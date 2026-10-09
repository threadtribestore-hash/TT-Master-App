// ===================================================================
// ======================= CONTROL ROOM (Studio) =====================
// ===================================================================
// One screen for running the day: the production queue, delivery dates
// (a two-week dispatch calendar plus overdue / at-risk / unpaid lists) and
// customer chats — live messages from the Buyer app, and WhatsApp group
// chats imported from WhatsApp's "Export chat" file.
//
// WhatsApp groups can't be read live: Meta's Groups API needs an Official
// Business Account and only covers groups created through the API, and
// WhatsApp Web scrapers risk a ban. So group chats come in as exports and
// are kept (last 45 days) in state.waChats, synced like any other setting.
(function(){
  if(window.TT_STOCK_MODE) return;

  const OPEN = ['booked', 'in_production'];
  const PRIORITY = { urgent: 0, high: 1, normal: 2, low: 3 };
  const KEEP_DAYS = 45, KEEP_MSGS = 3000;
  const V = { chat: 'app', filter: 'reply', importing: false };

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
  const P = { lines: [{ id: '', qty: 0 }], hours: '', need: '', rush: 0, customer: '' };
  function pset(){ return Object.assign({ packDays: 1, transitDays: 3, safetyPct: 15 }, state.promiseSettings || {}); }
  function fleet(){
    const running = (state.printers || []).filter(function(p){ return p.status !== 'down'; }).length || (state.fleet && state.fleet.printers) || 0;
    const hpd = (state.fleet && state.fleet.hoursPerDay) || 0;
    const reserved = queue().reduce(function(t, o){ return t + (o.reservedPrinters || 0); }, 0);
    return { running: running, hpd: hpd, cap: running * hpd, free: Math.max(0, running - reserved) };
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
    // Who a rush would push past their own date.
    if(k > 0 && delay > 0){
      r.hurt = queue().filter(function(o){
        const due = target(o), fin = fc.finish[o.id];
        return due && fin && fin <= due && addDays(fin, Math.ceil(delay)) > due;
      });
    }
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
      '<label>Customer (for the message)<input data-pp="customer" value="' + esc(P.customer) + '" placeholder="e.g. Anand"></label></div>' +
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
        (r.k ? ' on ' + r.k + ' dedicated printer' + (r.k === 1 ? '' : 's') : ' after ' + Math.round(r.queued) + ' h already queued, on ' + r.F.running + ' printers × ' + r.F.hpd + ' h/day') + '.</div>';
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
    if(r.k){
      html += '<div class="' + (r.hurt && r.hurt.length ? 'cr-warn' : 'cr-dim') + '" style="margin-top:6px">Rushing slows the rest of the queue by about ' + (Math.round(r.delay * 10) / 10) + ' days' +
        (r.hurt && r.hurt.length ? ' — these would then miss their dates: ' + r.hurt.map(function(o){ return esc(o.displayId) + ' (' + esc(who(o)) + ')'; }).join(', ') : ', and no order misses its date') + '.</div>';
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
    return '<p class="cr-dim">' + Math.round(fc.hours) + ' print-hours queued' + (fc.cap ? ' ≈ ' + (Math.round(fc.days * 10) / 10) + ' days on ' + Math.round(fc.cap) + ' printer-hours a day' : ' — set printers and hours per day in Settings to forecast') + '.</p>' +
      q.map(function(o){
        const pr = orderProgress(o), t = orderTotals(o), s = ps[o.id], due = target(o), fin = fc.finish[o.id], late = due && fin && fin > due;
        return '<div class="cr-q"><div class="cr-q-h">' + orderLink(o) + '<span class="cr-who">' + esc(who(o)) + '</span>' + pill(o.status, o) +
          (o.priority && o.priority !== 'normal' ? '<span class="cr-pill prio-' + o.priority + '">' + esc(priorityLabel(o.priority)) + '</span>' : '') + '</div>' +
          '<div class="cr-dim cr-q-n">' + esc(o.name || '') + '</div>' +
          '<div class="cr-bar"><i style="width:' + pr.pct + '%"></i></div>' +
          '<div class="cr-q-m"><span>' + pr.done + '/' + pr.total + ' pcs</span><span>' + Math.round(t.hours * 10) / 10 + ' h left</span>' +
            (s && s.printer_count ? '<span>' + s.printer_count + ' printer' + (s.printer_count === 1 ? '' : 's') + (s.printing_now ? ' · ' + s.printing_now + ' printing' : '') + '</span>' : '') +
            '<span class="' + (late ? 'cr-bad' : '') + '">' + (due ? 'due ' + fmt(due) : 'no date') + (fin ? ' · finish ≈ ' + fmt(fin) : '') + '</span></div>' +
          '<div class="cr-q-a">' + (o.status === 'booked' ? '<button class="cr-btn" data-cr="start" data-id="' + o.id + '">Start</button>' : '<button class="cr-btn primary" data-cr="done" data-id="' + o.id + '">Mark made</button>') + '</div></div>';
      }).join('');
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
    return '<div class="cr-cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function(n){ return '<div class="cr-cal-h">' + n + '</div>'; }).join('') +
      days.map(function(d){
        return '<div class="cr-day' + (d === t ? ' today' : '') + (d < t ? ' past' : '') + '"><div class="cr-day-n">' + new Date(d + 'T00:00:00').getDate() + '</div>' +
          (by[d] || []).map(function(o){
            const cls = o.shippedDate ? 'sent' : (d < t ? 'late' : o.status === 'production_done' ? 'ready' : 'plan');
            return '<a href="#" class="cr-ev ' + cls + '" data-cr="open" data-id="' + o.id + '" title="' + esc(who(o) + ' · ' + (o.name || '') + (o.courier ? ' · ' + o.courier : '')) + '">' + (o.shippedDate ? '✓ ' : '') + esc(o.displayId || '') + '</a>';
          }).join('') + '</div>';
      }).join('') + '</div><div class="cr-legend"><span class="cr-ev plan">planned</span><span class="cr-ev ready">ready</span><span class="cr-ev sent">✓ dispatched</span><span class="cr-ev late">late</span></div>';
  }
  function problemsHtml(p){
    function list(title, rows, fn){ return rows.length ? '<div class="cr-prob"><b>' + title + ' <span class="cr-count">' + rows.length + '</span></b>' + rows.slice(0, 8).map(fn).join('') + '</div>' : ''; }
    const html = list('Overdue', p.overdue, function(x){ return '<div class="cr-pr">' + orderLink(x.o) + '<span>' + esc(who(x.o)) + '</span><span class="cr-bad">' + x.late + 'd late</span></div>'; }) +
      list('At risk', p.risk, function(x){ return '<div class="cr-pr">' + orderLink(x.o) + '<span>' + esc(who(x.o)) + '</span><span class="cr-warn">finish ≈ ' + fmt(x.finish) + ', due ' + fmt(target(x.o)) + '</span></div>'; }) +
      list('Waiting for payment', p.unpaid, function(x){ return '<div class="cr-pr">' + orderLink(x.o) + '<span>' + esc(who(x.o)) + '</span><span class="cr-warn">' + money(x.due) + ' · ' + x.days + 'd</span></div>'; });
    return html || '<p class="cr-dim">Nothing overdue, at risk or unpaid. 🎉</p>';
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
    if(V.chat !== 'app' && !C.groups.some(function(g){ return g.id === V.chat; })) V.chat = 'app';
    const tabs = '<div class="cr-tabs"><button class="' + (V.chat === 'app' ? 'on' : '') + '" data-crchat="app">Buyer app' + (appOpen ? ' · ' + appOpen : '') + '</button>' +
      C.groups.map(function(g){ const n = g.team.length ? needsReply(g).length : 0; return '<button class="' + (V.chat === g.id ? 'on' : '') + '" data-crchat="' + g.id + '">💬 ' + esc(g.name) + (n ? ' · ' + n : '') + '</button>'; }).join('') +
      '<label class="cr-btn">' + (V.importing ? 'Importing…' : '+ Import WhatsApp chat') + '<input type="file" accept=".txt,.zip,text/plain,application/zip" id="crFile" hidden></label></div>';
    const g = C.groups.find(function(x){ return x.id === V.chat; });
    return tabs + (V.chat === 'app' ? appInbox() : groupView(g)) +
      (!C.groups.length ? '<p class="cr-dim" style="margin-top:10px"><b>WhatsApp groups:</b> in the group, tap ⋮ → More → <b>Export chat</b> → Without media, save the file, then import it here. The dashboard sorts messages into orders, payments, dispatch and complaints, links TT-numbers to orders and flags questions no one from Thread Tribe has answered.</p>' : '');
  }

  function render(){
    const root = document.getElementById('controlRoot');
    if(!root) return;
    const fc = forecast(), p = problems(), C = chats();
    const waiting = C.groups.reduce(function(t, g){ return t + (g.team.length ? needsReply(g).length : 0); }, 0) +
      ((window.TTBuyers && window.TTBuyers.requests()) || []).filter(function(q){ return q.status === 'open'; }).length;
    const weekEnd = addDays(today(), 7);
    const dueWeek = state.orders.filter(function(o){ const d = target(o); return d && d >= today() && d <= weekEnd && o.status !== 'delivered' && !o.shippedDate && ['quoted', 'lost', 'cancelled'].indexOf(o.status) === -1; }).length;
    root.innerHTML =
      '<div class="cr-kpis">' +
        '<div class="cr-kpi"><div class="k">In production</div><div class="v">' + state.orders.filter(function(o){ return o.status === 'in_production'; }).length + '</div><div class="s">' + state.orders.filter(function(o){ return o.status === 'booked'; }).length + ' booked next</div></div>' +
        '<div class="cr-kpi"><div class="k">Print hours queued</div><div class="v">' + Math.round(fc.hours) + '</div><div class="s">' + (fc.cap ? '≈ ' + Math.ceil(fc.days) + ' day' + (Math.ceil(fc.days) === 1 ? '' : 's') : 'set capacity') + '</div></div>' +
        '<div class="cr-kpi"><div class="k">Due in 7 days</div><div class="v">' + dueWeek + '</div><div class="s">to dispatch</div></div>' +
        '<div class="cr-kpi ' + (p.overdue.length + p.risk.length ? 'bad' : '') + '"><div class="k">Late or at risk</div><div class="v">' + (p.overdue.length + p.risk.length) + '</div><div class="s">' + p.overdue.length + ' overdue</div></div>' +
        '<div class="cr-kpi ' + (waiting ? 'warn' : '') + '"><div class="k">Chats waiting</div><div class="v">' + waiting + '</div><div class="s">need a reply</div></div>' +
      '</div>' +
      promiseHtml() +
      '<div class="cr-grid">' +
        '<div class="panel"><div class="panel-title">Production queue</div>' + queueHtml(fc) + '</div>' +
        '<div><div class="panel"><div class="panel-title">Dispatch calendar · 2 weeks</div>' + calendarHtml() + '</div>' +
        '<div class="panel"><div class="panel-title">Needs attention</div>' + problemsHtml(p) + '</div></div>' +
      '</div>' +
      '<div class="panel"><div class="panel-title">Customer chats</div>' + chatsHtml() + '</div>';
  }
  window.renderControlRoom = function(){ render(); if(window.TTBuyers) window.TTBuyers.refresh().then(render).catch(function(){}); };
  setInterval(function(){
    const t = document.getElementById('tabControl');
    if(t && t.style.display !== 'none' && !(document.activeElement && t.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render();
  }, 30000);

  document.addEventListener('click', function(e){
    const tab = document.getElementById('tabControl');
    if(!tab || !tab.contains(e.target)) return;
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
  document.addEventListener('change', function(e){
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
    '#tabControl .cr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin-bottom:14px}' +
    '#tabControl .cr-kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}' +
    '#tabControl .cr-kpi .k{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}' +
    '#tabControl .cr-kpi .v{font-size:24px;font-weight:700;margin-top:2px}' +
    '#tabControl .cr-kpi .s{font-size:11px;color:var(--dim)}' +
    '#tabControl .cr-kpi.bad .v{color:var(--red)} #tabControl .cr-kpi.warn .v{color:var(--amber)}' +
    '#tabControl .cr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px;align-items:start}' +
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
    '@media (max-width:700px){#tabControl .cr-grid{grid-template-columns:1fr} #tabControl .cr-day{min-height:48px} #tabControl .cr-kpi{padding:9px 10px} #tabControl .cr-kpi .v{font-size:20px} #tabControl .cr-kpi .k{font-size:9.5px}}';
  document.head.appendChild(css);
})();
