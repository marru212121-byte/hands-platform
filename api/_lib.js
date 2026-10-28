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

// 근로자 비밀번호(관리자가 바꿔 준 경우만 저장). 대소문자·빈칸 무시 (사장님 10-27)
const normPw = (x) => String(x || '').toUpperCase().replace(/\s+/g, '');
function pwHash(pw) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(normPw(pw), salt, 32).toString('hex'); }
function pwCheck(pw, stored) {
  const [salt, h] = String(stored || '').split(':'); if (!salt || !h) return false;
  const x = crypto.scryptSync(normPw(pw), salt, 32), y = Buffer.from(h, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// 근로자: 로그인 쿠키(홈 화면 앱에서 오래 유지) 또는 폰 저장 열쇠로 본인 확인
const WORKER_COOKIE = 'hands_w';
function workerTokenFromReq(req) {
  const h = req.headers['x-hands-token'];
  if (h) return String(h);
  const m = /(?:^|;\s*)hands_w=([A-Za-z0-9_-]+)/.exec(String(req.headers.cookie || ''));
  return m ? m[1] : '';
}
// 400일(브라우저가 허용하는 최대). HttpOnly 라 화면 글이 못 읽음.
function workerCookie(token) { return `${WORKER_COOKIE}=${token}; Path=/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax`; }
async function workerFromReq(req) {
  const tok = workerTokenFromReq(req);
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

function adminCookie(id, role = 'admin', name = '관리자') {
  // 관리자(사장님·지인 둘)는 로그아웃 안 하면 계속 유지 — 400일 (사장님 10-28: 근로자 위급할 때 바로 봐야). 매니저는 12시간 그대로. 같은 계정 동시 로그인은 원래 됨(서버에 한 사람만 기억하지 않음)
  const hours = role === 'admin' ? 400 * 24 : ADMIN_HOURS;
  const payload = Buffer.from(JSON.stringify({ id, role, name, exp: Date.now() + hours * 3600000 })).toString('base64url');
  return `${ADMIN_COOKIE}=${payload}.${hmac(payload)}; Path=/; Max-Age=${hours * 3600}; HttpOnly; Secure; SameSite=Strict`;
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
  if (p.role === 'manager') {  // 매니저는 지워졌으면 바로 끊김
    const rows = await db('app_settings?select=value&key=eq.managers');
    const mg = ((rows[0] && rows[0].value) || []).find((x) => x.id === p.id);
    if (!mg) throw new HttpError(401, 'no_session');
    return { email: p.id, name: mg.name || '매니저', company: mg.company || '', role: 'manager' };
  }
  return { email: p.id, name: '관리자', role: 'admin' };
}
// 관리자만 (매니저는 위치·지도·SOS·텔레그램·열람 기록·설정 못 봄)
async function adminOnly(req) {
  const a = await adminFromReq(req);
  if (a.role !== 'admin') throw new HttpError(403, 'forbidden');
  return a;
}

// 자동 알림 크론마다 언제·몇 명 보냈는지 남김 (사장님 10-28: 매일 빠짐없이 가는지 확인) — app_settings.cron_log { 이름: [최근 30회] }
async function cronLog(name, result) {
  try {
    const rows = await db('app_settings?select=value&key=eq.cron_log');
    const v = (rows[0] && rows[0].value) || {};
    v[name] = [{ at: new Date().toISOString(), ...result }, ...(v[name] || [])].slice(0, 30);
    await db('app_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { key: 'cron_log', value: v, updated_at: new Date().toISOString() } });
  } catch (e) {}
  return result;
}
async function logAccess(admin, memberId, action) {
  try { await db('access_logs', { method: 'POST', body: { admin_email: admin.email, member_id: memberId, action } }); } catch (_) {}
}

// 텔레그램 — 봇 열쇠는 버셀 환경변수(TELEGRAM_BOT_TOKEN)에만. 받는 사람은 관리자 화면에서 고름(app_settings.telegram_chats)
async function telegramChats() {
  const env = String(process.env.TELEGRAM_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  let saved = [];
  try {
    const rows = await db('app_settings?select=value&key=eq.telegram_chats');
    saved = ((rows[0] && rows[0].value) || []).map(c => String(c.id));
  } catch (_) {}
  return [...new Set([...env, ...saved])];
}

async function telegramApi(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new HttpError(400, 'telegram_no_token');
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new HttpError(400, 'telegram_error');
  return j.result;
}

async function telegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  const chats = await telegramChats();
  let ok = false;
  for (const chat_id of chats) {
    try { await telegramApi('sendMessage', { chat_id, text, disable_web_page_preview: true }); ok = true; } catch (_) {}
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

// 웹 푸시(홈 화면에 추가한 근로자 폰으로) — 열쇠는 버셀 환경변수에만
let _wp = null;
function webpush() {
  if (_wp) return _wp;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new HttpError(500, 'push_not_configured');
  _wp = require('web-push');
  _wp.setVapidDetails(process.env.VAPID_SUBJECT || 'https://hands-platform.vercel.app', pub, priv);
  return _wp;
}

module.exports = { cronLog, adminOnly, pwHash, pwCheck, workerTokenFromReq, workerCookie, webpush, telegramApi, telegramChats, db, upload, signedUrl, imageFromDataUrl, workerFromReq, adminFromReq, adminCookie, clearAdminCookie, checkAdminLogin, logAccess, telegram,
  handler, HttpError, sha256, newToken, newCode, clean, num };
