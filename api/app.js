// 관리자 화면 코드 금고 — 로그인한 관리자·매니저에게만 내려 줌 (사장님 10-31: 밖에서 짜임을 못 베끼게)
//   원본은 api/_admin_app.txt (api 폴더 안 · 밑줄로 시작 → 주소로 못 엶). 화면 쪽은 admin-boot.js 가 로그인 뒤 /api/app 을 붙임.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./_lib');

const SRC = fs.readFileSync(path.join(__dirname, '_admin_app.txt'), 'utf8');
const TAG = '"' + crypto.createHash('sha1').update(SRC).digest('hex').slice(0, 20) + '"';

module.exports = async (req, res) => {
  try {
    await L.adminFromReq(req);
  } catch (_) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).end('');
    return;
  }
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', TAG);
  if (req.headers['if-none-match'] === TAG) { res.status(304).end(); return; }
  res.status(200).end(SRC);
};
