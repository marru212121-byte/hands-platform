// 근로자 앱 서버 — /api/w?action=...
const L = require('./_lib');
const { db, HttpError, clean, num } = L;

const CONSENT_VERSION = '2026-10-27';
const REQUIRED = ['terms', 'privacy', 'sensitive', 'location'];
const COUNTRY_KO = { vn: '베트남', th: '태국', id: '인도네시아', ph: '필리핀', np: '네팔', kh: '캄보디아', mm: '미얀마', lk: '스리랑카', bd: '방글라데시', other: '기타' };

const nowIso = () => new Date().toISOString();
const mapLink = (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`;

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

module.exports = L.handler({
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
    const source = ['app_open', 'watch'].includes(b.source) ? b.source : 'app_open';
    await saveLocation(m, { ...b, source });
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
      hasLoc ? `위치: ${mapLink(lat, lng)}` : '위치: 받지 못함',
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
    await L.telegram([`[HANDS ${label}]`, `${m.name} (${COUNTRY_KO[m.country] || m.country || '-'}) ${m.phone || ''}`, body.slice(0, 300)].join('\n')).catch(() => {});
    return { ok: true };
  },

  async inquiries(req) {
    const m = await L.workerFromReq(req);
    const rows = await db(`inquiries?select=id,category,title,body,reply,status,created_at,replied_at&member_id=eq.${m.id}&order=created_at.desc&limit=30`);
    return { ok: true, inquiries: rows };
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
