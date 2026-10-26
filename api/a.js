// 관리자 서버 — /api/a?action=...  (수파베이스 로그인 + hands_admins 명단만)
const L = require('./_lib');
const { db, HttpError, clean } = L;

const MEMBER_COLS = 'id,name,phone,country,language,company,birth_date,gender,passport_number,emergency_contact,is_active,created_at,last_seen_at,last_login_at,last_checkin_at,consent_version,consent_at,consents';
const nowIso = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

async function memberById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new HttpError(400, 'bad_id');
  const rows = await db(`members?select=${MEMBER_COLS},selfie_photo_path,passport_photo_path&id=eq.${id}`);
  if (!rows.length) throw new HttpError(404, 'not_found');
  return rows[0];
}

module.exports = L.handler({
  // 공용 아이디·비밀번호. 15분에 10번 넘게 틀리면 잠깐 막음(같은 IP).
  async login(req, b) {
    if (req.method !== 'POST') throw new HttpError(405, 'post_only');
    const ip = clean(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0], 64) || '-';
    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const fails = await db(`access_logs?select=id&action=eq.login_fail&admin_email=eq.${encodeURIComponent('ip:' + ip)}&created_at=gt.${encodeURIComponent(since)}`);
    if (fails.length >= 10) throw new HttpError(429, 'too_many');
    if (!L.checkAdminLogin(b.id, b.password)) {
      await db('access_logs', { method: 'POST', body: { admin_email: 'ip:' + ip, action: 'login_fail' } }).catch(() => {});
      await new Promise(r => setTimeout(r, 400));
      throw new HttpError(401, 'wrong_login');
    }
    const id = String(b.id).trim().toLowerCase();
    await db('access_logs', { method: 'POST', body: { admin_email: id, action: 'login' } }).catch(() => {});
    return { ok: true, admin: { email: id, name: '관리자' }, __setCookie: L.adminCookie(id) };
  },

  async logout() {
    return { ok: true, __setCookie: L.clearAdminCookie() };
  },

  async me(req) {
    const a = await L.adminFromReq(req);
    return { ok: true, admin: a };
  },

  async dashboard(req) {
    await L.adminFromReq(req);
    const [members, sos, locs, inq] = await Promise.all([
      db(`members?select=id,last_seen_at,last_checkin_at,is_active,created_at`),
      db(`sos_alerts?select=id,status&status=eq.pending`),
      db(`locations?select=member_id,updated_at`),
      db(`inquiries?select=id&status=eq.open`),
    ]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const active = members.filter(m => m.is_active !== false);
    const silent3 = active.filter(m => !m.last_seen_at || m.last_seen_at < daysAgo(3)).length;
    return { ok: true, stats: {
      total: active.length,
      seen_today: active.filter(m => m.last_seen_at && new Date(m.last_seen_at) >= today).length,
      checkin_today: active.filter(m => m.last_checkin_at && new Date(m.last_checkin_at) >= today).length,
      sos_pending: sos.length,
      silent_3d: silent3,
      new_7d: active.filter(m => m.created_at >= daysAgo(7)).length,
      located: locs.length,
      inquiries_open: inq.length,
    } };
  },

  // 목록 + 검색(이름·전화·여권번호·근무처)
  async members(req) {
    await L.adminFromReq(req);
    const q = clean(req.query.q, 60);
    let filter = '';
    if (q) {
      const s = encodeURIComponent(`*${q.replace(/[*,()]/g, '')}*`);
      filter = `&or=(name.ilike.${s},phone.ilike.${s},passport_number.ilike.${s},company.ilike.${s})`;
    }
    const rows = await db(`members?select=id,name,phone,country,company,created_at,last_seen_at,last_checkin_at,is_active,passport_number&order=created_at.desc&limit=500${filter}`);
    const locs = await db(`locations?select=member_id,lat,lng,updated_at,sos_active`);
    const byId = Object.fromEntries(locs.map(l => [l.member_id, l]));
    return { ok: true, members: rows.map(m => ({ ...m,
      passport_number: m.passport_number ? '•••' + String(m.passport_number).slice(-4) : null,
      location: byId[m.id] || null })) };
  },

  // 상세: 사진은 10분짜리 서명 주소, 열람은 기록
  async member(req) {
    const a = await L.adminFromReq(req);
    const m = await memberById(req.query.id);
    const [history, sos, selfie, passport] = await Promise.all([
      db(`location_history?select=lat,lng,accuracy,source,recorded_at&member_id=eq.${m.id}&order=recorded_at.desc&limit=50`),
      db(`sos_alerts?select=id,lat,lng,status,created_at,resolved_at,resolved_by,notified_at,note&member_id=eq.${m.id}&order=created_at.desc&limit=20`),
      L.signedUrl(m.selfie_photo_path), L.signedUrl(m.passport_photo_path),
    ]);
    await L.logAccess(a, m.id, 'view_member');
    const { selfie_photo_path, passport_photo_path, ...rest } = m;
    return { ok: true, member: rest, photos: { selfie, passport }, history, sos };
  },

  async update(req, b) {
    const a = await L.adminFromReq(req);
    const m = await memberById(b.id);
    const patch = {};
    for (const k of ['name', 'phone', 'company', 'emergency_contact', 'passport_number', 'birth_date', 'gender']) {
      if (k in b) patch[k] = clean(b[k], 120);
    }
    if ('is_active' in b) patch.is_active = !!b.is_active;
    patch.updated_at = nowIso();
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: patch });
    await L.logAccess(a, m.id, 'update_member');
    return { ok: true };
  },

  async sos(req) {
    await L.adminFromReq(req);
    const rows = await db(`sos_alerts?select=id,lat,lng,status,created_at,resolved_at,resolved_by,notified_at,note,member:members(id,name,phone,country,company)&order=created_at.desc&limit=100`);
    return { ok: true, sos: rows };
  },

  async sos_resolve(req, b) {
    const a = await L.adminFromReq(req);
    if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) throw new HttpError(400, 'bad_id');
    const rows = await db(`sos_alerts?id=eq.${b.id}`, { method: 'PATCH', prefer: 'return=representation', body: {
      status: 'resolved', resolved_at: nowIso(), resolved_by: a.email, note: clean(b.note, 500) } });
    if (rows[0]) {
      const open = await db(`sos_alerts?select=id&member_id=eq.${rows[0].member_id}&status=eq.pending`);
      if (!open.length) await db(`locations?member_id=eq.${rows[0].member_id}`, { method: 'PATCH', body: { sos_active: false } });
      await L.logAccess(a, rows[0].member_id, 'sos_resolve');
    }
    return { ok: true };
  },

  // 며칠째 앱을 안 연 사람
  async silent(req) {
    await L.adminFromReq(req);
    const days = Math.min(30, Math.max(1, parseInt(req.query.days || '3', 10)));
    const rows = await db(`members?select=id,name,phone,country,company,last_seen_at,last_checkin_at&is_active=eq.true&or=(last_seen_at.is.null,last_seen_at.lt.${encodeURIComponent(daysAgo(days))})&order=last_seen_at.asc.nullsfirst&limit=500`);
    return { ok: true, days, members: rows };
  },

  async map(req) {
    await L.adminFromReq(req);
    const rows = await db(`locations?select=member_id,lat,lng,accuracy,updated_at,sos_active,member_name,member_country`);
    return { ok: true, locations: rows };
  },

  async logs(req) {
    await L.adminFromReq(req);
    const rows = await db(`access_logs?select=id,admin_email,action,created_at,member:members(name)&action=neq.login_fail&order=created_at.desc&limit=200`);
    return { ok: true, logs: rows };
  },

  async inquiries(req) {
    await L.adminFromReq(req);
    const st = ['open', 'answered'].includes(req.query.status) ? `&status=eq.${req.query.status}` : '';
    const rows = await db(`inquiries?select=id,category,title,body,reply,status,created_at,replied_at,member:members(id,name,phone,country,company)&order=created_at.desc&limit=200${st}`);
    return { ok: true, inquiries: rows };
  },

  async inquiry_reply(req, b) {
    const a = await L.adminFromReq(req);
    if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) throw new HttpError(400, 'bad_id');
    const reply = clean(b.reply, 2000);
    if (!reply) throw new HttpError(400, 'missing_fields');
    const rows = await db(`inquiries?id=eq.${b.id}`, { method: 'PATCH', prefer: 'return=representation', body: { reply, status: 'answered', replied_at: nowIso() } });
    if (rows[0]) await L.logAccess(a, rows[0].member_id, 'inquiry_reply');
    return { ok: true };
  },

  async posts(req) {
    await L.adminFromReq(req);
    const rows = await db('posts?select=id,category,title,body,created_at,author:members(id,name,country)&order=created_at.desc&limit=100');
    return { ok: true, posts: rows };
  },

  async post_delete(req, b) {
    const a = await L.adminFromReq(req);
    if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) throw new HttpError(400, 'bad_id');
    await db(`posts?id=eq.${b.id}`, { method: 'DELETE' });
    await L.logAccess(a, null, 'post_delete');
    return { ok: true };
  },

  // 매일 아침(버셀 크론) — 3일 넘게 앱을 안 연 사람을 텔레그램으로
  async cron(req) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) throw new HttpError(401, 'no');
    // 위치 기록 보관 6개월(약관 위치정보 항목)
    await db(`location_history?recorded_at=lt.${encodeURIComponent(daysAgo(180))}`, { method: 'DELETE' }).catch(() => {});
    const rows = await db(`members?select=name,phone,country,last_seen_at&is_active=eq.true&last_seen_at=lt.${encodeURIComponent(daysAgo(3))}&order=last_seen_at.asc&limit=50`);
    if (!rows.length) return { ok: true, sent: false };
    const lines = rows.map(m => `- ${m.name} (${m.phone || '-'}) 마지막 접속 ${new Date(m.last_seen_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    const sent = await L.telegram([`[HANDS] 3일 넘게 앱을 열지 않은 근로자 ${rows.length}명`, ...lines].join('\n'));
    return { ok: true, sent };
  },
});
