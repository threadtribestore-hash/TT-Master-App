// ===================================================================
// ======================== SHIPTURTLE (Studio) ======================
// ===================================================================
// Orders from Shipturtle, copied every 5 minutes by tt-bridge on the workshop Mac into
// shipturtle_orders (the Shipturtle token stays on the Mac). Here each one can be imported as a
// Studio order or linked to one you already have (order.shipturtleId). For linked orders:
//   - tracking: an AWB Shipturtle has fills the order's courier and tracking number if it has none;
//     an AWB typed in Studio goes the other way, the bridge sends it to Shipturtle.
//   - payments: when Shipturtle's payment status changes, the order follows it (paid, part paid).
//     A status already applied is never re-applied, so a payment you change by hand stays.
(function(){
  if(window.TT_STOCK_MODE) return;

  const V = { rows: [], loaded: false, error: '', show: 'new', loading: false };
  const PAID = { paid: 'Paid', partially_paid: 'Part paid', pending: 'Not paid', authorized: 'Authorised', refunded: 'Refunded', partially_refunded: 'Part refunded', voided: 'Voided' };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function cfg(){ if(!state.shipturtle) state.shipturtle = {}; return state.shipturtle; }
  function localDay(d){ const x = d ? new Date(d) : new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
  function fmt(d){ if(!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  // Imports go to this client: the one chosen here, else the client named Ikiru.
  function defaultClient(){
    const cs = state.clients || [], id = cfg().clientId;
    if(id === '__none') return null;
    return cs.find(function(c){ return c.id === id; }) || cs.find(function(c){ return /ikiru/i.test(c.name || ''); }) || null;
  }
  function linked(r){ return state.orders.find(function(o){ return String(o.shipturtleId || '') === String(r.st_id); }) || null; }
  function lineText(r){ return (r.lines || []).map(function(l){ return (l.qty || 0) + ' × ' + l.title; }).join(', '); }

  async function load(){
    if(!window.cloudIsOn || !cloudIsOn() || V.loading) return;
    V.loading = true;
    try{
      const res = await cloud.sb.from('shipturtle_orders').select('*').order('order_date', { ascending: false }).limit(300);
      if(res.error) throw res.error;
      V.rows = res.data || []; V.loaded = true; V.error = '';
      if(apply()) { scheduleSave(); if(typeof renderOrders === 'function') try{ renderOrders(); }catch(e){} }
    }catch(e){
      V.error = /shipturtle_orders/.test(String(e.message || e)) ? 'Run shipturtle_setup.sql in Supabase first.' : String(e.message || e);
    }
    V.loading = false;
    render();
  }

  // Tracking and payments onto linked orders. Returns true if any order changed.
  function apply(){
    let changed = false;
    V.rows.forEach(function(r){
      const o = linked(r); if(!o) return;
      if(r.awb && !String(o.trackingNo || '').trim()){
        o.trackingNo = r.awb; if(!o.courier && r.courier) o.courier = r.courier;
        if(!o.shippedDate) o.shippedDate = localDay();
        changed = true;
      }
      if(r.tracking_link && o.trackingUrl !== r.tracking_link){ o.trackingUrl = r.tracking_link; changed = true; }
      if(r.tracking_status && o.shipturtleTracking !== r.tracking_status){ o.shipturtleTracking = r.tracking_status; changed = true; }
      const fin = r.financial_status || '';
      if(fin && o.shipturtleFin !== fin){
        o.shipturtleFin = fin;
        const st = o.paymentStatus || 'unpaid';
        if(fin === 'paid' && st !== 'paid' && st !== 'refunded'){
          o.paymentStatus = 'paid'; o.amountPaid = orderTotals(o).grandTotal;
          if(!o.paymentClearedDate) o.paymentClearedDate = localDay();
          if(!o.paymentMode) o.paymentMode = r.is_cod ? 'COD' : 'Shipturtle';
        } else if(fin === 'partially_paid' && st === 'unpaid' && r.outstanding != null){
          o.paymentStatus = 'partial'; o.amountPaid = Math.max(o.amountPaid || 0, Math.max(0, (+r.total || 0) - (+r.outstanding || 0)));
        }
        changed = true;
      }
    });
    return changed;
  }

  // A catalogue product whose name matches a Shipturtle line, if there is one.
  function catalogFor(title){
    const t = String(title || '').trim().toLowerCase(); if(!t) return null;
    const cat = state.productCatalog || [];
    return cat.find(function(c){ return (c.name || '').trim().toLowerCase() === t; }) ||
      cat.find(function(c){ const n = (c.name || '').trim().toLowerCase(); return n && (t.indexOf(n) !== -1 || n.indexOf(t) !== -1); }) || null;
  }

  function importOrder(r){
    if(linked(r)) return;
    const client = defaultClient();
    const o = newOrderShell('booked');
    o.name = 'Shipturtle ' + (r.name || r.order_number || r.st_id);
    o.shipturtleId = String(r.st_id);
    o.orderSource = 'Shipturtle';
    o.orderedDate = r.order_date ? localDay(r.order_date) : localDay();
    if(client){
      o.clientId = client.id; o.clientName = client.name || ''; o.clientPhone = client.phone || '';
      o.clientAddress = client.address || ''; o.clientGstin = client.gstin || '';
    } else {
      o.clientName = r.customer_name || r.company || ''; o.clientPhone = r.customer_phone || '';
      o.clientAddress = r.address || ''; o.clientState = r.province || '';
    }
    o.notes = ['Shipturtle ' + (r.name || r.st_id), 'Ship to: ' + [r.customer_name, r.customer_phone, r.address, r.city, r.province].filter(Boolean).join(', ')].join('\n');
    const lines = r.lines || [], qtyAll = lines.reduce(function(s, l){ return s + (+l.qty || 0); }, 0);
    const channel = o.clientId ? orderChannel(o) : 'd2c';
    // Shipturtle prices include GST; Studio lines are ex-GST and add it on the invoice.
    const rate = typeof orderGstRate === 'function' ? +orderGstRate(o) || 0 : 0;
    const exGst = function(v){ return Math.round(v / (1 + rate / 100) * 100) / 100; };
    lines.forEach(function(l){
      const cat = catalogFor(l.title), qty = +l.qty || 0;
      const fallback = exGst(+l.price || (qtyAll ? (+r.total || 0) / qtyAll : 0));
      const price = cat ? (catalogPriceForChannel(cat, channel) || fallback) : fallback;
      o.products.push({ id: newId(), name: cat ? cat.name : l.title, qty: qty, already: 0, failed: 0,
        hrs: cat ? cat.hours || 0 : 0, fil: cat ? cat.weight || 0 : 0, color: cat ? cat.color || '' : '', colorHex: '',
        material: cat ? (cat.material || '').trim() || 'PLA' : '', listPrice: price, actualPrice: price });
    });
    if(r.awb){ o.trackingNo = r.awb; o.courier = r.courier || ''; }
    if(typeof ensureOrderDefaults === 'function') ensureOrderDefaults(o);
    state.orders.push(o);
    apply(); scheduleSave();
    if(typeof renderOrders === 'function') try{ renderOrders(); }catch(e){}
    showToast(o.displayId + ' made from Shipturtle ' + (r.name || r.st_id));
    return o;
  }

  function link(r, orderId){
    const o = state.orders.find(function(x){ return x.id === orderId; }); if(!o) return;
    o.shipturtleId = String(r.st_id);
    apply(); scheduleSave();
    showToast(o.displayId + ' linked to Shipturtle ' + (r.name || r.st_id));
  }

  async function retry(r){
    const res = await cloud.sb.from('shipturtle_orders').update({ label_awb: null, label_error: null }).eq('st_id', r.st_id);
    if(res.error){ showToast('Could not retry: ' + res.error.message); return; }
    showToast('The bridge will send it again within 5 minutes'); load();
  }

  function chip(text, tone){ return '<span class="stx-chip ' + (tone || '') + '">' + esc(text) + '</span>'; }
  function payChip(r){
    const f = r.financial_status || '', label = PAID[f] || f || 'Unknown';
    return chip((r.is_cod ? 'COD · ' : '') + label, f === 'paid' ? 'good' : f === 'refunded' || f === 'voided' ? 'bad' : 'warn');
  }
  function labelState(r, o){
    if(r.label_error) return '<span class="stx-bad">Couldn’t send AWB ' + esc(r.label_awb) + ' to Shipturtle</span> <button class="stx-btn sm" data-stx="retry" data-id="' + r.st_id + '">Try again</button><div class="stx-dim stx-err">' + esc(r.label_error) + '</div>';
    if(o && o.trackingNo && r.awb !== String(o.trackingNo).trim() && r.label_awb !== String(o.trackingNo).trim()) return '<span class="stx-dim">AWB ' + esc(o.trackingNo) + ' goes to Shipturtle on the next bridge run</span>';
    if(r.label_pushed_at && !r.label_error) return '<span class="stx-good">AWB sent to Shipturtle ' + fmt(r.label_pushed_at) + '</span>';
    return '';
  }

  function rowHtml(r){
    const o = linked(r), client = defaultClient();
    const open = client ? state.orders.filter(function(x){ return x.clientId === client.id && !x.shipturtleId && ['quoted', 'booked', 'in_production', 'production_done', 'shipped'].indexOf(x.status) !== -1; }) : [];
    const action = o
      ? '<button class="stx-btn" data-stx="open" data-order="' + esc(o.id) + '">' + esc(o.displayId || 'Open order') + '</button>'
      : '<button class="stx-btn primary" data-stx="import" data-id="' + r.st_id + '">Import</button>' +
        (open.length ? '<select class="stx-link" data-id="' + r.st_id + '"><option value="">Link to…</option>' + open.map(function(x){ return '<option value="' + esc(x.id) + '">' + esc((x.displayId || '') + ' · ' + (x.name || '')) + '</option>'; }).join('') + '</select>' : '');
    const track = r.awb ? esc((r.courier ? r.courier + ' ' : '') + r.awb) + (r.tracking_status ? ' · ' + esc(r.tracking_status) : '') : '<span class="stx-dim">No AWB yet</span>';
    return '<div class="stx-row' + (o ? ' done' : '') + '">' +
      '<div class="stx-main"><div class="stx-name">' + esc(r.name || r.order_number || r.st_id) + ' <span class="stx-dim">' + fmt(r.order_date) + '</span></div>' +
        '<div class="stx-who">' + esc([r.customer_name, r.company, r.city].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="stx-dim">' + esc(lineText(r)) + '</div></div>' +
      '<div class="stx-mid"><div class="stx-amt">' + money(r.total) + '</div>' + payChip(r) + '</div>' +
      '<div class="stx-track">' + track + '<div>' + labelState(r, o) + '</div></div>' +
      '<div class="stx-act">' + action + '</div></div>';
  }

  function render(){
    const root = document.getElementById('shipturtleRoot'); if(!root) return;
    if(!window.cloudIsOn || !cloudIsOn()){ root.innerHTML = head() + '<div class="panel stx-dim">Sign in to cloud sync to see Shipturtle orders.</div>'; return; }
    if(V.error){ root.innerHTML = head() + '<div class="panel stx-bad">' + esc(V.error) + '</div>'; return; }
    if(!V.loaded){ root.innerHTML = head() + '<div class="panel stx-dim">Loading Shipturtle orders…</div>'; return; }
    const fresh = V.rows.filter(function(r){ return !linked(r); }), done = V.rows.filter(linked);
    const unpaid = done.filter(function(r){ const o = linked(r); return o && (o.paymentStatus || 'unpaid') !== 'paid' && (o.paymentStatus || '') !== 'refunded'; });
    const noAwb = done.filter(function(r){ const o = linked(r); return o && !o.trackingNo && !r.awb; });
    const list = V.show === 'linked' ? done : V.show === 'all' ? V.rows : fresh;
    const last = V.rows.reduce(function(m, r){ return r.fetched_at > m ? r.fetched_at : m; }, '');
    const clients = (state.clients || []).slice().sort(function(a, b){ return (a.name || '').localeCompare(b.name || ''); });
    const dc = defaultClient();
    const tab = function(v, t, n){ return '<button class="stx-tab' + (V.show === v ? ' on' : '') + '" data-stx-show="' + v + '">' + t + ' <b>' + n + '</b></button>'; };
    root.innerHTML = head(last) +
      '<div class="stx-kpis">' +
        kpi('To import', fresh.length, 'new in Shipturtle') +
        kpi('Linked', done.length, 'orders in Studio') +
        kpi('Awaiting payment', unpaid.length, money(unpaid.reduce(function(s, r){ const o = linked(r); return s + (o ? Math.max(0, orderTotals(o).grandTotal - (o.amountPaid || 0)) : 0); }, 0)) + ' due') +
        kpi('No AWB yet', noAwb.length, 'linked, not shipped') +
      '</div>' +
      '<div class="stx-bar"><div class="stx-tabs">' + tab('new', 'To import', fresh.length) + tab('linked', 'Linked', done.length) + tab('all', 'All', V.rows.length) + '</div>' +
        '<label class="stx-dim">Import for <select id="stxClient"><option value="">No client (customer details)</option>' +
        clients.map(function(c){ return '<option value="' + esc(c.id) + '"' + (dc && dc.id === c.id ? ' selected' : '') + '>' + esc(c.name || 'Untitled') + '</option>'; }).join('') + '</select></label>' +
        '<button class="stx-btn" data-stx="reload">Refresh</button></div>' +
      '<div class="panel stx-list">' + (list.length ? list.map(rowHtml).join('') : '<div class="stx-dim stx-empty">' + (V.rows.length ? 'Nothing here.' : 'No Shipturtle orders yet. Once SHIPTURTLE_TOKEN is in bridge.env on the Mac, orders from the last 30 days show up within 5 minutes.') + '</div>') + '</div>';
  }
  function head(last){
    return '<div class="stx-head"><div class="stx-title">Shipturtle</div><div class="stx-dim">Orders, tracking and payments from Shipturtle' + (last ? ' · bridge last ran ' + new Date(last).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + ' ' + fmt(last) : '') + '</div></div>';
  }
  function kpi(k, v, s){ return '<div class="stx-kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + esc(s) + '</div></div>'; }

  window.renderShipturtle = function(){ render(); load(); };
  window.TTShipturtle = {
    rows: function(){ return V.rows; },
    forOrder: function(o){ return V.rows.find(function(r){ return String(r.st_id) === String(o.shipturtleId || ''); }) || null; },
    needs: function(){
      const fresh = V.rows.filter(function(r){ return !linked(r); }).length;
      const failed = V.rows.filter(function(r){ return r.label_error; }).length;
      const out = [];
      if(fresh) out.push({ level: 1, rank: 2, score: fresh, text: fresh + ' Shipturtle order' + (fresh === 1 ? '' : 's') + ' not in Studio yet', act: 'tab', id: 'shipturtle', btn: 'Import' });
      if(failed) out.push({ level: 1, rank: 1, score: failed, text: failed + ' AWB' + (failed === 1 ? '' : 's') + ' couldn’t be sent to Shipturtle', act: 'tab', id: 'shipturtle', btn: 'Check' });
      return out;
    },
    load: load
  };

  document.addEventListener('click', function(e){
    const t = document.getElementById('tabShipturtle'); if(!t || !t.contains(e.target)) return;
    const sv = e.target.closest('[data-stx-show]'); if(sv){ V.show = sv.getAttribute('data-stx-show'); render(); return; }
    const b = e.target.closest('[data-stx]'); if(!b) return;
    const a = b.getAttribute('data-stx'), r = V.rows.find(function(x){ return String(x.st_id) === b.getAttribute('data-id'); });
    if(a === 'reload') load();
    else if(a === 'import' && r){ importOrder(r); render(); }
    else if(a === 'retry' && r) retry(r);
    else if(a === 'open'){ const id = b.getAttribute('data-order'); if(typeof openOrderDetailModal === 'function') openOrderDetailModal(id); }
  });
  document.addEventListener('change', function(e){
    const t = document.getElementById('tabShipturtle'); if(!t || !t.contains(e.target)) return;
    if(e.target.id === 'stxClient'){ cfg().clientId = e.target.value || '__none'; scheduleSave(); render(); return; }
    if(e.target.classList.contains('stx-link') && e.target.value){
      const r = V.rows.find(function(x){ return String(x.st_id) === e.target.getAttribute('data-id'); });
      if(r){ link(r, e.target.value); render(); }
    }
  });

  // Keep tracking and payments current in the background, not only when the tab is open.
  let tries = 0;
  const boot = setInterval(function(){ tries++; if(window.cloudIsOn && cloudIsOn()){ clearInterval(boot); load(); } else if(tries > 60) clearInterval(boot); }, 3000);
  setInterval(function(){ if(document.visibilityState === 'visible') load(); }, 10 * 60 * 1000);

  const css = document.createElement('style');
  css.textContent = [
    '#tabShipturtle{font-family:"Space Grotesk",sans-serif}',
    '#tabShipturtle .stx-head{margin:4px 0 14px} #tabShipturtle .stx-title{font-size:26px;font-weight:700;color:var(--text)}',
    '#tabShipturtle .stx-dim{color:var(--dim);font-size:12.5px} #tabShipturtle .stx-good{color:var(--green);font-size:12.5px} #tabShipturtle .stx-bad{color:var(--red);font-size:12.5px}',
    '#tabShipturtle .stx-err{font-family:"JetBrains Mono",monospace;font-size:11px;word-break:break-word;margin-top:2px}',
    '#tabShipturtle .stx-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}',
    '#tabShipturtle .stx-kpi{background:var(--input-bg);border-radius:12px;padding:10px 12px} #tabShipturtle .stx-kpi .k{font:10.5px "JetBrains Mono",monospace;letter-spacing:1px;text-transform:uppercase;color:var(--dim)} #tabShipturtle .stx-kpi .v{font-size:22px;font-weight:700;margin-top:3px} #tabShipturtle .stx-kpi .s{font-size:12px;color:var(--dim)}',
    '#tabShipturtle .stx-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px} #tabShipturtle .stx-bar select{margin-left:6px;max-width:220px}',
    '#tabShipturtle .stx-tabs{display:flex;gap:4px;background:var(--input-bg);border-radius:12px;padding:4px;margin-right:auto}',
    '#tabShipturtle .stx-tab{border:none;background:transparent;border-radius:9px;padding:7px 13px;font:13.5px "Space Grotesk",sans-serif;color:var(--dim);cursor:pointer} #tabShipturtle .stx-tab b{font-family:"JetBrains Mono",monospace;font-weight:600;margin-left:3px}',
    '#tabShipturtle .stx-tab.on{background:var(--panel);color:var(--text);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '#tabShipturtle .stx-list{padding:4px 14px} #tabShipturtle .stx-empty{padding:18px 0}',
    '#tabShipturtle .stx-row{display:grid;grid-template-columns:minmax(200px,1.6fr) 120px minmax(170px,1.2fr) auto;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line)} #tabShipturtle .stx-row:first-child{border-top:none}',
    '#tabShipturtle .stx-name{font-weight:600;font-size:14.5px} #tabShipturtle .stx-who{font-size:13px;margin:2px 0}',
    '#tabShipturtle .stx-amt{font:600 14px "JetBrains Mono",monospace;margin-bottom:4px} #tabShipturtle .stx-track{font-size:13px}',
    '#tabShipturtle .stx-act{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap} #tabShipturtle .stx-act select{max-width:170px}',
    '#tabShipturtle .stx-chip{display:inline-block;font-size:11.5px;border-radius:999px;padding:2px 9px;background:var(--input-bg);color:var(--text)}',
    '#tabShipturtle .stx-chip.good{color:var(--green)} #tabShipturtle .stx-chip.warn{color:var(--amber)} #tabShipturtle .stx-chip.bad{color:var(--red)}',
    '#tabShipturtle .stx-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:7px 13px;font:13px "Space Grotesk",sans-serif;cursor:pointer;white-space:nowrap}',
    '#tabShipturtle .stx-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600} #tabShipturtle .stx-btn.sm{padding:3px 9px;font-size:12px}',
    '@media (max-width:760px){#tabShipturtle .stx-row{grid-template-columns:1fr auto}#tabShipturtle .stx-track{grid-column:1/-1}#tabShipturtle .stx-act{grid-column:1/-1;justify-content:flex-start}}'
  ].join('');
  document.head.appendChild(css);
})();
