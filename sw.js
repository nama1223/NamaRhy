/* NamaRhy Service Worker
   - オフライン起動：アプリ一式をプリキャッシュ
   - オンライン：ドキュメントは stale-while-revalidate。サーバ上の方が新しければ
     キャッシュを更新し、クライアントへ通知して自動リロード
   ※資産(フォント/アイコン)を差し替えたら CACHE の版数を上げてください */
const CACHE = 'namarhy-v1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'Bravura.woff2',
  'NamaRhy192.png', 'NamaRhy512.png', 'NamaRhy1024.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 変更検出用の署名（ETag → Last-Modified → Content-Length）
function sig(res) {
  if (!res) return null;
  const h = res.headers;
  return h.get('etag') || h.get('last-modified') || h.get('content-length') || null;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isDoc = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    if (isDoc) {
      // キャッシュ即返し＋裏で最新を取得（HTTPキャッシュを介さず確実に比較）
      const revalidate = fetch(req, { cache: 'no-store' }).then(async res => {
        if (res && res.ok && res.type === 'basic') {
          const changed = cached && sig(cached) && sig(res) && sig(cached) !== sig(res);
          await cache.put(req, res.clone());
          if (changed) {
            const cs = await self.clients.matchAll({ type: 'window' });
            cs.forEach(c => c.postMessage({ type: 'NR_UPDATE' }));
          }
        }
        return res;
      }).catch(() => null);

      if (cached) { e.waitUntil(revalidate); return cached; }
      return (await revalidate) || (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
    }

    // 資産：キャッシュ優先（無ければ取得して保存）
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});

self.addEventListener('message', e => { if (e.data === 'NR_SKIP') self.skipWaiting(); });
