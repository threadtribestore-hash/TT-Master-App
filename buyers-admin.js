// ===================================================================
// ===================== BUYER APP (Master side) =====================
// ===================================================================
// Trade buyers (toy resellers, lamp wholesalers) get their own app in buyer/.
// Same pattern as the Partner app: Studio publishes one "buyer pack" per client
// into buyer_packs (their catalogue at their tier price, their orders, invoices
// and production progress), and buyers send orders back through
// buyer_submit_request into buyer_requests, which land in this tab's inbox.
// Buyers never read studio_rows.
//
// Pricing (decided Oct 2026). The Buyer app sells toys only; lamps are left out.
//   base      weight x Rs 4 per gram
//   discount  dealer tier % (from spend on orders dated in the last 30 days)
//             + quantity slab % (from the order's total pieces, products mixed),
//             capped. Orders need a minimum per product and per order.
// Prices are always recomputed here when an order is created; the price a buyer
// saw in their app is only shown for comparison.
(function(){
  if(window.TT_STOCK_MODE) return;

  const TOY_RATE = 4;
  const TIER_DAYS = 30, HISTORY_DAYS = 365;
  const DEFAULT_TERMS = { minPerProduct: 10, minOrder: 25, maxDiscount: 20,
    slabs: [{ min: 100, pct: 3 }, { min: 250, pct: 5 }, { min: 500, pct: 8 }, { min: 1000, pct: 12 }] };
  function terms(){
    const t = Object.assign({}, DEFAULT_TERMS, state.buyerSettings || {});
    t.slabs = (Array.isArray(t.slabs) ? t.slabs : DEFAULT_TERMS.slabs)
      .map(function(x){ return { min: Math.max(1, Math.round(+x.min || 0)), pct: Math.max(0, Math.min(100, +x.pct || 0)) }; })
      .filter(function(x){ return x.min > 0; }).sort(function(a, b){ return a.min - b.min; });
    return t;
  }
  function slabPct(totalQty){ let p = 0; terms().slabs.forEach(function(x){ if(totalQty >= x.min) p = x.pct; }); return p; }
  function orderDiscount(tierPct, totalQty){ return Math.min(terms().maxDiscount, (tierPct || 0) + slabPct(totalQty)); }
  const HASH_KEY = 'tt-buyer-pack-hashes-v1';
  const B = { requests: [], prod: {}, known: null, hashes: {}, missing: false, seen: {}, at: 0, showDone: false, thumbs: {}, publishing: false };
  try{ B.hashes = JSON.parse(localStorage.getItem(HASH_KEY)) || {}; }catch(e){}
  function saveHashes(){ try{ localStorage.setItem(HASH_KEY, JSON.stringify(B.hashes)); }catch(e){} }

  // ---------- pricing ----------
  function kindOf(item){
    const test = function(s){
      s = (s || '').toLowerCase();
      if(/toy|clicker|fidget|flexi/.test(s)) return 'toy';
      if(/lamp|light|pendant|chandelier|sconce|wall/.test(s)) return 'lamp';
      return '';
    };
    return test(item.category) || test(item.name);
  }
  function basePrice(item){
    const g = parseFloat(item.weight) || 0;
    return g > 0 && kindOf(item) === 'toy' ? Math.round(g * TOY_RATE) : 0;
  }
  function tierPrice(base, pct){ return Math.round(base * (1 - (pct || 0) / 100)); }

  // ---------- tiers ----------
  function isoDaysAgo(n){ const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
  function orderDate(o){ return o.orderedDate || o.productionStartDate || o.quotedDate || o.dueDate || ''; }
  function counts(o){ return ['quoted', 'lost', 'cancelled'].indexOf(o.status) === -1; }
  function spend30(cid){
    const cutoff = isoDaysAgo(TIER_DAYS);
    return state.orders.reduce(function(sum, o){
      if(o.clientId !== cid || !counts(o) || orderDate(o) < cutoff) return sum;
      return sum + (orderTotals(o).orderValue || 0);
    }, 0);
  }
  function tiers(){ return (state.dealerTiers || []).slice().sort(function(a, b){ return (a.minRevenue || 0) - (b.minRevenue || 0); }); }
  function tierOf(cid){
    const spend = spend30(cid);
    let cur = null, next = null;
    tiers().forEach(function(t){ if(spend >= (t.minRevenue || 0)) cur = t; else if(!next) next = t; });
    const on = state.dealerRewardsEnabled !== false;
    return {
      name: cur ? (cur.name || 'Tier') : '', pct: on && cur ? (parseFloat(cur.discountPct) || 0) : 0, spend: Math.round(spend), days: TIER_DAYS,
      next: next ? { name: next.name || 'Next tier', pct: parseFloat(next.discountPct) || 0, minRevenue: next.minRevenue || 0, need: Math.max(0, Math.round((next.minRevenue || 0) - spend)) } : null,
      ladder: tiers().map(function(t){ return { name: t.name || '', minRevenue: t.minRevenue || 0, pct: parseFloat(t.discountPct) || 0 }; })
    };
  }

  // ---------- packs ----------
  // The Buyer app is for trade clients only; D2C (consumer) clients never get a pack.
  function isTrade(c){ return !/\bd2c\b|consumer|individual/i.test((c && c.type) || ''); }
  function emailOf(c){
    const em = String((c && c.email) || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) ? em : '';
  }
  function gstinOf(c){
    if(c.gstin) return c.gstin;
    const o = state.orders.filter(function(x){ return x.clientId === c.id && x.clientGstin; }).pop();
    return o ? o.clientGstin : '';
  }
  // Studio stores photos as full-size data URLs; packs carry small JPEG thumbnails instead.
  function thumbKey(item){ return item.id + ':' + String(item.photo || '').length; }
  function makeThumb(src){
    return new Promise(function(resolve){
      const img = new Image();
      img.onload = function(){
        try{
          const s = Math.min(1, 320 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.72));
        }catch(e){ resolve(''); }
      };
      img.onerror = function(){ resolve(''); };
      img.src = src;
    });
  }
  async function ensureThumbs(){
    const jobs = (state.productCatalog || []).filter(function(i){
      return i.photo && /^data:image\//.test(i.photo) && basePrice(i) > 0 && B.thumbs[thumbKey(i)] === undefined;
    }).map(async function(i){ B.thumbs[thumbKey(i)] = await makeThumb(i.photo); });
    await Promise.all(jobs);
  }
  function photoOf(item){
    if(!item.photo) return '';
    if(/^https?:\/\//.test(item.photo)) return item.photo;
    return B.thumbs[thumbKey(item)] || '';
  }
  function catalogue(pct){
    return (state.productCatalog || []).filter(function(i){ return (i.name || '').trim() && basePrice(i) > 0; }).map(function(i){
      const base = basePrice(i);
      // Suggested retail only when set by hand: the auto D2C formula is lamp-only and
      // would put a 10 g clicker at Rs 500, which would mislead a reseller.
      const retail = i.d2cPrice != null ? (parseFloat(i.d2cPrice) || 0) : 0;
      return { id: i.id, name: i.name.trim(), category: i.category || '', kind: kindOf(i), weight: parseFloat(i.weight) || 0, hours: parseFloat(i.hours) || 0,
        color: i.color || '', size: i.size || '', material: i.material || '', photo: photoOf(i), base: base, price: tierPrice(base, pct), retail: retail };
    }).sort(function(a, b){ return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name); });
  }
  function catalogIdFor(line){
    if(line.catalogId) return line.catalogId;
    const n = (line.name || '').trim().toLowerCase();
    const hit = n && (state.productCatalog || []).find(function(i){ return (i.name || '').trim().toLowerCase() === n; });
    return hit ? hit.id : '';
  }
  function orderView(o){
    const t = orderTotals(o), ps = B.prod[o.id];
    const open = o.status === 'booked' || o.status === 'in_production';
    const noDue = o.status === 'quoted' || o.status === 'cancelled' || o.paymentStatus === 'paid' || o.paymentStatus === 'refunded';
    return {
      id: o.id, displayId: o.displayId || '', name: o.name || '', status: o.status, orderedDate: orderDate(o), dueDate: o.dueDate || '',
      productionDoneDate: o.productionDoneDate || '', deliveryDate: o.deliveryDate || '',
      lines: o.products.filter(function(p){ return (p.qty || 0) > 0; }).map(function(p){
        return { name: p.name || '', color: p.color || '', material: p.material || '', qty: p.qty || 0, made: Math.min(p.already || 0, p.qty || 0),
          unitPrice: p.actualPrice || 0, listPrice: p.listPrice || 0, catalogId: catalogIdFor(p) };
      }),
      subtotal: t.orderValue, discount: t.discount, gstRate: t.gstRate, gst: t.gstAmount, total: t.grandTotal,
      paid: o.paymentStatus === 'paid' ? t.grandTotal : (o.amountPaid || 0), due: noDue ? 0 : Math.max(0, Math.round((t.grandTotal - (o.amountPaid || 0)) * 100) / 100),
      paymentStatus: o.paymentStatus || 'unpaid', invoiceNumber: o.invoiceNumber || '',
      reservedHours: open ? Math.round(t.hours * 10) / 10 : 0,
      production: ps ? { printers: ps.printers || [], printerCount: ps.printer_count || 0, printingNow: ps.printing_now || 0,
        printHours: Math.round((ps.print_seconds || 0) / 360) / 10, platesDone: ps.plates_done || 0, platesFailed: ps.plates_failed || 0,
        unitsGood: ps.units_good || 0, unitsRejected: ps.units_rejected || 0, updatedAt: ps.updated_at || '' } : null
    };
  }
  function ordersFor(cid){
    const cutoff = isoDaysAgo(HISTORY_DAYS);
    return state.orders.filter(function(o){
      if(o.clientId !== cid || o.status === 'lost') return false;
      return ['quoted', 'booked', 'in_production', 'production_done', 'shipped'].indexOf(o.status) !== -1 || orderDate(o) >= cutoff || (o.deliveryDate || '') >= cutoff;
    }).sort(function(a, b){ return orderDate(b).localeCompare(orderDate(a)); }).slice(0, 250).map(orderView);
  }
  function buildPack(c){
    const tier = tierOf(c.id), biz = state.business || {};
    const pack = {
      type: 'tt-buyer-pack', version: 1, generatedAt: new Date().toISOString(),
      business: { name: biz.name || 'Thread Tribe Studios', phone: biz.phone || '', email: biz.email || '', gst: biz.gst || '', address: biz.address || '', gstRate: biz.gstRate || 0 },
      client: { id: c.id, name: c.name || '', contact: c.contact || '', phone: c.phone || '', email: emailOf(c), gstin: gstinOf(c), address: c.address || '', city: c.city || '', state: c.state || '' },
      // The tier name is not sent: buyers see their price, not their rank.
      terms: Object.assign(terms(), { tierPct: tier.pct, note: 'Prices are ex-GST. Orders are confirmed by Thread Tribe before production starts.' }),
      catalogue: catalogue(tier.pct),
      orders: ordersFor(c.id)
    };
    if(JSON.stringify(pack).length > 4000000) pack.catalogue.forEach(function(i){ i.photo = ''; });
    return pack;
  }

  async function publish(){
    if(!(typeof cloudIsOn === 'function' && cloudIsOn()) || B.missing || B.publishing) return;
    B.publishing = true;
    try{
      if(!B.known){
        const r = await cloud.sb.from('buyer_packs').select('client_id');
        if(r.error){ B.missing = /buyer_packs|does not exist|schema cache|relation/i.test(r.error.message || ''); return; }
        B.known = {};
        (r.data || []).forEach(function(x){ B.known[x.client_id] = 1; });
      }
      await ensureThumbs();
      const want = {};
      (state.clients || []).forEach(function(c){
        const em = emailOf(c);
        if(!c.buyerApp || !em || !isTrade(c)) return;
        const pack = buildPack(c);
        want[c.id] = { pack: pack, em: em, h: cloudHash(em + '|' + cloudCanon(Object.assign({}, pack, { generatedAt: '' }))) };
      });
      const ups = Object.keys(want).filter(function(id){ return B.hashes[id] !== want[id].h || !B.known[id]; })
        .map(function(id){ return { client_id: id, email: want[id].em, pack: want[id].pack, updated_at: new Date().toISOString() }; });
      const dels = Object.keys(B.known).filter(function(id){ return !want[id]; });
      if(ups.length){
        const r = await cloud.sb.from('buyer_packs').upsert(ups, { onConflict: 'client_id' });
        if(r.error){ console.warn('[buyers] publish', r.error); return; }
        ups.forEach(function(u){ B.hashes[u.client_id] = want[u.client_id].h; B.known[u.client_id] = 1; });
      }
      if(dels.length){
        const r = await cloud.sb.from('buyer_packs').delete().in('client_id', dels);
        if(!r.error) dels.forEach(function(id){ delete B.known[id]; delete B.hashes[id]; });
      }
      if(ups.length || dels.length){ saveHashes(); if(typeof cloudPing === 'function') cloudPing('buyers'); }
    } finally { B.publishing = false; }
  }

  async function pull(){
    if(!(typeof cloudIsOn === 'function' && cloudIsOn())) return;
    const res = await Promise.all([
      cloud.sb.from('buyer_requests').select('*').order('created_at', { ascending: false }).limit(300),
      cloud.sb.from('production_stats').select('*')
    ]);
    const r = res[0], p = res[1];
    if(r.error){
      B.missing = /buyer_requests|does not exist|schema cache|relation/i.test(r.error.message || '');
    } else {
      B.missing = false;
      const firstLoad = !B.at;
      const fresh = (r.data || []).filter(function(q){ return q.status === 'open' && !B.seen[q.id]; });
      fresh.forEach(function(q){ B.seen[q.id] = 1; });
      B.requests = r.data || [];
      B.at = Date.now();
      if(fresh.length && !firstLoad) showToast(fresh.length === 1 ? clientName(fresh[0].client_id) + ': new ' + (fresh[0].kind === 'order' ? 'order' : 'request') + ' from the Buyer app' : fresh.length + ' new Buyer app requests');
    }
    if(!p.error){ B.prod = {}; (p.data || []).forEach(function(x){ B.prod[x.order_id] = x; }); }
    await publish();
    refreshViews();
  }

  // Ride along with Studio's own sync: every pull (about every 15 s, and on live
  // pings) also pulls buyer requests; every push also republishes changed packs.
  const origPull = cloudPullReports;
  cloudPullReports = async function(){
    await origPull();
    try{ await pull(); }catch(e){ console.warn('[buyers] pull', e); }
  };
  const origPublish = cloudPublishPacks;
  cloudPublishPacks = async function(){
    await origPublish();
    try{ await publish(); }catch(e){ console.warn('[buyers] publish', e); }
  };

  // ---------- inbox actions ----------
  function client(id){ return (state.clients || []).find(function(c){ return c.id === id; }); }
  function clientName(id){ const c = client(id); return c ? (c.name || 'Client') : 'Unknown client'; }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }

  async function reply(id, status, text){
    const q = B.requests.find(function(x){ return x.id === id; });
    if(!q) return false;
    const r = await cloud.sb.from('buyer_requests').update({ status: status, reply: String(text || '').slice(0, 1000) }).eq('id', id);
    if(r.error){ showNoticeModal('Couldn’t update the request: ' + r.error.message); return false; }
    q.status = status; q.reply = text || '';
    if(typeof cloudPing === 'function') cloudPing('buyers');
    refreshViews();
    return true;
  }

  // Current prices for a request's lines, whatever the buyer's screen said.
  function priced(q){
    const c = client(q.client_id), tierPct = c ? tierOf(c.id).pct : 0;
    const rows = ((q.payload && q.payload.lines) || []).map(function(l){
      const item = (state.productCatalog || []).find(function(i){ return i.id === l.productId; });
      const base = item ? basePrice(item) : 0;
      return { line: l, item: item, qty: Math.max(0, Math.round(parseFloat(l.qty) || 0)), base: base, seen: parseFloat(l.unitPrice) || 0 };
    });
    const total = rows.reduce(function(s, x){ return s + (x.base > 0 ? x.qty : 0); }, 0);
    const pct = orderDiscount(tierPct, total);
    rows.forEach(function(x){ x.price = tierPrice(x.base, pct); });
    rows.pct = pct; rows.tierPct = tierPct; rows.slabPct = slabPct(total); rows.totalQty = total;
    return rows;
  }

  function createOrder(id){
    const q = B.requests.find(function(x){ return x.id === id; });
    const c = q && client(q.client_id);
    if(!q || !c){ showNoticeModal('That client no longer exists in Studio.'); return; }
    const lines = priced(q).filter(function(x){ return x.item && x.qty > 0 && x.base > 0; });
    if(!lines.length){ showNoticeModal('None of the products in this request are in the catalogue any more. Decline it with a note instead.'); return; }
    const order = newOrderShell('booked');
    Object.assign(order, {
      name: 'Buyer app order' + (q.payload.reference ? ' · ' + String(q.payload.reference).slice(0, 60) : ''),
      clientId: c.id, clientName: c.name || '', clientPhone: c.phone || '', clientAddress: c.address || '', clientState: c.state || '', clientGstin: gstinOf(c),
      orderSource: 'Buyer app', orderedDate: new Date().toISOString().slice(0, 10), notes: String(q.payload.notes || '').slice(0, 2000),
      buyerRequestId: q.id
    });
    order.products = lines.map(function(x){
      return { id: newId(), name: x.item.name || '', qty: x.qty, already: 0, failed: 0, hrs: x.item.hours || 0, fil: x.item.weight || 0,
        color: x.line.color || x.item.color || '', colorHex: '', material: (x.item.material || '').trim() || 'PLA', listPrice: x.base, actualPrice: x.price, catalogId: x.item.id };
    });
    state.orders.push(order);
    renderOrders(); recalcQueue(); renderInventory(); scheduleSave();
    reply(q.id, 'accepted', 'Confirmed as order ' + order.displayId + '. We’ll update you as it moves through production.');
    showToast('Order ' + order.displayId + ' created for ' + (c.name || 'client'));
  }

  function applyProfile(id){
    const q = B.requests.find(function(x){ return x.id === id; });
    const c = q && client(q.client_id);
    if(!q || !c) return;
    const p = q.payload || {};
    ['contact', 'phone', 'address', 'city', 'state', 'gstin'].forEach(function(f){ if(typeof p[f] === 'string' && p[f].trim()) c[f] = p[f].trim().slice(0, 300); });
    scheduleSave();
    if(typeof renderClients === 'function') renderClients();
    reply(q.id, 'done', 'Your details are updated.');
  }

  // ---------- view ----------
  function appUrl(){
    const cfg = (window.TT_CONFIG && window.TT_CONFIG.buyerAppUrl) || '';
    if(cfg) return cfg;
    try{ return new URL('buyer/', location.href).href; }catch(e){ return 'buyer/'; }
  }
  function openCount(){ return B.requests.filter(function(q){ return q.status === 'open'; }).length; }
  function refreshViews(){
    const n = openCount();
    const tb = document.querySelector('.tab-btn[data-tab="buyers"]');
    if(tb) tb.innerHTML = 'Buyer App' + (n ? ' <span class="pon-badge">' + n + '</span>' : '');
    const t = document.getElementById('tabBuyers');
    if(t && t.style.display !== 'none' && !(document.activeElement && t.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render();
  }

  function requestCard(q){
    const when = new Date(q.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const head = '<div class="ba-req-head"><b>' + esc(clientName(q.client_id)) + '</b><span class="ba-dim">' + esc(when) + '</span>' +
      '<span class="ba-pill ' + (q.status === 'open' ? 'warn' : q.status === 'accepted' || q.status === 'done' ? 'ok' : '') + '">' + esc(q.status) + '</span></div>';
    let body = '';
    if(q.kind === 'order'){
      const rows = priced(q);
      let total = 0;
      body = '<table class="ba-table"><tr><th>Product</th><th class="num">Qty</th><th class="num">Price now</th><th class="num">Buyer saw</th><th class="num">Line</th></tr>' +
        rows.map(function(x){
          total += x.price * x.qty;
          const warn = !x.item || !x.base ? ' <span class="ba-pill bad">not offered</span>' : x.qty < terms().minPerProduct ? ' <span class="ba-pill warn">below ' + terms().minPerProduct + ' per product</span>' : '';
          const diff = x.item && x.seen && Math.round(x.seen) !== x.price ? ' class="ba-warn"' : '';
          return '<tr><td>' + esc((x.item && x.item.name) || x.line.name || '?') + (x.line.color ? ' · ' + esc(x.line.color) : '') + warn + '</td><td class="num">' + x.qty +
            '</td><td class="num">' + money(x.price) + '</td><td class="num"' + diff + '>' + money(x.seen) + '</td><td class="num">' + money(x.price * x.qty) + '</td></tr>';
        }).join('') +
        '<tr><td colspan="4"><b>Total (ex-GST)</b> <span class="ba-dim">' + rows.totalQty + ' pcs · ' + rows.pct + '% off (tier ' + rows.tierPct + '% + quantity ' + rows.slabPct + '%' + (rows.tierPct + rows.slabPct > rows.pct ? ', capped' : '') + ')' +
          (rows.totalQty < terms().minOrder ? ' · <span class="ba-warn">below ' + terms().minOrder + ' pcs order minimum</span>' : '') + '</span></td><td class="num"><b>' + money(total) + '</b></td></tr></table>' +
        (q.payload.reorderOf ? '<div class="ba-dim">Repeat of ' + esc(q.payload.reorderOf) + '</div>' : '') +
        (q.payload.notes ? '<div class="ba-note">“' + esc(q.payload.notes) + '”</div>' : '');
    } else if(q.kind === 'profile'){
      const p = q.payload || {};
      body = '<div class="ba-dim">Asked to update their details:</div><ul class="ba-list">' +
        ['contact', 'phone', 'address', 'city', 'state', 'gstin'].filter(function(f){ return p[f]; }).map(function(f){ return '<li>' + f + ': <b>' + esc(p[f]) + '</b></li>'; }).join('') + '</ul>';
    } else {
      body = '<div class="ba-note">“' + esc((q.payload && q.payload.text) || '') + '”</div>';
    }
    let actions = '';
    if(q.status === 'open'){
      actions = '<div class="ba-actions">' +
        (q.kind === 'order' ? '<button class="ba-btn primary" data-ba="create" data-id="' + q.id + '">Create order</button>' : '') +
        (q.kind === 'profile' ? '<button class="ba-btn primary" data-ba="apply" data-id="' + q.id + '">Apply changes</button>' : '') +
        (q.kind === 'message' ? '<button class="ba-btn primary" data-ba="answer" data-id="' + q.id + '">Reply</button>' : '') +
        '<button class="ba-btn" data-ba="decline" data-id="' + q.id + '">' + (q.kind === 'message' ? 'Close' : 'Decline') + '</button></div>';
    } else if(q.reply){
      actions = '<div class="ba-dim">Reply: ' + esc(q.reply) + '</div>';
    }
    return '<div class="ba-req">' + head + body + actions + '</div>';
  }

  function render(){
    const root = document.getElementById('buyerRoot');
    if(!root) return;
    if(!(typeof cloudIsOn === 'function' && cloudIsOn())){
      root.innerHTML = '<div class="panel"><div class="panel-title">Buyer App</div><p class="ba-dim">Sign in to Cloud sync (Settings) to run the Buyer app.</p></div>';
      return;
    }
    if(B.missing){
      root.innerHTML = '<div class="panel"><div class="panel-title">Buyer App</div><p class="ba-dim">The Buyer app tables aren’t set up in the database yet. Run <code>buyer_setup.sql</code> once in Supabase → SQL Editor, then reload.</p></div>';
      return;
    }
    const open = B.requests.filter(function(q){ return q.status === 'open'; });
    const done = B.requests.filter(function(q){ return q.status !== 'open'; }).slice(0, 30);
    const hiddenD2c = (state.clients || []).filter(function(c){ return !isTrade(c); }).length;
    const clients = (state.clients || []).filter(isTrade).sort(function(a, b){ return (b.buyerApp ? 1 : 0) - (a.buyerApp ? 1 : 0) || (a.name || '').localeCompare(b.name || ''); });
    const cat = (state.productCatalog || []).filter(function(i){ return (i.name || '').trim() && kindOf(i) === 'toy'; });
    const priced = cat.filter(function(i){ return basePrice(i) > 0; });
    const unpriced = cat.filter(function(i){ return basePrice(i) <= 0; });
    const T = terms();

    let html = '<div class="panel"><div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;"><span>Buyer App</span>' +
      '<span><button class="ba-btn" data-ba="copy-link">Copy app link</button></span></div>' +
      '<p class="ba-dim">Buyers sign in at <b>' + esc(appUrl()) + '</b> with their email. They see the catalogue at their tier price, their orders with production progress, invoices and what they owe — nothing else.</p></div>';

    html += '<div class="panel"><div class="panel-title">Order requests' + (open.length ? ' <span class="pon-badge">' + open.length + '</span>' : '') + '</div>' +
      (open.length ? open.map(requestCard).join('') : '<p class="ba-dim">No open requests.</p>') +
      (done.length ? '<button class="ba-btn" data-ba="toggle-done">' + (B.showDone ? 'Hide' : 'Show') + ' answered (' + done.length + ')</button>' + (B.showDone ? done.map(requestCard).join('') : '') : '') + '</div>';

    html += '<div class="panel"><div class="panel-title">Buyers</div><p class="ba-dim">Tier = spend on orders dated in the last ' + TIER_DAYS + ' days, toys and lamps together' +
      (state.dealerRewardsEnabled === false ? '. <b>Dealer rewards are switched off in Settings, so no tier discounts apply.</b>' : '.') +
      (hiddenD2c ? ' ' + hiddenD2c + ' D2C client' + (hiddenD2c === 1 ? ' is' : 's are') + ' left out — the Buyer app is for trade clients only.' : '') + '</p>' +
      '<div style="overflow-x:auto"><table class="ba-table"><tr><th>Access</th><th>Client</th><th>Email</th><th class="num">30-day spend</th><th>Tier</th><th>Next</th></tr>' +
      clients.map(function(c){
        const em = emailOf(c), t = tierOf(c.id);
        return '<tr><td><input type="checkbox" data-ba="access" data-id="' + c.id + '"' + (c.buyerApp ? ' checked' : '') + (em ? '' : ' disabled title="Add an email in Clients first"') + '></td>' +
          '<td>' + esc(c.name || '(no name)') + (c.type ? ' <span class="ba-dim">' + esc(c.type) + '</span>' : '') + '</td>' +
          '<td>' + (em ? esc(em) : '<span class="ba-dim">no email</span>') + '</td><td class="num">' + money(t.spend) + '</td>' +
          '<td>' + (t.name ? esc(t.name) + ' · ' + t.pct + '%' : '—') + '</td>' +
          '<td class="ba-dim">' + (t.next ? money(t.next.need) + ' to ' + esc(t.next.name) : 'top tier') + '</td></tr>';
      }).join('') + '</table></div></div>';

    html += '<div class="panel"><div class="panel-title">Order discounts</div>' +
      '<p class="ba-dim">Buyers can mix products. Discount = tier % + quantity %, on the order’s total pieces, capped. Changes reach buyers on the next sync.</p>' +
      '<div class="ba-form"><label>Min per product <input type="number" min="1" data-bs="minPerProduct" value="' + T.minPerProduct + '"></label>' +
      '<label>Min per order <input type="number" min="1" data-bs="minOrder" value="' + T.minOrder + '"></label>' +
      '<label>Max total discount % <input type="number" min="0" max="100" data-bs="maxDiscount" value="' + T.maxDiscount + '"></label></div>' +
      '<table class="ba-table" style="max-width:420px"><tr><th>Order total (pcs) from</th><th class="num">Extra discount %</th><th></th></tr>' +
      T.slabs.map(function(x, i){ return '<tr><td><input type="number" min="1" data-slab="' + i + '" data-f="min" value="' + x.min + '"></td><td class="num"><input type="number" min="0" max="100" step="0.5" data-slab="' + i + '" data-f="pct" value="' + x.pct + '"></td><td><button class="ba-btn" data-ba="slab-del" data-i="' + i + '">✕</button></td></tr>'; }).join('') +
      '</table><button class="ba-btn" data-ba="slab-add">+ Add slab</button></div>';

    html += '<div class="panel"><div class="panel-title">Resale · last 90 days</div>' + resaleHtml() + '</div>';

    html += '<div class="panel"><div class="panel-title">Price check</div><p class="ba-dim">The Buyer app sells toys only. ' + priced.length + ' of ' + cat.length + ' toys have a trade price (₹' + TOY_RATE + '/g, before discounts, ex-GST). ' +
      'Suggested retail comes from the D2C price, so import the website prices to show resellers their margin.</p>' +
      (unpriced.length ? '<p class="ba-dim"><b>Not shown to buyers</b> — needs a weight in grams:</p><ul class="ba-list">' +
        unpriced.slice(0, 60).map(function(i){ return '<li>' + esc(i.name) + ' <span class="ba-dim">(' + esc(i.category || 'no category') + ', ' + (parseFloat(i.weight) || 0) + ' g)</span></li>'; }).join('') + '</ul>' : '') + '</div>';

    root.innerHTML = html;
  }
  // ---------- resale totals (from resellers' own invoices; no names or prices) ----------
  const R = { rows: null, at: 0, missing: false, loading: false };
  async function loadResale(){
    if(R.loading || !(typeof cloudIsOn === 'function' && cloudIsOn())) return;
    R.loading = true;
    try{
      const r = await cloud.sb.rpc('reseller_summary', { p_since: isoDaysAgo(90) });
      if(r.error){ R.missing = /reseller_summary|does not exist|schema cache/i.test(r.error.message || ''); R.rows = []; }
      else { R.missing = false; R.rows = r.data || []; }
      R.at = Date.now();
    } finally { R.loading = false; }
    refreshViews();
  }
  function resaleHtml(){
    if(R.missing) return '<p class="ba-dim">Run <code>buyer_tools_setup.sql</code> in Supabase to switch on reseller tools.</p>';
    if(!R.rows) return '<p class="ba-dim">Loading…</p>';
    if(!R.rows.length) return '<p class="ba-dim">No resale invoices yet. Resellers’ customer names and selling prices stay private; you see units by product and city.</p>';
    function top(key){
      const m = {};
      R.rows.forEach(function(r){ const k = r[key] || '—'; m[k] = (m[k] || 0) + (+r.units || 0); });
      return Object.keys(m).map(function(k){ return [k, m[k]]; }).sort(function(a, b){ return b[1] - a[1]; }).slice(0, 12);
    }
    function table(title, list){ return '<div><b>' + title + '</b><table class="ba-table">' + list.map(function(x){ return '<tr><td>' + esc(x[0]) + '</td><td class="num">' + Math.round(x[1]).toLocaleString('en-IN') + '</td></tr>'; }).join('') + '</table></div>'; }
    const total = R.rows.reduce(function(s, r){ return s + (+r.units || 0); }, 0);
    return '<p class="ba-dim">' + Math.round(total).toLocaleString('en-IN') + ' units resold onward. Names and selling prices stay private to each reseller.</p>' +
      '<div class="ba-cols">' + table('By product', top('product')) + table('By city', top('city')) + table('By reseller', top('client_name')) + '</div>';
  }

  window.renderBuyers = function(){
    if(!R.at || Date.now() - R.at > 300000) loadResale(); render(); if(typeof cloudIsOn === 'function' && cloudIsOn() && !B.at) pull().catch(function(e){ console.warn('[buyers]', e); }); };

  document.addEventListener('click', function(e){
    const b = e.target.closest('[data-ba]');
    if(!b || !document.getElementById('tabBuyers').contains(b)) return;
    const act = b.getAttribute('data-ba'), id = b.getAttribute('data-id');
    if(act === 'create') createOrder(id);
    else if(act === 'apply') applyProfile(id);
    else if(act === 'decline'){
      const why = prompt('Tell the buyer why (they’ll see this):', '');
      if(why !== null) reply(id, 'declined', why);
    } else if(act === 'answer'){
      const txt = prompt('Your reply (the buyer sees this):', '');
      if(txt) reply(id, 'done', txt);
    } else if(act === 'toggle-done'){ B.showDone = !B.showDone; render(); }
    else if(act === 'slab-add'){ const t = terms(); const last = t.slabs[t.slabs.length - 1]; t.slabs.push({ min: last ? last.min * 2 : 100, pct: last ? last.pct + 2 : 3 }); saveTerms(t); render(); }
    else if(act === 'slab-del'){ const t = terms(); t.slabs.splice(+b.getAttribute('data-i'), 1); saveTerms(t); render(); }
    else if(act === 'copy-link'){
      const msg = 'Thread Tribe trade app: ' + appUrl() + ' — sign in with this email to see your prices, orders and invoices.';
      (navigator.clipboard ? navigator.clipboard.writeText(msg) : Promise.reject()).then(function(){ showToast('Invite copied'); }).catch(function(){ prompt('Copy this:', msg); });
    }
  });
  function saveTerms(t){ state.buyerSettings = { minPerProduct: t.minPerProduct, minOrder: t.minOrder, maxDiscount: t.maxDiscount, slabs: t.slabs }; scheduleSave(); }
  document.addEventListener('change', function(e){
    const tab = document.getElementById('tabBuyers');
    if(tab && tab.contains(e.target) && (e.target.hasAttribute('data-bs') || e.target.hasAttribute('data-slab'))){
      const t = terms(), v = Math.max(0, parseFloat(e.target.value) || 0);
      if(e.target.hasAttribute('data-bs')) t[e.target.getAttribute('data-bs')] = Math.round(v * 10) / 10;
      else t.slabs[+e.target.getAttribute('data-slab')][e.target.getAttribute('data-f')] = v;
      t.minPerProduct = Math.max(1, Math.round(t.minPerProduct)); t.minOrder = Math.max(t.minPerProduct, Math.round(t.minOrder));
      t.maxDiscount = Math.min(100, t.maxDiscount);
      saveTerms(t); render(); showToast('Order discounts saved');
      return;
    }
    const b = e.target.closest('[data-ba="access"]');
    if(!b) return;
    const c = client(b.getAttribute('data-id'));
    if(!c) return;
    c.buyerApp = b.checked;
    scheduleSave();
    showToast(b.checked ? (c.name || 'Client') + ' can now use the Buyer app' : 'Buyer app access removed');
  });

  const css = document.createElement('style');
  css.textContent =
    '#tabBuyers .ba-dim{color:var(--dim);font-size:12px;margin:4px 0 10px}' +
    '#tabBuyers .ba-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font:12px "JetBrains Mono",monospace;cursor:pointer;margin:4px 6px 4px 0}' +
    '#tabBuyers .ba-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#0d1117;font-weight:600}' +
    '#tabBuyers .ba-req{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:10px 0}' +
    '#tabBuyers .ba-req-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px}' +
    '#tabBuyers .ba-pill{border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:11px;color:var(--dim)}' +
    '#tabBuyers .ba-pill.ok{color:var(--green);border-color:var(--green)} #tabBuyers .ba-pill.warn{color:var(--amber);border-color:var(--amber)} #tabBuyers .ba-pill.bad{color:var(--red);border-color:var(--red)}' +
    '#tabBuyers .ba-table{width:100%;border-collapse:collapse;font-size:12px}' +
    '#tabBuyers .ba-table th,#tabBuyers .ba-table td{text-align:left;padding:6px 8px;border-top:1px solid var(--line)}' +
    '#tabBuyers .ba-table th{color:var(--dim);font-weight:500}' +
    '#tabBuyers .num{text-align:right;font-variant-numeric:tabular-nums}' +
    '#tabBuyers .ba-warn{color:var(--amber)}' +
    '#tabBuyers .ba-note{margin:6px 0;font-style:italic}' +
    '#tabBuyers .ba-list{margin:4px 0 8px 18px;font-size:12px}' +
    '#tabBuyers .ba-actions{margin-top:8px}' +
    '#tabBuyers .ba-form{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0 10px}' +
    '#tabBuyers .ba-form label{font-size:12px;color:var(--dim);display:flex;flex-direction:column;gap:4px}' +
    '#tabBuyers input[type=number]{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 7px;width:90px;font:12px "JetBrains Mono",monospace}' +
    '#tabBuyers .ba-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}';
  document.head.appendChild(css);
})();
