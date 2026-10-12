// ===================================================================
// ========================= OWNER HOME (Studio) =====================
// ===================================================================
// The top of Home, for the owner of a semi-automated farm. In ten seconds it
// answers: is the automation running, what needs a decision today, which
// promises are slipping, and is money coming in. It only reads what Studio
// already has (orders, partners, buyer and partner requests, the Control Room
// forecast, the workshop bridge's production stats) and stores nothing.
(function(){
  if(window.TT_STOCK_MODE) return;

  const OPEN = ['booked', 'in_production'];
  const SHOW = 5;
  const H = { all: false, tool: '', text: '' };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function dayDiff(a, b){ return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
  function fmt(s){ if(!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function rupees(v){
    v = Math.round(v || 0);
    if(Math.abs(v) >= 100000) return '₹' + (v / 100000).toFixed(2).replace(/\.?0+$/, '') + 'L';
    return '₹' + v.toLocaleString('en-IN');
  }
  function target(o){ return o.dispatchBy || o.dueDate || ''; }
  function client(id){ return (state.clients || []).find(function(c){ return c.id === id; }); }
  function who(o){ const c = client(o.clientId); return (c && c.name) || o.clientName || o.name || 'Walk-in'; }
  function label(o){ return (o.displayId ? o.displayId + ' · ' : '') + who(o); }
  function prod(){ return (window.TTBuyers && window.TTBuyers.prod()) || {}; }
  function owed(o){ return o.paymentStatus === 'paid' || o.paymentStatus === 'refunded' ? 0 : Math.max(0, Math.round(orderTotals(o).grandTotal - (o.amountPaid || 0))); }

  // Pieces made: Studio's own count, or what the farm saw finish for the line, whichever is higher.
  function made(o){
    const ps = prod()[o.id], lines = (ps && ps.lines) || {};
    let done = 0, qty = 0;
    (o.products || []).forEach(function(p){
      const q = +p.qty || 0, farm = lines[p.id] ? (lines[p.id].made || 0) : 0;
      qty += q; done += Math.min(q, Math.max(+p.already || 0, farm));
    });
    return { done: done, qty: qty };
  }

  // Print hours still to run: pieces not yet made x hours per piece, with the failure buffer.
  function hoursLeft(o){
    const ps = prod()[o.id], lines = (ps && ps.lines) || {}, buf = typeof bufferMult === 'function' ? bufferMult() : 1;
    return (o.products || []).reduce(function(s, p){
      const farm = lines[p.id] ? (lines[p.id].made || 0) : 0;
      return s + Math.max(0, (+p.qty || 0) - Math.max(+p.already || 0, farm)) * (+p.hrs || 0) * buf;
    }, 0);
  }
  window.TTOwnerHomeHelpers = { made: made, hoursLeft: hoursLeft };

  // ---------- is the automation running ----------
  function health(){
    const out = [];
    if(!(typeof cloudIsOn === 'function' && cloudIsOn())) out.push({ level: 1, text: 'Not signed in to cloud sync' });
    let latest = '';
    Object.keys(prod()).forEach(function(k){ const u = prod()[k].updated_at || ''; if(u > latest) latest = u; });
    if(!latest) out.push({ level: 1, text: 'No farm data yet' });
    else {
      const mins = Math.round((Date.now() - new Date(latest)) / 60000);
      if(mins > 20) out.push({ level: 0, text: 'Farm data is ' + (mins > 120 ? Math.round(mins / 60) + ' h' : mins + ' min') + ' old. Check the workshop Mac' });
      else out.push({ level: 2, text: 'Farm data ' + (mins < 1 ? 'just now' : mins + ' min ago') });
    }
    return out;
  }

  // ---------- the farm right now ----------
  function farm(){
    const printers = state.printers || [];
    const total = printers.length || (state.fleet && state.fleet.printers) || 0;
    const down = printers.filter(function(p){ return p.status === 'down'; }).length;
    let printing = 0;
    state.orders.forEach(function(o){ if(OPEN.indexOf(o.status) !== -1 && prod()[o.id]) printing += prod()[o.id].printing_now || 0; });
    printing = Math.min(printing, Math.max(0, total - down));
    const P = state.pon || {};
    const partners = (P.partners || []).filter(function(p){ return p.status !== 'paused'; });
    const jobs = (P.jobs || []).filter(function(j){ return typeof ponIsOpen === 'function' && ponIsOpen(j); });
    return {
      total: total, down: down, printing: printing, idle: Math.max(0, total - down - printing),
      partners: partners.length, ponPrinters: partners.reduce(function(s, p){ return s + (+p.printers || 0); }, 0),
      ponJobs: jobs.length, ponLate: jobs.filter(function(j){ return typeof ponIsOverdue === 'function' && ponIsOverdue(j); }).length
    };
  }

  // ---------- what needs the owner, most urgent first ----------
  function needs(){
    const out = [], t = today();
    const ctl = window.TTControl ? window.TTControl.problems() : { overdue: [], risk: [], unpaid: [] };
    ctl.overdue.forEach(function(x){
      out.push({ level: 0, score: x.late, text: label(x.o) + ' is ' + x.late + ' day' + (x.late === 1 ? '' : 's') + ' late', act: 'order', id: x.o.id, btn: 'Open' });
    });
    state.orders.forEach(function(o){
      if(o.status === 'booked' && target(o) === t)
        out.push({ level: 0, score: 0, text: label(o) + ' is due today and not started', act: 'order', id: o.id, btn: 'Plan it' });
    });
    ctl.risk.forEach(function(x){
      out.push({ level: 1, rank: 0, score: x.by, text: label(x.o) + ' will finish ' + fmt(x.finish) + ', ' + x.by + ' day' + (x.by === 1 ? '' : 's') + ' after it is due', act: 'tab', id: 'control', btn: 'Plan' });
    });
    if(typeof ponOpenRequests === 'function') ponOpenRequests().forEach(function(q){
      out.push({ level: 1, rank: 1, score: 0, text: 'Partner ' + (typeof ponPartnerName === 'function' ? ponPartnerName(q.partner_id) : '') + ' sent a ' + String(q.kind || 'request').replace(/_/g, ' ') + ' request', act: 'tab', id: 'partners', btn: 'Answer' });
    });
    ((window.TTBuyers && window.TTBuyers.requests()) || []).filter(function(q){ return q.status === 'open'; }).forEach(function(q){
      const name = window.TTBuyers.clientName ? window.TTBuyers.clientName(q.client_id) : 'a buyer';
      out.push({ level: 1, rank: 2, score: 0, text: (q.kind === 'order' ? 'Order request' : 'Request') + ' from ' + name + ' in the Buyer app', act: 'tab', id: 'buyers', btn: 'Answer' });
    });
    // Money owed: the oldest one by name, the rest as one line so it can't crowd out the floor.
    if(ctl.unpaid.length){
      const x = ctl.unpaid[0];
      out.push({ level: 1, rank: 3, score: x.days, text: who(x.o) + ' owes ' + rupees(x.due) + ' · ' + x.days + ' days since delivery', act: 'remind', id: x.o.id, btn: 'Remind' });
      if(ctl.unpaid.length > 1){
        const rest = ctl.unpaid.slice(1), sum = rest.reduce(function(s, y){ return s + y.due; }, 0);
        out.push({ level: 1, rank: 4, score: 0, text: rest.length + ' more unpaid order' + (rest.length === 1 ? '' : 's') + ' · ' + rupees(sum) + ' overdue', act: 'tab', id: 'invoices', btn: 'See all' });
      }
    }
    state.orders.forEach(function(o){
      if(o.status !== 'quoted') return;
      const since = o.quotedDate || o.orderedDate || '';
      const days = since ? dayDiff(t, since.slice(0, 10)) : 0;
      if(days > 3) out.push({ level: 2, score: days, text: 'Quote for ' + who(o) + ' · ' + rupees(orderTotals(o).grandTotal) + ' · sent ' + days + ' days ago', act: 'order', id: o.id, btn: 'Follow up' });
    });
    (state.inventory || []).forEach(function(inv){
      if(inv.qty !== undefined && inv.par !== undefined && inv.qty <= inv.par)
        out.push({ level: 2, score: 0, text: (inv.material || '') + ' ' + (inv.color || '') + ' is low · ' + inv.qty + ' g left', act: 'tab', id: 'filament', btn: 'Restock' });
    });
    // Items from the rules switched on in System → Automations.
    if(window.TTAutomations) try{ window.TTAutomations.needs().forEach(function(x){ out.push(x); }); }catch(e){ console.warn('[owner home] automations', e); }
    // Floor problems first, then requests, then money; within each, the worst first.
    out.sort(function(a, b){ return a.level - b.level || (a.rank || 0) - (b.rank || 0) || b.score - a.score; });
    return out;
  }

  // ---------- promises due in the next 7 days ----------
  function promised(){
    const t = today(), until = addDays(t, 7);
    const fc = window.TTControl ? window.TTControl.forecast() : { finish: {} };
    return state.orders.filter(function(o){
      const d = target(o);
      return d && d <= until && !o.shippedDate && (OPEN.indexOf(o.status) !== -1 || o.status === 'production_done');
    }).sort(function(a, b){ return target(a).localeCompare(target(b)); }).slice(0, 8).map(function(o){
      const d = target(o), finish = fc.finish[o.id] || '', m = made(o);
      let state_, cls;
      if(o.status === 'production_done'){ state_ = 'Ready to ship'; cls = 'ok'; }
      else if(d < t){ state_ = 'Late ' + dayDiff(t, d) + 'd'; cls = 'bad'; }
      else if(finish && finish > d){ state_ = 'At risk'; cls = 'warn'; }
      else { state_ = 'On track'; cls = 'ok'; }
      const detail = m.done + ' of ' + m.qty + ' made' + (o.status === 'production_done' ? '' : finish ? ' · finishes ' + fmt(finish) : '') + ' · due ' + fmt(d);
      return { o: o, state: state_, cls: cls, detail: detail };
    });
  }

  // ---------- money this month ----------
  function money(){
    const now = new Date(), start = iso(new Date(now.getFullYear(), now.getMonth(), 1)), end = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const m = typeof computeBusinessMetrics === 'function' ? computeBusinessMetrics({ start: start, end: end }) : { revenue: 0, margin: 0 };
    let collected = 0, due = 0, unpaid = 0;
    state.orders.forEach(function(o){
      const cleared = (o.paymentClearedDate || '').slice(0, 10);
      if(cleared >= start && cleared <= end) collected += +o.amountPaid || orderTotals(o).grandTotal;
      if((o.status === 'delivered' || o.shippedDate) && owed(o) > 0){ due += owed(o); unpaid++; }
    });
    return { booked: m.revenue || 0, collected: collected, due: due, unpaid: unpaid, margin: m.margin || 0 };
  }

  // ---------- the floor today (the owner runs the printers too) ----------
  function floor(){
    const queue = window.TTControl ? window.TTControl.queue() : state.orders.filter(function(o){ return OPEN.indexOf(o.status) !== -1; });
    const next = [];
    queue.forEach(function(o){
      if(next.length >= 5) return;
      const m = made(o), left = Math.max(0, m.qty - m.done);
      if(!left) return;
      const hrs = hoursLeft(o);
      const ps = prod()[o.id] || {};
      next.push({ o: o, left: left, hrs: hrs, printing: ps.printing_now || 0, failed: ps.plates_failed || 0 });
    });
    const t = today(), tomorrow = addDays(t, 1);
    const ship = state.orders.filter(function(o){ return o.status === 'production_done' && !o.shippedDate; })
      .sort(function(a, b){ return (target(a) || '9').localeCompare(target(b) || '9'); }).slice(0, 4);
    const pickups = window.TTPartners && window.TTPartners.ready() ? window.TTPartners.pickups().filter(function(x){ return x.b.date <= tomorrow && !x.b.collectedAt; }).slice(0, 4) : [];
    return { next: next, ship: ship, pickups: pickups, printers: state.printers || [], t: t };
  }

  // ---------- capacity, sales and quality ----------
  function extras(){
    const fc = window.TTControl ? window.TTControl.forecast() : { hours: 0, cap: 0 };
    const load = fc.cap > 0 ? Math.round(100 * fc.hours / (fc.cap * 7)) : null;
    const ponFree = window.TTPartners && window.TTPartners.ready() ? Math.round(window.TTPartners.freePerDay(7)) : null;
    let done = 0, failed = 0;
    Object.keys(prod()).forEach(function(k){ done += prod()[k].plates_done || 0; failed += prod()[k].plates_failed || 0; });
    const leads = (window.TTSales && window.TTSales.leads()) || [];
    const weekAgo = addDays(today(), -7);
    const openStages = ['new', 'contacted', 'meeting', 'quote'];
    return {
      load: load, queueDays: fc.cap > 0 ? Math.ceil(fc.hours / fc.cap) : null, ponFree: ponFree,
      passRate: done + failed >= 3 ? Math.round(100 * done / (done + failed)) : null, failed: failed,
      salesReady: !!(window.TTSales && window.TTSales.loaded()),
      newLeads: leads.filter(function(l){ return ((l.data || {}).createdAt || '') >= weekAgo; }).length,
      openLeads: leads.filter(function(l){ return openStages.indexOf(l.stage) !== -1; }).length,
      quoteLeads: leads.filter(function(l){ return l.stage === 'quote'; }).length
    };
  }

  // ---------- render ----------
  function dot(level){ return '<span class="oh-dot oh-l' + level + '"></span>'; }
  function bar(parts){ return '<div class="oh-bar">' + parts.map(function(p){ return '<i style="width:' + p[0] + '%;background:' + p[1] + '"></i>'; }).join('') + '</div>'; }
  function pct(a, b){ return b > 0 ? Math.round(100 * a / b) : 0; }

  function render(){
    const root = document.getElementById('ownerHome');
    if(!root) return;
    const hl = health(), f = farm(), nd = needs(), pr = promised(), mo = money(), ex = extras();
    const worst = hl.reduce(function(m, x){ return Math.min(m, x.level); }, 2);
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const urgent = nd.filter(function(x){ return x.level < 2; }).length;

    let h = '<div class="oh-head"><div><div class="oh-hello">' + hello + '</div><div class="oh-sub">' +
      new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
      (urgent ? urgent + ' thing' + (urgent === 1 ? '' : 's') + ' need you' : 'nothing urgent needs you') + '</div></div>' +
      '<span class="oh-health oh-h' + worst + '">' + hl.map(function(x){ return esc(x.text); }).join(' · ') + '</span></div>';

    h += '<div class="oh-grid2">' +
      '<div class="home-section oh-card"><div class="oh-title"><span>In-house · ' + f.total + ' printers</span><span>' + pct(f.printing, f.total) + '% printing</span></div>' +
      bar([[pct(f.printing, f.total), 'var(--green)'], [pct(f.idle, f.total), 'var(--line)'], [pct(f.down, f.total), 'var(--red)']]) +
      '<div class="oh-note">' + f.printing + ' printing · ' + f.idle + ' idle · ' + f.down + ' down</div></div>' +
      '<div class="home-section oh-card"><div class="oh-title"><span>PON · ' + f.partners + ' partners, ' + f.ponPrinters + ' printers</span><span>' + f.ponJobs + ' open jobs</span></div>' +
      bar([[pct(f.ponJobs - f.ponLate, Math.max(f.ponJobs, 1)), 'var(--green)'], [pct(f.ponLate, Math.max(f.ponJobs, 1)), 'var(--amber)']]) +
      '<div class="oh-note">' + (f.ponLate ? f.ponLate + ' partner job' + (f.ponLate === 1 ? '' : 's') + ' behind plan' : 'All partner jobs on plan') + '</div></div></div>';

    const shown = H.all ? nd : nd.slice(0, SHOW);
    h += '<div class="home-section oh-card"><div class="oh-title"><span>Needs you</span><span>Most urgent first</span></div>' +
      (shown.length ? shown.map(function(x, i){
        return '<div class="oh-row">' + dot(x.level) + '<span class="oh-text">' + esc(x.text) + '</span>' +
          '<button class="oh-btn" data-oh="' + x.act + '" data-id="' + esc(x.id) + '">' + esc(x.btn) + '</button></div>';
      }).join('') : '<div class="oh-empty">Nothing needs you right now. The farm is running itself.</div>') +
      (nd.length > SHOW ? '<button class="oh-more" data-oh="all">' + (H.all ? 'Show fewer' : 'Show all ' + nd.length) + '</button>' : '') + '</div>';

    const fl = floor();
    h += '<div class="home-section oh-card"><div class="oh-title"><span>Floor today</span><span>' +
      '<button class="oh-link" data-oh="farm">Print farm</button><a class="oh-link" href="' + esc(state.bambuddyUrl || 'http://localhost:8000') + '" target="_blank" rel="noopener">Bambuddy</a>' +
      '<button class="oh-link" data-oh="tab" data-id="scheduler">Scheduler</button></span></div><div class="oh-grid2 oh-floor">' +
      '<div><div class="oh-sub2">Up next in the queue</div>' +
      (fl.next.length ? fl.next.map(function(x){
        return '<div class="oh-row oh-click" data-oh="order" data-id="' + esc(x.o.id) + '"><span class="oh-text">' + esc(label(x.o)) +
          '<span class="oh-detail">' + x.left + ' pcs left · about ' + Math.round(x.hrs) + ' print hrs' +
          (x.printing ? ' · ' + x.printing + ' printing now' : '') + (x.failed ? ' · ' + x.failed + ' failed plate' + (x.failed === 1 ? '' : 's') : '') + '</span></span>' +
          (x.printing ? '<span class="oh-pill oh-ok">Printing</span>' : '<span class="oh-pill oh-warn">Waiting</span>') + '</div>';
      }).join('') : '<div class="oh-empty">Queue is empty. Book or start the next order.</div>') + '</div>' +
      '<div><div class="oh-sub2">Printers · tap to mark down or back up</div><div class="oh-chips">' +
      (fl.printers.length ? fl.printers.map(function(p){
        return '<button class="oh-chip ' + (p.status === 'down' ? 'oh-down' : 'oh-up') + '" data-oh="printer" data-id="' + esc(p.id) + '" title="' + (p.status === 'down' ? 'Down: tap when it is back' : 'Up: tap if it breaks down') + '">' + esc(p.name || 'Printer') + '</button>';
      }).join('') : '<span class="oh-note">Add your printers in Settings.</span>') + '</div>' +
      '<div class="oh-sub2" style="margin-top:12px">Ready to ship and pickups</div>' +
      (fl.ship.length || fl.pickups.length ?
        fl.ship.map(function(o){ return '<div class="oh-row oh-click" data-oh="order" data-id="' + esc(o.id) + '"><span class="oh-text">' + esc(label(o)) + '<span class="oh-detail">Made · ' + (target(o) ? 'ship by ' + fmt(target(o)) : 'no ship date set') + '</span></span><span class="oh-pill oh-ok">Ship</span></div>'; }).join('') +
        fl.pickups.map(function(x){ return '<div class="oh-row"><span class="oh-text">Pickup from ' + esc(x.p.name || 'partner') + '<span class="oh-detail">' + esc((x.job && (x.job.productName || x.job.name)) || 'Partner job') + ' · ' + fmt(x.b.date) + '</span></span><span class="oh-pill ' + (x.b.date < fl.t ? 'oh-bad' : 'oh-warn') + '">' + (x.b.date === fl.t ? 'Today' : x.b.date < fl.t ? 'Overdue' : 'Tomorrow') + '</span></div>'; }).join('')
        : '<div class="oh-empty">Nothing to ship or collect today.</div>') +
      '</div></div></div>';

    h += automationsCard();

    h += '<div class="home-section oh-card"><div class="oh-title"><span>Promised in the next 7 days</span><span>Forecast vs due</span></div>' +
      (pr.length ? pr.map(function(x){
        return '<div class="oh-row oh-click" data-oh="order" data-id="' + esc(x.o.id) + '"><span class="oh-text">' + esc(label(x.o)) +
          '<span class="oh-detail">' + esc(x.detail) + '</span></span><span class="oh-pill oh-' + x.cls + '">' + esc(x.state) + '</span></div>';
      }).join('') : '<div class="oh-empty">No deliveries due in the next 7 days.</div>') + '</div>';

    h += '<div class="oh-money">' +
      '<div class="home-kpi"><div class="kpi-label">Booked this month</div><div class="kpi-val">' + rupees(mo.booked) + '</div></div>' +
      '<div class="home-kpi"><div class="kpi-label">Collected this month</div><div class="kpi-val">' + rupees(mo.collected) + '</div></div>' +
      '<div class="home-kpi oh-click" data-oh="tab" data-id="invoices"><div class="kpi-label">Due to you</div><div class="kpi-val" style="color:' + (mo.due ? 'var(--red)' : 'inherit') + '">' + rupees(mo.due) + '</div><div class="kpi-sub">' + mo.unpaid + ' unpaid order' + (mo.unpaid === 1 ? '' : 's') + '</div></div>' +
      '<div class="home-kpi"><div class="kpi-label">Net margin this month</div><div class="kpi-val">' + Math.round(mo.margin) + '%</div></div></div>';

    h += '<div class="oh-grid2">' +
      '<div class="home-section oh-card"><div class="oh-title"><span>Next 7 days</span><span>Booked load</span></div>' +
      (ex.load == null ? '<div class="oh-note">Set printers and hours per day in Settings to see load.</div>' :
        '<div class="oh-note" style="margin-bottom:4px">In-house ' + ex.load + '%' + (ex.load > 100 ? ' · overbooked' : '') + '</div>' +
        bar([[Math.min(100, ex.load), ex.load > 90 ? 'var(--amber)' : 'var(--green)']]) +
        '<div class="oh-note">Queue clears in about ' + ex.queueDays + ' day' + (ex.queueDays === 1 ? '' : 's') + (ex.ponFree != null ? ' · partners have ' + ex.ponFree + ' free printer-hours a day' : '') + '</div>') + '</div>' +
      '<div class="home-section oh-card"><div class="oh-title"><span>Sales and quality</span><span>This week</span></div>' +
      '<div class="oh-note oh-lines">' +
      (ex.salesReady ? ex.newLeads + ' new lead' + (ex.newLeads === 1 ? '' : 's') + ' · ' + ex.openLeads + ' open in the pipeline<br>' + ex.quoteLeads + ' at quote or sample stage' : 'Pipeline loads when you open Sales') +
      '<br>' + (ex.passRate != null ? 'Pass rate ' + ex.passRate + '% · ' + ex.failed + ' failed plate' + (ex.failed === 1 ? '' : 's') + ' on open orders' : 'Pass rate shows once the farm reports prints') +
      '</div></div></div>';

    root.innerHTML = h;
  }

  // Pinned daily tools as tiles (they open here), rules switched on, and the latest automatic actions.
  function automationsCard(){
    const T = window.TTAutomations;
    if(!T) return '';
    const tiles = T.pinned(), recent = T.recent(3);
    let h = '<div class="home-section oh-card"><div class="oh-title"><span>Automations</span><span>' + T.rulesOn() + ' of ' + T.rulesTotal + ' rules on' +
      '<button class="oh-link" data-oh="tab" data-id="automations">Manage</button></span></div>';
    h += tiles.length ? '<div class="oh-tiles">' + tiles.map(function(t){
      return '<button class="oh-tile' + (H.tool === t.id ? ' on' : '') + '" data-oh="hometool" data-id="' + esc(t.id) + '"><b>' + esc(t.name) + '</b><span>' + esc(t.summary) + '</span></button>';
    }).join('') + '</div>' : '<div class="oh-empty">Pin daily tools with ★ in Automations to see them here.</div>';
    if(H.tool){
      const out = T.runTool(H.tool);
      if(out){
        H.text = out.text || ''; H.html = out.html || '';
        h += '<div class="oh-toolout"><div class="oh-title"><span>' + esc(out.name) + '</span><span>' +
          (out.text ? '<button class="oh-link" data-oh="copytool">Copy</button><a class="oh-link" target="_blank" rel="noopener" href="' + esc(T.wa('', out.text)) + '">WhatsApp</a>' : '') +
          (out.print ? '<button class="oh-link" data-oh="printtool">Print</button>' : '') + '<button class="oh-link" data-oh="hometool" data-id="' + esc(H.tool) + '">Close</button></span></div>' + out.html + '</div>';
      }
    }
    if(recent.length) h += '<div class="oh-sub2" style="margin-top:12px">Latest actions</div>' + recent.map(function(e){
      return '<div class="oh-row"><span class="oh-text">' + esc(e.text) + '<span class="oh-detail">' + new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + '</span></span>' +
        (e.undo ? '<button class="oh-btn" data-oh="undoauto" data-id="' + e.i + '">Undo</button>' : '') + '</div>';
    }).join('');
    return h + '</div>';
  }

  function remind(id){
    const o = state.orders.find(function(x){ return x.id === id; });
    if(!o) return;
    const c = client(o.clientId), raw = String((c && c.phone) || o.clientPhone || '').replace(/\D/g, '');
    const phone = raw.length === 10 ? '91' + raw : raw;
    const msg = 'Hi ' + who(o) + ', a gentle reminder that ' + rupees(owed(o)) + ' is pending for order ' + (o.displayId || '') + '. Thank you! — Thread Tribe';
    if(phone.length >= 11) window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
    else if(typeof openOrderDetailModal === 'function') openOrderDetailModal(o.id);
  }
  function goTab(tab){ const b = document.querySelector('.tab-btn[data-tab="' + tab + '"]'); if(b) b.click(); window.scrollTo(0, 0); }

  document.addEventListener('click', function(e){
    const b = e.target.closest('[data-oh]');
    if(!b || !document.getElementById('ownerHome') || !document.getElementById('ownerHome').contains(b)) return;
    const act = b.getAttribute('data-oh'), id = b.getAttribute('data-id');
    if(act === 'all'){ H.all = !H.all; render(); }
    else if(act === 'order' && typeof openOrderDetailModal === 'function') openOrderDetailModal(id);
    else if(act === 'tab') goTab(id);
    else if(act === 'remind') remind(id);
    else if(act === 'tool' && window.TTAutomations){ H.tool = id; render(); const o = document.querySelector('#ownerHome .oh-toolout'); if(o) o.scrollIntoView({ block: 'nearest' }); }
    else if(act === 'hometool'){ H.tool = H.tool === id ? '' : id; render(); const o = document.querySelector('#ownerHome .oh-toolout'); if(o) o.scrollIntoView({ block: 'nearest' }); }
    else if(act === 'copytool'){ if(navigator.clipboard) navigator.clipboard.writeText(H.text || '').then(function(){ if(window.ttToast) window.ttToast('Copied'); }); }
    else if(act === 'printtool' && window.TTAutomations) window.TTAutomations.printOut(H.html || '');
    else if(act === 'undoauto' && window.TTAutomations){ window.TTAutomations.undo(+id); render(); if(window.ttToast) window.ttToast('Undone'); }
    else if(act === 'link') window.open(id, '_blank', 'noopener');
    else if(act === 'farm'){ const m = document.querySelector('.ttf-menu-item'); if(m) m.click(); else goTab('control'); }
    else if(act === 'printer'){
      const p = (state.printers || []).find(function(x){ return x.id === id; });
      if(!p || typeof togglePrinterStatus !== 'function') return;
      if(!confirm((p.name || 'This printer') + (p.status === 'down' ? ' is back up?' : ' is down?') + ' This changes the capacity the queue and delivery forecasts use.')) return;
      togglePrinterStatus(id); render();
    }
  });

  const css = document.createElement('style');
  css.textContent =
    '#homeAlerts{display:none}' +
    '#ownerHome{margin-bottom:18px}' +
    '.oh-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}' +
    '.oh-hello{font-size:22px;font-weight:600}.oh-sub{color:var(--dim);font-size:13px}' +
    '.oh-health{font-size:12px;padding:4px 12px;border-radius:999px;border:1px solid var(--line)}' +
    '.oh-h2{color:var(--green);border-color:var(--green)}.oh-h1{color:var(--amber);border-color:var(--amber)}.oh-h0{color:var(--red);border-color:var(--red)}' +
    '.oh-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}' +
    '.oh-card{margin-bottom:14px}' +
    '.oh-title{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--dim);font-family:\'JetBrains Mono\',monospace;letter-spacing:.5px;margin-bottom:10px}' +
    '.oh-title span:first-child{color:var(--text);font-weight:600}' +
    '.oh-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--input-bg);margin-bottom:8px}.oh-bar i{display:block;height:100%}' +
    '.oh-note{font-size:13px;color:var(--dim)}.oh-lines{line-height:1.9}' +
    '.oh-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line);font-size:14px}' +
    '.oh-row:first-of-type{border-top:none}.oh-click{cursor:pointer}' +
    '.oh-text{flex:1;min-width:0}.oh-detail{display:block;font-size:12px;color:var(--dim)}' +
    '.oh-dot{width:8px;height:8px;border-radius:50%;flex:none}.oh-l0{background:var(--red)}.oh-l1{background:var(--amber)}.oh-l2{background:var(--line)}' +
    '.oh-btn,.oh-more{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}' +
    '.oh-btn:hover,.oh-more:hover{border-color:var(--cyan);color:var(--cyan)}.oh-more{margin-top:8px}' +
    '.oh-pill{font-size:12px;padding:2px 10px;border-radius:999px;white-space:nowrap;border:1px solid}' +
    '.oh-ok{color:var(--green)}.oh-warn{color:var(--amber)}.oh-bad{color:var(--red)}' +
    '.oh-empty{font-size:13px;color:var(--dim);padding:6px 0}' +
    '.oh-sub2{font-size:12px;color:var(--dim);margin-bottom:4px}' +
    '.oh-floor{gap:22px}' +
    '.oh-link{background:none;border:none;color:var(--cyan);font:inherit;font-size:12px;cursor:pointer;margin-left:12px;text-decoration:none;padding:0}' +
    '.oh-chips{display:flex;flex-wrap:wrap;gap:6px}' +
    '.oh-chip{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;cursor:pointer;background:var(--input-bg);border:1px solid var(--line);color:var(--text)}' +
    '.oh-up{border-color:var(--green)}.oh-down{border-color:var(--red);color:var(--red);text-decoration:line-through}' +
    '.oh-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}' +
    '.oh-tile{text-align:left;background:var(--input-bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--text);font:inherit}' +
    '.oh-tile b{display:block;font-size:14px}.oh-tile span{font-size:12px;color:var(--dim)}.oh-tile.on,.oh-tile:hover{border-color:var(--cyan)}' +
    '.oh-toolout{margin-top:12px;border:1px solid var(--line);border-radius:10px;padding:12px 14px}' +
    '.oh-money{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:14px}';
  document.head.appendChild(css);

  const home = document.getElementById('tabHome');
  if(home){
    const root = document.createElement('div');
    root.id = 'ownerHome';
    home.insertBefore(root, home.firstChild);
  }

  // Draw with Home, and keep it fresh while Home is on screen (farm data lands every few minutes).
  if(typeof renderHome === 'function'){
    const orig = renderHome;
    renderHome = function(){ orig.apply(this, arguments); try{ render(); }catch(e){ console.warn('[owner home]', e); } };
  }
  setInterval(function(){
    const home = document.getElementById('tabHome');
    if(home && home.style.display !== 'none' && !document.hidden){ try{ render(); }catch(e){} }
  }, 60000);
  if(window.TTSales) setTimeout(function(){ window.TTSales.load().then(render).catch(function(){}); }, 4000);
  window.TTOwnerHome = { render: render };
  try{ render(); }catch(e){ console.warn('[owner home]', e); }
})();
