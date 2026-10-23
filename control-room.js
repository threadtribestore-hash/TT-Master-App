// ===================================================================
// ======================= CONTROL ROOM (Studio) =====================
// ===================================================================
// One screen for running the day: the production queue and delivery dates
// (a two-week dispatch calendar plus overdue / at-risk / unpaid lists).
//
// The Customer chats panel (Buyer-app messages, imported WhatsApp group chats
// in state.waChats, and the week's client updates) was taken off the screen on
// 14 Oct 2026. Its helpers below are unused for now; saved chat data is kept.
(function(){
  if(window.TT_STOCK_MODE) return;

  const OPEN = ['booked', 'in_production'];
  const PRIORITY = { urgent: 0, high: 1, normal: 2, low: 3 };
  const KEEP_DAYS = 45, KEEP_MSGS = 3000;
  const V = { chat: 'week', filter: 'reply', importing: false };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function dayDiff(a, b){ return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
  function fmt(s){ if(!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function client(id){ return (state.clients || []).find(function(c){ return c.id === id; }); }
  function who(o){ const c = client(o.clientId); return (c && c.name) || o.clientName || 'Walk-in'; }
  function target(o){ return o.dispatchBy || o.dueDate || ''; }
  function prodStats(){ return (window.TTBuyers && window.TTBuyers.prod()) || {}; }

  // ---------- production queue and finish forecast ----------
  function capacityPerDay(){
    const running = (state.printers || []).filter(function(p){ return p.status !== 'down'; }).length || (state.fleet && state.fleet.printers) || 0;
    return running * ((state.fleet && state.fleet.hoursPerDay) || 0);
  }
  function queue(){
    return state.orders.filter(function(o){ return OPEN.indexOf(o.status) !== -1; }).sort(function(a, b){
      return (a.status === 'in_production' ? 0 : 1) - (b.status === 'in_production' ? 0 : 1) ||
        (PRIORITY[a.priority || 'normal'] - PRIORITY[b.priority || 'normal']) || (target(a) || '9').localeCompare(target(b) || '9');
    });
  }
  // Queue clear date = queued print hours ÷ printers running, counted from now with the
  // printers going round the clock. The forecast below is the slower, hours-per-day view.
  function printersRunning(){ return (state.printers || []).filter(function(p){ return p.status !== 'down'; }).length || (state.fleet && state.fleet.printers) || 0; }
  function queueClear(hours){
    const n = printersRunning();
    if(!n) return null;
    const each = hours / n;
    return { n: n, each: each, at: new Date(Date.now() + each * 3600000) };
  }
  function fmtWhen(d){ return d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  // Serial forecast in queue order against the fleet's daily print hours.
  function forecast(){
    const cap = capacityPerDay(), out = {};
    let used = 0;
    queue().forEach(function(o){
      used += orderTotals(o).hours || 0;
      out[o.id] = cap > 0 ? addDays(today(), Math.max(0, Math.ceil(used / cap) - 1)) : '';
    });
    return { finish: out, hours: used, days: cap > 0 ? used / cap : 0, cap: cap };
  }

  // ---------- live delivery-promise calculator (for the sales team) ----------
  // Answers "when can we deliver?" while the customer is on the phone. The new order
  // joins the back of the current queue on the shared fleet, or gets N printers to
  // itself (which slows everything else by its share). Dates: production finish →
  // + packing days = dispatch → + transit days = delivery. The safe date adds a
  // margin on print time for failures, downtime and changeovers.
  const P = { lines: [{ id: '', qty: 0 }], hours: '', need: '', rush: 0, customer: '', partners: false };
  function pset(){ return Object.assign({ packDays: 1, transitDays: 3, safetyPct: 15 }, state.promiseSettings || {}); }
  function fleet(){
    const running = (state.printers || []).filter(function(p){ return p.status !== 'down'; }).length || (state.fleet && state.fleet.printers) || 0;
    const hpd = (state.fleet && state.fleet.hoursPerDay) || 0;
    const reserved = queue().reduce(function(t, o){ return t + (o.reservedPrinters || 0); }, 0);
    // Optionally add the partner network's free printer-hours (partner-planning.js).
    const extra = P.partners && window.TTPartners && window.TTPartners.ready() ? window.TTPartners.freePerDay(14) : 0;
    return { running: running, hpd: hpd, own: running * hpd, extra: extra, cap: running * hpd + extra, free: Math.max(0, running - reserved) };
  }
  function lineHours(){
    let hours = 0, pcs = 0, missing = [];
    P.lines.forEach(function(l){
      const it = (state.productCatalog || []).find(function(i){ return i.id === l.id; }), q = Math.max(0, Math.round(+l.qty || 0));
      if(!it || !q) return;
      pcs += q;
      if(!(+it.hours > 0)) missing.push(it.name);
      hours += q * (+it.hours || 0) * bufferMult();
    });
    const manual = parseFloat(P.hours);
    if(isFinite(manual) && manual > 0) hours += manual;
    return { hours: hours, pcs: pcs, missing: missing };
  }
  function dayAfter(days){ return addDays(today(), Math.max(0, Math.ceil(days - 1e-9) - 1)); }
  function promise(){
    const F = fleet(), S = pset(), L = lineHours(), fc = forecast();
    if(!(L.hours > 0) || !F.cap) return { L: L, F: F, empty: true };
    const queued = fc.hours, safety = 1 + (+S.safetyPct || 0) / 100;
    let earliestDays, safeDays, delay = 0;
    const k = Math.min(P.rush, F.free);
    if(k > 0){
      earliestDays = L.hours / (k * F.hpd);
      safeDays = earliestDays * safety;
      delay = earliestDays * k / F.running;                 // days the rest of the queue slips
    } else {
      earliestDays = (queued + L.hours) / F.cap;
      safeDays = (queued + L.hours * safety) / F.cap;
    }
    const r = { L: L, F: F, S: S, k: k, delay: delay, queued: queued,
      earliestMade: dayAfter(earliestDays), safeMade: dayAfter(safeDays) };
    r.dispatch = addDays(r.safeMade, +S.packDays || 0);
    r.delivery = addDays(r.dispatch, +S.transitDays || 0);
    r.earliestDispatch = addDays(r.earliestMade, +S.packDays || 0);
    // Against the customer's date: what it takes to make it, and what fits by then.
    if(P.need){
      const lastMade = addDays(P.need, -(+S.packDays || 0) - (+S.transitDays || 0));
      const daysAvail = dayDiff(lastMade, today()) + 1;
      r.lastMade = lastMade; r.daysAvail = daysAvail;
      r.verdict = r.delivery <= P.need ? 'yes' : addDays(r.earliestDispatch, +S.transitDays || 0) <= P.need ? 'tight' : 'no';
      if(daysAvail > 0){
        const needK = Math.ceil(L.hours * safety / (daysAvail * F.hpd));
        r.needPrinters = needK <= F.free ? needK : null;
        const hoursByThen = k > 0 ? daysAvail * k * F.hpd / safety : Math.max(0, daysAvail * F.cap - queued) / safety;
        r.partialPcs = L.pcs && L.hours ? Math.min(L.pcs, Math.floor(L.pcs * hoursByThen / L.hours)) : 0;
      }
    }
    // Every queued order, now and with the new order in place. Rushed: while the rush runs
    // (T days) the queue has the other printers only, then the whole fleet again. Queued
    // at the back: the new order doesn't move anyone.
    const slow = F.cap - k * F.hpd, T = k > 0 ? earliestDays : 0;
    let cum = 0;
    r.impact = queue().map(function(o){
      cum += orderTotals(o).hours || 0;
      const before = cum / F.cap;
      let after = before;
      if(k > 0) after = slow <= 0 ? T + cum / F.cap : (cum <= slow * T ? cum / slow : T + (cum - slow * T) / F.cap);
      const due = target(o), was = dayAfter(before), now = dayAfter(after);
      return { o: o, due: due, was: was, now: now, slip: dayDiff(now, was), lateBefore: !!(due && was > due), lateAfter: !!(due && now > due) };
    });
    r.hurt = r.impact.filter(function(x){ return x.lateAfter && !x.lateBefore; }).map(function(x){ return x.o; });
    r.lastDone = r.impact.length ? r.impact[r.impact.length - 1].now : '';
    r.lastWas = r.impact.length ? r.impact[r.impact.length - 1].was : '';
    return r;
  }
  function promiseHtml(){
    const cat = (state.productCatalog || []).filter(function(i){ return (i.name || '').trim(); }).slice().sort(function(a, b){ return a.name.localeCompare(b.name); });
    const S = pset();
    return '<div class="panel cr-promise"><div class="panel-title">Promise a delivery date</div>' +
      '<p class="cr-dim">For quoting a customer live. It counts everything already queued on the printers. Results update as you type.</p>' +
      '<div class="cr-pl">' + P.lines.map(function(l, i){
        return '<div class="cr-pl-row"><select data-pp="id" data-i="' + i + '"><option value="">Choose a product…</option>' + cat.map(function(it){
          return '<option value="' + esc(it.id) + '"' + (it.id === l.id ? ' selected' : '') + '>' + esc(it.name) + (+it.hours > 0 ? ' · ' + it.hours + ' h/pc' : ' · no print time') + '</option>'; }).join('') + '</select>' +
          '<input type="number" min="0" placeholder="Qty" data-pp="qty" data-i="' + i + '" value="' + (l.qty || '') + '">' +
          (P.lines.length > 1 ? '<button class="cr-btn" data-cr="pl-del" data-i="' + i + '">✕</button>' : '') + '</div>';
      }).join('') + '<button class="cr-btn" data-cr="pl-add">+ Add product</button></div>' +
      '<div class="cr-pf"><label>or extra print hours<input type="number" min="0" step="0.5" data-pp="hours" value="' + esc(P.hours) + '" placeholder="0"></label>' +
      '<label>Customer needs it by<input type="date" data-pp="need" value="' + esc(P.need) + '"></label>' +
      '<label>Rush on dedicated printers<select data-pp="rush"><option value="0">No — join the queue</option>' +
        Array.from({ length: fleet().free }, function(_, i){ return '<option value="' + (i + 1) + '"' + (P.rush === i + 1 ? ' selected' : '') + '>' + (i + 1) + ' printer' + (i ? 's' : '') + '</option>'; }).join('') + '</select></label>' +
      '<label>Customer (for the message)<input data-pp="customer" value="' + esc(P.customer) + '" placeholder="e.g. Anand"></label>' +
      (window.TTPartners && window.TTPartners.ready() ? '<label class="cr-chk"><input type="checkbox" data-pp="partners"' + (P.partners ? ' checked' : '') + '> Count partner farms (+' + Math.round(window.TTPartners.freePerDay(14)) + ' h/day free)</label>' : '') + '</div>' +
      '<div id="crPromiseOut">' + promiseOut() + '</div>' +
      '<details class="cr-pset"><summary class="cr-dim">Assumptions: ' + S.packDays + ' day packing · ' + S.transitDays + ' days transit · ' + S.safetyPct + '% safety margin</summary>' +
      '<div class="cr-pf"><label>Packing days<input type="number" min="0" data-ps="packDays" value="' + S.packDays + '"></label><label>Transit days<input type="number" min="0" data-ps="transitDays" value="' + S.transitDays + '"></label>' +
      '<label>Safety margin %<input type="number" min="0" max="100" data-ps="safetyPct" value="' + S.safetyPct + '"></label></div></details></div>';
  }
  function promiseOut(){
    const r = promise();
    if(!r.F.cap) return '<div class="cr-note">Set printers and print hours per day in Settings so the calculator knows your capacity.</div>';
    if(r.empty) return '<div class="cr-note">Add a product and quantity (or print hours) to get a date.</div>';
    const v = r.verdict, color = v === 'yes' ? 'ok' : v === 'tight' ? 'warn' : v === 'no' ? 'bad' : '';
    let html = '<div class="cr-res ' + color + '">' +
      (v ? '<div class="cr-verdict">' + (v === 'yes' ? '✓ Yes, we can deliver by ' + fmt(P.need) : v === 'tight' ? '⚠ Possible, but tight for ' + fmt(P.need) : '✗ Not by ' + fmt(P.need)) + '</div>' : '') +
      '<div class="cr-dates"><div><span>Safe to promise · dispatch</span><b>' + fmtLong(r.dispatch) + '</b></div><div><span>Delivered by</span><b>' + fmtLong(r.delivery) + '</b></div>' +
      '<div><span>Earliest possible dispatch</span><b>' + fmtLong(r.earliestDispatch) + '</b></div></div>' +
      '<div class="cr-dim" style="margin:6px 0 0">' + Math.round(r.L.hours) + ' print-hours' + (r.L.pcs ? ' for ' + r.L.pcs.toLocaleString('en-IN') + ' pcs' : '') +
        (r.k ? ' on ' + r.k + ' dedicated printer' + (r.k === 1 ? '' : 's') : ' after ' + Math.round(r.queued) + ' h already queued, on ' + r.F.running + ' printers × ' + r.F.hpd + ' h/day' + (r.F.extra ? ' + ' + Math.round(r.F.extra) + ' h/day at partner farms' : '')) + '.</div>';
    if(r.L.missing.length) html += '<div class="cr-warn" style="margin-top:6px">No print time set for ' + esc(r.L.missing.join(', ')) + ' — add it in Product Catalog, or enter the hours above.</div>';
    if(v === 'no' || v === 'tight'){
      const tips = [];
      if(r.daysAvail <= 0) tips.push('That date is too soon even to pack and ship (' + r.S.packDays + ' + ' + r.S.transitDays + ' days).');
      else {
        if(!r.k && r.needPrinters) tips.push('Dedicate <b>' + r.needPrinters + ' printer' + (r.needPrinters === 1 ? '' : 's') + '</b> to make it — pick it under “Rush”.');
        if(!r.needPrinters) tips.push('Even all ' + r.F.free + ' free printers can’t make it in time.');
        if(r.partialPcs && r.partialPcs < r.L.pcs) tips.push('About <b>' + r.partialPcs.toLocaleString('en-IN') + ' of ' + r.L.pcs.toLocaleString('en-IN') + ' pcs</b> could ship in time — offer a part delivery.');
      }
      if(tips.length) html += '<ul class="cr-tips">' + tips.map(function(t){ return '<li>' + t + '</li>'; }).join('') + '</ul>';
    }
    if(r.impact && r.impact.length){
      html += '<div class="cr-impact"><div class="cr-impact-h"><b>' + (r.k ? 'What the rush does to the queue' : 'Orders already in the queue') + '</b>' +
        '<span class="cr-dim">' + (r.k ? 'Whole queue done ' + fmtLong(r.lastDone) + ' instead of ' + fmtLong(r.lastWas) + (r.hurt.length ? ' · <span class="cr-bad">' + r.hurt.length + ' will now be late</span>' : ' · no order newly late') : 'This order goes after them, so none of them moves. Queue clears ' + fmtLong(r.lastWas) + '.') + '</span></div>' +
        '<table class="cr-it"><tr><th>Order</th><th>Due</th><th>Finishes now</th>' + (r.k ? '<th>With rush</th><th></th>' : '') + '</tr>' +
        r.impact.map(function(x){
          const cls = x.lateAfter && !x.lateBefore ? 'cr-bad' : x.lateAfter ? 'cr-warn' : '';
          return '<tr><td>' + orderLink(x.o) + ' <span class="cr-dim">' + esc(who(x.o)) + '</span></td><td>' + (x.due ? fmt(x.due) : '—') + '</td>' +
            '<td class="' + (!r.k && x.lateBefore ? 'cr-warn' : '') + '">' + fmt(x.was) + '</td>' +
            (r.k ? '<td class="' + cls + '">' + fmt(x.now) + '</td><td class="' + cls + '">' + (x.slip > 0 ? '+' + x.slip + 'd' : 'same') + (x.lateAfter && !x.lateBefore ? ' · late' : x.lateAfter ? ' · already late' : '') + '</td>' : '') + '</tr>';
        }).join('') + '</table></div>';
    }
    html += '<div class="cr-msgbox"><textarea id="crPromiseMsg" rows="3">' + esc(promiseMessage(r)) + '</textarea>' +
      '<div><button class="cr-btn primary" data-cr="p-copy">Copy message</button><button class="cr-btn" data-cr="p-wa">Send on WhatsApp</button></div></div></div>';
    return html;
  }
  function fmtLong(s){ const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function promiseMessage(r){
    const items = P.lines.map(function(l){ const it = (state.productCatalog || []).find(function(i){ return i.id === l.id; }); return it && +l.qty ? l.qty + ' × ' + it.name : ''; }).filter(Boolean);
    return 'Hi' + (P.customer ? ' ' + P.customer : '') + ', ' + (items.length ? 'for ' + items.join(', ') + ' — ' : '') +
      'we can dispatch by ' + fmtLong(r.dispatch) + ', so you should receive it by ' + fmtLong(r.delivery) + '. Production starts as soon as you confirm. — Thread Tribe';
  }
  function refreshPromise(){ const o = document.getElementById('crPromiseOut'); if(o) o.innerHTML = promiseOut(); }

  // ---------- delivery problems ----------
  function problems(){
    const t = today(), fc = forecast(), out = { overdue: [], risk: [], unpaid: [] };
    state.orders.forEach(function(o){
      if(['quoted', 'lost', 'cancelled'].indexOf(o.status) !== -1) return;
      const due = target(o), done = o.status === 'delivered' || !!o.shippedDate;
      if(!done && due && due < t) out.overdue.push({ o: o, late: dayDiff(t, due) });
      else if(!done && due && OPEN.indexOf(o.status) !== -1 && fc.finish[o.id] && fc.finish[o.id] > due) out.risk.push({ o: o, finish: fc.finish[o.id], by: dayDiff(fc.finish[o.id], due) });
      const owed = o.paymentStatus !== 'paid' && o.paymentStatus !== 'refunded' && (o.status === 'delivered' || o.shippedDate);
      const since = o.deliveryDate || o.shippedDate || '';
      if(owed && since && dayDiff(t, since) > 7) out.unpaid.push({ o: o, days: dayDiff(t, since), due: Math.max(0, orderTotals(o).grandTotal - (o.amountPaid || 0)) });
    });
    out.overdue.sort(function(a, b){ return b.late - a.late; });
    out.risk.sort(function(a, b){ return b.by - a.by; });
    out.unpaid.sort(function(a, b){ return b.days - a.days; });
    return out;
  }

  // For the owner's Home: the same finish forecast and late / at-risk / unpaid lists.
  window.TTControl = { forecast: forecast, problems: problems, queue: queue };

  // ---------- WhatsApp chat import ----------
  function chats(){
    if(!state.waChats || typeof state.waChats !== 'object') state.waChats = { groups: [], handled: {} };
    if(!Array.isArray(state.waChats.groups)) state.waChats.groups = [];
    if(!state.waChats.handled) state.waChats.handled = {};
    return state.waChats;
  }
  // Android: "10/09/26, 3:45 pm - Name: text"   iOS: "[10/09/26, 3:45:12 PM] Name: text"
  const LINE_A = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?\s?m\.?)?\s*[-–]\s+([^:]{1,60}):\s?([\s\S]*)$/i;
  const LINE_I = /^\[(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?\s?m\.?)?\]\s+([^:]{1,60}):\s?([\s\S]*)$/i;
  function parseChat(text){
    const msgs = [];
    String(text).replace(/\r/g, '').split('\n').forEach(function(raw){
      const line = raw.replace(/[‎‏‪-‮]/g, '');
      const m = line.match(LINE_I) || line.match(LINE_A);
      if(m){
        let d = +m[1], mo = +m[2], y = +m[3], h = +m[4];
        if(mo > 12 && d <= 12){ const x = d; d = mo; mo = x; }          // US-style export
        if(y < 100) y += 2000;
        const ap = (m[6] || '').toLowerCase().replace(/[\s.]/g, '');
        if(ap === 'pm' && h < 12) h += 12; if(ap === 'am' && h === 12) h = 0;
        const t = new Date(y, mo - 1, d, h, +m[5]);
        if(isNaN(t)) return;
        msgs.push({ t: t.toISOString(), from: m[7].trim(), text: m[8].trim() });
      } else if(msgs.length && line.trim()){
        msgs[msgs.length - 1].text += '\n' + line.trim();
      }
    });
    return msgs.filter(function(x){ return x.text && !/^<(media omitted|attached:)|^(this message was deleted|image omitted|video omitted|sticker omitted)$/i.test(x.text); });
  }
  function msgId(g, m){ return g.id + '|' + m.t + '|' + m.from + '|' + m.text.slice(0, 30); }
  function tags(text){
    const t = String(text), out = [];
    if(/\bTT-\d+\b/i.test(t) || /\border\b|\bmaal\b|\bpcs\b|\bpieces\b/i.test(t)) out.push('order');
    if(/\bpa(y|id|yment)\b|\bupi\b|\bneft\b|\btransfer|\binvoice\b|\bbill\b|₹\s?\d|\brs\.?\s?\d/i.test(t)) out.push('payment');
    if(/dispatch|\bship|courier|tracking|\bawb\b|deliver|parcel|kab (tak|milega|aayega)/i.test(t)) out.push('dispatch');
    if(/broken|damag|defect|missing|wrong|crack|return|replace|refund|\bissue\b|problem|kharab|toot/i.test(t)) out.push('complaint');
    return out;
  }
  function isQuestion(text){ return /\?\s*$|\bkab\b|\bkya\b|\bkitna\b|\bwhen\b|\bstatus\b|\bupdate\b|\bplease\b|\bpls\b|\bplz\b/i.test(text); }
  function teamSet(g){ const s = {}; (g.team || []).forEach(function(n){ s[n] = 1; }); return s; }
  // A customer message needs a reply when nobody from the team wrote after it.
  function needsReply(g){
    const team = teamSet(g), handled = chats().handled, out = [];
    let lastTeam = '';
    g.msgs.forEach(function(m){ if(team[m.from]) lastTeam = m.t; });
    g.msgs.forEach(function(m){
      if(team[m.from] || m.t <= lastTeam || handled[msgId(g, m)]) return;
      if(isQuestion(m.text) || tags(m.text).length) out.push(m);
    });
    return out;
  }
  async function readFile(file){
    if(/\.zip$/i.test(file.name)){
      if(typeof JSZip === 'undefined'){
        await new Promise(function(res, rej){ const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      }
      const zip = await JSZip.loadAsync(file);
      const entry = Object.keys(zip.files).find(function(n){ return /_chat\.txt$|\.txt$/i.test(n); });
      if(!entry) throw new Error('No chat text inside that zip.');
      return zip.files[entry].async('string');
    }
    return file.text();
  }
  async function importChat(file){
    V.importing = true; render();
    try{
      const text = await readFile(file);
      let msgs = parseChat(text);
      if(!msgs.length) throw new Error('Couldn’t read any messages. Export the chat from WhatsApp (⋮ → More → Export chat → Without media) and upload that file.');
      const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
      msgs = msgs.filter(function(m){ return m.t >= cutoff; }).slice(-KEEP_MSGS).map(function(m){ return { t: m.t, from: m.from.slice(0, 60), text: m.text.slice(0, 1200) }; });
      const name = (file.name.replace(/\.(txt|zip)$/i, '').replace(/^WhatsApp Chat (with|-)\s*/i, '').trim()) || 'WhatsApp group';
      const C = chats();
      let g = C.groups.find(function(x){ return x.name === name; });
      if(g){
        const seen = {}; g.msgs.forEach(function(m){ seen[m.t + m.from + m.text] = 1; });
        g.msgs = g.msgs.concat(msgs.filter(function(m){ return !seen[m.t + m.from + m.text]; })).sort(function(a, b){ return a.t.localeCompare(b.t); }).slice(-KEEP_MSGS);
      } else {
        // Guess the team: senders named like the business. The user confirms below.
        const biz = String((state.business && state.business.name) || 'thread tribe').toLowerCase().split(' ')[0];
        const senders = {}; msgs.forEach(function(m){ senders[m.from] = 1; });
        g = { id: 'g' + Date.now().toString(36), name: name, msgs: msgs, team: Object.keys(senders).filter(function(n){ return n.toLowerCase().indexOf(biz) !== -1 || /thread\s*tribe|^tt\b|^you$/i.test(n); }) };
        C.groups.push(g);
      }
      g.importedAt = new Date().toISOString();
      scheduleSave();
      V.chat = g.id; V.filter = g.team.length ? 'reply' : 'setup';
      showToast('Imported ' + msgs.length + ' messages from ' + name);
    }catch(e){ showNoticeModal(String((e && e.message) || e)); }
    V.importing = false; render();
  }

  // ---------- this week's clients ----------
  // Every client with an order to dispatch in the next 7 days (or late, or shipped in the
  // last 3 days and not yet delivered), with one-tap WhatsApp updates. Studio can't read
  // replies, so each send is logged on the order and clients go quiet-flagged after 3 days.
  const QUIET_DAYS = 3;
  function waPhone(raw){
    let d = String(raw || '').replace(/\D/g, '');
    if(d.length === 10) d = '91' + d;
    if(d.length === 11 && d[0] === '0') d = '91' + d.slice(1);
    return d.length >= 11 ? d : '';
  }
  function owed(o){ return orderOwed(o); }
  function weekOrders(){
    const t = today(), end = addDays(t, 7), recent = addDays(t, -3);
    return state.orders.filter(function(o){
      if(['quoted', 'lost', 'cancelled', 'delivered'].indexOf(o.status) !== -1) return false;
      if(o.shippedDate) return o.shippedDate >= recent;
      if(['booked', 'in_production', 'production_done'].indexOf(o.status) === -1) return false;
      const d = target(o);
      return !d || d <= end;
    });
  }
  function lastSent(o){ const l = o.waLog || []; return l.length ? l[l.length - 1] : null; }
  function linkedGroup(key, name){
    const n = String(name || '').toLowerCase().trim();
    return chats().groups.find(function(g){ return g.clientKey === key; }) ||
      (n.length > 2 ? chats().groups.find(function(g){ return !g.clientKey && g.name.toLowerCase().indexOf(n) !== -1; }) : null);
  }
  function weekClients(){
    const by = {}, t = today();
    weekOrders().forEach(function(o){
      const key = o.clientId || ('n:' + who(o).toLowerCase());
      const c = client(o.clientId);
      const w = by[key] = by[key] || { key: key, name: who(o), phone: waPhone((c && c.phone) || o.clientPhone), orders: [], last: '' };
      if(!w.phone) w.phone = waPhone(o.clientPhone);
      w.orders.push(o);
      const ls = lastSent(o); if(ls && ls.t > w.last) w.last = ls.t;
    });
    return Object.keys(by).map(function(k){
      const w = by[k];
      w.orders.sort(function(a, b){ return (target(a) || '9999').localeCompare(target(b) || '9999'); });
      w.group = linkedGroup(w.key, w.name);
      w.waiting = w.group && w.group.team.length ? needsReply(w.group).length : 0;
      w.quiet = !w.last || dayDiff(t, w.last.slice(0, 10)) >= QUIET_DAYS;
      return w;
    }).sort(function(a, b){
      return (b.waiting - a.waiting) || ((b.quiet ? 1 : 0) - (a.quiet ? 1 : 0)) || (target(a.orders[0]) || '9999').localeCompare(target(b.orders[0]) || '9999');
    });
  }
  function itemsText(o){ return (o.products || []).filter(function(p){ return p.name; }).map(function(p){ return p.name + ' × ' + (p.qty || 0); }).join(', '); }
  function waText(o, kind, name){
    const biz = (state.business && state.business.name) || 'Thread Tribe', hi = 'Hi ' + String(name || '').split(' ')[0] + ', ';
    const ref = o.displayId || 'your order', d = target(o), when = d ? fmtLong(d) : '';
    if(kind === 'pay') return hi + 'a gentle reminder that ' + money(owed(o)) + ' is due for ' + ref + '. Payment details are on your invoice. Thank you!\n— ' + biz;
    if(o.shippedDate){ const sh = typeof shipmentsText === 'function' ? shipmentsText(o) : (o.trackingNo || ''), n = typeof orderShipments === 'function' ? orderShipments(o).length : 1; return hi + ref + ' has been dispatched' + (n > 1 ? ' in ' + n + ' parcels' : (o.courier ? ' via ' + o.courier : '')) + (sh ? '. Tracking / AWB: ' + sh : '') + '.\n— ' + biz; }
    if(o.status === 'production_done') return hi + 'good news: ' + ref + ' is ready and will be dispatched ' + (when ? 'by ' + when : 'shortly') + '.' + (owed(o) ? ' Balance due: ' + money(owed(o)) + '.' : '') + '\n— ' + biz;
    if(o.status === 'in_production'){ const pr = orderProgress(o); return hi + 'quick update on ' + ref + ': ' + pr.done + ' of ' + pr.total + ' pieces made so far' + (when ? ', on track to dispatch by ' + when : '') + '.\n— ' + biz; }
    return hi + ref + ' is confirmed and booked for production' + (itemsText(o) ? ': ' + itemsText(o) : '') + '.' + (when ? ' Expected dispatch: ' + when + '.' : '') + '\n— ' + biz;
  }
  // Timestamps are stored in UTC, so compare by the local calendar date (an evening send in India is the next UTC day).
  function ago(ts){ const t = new Date(ts); const n = isNaN(t) ? 0 : dayDiff(today(), iso(t)); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }
  function weekHtml(){
    const W = weekClients(), groups = chats().groups;
    if(!W.length) return '<p class="cr-dim">No client orders to dispatch in the next 7 days.</p>';
    return W.map(function(w){
      const chat = w.group ? '<button class="cr-btn" data-crchat="' + w.group.id + '">💬 ' + (w.waiting ? w.waiting + ' waiting' : 'Chat') + '</button>' :
        (groups.length ? '<select class="cr-link" data-crlink="' + esc(w.key) + '"><option value="">Link a chat…</option>' + groups.map(function(g){ return '<option value="' + g.id + '">' + esc(g.name) + '</option>'; }).join('') + '</select>' : '');
      return '<div class="cr-wk' + (w.waiting ? ' open' : '') + '"><div class="cr-wk-h"><b>' + esc(w.name) + '</b>' +
        (w.phone ? '<span class="cr-dim">+' + w.phone + '</span>' : '<span class="cr-warn">no phone, add it in Clients</span>') +
        '<span class="' + (w.quiet ? 'cr-warn' : 'cr-dim') + '">' + (w.last ? 'Last update ' + ago(w.last) : 'No update sent') + '</span>' + chat + '</div>' +
        w.orders.map(function(o){
          const pr = orderProgress(o), due = owed(o), ls = lastSent(o), d = target(o);
          return '<div class="cr-wk-o">' + orderLink(o) + pill(o.status, o) + '<span class="cr-dim">' + pr.done + '/' + pr.total + ' pcs</span>' +
            '<span class="' + (d && d < today() && !o.shippedDate ? 'cr-bad' : 'cr-dim') + '">' + (o.shippedDate ? 'sent ' + fmt(o.shippedDate) : d ? 'dispatch ' + fmt(d) : 'no date') + '</span>' +
            (due ? '<span class="cr-warn">' + money(due) + ' due</span>' : '') +
            '<span class="cr-wk-a">' + (ls ? '<span class="cr-dim">' + (ls.kind === 'pay' ? 'reminded' : 'updated') + ' ' + ago(ls.t) + '</span>' : '') +
            '<button class="cr-btn primary" data-cr="wa" data-k="update" data-id="' + o.id + '"' + (w.phone ? '' : ' disabled') + '>' + (o.shippedDate ? 'Send tracking' : 'Send update') + '</button>' +
            (due && (o.status === 'production_done' || o.shippedDate) ? '<button class="cr-btn" data-cr="wa" data-k="pay" data-id="' + o.id + '"' + (w.phone ? '' : ' disabled') + '>Payment reminder</button>' : '') + '</span></div>';
        }).join('') + '</div>';
    }).join('') + '<p class="cr-dim" style="margin-top:8px">Each button opens WhatsApp with the message filled in. Edit it if you like, then send. Clients you haven’t updated in ' + QUIET_DAYS + ' days are flagged.</p>';
  }
  function sendWa(id, kind){
    const o = state.orders.find(function(x){ return x.id === id; }); if(!o) return;
    const c = client(o.clientId), phone = waPhone((c && c.phone) || o.clientPhone);
    if(!phone){ showNoticeModal('Add a phone number for ' + who(o) + ' in the Clients tab first.'); return; }
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(waText(o, kind, who(o))), '_blank');
    o.waLog = (o.waLog || []).concat([{ t: new Date().toISOString(), kind: kind }]).slice(-10);
    scheduleSave(); render();
  }

  // ---------- order lines: every open order's products, farm state and per-product updates ----------
  // Farm state comes from tt-bridge (production_stats.lines): made, plus jobs waiting / printing that
  // it could tie to the line. "_farm" holds jobs known to be for the order but not for one line.
  const LINE_STATES = [['all', 'All'], ['none', 'Not queued'], ['queued', 'Queued'], ['printing', 'Printing'], ['done', 'Made']];
  function floorOrders(){
    return state.orders.filter(function(o){
      return ['booked', 'in_production', 'production_done'].indexOf(o.status) !== -1 && !o.shippedDate && (o.products || []).some(function(p){ return (p.qty || 0) > 0; });
    }).sort(function(a, b){ return (target(a) || '9999').localeCompare(target(b) || '9999'); });
  }
  function lineInfo(o, p){
    const ps = prodStats()[o.id], f = ps && ps.lines ? ps.lines[p.id] : null, of = ps && ps.lines ? ps.lines._farm : null;
    const qty = p.qty || 0, made = Math.min(qty, Math.max(p.already || 0, f ? (f.made || 0) : 0)), left = qty - made;
    const waiting = f ? (f.waiting || 0) : 0, printing = f ? (f.printing || 0) : 0;
    let st, label;
    if(o.status === 'production_done' || left <= 0){ st = 'done'; label = 'Made'; }
    else if(printing){ st = 'printing'; label = 'Printing' + (waiting ? ' · ' + waiting + ' waiting' : ''); }
    else if(waiting){ st = 'queued'; label = 'Queued · ' + waiting + ' plate' + (waiting === 1 ? '' : 's'); }
    else if(of && (of.waiting || of.printing)){ st = 'queued'; label = 'Order on farm'; }
    else if(!ps){ st = 'none'; label = 'No farm data'; }
    else { st = 'none'; label = 'Not queued'; }
    return { qty: qty, made: made, left: left, waiting: waiting, printing: printing, st: st, label: label, unknown: !ps };
  }
  function colourOf(p){
    const hex = typeof resolveHex === 'function' ? resolveHex(p) : (p.colorHex || '#999');
    return '<span class="cr-sw" style="background:' + esc(hex) + '"></span>' + esc(p.color || '—') + (p.material ? ' <span class="cr-dim-i">' + esc(p.material) + '</span>' : '');
  }
  function lineText(o, p, name){
    const biz = (state.business && state.business.name) || 'Thread Tribe', hi = 'Hi ' + String(name || '').split(' ')[0] + ', ';
    const i = lineInfo(o, p), ref = o.displayId || 'your order', d = target(o), when = d ? fmtLong(d) : '';
    const item = p.name + (p.color ? ' (' + p.color + ')' : '');
    let body;
    if(i.left <= 0) body = 'all ' + i.qty + ' pcs of ' + item + ' are made' + (when ? ' and set for dispatch by ' + when : '') + '.';
    else if(i.printing || i.waiting) body = item + ': ' + i.made + ' of ' + i.qty + ' pcs made, the remaining ' + i.left + ' are ' + (i.waiting ? 'in the print queue' : 'printing now') + (when ? '. On track for dispatch by ' + when : '') + '.';
    else if(i.made) body = item + ': ' + i.made + ' of ' + i.qty + ' pcs made so far' + (when ? '. Expected dispatch ' + when : '') + '.';
    else body = item + ' × ' + i.qty + ' is scheduled for production' + (when ? ', expected dispatch ' + when : '') + '.';
    return hi + 'update on ' + ref + ': ' + body + '\n— ' + biz;
  }
  function sendLine(id, lineId){
    const o = state.orders.find(function(x){ return x.id === id; }); if(!o) return;
    const p = (o.products || []).find(function(x){ return x.id === lineId; }); if(!p) return;
    const c = client(o.clientId), phone = waPhone((c && c.phone) || o.clientPhone);
    if(!phone){ showNoticeModal('Add a phone number for ' + who(o) + ' in the Clients tab first.'); return; }
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(lineText(o, p, who(o))), '_blank');
    o.waLog = (o.waLog || []).concat([{ t: new Date().toISOString(), kind: 'line', line: lineId }]).slice(-20);
    scheduleSave(); render();
  }
  function lineSent(o, lineId){ const l = (o.waLog || []).filter(function(e){ return e.kind === 'line' && e.line === lineId; }); return l.length ? l[l.length - 1] : null; }
  function linesHtml(){
    const orders = floorOrders(), f = V.lf || 'all', q = (V.lq || '').trim().toLowerCase();
    const counts = { all: 0, none: 0, queued: 0, printing: 0, done: 0 };
    const rows = orders.map(function(o){
      const ls = (o.products || []).filter(function(p){ return (p.qty || 0) > 0; }).map(function(p){ const i = lineInfo(o, p); counts.all++; counts[i.st]++; return { p: p, i: i }; });
      return { o: o, ls: ls };
    });
    const anyData = Object.keys(prodStats()).length > 0;
    // A search that names the order or client shows all its lines; one that names a product or colour shows those lines.
    const shown = rows.map(function(r){
      const orderHit = !q || [r.o.displayId, who(r.o), r.o.name].join(' ').toLowerCase().indexOf(q) !== -1;
      return { o: r.o, ls: r.ls.filter(function(x){
        return (f === 'all' || x.i.st === f) && (orderHit || [x.p.name, x.p.color, x.p.material].join(' ').toLowerCase().indexOf(q) !== -1);
      }) };
    }).filter(function(r){ return r.ls.length; });
    let h = '<div class="panel cr-lines"><div class="cr-lines-head"><div class="panel-title" style="margin:0">Order lines on the floor</div>' +
      '<input class="cr-lines-q" data-crlq placeholder="Search order, client, product, colour" value="' + esc(V.lq || '') + '"></div>' +
      '<div class="cr-lines-f">' + LINE_STATES.map(function(s){ return '<button class="' + (f === s[0] ? 'on ' : '') + 'st-' + s[0] + '" data-crlf="' + s[0] + '">' + s[1] + ' <b>' + counts[s[0]] + '</b></button>'; }).join('') + '</div>' +
      (anyData ? '' : '<p class="cr-dim">Farm status comes from the workshop bridge. Sign in to sync to see what is queued and printing.</p>');
    if(!shown.length) return h + '<p class="cr-dim">' + (orders.length ? 'No lines match.' : 'No booked or in-production orders.') + '</p></div>';
    // Search and filters stay put; the orders scroll inside, like the production queue.
    h += '<div class="cr-lines-list">' + shown.map(function(r){
      const o = r.o, pr = orderProgress(o), d = target(o), late = d && d < today();
      const ls = lastSent(o);
      return '<div class="cr-lo"><div class="cr-lo-h">' + orderLink(o) + '<b>' + esc(who(o)) + '</b>' + pill(o.status, o) +
          '<span class="' + (late ? 'cr-bad' : 'cr-dim-i') + '">' + (d ? (late ? 'late · ' : 'dispatch ') + fmt(d) : 'no date') + '</span>' +
          '<span class="cr-dim-i">' + pr.done + '/' + pr.total + ' pcs</span>' +
          '<span class="cr-lo-a">' + (ls ? '<span class="cr-dim-i">updated ' + ago(ls.t) + '</span>' : '') + '<button class="cr-btn" data-cr="wa" data-id="' + o.id + '" data-k="update">Update whole order</button></span></div>' +
        '<div class="cr-lt"><div class="cr-lt-r cr-lt-th"><span>Product</span><span>Colour</span><span class="n">Qty</span><span class="n">Made</span><span class="n">Left</span><span>Farm</span><span></span></div>' +
        r.ls.map(function(x){
          const p = x.p, i = x.i, sent = lineSent(o, p.id), pct = i.qty ? Math.round(i.made / i.qty * 100) : 0;
          return '<div class="cr-lt-r"><span class="cr-lt-p" data-l="Product"><b>' + esc(p.name || 'Untitled') + '</b><i class="cr-lt-bar"><i style="width:' + pct + '%"></i></i></span>' +
            '<span data-l="Colour">' + colourOf(p) + '</span>' +
            '<span class="n" data-l="Qty">' + i.qty + '</span><span class="n" data-l="Made">' + i.made + '</span><span class="n" data-l="Left">' + i.left + '</span>' +
            '<span data-l="Farm"><span class="cr-fs ' + i.st + '">' + esc(i.label) + '</span></span>' +
            '<span class="cr-lt-a"><button class="cr-btn" data-cr="line-wa" data-id="' + o.id + '" data-line="' + esc(p.id) + '" title="WhatsApp ' + esc(who(o)) + ' an update on ' + esc(p.name) + '">Send update</button>' +
              (sent ? '<span class="cr-dim-i">sent ' + ago(sent.t) + '</span>' : '') + '</span></div>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
    return h + '</div>';
  }

  // ---------- view ----------
  function pill(status, o){
    const map = { booked: 'Booked', in_production: 'In production', production_done: o && o.shippedDate ? 'Dispatched' : 'Ready', delivered: 'Delivered' };
    return '<span class="cr-pill ' + status + (o && o.shippedDate ? ' shipped' : '') + '">' + (map[status] || status) + '</span>';
  }
  function orderLink(o){ return '<a href="#" class="cr-ord" data-cr="open" data-id="' + o.id + '">' + esc(o.displayId || 'Order') + '</a>'; }
  function linkify(text){
    return esc(text).replace(/\bTT-\d+\b/gi, function(ref){
      const o = state.orders.find(function(x){ return (x.displayId || '').toLowerCase() === ref.toLowerCase(); });
      return o ? '<a href="#" class="cr-ord" data-cr="open" data-id="' + o.id + '">' + ref + '</a>' : ref;
    }).replace(/\n/g, '<br>');
  }

  function queueHtml(fc){
    const q = queue(), ps = prodStats();
    if(!q.length) return '<p class="cr-dim">Nothing booked or in production.</p>';
    const qc = queueClear(fc.hours);
    return '<p class="cr-dim">' + (qc ? 'Queue clears ≈ <b>' + fmtWhen(qc.at) + '</b> (' + Math.round(fc.hours) + ' h ÷ ' + qc.n + ' printers). ' : '') + Math.round(fc.hours) + ' print-hours queued' + (fc.cap ? ' ≈ ' + (Math.round(fc.days * 10) / 10) + ' days on ' + Math.round(fc.cap) + ' printer-hours a day' : ' — set printers and hours per day in Settings to forecast') + '.</p>' +
      '<div class="cr-q-scroll"><div class="cr-q-list">' + q.map(function(o){
        const pr = orderProgress(o), t = orderTotals(o), s = ps[o.id], due = target(o), fin = fc.finish[o.id], late = due && fin && fin > due;
        return '<div class="cr-q"><div class="cr-q-h">' + orderLink(o) + '<span class="cr-who">' + esc(who(o)) + '</span>' + pill(o.status, o) +
          (o.priority && o.priority !== 'normal' ? '<span class="cr-pill prio-' + o.priority + '">' + esc(priorityLabel(o.priority)) + '</span>' : '') + '</div>' +
          '<div class="cr-dim cr-q-n">' + esc(o.name || '') + '</div>' +
          '<div class="cr-bar"><i style="width:' + pr.pct + '%"></i></div>' +
          '<div class="cr-q-m"><span>' + pr.done + '/' + pr.total + ' pcs</span><span>' + Math.round(t.hours * 10) / 10 + ' h left</span>' +
            (s && s.printer_count ? '<span>' + s.printer_count + ' printer' + (s.printer_count === 1 ? '' : 's') + (s.printing_now ? ' · ' + s.printing_now + ' printing' : '') + '</span>' : '') +
            '<span class="' + (late ? 'cr-bad' : '') + '">' + (due ? 'due ' + fmt(due) : 'no date') + (fin ? ' · finish ≈ ' + fmt(fin) : '') + '</span></div>' +
          '<div class="cr-q-a">' + (o.status === 'booked' ? '<button class="cr-btn" data-cr="start" data-id="' + o.id + '">Start</button>' : '<button class="cr-btn primary" data-cr="done" data-id="' + o.id + '">Mark made</button>') + '</div></div>';
      }).join('') + '</div></div>';
  }
  function calendarHtml(){
    const t = today(), start = addDays(t, -((new Date(t + 'T00:00:00').getDay() + 6) % 7)), days = [];
    for(let i = 0; i < 14; i++) days.push(addDays(start, i));
    const by = {};
    state.orders.forEach(function(o){
      if(['quoted', 'lost', 'cancelled'].indexOf(o.status) !== -1) return;
      const d = o.shippedDate || (o.status === 'delivered' ? '' : target(o));
      if(d && d >= days[0] && d <= days[13]) (by[d] = by[d] || []).push(o);
    });
    const pk = {};
    ((window.TTPartners && window.TTPartners.pickups()) || []).forEach(function(x){ if(x.b.date >= days[0] && x.b.date <= days[13]) (pk[x.b.date] = pk[x.b.date] || []).push(x); });
    return '<div class="cr-cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function(n){ return '<div class="cr-cal-h">' + n + '</div>'; }).join('') +
      days.map(function(d){
        return '<div class="cr-day' + (d === t ? ' today' : '') + (d < t ? ' past' : '') + '"><div class="cr-day-n">' + new Date(d + 'T00:00:00').getDate() + '</div>' +
          (by[d] || []).map(function(o){
            const cls = o.shippedDate ? 'sent' : (d < t ? 'late' : o.status === 'production_done' ? 'ready' : 'plan');
            return '<a href="#" class="cr-ev ' + cls + '" data-cr="open" data-id="' + o.id + '" title="' + esc(who(o) + ' · ' + (o.name || '') + (o.courier ? ' · ' + o.courier : '')) + '">' + (o.shippedDate ? '✓ ' : '') + esc(o.displayId || '') + '</a>';
          }).join('') + (pk[d] || []).map(function(x){
            return '<span class="cr-ev pk" title="' + esc((x.p.name || 'Partner') + ' · ' + ((x.job && x.job.productName) || '') + (x.b.courier ? ' · ' + x.b.courier : '')) + '">🚚 ' + esc((x.job && x.job.jobCode) || 'pickup') + '</span>';
          }).join('') + '</div>';
      }).join('') + '</div><div class="cr-legend"><span class="cr-ev plan">planned</span><span class="cr-ev ready">ready</span><span class="cr-ev sent">✓ dispatched</span><span class="cr-ev late">late</span><span class="cr-ev pk">🚚 partner pickup</span></div>';
  }
  function problemsHtml(p){
    function list(title, rows, fn){ return rows.length ? '<div class="cr-prob"><b>' + title + ' <span class="cr-count">' + rows.length + '</span></b>' + rows.slice(0, 8).map(fn).join('') + '</div>' : ''; }
    const html = list('Overdue', p.overdue, function(x){ return '<div class="cr-pr">' + orderLink(x.o) + '<span>' + esc(who(x.o)) + '</span><span class="cr-bad">' + x.late + 'd late</span></div>'; }) +
      list('At risk', p.risk, function(x){ return '<div class="cr-pr">' + orderLink(x.o) + '<span>' + esc(who(x.o)) + '</span><span class="cr-warn">finish ≈ ' + fmt(x.finish) + ', due ' + fmt(target(x.o)) + '</span></div>'; });
      // Unpaid orders are money, not the floor: they are in Home → Needs you and Finance.
    return html || '<p class="cr-dim">Nothing overdue or at risk. 🎉</p>';
  }
  function appInbox(){
    const reqs = ((window.TTBuyers && window.TTBuyers.requests()) || []).filter(function(q){ return q.status === 'open'; });
    if(!window.TTBuyers) return '<p class="cr-dim">Open the Buyer App tab once to connect live messages.</p>';
    if(!reqs.length) return '<p class="cr-dim">No open messages, orders or claims from the Buyer app.</p>';
    return reqs.map(function(q){
      const p = q.payload || {}, name = window.TTBuyers.clientName(q.client_id);
      const what = q.kind === 'message' ? esc(p.text || '') : q.kind === 'claim' ? 'Problem with ' + esc(p.displayId || 'an order') + ' — ' + (p.lines || []).map(function(l){ return esc(l.name) + ' ×' + (+l.qty || 0); }).join(', ') :
        q.kind === 'order' ? 'Supply request · ' + (p.lines || []).reduce(function(t, l){ return t + (+l.qty || 0); }, 0) + ' pcs' : 'Details change';
      return '<div class="cr-msg"><div class="cr-msg-h"><b>' + esc(name) + '</b><span class="cr-tag ' + q.kind + '">' + q.kind + '</span><span class="cr-dim">' + new Date(q.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + '</span></div>' +
        '<div class="cr-msg-t">' + what + '</div>' +
        (q.kind === 'message' ? '<div class="cr-reply"><input data-crreply="' + q.id + '" placeholder="Reply…"><button class="cr-btn primary" data-cr="send" data-id="' + q.id + '">Send</button></div>'
          : '<button class="cr-btn" data-cr="buyertab">Handle in Buyer App tab</button>') + '</div>';
    }).join('');
  }
  function groupView(g){
    const team = teamSet(g), handled = chats().handled;
    if(V.filter === 'setup' || !g.team.length){
      const senders = {}; g.msgs.forEach(function(m){ senders[m.from] = (senders[m.from] || 0) + 1; });
      return '<p class="cr-dim">Tick who is from <b>Thread Tribe</b> in “' + esc(g.name) + '”, so the dashboard knows which customer messages are still unanswered.</p><div class="cr-senders">' +
        Object.keys(senders).sort(function(a, b){ return senders[b] - senders[a]; }).map(function(n){ return '<label><input type="checkbox" data-crteam="' + esc(n) + '"' + (team[n] ? ' checked' : '') + '> ' + esc(n) + ' <span class="cr-dim">' + senders[n] + '</span></label>'; }).join('') +
        '</div><button class="cr-btn primary" data-cr="team-done">Done</button>';
    }
    const filters = [['reply', 'Needs reply'], ['all', 'All'], ['order', 'Orders'], ['payment', 'Payments'], ['dispatch', 'Dispatch'], ['complaint', 'Complaints']];
    const nr = needsReply(g), nrIds = {}; nr.forEach(function(m){ nrIds[msgId(g, m)] = 1; });
    let msgs = V.filter === 'reply' ? nr : V.filter === 'all' ? g.msgs.slice(-80) : g.msgs.filter(function(m){ return tags(m.text).indexOf(V.filter) !== -1; }).slice(-60);
    msgs = msgs.slice().reverse();
    return '<div class="cr-filters">' + filters.map(function(f){ return '<button class="' + (V.filter === f[0] ? 'on' : '') + '" data-crf="' + f[0] + '">' + f[1] + (f[0] === 'reply' && nr.length ? ' · ' + nr.length : '') + '</button>'; }).join('') +
      '<span class="cr-dim">Imported ' + new Date(g.importedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' · <a href="#" data-cr="team">Team</a> · <a href="#" data-cr="del-group" data-id="' + g.id + '">Remove</a></span></div>' +
      (msgs.length ? msgs.map(function(m){
        const id = msgId(g, m), mine = team[m.from];
        return '<div class="cr-msg' + (mine ? ' mine' : '') + (nrIds[id] ? ' open' : '') + '"><div class="cr-msg-h"><b>' + esc(m.from) + '</b>' + tags(m.text).map(function(t){ return '<span class="cr-tag ' + t + '">' + t + '</span>'; }).join('') +
          '<span class="cr-dim">' + new Date(m.t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + '</span>' +
          (nrIds[id] ? '<button class="cr-btn" data-cr="handled" data-k="' + esc(id) + '">Mark handled</button>' : '') + '</div><div class="cr-msg-t">' + linkify(m.text) + '</div></div>';
      }).join('') : '<p class="cr-dim">' + (V.filter === 'reply' ? 'Nothing waiting — every customer question has a reply after it. 👍' : 'No messages here.') + '</p>') +
      '<p class="cr-dim" style="margin-top:8px">To refresh, export the chat again and import it — new messages are added, nothing is duplicated.</p>';
  }
  function chatsHtml(){
    const C = chats(), appOpen = ((window.TTBuyers && window.TTBuyers.requests()) || []).filter(function(q){ return q.status === 'open'; }).length;
    if(V.chat !== 'app' && V.chat !== 'week' && !C.groups.some(function(g){ return g.id === V.chat; })) V.chat = 'app';
    const quiet = weekClients().filter(function(w){ return w.quiet || w.waiting; }).length;
    const tabs = '<div class="cr-tabs"><button class="' + (V.chat === 'week' ? 'on' : '') + '" data-crchat="week">This week' + (quiet ? ' · ' + quiet : '') + '</button><button class="' + (V.chat === 'app' ? 'on' : '') + '" data-crchat="app">Buyer app' + (appOpen ? ' · ' + appOpen : '') + '</button>' +
      C.groups.map(function(g){ const n = g.team.length ? needsReply(g).length : 0; return '<button class="' + (V.chat === g.id ? 'on' : '') + '" data-crchat="' + g.id + '">💬 ' + esc(g.name) + (n ? ' · ' + n : '') + '</button>'; }).join('') +
      '<label class="cr-btn">' + (V.importing ? 'Importing…' : '+ Import WhatsApp chat') + '<input type="file" accept=".txt,.zip,text/plain,application/zip" id="crFile" hidden></label></div>';
    const g = C.groups.find(function(x){ return x.id === V.chat; });
    return tabs + (V.chat === 'week' ? weekHtml() : V.chat === 'app' ? appInbox() : groupView(g)) +
      (!C.groups.length ? '<p class="cr-dim" style="margin-top:10px"><b>WhatsApp groups:</b> in the group, tap ⋮ → More → <b>Export chat</b> → Without media, save the file, then import it here. The dashboard sorts messages into orders, payments, dispatch and complaints, links TT-numbers to orders and flags questions no one from Thread Tribe has answered.</p>' : '');
  }

  function render(){
    const root = document.getElementById('controlRoot');
    if(!root) return;
    const fc = forecast(), p = problems();
    const weekEnd = addDays(today(), 7);
    const dueWeek = state.orders.filter(function(o){ const d = target(o); return d && d >= today() && d <= weekEnd && o.status !== 'delivered' && !o.shippedDate && ['quoted', 'lost', 'cancelled'].indexOf(o.status) === -1; }).length;
    root.innerHTML =
      '<div class="cr-kpis">' +
        '<div class="cr-kpi"><div class="k">In production</div><div class="v">' + state.orders.filter(function(o){ return o.status === 'in_production'; }).length + '</div><div class="s">' + state.orders.filter(function(o){ return o.status === 'booked'; }).length + ' booked next</div></div>' +
        '<div class="cr-kpi"><div class="k">Print hours queued</div><div class="v">' + Math.round(fc.hours) + '</div><div class="s">' + (fc.cap ? '≈ ' + Math.ceil(fc.days) + ' day' + (Math.ceil(fc.days) === 1 ? '' : 's') : 'set capacity') + '</div></div>' +
        (function(){ const qc = queueClear(fc.hours);
          return '<div class="cr-kpi" title="Queue time ÷ printers running: ' + Math.round(fc.hours) + ' h ÷ ' + (qc ? qc.n : 0) + ' = ' + (qc ? Math.round(qc.each * 10) / 10 : 0) + ' h on each printer, from now"><div class="k">Queue clear date</div><div class="v">' +
            (!fc.hours ? 'Clear' : qc ? fmt(iso(qc.at)) : '—') + '</div><div class="s">' + (!fc.hours ? 'nothing queued' : qc ? Math.round(fc.hours) + ' h ÷ ' + qc.n + ' printers = ' + (Math.round(qc.each * 10) / 10) + ' h' : 'add printers in Settings') + '</div></div>'; })() +
        '<div class="cr-kpi"><div class="k">Due in 7 days</div><div class="v">' + dueWeek + '</div><div class="s">to dispatch</div></div>' +
        '<div class="cr-kpi ' + (p.overdue.length + p.risk.length ? 'bad' : '') + '"><div class="k">Late or at risk</div><div class="v">' + (p.overdue.length + p.risk.length) + '</div><div class="s">' + p.overdue.length + ' overdue</div></div>' +
      '</div>' +
      '<div class="panel"><div class="panel-title">Dispatch calendar · 2 weeks</div>' + calendarHtml() + '</div>' +
      // "Order lines on the floor" hidden for now (2026-10-24); linesHtml() is kept so it can return.
      promiseHtml() +
      // The queue matches the height of Needs attention and scrolls inside, so the page has no gap.
      '<div class="cr-grid">' +
        '<div class="panel cr-qp"><div class="panel-title">Production queue</div>' + queueHtml(fc) + '</div>' +
        '<div class="panel"><div class="panel-title">Needs attention</div>' + problemsHtml(p) + '</div>' +
      '</div>';
  }
  window.renderControlRoom = function(){ render(); if(window.TTPartners) window.TTPartners.load().then(render).catch(function(){}); if(window.TTBuyers) window.TTBuyers.refresh().then(render).catch(function(){}); };
  setInterval(function(){
    const t = document.getElementById('tabControl');
    if(t && t.style.display !== 'none' && !(document.activeElement && t.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render();
  }, 30000);

  document.addEventListener('click', function(e){
    const tab = document.getElementById('tabControl');
    if(!tab || !tab.contains(e.target)) return;
    const lf = e.target.closest('[data-crlf]'); if(lf){ V.lf = lf.getAttribute('data-crlf'); render(); return; }
    const f = e.target.closest('[data-crf]'); if(f){ V.filter = f.getAttribute('data-crf'); render(); return; }
    const c = e.target.closest('[data-crchat]'); if(c){ V.chat = c.getAttribute('data-crchat'); V.filter = 'reply'; render(); return; }
    const b = e.target.closest('[data-cr]'); if(!b) return;
    const act = b.getAttribute('data-cr'), id = b.getAttribute('data-id');
    if(b.tagName === 'A') e.preventDefault();
    if(act === 'pl-add'){ P.lines.push({ id: '', qty: 0 }); render(); return; }
    if(act === 'pl-del'){ P.lines.splice(+b.getAttribute('data-i'), 1); render(); return; }
    if(act === 'p-copy' || act === 'p-wa'){
      const msg = (document.getElementById('crPromiseMsg') || {}).value || '';
      if(act === 'p-wa') window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
      else (navigator.clipboard ? navigator.clipboard.writeText(msg) : Promise.reject()).then(function(){ showToast('Message copied'); }).catch(function(){ prompt('Copy:', msg); });
      return;
    }
    if(act === 'open'){ const i = state.orders.findIndex(function(o){ return o.id === id; }); if(i !== -1) openOrderDetailModal(id, i); }
    else if(act === 'start'){ setOrderStatusDirect(id, 'in_production'); setTimeout(render, 300); }
    else if(act === 'done'){ setOrderStatusDirect(id, 'production_done'); setTimeout(render, 300); }
    else if(act === 'buyertab'){ const t = document.querySelector('.tab-btn[data-tab="buyers"]'); if(t) t.click(); }
    else if(act === 'send'){
      const inp = tab.querySelector('[data-crreply="' + id + '"]'), txt = inp ? inp.value.trim() : '';
      if(!txt) return;
      window.TTBuyers.reply(id, 'done', txt).then(function(ok){ if(ok){ showToast('Reply sent'); render(); } });
    }
    else if(act === 'wa') sendWa(id, b.getAttribute('data-k'));
    else if(act === 'line-wa') sendLine(id, b.getAttribute('data-line'));
    else if(act === 'handled'){ chats().handled[b.getAttribute('data-k')] = 1; scheduleSave(); render(); }
    else if(act === 'team'){ V.filter = 'setup'; render(); }
    else if(act === 'team-done'){ V.filter = 'reply'; render(); }
    else if(act === 'del-group'){ if(confirm('Remove this imported chat from the dashboard?')){ chats().groups = chats().groups.filter(function(g){ return g.id !== id; }); scheduleSave(); render(); } }
  });
  // Calculator inputs: recompute on every keystroke without re-rendering the form.
  function onPromiseInput(e){
    const t = e.target;
    if(!t.closest || !t.closest('.cr-promise')) return false;
    if(t.hasAttribute('data-pp')){
      const k = t.getAttribute('data-pp'), i = t.getAttribute('data-i');
      if(i !== null){ P.lines[+i][k] = k === 'qty' ? (+t.value || 0) : t.value; }
      else if(k === 'rush') P.rush = +t.value || 0;
      else if(k === 'partners') P.partners = t.checked;
      else P[k] = t.value;
      refreshPromise(); return true;
    }
    if(t.hasAttribute('data-ps')){
      const st = pset(); st[t.getAttribute('data-ps')] = Math.max(0, +t.value || 0);
      state.promiseSettings = st; scheduleSave(); refreshPromise(); return true;
    }
    return false;
  }
  document.addEventListener('input', onPromiseInput);
  // Order-lines search: re-render, then put the cursor back where it was.
  document.addEventListener('input', function(e){
    if(!e.target.hasAttribute || !e.target.hasAttribute('data-crlq')) return;
    V.lq = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const inp = document.querySelector('#tabControl [data-crlq]');
    if(inp){ inp.focus(); try{ inp.setSelectionRange(pos, pos); }catch(err){} }
  });
  document.addEventListener('change', function(e){
    const lk = e.target.closest && e.target.closest('[data-crlink]');
    if(lk){ const g = chats().groups.find(function(x){ return x.id === lk.value; }); if(g){ g.clientKey = lk.getAttribute('data-crlink'); scheduleSave(); render(); } return; }
    if(onPromiseInput(e)) return;
    if(e.target.id === 'crFile' && e.target.files && e.target.files[0]){ importChat(e.target.files[0]); e.target.value = ''; return; }
    const tm = e.target.closest && e.target.closest('[data-crteam]');
    if(tm){
      const g = chats().groups.find(function(x){ return x.id === V.chat; }); if(!g) return;
      const n = tm.getAttribute('data-crteam');
      g.team = (g.team || []).filter(function(x){ return x !== n; }); if(tm.checked) g.team.push(n);
      scheduleSave();
    }
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && e.target.hasAttribute && e.target.hasAttribute('data-crreply')){ const btn = e.target.parentNode.querySelector('[data-cr="send"]'); if(btn) btn.click(); }
  });

  const css = document.createElement('style');
  css.textContent =
    '#tabControl .cr-dim{color:var(--dim);font-size:12px;margin:2px 0 8px}' +
    '#tabControl .cr-dim-i{color:var(--dim);font-size:12px}' +
    '#tabControl .cr-lines-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}' +
    '#tabControl .cr-lines-q{flex:0 1 300px;min-width:0;border-radius:9px;min-height:36px;font-size:13px}' +
    '#tabControl .cr-lines-f{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}' +
    '#tabControl .cr-lines-f button{background:transparent;border:1px solid var(--line);border-radius:999px;padding:5px 12px;font:12.5px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer}' +
    '#tabControl .cr-lines-f button b{font-weight:600;color:var(--dim);margin-left:3px}' +
    '#tabControl .cr-lines-f button.on{border-color:var(--cyan);background:rgba(79,209,197,.12)}' +
    '#tabControl .cr-lines-list{max-height:560px;overflow-y:auto;padding-right:4px;overscroll-behavior:contain}' +
    '#tabControl .cr-lines-list .cr-lo:last-child{margin-bottom:0}' +
    '@media (max-width:760px){#tabControl .cr-lines-list{max-height:70vh}}' +
    '#tabControl .cr-lo{border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}' +
    '#tabControl .cr-lo-h{display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:var(--input-bg);font-size:13.5px}' +
    '#tabControl .cr-lo-a{margin-left:auto;display:flex;gap:8px;align-items:center}' +
    '#tabControl .cr-lt-r{display:grid;grid-template-columns:minmax(140px,2fr) minmax(110px,1.3fr) 48px 52px 48px minmax(130px,1.3fr) auto;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid var(--line);font-size:13px}' +
    '#tabControl .cr-lt-th{font:10.5px "JetBrains Mono",monospace;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);border-top:none;padding-top:8px;padding-bottom:6px}' +
    '#tabControl .cr-lt-r .n{text-align:right;font-family:"JetBrains Mono",monospace;font-variant-numeric:tabular-nums}' +
    '#tabControl .cr-lt-p{display:flex;flex-direction:column;gap:5px;min-width:0}' +
    '#tabControl .cr-lt-p b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#tabControl .cr-lt-bar{display:block;height:4px;border-radius:2px;background:var(--line);overflow:hidden;max-width:160px}' +
    '#tabControl .cr-lt-bar i{display:block;height:100%;background:var(--green);border-radius:2px}' +
    '#tabControl .cr-sw{display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid rgba(0,0,0,.15);vertical-align:-2px;margin-right:6px}' +
    '#tabControl .cr-fs{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-size:12px;border:1px solid var(--line);color:var(--dim);white-space:nowrap}' +
    '#tabControl .cr-fs::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}' +
    '#tabControl .cr-fs.none{color:var(--red);border-color:rgba(232,97,90,.45)}' +
    '#tabControl .cr-fs.queued{color:var(--amber);border-color:rgba(240,168,60,.5)}' +
    '#tabControl .cr-fs.printing{color:var(--cyan);border-color:rgba(79,209,197,.55)}' +
    '#tabControl .cr-fs.done{color:var(--green);border-color:rgba(126,208,138,.55)}' +
    '#tabControl .cr-lt-a{display:flex;flex-direction:column;align-items:flex-end;gap:3px}' +
    '@media (max-width:760px){' +
      '#tabControl .cr-lt-th{display:none}' +
      '#tabControl .cr-lt-r{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px 10px}' +
      '#tabControl .cr-lt-p{grid-column:1/-1}' +
      '#tabControl .cr-lt-r > span[data-l="Colour"],#tabControl .cr-lt-r > span[data-l="Farm"]{grid-column:span 3}' +
      '#tabControl .cr-lt-r .n{text-align:left}' +
      '#tabControl .cr-lt-r .n::before{content:attr(data-l) " ";color:var(--dim);font-size:11px}' +
      '#tabControl .cr-lt-a{grid-column:1/-1;flex-direction:row;align-items:center;justify-content:space-between}' +
      '#tabControl .cr-lo-a{margin-left:0;width:100%;justify-content:space-between}' +
    '}' +
    '#tabControl .cr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin-bottom:14px}' +
    '#tabControl .cr-kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}' +
    '#tabControl .cr-kpi .k{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}' +
    '#tabControl .cr-kpi .v{font-size:24px;font-weight:700;margin-top:2px}' +
    '#tabControl .cr-kpi .s{font-size:11px;color:var(--dim)}' +
    '#tabControl .cr-kpi.bad .v{color:var(--red)} #tabControl .cr-kpi.warn .v{color:var(--amber)}' +
    '#tabControl .cr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px;align-items:stretch}' +
    '#tabControl .cr-grid > .panel{margin-bottom:0}' +
    '#tabControl .cr-qp{display:flex;flex-direction:column}' +
    '#tabControl .cr-q-scroll{flex:1;position:relative;min-height:190px}' +
    '#tabControl .cr-q-list{position:absolute;inset:0;overflow-y:auto;padding-right:4px}' +
    '@media (max-width:820px){#tabControl .cr-q-scroll{min-height:0}#tabControl .cr-q-list{position:static;max-height:460px}}' +
    '#tabControl .cr-q{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}' +
    '#tabControl .cr-q-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '#tabControl .cr-who{font-weight:600;font-size:13px}' +
    '#tabControl .cr-q-n{margin:2px 0 6px}' +
    '#tabControl .cr-bar{height:6px;background:var(--input-bg);border-radius:4px;overflow:hidden}' +
    '#tabControl .cr-bar i{display:block;height:100%;background:var(--cyan)}' +
    '#tabControl .cr-q-m{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--dim);margin-top:6px}' +
    '#tabControl .cr-q-a{margin-top:6px}' +
    '#tabControl .cr-bad{color:var(--red)!important;font-weight:600} #tabControl .cr-warn{color:var(--amber);font-weight:600}' +
    '#tabControl .cr-pill{border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:11px;color:var(--dim)}' +
    '#tabControl .cr-pill.in_production{color:var(--cyan);border-color:var(--cyan)} #tabControl .cr-pill.production_done{color:var(--green);border-color:var(--green)}' +
    '#tabControl .cr-pill.prio-urgent{color:var(--red);border-color:var(--red)} #tabControl .cr-pill.prio-high{color:var(--amber);border-color:var(--amber)}' +
    '#tabControl .cr-ord{color:var(--cyan);font-weight:700;text-decoration:none}' +
    '#tabControl .cr-btn{display:inline-block;background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 11px;font:12px "JetBrains Mono",monospace;cursor:pointer;margin:2px 4px 2px 0}' +
    '#tabControl .cr-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#0d1117;font-weight:600}' +
    '#tabControl .cr-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}' +
    '#tabControl .cr-cal-h{font-size:10.5px;color:var(--dim);text-align:center;text-transform:uppercase}' +
    '#tabControl .cr-day{min-height:62px;border:1px solid var(--line);border-radius:8px;padding:4px;display:flex;flex-direction:column;gap:3px}' +
    '#tabControl .cr-day.today{border-color:var(--cyan)} #tabControl .cr-day.past{opacity:.6}' +
    '#tabControl .cr-day-n{font-size:11px;color:var(--dim)}' +
    '#tabControl .cr-ev{display:block;font-size:10.5px;font-weight:700;border-radius:5px;padding:1px 4px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#tabControl .cr-ev.plan{background:color-mix(in srgb,var(--cyan) 18%,transparent);color:var(--cyan)}' +
    '#tabControl .cr-ev.ready{background:color-mix(in srgb,var(--green) 20%,transparent);color:var(--green)}' +
    '#tabControl .cr-ev.sent{background:var(--input-bg);color:var(--dim)}' +
    '#tabControl .cr-ev.late{background:color-mix(in srgb,var(--red) 18%,transparent);color:var(--red)}' +
    '#tabControl .cr-legend{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}' +
    '#tabControl .cr-prob{margin-bottom:10px} #tabControl .cr-count{color:var(--dim);font-weight:400}' +
    '#tabControl .cr-pr{display:flex;gap:10px;align-items:center;font-size:12.5px;padding:5px 0;border-bottom:1px dashed var(--line)} #tabControl .cr-pr span:nth-child(2){flex:1}' +
    '#tabControl .cr-tabs,#tabControl .cr-filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}' +
    '#tabControl .cr-tabs button,#tabControl .cr-filters button{background:transparent;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font:12px "JetBrains Mono",monospace;cursor:pointer}' +
    '#tabControl .cr-tabs button.on,#tabControl .cr-filters button.on{border-color:var(--cyan);color:var(--cyan)}' +
    '#tabControl .cr-filters .cr-dim{margin:0 0 0 auto}' +
    '#tabControl .cr-msg{border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:6px}' +
    '#tabControl .cr-msg.open{border-color:var(--amber)} #tabControl .cr-msg.mine{background:var(--input-bg)}' +
    '#tabControl .cr-msg-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px}' +
    '#tabControl .cr-msg-h .cr-dim{margin:0}' +
    '#tabControl .cr-msg-t{font-size:13px;margin-top:4px;line-height:1.45}' +
    '#tabControl .cr-tag{font-size:10.5px;border-radius:999px;padding:1px 7px;background:var(--input-bg);color:var(--dim)}' +
    '#tabControl .cr-tag.payment{color:var(--green)} #tabControl .cr-tag.complaint,#tabControl .cr-tag.claim{color:var(--red)} #tabControl .cr-tag.dispatch{color:var(--cyan)} #tabControl .cr-tag.order{color:var(--amber)}' +
    '#tabControl .cr-reply{display:flex;gap:6px;margin-top:6px} #tabControl .cr-reply input{flex:1;background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:13px inherit}' +
    '#tabControl .cr-wk{border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:8px} #tabControl .cr-wk.open{border-color:var(--amber)}' +
    '#tabControl .cr-wk-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;margin-bottom:4px} #tabControl .cr-wk-h .cr-dim{margin:0}' +
    '#tabControl .cr-wk-o{display:flex;gap:6px 10px;align-items:center;flex-wrap:wrap;font-size:12.5px;padding:5px 0;border-top:1px dashed var(--line)} #tabControl .cr-wk-o .cr-dim{margin:0}' +
    '#tabControl .cr-wk-a{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}' +
    '#tabControl .cr-btn[disabled]{opacity:.45;cursor:not-allowed}' +
    '#tabControl .cr-link{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:4px 6px;font-size:12px}' +
    '#tabControl .cr-senders{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0 12px;font-size:13px}' +
    '#tabControl .cr-promise{border:1px solid var(--cyan)}' +
    '#tabControl .cr-pl-row{display:flex;gap:6px;margin-bottom:6px} #tabControl .cr-pl-row select{flex:1;min-width:0}' +
    '#tabControl .cr-pl-row input{width:90px}' +
    '#tabControl .cr-promise select,#tabControl .cr-promise input,#tabControl .cr-promise textarea{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:13px inherit}' +
    '#tabControl .cr-pf{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin:10px 0}' +
    '#tabControl .cr-pf label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--dim)}' +
    '#tabControl .cr-note{padding:12px;border:1px dashed var(--line);border-radius:10px;color:var(--dim);font-size:13px}' +
    '#tabControl .cr-res{border:1px solid var(--line);border-radius:12px;padding:12px 14px}' +
    '#tabControl .cr-res.ok{border-color:var(--green)} #tabControl .cr-res.warn{border-color:var(--amber)} #tabControl .cr-res.bad{border-color:var(--red)}' +
    '#tabControl .cr-verdict{font-size:16px;font-weight:700;margin-bottom:8px}' +
    '#tabControl .cr-res.ok .cr-verdict{color:var(--green)} #tabControl .cr-res.warn .cr-verdict{color:var(--amber)} #tabControl .cr-res.bad .cr-verdict{color:var(--red)}' +
    '#tabControl .cr-dates{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}' +
    '#tabControl .cr-dates div{background:var(--input-bg);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column}' +
    '#tabControl .cr-dates span{font-size:11px;color:var(--dim)} #tabControl .cr-dates b{font-size:16px;margin-top:2px}' +
    '#tabControl .cr-dates div:first-child b{color:var(--cyan)}' +
    '#tabControl .cr-tips{margin:8px 0 0 18px;font-size:13px}' +
    '#tabControl .cr-msgbox{margin-top:10px;display:flex;flex-direction:column;gap:6px} #tabControl .cr-msgbox textarea{width:100%;resize:vertical}' +
    '#tabControl .cr-pset{margin-top:8px}' +
    '#tabControl .cr-ev.pk{background:color-mix(in srgb,var(--amber) 18%,transparent);color:var(--amber)}' +
    '#tabControl .cr-chk{flex-direction:row!important;align-items:center;gap:6px!important;color:var(--text)!important;font-size:12.5px!important}' +
    '#tabControl .cr-impact{margin-top:12px;border-top:1px dashed var(--line);padding-top:10px}' +
    '#tabControl .cr-impact-h{display:flex;flex-direction:column;gap:2px;margin-bottom:6px} #tabControl .cr-impact-h .cr-dim{margin:0}' +
    '#tabControl .cr-it{width:100%;border-collapse:collapse;font-size:12.5px}' +
    '#tabControl .cr-it th,#tabControl .cr-it td{text-align:left;padding:5px 6px;border-top:1px solid var(--line);white-space:nowrap}' +
    '#tabControl .cr-it th{color:var(--dim);font-weight:500;font-size:11px}' +
    '@media (max-width:700px){#tabControl .cr-grid{grid-template-columns:1fr} #tabControl .cr-day{min-height:48px} #tabControl .cr-kpi{padding:9px 10px} #tabControl .cr-kpi .v{font-size:20px} #tabControl .cr-kpi .k{font-size:9.5px}}';
  document.head.appendChild(css);
})();
