import { db, takeSnapshot } from './db.js';
import { addTransaction } from './finance.js';
import { decrypt, encrypt } from './security.js';

const environments = { sandbox: 'https://sandbox.plaid.com', development: 'https://development.plaid.com', production: 'https://production.plaid.com' };
const plaidReady = () => Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);

async function plaidRequest(endpoint, payload) {
  if (!plaidReady()) throw new Error('Add PLAID_CLIENT_ID and PLAID_SECRET to enable bank linking.');
  const base = environments[process.env.PLAID_ENV || 'sandbox'] || environments.sandbox;
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...payload })
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error_message || `Plaid request failed (${response.status}).`);
    error.code = data.error_code;
    throw error;
  }
  return data;
}

export { plaidReady };

function ledgerCategory(transaction) {
  const primary = transaction.personal_finance_category?.primary || '';
  const detail = transaction.personal_finance_category?.detailed || '';
  if (primary === 'INCOME') return 'Income';
  if (primary.startsWith('TRANSFER_')) return 'Transfer';
  if (primary === 'FOOD_AND_DRINK') return 'Dining';
  if (primary === 'GENERAL_MERCHANDISE') return 'Shopping';
  if (primary === 'TRANSPORTATION') return 'Transportation';
  if (primary === 'MEDICAL') return 'Health';
  if (primary === 'ENTERTAINMENT') return 'Entertainment';
  if (primary === 'TRAVEL') return 'Travel';
  if (primary === 'PERSONAL_CARE') return 'Personal care';
  if (primary === 'EDUCATION') return 'Education';
  if (primary === 'RENT_AND_UTILITIES') return /utilities|electric|water|internet/i.test(detail) ? 'Utilities' : 'Housing';
  if (primary === 'HOME_IMPROVEMENT') return 'Housing';
  if (primary === 'BANK_FEES' || primary === 'GOVERNMENT_AND_NON_PROFIT' || primary === 'LOAN_PAYMENTS') return 'Other';
  return null;
}

export async function createLinkToken() {
  const result = await plaidRequest('/link/token/create', {
    user: { client_user_id: 'ledger-local-user' },
    client_name: 'Ledger',
    products: ['transactions'],
    optional_products: ['investments'],
    country_codes: ['US'],
    language: 'en',
    transactions: { days_requested: 730 }
  });
  return result.link_token;
}

export async function exchangePublicToken(publicToken) {
  const { access_token: accessToken, item_id: itemId } = await plaidRequest('/item/public_token/exchange', { public_token: publicToken });
  const item = await plaidRequest('/item/get', { access_token: accessToken });
  const institution = item.item.institution_name || 'Linked institution';
  db.prepare(`INSERT INTO plaid_items(user_id,item_id,institution,encrypted_access_token,cursor) VALUES(1,?,?,?,NULL)
    ON CONFLICT(item_id) DO UPDATE SET institution=excluded.institution,encrypted_access_token=excluded.encrypted_access_token`)
    .run(itemId, institution, encrypt(accessToken));
  const accountResponse = await plaidRequest('/accounts/get', { access_token: accessToken });
  const upsert = db.prepare(`INSERT INTO accounts(user_id,name,institution,type,subtype,balance,currency,plaid_account_id,plaid_item_id)
    VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(plaid_account_id) DO UPDATE SET name=excluded.name,balance=excluded.balance,subtype=excluded.subtype,plaid_item_id=excluded.plaid_item_id`);
  for (const account of accountResponse.accounts || []) {
    const type = account.type === 'credit' ? 'credit' : account.type === 'investment' ? 'investment' : account.type === 'loan' ? 'loan' : account.type === 'depository' ? (account.subtype === 'savings' ? 'savings' : 'checking') : 'other_asset';
    const balance = type === 'credit' || type === 'loan' ? Math.abs(account.balances.current || 0) : account.balances.current || 0;
    upsert.run(account.name, institution, type, account.subtype || '', balance, account.balances.iso_currency_code || 'USD', account.account_id, itemId);
  }
  await syncItem(itemId);
  return { institution };
}

