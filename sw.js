// 설치(홈 화면 추가)용 최소 서비스워커 — 캐시하지 않고 그대로 통과(항상 최신 화면·서버)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
