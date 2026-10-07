// Offline support for Thread Tribe Studio.
// Bump VERSION whenever index.html changes so phones pick up the new build.
const VERSION = 'tt-studio-202610072002';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './config.js', './vendor/supabase.js', './vendor/qrcode.js', './vendor/jsQR.js'];
const THIRD_PARTY = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(VERSION).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('tt-studio-') === 0 && k !== VERSION; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

function putInCache(req, res){
  if(res && (res.ok || res.type === 'opaque')){
    const copy = res.clone();
    caches.open(VERSION).then(function(c){ c.put(req, copy); });
  }
  return res;
}

self.addEventListener('fetch', function(e){
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);


  // Settings file: always try the network so edits to config.js arrive straight away.
  if(url.origin === location.origin && /\/config\.js$/.test(url.pathname)){
    e.respondWith(fetch(req).then(function(res){ return putInCache(req, res); }).catch(function(){ return caches.match(req); }));
    return;
  }

  // The app page itself: try the network first so updates arrive, fall back to the cached copy offline.
  if(req.mode === 'navigate' && url.origin === location.origin){
    e.respondWith(fetch(req).then(function(res){
      if(res.ok){ const copy = res.clone(); caches.open(VERSION).then(function(c){ c.put('./index.html', copy); }); }
      return res;
    }).catch(function(){ return caches.match('./index.html'); }));
    return;
  }

  // Icons, manifest, fonts and the Excel library: cache first.
  if(url.origin === location.origin || THIRD_PARTY.indexOf(url.hostname) !== -1){
    e.respondWith(caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){ return putInCache(req, res); });
    }));
  }
});
