// HANDS 서버 공용 — 수파베이스는 서버 열쇠(service_role)로만 만진다. 화면은 DB를 직접 못 만짐.
const crypto = require('crypto');

const URL_ = process.env.HANDS_SUPABASE_URL;
const SERVICE = process.env.HANDS_SUPABASE_SERVICE_KEY;
const BUCKET = 'passports';

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('base64url'); }
function newCode() { return String(crypto.randomInt(0, 100000000)).padStart(8, '0'); }

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

// PostgREST
async function db(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const err = new HttpError(r.status >= 500 ? 502 : 400, (data && data.code) || 'db_error');
    err.detail = data; throw err;
  }
  return data;
}

async function upload(path, buf, contentType = 'image/jpeg') {
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: buf,
  });
  if (!r.ok) throw new HttpError(502, 'upload_failed');
}

// 관리자만, 10분짜리 서명 주소
async function signedUrl(path, seconds = 600) {
  if (!path) return null;
  const r = await fetch(`${URL_}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.signedURL ? `${URL_}/storage/v1${j.signedURL}` : null;
}

// data:image/jpeg;base64,... → Buffer (사진 한 장 3MB 넘으면 거절)
function imageFromDataUrl(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(s || '');
  if (!m) throw new HttpError(400, 'bad_image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 2000 || buf.length > 3 * 1024 * 1024) throw new HttpError(400, 'bad_image_size');
  return { buf, type: m[1] };
}

// 근로자: 기기에 심은 열쇠로 본인 확인
async function workerFromReq(req) {
  const tok = req.headers['x-hands-token'];
  if (!tok || String(tok).length < 20) throw new HttpError(401, 'no_token');
  const rows = await db(`members?select=*&device_token_hash=eq.${sha256(tok)}&limit=1`);
  if (!rows.length) throw new HttpError(401, 'bad_token');
  if (rows[0].is_active === false) throw new HttpError(403, 'inactive');
  return rows[0];
}

// 관리자: 공용 아이디·비밀번호(버셀 환경변수) → HMAC 도장 쿠키(12시간, HttpOnly)
const ADMIN_COOKIE = 'hands_admin';
const ADMIN_HOURS = 12;

function sessionSecret() {
  const s = process.env.HANDS_SESSION_SECRET;
  if (!s || s.length < 32) throw new HttpError(500, 'no_session_secret');
  return s;
}
function hmac(data) { return crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url'); }
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function adminCookie(id) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + ADMIN_HOURS * 3600000 })).toString('base64url');
  return `${ADMIN_COOKIE}=${payload}.${hmac(payload)}; Path=/; Max-Age=${ADMIN_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict`;
}
const clearAdminCookie = () => `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

function checkAdminLogin(id, password) {
  const wantId = process.env.HANDS_ADMIN_ID, wantPw = process.env.HANDS_ADMIN_PASSWORD;
  if (!wantId || !wantPw) throw new HttpError(500, 'admin_not_configured');
  return safeEq(String(id || '').trim().toLowerCase(), wantId.trim().toLowerCase()) & safeEq(password || '', wantPw);
}

async function adminFromReq(req) {
  const raw = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(ADMIN_COOKIE + '='));
  const tok = raw ? raw.slice(ADMIN_COOKIE.length + 1) : '';
  const [payload, sig] = tok.split('.');
  if (!payload || !sig || !safeEq(sig, hmac(payload))) throw new HttpError(401, 'no_session');
  let p; try { p = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch (_) { throw new HttpError(401, 'no_session'); }
  if (!p.exp || p.exp < Date.now()) throw new HttpError(401, 'expired');
  return { email: p.id, name: '관리자', role: 'admin' };
}

async function logAccess(admin, memberId, action) {
  try { await db('access_logs', { method: 'POST', body: { admin_email: admin.email, member_id: memberId, action } }); } catch (_) {}
}

// 텔레그램 — 토큰·받는 방 번호는 버셀 환경변수에만
async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = String(process.env.TELEGRAM_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!token || !chats.length) return false;
  let ok = false;
  for (const chat_id of chats) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
      });
      ok = ok || r.ok;
    } catch (_) {}
  }
  return ok;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function handler(routes) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const action = (req.query && req.query.action) || new URL(req.url, 'http://x').searchParams.get('action');
    const fn = routes[action];
    try {
      if (!fn) throw new HttpError(404, 'unknown_action');
      const body = req.method === 'POST' ? await readJson(req) : {};
      const out = await fn(req, body);
      if (out && out.__setCookie) { res.setHeader('Set-Cookie', out.__setCookie); delete out.__setCookie; }
      res.status(200).json(out || { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(action, e.code || e.message, e.detail || '');
      res.status(status).json({ ok: false, error: e.code || 'server_error' });
    }
  };
}

const clean = (s, max = 200) => (s == null ? null : String(s).trim().slice(0, max) || null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

module.exports = { db, upload, signedUrl, imageFromDataUrl, workerFromReq, adminFromReq, adminCookie, clearAdminCookie, checkAdminLogin, logAccess, telegram,
  handler, HttpError, sha256, newToken, newCode, clean, num };
