// ===================================================================
// ===================== NOTIFICATIONS: bell + inbox =================
// ===================================================================
// The same file in every Thread Tribe app (Studio, Partner, Sales, Buyer). It adds a bell
// with an unread count to the top bar, an inbox panel, and "Phone alerts" (Web Push).
// Each app tells it who it is before this loads:
//   window.TT_NOTIFY = { app: 'partner', mount: '#top' }
//   window.TTApp = { sb: function(){ return <supabase client> }, email: function(){ return <signed-in email> } }
// Messages come from public.notifications (notify_setup.sql); phone alerts are delivered
// by the send-push Edge Function. On iPhone, alerts work once the app is on the Home Screen.
(function(){
  var CFG = window.TT_NOTIFY || {};
  var APP = CFG.app;
  if(!APP || window.__ttNotifyLoaded) return;
  window.__ttNotifyLoaded = true;
  var N = { list: [], open: false, chan: null, who: '', busy: false, push: 'off', msg: '' };

  function sb(){ try{ return window.TTApp && window.TTApp.sb(); }catch(e){ return null; } }
  function me(){ try{ return String((window.TTApp && window.TTApp.email()) || '').toLowerCase(); }catch(e){ return ''; } }
  function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML.replace(/"/g, '&quot;'); }
  function ago(ts){
    var m = Math.round((Date.now() - Date.parse(ts)) / 60000);
    if(!isFinite(m)) return '';
    if(m < 1) return 'just now'; if(m < 60) return m + ' min ago'; if(m < 1440) return Math.round(m / 60) + ' h ago';
    var d = new Date(ts); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function unread(){ return N.list.filter(function(n){ return !n.read_at; }).length; }

  // ---------- data ----------
  async function load(){
    var c = sb(), who = me();
    if(!c || !who) return;
    var r = await c.from('notifications').select('id,title,body,url,kind,created_at,read_at').eq('app', APP).eq('recipient', who).order('created_at', { ascending: false }).limit(50);
    if(r.error){ if(/notifications|does not exist|schema cache|relation/i.test(r.error.message || '')) hideBell(); return; }
    N.list = r.data || [];
    paint();
  }
  function listen(){
    var c = sb(), who = me();
    if(!c || !who || N.chan) return;
    try{
      N.chan = c.channel('tt-notify-' + Math.random().toString(36).slice(2, 8))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'recipient=eq.' + who }, function(p){
          var n = p && p.new; if(!n || n.app !== APP) return;
          if(!N.list.some(function(x){ return x.id === n.id; })) N.list.unshift(n);
          paint(); ring();
        }).subscribe();
    }catch(e){}
  }
  async function markRead(ids){
    var c = sb(); if(!c || !ids.length) return;
    var now = new Date().toISOString();
    N.list.forEach(function(n){ if(ids.indexOf(n.id) !== -1 && !n.read_at) n.read_at = now; });
    paint();
    await c.from('notifications').update({ read_at: now }).in('id', ids).is('read_at', null);
  }

  // ---------- phone alerts ----------
  function pushSupported(){ return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function isIOS(){ return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function installed(){ return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
  function b64ToBytes(b64){
    var pad = '='.repeat((4 - b64.length % 4) % 4), s = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(s.length); for(var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out;
  }
  async function pushState(){
    if(!pushSupported()) N.push = isIOS() && !installed() ? 'ios-install' : 'unsupported';
    else if(Notification.permission === 'denied') N.push = 'blocked';
    else{
      try{ var reg = await navigator.serviceWorker.getRegistration(); var sub = reg && await reg.pushManager.getSubscription(); N.push = sub ? 'on' : 'off'; }
      catch(e){ N.push = 'off'; }
    }
    paint();
  }
  async function enablePush(){
    N.msg = '';
    var c = sb(); if(!c) return;
    try{
      var perm = await Notification.requestPermission();
      if(perm !== 'granted'){ N.msg = perm === 'denied' ? 'Alerts are blocked for this app. Allow notifications in your phone or browser settings.' : 'Alerts were not allowed.'; await pushState(); return; }
      var res = await c.functions.invoke('send-push', { method: 'GET' });
      var key = res && res.data && res.data.publicKey;
      if(!key) throw new Error((res && res.error && res.error.message) || 'Phone alerts aren’t switched on yet');
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if(sub && sub.options && sub.options.applicationServerKey){
        var had = new Uint8Array(sub.options.applicationServerKey), want = b64ToBytes(key);
        if(had.length !== want.length || had.some(function(v, i){ return v !== want[i]; })){ await sub.unsubscribe(); sub = null; }
      }
      if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      var j = sub.toJSON();
      var r = await c.rpc('register_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_app: APP, p_ua: navigator.userAgent.slice(0, 200) });
      if(r.error) throw r.error;
      N.msg = 'Phone alerts are on for this device.';
    }catch(e){ N.msg = 'Couldn’t turn on alerts: ' + String((e && e.message) || e).slice(0, 140); }
    await pushState();
  }
  async function disablePush(){
    try{
      var reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription();
      if(sub){ var c = sb(); if(c) await c.rpc('unregister_push', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
      N.msg = 'Phone alerts are off for this device.';
    }catch(e){ N.msg = 'Couldn’t turn off alerts.'; }
    await pushState();
  }

  // ---------- UI ----------
  var bell = null, panel = null;
  function hideBell(){ if(bell) bell.style.display = 'none'; }
  function ring(){ if(!bell) return; bell.classList.remove('ttn-ring'); void bell.offsetWidth; bell.classList.add('ttn-ring'); }
  function mount(){
    if(bell && document.body.contains(bell)) return;
    var host = document.querySelector(CFG.mount || '#top');
    if(host && host.tagName === 'BUTTON') host = host.parentNode;   // mount next to a button
    if(!host) return;
    bell = document.createElement('button');
    bell.type = 'button'; bell.className = 'ttn-bell'; bell.title = 'Notifications'; bell.setAttribute('aria-label', 'Notifications');
    bell.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span class="ttn-badge"></span>';
    bell.addEventListener('click', function(e){ e.stopPropagation(); toggle(); });
    host.appendChild(bell);
    paint();
  }
  function toggle(force){
    N.open = force == null ? !N.open : force;
    if(N.open){ pushState(); load(); }
    paint();
  }
  function pushRow(){
    var t = {
      on: ['🔔 Phone alerts are on', '<button class="ttn-btn" data-ttn="push-off">Turn off</button>'],
      off: ['🔕 Phone alerts are off', '<button class="ttn-btn ttn-primary" data-ttn="push-on">Turn on</button>'],
      blocked: ['🚫 Alerts are blocked', '<span class="ttn-dim">Allow notifications for this app in your settings</span>'],
      'ios-install': ['📱 On iPhone, add this app to your Home Screen first', '<span class="ttn-dim">Share → Add to Home Screen, then open it from there</span>'],
      unsupported: ['This browser can’t show phone alerts', '<span class="ttn-dim">Messages still arrive here</span>']
    }[N.push] || ['', ''];
    return '<div class="ttn-push"><span>' + t[0] + '</span>' + t[1] + '</div>' + (N.msg ? '<div class="ttn-msg">' + esc(N.msg) + '</div>' : '');
  }
  function paint(){
    if(bell){
      var u = unread(), b = bell.querySelector('.ttn-badge');
      b.textContent = u > 9 ? '9+' : u; b.style.display = u ? '' : 'none';
      bell.classList.toggle('on', N.open);
    }
    if(!N.open){ if(panel) panel.style.display = 'none'; return; }
    if(!panel){
      panel = document.createElement('div'); panel.className = 'ttn-panel';
      document.body.appendChild(panel);
      panel.addEventListener('click', onPanelClick);
      document.addEventListener('click', function(e){ if(N.open && panel && !panel.contains(e.target) && bell && !bell.contains(e.target)) toggle(false); });
    }
    panel.style.display = '';
    panel.innerHTML = '<div class="ttn-h"><b>Notifications</b>' + (unread() ? '<button class="ttn-link" data-ttn="all-read">Mark all read</button>' : '') + '<button class="ttn-x" data-ttn="close" aria-label="Close">✕</button></div>' +
      pushRow() +
      '<div class="ttn-list">' + (N.list.length ? N.list.map(function(n){
        return '<div class="ttn-item' + (n.read_at ? '' : ' ttn-new') + '" data-ttn="open" data-id="' + esc(n.id) + '"><div class="ttn-t">' + esc(n.title) + '</div>' +
          (n.body ? '<div class="ttn-b">' + esc(n.body) + '</div>' : '') + '<div class="ttn-dim">' + esc(ago(n.created_at)) + (n.url ? ' · tap to open' : '') + '</div></div>';
      }).join('') : '<div class="ttn-empty">No notifications yet.</div>') + '</div>';
  }
  function onPanelClick(e){
    var b = e.target.closest('[data-ttn]'); if(!b) return;
    var a = b.getAttribute('data-ttn');
    if(a === 'close') toggle(false);
    else if(a === 'all-read') markRead(N.list.filter(function(n){ return !n.read_at; }).map(function(n){ return n.id; }));
    else if(a === 'push-on') enablePush();
    else if(a === 'push-off') disablePush();
    else if(a === 'open'){
      var n = N.list.find(function(x){ return x.id === b.getAttribute('data-id'); }); if(!n) return;
      markRead([n.id]);
      if(n.url && /^https:\/\//.test(n.url)){ if(n.url.indexOf(location.origin) === 0) location.href = n.url; else window.open(n.url, '_blank', 'noopener'); }
    }
  }

  var css = document.createElement('style');
  css.textContent =
    '.ttn-bell{position:relative;flex:none;width:40px;height:40px;border-radius:12px;border:1px solid var(--line,#ddd);background:var(--panel,#fff);color:var(--text,#222);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;margin-left:6px}' +
    '.ttn-bell svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.ttn-bell.on{border-color:var(--accent,var(--cyan,#1f9e93))}' +
    '.ttn-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;border-radius:9px;background:#e8615a;color:#fff;font:700 11px/18px system-ui,sans-serif;padding:0 4px;text-align:center}' +
    '.ttn-ring{animation:ttnRing .6s}@keyframes ttnRing{0%,100%{transform:rotate(0)}20%{transform:rotate(-14deg)}40%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(4deg)}}' +
    '.ttn-panel{position:fixed;z-index:2000;top:64px;right:12px;width:min(380px,calc(100vw - 24px));max-height:min(70vh,560px);display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--text,#222);border:1px solid var(--line,#ddd);border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,.22);overflow:hidden;font-family:inherit}' +
    '.ttn-h{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line,#ddd)}.ttn-h b{flex:1;font-size:15px}' +
    '.ttn-x,.ttn-link{background:none;border:none;color:var(--dim,#777);cursor:pointer;font:inherit;font-size:13px;padding:2px 4px}.ttn-link{color:var(--accent,var(--cyan,#1f9e93))}' +
    '.ttn-push{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;font-size:13px;background:var(--panel2,var(--input-bg,#f6f8fa));border-bottom:1px solid var(--line,#ddd)}' +
    '.ttn-msg{padding:8px 14px;font-size:12.5px;color:var(--dim,#777);border-bottom:1px solid var(--line,#ddd)}' +
    '.ttn-btn{border:1px solid var(--line,#ddd);background:var(--panel,#fff);color:var(--text,#222);border-radius:8px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}.ttn-primary{background:var(--accent,var(--cyan,#1f9e93));border-color:var(--accent,var(--cyan,#1f9e93));color:#fff}' +
    '.ttn-list{overflow-y:auto}.ttn-item{padding:11px 14px;border-bottom:1px solid var(--line,#ddd);cursor:pointer}.ttn-item:hover{background:var(--panel2,var(--input-bg,#f6f8fa))}' +
    '.ttn-new{box-shadow:inset 3px 0 0 var(--accent,var(--cyan,#1f9e93))}.ttn-new .ttn-t{font-weight:700}' +
    '.ttn-t{font-size:14px;font-weight:600}.ttn-b{font-size:13px;margin-top:2px;white-space:pre-wrap;overflow-wrap:anywhere}.ttn-dim{font-size:11.5px;color:var(--dim,#777);margin-top:3px}' +
    '.ttn-empty{padding:28px 14px;text-align:center;color:var(--dim,#777);font-size:13px}' +
    '@media print{.ttn-bell,.ttn-panel{display:none!important}}';
  document.head.appendChild(css);

  // Start once someone is signed in; restart if they switch accounts.
  function tick(){
    var who = me();
    mount();
    if(who && who !== N.who){
      N.who = who; N.list = [];
      if(N.chan){ try{ sb().removeChannel(N.chan); }catch(e){} N.chan = null; }
      load(); listen(); pushState();
    }
    if(bell) bell.style.display = who ? '' : 'none';
  }
  setInterval(tick, 3000);
  setInterval(function(){ if(!document.hidden && N.who) load(); }, 90000);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden && N.who) load(); });
  setTimeout(tick, 800);

  window.TTNotifyApp = { refresh: load, open: function(){ toggle(true); }, unread: unread };
})();
