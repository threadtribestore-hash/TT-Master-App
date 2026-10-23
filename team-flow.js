// Team flow (Control Room): where orders wait between people, and why orders run late.
//
// 1. Handoffs. An order moves quote -> booked -> printing -> made -> shipped -> paid. Each
//    stage has an owner and a target number of days (state.flow). Control Room shows
//    which orders sit past target, with whom, and the last 30 days' average per handoff.
// 2. Delay reasons. Any order past target (or past its due date) can be tagged with a
//    reason (order.delays). The report ranks reasons by orders and days lost.
//
// Stage changes are timestamped in order.stageLog from now on (via scheduleSave), so
// waits are exact; older orders fall back to the dates already on the order.
(function(){
  if(typeof state === 'undefined') return;

  var STAGES = [
    { key: 'quote', label: 'Quote decision', from: 'Quoted', team: 'Sales', target: 3, hint: 'Quote sent, waiting for the client to book' },
    { key: 'booked', label: 'Start printing', from: 'Booked', team: 'Production', target: 1, hint: 'Booked, printing not started' },
    { key: 'printing', label: 'Printing', from: 'Printing', team: 'Production', target: 2, hint: 'Target = print days at fleet capacity + these buffer days' },
    { key: 'made', label: 'Pack & dispatch', from: 'Made', team: 'Packing', target: 2, hint: 'Made, not yet shipped' },
    { key: 'shipped', label: 'Delivery', from: 'Shipped', team: 'Dispatch', target: 4, hint: 'Shipped, not yet marked delivered' },
    { key: 'payment', label: 'Collect payment', from: 'Delivered', team: 'Accounts', target: 7, hint: 'Delivered, money still owed' }
  ];
  var REASONS = [
    ['client_wait', 'Waiting on client (approval, artwork, details)'],
    ['client_change', 'Client changed the order'],
    ['advance', 'Waiting for advance payment'],
    ['filament', 'Filament out of stock'],
    ['print_fail', 'Print failures or reprints'],
    ['capacity', 'Printers fully booked'],
    ['partner', 'Partner job late'],
    ['setup', 'Print file or product details missing'],
    ['packing', 'Packing backlog or short-staffed'],
    ['courier', 'Courier pickup or transit delay'],
    ['other', 'Other']
  ];
  function reasonLabel(k){ var r = REASONS.find(function(x){ return x[0] === k; }); return r ? r[1] : k; }

  // ---------- helpers ----------
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function today(){ return isoLocal(); }
  function days(a, b){ if(!a || !b) return null; return Math.round((new Date(String(b).slice(0, 10) + 'T00:00:00') - new Date(String(a).slice(0, 10) + 'T00:00:00')) / 86400000); }
  function fmt(s){ if(!s) return '—'; var d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.getDate() + ' ' + d.toLocaleString('en-IN', { month: 'short' }); }
  function who(o){ return (o.clientName || o.name || 'Order').trim(); }
  function cfg(){
    state.flow = state.flow || {};
    state.flow.targets = state.flow.targets || {};
    state.flow.owners = state.flow.owners || {};
    return state.flow;
  }
  function target(stageKey){ var v = cfg().targets[stageKey]; return v != null && v !== '' ? +v : STAGES.find(function(s){ return s.key === stageKey; }).target; }
  function ownerOf(stageKey, o){
    // A quote belongs to the order's salesperson when one is set.
    if(stageKey === 'quote' && o && o.salesRep) return o.salesRep;
    return cfg().owners[stageKey] || STAGES.find(function(s){ return s.key === stageKey; }).team;
  }
  function owes(o){
    if(typeof orderOwesMoney === 'function') return orderOwesMoney(o);
    var ps = o.paymentStatus || 'unpaid'; return ps !== 'paid' && ps !== 'refunded' && orderAmountDue(o) > 0;
  }
  function stageOf(o){
    if(o.status === 'quoted') return 'quote';
    if(o.status === 'booked') return 'booked';
    if(o.status === 'in_production') return 'printing';
    if(o.status === 'production_done') return o.shippedDate ? 'shipped' : 'made';
    if(o.status === 'delivered') return owes(o) ? 'payment' : 'done';
    return 'closed';
  }
  function logged(o, st){
    var l = (o.stageLog || []).filter(function(e){ return e.s === st; });
    return l.length ? l[l.length - 1].t.slice(0, 10) : '';
  }
  // When the order entered a stage: the recorded time, else the date fields Studio keeps.
  function entered(o, st){
    var l = logged(o, st); if(l) return l;
    if(st === 'quote') return o.quotedDate || '';
    if(st === 'booked') return o.orderedDate || '';
    if(st === 'printing') return o.productionStartDate || '';
    if(st === 'made') return o.productionDoneDate || '';
    if(st === 'shipped') return o.shippedDate || '';
    if(st === 'payment') return o.deliveryDate || '';
    return '';
  }
  function fleetCap(){
    var n = 0; (state.printers || []).forEach(function(p){ if(p.status !== 'down') n++; });
    if(!(state.printers || []).length) n = state.fleet.printers || 0;
    return n * (state.fleet.hoursPerDay || 0);
  }
  // Printing target scales with the order: print days at fleet capacity + buffer days.
  function targetFor(st, o){
    if(st !== 'printing') return target(st);
    var cap = fleetCap(), h = 0;
    try{ h = (o.costSnapshot && o.costSnapshot.hours) || computeProductionCost(o, { useFullQty: true }).hours || 0; }catch(e){}
    return (cap > 0 ? Math.ceil(h / cap) : 0) + target('printing');
  }

  // ---------- stage recorder ----------
  function record(){
    // Local date and time (India), not UTC, so a change just after midnight lands on the right day.
    var d = new Date(), now = isoLocal(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), changed = false;
    (state.orders || []).forEach(function(o){
      var st = stageOf(o);
      if(o._flowStage === st) return;
      if(o._flowStage){ // a real change, not the first time this order is seen
        o.stageLog = (o.stageLog || []).concat([{ s: st, t: now }]).slice(-30);
        if(st === 'printing' && !o.productionStartDate) o.productionStartDate = now.slice(0, 10);
      }
      o._flowStage = st; changed = true;
    });
    return changed;
  }
  if(typeof scheduleSave === 'function'){
    var origSave = scheduleSave;
    scheduleSave = function(){ try{ record(); }catch(e){} return origSave.apply(this, arguments); };
  }
  setTimeout(function(){ try{ record(); }catch(e){} }, 1500);

  // ---------- what's waiting now ----------
  function waiting(){
    var t = today(), out = [];
    (state.orders || []).forEach(function(o){
      var st = stageOf(o);
      if(!STAGES.some(function(s){ return s.key === st; })) return;
      var since = entered(o, st), d = since ? Math.max(0, days(since, t)) : null, tg = targetFor(st, o);
      var pastDue = o.dueDate && o.dueDate < t && ['quote', 'booked', 'printing', 'made'].indexOf(st) !== -1;
      out.push({ o: o, st: st, since: since, d: d, target: tg, over: d != null && d > tg, pastDue: pastDue, owner: ownerOf(st, o),
        reason: (o.delays || []).filter(function(x){ return x.stage === st; }).slice(-1)[0] || null });
    });
    return out;
  }

  // ---------- last 30 days: finished handoffs ----------
  function history(daysBack){
    var from = isoLocal(new Date(Date.now() - daysBack * 86400000)), res = {};
    STAGES.forEach(function(s){ res[s.key] = { n: 0, total: 0, over: 0 }; });
    function add(st, a, b, o){
      if(!a || !b || b < from) return;
      var d = days(a, b); if(d == null || d < 0) return;
      var r = res[st]; r.n++; r.total += d; if(d > targetFor(st, o)) r.over++;
    }
    (state.orders || []).forEach(function(o){
      var start = entered(o, 'printing'), made = entered(o, 'made'), shipped = entered(o, 'shipped'), deliv = o.deliveryDate || logged(o, 'payment') || logged(o, 'done');
      if(o.wasQuoted || o.quotedDate) add('quote', o.quotedDate, o.orderedDate, o);
      add('booked', o.orderedDate, start, o);
      add('printing', start, made, o);
      add('made', made, shipped || (o.status === 'delivered' ? deliv : ''), o);
      add('shipped', shipped, deliv, o);
      add('payment', deliv, o.paymentClearedDate, o);
    });
    return res;
  }

  // ---------- delay reasons report ----------
  function reasonsReport(daysBack){
    var from = isoLocal(new Date(Date.now() - daysBack * 86400000)), t = today(), agg = {};
    (state.orders || []).forEach(function(o){
      var ds = (o.delays || []).filter(function(x){ return (x.at || '') >= from; });
      if(!ds.length) return;
      // Days lost on a stage = time beyond its target (so far, if still in it), shared between that stage's reasons.
      var byStage = {};
      ds.forEach(function(x){ (byStage[x.stage] = byStage[x.stage] || []).push(x); });
      Object.keys(byStage).forEach(function(st){
        var a = entered(o, st), nextAt = '';
        var i = STAGES.findIndex(function(s){ return s.key === st; });
        for(var j = i + 1; j < STAGES.length && !nextAt; j++) nextAt = entered(o, STAGES[j].key);
        if(!nextAt && st === 'payment') nextAt = o.paymentClearedDate || '';
        var spent = a ? days(a, nextAt || t) : 0, lost = Math.max(0, (spent || 0) - targetFor(st, o));
        var list = byStage[st];
        list.forEach(function(x){
          var k = x.reason; agg[k] = agg[k] || { n: 0, lost: 0, orders: {} };
          agg[k].n++; agg[k].lost += lost / list.length; agg[k].orders[o.id] = 1;
        });
      });
    });
    return Object.keys(agg).map(function(k){ return { k: k, n: Object.keys(agg[k].orders).length, lost: Math.round(agg[k].lost) }; })
      .sort(function(a, b){ return b.lost - a.lost || b.n - a.n; });
  }

  // ---------- UI ----------
  var V = { stage: 'over', reasonFor: null, showSettings: false };
  function stageTile(s, list){
    var inS = list.filter(function(x){ return x.st === s.key; }), over = inS.filter(function(x){ return x.over; }).length;
    var oldest = inS.reduce(function(m, x){ return Math.max(m, x.d || 0); }, 0), owner = s.key === 'quote' ? (cfg().owners.quote || 'Sales rep') : ownerOf(s.key);
    return '<button type="button" class="tf-tile' + (over ? ' bad' : '') + (V.stage === s.key ? ' on' : '') + '" data-tf="stage" data-k="' + s.key + '" title="' + esc(s.hint) + '">' +
      '<span class="tf-tl">' + esc(s.label) + '</span><span class="tf-owner">' + esc(owner) + ' · target ' + (s.key === 'printing' ? 'print days + ' + target('printing') : target(s.key)) + 'd</span>' +
      '<span class="tf-n">' + inS.length + '</span><span class="tf-s">' + (over ? '<b>' + over + ' over target</b>' : 'all on time') + (oldest ? ' · oldest ' + oldest + 'd' : '') + '</span></button>';
  }
  function rowHtml(x){
    var s = STAGES.find(function(z){ return z.key === x.st; });
    var reason = x.reason ? '<span class="tf-chip" title="' + esc(x.reason.note || '') + '">' + esc(reasonLabel(x.reason.reason)) + '</span>' : '';
    var picker = V.reasonFor === x.o.id
      ? '<span class="tf-pick"><select data-tf-reason="' + esc(x.o.id) + '"><option value="">Pick a reason…</option>' + REASONS.map(function(r){ return '<option value="' + r[0] + '">' + esc(r[1]) + '</option>'; }).join('') + '</select>' +
        '<input data-tf-note="' + esc(x.o.id) + '" placeholder="Note (optional)"><button type="button" class="tf-btn" data-tf="save-reason" data-id="' + esc(x.o.id) + '" data-st="' + x.st + '">Save</button></span>'
      : ((x.over || x.pastDue) ? '<button type="button" class="tf-btn' + (x.reason ? '' : ' warn') + '" data-tf="why" data-id="' + esc(x.o.id) + '">' + (x.reason ? 'Change reason' : 'Why late?') + '</button>' : '');
    return '<tr class="' + (x.over ? 'tf-over' : '') + '"><td><a href="#" class="cr-ord" data-cr="open" data-id="' + esc(x.o.id) + '">' + esc(x.o.displayId || 'Order') + '</a> ' + esc(who(x.o)) + (x.pastDue ? ' <span class="tf-due">past due ' + fmt(x.o.dueDate) + '</span>' : '') + '</td>' +
      '<td>' + esc(s.label) + '</td><td>' + esc(x.owner) + '</td>' +
      '<td class="n"><b' + (x.over ? ' style="color:var(--red)"' : '') + '>' + (x.d == null ? '?' : x.d + 'd') + '</b> / ' + x.target + 'd</td>' +
      '<td>' + reason + ' ' + picker + ' <button type="button" class="tf-btn" data-tf="nudge" data-id="' + esc(x.o.id) + '" title="WhatsApp the owner">Nudge</button></td></tr>';
  }
  function historyHtml(){
    var h = history(30), worst = null;
    var rows = STAGES.map(function(s){
      var r = h[s.key], avg = r.n ? r.total / r.n : null, tg = s.key === 'printing' ? null : target(s.key);
      var excess = avg != null && tg != null ? (avg - tg) * r.n : 0;
      if(excess > 0 && (!worst || excess > worst.excess)) worst = { s: s, avg: avg, tg: tg, excess: excess };
      var max = Math.max(avg || 0, tg || 0, 1) * 1.15, w = avg != null ? avg / max * 100 : 0, tw = tg != null ? tg / max * 100 : null;
      var late = r.n ? Math.round(r.over / r.n * 100) : 0;
      return '<div class="tf-h"><span class="tf-hl">' + esc(s.label) + '</span>' +
        '<span class="tf-bar" title="' + (avg != null ? 'Average ' + (Math.round(avg * 10) / 10) + ' days over ' + r.n + ' orders' : 'No finished handoffs in 30 days') + '"><i style="width:' + w + '%;background:' + (r.n && late > 30 ? 'var(--red)' : 'var(--cyan)') + '"></i>' + (tw != null ? '<em style="left:' + tw + '%" title="Target ' + tg + 'd"></em>' : '') + '</span>' +
        '<span class="tf-hv">' + (avg != null ? (Math.round(avg * 10) / 10) + 'd' : '—') + '</span><span class="tf-hs">' + (r.n ? late + '% late · ' + r.n : '') + '</span></div>';
    }).join('');
    return '<div class="panel"><div class="panel-title">Handoff times · last 30 days</div>' +
      '<p class="tf-verdict">' + (worst ? '⚠ <b>' + esc(worst.s.label) + '</b> is your bottleneck: ' + (Math.round(worst.avg * 10) / 10) + ' days on average vs a ' + worst.tg + '-day target (' + esc(ownerOf(worst.s.key)) + ').' : 'Every handoff is within target on average.') + '</p>' +
      rows + '<p class="cr-dim" style="margin-top:8px">Bar = average days an order spent in that handoff; tick = target. Red when over 30% of orders were late.</p></div>';
  }
  function reasonsHtml(){
    var r = reasonsReport(90), max = r.reduce(function(m, x){ return Math.max(m, x.lost, 1); }, 1);
    return '<div class="panel"><div class="panel-title">Why orders run late · last 90 days</div>' +
      (r.length ? '<p class="tf-verdict">Top cause: <b>' + esc(reasonLabel(r[0].k)) + '</b>, ' + r[0].lost + ' days lost across ' + r[0].n + ' order' + (r[0].n === 1 ? '' : 's') + '. Fix this first.</p>' +
        r.map(function(x){ return '<div class="tf-h"><span class="tf-hl">' + esc(reasonLabel(x.k)) + '</span><span class="tf-bar"><i style="width:' + (x.lost / max * 100) + '%;background:var(--amber)"></i></span><span class="tf-hv">' + x.lost + 'd</span><span class="tf-hs">' + x.n + ' order' + (x.n === 1 ? '' : 's') + '</span></div>'; }).join('')
        : '<p class="cr-dim">No reasons recorded yet. Use <b>Why late?</b> on orders past target and this fills up.</p>') + '</div>';
  }
  function settingsHtml(){
    var names = {};
    (state.taskPeople || []).forEach(function(n){ names[n] = 1; });
    (state.orders || []).forEach(function(o){ if(o.salesRep) names[o.salesRep] = 1; });
    return '<details class="tf-set"' + (V.showSettings ? ' open' : '') + '><summary>Owners and targets</summary><datalist id="tfPeople">' + Object.keys(names).map(function(n){ return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<table class="tf-t"><thead><tr><th>Handoff</th><th>Owner</th><th>Target days</th></tr></thead><tbody>' +
      STAGES.map(function(s){ return '<tr><td>' + esc(s.label) + '<div class="cr-dim">' + esc(s.hint) + '</div></td><td><input list="tfPeople" data-tf-owner="' + s.key + '" value="' + esc(cfg().owners[s.key] || '') + '" placeholder="' + esc(s.key === 'quote' ? 'Order’s sales rep, else ' + s.team : s.team) + '"></td>' +
        '<td><input type="number" min="0" step="1" data-tf-target="' + s.key + '" value="' + target(s.key) + '" style="width:70px"></td></tr>'; }).join('') +
      '</tbody></table><p class="cr-dim">Names come from Tasks (floor staff) and sales reps on orders.</p></details>';
  }
  function html(){
    var list = waiting(), shown;
    if(V.stage === 'over') shown = list.filter(function(x){ return x.over || x.pastDue; });
    else shown = list.filter(function(x){ return x.st === V.stage; });
    shown.sort(function(a, b){ return (b.over - a.over) || ((b.d || 0) - (b.target || 0)) - ((a.d || 0) - (a.target || 0)); });
    var overN = list.filter(function(x){ return x.over || x.pastDue; }).length;
    return '<div class="panel tf"><div class="tf-head"><div class="panel-title" style="margin:0">Who is holding orders</div>' +
        '<button type="button" class="tf-btn' + (V.stage === 'over' ? ' on' : '') + '" data-tf="stage" data-k="over">Over target · ' + overN + '</button></div>' +
      '<div class="tf-tiles">' + STAGES.map(function(s){ return stageTile(s, list); }).join('') + '</div>' +
      (shown.length ? '<div class="tf-tw"><table class="tf-t"><thead><tr><th>Order</th><th>Waiting at</th><th>Owner</th><th class="n">Waiting / target</th><th></th></tr></thead><tbody>' + shown.slice(0, 60).map(rowHtml).join('') + '</tbody></table></div>'
        : '<p class="cr-dim">' + (V.stage === 'over' ? 'Nothing over target. 👌' : 'No orders here.') + '</p>') +
      settingsHtml() + '</div>' +
      '<div class="tf-grid">' + historyHtml() + reasonsHtml() + '</div>';
  }

  // ---------- events ----------
  function rerender(){ if(window.renderControlRoom) window.renderControlRoom(); }
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-tf]'); if(!b) return;
    var a = b.getAttribute('data-tf'), id = b.getAttribute('data-id');
    if(a === 'stage'){ var k = b.getAttribute('data-k'); V.stage = V.stage === k && k !== 'over' ? 'over' : k; V.reasonFor = null; rerender(); }
    else if(a === 'why'){ V.reasonFor = id; rerender(); }
    else if(a === 'save-reason'){
      var o = state.orders.find(function(x){ return x.id === id; }); if(!o) return;
      var sel = document.querySelector('[data-tf-reason="' + id + '"]'), note = document.querySelector('[data-tf-note="' + id + '"]');
      if(!sel || !sel.value){ showToast('Pick a reason'); return; }
      o.delays = (o.delays || []).concat([{ id: newId(), stage: b.getAttribute('data-st'), reason: sel.value, note: (note && note.value || '').trim(), at: today() }]);
      V.reasonFor = null; scheduleSave(); rerender(); showToast('Reason saved');
    }
    else if(a === 'nudge'){
      var x = waiting().find(function(w){ return w.o.id === id; }); if(!x) return;
      var s = STAGES.find(function(z){ return z.key === x.st; });
      var msg = 'Hi ' + x.owner + ', ' + (x.o.displayId || 'an order') + ' for ' + who(x.o) + ' has been at "' + s.label + '" for ' + x.d + ' days (target ' + x.target + '). Can you move it today?' + (x.o.dueDate ? ' Due ' + fmt(x.o.dueDate) + '.' : '');
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }
  });
  document.addEventListener('change', function(e){
    var ow = e.target.getAttribute && e.target.getAttribute('data-tf-owner'), tg = e.target.getAttribute && e.target.getAttribute('data-tf-target');
    if(ow){ cfg().owners[ow] = e.target.value.trim(); V.showSettings = true; scheduleSave(); rerender(); }
    if(tg){ var v = parseInt(e.target.value, 10); cfg().targets[tg] = isNaN(v) ? '' : Math.max(0, v); V.showSettings = true; scheduleSave(); rerender(); }
  });
  document.addEventListener('toggle', function(e){ if(e.target.classList && e.target.classList.contains('tf-set')) V.showSettings = e.target.open; }, true);

  var css = document.createElement('style');
  css.textContent = [
    '#tabControl .tf-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}',
    '#tabControl .tf-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}',
    '#tabControl .tf-tile{text-align:left;display:flex;flex-direction:column;gap:2px;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;cursor:pointer;font:inherit;color:var(--text)}',
    '#tabControl .tf-tile.on{border-color:var(--cyan);box-shadow:inset 0 0 0 1px var(--cyan)}',
    '#tabControl .tf-tile.bad .tf-n{color:var(--red)}',
    '#tabControl .tf-tl{font-weight:600;font-size:13px}',
    '#tabControl .tf-owner{font-size:11px;color:var(--dim)}',
    '#tabControl .tf-n{font-size:24px;font-weight:700;line-height:1.2;margin-top:4px}',
    '#tabControl .tf-s{font-size:11.5px;color:var(--dim)}#tabControl .tf-s b{color:var(--red);font-weight:600}',
    '#tabControl .tf-tw{overflow-x:auto}',
    '#tabControl .tf-t{width:100%;border-collapse:collapse;font-size:13px}',
    '#tabControl .tf-t th{text-align:left;font-weight:500;color:var(--dim);font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line)}',
    '#tabControl .tf-t td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:middle}',
    '#tabControl .tf-t .n{text-align:right;white-space:nowrap}',
    '#tabControl .tf-t input,#tabControl .tf-t select{padding:5px 8px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text);font:inherit;font-size:12.5px}',
    '#tabControl .tf-over td:first-child{box-shadow:inset 3px 0 0 var(--red)}',
    '#tabControl .tf-due{font-size:11px;color:var(--red);margin-left:4px}',
    '#tabControl .tf-chip{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:999px;background:rgba(240,168,60,.14);color:var(--amber);margin-right:4px}',
    '#tabControl .tf-pick{display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center}',
    '#tabControl .tf-btn{background:transparent;border:1px solid var(--line);border-radius:8px;padding:4px 10px;font:12px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer;white-space:nowrap}',
    '#tabControl .tf-btn.warn{border-color:rgba(240,168,60,.6);color:var(--amber)}',
    '#tabControl .tf-btn.on{border-color:var(--cyan);background:rgba(79,209,197,.12)}',
    '#tabControl .tf-set{margin-top:14px}#tabControl .tf-set summary{cursor:pointer;color:var(--dim);font-size:12.5px}',
    '#tabControl .tf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
    '@media (max-width:900px){#tabControl .tf-grid{grid-template-columns:1fr}}',
    '#tabControl .tf-verdict{font-size:13.5px;margin:0 0 12px}',
    '#tabControl .tf-h{display:grid;grid-template-columns:130px 1fr 44px 92px;gap:10px;align-items:center;margin:7px 0;font-size:12.5px}',
    '#tabControl .tf-hl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#tabControl .tf-bar{position:relative;height:12px;background:var(--panel2);border-radius:4px}',
    '#tabControl .tf-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:0 4px 4px 0}',
    '#tabControl .tf-bar em{position:absolute;top:-3px;bottom:-3px;border-left:2px solid var(--text)}',
    '#tabControl .tf-hv{font-weight:600;text-align:right}#tabControl .tf-hs{color:var(--dim);font-size:11.5px}'
  ].join('');
  document.head.appendChild(css);

  window.TTFlow = { html: html, stageOf: stageOf, entered: entered, waiting: waiting, reasons: REASONS, reasonLabel: reasonLabel, record: record };
})();
