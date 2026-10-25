// ===================================================================
// ======================== PRODUCT LAB (Studio) =====================
// ===================================================================
// Decide what to keep, fix, reprice, retire and make next.
//   Scorecard     every product: units and revenue (90 days) and trend, average price, cost per
//                 piece (Studio's own filament + machine cost with the failure buffer), margin per
//                 print-hour, failure rate (order lines + the farm), reorder rate, claims, verdict.
//   Make next     demand signals: brand-partner messages and order notes asking for something,
//                 why quotes were lost, quality claims, what similar clients buy (Upsell), colours.
//   New products  Idea, Spec, Prototype, Test batch, Pricing, Launched. Pricing follows the rate card
//                 (toys Rs 4/g; lamps Rs 300 up to 100 g, then Rs 3.5/g). Launch adds the product to
//                 the catalogue, a launch campaign in Marketing and a shoot task.
// Ideas sync as their own rows (state.lab.ideas).
(function(){
  if(window.TT_STOCK_MODE) return;

  const STAGES = [['idea', 'Idea'], ['spec', 'Spec'], ['prototype', 'Prototype'], ['test', 'Test batch'], ['pricing', 'Pricing'], ['launched', 'Launched'], ['dropped', 'Dropped']];
  const DAY = 86400000;
  const V = { view: 'score', sort: 'revenue', dir: -1, verdict: '' };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function daysAgo(n){ return iso(new Date(Date.now() - n * DAY)); }
  function key(s){ return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function lab(){ if(!state.lab || typeof state.lab !== 'object') state.lab = {}; if(!Array.isArray(state.lab.ideas)) state.lab.ideas = []; return state.lab; }
  function counts(o){ return ['quoted', 'lost', 'cancelled', 'returned'].indexOf(o.status) === -1; }
  function orderDay(o){ return o.orderedDate || o.productionStartDate || o.dueDate || ''; }
  function buf(){ return typeof bufferMult === 'function' ? bufferMult() : 1; }
  function median(a){ if(!a.length) return 0; const s = a.slice().sort(function(x, y){ return x - y; }); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function pct(v){ return v == null || !isFinite(v) ? '—' : Math.round(v * 100) + '%'; }
  function isToy(cat, name){ return /toy|flexi|fidget|clicker|keychain/i.test((cat || '') + ' ' + (name || '')); }
  // Rate card: toys Rs 4 per gram; lamps Rs 300 up to 100 g, then Rs 3.5 per gram, never under Rs 300.
  function ratePrice(weight, cat, name){ const g = +weight || 0; if(!g) return 0; return isToy(cat, name) ? Math.round(g * 4) : Math.max(300, g <= 100 ? 300 : Math.round(g * 3.5)); }
  function costPerPiece(fil, hrs, material, color){
    const b = buf(), rate = typeof rateForProduct === 'function' ? rateForProduct({ material: material || '', color: color || '' }) : ((state.fleet && state.fleet.filamentPrice) || 0);
    return (fil || 0) * b / 1000 * rate + (hrs || 0) * b * ((state.fleet && state.fleet.machineRate) || 0);
  }

  // ---------- scorecard ----------
  function scorecard(){
    const P = {}, t90 = daysAgo(90), t180 = daysAgo(180), b = buf();
    function get(name){ const k = key(name); if(!k) return null; return P[k] || (P[k] = { key: k, name: String(name).trim(), u90: 0, uPrev: 0, rev90: 0, revAll: 0, uAll: 0, made: 0, failed: 0, buyers: {}, fil: [], hrs: [], last: '' }); }
    (state.productCatalog || []).forEach(function(c){ const p = get(c.name); if(!p) return; p.cat = c; });
    const prod = (window.TTBuyers && window.TTBuyers.prod()) || {};
    state.orders.filter(counts).forEach(function(o){
      const d = orderDay(o);
      (o.products || []).forEach(function(l){
        const p = get(l.name); if(!p) return;
        const q = +l.qty || 0, v = q * (+l.actualPrice || 0);
        p.uAll += q; p.revAll += v;
        if(d >= t90){ p.u90 += q; p.rev90 += v; } else if(d >= t180) p.uPrev += q;
        const farm = prod[o.id] && prod[o.id].lines && prod[o.id].lines[l.id];
        p.made += Math.max(+l.already || 0, farm ? farm.made || 0 : 0); p.failed += Math.max(+l.failed || 0, farm ? farm.failed || 0 : 0);
        if(l.fil) p.fil.push(+l.fil); if(l.hrs) p.hrs.push(+l.hrs);
        if(o.clientId){ p.buyers[o.clientId] = (p.buyers[o.clientId] || 0) + 1; }
        if(d > p.last) p.last = d;
      });
    });
    // Quality claims from brand partners, by product, last 90 days.
    ((window.TTBuyers && window.TTBuyers.requests()) || []).filter(function(q){ return q.kind === 'claim' && (q.created_at || '').slice(0, 10) >= t90; }).forEach(function(q){
      ((q.payload || {}).lines || []).forEach(function(l){ const p = get(l.name); if(p) p.claims = (p.claims || 0) + (+l.qty || 1); });
    });
    const rows = Object.keys(P).map(function(k){
      const p = P[k], c = p.cat || {};
      const fil = +c.weight || median(p.fil), hrs = +c.hours || median(p.hrs);
      const price = p.uAll ? p.revAll / p.uAll : (+c.wholesalePrice || 0);
      const cost = costPerPiece(fil, hrs, c.material, c.color);
      const buyers = Object.keys(p.buyers), repeat = buyers.filter(function(id){ return p.buyers[id] >= 2; }).length;
      const attempts = p.made + p.failed;
      return { name: p.name, inCatalogue: !!p.cat, u90: p.u90, rev90: p.rev90, trend: p.uPrev ? (p.u90 - p.uPrev) / p.uPrev : (p.u90 ? 1 : null),
        price: price, cost: cost, perHour: hrs ? (price - cost) / (hrs * b) : null, hrs: hrs, fil: fil,
        failRate: attempts >= 5 ? p.failed / attempts : null, attempts: attempts, reorder: buyers.length ? repeat / buyers.length : null, buyers: buyers.length, claims: p.claims || 0, last: p.last };
    });
    const med = median(rows.filter(function(r){ return r.perHour != null && r.u90; }).map(function(r){ return r.perHour; }));
    rows.forEach(function(r){
      let v = 'keep', why = 'Selling steadily';
      if(r.inCatalogue && !r.last) { v = 'retire'; why = 'Never ordered'; }
      else if(r.inCatalogue && r.last < t180){ v = 'retire'; why = 'No orders in 6 months'; }
      else if((r.failRate != null && r.failRate >= 0.15 && r.attempts >= 10) || r.claims >= 3){ v = 'fix'; why = r.claims >= 3 ? r.claims + ' pieces claimed as faulty in 90 days' : pct(r.failRate) + ' of prints fail'; }
      else if(r.perHour != null && med > 0 && r.perHour < med * 0.6 && r.u90){ v = 'reprice'; why = 'Earns ' + money(r.perHour) + ' per print-hour vs ' + money(med) + ' typical'; }
      else if(r.trend != null && r.trend >= 0.2 && r.u90 >= 10 && (r.perHour == null || r.perHour >= med)){ v = 'star'; why = 'Growing ' + pct(r.trend) + ' with good margin'; }
      r.verdict = v; r.why = why;
    });
    return { rows: rows, median: med };
  }
  const VERDICT = { star: ['Star', 'good'], keep: ['Keep', ''], fix: ['Fix quality', 'bad'], reprice: ['Reprice', 'warn'], retire: ['Retire?', 'dim'] };

  function scoreHtml(){
    const S = scorecard();
    let rows = S.rows.filter(function(r){ return !V.verdict || r.verdict === V.verdict; });
    const f = V.sort, d = V.dir;
    rows.sort(function(a, b){ const x = a[f], y = b[f]; if(x == null && y == null) return 0; if(x == null) return 1; if(y == null) return -1; return typeof x === 'string' ? d * x.localeCompare(y) : d * (x - y); });
    const cnt = {}; S.rows.forEach(function(r){ cnt[r.verdict] = (cnt[r.verdict] || 0) + 1; });
    const th = function(k, t, cls){ return '<span class="pl-th ' + (cls || '') + (V.sort === k ? ' on' : '') + '" data-pl-sort="' + k + '">' + t + (V.sort === k ? (V.dir < 0 ? ' ↓' : ' ↑') : '') + '</span>'; };
    return '<div class="pl-chips"><button class="' + (!V.verdict ? 'on' : '') + '" data-pl-v="">All <b>' + S.rows.length + '</b></button>' +
        Object.keys(VERDICT).map(function(k){ return '<button class="' + (V.verdict === k ? 'on' : '') + '" data-pl-v="' + k + '"><i class="pl-dot ' + VERDICT[k][1] + '"></i>' + VERDICT[k][0] + ' <b>' + (cnt[k] || 0) + '</b></button>'; }).join('') + '</div>' +
      '<p class="pl-dim">Last 90 days. Margin per print-hour = (average price − filament and machine cost) ÷ print hours, with your ' + Math.round(((state.fleet && state.fleet.failureBufferPct) || 0)) + '% failure buffer. Typical: ' + money(S.median) + ' an hour.</p>' +
      '<div class="pl-table"><div class="pl-r pl-h">' + th('name', 'Product') + th('verdict', 'Verdict') + th('u90', 'Units', 'n') + th('rev90', 'Revenue', 'n') + th('trend', 'Trend', 'n') + th('price', 'Avg price', 'n') + th('cost', 'Cost / pc', 'n') + th('perHour', '₹ / print-hr', 'n') + th('failRate', 'Fail', 'n') + th('reorder', 'Reorder', 'n') + th('claims', 'Claims', 'n') + '</div>' +
      rows.map(function(r){
        return '<div class="pl-r"><span class="pl-name">' + esc(r.name) + (r.inCatalogue ? '' : ' <i class="pl-dim">not in catalogue</i>') + '</span>' +
          '<span><b class="pl-v ' + VERDICT[r.verdict][1] + '">' + VERDICT[r.verdict][0] + '</b><i class="pl-why">' + esc(r.why) + '</i></span>' +
          '<span class="n">' + r.u90 + '</span><span class="n">' + money(r.rev90) + '</span>' +
          '<span class="n ' + (r.trend == null ? '' : r.trend >= 0 ? 'up' : 'down') + '">' + (r.trend == null ? '—' : (r.trend >= 0 ? '+' : '') + pct(r.trend)) + '</span>' +
          '<span class="n">' + (r.price ? money(r.price) : '—') + '</span><span class="n">' + (r.cost ? money(r.cost) : '—') + '</span>' +
          '<span class="n">' + (r.perHour == null ? '—' : money(r.perHour)) + '</span><span class="n">' + pct(r.failRate) + '</span><span class="n">' + pct(r.reorder) + '</span><span class="n">' + (r.claims || '—') + '</span></div>';
      }).join('') + '</div>';
  }

  // ---------- what to make next ----------
  const ASK = /do you (have|make)|can you (make|do)|custom|personali[sz]|new design|bigger|smaller|larger|another colou?r|in (black|white|gold|pink|blue|green|red)|any (lamp|toy)|looking for|need (a|some)|want (a|some)/i;
  function signals(){
    const t90 = daysAgo(90), reqs = ((window.TTBuyers && window.TTBuyers.requests()) || []).filter(function(q){ return (q.created_at || '').slice(0, 10) >= t90; });
    const asks = [];
    reqs.forEach(function(q){ const p = q.payload || {}; [p.text, p.notes].filter(Boolean).forEach(function(t){ if(ASK.test(t)) asks.push({ who: (window.TTBuyers.clientName && window.TTBuyers.clientName(q.client_id)) || 'A brand partner', text: String(t).slice(0, 220), at: (q.created_at || '').slice(0, 10) }); }); });
    state.orders.filter(function(o){ return orderDay(o) >= t90 && o.notes && ASK.test(o.notes); }).forEach(function(o){ asks.push({ who: o.clientName || o.displayId, text: o.notes.slice(0, 220), at: orderDay(o) }); });
    const lost = {}, lostNotes = [];
    ((window.TTSales && window.TTSales.leads()) || []).filter(function(l){ const d = l.data || {}; return l.stage === 'lost' && (d.lostAt || l.updated_at || '').slice(0, 10) >= t90; }).forEach(function(l){
      const r = String((l.data || {}).lostReason || 'Not given'), base = r.split(' — ')[0];
      lost[base] = (lost[base] || 0) + 1; if(r.indexOf(' — ') !== -1) lostNotes.push((l.data.business || 'Lead') + ': ' + r.split(' — ').slice(1).join(' '));
    });
    const issues = {};
    reqs.filter(function(q){ return q.kind === 'claim'; }).forEach(function(q){ const p = q.payload || {}; (p.lines || []).forEach(function(l){ const k = l.name + ' · ' + ({ broken: 'broken', missing: 'missing pieces', colour: 'wrong colour', defect: 'print defect' }[p.issue] || 'other'); issues[k] = (issues[k] || 0) + (+l.qty || 1); }); });
    const cross = {};
    if(window.TTUpsell){ try{ window.TTUpsell.analyse().opps.filter(function(x){ return x.type === 'cross'; }).forEach(function(x){ const n = x.title.replace(/^Offer /, ''); cross[n] = (cross[n] || 0) + 1; }); }catch(e){} }
    const colours = {};
    state.orders.filter(function(o){ return counts(o) && orderDay(o) >= t90; }).forEach(function(o){ (o.products || []).forEach(function(l){ if(l.color) colours[l.color] = (colours[l.color] || 0) + (+l.qty || 0); }); });
    return { asks: asks.sort(function(a, b){ return b.at.localeCompare(a.at); }), lost: lost, lostNotes: lostNotes, issues: issues, cross: cross, colours: colours };
  }
  function topList(obj, n, fmtV){ return Object.keys(obj).sort(function(a, b){ return obj[b] - obj[a]; }).slice(0, n).map(function(k){ return '<div class="pl-li"><span>' + esc(k) + '</span><b>' + (fmtV ? fmtV(obj[k]) : obj[k]) + '</b></div>'; }).join(''); }
  function nextHtml(){
    const s = signals();
    const card = function(title, sub, body, idea){ return '<div class="panel pl-card"><div class="panel-title">' + title + '</div><p class="pl-dim">' + sub + '</p>' + (body || '<p class="pl-dim">Nothing in the last 90 days.</p>') + (idea ? '<button class="pl-btn" data-pl="idea-from" data-why="' + esc(idea) + '">Start an idea from this</button>' : '') + '</div>'; };
    return '<div class="pl-grid">' +
      card('Asked for by brand partners', 'Messages and order notes asking for a product, size, colour or custom piece.', s.asks.slice(0, 8).map(function(a){ return '<div class="pl-quote"><b>' + esc(a.who) + '</b> <i>' + esc(a.at) + '</i><br>“' + esc(a.text) + '”</div>'; }).join(''), s.asks.length ? 'Requested by brand partners' : '') +
      card('Why deals were lost', 'Reasons salespeople gave when a lead was lost.', topList(s.lost, 6) + (s.lostNotes.length ? '<div class="pl-dim" style="margin-top:6px">' + s.lostNotes.slice(0, 4).map(esc).join('<br>') + '</div>' : ''), Object.keys(s.lost).length ? 'Lost deals: ' + Object.keys(s.lost).sort(function(a, b){ return s.lost[b] - s.lost[a]; })[0] : '') +
      card('Quality problems', 'Pieces claimed by brand partners, by product and problem. Fix these before making more.', topList(s.issues, 6, function(v){ return v + ' pcs'; }), '') +
      card('What similar clients buy', 'Products clients of the same type buy that others don’t yet (Upsell analysis). Gaps here are cheap wins.', topList(s.cross, 6, function(v){ return v + ' client' + (v === 1 ? '' : 's'); }), Object.keys(s.cross).length ? 'Variant of a cross-sell favourite' : '') +
      card('Colours that sell', 'Pieces ordered by colour, last 90 days. New products should launch in these first.', topList(s.colours, 8, function(v){ return v + ' pcs'; }), '') +
    '</div>';
  }

  // ---------- new products ----------
  function ideasHtml(){
    const ideas = lab().ideas;
    return '<div class="pl-row-a"><button class="pl-btn primary" data-pl="new">+ New product idea</button><span class="pl-dim">Move each idea along when it’s ready. Launch adds it to the catalogue and starts its launch campaign.</span></div>' +
      '<div class="pl-board">' + STAGES.filter(function(s){ return s[0] !== 'dropped' || ideas.some(function(i){ return i.stage === 'dropped'; }); }).map(function(st){
        const list = ideas.filter(function(i){ return i.stage === st[0]; });
        return '<div class="pl-col"><div class="pl-col-h">' + st[1] + ' <b>' + list.length + '</b></div>' + list.map(function(i){
          const w = (+i.wholesale || ratePrice(i.weight, i.category, i.name)), mrp = +i.mrp || 0;
          return '<div class="pl-idea" data-pl="edit" data-id="' + i.id + '"><b>' + esc(i.name || 'Untitled') + '</b><span class="pl-dim">' + esc([i.category, i.weight ? i.weight + ' g' : '', i.hours ? i.hours + ' h' : ''].filter(Boolean).join(' · ')) + '</span>' +
            (w ? '<span class="pl-dim">Trade ' + money(w) + (mrp ? ' · MRP ' + money(mrp) + ' · dealer ' + (Math.round(mrp / w * 10) / 10) + '×' : '') + '</span>' : '') +
            (i.why ? '<i class="pl-why">' + esc(i.why) + '</i>' : '') + '</div>';
        }).join('') + '</div>';
      }).join('') + '</div>';
  }
  let modal = null;
  function edit(i){
    const isNew = !i.id;
    if(!modal){ modal = document.createElement('div'); modal.className = 'pl-modal'; document.body.appendChild(modal); }
    const sug = ratePrice(i.weight, i.category, i.name), cost = costPerPiece(+i.weight || 0, +i.hours || 0, i.material, i.colour);
    const f = function(n, l, v, t, ph){ return '<label>' + l + '<input name="' + n + '" type="' + (t || 'text') + '" value="' + esc(v == null ? '' : v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></label>'; };
    modal.innerHTML = '<div class="pl-box"><div class="pl-box-h"><b>' + (isNew ? 'New product idea' : esc(i.name)) + '</b><button class="pl-x" data-plm="close">✕</button></div><div class="pl-box-b">' +
      f('name', 'Name', i.name, 'text', 'e.g. Kara mini pendant') +
      '<div class="pl-2">' + f('category', 'Category', i.category, 'text', 'Pendant lamp, Flexi toy…') + '<label>Stage<select name="stage">' + STAGES.map(function(s){ return '<option value="' + s[0] + '"' + ((i.stage || 'idea') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<label>Why make it<textarea name="why" rows="2">' + esc(i.why || '') + '</textarea></label>' +
      '<div class="pl-3">' + f('size', 'Size', i.size, 'text', 'e.g. 22 cm Ø') + f('weight', 'Weight (g)', i.weight, 'number') + f('hours', 'Print hours', i.hours, 'number') + '</div>' +
      '<div class="pl-2">' + f('material', 'Material', i.material || 'PLA') + f('colour', 'Launch colours', i.colour, 'text', 'e.g. White, Sage') + '</div>' +
      '<div class="pl-3">' + f('wholesale', 'Trade price (₹)', i.wholesale, 'number', sug ? 'rate card: ' + sug : '') + f('mrp', 'MRP (₹)', i.mrp, 'number', sug ? 'e.g. ' + Math.round(sug * 3.3) : '') + f('testPrinted', 'Test prints made', i.testPrinted, 'number') + '</div>' +
      '<div class="pl-2">' + f('testFailed', 'Test prints failed', i.testFailed, 'number') + f('owner', 'Owner', i.owner) + '</div>' +
      '<p class="pl-dim">' + (sug ? 'Rate card price ' + money(sug) + '. ' : 'Add weight to get the rate card price. ') + (cost ? 'Cost about ' + money(cost) + ' a piece. ' : '') + 'Dealers expect about 3.3× between trade price and MRP.</p>' +
      '<label>Notes<textarea name="notes" rows="3">' + esc(i.notes || '') + '</textarea></label></div>' +
      '<div class="pl-box-f">' + (!isNew && i.stage !== 'launched' ? '<button class="pl-btn primary" data-plm="launch">Launch</button>' : '') + '<span style="flex:1"></span><button class="pl-btn" data-plm="close">Cancel</button><button class="pl-btn primary" data-plm="save">Save</button></div></div>';
    modal.classList.add('on');
    modal.onclick = async function(e){
      const b = e.target.closest('[data-plm]'); if(!b && e.target !== modal) return;
      const a = b ? b.getAttribute('data-plm') : 'close';
      if(a === 'close'){ modal.classList.remove('on'); return; }
      const g = function(n){ const el = modal.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ''; };
      if(!g('name')){ showNoticeModal('Give the product a name.'); return; }
      ['name', 'category', 'stage', 'why', 'size', 'weight', 'hours', 'material', 'colour', 'wholesale', 'mrp', 'testPrinted', 'testFailed', 'owner', 'notes'].forEach(function(k){ i[k] = g(k); });
      if(isNew){ i.id = 'idea_' + Date.now().toString(36); i.created = today(); lab().ideas.push(i); }
      if(a === 'launch'){ await launch(i); }
      scheduleSave(); modal.classList.remove('on'); render();
    };
  }
  async function launch(i){
    const w = +i.wholesale || ratePrice(i.weight, i.category, i.name);
    if(!w){ showNoticeModal('Add a weight or a trade price before launching.'); return; }
    if(!state.productCatalog) state.productCatalog = [];
    let c = state.productCatalog.find(function(x){ return key(x.name) === key(i.name); });
    if(!c){ c = { id: newId(), name: i.name, category: i.category || '', weight: +i.weight || 0, hours: +i.hours || 0, material: i.material || 'PLA', color: (i.colour || '').split(',')[0].trim(), size: i.size || '', photo: '', wholesalePrice: w, d2cPrice: +i.mrp || null }; state.productCatalog.push(c); }
    i.stage = 'launched'; i.launchedAt = today(); i.catalogId = c.id;
    let posts = 0;
    if(window.TTMarketing && window.TTMarketing.createCampaign){
      const start = iso(new Date(Date.now() + 7 * DAY));
      const camp = { name: i.name + ' launch', product: i.name, phase: 'conversion', start: start, goal: 'First trade orders for ' + i.name, code: (i.name.replace(/[^a-z0-9]/gi, '').slice(0, 6) + start.slice(8, 10)).toUpperCase() };
      try{ posts = await window.TTMarketing.createCampaign(camp, isToy(i.category, i.name) ? 'tpl_toys' : 'tpl_launch'); i.campaignId = camp.id; }catch(e){ console.warn('[lab] campaign', e); }
    }
    if(window.TTTasks) try{ await window.TTTasks.add('Shoot launch photos and reel: ' + i.name, '', iso(new Date(Date.now() + 3 * DAY)), 'high', { type: 'product', id: c.id, label: i.name }); }catch(e){}
    if(typeof renderProductCatalog === 'function') try{ renderProductCatalog(); }catch(e){}
    showNoticeModal(i.name + ' is in the catalogue at ' + money(w) + ' trade' + (posts ? ', with a launch campaign of ' + posts + ' posts starting in a week' : '') + ', and a task to shoot it.');
  }

  // ---------- page ----------
  function render(){
    const root = document.getElementById('labRoot'); if(!root) return;
    const tab = function(v, t){ return '<button class="pl-tab' + (V.view === v ? ' on' : '') + '" data-pl-view="' + v + '">' + t + '</button>'; };
    root.innerHTML = '<div class="pl-head"><div class="pl-title">Product Lab</div><div class="pl-dim">What to keep, fix, reprice, retire, and make next</div></div>' +
      '<div class="pl-tabs">' + tab('score', 'Scorecard') + tab('next', 'What to make next') + tab('ideas', 'New products') + '</div>' +
      (V.view === 'next' ? nextHtml() : V.view === 'ideas' ? ideasHtml() : '<div class="panel">' + scoreHtml() + '</div>');
  }
  window.renderProductLab = render;

  document.addEventListener('click', function(e){
    const t = document.getElementById('tabLab'); if(!t || !t.contains(e.target)) return;
    const vw = e.target.closest('[data-pl-view]'); if(vw){ V.view = vw.getAttribute('data-pl-view'); render(); return; }
    const so = e.target.closest('[data-pl-sort]'); if(so){ const k = so.getAttribute('data-pl-sort'); V.dir = V.sort === k ? -V.dir : (k === 'name' || k === 'verdict' ? 1 : -1); V.sort = k; render(); return; }
    const vd = e.target.closest('[data-pl-v]'); if(vd){ V.verdict = vd.getAttribute('data-pl-v'); render(); return; }
    const b = e.target.closest('[data-pl]'); if(!b) return;
    const a = b.getAttribute('data-pl');
    if(a === 'new') edit({ stage: 'idea', material: 'PLA' });
    else if(a === 'idea-from'){ V.view = 'ideas'; render(); edit({ stage: 'idea', material: 'PLA', why: b.getAttribute('data-why') }); }
    else if(a === 'edit'){ const i = lab().ideas.find(function(x){ return x.id === b.getAttribute('data-id'); }); if(i) edit(i); }
  });

  const css = document.createElement('style');
  css.textContent = [
    '#tabLab{font-family:"Space Grotesk",sans-serif}',
    '#tabLab .pl-head{margin:4px 0 14px} #tabLab .pl-title{font-size:26px;font-weight:700;color:var(--text)}',
    '#tabLab .pl-dim,.pl-box .pl-dim{color:var(--dim);font-size:12.5px}',
    '#tabLab .pl-tabs{display:flex;gap:4px;background:var(--input-bg);border-radius:12px;padding:4px;margin-bottom:14px;width:fit-content;max-width:100%;flex-wrap:wrap}',
    '#tabLab .pl-tab{border:none;background:transparent;border-radius:9px;padding:8px 14px;font:13.5px "Space Grotesk",sans-serif;color:var(--dim);cursor:pointer}',
    '#tabLab .pl-tab.on{background:var(--panel);color:var(--text);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '#tabLab .pl-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}',
    '#tabLab .pl-chips button{border:1px solid var(--line);background:transparent;border-radius:999px;padding:5px 12px;font:13px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer;display:inline-flex;gap:6px;align-items:center}',
    '#tabLab .pl-chips button.on{border-color:var(--cyan);background:rgba(79,209,197,.12)} #tabLab .pl-chips b{color:var(--dim);font-weight:600}',
    '#tabLab .pl-dot{width:8px;height:8px;border-radius:50%;background:var(--line);display:inline-block}',
    '#tabLab .pl-dot.good{background:var(--green)} #tabLab .pl-dot.warn{background:var(--amber)} #tabLab .pl-dot.bad{background:var(--red)} #tabLab .pl-dot.dim{background:var(--dim)}',
    '#tabLab .pl-table{overflow-x:auto}',
    '#tabLab .pl-r{display:grid;grid-template-columns:minmax(150px,1.4fr) minmax(170px,1.6fr) repeat(9,minmax(64px,.6fr));gap:8px;align-items:center;padding:9px 4px;border-top:1px solid var(--line);font-size:13px;min-width:1020px}',
    '#tabLab .pl-h{border-top:none;font:10.5px "JetBrains Mono",monospace;letter-spacing:.6px;text-transform:uppercase;color:var(--dim)}',
    '#tabLab .pl-th{cursor:pointer} #tabLab .pl-th.on{color:var(--text)} #tabLab .n{text-align:right;font-variant-numeric:tabular-nums}',
    '#tabLab .n.up{color:var(--green)} #tabLab .n.down{color:var(--red)}',
    '#tabLab .pl-name{font-weight:600} #tabLab .pl-name i{font-weight:400;font-style:normal}',
    '#tabLab .pl-v{font-size:12px;border-radius:999px;padding:2px 8px;border:1px solid var(--line)}',
    '#tabLab .pl-v.good{color:var(--green);border-color:var(--green)} #tabLab .pl-v.warn{color:var(--amber);border-color:var(--amber)} #tabLab .pl-v.bad{color:var(--red);border-color:var(--red)} #tabLab .pl-v.dim{color:var(--dim)}',
    '#tabLab .pl-why{display:block;font-style:normal;font-size:11.5px;color:var(--dim);margin-top:3px}',
    '#tabLab .pl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}',
    '#tabLab .pl-card{margin:0;display:flex;flex-direction:column;gap:6px}',
    '#tabLab .pl-li{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--line);font-size:13px}',
    '#tabLab .pl-quote{font-size:13px;padding:7px 0;border-top:1px solid var(--line)} #tabLab .pl-quote i{color:var(--dim);font-style:normal;font-size:11.5px}',
    '#tabLab .pl-btn,.pl-box .pl-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:7px 13px;font:13px "Space Grotesk",sans-serif;cursor:pointer;align-self:flex-start}',
    '#tabLab .pl-btn.primary,.pl-box .pl-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600}',
    '#tabLab .pl-row-a{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}',
    '#tabLab .pl-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(200px,1fr);gap:10px;overflow-x:auto;padding-bottom:8px}',
    '#tabLab .pl-col{background:var(--input-bg);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:120px}',
    '#tabLab .pl-col-h{font:11px "JetBrains Mono",monospace;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);padding:2px 4px 4px}',
    '#tabLab .pl-idea{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:3px;cursor:pointer;font-size:13px}',
    '#tabLab .pl-idea:hover{border-color:var(--cyan)}',
    '.pl-modal{position:fixed;inset:0;z-index:1100;background:rgba(5,8,12,.6);display:none;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow-y:auto}',
    '.pl-modal.on{display:flex}',
    '.pl-box{background:var(--panel);border-radius:16px;width:min(620px,100%);box-shadow:0 24px 70px rgba(0,0,0,.35);font-family:"Space Grotesk",sans-serif}',
    '.pl-box-h{display:flex;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--line);font-size:17px}',
    '.pl-x{background:none;border:none;font-size:16px;color:var(--dim);cursor:pointer}',
    '.pl-box-b{padding:6px 18px 14px;max-height:68vh;overflow-y:auto} .pl-box-b label{display:block;font-size:12px;color:var(--dim);margin-top:10px}',
    '.pl-box-b input,.pl-box-b select,.pl-box-b textarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;border-radius:9px;min-height:38px;font:14px "Space Grotesk",sans-serif}',
    '.pl-2{display:grid;grid-template-columns:1fr 1fr;gap:10px} .pl-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}',
    '.pl-box-f{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--line)}',
    '@media (max-width:640px){.pl-2,.pl-3{grid-template-columns:1fr}}'
  ].join('');
  document.head.appendChild(css);
})();
