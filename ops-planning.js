// ===================================================================
// ======================= OPS PLANNING (Studio) =====================
// ===================================================================
//   Capacity   the next 8 weeks: booked print-hours placed in the week they are due, plus likely
//              work (open quotes at 50%, the sales pipeline converted to hours at your own rupees per
//              print-hour), against printer capacity (running printers x hours a day x 7 at 85%) and
//              free partner capacity. Says when you run short and how many printers that is.
//   Suppliers  filament bought by supplier: spend, kilos, price per kg and its trend; the cheapest
//              source for each material and colour; and the failure rate of each filament colour.
//   Floor      step-by-step guides for print staff, editable and printable (state.floorGuides).
(function(){
  if(window.TT_STOCK_MODE) return;

  const UTIL = 0.85, DAY = 86400000;
  const V = { view: 'capacity' };
  const GUIDES = [
    { title: 'Start a print for an order', steps: [
      'Find the order’s TT number (Control Room → Order lines, or the job sheet).',
      'In Bambuddy, add the file to the queue and pick the order’s project: the one named with its TT number (e.g. TT-151). Never leave the project empty.',
      'Choose the printer and the filament colour the order line asks for, then start.',
      'Why: Studio only counts pieces and shows Queued or Printing for jobs filed under the order’s project. The same lamp file is often in two orders, and the project is the only way to tell them apart.'] },
    { title: 'When a print finishes', steps: [
      'Take the parts off and check every piece.',
      'In Bambuddy, mark the print Good, or Reject if a piece isn’t sellable, so rejects aren’t counted as made.',
      'Clear and wipe the plate, then start the next job in the queue.'] },
    { title: 'When a print fails', steps: [
      'Mark it failed in Bambuddy and note what happened (spaghetti, warping, clog, filament ran out).',
      'Queue it again under the same order project.',
      'If the same file fails twice, tell the ops lead. Studio flags repeat failures in Home → Needs you.'] },
    { title: 'Pack and dispatch an order', steps: [
      'In Control Room → Order lines, check every line of the order shows Made.',
      'Print the pack list (Automations → Pack lists) and count pieces by product and colour against it.',
      'Wrap, box, and label the box with the TT number and the client’s name.',
      'In the order, fill in the courier and tracking number and the date it left. The client sees tracking in the Buyer app.'] },
    { title: 'Change or add a spool', steps: [
      'Use the colour and material the order line asks for.',
      'New spool: add it in Filament Inventory and stick its label (code) on the spool.',
      'Opened or finished a spool: weigh it and update it in Filament Inventory, so the reorder list stays right.'] }
  ];

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function monday(d){ const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function counts(o){ return ['quoted', 'lost', 'cancelled', 'returned'].indexOf(o.status) === -1; }
  function orderDay(o){ return o.orderedDate || o.productionStartDate || o.dueDate || ''; }
  function hours(o){ try{ return orderTotals(o).hours || 0; }catch(e){ return 0; } }

  // ---------- capacity ----------
  function capacity(){
    const printers = (state.printers || []).length ? (state.printers || []).filter(function(p){ return p.status !== 'down'; }).length : ((state.fleet && state.fleet.printers) || 0);
    const hpd = (state.fleet && state.fleet.hoursPerDay) || 20, perWeek = printers * hpd * 7 * UTIL;
    const partner = window.TTPartners && window.TTPartners.ready && window.TTPartners.ready() ? (window.TTPartners.freePerDay(14) || 0) * 7 : 0;
    const start = monday(new Date()), weeks = [];
    for(let i = 0; i < 8; i++){ const s = new Date(start.getTime() + i * 7 * DAY); weeks.push({ from: iso(s), booked: 0, likely: 0 }); }
    const weekOf = function(d){ if(!d) return 0; const i = Math.floor((new Date(d + 'T00:00:00') - start) / (7 * DAY)); return Math.max(0, Math.min(7, i)); };
    // Booked work is needed by the week it is due (overdue and undated go into this week).
    state.orders.filter(function(o){ return o.status === 'booked' || o.status === 'in_production'; }).forEach(function(o){ weeks[weekOf(o.dispatchBy || o.dueDate)].booked += hours(o); });
    // Open quotes count at 50% in their week.
    state.orders.filter(function(o){ return o.status === 'quoted'; }).forEach(function(o){ try{ weeks[weekOf(o.dueDate)].likely += (computeProductionCost(o, { useFullQty: true }).hours || 0) * 0.5; }catch(e){} });
    // The sales pipeline in rupees, turned into hours at your own rupees per print-hour, spread over weeks 3-8.
    const done = state.orders.filter(function(o){ return counts(o) && orderDay(o) >= iso(new Date(Date.now() - 120 * DAY)); });
    let rev = 0, hrs = 0;
    done.forEach(function(o){ try{ const t = orderTotals(o), p = computeProductionCost(o, { useFullQty: true }); rev += t.orderValue || 0; hrs += p.hours || 0; }catch(e){} });
    const perHour = hrs ? rev / hrs : 0;
    const PROB = { new: 0.05, contacted: 0.1, meeting: 0.25, quote: 0.5 };
    const pipeRs = ((window.TTSales && window.TTSales.leads()) || []).reduce(function(t, l){ return t + (PROB[l.stage] ? (+((l.data || {}).potential) || 0) * PROB[l.stage] : 0); }, 0);
    const pipeHrs = perHour ? pipeRs / perHour : 0;
    for(let i = 2; i < 8; i++) weeks[i].likely += pipeHrs / 6;
    let carry = 0;
    weeks.forEach(function(w){ w.cap = perWeek; w.partner = partner; const need = w.booked + carry; w.backlog = Math.max(0, need - perWeek); carry = w.backlog; w.short = Math.max(0, w.booked + w.likely - perWeek - partner); });
    return { printers: printers, hpd: hpd, perWeek: perWeek, partner: partner, weeks: weeks, perHour: perHour, pipeHrs: pipeHrs };
  }
  function capacityHtml(){
    const C = capacity(), max = Math.max.apply(null, C.weeks.map(function(w){ return Math.max(w.booked + w.likely, w.cap + w.partner); }).concat([1]));
    const firstShort = C.weeks.find(function(w){ return w.booked > w.cap + w.partner; });
    const worst = C.weeks.reduce(function(m, w){ return w.short > m.short ? w : m; }, { short: 0 });
    const extraPrinters = worst.short ? Math.ceil(worst.short / (C.hpd * 7 * UTIL)) : 0;
    let verdict;
    if(firstShort) verdict = '<b class="op-bad">Booked work runs past capacity in the week of ' + fmtW(firstShort.from) + '.</b> Move work to partners, add printer hours, or agree later dates.';
    else if(worst.short) verdict = '<b class="op-warn">If the likely work comes in, you’re about ' + Math.round(worst.short) + ' print-hours short in the week of ' + fmtW(worst.from) + '.</b> That’s ' + extraPrinters + ' more printer' + (extraPrinters === 1 ? '' : 's') + ' at today’s hours, or the same in partner capacity.';
    else verdict = '<b class="op-good">Capacity covers booked and likely work for the next 8 weeks.</b>';
    return '<div class="panel"><div class="op-kpis">' +
        kpi('Printers running', C.printers, C.hpd + ' h a day') + kpi('Capacity a week', Math.round(C.perWeek) + ' h', 'at ' + Math.round(UTIL * 100) + '% use') +
        kpi('Partners free a week', Math.round(C.partner) + ' h', C.partner ? 'from Partner Network' : 'not loaded or none free') +
        kpi('You earn per print-hour', C.perHour ? money(C.perHour) : '—', 'last 120 days') + '</div>' +
      '<p class="op-verdict">' + verdict + '</p>' +
      '<div class="op-chart" role="img" aria-label="Print-hours needed each week against capacity">' + C.weeks.map(function(w){
        const b = w.booked / max * 100, l = w.likely / max * 100, cap = (w.cap) / max * 100, capP = (w.cap + w.partner) / max * 100;
        return '<div class="op-wk"><div class="op-bars" title="Booked ' + Math.round(w.booked) + ' h, likely ' + Math.round(w.likely) + ' h, capacity ' + Math.round(w.cap) + ' h + partners ' + Math.round(w.partner) + ' h">' +
          '<i class="op-cap" style="bottom:' + cap + '%"></i>' + (w.partner ? '<i class="op-capp" style="bottom:' + capP + '%"></i>' : '') +
          '<span class="op-likely" style="height:' + l + '%;bottom:' + b + '%"></span><span class="op-booked' + (w.booked > w.cap + w.partner ? ' over' : '') + '" style="height:' + b + '%"></span></div>' +
          '<div class="op-wl">' + fmtW(w.from) + '</div><div class="op-wv">' + Math.round(w.booked + w.likely) + ' h</div></div>';
      }).join('') + '</div>' +
      '<div class="op-legend"><span><i class="lb"></i>Booked</span><span><i class="ll"></i>Likely (quotes 50%, pipeline ≈ ' + Math.round(C.pipeHrs) + ' h)</span><span><i class="lc"></i>Your printers</span>' + (C.partner ? '<span><i class="lp"></i>With partners</span>' : '') + '</div>' +
      '<p class="op-dim">Booked hours sit in the week the order is due, including your failure buffer; late and undated orders count in this week. Likely pipeline work is spread over weeks 3–8.</p></div>';
  }
  function kpi(k, v, s){ return '<div class="op-kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; }
  function fmtW(s){ const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }

  // ---------- suppliers ----------
  function suppliersHtml(){
    const P = ((state.fil && state.fil.purchases) || []).filter(function(p){ return p.total || p.pricePerSpool; });
    const cut = iso(new Date(Date.now() - 180 * DAY));
    const by = {};
    P.forEach(function(p){
      const k = (p.supplier || 'Not named').trim(), kg = (p.qty || 0) * (p.netG || 1000) / 1000, s = by[k] || (by[k] = { name: k, spend: 0, kg: 0, n: 0, last: '', brands: {}, recent: [] });
      if((p.date || '') >= cut){ s.spend += p.total || (p.qty * p.pricePerSpool) || 0; s.kg += kg; }
      s.n++; if((p.date || '') > s.last) s.last = p.date || '';
      if(p.brand) s.brands[p.brand] = 1;
      if(kg) s.recent.push({ d: p.date || '', rate: (p.total || p.qty * p.pricePerSpool) / kg });
    });
    const rows = Object.keys(by).map(function(k){ const s = by[k]; s.recent.sort(function(a, b){ return a.d.localeCompare(b.d); }); const avg = s.recent.length ? s.recent.reduce(function(t, r){ return t + r.rate; }, 0) / s.recent.length : 0, lastR = s.recent.length ? s.recent[s.recent.length - 1].rate : 0; return Object.assign(s, { perKg: s.kg ? s.spend / s.kg : avg, trend: avg && lastR ? (lastR - avg) / avg : 0 }); })
      .sort(function(a, b){ return b.spend - a.spend; });
    // Cheapest supplier for each material + colour.
    const best = {};
    P.forEach(function(p){ const kg = (p.qty || 0) * (p.netG || 1000) / 1000; if(!kg) return; const k = [(p.material || 'PLA'), (p.color || '')].join(' · '), r = (p.total || p.qty * p.pricePerSpool) / kg; if(!best[k] || r < best[k].rate) best[k] = { rate: r, sup: p.supplier || 'Not named', brand: p.brand || '' }; });
    // Failure rate by filament colour and material, from order lines.
    const fail = {};
    state.orders.filter(counts).forEach(function(o){ (o.products || []).forEach(function(l){ const k = [(l.material || 'PLA'), (l.color || 'Unknown')].join(' · '), f = fail[k] || (fail[k] = { made: 0, failed: 0 }); f.made += +l.already || 0; f.failed += +l.failed || 0; }); });
    const failRows = Object.keys(fail).map(function(k){ const f = fail[k], n = f.made + f.failed; return { k: k, n: n, rate: n ? f.failed / n : 0 }; }).filter(function(r){ return r.n >= 10; }).sort(function(a, b){ return b.rate - a.rate; });
    let h = '<div class="panel"><div class="panel-title">Filament suppliers · last 180 days</div>';
    if(!rows.length) h += '<p class="op-dim">No filament purchases yet. Add them in Filament Inventory → Add purchase (supplier, brand, colour, spools, price) and this fills in.</p>';
    else h += '<div class="op-table"><div class="op-r op-h"><span>Supplier</span><span class="n">Spend</span><span class="n">Kg</span><span class="n">₹ / kg</span><span class="n">Latest vs avg</span><span>Brands</span><span>Last bought</span></div>' +
      rows.map(function(s){ return '<div class="op-r"><span><b>' + esc(s.name) + '</b></span><span class="n">' + money(s.spend) + '</span><span class="n">' + (Math.round(s.kg * 10) / 10) + '</span><span class="n">' + money(s.perKg) + '</span><span class="n ' + (s.trend > 0.03 ? 'op-bad' : s.trend < -0.03 ? 'op-good' : '') + '">' + (s.trend ? (s.trend > 0 ? '+' : '') + Math.round(s.trend * 100) + '%' : '—') + '</span><span class="op-dim">' + esc(Object.keys(s.brands).join(', ') || '—') + '</span><span class="op-dim">' + esc(s.last || '—') + '</span></div>'; }).join('') + '</div>';
    h += '</div><div class="op-grid"><div class="panel"><div class="panel-title">Cheapest source per filament</div>' +
      (Object.keys(best).length ? Object.keys(best).sort().map(function(k){ const b = best[k]; return '<div class="op-li"><span>' + esc(k) + '</span><span class="op-dim">' + esc(b.sup) + (b.brand ? ' · ' + esc(b.brand) : '') + '</span><b>' + money(b.rate) + '/kg</b></div>'; }).join('') : '<p class="op-dim">Appears once purchases are logged.</p>') +
      '</div><div class="panel"><div class="panel-title">Failure rate by filament colour</div><p class="op-dim">From order lines (made vs failed), all suppliers together; colours with 10+ prints.</p>' +
      (failRows.length ? failRows.slice(0, 12).map(function(r){ return '<div class="op-li"><span>' + esc(r.k) + '</span><span class="op-dim">' + r.n + ' prints</span><b class="' + (r.rate >= 0.15 ? 'op-bad' : r.rate >= 0.08 ? 'op-warn' : 'op-good') + '">' + Math.round(r.rate * 100) + '%</b></div>'; }).join('') : '<p class="op-dim">Not enough logged prints yet.</p>') + '</div></div>';
    return h;
  }

  // ---------- floor guides ----------
  function guides(){ return Array.isArray(state.floorGuides) ? state.floorGuides : GUIDES; }
  function guidesHtml(){
    return '<div class="op-row-a"><button class="op-btn" data-op="print">Print guides</button><button class="op-btn" data-op="edit">' + (V.edit ? 'Done editing' : 'Edit') + '</button>' +
      (Array.isArray(state.floorGuides) ? '' : '<span class="op-dim">Written from your Bambuddy and Studio setup. Edit them to match how your floor works.</span>') + '</div>' +
      '<div class="op-guides">' + guides().map(function(g, i){
        if(V.edit) return '<div class="panel op-guide"><input data-op-gt="' + i + '" value="' + esc(g.title) + '"><textarea data-op-gs="' + i + '" rows="' + (g.steps.length + 1) + '">' + esc(g.steps.join('\n')) + '</textarea><span class="op-dim">One step a line.</span></div>';
        return '<div class="panel op-guide"><div class="panel-title">' + esc(g.title) + '</div><ol>' + g.steps.map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
      }).join('') + (V.edit ? '<div class="panel op-guide"><button class="op-btn" data-op="add-guide">+ Guide</button></div>' : '') + '</div>';
  }
  function saveGuides(){
    const root = document.getElementById('opsRoot'), out = [];
    root.querySelectorAll('[data-op-gt]').forEach(function(el){ const i = el.getAttribute('data-op-gt'), st = root.querySelector('[data-op-gs="' + i + '"]'); const steps = st ? st.value.split('\n').map(function(x){ return x.trim(); }).filter(Boolean) : []; if(el.value.trim() && steps.length) out.push({ title: el.value.trim(), steps: steps }); });
    state.floorGuides = out; scheduleSave();
  }

  function render(){
    const root = document.getElementById('opsRoot'); if(!root) return;
    const tab = function(v, t){ return '<button class="op-tab' + (V.view === v ? ' on' : '') + '" data-op-view="' + v + '">' + t + '</button>'; };
    root.innerHTML = '<div class="op-head"><div class="op-title">Ops planning</div><div class="op-dim">Capacity ahead, filament suppliers, and guides for the floor</div></div>' +
      '<div class="op-tabs">' + tab('capacity', 'Capacity, 8 weeks') + tab('suppliers', 'Suppliers') + tab('guides', 'Floor guides') + '</div>' +
      (V.view === 'suppliers' ? suppliersHtml() : V.view === 'guides' ? guidesHtml() : capacityHtml());
  }
  window.renderOps = function(){ render(); if(window.TTPartners && window.TTPartners.load) window.TTPartners.load().then(render).catch(function(){}); };

  document.addEventListener('click', function(e){
    const t = document.getElementById('tabOps'); if(!t || !t.contains(e.target)) return;
    const vw = e.target.closest('[data-op-view]'); if(vw){ if(V.edit) saveGuides(); V.edit = false; V.view = vw.getAttribute('data-op-view'); render(); return; }
    const b = e.target.closest('[data-op]'); if(!b) return;
    const a = b.getAttribute('data-op');
    if(a === 'edit'){ if(V.edit){ saveGuides(); showToast('Guides saved'); } V.edit = !V.edit; render(); }
    else if(a === 'add-guide'){ saveGuides(); state.floorGuides = guides().concat([{ title: 'New guide', steps: ['First step'] }]); render(); }
    else if(a === 'print'){
      const w = window.open('', '_blank'); if(!w) return;
      w.document.write('<!doctype html><meta charset="utf-8"><title>Floor guides</title><style>body{font:15px system-ui,sans-serif;padding:24px;max-width:760px}h2{margin:22px 0 6px;page-break-after:avoid}li{margin:6px 0}section{page-break-inside:avoid}</style><h1>' + esc((state.business && state.business.name) || 'Thread Tribe') + ' · Floor guides</h1>' +
        guides().map(function(g){ return '<section><h2>' + esc(g.title) + '</h2><ol>' + g.steps.map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></section>'; }).join(''));
      w.document.close(); w.focus(); w.print();
    }
  });

  const css = document.createElement('style');
  css.textContent = [
    '#tabOps{font-family:"Space Grotesk",sans-serif}',
    '#tabOps .op-head{margin:4px 0 14px} #tabOps .op-title{font-size:26px;font-weight:700;color:var(--text)}',
    '#tabOps .op-dim{color:var(--dim);font-size:12.5px} #tabOps .op-good{color:var(--green)} #tabOps .op-warn{color:var(--amber)} #tabOps .op-bad{color:var(--red)}',
    '#tabOps .op-tabs{display:flex;gap:4px;background:var(--input-bg);border-radius:12px;padding:4px;margin-bottom:14px;width:fit-content;max-width:100%;flex-wrap:wrap}',
    '#tabOps .op-tab{border:none;background:transparent;border-radius:9px;padding:8px 14px;font:13.5px "Space Grotesk",sans-serif;color:var(--dim);cursor:pointer}',
    '#tabOps .op-tab.on{background:var(--panel);color:var(--text);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '#tabOps .op-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px}',
    '#tabOps .op-kpi{background:var(--input-bg);border-radius:12px;padding:10px 12px} #tabOps .op-kpi .k{font:10.5px "JetBrains Mono",monospace;letter-spacing:1px;text-transform:uppercase;color:var(--dim)} #tabOps .op-kpi .v{font-size:22px;font-weight:700;margin-top:3px} #tabOps .op-kpi .s{font-size:12px;color:var(--dim)}',
    '#tabOps .op-verdict{font-size:14px;line-height:1.5;margin:6px 0 14px}',
    '#tabOps .op-chart{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;align-items:end;height:220px;margin-bottom:8px}',
    '#tabOps .op-wk{display:flex;flex-direction:column;align-items:stretch;height:100%;min-width:0}',
    '#tabOps .op-bars{position:relative;flex:1;background:var(--input-bg);border-radius:8px 8px 4px 4px;overflow:hidden}',
    '#tabOps .op-booked{position:absolute;left:30%;right:30%;bottom:0;background:var(--cyan);border-radius:4px 4px 0 0} #tabOps .op-booked.over{background:var(--red)}',
    '#tabOps .op-likely{position:absolute;left:30%;right:30%;background:repeating-linear-gradient(45deg,rgba(79,209,197,.55) 0 4px,rgba(79,209,197,.2) 4px 8px);border-radius:4px 4px 0 0}',
    '#tabOps .op-cap{position:absolute;left:0;right:0;border-top:2px solid var(--text)} #tabOps .op-capp{position:absolute;left:0;right:0;border-top:2px dashed var(--dim)}',
    '#tabOps .op-wl{font-size:11.5px;color:var(--dim);text-align:center;margin-top:4px} #tabOps .op-wv{font:600 12px "JetBrains Mono",monospace;text-align:center}',
    '#tabOps .op-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dim);margin-bottom:6px} #tabOps .op-legend i{display:inline-block;width:14px;height:8px;border-radius:2px;margin-right:5px;vertical-align:0}',
    '#tabOps .op-legend .lb{background:var(--cyan)} #tabOps .op-legend .ll{background:repeating-linear-gradient(45deg,rgba(79,209,197,.55) 0 3px,rgba(79,209,197,.2) 3px 6px)} #tabOps .op-legend .lc{height:0;border-top:2px solid var(--text)} #tabOps .op-legend .lp{height:0;border-top:2px dashed var(--dim)}',
    '#tabOps .op-table{overflow-x:auto} #tabOps .op-r{display:grid;grid-template-columns:minmax(140px,1.3fr) repeat(4,minmax(80px,.7fr)) minmax(120px,1fr) 100px;gap:8px;padding:9px 4px;border-top:1px solid var(--line);font-size:13px;min-width:760px;align-items:center}',
    '#tabOps .op-h{border-top:none;font:10.5px "JetBrains Mono",monospace;letter-spacing:.6px;text-transform:uppercase;color:var(--dim)} #tabOps .n{text-align:right}',
    '#tabOps .op-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}',
    '#tabOps .op-li{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--line);font-size:13px} #tabOps .op-li span:first-child{flex:1} #tabOps .op-li b{font-family:"JetBrains Mono",monospace}',
    '#tabOps .op-row-a{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}',
    '#tabOps .op-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:7px 13px;font:13px "Space Grotesk",sans-serif;cursor:pointer}',
    '#tabOps .op-guides{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}',
    '#tabOps .op-guide{margin:0} #tabOps .op-guide ol{margin:0;padding-left:20px;font-size:13.5px;line-height:1.55} #tabOps .op-guide li{margin:5px 0}',
    '#tabOps .op-guide input,#tabOps .op-guide textarea{width:100%;box-sizing:border-box;border-radius:9px;font:13.5px "Space Grotesk",sans-serif;margin-bottom:6px} #tabOps .op-guide input{font-weight:600}',
    '@media (max-width:640px){#tabOps .op-chart{gap:4px;height:180px}#tabOps .op-wl{font-size:10px}}'
  ].join('');
  document.head.appendChild(css);
})();
