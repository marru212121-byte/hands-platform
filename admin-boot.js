/* 위해연교 관리자 — 로그인 창만. 화면 코드는 로그인 뒤 서버(/api/app)에서 받음 */
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const MSG = {
  wrong_login: '아이디 또는 비밀번호가 올바르지 않습니다.',
  too_many: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  network: '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.',
  server_error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  load_fail: '화면을 불러오지 못했습니다. 다시 로그인해 주세요.',
};
const form = $('#loginForm');
let loading = false;

function showLogin(notice) {
  $('#boot').hidden = true; $('#app').hidden = true; $('#login').hidden = false;
  const n = $('#loginNotice'); n.hidden = !notice; n.textContent = notice || '';
  $('#loginPw').value = '';
  document.title = '위해연교 로그인';
  setTimeout(() => ($('#loginId').value ? $('#loginPw') : $('#loginId')).focus(), 0);
}
function loadApp() {
  if (loading) return;
  loading = true;
  form.removeEventListener('submit', onSubmit);   // 이제부터 로그인은 관리자 화면 코드가 맡음
  const s = document.createElement('script');
  s.src = '/api/app';
  s.onerror = () => { loading = false; form.addEventListener('submit', onSubmit); showLogin(MSG.load_fail); };
  document.body.appendChild(s);
}
async function onSubmit(e) {
  e.preventDefault();
  const id = $('#loginId').value.trim(), password = $('#loginPw').value;
  const errEl = $('#loginError');
  if (!id || !password) { errEl.textContent = '아이디와 비밀번호를 입력해 주세요.'; errEl.hidden = false; return; }
  const btn = $('#btnLogin'); btn.disabled = true; btn.textContent = '확인 중';
  try {
    let r;
    try {
      r = await fetch('/api/a?action=login', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password }),
      });
    } catch (_) { throw new Error('network'); }
    let j = null; try { j = await r.json(); } catch (_) { /* 본문 없음 */ }
    if (!r.ok || !j || j.ok === false) throw new Error(r.status === 401 ? 'wrong_login' : ((j && j.error) || 'server_error'));
    errEl.hidden = true;
    loadApp();
  } catch (err) {
    errEl.textContent = MSG[err.message] || MSG.server_error;
    errEl.hidden = false;
    $('#loginPw').select();
  } finally { btn.disabled = false; btn.textContent = '로그인'; }
}
form.addEventListener('submit', onSubmit);

fetch('/api/a?action=me', { credentials: 'same-origin', cache: 'no-store' })
  .then((r) => (r.ok ? loadApp() : showLogin()))
  .catch(() => showLogin());
})();
