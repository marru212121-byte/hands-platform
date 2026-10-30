// 로컬 시험용(배포 안 됨): 정적 파일 + /api/{w,a} 를 버셀처럼 돌림. node dev-server.js
const http = require('http'), fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) process.env[m[1]] = m[2];
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const api = /^\/api\/(w|a|app)$/.exec(u.pathname);
  if (api) {
    req.query = Object.fromEntries(u.searchParams);
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    delete require.cache[require.resolve(`./api/${api[1]}.js`)]; delete require.cache[require.resolve('./api/_lib.js')];
    return require(`./api/${api[1]}.js`)(req, res);
  }
  let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
  const f = path.join(__dirname, p);
  if (!f.startsWith(__dirname) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 4321, () => console.log('HANDS dev on http://localhost:' + (process.env.PORT || 4321)));
