// ===================================================================
// ========================== APP SHELL (Studio) =====================
// ===================================================================
// Makes Studio behave like an app rather than a page: a slim sticky top bar,
// backup tools moved into Settings, the last screen and scroll position
// remembered per device, a short transition between screens, toasts with
// Undo, pull to refresh on phones, and a command search (Ctrl/Cmd + K) that
// jumps to any screen, order, client, partner or product.
(function(){
  if(window.TT_STOCK_MODE) return;

  const LAST_KEY = 'tt-last-tab-v1';
  const scrollByTab = {};

  function rd(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function wr(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function activeTab(){ const b = document.querySelector('.tab-btn.active'); return b ? b.getAttribute('data-tab') : 'home'; }
  function tabButton(tab){ return document.querySelector('.tab-btn[data-tab="' + tab + '"]'); }
  function goTab(tab){ const b = tabButton(tab); if(b && !b.classList.contains('active')) b.click(); }
  function visibleScreen(){
    const wrap = document.querySelector('.wrap');
    return wrap ? [].filter.call(wrap.children, function(el){ return /^tab[A-Z]/.test(el.id || '') && el.style.display !== 'none'; })[0] : null;
  }

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent =
    'body{padding-top:0}' +
    '#ttAppBar{position:sticky;top:0;z-index:900;background:var(--bg);margin:0 -18px 14px;padding:10px 18px 8px;border-bottom:1px solid var(--line)}' +
    '#ttAppBar header{margin:0 0 8px;align-items:center}' +
    '#ttAppBar header .eyebrow,#ttAppBar header .sub{display:none}' +
    '#ttAppBar header h1{font-size:20px;margin:0;cursor:pointer}' +
    '#ttAppBar .tab-bar{margin:0}' +
    '.tt-search-btn{white-space:nowrap}' +
    '.tt-enter{animation:ttEnter .18s ease-out}' +
    '@keyframes ttEnter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion: reduce){.tt-enter{animation:none}}' +
    '#ttToast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:10001;background:var(--text);color:var(--bg);border-radius:10px;padding:10px 14px;font-size:14px;display:none;align-items:center;gap:14px;max-width:min(92vw,520px)}' +
    '#ttToast.on{display:flex}#ttToast button{background:none;border:none;color:var(--cyan);font:inherit;font-weight:600;cursor:pointer;padding:0}' +
    '#ttPull{position:fixed;top:0;left:50%;transform:translate(-50%,-100%);z-index:10001;background:var(--panel);border:1px solid var(--line);border-radius:0 0 10px 10px;padding:6px 14px;font-size:12px;color:var(--dim);transition:transform .15s}' +
    '#ttCmdBack{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:none;align-items:flex-start;justify-content:center;padding:10vh 16px}' +
    '#ttCmdBack.on{display:flex}' +
    '#ttCmd{background:var(--panel);border:1px solid var(--line);border-radius:12px;width:min(640px,100%);overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.35)}' +
    '#ttCmd input{width:100%;box-sizing:border-box;border:none;border-bottom:1px solid var(--line);background:transparent;color:var(--text);font:inherit;font-size:16px;padding:14px 16px;outline:none}' +
    '#ttCmdList{max-height:55vh;overflow:auto}' +
    '.tt-cmd-item{display:flex;justify-content:space-between;gap:12px;padding:10px 16px;cursor:pointer;font-size:14px}' +
    '.tt-cmd-item.sel,.tt-cmd-item:hover{background:var(--input-bg)}.tt-cmd-item small{color:var(--dim);white-space:nowrap}' +
    '.tt-cmd-empty{padding:14px 16px;color:var(--dim);font-size:13px}';
  document.head.appendChild(css);

  // ---------- slim sticky top bar ----------
  const header = document.querySelector('.wrap > header');
  const tabBar = document.getElementById('tabBar');
  if(header && tabBar){
    const bar = document.createElement('div');
    bar.id = 'ttAppBar';
    header.parentNode.insertBefore(bar, header);
    bar.appendChild(header);
    bar.appendChild(tabBar);
    const right = header.lastElementChild;
    const search = document.createElement('button');
    search.className = 'theme-toggle-btn tt-search-btn';
    search.type = 'button';
    search.title = 'Search screens, orders, clients (Ctrl/Cmd + K)';
    search.textContent = '⌕ Search';
    search.addEventListener('click', openCmd);
    if(right) right.insertBefore(search, right.firstChild);
    const title = header.querySelector('h1');
    if(title) title.addEventListener('click', function(){ goTab('home'); window.scrollTo(0, 0); });
  }

  // ---------- backup and export live in Settings ----------
  const backup = document.querySelector('.wrap > .backup-bar');
  const settings = document.getElementById('tabSettings');
  if(backup && settings){
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = '<div class="panel-title">Backup and export</div>';
    panel.appendChild(backup);
    backup.style.margin = '0';
    settings.insertBefore(panel, settings.firstChild);
  }

  // ---------- remember the screen, keep scroll per screen, animate the change ----------
  let restoring = false;
  document.querySelectorAll('.tab-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      const from = activeTab();
      scrollByTab[from] = window.scrollY;
    }, true);
    btn.addEventListener('click', function(){
      const tab = btn.getAttribute('data-tab');
      if(!restoring) wr(LAST_KEY, tab);
      const scr = visibleScreen();
      if(scr){ scr.classList.remove('tt-enter'); void scr.offsetWidth; scr.classList.add('tt-enter'); }
      const y = scrollByTab[tab] || 0;
      requestAnimationFrame(function(){ window.scrollTo(0, y); });
    });
  });
  function landing(){
    const saved = rd(LAST_KEY);
    if(saved && tabButton(saved)) return saved;
    // First time on this device: sales reps start on Sales, everyone else on Home.
    const reps = window.TTSales && window.TTSales.reps ? window.TTSales.reps() : [];
    const me = ((typeof cloud !== 'undefined' && cloud.email) || '').toLowerCase();
    if(me && reps.some(function(r){ return (r.email || '').toLowerCase() === me; })) return 'sales';
    return 'home';
  }
  setTimeout(function(){
    const tab = landing();
    if(tab !== 'home'){ restoring = true; goTab(tab); restoring = false; }
  }, 400);

  // ---------- toast with Undo ----------
  const toast = document.createElement('div');
  toast.id = 'ttToast';
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);
  let toastTimer = null;
  window.ttToast = function(message, opts){
    opts = opts || {};
    toast.innerHTML = '<span>' + esc(message) + '</span>' + (opts.undo ? '<button type="button">Undo</button>' : '');
    toast.classList.add('on');
    const b = toast.querySelector('button');
    if(b) b.addEventListener('click', function(){ toast.classList.remove('on'); try{ opts.undo(); }catch(e){ console.warn(e); } });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toast.classList.remove('on'); }, opts.ms || (opts.undo ? 6000 : 3000));
  };

  // ---------- pull to refresh (phones) ----------
  const pull = document.createElement('div');
  pull.id = 'ttPull';
  pull.textContent = 'Pull to refresh';
  document.body.appendChild(pull);
  let startY = null, pulled = 0;
  window.addEventListener('touchstart', function(e){ startY = window.scrollY <= 0 && !document.querySelector('.msheet-overlay:not(.hidden), #ttCmdBack.on') ? e.touches[0].clientY : null; pulled = 0; }, { passive: true });
  window.addEventListener('touchmove', function(e){
    if(startY == null) return;
    pulled = e.touches[0].clientY - startY;
    if(pulled > 10){ pull.style.transform = 'translate(-50%,' + (Math.min(pulled, 90) - 100) + '%)'; pull.textContent = pulled > 80 ? 'Release to refresh' : 'Pull to refresh'; }
  }, { passive: true });
  window.addEventListener('touchend', function(){
    if(startY == null) return;
    const go = pulled > 80;
    startY = null; pull.style.transform = '';
    if(go) refresh();
  });
  async function refresh(){
    try{
      if(typeof cloudIsOn === 'function' && cloudIsOn() && typeof cloudPull === 'function'){ await cloudPull(); if(typeof cloudPullReports === 'function') await cloudPullReports(); }
      const b = tabButton(activeTab());
      if(b){ b.classList.remove('active'); b.click(); }
      window.ttToast('Up to date');
    }catch(e){ window.ttToast('Couldn’t refresh: ' + (e.message || e)); }
  }
  window.ttRefresh = refresh;

  // ---------- command search ----------
  const back = document.createElement('div');
  back.id = 'ttCmdBack';
  back.innerHTML = '<div id="ttCmd" role="dialog" aria-label="Search"><input id="ttCmdInput" placeholder="Search screens, orders, clients, partners, products…" autocomplete="off"><div id="ttCmdList"></div></div>';
  document.body.appendChild(back);
  const input = back.querySelector('#ttCmdInput'), list = back.querySelector('#ttCmdList');
  let items = [], sel = 0;

  const ACTIONS = [
    { label: 'New order', hint: 'Action', run: function(){ goTab('orders'); if(typeof addOrder === 'function') addOrder(); } },
    { label: 'New quote', hint: 'Action', run: function(){ goTab('orders'); if(typeof addQuote === 'function') addQuote(); } },
    { label: 'Add expense', hint: 'Action', run: function(){ goTab('expenses'); if(typeof openAddExpenseModal === 'function') openAddExpenseModal(); } },
    { label: 'Add client', hint: 'Action', run: function(){ goTab('clients'); if(typeof openAddClientModal === 'function') openAddClientModal(); } },
    { label: 'Open print farm', hint: 'Action', run: function(){ const m = document.querySelector('.ttf-menu-item'); if(m) m.click(); } },
    { label: 'Refresh data', hint: 'Action', run: refresh }
  ];
  function all(){
    const out = ACTIONS.slice();
    document.querySelectorAll('.tab-btn').forEach(function(b){
      const tab = b.getAttribute('data-tab');
      out.push({ label: b.textContent.trim(), hint: 'Screen', run: function(){ goTab(tab); } });
    });
    (state.orders || []).forEach(function(o){
      out.push({ label: (o.displayId ? o.displayId + ' · ' : '') + (o.clientName || o.name || 'Order'), hint: (o.status || '').replace(/_/g, ' '), key: [o.displayId, o.name, o.clientName].join(' '),
        run: function(){ if(typeof openOrderDetailModal === 'function') openOrderDetailModal(o.id); } });
    });
    (state.clients || []).forEach(function(c){
      out.push({ label: c.name || 'Client', hint: 'Client' + (c.city ? ' · ' + c.city : ''), key: [c.name, c.phone, c.city, c.gstin].join(' '), run: function(){ goTab('clients'); } });
    });
    ((state.pon && state.pon.partners) || []).forEach(function(p){
      out.push({ label: p.name || 'Partner', hint: 'Partner' + (p.city ? ' · ' + p.city : ''), key: [p.name, p.phone, p.city].join(' '), run: function(){ goTab('partners'); } });
    });
    (state.productCatalog || []).forEach(function(p){
      out.push({ label: p.name || 'Product', hint: 'Product' + (p.category ? ' · ' + p.category : ''), key: [p.name, p.category].join(' '), run: function(){ goTab('products'); } });
    });
    return out;
  }
  function filter(q){
    q = q.trim().toLowerCase();
    const src = all();
    if(!q) return src.slice(0, 12);
    const words = q.split(/\s+/);
    return src.filter(function(x){ const k = ((x.key || '') + ' ' + x.label + ' ' + x.hint).toLowerCase(); return words.every(function(w){ return k.indexOf(w) !== -1; }); })
      .sort(function(a, b){ return (a.label.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (b.label.toLowerCase().indexOf(q) === 0 ? 0 : 1); }).slice(0, 30);
  }
  function draw(){
    list.innerHTML = items.length ? items.map(function(x, i){
      return '<div class="tt-cmd-item' + (i === sel ? ' sel' : '') + '" data-i="' + i + '"><span>' + esc(x.label) + '</span><small>' + esc(x.hint) + '</small></div>';
    }).join('') : '<div class="tt-cmd-empty">No matches</div>';
  }
  function openCmd(){ back.classList.add('on'); input.value = ''; items = filter(''); sel = 0; draw(); setTimeout(function(){ input.focus(); }, 0); }
  function closeCmd(){ back.classList.remove('on'); }
  function pick(i){ const x = items[i]; closeCmd(); if(x) x.run(); }
  input.addEventListener('input', function(){ items = filter(input.value); sel = 0; draw(); });
  input.addEventListener('keydown', function(e){
    if(e.key === 'ArrowDown'){ sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if(e.key === 'Enter'){ pick(sel); e.preventDefault(); }
    else if(e.key === 'Escape') closeCmd();
  });
  list.addEventListener('click', function(e){ const it = e.target.closest('[data-i]'); if(it) pick(+it.getAttribute('data-i')); });
  back.addEventListener('click', function(e){ if(e.target === back) closeCmd(); });
  document.addEventListener('keydown', function(e){
    if((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')){ e.preventDefault(); back.classList.contains('on') ? closeCmd() : openCmd(); }
  });
  window.ttSearch = openCmd;
})();
