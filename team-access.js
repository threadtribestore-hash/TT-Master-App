// Team access: roles in Studio.
// Owners are app_admins. Team members are in studio_team with a role; the database
// (team_access_setup.sql) decides what each role can read and write, and this file mirrors
// those rules so menus, screens and sync match. Keep ACCESS in step with studio_can_read /
// studio_can_write in the SQL.
(function(){
  var ROLES = {
    owner: 'Owner', manager: 'Manager', production: 'Production', packing: 'Packing & dispatch', sales: 'Sales', accounts: 'Accounts'
  };
  // Screens each role sees ('printfarm' is the Print farm menu item). Owners and managers see
  // everything except the screens listed under deny.
  var TABS = {
    manager: { deny: ['expenses', 'finance', 'expDash'] },
    production: { allow: ['home', 'tasks', 'control', 'orders', 'scheduler', 'partners', 'projects', 'filament', 'ops', 'production', 'printmatch', 'printfarm', 'help'] },
    packing: { allow: ['home', 'tasks', 'control', 'orders', 'shipturtle', 'help'] },
    sales: { allow: ['home', 'tasks', 'control', 'orders', 'clients', 'products', 'help'] },
    accounts: { allow: ['home', 'tasks', 'orders', 'clients', 'invoices', 'expenses', 'finance', 'expDash', 'bi', 'help'] }
  };
  function tabAllowed(role, tab){
    if(!role || role === 'owner') return true;
    var t = TABS[role]; if(!t) return false;
    return t.allow ? t.allow.indexOf(tab) !== -1 : t.deny.indexOf(tab) === -1;
  }
  // Same rules as the database (studio_can_read / studio_can_write).
  function canRead(role, coll, id){
    if(role === 'owner') return true;
    if(!role) return false;
    if(coll === '$doc') return id !== 'bank' || role === 'accounts';
    if(['orders', 'clients', 'productCatalog', 'printers', 'inventory'].indexOf(coll) !== -1) return true;
    if(role === 'manager') return coll !== 'expenses' && coll.indexOf('bank.') !== 0;
    if(role === 'production') return ['filamentRates', 'pon.partners', 'pon.jobs', 'pon.filamentIssues', 'lab.ideas'].indexOf(coll) !== -1 || coll.indexOf('fil.') === 0;
    if(role === 'packing') return ['pon.partners', 'pon.jobs'].indexOf(coll) !== -1;
    if(role === 'sales') return ['filamentRates', 'dealerTiers', 'lab.ideas'].indexOf(coll) !== -1;
    if(role === 'accounts') return ['expenses', 'dealerTiers', 'pon.payouts', 'pon.partners'].indexOf(coll) !== -1 || coll.indexOf('bank.') === 0;
    return false;
  }
  function canWrite(role, coll, id){
    if(role === 'owner') return true;
    if(!role || !canRead(role, coll, id)) return false;
    if(role === 'manager') return true;
    if(coll === '$doc') return role === 'accounts' || ['bank', 'business', 'buyerSettings', 'flow'].indexOf(id) === -1;
    if(role === 'production') return ['orders', 'printers', 'inventory', 'pon.jobs', 'pon.filamentIssues', 'lab.ideas'].indexOf(coll) !== -1 || coll.indexOf('fil.') === 0;
    if(role === 'packing') return ['orders', 'inventory'].indexOf(coll) !== -1;
    if(role === 'sales') return ['orders', 'clients', 'lab.ideas'].indexOf(coll) !== -1;
    if(role === 'accounts') return ['orders', 'clients', 'expenses', 'pon.payouts'].indexOf(coll) !== -1 || coll.indexOf('bank.') === 0;
    return false;
  }
  // On-screen money hiding. Production and packing see no prices, costs or payments; sales
  // sees prices but not costs, margins or profit. (A money-free data pack is the next step.)
  var HIDE_MONEY = ['production', 'packing'], HIDE_COSTS = ['sales'];

  var current = { role: '', email: '' };
  function esc(s){ return typeof escapeHtml === 'function' ? escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s); }

  // ---------- apply a role ----------
  var styleEl = null;
  function applyRole(role, email){
    current.role = role || ''; current.email = email || '';
    document.body.setAttribute('data-tt-role', current.role || 'none');
    var allTabs = [];
    document.querySelectorAll('[data-tab],[data-mtab],[data-goto]').forEach(function(b){ var t = b.getAttribute('data-tab') || b.getAttribute('data-mtab') || b.getAttribute('data-goto'); if(t && allTabs.indexOf(t) === -1) allTabs.push(t); });
    ['printfarm', 'automations', 'notify', 'printmatch', 'research'].forEach(function(t){ if(allTabs.indexOf(t) === -1) allTabs.push(t); });
    var hidden = allTabs.filter(function(t){ return !tabAllowed(current.role, t); });
    // Menu buttons, the phone bottom bar (data-mtab) and the phone More sheet (data-goto).
    var css = hidden.filter(function(t){ return t !== 'printfarm'; }).map(function(t){ return '[data-tab="' + t + '"],[data-mtab="' + t + '"],[data-goto="' + t + '"]'; }).join(',');
    var rules = [];
    if(css) rules.push(css + '{display:none !important}');
    if(hidden.indexOf('printfarm') !== -1) rules.push('.ttf-menu-item{display:none !important}');
    if(HIDE_MONEY.indexOf(current.role) !== -1){
      rules.push(['#pipelineForecastStrip', '.kb-val', '.kanban-col-total', '.order-intel', '#kbHoverTip', '.profit-figures', '.profit-band', '.payments-total-band',
        '.payment-due-hint', '.payment-remind-badge', '.selling-price-hint', '.recalc-cost-link', '.cost-frozen-text', '#ordersViewToggle [data-view="table"]', '#exportOrdersTableBtn',
        '#paymentReminderBanner', '.panel:has(#paymentsSummaryList)', '.kanban-column[data-status="payment"] .kanban-card-badge',
        'div:has(> input.p-list-price)', 'div:has(> input.p-actual-price)', 'div:has(> input.p-amount-paid)', 'div:has(> select.p-payment-mode)', 'div:has(> input.p-refund-amount)',
        'div:has(> input.p-packaging-cost)', 'div:has(> input.p-delivery-cost)', 'div:has(> input.payment-cleared-date-input)'].join(',') + '{display:none !important}');
    }
    if(HIDE_COSTS.indexOf(current.role) !== -1 || current.role === 'manager'){
      // No expenses for these roles, so net profit would mislead; sales also doesn't see margins.
      rules.push('#pipelineForecastStrip .pc-conversion{display:none !important}');
    }
    if(HIDE_COSTS.indexOf(current.role) !== -1){
      rules.push('#pipelineForecastStrip .pc-revenue,.order-intel,#kbHoverTip .order-intel,.profit-figures,.profit-band,.recalc-cost-link,.cost-frozen-text{display:none !important}');
    }
    // Bulk actions (imports, backups, "Clear all") rewrite shared data for everyone: owners only.
    if(current.role && current.role !== 'owner') rules.push(OWNER_ONLY + '{display:none !important}');
    // Deleting a single order or client: owners and managers.
    if(current.role && ['owner', 'manager'].indexOf(current.role) === -1) rules.push('[title="Delete order"],[title="Delete client"]{display:none !important}');
    if(!styleEl){ styleEl = document.createElement('style'); styleEl.id = 'ttRoleCss'; document.head.appendChild(styleEl); }
    styleEl.textContent = rules.join('\n');
    // If the open screen isn't allowed, go Home.
    var active = document.querySelector('.tab-btn.active');
    if(active && !tabAllowed(current.role, active.getAttribute('data-tab'))){ var h = document.querySelector('.tab-btn[data-tab="home"]'); if(h) h.click(); }
    badge();
    renderTeamPanel();
  }
  window.ttApplyRole = applyRole;

  var OWNER_ONLY = '.backup-btn.danger,#importBtn,[data-tool="import"],#importOrdersBtn,#importClientsBtn,#importCatalogBtn,#importExpensesBtn,#ponImportBtn,[data-qa="import-update"]';
  document.addEventListener('click', function(e){
    var r = current.role; if(!r || r === 'owner') return;
    if(e.target.closest && e.target.closest(OWNER_ONLY)){ e.preventDefault(); e.stopImmediatePropagation(); if(typeof showToast === 'function') showToast('Only an owner can do this'); }
  }, true);
  function guard(name, roles){
    if(typeof window[name] !== 'function') return;
    var orig = window[name];
    window[name] = function(){
      if(current.role && roles.indexOf(current.role) === -1){ if(typeof showToast === 'function') showToast('Your role (' + ROLES[current.role] + ') can’t delete this. Ask an owner or manager.'); return; }
      return orig.apply(this, arguments);
    };
  }
  guard('removeOrder', ['owner', 'manager']);
  guard('removeClient', ['owner', 'manager']);

  // Block screens a role can't use, including links from other screens.
  document.addEventListener('click', function(e){
    var r = current.role; if(!r || r === 'owner') return;
    var t = e.target.closest && e.target.closest('[data-tab]');
    var pf = e.target.closest && e.target.closest('.ttf-menu-item');
    var tab = t ? t.getAttribute('data-tab') : pf ? 'printfarm' : '';
    if(tab && !tabAllowed(r, tab)){ e.preventDefault(); e.stopImmediatePropagation(); if(typeof showToast === 'function') showToast('Your role (' + ROLES[r] + ') doesn’t include this screen'); }
  }, true);

  function badge(){
    var el = document.getElementById('ttRoleBadge');
    if(!current.role || current.role === 'owner'){ if(el) el.remove(); return; }
    if(!el){
      el = document.createElement('span'); el.id = 'ttRoleBadge';
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:900;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font:12px "Space Grotesk",sans-serif;color:var(--dim);box-shadow:0 4px 14px rgba(0,0,0,.12)';
      document.body.appendChild(el);
    }
    el.textContent = ROLES[current.role] + ' · ' + current.email;
  }

  // ---------- Team & access (Settings) ----------
  var T = { list: null, err: '', missing: false, act: null, actErr: '', who: '', loading: false };
  function sb(){ return (typeof cloud !== 'undefined' && cloud.sb) ? cloud.sb : null; }
  async function loadTeam(){
    if(!sb() || T.loading) return;
    T.loading = true;
    try{
      var role = current.role;
      if(role === 'owner'){
        var r = await sb().from('studio_team').select('*').order('role').order('name');
        if(r.error){ T.missing = /studio_team|does not exist|schema cache|relation/i.test(r.error.message || ''); T.err = T.missing ? '' : r.error.message; T.list = []; }
        else { T.missing = false; T.err = ''; T.list = r.data || []; }
      }
      if(role === 'owner' || role === 'manager'){
        var q = sb().from('studio_activity').select('*').order('at', { ascending: false }).limit(200);
        if(T.who) q = q.eq('email', T.who);
        var a = await q;
        if(a.error){ T.actErr = /studio_activity|does not exist|schema cache|relation/i.test(a.error.message || '') ? '' : a.error.message; T.act = []; }
        else { T.actErr = ''; T.act = a.data || []; }
      }
    } finally { T.loading = false; }
    renderTeamPanel(true);
  }
  function when(ts){ var d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function collName(c, id){
    if(c === '$doc') return 'Setting · ' + id;
    var m = { orders: 'Order', clients: 'Client', expenses: 'Expense', productCatalog: 'Product', printers: 'Printer', inventory: 'Filament stock', filamentRates: 'Filament rate', dealerTiers: 'Dealer tier' };
    if(m[c]) return m[c];
    if(c.indexOf('bank.') === 0) return 'Bank';
    if(c.indexOf('pon.') === 0) return 'Partner network';
    if(c.indexOf('fil.') === 0) return 'Filament';
    return c;
  }
  function teamHtml(){
    var role = current.role, h = '';
    if(role === 'owner'){
      h += '<div class="panel" id="ttTeamPanel"><div class="panel-title">Team & access</div>';
      if(T.missing){
        h += '<p class="ta-dim">One-time setup: in Supabase → SQL Editor, run <b>team_access_setup.sql</b> (in tt-bridge). Then reopen this screen.</p>';
      } else {
        h += '<p class="ta-dim">Owners (you) see everything. Each person below signs in at this Studio address with their email code and sees only their role’s screens and data. The database enforces it.</p>' +
          '<table class="ta-t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th></th></tr></thead><tbody>' +
          (T.list && T.list.length ? T.list.map(function(m){
            return '<tr><td><input data-ta-f="name" data-e="' + esc(m.email) + '" value="' + esc(m.name) + '"></td><td>' + esc(m.email) + '</td>' +
              '<td><select data-ta-f="role" data-e="' + esc(m.email) + '">' + Object.keys(ROLES).filter(function(k){ return k !== 'owner'; }).map(function(k){ return '<option value="' + k + '"' + (m.role === k ? ' selected' : '') + '>' + ROLES[k] + '</option>'; }).join('') + '</select></td>' +
              '<td><label class="ta-sw"><input type="checkbox" data-ta-f="active" data-e="' + esc(m.email) + '"' + (m.active ? ' checked' : '') + '> ' + (m.active ? 'On' : 'Off') + '</label></td>' +
              '<td><button type="button" class="ta-btn" data-ta="remove" data-e="' + esc(m.email) + '">Remove</button></td></tr>';
          }).join('') : '<tr><td colspan="5" class="ta-dim">' + (T.list ? 'No team members yet.' : 'Loading…') + '</td></tr>') +
          '</tbody></table>' +
          '<div class="ta-add"><input id="taName" placeholder="Name"><input id="taEmail" type="email" placeholder="Email they sign in with"><select id="taRole">' +
          Object.keys(ROLES).filter(function(k){ return k !== 'owner'; }).map(function(k){ return '<option value="' + k + '">' + ROLES[k] + '</option>'; }).join('') +
          '</select><button type="button" class="ta-btn primary" data-ta="add">Add person</button></div>' +
          (T.err ? '<p class="ta-err">' + esc(T.err) + '</p>' : '') +
          '<details class="ta-roles"><summary>What each role can see and change</summary><table class="ta-t"><tbody>' +
          '<tr><td><b>Manager</b></td><td>Everything except Bank reconciliation, Expenses and net profit.</td></tr>' +
          '<tr><td><b>Production</b></td><td>Control Room, Orders (no prices), Scheduler, Partner Network, Projects, Filament, Ops planning, Print farm, Print matching, Tasks.</td></tr>' +
          '<tr><td><b>Packing & dispatch</b></td><td>Control Room, Orders (no prices), Shipturtle, Tasks.</td></tr>' +
          '<tr><td><b>Sales</b></td><td>Control Room, Orders and quotes, Clients, Product Catalog, Tasks. No costs or margins. Leads stay in the Sales app.</td></tr>' +
          '<tr><td><b>Accounts</b></td><td>Orders, Clients, Invoices, Expenses, Bank reconciliation, Expense Dashboard, Business Intelligence, Tasks.</td></tr>' +
          '</tbody></table><p class="ta-dim">Owners are managed in Supabase (app_admins).</p></details>';
      }
      h += '</div>';
    }
    if(role === 'owner' || role === 'manager'){
      var people = {};
      (T.list || []).forEach(function(m){ people[m.email] = m.name || m.email; });
      h += '<div class="panel" id="ttActivityPanel"><div class="panel-title">Activity · who changed what</div>' +
        '<div class="ta-add"><select id="taWho"><option value="">Everyone</option>' +
        Object.keys(people).map(function(e){ return '<option value="' + esc(e) + '"' + (T.who === e ? ' selected' : '') + '>' + esc(people[e]) + '</option>'; }).join('') +
        (current.email && !people[current.email] ? '<option value="' + esc(current.email) + '"' + (T.who === current.email ? ' selected' : '') + '>Me</option>' : '') +
        '</select><button type="button" class="ta-btn" data-ta="refresh">Refresh</button></div>' +
        (T.actErr ? '<p class="ta-err">' + esc(T.actErr) + '</p>' : '') +
        '<div class="ta-tw"><table class="ta-t"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead><tbody>' +
        (T.act && T.act.length ? T.act.map(function(a){
          return '<tr><td class="ta-nw">' + when(a.at) + '</td><td>' + esc(a.email ? (people[a.email] || a.email) : 'Workshop bridge') + (a.role && a.role !== 'owner' ? ' <span class="ta-dim">' + esc(ROLES[a.role] || a.role) + '</span>' : '') + '</td>' +
            '<td>' + esc(collName(a.coll, a.row_id)) + ' ' + esc(a.action) + '</td><td>' + esc(a.summary || '') + '</td></tr>';
        }).join('') : '<tr><td colspan="4" class="ta-dim">' + (T.act ? 'No activity recorded yet. It starts once team_access_setup.sql has been run.' : 'Loading…') + '</td></tr>') +
        '</tbody></table></div></div>';
    }
    return h;
  }
  function renderTeamPanel(fromLoad){
    var host = document.getElementById('tabSettings'); if(!host) return;
    var box = document.getElementById('ttTeamBox');
    var html = teamHtml();
    if(!html){ if(box) box.remove(); return; }
    if(!box){ box = document.createElement('div'); box.id = 'ttTeamBox'; host.insertBefore(box, host.firstChild); }
    box.innerHTML = html;
    if(!fromLoad && (T.list === null || T.act === null)) loadTeam();
  }
  // Load fresh whenever Settings opens.
  document.addEventListener('click', function(e){
    var t = e.target.closest && e.target.closest('.tab-btn[data-tab="settings"]');
    if(t && (current.role === 'owner' || current.role === 'manager')) setTimeout(loadTeam, 50);
  });
  async function upd(email, patch){
    var r = await sb().from('studio_team').update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq('email', email);
    if(r.error){ T.err = r.error.message; renderTeamPanel(true); return; }
    loadTeam();
  }
  document.addEventListener('click', async function(e){
    var b = e.target.closest && e.target.closest('[data-ta]'); if(!b) return;
    var a = b.getAttribute('data-ta');
    if(a === 'add'){
      var name = (document.getElementById('taName').value || '').trim(), email = (document.getElementById('taEmail').value || '').trim().toLowerCase(), role = document.getElementById('taRole').value;
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showToast('Enter a valid email'); return; }
      var r = await sb().from('studio_team').upsert({ email: email, name: name, role: role, active: true, added_by: current.email, updated_at: new Date().toISOString() }, { onConflict: 'email' });
      if(r.error){ T.err = r.error.message; renderTeamPanel(true); return; }
      showToast((name || email) + ' added as ' + ROLES[role] + '. They sign in here with ' + email + '.');
      loadTeam();
    } else if(a === 'remove'){
      var em = b.getAttribute('data-e');
      showConfirmModal('Remove ' + em + ' from Studio? They lose access at their next sync. Their past activity stays in the log.', async function(){
        var r = await sb().from('studio_team').delete().eq('email', em);
        if(r.error){ T.err = r.error.message; renderTeamPanel(true); return; }
        loadTeam();
      }, 'Remove');
    } else if(a === 'refresh') loadTeam();
  });
  document.addEventListener('change', function(e){
    var f = e.target.getAttribute && e.target.getAttribute('data-ta-f');
    if(f){ var em = e.target.getAttribute('data-e'); upd(em, f === 'active' ? { active: e.target.checked } : f === 'role' ? { role: e.target.value } : { name: e.target.value.trim() }); }
    if(e.target.id === 'taWho'){ T.who = e.target.value; loadTeam(); }
  });

  var css = document.createElement('style');
  css.textContent = [
    '#ttTeamBox .ta-dim{color:var(--dim);font-size:12.5px}',
    '#ttTeamBox .ta-err{color:var(--red);font-size:12.5px}',
    '#ttTeamBox .ta-t{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}',
    '#ttTeamBox .ta-t th{text-align:left;font-weight:500;color:var(--dim);font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line)}',
    '#ttTeamBox .ta-t td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:middle}',
    '#ttTeamBox input,#ttTeamBox select{padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--input-bg, var(--panel));color:var(--text);font:inherit;font-size:13px}',
    '#ttTeamBox .ta-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}',
    '#ttTeamBox .ta-btn{background:transparent;border:1px solid var(--line);border-radius:8px;padding:6px 12px;font:13px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer}',
    '#ttTeamBox .ta-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600}',
    '#ttTeamBox .ta-roles summary{cursor:pointer;color:var(--dim);font-size:12.5px;margin-top:6px}',
    '#ttTeamBox .ta-tw{max-height:420px;overflow:auto}',
    '#ttTeamBox .ta-nw{white-space:nowrap}',
    '#ttTeamBox .ta-sw{display:inline-flex;align-items:center;gap:6px;font-size:12.5px}'
  ].join('');
  document.head.appendChild(css);

  // Sign-in may have finished before this file loaded.
  if(typeof cloud !== 'undefined' && cloud.role) setTimeout(function(){ applyRole(cloud.role, cloud.email); }, 0);

  window.TTAccess = { roles: ROLES, tabAllowed: tabAllowed, canRead: canRead, canWrite: canWrite, role: function(){ return current.role; } };
})();
