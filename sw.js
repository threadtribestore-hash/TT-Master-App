// Offline support for Thread Tribe Studio.
// Bump VERSION whenever index.html changes so phones pick up the new build.
const VERSION = 'tt-studio-202610191400';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './brand/tt-logomark.svg', './brand/tt-lockup.svg', './config.js', './buyers-admin.js?v=26', './partner-planning.js?v=4', './control-room.js?v=13', './projects.js?v=11', './print-files.js?v=1', './sales-admin.js?v=13', './shop-admin.js?v=2', './owner-home.js?v=6', './daily-tasks.js?v=1', './sidebar.js?v=2', './notify-admin.js?v=1', './notify-app.js?v=1', './print-matching.js?v=1', './payment-ladder.js?v=2', './design-research.js?v=2', './automations.js?v=7', './app-shell.js?v=3', './ui-polish.js?v=13', './upsell.js?v=1', './marketing-admin.js?v=5', './finance-admin.js?v=1', './tasks-admin.js?v=1', './product-lab.js?v=1', './support-admin.js?v=4', './ops-planning.js?v=2', './shipturtle-admin.js?v=1', './vendor/supabase.js', './vendor/qrcode.js', './vendor/jsQR.js'];
const THIRD_PARTY = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(VERSION).then(function(c){ return c.addAll(SHELL.map(function(u){ return new Request(u, { cache: 'reload' }); })); }).then(function(){ return self.skipWaiting(); }));
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


  // Settings file and the Buyer app module: always try the network so edits arrive straight away.
  if(url.origin === location.origin && /\/(config|buyers-admin|control-room|partner-planning|projects|sales-admin|shop-admin|owner-home|automations|app-shell|ui-polish|upsell|marketing-admin|finance-admin|tasks-admin|product-lab|support-admin|ops-planning|shipturtle-admin|print-files|daily-tasks|sidebar)\.js$/.test(url.pathname)){
    // no-cache: revalidate with GitHub Pages instead of using the browser's 10-minute copy.
    e.respondWith(fetch(req.url, { cache: 'no-cache' }).then(function(res){ return putInCache(req, res); }).catch(function(){ return caches.match(req); }));
    return;
  }

  // The app page itself: try the network first so updates arrive, fall back to the cached copy offline.
  if(req.mode === 'navigate' && url.origin === location.origin){
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function(res){
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

// ---- phone alerts (notifications, send-push) ----
self.addEventListener('push', function(e){
  var d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(x){ d = { title: 'Thread Tribe', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Thread Tribe', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.id || undefined,
    data: { url: d.url || self.registration.scope }
  }));
});
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
    for(var i = 0; i < list.length; i++){
      var c = list[i];
      if(c.url.indexOf(self.registration.scope) === 0 && 'focus' in c){
        if(url.indexOf(self.registration.scope) === 0 && url !== c.url && 'navigate' in c) c.navigate(url);
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
