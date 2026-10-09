// The Partner app lives at https://threadtribestore-hash.github.io/TT-Partner-App/.
// This worker replaces the old copy at /TT-Master-App/partner/: it clears that copy's
// offline cache and unregisters itself, so phones stop serving the outdated app here.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('tt-partner-') === 0; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.registration.unregister(); }).then(function(){
    return self.clients.matchAll({ type: 'window' });
  }).then(function(clients){ clients.forEach(function(c){ c.navigate(c.url); }); }));
});
