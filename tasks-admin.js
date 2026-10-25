// ===================================================================
// =========================== TASKS (Studio) ========================
// ===================================================================
// One task board for the whole team (replaces Upbase) and "My day" at the top of Home.
// Tasks can be given to anyone who signs in (admins, salespeople, the marketing team) or to
// floor staff by name, and can point at an order, client, campaign or product. Salespeople see
// and tick off their tasks in the Sales app.
// Table: team_tasks (~/PrintFarm/tt-bridge/team_tasks_setup.sql). Signed out, tasks stay on
// this device (state.tasksLocal).
(function(){
  if(window.TT_STOCK_MODE) return;

  const STATUS = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']];
  const PRIO = [['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']];
  const X = { rows: [], loaded: false, loading: false, missing: false, local: false };
  const V = { who: 'all', q: '', overdue: false };

  // ---------- helpers ----------
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function fmt(s){ if(!s) return ''; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function me(){ return ((typeof cloud !== 'undefined' && cloud.email) || '').toLowerCase(); }
  function uid(){ return 'tk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function label(list, k){ const x = list.find(function(i){ return i[0] === k; }); return x ? x[1] : k; }
  function initials(n){ return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function(w){ return w[0]; }).join('').toUpperCase(); }

  // Everyone a task can go to: people who sign in, plus floor staff added by name.
  function people(){
    const out = [], seen = {};
    function add(email, name, role){ const k = email || 'name:' + name.toLowerCase(); if(seen[k] || !name) return; seen[k] = 1; out.push({ email: email || '', name: name, role: role }); }
    if(me()) add(me(), (state.business && state.business.signName) || 'Me', 'Admin');
    ((window.TTSales && window.TTSales.reps()) || []).filter(function(r){ return r.active !== false; }).forEach(function(r){ add(r.email, r.name, 'Sales'); });
    ((window.TTMarketing && window.TTMarketing.team && window.TTMarketing.team()) || []).filter(function(m){ return m.active !== false; }).forEach(function(m){ add(m.email, m.name, 'Marketing'); });
    (state.taskPeople || []).forEach(function(n){ add('', n, 'Floor'); });
    return out;
  }
  function personKey(t){ return t.assignee_email || (t.data.assigneeName ? 'name:' + t.data.assigneeName.toLowerCase() : ''); }
  function personName(t){ if(!t.assignee_email) return t.data.assigneeName || 'Unassigned'; const p = people().find(function(x){ return x.email === t.assignee_email; }); return p ? p.name : t.assignee_email.split('@')[0]; }
  function linkLabel(l){
    if(!l || !l.type) return '';
    if(l.type === 'order'){ const o = state.orders.find(function(x){ return x.id === l.id; }); return o ? (o.displayId || 'Order') + ' · ' + (o.clientName || o.name || '') : l.label || 'Order'; }
    if(l.type === 'client'){ const c = (state.clients || []).find(function(x){ return x.id === l.id; }); return c ? c.name : l.label || 'Client'; }
    if(l.type === 'campaign'){ const c = ((window.TTMarketing && window.TTMarketing.campaigns()) || []).find(function(x){ return x.id === l.id; }); return c ? 'Campaign · ' + c.name : l.label || 'Campaign'; }
    if(l.type === 'product') return 'Product · ' + (l.label || l.id);
    return l.label || '';
  }

  // ---------- data ----------
  async function load(){
    if(X.loading) return; X.loading = true;
    try{
      if(!on()){ X.local = true; X.missing = false; X.rows = Array.isArray(state.tasksLocal) ? state.tasksLocal : (state.tasksLocal = []); X.loaded = true; return; }
      X.local = false;
      const r = await cloud.sb.from('team_tasks').select('id,assignee_email,status,due,data,created_by,updated_by,updated_at').limit(5000);
      if(r.error){ X.missing = /team_tasks|does not exist|schema cache|relation/i.test(r.error.message || ''); X.loaded = true; return; }
      X.rows = (r.data || []).map(function(t){ t.data = t.data || {}; return t; }); X.missing = false; X.loaded = true;
    } finally { X.loading = false; }
  }
  async function save(t){
    t.updated_at = new Date().toISOString();
    const i = X.rows.findIndex(function(x){ return x.id === t.id; });
    if(i === -1) X.rows.push(t); else X.rows[i] = t;
    if(X.local){ state.tasksLocal = X.rows; scheduleSave(); return true; }
    const r = await cloud.sb.from('team_tasks').upsert({ id: t.id, assignee_email: t.assignee_email || null, status: t.status, due: t.due || null, data: t.data });
    if(r.error){ showNoticeModal('Couldn’t save the task: ' + r.error.message); return false; }
    return true;
  }
  async function remove(id){
    X.rows = X.rows.filter(function(t){ return t.id !== id; });
    if(X.local){ state.tasksLocal = X.rows; scheduleSave(); return; }
    const r = await cloud.sb.from('team_tasks').delete().eq('id', id); if(r.error) showNoticeModal(r.error.message);
  }
  function newTask(title, who, due, prio, link){
    const p = people().find(function(x){ return (x.email || 'name:' + x.name.toLowerCase()) === who; });
    return { id: uid(), assignee_email: p && p.email ? p.email : null, status: 'todo', due: due || null,
      data: { title: title, priority: prio || 'normal', assigneeName: p && !p.email ? p.name : '', link: link || null, created_at: new Date().toISOString() } };
  }
  async function setStatus(t, st){ t.status = st; t.data.done_at = st === 'done' ? new Date().toISOString() : ''; await save(t); }

  // ---------- views ----------
  function overdue(t){ return t.status !== 'done' && t.due && t.due < today(); }
  function cardHtml(t){
    const pr = t.data.priority || 'normal';
    return '<div class="tk-card' + (overdue(t) ? ' late' : '') + '" data-tk="edit" data-id="' + t.id + '" draggable="true">' +
      '<div class="tk-card-t"><button class="tk-check' + (t.status === 'done' ? ' on' : '') + '" data-tk="toggle" data-id="' + t.id + '" title="Mark done">' + (t.status === 'done' ? '✓' : '') + '</button><b>' + esc(t.data.title || 'Untitled') + '</b></div>' +
      '<div class="tk-meta">' + (personKey(t) ? '<span class="tk-av" title="' + esc(personName(t)) + '">' + esc(initials(personName(t))) + '</span>' : '<span class="tk-unas">Unassigned</span>') +
        (t.due ? '<span class="' + (overdue(t) ? 'tk-bad' : '') + '">' + (overdue(t) ? 'Late · ' : '') + fmt(t.due) + '</span>' : '') +
        (pr !== 'normal' ? '<span class="tk-pr ' + pr + '">' + esc(label(PRIO, pr)) + '</span>' : '') +
        (t.data.link ? '<span class="tk-link" data-tk="link" data-id="' + t.id + '">' + esc(linkLabel(t.data.link)) + '</span>' : '') + '</div></div>';
  }
  function filtered(){
    const q = V.q.trim().toLowerCase();
    return X.rows.filter(function(t){
      if(V.who === 'me' && t.assignee_email !== me()) return false;
      if(V.who !== 'all' && V.who !== 'me' && personKey(t) !== V.who) return false;  // '' = unassigned
      if(V.overdue && !overdue(t)) return false;
      return !q || [t.data.title, t.data.notes, personName(t), linkLabel(t.data.link)].join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }
  function render(){
    const root = document.getElementById('tasksRoot'); if(!root) return;
    if(!X.loaded){ root.innerHTML = '<p class="tk-dim">Loading…</p>'; load().then(render); return; }
    const ps = people(), list = filtered();
    const sort = function(a, b){ return (a.due || '9999').localeCompare(b.due || '9999') || PRIO.findIndex(function(p){ return p[0] === a.data.priority; }) - PRIO.findIndex(function(p){ return p[0] === b.data.priority; }); };
    let h = '<div class="tk-head"><div><div class="tk-title">Tasks</div><div class="tk-dim">One board for the whole team' + (X.local ? ' · on this device only (sign in to share)' : '') + '</div></div>' +
      '<label class="tk-btn">Import from Upbase (CSV)<input type="file" accept=".csv,text/csv" data-tk-file hidden></label></div>';
    if(X.missing) h += '<div class="tk-note">Run <b>team_tasks_setup.sql</b> in Supabase to share tasks with the team.</div>';
    h += '<div class="panel tk-add"><input data-tk-new="title" placeholder="Add a task, e.g. Pack TT-151 for dispatch">' +
      '<select data-tk-new="who"><option value="">Unassigned</option>' + ps.map(function(p){ return '<option value="' + esc(p.email || 'name:' + p.name.toLowerCase()) + '">' + esc(p.name) + ' (' + p.role + ')</option>'; }).join('') + '</select>' +
      '<input type="date" data-tk-new="due" value="' + today() + '"><select data-tk-new="prio">' + PRIO.map(function(p){ return '<option value="' + p[0] + '"' + (p[0] === 'normal' ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select>' +
      '<select data-tk-new="link"><option value="">Link to…</option>' + linkOptions('') + '</select><button class="tk-btn primary" data-tk="add">Add</button></div>';
    // Open tasks per person on the filter chips, so the load is visible at a glance.
    const open = X.rows.filter(function(t){ return t.status !== 'done'; });
    const n = function(fn){ const c = open.filter(fn).length; return c ? ' <span class="tk-n">' + c + '</span>' : ''; };
    const lateN = open.filter(overdue).length;
    h += '<div class="tk-bar"><div class="tk-chips"><button class="' + (V.who === 'all' ? 'on' : '') + '" data-tk-who="all">Everyone' + n(function(){ return true; }) + '</button>' + (me() ? '<button class="' + (V.who === 'me' ? 'on' : '') + '" data-tk-who="me">Mine' + n(function(t){ return t.assignee_email === me(); }) + '</button>' : '') +
      ps.filter(function(p){ return !p.email || p.email !== me(); }).map(function(p){ const k = p.email || 'name:' + p.name.toLowerCase(); return '<button class="' + (V.who === k ? 'on' : '') + '" data-tk-who="' + esc(k) + '">' + esc(p.name) + n(function(t){ return personKey(t) === k; }) + '</button>'; }).join('') +
      (open.some(function(t){ return !personKey(t); }) ? '<button class="' + (V.who === '' ? 'on' : '') + '" data-tk-who="">Unassigned' + n(function(t){ return !personKey(t); }) + '</button>' : '') + '</div>' +
      '<button class="tk-btn' + (V.overdue ? ' primary' : '') + '" data-tk="overdue">Late only' + (lateN ? ' · ' + lateN : '') + '</button><input class="tk-q" data-tk-q placeholder="Search tasks" value="' + esc(V.q) + '"></div>';
    const work = orderWork(), hint = { todo: 'Nothing to do. Add a task above.', doing: 'Drag a card here when someone starts on it.', done: 'Tick a card or drag it here when it’s finished.' };
    h += '<div class="tk-board' + (work ? ' four' : '') + '">' + (work || '') + STATUS.map(function(st){
      let col = list.filter(function(t){ return t.status === st[0]; });
      if(st[0] === 'done') col = col.filter(function(t){ return (t.data.done_at || t.updated_at || '') >= addDays(today(), -14); }).sort(function(a, b){ return (b.data.done_at || '').localeCompare(a.data.done_at || ''); });
      else col.sort(sort);
      return '<div class="tk-col" data-tk-drop="' + st[0] + '"><div class="tk-col-h">' + st[1] + ' <b>' + col.length + '</b>' + (st[0] === 'done' ? '<i>last 14 days</i>' : '') + '</div>' + (col.length ? col.map(cardHtml).join('') : '<div class="tk-empty">' + hint[st[0]] + '</div>') + '</div>';
    }).join('') + '</div>';
    h += '<details class="tk-floor"><summary>Floor staff without a login</summary><p class="tk-dim">Give tasks to people who don’t sign in (print-farm staff, packers) by name.</p><div class="tk-chips">' +
      (state.taskPeople || []).map(function(n){ return '<button data-tk="rm-person" data-n="' + esc(n) + '">' + esc(n) + ' ✕</button>'; }).join('') + '</div><div class="tk-add"><input data-tk-person placeholder="Name"><button class="tk-btn" data-tk="add-person">Add person</button></div></details>';
    root.innerHTML = h;
  }
  // Today's order work from Studio (the same list as Today's tasks on Home): ticking it here
  // ticks it there, and "Give to…" turns one into a team task linked to the order.
  function orderWork(){
    if(!window.TTDaily || !(state.orders || []).length) return '';
    const d = window.TTDaily.day(false), items = (d.items || []).filter(function(x){ return !x.done && !x.taskId; });
    const q = V.q.trim().toLowerCase(), shown = q ? items.filter(function(x){ return (x.text + ' ' + x.detail).toLowerCase().indexOf(q) !== -1; }) : items;
    return '<div class="tk-col tk-work"><div class="tk-col-h">From orders today <b>' + shown.length + '</b><i>auto</i></div>' +
      (shown.length ? shown.map(function(x){
        return '<div class="tk-card tk-wcard"><div class="tk-card-t"><input type="checkbox" class="tk-wtick" data-dt="tick" data-id="' + esc(x.id) + '" title="Mark done"><b>' + esc(x.text) + '</b></div>' +
          '<div class="tk-meta"><span class="dt-dept dt-' + x.dept + '">' + (x.dept === 'sales' ? 'Sales' : 'Production') + '</span>' + (x.detail ? '<span>' + esc(x.detail) + '</span>' : '') + '</div>' +
          '<div class="tk-wact"><button class="tk-mini" data-dt="open" data-id="' + esc(x.orderId) + '">Open order</button><button class="tk-mini" data-tk="give" data-wid="' + esc(x.id) + '">Give to…</button></div></div>';
      }).join('') : '<div class="tk-empty">All of today’s order work is done.</div>') + '</div>';
  }
  function giveWork(wid){
    const d = window.TTDaily && window.TTDaily.day(false), x = d && d.items.find(function(i){ return i.id === wid; }); if(!x) return;
    const t = newTask(x.text, '', today(), x.rank === 0 ? 'high' : 'normal', { type: 'order', id: x.orderId });
    t.data.notes = x.detail || ''; t.data.source = 'daily:' + x.id;
    edit(t, function(saved){ if(saved){ x.taskId = saved.id; scheduleSave(); } });
  }
  function linkOptions(cur){
    // Open orders, plus the order already linked (it may be delivered, e.g. a payment to chase).
    const os = state.orders.filter(function(o){ return 'order:' + o.id === cur || ['quoted', 'lost', 'cancelled', 'returned', 'delivered'].indexOf(o.status) === -1; }).slice(0, 60).map(function(o){ return ['order:' + o.id, (o.displayId || 'Order') + ' · ' + (o.clientName || o.name || '')]; });
    const cs = (state.clients || []).slice(0, 80).map(function(c){ return ['client:' + c.id, 'Client · ' + c.name]; });
    const ms = ((window.TTMarketing && window.TTMarketing.campaigns()) || []).map(function(c){ return ['campaign:' + c.id, 'Campaign · ' + c.name]; });
    const group = function(name, l){ return l.length ? '<optgroup label="' + name + '">' + l.map(function(x){ return '<option value="' + esc(x[0]) + '"' + (cur === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</optgroup>' : ''; };
    return group('Orders', os) + group('Clients', cs) + group('Campaigns', ms);
  }
  function parseLink(v){ if(!v) return null; const i = v.indexOf(':'); return { type: v.slice(0, i), id: v.slice(i + 1) }; }
  window.renderTasks = function(){ X.loaded = false; render(); };

  // ---------- My day (top of Home) ----------
  function myDayHtml(){
    if(!X.loaded) return '';
    const t = today(), mine = X.rows.filter(function(x){ return x.status !== 'done' && (!me() || x.assignee_email === me() || (!x.assignee_email && !x.data.assigneeName)); });
    const late = mine.filter(overdue), due = mine.filter(function(x){ return x.due === t; }), next = mine.filter(function(x){ return !x.due || x.due > t; }).sort(function(a, b){ return (a.due || '9999').localeCompare(b.due || '9999'); }).slice(0, 3);
    const dispatch = state.orders.filter(function(o){ const d = o.dispatchBy || o.dueDate; return d === t && ['booked', 'in_production', 'production_done'].indexOf(o.status) !== -1 && !o.shippedDate; });
    const posts = ((window.TTMarketing && window.TTMarketing.pieces && window.TTMarketing.pieces()) || []).filter(function(p){ return String(p.postAt || '').slice(0, 10) === t && p.stage !== 'idea'; });
    const follow = ((window.TTSales && window.TTSales.leads()) || []).filter(function(l){ const d = l.data || {}; return ['won', 'lost'].indexOf(l.stage) === -1 && d.nextAt && d.nextAt <= t; });
    const needs = (window.TTAutomations && window.TTAutomations.needs && window.TTAutomations.needs()) || [];
    const row = function(x){ return '<div class="md-task' + (overdue(x) ? ' late' : '') + '"><button class="tk-check" data-tk="toggle" data-id="' + x.id + '"></button><span data-tk="edit" data-id="' + x.id + '">' + esc(x.data.title) + '</span><i>' + (x.due ? (overdue(x) ? 'late · ' : '') + fmt(x.due) : '') + '</i></div>'; };
    const tile = function(n, text, tab){ return '<button class="md-tile' + (n ? ' on' : '') + '" data-md-tab="' + tab + '"><b>' + n + '</b><span>' + text + '</span></button>'; };
    return '<div class="panel md"><div class="md-h"><b>My day</b><span class="tk-dim">' + new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span><button class="tk-btn" data-md-tab="tasks">All tasks</button></div>' +
      '<div class="md-grid"><div><div class="md-sub">My tasks' + (late.length ? ' · <span class="tk-bad">' + late.length + ' late</span>' : '') + '</div>' +
        ((late.length + due.length + next.length) ? late.concat(due).map(row).join('') + (next.length ? '<div class="md-next">Coming up</div>' + next.map(row).join('') : '') : '<p class="tk-dim">Nothing on your list. Add tasks in Tasks.</p>') +
        '<div class="md-quick"><input data-md-new placeholder="Quick add for today"><button class="tk-btn" data-tk="md-add">Add</button></div></div>' +
      '<div class="md-tiles">' + tile(dispatch.length, 'to dispatch today', 'control') + tile(follow.length, 'sales follow-ups due', 'sales') + tile(posts.length, 'Instagram posts today', 'marketing') + tile(needs.length, 'things need you', 'home') + '</div></div></div>';
  }
  function drawMyDay(){
    const home = document.getElementById('tabHome'); if(!home) return;
    let box = document.getElementById('myDay');
    if(!box){ box = document.createElement('div'); box.id = 'myDay'; home.insertBefore(box, home.firstChild); }
    box.innerHTML = myDayHtml();
  }
  if(typeof renderHome === 'function'){
    const orig = renderHome;
    renderHome = function(){ orig.apply(this, arguments); try{ if(!X.loaded) load().then(drawMyDay); else drawMyDay(); }catch(e){ console.warn('[my day]', e); } };
  }

  // ---------- task editor ----------
  let modal = null;
  function edit(t, after){
    if(!modal){ modal = document.createElement('div'); modal.className = 'tk-modal'; document.body.appendChild(modal); }
    const ps = people(), cur = t.data.link ? t.data.link.type + ':' + t.data.link.id : '';
    modal.innerHTML = '<div class="tk-box"><div class="tk-box-h"><b>Task</b><button class="tk-x" data-tkm="close">✕</button></div><div class="tk-box-b">' +
      '<label>Title<input name="title" value="' + esc(t.data.title) + '"></label>' +
      '<div class="tk-2"><label>Who<select name="who"><option value="">Unassigned</option>' + ps.map(function(p){ const k = p.email || 'name:' + p.name.toLowerCase(); return '<option value="' + esc(k) + '"' + (k === personKey(t) ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Due<input type="date" name="due" value="' + esc(t.due || '') + '"></label></div>' +
      '<div class="tk-2"><label>Status<select name="status">' + STATUS.map(function(s){ return '<option value="' + s[0] + '"' + (t.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Priority<select name="prio">' + PRIO.map(function(p){ return '<option value="' + p[0] + '"' + ((t.data.priority || 'normal') === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<label>Linked to<select name="link"><option value="">Nothing</option>' + linkOptions(cur) + '</select></label>' +
      '<label>Notes<textarea name="notes" rows="4">' + esc(t.data.notes || '') + '</textarea></label>' +
      (t.updated_by ? '<p class="tk-dim">Last changed by ' + esc(t.updated_by) + '</p>' : '') +
      '</div><div class="tk-box-f">' + (X.rows.some(function(x){ return x.id === t.id; }) ? '<button class="tk-btn danger" data-tkm="delete">Delete</button>' : '') + '<span style="flex:1"></span><button class="tk-btn" data-tkm="close">Cancel</button><button class="tk-btn primary" data-tkm="save">Save</button></div></div>';
    modal.classList.add('on');
    modal.onclick = async function(e){
      const b = e.target.closest('[data-tkm]'); if(!b && e.target !== modal) return;
      const a = b ? b.getAttribute('data-tkm') : 'close';
      if(a === 'close'){ modal.classList.remove('on'); return; }
      if(a === 'delete'){ showConfirmModal('Delete this task?', async function(){ await remove(t.id); modal.classList.remove('on'); refreshAll(); }, 'Delete'); return; }
      const f = function(n){ return modal.querySelector('[name="' + n + '"]').value.trim(); };
      if(!f('title')){ showNoticeModal('Give the task a title.'); return; }
      const p = ps.find(function(x){ return (x.email || 'name:' + x.name.toLowerCase()) === f('who'); });
      t.data.title = f('title'); t.data.notes = f('notes'); t.data.priority = f('prio'); t.due = f('due') || null;
      t.assignee_email = p && p.email ? p.email : null; t.data.assigneeName = p && !p.email ? p.name : '';
      t.data.link = parseLink(f('link'));
      if(t.status !== f('status')) t.data.done_at = f('status') === 'done' ? new Date().toISOString() : '';
      t.status = f('status');
      if(await save(t)){ modal.classList.remove('on'); if(after) after(t); refreshAll(); showToast('Task saved'); }
    };
  }
  function refreshAll(){ render(); const h = document.getElementById('tabHome'); if(h && h.style.display !== 'none') drawMyDay(); }

  // ---------- Upbase / CSV import ----------
  function parseCSV(text){
    const rows = []; let row = [], cell = '', q = false; text = text.replace(/^﻿/, '');
    for(let i = 0; i < text.length; i++){ const ch = text[i];
      if(q){ if(ch === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; }
      else if(ch === '"') q = true; else if(ch === ','){ row.push(cell); cell = ''; }
      else if(ch === '\n' || ch === '\r'){ if(ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
    if(cell || row.length){ row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map(function(h){ return h.trim().toLowerCase(); });
    return rows.filter(function(r){ return r.some(function(c){ return c.trim(); }); }).map(function(r){ const o = {}; head.forEach(function(h, i){ o[h] = (r[i] || '').trim(); }); return o; });
  }
  function col(r, names){ for(const n of names) for(const k in r) if(k === n || k.indexOf(n) === 0) return r[k]; return ''; }
  function day(v){ v = String(v || '').trim(); let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[0]; m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if(m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); const d = new Date(v); return isNaN(d) ? null : iso(d); }
  async function importCSV(text){
    const rows = parseCSV(text), ps = people(); let n = 0;
    for(const r of rows){
      const title = col(r, ['task name', 'task', 'title', 'name']); if(!title) continue;
      const who = col(r, ['assignee', 'assigned to', 'owner']).toLowerCase();
      const p = ps.find(function(x){ return who && (x.email === who || x.name.toLowerCase() === who || who.indexOf(x.name.toLowerCase()) !== -1); });
      const st = col(r, ['status', 'stage', 'list', 'section']).toLowerCase();
      const t = newTask(title, p ? (p.email || 'name:' + p.name.toLowerCase()) : '', day(col(r, ['due date', 'due', 'deadline'])), /urgent|highest/.test(col(r, ['priority']).toLowerCase()) ? 'urgent' : /high/.test(col(r, ['priority']).toLowerCase()) ? 'high' : 'normal', null);
      t.status = /done|complete|closed/.test(st) ? 'done' : /progress|doing/.test(st) ? 'doing' : 'todo';
      t.data.notes = [col(r, ['description', 'notes', 'details']), col(r, ['list', 'project', 'folder']) ? 'From Upbase list: ' + col(r, ['list', 'project', 'folder']) : '', !p && who ? 'Upbase assignee: ' + who : ''].filter(Boolean).join('\n');
      t.data.source = 'upbase'; if(t.status === 'done') t.data.done_at = new Date().toISOString();
      await save(t); n++;
    }
    return n;
  }

  // ---------- events ----------
  function inScope(e){ const a = document.getElementById('tabTasks'), b = document.getElementById('myDay'); return (a && a.contains(e.target)) || (b && b.contains(e.target)); }
  document.addEventListener('click', async function(e){
    if(!inScope(e)) return;
    const w = e.target.closest('[data-tk-who]'); if(w){ V.who = w.getAttribute('data-tk-who'); render(); return; }
    const mt = e.target.closest('[data-md-tab]'); if(mt){ const b = document.querySelector('.tab-btn[data-tab="' + mt.getAttribute('data-md-tab') + '"]'); if(b) b.click(); return; }
    const b = e.target.closest('[data-tk]'); if(!b) return;
    const a = b.getAttribute('data-tk'), t = X.rows.find(function(x){ return x.id === b.getAttribute('data-id'); });
    if(a === 'toggle' && t){ e.stopPropagation(); await setStatus(t, t.status === 'done' ? 'todo' : 'done'); refreshAll(); if(t.status === 'done' && typeof ttToast === 'function') ttToast('Done: ' + t.data.title, { undo: async function(){ await setStatus(t, 'todo'); refreshAll(); } }); }
    else if(a === 'link' && t){
      e.stopPropagation(); const l = t.data.link || {};
      if(l.type === 'order'){ const i = state.orders.findIndex(function(o){ return o.id === l.id; }); if(i !== -1) openOrderDetailModal(l.id, i); }
      else { const tab = { client: 'clients', campaign: 'marketing', product: 'products' }[l.type]; const tb = tab && document.querySelector('.tab-btn[data-tab="' + tab + '"]'); if(tb) tb.click(); }
    }
    else if(a === 'edit' && t) edit(t);
    else if(a === 'give'){ e.stopPropagation(); giveWork(b.getAttribute('data-wid')); }
    else if(a === 'overdue'){ V.overdue = !V.overdue; render(); }
    else if(a === 'add'){
      const root = document.getElementById('tasksRoot'), g = function(k){ const el = root.querySelector('[data-tk-new="' + k + '"]'); return el ? el.value.trim() : ''; };
      if(!g('title')){ showNoticeModal('Type the task first.'); return; }
      const nt = newTask(g('title'), g('who'), g('due'), g('prio'), parseLink(g('link')));
      if(await save(nt)){ refreshAll(); showToast('Task added'); }
    }
    else if(a === 'md-add'){
      const inp = document.querySelector('#myDay [data-md-new]'); if(!inp || !inp.value.trim()) return;
      const nt = newTask(inp.value.trim(), me() || '', today(), 'normal', null);
      if(await save(nt)) refreshAll();
    }
    else if(a === 'add-person'){
      const inp = document.querySelector('#tasksRoot [data-tk-person]'); const n = inp && inp.value.trim(); if(!n) return;
      state.taskPeople = (state.taskPeople || []).concat([n]).filter(function(x, i, arr){ return arr.indexOf(x) === i; }); scheduleSave(); render();
    }
    else if(a === 'rm-person'){ const n = b.getAttribute('data-n'); state.taskPeople = (state.taskPeople || []).filter(function(x){ return x !== n; }); scheduleSave(); render(); }
  });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Enter' || !inScope(e)) return;
    if(e.target.matches('[data-tk-new="title"]')){ const b = document.querySelector('#tasksRoot [data-tk="add"]'); if(b) b.click(); }
    if(e.target.matches('[data-md-new]')){ const b = document.querySelector('#myDay [data-tk="md-add"]'); if(b) b.click(); }
  });
  // Drag cards between To do, Doing and Done.
  let dragId = null;
  document.addEventListener('dragstart', function(e){
    const c = e.target.closest && e.target.closest('#tasksRoot .tk-card[data-id]'); if(!c) return;
    dragId = c.getAttribute('data-id'); c.classList.add('drag');
    try{ e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; }catch(err){}
  });
  document.addEventListener('dragend', function(){ dragId = null; document.querySelectorAll('#tasksRoot .drag, #tasksRoot .over').forEach(function(el){ el.classList.remove('drag', 'over'); }); });
  document.addEventListener('dragover', function(e){
    const col = dragId && e.target.closest && e.target.closest('#tasksRoot [data-tk-drop]'); if(!col) return;
    e.preventDefault(); document.querySelectorAll('#tasksRoot .over').forEach(function(el){ if(el !== col) el.classList.remove('over'); }); col.classList.add('over');
  });
  document.addEventListener('drop', async function(e){
    const col = dragId && e.target.closest && e.target.closest('#tasksRoot [data-tk-drop]'); if(!col) return;
    e.preventDefault();
    const t = X.rows.find(function(x){ return x.id === dragId; }), st = col.getAttribute('data-tk-drop'); dragId = null;
    if(t && t.status !== st){ await setStatus(t, st); refreshAll(); }
  });
  // A tick on today's order work is saved by Today's tasks; redraw the board after it.
  document.addEventListener('change', function(e){ if(e.target.matches && e.target.matches('#tasksRoot .tk-wtick')) setTimeout(render, 0); });
  document.addEventListener('change', async function(e){
    if(!inScope(e) || !e.target.hasAttribute('data-tk-file')) return;
    const f = e.target.files && e.target.files[0]; if(!f) return;
    const n = await importCSV(await f.text()); e.target.value = '';
    showNoticeModal('Imported ' + n + ' task' + (n === 1 ? '' : 's') + '. Anyone the file names who isn’t on the team yet is noted on the task; add them as floor staff or to Sales/Marketing and reassign.'); render();
  });
  document.addEventListener('input', function(e){
    if(!inScope(e) || !e.target.hasAttribute('data-tk-q')) return;
    V.q = e.target.value; const pos = e.target.selectionStart; render();
    const q = document.querySelector('#tasksRoot [data-tk-q]'); if(q){ q.focus(); try{ q.setSelectionRange(pos, pos); }catch(err){} }
  });

  window.TTTasks = { rows: function(){ return X.rows; }, load: function(){ return X.loaded ? Promise.resolve() : load(); }, add: async function(title, who, due, prio, link, notes){ const t = newTask(title, who, due, prio, link); if(notes) t.data.notes = notes; return save(t); } };
  setTimeout(function(){ load().then(function(){ const h = document.getElementById('tabHome'); if(h && h.style.display !== 'none') drawMyDay(); }).catch(function(){}); }, 2500);

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent = [
    '#tabTasks,#myDay{font-family:"Space Grotesk",sans-serif}',
    '.tk-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin:4px 0 14px}',
    '.tk-title{font-size:26px;font-weight:700;color:var(--text)}',
    '.tk-dim{color:var(--dim);font-size:12.5px} .tk-bad{color:var(--red)}',
    '.tk-note{border:1px solid var(--amber);background:rgba(240,168,60,.08);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px}',
    '.tk-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:7px 13px;font:13px "Space Grotesk",sans-serif;cursor:pointer;white-space:nowrap;display:inline-block}',
    '.tk-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600} .tk-btn.danger{color:var(--red);background:transparent;border-color:rgba(232,97,90,.45)}',
    '.tk-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.tk-add input,.tk-add select{min-height:38px;border-radius:9px;font-family:"Space Grotesk",sans-serif}',
    '.tk-add [data-tk-new="title"]{flex:1 1 260px;min-width:0}',
    '.panel.tk-add{padding:12px}',
    '.tk-add select,.tk-add input[type=date]{width:auto;flex:0 1 auto;max-width:220px}',
    '.tk-add input[type=date]{flex:0 0 150px}',
    '.tk-n{display:inline-block;min-width:18px;padding:0 5px;margin-left:4px;border-radius:999px;background:var(--input-bg);color:var(--dim);font-size:11.5px;line-height:18px;text-align:center}',
    '.tk-chips button.on .tk-n{background:var(--cyan);color:#06201d}',
    '.tk-q{flex:0 1 260px!important}',
    '.tk-board.four{grid-template-columns:repeat(4,minmax(0,1fr))}',
    '.tk-col{transition:background .12s}.tk-col.over{background:rgba(79,209,197,.14);outline:2px dashed var(--cyan);outline-offset:-2px}',
    '.tk-card.drag{opacity:.45}',
    '.tk-empty{border:1.5px dashed var(--line);border-radius:10px;padding:18px 12px;text-align:center;color:var(--dim);font-size:12.5px}',
    '.tk-unas{font-size:11.5px;color:var(--dim);border:1px dashed var(--line);border-radius:999px;padding:1px 8px}',
    '.tk-work{background:rgba(79,209,197,.06);border:1px solid rgba(79,209,197,.25)}',
    '.tk-wcard{cursor:default}.tk-wcard .tk-card-t input{width:18px;height:18px;flex:none;margin:1px 0 0;accent-color:var(--cyan)}',
    '.tk-wact{display:flex;gap:6px}.tk-mini{background:transparent;border:1px solid var(--line);border-radius:7px;padding:3px 9px;font:12px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer}.tk-mini:hover{border-color:var(--cyan)}',
    '.tk-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 12px}',
    '.tk-chips{display:flex;gap:4px;flex-wrap:wrap}',
    '.tk-chips button{border:1px solid var(--line);background:transparent;border-radius:999px;padding:5px 12px;font:13px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer}',
    '.tk-chips button.on{border-color:var(--cyan);background:rgba(79,209,197,.12)}',
    '.tk-q{flex:1 1 200px;min-height:36px;border-radius:9px}',
    '.tk-board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}',
    '.tk-col{background:var(--input-bg);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:120px}',
    '.tk-col-h{font:11px "JetBrains Mono",monospace;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);padding:2px 4px 4px} .tk-col-h i{font-style:normal;text-transform:none;letter-spacing:0;margin-left:6px}',
    '.tk-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 10px;cursor:pointer;display:flex;flex-direction:column;gap:6px}',
    '.tk-card:hover{border-color:var(--cyan)} .tk-card.late{border-left:3px solid var(--red)}',
    '.tk-card-t{display:flex;gap:8px;align-items:flex-start;font-size:13.5px} .tk-card-t b{font-weight:600}',
    '.tk-check{flex:none;width:20px;height:20px;border-radius:6px;border:1.5px solid var(--dim);background:transparent;cursor:pointer;font-size:12px;line-height:1;color:#06201d;padding:0}',
    '.tk-check.on{background:var(--green);border-color:var(--green)}',
    '.tk-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--dim)}',
    '.tk-av{width:22px;height:22px;border-radius:50%;background:rgba(79,209,197,.18);color:var(--text);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}',
    '.tk-pr{border-radius:999px;padding:1px 7px;font-size:11px;border:1px solid var(--line)} .tk-pr.urgent{color:var(--red);border-color:var(--red)} .tk-pr.high{color:var(--amber);border-color:var(--amber)} .tk-pr.low{opacity:.7}',
    '.tk-link{color:var(--cyan);text-decoration:underline;cursor:pointer;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.tk-floor{margin-top:14px} .tk-floor summary{cursor:pointer;font-size:13px;color:var(--dim)} .tk-floor .tk-add{margin-top:8px}',
    '.tk-modal{position:fixed;inset:0;z-index:1100;background:rgba(5,8,12,.6);display:none;align-items:flex-start;justify-content:center;padding:6vh 14px;overflow-y:auto}',
    '.tk-modal.on{display:flex}',
    '.tk-box{background:var(--panel);border-radius:16px;width:min(560px,100%);box-shadow:0 24px 70px rgba(0,0,0,.35);font-family:"Space Grotesk",sans-serif}',
    '.tk-box-h{display:flex;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--line);font-size:17px}',
    '.tk-x{background:none;border:none;font-size:16px;color:var(--dim);cursor:pointer}',
    '.tk-box-b{padding:6px 18px 14px} .tk-box-b label{display:block;font-size:12px;color:var(--dim);margin-top:10px}',
    '.tk-box-b input,.tk-box-b select,.tk-box-b textarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;border-radius:9px;min-height:38px;font:14px "Space Grotesk",sans-serif}',
    '.tk-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.tk-box-f{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--line)}',
    '#myDay .md{margin-bottom:14px}',
    '#myDay .md-h{display:flex;gap:10px;align-items:center;margin-bottom:10px} #myDay .md-h b{font-size:17px} #myDay .md-h .tk-btn{margin-left:auto}',
    '#myDay .md-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px}',
    '#myDay .md-sub{font:11px "JetBrains Mono",monospace;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);margin-bottom:6px}',
    '#myDay .md-task{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--line);font-size:13.5px}',
    '#myDay .md-task span{flex:1;cursor:pointer} #myDay .md-task i{font-style:normal;font-size:12px;color:var(--dim)} #myDay .md-task.late i{color:var(--red)}',
    '#myDay .md-next{font-size:11.5px;color:var(--dim);margin:8px 0 2px}',
    '#myDay .md-quick{display:flex;gap:6px;margin-top:8px} #myDay .md-quick input{flex:1;min-height:34px;border-radius:9px}',
    '#myDay .md-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-content:start}',
    '#myDay .md-tile{text-align:left;background:var(--input-bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;font:inherit;color:var(--dim)}',
    '#myDay .md-tile b{display:block;font-size:22px;color:var(--text)} #myDay .md-tile span{font-size:12px} #myDay .md-tile.on{border-color:var(--cyan)}',
    '@media (max-width:1100px){.tk-board.four{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@media (max-width:760px){.tk-board,.tk-board.four{grid-template-columns:1fr}#myDay .md-grid{grid-template-columns:1fr}.tk-q{flex:1 1 100%!important}}'
  ].join('');
  document.head.appendChild(css);
})();