export async function syncItem(itemId) {
  const item = db.prepare('SELECT * FROM plaid_items WHERE item_id=? AND user_id=1').get(itemId);
  if (!item) return;
  const accessToken = decrypt(item.encrypted_access_token);
  const previousCursor = item.cursor || undefined;
  let cursor, added, modified, removed;
  let retries = 0;
  while (true) {
    cursor = previousCursor;
    added = []; modified = []; removed = [];
    let hasMore = true;
    try {
      while (hasMore) {
        const page = await plaidRequest('/transactions/sync', { access_token: accessToken, ...(cursor ? { cursor } : {}) });
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed);
        cursor = page.next_cursor;
        hasMore = page.has_more;
      }
      break;
    } catch (error) {
      if (error.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || retries >= 3) throw error;
      retries += 1;
    }
  }
  const accountRows = db.prepare('SELECT id,plaid_account_id FROM accounts WHERE user_id=1 AND plaid_item_id=?').all(item.item_id);
  const accountMap = new Map(accountRows.map((row) => [row.plaid_account_id, row.id]));
  const remove = db.prepare('DELETE FROM transactions WHERE external_id=? AND source=\'plaid\'');
  for (const txn of removed) remove.run(txn.transaction_id);
  const save = (txn) => {
    const amount = -Number(txn.amount || 0);
    const fingerprint = `plaid:${txn.transaction_id}`;
    const prior = db.prepare('SELECT id FROM transactions WHERE fingerprint=?').get(fingerprint);
    if (prior) {
      db.prepare(`UPDATE transactions SET date=?,description=?,merchant=?,category=COALESCE(?,category),amount=?,pending=?,account_id=? WHERE id=?`)
        .run(txn.date, txn.name, txn.merchant_name || txn.name, ledgerCategory(txn), amount, txn.pending ? 1 : 0, accountMap.get(txn.account_id) || null, prior.id);
    } else {
      addTransaction({ date: txn.date, description: txn.name, merchant: txn.merchant_name || txn.name, amount,
        category: ledgerCategory(txn) || undefined,
        account_id: accountMap.get(txn.account_id), external_id: txn.transaction_id, source: 'plaid', pending: txn.pending, fingerprint });
    }
  };
  for (const txn of added) save(txn);
  for (const txn of modified) save(txn);
  db.prepare('UPDATE plaid_items SET cursor=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(cursor || null, item.id);

  // Balances and positions can change independently of new transactions.
  const accountResponse = await plaidRequest('/accounts/get', { access_token: accessToken });
  for (const account of accountResponse.accounts || []) {
    const type = account.type === 'credit' ? 'credit' : account.type === 'investment' ? 'investment' : account.type === 'loan' ? 'loan' : account.type === 'depository' ? (account.subtype === 'savings' ? 'savings' : 'checking') : 'other_asset';
    const balance = type === 'credit' || type === 'loan' ? Math.abs(account.balances.current || 0) : account.balances.current || 0;
    db.prepare('UPDATE accounts SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE plaid_account_id=? AND user_id=1').run(balance, account.account_id);
  }
  try {
    const holdings = await plaidRequest('/investments/holdings/get', { access_token: accessToken });
    const accountIds = new Map(accountRows.map((row) => [row.plaid_account_id, row.id]));
    const securities = new Map((holdings.securities || []).map((security) => [security.security_id, security]));
    const upsert = db.prepare(`INSERT INTO holdings(user_id,account_id,security_id,ticker,name,quantity,price,value,currency)
      VALUES(1,?,?,?,?,?,?,?,?)`);
    db.prepare('DELETE FROM holdings WHERE user_id=1 AND account_id IN (SELECT id FROM accounts WHERE plaid_item_id=?)').run(item.item_id);
    for (const holding of holdings.holdings || []) {
      const security = securities.get(holding.security_id) || {};
      upsert.run(accountIds.get(holding.account_id) || null, holding.security_id, security.ticker_symbol || null,
        security.name || security.ticker_symbol || 'Investment', holding.quantity || 0, holding.institution_price || 0,
        holding.institution_value || 0, security.iso_currency_code || 'USD');
    }
  } catch (err) {
    // Investment access is optional for many linked Items.
    if (!/PRODUCTS_NOT_SUPPORTED|NO_INVESTMENT_ACCOUNTS|PRODUCT_NOT_READY/.test(err.message)) console.warn('Plaid holdings sync:', err.message);
  }
  takeSnapshot();
}

export async function syncAllItems() {
  const items = db.prepare('SELECT item_id FROM plaid_items WHERE user_id=1').all();
  for (const item of items) {
    try { await syncItem(item.item_id); }
    catch (err) { console.warn(`Bank sync failed for ${item.item_id}:`, err.message); }
  }
}

export async function removePlaidItem(itemId) {
  const item = db.prepare('SELECT * FROM plaid_items WHERE id=? AND user_id=1').get(Number(itemId));
  if (!item) return false;
  await plaidRequest('/item/remove', { access_token: decrypt(item.encrypted_access_token) });
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM holdings WHERE account_id IN (SELECT id FROM accounts WHERE plaid_item_id=?)').run(item.item_id);
    db.prepare('DELETE FROM accounts WHERE plaid_item_id=? AND user_id=1').run(item.item_id);
    db.prepare('DELETE FROM plaid_items WHERE id=? AND user_id=1').run(item.id);
  });
  remove();
  takeSnapshot();
  return true;
}
