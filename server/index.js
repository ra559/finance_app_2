import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, hasUser, takeSnapshot, categories } from './db.js';
import { authMiddleware, clearSessionCookie, consumeSetupCode, createSessionCookie, hashToken, mcpAuth, mcpOriginGuard, verifySetupCode } from './security.js';
import { addTransaction, budgetData, dashboardData, financeContext, monthlySummary, netWorthHistory, recurringData, roundMoney } from './finance.js';
import { parseImport } from './importers.js';
import { createLinkToken, exchangePublicToken, plaidReady, removePlaidItem, syncAllItems } from './plaid.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(dirname, '../dist');
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://sandbox.plaid.com https://development.plaid.com https://production.plaid.com; frame-src https://cdn.plaid.com; base-uri 'self'; frame-ancestors 'none'"
  });
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  const cookie = req.headers.cookie || '';
  req.cookies = Object.fromEntries(cookie.split(';').map((part) => {
    const [name, ...value] = part.trim().split('=');
    return [name, decodeURIComponent(value.join('='))];
  }).filter(([name]) => name));
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const requireAuth = authMiddleware;
const failedLogins = new Map();

function loginGuard(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const attempts = failedLogins.get(ip);
  if (attempts?.blockedUntil > now) return res.status(429).json({ error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
  if (attempts && now - attempts.startedAt > 15 * 60 * 1000) failedLogins.delete(ip);
  req.loginIp = ip;
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/api/status', (req, res) => {
  const raw = req.cookies?.ledger_session;
  let signedIn = false;
  if (raw) {
    const [payload, signature] = raw.split('.');
    if (payload && signature) {
      const expected = crypto.createHmac('sha256', fs.readFileSync(path.resolve(process.env.DATA_DIR || './data', 'instance.key'))).update(payload).digest('base64url');
      if (signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        try { const session = JSON.parse(Buffer.from(payload, 'base64url').toString()); signedIn = session.sub === 1 && session.exp > Date.now() / 1000; } catch { /* invalid cookie */ }
      }
    }
  }
  res.json({ setupRequired: !hasUser(), signedIn, plaidEnabled: plaidReady(), aiEnabled: Boolean(process.env.OPENAI_API_KEY || process.env.OLLAMA_MODEL), aiModel: process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL || 'configured model' : process.env.OLLAMA_MODEL || null });
});

app.post('/api/auth/setup', asyncRoute(async (req, res) => {
  if (hasUser()) return res.status(409).json({ error: 'Setup is already complete.' });
  if (!verifySetupCode(req.body.setupCode)) return res.status(403).json({ error: 'Enter the one-time setup code shown in the server logs.' });
  const username = String(req.body.username || '').trim().slice(0, 40);
  const password = String(req.body.password || '');
  if (!username || password.length < 12) return res.status(400).json({ error: 'Choose a username and a password with at least 12 characters.' });
  const hash = await bcrypt.hash(password, 12);
  try { db.prepare('INSERT INTO users(id,username,password_hash) VALUES(1,?,?)').run(username, hash); }
  catch { return res.status(409).json({ error: 'Setup has already been completed.' }); }
  consumeSetupCode();
  takeSnapshot();
  createSessionCookie(res, 1);
  res.json({ ok: true, username });
}));

app.post('/api/auth/login', loginGuard, asyncRoute(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=1').get();
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    const now = Date.now();
    const prior = failedLogins.get(req.loginIp);
    const attempt = !prior || now - prior.startedAt > 15 * 60 * 1000 ? { count: 1, startedAt: now } : { ...prior, count: prior.count + 1 };
    if (attempt.count >= 5) attempt.blockedUntil = now + 15 * 60 * 1000;
    failedLogins.set(req.loginIp, attempt);
    return res.status(401).json({ error: 'That password did not match.' });
  }
  failedLogins.delete(req.loginIp);
  createSessionCookie(res, 1);
  res.json({ ok: true, username: user.username });
}));

