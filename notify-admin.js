// ===================================================================
// ====================== SEND NOTIFICATIONS (Studio) ================
// ===================================================================
// System → Notifications: send a message to designers, print partners, sales reps, brand
// partners or the team. Each person gets it in their app's bell inbox, and as a phone
// alert on any device where they turned alerts on. Shows what was sent, how many have read
// it, and how many devices it reached. Also wires Studio's own bell (notify-app.js).
//
// Other screens call window.TTNotify.compose({ to: [...], title, body }) to open the form
// filled in (the project pop-up's "Notify designer"), or TTNotify.send(...) directly.
(function(){
  if(window.TT_STOCK_MODE) return;

  // Studio's own bell (Studio inbox, for admins).
  window.TT_NOTIFY = { app: 'studio', mount: 'header #cloudBtn' };
  window.TTApp = window.TTApp || { sb: function(){ return on() ? cloud.sb : null; }, email: function(){ return on() ? cloud.email : ''; } };

  const APP_URL = { partner: 'https://threadtribestore-hash.github.io/TT-Partner-App/', sales: 'https://threadtribestore-hash.github.io/TT-Sales-App/', buyer: 'https://threadtribestore-hash.github.io/TT-Buyer-App/', studio: 'https://threadtribestore-hash.github.io/TT-Master-App/' };
  const GROUPS = [['designer', 'Designers', 'partner'], ['partner', 'Print partners', 'partner'], ['sales', 'Sales reps', 'sales'], ['buyer', 'Brand partners', 'buyer'], ['team', 'Team (Studio)', 'studio']];
  const TEMPLATES = [
    ['Brief ready', 'designer', 'Brief ready: ', 'The brief is complete in your Designer profile, with inspiration. Please add your steps and dates.'],
    ['New job', 'partner', 'New job for you', 'A new print job is waiting in your Partner app. Please accept it and confirm the date.'],
    ['Order dispatched', 'buyer', 'Your order is on its way', 'Your order has been dispatched. Tracking details are in the Thread Tribe Trade app.'],
    ['Payment reminder', 'buyer', 'Payment reminder', 'A gentle reminder that a payment is due. Details are under Money in the Thread Tribe Trade app.'],
    ['New catalogue items', 'buyer', 'New designs in the catalogue', 'We’ve added new designs to your catalogue. Take a look in the Thread Tribe Trade app.'],
    ['Targets', 'sales', 'This month’s targets', 'This month’s targets are in your Sales app. Let’s go!']
  ];
  const V = { picked: {}, open: {}, title: '', body: '', link: '', sent: [], devices: {}, team: [], missing: false, loaded: false, busy: false };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function ago(ts){ const m = Math.round((Date.now() - Date.parse(ts)) / 60000); if(!isFinite(m)) return ''; if(m < 60) return Math.max(m, 0) + ' min ago'; if(m < 1440) return Math.round(m / 60) + ' h ago'; return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function okEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()); }

  // Everyone who can be sent to, by group: { key, email, name, app, group }.
  function people(){
    const out = [];
    ensurePon();
    const dz = state.projectDesigners || {};
    state.pon.partners.forEach(function(p){
      if(!okEmail(p.email) || p.status === 'paused') return;
      out.push({ group: dz[p.id] ? 'designer' : 'partner', email: p.email.trim().toLowerCase(), name: p.name || p.email, app: 'partner' });
    });
    ((window.TTSales && window.TTSales.reps()) || []).forEach(function(r){
      if(r.active !== false && okEmail(r.email)) out.push({ group: 'sales', email: r.email.toLowerCase(), name: r.name || r.email, app: 'sales' });
    });
    (state.clients || []).forEach(function(c){
      if(c.buyerApp && okEmail(c.email)) out.push({ group: 'buyer', email: c.email.trim().toLowerCase(), name: c.name || c.email, app: 'buyer' });
    });
    V.team.forEach(function(e){ out.push({ group: 'team', email: e, name: e === (cloud.email || '').toLowerCase() ? e + ' (you)' : e, app: 'studio' }); });
    const seen = {};
    return out.filter(function(p){ const k = p.app + '|' + p.email; if(seen[k]) return false; seen[k] = 1; p.key = k; return true; });
  }

  async function load(){
    if(!on() || V.busy) return;
    V.busy = true;
    try{
      const res = await Promise.all([
        cloud.sb.from('notifications').select('id,recipient,app,title,body,batch,sender,created_at,read_at,push_result').order('created_at', { ascending: false }).limit(600),
        cloud.sb.from('push_subscriptions').select('email,app'),
        cloud.sb.rpc('notify_team')
      ]);
      if(res[0].error){ V.missing = /notifications|does not exist|schema cache|relation/i.test(res[0].error.message || ''); }
      else{
        V.missing = false;
        const by = {};
        (res[0].data || []).forEach(function(n){
          const k = n.batch || n.id, b = by[k] || (by[k] = { batch: k, title: n.title, body: n.body, at: n.created_at, sender: n.sender, n: 0, read: 0, pushed: 0, apps: {} });
          b.n++; if(n.read_at) b.read++; if(/^sent [1-9]/.test(n.push_result || '')) b.pushed++; b.apps[n.app] = (b.apps[n.app] || 0) + 1;
        });
        V.sent = Object.values(by).sort(function(a, b){ return b.at.localeCompare(a.at); }).slice(0, 25);
      }
      V.devices = {};
      (res[1].data || []).forEach(function(d){ V.devices[d.app + '|' + d.email] = (V.devices[d.app + '|' + d.email] || 0) + 1; });
      V.team = (res[2].data || []).map(function(r){ return String(r.email || '').toLowerCase(); }).filter(okEmail);
      V.loaded = true;
    } finally { V.busy = false; }
    if(box && box.style.display !== 'none') render();
  }

  async function send(to, msg){
    const title = String(msg.title || '').trim().slice(0, 120), body = String(msg.body || '').trim().slice(0, 600), url = /^https:\/\//.test(msg.url || '') ? msg.url : null;
    if(!title) throw new Error('Add a title');
    if(!to.length) throw new Error('Pick at least one person');
    const batch = uid(), sender = String(cloud.email || '').toLowerCase();
    const rows = to.map(function(p){ return { recipient: p.email, app: p.app, title: title, body: body, url: url || APP_URL[p.app] || null, kind: msg.kind || 'message', batch: batch, sender: sender }; });
    for(let i = 0; i < rows.length; i += 200){
      const r = await cloud.sb.from('notifications').insert(rows.slice(i, i + 200));
      if(r.error) throw r.error;
    }
    return rows.length;
  }

  // ---------- screen ----------
  let box = null;
  function render(){
    const root = document.getElementById('notifyRoot'); if(!root) return;
    if(!on()){ root.innerHTML = '<div class="panel"><p class="nt-dim">Turn on cloud sync (Settings) to send notifications.</p></div>'; return; }
    if(V.missing){ root.innerHTML = '<div class="panel"><p>One-time setup: run <code>notify_setup.sql</code> (in ~/PrintFarm/tt-bridge) in Supabase → SQL Editor.</p></div>'; return; }
    const all = people(), picked = all.filter(function(p){ return V.picked[p.key]; });
    const withDevice = picked.filter(function(p){ return V.devices[p.key]; }).length;
    let h = '<div class="panel"><div class="panel-title">Send a notification</div>' +
      '<p class="nt-dim">Each person gets it in their app’s 🔔 inbox, and as a phone alert where they’ve turned alerts on.</p>' +
      '<div class="nt-tpls">' + TEMPLATES.map(function(t, i){ return '<button class="nt-chip" data-nt="tpl" data-i="' + i + '">' + esc(t[0]) + '</button>'; }).join('') + '</div>' +
      '<div class="nt-groups">' + GROUPS.map(function(g){
        const list = all.filter(function(p){ return p.group === g[0]; });
        const n = list.filter(function(p){ return V.picked[p.key]; }).length;
        return '<div class="nt-g"><div class="nt-g-h"><label><input type="checkbox" data-nt="group" data-g="' + g[0] + '"' + (list.length && n === list.length ? ' checked' : '') + (list.length ? '' : ' disabled') + '> <b>' + g[1] + '</b> <span class="nt-dim">' + (n ? n + ' of ' : '') + list.length + '</span></label>' +
          (list.length ? '<button class="nt-link" data-nt="expand" data-g="' + g[0] + '">' + (V.open[g[0]] ? 'Hide' : 'Choose people') + '</button>' : '<span class="nt-dim">' + (g[0] === 'buyer' ? 'clients with the Buyer app and an email' : g[0] === 'sales' ? 'open Sales once to load reps' : 'none with an email') + '</span>') + '</div>' +
          (V.open[g[0]] ? '<div class="nt-people">' + list.map(function(p){
            return '<label><input type="checkbox" data-nt="person" data-k="' + esc(p.key) + '"' + (V.picked[p.key] ? ' checked' : '') + '> ' + esc(p.name) + (V.devices[p.key] ? ' <span class="nt-ok" title="Phone alerts on">🔔</span>' : '') + '</label>';
          }).join('') + '</div>' : '') + '</div>';
      }).join('') + '</div>' +
      '<label class="nt-lab">Title<input id="ntTitle" maxlength="120" value="' + esc(V.title) + '" placeholder="e.g. Brief ready: Infinity Woodkraft paperweight"></label>' +
      '<label class="nt-lab">Message<textarea id="ntBody" maxlength="600" rows="3" placeholder="What they need to know or do">' + esc(V.body) + '</textarea></label>' +
      '<label class="nt-lab">Link (optional)<input id="ntLink" value="' + esc(V.link) + '" placeholder="https://… (otherwise it opens their app)"></label>' +
      '<div class="nt-send"><span class="nt-dim">' + (picked.length ? picked.length + ' ' + (picked.length === 1 ? 'person' : 'people') + ' · ' + withDevice + ' with phone alerts on' : 'Pick who to send to') + '</span>' +
        '<button class="nt-btn nt-primary" data-nt="send"' + (picked.length ? '' : ' disabled') + '>Send</button></div></div>';
    h += '<div class="panel"><div class="panel-title">Sent</div>' + (V.sent.length ? V.sent.map(function(b){
      return '<div class="nt-row"><div><b>' + esc(b.title) + '</b>' + (b.body ? '<div class="nt-dim">' + esc(b.body.slice(0, 140)) + '</div>' : '') +
        '<div class="nt-dim">' + esc(ago(b.at)) + ' · ' + Object.keys(b.apps).map(function(a){ return b.apps[a] + ' ' + ({ partner: 'partner', sales: 'sales', buyer: 'brand partner', studio: 'team' }[a] || a); }).join(', ') + '</div></div>' +
        '<div class="nt-stat"><span>' + b.read + '/' + b.n + ' read</span><span class="nt-dim">' + b.pushed + ' phone alert' + (b.pushed === 1 ? '' : 's') + '</span></div></div>';
    }).join('') : '<p class="nt-dim">Nothing sent yet.</p>') + '</div>';
    root.innerHTML = h;
  }
  function readForm(){ const t = document.getElementById('ntTitle'), b = document.getElementById('ntBody'), l = document.getElementById('ntLink'); if(t) V.title = t.value; if(b) V.body = b.value; if(l) V.link = l.value.trim(); }

  document.addEventListener('input', function(e){ if(box && box.contains(e.target) && /^nt(Title|Body|Link)$/.test(e.target.id)) readForm(); });
  document.addEventListener('change', function(e){
    if(!box || !box.contains(e.target)) return;
    const a = e.target.getAttribute('data-nt');
    if(a === 'person'){ const k = e.target.getAttribute('data-k'); if(e.target.checked) V.picked[k] = true; else delete V.picked[k]; readForm(); render(); }
    else if(a === 'group'){ const g = e.target.getAttribute('data-g'); people().filter(function(p){ return p.group === g; }).forEach(function(p){ if(e.target.checked) V.picked[p.key] = true; else delete V.picked[p.key]; }); readForm(); render(); }
  });
  document.addEventListener('click', async function(e){
    if(!box || !box.contains(e.target)) return;
    const b = e.target.closest('[data-nt]'); if(!b || b.tagName === 'INPUT') return;
    const a = b.getAttribute('data-nt');
    readForm();
    if(a === 'expand'){ const g = b.getAttribute('data-g'); V.open[g] = !V.open[g]; render(); }
    else if(a === 'tpl'){
      const t = TEMPLATES[+b.getAttribute('data-i')];
      V.title = t[2]; V.body = t[3];
      if(!people().some(function(p){ return V.picked[p.key]; })) people().filter(function(p){ return p.group === t[1]; }).forEach(function(p){ V.picked[p.key] = true; });
      render(); const ti = document.getElementById('ntTitle'); if(ti){ ti.focus(); ti.setSelectionRange(ti.value.length, ti.value.length); }
    }
    else if(a === 'send'){
      const to = people().filter(function(p){ return V.picked[p.key]; });
      if(V.link && !/^https:\/\//.test(V.link)){ showToast('The link must start with https://'); return; }
      if(!confirm('Send “' + (V.title || '').trim() + '” to ' + to.length + ' ' + (to.length === 1 ? 'person' : 'people') + '?')) return;
      b.disabled = true;
      try{ const n = await send(to, { title: V.title, body: V.body, url: V.link }); showToast('Sent to ' + n + ' ' + (n === 1 ? 'person' : 'people')); V.title = V.body = V.link = ''; V.picked = {}; await load(); }
      catch(err){ showToast('Couldn’t send: ' + (err.message || err)); b.disabled = false; }
    }
  });

  const css = document.createElement('style');
  css.textContent =
    '#tabNotify .nt-dim{color:var(--dim);font-size:12px}#tabNotify .nt-ok{font-size:11px}' +
    '#tabNotify .nt-tpls{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}#tabNotify .nt-chip{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:999px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer}#tabNotify .nt-chip:hover{border-color:var(--cyan);color:var(--cyan)}' +
    '#tabNotify .nt-groups{display:grid;gap:6px;margin-bottom:12px}#tabNotify .nt-g{border:1px solid var(--line);border-radius:10px;padding:8px 10px}' +
    '#tabNotify .nt-g-h{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}#tabNotify .nt-g-h label{display:flex;gap:6px;align-items:center;font-size:13.5px;cursor:pointer}' +
    '#tabNotify .nt-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 12px;margin-top:8px}#tabNotify .nt-people label{display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer}' +
    '#tabNotify .nt-link{background:none;border:none;color:var(--cyan);font:inherit;font-size:12px;cursor:pointer}' +
    '#tabNotify .nt-lab{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dim);margin-top:10px}' +
    '#tabNotify .nt-lab input,#tabNotify .nt-lab textarea{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px;font:inherit;font-size:13.5px}' +
    '#tabNotify .nt-send{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}' +
    '#tabNotify .nt-btn{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 18px;font:inherit;font-size:13.5px;cursor:pointer}#tabNotify .nt-primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600}#tabNotify .nt-btn[disabled]{opacity:.5;cursor:default}' +
    '#tabNotify .nt-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--line);font-size:13px}#tabNotify .nt-stat{text-align:right;white-space:nowrap;display:flex;flex-direction:column;gap:2px}';
  document.head.appendChild(css);

  // Screen: System → Notifications (next to Automations).
  const anchor = document.querySelector('.tab-btn[data-tab="automations"]') || document.querySelector('.tab-btn[data-tab="settings"]');
  const settingsTab = document.getElementById('tabSettings');
  if(anchor && settingsTab){
    const btn = document.createElement('button');
    btn.className = 'tab-btn'; btn.setAttribute('data-tab', 'notify'); btn.textContent = 'Notifications';
    anchor.insertAdjacentElement('afterend', btn);
    box = document.createElement('div');
    box.id = 'tabNotify'; box.style.display = 'none'; box.innerHTML = '<div id="notifyRoot"></div>';
    settingsTab.parentNode.insertBefore(box, settingsTab);
    function wire(b){
      b.addEventListener('click', function(){
        const show = b.getAttribute('data-tab') === 'notify';
        box.style.display = show ? '' : 'none';
        if(show){
          document.querySelectorAll('.tab-btn').forEach(function(x){ x.classList.toggle('active', x === b); });
          const lab = document.getElementById('currentTabLabel'); if(lab) lab.textContent = 'Notifications';
          const bar = document.getElementById('tabBar'); if(bar) bar.classList.remove('open');
          document.querySelectorAll('.wrap > [id^="tab"]').forEach(function(el){ if(el !== box && /^tab[A-Z]/.test(el.id) && el.id !== 'tabBar') el.style.display = 'none'; });
          if(window.TTSales && !window.TTSales.loaded()) window.TTSales.load().then(render).catch(function(){});
          render(); load();
        }
      });
    }
    document.querySelectorAll('.tab-btn').forEach(wire);
    const sheet = document.getElementById('moreSheetList');
    if(sheet){
      const lab = [].filter.call(sheet.querySelectorAll('.msheet-label'), function(el){ return /^system/i.test(el.textContent.trim()); })[0];
      const grid = lab && lab.nextElementSibling;
      if(grid){ const it = document.createElement('button'); it.className = 'msheet-item'; it.setAttribute('data-goto', 'notify'); it.textContent = 'Notifications'; grid.insertBefore(it, grid.firstChild); }
    }
  }

  window.TTNotify = {
    send: send,
    people: people,
    // Open the form with people and text filled in. to: [{ email, app }]
    compose: function(o){
      o = o || {};
      V.picked = {}; (o.to || []).forEach(function(p){ if(p && okEmail(p.email)) V.picked[p.app + '|' + String(p.email).toLowerCase()] = true; });
      V.title = o.title || ''; V.body = o.body || ''; V.link = o.url || '';
      const b = document.querySelector('.tab-btn[data-tab="notify"]'); if(b) b.click(); window.scrollTo(0, 0);
    }
  };
})();
