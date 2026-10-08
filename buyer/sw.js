// The Buyer app moved to https://threadtribestore-hash.github.io/TT-Buyer-App/.
// This worker replaces the old one at /TT-Master-App/buyer/: it clears the old
// offline copy and unregisters itself, so phones stop serving the old app here.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('tt-buyer-') === 0; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.registration.unregister(); }).then(function(){
    return self.clients.matchAll({ type: 'window' });
  }).then(function(clients){ clients.forEach(function(c){ c.navigate(c.url); }); }));
});
