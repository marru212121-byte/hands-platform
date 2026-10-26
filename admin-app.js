/* HANDS 관리자 콘솔 — 모든 데이터는 /api/a 를 통해서만 (표 직접 조회 없음) */
(() => {
'use strict';

/* ───────── 안전한 HTML 조립 ───────── */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ESC[c]);
const val = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : (v == null || v === false) ? '' : esc(v);
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += val(vals[i]); });
  return new Raw(out);
}
const setHTML = (el, r) => { el.innerHTML = r instanceof Raw ? r.s : esc(r); };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u)) ? u : null;
const telHref = (p) => { const d = String(p || '').replace(/[^0-9+]/g, ''); return d ? 'tel:' + d : null; };

/* ───────── 아이콘 ───────── */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  userOff: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5M22 8l-5 5"/>',
};
const ico = (name, cls = '') => raw(`<span class="ico ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[name] || ''}</svg></span>`);
const hydrateIcons = (root = document) => $$('[data-i]', root).forEach((el) => {
  if (!el.firstChild) el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[el.dataset.i] || ''}</svg>`;
});

/* ───────── 표기 ───────── */
const COUNTRY = { vn: '베트남', th: '태국', id: '인도네시아', ph: '필리핀', np: '네팔', kh: '캄보디아', mm: '미얀마', lk: '스리랑카', bd: '방글라데시', other: '기타' };
const LANG = { ko: '한국어', en: '영어', vi: '베트남어', th: '태국어', id: '인도네시아어', tl: '필리핀어', fil: '필리핀어', ne: '네팔어', km: '캄보디아어', my: '미얀마어', si: '싱할라어', ta: '타밀어', bn: '벵골어', uz: '우즈베크어', zh: '중국어' };
const GENDER = { M: '남성', F: '여성', m: '남성', f: '여성', male: '남성', female: '여성' };
const SOURCE = { app_open: '앱 실행', watch: '위치 추적', checkin: '안부 확인', sos: 'SOS' };
const CATEGORY = { general: '일반', question: '질문', tip: '생활 정보', event: '행사·소식', notice: '공지' };
const ACTION = {
  view_member: ['근로자 정보 열람', 'navy'], update_member: ['근로자 정보 수정', 'warn'],
  relink_code: ['재연결 번호 발급', 'navy'], sos_resolve: ['SOS 처리', 'ok'], post_delete: ['게시글 삭제', 'danger'],
};
const CONSENT_ITEMS = [
  ['terms', '서비스 이용약관', true], ['privacy', '개인정보 수집·이용', true], ['sensitive', '민감정보(신분증·얼굴 사진) 처리', true],
  ['location', '위치정보 수집·이용', true], ['marketing', '소식·안내 수신', false],
];
const ERR = {
  network: '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.', wrong_login: '아이디 또는 비밀번호가 올바르지 않습니다.',
  too_many: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.', unauthorized: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  not_found: '대상을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.', bad_id: '잘못된 요청입니다.', server_error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};
const errText = (e) => ERR[e && e.code] || ERR.server_error;
const countryName = (c) => COUNTRY[c] || (c ? String(c).toUpperCase() : '-');
const pad = (n) => String(n).padStart(2, '0');
const toDate = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };
const fmtDate = (s) => { const d = toDate(s); return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '-'; };
const fmtDT = (s) => { const d = toDate(s); return d ? `${fmtDate(s)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '-'; };
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function relText(s) {
  const d = toDate(s); if (!d) return null;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return '어제';
  if (days < 30) return `${days}일 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}
const rel = (s, empty = '기록 없음') => { const t = relText(s); return t ? html`<span class="rel" title="${fmtDT(s)}">${t}</span>` : html`<span class="muted">${empty}</span>`; };
const daysSince = (s) => { const d = toDate(s); return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null; };
const isToday = (s) => { const d = toDate(s); if (!d) return false; const t = new Date(); return d.toDateString() === t.toDateString(); };
const flag = (c) => html`<span class="flag">${countryName(c)}</span>`;
const fmtNum = (n) => (Number(n) || 0).toLocaleString('ko-KR');
const coord = (lat, lng) => (lat == null || lng == null) ? null : `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
const gmaps = (lat, lng) => (lat == null || lng == null) ? null : `https://maps.google.com/?q=${Number(lat)},${Number(lng)}`;

/* ───────── API ───────── */
class ApiError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
async function api(action, { params = {}, body } = {}) {
  const qs = new URLSearchParams({ action, ...params });
  let r;
  try {
    r = await fetch('/api/a?' + qs.toString(), {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (_) { throw new ApiError(0, 'network'); }
  let j = null; try { j = await r.json(); } catch (_) { /* 본문 없음 */ }
  if (r.status === 401 && action !== 'login' && action !== 'me' && action !== 'logout') {
    sessionEnded('expired'); throw new ApiError(401, 'unauthorized');
  }
  if (!r.ok || !j || j.ok === false) throw new ApiError(r.status, (j && j.error) || (r.status === 401 ? 'unauthorized' : 'server_error'));
  return j;
}

/* ───────── 상태 ───────── */
const S = {
  admin: null, view: null, timers: [], sosPending: 0, firstPoll: true,
  members: [], memberQuery: '', memberFilter: 'all', selectedId: null,
  sosFilter: 'pending', silentDays: 3, logAction: 'all',
  bigMap: null, miniMap: null, detail: null,
};
const IDLE_MS = 30 * 60 * 1000;
let lastActivity = Date.now();

/* ───────── 토스트·모달 ───────── */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  setHTML(el, html`${ico(kind === 'err' ? 'alert' : 'checkCircle', 'sm')}<span>${msg}</span>`);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
function modal({ title, body, icon, tone = 'teal', actions = [], onMount }) {
  const root = $('#modalRoot');
  const back = document.createElement('div');
  back.className = 'modal-back';
  setHTML(back, html`<div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-head">${icon ? html`<span class="modal-icon ${tone}">${ico(icon, 'lg')}</span>` : ''}<h3 style="${icon ? 'padding-top:8px' : ''}">${title}</h3></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">${actions.map((a, i) => html`<button class="btn ${a.cls || 'btn-secondary'}" data-a="${i}">${a.label}</button>`)}</div>
  </div>`);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $$('[data-a]', back).forEach((b) => b.addEventListener('click', async () => {
    const a = actions[+b.dataset.a];
    if (!a.run) return close();
    $$('button', back).forEach((x) => { x.disabled = true; });
    try { const keep = await a.run(back); if (keep !== true) close(); }
    catch (e) { toast(errText(e), 'err'); $$('button', back).forEach((x) => { x.disabled = false; }); }
  }));
  root.appendChild(back);
  if (onMount) onMount(back);
  const first = $('textarea, input', back) || $('.modal-foot .btn:last-child', back);
  if (first) first.focus();
  return { el: back, close };
}
const confirmDialog = ({ title, message, details, okLabel, danger, run }) => modal({
  title, icon: danger ? 'alert' : 'checkCircle', tone: danger ? 'danger' : 'teal',
  body: html`${details || ''}<p>${message}</p>`,
  actions: [{ label: '취소' }, { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', run }],
});

/* ───────── 로그인 ───────── */
function showLogin(notice) {
  stopTimers(); closePanel(true);
  S.admin = null;
  $('#boot').hidden = true; $('#app').hidden = true; $('#login').hidden = false;
  const n = $('#loginNotice'); n.hidden = !notice; n.textContent = notice || '';
  $('#loginError').hidden = true;
  $('#loginPw').value = '';
  document.title = 'HANDS 관리자 로그인';
  setTimeout(() => ($('#loginId').value ? $('#loginPw') : $('#loginId')).focus(), 0);
}
function sessionEnded(reason) {
  if (!S.admin) return;
  showLogin(reason === 'idle' ? '30분 동안 사용이 없어 자동으로 로그아웃되었습니다.' : '로그인이 만료되었습니다. 다시 로그인해 주세요.');
}
async function logout(reason) {
  try { await api('logout', { body: {} }); } catch (_) { /* 이미 끝난 세션 */ }
  if (reason) sessionEnded(reason); else showLogin('로그아웃되었습니다.');
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#loginId').value.trim(), password = $('#loginPw').value;
  const errEl = $('#loginError');
  if (!id || !password) { errEl.textContent = '아이디와 비밀번호를 입력해 주세요.'; errEl.hidden = false; return; }
  const btn = $('#btnLogin'); btn.disabled = true; btn.textContent = '확인 중';
  try {
    const j = await api('login', { body: { id, password } });
    errEl.hidden = true;
    enterApp(j.admin || { email: id, name: '관리자' });
  } catch (err) {
    errEl.textContent = err.status === 401 ? ERR.wrong_login : errText(err);
    errEl.hidden = false;
    $('#loginPw').select();
  } finally { btn.disabled = false; btn.textContent = '로그인'; }
});

/* ───────── 앱 진입 ───────── */
function enterApp(admin) {
  S.admin = admin;
  $('#boot').hidden = true; $('#login').hidden = true; $('#app').hidden = false;
  $('#adminName').textContent = admin.name || '관리자';
  $('#adminEmail').textContent = admin.email || '';
  $('#adminAvatar').textContent = String(admin.name || admin.email || 'A').trim().charAt(0).toUpperCase();
  lastActivity = Date.now();
  startTimers();
  route();
}
function startTimers() {
  stopTimers();
  S.firstPoll = true;
  pollSos();
  S.timers.push(setInterval(pollSos, 30000));
  S.timers.push(setInterval(tickIdle, 1000));
}
function stopTimers() { S.timers.forEach(clearInterval); S.timers = []; }

/* 30분 무활동 자동 로그아웃 */
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach((ev) =>
  window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
function tickIdle() {
  const left = IDLE_MS - (Date.now() - lastActivity);
  if (left <= 0) { logout('idle'); return; }
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $('#idleLeft').textContent = `${pad(m)}:${pad(s)}`;
  if (S.detail) tickPhotoExpiry();
}

/* SOS 감시(30초) */
async function pollSos() {
  try {
    const j = await api('dashboard');
    const n = Number(j.stats && j.stats.sos_pending) || 0;
    if (!S.firstPoll && n > S.sosPending) toast(`새 SOS 요청이 ${n - S.sosPending}건 들어왔습니다.`, 'err');
    S.firstPoll = false;
    S.sosPending = n;
    updateSosBadge();
    if (S.view === 'sos') renderSos(true);
    if (S.view === 'dashboard') renderDashboard(true, j);
  } catch (_) { /* 다음 주기에 다시 */ }
}
function updateSosBadge() {
  const n = S.sosPending;
  const b = $('#sosBadge'); b.hidden = n <= 0; b.textContent = n > 99 ? '99+' : String(n);
  $('#topSos').hidden = n <= 0; $('#topSosN').textContent = String(n);
  document.title = (n > 0 ? `(SOS ${n}) ` : '') + 'HANDS 관리자' + (S.view ? ' · ' + VIEWS[S.view].title : '');
}
const stamp = () => { $('#updatedAt').textContent = `${fmtTime(new Date())} 기준`; };

/* ───────── 라우팅 ───────── */
const VIEWS = {
  dashboard: { title: '대시보드', sub: '근로자 현황과 긴급 상황을 한눈에 확인합니다.', render: () => renderDashboard() },
  qr: { title: '가입 QR', sub: '공항·교육장에 붙일 가입 안내 포스터입니다. A4로 인쇄해 사용하세요.', render: () => renderQr() },
  members: { title: '근로자', sub: '등록된 근로자를 검색하고 정보를 관리합니다.', render: () => renderMembers() },
  map: { title: '지도', sub: '근로자가 마지막으로 공유한 위치입니다.', render: () => renderMap() },
  sos: { title: 'SOS', sub: '긴급 도움 요청을 확인하고 처리합니다. 30초마다 자동으로 갱신됩니다.', render: () => renderSos() },
  silent: { title: '미접속', sub: '일정 기간 앱을 열지 않은 근로자입니다. 직접 연락해 안부를 확인하세요.', render: () => renderSilent() },
  posts: { title: '게시판', sub: '근로자 커뮤니티 게시글을 관리합니다.', render: () => renderPosts() },
  logs: { title: '열람 기록', sub: '관리자의 개인정보 열람·수정 내역입니다. 기록은 수정하거나 삭제할 수 없습니다.', render: () => renderLogs() },
};
function route() {
  if (!S.admin) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  let view = VIEWS[parts[0]] ? parts[0] : 'dashboard';
  const memberId = view === 'members' && parts[1] ? decodeURIComponent(parts[1]) : null;
  if (view !== S.view) {
    if (S.bigMap) { S.bigMap.remove(); S.bigMap = null; }
    S.view = view;
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    $('#pageTitle').textContent = VIEWS[view].title;
    $('#pageSub').textContent = VIEWS[view].sub;
    const v = $('#view');
    v.className = 'view' + (view === 'map' ? ' view-map' : '');
    v.scrollTop = 0; window.scrollTo(0, 0);
    $('#app').classList.remove('drawer');
    updateSosBadge();
    VIEWS[view].render();
  }
  if (memberId) openPanel(memberId); else closePanel();
}
window.addEventListener('hashchange', route);

/* 공통 조각 */
const loadingRows = (cols, n = 6) => html`${Array.from({ length: n }, () => html`<tr>${Array.from({ length: cols }, (_, i) => html`<td><span class="skel" style="width:${[60, 40, 70, 50, 45, 55, 35, 40][i % 8]}%"></span></td>`)}</tr>`)}`;
const emptyBox = (title, sub, icon = 'search') => html`<div class="empty">${ico(icon)}<div class="empty-title">${title}</div><div>${sub || ''}</div></div>`;
const errorBox = (e) => html`<div class="err-box">${ico('alert', 'lg')}<div style="margin-top:8px">${errText(e)}</div><button class="btn btn-secondary btn-sm" data-retry>${ico('refresh', 'sm')}다시 시도</button></div>`;
function bindRetry(root, fn) { const b = $('[data-retry]', root); if (b) b.addEventListener('click', fn); }

/* ───────── 1. 대시보드 ───────── */
async function renderDashboard(silent, preStats) {
  const v = $('#view');
  if (!silent) {
    setHTML(v, html`<div class="kpis" id="kpis">${Array.from({ length: 6 }, () => html`<div class="kpi"><span class="skel" style="width:50%"></span><span class="skel" style="width:30%;height:24px"></span><span class="skel" style="width:70%"></span></div>`)}</div>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>최근 SOS</h2><div class="right"><a class="link" href="#/sos">전체 보기</a></div></div><div id="dashSos"><ul class="mini-list">${Array.from({ length: 4 }, () => html`<li><span class="skel" style="width:60%"></span></li>`)}</ul></div></section>
        <section class="card"><div class="card-head"><h2>3일 이상 미접속</h2><span class="count" id="dashSilentN"></span><div class="right"><a class="link" href="#/silent">전체 보기</a></div></div><div id="dashSilent"><ul class="mini-list">${Array.from({ length: 4 }, () => html`<li><span class="skel" style="width:60%"></span></li>`)}</ul></div></section>
      </div>`);
  }
  const [st, sos, sil] = await Promise.allSettled([
    preStats ? Promise.resolve(preStats) : api('dashboard'), api('sos'), api('silent', { params: { days: 3 } }),
  ]);
  if (S.view !== 'dashboard') return;
  stamp();
  const kp = $('#kpis');
  if (st.status === 'fulfilled') {
    const s = st.value.stats || {};
    S.sosPending = Number(s.sos_pending) || 0; updateSosBadge();
    const pct = (a) => s.total ? `전체의 ${Math.round((a / s.total) * 100)}%` : '-';
    const cards = [
      { k: 'total', label: '전체 근로자', icon: 'users', foot: `위치 공유 ${fmtNum(s.located)}명`, to: '#/members', cls: 'teal' },
      { k: 'seen_today', label: '오늘 접속', icon: 'activity', foot: pct(s.seen_today), to: '#/members' },
      { k: 'checkin_today', label: '오늘 안부 확인', icon: 'checkCircle', foot: pct(s.checkin_today), to: '#/members' },
      { k: 'sos_pending', label: 'SOS 미처리', icon: 'alert', foot: s.sos_pending > 0 ? '즉시 확인이 필요합니다' : '미처리 요청 없음', to: '#/sos', cls: s.sos_pending > 0 ? 'danger' : '' },
      { k: 'silent_3d', label: '3일 이상 미접속', icon: 'clock', foot: '연락 확인 필요', to: '#/silent', cls: s.silent_3d > 0 ? 'warn' : '' },
      { k: 'new_7d', label: '최근 7일 가입', icon: 'userPlus', foot: '신규 등록', to: '#/members' },
    ];
    setHTML(kp, html`${cards.map((c) => html`<a class="kpi ${c.cls || ''}" href="${c.to}">
      <div class="kpi-top"><span>${c.label}</span><span class="kpi-icon">${ico(c.icon, 'sm')}</span></div>
      <div class="kpi-value num">${fmtNum(s[c.k])}<small>${c.k === 'sos_pending' ? '건' : '명'}</small></div>
      <div class="kpi-foot">${c.foot}</div></a>`)}`);
  } else if (!silent) setHTML(kp, html`<div class="card" style="grid-column:1/-1">${errorBox(st.reason)}</div>`);

  const ds = $('#dashSos');
  if (sos.status === 'fulfilled') {
    const list = sortSos(sos.value.sos || []).slice(0, 6);
    setHTML(ds, list.length ? html`<ul class="mini-list">${list.map((a) => {
      const m = a.member || {};
      return html`<li class="clickable" data-member="${m.id || ''}">
        ${a.status === 'pending' ? html`<span class="badge danger"><span class="d"></span>미처리</span>` : html`<span class="badge off">처리 완료</span>`}
        <div class="who"><b>${m.name || '알 수 없음'}</b> <span class="muted">· ${countryName(m.country)}</span><div class="sub">${m.company || '근무처 미등록'}${m.phone ? ' · ' + m.phone : ''}</div></div>
        <div class="when">${rel(a.created_at)}<div class="num">${fmtDT(a.created_at)}</div></div></li>`;
    })}</ul>` : emptyBox('접수된 SOS가 없습니다', '긴급 요청이 들어오면 이곳과 사이드바에 표시됩니다.', 'shield'));
  } else if (!silent) setHTML(ds, errorBox(sos.reason));

  const dl = $('#dashSilent');
  if (sil.status === 'fulfilled') {
    const all = sil.value.members || [];
    $('#dashSilentN').textContent = `${fmtNum(all.length)}명`;
    setHTML(dl, all.length ? html`<ul class="mini-list">${all.slice(0, 6).map((m) => html`<li class="clickable" data-member="${m.id}">
      <div class="who"><b>${m.name || '-'}</b> <span class="muted">· ${countryName(m.country)}</span><div class="sub">${m.company || '근무처 미등록'}</div></div>
      <div class="when">${m.last_seen_at ? html`<span class="num">${daysSince(m.last_seen_at)}일째</span>` : '접속 기록 없음'}<div>${m.last_seen_at ? fmtDate(m.last_seen_at) : ''}</div></div>
      ${telHref(m.phone) ? html`<a class="btn btn-ghost btn-sm" href="${telHref(m.phone)}" data-stop>${ico('phone', 'sm')}전화</a>` : ''}</li>`)}</ul>`
      : emptyBox('모든 근로자가 최근 3일 안에 접속했습니다', '', 'checkCircle'));
  } else if (!silent) setHTML(dl, errorBox(sil.reason));

  $$('[data-member]', v).forEach((li) => li.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]') || !li.dataset.member) return;
    location.hash = '#/members/' + encodeURIComponent(li.dataset.member);
  }));
  bindRetry(v, () => renderDashboard());
}

/* ───────── 가입 QR 포스터 ───────── */
const QR_LINES = [
  ['English', 'Welcome. Scan the QR code to go to the app, then install it.'],
  ['Tiếng Việt', 'Xin chào. Hãy quét mã QR để vào ứng dụng, sau đó cài đặt.'],
  ['ภาษาไทย', 'ยินดีต้อนรับ สแกน QR เพื่อไปที่แอป แล้วติดตั้งแอป'],
  ['Bahasa Indonesia', 'Selamat datang. Pindai kode QR untuk membuka aplikasi, lalu pasang.'],
  ['Filipino', 'Maligayang pagdating. I-scan ang QR para pumunta sa app, saka i-install ito.'],
  ['नेपाली', 'स्वागत छ। QR स्क्यान गरेर एपमा जानुहोस्, त्यसपछि इन्स्टल गर्नुहोस्।'],
  ['ខ្មែរ', 'សូមស្វាគមន៍។ ស្កេន QR ដើម្បីទៅកម្មវិធី រួចដំឡើងវា។'],
  ['မြန်မာ', 'ကြိုဆိုပါတယ်။ QR ကို စကင်ဖတ်ပြီး အက်ပ်သို့သွားကာ ထည့်သွင်းပါ။'],
  ['සිංහල', 'ආයුබෝවන්. QR එක ස්කෑන් කර යෙදුමට ගොස් එය ස්ථාපනය කරන්න.'],
  ['বাংলা', 'স্বাগতম। QR স্ক্যান করে অ্যাপে যান, তারপর ইনস্টল করুন।'],
];
function renderQr() {
  const url = location.origin + '/?src=qr';
  const v = $('#view');
  setHTML(v, html`<div class="qr-page">
    <div class="qr-tools card">
      <div class="qr-tools-text"><div class="cell-main">가입 안내 포스터</div><div class="cell-sub">QR을 찍으면 근로자 앱 가입 화면이 열립니다. 주소 끝의 <span class="mono">?src=qr</span>로 QR 유입이 구분됩니다.</div></div>
      <div class="qr-tools-btns"><button class="btn btn-secondary" id="qrCopy">${ico('copy', 'sm')}주소 복사</button><button class="btn btn-primary" id="qrPrint">${ico('printer', 'sm')}인쇄</button></div>
    </div>
    <article class="poster" id="poster">
      <header class="poster-head"><span class="brand-mark lg" aria-hidden="true"></span><div><div class="poster-title">HANDS</div><div class="poster-tag">외국인 근로자 생활 안전 앱</div></div></header>
      <div class="poster-lead">어서 오세요.<br>QR을 찍어서 앱으로 이동 후 설치를 해주세요.</div>
      <div class="qr-box"><div id="qrCode" role="img" aria-label="가입 QR 코드"></div></div>
      <div class="poster-url mono">${url}</div>
      <ul class="poster-langs">${QR_LINES.map(([l, t]) => html`<li><span class="pl">${l}</span><span class="pt">${t}</span></li>`)}</ul>
      <ol class="poster-steps">
        <li><b>1</b><div><span>카메라로 QR 찍기</span><small>Scan QR</small></div></li>
        <li class="arrow" aria-hidden="true">${ico('chevron')}</li>
        <li><b>2</b><div><span>홈 화면에 추가</span><small>Add to Home Screen</small></div></li>
        <li class="arrow" aria-hidden="true">${ico('chevron')}</li>
        <li><b>3</b><div><span>가입</span><small>Sign up</small></div></li>
      </ol>
    </article>
  </div>`);
  const box = $('#qrCode');
  if (typeof QRCode === 'undefined') setHTML(box, errorBox({ code: 'network' }));
  else new QRCode(box, { text: url, width: 720, height: 720, colorDark: '#0F172A', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
  $('#qrPrint').addEventListener('click', () => window.print());
  $('#qrCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('주소를 복사했습니다.'); }
    catch (_) {
      const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove();
      toast(ok ? '주소를 복사했습니다.' : '복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요.', ok ? '' : 'err');
    }
  });
}

/* ───────── 2. 근로자 ───────── */
let searchTimer = null;
function renderMembers() {
  const v = $('#view');
  setHTML(v, html`<section class="card">
    <div class="toolbar">
      <label class="search">${ico('search')}<input id="mq" type="search" placeholder="이름·전화번호·여권번호·근무처 검색" value="${S.memberQuery}" autocomplete="off" aria-label="근로자 검색"></label>
      <div class="seg" id="mfilter" role="tablist">
        <button data-f="all">전체 <span class="c" data-c="all"></span></button>
        <button data-f="active">활성 <span class="c" data-c="active"></span></button>
        <button data-f="inactive">비활성 <span class="c" data-c="inactive"></span></button>
      </div>
      <div class="right"><button class="btn btn-ghost btn-sm" id="mreload">${ico('refresh', 'sm')}새로고침</button></div>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>이름</th><th>국적</th><th>근무처</th><th>전화</th><th>가입일</th><th>마지막 접속</th><th>안부 확인</th><th>상태</th></tr></thead>
      <tbody id="mbody">${loadingRows(8)}</tbody>
    </table><div id="mempty"></div></div>
    <div class="card-foot muted" id="mfoot">불러오는 중</div>
  </section>`);
  const input = $('#mq');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.memberQuery = input.value.trim(); loadMembers(); }, 300);
  });
  $$('#mfilter button').forEach((b) => b.addEventListener('click', () => { S.memberFilter = b.dataset.f; drawMembers(); }));
  $('#mreload').addEventListener('click', () => loadMembers());
  loadMembers();
}
let memberReq = 0;
async function loadMembers() {
  const my = ++memberReq;
  try {
    const j = await api('members', { params: S.memberQuery ? { q: S.memberQuery } : {} });
    if (my !== memberReq || S.view !== 'members') return;
    S.members = j.members || [];
    stamp(); drawMembers();
  } catch (e) {
    if (my !== memberReq || S.view !== 'members') return;
    setHTML($('#mbody'), ''); setHTML($('#mempty'), errorBox(e)); bindRetry($('#mempty'), loadMembers);
  }
}
function drawMembers() {
  const all = S.members;
  const counts = { all: all.length, active: all.filter((m) => m.is_active !== false).length };
  counts.inactive = counts.all - counts.active;
  $$('#mfilter button').forEach((b) => b.classList.toggle('on', b.dataset.f === S.memberFilter));
  $$('#mfilter [data-c]').forEach((c) => { c.textContent = fmtNum(counts[c.dataset.c]); });
  const list = all.filter((m) => S.memberFilter === 'all' || (S.memberFilter === 'active' ? m.is_active !== false : m.is_active === false));
  setHTML($('#mbody'), html`${list.map((m) => {
    const sos = m.location && m.location.sos_active;
    return html`<tr class="clickable ${sos ? 'row-danger' : ''} ${S.selectedId === m.id ? 'selected' : ''}" data-id="${m.id}" tabindex="0">
      <td class="card-title" data-label="이름"><div class="cell-main">${m.name || '-'}</div><div class="cell-sub num">여권 ${m.passport_number || '미등록'}</div></td>
      <td data-label="국적">${flag(m.country)}</td>
      <td data-label="근무처"><div class="cell-clip" title="${m.company || ''}">${m.company || html`<span class="muted">미등록</span>`}</div></td>
      <td class="nowrap num" data-label="전화">${m.phone || html`<span class="muted">-</span>`}</td>
      <td class="nowrap num" data-label="가입일">${fmtDate(m.created_at)}</td>
      <td class="nowrap" data-label="마지막 접속">${rel(m.last_seen_at)}</td>
      <td class="nowrap" data-label="안부 확인">${isToday(m.last_checkin_at) ? html`<span class="badge ok">${ico('check', 'xs')}오늘 확인</span>` : rel(m.last_checkin_at, '없음')}</td>
      <td class="nowrap" data-label="상태">${sos ? html`<span class="badge danger"><span class="d"></span>SOS</span> ` : ''}${m.is_active === false ? html`<span class="badge off">비활성</span>` : html`<span class="badge ok"><span class="d"></span>활성</span>`}</td>
    </tr>`;
  })}`);
  setHTML($('#mempty'), list.length ? '' : (S.memberQuery
    ? emptyBox('검색 결과가 없습니다', `"${S.memberQuery}"와 일치하는 근로자가 없습니다.`)
    : emptyBox('표시할 근로자가 없습니다', '', 'users')));
  $('#mfoot').textContent = `${fmtNum(list.length)}명 표시${S.memberQuery ? ` · 검색어 "${S.memberQuery}"` : ''}${all.length >= 500 ? ' · 최대 500명까지 표시됩니다. 검색으로 좁혀 주세요.' : ''}`;
  $$('#mbody tr').forEach((tr) => {
    const go = () => { location.hash = '#/members/' + encodeURIComponent(tr.dataset.id); };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

/* ───────── 근로자 상세 패널 ───────── */
function openPanel(id) {
  if (S.view !== 'members') return;
  S.selectedId = id;
  $$('#mbody tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === id));
  const p = $('#panel');
  $('#panelScrim').hidden = false;
  p.classList.add('open'); p.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  loadDetail(id);
}
function closePanel(silent) {
  const p = $('#panel');
  if (!p.classList.contains('open') && !S.detail) return;
  p.classList.remove('open'); p.setAttribute('aria-hidden', 'true');
  $('#panelScrim').hidden = true;
  document.body.style.overflow = '';
  if (S.miniMap) { S.miniMap.remove(); S.miniMap = null; }
  S.detail = null; S.selectedId = null;
  $$('#mbody tr.selected').forEach((tr) => tr.classList.remove('selected'));
  setTimeout(() => { if (!p.classList.contains('open')) setHTML(p, ''); }, 250);
  if (!silent && /^#\/members\/./.test(location.hash)) history.replaceState(null, '', '#/members');
}
const leavePanel = () => { if (/^#\/members\/./.test(location.hash)) location.hash = '#/members'; else closePanel(); };
$('#panelScrim').addEventListener('click', leavePanel);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.detail && !$('#modalRoot').children.length) leavePanel(); });

let detailReq = 0;
async function loadDetail(id, keepEdit) {
  const my = ++detailReq;
  const p = $('#panel');
  if (!S.detail || S.detail.member.id !== id) {
    setHTML(p, html`<div class="panel-head"><div style="flex:1"><span class="skel" style="width:40%;height:20px"></span><span class="skel" style="width:60%;margin-top:8px"></span></div>
      <button class="icon-btn close" data-close aria-label="닫기">${ico('x')}</button></div>
      <div class="panel-body">${Array.from({ length: 3 }, () => html`<div class="sec"><div class="sec-body"><span class="skel" style="width:70%"></span><span class="skel" style="width:50%;margin-top:12px"></span><span class="skel" style="width:60%;margin-top:12px"></span></div></div>`)}</div>`);
    $('[data-close]', p).addEventListener('click', leavePanel);
  }
  try {
    const j = await api('member', { params: { id } });
    if (my !== detailReq || S.selectedId !== id) return;
    S.detail = { ...j, loadedAt: Date.now(), editing: !!keepEdit };
    drawDetail();
  } catch (e) {
    if (my !== detailReq) return;
    setHTML(p, html`<div class="panel-head"><div class="panel-name">근로자 상세</div><button class="icon-btn close" data-close aria-label="닫기" style="display:inline-grid">${ico('x')}</button></div>${errorBox(e)}`);
    $('[data-close]', p).addEventListener('click', leavePanel);
    bindRetry(p, () => loadDetail(id));
  }
}
function drawDetail() {
  const d = S.detail; const m = d.member; const p = $('#panel');
  const active = m.is_active !== false;
  const pendingSos = (d.sos || []).some((a) => a.status === 'pending');
  const ph = d.photos || {};
  const photo = (url, label) => {
    const u = safeUrl(url);
    return html`<div class="photo"><div class="photo-label">${label}</div>${u
      ? html`<button class="photo-frame" data-zoom="${u}" data-label="${label}" aria-label="${label} 크게 보기"><img src="${u}" alt="${label}" referrerpolicy="no-referrer"><span class="expired" hidden>링크 만료<br>새로고침을 눌러 주세요</span></button>`
      : html`<div class="photo-frame none">${ico('image', 'lg')}<span>등록된 사진 없음</span></div>`}</div>`;
  };
  const c = m.consents || {};
  const hist = d.history || [];
  setHTML(p, html`
    <div class="panel-head">
      <button class="icon-btn back" data-close aria-label="목록으로">${ico('back')}</button>
      <div style="min-width:0;flex:1">
        <div class="panel-name">${m.name || '-'} ${flag(m.country)} ${active ? html`<span class="badge ok"><span class="d"></span>활성</span>` : html`<span class="badge off">비활성</span>`}${pendingSos ? html` <span class="badge danger"><span class="d"></span>SOS 미처리</span>` : ''}</div>
        <div class="panel-meta num">${m.company || '근무처 미등록'} · ${m.phone || '전화 미등록'} · 가입 ${fmtDate(m.created_at)}</div>
      </div>
      <button class="icon-btn close" data-close aria-label="닫기">${ico('x')}</button>
    </div>
    <div class="audit-note">${ico('eye', 'xs')}열람 기록이 남습니다. 업무 목적 외 열람·이용을 금지합니다.</div>
    <div class="panel-actions">
      ${telHref(m.phone) ? html`<a class="btn btn-secondary btn-sm" href="${telHref(m.phone)}">${ico('phone', 'sm')}전화 걸기</a>` : ''}
      <button class="btn btn-secondary btn-sm" data-act="edit" ${d.editing ? 'disabled' : ''}>${ico('edit', 'sm')}정보 수정</button>
      <button class="btn ${active ? 'btn-danger-outline' : 'btn-secondary'} btn-sm" data-act="toggle" style="margin-left:auto">${ico(active ? 'ban' : 'checkCircle', 'sm')}${active ? '비활성화' : '활성화'}</button>
    </div>
    <div class="panel-body">
      <section class="sec">
        <div class="sec-head"><h3>본인 확인 사진</h3><div class="right"><span id="photoLeft" class="num"></span><button class="btn btn-ghost btn-sm" data-act="reload">${ico('refresh', 'sm')}새로고침</button></div></div>
        <div class="sec-body"><div class="photos">${photo(ph.selfie, '얼굴 사진')}${photo(ph.passport, '여권 사진')}</div></div>
      </section>

      <section class="sec">
        <div class="sec-head"><h3>인적 사항</h3></div>
        <div class="sec-body" id="infoBody">${d.editing ? editForm(m) : infoList(m)}</div>
      </section>

      <section class="sec">
        <div class="sec-head"><h3>동의 기록</h3><div class="right">${c.version || m.consent_version ? html`<span>약관 버전 <b class="num">${c.version || m.consent_version}</b></span>` : ''}</div></div>
        <div class="sec-body"><table class="inner"><thead><tr><th>항목</th><th>구분</th><th>상태</th><th>버전</th><th>동의 시각</th></tr></thead><tbody>
          ${CONSENT_ITEMS.map(([k, label, req]) => {
            const on = c[k] === true;
            return html`<tr><td>${label}</td><td class="muted">${req ? '필수' : '선택'}</td>
              <td>${on ? html`<span class="badge ok">${ico('check', 'xs')}동의</span>` : html`<span class="badge off">미동의</span>`}</td>
              <td class="num">${on ? (c.version || m.consent_version || '-') : '-'}</td><td class="num nowrap">${on ? fmtDT(c.at || m.consent_at) : '-'}</td></tr>`;
          })}
        </tbody></table></div>
      </section>

      <section class="sec">
        <div class="sec-head"><h3>위치 기록</h3><div class="right">최근 ${fmtNum(hist.length)}건</div></div>
        <div class="sec-body">${hist.length ? html`<div class="mini-map" id="miniMap"></div>
          <table class="inner"><thead><tr><th>시각</th><th>경로</th><th>좌표</th><th class="right">정확도</th></tr></thead><tbody>
          ${hist.slice(0, 15).map((h) => html`<tr><td class="num nowrap">${fmtDT(h.recorded_at)}</td>
            <td>${h.source === 'sos' ? html`<span class="badge danger">SOS</span>` : html`<span class="badge">${SOURCE[h.source] || h.source || '-'}</span>`}</td>
            <td>${gmaps(h.lat, h.lng) ? html`<a class="ext num" href="${gmaps(h.lat, h.lng)}" target="_blank" rel="noopener noreferrer">${coord(h.lat, h.lng)}${ico('external', 'xs')}</a>` : '-'}</td>
            <td class="num right nowrap">${h.accuracy != null ? `${Math.round(h.accuracy)}m` : '-'}</td></tr>`)}
          </tbody></table>${hist.length > 15 ? html`<div class="muted" style="font-size:12px;margin-top:8px">최근 15건만 표시합니다.</div>` : ''}`
          : emptyBox('위치 기록이 없습니다', '근로자가 앱에서 위치 공유를 허용하면 기록됩니다.', 'pin')}</div>
      </section>

      <section class="sec">
        <div class="sec-head"><h3>SOS 이력</h3><div class="right">${fmtNum((d.sos || []).length)}건</div></div>
        <div class="sec-body">${(d.sos || []).length ? html`<table class="inner"><thead><tr><th>발생 시각</th><th>상태</th><th>위치</th><th>처리</th></tr></thead><tbody>
          ${d.sos.map((a) => html`<tr><td class="num nowrap">${fmtDT(a.created_at)}</td>
            <td>${a.status === 'pending' ? html`<span class="badge danger"><span class="d"></span>미처리</span>` : html`<span class="badge off">처리 완료</span>`}</td>
            <td>${gmaps(a.lat, a.lng) ? html`<a class="ext" href="${gmaps(a.lat, a.lng)}" target="_blank" rel="noopener noreferrer">지도${ico('external', 'xs')}</a>` : html`<span class="muted">위치 없음</span>`}</td>
            <td class="muted">${a.status === 'pending' ? html`<a class="link" href="#/sos">SOS 화면에서 처리</a>` : html`<span class="num">${fmtDT(a.resolved_at)}</span><div>${a.resolved_by || ''}</div>`}</td></tr>`)}
          </tbody></table>` : emptyBox('SOS 이력이 없습니다', '', 'shield')}</div>
      </section>

      <section class="sec">
        <div class="sec-head"><h3>계정 활동</h3></div>
        <div class="sec-body"><dl class="dl">
          <dt>가입일</dt><dd class="num">${fmtDT(m.created_at)}</dd>
          <dt>마지막 로그인</dt><dd class="num">${fmtDT(m.last_login_at)}</dd>
          <dt>마지막 접속</dt><dd class="num">${fmtDT(m.last_seen_at)} ${m.last_seen_at ? html`<span class="muted">(${relText(m.last_seen_at)})</span>` : ''}</dd>
          <dt>마지막 안부 확인</dt><dd class="num">${fmtDT(m.last_checkin_at)}</dd>
          <dt>앱 언어</dt><dd>${LANG[m.language] || m.language || '-'}</dd>
        </dl></div>
      </section>
    </div>`);

  $$('[data-close]', p).forEach((b) => b.addEventListener('click', leavePanel));
  $('[data-act="reload"]', p).addEventListener('click', () => loadDetail(m.id, d.editing));
  $('[data-act="edit"]', p).addEventListener('click', () => { d.editing = true; drawInfo(); $('[data-act="edit"]', p).disabled = true; });
  $('[data-act="toggle"]', p).addEventListener('click', () => toggleActive(m));
  $$('[data-zoom]', p).forEach((b) => b.addEventListener('click', () => { if (!b.classList.contains('is-expired')) lightbox(b.dataset.zoom, b.dataset.label, m.name); }));
  bindInfo();
  tickPhotoExpiry();
  if (hist.length) setTimeout(() => drawMiniMap(hist), 260);
}
function infoList(m) {
  return html`<dl class="dl">
    <dt>이름</dt><dd>${m.name || '-'}</dd>
    <dt>국적</dt><dd>${countryName(m.country)}</dd>
    <dt>생년월일</dt><dd class="num">${m.birth_date || '-'}</dd>
    <dt>성별</dt><dd>${GENDER[m.gender] || m.gender || '-'}</dd>
    <dt>여권번호</dt><dd class="num mono">${m.passport_number || '-'}</dd>
    <dt>전화번호</dt><dd class="num">${m.phone || '-'}</dd>
    <dt>근무처</dt><dd>${m.company || '-'}</dd>
    <dt>비상 연락처</dt><dd>${m.emergency_contact || '-'}</dd>
  </dl>`;
}
function editForm(m) {
  const g = m.gender && !GENDER[m.gender] ? m.gender : null;
  return html`<form id="editForm" class="form-grid" novalidate>
    <label class="field"><span class="field-label">이름</span><input name="name" value="${m.name || ''}" maxlength="120" required></label>
    <label class="field"><span class="field-label">전화번호</span><input name="phone" value="${m.phone || ''}" maxlength="40" inputmode="tel"></label>
    <label class="field"><span class="field-label">생년월일</span><input name="birth_date" type="date" value="${m.birth_date || ''}"></label>
    <label class="field"><span class="field-label">성별</span><select name="gender">
      <option value="">선택 안 함</option>
      <option value="M" ${['M', 'm', 'male'].includes(m.gender) ? 'selected' : ''}>남성</option>
      <option value="F" ${['F', 'f', 'female'].includes(m.gender) ? 'selected' : ''}>여성</option>
      ${g ? html`<option value="${g}" selected>${g}</option>` : ''}
    </select></label>
    <label class="field"><span class="field-label">여권번호</span><input name="passport_number" value="${m.passport_number || ''}" maxlength="40" autocomplete="off" spellcheck="false"></label>
    <label class="field"><span class="field-label">근무처</span><input name="company" value="${m.company || ''}" maxlength="120"></label>
    <label class="field full"><span class="field-label">비상 연락처</span><input name="emergency_contact" value="${m.emergency_contact || ''}" maxlength="120" placeholder="이름 · 관계 · 전화번호"></label>
    <div class="full form-actions" style="margin-top:0"><button type="button" class="btn btn-secondary" data-cancel>취소</button><button type="submit" class="btn btn-primary">${ico('check', 'sm')}저장</button></div>
  </form>`;
}
function drawInfo() { setHTML($('#infoBody'), S.detail.editing ? editForm(S.detail.member) : infoList(S.detail.member)); bindInfo(); }
function bindInfo() {
  const f = $('#editForm'); if (!f) return;
  const m = S.detail.member;
  $('[data-cancel]', f).addEventListener('click', () => { S.detail.editing = false; drawInfo(); const b = $('#panel [data-act="edit"]'); if (b) b.disabled = false; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f); const patch = {};
    for (const [k, v0] of fd.entries()) { const v = String(v0).trim(); if (v !== String(m[k] || '')) patch[k] = v; }
    if ('name' in patch && !patch.name) { toast('이름은 비워 둘 수 없습니다.', 'err'); return; }
    if (!Object.keys(patch).length) { S.detail.editing = false; drawInfo(); $('#panel [data-act="edit"]').disabled = false; return; }
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      await api('update', { body: { id: m.id, ...patch } });
      Object.assign(m, patch);
      S.detail.editing = false;
      toast('근로자 정보를 저장했습니다.');
      drawDetail(); refreshMemberRow(m);
    } catch (err) { toast(errText(err), 'err'); btn.disabled = false; }
  });
}
function refreshMemberRow(m) {
  const row = S.members.find((x) => x.id === m.id);
  if (row) { ['name', 'phone', 'company', 'is_active'].forEach((k) => { if (k in m) row[k] = m[k]; }); if (S.view === 'members') drawMembers(); }
}
function toggleActive(m) {
  const active = m.is_active !== false;
  confirmDialog({
    title: active ? '근로자 계정을 비활성화할까요?' : '근로자 계정을 다시 활성화할까요?',
    danger: active, okLabel: active ? '비활성화' : '활성화',
    details: html`<dl class="kv"><dt>이름</dt><dd>${m.name || '-'}</dd><dt>국적</dt><dd>${countryName(m.country)}</dd><dt>근무처</dt><dd>${m.company || '-'}</dd></dl>`,
    message: active ? '비활성화하면 현황 집계와 미접속 알림에서 제외됩니다. 퇴사·출국 등으로 관리 대상이 아닐 때 사용하세요.' : '다시 현황 집계와 미접속 알림에 포함됩니다.',
    run: async () => {
      await api('update', { body: { id: m.id, is_active: !active } });
      m.is_active = !active;
      toast(active ? '비활성화했습니다.' : '활성화했습니다.');
      drawDetail(); refreshMemberRow(m);
    },
  });
}
function tickPhotoExpiry() {
  const d = S.detail; if (!d) return;
  const el = $('#photoLeft'); if (!el) return;
  const hasPhoto = d.photos && (d.photos.selfie || d.photos.passport);
  if (!hasPhoto) { el.textContent = ''; return; }
  const left = 600000 - (Date.now() - d.loadedAt);
  const expired = left <= 0;
  el.textContent = expired ? '사진 링크 만료됨' : `사진 링크 ${Math.floor(left / 60000)}:${pad(Math.floor((left % 60000) / 1000))} 남음`;
  el.style.color = expired ? 'var(--red)' : '';
  $$('#panel .photo-frame[data-zoom]').forEach((b) => { b.classList.toggle('is-expired', expired); $('.expired', b).hidden = !expired; b.style.cursor = expired ? 'default' : ''; });
}
function lightbox(url, label, name) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  setHTML(el, html`<div class="lightbox-bar"><b>${name || ''}</b><span>${label}</span><button class="icon-btn" aria-label="닫기">${ico('x')}</button></div>
    <div class="lightbox-img"><img src="${url}" alt="${label}" referrerpolicy="no-referrer"></div>`);
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => { if (e.target.tagName !== 'IMG') close(); });
  $('#modalRoot').appendChild(el);
}

/* 지도 공통 */
const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; OpenStreetMap contributors';
const BUSAN = [35.1796, 129.0756];
const markerIcon = (cls) => L.divIcon({ className: '', html: `<div class="mk ${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10] });
function drawMiniMap(hist) {
  const el = $('#miniMap'); if (!el || typeof L === 'undefined') return;
  if (S.miniMap) S.miniMap.remove();
  const pts = hist.filter((h) => h.lat != null && h.lng != null);
  const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  S.miniMap = map;
  L.tileLayer(TILE, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
  if (!pts.length) { map.setView(BUSAN, 11); return; }
  const ll = pts.map((h) => [h.lat, h.lng]);
  L.polyline(ll.slice().reverse(), { color: '#26437A', weight: 2, opacity: 0.5, dashArray: '4 4' }).addTo(map);
  pts.slice().reverse().forEach((h, i, arr) => {
    const latest = i === arr.length - 1;
    const cls = 'hist' + (h.source === 'sos' ? ' sos' : '') + (latest ? ' latest' : '');
    L.marker([h.lat, h.lng], { icon: L.divIcon({ className: '', html: `<div class="mk ${cls}"></div>`, iconSize: latest ? [16, 16] : [12, 12], iconAnchor: latest ? [8, 8] : [6, 6] }), zIndexOffset: latest ? 1000 : 0 })
      .addTo(map).bindTooltip(`${fmtDT(h.recorded_at)} · ${SOURCE[h.source] || esc(h.source || '')}`);
  });
  if (ll.length === 1) map.setView(ll[0], 15); else map.fitBounds(ll, { padding: [24, 24], maxZoom: 16 });
}

/* ───────── 3. 지도 ───────── */
async function renderMap() {
  const v = $('#view');
  setHTML(v, html`<div class="map-layout">
    <div class="map-area"><div id="bigMap"></div>
      <div class="map-legend"><span><i class="lg-dot" style="background:var(--red)"></i>SOS 요청 중</span><span><i class="lg-dot" style="background:var(--teal)"></i>1시간 이내</span><span><i class="lg-dot" style="background:#94A3B8"></i>1시간 이상 경과</span></div>
    </div>
    <aside class="map-side">
      <div class="map-stats"><div><div class="l">위치 공유</div><div class="v" id="msTotal">-</div></div><div><div class="l">1시간 이내</div><div class="v" id="msOn">-</div></div><div><div class="l">SOS</div><div class="v" id="msSos">-</div></div></div>
      <label class="search">${ico('search')}<input id="mapq" type="search" placeholder="이름 검색" autocomplete="off" aria-label="지도 근로자 검색"></label>
      <ul class="map-list" id="mapList"></ul>
    </aside></div>`);
  if (typeof L === 'undefined') { setHTML($('#bigMap'), errorBox({ code: 'network' })); return; }
  const map = L.map('bigMap', { zoomControl: true }).setView(BUSAN, 11);
  S.bigMap = map;
  L.tileLayer(TILE, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
  let locs;
  try { locs = (await api('map')).locations || []; }
  catch (e) { if (S.view === 'map') setHTML($('#mapList'), html`<li style="cursor:default">${errorBox(e)}</li>`); bindRetry($('#mapList'), () => { S.view = null; route(); }); return; }
  if (S.view !== 'map' || S.bigMap !== map) return;
  stamp();
  const now = Date.now();
  const kind = (l) => l.sos_active ? 'sos' : (toDate(l.updated_at) && now - toDate(l.updated_at).getTime() < 3600000 ? 'on' : 'old');
  const order = { sos: 0, on: 1, old: 2 };
  locs = locs.filter((l) => l.lat != null && l.lng != null)
    .sort((a, b) => order[kind(a)] - order[kind(b)] || String(b.updated_at).localeCompare(String(a.updated_at)));
  $('#msTotal').textContent = fmtNum(locs.length);
  $('#msOn').textContent = fmtNum(locs.filter((l) => kind(l) === 'on').length);
  const ns = locs.filter((l) => kind(l) === 'sos').length;
  $('#msSos').textContent = fmtNum(ns); $('#msSos').classList.toggle('red', ns > 0);
  const markers = {};
  locs.forEach((l) => {
    const k = kind(l);
    const pop = html`<div class="pop-name">${l.member_name || '이름 없음'}</div>
      <div class="pop-sub">${countryName(l.member_country)} · ${relText(l.updated_at) || '-'} 갱신${l.accuracy != null ? ` · 오차 ${Math.round(l.accuracy)}m` : ''}${k === 'sos' ? ' · SOS 요청 중' : ''}</div>
      <a class="pop-btn" href="#/members/${encodeURIComponent(l.member_id)}">상세 보기</a>`;
    markers[l.member_id] = L.marker([l.lat, l.lng], { icon: markerIcon(k), zIndexOffset: k === 'sos' ? 1000 : k === 'on' ? 500 : 0 }).addTo(map).bindPopup(pop.s);
  });
  if (locs.length === 1) map.setView([locs[0].lat, locs[0].lng], 14);
  else if (locs.length > 1) map.fitBounds(locs.map((l) => [l.lat, l.lng]), { padding: [48, 48], maxZoom: 15 });
  const drawList = () => {
    const q = $('#mapq').value.trim().toLowerCase();
    const list = locs.filter((l) => !q || String(l.member_name || '').toLowerCase().includes(q));
    setHTML($('#mapList'), list.length ? html`${list.map((l) => html`<li data-id="${l.member_id}"><span class="m-dot ${kind(l)}"></span>
      <div class="who"><b>${l.member_name || '이름 없음'}</b> <span class="muted">· ${countryName(l.member_country)}</span><div class="sub">${kind(l) === 'sos' ? 'SOS 요청 중 · ' : ''}${rel(l.updated_at)}</div></div>${ico('chevron', 'sm')}</li>`)}`
      : html`<li style="cursor:default">${emptyBox(q ? '검색 결과가 없습니다' : '위치를 공유한 근로자가 없습니다', '', 'pin')}</li>`);
    $$('#mapList li[data-id]').forEach((li) => li.addEventListener('click', () => {
      const mk = markers[li.dataset.id]; if (!mk) return;
      map.setView(mk.getLatLng(), Math.max(map.getZoom(), 15)); mk.openPopup();
      if (window.innerWidth <= 1024) $('#bigMap').scrollIntoView({ behavior: 'smooth' });
    }));
  };
  $('#mapq').addEventListener('input', drawList);
  drawList();
  setTimeout(() => map.invalidateSize(), 100);
}

/* ───────── 4. SOS ───────── */
const sortSos = (arr) => arr.slice().sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || String(b.created_at).localeCompare(String(a.created_at)));
let sosCache = null;
async function renderSos(silent) {
  const v = $('#view');
  if (!silent) {
    setHTML(v, html`<section class="card">
      <div class="toolbar">
        <div class="seg" id="sfilter"><button data-f="pending">미처리 <span class="c" data-c="pending"></span></button><button data-f="resolved">처리 완료 <span class="c" data-c="resolved"></span></button><button data-f="all">전체 <span class="c" data-c="all"></span></button></div>
        <div class="right"><span class="muted" style="font-size:12px">30초마다 자동 갱신</span><button class="btn btn-ghost btn-sm" id="sreload">${ico('refresh', 'sm')}새로고침</button></div>
      </div>
      <div class="table-wrap"><table class="data"><thead><tr><th>상태</th><th>근로자</th><th>근무처</th><th>발생 시각</th><th>위치</th><th>텔레그램 알림</th><th>처리</th></tr></thead>
        <tbody id="sbody">${loadingRows(7, 4)}</tbody></table><div id="sempty"></div></div>
    </section>`);
    $$('#sfilter button').forEach((b) => b.addEventListener('click', () => { S.sosFilter = b.dataset.f; drawSos(); }));
    $('#sreload').addEventListener('click', () => renderSos(true));
  }
  try {
    const j = await api('sos');
    if (S.view !== 'sos') return;
    sosCache = j.sos || [];
    stamp(); drawSos();
  } catch (e) {
    if (S.view !== 'sos' || silent) return;
    setHTML($('#sbody'), ''); setHTML($('#sempty'), errorBox(e)); bindRetry($('#sempty'), () => renderSos());
  }
}
function drawSos() {
  if (!sosCache) return;
  const counts = { all: sosCache.length, pending: sosCache.filter((a) => a.status === 'pending').length };
  counts.resolved = counts.all - counts.pending;
  $$('#sfilter button').forEach((b) => b.classList.toggle('on', b.dataset.f === S.sosFilter));
  $$('#sfilter [data-c]').forEach((c) => { c.textContent = fmtNum(counts[c.dataset.c]); });
  const list = sortSos(sosCache).filter((a) => S.sosFilter === 'all' || a.status === S.sosFilter);
  setHTML($('#sbody'), html`${list.map((a) => {
    const m = a.member || {}; const pending = a.status === 'pending';
    const g = gmaps(a.lat, a.lng);
    return html`<tr class="${pending ? 'row-danger' : ''}" data-id="${a.id}">
      <td class="nowrap" data-label="상태">${pending ? html`<span class="badge danger"><span class="d"></span>미처리</span>` : html`<span class="badge off">${ico('check', 'xs')}처리 완료</span>`}</td>
      <td class="card-title" data-label="근로자"><div class="cell-main">${m.id ? html`<a href="#/members/${encodeURIComponent(m.id)}">${m.name || '-'}</a>` : (m.name || '알 수 없음')} <span class="muted" style="font-weight:400">· ${countryName(m.country)}</span></div>
        <div class="cell-sub num">${telHref(m.phone) ? html`<a class="tel" href="${telHref(m.phone)}">${ico('phone', 'xs')}${m.phone}</a>` : '전화 미등록'}</div></td>
      <td data-label="근무처"><div class="cell-clip">${m.company || html`<span class="muted">미등록</span>`}</div></td>
      <td class="nowrap" data-label="발생 시각"><div class="num">${fmtDT(a.created_at)}</div><div class="cell-sub">${relText(a.created_at) || ''}</div></td>
      <td class="nowrap" data-label="위치">${g ? html`<a class="ext" href="${g}" target="_blank" rel="noopener noreferrer">${ico('pin', 'xs')}구글 지도${ico('external', 'xs')}</a>` : html`<span class="muted">위치 없음</span>`}</td>
      <td class="nowrap" data-label="텔레그램 알림">${a.notified_at ? html`<span class="badge ok">${ico('bell', 'xs')}발송됨</span><div class="cell-sub num">${fmtDT(a.notified_at)}</div>` : html`<span class="badge warn">미발송</span>`}</td>
      <td class="card-actions" data-label="처리">${pending ? html`<button class="btn btn-danger btn-sm" data-resolve="${a.id}">${ico('check', 'sm')}처리</button>`
        : html`<div style="font-size:13px"><span class="num">${fmtDT(a.resolved_at)}</span> · ${a.resolved_by || '-'}</div>${a.note ? html`<div class="cell-sub" style="max-width:280px;white-space:normal">${a.note}</div>` : ''}`}</td>
    </tr>`;
  })}`);
  setHTML($('#sempty'), list.length ? '' : emptyBox(S.sosFilter === 'pending' ? '미처리 SOS가 없습니다' : 'SOS 기록이 없습니다', S.sosFilter === 'pending' ? '새 요청이 들어오면 자동으로 표시됩니다.' : '', 'shield'));
  $$('[data-resolve]').forEach((b) => b.addEventListener('click', () => resolveSos(sosCache.find((a) => a.id === b.dataset.resolve))));
}
function resolveSos(a) {
  if (!a) return;
  const m = a.member || {};
  modal({
    title: 'SOS 처리 완료', icon: 'checkCircle', tone: 'teal',
    body: html`<dl class="kv"><dt>근로자</dt><dd>${m.name || '-'} · ${countryName(m.country)}</dd><dt>연락처</dt><dd class="num">${m.phone || '-'}</dd><dt>발생 시각</dt><dd class="num">${fmtDT(a.created_at)}</dd><dt>위치</dt><dd class="num">${coord(a.lat, a.lng) || '위치 없음'}</dd></dl>
      <label class="field"><span class="field-label">처리 내용</span><textarea id="sosNote" maxlength="500" placeholder="예) 본인과 통화하여 안전 확인. 오조작으로 확인됨."></textarea></label>
      <div class="muted" style="font-size:12px;margin-top:8px">처리 내용과 처리자(${S.admin ? S.admin.email : ''})가 기록됩니다.</div>`,
    actions: [{ label: '취소' }, {
      label: '처리 완료', cls: 'btn-primary', run: async (el) => {
        const note = $('#sosNote', el).value.trim();
        if (!note) { toast('처리 내용을 입력해 주세요.', 'err'); $$('button', el).forEach((x) => { x.disabled = false; }); $('#sosNote', el).focus(); return true; }
        await api('sos_resolve', { body: { id: a.id, note } });
        toast('SOS를 처리 완료로 기록했습니다.');
        pollSos();
        if (S.view === 'sos') renderSos(true);
      },
    }],
  });
}

/* ───────── 5. 미접속 ───────── */
async function renderSilent() {
  const v = $('#view');
  setHTML(v, html`<section class="card">
    <div class="toolbar">
      <span class="muted" style="font-size:13px">기준</span>
      <div class="seg" id="dsel">${[1, 3, 7].map((d) => html`<button data-d="${d}" class="${S.silentDays === d ? 'on' : ''}">${d}일 이상</button>`)}</div>
      <div class="right"><span class="muted" id="silentN" style="font-size:13px"></span></div>
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th>이름</th><th>국적</th><th>근무처</th><th>마지막 접속</th><th>경과</th><th>마지막 안부 확인</th><th class="right">연락</th></tr></thead>
      <tbody id="lbody">${loadingRows(7)}</tbody></table><div id="lempty"></div></div>
  </section>`);
  $$('#dsel button').forEach((b) => b.addEventListener('click', () => { S.silentDays = +b.dataset.d; renderSilent(); }));
  try {
    const j = await api('silent', { params: { days: S.silentDays } });
    if (S.view !== 'silent') return;
    stamp();
    const list = j.members || [];
    $('#silentN').textContent = `${fmtNum(list.length)}명`;
    setHTML($('#lbody'), html`${list.map((m) => {
      const ds = daysSince(m.last_seen_at);
      return html`<tr class="clickable" data-id="${m.id}">
        <td class="card-title" data-label="이름"><div class="cell-main">${m.name || '-'}</div><div class="cell-sub num">${m.phone || '전화 미등록'}</div></td>
        <td data-label="국적">${flag(m.country)}</td>
        <td data-label="근무처"><div class="cell-clip">${m.company || html`<span class="muted">미등록</span>`}</div></td>
        <td class="nowrap num" data-label="마지막 접속">${m.last_seen_at ? fmtDT(m.last_seen_at) : html`<span class="muted">접속 기록 없음</span>`}</td>
        <td class="nowrap" data-label="경과">${ds == null ? html`<span class="badge warn">기록 없음</span>` : html`<span class="badge ${ds >= 7 ? 'danger' : 'warn'} num">${ds}일째</span>`}</td>
        <td class="nowrap" data-label="마지막 안부 확인">${rel(m.last_checkin_at, '없음')}</td>
        <td class="card-actions right" data-label="연락">${telHref(m.phone) ? html`<a class="btn btn-secondary btn-sm" href="${telHref(m.phone)}" data-stop>${ico('phone', 'sm')}전화 걸기</a>` : html`<span class="muted">전화 미등록</span>`}</td>
      </tr>`;
    })}`);
    setHTML($('#lempty'), list.length ? '' : emptyBox(`${S.silentDays}일 이상 미접속한 근로자가 없습니다`, '', 'checkCircle'));
    $$('#lbody tr').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('[data-stop]')) location.hash = '#/members/' + encodeURIComponent(tr.dataset.id); }));
  } catch (e) {
    if (S.view !== 'silent') return;
    setHTML($('#lbody'), ''); setHTML($('#lempty'), errorBox(e)); bindRetry($('#lempty'), renderSilent);
  }
}

/* ───────── 6. 게시판 ───────── */
async function renderPosts() {
  const v = $('#view');
  setHTML(v, html`<section class="card">
    <div class="card-head"><h2>게시글</h2><span class="count" id="pcount"></span><div class="right"><span class="muted" style="font-size:12px">제목을 누르면 본문 전체가 펼쳐집니다</span></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>분류</th><th>제목·내용</th><th>작성자</th><th>작성일</th><th class="right">관리</th></tr></thead>
      <tbody id="pbody">${loadingRows(5)}</tbody></table><div id="pempty"></div></div>
  </section>`);
  try {
    const j = await api('posts');
    if (S.view !== 'posts') return;
    stamp();
    const list = j.posts || [];
    $('#pcount').textContent = `${fmtNum(list.length)}건`;
    setHTML($('#pbody'), html`${list.map((p) => {
      const a = p.author || {};
      return html`<tr data-id="${p.id}">
        <td class="nowrap" data-label="분류"><span class="badge navy">${CATEGORY[p.category] || p.category || '기타'}</span></td>
        <td class="card-block" data-label="제목·내용" style="cursor:pointer" data-toggle><div class="cell-main">${p.title || '(제목 없음)'}</div><div class="post-body">${p.body || ''}</div></td>
        <td class="nowrap" data-label="작성자"><span>${a.id ? html`<a href="#/members/${encodeURIComponent(a.id)}">${a.name || '-'}</a>` : (a.name || html`<span class="muted">탈퇴 회원</span>`)}${a.country ? html` <span class="muted">· ${countryName(a.country)}</span>` : ''}</span></td>
        <td class="nowrap" data-label="작성일"><span class="num">${fmtDT(p.created_at)}</span></td>
        <td class="card-actions right" data-label="관리"><button class="btn btn-danger-outline btn-sm" data-del="${p.id}">${ico('trash', 'sm')}삭제</button></td>
      </tr>`;
    })}`);
    setHTML($('#pempty'), list.length ? '' : emptyBox('게시글이 없습니다', '', 'message'));
    $$('[data-toggle]').forEach((td) => td.addEventListener('click', () => td.closest('tr').classList.toggle('expanded')));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const p = list.find((x) => x.id === b.dataset.del); if (!p) return;
      confirmDialog({
        title: '게시글을 삭제할까요?', danger: true, okLabel: '삭제',
        details: html`<dl class="kv"><dt>제목</dt><dd>${p.title || '(제목 없음)'}</dd><dt>작성자</dt><dd>${(p.author && p.author.name) || '-'}</dd><dt>작성일</dt><dd class="num">${fmtDT(p.created_at)}</dd></dl>`,
        message: '삭제한 게시글은 되돌릴 수 없으며, 삭제 기록이 열람 기록에 남습니다.',
        run: async () => { await api('post_delete', { body: { id: p.id } }); toast('게시글을 삭제했습니다.'); renderPosts(); },
      });
    }));
  } catch (e) {
    if (S.view !== 'posts') return;
    setHTML($('#pbody'), ''); setHTML($('#pempty'), errorBox(e)); bindRetry($('#pempty'), renderPosts);
  }
}

/* ───────── 7. 열람 기록 ───────── */
let logsCache = [];
async function renderLogs() {
  const v = $('#view');
  setHTML(v, html`<section class="card">
    <div class="toolbar">
      <select class="select" id="lact" aria-label="작업 종류">
        <option value="all">모든 작업</option>${Object.entries(ACTION).map(([k, [l]]) => html`<option value="${k}" ${S.logAction === k ? 'selected' : ''}>${l}</option>`)}
      </select>
      <div class="right"><span class="muted" id="logN" style="font-size:13px"></span><button class="btn btn-ghost btn-sm" id="lreload">${ico('refresh', 'sm')}새로고침</button></div>
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th>시각</th><th>관리자</th><th>작업</th><th>대상 근로자</th></tr></thead>
      <tbody id="gbody">${loadingRows(4, 8)}</tbody></table><div id="gempty"></div></div>
    <div class="card-foot muted">최근 200건을 표시합니다. 기록은 서버에서 자동으로 남으며 수정·삭제할 수 없습니다.</div>
  </section>`);
  $('#lact').addEventListener('change', (e) => { S.logAction = e.target.value; drawLogs(); });
  $('#lreload').addEventListener('click', renderLogs);
  try {
    const j = await api('logs');
    if (S.view !== 'logs') return;
    logsCache = j.logs || []; stamp(); drawLogs();
  } catch (e) {
    if (S.view !== 'logs') return;
    setHTML($('#gbody'), ''); setHTML($('#gempty'), errorBox(e)); bindRetry($('#gempty'), renderLogs);
  }
}
function drawLogs() {
  const list = logsCache.filter((l) => S.logAction === 'all' || l.action === S.logAction);
  $('#logN').textContent = `${fmtNum(list.length)}건`;
  setHTML($('#gbody'), html`${list.map((l) => {
    const [label, tone] = ACTION[l.action] || [l.action || '-', ''];
    return html`<tr>
      <td class="nowrap card-title" data-label="시각"><span class="num cell-main">${fmtDT(l.created_at)}</span> <span class="muted" style="font-size:12px">${relText(l.created_at) || ''}</span></td>
      <td data-label="관리자"><div class="cell-clip">${l.admin_email || '-'}</div></td>
      <td class="nowrap" data-label="작업"><span class="badge ${tone}">${label}</span></td>
      <td data-label="대상 근로자">${l.member && l.member.name ? l.member.name : html`<span class="muted">-</span>`}</td>
    </tr>`;
  })}`);
  setHTML($('#gempty'), list.length ? '' : emptyBox('기록이 없습니다', '', 'file'));
}

/* ───────── 셸 이벤트 ───────── */
$('#btnMenu').addEventListener('click', () => $('#app').classList.add('drawer'));
$('#btnDrawerClose').addEventListener('click', () => $('#app').classList.remove('drawer'));
$('#scrim').addEventListener('click', () => $('#app').classList.remove('drawer'));
$$('#nav a').forEach((a) => a.addEventListener('click', () => {
  $('#app').classList.remove('drawer');
  if (a.getAttribute('href') === location.hash && a.dataset.view !== 'members') { S.view = null; route(); }
}));
$('#btnLogout').addEventListener('click', () => confirmDialog({
  title: '로그아웃할까요?', okLabel: '로그아웃', message: '로그아웃하면 다시 아이디와 비밀번호를 입력해야 합니다.',
  run: () => logout(),
}));
window.addEventListener('resize', () => { if (S.bigMap) S.bigMap.invalidateSize(); if (S.miniMap) S.miniMap.invalidateSize(); });

/* ───────── 시작 ───────── */
hydrateIcons();
(async () => {
  try {
    const j = await api('me');
    enterApp(j.admin || { email: '', name: '관리자' });
  } catch (_) { showLogin(); }
})();
})();
