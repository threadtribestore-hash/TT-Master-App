// ===================================================================
// ======================== UPSELL OPPORTUNITIES (Studio) ============
// ===================================================================
// Reads every client's past orders and scores four kinds of upsell, each with a
// rupee estimate and the reason behind it:
//   Reorder due   – a repeat client is at or past their usual gap between orders.
//   Cross-sell    – products that clients of the same type buy and this one hasn't.
//   Bigger qty    – their usual quantity of a product sits just under a discount slab.
//   Tier step-up  – last-30-day spend is close to the next dealer tier.
// Shown on Orders as a stacked bar chart of the top clients plus a ranked list with
// a ready WhatsApp message. Quoted, lost and cancelled orders are ignored.
(function(){
  if(window.TT_STOCK_MODE) return;
  const tab = document.getElementById('tabOrders');
  if(!tab) return;

  const DAY = 86400000;
  const DONE = ['quoted', 'lost', 'cancelled'];
  const TYPES = [
    { id: 'reorder', name: 'Reorder due' },
    { id: 'cross', name: 'Cross-sell' },
    { id: 'qty', name: 'Bigger quantity' },
    { id: 'tier', name: 'Tier step-up' }
  ];
  const SHOW = 8;

  const css = document.createElement('style');
  css.textContent = [
    '.up-panel{--up-1:#2a78d6;--up-2:#eb6834;--up-3:#1baf7a;--up-4:#eda100;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin:16px 0}',
    'html[data-theme="dark"] .up-panel{--up-1:#3987e5;--up-2:#d95926;--up-3:#199e70;--up-4:#c98500}',
    '.up-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}',
    '.up-title{font-family:"Space Grotesk",sans-serif;font-size:18px;font-weight:700;color:var(--text)}',
    '.up-sub{font-size:12.5px;color:var(--dim);margin-top:3px;font-family:"Space Grotesk",sans-serif}',
    '.up-how{font-size:12px;color:var(--dim);font-family:"Space Grotesk",sans-serif}',
    '.up-how summary{cursor:pointer;color:var(--cyan)}',
    '.up-how ul{margin:8px 0 0;padding-left:18px;max-width:520px;line-height:1.5}',
    '.up-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px}',
    '.up-tile{background:var(--bg);border-radius:12px;padding:12px 14px}',
    '.up-tile-k{font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:var(--dim)}',
    '.up-tile-v{font-family:"Space Grotesk",sans-serif;font-size:24px;font-weight:700;color:var(--text);margin-top:4px}',
    '.up-tile-s{font-size:12px;color:var(--dim);margin-top:2px;font-family:"Space Grotesk",sans-serif}',
    '.up-legend{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}',
    '.up-key{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:transparent;border-radius:999px;padding:5px 11px;font-size:12.5px;color:var(--text);cursor:pointer;font-family:"Space Grotesk",sans-serif}',
    '.up-key i{width:10px;height:10px;border-radius:3px;display:inline-block}',
    '.up-key.off{opacity:.45}.up-key.off i{background:transparent!important;outline:1.5px solid var(--dim)}',
    '.up-chart{display:flex;flex-direction:column;gap:8px;margin-bottom:18px}',
    '.up-row{display:grid;grid-template-columns:minmax(90px,180px) 1fr;gap:10px;align-items:center}',
    '.up-name{font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:"Space Grotesk",sans-serif}',
    '.up-track{display:flex;align-items:center;gap:8px;min-width:0}',
    '.up-bar{display:flex;gap:2px;height:22px;min-width:4px}',
    '.up-seg{height:100%;cursor:default;min-width:3px}',
    '.up-seg:last-child{border-radius:0 4px 4px 0}',
    '.up-seg:hover{filter:brightness(1.1)}',
    '.up-total{font-size:12.5px;color:var(--text);font-family:"JetBrains Mono",monospace;white-space:nowrap}',
    '.up-tip{position:fixed;z-index:2000;pointer-events:none;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.2);padding:10px 12px;font-size:12.5px;color:var(--text);max-width:280px;display:none;font-family:"Space Grotesk",sans-serif;line-height:1.45}',
    '.up-tip b{display:block;margin-bottom:2px}.up-tip .up-tip-v{font-family:"JetBrains Mono",monospace;margin-top:4px}',
    '.up-list{display:flex;flex-direction:column;border-top:1px solid var(--line)}',
    '.up-item{display:grid;grid-template-columns:auto 1fr auto auto;gap:12px;align-items:center;padding:11px 2px;border-bottom:1px solid var(--line)}',
    '.up-dot{width:10px;height:10px;border-radius:3px}',
    '.up-what{min-width:0;font-family:"Space Grotesk",sans-serif}',
    '.up-what b{font-size:13.5px;color:var(--text)}',
    '.up-what span{display:block;font-size:12.5px;color:var(--dim);margin-top:2px}',
    '.up-what span.up-type{display:inline;margin-top:0}',
    '.up-type{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);margin-left:6px}',
    '.up-val{font-family:"JetBrains Mono",monospace;font-size:13px;color:var(--text);white-space:nowrap}',
    '.up-act{font-size:12px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;color:var(--text);text-decoration:none;white-space:nowrap;font-family:"Space Grotesk",sans-serif}',
    '.up-act:hover{border-color:var(--cyan);color:var(--cyan)}',
    '.up-more{margin-top:10px;background:none;border:none;color:var(--cyan);cursor:pointer;font-size:13px;font-family:"Space Grotesk",sans-serif;padding:0}',
    '.up-empty{color:var(--dim);font-size:13px;padding:10px 0;font-family:"Space Grotesk",sans-serif}',
    '@media (max-width:640px){.up-row{grid-template-columns:1fr}.up-name{font-size:12.5px}.up-item{grid-template-columns:auto 1fr auto}.up-item .up-act{grid-column:2/-1;justify-self:start}}'
  ].join('');
  document.head.appendChild(css);

  // ---------- helpers ----------
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function rupees(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function key(s){ return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function median(a){ if(!a.length) return 0; const s = a.slice().sort(function(x, y){ return x - y; }); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function dateOf(o){ const d = o.orderedDate || o.productionStartDate || o.dueDate || o.deliveryDate; const t = d ? new Date(String(d).slice(0, 10) + 'T00:00:00').getTime() : NaN; return isNaN(t) ? null : t; }
  function valueOf(o){ try{ return orderTotals(o).orderValue || 0; }catch(e){ return (o.products || []).reduce(function(s, p){ return s + (p.actualPrice || 0) * (p.qty || 0); }, 0); } }
  function phoneOf(raw){ raw = String(raw || '').replace(/\D/g, ''); return raw.length === 10 ? '91' + raw : raw; }
  function wa(phone, text){ return 'https://wa.me/' + (phone && phone.length >= 11 ? phone : '') + '?text=' + encodeURIComponent(text); }
  function slabs(){
    const s = (state.buyerSettings && state.buyerSettings.model === 'mrp' && state.buyerSettings.slabs) || [{ min: 10, pct: 10 }, { min: 25, pct: 15 }, { min: 50, pct: 20 }, { min: 100, pct: 25 }, { min: 250, pct: 30 }, { min: 500, pct: 35 }, { min: 1000, pct: 40 }];
    return s.slice().sort(function(a, b){ return a.min - b.min; });
  }
  function tiers(){ return ((state.dealerTiers && state.dealerTiers.length) ? state.dealerTiers : []).slice().sort(function(a, b){ return a.minRevenue - b.minRevenue; }); }

  // ---------- analysis ----------
  function analyse(){
    const now = Date.now();
    const clients = {};
    (state.orders || []).forEach(function(o){
      if(DONE.indexOf(o.status) !== -1) return;
      const c = o.clientId ? (state.clients || []).find(function(x){ return x.id === o.clientId; }) : null;
      const k = o.clientId || ('name:' + key(o.clientName));
      if(!o.clientId && !key(o.clientName)) return;
      if(!clients[k]) clients[k] = { key: k, name: (c && c.name) || o.clientName || 'Client', type: key((c && c.type) || ''), phone: phoneOf((c && c.phone) || o.clientPhone), orders: [], lines: {} };
      const cl = clients[k];
      const t = dateOf(o), v = valueOf(o);
      cl.orders.push({ t: t, v: v, o: o });
      (o.products || []).forEach(function(p){
        const pk = key(p.name);
        if(!pk || !(p.qty > 0)) return;
        if(!cl.lines[pk]) cl.lines[pk] = { name: p.name.trim(), qtys: [], prices: [] };
        cl.lines[pk].qtys.push(p.qty);
        if(p.actualPrice > 0) cl.lines[pk].prices.push(p.actualPrice);
      });
    });
    const list = Object.keys(clients).map(function(k){ return clients[k]; });
    const totalOrders = list.reduce(function(s, c){ return s + c.orders.length; }, 0);

    // Product adoption by client type, for cross-sell.
    const byType = {};
    list.forEach(function(c){
      const t = c.type || 'other';
      if(!byType[t]) byType[t] = { n: 0, prod: {} };
      byType[t].n++;
      Object.keys(c.lines).forEach(function(pk){
        const l = c.lines[pk];
        const P = byType[t].prod[pk] || (byType[t].prod[pk] = { name: l.name, buyers: 0, vals: [] });
        P.buyers++;
        P.vals.push(median(l.qtys) * (median(l.prices) || 0));
      });
    });

    const opps = [];
    const SL = slabs(), TI = tiers();
    list.forEach(function(c){
      const dated = c.orders.filter(function(x){ return x.t != null; }).sort(function(a, b){ return a.t - b.t; });
      const avgVal = median(c.orders.map(function(x){ return x.v; }).filter(function(v){ return v > 0; }));

      // 1. Reorder due.
      if(dated.length >= 2){
        const gaps = [];
        for(let i = 1; i < dated.length; i++){ const g = (dated[i].t - dated[i - 1].t) / DAY; if(g >= 3) gaps.push(g); }
        const gap = median(gaps);
        const since = (now - dated[dated.length - 1].t) / DAY;
        if(gap > 0 && since >= gap * 0.8 && avgVal > 0){
          const lapsed = since > gap * 2.5;
          opps.push({ c: c, type: 'reorder', value: avgVal * (lapsed ? 0.4 : 0.8),
            title: lapsed ? 'Win back — no order in ' + Math.round(since) + ' days' : 'Due to reorder',
            why: 'Orders every ~' + Math.round(gap) + ' days; last one ' + Math.round(since) + ' days ago. Typical order ' + rupees(avgVal) + '.',
            msg: 'Hi ' + c.name + ', it has been a while since your last order with Thread Tribe. Shall we repeat it, or would you like to see what is new?' });
        }
      }

      // 2. Cross-sell from clients of the same type.
      const peers = byType[c.type || 'other'];
      if(peers && peers.n >= 3){
        Object.keys(peers.prod).filter(function(pk){ return !c.lines[pk]; }).map(function(pk){
          const P = peers.prod[pk];
          return { name: P.name, share: P.buyers / peers.n, val: median(P.vals.filter(function(v){ return v > 0; })) };
        }).filter(function(x){ return x.share >= 0.3 && x.val > 0; })
          .sort(function(a, b){ return b.share * b.val - a.share * a.val; }).slice(0, 2)
          .forEach(function(x){
            opps.push({ c: c, type: 'cross', value: x.val * x.share,
              title: 'Offer ' + x.name,
              why: Math.round(x.share * 100) + '% of ' + (c.type || 'similar') + ' clients buy it; typical line ' + rupees(x.val) + '.',
              msg: 'Hi ' + c.name + ', other ' + (c.type || 'trade') + ' partners have been doing well with our ' + x.name + '. Want me to add some to your next order?' });
          });
      }

      // 3. Bigger quantity: usual qty just under the next discount slab.
      Object.keys(c.lines).forEach(function(pk){
        const l = c.lines[pk];
        if(l.qtys.length < 1) return;
        const q = median(l.qtys), price = median(l.prices);
        const next = SL.find(function(s){ return s.min > q; });
        if(!next || !price) return;
        const extra = next.min - q;
        if(extra / next.min > 0.4) return;
        opps.push({ c: c, type: 'qty', value: extra * price,
          title: l.name + ': ' + Math.round(q) + ' → ' + next.min + ' pcs',
          why: 'Usually orders ' + Math.round(q) + '. ' + Math.round(extra) + ' more reaches the ' + next.min + '+ slab (' + next.pct + '% off list).',
          msg: 'Hi ' + c.name + ', on ' + l.name + ' you are ' + Math.round(extra) + ' pieces short of the ' + next.min + '+ price break. Shall I make your next one ' + next.min + '?' });
      });

      // 4. Tier step-up on the last 30 days of spend.
      if(TI.length){
        const spend = dated.filter(function(x){ return now - x.t <= 30 * DAY; }).reduce(function(s, x){ return s + x.v; }, 0);
        const next = TI.find(function(t){ return t.minRevenue > spend; });
        if(next && spend > 0){
          const gapR = next.minRevenue - spend;
          if(gapR / next.minRevenue <= 0.35){
            opps.push({ c: c, type: 'tier', value: gapR,
              title: rupees(gapR) + ' from ' + next.name,
              why: rupees(spend) + ' in the last 30 days. ' + next.name + ' starts at ' + rupees(next.minRevenue) + ' (' + next.discountPct + '% off).',
              msg: 'Hi ' + c.name + ', you are ' + rupees(gapR) + ' away from ' + next.name + ' pricing (' + next.discountPct + '% off) this month. Anything you would like to add?' });
          }
        }
      }
    });

    const perClient = {};
    opps.forEach(function(x){
      const p = perClient[x.c.key] || (perClient[x.c.key] = { c: x.c, total: 0, by: {} });
      p.total += x.value;
      p.by[x.type] = (p.by[x.type] || 0) + x.value;
    });
    return {
      clients: list.length, orders: totalOrders,
      opps: opps.sort(function(a, b){ return b.value - a.value; }),
      ranked: Object.keys(perClient).map(function(k){ return perClient[k]; }).sort(function(a, b){ return b.total - a.total; })
    };
  }

  // ---------- render ----------
  const off = {};
  let showAll = false;
  const panel = document.createElement('div');
  panel.className = 'up-panel';
  panel.id = 'upsellPanel';
  const tip = document.createElement('div');
  tip.className = 'up-tip';
  document.body.appendChild(tip);

  function colour(type){ return 'var(--up-' + (TYPES.findIndex(function(t){ return t.id === type; }) + 1) + ')'; }

  function render(){
    if(tab.style.display === 'none') return;
    const A = analyse();
    const opps = A.opps.filter(function(x){ return !off[x.type]; });
    const ranked = A.ranked.map(function(r){
      const by = {}; let total = 0;
      Object.keys(r.by).forEach(function(t){ if(!off[t]){ by[t] = r.by[t]; total += r.by[t]; } });
      return { c: r.c, by: by, total: total };
    }).filter(function(r){ return r.total > 0; }).sort(function(a, b){ return b.total - a.total; });
    const total = opps.reduce(function(s, x){ return s + x.value; }, 0);
    const byType = {};
    opps.forEach(function(x){ byType[x.type] = (byType[x.type] || 0) + x.value; });
    const topType = TYPES.slice().sort(function(a, b){ return (byType[b.id] || 0) - (byType[a.id] || 0); })[0];

    let h = '<div class="up-head"><div><div class="up-title">Upsell opportunities</div>' +
      '<div class="up-sub">From ' + A.orders + ' past orders across ' + A.clients + ' clients. Quotes, lost and cancelled orders are left out.</div></div>' +
      '<details class="up-how"><summary>How this is worked out</summary><ul>' +
        '<li><b>Reorder due</b>: repeat clients at 80% or more of their usual gap between orders. Worth 80% of their typical order (40% if lapsed past 2.5× the gap).</li>' +
        '<li><b>Cross-sell</b>: products at least 30% of clients of the same type buy and this one hasn’t. Worth the typical line × that share.</li>' +
        '<li><b>Bigger quantity</b>: a product’s usual quantity within 40% of the next discount slab. Worth the extra pieces at their price.</li>' +
        '<li><b>Tier step-up</b>: last-30-day spend within 35% of the next dealer tier. Worth the gap.</li>' +
        '<li>Estimates are a guide for who to call first, not a forecast.</li></ul></details></div>';

    if(!A.opps.length){
      panel.innerHTML = h + '<div class="up-empty">No upsell signals yet. They appear once clients have a few dated orders with products and prices.</div>';
      return;
    }

    h += '<div class="up-tiles">' +
      '<div class="up-tile"><div class="up-tile-k">Potential</div><div class="up-tile-v">' + rupees(total) + '</div><div class="up-tile-s">estimated, across ' + opps.length + ' opportunities</div></div>' +
      '<div class="up-tile"><div class="up-tile-k">Clients to call</div><div class="up-tile-v">' + ranked.length + '</div><div class="up-tile-s">top: ' + esc(ranked[0] ? ranked[0].c.name : '—') + '</div></div>' +
      '<div class="up-tile"><div class="up-tile-k">Biggest lever</div><div class="up-tile-v" style="font-size:20px">' + esc(topType && byType[topType.id] ? topType.name : '—') + '</div><div class="up-tile-s">' + (topType && byType[topType.id] ? rupees(byType[topType.id]) + ' of the total' : '') + '</div></div>' +
    '</div>';

    h += '<div class="up-legend">' + TYPES.map(function(t){
      return '<button type="button" class="up-key' + (off[t.id] ? ' off' : '') + '" data-type="' + t.id + '" title="Show or hide ' + esc(t.name) + '"><i style="background:' + colour(t.id) + '"></i>' + esc(t.name) + ' <span style="color:var(--dim)">' + (A.opps.filter(function(x){ return x.type === t.id; }).length) + '</span></button>';
    }).join('') + '</div>';

    const top = ranked.slice(0, SHOW);
    const max = top.length ? top[0].total : 1;
    h += '<div class="up-chart" role="img" aria-label="Estimated upsell value by client, split by opportunity type">' + top.map(function(r){
      const segs = TYPES.filter(function(t){ return r.by[t.id] > 0; }).map(function(t){
        return '<div class="up-seg" style="flex:' + r.by[t.id].toFixed(2) + ' 1 0;background:' + colour(t.id) + '" data-tip="' + esc('<b>' + esc(r.c.name) + '</b>' + esc(t.name) + '<div class="up-tip-v">' + rupees(r.by[t.id]) + '</div>') + '"></div>';
      }).join('');
      return '<div class="up-row"><div class="up-name" title="' + esc(r.c.name) + '">' + esc(r.c.name) + '</div>' +
        '<div class="up-track"><div class="up-bar" style="width:calc(' + (r.total / max * 100) + '% - 70px)">' + segs + '</div><span class="up-total">' + rupees(r.total) + '</span></div></div>';
    }).join('') + '</div>';

    const rows = showAll ? opps : opps.slice(0, 6);
    h += '<div class="up-list">' + rows.map(function(x){
      return '<div class="up-item"><span class="up-dot" style="background:' + colour(x.type) + '"></span>' +
        '<div class="up-what"><b>' + esc(x.c.name) + '</b><span class="up-type">' + esc(TYPES.find(function(t){ return t.id === x.type; }).name) + '</span>' +
          '<span>' + esc(x.title) + ' · ' + esc(x.why) + '</span></div>' +
        '<span class="up-val">' + rupees(x.value) + '</span>' +
        '<a class="up-act" href="' + esc(wa(x.c.phone, x.msg)) + '" target="_blank" rel="noopener">WhatsApp</a></div>';
    }).join('') + '</div>';
    if(opps.length > 6) h += '<button type="button" class="up-more">' + (showAll ? 'Show fewer' : 'Show all ' + opps.length) + '</button>';
    panel.innerHTML = h;
  }

  panel.addEventListener('click', function(e){
    const k = e.target.closest('.up-key');
    if(k){ const t = k.getAttribute('data-type'); off[t] = !off[t]; render(); return; }
    if(e.target.closest('.up-more')){ showAll = !showAll; render(); }
  });
  panel.addEventListener('mousemove', function(e){
    const s = e.target.closest('.up-seg');
    if(!s){ tip.style.display = 'none'; return; }
    tip.innerHTML = s.getAttribute('data-tip');
    tip.style.display = 'block';
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + 'px';
    tip.style.top = Math.max(8, e.clientY - hgt - 12) + 'px';
  });
  panel.addEventListener('mouseleave', function(){ tip.style.display = 'none'; });

  // Sits below the orders list, where Order Velocity and the Pricing Calculator were.
  const anchor = document.getElementById('orderVelocityPanel') || document.getElementById('ordersTableWrap');
  if(anchor) anchor.parentNode.insertBefore(panel, anchor);

  let timer = null;
  function soon(){ clearTimeout(timer); timer = setTimeout(function(){ try{ render(); }catch(e){ console.warn('[upsell]', e); } }, 250); }
  if(typeof renderOrders === 'function'){
    const orig = renderOrders;
    renderOrders = function(){ const r = orig.apply(this, arguments); soon(); return r; };
  }
  const btn = document.querySelector('.tab-btn[data-tab="orders"]');
  if(btn) btn.addEventListener('click', soon);
  soon();
  window.TTUpsell = { analyse: analyse, render: render };
})();
