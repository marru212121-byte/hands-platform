// 근로자 앱 서버 — /api/w?action=...
const L = require('./_lib');
const { db, HttpError, clean, num } = L;

const CONSENT_VERSION = '2026-10-27b';
const REQUIRED = ['terms', 'privacy', 'sensitive', 'location'];
const COUNTRY_KO = { vn: '베트남', th: '태국', id: '인도네시아', ph: '필리핀', np: '네팔', kh: '캄보디아', mm: '미얀마', lk: '스리랑카', bd: '방글라데시', other: '기타' };

const nowIso = () => new Date().toISOString();
// 로그인 = 여권 영문 이름(띄어쓰기·기호 무시) + 여권번호 (사장님 10-27)
const normName = (x) => String(x || '').toUpperCase().replace(/[^A-Z]/g, '');
const FX_CODES = ['USD', 'VND', 'THB', 'IDR', 'PHP', 'NPR', 'KHR', 'MMK', 'LKR', 'BDT'];
let fxCache = null;

// 기상청 단기예보 격자(DFS 람베르트) — 기상청 활용가이드 공식
function kmaGrid(lat, lng) {
  const RE = 6371.00877 / 5.0, D = Math.PI / 180, s1 = 30 * D, s2 = 60 * D, olon = 126 * D, olat = 38 * D;
  let sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5));
  const sf = Math.pow(Math.tan(Math.PI * 0.25 + s1 * 0.5), sn) * Math.cos(s1) / sn;
  const ro = RE * sf / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn);
  const ra = RE * sf / Math.pow(Math.tan(Math.PI * 0.25 + lat * D * 0.5), sn);
  let th = lng * D - olon; if (th > Math.PI) th -= 2 * Math.PI; if (th < -Math.PI) th += 2 * Math.PI; th *= sn;
  return { nx: Math.floor(ra * Math.sin(th) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(th) + 136 + 0.5) };
}
const kst = (ms) => { const d = new Date(ms + 9 * 3600000); return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), h: d.getUTCHours(), m: d.getUTCMinutes() }; };
async function kmaCall(op, q) {
  let key = String(process.env.KMA_SERVICE_KEY || '').trim();
  if (/%[0-9A-Fa-f]{2}/.test(key)) { try { key = decodeURIComponent(key); } catch (e) {} }  // 포털의 Encoding·Decoding 어느 쪽을 넣어도 됨
  if (!key) throw new HttpError(503, 'weather_unavailable');
  const u = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${op}?serviceKey=${encodeURIComponent(key)}&pageNo=1&numOfRows=1000&dataType=JSON&${new URLSearchParams(q)}`;
  const r = await fetch(u);
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  const items = j && j.response && j.response.body && j.response.body.items && j.response.body.items.item;
  if (!items) {  // 기상청이 준 이유를 기록(열쇠 값은 안 남김) — 새 열쇠 등록 전 오류, 열쇠 종류 섞임 등
    const why = (j && j.response && j.response.header && (j.response.header.resultCode + ' ' + j.response.header.resultMsg)) || (txt.match(/<returnAuthMsg>([^<]*)/) || [])[1] || txt.slice(0, 160);
    console.error('kma', op, r.status, why);
    throw new HttpError(502, 'weather_unavailable');
  }
  return items;
}
const wxCache = new Map(), placeCache = new Map();
// 통역 (사장님 10-27): 하이쿠, 근로자 말 ↔ 한국어. 한 사람 1시간 120번
const TR_LANGS = { ko: 'Korean', en: 'English', vi: 'Vietnamese', id: 'Indonesian', th: 'Thai', tl: 'Filipino (Tagalog)', ne: 'Nepali', km: 'Khmer', my: 'Burmese', si: 'Sinhala', bn: 'Bengali' };
const trHits = new Map();
const normPass = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const loginFails = new Map();
// 카카오맵 (관리자 지도와 같은 지도). 이름은 핀 이름표로 뜸
const mapLink = (lat, lng, name) => `https://map.kakao.com/link/map/${encodeURIComponent(String(name || 'HANDS').replace(/,/g, ' '))},${lat},${lng}`;
const adminLink = (id) => `https://hands-platform.vercel.app/admin#/members/${encodeURIComponent(id)}`;

function publicProfile(m) {
  return {
    id: m.id, name: m.name, country: m.country, language: m.language, phone: m.phone,
    passport_last4: m.passport_number ? String(m.passport_number).slice(-4) : null,
    company: m.company, created_at: m.created_at, last_checkin_at: m.last_checkin_at,
    consent_version: m.consent_version, consent_current: m.consent_version === CONSENT_VERSION, payday: m.payday || 0,
  };
}

async function saveLocation(m, { lat, lng, accuracy, source }) {
  lat = num(lat); lng = num(lng);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'bad_location');
  const acc = num(accuracy) == null ? null : Math.round(num(accuracy));
  const t = nowIso();
  await db('locations?on_conflict=member_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates',
    body: { member_id: m.id, lat, lng, accuracy: acc, updated_at: t, member_name: m.name, member_country: m.country },
  });
  let keep = source !== 'watch';
  if (!keep) {
    const last = await db(`location_history?select=recorded_at&member_id=eq.${m.id}&order=recorded_at.desc&limit=1`);
    keep = !last.length || Date.now() - new Date(last[0].recorded_at).getTime() > 5 * 60 * 1000;
  }
  if (keep) await db('location_history', { method: 'POST', body: { member_id: m.id, lat, lng, accuracy: acc, source, recorded_at: t } });
  await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: { last_seen_at: t } });
  return { lat, lng, acc, t };
}

