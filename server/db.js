import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
process.umask(0o077);
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
fs.chmodSync(dataDir, 0o700);
const databasePath = path.join(dataDir, 'ledger.db');
export const db = new Database(databasePath);
fs.chmodSync(databasePath, 0o600);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT 'Manual account',
  type TEXT NOT NULL DEFAULT 'checking',
  subtype TEXT,
  balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  plaid_account_id TEXT UNIQUE,
  plaid_item_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER,
  external_id TEXT,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  merchant TEXT,
  category TEXT NOT NULL DEFAULT 'Uncategorized',
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  pending INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions(category);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, category),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  assets REAL NOT NULL,
  liabilities REAL NOT NULL,
  UNIQUE(user_id, date),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS investment_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  UNIQUE(user_id, date),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS plaid_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  item_id TEXT NOT NULL UNIQUE,
  institution TEXT NOT NULL DEFAULT 'Linked institution',
  encrypted_access_token TEXT NOT NULL,
  cursor TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER,
  security_id TEXT,
  ticker TEXT,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS holding_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  account_id INTEGER,
  security_id TEXT NOT NULL,
  ticker TEXT,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  UNIQUE(user_id,date,account_id,security_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL DEFAULT 'MCP client',
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const accountColumns = db.pragma('table_info(accounts)');
if (!accountColumns.some((column) => column.name === 'plaid_item_id')) db.exec('ALTER TABLE accounts ADD COLUMN plaid_item_id TEXT');
db.exec('CREATE INDEX IF NOT EXISTS accounts_plaid_item_idx ON accounts(plaid_item_id)');

export const categories = [
  'Housing', 'Groceries', 'Dining', 'Transportation', 'Shopping', 'Health',
  'Entertainment', 'Utilities', 'Travel', 'Personal care', 'Education',
  'Income', 'Transfer', 'Other', 'Uncategorized'
];

export function takeSnapshot(date = new Date().toISOString().slice(0, 10)) {
  if (!db.prepare('SELECT id FROM users WHERE id=1').get()) return;
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN type IN ('checking','savings','investment','cash','other_asset') THEN balance ELSE 0 END), 0) assets,
    COALESCE(SUM(CASE WHEN type IN ('credit','loan','mortgage') THEN ABS(balance) ELSE 0 END), 0) liabilities
    FROM accounts WHERE user_id = 1`).get();
  db.prepare(`INSERT INTO snapshots(user_id,date,assets,liabilities) VALUES(1,?,?,?)
    ON CONFLICT(user_id,date) DO UPDATE SET assets=excluded.assets, liabilities=excluded.liabilities`)
    .run(date, totals.assets, totals.liabilities);
  const investment = db.prepare("SELECT COALESCE(SUM(balance),0) value FROM accounts WHERE user_id=1 AND type='investment'").get();
  db.prepare(`INSERT INTO investment_snapshots(user_id,date,value) VALUES(1,?,?)
    ON CONFLICT(user_id,date) DO UPDATE SET value=excluded.value`).run(date, investment.value);
  db.prepare('DELETE FROM holding_snapshots WHERE user_id=1 AND date=?').run(date);
  db.prepare(`INSERT INTO holding_snapshots(user_id,date,account_id,security_id,ticker,name,quantity,price,value,currency)
    SELECT user_id,?,account_id,security_id,COALESCE(ticker,''),name,quantity,price,value,currency FROM holdings WHERE user_id=1`).run(date);
}

export function hasUser() {
  return Boolean(db.prepare('SELECT id FROM users LIMIT 1').get());
}
