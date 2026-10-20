// ===================================================================
// ========================= DAILY TASKS (Studio) ====================
// ===================================================================
// Each morning, a task list per department is lined up from the orders:
//   Sales:      shipped orders to follow up, delivered orders to collect payment on,
//               overdue payments to chase, quotes waiting, delivered orders to ask
//               for a reorder.
//   Production: booked orders to start, orders due soon, orders at risk of missing
//               their date, made orders ready to pack and dispatch.
// The list is fixed for the day once lined up (so ticks stay put), saved with the
// Studio data so the whole team sees the same ticks, and can be refreshed to add
// anything new. Shown on Home; sales reps open on the Sales list.
(function(){
  if(window.TT_STOCK_MODE) return;

  const KEEP_DAYS = 14;
  const DEPTS = [['all', 'All'], ['sales', 'Sales'], ['production', 'Production']];
  const V = { dept: null };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function dayDiff(a, b){ return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
  function fmt(s){ if(!s) return ''; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function rupees(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function client(id){ return (state.clients || []).find(function(c){ return c.id === id; }); }
  function who(o){ const c = client(o.clientId); return (c && c.name) || o.clientName || o.name || 'Walk-in'; }
  function label(o){ return (o.displayId ? o.displayId + ' · ' : '') + who(o); }
  function target(o){ return o.dispatchBy || o.dueDate || ''; }
  function owed(o){ return orderOwed(o); }
  function me(){ return ((typeof cloud !== 'undefined' && cloud.email) || '').toLowerCase(); }

  function store(){
    if(!state.dailyTasks || typeof state.dailyTasks !== 'object') state.dailyTasks = {};
    return state.dailyTasks;
  }

  // ---------- what each department should do today ----------
  function generate(){
    const t = today(), out = [];
    const add = function(dept, kind, o, text, detail, rank){ out.push({ id: dept + ':' + kind + ':' + o.id, dept: dept, kind: kind, orderId: o.id, text: text, detail: detail || '', rank: rank || 0 }); };
    const fc = window.TTControl ? window.TTControl.forecast() : { finish: {} };

    state.orders.forEach(function(o){
      const s = o.status, due = target(o);
      // ----- Sales -----
      if(s === 'production_done' && o.shippedDate){
        const d = dayDiff(t, o.shippedDate.slice(0, 10));
        add('sales', 'shipped', o, 'Share tracking and confirm delivery: ' + label(o),
          'Shipped ' + fmt(o.shippedDate) + (o.courier ? ' · ' + o.courier : '') + (o.trackingNo ? ' · ' + o.trackingNo : '') + (d > 5 ? ' · ' + d + ' days in transit' : ''), d > 5 ? 1 : 3);
      }
      if(s === 'delivered' && owed(o) > 0){
        const since = (o.deliveryDate || '').slice(0, 10), d = since ? dayDiff(t, since) : 0;
        if(d > 7) add('sales', 'chase', o, 'Chase payment ' + rupees(owed(o)) + ': ' + who(o), (o.displayId || '') + ' · delivered ' + d + ' days ago', 0);
        else add('sales', 'collect', o, 'Collect payment ' + rupees(owed(o)) + ': ' + who(o), (o.displayId || '') + ' · delivered ' + (since ? fmt(since) : 'recently') + ' · due within 7 days', 2);
      }
      if(s === 'delivered' && owed(o) === 0){
        const since = (o.deliveryDate || '').slice(0, 10);
        if(since && dayDiff(t, since) === 3) add('sales', 'reorder', o, 'Ask for feedback and the next order: ' + who(o), (o.displayId || '') + ' · delivered ' + fmt(since), 5);
      }
      if(s === 'quoted'){
        const q = (o.quotedDate || o.orderedDate || '').slice(0, 10), d = q ? dayDiff(t, q) : 0;
        if(d >= 3) add('sales', 'quote', o, 'Follow up on the quote: ' + who(o), rupees(orderTotals(o).grandTotal) + ' · sent ' + d + ' days ago', 4);
      }
      // ----- Production -----
      if(s === 'booked'){
        add('production', 'start', o, 'Plan and start: ' + label(o), due ? 'Due ' + fmt(due) + (due < t ? ' · late' : due <= addDays(t, 3) ? ' · due soon' : '') : 'No due date set', due && due <= addDays(t, 3) ? 0 : 2);
      }
      if(s === 'in_production' && due){
        const finish = fc.finish[o.id];
        if(due < t) add('production', 'late', o, 'Late, finish first: ' + label(o), 'Was due ' + fmt(due) + (finish ? ' · forecast ' + fmt(finish) : ''), 0);
        else if(finish && finish > due) add('production', 'risk', o, 'At risk, add printers or partners: ' + label(o), 'Due ' + fmt(due) + ' · forecast ' + fmt(finish), 1);
        else if(due <= addDays(t, 2)) add('production', 'due', o, 'Due ' + (due === t ? 'today' : fmt(due)) + ': ' + label(o), finish ? 'Forecast ' + fmt(finish) : '', 1);
      }
      if(s === 'production_done' && !o.shippedDate){
        add('production', 'dispatch', o, 'Pack and dispatch: ' + label(o), (due ? 'Ship by ' + fmt(due) : 'No ship date') + ' · made ' + fmt(o.productionDoneDate), due && due <= t ? 0 : 2);
      }
    });
    out.sort(function(a, b){ return a.rank - b.rank; });
    return out;
  }

  // Lines up the day's list the first time it is opened that day; Refresh adds new tasks.
  function day(refresh){
    const S = store(), t = today();
    let d = S[t];
    // Orders not loaded yet (first paint, or cloud sync still pulling): show, don't save.
    if(!(state.orders || []).length) return d || { at: '', items: [] };
    if(!d || refresh){
      const fresh = generate(), prev = d ? d.items : [];
      const keep = {};
      prev.forEach(function(x){ keep[x.id] = x; });
      const items = fresh.map(function(x){ return keep[x.id] ? Object.assign(x, { done: keep[x.id].done, by: keep[x.id].by, at: keep[x.id].at }) : x; });
      // Ticked tasks that no longer apply stay on the list as done, so the day's record is complete.
      prev.forEach(function(x){ if(x.done && !items.some(function(y){ return y.id === x.id; })) items.push(x); });
      d = S[t] = { at: new Date().toISOString(), items: items };
      Object.keys(S).sort().slice(0, -KEEP_DAYS).forEach(function(k){ delete S[k]; });
      if(typeof scheduleSave === 'function') scheduleSave();
    }
    return d;
  }

  function defaultDept(){
    const reps = window.TTSales && window.TTSales.reps ? window.TTSales.reps() : [];
    if(me() && reps.some(function(r){ return (r.email || '').toLowerCase() === me(); })) return 'sales';
    return 'all';
  }

  function html(){
    const d = day(false);
    if(V.dept == null) V.dept = defaultDept();
    const shown = d.items.filter(function(x){ return V.dept === 'all' || x.dept === V.dept; });
    const count = function(dep){ const list = d.items.filter(function(x){ return dep === 'all' || x.dept === dep; }); return list.filter(function(x){ return !x.done; }).length + '/' + list.length; };
    let h = '<div class="home-section oh-card dt-card"><div class="oh-title"><span>Today’s tasks</span><span>' +
      '<button class="oh-link" data-dt="refresh">Refresh</button><button class="oh-link" data-dt="share">Share on WhatsApp</button></span></div>' +
      '<div class="dt-tabs">' + DEPTS.map(function(x){ return '<button class="dt-tab' + (V.dept === x[0] ? ' on' : '') + '" data-dt="dept" data-id="' + x[0] + '">' + x[1] + ' <span>' + count(x[0]) + '</span></button>'; }).join('') + '</div>';
    if(!shown.length) h += '<div class="oh-empty">Nothing lined up for ' + (V.dept === 'all' ? 'today' : 'this team today') + '.</div>';
    else {
      const open = shown.filter(function(x){ return !x.done; }), done = shown.filter(function(x){ return x.done; });
      h += open.concat(done).map(function(x){
        return '<label class="dt-row' + (x.done ? ' done' : '') + '"><input type="checkbox" data-dt="tick" data-id="' + esc(x.id) + '"' + (x.done ? ' checked' : '') + '>' +
          '<span class="dt-text">' + esc(x.text) + '<span class="oh-detail">' + esc(x.detail) + (x.done && x.by ? ' · done by ' + esc(x.by.split('@')[0]) : '') + '</span></span>' +
          (V.dept === 'all' ? '<span class="dt-dept dt-' + x.dept + '">' + (x.dept === 'sales' ? 'Sales' : 'Production') + '</span>' : '') +
          '<button class="oh-btn" data-dt="open" data-id="' + esc(x.orderId) + '">Open</button></label>';
      }).join('');
    }
    return h + '</div>';
  }

  function shareText(){
    const d = day(false), dept = V.dept || 'all';
    const list = d.items.filter(function(x){ return !x.done && (dept === 'all' || x.dept === dept); });
    const head = 'Thread Tribe · ' + (dept === 'all' ? 'Today’s tasks' : (dept === 'sales' ? 'Sales' : 'Production') + ' tasks') + ' · ' + new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    return head + '\n' + (list.length ? list.map(function(x, i){ return (i + 1) + '. ' + x.text + (x.detail ? ' (' + x.detail + ')' : ''); }).join('\n') : 'All done.');
  }

  function rerender(){ if(window.TTOwnerHome) window.TTOwnerHome.render(); }

  document.addEventListener('click', function(e){
    const b = e.target.closest('[data-dt]');
    if(!b || b.tagName === 'INPUT') return;
    const act = b.getAttribute('data-dt'), id = b.getAttribute('data-id');
    if(act === 'dept'){ V.dept = id; rerender(); }
    else if(act === 'refresh'){ day(true); rerender(); if(window.ttToast) window.ttToast('Task list refreshed'); }
    else if(act === 'open'){ e.preventDefault(); if(typeof openOrderDetailModal === 'function') openOrderDetailModal(id); }
    else if(act === 'share'){
      const link = (state.fleet && state.fleet.teamWhatsappLink) || '';
      const text = shareText();
      if(navigator.clipboard) navigator.clipboard.writeText(text).catch(function(){});
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      if(window.ttToast) window.ttToast(link ? 'Copied. Paste it in the team group if WhatsApp asks who to send to' : 'Copied and opened WhatsApp');
    }
  });
  document.addEventListener('change', function(e){
    const b = e.target.closest('input[data-dt="tick"]');
    if(!b) return;
    const it = day(false).items.find(function(x){ return x.id === b.getAttribute('data-id'); });
    if(!it) return;
    it.done = b.checked; it.by = b.checked ? (me() || 'someone') : ''; it.at = b.checked ? new Date().toISOString() : '';
    if(typeof scheduleSave === 'function') scheduleSave();
    rerender();
  });

  const css = document.createElement('style');
  css.textContent =
    '.dt-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}' +
    '.dt-tab{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}' +
    '.dt-tab span{color:var(--dim);font-size:12px;margin-left:4px}.dt-tab.on{border-color:var(--cyan);color:var(--cyan)}' +
    '.dt-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line);font-size:14px;cursor:pointer}' +
    '.dt-row input{width:18px;height:18px;flex:none;accent-color:var(--cyan)}' +
    '.dt-text{flex:1;min-width:0}.dt-row.done .dt-text{color:var(--dim);text-decoration:line-through}' +
    '.dt-dept{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;white-space:nowrap}.dt-sales{color:var(--pink);border-color:var(--pink)}.dt-production{color:var(--cyan);border-color:var(--cyan)}';
  document.head.appendChild(css);

  window.TTDaily = { html: html, day: day, generate: generate };
})();
