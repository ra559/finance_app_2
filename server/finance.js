import { db, categories } from './db.js';

export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const monthStart = (offset = 0) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return date.toISOString().slice(0, 10);
};

const autoCategory = (description = '') => {
  const value = description.toLowerCase();
  if (/salary|payroll|direct dep|paycheck|interest income/.test(value)) return 'Income';
  if (/rent|mortgage|property management|hoa/.test(value)) return 'Housing';
  if (/grocery|whole foods|trader joe|aldi|costco|kroger|safeway|market basket/.test(value)) return 'Groceries';
  if (/restaurant|cafe|coffee|doordash|uber eats|grubhub|toast|chipotle|sweetgreen/.test(value)) return 'Dining';
  if (/uber|lyft|gas |shell|exxon|chevron|parking|transit|metro|train|toll/.test(value)) return 'Transportation';
  if (/amazon|target|walmart|best buy|ikea|etsy/.test(value)) return 'Shopping';
  if (/pharmacy|doctor|medical|health|dental|cvs|walgreens/.test(value)) return 'Health';
  if (/netflix|spotify|hulu|movie|theater|youtube|steam/.test(value)) return 'Entertainment';
  if (/electric|water|utility|internet|comcast|verizon|at&t|phone bill/.test(value)) return 'Utilities';
  if (/airline|hotel|airbnb|booking|vacation/.test(value)) return 'Travel';
  if (/transfer|payment thank|credit card payment/.test(value)) return 'Transfer';
  return 'Uncategorized';
};

export function addTransaction(input) {
  const description = String(input.description || input.name || 'Transaction').trim().slice(0, 250);
  const date = String(input.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const amount = roundMoney(input.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) return false;
  const fingerprint = input.fingerprint || `${input.source || 'manual'}:${input.external_id || ''}:${input.account_id || ''}:${date}:${amount}:${input.currency || 'USD'}:${description.toLowerCase()}`;
  try {
    db.prepare(`INSERT INTO transactions(user_id,account_id,external_id,date,description,merchant,category,amount,currency,pending,source,fingerprint)
      VALUES(1,@account_id,@external_id,@date,@description,@merchant,@category,@amount,@currency,@pending,@source,@fingerprint)`)
      .run({
        account_id: input.account_id || null,
        external_id: input.external_id || null,
        date,
        description,
        merchant: input.merchant || description,
        category: input.category || autoCategory(description),
        amount,
        currency: input.currency || 'USD',
        pending: input.pending ? 1 : 0,
        source: input.source || 'manual',
        fingerprint
      });
    return true;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw err;
  }
}

export function dashboardData() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const accounts = db.prepare(`SELECT id,name,institution,type,subtype,balance,currency,updated_at,
    CASE WHEN plaid_account_id IS NULL THEN 0 ELSE 1 END connected FROM accounts WHERE user_id=1 ORDER BY id`).all();
  const summary = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN type IN ('checking','savings','investment','cash','other_asset') THEN balance ELSE 0 END),0) assets,
    COALESCE(SUM(CASE WHEN type IN ('credit','loan','mortgage') THEN ABS(balance) ELSE 0 END),0) liabilities
    FROM accounts WHERE user_id=1`).get();
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN amount > 0 AND category != 'Transfer' THEN amount ELSE 0 END),0) income,
    COALESCE(SUM(CASE WHEN amount < 0 AND category != 'Transfer' THEN -amount ELSE 0 END),0) spending
    FROM transactions WHERE user_id=1 AND date>=?`).get(start);
  const recent = db.prepare(`SELECT t.id,t.account_id,t.date,t.description,t.merchant,t.category,t.amount,t.currency,t.pending,t.source,a.name account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
    WHERE t.user_id=1 ORDER BY t.date DESC,t.id DESC LIMIT 8`).all();
  const monthly = db.prepare(`SELECT substr(date,1,7) month,
    SUM(CASE WHEN amount > 0 AND category != 'Transfer' THEN amount ELSE 0 END) income,
    SUM(CASE WHEN amount < 0 AND category != 'Transfer' THEN -amount ELSE 0 END) spending
    FROM transactions WHERE user_id=1 AND date>=date('now','start of month','-5 months')
    GROUP BY substr(date,1,7) ORDER BY month`).all();
  const categorySpend = db.prepare(`SELECT category,SUM(-amount) amount FROM transactions WHERE user_id=1 AND amount<0 AND category!='Transfer' AND date>=? GROUP BY category ORDER BY amount DESC`).all(start);
  return {
    netWorth: roundMoney(summary.assets - summary.liabilities),
    assets: roundMoney(summary.assets),
    liabilities: roundMoney(summary.liabilities),
    income: roundMoney(totals.income),
    spending: roundMoney(totals.spending),
    cashFlow: roundMoney(totals.income - totals.spending),
    accounts,
    recent,
    monthly: monthly.map((row) => ({ ...row, income: roundMoney(row.income), spending: roundMoney(row.spending) })),
    categorySpend: categorySpend.map((row) => ({ ...row, amount: roundMoney(row.amount) }))
  };
}

