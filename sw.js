/**
 * Service Worker GeoUkur GPS.
 * - Cangkang aplikasi (HTML/CSS/JS/Leaflet/sql.js) di-cache saat instal → aplikasi tetap
 *   terbuka tanpa sinyal.
 * - Ubin peta online di-cache saat lewat (stale-while-revalidate) sebagai pelengkap MBTiles.
 * - Panggilan API (POST) tidak pernah di-cache; itu urusan antrean offline di dalam aplikasi.
 */
const VERSI = 'geoukur-v3.1.0';
const CANGKANG = VERSI + '-cangkang';
const UBIN = VERSI + '-ubin';
const MAKS_UBIN = 600;

const ASET = [
  './',
  './index.html',            // CSS + JS sudah tertanam di dalamnya
  './manifest.webmanifest',
  './icons/ikon-192.png',
  './icons/ikon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CANGKANG)
      // addAll gagal total kalau satu URL meleset; pakai per-item supaya tetap terpasang.
      .then((c) => Promise.all(ASET.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((n) => !n.startsWith(VERSI)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function ubinPeta(url) {
  return /tile\.openstreetmap\.org|tile\.opentopomap\.org|server\.arcgisonline\.com/.test(url);
}

async function pangkasCache(nama, maks) {
  const c = await caches.open(nama);
  const kunci = await c.keys();
  if (kunci.length > maks) {
    for (const k of kunci.slice(0, kunci.length - maks)) await c.delete(k);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // API lewat POST — biarkan lewat apa adanya

  if (ubinPeta(req.url)) {
    e.respondWith(
      caches.open(UBIN).then((c) =>
        c.match(req).then((hit) => {
          const jaringan = fetch(req)
            .then((res) => { c.put(req, res.clone()); pangkasCache(UBIN, MAKS_UBIN); return res; })
            .catch(() => hit);
          return hit || jaringan;
        })
      )
    );
    return;
  }

  // HALAMAN (navigasi): JARINGAN DULU, cache hanya sebagai cadangan saat offline.
  //
  // Sebelumnya halaman disajikan cache-first. Akibatnya, begitu index.html versi baru
  // diunggah ke GitHub, pengguna TETAP melihat versi lama — kadang selamanya, karena
  // cache tidak pernah punya alasan untuk melepasnya. Untuk aplikasi lapangan, jeda
  // beberapa ratus milidetik jauh lebih murah daripada surveyor memakai versi usang.
  if (req.mode === 'navigate' || (req.destination === 'document')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const salinan = res.clone();
          caches.open(CANGKANG).then((c) => c.put('./index.html', salinan));
          return res;
        })
        .catch(() => caches.match('./index.html'))   // offline: pakai simpanan terakhir
    );
    return;
  }

  // Aset lain (ikon, Leaflet, sql.js): cache dulu — isinya memang tidak berubah-ubah.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).catch(() => caches.match('./index.html')))
  );
});
