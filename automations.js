// ===================================================================
// ======================== AUTOMATIONS (Studio) =====================
// ===================================================================
// Rules that watch the farm and either act (with Undo) or put an item in
// Home → Needs you, plus on-demand tools that do the ops lead's daily
// paperwork: morning plan, night loader, filament reorder list, pack lists,
// dispatch batches, partner overflow, pickup run, handover note, daily
// scorecard and weekly report.
//
// Rules run while Studio is open on a signed-in device (every 2 minutes).
// Every rule starts off; switch them on in System → Automations. What a rule
// does is written to the activity log. Rules that must run around the clock
// (re-queueing failed plates on the printers, live printer states) belong in
// the workshop bridge and are listed as coming next.
(function(){
  if(window.TT_STOCK_MODE) return;

  const OPEN = ['booked', 'in_production'];
  const LOG_MAX = 150;
  const DEFAULT_PINS = ['plan', 'night', 'reorder', 'pack', 'handover', 'scorecard'];
  const V = { tool: '' };

  // ---------- helpers ----------
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function dayDiff(a, b){ return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
  function fmt(s){ if(!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function rupees(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function kg(g){ return (Math.round((g || 0) / 100) / 10) + ' kg'; }
  function hrs(h){ return (Math.round((h || 0) * 10) / 10) + ' h'; }
  function target(o){ return o.dispatchBy || o.dueDate || ''; }
  function client(id){ return (state.clients || []).find(function(c){ return c.id === id; }); }
  function who(o){ const c = client(o.clientId); return (c && c.name) || o.clientName || o.name || 'Walk-in'; }
  function label(o){ return (o.displayId ? o.displayId + ' · ' : '') + who(o); }
  function prod(){ return (window.TTBuyers && window.TTBuyers.prod()) || {}; }
  function buf(){ return typeof bufferMult === 'function' ? bufferMult() : 1; }
  function lineMade(o, p){ const ps = prod()[o.id], l = ps && ps.lines && ps.lines[p.id]; return Math.min(+p.qty || 0, Math.max(+p.already || 0, l ? (l.made || 0) : 0)); }
  function lineLeft(o, p){ return Math.max(0, (+p.qty || 0) - lineMade(o, p)); }
  function fullyMade(o){ return (o.products || []).some(function(p){ return (+p.qty || 0) > 0; }) && (o.products || []).every(function(p){ return lineLeft(o, p) === 0; }); }
  function queue(){ return window.TTControl ? window.TTControl.queue() : state.orders.filter(function(o){ return OPEN.indexOf(o.status) !== -1; }); }
  function running(){ return (state.printers || []).filter(function(p){ return p.status !== 'down'; }); }
  function hoursPerDay(){ return (state.fleet && state.fleet.hoursPerDay) || 22; }
  function perPlate(name){
    // The Farm panel's product → file setup holds units per plate (on the device that set it up).
    try{ const m = JSON.parse(localStorage.getItem('tt-bambuddy-map-v1') || '{}'); const k = String(name || '').trim().toLowerCase().replace(/\s+/g, ' '); return Math.max(1, +((m[k] || {}).unitsPerPlate) || 1); }catch(e){ return 1; }
  }
  function phoneOf(raw){ raw = String(raw || '').replace(/\D/g, ''); return raw.length === 10 ? '91' + raw : raw; }
  function wa(phone, text){ return phone && phone.length >= 11 ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text) : 'https://wa.me/?text=' + encodeURIComponent(text); }
  function goTab(tab){ const b = document.querySelector('.tab-btn[data-tab="' + tab + '"]'); if(b) b.click(); window.scrollTo(0, 0); }
  function canAct(){ return typeof cloudIsOn !== 'function' || cloudIsOn() || !(typeof cloud !== 'undefined' && cloud.sb); }

  function A(){
    if(!state.automations || typeof state.automations !== 'object') state.automations = {};
    const a = state.automations;
    if(!a.on || typeof a.on !== 'object') a.on = {};
    if(!Array.isArray(a.log)) a.log = [];
    if(!a.snap || typeof a.snap !== 'object') a.snap = {};
    if(!Array.isArray(a.pins)) a.pins = DEFAULT_PINS.slice();
    return a;
  }
  function isOn(id){ return !!A().on[id]; }
  function log(rule, text, undo){
    const a = A();
    a.log.unshift({ at: new Date().toISOString(), rule: rule, text: text, undo: undo || null });
    if(a.log.length > LOG_MAX) a.log.length = LOG_MAX;
    if(typeof scheduleSave === 'function') scheduleSave();
  }

  // ---------- rules ----------
  // kind 'acts' changes data (with Undo); 'flags' adds items to Home → Needs you.
  const RULES = [
    { id: 'made-done', area: 'Operations', kind: 'acts', name: 'Fully made → production done',
      desc: 'When every line of an in-production order is made (Studio’s count or the farm’s), mark it Production Done and note the date. Runs around the clock: the workshop bridge checks every 5 minutes, even with Studio closed. Undo from the log.' },
    { id: 'printer-down', area: 'Operations', kind: 'flags', name: 'Printer down → recheck promises',
      desc: 'When a printer is marked down or back up, log it and list the orders that will now miss their date.' },
    { id: 'repeat-fail', area: 'Operations', kind: 'flags', name: 'Repeat failures',
      desc: 'Flag an open order with 2 or more failed plates so you can check the printer or the file.' },
    { id: 'filament-short', area: 'Operations', kind: 'flags', name: 'Filament won’t cover the queue',
      desc: 'Compare filament needed for booked pieces with in-house stock by colour, and flag any shortfall.' },
    { id: 'overflow', area: 'Partners', kind: 'flags', name: 'Overflow to partners',
      desc: 'When in-house is over 90% booked for the week, flag it with the partner capacity that is free.' },
    { id: 'partner-chase', area: 'Partners', kind: 'flags', name: 'Chase partner jobs behind plan',
      desc: 'For each partner job past its due date, put a ready WhatsApp nudge to the partner in Needs you.' },
    { id: 'lead-idle', area: 'Sales', kind: 'flags', name: 'Idle leads',
      desc: 'Flag open leads with no call, visit or message logged for 5 days.' },
    { id: 'pay-remind', area: 'Finances', kind: 'flags', name: 'Payment ladder · day 7, 14, 21',
      desc: 'Unpaid delivered orders get a WhatsApp reminder at day 7, a firmer one at day 14 and a final one at day 21, each in Needs you with the message ready. Tapping Send records the step. At day 21 the client’s sales rep also gets a task.' },
    { id: 'credit-hold', area: 'Finances', kind: 'flags', name: 'Credit hold on new bookings',
      desc: 'Booking an order for a client who owes money delivered 21 or more days ago asks first, and the order pop-up shows what they owe.' }
  ];
  const NEXT = [
    ['Auto re-queue failed plates', 'Workshop bridge: re-queues a failed plate on the printers and notes it on the order.'],
    ['Booked order → farm, held', 'Workshop bridge: sends booked lines with a farm file to Bambuddy, held until Start.'],
    ['Failure alerts by cause', 'Bambuddy failure detection (Obico) switched on, plus phone notifications.'],
    ['Maintenance by run hours', 'Workshop bridge: reads each printer’s run hours from Bambuddy.'],
    ['Live printer states', 'Workshop bridge: which printer is printing what, for Home and the morning plan.'],
    ['Next job when the bed is cleared', 'A “bed cleared” tap per printer and live printer states.'],
    ['Filament swap prompts', 'Spools assigned to printer slots in Bambuddy Inventory.'],
    ['QC tap per plate', 'A small QC screen on the phone; rejects re-queue themselves.'],
    ['Invoice and tracking on dispatch', 'Courier tracking numbers on dispatch, then the GST invoice and buyer message follow.'],
    ['Push notifications', 'The installed app plus a small cloud function that sends them.'],
    ['Spare parts watch', 'A parts list (nozzles, plates) with stock.']
  ];

  function atRisk(){ return window.TTControl ? window.TTControl.problems().risk : []; }

  function runActs(){
    if(!canAct()) return;
    if(isOn('made-done')){
      state.orders.forEach(function(o){
        if(o.status !== 'in_production' || !fullyMade(o)) return;
        const before = { status: o.status, productionDoneDate: o.productionDoneDate || '' };
        o.status = 'production_done';
        o.productionDoneDate = today();
        log('made-done', label(o) + ' is fully made → Production Done', { orderId: o.id, before: before });
      });
    }
    // Printer status changes (always tracked so the log is complete when the rule is turned on).
    const snap = A().snap.printers || {};
    const now = {};
    (state.printers || []).forEach(function(p){ now[p.id] = p.status === 'down' ? 'down' : 'up'; });
    if(isOn('printer-down')){
      (state.printers || []).forEach(function(p){
        if(snap[p.id] && snap[p.id] !== now[p.id]){
          const risk = atRisk();
          log('printer-down', (p.name || 'A printer') + (now[p.id] === 'down' ? ' marked down' : ' back up') +
            (risk.length ? ' · ' + risk.length + ' order' + (risk.length === 1 ? '' : 's') + ' now at risk: ' + risk.slice(0, 4).map(function(x){ return x.o.displayId || who(x.o); }).join(', ') : ' · no orders at risk'));
        }
      });
    }
    if(JSON.stringify(snap) !== JSON.stringify(now)){ A().snap.printers = now; if(typeof scheduleSave === 'function') scheduleSave(); }
  }

  function undo(i){
    const e = A().log[i];
    if(!e || !e.undo) return;
    if(e.undo.orderId){
      const o = state.orders.find(function(x){ return x.id === e.undo.orderId; });
      if(o){ o.status = e.undo.before.status; o.productionDoneDate = e.undo.before.productionDoneDate; }
    }
    e.undo = null; e.text += ' · undone';
    // Don't let the rule redo it straight away: pause the rule until the owner turns it back on.
    if(e.rule === 'made-done'){ A().on['made-done'] = false; e.text += ' (rule paused)'; }
    if(typeof scheduleSave === 'function') scheduleSave();
    if(typeof renderOrders === 'function') renderOrders();
    render();
  }

  // Items for Home → Needs you.
  function needs(){
    const out = [], t = today();
    if(isOn('printer-down')){
      const down = (state.printers || []).filter(function(p){ return p.status === 'down'; });
      const risk = atRisk();
      if(down.length && risk.length) out.push({ level: 0, rank: 0, score: risk.length, text: down.map(function(p){ return p.name; }).join(', ') + ' down · ' + risk.length + ' order' + (risk.length === 1 ? '' : 's') + ' will now be late', act: 'tab', id: 'control', btn: 'Replan' });
    }
    if(isOn('repeat-fail')){
      state.orders.forEach(function(o){
        const ps = prod()[o.id];
        if(OPEN.indexOf(o.status) !== -1 && ps && (ps.plates_failed || 0) >= 2)
          out.push({ level: 1, rank: 0, score: ps.plates_failed, text: label(o) + ' has ' + ps.plates_failed + ' failed plates · check the printer or the file', act: 'farm', id: '', btn: 'Print farm' });
      });
    }
    if(isOn('filament-short')){
      const r = reorder();
      if(r.short.length) out.push({ level: 1, rank: 1, score: r.short.length, text: 'Filament short for booked orders: ' + r.short.slice(0, 3).map(function(x){ return kg(x.buy) + ' ' + x.name; }).join(', ') + (r.short.length > 3 ? ' and more' : ''), act: 'tool', id: 'reorder', btn: 'Reorder list' });
    }
    if(isOn('overflow')){
      const ov = overflow();
      if(ov.load > 90) out.push({ level: 1, rank: 1, score: ov.load, text: 'In-house is ' + ov.load + '% booked this week' + (ov.free != null ? ' · partners have ' + ov.free + ' free printer-hours a day' : ''), act: 'tool', id: 'overflow', btn: 'Plan overflow' });
    }
    if(isOn('partner-chase')){
      ((state.pon && state.pon.jobs) || []).forEach(function(j){
        if(typeof ponIsOverdue !== 'function' || !ponIsOverdue(j)) return;
        const p = typeof ponPartner === 'function' ? ponPartner(j.partnerId) : null;
        const late = j.dueDate ? dayDiff(t, j.dueDate) : 0;
        const text = 'Hi ' + ((p && p.name) || '') + ', checking on job ' + (j.code || j.id || '') + ' (' + (j.productName || j.name || 'your job') + ') due ' + fmt(j.dueDate) + '. How many pieces are done, and when can we pick up? — Thread Tribe';
        out.push({ level: 1, rank: 1, score: late, text: ((p && p.name) || 'Partner') + ' is ' + late + ' day' + (late === 1 ? '' : 's') + ' late on ' + (j.productName || j.name || 'a job'), act: 'link', id: wa(phoneOf(p && p.phone), text), btn: 'Nudge' });
      });
    }
    if(isOn('lead-idle') && window.TTSales){
      const acts = (window.TTSales.acts && window.TTSales.acts()) || [], last = {};
      acts.forEach(function(x){ if(!last[x.lead_id] || x.created_at > last[x.lead_id]) last[x.lead_id] = x.created_at; });
      const cutoff = addDays(t, -5);
      const idle = window.TTSales.leads().filter(function(l){
        return ['new', 'contacted', 'meeting', 'quote'].indexOf(l.stage) !== -1 && ((last[l.id] || (l.data || {}).createdAt || l.updated_at || '').slice(0, 10) < cutoff);
      });
      if(idle.length) out.push({ level: 2, rank: 0, score: idle.length, text: idle.length + ' open lead' + (idle.length === 1 ? ' has' : 's have') + ' had no activity for 5 days', act: 'tab', id: 'sales', btn: 'Sales' });
    }
    // Payment ladder (payment-ladder.js): one item per order with a reminder due.
    if(window.TTPayLadder) try{ out.push.apply(out, window.TTPayLadder.needs()); }catch(e){ console.warn('[automations] ladder', e); }
    if(window.TTMarketing) try{ out.push.apply(out, window.TTMarketing.needs()); }catch(e){}
    if(window.TTShipturtle) try{ out.push.apply(out, window.TTShipturtle.needs()); }catch(e){}
    if(window.TTSupport) try{
      const op = window.TTSupport.open(), claims = op.filter(function(q){ return q.kind === 'claim'; }).length, waiting = op.filter(function(q){ return q.kind === 'message' && Date.now() - Date.parse(q.created_at || 0) > 86400000; }).length;
      if(claims) out.push({ level: 1, rank: 1, score: claims, text: claims + ' damage claim' + (claims === 1 ? '' : 's') + ' from brand partners waiting', act: 'tab', id: 'support', btn: 'Support' });
      if(waiting) out.push({ level: 1, rank: 2, score: waiting, text: waiting + ' brand-partner message' + (waiting === 1 ? '' : 's') + ' unanswered for over a day', act: 'tab', id: 'support', btn: 'Reply' });
    }catch(e){}
    return out;
  }

  // ---------- tools ----------
  function plan(){
    const ps = running(), day = hoursPerDay(), slots = ps.map(function(p){ return { p: p, used: 0, jobs: [] }; });
    const lines = [];
    queue().forEach(function(o){
      (o.products || []).forEach(function(p){
        const left = lineLeft(o, p), per = perPlate(p.name), plateH = (+p.hrs || 0) * per * buf();
        if(left > 0 && plateH > 0) lines.push({ o: o, p: p, plates: Math.ceil(left / per), plateH: plateH, color: [p.material, p.color].filter(Boolean).join(' ') });
      });
    });
    // Fill each printer up to a day of print hours, in queue order, keeping a colour on one printer where possible.
    lines.forEach(function(L){
      while(L.plates > 0){
        const fit = slots.filter(function(s){ return s.used + L.plateH <= day + 0.01; });
        if(!fit.length) break;
        fit.sort(function(a, b){ return (b.jobs.some(function(j){ return j.color === L.color; }) ? 1 : 0) - (a.jobs.some(function(j){ return j.color === L.color; }) ? 1 : 0) || a.used - b.used; });
        const s = fit[0], n = Math.max(1, Math.min(L.plates, Math.floor((day - s.used) / L.plateH)));
        const last = s.jobs[s.jobs.length - 1];
        if(last && last.L === L) last.n += n; else s.jobs.push({ L: L, n: n, color: L.color });
        s.used += n * L.plateH; L.plates -= n;
      }
    });
    return { slots: slots, day: day, leftover: lines.filter(function(L){ return L.plates > 0; }) };
  }
  function reorder(){
    const need = {}, have = {}, names = {};
    function key(c){ return typeof colorKey === 'function' ? colorKey(c) : String(c || '').trim().toLowerCase(); }
    queue().forEach(function(o){
      (o.products || []).forEach(function(p){
        const g = lineLeft(o, p) * (+p.fil || 0) * buf();
        if(!g) return;
        const k = key(p.color) || 'unspecified';
        need[k] = (need[k] || 0) + g; names[k] = [p.material, p.color].filter(Boolean).join(' ') || 'Unspecified colour';
      });
    });
    const spools = (state.fil && state.fil.spools) || [];
    spools.forEach(function(s){ if(typeof filInHouse === 'function' ? filInHouse(s) : s.status !== 'empty'){ const k = key(s.color); have[k] = (have[k] || 0) + (s.remG || 0); } });
    const spool = typeof spoolGrams === 'function' ? spoolGrams() : 1000;
    const rows = Object.keys(need).map(function(k){
      const gap = need[k] - (have[k] || 0);
      return { name: names[k], need: need[k], have: have[k] || 0, buy: gap > 0 ? Math.ceil(gap / spool) * spool : 0 };
    }).sort(function(a, b){ return b.buy - a.buy || b.need - a.need; });
    return { rows: rows, short: rows.filter(function(r){ return r.buy > 0; }), spool: spool, tracked: spools.length > 0 };
  }
  function readyToPack(){
    return state.orders.filter(function(o){ return !o.shippedDate && (o.status === 'production_done' || (o.status === 'in_production' && fullyMade(o))); })
      .sort(function(a, b){ return (target(a) || '9').localeCompare(target(b) || '9'); });
  }
  function overflow(){
    const fc = window.TTControl ? window.TTControl.forecast() : { hours: 0, cap: 0 };
    const weekCap = fc.cap * 7, load = weekCap > 0 ? Math.round(100 * fc.hours / weekCap) : 0;
    const free = window.TTPartners && window.TTPartners.ready() ? Math.round(window.TTPartners.freePerDay(7)) : null;
    let extra = Math.max(0, fc.hours - weekCap * 0.9);
    const pick = [];
    queue().slice().reverse().forEach(function(o){
      if(extra <= 0) return;
      const h = (o.products || []).reduce(function(s, p){ return s + lineLeft(o, p) * (+p.hrs || 0) * buf(); }, 0);
      if(h > 0){ pick.push({ o: o, h: h }); extra -= h; }
    });
    const partners = ((state.pon && state.pon.partners) || []).filter(function(p){ return p.status !== 'paused'; })
      .sort(function(a, b){ return (+b.printers || 0) - (+a.printers || 0); });
    return { load: load, free: free, pick: pick, partners: partners, overHours: Math.max(0, fc.hours - weekCap * 0.9) };
  }
  function pickupsSoon(){
    if(!(window.TTPartners && window.TTPartners.ready())) return null;
    const until = addDays(today(), 1);
    return window.TTPartners.pickups().filter(function(x){ return x.b.date <= until && !x.b.collectedAt; });
  }
  function metricsFor(start, end){
    let booked = 0, collected = 0, delivered = 0, onTime = 0;
    state.orders.forEach(function(o){
      if(['quoted', 'lost', 'cancelled', 'returned'].indexOf(o.status) === -1){
        const od = (o.orderedDate || '').slice(0, 10);
        if(od >= start && od <= end) booked += orderTotals(o).grandTotal;
      }
      const cl = (o.paymentClearedDate || '').slice(0, 10);
      if(cl >= start && cl <= end) collected += +o.amountPaid || orderTotals(o).grandTotal;
      const dd = (o.deliveryDate || o.shippedDate || '').slice(0, 10);
      if(o.status === 'delivered' && dd >= start && dd <= end){ delivered++; if(!target(o) || dd <= target(o)) onTime++; }
    });
    return { booked: booked, collected: collected, delivered: delivered, onTime: onTime };
  }

  const TOOLS = [
    { id: 'plan', name: 'Morning plan', desc: 'What each printer prints today', run: function(){
      const P = plan();
      if(!P.slots.length) return { html: '<p class="au-note">No printers are marked up. Set them in Settings or on Home.</p>', text: '' };
      let text = 'Print plan · ' + fmt(today()) + '\n';
      const html = P.slots.map(function(s){
        text += '\n' + (s.p.name || 'Printer') + ' (' + hrs(s.used) + ')\n' + (s.jobs.length ? s.jobs.map(function(j){ return '  ' + (j.L.o.displayId || '') + ' ' + j.L.p.name + ' ×' + j.n + ' plate' + (j.n === 1 ? '' : 's') + (j.L.color ? ' · ' + j.L.color : '') + (j.L.plateH >= 6 ? ' · start before you leave' : ''); }).join('\n') : '  free') + '\n';
        return '<div class="au-block"><div class="au-h">' + esc(s.p.name || 'Printer') + ' <span>' + hrs(s.used) + ' of ' + hrs(P.day) + '</span></div>' +
          (s.jobs.length ? s.jobs.map(function(j){ return '<div class="au-li">' + esc((j.L.o.displayId || '') + ' · ' + j.L.p.name) + ' ×' + j.n + ' plate' + (j.n === 1 ? '' : 's') + ' <span>' + (j.L.color ? esc(j.L.color) + ' · ' : '') + hrs(j.n * j.L.plateH) + (j.L.plateH >= 6 ? ' · start before you leave' : '') + '</span></div>'; }).join('') : '<div class="au-li au-dim">Free all day</div>') + '</div>';
      }).join('') + (P.leftover.length ? '<p class="au-note">Still waiting after today: ' + P.leftover.slice(0, 6).map(function(L){ return esc((L.o.displayId || '') + ' ' + L.p.name + ' ×' + L.plates); }).join(', ') + (P.leftover.length > 6 ? ' and ' + (P.leftover.length - 6) + ' more lines' : '') + '</p>' : '') +
        '<p class="au-note">Plates use units per plate from the Print farm setup on this device (1 if not set). Hours include the failure buffer.</p>';
      return { html: html, text: text };
    } },
    { id: 'night', name: 'Night-shift loader', desc: 'Long jobs for printers before you leave', run: function(){
      const P = plan(), idle = P.slots.filter(function(s){ return !s.jobs.some(function(j){ return j.L.plateH >= 6; }); });
      const long = [];
      queue().forEach(function(o){ (o.products || []).forEach(function(p){ const per = perPlate(p.name), h = (+p.hrs || 0) * per * buf(); if(lineLeft(o, p) > 0 && h >= 6) long.push({ o: o, p: p, h: h }); }); });
      long.sort(function(a, b){ return b.h - a.h; });
      if(!idle.length) return { html: '<p class="au-note">Every printer already has a long job in today’s plan.</p>', text: '' };
      let text = 'Before you leave · ' + fmt(today()) + '\n';
      const html = idle.map(function(s, i){
        const L = long[i % Math.max(long.length, 1)];
        text += (s.p.name || 'Printer') + ': ' + (L ? (L.o.displayId || '') + ' ' + L.p.name + ' (' + hrs(L.h) + ' per plate)' : 'no long job queued') + '\n';
        return '<div class="au-li">' + esc(s.p.name || 'Printer') + ' <span>' + (L ? esc((L.o.displayId || '') + ' · ' + L.p.name) + ' · ' + hrs(L.h) + ' per plate' : 'no long job in the queue') + '</span></div>';
      }).join('');
      return { html: html, text: text };
    } },
    { id: 'reorder', name: 'Filament reorder list', desc: 'Kilograms to buy for booked orders', run: function(){
      const r = reorder();
      if(!r.rows.length) return { html: '<p class="au-note">No filament needed: the queue is empty or products have no grams set.</p>', text: '' };
      let text = 'Filament purchase order · ' + fmt(today()) + '\n';
      r.short.forEach(function(x){ text += '- ' + x.name + ': ' + kg(x.buy) + ' (' + Math.round(x.buy / r.spool) + ' spools)\n'; });
      const html = '<div class="au-table">' + '<div class="au-tr au-th"><span>Colour</span><span>Needed</span><span>In stock</span><span>Buy</span></div>' +
        r.rows.map(function(x){ return '<div class="au-tr"><span>' + esc(x.name) + '</span><span>' + kg(x.need) + '</span><span>' + kg(x.have) + '</span><span' + (x.buy ? ' class="au-bad"' : '') + '>' + (x.buy ? kg(x.buy) : '—') + '</span></div>'; }).join('') + '</div>' +
        (r.tracked ? '' : '<p class="au-note">No spools are tracked in Filament Inventory yet, so stock counts as zero.</p>');
      return { html: html, text: r.short.length ? text : '' };
    } },
    { id: 'pack', name: 'Pack lists', desc: 'Printable list for each made order', run: function(){
      const list = readyToPack();
      if(!list.length) return { html: '<p class="au-note">No made orders waiting to be packed.</p>', text: '' };
      const html = list.map(function(o){
        const c = client(o.clientId) || {};
        return '<div class="au-block"><div class="au-h">' + esc(label(o)) + ' <span>' + (target(o) ? 'ship by ' + fmt(target(o)) : 'no ship date') + '</span></div>' +
          (o.products || []).filter(function(p){ return (+p.qty || 0) > 0; }).map(function(p){ return '<div class="au-li">☐ ' + esc(p.name) + ' ×' + p.qty + ' <span>' + esc([p.material, p.color].filter(Boolean).join(' ')) + '</span></div>'; }).join('') +
          (c.address ? '<div class="au-li au-dim">' + esc(c.address) + '</div>' : '') + '</div>';
      }).join('');
      return { html: html, text: '', print: true };
    } },
    { id: 'dispatch', name: 'Dispatch batches', desc: 'Made orders grouped by city', run: function(){
      const groups = {};
      readyToPack().forEach(function(o){ const c = client(o.clientId) || {}; const k = (c.city || 'City not set').trim(); (groups[k] = groups[k] || []).push(o); });
      const keys = Object.keys(groups).sort(function(a, b){ return groups[b].length - groups[a].length; });
      if(!keys.length) return { html: '<p class="au-note">No made orders to dispatch.</p>', text: '' };
      let text = 'Dispatch batches · ' + fmt(today()) + '\n';
      const html = keys.map(function(k){
        text += '\n' + k + ': ' + groups[k].map(function(o){ return o.displayId || who(o); }).join(', ');
        return '<div class="au-block"><div class="au-h">' + esc(k) + ' <span>' + groups[k].length + ' order' + (groups[k].length === 1 ? '' : 's') + '</span></div>' + groups[k].map(function(o){ return '<div class="au-li">' + esc(label(o)) + ' <span>' + (target(o) ? 'by ' + fmt(target(o)) : '') + '</span></div>'; }).join('') + '</div>';
      }).join('');
      return { html: html, text: text };
    } },
    { id: 'overflow', name: 'Partner overflow', desc: 'What to send to partners this week', run: function(){
      const ov = overflow();
      if(ov.load <= 90) return { html: '<p class="au-note">In-house is ' + ov.load + '% booked this week. No overflow needed.</p>', text: '' };
      const html = '<p class="au-note">In-house is ' + ov.load + '% booked: about ' + hrs(ov.overHours) + ' over a comfortable 90%.' + (ov.free != null ? ' Partners have about ' + ov.free + ' free printer-hours a day.' : '') + '</p>' +
        '<div class="au-h">Send these (latest due first)</div>' + ov.pick.map(function(x){ return '<div class="au-li">' + esc(label(x.o)) + ' <span>' + hrs(x.h) + ' · due ' + fmt(target(x.o)) + '</span></div>'; }).join('') +
        '<div class="au-h" style="margin-top:10px">Partners with the most printers</div>' + (ov.partners.length ? ov.partners.slice(0, 5).map(function(p){ return '<div class="au-li">' + esc(p.name || 'Partner') + ' <span>' + (+p.printers || 0) + ' printers' + (p.city ? ' · ' + esc(p.city) : '') + '</span></div>'; }).join('') : '<div class="au-li au-dim">No active partners yet</div>') +
        '<p><button class="au-btn" data-au="partner-job">Create a partner job</button></p>';
      return { html: html, text: '' };
    } },
    { id: 'pickups', name: 'Pickup run', desc: 'Today’s and tomorrow’s partner pickups, in a route', run: function(){
      const list = pickupsSoon();
      if(list == null) return { html: '<p class="au-note">Partner pickups load with Partner Network → Planning (sign in to sync).</p>', text: '' };
      if(!list.length) return { html: '<p class="au-note">No pickups booked for today or tomorrow.</p>', text: '' };
      const stops = list.map(function(x){ return x.p.address || x.p.city || x.p.name; }).filter(Boolean);
      const route = stops.length ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(stops[stops.length - 1]) + (stops.length > 1 ? '&waypoints=' + encodeURIComponent(stops.slice(0, -1).join('|')) : '') : '';
      let text = 'Pickup run · ' + fmt(today()) + '\n';
      const html = list.map(function(x){
        text += '- ' + (x.p.name || 'Partner') + ', ' + (x.p.address || x.p.city || '') + ' · ' + fmt(x.b.date) + '\n';
        return '<div class="au-li">' + esc(x.p.name || 'Partner') + ' <span>' + esc(x.p.address || x.p.city || '') + ' · ' + fmt(x.b.date) + '</span></div>';
      }).join('') + (route ? '<p><a class="au-btn" href="' + esc(route) + '" target="_blank" rel="noopener">Open route in Maps</a></p>' : '');
      return { html: html, text: text };
    } },
    { id: 'handover', name: 'Shift handover note', desc: 'End-of-day summary for the next shift', run: function(){
      const t = today(), down = (state.printers || []).filter(function(p){ return p.status === 'down'; });
      const done = state.orders.filter(function(o){ return (o.productionDoneDate || '').slice(0, 10) === t; });
      const inProd = state.orders.filter(function(o){ return o.status === 'in_production'; });
      const P = plan(), pk = pickupsSoon() || [];
      const lines = ['Handover · ' + fmt(t), '',
        'Printers down: ' + (down.length ? down.map(function(p){ return p.name; }).join(', ') : 'none'),
        'Finished today: ' + (done.length ? done.map(function(o){ return o.displayId || who(o); }).join(', ') : 'none'),
        'In production: ' + (inProd.length ? inProd.map(function(o){ const m = (o.products || []).reduce(function(s, p){ return s + lineMade(o, p); }, 0), q = (o.products || []).reduce(function(s, p){ return s + (+p.qty || 0); }, 0); return (o.displayId || who(o)) + ' ' + m + '/' + q; }).join(', ') : 'none'),
        'Failed plates on open orders: ' + (Object.keys(prod()).reduce(function(s, k){ return s + (prod()[k].plates_failed || 0); }, 0)),
        'Next up: ' + (P.slots.filter(function(s){ return s.jobs.length; }).slice(0, 4).map(function(s){ const j = s.jobs[0]; return s.p.name + ' → ' + (j.L.o.displayId || '') + ' ' + j.L.p.name; }).join('; ') || 'queue empty'),
        'Pickups: ' + (pk.length ? pk.map(function(x){ return x.p.name + ' ' + fmt(x.b.date); }).join(', ') : 'none')];
      return { html: '<pre class="au-pre">' + esc(lines.join('\n')) + '</pre>', text: lines.join('\n') };
    } },
    { id: 'scorecard', name: 'Daily scorecard', desc: 'Today’s numbers for the owner', run: function(){
      const t = today(), m = metricsFor(t, t), ctl = window.TTControl ? window.TTControl.problems() : { overdue: [], risk: [], unpaid: [] };
      const fc = window.TTControl ? window.TTControl.forecast() : { hours: 0, cap: 0 };
      const unpaid = ctl.unpaid.reduce(function(s, x){ return s + x.due; }, 0);
      const madeToday = state.orders.filter(function(o){ return (o.productionDoneDate || '').slice(0, 10) === t; }).length;
      const down = (state.printers || []).filter(function(p){ return p.status === 'down'; }).length;
      const lines = ['Thread Tribe · ' + fmt(t),
        'Booked today: ' + rupees(m.booked), 'Collected today: ' + rupees(m.collected), 'Orders finished today: ' + madeToday,
        'Late: ' + ctl.overdue.length + ' · at risk: ' + ctl.risk.length, 'Overdue payments: ' + rupees(unpaid) + ' (' + ctl.unpaid.length + ')',
        'Printers down: ' + down + ' · queue clears in ' + (fc.cap > 0 ? Math.ceil(fc.hours / fc.cap) + ' days' : '—')];
      return { html: '<pre class="au-pre">' + esc(lines.join('\n')) + '</pre>', text: lines.join('\n') };
    } },
    { id: 'weekly', name: 'Weekly report', desc: 'The last 7 days, for the weekly review', run: function(){
      const end = today(), start = addDays(end, -6), m = metricsFor(start, end);
      const fails = state.orders.map(function(o){ return { o: o, f: (prod()[o.id] || {}).plates_failed || 0, d: (prod()[o.id] || {}).plates_done || 0 }; }).filter(function(x){ return x.f > 0; }).sort(function(a, b){ return b.f - a.f; }).slice(0, 5);
      const byClient = {};
      state.orders.forEach(function(o){ const od = (o.orderedDate || '').slice(0, 10); if(od >= start && od <= end && ['quoted', 'lost', 'cancelled', 'returned'].indexOf(o.status) === -1){ const k = who(o); byClient[k] = (byClient[k] || 0) + orderTotals(o).grandTotal; } });
      const top = Object.keys(byClient).sort(function(a, b){ return byClient[b] - byClient[a]; }).slice(0, 5);
      const pj = ((state.pon && state.pon.jobs) || []).filter(function(j){ const d = (j.deliveredAt || j.deliveredDate || '').slice(0, 10); return j.status === 'delivered' && d >= start && d <= end; });
      const lines = ['Week ' + fmt(start) + ' – ' + fmt(end), '',
        'Booked: ' + rupees(m.booked) + ' · collected: ' + rupees(m.collected),
        'Delivered: ' + m.delivered + ' orders · on time: ' + (m.delivered ? Math.round(100 * m.onTime / m.delivered) + '%' : '—'),
        'Top clients: ' + (top.length ? top.map(function(k){ return k + ' ' + rupees(byClient[k]); }).join(', ') : 'none'),
        'Most failed plates: ' + (fails.length ? fails.map(function(x){ return (x.o.displayId || who(x.o)) + ' ' + x.f + ' of ' + (x.f + x.d); }).join(', ') : 'none'),
        'Partner jobs delivered: ' + pj.length];
      return { html: '<pre class="au-pre">' + esc(lines.join('\n')) + '</pre>', text: lines.join('\n') };
    } }
  ];

  // One-line live summary per tool, for the tiles on Home.
  const SUMMARY = {
    plan: function(){ const P = plan(), busy = P.slots.filter(function(s){ return s.jobs.length; }); return busy.length ? busy.length + ' of ' + P.slots.length + ' printers loaded · ' + hrs(P.slots.reduce(function(s, x){ return s + x.used; }, 0)) : 'Nothing to plan'; },
    night: function(){ const P = plan(), idle = P.slots.filter(function(s){ return !s.jobs.some(function(j){ return j.L.plateH >= 6; }); }); return idle.length ? idle.length + ' printer' + (idle.length === 1 ? '' : 's') + ' need a long job' : 'All printers have long jobs'; },
    reorder: function(){ const r = reorder(); return r.short.length ? kg(r.short.reduce(function(s, x){ return s + x.buy; }, 0)) + ' to buy' : r.rows.length ? 'Stock covers the queue' : 'Nothing needed'; },
    pack: function(){ const n = readyToPack().length; return n ? n + ' order' + (n === 1 ? '' : 's') + ' to pack' : 'Nothing to pack'; },
    dispatch: function(){ const c = {}; readyToPack().forEach(function(o){ const cl = client(o.clientId) || {}; c[cl.city || '?'] = 1; }); const n = Object.keys(c).length; return n ? n + ' batch' + (n === 1 ? '' : 'es') : 'Nothing to dispatch'; },
    overflow: function(){ const ov = overflow(); return 'In-house ' + ov.load + '% booked'; },
    pickups: function(){ const p = pickupsSoon(); return p == null ? 'Loads with Planning' : p.length ? p.length + ' pickup' + (p.length === 1 ? '' : 's') + ' soon' : 'No pickups'; },
    handover: function(){ return 'Ready to send'; },
    scorecard: function(){ const ctl = window.TTControl ? window.TTControl.problems() : { overdue: [], risk: [] }; return ctl.overdue.length + ' late · ' + ctl.risk.length + ' at risk'; },
    weekly: function(){ return 'Last 7 days'; }
  };
  function pins(){ return A().pins.filter(function(id){ return TOOLS.some(function(t){ return t.id === id; }); }); }
  function togglePin(id){ const a = A(), i = a.pins.indexOf(id); if(i === -1) a.pins.push(id); else a.pins.splice(i, 1); if(typeof scheduleSave === 'function') scheduleSave(); }
  function runTool(id){ const t = TOOLS.find(function(x){ return x.id === id; }); if(!t) return null; try{ return Object.assign({ name: t.name }, t.run()); }catch(e){ return { name: t.name, html: '<p class="au-note">Couldn’t build this: ' + esc(e.message || e) + '</p>', text: '' }; } }

  // ---------- screen ----------
  function render(){
    const root = document.getElementById('automationsRoot');
    if(!root) return;
    const a = A();
    let h = '<div class="panel"><div class="panel-title">Daily tools</div><p class="au-note">One tap does the paperwork. Copy or share the result on WhatsApp.</p><div class="au-tools">' +
      TOOLS.map(function(t){
        const pinned = pins().indexOf(t.id) !== -1;
        return '<div class="au-toolwrap"><button class="au-tool' + (V.tool === t.id ? ' on' : '') + '" data-au="tool" data-id="' + t.id + '"><b>' + esc(t.name) + '</b><span>' + esc(t.desc) + '</span></button>' +
          '<button class="au-pin' + (pinned ? ' on' : '') + '" data-au="pin" data-id="' + t.id + '" title="' + (pinned ? 'Unpin from Home' : 'Pin to Home') + '" aria-label="' + (pinned ? 'Unpin ' : 'Pin ') + esc(t.name) + (pinned ? ' from Home' : ' to Home') + '">' + (pinned ? '★' : '☆') + '</button></div>';
      }).join('') + '</div><p class="au-note">★ pins a tool to Home.</p>';
    if(V.tool){
      const t = TOOLS.find(function(x){ return x.id === V.tool; });
      let out;
      try{ out = t.run(); }catch(e){ out = { html: '<p class="au-note">Couldn’t build this: ' + esc(e.message || e) + '</p>', text: '' }; }
      V.text = out.text || '';
      h += '<div class="au-out" id="auOut"><div class="au-out-head"><b>' + esc(t.name) + '</b><span>' +
        (out.text ? '<button class="au-btn" data-au="copy">Copy</button> <a class="au-btn" target="_blank" rel="noopener" href="' + esc(wa('', out.text)) + '">WhatsApp</a> ' : '') +
        (out.print ? '<button class="au-btn" data-au="print">Print</button> ' : '') + '<button class="au-btn" data-au="close">Close</button></span></div>' + out.html + '</div>';
    }
    h += '</div>';

    h += '<div class="panel"><div class="panel-title">Rules</div><p class="au-note">Rules run while Studio is open on a signed-in device. Each starts off. “Acts” rules change data and can be undone from the log; “Flags” rules add items to Home → Needs you.</p>' +
      RULES.map(function(r){
        return '<label class="au-rule"><input type="checkbox" data-au="rule" data-id="' + r.id + '"' + (isOn(r.id) ? ' checked' : '') + '><span><b>' + esc(r.name) + '</b> <em class="au-tag au-' + r.kind + '">' + (r.kind === 'acts' ? 'Acts' : 'Flags') + '</em> <em class="au-tag">' + esc(r.area) + '</em><br><small>' + esc(r.desc) + '</small></span></label>';
      }).join('') + '</div>';

    h += '<div class="panel"><div class="panel-title">Activity log</div>' + (a.log.length ? a.log.slice(0, 40).map(function(e, i){
      const r = RULES.find(function(x){ return x.id === e.rule; });
      return '<div class="au-log"><span class="au-dim">' + new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + '</span> <span>' + esc(e.text) + '</span> <span class="au-dim">' + esc(r ? r.name : e.rule) + '</span>' + (e.undo ? ' <button class="au-btn" data-au="undo" data-id="' + i + '">Undo</button>' : '') + '</div>';
    }).join('') : '<p class="au-note">Nothing yet. Turn on a rule above.</p>') + '</div>';

    h += '<div class="panel"><div class="panel-title">Coming next</div><p class="au-note">These need a piece outside Studio first.</p>' +
      NEXT.map(function(n){ return '<div class="au-li"><b>' + esc(n[0]) + '</b> <span>' + esc(n[1]) + '</span></div>'; }).join('') + '</div>';
    root.innerHTML = h;
  }

  function printPack(){
    const out = document.getElementById('auOut');
    if(!out) return;
    const w = window.open('', '_blank');
    if(!w) return;
    w.document.write('<!doctype html><meta charset="utf-8"><title>Pack lists</title><style>body{font:14px system-ui,sans-serif;padding:20px}.au-block{border:1px solid #999;border-radius:8px;padding:12px;margin:0 0 14px;page-break-inside:avoid}.au-h{font-weight:700;margin-bottom:6px}.au-h span,.au-li span{color:#555;font-weight:400;margin-left:8px}.au-li{padding:3px 0}.au-out-head{display:none}</style>' + out.innerHTML);
    w.document.close(); w.focus(); w.print();
  }

  document.addEventListener('click', function(e){
    const b = e.target.closest('[data-au]');
    if(!b) return;
    const act = b.getAttribute('data-au'), id = b.getAttribute('data-id');
    if(act === 'tool'){ V.tool = V.tool === id ? '' : id; render(); const o = document.getElementById('auOut'); if(o) o.scrollIntoView({ block: 'nearest' }); }
    else if(act === 'close'){ V.tool = ''; render(); }
    else if(act === 'copy'){ navigator.clipboard && navigator.clipboard.writeText(V.text || '').then(function(){ window.ttToast && window.ttToast('Copied'); }); }
    else if(act === 'print') printPack();
    else if(act === 'undo') undo(+id);
    else if(act === 'pin'){ togglePin(id); render(); if(window.TTOwnerHome) window.TTOwnerHome.render(); }
    else if(act === 'partner-job'){ goTab('partners'); if(typeof ponOpenJob === 'function') ponOpenJob(null); }
  });
  document.addEventListener('change', function(e){
    const b = e.target.closest('[data-au="rule"]');
    if(!b) return;
    const id = b.getAttribute('data-id'), r = RULES.find(function(x){ return x.id === id; });
    A().on[id] = b.checked;
    if(id === 'lead-idle' && b.checked && window.TTSales) window.TTSales.load().catch(function(){});
    log(id, (r ? r.name : id) + (b.checked ? ' turned on' : ' turned off'));
    if(b.checked) tick();
    render();
  });

  const css = document.createElement('style');
  css.textContent =
    '.au-note{font-size:13px;color:var(--dim);margin:4px 0 10px}.au-dim{color:var(--dim)}.au-bad{color:var(--red);font-weight:600}' +
    '.au-tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}' +
    '.au-tool{text-align:left;background:var(--input-bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--text);font:inherit}' +
    '.au-toolwrap{position:relative}.au-toolwrap .au-tool{width:100%;height:100%;padding-right:34px}' +
    '.au-pin{position:absolute;top:6px;right:6px;background:none;border:none;font-size:16px;cursor:pointer;color:var(--dim);padding:2px 4px}.au-pin.on{color:var(--amber)}' +
    '.au-tool b{display:block;font-size:14px}.au-tool span{font-size:12px;color:var(--dim)}.au-tool.on,.au-tool:hover{border-color:var(--cyan)}' +
    '.au-out{margin-top:14px;border:1px solid var(--line);border-radius:10px;padding:12px 14px}' +
    '.au-out-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}' +
    '.au-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;text-decoration:none;display:inline-block}.au-btn:hover{border-color:var(--cyan);color:var(--cyan)}' +
    '.au-block{border-top:1px solid var(--line);padding:8px 0}.au-block:first-child{border-top:none}' +
    '.au-h{font-weight:600;font-size:14px;margin-bottom:4px}.au-h span{font-weight:400;color:var(--dim);font-size:12px;margin-left:8px}' +
    '.au-li{font-size:13px;padding:3px 0}.au-li span{color:var(--dim);margin-left:6px}' +
    '.au-table{display:grid;font-size:13px}.au-tr{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;padding:5px 0;border-top:1px solid var(--line)}.au-th{color:var(--dim);border-top:none}' +
    '.au-pre{white-space:pre-wrap;font-family:inherit;font-size:13px;margin:0;line-height:1.7}' +
    '.au-rule{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line);cursor:pointer}.au-rule input{margin-top:4px}.au-rule small{color:var(--dim)}' +
    '.au-tag{font-style:normal;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin-left:4px;color:var(--dim)}.au-acts{color:var(--amber);border-color:var(--amber)}.au-flags{color:var(--cyan);border-color:var(--cyan)}' +
    '.au-log{font-size:13px;padding:6px 0;border-top:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center}';
  document.head.appendChild(css);

  // Screen: a menu entry in System, and its container next to Settings.
  const settingsBtn = document.querySelector('.tab-btn[data-tab="settings"]');
  const settingsTab = document.getElementById('tabSettings');
  if(settingsBtn && settingsTab){
    const btn = document.createElement('button');
    btn.className = 'tab-btn'; btn.setAttribute('data-tab', 'automations'); btn.textContent = 'Automations';
    settingsBtn.parentNode.insertBefore(btn, settingsBtn);
    const box = document.createElement('div');
    box.id = 'tabAutomations'; box.style.display = 'none'; box.innerHTML = '<div id="automationsRoot"></div>';
    settingsTab.parentNode.insertBefore(box, settingsTab);
    // The core tab handler only knows its own screens, so show and hide this one here.
    function wire(b){
      b.addEventListener('click', function(){
        const on = b.getAttribute('data-tab') === 'automations';
        box.style.display = on ? '' : 'none';
        if(on){
          document.querySelectorAll('.tab-btn').forEach(function(x){ x.classList.toggle('active', x === b); });
          const lab = document.getElementById('currentTabLabel'); if(lab) lab.textContent = b.textContent;
          const bar = document.getElementById('tabBar'); if(bar) bar.classList.remove('open');
          document.querySelectorAll('.wrap > [id^="tab"]').forEach(function(el){ if(el !== box && /^tab[A-Z]/.test(el.id) && el.id !== 'tabBar') el.style.display = 'none'; });
          render();
        }
      });
    }
    document.querySelectorAll('.tab-btn').forEach(wire);
    // The phone's More sheet was built before this screen existed; add it to the System group there.
    const sheet = document.getElementById('moreSheetList');
    if(sheet){
      const lab = [].filter.call(sheet.querySelectorAll('.msheet-label'), function(el){ return /^system/i.test(el.textContent.trim()); })[0];
      const grid = lab && lab.nextElementSibling;
      if(grid){ const it = document.createElement('button'); it.className = 'msheet-item'; it.setAttribute('data-goto', 'automations'); it.textContent = 'Automations'; grid.insertBefore(it, grid.firstChild); }
    }
  }

  function tick(){ try{ runActs(); }catch(e){ console.warn('[automations]', e); } if(window.TTOwnerHome) try{ window.TTOwnerHome.render(); }catch(e){} }
  setTimeout(tick, 6000);
  setInterval(function(){ if(!document.hidden) tick(); }, 120000);

  window.TTAutomations = {
    needs: needs, render: render, isOn: isOn, tick: tick,
    openTool: function(id){ goTab('automations'); V.tool = id; render(); },
    // For Home: pinned tools with live summaries, running a tool in place, rules on, recent log with Undo.
    pinned: function(){ return pins().map(function(id){ const t = TOOLS.find(function(x){ return x.id === id; }); let s = ''; try{ s = SUMMARY[id] ? SUMMARY[id]() : ''; }catch(e){} return { id: id, name: t.name, summary: s }; }); },
    runTool: runTool,
    rulesOn: function(){ return RULES.filter(function(r){ return isOn(r.id); }).length; },
    rulesTotal: RULES.length,
    recent: function(n){ return A().log.slice(0, n || 3).map(function(e, i){ return { i: i, at: e.at, text: e.text, undo: !!e.undo }; }); },
    undo: undo,
    printOut: function(html){ const w = window.open('', '_blank'); if(!w) return; w.document.write('<!doctype html><meta charset="utf-8"><title>Thread Tribe</title><style>body{font:14px system-ui,sans-serif;padding:20px}.au-block{border:1px solid #999;border-radius:8px;padding:12px;margin:0 0 14px;page-break-inside:avoid}.au-h{font-weight:700;margin-bottom:6px}.au-h span,.au-li span{color:#555;font-weight:400;margin-left:8px}.au-li{padding:3px 0}</style>' + html); w.document.close(); w.focus(); w.print(); },
    wa: wa
  };
})();
