// Team operations (Control Room), one panel with five views:
//  - Changes: client changes after booking, with their impact, approval, and messages.
//  - Handover: is a booked order complete enough for production? Soft gate on booking.
//  - People: post-print labour (finishing, assembly, packing) needed vs staff available.
//  - Stock: fast movers to keep on the shelf, expected reorders, and a stock order.
//  - On time: orders shipped complete by the promised date, by month, client and rep.
// Uses index.html globals (state, orderTotals, setOrderStatusDirect, newOrderShell, ...)
// and team-flow.js (window.TTFlow) for stages and delay reasons.
(function(){
  if(typeof state === 'undefined') return;

  // ---------- helpers ----------
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function today(){ return isoLocal(); }
  function addDays(s, n){ var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return isoLocal(d); }
  function days(a, b){ if(!a || !b) return null; return Math.round((new Date(String(b).slice(0, 10) + 'T00:00:00') - new Date(String(a).slice(0, 10) + 'T00:00:00')) / 86400000); }
  function fmt(s){ if(!s) return '—'; var d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.getDate() + ' ' + d.toLocaleString('en-IN', { month: 'short' }); }
  function inr(n){ return (n < 0 ? '-' : '') + '₹' + Math.abs(Math.round(n || 0)).toLocaleString('en-IN'); }
  function who(o){ return (o.clientName || o.name || 'Order').trim(); }
  function byId(id){ return state.orders.find(function(o){ return o.id === id; }); }
  function link(o){ return '<a href="#" class="cr-ord" data-cr="open" data-id="' + esc(o.id) + '">' + esc(o.displayId || 'Order') + '</a>'; }
  function cfg(){
    state.teamOps = state.teamOps || {};
    var c = state.teamOps;
    c.minutes = c.minutes || { toy: { finish: 1, assembly: 0, pack: 1 }, lamp: { finish: 5, assembly: 15, pack: 5 }, other: { finish: 2, assembly: 2, pack: 2 } };
    if(!c.staff) c.staff = (state.taskPeople || []).map(function(n){ return { name: n, hours: 8 }; });
    if(c.workDays == null) c.workDays = 6;
    if(c.advancePct == null) c.advancePct = 0;
    if(c.stockWeeks == null) c.stockWeeks = 2;
    c.shelf = c.shelf || {};
    return c;
  }
  function fleetCap(){
    var n = 0; (state.printers || []).forEach(function(p){ if(p.status !== 'down') n++; });
    if(!(state.printers || []).length) n = state.fleet.printers || 0;
    return n * (state.fleet.hoursPerDay || 0);
  }
  function remHours(o){ try{ return orderTotals(o).hours || 0; }catch(e){ return 0; } }
  function kind(p){
    var s = (p.name || '') + ' ' + (p.category || '');
    var c = (state.productCatalog || []).find(function(i){ return (i.name || '').trim().toLowerCase() === (p.name || '').trim().toLowerCase(); });
    if(c) s += ' ' + (c.category || '') + ' ' + (c.type || '');
    s = s.toLowerCase();
    if(/toy|clicker|fidget|flexi/.test(s)) return 'toy';
    if(/lamp|light|pendant|chandelier|sconce/.test(s)) return 'lamp';
    return 'other';
  }
  function lines(o){ return (o.products || []).filter(function(p){ return (p.qty || 0) > 0; }); }
  function waLink(phone, text){ var d = String(phone || '').replace(/\D/g, ''); if(d.length === 10) d = '91' + d; return 'https://wa.me/' + (d || '') + '?text=' + encodeURIComponent(text); }

  // Day the work would finish if this order's hours joined the queue behind orders due earlier.
  function finishFor(o, extraHours){
    var cap = fleetCap(); if(!(cap > 0)) return null;
    var ahead = 0;
    state.orders.forEach(function(x){
      if(x === o || (x.status !== 'booked' && x.status !== 'in_production')) return;
      if(x.status === 'in_production' || !o.dueDate || !x.dueDate || x.dueDate <= o.dueDate) ahead += remHours(x);
    });
    return addDays(today(), Math.max(0, Math.ceil((ahead + remHours(o) + (extraHours || 0)) / cap) - 1));
  }

  // ======================= 3. Changes =======================
  var CH = { form: false, orderId: '', type: 'qty', lineId: '', val: '', note: '' };
  var TYPES = [['qty', 'Quantity'], ['color', 'Colour'], ['due', 'Due date'], ['add', 'Add an item'], ['other', 'Other']];
  function impact(o, type, lineId, val){
    var p = (o.products || []).find(function(x){ return x.id === lineId; }), out = { hours: 0, grams: 0, price: 0, waste: 0, text: [] };
    if(type === 'qty' && p){
      var nq = Math.max(0, parseInt(val, 10) || 0), dq = nq - (p.qty || 0);
      out.hours = dq * (p.hrs || 0); out.grams = dq * (p.fil || 0); out.price = dq * (p.actualPrice || 0);
      if(nq < (p.already || 0)) out.waste = (p.already - nq);
      out.text.push((dq >= 0 ? '+' : '') + dq + ' pcs of ' + (p.name || 'item'));
    } else if(type === 'color' && p){
      out.waste = p.already || 0; out.hours = out.waste * (p.hrs || 0); out.grams = out.waste * (p.fil || 0);
      out.text.push((p.name || 'item') + ': ' + (p.color || 'no colour') + ' → ' + val);
    } else if(type === 'add'){
      var m = /^(.*?)\s*[x×]\s*(\d+)\s*$/i.exec(val || ''), cat = m && (state.productCatalog || []).find(function(i){ return (i.name || '').trim().toLowerCase() === m[1].trim().toLowerCase(); });
      if(m){ var q = +m[2]; out.hours = q * ((cat && +cat.hours) || 0); out.grams = q * ((cat && +cat.weight) || 0); out.text.push('+' + q + ' × ' + m[1].trim()); }
      else out.text.push('Add: ' + val);
    } else if(type === 'due'){ out.text.push('Due ' + fmt(o.dueDate) + ' → ' + fmt(val)); }
    else out.text.push(val || '');
    var fin = finishFor(o, Math.max(0, out.hours));
    out.finish = fin;
    out.due = type === 'due' ? val : o.dueDate;
    out.late = fin && out.due && fin > out.due;
    return out;
  }
  function impactLine(im){
    var bits = [];
    if(im.hours) bits.push((im.hours > 0 ? '+' : '') + (Math.round(im.hours * 10) / 10) + ' print h');
    if(im.grams) bits.push((im.grams > 0 ? '+' : '') + Math.round(im.grams) + ' g filament');
    if(im.price) bits.push((im.price > 0 ? '+' : '') + inr(im.price) + ' order value');
    if(im.waste) bits.push('<b style="color:var(--red)">' + im.waste + ' made pcs wasted</b>');
    if(im.finish) bits.push('finishes ~' + fmt(im.finish) + (im.late ? ' <b style="color:var(--red)">after due ' + fmt(im.due) + '</b>' : ''));
    return bits.join(' · ') || 'No production impact';
  }
  function changesView(){
    var open = state.orders.filter(function(o){ return ['quoted', 'booked', 'in_production', 'production_done'].indexOf(o.status) !== -1; });
    var all = [];
    state.orders.forEach(function(o){ (o.changes || []).forEach(function(c){ all.push({ o: o, c: c }); }); });
    all.sort(function(a, b){ return (a.c.status === 'pending' ? 0 : 1) - (b.c.status === 'pending' ? 0 : 1) || (b.c.at || '').localeCompare(a.c.at || ''); });
    var h = '<p class="to-lead">Log every change a client asks for after booking. See what it costs before you agree, get the client to confirm, and tell the floor in one tap.</p>';
    if(!CH.form) h += '<button type="button" class="to-btn primary" data-to="ch-new">+ Log a change</button>';
    else {
      var o = byId(CH.orderId) || open[0]; if(o) CH.orderId = o.id;
      var ls = o ? lines(o) : [];
      if(o && !ls.some(function(p){ return p.id === CH.lineId; })) CH.lineId = ls[0] ? ls[0].id : '';
      var im = o ? impact(o, CH.type, CH.lineId, CH.val) : null;
      h += '<div class="to-form">' +
        '<label>Order <select data-to-ch="orderId">' + open.map(function(x){ return '<option value="' + esc(x.id) + '"' + (o && x.id === o.id ? ' selected' : '') + '>' + esc((x.displayId || '') + ' · ' + who(x)) + '</option>'; }).join('') + '</select></label>' +
        '<label>Change <select data-to-ch="type">' + TYPES.map(function(t){ return '<option value="' + t[0] + '"' + (CH.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label>' +
        ((CH.type === 'qty' || CH.type === 'color') ? '<label>Item <select data-to-ch="lineId">' + ls.map(function(p){ return '<option value="' + esc(p.id) + '"' + (p.id === CH.lineId ? ' selected' : '') + '>' + esc((p.name || 'Item') + (p.color ? ' · ' + p.color : '') + ' · ' + p.qty + ' pcs') + '</option>'; }).join('') + '</select></label>' : '') +
        '<label>' + (CH.type === 'qty' ? 'New quantity' : CH.type === 'color' ? 'New colour' : CH.type === 'due' ? 'New due date' : CH.type === 'add' ? 'Item × qty (e.g. Rega × 20)' : 'What changed') +
          ' <input data-to-ch="val" type="' + (CH.type === 'due' ? 'date' : CH.type === 'qty' ? 'number' : 'text') + '" value="' + esc(CH.val) + '"></label>' +
        '<label>Note <input data-to-ch="note" value="' + esc(CH.note) + '" placeholder="Who asked, when"></label>' +
        (im ? '<div class="to-impact">Impact: ' + impactLine(im) + '</div>' : '') +
        '<div class="to-row"><button type="button" class="to-btn primary" data-to="ch-save">Save as pending</button><button type="button" class="to-btn" data-to="ch-cancel">Cancel</button></div></div>';
    }
    h += '<table class="to-t"><thead><tr><th>Order</th><th>Change</th><th>Impact</th><th>Status</th><th></th></tr></thead><tbody>' +
      (all.length ? all.slice(0, 40).map(function(x){
        var c = x.c, st = c.status === 'pending' ? '<span class="to-chip amber">Pending</span>' : c.status === 'approved' ? '<span class="to-chip green">Applied ' + fmt(c.doneAt) + '</span>' : '<span class="to-chip">Declined</span>';
        var acts = c.status === 'pending' ? '<button type="button" class="to-btn" data-to="ch-approve" data-id="' + esc(x.o.id) + '" data-c="' + esc(c.id) + '">Approve & apply</button> <button type="button" class="to-btn" data-to="ch-reject" data-id="' + esc(x.o.id) + '" data-c="' + esc(c.id) + '">Decline</button> ' : '';
        acts += '<a class="to-btn" target="_blank" rel="noopener" href="' + esc(waLink(x.o.clientPhone, 'Hi ' + who(x.o) + ', confirming the change to order ' + (x.o.displayId || '') + ': ' + c.summary + '. ' + (c.price ? 'Order value changes by ' + inr(c.price) + '. ' : '') + (c.finish ? 'Expected ready by ' + fmt(c.finish) + '. ' : '') + 'Please reply OK to confirm. — Thread Tribe')) + '">Client</a> ' +
          '<a class="to-btn" target="_blank" rel="noopener" href="' + esc(waLink('', 'Order change ' + (x.o.displayId || '') + ' (' + who(x.o) + '): ' + c.summary + (c.status === 'approved' ? ' — APPLIED, follow the new spec.' : ' — pending, do not start this line yet.'))) + '">Floor</a>';
        return '<tr><td>' + link(x.o) + ' ' + esc(who(x.o)) + '<div class="to-dim">' + fmt(c.at) + (c.note ? ' · ' + esc(c.note) : '') + '</div></td><td>' + esc(c.summary) + '</td><td class="to-small">' + c.impact + '</td><td>' + st + '</td><td class="to-acts">' + acts + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="to-dim">No changes logged yet.</td></tr>') + '</tbody></table>';
    return h;
  }
  function saveChange(){
    var o = byId(CH.orderId); if(!o){ showToast('Pick an order'); return; }
    if(CH.type !== 'other' && !String(CH.val).trim()){ showToast('Fill in the new value'); return; }
    var im = impact(o, CH.type, CH.lineId, CH.val);
    o.changes = (o.changes || []).concat([{ id: newId(), at: today(), type: CH.type, lineId: CH.lineId, val: CH.val, note: CH.note.trim(), status: 'pending',
      summary: im.text.join('; '), impact: impactLine(im), price: im.price, finish: im.finish || '' }]);
    CH = { form: false, orderId: '', type: 'qty', lineId: '', val: '', note: '' };
    scheduleSave(); rerender(); showToast('Change logged as pending');
  }
  function applyChange(o, c){
    var p = (o.products || []).find(function(x){ return x.id === c.lineId; });
    if(c.type === 'qty' && p) p.qty = Math.max(0, parseInt(c.val, 10) || 0);
    else if(c.type === 'color' && p){ p.color = c.val; if(p.already) { p.failed = (p.failed || 0) + p.already; p.already = 0; } }
    else if(c.type === 'due'){
      var was = o.dueDate; o.dueDate = c.val;
      // A later date asked for by the client is a client-caused delay.
      if(was && c.val > was && window.TTFlow) o.delays = (o.delays || []).concat([{ id: newId(), stage: window.TTFlow.stageOf(o), reason: 'client_change', note: 'Due ' + fmt(was) + ' → ' + fmt(c.val), at: today() }]);
    }
    else if(c.type === 'add'){
      var m = /^(.*?)\s*[x×]\s*(\d+)\s*$/i.exec(c.val || ''), name = m ? m[1].trim() : c.val, q = m ? +m[2] : 1;
      var cat = (state.productCatalog || []).find(function(i){ return (i.name || '').trim().toLowerCase() === name.toLowerCase(); });
      o.products.push({ id: newId(), name: cat ? cat.name : name, qty: q, already: 0, failed: 0, hrs: cat ? +cat.hours || 0 : 0, fil: cat ? +cat.weight || 0 : 0, color: '', colorHex: '', material: cat ? cat.material || '' : '', listPrice: 0, actualPrice: 0, catalogId: cat ? cat.id : '' });
    }
    c.status = 'approved'; c.doneAt = today();
    o.notes = ((o.notes || '') + '\nChange ' + fmt(c.doneAt) + ': ' + c.summary).trim();
  }

  // ======================= 4. Handover =======================
  function checks(o){
    var ls = lines(o), t = orderTotals(o), c = cfg(), out = [];
    function add(ok, label){ out.push({ ok: !!ok, label: label }); }
    add(o.clientPhone || o.clientId, 'Client phone');
    add((o.clientAddress || '').trim(), 'Delivery address');
    add(ls.length, 'At least one item');
    add(ls.length && ls.every(function(p){ return (p.color || '').trim(); }), 'Colour on every item');
    add(ls.length && ls.every(function(p){ return (p.hrs || 0) > 0 && (p.fil || 0) > 0; }), 'Print time and weight on every item');
    add(ls.length && ls.every(function(p){ return (p.actualPrice || 0) > 0; }), 'Price on every item');
    add(o.dueDate, 'Due date agreed');
    if(o.dueDate){ var f = finishFor(o); add(!f || f <= o.dueDate, 'Due date fits capacity' + (f ? ' (ready ~' + fmt(f) + ')' : '')); }
    if(c.advancePct > 0) add((o.amountPaid || 0) >= t.grandTotal * c.advancePct / 100 - 1, c.advancePct + '% advance received');
    return out;
  }
  function missing(o){ return checks(o).filter(function(x){ return !x.ok; }).map(function(x){ return x.label; }); }
  function handoverView(){
    var c = cfg(), list = state.orders.filter(function(o){ return o.status === 'booked' || o.status === 'quoted'; })
      .map(function(o){ return { o: o, miss: missing(o) }; }).sort(function(a, b){ return b.miss.length - a.miss.length; });
    var since = addDays(today(), -60), reps = {};
    state.orders.forEach(function(o){
      if(!o.handover || o.handover.at < since) return;
      var r = o.handover.rep || o.salesRep || 'No rep'; reps[r] = reps[r] || { n: 0, bad: 0 }; reps[r].n++; if(o.handover.missing.length) reps[r].bad++;
    });
    return '<p class="to-lead">Production starts the same day only if sales hands over a complete order. Booking an order with gaps now asks first and records what was missing.</p>' +
      '<div class="to-row"><label>Advance needed before booking <input type="number" min="0" max="100" data-to-cfg="advancePct" value="' + c.advancePct + '" style="width:64px">%</label></div>' +
      '<table class="to-t"><thead><tr><th>Order</th><th>Rep</th><th>Status</th><th>Missing</th></tr></thead><tbody>' +
      (list.length ? list.map(function(x){ return '<tr><td>' + link(x.o) + ' ' + esc(who(x.o)) + '</td><td>' + esc(x.o.salesRep || '—') + '</td><td>' + (x.o.status === 'quoted' ? 'Quote' : 'Booked') + '</td><td>' +
        (x.miss.length ? x.miss.map(function(m){ return '<span class="to-chip red">' + esc(m) + '</span>'; }).join(' ') : '<span class="to-chip green">Ready for production</span>') + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="to-dim">No quotes or booked orders waiting.</td></tr>') +
      '</tbody></table>' +
      '<h4 class="to-h">Handover quality by rep · last 60 days</h4>' +
      (Object.keys(reps).length ? '<table class="to-t"><thead><tr><th>Rep</th><th class="n">Orders booked</th><th class="n">Booked with gaps</th></tr></thead><tbody>' +
        Object.keys(reps).sort(function(a, b){ return reps[b].bad / reps[b].n - reps[a].bad / reps[a].n; }).map(function(r){ var x = reps[r], p = Math.round(x.bad / x.n * 100);
          return '<tr><td>' + esc(r) + '</td><td class="n">' + x.n + '</td><td class="n"><b style="color:' + (p > 30 ? 'var(--red)' : 'var(--text)') + '">' + p + '%</b></td></tr>'; }).join('') + '</tbody></table>'
        : '<p class="to-dim">Fills in as orders are booked from now on.</p>');
  }
  // Soft gate: booking (quote → booked, or straight to printing) with gaps asks first.
  if(typeof setOrderStatusDirect === 'function'){
    var origSet = setOrderStatusDirect;
    setOrderStatusDirect = function(orderId, newStatus){
      var o = byId(orderId), self = this, args = arguments;
      var booking = o && (o.status === 'quoted' && ['booked', 'in_production'].indexOf(newStatus) !== -1 || o.status === 'booked' && newStatus === 'in_production');
      if(!booking) return origSet.apply(self, args);
      var miss = missing(o);
      function go(){ if(o.status === 'quoted' || !o.handover) o.handover = { at: today(), missing: miss, rep: o.salesRep || '' }; return origSet.apply(self, args); }
      if(!miss.length) return go();
      showConfirmModal('This order is missing: ' + miss.join(', ') + '. Production may have to come back to sales. ' + (newStatus === 'in_production' ? 'Start printing' : 'Book it') + ' anyway?', go, newStatus === 'in_production' ? 'Start anyway' : 'Book anyway');
    };
  }

  // ======================= 5. People =======================
  var STEPS = [['finish', 'Finishing (cleanup, sanding)'], ['assembly', 'Assembly & wiring'], ['pack', 'QC & packing']];
  function labour(){
    var c = cfg(), need = { finish: 0, assembly: 0, pack: 0 }, horizon = addDays(today(), 7), byOrder = [];
    state.orders.forEach(function(o){
      var st = o.status, inWindow = st === 'in_production' || (st === 'production_done' && !o.shippedDate) || (st === 'booked' && o.dueDate && o.dueDate <= horizon);
      if(!inWindow) return;
      var row = { o: o, finish: 0, assembly: 0, pack: 0 };
      lines(o).forEach(function(p){
        var m = c.minutes[kind(p)] || c.minutes.other, q = p.qty || 0;
        // A made order only has packing left; anything still printing or booked needs all three.
        if(st !== 'production_done'){ row.finish += q * m.finish / 60; row.assembly += q * m.assembly / 60; }
        row.pack += q * m.pack / 60;
      });
      STEPS.forEach(function(s){ need[s[0]] += row[s[0]]; });
      byOrder.push(row);
    });
    var perDay = c.staff.reduce(function(t, p){ return t + (+p.hours || 0); }, 0), avail = perDay * c.workDays;
    var total = need.finish + need.assembly + need.pack;
    return { need: need, total: total, avail: avail, perDay: perDay, byOrder: byOrder };
  }
  function peopleView(){
    var c = cfg(), L = labour(), over = L.total - L.avail, max = Math.max(L.total, L.avail, 1);
    var big = STEPS.slice().sort(function(a, b){ return L.need[b[0]] - L.need[a[0]]; })[0];
    var verdict = !L.avail ? 'Add your team below to compare work with people.'
      : over > 0 ? '⚠ <b>' + Math.round(over) + ' hours more work than people</b> this week. Add about ' + Math.ceil(over / 8) + ' person-day' + (Math.ceil(over / 8) === 1 ? '' : 's') + ' (biggest load: ' + big[1].toLowerCase() + '), or move due dates.'
      : L.total / L.avail > 0.85 ? 'Tight: ' + Math.round(L.total / L.avail * 100) + '% of team hours are booked. No room for absences.'
      : 'Team has ' + Math.round(L.avail - L.total) + ' spare hours this week (' + Math.round(L.total / L.avail * 100) + '% used).';
    return '<p class="to-lead">Printers are planned; people aren’t. This adds up finishing, assembly and packing for orders printing, made, or due in the next 7 days, against your team’s hours.</p>' +
      '<p class="to-verdict">' + verdict + '</p>' +
      '<div class="to-bars">' + STEPS.map(function(s){ var v = L.need[s[0]]; return '<div class="to-h"><span>' + esc(s[1]) + '</span><span class="to-bar"><i style="width:' + (v / max * 100) + '%;background:var(--cyan)"></i></span><b>' + Math.round(v) + 'h</b></div>'; }).join('') +
        '<div class="to-h"><span><b>Total needed</b></span><span class="to-bar"><i style="width:' + (L.total / max * 100) + '%;background:' + (over > 0 ? 'var(--red)' : 'var(--green)') + '"></i><em style="left:' + (L.avail / max * 100) + '%" title="Team hours available"></em></span><b>' + Math.round(L.total) + 'h</b></div>' +
        '<div class="to-dim">Tick = team hours available this week: ' + Math.round(L.avail) + 'h (' + L.perDay + 'h a day × ' + c.workDays + ' days).</div></div>' +
      '<details class="to-set"><summary>Team and minutes per piece</summary><div class="to-cols"><div><h4 class="to-h">Team</h4>' +
        c.staff.map(function(p, i){ return '<div class="to-row"><input data-to-staff="' + i + '" data-f="name" value="' + esc(p.name) + '" placeholder="Name"><input type="number" min="0" step="0.5" data-to-staff="' + i + '" data-f="hours" value="' + (p.hours || 0) + '" style="width:64px"> h/day <button type="button" class="to-btn" data-to="staff-del" data-i="' + i + '">✕</button></div>'; }).join('') +
        '<button type="button" class="to-btn" data-to="staff-add">+ Add person</button> <label>Working days a week <input type="number" min="1" max="7" data-to-cfg="workDays" value="' + c.workDays + '" style="width:56px"></label></div>' +
        '<div><h4 class="to-h">Minutes per piece</h4><table class="to-t"><thead><tr><th></th>' + STEPS.map(function(s){ return '<th>' + esc(s[1].split(' ')[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        ['toy', 'lamp', 'other'].map(function(k){ return '<tr><td>' + (k === 'toy' ? 'Toys' : k === 'lamp' ? 'Lamps' : 'Other') + '</td>' + STEPS.map(function(s){ return '<td><input type="number" min="0" step="0.5" data-to-min="' + k + '" data-s="' + s[0] + '" value="' + c.minutes[k][s[0]] + '" style="width:60px"></td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div></div></details>' +
      '<h4 class="to-h">Where the hours go</h4><table class="to-t"><thead><tr><th>Order</th><th>Stage</th>' + STEPS.map(function(s){ return '<th class="n">' + esc(s[1].split(' ')[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (L.byOrder.length ? L.byOrder.sort(function(a, b){ return (b.finish + b.assembly + b.pack) - (a.finish + a.assembly + a.pack); }).slice(0, 25).map(function(r){
          return '<tr><td>' + link(r.o) + ' ' + esc(who(r.o)) + '</td><td>' + esc(r.o.status === 'production_done' ? 'Made' : r.o.status === 'in_production' ? 'Printing' : 'Booked, due ' + fmt(r.o.dueDate)) + '</td>' + STEPS.map(function(s){ return '<td class="n">' + (Math.round(r[s[0]] * 10) / 10) + 'h</td>'; }).join('') + '</tr>'; }).join('')
          : '<tr><td colspan="5" class="to-dim">No post-print work in the next 7 days.</td></tr>') + '</tbody></table>';
  }

  // ======================= 6. Stock =======================
  function stockData(){
    var c = cfg(), since = addDays(today(), -90), items = {}, clients = {};
    state.orders.forEach(function(o){
      if(['booked', 'in_production', 'production_done', 'delivered'].indexOf(o.status) === -1) return;
      if(/^stock\b/i.test(o.clientName || '')) return;
      var d = o.orderedDate || o.productionDoneDate || o.deliveryDate || '';
      var k = who(o); if(d){ (clients[k] = clients[k] || { dates: [], items: {} }).dates.push(d); }
      if(d < since) return;
      lines(o).forEach(function(p){
        var key = (p.name || '').trim() + '|' + (p.color || '').trim();
        var it = items[key] = items[key] || { name: (p.name || '').trim(), color: (p.color || '').trim(), units: 0, orders: {}, clients: {}, hrs: p.hrs || 0, fil: p.fil || 0, price: p.actualPrice || 0, material: p.material || '' };
        it.units += p.qty || 0; it.orders[o.id] = 1; it.clients[k] = 1;
        if(clients[k]) clients[k].items[it.name] = (clients[k].items[it.name] || 0) + (p.qty || 0);
      });
    });
    var movers = Object.keys(items).map(function(k){
      var it = items[k], n = Object.keys(it.orders).length, cl = Object.keys(it.clients).length;
      var weekly = it.units / 13, target = Math.ceil(weekly * c.stockWeeks), have = +c.shelf[k] || 0;
      return { key: k, name: it.name, color: it.color, units: it.units, n: n, clients: cl, weekly: weekly, target: target, have: have, make: Math.max(0, target - have), hrs: it.hrs, fil: it.fil, price: it.price, material: it.material };
    }).filter(function(m){ return m.name && (m.n >= 3 || m.clients >= 2); }).sort(function(a, b){ return b.units - a.units; });
    var reorders = Object.keys(clients).map(function(k){
      var ds = clients[k].dates.sort(), gaps = [];
      for(var i = 1; i < ds.length; i++){ var g = days(ds[i - 1], ds[i]); if(g > 3) gaps.push(g); }
      if(gaps.length < 1) return null;
      var avg = Math.round(gaps.reduce(function(a, b){ return a + b; }, 0) / gaps.length), next = addDays(ds[ds.length - 1], avg);
      var top = Object.keys(clients[k].items).sort(function(a, b){ return clients[k].items[b] - clients[k].items[a]; }).slice(0, 3);
      return { client: k, last: ds[ds.length - 1], every: avg, next: next, items: top, orders: ds.length };
    }).filter(function(r){ return r && r.next <= addDays(today(), 21); }).sort(function(a, b){ return a.next.localeCompare(b.next); });
    var cap14 = fleetCap() * 14, booked = 0;
    state.orders.forEach(function(o){ if(o.status === 'booked' || o.status === 'in_production') booked += remHours(o); });
    return { movers: movers, reorders: reorders, spare: Math.max(0, cap14 - booked), cap14: cap14 };
  }
  function stockView(){
    var c = cfg(), S = stockData(), plan = S.movers.filter(function(m){ return m.make > 0; }), planH = plan.reduce(function(t, m){ return t + m.make * m.hrs; }, 0);
    return '<p class="to-lead">Best sellers printed to the shelf in idle printer time ship in a day instead of waiting in the queue. Fast movers = ordered 3+ times or by 2+ clients in 90 days.</p>' +
      '<p class="to-verdict">' + (!S.movers.length ? 'Not enough repeat orders yet to pick fast movers.'
        : 'Printers have <b>' + Math.round(S.spare) + 'h</b> spare in the next 14 days. Topping the shelf up to ' + c.stockWeeks + ' weeks of demand needs <b>' + Math.round(planH) + 'h</b>' + (planH > S.spare ? ', more than the spare time: print the top lines first.' : '. It fits.')) + '</p>' +
      '<div class="to-row"><label>Keep on shelf <input type="number" min="0" max="12" step="0.5" data-to-cfg="stockWeeks" value="' + c.stockWeeks + '" style="width:56px"> weeks of demand</label>' +
        (plan.length ? ' <button type="button" class="to-btn primary" data-to="stock-order">Create stock order (' + plan.length + ' item' + (plan.length === 1 ? '' : 's') + ')</button>' : '') + '</div>' +
      '<table class="to-t"><thead><tr><th>Product</th><th class="n">Sold 90d</th><th class="n">Per week</th><th class="n">Keep</th><th class="n">On shelf</th><th class="n">To print</th></tr></thead><tbody>' +
      (S.movers.length ? S.movers.slice(0, 25).map(function(m){ return '<tr><td>' + esc(m.name) + (m.color ? ' <span class="to-dim">' + esc(m.color) + '</span>' : '') + '<div class="to-dim">' + m.n + ' orders · ' + m.clients + ' clients</div></td><td class="n">' + m.units + '</td><td class="n">' + (Math.round(m.weekly * 10) / 10) + '</td><td class="n">' + m.target + '</td>' +
        '<td class="n"><input type="number" min="0" data-to-shelf="' + esc(m.key) + '" value="' + m.have + '" style="width:64px"></td><td class="n"><b>' + m.make + '</b>' + (m.make && m.hrs ? '<div class="to-dim">' + Math.round(m.make * m.hrs) + 'h</div>' : '') + '</td></tr>'; }).join('')
        : '<tr><td colspan="6" class="to-dim">No fast movers yet.</td></tr>') + '</tbody></table>' +
      '<h4 class="to-h">Expected reorders · next 3 weeks</h4>' +
      (S.reorders.length ? '<table class="to-t"><thead><tr><th>Client</th><th>Usually every</th><th>Last order</th><th>Expected</th><th>Usually buys</th></tr></thead><tbody>' +
        S.reorders.map(function(r){ var late = r.next < today(); return '<tr><td>' + esc(r.client) + '</td><td>' + r.every + ' days</td><td>' + fmt(r.last) + '</td><td>' + (late ? '<b style="color:var(--amber)">' + fmt(r.next) + ' (due, call them)</b>' : fmt(r.next)) + '</td><td>' + esc(r.items.join(', ')) + '</td></tr>'; }).join('') + '</tbody></table>'
        : '<p class="to-dim">No repeat clients due to reorder in the next 3 weeks.</p>');
  }
  function createStockOrder(){
    var S = stockData(), plan = S.movers.filter(function(m){ return m.make > 0; });
    if(!plan.length) return;
    var o = newOrderShell('booked');
    o.name = 'Shelf stock'; o.clientName = 'Stock (Thread Tribe)'; o.priority = 'low'; o.orderedDate = today(); o.dueDate = addDays(today(), 14);
    o.notes = 'Make-to-stock from fast movers (' + cfg().stockWeeks + ' weeks of demand). Print in idle time.';
    o.products = plan.map(function(m){ return { id: newId(), name: m.name, qty: m.make, already: 0, failed: 0, hrs: m.hrs, fil: m.fil, color: m.color, colorHex: '', material: m.material, listPrice: 0, actualPrice: 0 }; });
    o.handover = { at: today(), missing: [], rep: '' };
    state.orders.push(o);
    if(typeof recalcQueue === 'function') recalcQueue();
    scheduleSave(); rerender();
    showToast('Stock order ' + (o.displayId || '') + ' created at low priority');
  }

  // ======================= 7. On time =======================
  function otif(){
    var start = (function(){ var d = new Date(); return isoLocal(new Date(d.getFullYear(), d.getMonth() - 5, 1)); })(), rows = [];
    state.orders.forEach(function(o){
      if(!o.dueDate || /^stock\b/i.test(o.clientName || '')) return;
      var sent = o.shippedDate || (o.status === 'delivered' ? (o.deliveryDate || o.productionDoneDate) : '');
      if(!sent || sent < start) return;
      var full = o.status === 'delivered' || lines(o).every(function(p){ return (p.already || 0) >= (p.qty || 0); }) || !!o.shippedDate;
      rows.push({ o: o, sent: sent, onTime: sent <= o.dueDate, full: full, late: Math.max(0, days(o.dueDate, sent)) });
    });
    return rows;
  }
  function otView(){
    var R = otif(), months = [], d = new Date();
    for(var i = 5; i >= 0; i--){ var m = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push({ key: isoLocal(m).slice(0, 7), label: m.toLocaleString('en-IN', { month: 'short' }), n: 0, ok: 0 }); }
    var byC = {}, byR = {};
    R.forEach(function(r){
      var good = r.onTime && r.full, mo = months.find(function(m){ return m.key === r.sent.slice(0, 7); });
      if(mo){ mo.n++; if(good) mo.ok++; }
      var c = who(r.o), rep = r.o.salesRep || '—';
      (byC[c] = byC[c] || { n: 0, ok: 0 }); byC[c].n++; if(good) byC[c].ok++;
      (byR[rep] = byR[rep] || { n: 0, ok: 0 }); byR[rep].n++; if(good) byR[rep].ok++;
    });
    var tot = R.length, ok = R.filter(function(r){ return r.onTime && r.full; }).length, pct = tot ? Math.round(ok / tot * 100) : null;
    var cur = months[5], prev = months[4];
    function p(x){ return x.n ? Math.round(x.ok / x.n * 100) : null; }
    var lateRows = R.filter(function(r){ return !(r.onTime && r.full); }).sort(function(a, b){ return b.sent.localeCompare(a.sent); }).slice(0, 20);
    function tbl(obj, label){ var ks = Object.keys(obj).sort(function(a, b){ return obj[a].ok / obj[a].n - obj[b].ok / obj[b].n; }); return '<table class="to-t"><thead><tr><th>' + label + '</th><th class="n">Orders</th><th class="n">On time</th></tr></thead><tbody>' + ks.slice(0, 10).map(function(k){ var v = Math.round(obj[k].ok / obj[k].n * 100); return '<tr><td>' + esc(k) + '</td><td class="n">' + obj[k].n + '</td><td class="n"><b style="color:' + (v < 80 ? 'var(--red)' : 'var(--green)') + '">' + v + '%</b></td></tr>'; }).join('') + '</tbody></table>'; }
    return '<p class="to-lead">On time in full: shipped complete on or before the due date. One number for whether the team is getting faster.</p>' +
      '<p class="to-verdict">' + (pct === null ? 'No shipped orders with due dates in the last 6 months yet.'
        : '<b style="font-size:20px">' + pct + '%</b> of ' + tot + ' orders on time in full (6 months). ' + (p(cur) !== null ? 'This month ' + p(cur) + '%' + (p(prev) !== null ? ', last month ' + p(prev) + '%.' : '.') : '') + (pct < 90 ? ' Target 90%+: the late list and reasons below show what to fix.' : ' Strong.')) + '</p>' +
      '<div class="to-months">' + months.map(function(m){ var v = p(m); return '<div class="to-m" title="' + m.ok + ' of ' + m.n + ' on time"><span class="to-mb"><i style="height:' + (v || 0) + '%;background:' + (v === null ? 'transparent' : v < 80 ? 'var(--red)' : 'var(--green)') + '"></i></span><b>' + (v === null ? '—' : v + '%') + '</b><span>' + m.label + '</span></div>'; }).join('') + '</div>' +
      '<div class="to-cols"><div><h4 class="to-h">By client, worst first</h4>' + tbl(byC, 'Client') + '</div><div><h4 class="to-h">By sales rep</h4>' + tbl(byR, 'Rep') + '</div></div>' +
      '<h4 class="to-h">Late orders</h4><table class="to-t"><thead><tr><th>Order</th><th>Due</th><th>Shipped</th><th class="n">Days late</th><th>Reason</th></tr></thead><tbody>' +
      (lateRows.length ? lateRows.map(function(r){
        var rs = (r.o.delays || []).map(function(x){ return window.TTFlow ? window.TTFlow.reasonLabel(x.reason) : x.reason; });
        return '<tr><td>' + link(r.o) + ' ' + esc(who(r.o)) + '</td><td>' + fmt(r.o.dueDate) + '</td><td>' + fmt(r.sent) + '</td><td class="n">' + r.late + '</td><td>' +
          (rs.length ? rs.map(function(x){ return '<span class="to-chip amber">' + esc(x) + '</span>'; }).join(' ')
            : '<select data-to-otr="' + esc(r.o.id) + '"><option value="">Add reason…</option>' + (window.TTFlow ? [['printing', 'Production'], ['made', 'Packing & dispatch']].map(function(g){ return '<optgroup label="' + g[1] + '">' + window.TTFlow.reasonsFor(g[0]).map(function(x){ return '<option value="' + g[0] + ':' + x[0] + '">' + esc(x[1]) + '</option>'; }).join('') + '</optgroup>'; }).join('') : '') + '</select>') + '</td></tr>'; }).join('')
        : '<tr><td colspan="5" class="to-dim">No late orders.</td></tr>') + '</tbody></table>';
  }

  // ======================= panel =======================
  var V = { tab: 'changes' };
  var TABS = [['changes', 'Changes'], ['handover', 'Handover check'], ['people', 'People'], ['stock', 'Stock to keep'], ['ontime', 'On time']];
  function badge(k){
    if(k === 'changes'){ var n = 0; state.orders.forEach(function(o){ (o.changes || []).forEach(function(c){ if(c.status === 'pending') n++; }); }); return n; }
    if(k === 'handover') return state.orders.filter(function(o){ return o.status === 'booked' && missing(o).length; }).length;
    return 0;
  }
  function html(){
    var body = V.tab === 'changes' ? changesView() : V.tab === 'handover' ? handoverView() : V.tab === 'people' ? peopleView() : V.tab === 'stock' ? stockView() : otView();
    return '<div class="panel to"><div class="to-tabs">' + TABS.map(function(t){ var b = badge(t[0]); return '<button type="button" class="' + (V.tab === t[0] ? 'on' : '') + '" data-to="tab" data-k="' + t[0] + '">' + t[1] + (b ? ' <span class="to-badge">' + b + '</span>' : '') + '</button>'; }).join('') + '</div>' + body + '</div>';
  }

  // ---------- events ----------
  function rerender(){ if(window.renderControlRoom) window.renderControlRoom(); }
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-to]'); if(!b || !e.target.closest('#tabControl')) return;
    var a = b.getAttribute('data-to');
    if(a === 'tab'){ V.tab = b.getAttribute('data-k'); rerender(); }
    else if(a === 'ch-new'){ CH.form = true; rerender(); }
    else if(a === 'ch-cancel'){ CH.form = false; rerender(); }
    else if(a === 'ch-save') saveChange();
    else if(a === 'ch-approve' || a === 'ch-reject'){
      var o = byId(b.getAttribute('data-id')), c = o && (o.changes || []).find(function(x){ return x.id === b.getAttribute('data-c'); }); if(!c) return;
      if(a === 'ch-reject'){ c.status = 'declined'; c.doneAt = today(); scheduleSave(); rerender(); return; }
      showConfirmModal('Apply this change to ' + (o.displayId || 'the order') + '? ' + c.summary + '. The order is updated and a note added.', function(){
        applyChange(o, c); if(typeof recalcQueue === 'function') recalcQueue(); if(typeof renderOrders === 'function') renderOrders(); scheduleSave(); rerender(); showToast('Change applied');
      }, 'Apply change');
    }
    else if(a === 'staff-add'){ cfg().staff.push({ name: '', hours: 8 }); scheduleSave(); rerender(); }
    else if(a === 'staff-del'){ cfg().staff.splice(+b.getAttribute('data-i'), 1); scheduleSave(); rerender(); }
    else if(a === 'stock-order'){ showConfirmModal('Create a booked, low-priority stock order for the fast movers below? It joins the production queue like any order.', createStockOrder, 'Create stock order'); }
  });
  document.addEventListener('input', function(e){
    var k = e.target.getAttribute && e.target.getAttribute('data-to-ch');
    if(k){ CH[k] = e.target.value; if(k === 'orderId' || k === 'type'){ if(k === 'type') CH.val = ''; rerender(); } else { var o = byId(CH.orderId); var box = document.querySelector('#tabControl .to-impact'); if(o && box) box.innerHTML = 'Impact: ' + impactLine(impact(o, CH.type, CH.lineId, CH.val)); } }
  });
  document.addEventListener('change', function(e){
    var t = e.target, g = function(n){ return t.getAttribute && t.getAttribute(n); };
    if(!t.closest || !t.closest('#tabControl .to')) return;
    if(g('data-to-ch') === 'lineId'){ CH.lineId = t.value; rerender(); }
    else if(g('data-to-cfg')){ cfg()[g('data-to-cfg')] = Math.max(0, +t.value || 0); scheduleSave(); rerender(); }
    else if(g('data-to-staff') != null){ var p = cfg().staff[+g('data-to-staff')]; if(p){ p[g('data-f')] = g('data-f') === 'hours' ? Math.max(0, +t.value || 0) : t.value.trim(); scheduleSave(); rerender(); } }
    else if(g('data-to-min')){ cfg().minutes[g('data-to-min')][g('data-s')] = Math.max(0, +t.value || 0); scheduleSave(); rerender(); }
    else if(g('data-to-shelf')){ cfg().shelf[g('data-to-shelf')] = Math.max(0, parseInt(t.value, 10) || 0); scheduleSave(); rerender(); }
    else if(g('data-to-otr')){ var o = byId(g('data-to-otr')); if(o && t.value){ var sr = t.value.split(':'); o.delays = (o.delays || []).concat([{ id: newId(), stage: sr[0], reason: sr[1], note: 'Shipped late', at: today() }]); scheduleSave(); rerender(); } }
  });

  var css = document.createElement('style');
  css.textContent = [
    '#tabControl .to-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px}',
    '#tabControl .to-tabs button{background:transparent;border:1px solid var(--line);border-radius:999px;padding:6px 14px;font:13px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer}',
    '#tabControl .to-tabs button.on{border-color:var(--cyan);background:rgba(79,209,197,.12)}',
    '#tabControl .to-badge{background:var(--amber);color:#111;border-radius:999px;padding:0 6px;font-size:11px;margin-left:3px}',
    '#tabControl .to-lead{font-size:13px;color:var(--dim);margin:0 0 10px}',
    '#tabControl .to-verdict{font-size:14px;margin:0 0 12px}',
    '#tabControl .to-btn{display:inline-block;background:transparent;border:1px solid var(--line);border-radius:8px;padding:5px 11px;font:12.5px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer;text-decoration:none;white-space:nowrap}',
    '#tabControl .to-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600}',
    '#tabControl .to-form{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);margin-bottom:12px}',
    '#tabControl .to-form label,#tabControl .to-row label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dim)}',
    '#tabControl .to-row label{flex-direction:row;align-items:center;gap:6px}',
    '#tabControl .to input,#tabControl .to select{padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text);font:inherit;font-size:13px}',
    '#tabControl .to-impact{width:100%;font-size:13px}',
    '#tabControl .to-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}',
    '#tabControl .to-t{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}',
    '#tabControl .to-t th{text-align:left;font-weight:500;color:var(--dim);font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line)}',
    '#tabControl .to-t td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:middle}',
    '#tabControl .to-t .n{text-align:right}',
    '#tabControl .to-acts{white-space:nowrap}',
    '#tabControl .to-small{font-size:12px}',
    '#tabControl .to-dim{color:var(--dim);font-size:12px}',
    '#tabControl .to-chip{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--panel2);color:var(--dim);margin:1px 0}',
    '#tabControl .to-chip.red{background:rgba(232,97,90,.12);color:var(--red)}',
    '#tabControl .to-chip.green{background:rgba(126,208,138,.15);color:var(--green)}',
    '#tabControl .to-chip.amber{background:rgba(240,168,60,.14);color:var(--amber)}',
    '#tabControl .to-h{font-size:11.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);margin:16px 0 6px;font-family:"JetBrains Mono",monospace;font-weight:500}',
    '#tabControl .to-bars .to-h{display:grid;grid-template-columns:200px 1fr 50px;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font:13px "Space Grotesk",sans-serif;color:var(--text);margin:8px 0}',
    '#tabControl .to-bar{position:relative;height:12px;background:var(--panel2);border-radius:4px}',
    '#tabControl .to-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:0 4px 4px 0}',
    '#tabControl .to-bar em{position:absolute;top:-4px;bottom:-4px;border-left:2px solid var(--text)}',
    '#tabControl .to-set{margin-top:12px}#tabControl .to-set summary{cursor:pointer;color:var(--dim);font-size:12.5px}',
    '#tabControl .to-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}',
    '@media (max-width:900px){#tabControl .to-cols{grid-template-columns:1fr}#tabControl .to-bars .to-h{grid-template-columns:120px 1fr 44px}}',
    '#tabControl .to-months{display:flex;gap:12px;align-items:flex-end;height:120px;margin:4px 0 8px}',
    '#tabControl .to-m{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:12px;height:100%}',
    '#tabControl .to-mb{flex:1;width:28px;background:var(--panel2);border-radius:4px;position:relative;display:flex;align-items:flex-end;overflow:hidden}',
    '#tabControl .to-mb i{width:100%;border-radius:4px 4px 0 0}',
    '#tabControl .to-m span:last-child{color:var(--dim)}'
  ].join('');
  document.head.appendChild(css);

  window.TTTeamOps = { html: html, missing: missing };
})();
