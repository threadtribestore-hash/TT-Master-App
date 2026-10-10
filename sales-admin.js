// ===================================================================
// ========================= SALES (Studio) ==========================
// ===================================================================
// The sales team works in the Sales app (TT-Sales-App): leads, visits and follow-ups across
// three channels. Studio manages the team and monthly targets, turns won leads into clients,
// and publishes the sales pack (catalogue per channel, accounts, this month's sales) the app reads.
// Tables: sales_reps, sales_leads, sales_activities, sales_pack (sales_setup.sql).
(function(){
  if(window.TT_STOCK_MODE) return;

  const CH = { toys: 'Toys', lighting: 'Lighting', gifting: 'HoReCa & gifting' };
  const CH_ICON = { toys: '🧸', lighting: '💡', gifting: '🎁' };
  const CH_TYPE = { toys: 'Reseller', lighting: 'Lamp wholesaler', gifting: 'Corporate' };
  const SALES_APP_URL = 'https://threadtribestore-hash.github.io/TT-Sales-App/';
  const STAGES = [['new', 'New'], ['contacted', 'Contacted'], ['meeting', 'Meeting'], ['quote', 'Quote / sample'], ['won', 'Won'], ['lost', 'Lost']];
  const X = { reps: [], leads: [], acts: [], missing: false, loaded: false, hashes: {}, publishing: false };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function today(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysAgo(n){ const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function salesUrl(){ return (window.TT_CONFIG && window.TT_CONFIG.salesAppUrl) || SALES_APP_URL; }
  function stageName(k){ const s = STAGES.find(function(x){ return x[0] === k; }); return s ? s[1] : k; }
  function repName(email){ const r = X.reps.find(function(x){ return x.email === email; }); return r ? r.name : (email || '').split('@')[0]; }

  // ---------- channels ----------
  // A client's channel: set by hand (or by the won lead it came from), otherwise read from its type.
  function inferChannel(c){
    const t = ((c.type || '') + ' ' + (c.notes || '')).toLowerCase();
    if(/\bd2c\b|consumer|individual/.test(t)) return '';
    if(/design|architect|interior|studio|light|lamp|electrical|builder/.test(t)) return 'lighting';
    if(/hotel|restaurant|caf[eé]|horeca|corporate|gift|hamper|event/.test(t)) return 'gifting';
    return 'toys';
  }
  function channelOf(c){ return c.salesChannel || inferChannel(c); }
  function counts(o){ return ['quoted', 'lost', 'cancelled'].indexOf(o.status) === -1; }
  function orderDate(o){ return o.orderedDate || o.productionStartDate || o.quotedDate || o.dueDate || ''; }

  // ---------- data ----------
  async function load(){
    if(!on()) return;
    const r = await cloud.sb.from('sales_reps').select('email,name,channel,active').order('name');
    if(r.error){ X.missing = /sales_reps|does not exist|schema cache|relation/i.test(r.error.message || ''); X.loaded = true; return; }
    const since = new Date(Date.now() - 62 * 86400000).toISOString();
    const res = await Promise.all([
      cloud.sb.from('sales_leads').select('id,channel,stage,owner_email,data,updated_at').order('updated_at', { ascending: false }).limit(5000),
      cloud.sb.from('sales_activities').select('id,lead_id,kind,author_email,created_at').gte('created_at', since).limit(10000)
    ]);
    X.missing = false; X.loaded = true;
    X.reps = r.data || []; X.leads = res[0].data || []; X.acts = res[1].data || [];
    badge();
  }
  function wonToSetUp(){ return X.leads.filter(function(l){ return l.stage === 'won' && !(l.data || {}).clientId; }); }
  function badge(){
    const b = document.querySelector('.tab-btn[data-tab="sales"]'), n = wonToSetUp().length;
    if(b) b.innerHTML = 'Sales' + (n ? ' <span class="pon-badge">' + n + '</span>' : '');
  }

  // ---------- the pack the Sales app reads ----------
  function httpPhoto(p){ return typeof p === 'string' && /^https:\/\//.test(p) ? p : ''; }
  function catalogue(){
    const out = { toys: [], lighting: [], gifting: [] };
    const toys = window.TTBuyers && window.TTBuyers.catalogue ? window.TTBuyers.catalogue() : [];
    toys.forEach(function(t){
      if(t.onRequest) return;
      const handle = /^web:/.test(t.id) ? t.id.slice(4) : '';
      out.toys.push({ id: t.id, name: t.name, category: t.category || '', photo: httpPhoto(t.photo), trade: t.onRequest ? 0 : t.price, mrp: t.retail || 0,
        url: handle ? 'https://threadtribe.co/products/' + handle : '' });
    });
    (state.productCatalog || []).forEach(function(i){
      const s = ((i.category || '') + ' ' + (i.name || '')).toLowerCase();
      const ch = /lamp|light|pendant|chandelier|sconce|wall/.test(s) ? 'lighting' : /hamper|gift|coaster|planter|decor|candle|tray|organi[sz]er|keychain/.test(s) ? 'gifting' : '';
      if(!ch || !(i.name || '').trim()) return;
      out[ch].push({ id: i.id, name: i.name.trim(), category: i.category || '', photo: httpPhoto(i.photo), trade: parseFloat(i.wholesalePrice) || 0, mrp: parseFloat(i.d2cPrice) || 0, url: '' });
    });
    Object.keys(out).forEach(function(k){ out[k].sort(function(a, b){ return a.name.localeCompare(b.name); }); });
    return out;
  }
  // An order as the sales team sees it: status, pieces made, dispatch, tracking and what's still to collect.
  function orderView(o){
    if(window.TTBuyers && window.TTBuyers.orderView){
      const v = window.TTBuyers.orderView(o);
      return { id: v.id, displayId: v.displayId, name: v.name, status: v.status, orderedDate: v.orderedDate, dueDate: v.dueDate, dispatchBy: v.dispatchBy, shippedDate: v.shippedDate,
        deliveryDate: v.deliveryDate, courier: v.courier, trackingNo: v.trackingNo, lines: v.lines.map(function(l){ return { name: l.name, color: l.color, qty: l.qty, made: l.made, unitPrice: l.unitPrice }; }),
        total: Math.round(v.total), paid: Math.round(v.paid), due: Math.round(v.due), paymentStatus: v.paymentStatus, invoiceNumber: v.invoiceNumber,
        printers: v.production ? v.production.printingNow : 0, printedGood: v.production ? v.production.unitsGood : 0 };
    }
    const t = orderTotals(o);
    return { id: o.id, displayId: o.displayId || '', name: o.name || '', status: o.status === 'production_done' && o.shippedDate ? 'shipped' : o.status, orderedDate: orderDate(o), dueDate: o.dueDate || '',
      dispatchBy: o.dispatchBy || '', shippedDate: o.shippedDate || '', deliveryDate: o.deliveryDate || '', courier: o.courier || '', trackingNo: o.trackingNo || '',
      lines: (o.products || []).filter(function(p){ return (p.qty || 0) > 0; }).map(function(p){ return { name: p.name || '', color: p.color || '', qty: p.qty || 0, made: Math.min(p.already || 0, p.qty || 0), unitPrice: p.actualPrice || 0 }; }),
      total: Math.round(t.grandTotal || t.orderValue || 0), paid: Math.round(o.amountPaid || 0), due: 0, paymentStatus: o.paymentStatus || 'unpaid', invoiceNumber: o.invoiceNumber || '', printers: 0 };
  }
  function accounts(ch){
    const cut90 = daysAgo(90);
    return (state.clients || []).map(function(c){
      if(channelOf(c) !== ch) return null;
      let last = '', value90 = 0, lifetime = 0, count = 0;
      const mine = state.orders.filter(function(o){ return o.clientId === c.id && counts(o); });
      mine.forEach(function(o){
        const d = orderDate(o), v = orderTotals(o).orderValue || 0;
        if(d > last) last = d;
        if(d >= cut90) value90 += v;
        lifetime += v; count++;
      });
      const isOpen = function(o){ return ['booked', 'in_production', 'production_done'].indexOf(o.status) !== -1; };
      const current = mine.filter(isOpen).sort(function(a, b){ return orderDate(a).localeCompare(orderDate(b)); }).slice(0, 20).map(orderView);
      const recent = mine.filter(function(o){ return !isOpen(o); }).sort(function(a, b){ return orderDate(b).localeCompare(orderDate(a)); }).slice(0, 5).map(orderView);
      const views = current.concat(recent);
      const days = last ? Math.round((new Date(today() + 'T00:00:00') - new Date(last.slice(0, 10) + 'T00:00:00')) / 86400000) : null;
      return { id: c.id, name: c.name || 'Client', type: c.type || '', city: c.city || '', contact: c.contact || '', phone: c.phone || '', email: c.email || '',
        address: c.address || '', gstin: c.gstin || '', instagram: c.instagram || '', channel: ch, buyerApp: !!c.buyerApp, lastOrder: last.slice(0, 10), daysSince: days,
        value90: Math.round(value90), lifetime: Math.round(lifetime), orderCount: count, openOrders: current.length,
        due: views.reduce(function(t, o){ return t + (o.due || 0); }, 0), orders: current, recent: recent };
    }).filter(Boolean);
  }
  function actuals(){
    const m = today().slice(0, 7), out = {}, byId = {};
    Object.keys(CH).forEach(function(k){ out[k] = { revenueMonth: 0, ordersMonth: 0, newAccountsMonth: 0 }; });
    (state.clients || []).forEach(function(c){ byId[c.id] = c; });
    const first = {};
    state.orders.forEach(function(o){
      if(!counts(o) || !byId[o.clientId]) return;
      const d = orderDate(o), ch = channelOf(byId[o.clientId]); if(!ch) return;
      if(!first[o.clientId] || d < first[o.clientId]) first[o.clientId] = d;
      if(d.slice(0, 7) === m){ out[ch].revenueMonth += orderTotals(o).orderValue || 0; out[ch].ordersMonth++; }
    });
    Object.keys(first).forEach(function(id){ const ch = channelOf(byId[id]); if(ch && first[id].slice(0, 7) === m) out[ch].newAccountsMonth++; });
    Object.keys(out).forEach(function(k){ out[k].revenueMonth = Math.round(out[k].revenueMonth); });
    return out;
  }
  function targets(){
    const t = state.salesTargets || {};
    const out = {};
    Object.keys(CH).forEach(function(k){ out[k] = Object.assign({ leads: 20, meetings: 30, won: 4, revenue: 0 }, t[k] || {}); });
    return out;
  }
  async function publish(){
    if(!on() || X.missing || X.publishing) return;
    X.publishing = true;
    try{
      if(window.TTBuyers && window.TTBuyers.loadWeb){ try{ await window.TTBuyers.loadWeb(); }catch(e){} }
      // 'main' is for the whole team; each channel's clients, orders and catalogue go in their own row,
      // which only that channel's salesperson (and admins) can read.
      const cat = catalogue(), rows = [{ id: 'main', pack: { targets: targets(), actuals: actuals(), salesAppUrl: salesUrl() } }];
      Object.keys(CH).forEach(function(ch){ rows.push({ id: ch, pack: { channel: ch, accounts: accounts(ch), catalogue: cat[ch] } }); });
      const changed = rows.filter(function(r){ return JSON.stringify(r.pack) !== X.hashes[r.id]; });
      if(!changed.length) return;
      const at = new Date().toISOString();
      const r = await cloud.sb.from('sales_pack').upsert(changed.map(function(x){ return { id: x.id, pack: Object.assign({ generatedAt: at }, x.pack) }; }), { onConflict: 'id' });
      if(r.error){ if(/sales_pack|does not exist|schema cache|relation/i.test(r.error.message || '')) X.missing = true; return; }
      changed.forEach(function(x){ X.hashes[x.id] = JSON.stringify(x.pack); });
    } finally { X.publishing = false; }
  }
  if(typeof cloudPublishPacks === 'function'){
    const origPublish = cloudPublishPacks;
    cloudPublishPacks = async function(){
      const r = await origPublish.apply(this, arguments);
      try{ await publish(); }catch(e){ console.warn('[sales] publish', e); }
      return r;
    };
  }
  if(typeof cloudPullReports === 'function'){
    const origPull = cloudPullReports;
    cloudPullReports = async function(){
      const r = await origPull.apply(this, arguments);
      try{ await load(); await publish(); refresh(); }catch(e){}
      return r;
    };
  }

  // ---------- numbers ----------
  function kpis(email, ch){
    const m = today().slice(0, 7), leadCh = {};
    X.leads.forEach(function(l){ leadCh[l.id] = l.channel; });
    const acts = X.acts.filter(function(a){ return (a.created_at || '').slice(0, 7) === m && (!email || a.author_email === email) && (!ch || leadCh[a.lead_id] === ch); });
    const won = X.leads.filter(function(l){ return l.stage === 'won' && ((l.data || {}).wonAt || '').slice(0, 7) === m && (!email || l.owner_email === email) && (!ch || l.channel === ch); });
    return {
      leads: X.leads.filter(function(l){ return ((l.data || {}).createdAt || '').slice(0, 7) === m && (!email || l.data.createdBy === email) && (!ch || l.channel === ch); }).length,
      meetings: acts.filter(function(a){ return a.kind === 'visit' || a.kind === 'meeting'; }).length,
      touches: acts.filter(function(a){ return a.kind !== 'stage'; }).length, won: won.length, wonValue: won.reduce(function(t, l){ return t + (+l.data.wonValue || 0); }, 0)
    };
  }
  function pct(v, t){ return t ? Math.min(100, Math.round(100 * v / t)) : 0; }
  function meter(v, t, fmt){ return '<div class="sa-meter"><i style="width:' + pct(v, t) + '%;background:' + (t && v >= t ? 'var(--green)' : 'var(--cyan)') + '"></i></div><span class="sa-dim">' + (fmt ? fmt(v) : v) + (t ? ' / ' + (fmt ? fmt(t) : t) : '') + '</span>'; }

  // ---------- view ----------
  function render(){
    const root = document.getElementById('salesRoot'); if(!root) return;
    if(!on()){ root.innerHTML = '<div class="panel"><p class="sa-dim">Sign in to Cloud sync to use Sales.</p></div>'; return; }
    if(X.missing){ root.innerHTML = '<div class="panel"><p class="sa-dim">Run <code>sales_setup.sql</code> in Supabase → SQL Editor to switch on the Sales app, then reload.</p></div>'; return; }
    if(!X.loaded){ root.innerHTML = '<div class="panel"><p class="sa-dim">Loading…</p></div>'; return; }
    const T = targets(), A = actuals();
    let h = '';
    // won leads waiting to become clients
    const setUp = wonToSetUp();
    if(setUp.length) h += '<div class="panel sa-alert"><div class="panel-title">🎉 Won — set up as clients <span class="sa-dim">' + setUp.length + '</span></div>' + setUp.map(function(l){
      const d = l.data || {};
      const matches = (state.clients || []).filter(function(c){ const a = (c.name || '').toLowerCase(), b = (d.business || '').toLowerCase(); return b && a && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1); });
      return '<div class="sa-row"><div><b>' + esc(d.business || d.contact || 'Lead') + '</b> <span class="sa-dim">' + CH_ICON[l.channel] + ' ' + esc(CH[l.channel] || '') + ' · won by ' + esc(repName(l.owner_email)) + (d.wonValue ? ' · first order ~' + money(d.wonValue) : '') + '</span>' +
        '<div class="sa-dim">' + esc([d.contact, d.phone, d.email, d.instagram ? '@' + d.instagram : '', d.market, d.city, d.gstin].filter(Boolean).join(' · ')) + '</div>' + (d.wonNote ? '<div>“' + esc(d.wonNote) + '”</div>' : '') + '</div>' +
        '<div><button class="sa-btn primary" data-sa="make-client" data-id="' + esc(l.id) + '">Create client</button>' +
        (matches.length ? '<select data-sa-link="' + esc(l.id) + '"><option value="">…or link to existing</option>' + matches.map(function(c){ return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' : '') + '</div></div>';
    }).join('') + '</div>';

    // this month by channel
    h += '<div class="panel"><div class="panel-title">This month by channel</div><div class="sa-grid">' + Object.keys(CH).map(function(ch){
      const k = kpis('', ch), t = T[ch], ls = X.leads.filter(function(l){ return l.channel === ch; });
      return '<div class="sa-card"><b>' + CH_ICON[ch] + ' ' + CH[ch] + '</b>' +
        '<div class="sa-kv"><span>New leads</span>' + meter(k.leads, t.leads) + '</div><div class="sa-kv"><span>Meetings & visits</span>' + meter(k.meetings, t.meetings) + '</div>' +
        '<div class="sa-kv"><span>Won</span>' + meter(k.won, t.won) + '</div><div class="sa-kv"><span>Sales (orders)</span>' + meter(A[ch].revenueMonth, t.revenue, money) + '</div>' +
        '<div class="sa-dim" style="margin-top:6px">Pipeline: ' + ['new', 'contacted', 'meeting', 'quote'].map(function(s){ return stageName(s) + ' ' + ls.filter(function(l){ return l.stage === s; }).length; }).join(' · ') + '</div>' +
        '<div class="sa-dim">' + A[ch].ordersMonth + ' orders · ' + A[ch].newAccountsMonth + ' new accounts this month</div></div>';
    }).join('') + '</div></div>';

    // team
    h += '<div class="panel"><div class="panel-title" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>Team</span><span><button class="sa-btn" data-sa="copy-link">Copy app link</button></span></div>' +
      '<p class="sa-dim">Each salesperson signs in to the Sales app with the email below (a code is emailed — no password). Everyone sees the whole pipeline.</p>' +
      '<table class="ba-table"><tr><th>Name</th><th>Email</th><th>Channel</th><th>This month</th><th></th></tr>' + X.reps.map(function(r){
        const k = kpis(r.email, '');
        return '<tr' + (r.active ? '' : ' style="opacity:.5"') + '><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.email) + '</td>' +
          '<td><select data-sa-rep="channel" data-id="' + esc(r.email) + '">' + Object.keys(CH).map(function(c){ return '<option value="' + c + '"' + (r.channel === c ? ' selected' : '') + '>' + CH[c] + '</option>'; }).join('') + '</select></td>' +
          '<td class="sa-dim">' + k.leads + ' leads · ' + k.meetings + ' meetings · ' + k.won + ' won</td>' +
          '<td><button class="sa-btn" data-sa="invite" data-id="' + esc(r.email) + '">Invite</button><button class="sa-btn" data-sa="toggle-rep" data-id="' + esc(r.email) + '">' + (r.active ? 'Pause' : 'Re-activate') + '</button></td></tr>';
      }).join('') + '</table>' +
      '<div class="sa-add"><input id="saName" placeholder="Name"><input id="saEmail" type="email" placeholder="work email"><select id="saCh">' + Object.keys(CH).map(function(c){ return '<option value="' + c + '">' + CH[c] + '</option>'; }).join('') + '</select><button class="sa-btn primary" data-sa="add-rep">Add to team</button></div></div>';

    // targets
    h += '<div class="panel"><div class="panel-title">Monthly targets</div><table class="ba-table"><tr><th>Channel</th><th>New leads</th><th>Meetings & visits</th><th>Won accounts</th><th>Sales ₹</th></tr>' + Object.keys(CH).map(function(ch){
      return '<tr><td>' + CH_ICON[ch] + ' ' + CH[ch] + '</td>' + ['leads', 'meetings', 'won', 'revenue'].map(function(f){ return '<td><input type="number" min="0" data-sa-target="' + ch + ':' + f + '" value="' + (T[ch][f] || 0) + '" style="width:' + (f === 'revenue' ? 110 : 70) + 'px"></td>'; }).join('') + '</tr>';
    }).join('') + '</table><p class="sa-dim">The Sales app shows each person their channel’s targets. Sales ₹ counts this month’s orders from that channel’s clients.</p></div>';

    // recent activity + lost reasons
    const recent = X.leads.filter(function(l){ return l.stage === 'lost' && ((l.data || {}).lostAt || '') >= daysAgo(60); });
    const why = {}; recent.forEach(function(l){ const r = String(l.data.lostReason || 'Other').split(' — ')[0]; why[r] = (why[r] || 0) + 1; });
    if(recent.length) h += '<div class="panel"><div class="panel-title">Why we lost deals (60 days)</div>' + Object.keys(why).sort(function(a, b){ return why[b] - why[a]; }).map(function(k){ return '<div class="sa-kv"><span>' + esc(k) + '</span><b>' + why[k] + '</b></div>'; }).join('') + '</div>';

    // channel for each client
    const cl = (state.clients || []).filter(function(c){ return inferChannel(c) || c.salesChannel; }).sort(function(a, b){ return (a.name || '').localeCompare(b.name || ''); });
    h += '<div class="panel"><div class="panel-title">Client channels <span class="sa-dim">' + cl.length + '</span></div><p class="sa-dim">Which channel each client belongs to — used for the Accounts list and channel sales. Worked out from the client type unless you set it.</p>' +
      '<details><summary class="sa-dim" style="cursor:pointer">Show clients</summary><table class="ba-table">' + cl.map(function(c){
        return '<tr><td>' + esc(c.name || 'Client') + ' <span class="sa-dim">' + esc(c.type || '') + '</span></td><td><select data-sa-client="' + esc(c.id) + '">' + Object.keys(CH).map(function(k){ return '<option value="' + k + '"' + (channelOf(c) === k ? ' selected' : '') + '>' + CH[k] + (inferChannel(c) === k && !c.salesChannel ? ' (auto)' : '') + '</option>'; }).join('') + '</select></td></tr>';
      }).join('') + '</table></details></div>';
    root.innerHTML = h;
  }
  function refresh(){
    const t = document.getElementById('tabSales');
    if(t && t.style.display !== 'none' && !(document.activeElement && t.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) render();
  }
  window.renderSales = function(){ render(); load().then(function(){ render(); publish(); }); };

  // ---------- actions ----------
  async function upsertRep(r){
    const res = await cloud.sb.from('sales_reps').upsert(r, { onConflict: 'email' });
    if(res.error){ showNoticeModal('Couldn’t save: ' + res.error.message); return false; }
    return true;
  }
  async function linkLead(l, clientId){
    l.data = Object.assign({}, l.data, { clientId: clientId, setUpAt: new Date().toISOString() });
    const r = await cloud.sb.from('sales_leads').update({ data: l.data }).eq('id', l.id);
    if(r.error){ showNoticeModal('Client saved, but the lead couldn’t be updated: ' + r.error.message); return false; }
    return true;
  }
  document.addEventListener('click', async function(e){
    const tab = document.getElementById('tabSales'); if(!tab || !tab.contains(e.target)) return;
    const b = e.target.closest('[data-sa]'); if(!b) return;
    const act = b.getAttribute('data-sa'), id = b.getAttribute('data-id');
    if(act === 'add-rep'){
      const name = (document.getElementById('saName').value || '').trim(), email = (document.getElementById('saEmail').value || '').trim().toLowerCase();
      if(!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showToast('Add a name and a valid email'); return; }
      if(await upsertRep({ email: email, name: name.slice(0, 80), channel: document.getElementById('saCh').value, active: true })){ await load(); render(); showToast(name + ' added — send them the invite'); }
    } else if(act === 'toggle-rep'){
      const r = X.reps.find(function(x){ return x.email === id; }); if(!r) return;
      if(await upsertRep({ email: r.email, name: r.name, channel: r.channel, active: !r.active })){ await load(); render(); }
    } else if(act === 'invite'){
      const r = X.reps.find(function(x){ return x.email === id; }); if(!r) return;
      const msg = 'Hi ' + r.name.split(' ')[0] + '! Here’s the Thread Tribe Sales app for ' + CH[r.channel] + ': ' + salesUrl() + '\n\nSign in with ' + r.email + ' — you’ll get a 6-digit code by email. On your phone, tap Share → Add to Home Screen so it opens like an app.\n\nLog every lead, call and visit there, and set a next follow-up so nothing goes cold.';
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    } else if(act === 'copy-link'){
      (navigator.clipboard ? navigator.clipboard.writeText(salesUrl()) : Promise.reject()).then(function(){ showToast('Sales app link copied'); }).catch(function(){ prompt('Sales app link:', salesUrl()); });
    } else if(act === 'make-client'){
      const l = X.leads.find(function(x){ return x.id === id; }); if(!l) return;
      const d = l.data || {};
      if(!confirm('Create client “' + (d.business || d.contact) + '” in Studio?')) return;
      const c = { id: newId(), name: (d.business || d.contact || 'Client').slice(0, 120), type: d.type || CH_TYPE[l.channel] || '', city: d.city || '', address: [d.address, d.market].filter(Boolean).join(', '),
        contact: d.contact || '', phone: d.phone || '', email: d.email || '', instagram: d.instagram ? '@' + d.instagram : '', gstin: d.gstin || '', totalOrders: 0, revenue: 0, salesChannel: l.channel,
        notes: 'Won by ' + repName(l.owner_email) + ' (Sales app' + (d.source ? ', via ' + d.source : '') + ').' + (d.wonNote ? ' ' + d.wonNote : '') };
      state.clients.push(c);
      scheduleSave(); if(typeof renderClients === 'function') renderClients();
      if(await linkLead(l, c.id)){ render(); badge(); showToast(c.name + ' added to Clients' + (l.channel === 'toys' ? ' — turn on their TT Trade access in the Buyer App tab' : '')); publish(); }
    }
  });
  document.addEventListener('change', async function(e){
    const tab = document.getElementById('tabSales'); if(!tab || !tab.contains(e.target)) return;
    const t = e.target;
    if(t.hasAttribute('data-sa-target')){
      const parts = t.getAttribute('data-sa-target').split(':');
      if(!state.salesTargets) state.salesTargets = {};
      state.salesTargets[parts[0]] = Object.assign({}, targets()[parts[0]], state.salesTargets[parts[0]] || {}, { [parts[1]]: Math.max(0, Math.round(+t.value || 0)) });
      scheduleSave(); publish(); showToast('Target saved');
    } else if(t.hasAttribute('data-sa-rep')){
      const r = X.reps.find(function(x){ return x.email === t.getAttribute('data-id'); }); if(!r) return;
      if(await upsertRep({ email: r.email, name: r.name, channel: t.value, active: r.active })){ await load(); render(); showToast('Channel updated'); }
    } else if(t.hasAttribute('data-sa-client')){
      const c = (state.clients || []).find(function(x){ return x.id === t.getAttribute('data-sa-client'); }); if(!c) return;
      c.salesChannel = t.value; scheduleSave(); publish(); showToast('Saved');
    } else if(t.hasAttribute('data-sa-link') && t.value){
      const l = X.leads.find(function(x){ return x.id === t.getAttribute('data-sa-link'); }); if(!l) return;
      const c = (state.clients || []).find(function(x){ return x.id === t.value; }); if(!c) return;
      if(!c.salesChannel){ c.salesChannel = l.channel; scheduleSave(); }
      if(await linkLead(l, c.id)){ render(); badge(); showToast('Linked to ' + c.name); }
    }
  });

  const css = document.createElement('style');
  css.textContent =
    '#tabSales .sa-dim{color:var(--dim);font-size:12px}' +
    '#tabSales .sa-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 11px;font:12px "JetBrains Mono",monospace;cursor:pointer;margin:2px 4px 2px 0}' +
    '#tabSales .sa-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#0d1117;font-weight:600}' +
    '#tabSales .sa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}' +
    '#tabSales .sa-card{background:var(--input-bg);border-radius:10px;padding:10px}' +
    '#tabSales .sa-kv{display:grid;grid-template-columns:130px 1fr auto;gap:8px;align-items:center;font-size:12.5px;margin-top:6px}' +
    '#tabSales .sa-meter{height:6px;background:var(--line);border-radius:4px;overflow:hidden} #tabSales .sa-meter i{display:block;height:100%}' +
    '#tabSales .sa-row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px dashed var(--line);font-size:13px}' +
    '#tabSales .sa-alert{border:1px solid var(--amber)}' +
    '#tabSales .sa-add{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px} #tabSales input,#tabSales select{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:12.5px inherit}';
  document.head.appendChild(css);
})();