// 텔레그램 알림 모양 (사장님 10-27: 핵심만 한 줄씩, 링크는 이름 아래 줄에, 칸 사이 한 줄 띄움)
function kstText(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}년 ${p.month}월 ${p.day}일 ${p.dayPeriod} ${p.hour}시 ${p.minute}분 ${p.second}초`;
}
function tgCard(title, head, rows, { lat, lng, name, id } = {}) {
  const out = [title, head, ''];
  rows.filter(Boolean).forEach(r => out.push(r));
  out.push('');
  if (lat != null && lng != null) out.push('위치 보기 (카카오맵)', mapLink(lat, lng, name), '');
  else out.push('위치: 받지 못함', '');
  if (id) out.push('관리자에서 보기', adminLink(id));
  return out.join('\n');
}

// 「집중 관리」 근로자는 앱을 열고 닫을 때 텔레그램 (같은 종류 1분 안 중복은 건너뜀)
async function watchAlert(m, b, kind) {
  if (!m.watch) return;
  const since = new Date(Date.now() - 60000).toISOString();
  const recent = await db(`location_history?select=id&member_id=eq.${m.id}&source=eq.${kind}&recorded_at=gt.${encodeURIComponent(since)}&limit=1`).catch(() => []);
  if (recent.length) return;
  const lat = num(b.lat), lng = num(b.lng);
  await L.telegram(tgCard('[HANDS 집중 관리]', `${m.name} 님 앱이 ${kind === 'app_open' ? '열렸습니다' : '닫혔습니다'}`,
    [`시각: ${kstText()}`], { lat, lng, name: m.name, id: m.id })).catch(() => {});
}

// ── 여권 읽기: 하이쿠 비전 (사장님 10-27). 가입 전이라 근로자 열쇠가 없음 → 주소·크기·횟수로 막음
const { Anthropic } = require('@anthropic-ai/sdk');
const readHits = new Map();
const mrzCk = (str) => { const w = [7, 3, 1]; let t = 0; for (let i = 0; i < str.length; i++) { const c = str[i]; const v = c === '<' ? 0 : c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 55 : 0; t += v * w[i % 3]; } return String(t % 10); };
const PASS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['is_passport', 'surname', 'given_names', 'passport_number', 'nationality_code', 'birth_date', 'sex', 'mrz_line1', 'mrz_line2'],
  properties: {
    is_passport: { type: 'boolean' }, surname: { type: 'string' }, given_names: { type: 'string' },
    passport_number: { type: 'string' }, nationality_code: { type: 'string' }, birth_date: { type: 'string' },
    sex: { type: 'string' }, mrz_line1: { type: 'string' }, mrz_line2: { type: 'string' },
  },
};
const PASS_PROMPT = 'This photo should show the data page of a passport. It may be rotated, tilted or partly blurry. ' +
  'Read the two machine-readable lines (MRZ) at the bottom exactly as printed (44 characters each, use < for fillers), and the printed fields. ' +
  'Use the MRZ check digits and the printed fields to correct reading mistakes. Names in Latin capital letters exactly as in the passport. ' +
  'nationality_code = the 3-letter code (e.g. VNM). birth_date = YYYY-MM-DD. sex = M or F. Use an empty string for anything you cannot read with confidence. ' +
  'If the image is not a passport data page, set is_passport to false.';
function fixWithMrz(r) {
  // 자동 수정: MRZ 검증 숫자가 맞으면 그 값을 정답으로 씀
  const l2 = String(r.mrz_line2 || '').toUpperCase().replace(/[^A-Z0-9<]/g, '');
  if (l2.length >= 28) {
    const doc = l2.slice(0, 9);
    if (mrzCk(doc) === l2[9]) r.passport_number = doc.replace(/</g, '');
    const dob = l2.slice(13, 19);
    if (/^\d{6}$/.test(dob) && mrzCk(dob) === l2[19]) {
      const yy = +dob.slice(0, 2), now = new Date().getFullYear() % 100;
      r.birth_date = (yy > now ? '19' : '20') + dob.slice(0, 2) + '-' + dob.slice(2, 4) + '-' + dob.slice(4, 6);
    }
    if (/^[A-Z]{3}$/.test(l2.slice(10, 13))) r.nationality_code = l2.slice(10, 13);
    if (l2[20] === 'M' || l2[20] === 'F') r.sex = l2[20];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.birth_date || '')) r.birth_date = '';
  if (r.sex !== 'M' && r.sex !== 'F') r.sex = '';
  return r;
}

module.exports = L.handler({
  async passport_read(req, b) {
    if (req.method !== 'POST') throw new HttpError(405, 'post_only');
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'vision_off');
    const from = String(req.headers.origin || req.headers.referer || '');
    if (!/^https:\/\/hands-platform\.vercel\.app|^http:\/\/localhost(:\d+)?/.test(from)) throw new HttpError(403, 'forbidden');
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    const now = Date.now(); const hits = (readHits.get(ip) || []).filter((t) => now - t < 10 * 60000);
    if (hits.length >= 600) throw new HttpError(429, 'too_many');  // 공항 와이파이 하나에 수백 명 (사장님 10-27)
    hits.push(now); readHits.set(ip, hits);
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
    if (!m || m[2].length > 4500000) throw new HttpError(400, 'bad_image');
    const client = new Anthropic({ timeout: 20000, maxRetries: 1 });  // 앱이 20초면 폰 판독으로 넘어감
    const msg = await client.messages.create({
      model: 'claude-haiku-5-5', max_tokens: 2048,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PASS_SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/' + m[1], data: m[2] } },
        { type: 'text', text: PASS_PROMPT },
      ] }],
    });
    if (msg.stop_reason === 'refusal') throw new HttpError(422, 'refused');
    const txt = (msg.content.find((c) => c.type === 'text') || {}).text || '';
    let r; try { r = JSON.parse(txt); } catch (e) { throw new HttpError(502, 'bad_reply'); }
    if (!r.is_passport) return { ok: true, passport: false };
    fixWithMrz(r);
    const name = [r.surname, r.given_names].map((x) => String(x || '').replace(/</g, ' ').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').toUpperCase();
    return { ok: true, passport: true, name, passport_number: String(r.passport_number || '').toUpperCase().replace(/\s/g, ''),
      nationality: String(r.nationality_code || '').toUpperCase(), birth_date: r.birth_date, gender: r.sex };
  },

  // 가입: 동의 + 정보 + 얼굴 + 여권 한 번에. 기기 열쇠를 돌려줌.
  async signup(req, b) {
    if (req.method !== 'POST') throw new HttpError(405, 'post_only');
    const c = b.consents || {};
    if (!REQUIRED.every(k => c[k] === true)) throw new HttpError(400, 'consent_required');
    const name = clean(b.name, 80);
    const country = clean(b.country, 10);
    if (!name || !country) throw new HttpError(400, 'missing_fields');
    const passNo = normPass(b.passport_number);
    if (passNo.length < 5) throw new HttpError(400, 'missing_fields');
    const dup = await db(`members?select=id&passport_number=eq.${encodeURIComponent(passNo)}&limit=1`);
    if (dup.length) throw new HttpError(409, 'passport_exists');
    const selfie = L.imageFromDataUrl(b.selfie);
    const passport = L.imageFromDataUrl(b.passport);

    const token = L.newToken();
    const t = nowIso();
    const rows = await db('members', {
      method: 'POST', prefer: 'return=representation',
      body: {
        name, country,
        phone: clean(b.phone, 30),
        passport_number: passNo,
        birth_date: clean(b.birth_date, 10),
        gender: clean(b.gender, 10),
        company: clean(b.company, 80),
        emergency_contact: clean(b.emergency_contact, 120),
        language: clean(b.language, 10) || 'en',
        consents: { ...Object.fromEntries(REQUIRED.map(k => [k, true])), marketing: c.marketing === true, push: c.push === true, at: t, version: CONSENT_VERSION },
        consent_version: CONSENT_VERSION, consent_at: t,
        consent_ip: clean(String(req.headers['x-forwarded-for'] || '').split(',')[0], 64),
        device_token_hash: L.sha256(token), is_active: true, last_login_at: t, last_seen_at: t,
      },
    }).catch(e => { if (e.detail && e.detail.code === '23505') throw new HttpError(409, 'phone_exists'); throw e; });
    const m = rows[0];
    const sp = `${m.id}/selfie_${Date.now()}.jpg`, pp = `${m.id}/passport_${Date.now()}.jpg`;
    try {
      await L.upload(sp, selfie.buf, selfie.type);
      await L.upload(pp, passport.buf, passport.type);
    } catch (e) {
      await db(`members?id=eq.${m.id}`, { method: 'DELETE' }).catch(() => {});
      throw e;
    }
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: { selfie_photo_path: sp, passport_photo_path: pp, selfie_photo_url: null, passport_photo_url: null } });
    return { ok: true, token, profile: publicProfile({ ...m, selfie_photo_path: sp }), __setCookie: L.workerCookie(token) };
  },

  // 로그아웃: 로그인 쿠키 지움 (내 정보 맨 아래 작은 글씨)
  async logout() {
    return { ok: true, __setCookie: 'hands_w=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' };
  },

  // 로그인: 아이디 = 여권번호, 비밀번호 = 여권번호(관리자가 바꿔 주면 그 비밀번호). 대소문자·빈칸 무시
  async login(req, b) {
    if (req.method !== 'POST') throw new HttpError(405, 'post_only');
    const passNo = normPass(b.id), pw = String(b.password || '');
    if (passNo.length < 5 || !pw.trim()) throw new HttpError(400, 'missing_fields');
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    const key = ip + '|' + passNo, now = Date.now();
    const fails = (loginFails.get(key) || []).filter((t) => now - t < 30 * 60000);
    if (fails.length >= 5) throw new HttpError(429, 'login_locked');
    const rows = await db(`members?select=*&passport_number=eq.${encodeURIComponent(passNo)}&limit=1`);
    const m = rows[0];
    const ok = m && (m.login_pw_hash ? L.pwCheck(pw, m.login_pw_hash) : normPass(pw) === passNo);
    if (!ok) { fails.push(now); loginFails.set(key, fails); throw new HttpError(401, 'login_fail'); }
    if (m.is_active === false) throw new HttpError(403, 'inactive');
    loginFails.delete(key);
    const token = L.newToken(), t = nowIso();
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: { device_token_hash: L.sha256(token), last_login_at: t, last_seen_at: t } });
    await L.telegram(tgCard('[HANDS 다시 로그인]', `${m.name} 님이 여권번호로 다시 로그인했습니다`,
      [`시각: ${kstText()}`], { id: m.id })).catch(() => {});
    return { ok: true, token, profile: publicProfile(m), __setCookie: L.workerCookie(token) };
  },

  async me(req) {
    const m = await L.workerFromReq(req);
    return { ok: true, profile: publicProfile(m), __setCookie: L.workerCookie(L.workerTokenFromReq(req)) };
  },

  async language(req, b) {
    const m = await L.workerFromReq(req);
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: { language: clean(b.language, 10) } });
    return { ok: true };
  },

  // 약관이 바뀌었을 때만 다시 받음
  async consent(req, b) {
    const m = await L.workerFromReq(req);
    const c = b.consents || {};
    if (!REQUIRED.every(k => c[k] === true)) throw new HttpError(400, 'consent_required');
    const t = nowIso();
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: {
      consents: { ...Object.fromEntries(REQUIRED.map(k => [k, true])), marketing: c.marketing === true, push: c.push === true, at: t, version: CONSENT_VERSION },
      consent_version: CONSENT_VERSION, consent_at: t } });
    return { ok: true };
  },

  async location(req, b) {
    const m = await L.workerFromReq(req);
    const source = ['app_open', 'watch', 'tap'].includes(b.source) ? b.source : 'app_open';
    if (source === 'app_open') await watchAlert(m, b, 'app_open');
    if (b.lat == null || b.lng == null) {
      if (source !== 'app_open') throw new HttpError(400, 'bad_location');
      // opened without a position (location off): keep the event, no coordinates
      const t = nowIso();
      await db('location_history', { method: 'POST', body: { member_id: m.id, lat: null, lng: null, source, recorded_at: t } }).catch(() => {});
      await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: { last_seen_at: t } });
      return { ok: true };
    }
    await saveLocation(m, { ...b, source });
    return { ok: true };
  },

  // 앱을 내릴 때(닫을 때) — sendBeacon 이라 열쇠가 본문에 옴
  async location_beacon(req, b) {
    req.headers['x-hands-token'] = String(b.token || '');
    const m = await L.workerFromReq(req);
    await watchAlert(m, b, 'app_close');
    if (b.lat != null && b.lng != null) await saveLocation(m, { ...b, source: 'app_close' });
    else await db('location_history', { method: 'POST', body: { member_id: m.id, lat: null, lng: null, source: 'app_close', recorded_at: nowIso() } }).catch(() => {});
    return { ok: true };
  },

  // 「오늘 괜찮아요」
  async checkin(req, b) {
    const m = await L.workerFromReq(req);
    const t = nowIso();
    if (b.lat != null && b.lng != null) await saveLocation(m, { ...b, source: 'checkin' });
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: { last_checkin_at: t, last_seen_at: t } });
    return { ok: true, at: t };
  },

  // SOS: 기록이 실제로 들어가야 ok. 텔레그램은 따로 결과를 알려 줌.
  async sos(req, b) {
    const m = await L.workerFromReq(req);
    const lat = num(b.lat), lng = num(b.lng);
    const hasLoc = lat != null && lng != null;
    const rows = await db('sos_alerts', { method: 'POST', prefer: 'return=representation', body: {
      member_id: m.id, lat: hasLoc ? lat : null, lng: hasLoc ? lng : null,
      accuracy: num(b.accuracy) == null ? null : Math.round(num(b.accuracy)), status: 'pending' } });
    if (hasLoc) await saveLocation(m, { lat, lng, accuracy: b.accuracy, source: 'sos' }).catch(() => {});
    await db(`locations?member_id=eq.${m.id}`, { method: 'PATCH', body: { sos_active: true } }).catch(() => {});
    const notified = await L.telegram(tgCard('[HANDS 긴급 SOS]', `${m.name} 님이 SOS를 눌렀습니다`, [
      `국적: ${COUNTRY_KO[m.country] || m.country || '-'}`,
      `전화: ${m.phone || '-'}`,
      m.company ? `근무처: ${m.company}` : null,
      `시각: ${kstText()}`,
    ], hasLoc ? { lat, lng, name: m.name, id: m.id } : { id: m.id }));
    if (notified) await db(`sos_alerts?id=eq.${rows[0].id}`, { method: 'PATCH', body: { notified_at: nowIso() } }).catch(() => {});
    return { ok: true, id: rows[0].id, notified };
  },

  // 일자리 찾기 · 선박 문의 → 관리자 문의함
  async inquiry(req, b) {
    const m = await L.workerFromReq(req);
    const category = ['job', 'ship', 'other'].includes(b.category) ? b.category : 'other';
    const body = clean(b.body, 2000);
    if (!body) throw new HttpError(400, 'missing_fields');
    const title = clean(b.title, 120) || (category === 'job' ? '일자리 찾기' : category === 'ship' ? '선박 문의' : '문의');
    await db('inquiries', { method: 'POST', body: { member_id: m.id, category, title, body, body_lang: m.language, status: 'open' } });
    const label = category === 'job' ? '일자리 찾기' : category === 'ship' ? '선박 문의' : '문의';
    const last = (await db(`locations?select=lat,lng&member_id=eq.${m.id}&limit=1`).catch(() => []))[0] || {};
    await L.telegram(tgCard(`[HANDS ${label}]`, `${m.name} 님이 ${label} 글을 보냈습니다`, [
      `국적: ${COUNTRY_KO[m.country] || m.country || '-'}`,
      m.phone ? `전화: ${m.phone}` : null,
      `시각: ${kstText()}`,
      '',
      body.slice(0, 300),
    ], { lat: num(last.lat), lng: num(last.lng), name: m.name, id: m.id })).catch(() => {});
    return { ok: true };
  },

  async inquiries(req) {
    const m = await L.workerFromReq(req);
    const rows = await db(`inquiries?select=id,category,title,body,reply,status,created_at,replied_at&member_id=eq.${m.id}&order=created_at.desc&limit=30`);
    return { ok: true, inquiries: rows };
  },

  // 푸시: 공개 열쇠 / 이 폰 구독 저장
  async push_key() {
    return { ok: true, key: process.env.VAPID_PUBLIC_KEY || null };
  },

  async push_subscribe(req, b) {
    const m = await L.workerFromReq(req);
    const s = b.subscription || {};
    const endpoint = clean(s.endpoint, 1000), keys = s.keys || {};
    if (!endpoint || !/^https:\/\//.test(endpoint) || !keys.p256dh || !keys.auth) throw new HttpError(400, 'bad_subscription');
    await db('push_subscriptions?on_conflict=endpoint', { method: 'POST', prefer: 'resolution=merge-duplicates',
      body: { member_id: m.id, endpoint, p256dh: clean(keys.p256dh, 200), auth: clean(keys.auth, 100) } });
    return { ok: true };
  },

  // 공지사항: 관리자·매니저가 보낸 알림 = 공지. 근로자 말로 번역된 것 + 한국어 원문 (사장님 10-27)
  async notices(req) {
    const m = await L.workerFromReq(req);
    const or = `(target.eq.all,target.eq.country:${m.country},target.eq.member:${m.id})`;
    const rows = await db(`push_messages?select=id,title,body,i18n,created_at&or=${encodeURIComponent(or)}&order=created_at.desc&limit=50`);
    const lang = m.language || 'en';
    return { ok: true, notices: rows.map((r) => {
      const tr = (r.i18n && r.i18n[lang]) || null;
      return { id: r.id, created_at: r.created_at, title: tr ? tr.title : r.title, body: tr ? tr.body : r.body, ko_title: r.title, ko_body: r.body, translated: !!tr };
    }) };
  },

  // 담당자 연결: 관리자 설정의 담당자 이름·번호
  async contacts(req) {
    await L.workerFromReq(req);
    const rows = await db('app_settings?select=value&key=eq.contacts');
    const list = ((rows[0] && rows[0].value) || []).filter((c) => c && c.phone).map((c) => ({ name: String(c.name || ''), role: String(c.role || ''), phone: String(c.phone || '') }));
    return { ok: true, contacts: list };
  },

  // 환율: 무료 자료(open.er-api.com, 하루 1번 갱신)라 「오늘 기준」으로 보여 줌 (사장님 10-27)
  async fx(req) {
    await L.workerFromReq(req);
    if (!fxCache || Date.now() - fxCache.at > 3 * 3600000) {
      const r = await fetch('https://open.er-api.com/v6/latest/KRW');
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.result !== 'success') { if (fxCache) return fxCache.out; throw new HttpError(502, 'fx_unavailable'); }
      const rates = {};
      for (const c of FX_CODES) if (j.rates && j.rates[c]) rates[c] = j.rates[c];
      fxCache = { at: Date.now(), out: { ok: true, base: 'KRW', rates, updated: j.time_last_update_unix * 1000 } };
    }
    return fxCache.out;
  },

  // 날씨: 기상청 단기예보(공공데이터, 출처 표시) + 지역 이름(오픈스트리트맵, 출처 표시). 격자별 20분 저장 (사장님 10-27)
  async weather(req, b) {
    await L.workerFromReq(req);
    const lat = num(b.lat), lng = num(b.lng);
    if (lat == null || lng == null || lat < 32 || lat > 39.5 || lng < 124 || lng > 132) throw new HttpError(400, 'bad_location');
    const { nx, ny } = kmaGrid(lat, lng), gk = nx + ',' + ny, now = Date.now();
    const placeP = (async () => {  // 지역 이름은 날씨와 동시에
    // 지역 이름: 1km 단위로 저장, 근로자 말로 (구·동은 한국어로 옴)
    const lang = clean(b.lang, 10) || 'en', pk = lat.toFixed(2) + ',' + lng.toFixed(2) + ',' + lang;
    let place = placeCache.get(pk);
    if (place !== undefined) return place;
    {
      place = null;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&zoom=14&accept-language=${encodeURIComponent(lang)}`,
          { headers: { 'User-Agent': 'hands-platform/1.0 (https://hands-platform.vercel.app)' } });
        const a = (await r.json()).address || {};
        place = [a.city || a.province || a.state, a.borough || a.county || a.town, a.suburb || a.village || a.quarter].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(' · ') || null;
      } catch (e) {}
      placeCache.set(pk, place);
    }
    return place;
    })();
    let wx = wxCache.get(gk);
    if (!wx || now - wx.at > 20 * 60000) {
      // 실황: 매시 정각 자료가 40분쯤 나옴
      const n = kst(now - 40 * 60000);
      // 단기예보: 02·05·08·11·14·17·20·23시 발표, 10분쯤 뒤에 나옴 — 두 자료를 한꺼번에 물음
      const f = kst(now - 15 * 60000), bh = [23, 20, 17, 14, 11, 8, 5, 2].find((x) => x <= f.h);
      const fb = bh == null ? { ...kst(now - 15 * 60000 - 24 * 3600000), bh: 23 } : { ...f, bh };
      const [ncst, fc] = await Promise.all([
        kmaCall('getUltraSrtNcst', { base_date: n.ymd, base_time: String(n.h).padStart(2, '0') + '00', nx, ny }),
        kmaCall('getVilageFcst', { base_date: fb.ymd, base_time: String(fb.bh).padStart(2, '0') + '00', nx, ny })]);
      const cur = {}; for (const it of ncst) cur[it.category] = it.obsrValue;
      const hours = {}, days = {};
      for (const it of fc) {
        const k = it.fcstDate + it.fcstTime;
        (hours[k] = hours[k] || { date: it.fcstDate, time: it.fcstTime })[it.category] = it.fcstValue;
        const d = (days[it.fcstDate] = days[it.fcstDate] || { date: it.fcstDate, tmps: [], sky: [], pty: [], pop: 0 });
        if (it.category === 'TMP') d.tmps.push(+it.fcstValue);
        if (it.category === 'TMN') d.tmn = +it.fcstValue;
        if (it.category === 'TMX') d.tmx = +it.fcstValue;
        if (it.category === 'POP') d.pop = Math.max(d.pop, +it.fcstValue);
        if (it.category === 'SKY' && it.fcstTime >= '0900' && it.fcstTime <= '1800') d.sky.push(+it.fcstValue);
        if (it.category === 'PTY' && +it.fcstValue > 0) d.pty.push(+it.fcstValue);
      }
      const hl = Object.keys(hours).sort().map((k) => hours[k]);
      const nowKey = kst(now).ymd + String(kst(now).h).padStart(2, '0') + '00';
      const next = hl.filter((x) => x.date + x.time >= nowKey).filter((x) => x.TMP != null).map((x) => ({ date: x.date, time: x.time, tmp: +x.TMP, sky: +x.SKY, pty: +x.PTY, pop: +x.POP, pcp: x.PCP }));  // 글피까지 시간별 전부 (사장님 10-27: 내일·모레 눌러 시간별)
      const mode = (a) => a.length ? +Object.entries(a.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {})).sort((p, q) => q[1] - p[1])[0][0] : 1;
      const dl = Object.keys(days).sort().slice(0, 3).map((k) => { const d = days[k];
        return { date: d.date, min: d.tmn != null ? d.tmn : Math.min(...d.tmps), max: d.tmx != null ? d.tmx : Math.max(...d.tmps), sky: mode(d.sky), pty: d.pty.length ? mode(d.pty) : 0, pop: d.pop }; });
      wx = { at: now, out: {
        now: { tmp: +cur.T1H, reh: +cur.REH, wsd: +cur.WSD, rn1: cur.RN1, pty: +cur.PTY || 0, sky: next[0] ? next[0].sky : 1 },
        hours: next, days: dl, base: now } };
      wxCache.set(gk, wx);
    }
    const place = await placeP;
    return { ok: true, place, ...wx.out };
  },

  async translate(req, b) {
    if (req.method !== 'POST') throw new HttpError(405, 'post_only');
    const m = await L.workerFromReq(req);
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'vision_off');
    const text = String(b.text || '').trim().slice(0, 1000), to = TR_LANGS[b.to] ? b.to : 'ko';
    if (!text) throw new HttpError(400, 'missing_fields');
    const now = Date.now(), hits = (trHits.get(m.id) || []).filter((x) => now - x < 3600000);
    if (hits.length >= 120) throw new HttpError(429, 'too_many');
    hits.push(now); trHits.set(m.id, hits);
    const { Anthropic } = require('@anthropic-ai/sdk');
    const client = new Anthropic({ timeout: 20000, maxRetries: 1 });
    const msg = await client.messages.create({
      model: 'claude-haiku-5-5', max_tokens: 2048,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } } },
      messages: [{ role: 'user', content: `You are an interpreter between foreign seafarers / fishing-boat and port workers in Korea and Koreans (bosses, doctors, shop staff). The text may come from speech recognition or quick typing: misspellings, sound-alike words, missing accents, slang and abbreviations are common. Work out what the speaker most likely meant in that work-and-daily-life context (e.g. "sheep" on a boat is "ship"), then translate it into ${TR_LANGS[to]}. Never add facts that are not in the text. Write entirely in ${TR_LANGS[to]} script — no English words mixed in; if there is no exact word, say it simply in ${TR_LANGS[to]}. Keep numbers, names, places, times and phone numbers exactly. Natural spoken words. Put only the translation in the text field.\n\nTEXT:\n${text}` }],
    });
    const r = JSON.parse((msg.content.find((c) => c.type === 'text') || {}).text || '{}');
    let out = String(r.text || '').trim();
    if (out.startsWith('{')) { try { const inner = JSON.parse(out); if (inner && inner.text) out = String(inner.text); } catch (e) {} }  // 겹쳐 온 모양 풀기
    return { ok: true, text: out.slice(0, 3000), to };
  },

  // 월급날 (사장님 10-27): 근로자가 날짜를 정함, 0 = 끔. 그날 아침 9시 알림(관리자 서버 크론)
  async payday(req, b) {
    if (req.method !== 'POST') throw new HttpError(405, 'post_only');
    const m = await L.workerFromReq(req);
    const day = Math.max(0, Math.min(31, Math.round(Number(b.day) || 0)));
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: { payday: day } });
    return { ok: true, payday: day };
  },

  async posts(req) {
    await L.workerFromReq(req);
    const rows = await db('posts?select=id,category,title,body,created_at,author:members(name,country)&order=created_at.desc&limit=50');
    return { ok: true, posts: rows };
  },

  async post(req, b) {
    const m = await L.workerFromReq(req);
    const title = clean(b.title, 120), body = clean(b.body, 3000);
    if (!title || !body) throw new HttpError(400, 'missing_fields');
    const category = ['general', 'question', 'tip', 'event'].includes(b.category) ? b.category : 'general';
    await db('posts', { method: 'POST', body: { author_id: m.id, category, title, body, body_lang: m.language } });
    return { ok: true };
  },
});