app.post('/api/auth/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });
app.get('/api/me', requireAuth, (req, res) => res.json(db.prepare('SELECT username,created_at FROM users WHERE id=?').get(req.userId)));
app.get('/api/dashboard', requireAuth, (_req, res) => res.json(dashboardData()));
app.get('/api/categories', requireAuth, (_req, res) => res.json(categories));
app.get('/api/budgets', requireAuth, (_req, res) => res.json(budgetData()));
app.put('/api/budgets', requireAuth, (req, res) => {
  const rows = Array.isArray(req.body.budgets) ? req.body.budgets : [];
  const update = db.prepare(`INSERT INTO budgets(user_id,category,amount) VALUES(1,?,?)
    ON CONFLICT(user_id,category) DO UPDATE SET amount=excluded.amount`);
  const remove = db.prepare('DELETE FROM budgets WHERE user_id=1 AND category=?');
  const transaction = db.transaction(() => {
    for (const row of rows) {
      const category = String(row.category || '').trim().slice(0, 80);
      const amount = Number(row.amount);
      if (!category || !Number.isFinite(amount) || amount < 0) continue;
      if (amount === 0) remove.run(category); else update.run(category, roundMoney(amount));
    }
  });
  transaction();
  res.json(budgetData());
});

app.get('/api/transactions', requireAuth, (req, res) => {
  const where = ['t.user_id=1'];
  const values = [];
  if (req.query.search) { where.push('(t.description LIKE ? OR t.merchant LIKE ?)'); values.push(`%${String(req.query.search).slice(0, 80)}%`, `%${String(req.query.search).slice(0, 80)}%`); }
  if (req.query.category && req.query.category !== 'All categories') { where.push('t.category=?'); values.push(String(req.query.category).slice(0, 80)); }
  if (req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) { where.push('t.date>=?'); values.push(req.query.from); }
  if (req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) { where.push('t.date<=?'); values.push(req.query.to); }
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
  res.json(db.prepare(`SELECT t.id,t.account_id,t.date,t.description,t.merchant,t.category,t.amount,t.currency,t.pending,t.source,a.name account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE ${where.join(' AND ')} ORDER BY t.date DESC,t.id DESC LIMIT ?`).all(...values, limit));
});

app.patch('/api/transactions/:id', requireAuth, (req, res) => {
  const category = String(req.body.category || '').trim().slice(0, 80);
  if (!category) return res.status(400).json({ error: 'Choose a category.' });
  const result = db.prepare('UPDATE transactions SET category=? WHERE id=? AND user_id=1').run(category, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Transaction not found.' });
  res.json({ ok: true });
});

app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM transactions WHERE id=? AND user_id=1').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Transaction not found.' });
  res.json({ ok: true });
});

app.post('/api/transactions', requireAuth, (req, res) => {
  const date = String(req.body.date || '').slice(0, 10);
  const description = String(req.body.description || '').trim();
  const amount = Number(req.body.amount);
  const accountId = req.body.accountId ? Number(req.body.accountId) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description || !Number.isFinite(amount)) return res.status(400).json({ error: 'Add a date, description, and valid amount.' });
  if (accountId && !db.prepare('SELECT id FROM accounts WHERE id=? AND user_id=1').get(accountId)) return res.status(400).json({ error: 'Choose one of your accounts.' });
  const inserted = addTransaction({ date, description, merchant: description, amount, category: req.body.category, account_id: accountId, source: 'manual' });
  if (!inserted) return res.status(409).json({ error: 'A matching transaction already exists.' });
  res.status(201).json({ ok: true });
});

app.post('/api/import', requireAuth, upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a file to import.' });
    const accountId = req.body.accountId ? Number(req.body.accountId) : null;
    if (accountId && !db.prepare('SELECT id FROM accounts WHERE id=? AND user_id=1').get(accountId)) return res.status(400).json({ error: 'Choose one of your accounts.' });
    const items = parseImport(req.file.originalname, req.file.buffer);
    let imported = 0;
    for (const item of items) if (addTransaction({ ...item, account_id: accountId, currency: req.body.currency || 'USD' })) imported += 1;
    res.json({ imported, skipped: items.length - imported, total: items.length });
  } catch (err) { next(err); }
});

