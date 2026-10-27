// 관리자 서버 — /api/a?action=...  (수파베이스 로그인 + hands_admins 명단만)
const L = require('./_lib');
const { db, HttpError, clean } = L;

const MEMBER_COLS = 'id,watch,name,phone,country,language,company,birth_date,gender,passport_number,emergency_contact,is_active,created_at,last_seen_at,last_login_at,last_checkin_at,consent_version,consent_at,consents';
const nowIso = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

async function memberById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new HttpError(400, 'bad_id');
  const rows = await db(`members?select=${MEMBER_COLS},selfie_photo_path,passport_photo_path&id=eq.${id}`);
  if (!rows.length) throw new HttpError(404, 'not_found');
  return rows[0];
}

// 공지 번역: 하이쿠 5.5, 구조화 출력 (사장님 10-27)
const LANG_NAMES = { en: 'English', vi: 'Vietnamese', id: 'Indonesian', th: 'Thai', tl: 'Filipino (Tagalog)', ne: 'Nepali', km: 'Khmer', my: 'Burmese', si: 'Sinhala', bn: 'Bengali' };
async function translate(title, body, lang) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: 'claude-haiku-5-5', max_tokens: 1024,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'], additionalProperties: false } } },
    messages: [{ role: 'user', content: `Translate this Korean notice from a company to its foreign workers into ${LANG_NAMES[lang]}. Keep numbers, names, places, dates and phone numbers exactly. Plain, friendly words.\n\nTITLE: ${title}\n\nBODY: ${body}` }],
  });
  const txt = (msg.content.find((c) => c.type === 'text') || {}).text || '';
  const r = JSON.parse(txt);
  return { title: String(r.title || '').slice(0, 120), body: String(r.body || '').slice(0, 600) };
}

// 월급날 알림 (사장님 10-27): 크론(아침 9시)에서 그날이 월급날인 근로자에게. 그 달에 날짜가 없으면(31일 등) 마지막 날에
const PAY_MSG = {
  ko: ['오늘은 월급날입니다', '오늘 환율을 확인해 보세요.'], en: ['Today is payday', 'Check today\'s exchange rate.'],
  vi: ['Hôm nay là ngày nhận lương', 'Hãy xem tỷ giá hôm nay.'], id: ['Hari ini hari gajian', 'Lihat kurs hari ini.'],
  th: ['วันนี้เป็นวันเงินเดือนออก', 'ดูอัตราแลกเปลี่ยนวันนี้'], tl: ['Araw ng sahod ngayon', 'Tingnan ang palitan ng pera ngayon.'],
  ne: ['आज तलब आउने दिन हो', 'आजको विनिमय दर हेर्नुहोस्।'], km: ['ថ្ងៃនេះជាថ្ងៃបើកប្រាក់ខែ', 'សូមមើលអត្រាប្តូរប្រាក់ថ្ងៃនេះ។'],
  my: ['ယနေ့ လစာထုတ်ရက်ဖြစ်သည်', 'ယနေ့ ငွေလဲနှုန်းကို ကြည့်ပါ။'], si: ['අද වැටුප් දිනයයි', 'අද විනිමය අනුපාතය බලන්න.'],
  bn: ['আজ বেতনের দিন', 'আজকের বিনিময় হার দেখুন।'] };
