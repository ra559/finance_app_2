import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const keyPath = path.join(dataDir, 'instance.key');
let key;
try {
  key = fs.readFileSync(keyPath);
} catch {
  key = crypto.randomBytes(32);
  const fd = fs.openSync(keyPath, 'wx', 0o600);
  fs.writeFileSync(fd, key);
  fs.closeSync(fd);
}
if (key.length !== 32) throw new Error('Invalid instance encryption key');

const cookieName = 'ledger_session';
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const setupCodePath = path.join(dataDir, 'setup.code');
let setupCode;
if (!db.prepare('SELECT id FROM users WHERE id=1').get()) {
  try { setupCode = fs.readFileSync(setupCodePath, 'utf8').trim(); }
  catch {
    setupCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    const fd = fs.openSync(setupCodePath, 'wx', 0o600);
    fs.writeFileSync(fd, setupCode);
    fs.closeSync(fd);
  }
  if (!/^[A-F0-9]{12}$/.test(setupCode)) {
    setupCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    fs.writeFileSync(setupCodePath, setupCode, { mode: 0o600 });
    fs.chmodSync(setupCodePath, 0o600);
  }
} else {
  setupCode = '';
  try { fs.unlinkSync(setupCodePath); } catch { /* no stale setup code */ }
}

export function verifySetupCode(candidate) {
  const value = String(candidate || '').trim().toUpperCase();
  return Boolean(setupCode) && value.length === setupCode.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(setupCode));
}

export function consumeSetupCode() {
  try { fs.unlinkSync(setupCodePath); } catch { /* setup has already been consumed */ }
  setupCode = '';
}

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

export function decrypt(value) {
  const [ivText, tagText, bodyText] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
}

function sign(value) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

export function createSessionCookie(res, userId) {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: expires })).toString('base64url');
  const value = `${payload}.${sign(payload)}`;
  res.cookie(cookieName, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 14 * 24 * 60 * 60 * 1000
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
}

export function authMiddleware(req, res, next) {
  const raw = req.cookies?.[cookieName];
  if (!raw) return res.status(401).json({ error: 'Sign in to continue.' });
  const [payload, signature] = raw.split('.');
  const expectedSignature = payload ? sign(payload) : '';
  if (!payload || !signature || signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now() / 1000 || data.sub !== 1) throw new Error('expired');
    req.userId = data.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
}

export function mcpOriginGuard(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      const parsed = new URL(origin);
      const allowed = new Set([req.get('host'), req.get('x-forwarded-host')].filter(Boolean));
      if (!allowed.has(parsed.host)) return res.status(403).json({ error: 'Origin not allowed.' });
    } catch {
      return res.status(403).json({ error: 'Invalid origin.' });
    }
  }
  next();
}

export function mcpAuth(req, res, next) {
  return mcpOriginGuard(req, res, () => {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ error: 'Use a Ledger MCP bearer token.' });
  const tokenHash = hashToken(match[1]);
  const row = db.prepare('SELECT id,user_id FROM mcp_tokens WHERE token_hash=?').get(tokenHash);
  if (!row) return res.status(401).json({ error: 'Invalid MCP token.' });
  db.prepare('UPDATE mcp_tokens SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id);
  req.userId = row.user_id;
  next();
  });
}