app.get('/api/accounts', requireAuth, (_req, res) => res.json(db.prepare(`SELECT id,name,institution,type,subtype,balance,currency,updated_at,CASE WHEN plaid_account_id IS NULL THEN 0 ELSE 1 END connected FROM accounts WHERE user_id=1 ORDER BY id`).all()));
app.post('/api/accounts', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const institution = String(req.body.institution || 'Manual account').trim().slice(0, 80);
  const allowed = ['checking', 'savings', 'investment', 'credit', 'loan', 'mortgage', 'cash', 'other_asset'];
  const type = allowed.includes(req.body.type) ? req.body.type : 'checking';
  const balance = Number(req.body.balance);
  if (!name || !Number.isFinite(balance)) return res.status(400).json({ error: 'Add an account name and a valid balance.' });
  const info = db.prepare('INSERT INTO accounts(user_id,name,institution,type,balance,currency) VALUES(1,?,?,?,?,?)')
    .run(name, institution, type, roundMoney(balance), req.body.currency || 'USD');
  takeSnapshot();
  res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id=?').get(info.lastInsertRowid));
});

app.patch('/api/accounts/:id', requireAuth, (req, res) => {
  const balance = Number(req.body.balance);
  if (!Number.isFinite(balance)) return res.status(400).json({ error: 'Enter a valid balance.' });
  const result = db.prepare('UPDATE accounts SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=1').run(roundMoney(balance), Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Account not found.' });
  takeSnapshot();
  res.json({ ok: true });
});

app.delete('/api/accounts/:id', requireAuth, (req, res) => {
  if (db.prepare('SELECT id FROM accounts WHERE id=? AND plaid_account_id IS NOT NULL AND user_id=1').get(Number(req.params.id))) return res.status(409).json({ error: 'Disconnect this bank from Settings to remove its linked accounts.' });
  const result = db.prepare('DELETE FROM accounts WHERE id=? AND user_id=1').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Account not found.' });
  takeSnapshot();
  res.json({ ok: true });
});

app.get('/api/net-worth', requireAuth, (_req, res) => res.json(netWorthHistory()));
app.post('/api/snapshot', requireAuth, (_req, res) => { takeSnapshot(); res.json(netWorthHistory()); });
app.get('/api/recurring', requireAuth, (_req, res) => res.json(recurringData()));
app.get('/api/holdings', requireAuth, (_req, res) => res.json(db.prepare(`SELECT h.*,a.name account_name FROM holdings h LEFT JOIN accounts a ON a.id=h.account_id WHERE h.user_id=1 ORDER BY h.value DESC`).all()));
app.get('/api/holding-history', requireAuth, (_req, res) => res.json(db.prepare(`SELECT date,security_id,ticker,name,SUM(value) value FROM holding_snapshots WHERE user_id=1 GROUP BY date,security_id ORDER BY date`).all()));
app.get('/api/investment-history', requireAuth, (_req, res) => res.json(db.prepare('SELECT date,value FROM investment_snapshots WHERE user_id=1 ORDER BY date').all()));
app.get('/api/monthly-summary', requireAuth, (req, res) => res.json(monthlySummary(String(req.query.month || ''))));

app.get('/api/plaid/status', requireAuth, (_req, res) => {
  const institutions = db.prepare('SELECT id,institution,updated_at FROM plaid_items WHERE user_id=1 ORDER BY id').all();
  res.json({ enabled: plaidReady(), institutions });
});
app.post('/api/plaid/link-token', requireAuth, asyncRoute(async (_req, res) => {
  if (!plaidReady()) return res.status(503).json({ error: 'Plaid is not configured on this server.' });
  res.json({ linkToken: await createLinkToken() });
}));
app.post('/api/plaid/exchange', requireAuth, asyncRoute(async (req, res) => {
  if (!plaidReady()) return res.status(503).json({ error: 'Plaid is not configured on this server.' });
  if (!req.body.publicToken) return res.status(400).json({ error: 'Missing Plaid public token.' });
  res.json(await exchangePublicToken(req.body.publicToken));
}));
app.post('/api/plaid/sync', requireAuth, asyncRoute(async (_req, res) => {
  if (!plaidReady()) return res.status(503).json({ error: 'Plaid is not configured on this server.' });
  await syncAllItems();
  res.json({ ok: true });
}));
app.delete('/api/plaid/items/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!plaidReady()) return res.status(503).json({ error: 'Plaid is not configured on this server.' });
  const removed = await removePlaidItem(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Linked institution not found.' });
  res.json({ ok: true });
}));