async function paydayPush() {
  const k = new Date(Date.now() + 9 * 3600000), day = k.getUTCDate();
  const last = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 0)).getUTCDate();
  const cond = day === last ? `payday=gte.${day}` : `payday=eq.${day}`;
  const subs = await db(`push_subscriptions?select=id,endpoint,p256dh,auth,member:members!inner(id,language,is_active,payday)&member.is_active=eq.true&member.${cond}`);
  if (!subs.length) return { sent: 0 };
  const wp = L.webpush(); let sent = 0; const gone = [];
  await Promise.all(subs.map(async (s) => {
    const [title, body] = PAY_MSG[s.member.language] || PAY_MSG.en;
    try { await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url: '/?fx=1' }), { TTL: 43200 }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.id); }
  }));
  if (gone.length) await db(`push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' }).catch(() => {});
  return { sent };
}

module.exports = L.handler({
  // 공용 아이디·비밀번호. 15분에 10번 넘게 틀리면 잠깐 막음(같은 IP).
  async login(req, b) {
    if (req.method !== 'POST') throw new HttpError(405, 'post_only');
    const ip = clean(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0], 64) || '-';
    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const fails = await db(`access_logs?select=id&action=eq.login_fail&admin_email=eq.${encodeURIComponent('ip:' + ip)}&created_at=gt.${encodeURIComponent(since)}`);
    if (fails.length >= 10) throw new HttpError(429, 'too_many');
    const id = String(b.id || '').trim().toLowerCase();
    let who = null;
    if (L.checkAdminLogin(b.id, b.password)) who = { email: id, name: '관리자', role: 'admin' };
    else {
      const rows = await db('app_settings?select=value&key=eq.managers');
      const mg = ((rows[0] && rows[0].value) || []).find((x) => x.id === id);
      if (mg && mg.pw_hash && L.pwCheck(String(b.password || ''), mg.pw_hash)) who = { email: id, name: mg.name || '매니저', company: mg.company || '', role: 'manager' };
    }
    if (!who) {
      await db('access_logs', { method: 'POST', body: { admin_email: 'ip:' + ip, action: 'login_fail' } }).catch(() => {});
      await new Promise(r => setTimeout(r, 400));
      throw new HttpError(401, 'wrong_login');
    }
    await db('access_logs', { method: 'POST', body: { admin_email: id, action: 'login' } }).catch(() => {});
    return { ok: true, admin: who, __setCookie: L.adminCookie(id, who.role, who.name) };
  },

  async logout() {
    return { ok: true, __setCookie: L.clearAdminCookie() };
  },

  async me(req) {
    const a = await L.adminFromReq(req);
    return { ok: true, admin: a };
  },

  async dashboard(req) {
    const me = await L.adminFromReq(req);
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
      located: me.role === 'admin' ? locs.length : null,
      inquiries_open: inq.length,
    } };
  },

  // 목록 + 검색(이름·전화·여권번호·근무처)
  async members(req) {
    const me = await L.adminFromReq(req);
    const q = clean(req.query.q, 60);
    let filter = '';
    if (q) {
      const s = encodeURIComponent(`*${q.replace(/[*,()]/g, '')}*`);
      filter = `&or=(name.ilike.${s},phone.ilike.${s},passport_number.ilike.${s},company.ilike.${s})`;
    }
    const rows = await db(`members?select=id,name,phone,country,company,created_at,last_seen_at,last_checkin_at,is_active,watch,passport_number&order=created_at.desc&limit=500${filter}`);
    const [locs, all] = await Promise.all([
      db(`locations?select=member_id,lat,lng,updated_at,sos_active`),
      db(`members?select=id,name,birth_date,passport_number&limit=5000`),
    ]);
    const byId = Object.fromEntries(locs.map(l => [l.member_id, l]));
    // 중복 가입 의심: 같은 여권번호, 또는 같은 이름+생년월일 (아이폰 사파리↔홈 화면 앱 등으로 다시 가입한 경우)
    const keyCount = {};
    const keys = (m) => [m.passport_number && 'p:' + String(m.passport_number).toUpperCase().replace(/\s/g, ''),
      m.name && m.birth_date && 'n:' + String(m.name).toUpperCase().replace(/\s+/g, ' ').trim() + '|' + m.birth_date].filter(Boolean);
    all.forEach((m) => keys(m).forEach((k) => { keyCount[k] = (keyCount[k] || 0) + 1; }));
    return { ok: true, members: rows.map(m => ({ ...m,
      dup: keys(m).some((k) => keyCount[k] > 1),
      passport_number: m.passport_number ? '•••' + String(m.passport_number).slice(-4) : null,
      ...(me.role === 'admin' ? { location: byId[m.id] || null } : { location: null, watch: null }) })) };
  },

  // 상세: 사진은 10분짜리 서명 주소, 열람은 기록
  async member(req) {
    const a = await L.adminFromReq(req);
    const m = await memberById(req.query.id);
    const isAdmin = a.role === 'admin';
    const [history, sos, selfie, passport] = await Promise.all([
      !isAdmin ? [] : db(`location_history?select=lat,lng,accuracy,source,recorded_at&member_id=eq.${m.id}&order=recorded_at.desc&limit=50`),
      !isAdmin ? [] : db(`sos_alerts?select=id,lat,lng,status,created_at,resolved_at,resolved_by,notified_at,note&member_id=eq.${m.id}&order=created_at.desc&limit=20`),
      L.signedUrl(m.selfie_photo_path), L.signedUrl(m.passport_photo_path),
    ]);
    await L.logAccess(a, m.id, 'view_member');
    const { selfie_photo_path, passport_photo_path, login_pw_hash, ...rest } = m;
    if (!isAdmin) rest.watch = null;
    return { ok: true, member: { ...rest, custom_pw: !!login_pw_hash }, photos: { selfie, passport }, history, sos };
  },

  // 근로자 비밀번호 바꾸기(잊어버렸을 때). 빈칸이면 처음처럼 여권번호로 되돌림
  async member_password(req, b) {
    const a = await L.adminFromReq(req);
    const m = await memberById(b.id);
    const pw = String(b.password || '').trim();
    if (pw && pw.length < 4) throw new HttpError(400, 'pw_short');
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: { login_pw_hash: pw ? L.pwHash(pw) : null, updated_at: nowIso() } });
    await L.logAccess(a, m.id, pw ? 'member_pw_set' : 'member_pw_reset');
    return { ok: true };
  },

  // 매니저 계정·담당자 연락처 (관리자만)
  async staff(req) {
    await L.adminOnly(req);
    const [mg, ct] = await Promise.all([db('app_settings?select=value&key=eq.managers'), db('app_settings?select=value&key=eq.contacts')]);
    return { ok: true, managers: ((mg[0] && mg[0].value) || []).map((x) => ({ id: x.id, name: x.name || '', company: x.company || '' })), contacts: (ct[0] && ct[0].value) || [] };
  },
  async staff_set(req, b) {
    const a = await L.adminOnly(req);
    const old = await db('app_settings?select=value&key=eq.managers');
    const oldById = Object.fromEntries(((old[0] && old[0].value) || []).map((x) => [x.id, x]));
    const managers = (Array.isArray(b.managers) ? b.managers : []).slice(0, 100).map((x) => {
      const id = clean(String(x.id || '').toLowerCase(), 40);
      if (!/^[a-z0-9._-]{3,40}$/.test(id) || id === String(process.env.HANDS_ADMIN_ID || '').trim().toLowerCase()) throw new HttpError(400, 'bad_id');
      const pw = String(x.password || '').trim();
      const pw_hash = pw ? L.pwHash(pw) : (oldById[id] && oldById[id].pw_hash);
      if (!pw_hash) throw new HttpError(400, 'pw_needed');
      return { id, name: clean(x.name, 40), company: clean(x.company, 60), pw_hash };
    });
    const contacts = (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 30).map((c) => ({ name: clean(c.name, 40), role: clean(c.role, 40), phone: clean(c.phone, 30) })).filter((c) => c.name && c.phone);
    const t = nowIso();
    await db('app_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates', body: [{ key: 'managers', value: managers, updated_at: t }, { key: 'contacts', value: contacts, updated_at: t }] });
    await L.logAccess(a, null, 'staff_set');
    return { ok: true };
  },

  async update(req, b) {
    const a = await L.adminFromReq(req);
    const m = await memberById(b.id);
    const patch = {};
    for (const k of ['name', 'phone', 'company', 'emergency_contact', 'passport_number', 'birth_date', 'gender']) {
      if (k in b) patch[k] = clean(b[k], 120);
    }
    if ('passport_number' in patch) patch.passport_number = String(patch.passport_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if ('is_active' in b) patch.is_active = !!b.is_active;
    if ('watch' in b && a.role === 'admin') patch.watch = !!b.watch;
    patch.updated_at = nowIso();
    await db(`members?id=eq.${m.id}`, { method: 'PATCH', body: patch });
    await L.logAccess(a, m.id, 'update_member');
    return { ok: true };
  },

  async sos(req) {
    await L.adminOnly(req);
    const rows = await db(`sos_alerts?select=id,lat,lng,status,created_at,resolved_at,resolved_by,notified_at,note,member:members(id,name,phone,country,company)&order=created_at.desc&limit=100`);
    return { ok: true, sos: rows };
  },

  async sos_resolve(req, b) {
    const a = await L.adminOnly(req);
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
    await L.adminOnly(req);
    const [rows, mem] = await Promise.all([
      db(`locations?select=member_id,lat,lng,accuracy,updated_at,sos_active,member_name,member_country`),
      db(`members?select=id,company,watch`),
    ]);
    const byId = Object.fromEntries(mem.map(m => [m.id, m]));
    return { ok: true, locations: rows.map(l => ({ ...l, company: (byId[l.member_id] || {}).company || null, watch: (byId[l.member_id] || {}).watch === true })) };
  },

  async logs(req) {
    await L.adminOnly(req);
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

  // 근로자에게 푸시: 전체 / 국적 / 한 사람
  // 알림 = 공지. 받는 근로자마다 그 사람 언어로 자동 번역 + 한국어 원문, 누르면 그 공지가 열림 (사장님 10-27)
  async push_send(req, b) {
    const a = await L.adminFromReq(req);
    const title = clean(b.title, 80), body = clean(b.body, 300);
    if (!title || !body) throw new HttpError(400, 'missing_fields');
    let filter = '';
    if (b.target === 'member') {
      if (!/^[0-9a-f-]{36}$/i.test(String(b.member_id || ''))) throw new HttpError(400, 'bad_id');
      filter = `&member_id=eq.${b.member_id}`;
    } else if (b.target === 'country') {
      const c = clean(b.country, 10); if (!c) throw new HttpError(400, 'missing_fields');
      filter = `&member.country=eq.${encodeURIComponent(c)}`;
    }
    const target = b.target === 'member' ? 'member:' + b.member_id : b.target === 'country' ? 'country:' + b.country : 'all';
    const subs = await db(`push_subscriptions?select=id,endpoint,p256dh,auth,member:members!inner(id,country,language,is_active)&member.is_active=eq.true${filter}`);
    const rows = await db('push_messages', { method: 'POST', prefer: 'return=representation', body: { admin_email: a.email, target, title, body, sent: 0, failed: 0 } });
    const msgId = rows[0].id;
    // 받는 사람들의 언어만 번역 (한국어는 원문 그대로)
    const langs = [...new Set(subs.map((s) => s.member.language || 'en'))].filter((l) => l !== 'ko' && LANG_NAMES[l]);
    const i18n = {};
    await Promise.all(langs.map(async (l) => { const tr = await translate(title, body, l).catch(() => null); if (tr) i18n[l] = tr; }));
    if (Object.keys(i18n).length) await db(`push_messages?id=eq.${msgId}`, { method: 'PATCH', body: { i18n } }).catch(() => {});
    const wp = L.webpush();
    let sent = 0, failed = 0; const gone = [];
    await Promise.all(subs.map(async (s) => {
      const tr = i18n[s.member.language];
      const payload = JSON.stringify(tr
        ? { title: tr.title, body: tr.body + '\n\n[한국어] ' + body, url: '/?notice=' + msgId }
        : { title, body, url: '/?notice=' + msgId });
      try { await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); sent++; }
      catch (e) { failed++; if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.id); }
    }));
    if (gone.length) await db(`push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' }).catch(() => {});
    await db(`push_messages?id=eq.${msgId}`, { method: 'PATCH', body: { sent, failed } }).catch(() => {});
    await L.logAccess(a, b.target === 'member' ? b.member_id : null, 'push_send');
    return { ok: true, sent, failed, subscribers: subs.length, translated: Object.keys(i18n) };
  },

  async push_history(req) {
    await L.adminFromReq(req);
    const [rows, subs] = await Promise.all([
      db('push_messages?select=id,admin_email,target,title,body,sent,failed,created_at&order=created_at.desc&limit=50'),
      db('push_subscriptions?select=member_id'),
    ]);
    return { ok: true, messages: rows, subscribed_members: new Set(subs.map(s => s.member_id)).size };
  },

  // 텔레그램 연결: 봇 확인 · 말 건 사람 찾기 · 받는 사람 저장 · 시험 보내기
  async telegram_status(req) {
    await L.adminOnly(req);
    const rows = await db('app_settings?select=value&key=eq.telegram_chats');
    const chats = (rows[0] && rows[0].value) || [];
    if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: true, connected: false, bot: null, chats };
    try {
      const me = await L.telegramApi('getMe');
      return { ok: true, connected: true, bot: { username: me.username, name: me.first_name }, chats };
    } catch (_) { return { ok: true, connected: false, bot: null, chats, error: 'bad_token' }; }
  },

  async telegram_scan(req) {
    await L.adminOnly(req);
    const ups = await L.telegramApi('getUpdates', { limit: 100, allowed_updates: ['message'] });
    const seen = {};
    for (const u of ups) {
      const c = u.message && u.message.chat;
      if (c && c.type === 'private') seen[c.id] = { id: String(c.id), name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id), username: c.username || null };
    }
    return { ok: true, candidates: Object.values(seen) };
  },

  async telegram_set(req, b) {
    const a = await L.adminOnly(req);
    const chats = (Array.isArray(b.chats) ? b.chats : []).slice(0, 10)
      .filter(c => /^-?\d{3,20}$/.test(String(c.id)))
      .map(c => ({ id: String(c.id), name: clean(c.name, 60) || String(c.id) }));
    await db('app_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates',
      body: { key: 'telegram_chats', value: chats, updated_at: nowIso() } });
    await L.logAccess(a, null, 'telegram_set');
    return { ok: true, chats };
  },

  async telegram_test(req) {
    await L.adminOnly(req);
    const sent = await L.telegram('[HANDS] 텔레그램 연결 시험입니다. 이 메시지가 보이면 SOS·문의 알림이 이 방으로 옵니다.');
    return { ok: true, sent };
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
    const pay = await paydayPush().catch((e) => ({ error: String(e && e.message || e) }));
    const rows = await db(`members?select=name,phone,country,last_seen_at&is_active=eq.true&last_seen_at=lt.${encodeURIComponent(daysAgo(3))}&order=last_seen_at.asc&limit=50`);
    if (!rows.length) return { ok: true, sent: false, pay };
    const lines = rows.map(m => `- ${m.name} (${m.phone || '-'}) 마지막 접속 ${new Date(m.last_seen_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    const sent = await L.telegram([`[HANDS] 3일 넘게 앱을 열지 않은 근로자 ${rows.length}명`, ...lines].join('\n'));
    return { ok: true, sent, pay };
  },
});
