// 근로자 앱 서버 — /api/w?action=...
const L = require('./_lib');
const { db, HttpError, clean, num } = L;

const CONSENT_VERSION = '2026-10-27b';
const REQUIRED = ['terms', 'privacy', 'sensitive', 'location'];
const COUNTRY_KO = { vn: '베트남', th: '태국', id: '인도네시아', ph: '필리핀', np: '네팔', kh: '캄보디아', mm: '미얀마', lk: '스리랑카', bd: '방글라데시', other: '기타' };

const nowIso = () => new Date().toISOString();
// 카카오맵 (관리자 지도와 같은 지도). 이름은 핀 이름표로 뜸
const mapLink = (lat, lng, name) => `https://map.kakao.com/link/map/${encodeURIComponent(String(name || 'HANDS').replace(/,/g, ' '))},${lat},${lng}`;
const adminLink = (id) => `https://hands-platform.vercel.app/admin#/members/${encodeURIComponent(id)}`;

function publicProfile(m) {
  return {
    id: m.id, name: m.name, country: m.country, language: m.language, phone: m.phone,
    passport_last4: m.passport_number ? String(m.passport_number).slice(-4) : null,
    company: m.company, created_at: m.created_at, last_checkin_at: m.last_checkin_at,
    consent_version: m.consent_version, consent_current: m.consent_version === CONSENT_VERSION,
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

// 「집중 관리」 근로자는 앱을 열고 닫을 때 텔레그램 (같은 종류 1분 안 중복은 건너뜀)
async function watchAlert(m, b, kind) {
  if (!m.watch) return;
  const since = new Date(Date.now() - 60000).toISOString();
  const recent = await db(`location_history?select=id&member_id=eq.${m.id}&source=eq.${kind}&recorded_at=gt.${encodeURIComponent(since)}&limit=1`).catch(() => []);
  if (recent.length) return;
  const lat = num(b.lat), lng = num(b.lng);
  const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  await L.telegram([`[HANDS 집중 관리] ${m.name} 앱 ${kind === 'app_open' ? '열림' : '닫힘'}`, `시각: ${kst}`,
    lat != null && lng != null ? `위치(카카오맵): ${mapLink(lat, lng, m.name)}` : '위치: 받지 못함',
    `관리자에서 보기: ${adminLink(m.id)}`].join('\n')).catch(() => {});
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
    if (hits.length >= 12) throw new HttpError(429, 'too_many');
    hits.push(now); readHits.set(ip, hits);
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
    if (!m || m[2].length > 4500000) throw new HttpError(400, 'bad_image');
    const client = new Anthropic();
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
    const selfie = L.imageFromDataUrl(b.selfie);
    const passport = L.imageFromDataUrl(b.passport);

    const token = L.newToken();
    const t = nowIso();
    const rows = await db('members', {
      method: 'POST', prefer: 'return=representation',
      body: {
        name, country,
        phone: clean(b.phone, 30),
        passport_number: clean(b.passport_number, 30),
        birth_date: clean(b.birth_date, 10),
        gender: clean(b.gender, 10),
        company: clean(b.company, 80),
        emergency_contact: clean(b.emergency_contact, 120),
        language: clean(b.language, 10) || 'en',
        consents: { ...Object.fromEntries(REQUIRED.map(k => [k, true])), marketing: c.marketing === true, at: t, version: CONSENT_VERSION },
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
    return { ok: true, token, profile: publicProfile({ ...m, selfie_photo_path: sp }) };
  },

  async me(req) {
    const m = await L.workerFromReq(req);
    return { ok: true, profile: publicProfile(m) };
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
      consents: { ...Object.fromEntries(REQUIRED.map(k => [k, true])), marketing: c.marketing === true, at: t, version: CONSENT_VERSION },
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
    const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const notified = await L.telegram([
      '[HANDS 긴급 SOS]',
      `${m.name} (${COUNTRY_KO[m.country] || m.country || '-'})`,
      `전화: ${m.phone || '-'}`,
      m.company ? `근무처: ${m.company}` : null,
      `시각: ${kst}`,
      hasLoc ? `위치(카카오맵): ${mapLink(lat, lng, m.name)}` : '위치: 받지 못함',
      `관리자에서 보기: ${adminLink(m.id)}`,
    ].filter(Boolean).join('\n'));
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
    await L.telegram([`[HANDS ${label}]`, `${m.name} (${COUNTRY_KO[m.country] || m.country || '-'}) ${m.phone || ''}`, body.slice(0, 300), `관리자에서 보기: ${adminLink(m.id)}`].join('\n')).catch(() => {});
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