app.get('/api/settings', requireAuth, (_req, res) => {
  const tokens = db.prepare('SELECT id,label,created_at,last_used_at FROM mcp_tokens WHERE user_id=1 ORDER BY id DESC').all();
  const plaidInstitutions = db.prepare('SELECT id,institution,updated_at FROM plaid_items WHERE user_id=1 ORDER BY id').all();
  const me = db.prepare('SELECT username,created_at FROM users WHERE id=1').get();
  res.json({ ...me, mcpTokens: tokens, plaidInstitutions, ai: { enabled: Boolean(process.env.OPENAI_API_KEY || process.env.OLLAMA_MODEL), model: process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL || 'Configured endpoint' : process.env.OLLAMA_MODEL || null }, plaidEnabled: plaidReady() });
});

app.post('/api/mcp-tokens', requireAuth, (req, res) => {
  const label = String(req.body.label || 'MCP client').trim().slice(0, 80) || 'MCP client';
  const token = `ldg_${crypto.randomBytes(32).toString('base64url')}`;
  const result = db.prepare('INSERT INTO mcp_tokens(user_id,label,token_hash) VALUES(1,?,?)').run(label, hashToken(token));
  res.status(201).json({ id: result.lastInsertRowid, token, label });
});
app.delete('/api/mcp-tokens/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM mcp_tokens WHERE id=? AND user_id=1').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Token not found.' });
  res.json({ ok: true });
});

app.post('/api/chat', requireAuth, asyncRoute(async (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 3000);
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8).filter((item) => ['user', 'assistant'].includes(item.role)).map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 3000) })) : [];
  if (!message) return res.status(400).json({ error: 'Type a question first.' });
  const context = financeContext();
  const system = `You are Ledger's private personal-finance assistant. Answer clearly and conservatively using the supplied data. Currency is USD. Expenses are negative in transaction records. State when the data does not support an answer. Do not claim to give regulated financial, tax, or legal advice. Never invent figures. The following is the user's current finance summary; it is private account data.\n${context}`;
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: message }];
  let endpoint, payload, headers = { 'Content-Type': 'application/json' };
  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    endpoint = `${base}/chat/completions`;
    headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
    payload = { model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages, temperature: 0.2 };
  } else if (process.env.OLLAMA_MODEL) {
    const base = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
    endpoint = `${base}/api/chat`;
    payload = { model: process.env.OLLAMA_MODEL, messages, stream: false, options: { temperature: 0.2 } };
  } else {
    return res.status(503).json({ error: 'AI is not configured. Set OLLAMA_MODEL (recommended for local use), or an OpenAI-compatible endpoint, in the server environment.' });
  }
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(120_000) });
  const body = await response.json();
  if (!response.ok) return res.status(502).json({ error: body.error?.message || body.error || 'The configured AI endpoint returned an error.' });
  res.json({ reply: body.choices?.[0]?.message?.content || body.message?.content || 'I could not form an answer from the current data.' });
}));