export function budgetData() {
  const from = monthStart();
  const budgetRows = db.prepare('SELECT category,amount FROM budgets WHERE user_id=1 ORDER BY category').all();
  const spentRows = db.prepare(`SELECT category,SUM(-amount) spent FROM transactions WHERE user_id=1 AND amount<0 AND category!='Transfer' AND date>=? GROUP BY category`).all(from);
  const spent = new Map(spentRows.map((row) => [row.category, roundMoney(row.spent)]));
  return budgetRows.map((row) => ({ category: row.category, budget: row.amount, spent: spent.get(row.category) || 0 }));
}

export function monthlySummary(month) {
  const selected = /^\d{4}-\d{2}$/.test(month || '') ? month : new Date().toISOString().slice(0, 7);
  const row = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN amount<0 AND category!='Transfer' THEN -amount ELSE 0 END),0) spending,
    COALESCE(SUM(CASE WHEN amount>0 AND category!='Transfer' THEN amount ELSE 0 END),0) income
    FROM transactions WHERE user_id=1 AND substr(date,1,7)=?`).get(selected);
  const category = db.prepare(`SELECT category,SUM(-amount) amount FROM transactions WHERE user_id=1 AND amount<0 AND category!='Transfer' AND substr(date,1,7)=? GROUP BY category ORDER BY amount DESC`).all(selected);
  return { month: selected, spending: roundMoney(row.spending), income: roundMoney(row.income), cashFlow: roundMoney(row.income - row.spending), categories: category.map((item) => ({ ...item, amount: roundMoney(item.amount) })) };
}

export function recurringData() {
  const rows = db.prepare(`SELECT merchant,category,amount,date,description FROM transactions WHERE user_id=1 AND amount<0 AND category!='Transfer' ORDER BY date DESC`).all();
  const groups = new Map();
  for (const row of rows) {
    const merchant = (row.merchant || row.description).trim().toLowerCase();
    if (!groups.has(merchant)) groups.set(merchant, []);
    groups.get(merchant).push(row);
  }
  const items = [];
  for (const [merchant, txns] of groups) {
    if (txns.length < 2) continue;
    const amounts = txns.slice(0, 6).map((txn) => Math.abs(txn.amount));
    const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const stable = amounts.every((value) => Math.abs(value - average) <= Math.max(3, average * 0.2));
    const dates = txns.slice(0, 4).map((txn) => new Date(`${txn.date}T12:00:00Z`).getTime()).sort((a, b) => a - b);
    const intervals = dates.slice(1).map((value, index) => (value - dates[index]) / 86400000);
    const recurring = intervals.length > 0 && intervals.every((value) => value >= 6 && value <= 100);
    if (stable && recurring) {
      const days = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const cadence = days < 10 ? 'Weekly' : days < 24 ? 'Biweekly' : days < 40 ? 'Monthly' : 'Annual';
      items.push({ merchant: txns[0].merchant || merchant, category: txns[0].category, amount: roundMoney(average), cadence, lastDate: txns[0].date, occurrences: txns.length });
    }
  }
  return items.sort((a, b) => b.amount - a.amount);
}

export function netWorthHistory() {
  return db.prepare(`SELECT date,assets,liabilities,(assets-liabilities) netWorth FROM snapshots WHERE user_id=1 ORDER BY date`).all()
    .map((row) => ({ ...row, netWorth: roundMoney(row.netWorth) }));
}

export function financeContext() {
  const dashboard = dashboardData();
  const budgetProgress = budgetData();
  const monthlyCategories = db.prepare(`SELECT substr(date,1,7) month,category,SUM(-amount) amount
    FROM transactions WHERE user_id=1 AND amount<0 AND category!='Transfer'
    AND date>=date('now','start of month','-11 months') GROUP BY substr(date,1,7),category ORDER BY month,amount DESC`).all();
  const recent = db.prepare(`SELECT date,merchant,category,amount FROM transactions WHERE user_id=1 ORDER BY date DESC LIMIT 40`).all();
  const holdings = db.prepare(`SELECT h.ticker,h.name,h.quantity,h.price,h.value,h.currency,a.name account
    FROM holdings h LEFT JOIN accounts a ON a.id=h.account_id WHERE h.user_id=1 ORDER BY h.value DESC`).all();
  const investmentHistory = db.prepare(`SELECT date,value FROM investment_snapshots WHERE user_id=1 AND date>=date('now','start of month','-11 months') ORDER BY date`).all();
  return JSON.stringify({
    currency: 'USD',
    current: { netWorth: dashboard.netWorth, assets: dashboard.assets, liabilities: dashboard.liabilities, income: dashboard.income, spending: dashboard.spending, cashFlow: dashboard.cashFlow },
    accounts: dashboard.accounts.map(({ name, institution, type, balance, currency }) => ({ name, institution, type, balance, currency })),
    monthlyCashFlow: dashboard.monthly,
    monthlyCategorySpend: monthlyCategories,
    budgetProgress,
    investmentHoldings: holdings,
    investmentValueHistory: investmentHistory,
    recentTransactions: recent
  }, null, 2);
}

export { autoCategory, categories };