const mcpTools = [
  { name: 'get_spending_summary', description: 'Get income, spending, cash flow, and category totals for a calendar month. Month uses YYYY-MM and defaults to the current month.', inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'Calendar month in YYYY-MM format.' } }, additionalProperties: false } },
  { name: 'get_budget_progress', description: 'Get each configured monthly category budget, amount spent so far, and remaining amount.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_net_worth', description: 'Get current assets, liabilities, net worth, and saved balance snapshots over time.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_transactions', description: 'List recent transactions with date, merchant, category, and signed amount. Use month such as 2026-11 to filter.', inputSchema: { type: 'object', properties: { month: { type: 'string' }, category: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: 'list_accounts', description: 'List account names, types, and latest balances.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_investment_holdings', description: 'Get current investment positions, recorded portfolio values over time, and individual holding value snapshots.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_recurring_bills', description: 'List likely recurring bills and subscriptions detected from matching transaction history.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
];
const mcpProtocolVersions = ['2024-11-05', '2025-03-26', '2025-06-18'];

function callMcpTool(name, args = {}) {
  if (name === 'get_spending_summary') return monthlySummary(args.month);
  if (name === 'get_budget_progress') return budgetData().map((row) => ({ ...row, remaining: roundMoney(row.budget - row.spent), percentUsed: row.budget ? Math.round(row.spent / row.budget * 100) : 0 }));
  if (name === 'get_net_worth') {
    const dashboard = dashboardData();
    return { current: { netWorth: dashboard.netWorth, assets: dashboard.assets, liabilities: dashboard.liabilities }, history: netWorthHistory() };
  }
  if (name === 'list_transactions') {
    const where = ['user_id=1']; const values = [];
    if (args.month && /^\d{4}-\d{2}$/.test(args.month)) { where.push("substr(date,1,7)=?"); values.push(args.month); }
    if (args.category) { where.push('category=?'); values.push(String(args.category).slice(0, 80)); }
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 30));
    return db.prepare(`SELECT date,description,merchant,category,amount,currency FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC,id DESC LIMIT ?`).all(...values, limit);
  }
  if (name === 'list_accounts') return db.prepare('SELECT name,institution,type,balance,currency,updated_at FROM accounts WHERE user_id=1 ORDER BY id').all();
  if (name === 'get_investment_holdings') return {
    currentHoldings: db.prepare(`SELECT h.ticker,h.name,h.quantity,h.price,h.value,h.currency,a.name account FROM holdings h LEFT JOIN accounts a ON a.id=h.account_id WHERE h.user_id=1 ORDER BY h.value DESC`).all(),
    portfolioHistory: db.prepare(`SELECT date,value FROM investment_snapshots WHERE user_id=1 ORDER BY date`).all(),
    holdingHistory: db.prepare(`SELECT date,ticker,name,SUM(value) value FROM holding_snapshots WHERE user_id=1 AND date>=date('now','start of month','-11 months') GROUP BY date,security_id ORDER BY date`).all()
  };
  if (name === 'list_recurring_bills') return recurringData();
  throw new Error(`Unknown tool: ${name}`);
}

app.get('/mcp', mcpOriginGuard, (_req, res) => res.status(405).set('Allow', 'POST').end());
app.post('/mcp', mcpAuth, (req, res) => {
  const message = req.body;
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid JSON-RPC request.' }, id: message?.id ?? null });
  const headerVersion = req.get('mcp-protocol-version');
  if (message.method !== 'initialize' && headerVersion && !mcpProtocolVersions.includes(headerVersion)) return res.status(400).json({ error: 'Unsupported MCP protocol version.' });
  if (!Object.hasOwn(message, 'id')) return res.status(202).end();
  const reply = (result) => res.type('application/json').json({ jsonrpc: '2.0', id: message.id, result });
  const error = (code, text) => res.type('application/json').json({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });
  if (message.method === 'initialize') {
    const version = message.params?.protocolVersion || '2025-03-26';
    return reply({ protocolVersion: mcpProtocolVersions.includes(version) ? version : '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'ledger', version: '1.0.0' }, instructions: 'Read-only personal finance data for the authenticated Ledger user.' });
  }
  if (message.method === 'ping') return reply({});
  if (message.method === 'tools/list') return reply({ tools: mcpTools });
  if (message.method === 'tools/call') {
    try {
      const result = callMcpTool(message.params?.name, message.params?.arguments || {});
      return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false });
    } catch (err) { return reply({ content: [{ type: 'text', text: err.message }], isError: true }); }
  }
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return res.status(202).end();
  return error(-32601, `Method not found: ${message.method}`);
});
app.all('/mcp', mcpOriginGuard, (_req, res) => res.status(405).set('Allow', 'GET, POST').end());

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/mcp') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File must be 10 MB or smaller.' : 'Could not upload that file.' });
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong.' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Ledger is listening on port ${port}`);
  if (!hasUser()) {
    const setupCode = fs.readFileSync(path.resolve(process.env.DATA_DIR || './data', 'setup.code'), 'utf8').trim();
    console.log(`One-time first-run setup code: ${setupCode}`);
  }
  if (plaidReady()) {
    syncAllItems();
    setInterval(syncAllItems, 6 * 60 * 60 * 1000).unref();
  }
  setInterval(() => takeSnapshot(), 24 * 60 * 60 * 1000).unref();
});
