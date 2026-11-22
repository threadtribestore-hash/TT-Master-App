// ===================================================================
// ===================== EXPENSES: HEALTH, REVIEW, PLAN ===============
// ===================================================================
// Splits the Expenses tab into four views: Health (what the month's spending says),
// Entries (the existing table), Review (new entries waiting for a weekly check) and
// Plan (monthly close routine, budget, cash calendar, one cost lever).
// Also owns the fixed category list, vendor memory and recurring bills used by the
// quick-add popup in index.html (window.EXP).
// Uses index.html globals: state, scheduleSave, escapeHtml, isoLocal, orderTotals,
// orderEffectiveDate, orderAmountDue, computeProductionCost, showConfirmModal,
// showNoticeModal, openAddExpenseModal, renderExpenses.
(function(){
  if(window.TT_STOCK_MODE || typeof state === 'undefined') return;

  // ---------- categories: fixed list, type follows the category ----------
  const CATS = [
    { name: 'Raw Materials', type: 'raw_materials', hint: 'Filament and other print material' },
    { name: 'Bought-in Parts', type: 'raw_materials', hint: 'Parts that go into an order: clicker parts, holders, wire' },
    { name: 'Print Consumables', type: 'opex', hint: 'Nozzles, plates, glue, jump rings, magnets' },
    { name: 'Logistics & Distribution', type: 'opex', hint: 'Courier, packing, local delivery' },
    { name: 'Office & Operations', type: 'opex', hint: 'Rent, electricity, internet, software, petrol' },
    { name: 'Payroll', type: 'opex', hint: 'Salaries and wages' },
    { name: 'Sales & Marketing', type: 'opex', hint: 'Ads, content, photography, dealer commission' },
    { name: 'Equipment & Hardware', type: 'capex', hint: 'Printers, tools, furniture' }
  ];
  const CAT_NAMES = CATS.map(function(c){ return c.name; });
  // Older free-typed categories and where they belong now.
  const LEGACY = {
    'delivery chandni chowk': 'Logistics & Distribution', 'logistics': 'Logistics & Distribution', 'shipping': 'Logistics & Distribution', 'courier': 'Logistics & Distribution', 'packaging': 'Logistics & Distribution',
    'photography & content': 'Sales & Marketing', 'design': 'Sales & Marketing', 'marketing': 'Sales & Marketing', 'commission': 'Sales & Marketing',
    'filament': 'Raw Materials', 'supplies': 'Print Consumables', 'electricity': 'Office & Operations', 'rent': 'Office & Operations', 'software': 'Office & Operations',
    'internet and phone': 'Office & Operations', 'salaries': 'Payroll', 'equipment': 'Equipment & Hardware'
  };
  const CEILINGS = { 'Raw Materials': 15, 'Bought-in Parts': 8, 'Print Consumables': 10, 'Logistics & Distribution': 8, 'Office & Operations': 15, 'Payroll': 25, 'Sales & Marketing': 5, 'Equipment & Hardware': 3 };
  const FIXED = ['Office & Operations', 'Payroll'];
  const PAID = [['upi', 'UPI'], ['cash', 'Cash'], ['card', 'Card'], ['bank', 'Bank']];
  const TYPE_LABEL = { opex: 'Opex', raw_materials: 'Raw Materials', capex: 'Capex' };

  function canonCat(c){
    const s = String(c || '').trim();
    if(!s) return '';
    const hit = CAT_NAMES.find(function(n){ return n.toLowerCase() === s.toLowerCase(); });
    if(hit) return hit;
    return LEGACY[s.toLowerCase()] || '';
  }
  function typeFor(cat){ const c = CATS.find(function(x){ return x.name === canonCat(cat); }); return c ? c.type : 'opex'; }
  function cfg(){
    if(!state.expenseCfg || typeof state.expenseCfg !== 'object' || Array.isArray(state.expenseCfg)) state.expenseCfg = {};
    const C = state.expenseCfg;
    if(!C.ceilings) C.ceilings = {};
    if(!Array.isArray(C.recurring)) C.recurring = [];
    if(!C.plans) C.plans = {};
    if(!C.cash) C.cash = { amount: null, date: '' };
    if(!C.vendors || typeof C.vendors !== 'object' || Array.isArray(C.vendors)) C.vendors = {};
    return C;
  }
  function ceilingOf(cat){ const v = cfg().ceilings[cat]; return v != null && v !== '' ? +v : CEILINGS[cat]; }

  // ---------- small helpers ----------
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function inr(n){ n = Math.round(n || 0); return (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN'); }
  function inrS(n){ n = Math.round(n || 0); const a = Math.abs(n), s = n < 0 ? '−' : '';
    if(a >= 100000) return s + '₹' + (a / 100000).toFixed(2).replace(/\.?0+$/, '') + 'L';
    if(a >= 10000) return s + '₹' + (a / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return s + '₹' + a.toLocaleString('en-IN'); }
  function pct(a, b){ return b > 0 ? a / b * 100 : 0; }
  function mKey(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function mStart(k){ return k + '-01'; }
  function mEnd(k){ const p = k.split('-'); return isoLocal(new Date(+p[0], +p[1], 0)); }
  function mShift(k, n){ const p = k.split('-'); return mKey(new Date(+p[0], +p[1] - 1 + n, 1)); }
  function mLabel(k, long){ const p = k.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-IN', { month: long ? 'long' : 'short', year: 'numeric' }); }
  function inMonth(d, k){ return !!d && String(d).slice(0, 7) === k; }
  function dayLabel(s){ if(!s) return '—'; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function expenses(){ return state.expenses || []; }
  function isSale(o){ return o.status !== 'quoted' && o.status !== 'lost' && o.status !== 'cancelled' && o.status !== 'returned'; }
  function orderLabel(o){ return (o.displayId || 'Order') + ' · ' + ((o.clientName || o.name || '').trim() || 'No client'); }
  function findOrder(id){ return (state.orders || []).find(function(o){ return o.id === id; }); }
  function chip(kind, text){ return '<span class="eh-chip eh-' + kind + '">' + esc(text) + '</span>'; }
  function vendorKey(v){ return String(v || '').trim().toLowerCase(); }

  // ---------- vendor memory ----------
  // Built from history: each vendor's latest name spelling, most-used category, last buy.
  function vendorIndex(){
    const idx = {};
    expenses().slice().sort(function(a, b){ return (a.date || '').localeCompare(b.date || ''); }).forEach(function(e){
      const k = vendorKey(e.vendor); if(!k) return;
      const v = idx[k] = idx[k] || { name: e.vendor.trim(), cats: {}, last: '', n: 0, lastItem: '', paidVia: '' };
      v.name = e.vendor.trim(); v.n++; v.last = e.date || v.last; v.lastItem = e.item || v.lastItem; if(e.paidVia) v.paidVia = e.paidVia;
      const c = canonCat(e.category); if(c) v.cats[c] = (v.cats[c] || 0) + 1;
    });
    Object.keys(idx).forEach(function(k){ const v = idx[k]; v.category = Object.keys(v.cats).sort(function(a, b){ return v.cats[b] - v.cats[a]; })[0] || ''; });
    // Saved vendor details (added from the quick-add popup) win over what history suggests.
    const saved = cfg().vendors;
    Object.keys(saved).forEach(function(k){
      const d = saved[k]; if(!d || !d.name) return;
      const v = idx[k] = idx[k] || { name: d.name, cats: {}, last: d.addedAt ? d.addedAt.slice(0, 10) : '', n: 0, lastItem: '', paidVia: '', category: '' };
      v.details = d;
      if(d.category) v.category = d.category;
      if(d.paidVia && !v.paidVia) v.paidVia = d.paidVia;
    });
    return idx;
  }
  function recentVendors(n){
    const idx = vendorIndex();
    return Object.keys(idx).map(function(k){ return idx[k]; }).sort(function(a, b){ return (b.last || '').localeCompare(a.last || '') || b.n - a.n; }).slice(0, n || 8);
  }

  // ---------- recurring bills: added as review entries once their day comes ----------
  function runRecurring(){
    const C = cfg(), now = new Date(), k = mKey(now), today = now.getDate();
    let added = 0;
    C.recurring.forEach(function(r){
      if(!r || !r.id || !(+r.amount > 0)) return;
      const day = Math.min(Math.max(1, +r.day || 1), new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
      if(day > today) return;
      if(r.from && k < r.from) return;
      const exists = expenses().some(function(e){ return e.recurringId === r.id && inMonth(e.date, k); });
      if(exists) return;
      state.expenses.push({ id: newId(), date: k + '-' + String(day).padStart(2, '0'), item: r.item || '', category: r.category || '', type: typeFor(r.category), cost: +r.amount, vendor: r.vendor || '', paidVia: r.paidVia || '', status: 'review', recurringId: r.id });
      added++;
    });
    if(added) scheduleSave();
    return added;
  }

  // ---------- month figures ----------
  function orderHours(o){ return ((o.costSnapshot && o.costSnapshot.hours) || computeProductionCost(o, { useFullQty: true }).hours) || 0; }
  function monthStats(k){
    const s = { k: k, rev: 0, gp: 0, n: 0, hours: 0, revByDay: {}, piecesShipped: 0, b2bRev: 0, spend: {}, opex: 0, raw: 0, capex: 0, total: 0, list: [] };
    (state.orders || []).forEach(function(o){
      if(!isSale(o)) return;
      const t = orderTotals(o), d = orderEffectiveDate(o);
      if(inMonth(d, k)){
        s.rev += t.orderValue; s.gp += t.profit; s.n++; s.hours += orderHours(o);
        s.revByDay[d] = (s.revByDay[d] || 0) + t.orderValue;
        if(o.clientId) s.b2bRev += t.orderValue;
      }
      const shipD = o.deliveryDate || o.shippedDate || '';
      if((o.status === 'delivered' || o.status === 'shipped') && inMonth(shipD, k)) s.piecesShipped += t.totalQty || 0;
    });
    expenses().forEach(function(e){
      if(!inMonth(e.date, k)) return;
      const c = canonCat(e.category) || 'Uncategorised', v = +e.cost || 0;
      s.spend[c] = (s.spend[c] || 0) + v; s.total += v; s.list.push(e);
      if(e.type === 'capex') s.capex += v; else if(e.type === 'raw_materials') s.raw += v; else s.opex += v;
    });
    s.margin = s.rev > 0 ? s.gp / s.rev : 0;
    s.fixed = FIXED.reduce(function(a, c){ return a + (s.spend[c] || 0); }, 0);
    const recFixed = cfg().recurring.reduce(function(a, r){ return a + (FIXED.indexOf(canonCat(r.category)) !== -1 ? (+r.amount || 0) : 0); }, 0);
    s.fixed = Math.max(s.fixed, recFixed);
    s.breakeven = s.margin > 0 ? s.opex / s.margin : 0;
    return s;
  }
  function receivables(){
    return (state.orders || []).filter(function(o){ return isSale(o) && (o.paymentStatus || 'unpaid') !== 'refunded' && (o.status === 'delivered' || o.status === 'shipped' || o.status === 'production_done'); })
      .map(function(o){ return { o: o, due: orderAmountDue(o) }; }).filter(function(x){ return x.due > 0; }).sort(function(a, b){ return b.due - a.due; });
  }

  // ---------- data health ----------
  function partsUnlinked(e){ const c = canonCat(e.category); return (c === 'Bought-in Parts' || c === 'Print Consumables') && !e.orderId; }
  function dataHealth(k){
    const all = expenses();
    return {
      noVendor: all.filter(function(e){ return !String(e.vendor || '').trim(); }).length,
      badCat: all.filter(function(e){ return !CAT_NAMES.includes(String(e.category || '').trim()); }).length,
      review: all.filter(function(e){ return e.status === 'review'; }).length,
      unlinked: all.filter(function(e){ return inMonth(e.date, k) && partsUnlinked(e); }).length,
      bankOpen: ((state.bank && state.bank.txns) || []).filter(function(t){ return t.amount < 0 && !t.match && inMonth(t.date, k); }).length,
      bankUsed: ((state.bank && state.bank.txns) || []).some(function(t){ return inMonth(t.date, k); })
    };
  }
  // Flags for one entry, worst first. kind: over | watch | info | ok
  function flagsOf(e, all){
    const f = [], c = canonCat(e.category);
    if(!String(e.vendor || '').trim()) f.push(['over', 'Vendor missing']);
    if(!c) f.push(['over', 'Pick a category']);
    else if(c !== e.category) f.push(['watch', 'Rename to ' + c]);
    if(c && (e.type || 'opex') !== typeFor(c)) f.push(['over', 'Should be ' + TYPE_LABEL[typeFor(c)]]);
    if(/commis+ion/i.test(e.item || '') && c !== 'Sales & Marketing') f.push(['over', 'Commission → Sales & Marketing']);
    if(c === 'Raw Materials' && !(+e.qtyKg > 0)) f.push(['watch', 'Add kg']);
    if(partsUnlinked(e)) f.push(['watch', 'Link to an order?']);
    const dup = (all || expenses()).find(function(x){ return x !== e && +x.cost === +e.cost && +e.cost > 0 && vendorKey(x.vendor) === vendorKey(e.vendor) && x.date && e.date && Math.abs(new Date(x.date) - new Date(e.date)) <= 3 * 86400000; });
    if(dup) f.push(['watch', 'Possible duplicate']);
    if(c === 'Raw Materials' && +e.qtyKg > 0){
      const prev = (all || expenses()).filter(function(x){ return x !== e && vendorKey(x.vendor) === vendorKey(e.vendor) && +x.qtyKg > 0 && (x.date || '') <= (e.date || ''); }).sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); })[0];
      const per = e.cost / e.qtyKg;
      if(prev){ const d = (per / (prev.cost / prev.qtyKg) - 1) * 100; f.push([d > 5 ? 'watch' : 'info', inr(per) + '/kg · ' + (d >= 0 ? '+' : '') + Math.round(d) + '% vs last']); }
      else f.push(['info', inr(per) + '/kg']);
    }
    if(e.recurringId) f.push(['info', 'Recurring · auto-added']);
    if(!f.some(function(x){ return x[0] === 'over' || x[0] === 'watch'; })) f.unshift(['ok', 'Clean']);
    return f;
  }

  // ---------- view state ----------
  const UI = { view: 'health', month: mKey(new Date(new Date().getFullYear(), new Date().getMonth() - (new Date().getDate() <= 7 ? 1 : 0), 1)), planMonth: mKey(new Date()) };
  try{ const v = localStorage.getItem('tt-exp-view'); if(['health', 'entries', 'review', 'plan'].indexOf(v) !== -1) UI.view = v; }catch(e){}

  // ---------- CSS ----------
  const css = document.createElement('style');
  css.textContent = [
    '.eh-nav{display:flex;gap:4px;padding:4px;background:var(--panel);border:1px solid var(--line);border-radius:10px;width:max-content;max-width:100%;overflow-x:auto;margin:0 0 14px}',
    '.eh-nav button{background:none;border:0;color:var(--dim);font:600 13px "Space Grotesk",sans-serif;padding:7px 14px;border-radius:7px;cursor:pointer;white-space:nowrap}',
    '.eh-nav button.on{background:rgba(79,209,197,.14);color:var(--cyan)}',
    '.eh-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px}',
    '.eh-head h3{margin:0;font:700 20px "Space Grotesk",sans-serif;flex:1;min-width:200px}',
    '.eh-head .eh-sub{display:block;font:400 12px "Space Grotesk",sans-serif;color:var(--dim);margin-top:3px}',
    '.eh-month{display:flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:4px 6px;font:600 13px "JetBrains Mono",monospace}',
    '.eh-month button{background:none;border:0;color:var(--text);cursor:pointer;font-size:16px;padding:0 6px}',
    '.eh-strip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(240,168,60,.12);border-radius:10px;padding:9px 14px;margin:0 0 14px}',
    '.eh-strip b{font:700 11px "Space Grotesk",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#b7791f;margin-right:4px}',
    '.eh-chip{display:inline-block;font:700 11px "Space Grotesk",sans-serif;padding:3px 9px;border-radius:20px;white-space:nowrap}',
    '.eh-ok{background:rgba(126,208,138,.18);color:#2f9e44}.eh-watch{background:rgba(240,168,60,.16);color:#b7791f}.eh-over{background:rgba(232,97,90,.14);color:#c92a2a}.eh-info{background:rgba(79,209,197,.14);color:#17877b}',
    '.eh-sec{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:0 0 14px}',
    '.eh-sec h4{margin:0;font:700 15px "Space Grotesk",sans-serif}.eh-sec .eh-sub{font-size:12px;color:var(--dim);margin:2px 0 12px}',
    '.eh-row{display:grid;gap:14px}.eh-row.two{grid-template-columns:minmax(0,1fr) 420px}.eh-row.lever{grid-template-columns:minmax(0,1fr) 460px}.eh-row.plan{grid-template-columns:380px minmax(0,1fr)}',
    '@media(max-width:1000px){.eh-row.two,.eh-row.lever,.eh-row.plan{grid-template-columns:1fr}}',
    '.eh-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}',
    '.eh-kpi{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--panel)}',
    '.eh-kpi .l{font:600 10.5px "Space Grotesk",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}',
    '.eh-kpi .v{font:700 22px "JetBrains Mono",monospace;margin:4px 0 2px}.eh-kpi .v .r{font-family:"Space Grotesk",sans-serif}',
    '.eh-kpi .s{font-size:12px;color:var(--dim);line-height:1.35}.eh-kpi .h{font:600 12px "Space Grotesk",sans-serif;color:#17877b;margin-top:4px}',
    '.eh-kpi .h.bad{color:#c92a2a}.eh-kpi input{width:110px;margin-top:6px}',
    '.eh-track{position:relative;height:10px;border-radius:5px;background:var(--panel2);border:1px solid var(--line);margin-top:6px;overflow:hidden}',
    '.eh-track i{position:absolute;left:0;top:0;bottom:0;border-radius:5px}.eh-track em{position:absolute;top:-1px;bottom:-1px;width:2px;background:var(--text)}',
    '.eh-bar-l{display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-top:12px;flex-wrap:wrap}',
    '.eh-t{width:100%;border-collapse:collapse;font-size:13px}.eh-t th{font:600 10.5px "Space Grotesk",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}',
    '.eh-t td{padding:8px;border-bottom:1px solid var(--line);vertical-align:middle}.eh-t td.m{font-family:"JetBrains Mono",monospace;white-space:nowrap}.eh-t tr.tot td{font-weight:700;border-bottom:0}',
    '.eh-t input,.eh-t select{width:100%;min-width:0;padding:5px 7px;font-size:12px}.eh-t .num{max-width:110px}',
    '.eh-cbar{position:relative;height:8px;border-radius:4px;background:var(--panel2);border:1px solid var(--line);min-width:90px;overflow:hidden}.eh-cbar i{position:absolute;left:0;top:0;bottom:0;border-radius:4px}',
    '.eh-weeks{display:flex;align-items:flex-end;gap:14px;height:150px;padding-top:8px}',
    '.eh-week{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end}',
    '.eh-week .b{display:flex;gap:4px;align-items:flex-end;height:120px}.eh-week .b i{width:18px;border-radius:3px 3px 0 0;display:block}',
    '.eh-week span{font:500 11px "JetBrains Mono",monospace;color:var(--dim)}',
    '.eh-alert{border-radius:8px;padding:9px 12px;font-size:12px;margin-top:10px}.eh-alert.bad{background:rgba(232,97,90,.12);color:#c92a2a}.eh-alert.warn{background:rgba(240,168,60,.14);color:#b7791f}.eh-alert.good{background:rgba(126,208,138,.16);color:#2f9e44}',
    '.eh-note{font-size:11.5px;color:var(--dim);margin-top:8px;line-height:1.45}',
    '.eh-vend{display:grid;grid-template-columns:200px minmax(0,1fr) 90px;gap:10px;align-items:center;margin:7px 0;font-size:13px}',
    '.eh-vend .t{height:10px;border-radius:5px}.eh-vend .a{font-family:"JetBrains Mono",monospace;text-align:right}',
    '.eh-box{background:var(--panel2);border-radius:8px;padding:10px 12px;margin-top:10px}.eh-box .cap{font:700 10.5px "Space Grotesk",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:6px}',
    '.eh-li{display:flex;gap:10px;align-items:center;font-size:13px;padding:4px 0}.eh-li .g{flex:1;min-width:0}.eh-li .m{font-family:"JetBrains Mono",monospace;white-space:nowrap}',
    '.eh-dec{font:600 12px "Space Grotesk",sans-serif;color:#17877b;margin-top:10px}',
    '.eh-step{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}.eh-step:last-child{border-bottom:0}',
    '.eh-step input{margin-top:3px;width:16px;height:16px;flex:none}.eh-step .g{flex:1}.eh-step b{display:block;font-size:14px}.eh-step span{font-size:12px;color:var(--dim)}',
    '.eh-lever{display:flex;gap:10px;align-items:center;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:10px 12px;margin-top:8px;cursor:pointer}',
    '.eh-lever.on{border-color:var(--cyan);background:rgba(79,209,197,.1)}.eh-lever b{display:block;font-size:13.5px}.eh-lever span{font-size:12px;color:var(--dim)}',
    '.eh-btn{background:var(--cyan);color:#0d1117;border:0;border-radius:8px;padding:8px 14px;font:700 13px "Space Grotesk",sans-serif;cursor:pointer}',
    '.eh-btn.ghost{background:none;border:1px solid var(--line);color:var(--text)}.eh-btn.sm{padding:5px 10px;font-size:12px}',
    '.eh-link{background:none;border:0;padding:0;color:#17877b;font:700 12px "Space Grotesk",sans-serif;cursor:pointer}',
    '.eh-sum{display:flex;gap:22px;flex-wrap:wrap;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:0 0 14px}',
    '.eh-sum .l{font:600 10.5px "Space Grotesk",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}.eh-sum .v{font:700 18px "JetBrains Mono",monospace}',
    '.eh-flags{display:flex;gap:5px;flex-wrap:wrap}',
    '.eh-rec{display:grid;grid-template-columns:1fr 1fr;gap:8px}.eh-rec input,.eh-rec select{width:100%;min-width:0}.eh-rec button{justify-self:start}',
    '.eh-empty{padding:18px 0;color:var(--dim);font-size:13px}',
    // quick-add popup
    '.qa-amount{display:flex;align-items:center;justify-content:center;gap:6px;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px}',
    '.qa-amount span{font:700 30px "Space Grotesk",sans-serif}.qa-amount input{font:700 32px "JetBrains Mono",monospace;border:0;background:none;width:200px;text-align:left;padding:0}',
    '.qa-label{display:block;font:600 10.5px "Space Grotesk",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:14px 0 6px}',
    '.qa-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}',
    '.qa-chips button{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:18px;padding:6px 12px;font:600 12.5px "Space Grotesk",sans-serif;cursor:pointer}',
    '.qa-chips button.on{border-color:var(--cyan);background:rgba(79,209,197,.14);color:#17877b}',
    '.qa-chips button.qa-new{border-style:dashed;color:#17877b}',
    '.qa-vinfo{display:flex;gap:10px;align-items:center;justify-content:space-between;font-size:12px;color:var(--dim);margin-top:6px}.qa-vinfo:empty{display:none}',
    '.qa-vform{border:1px dashed var(--cyan);border-radius:10px;padding:12px;margin-top:10px;background:rgba(79,209,197,.06)}',
    '.qa-vform-title{font:700 12.5px "Space Grotesk",sans-serif;color:#17877b;margin-bottom:8px}.qa-vform input{width:100%;box-sizing:border-box}',
    '.qa-vform-note{font-size:11.5px;color:var(--dim);margin-top:8px}',
    '@media(max-width:520px){.qa-vform .row2{grid-template-columns:1fr !important;gap:10px}}',
    // On phones the bottom nav sits above popups; keep this one on top so Save is always reachable.
    '@media(max-width:760px){#addExpenseModalOverlay{z-index:1070}#addExpenseModalOverlay .order-detail-modal-box{padding-bottom:calc(16px + env(safe-area-inset-bottom))}}',
    '.qa-auto{font:600 11px "Space Grotesk",sans-serif;color:#17877b;text-transform:none;letter-spacing:0;margin-left:6px}',
    '.qa-type{font-size:12px;color:var(--dim);margin-top:5px}',
    '#addExpenseModalOverlay select,#addExpenseModalOverlay input[type=text],#addExpenseModalOverlay input#newExpKg{width:100%;box-sizing:border-box}',
    '.ex-review-badge{display:inline-block;margin-left:6px;font:700 10px "Space Grotesk",sans-serif;padding:2px 6px;border-radius:10px;background:rgba(240,168,60,.16);color:#b7791f;vertical-align:middle}'
  ].join('\n');
  document.head.appendChild(css);

  // ---------- shell: nav + views inside the Expenses tab ----------
  const tab = document.getElementById('tabExpenses');
  if(!tab) return;
  const title = tab.firstElementChild;
  const nav = document.createElement('div');
  nav.className = 'eh-nav'; nav.id = 'ehNav';
  const views = {};
  ['health', 'entries', 'review', 'plan'].forEach(function(v){ const d = document.createElement('div'); d.id = 'eh-' + v; views[v] = d; });
  // Existing panels become the Entries view.
  Array.prototype.slice.call(tab.children).forEach(function(ch){ if(ch !== title) views.entries.appendChild(ch); });
  title.after(nav);
  nav.after(views.health, views.entries, views.review, views.plan);
  nav.addEventListener('click', function(e){ const b = e.target.closest('button[data-v]'); if(!b) return; show(b.getAttribute('data-v')); });

  function show(v){
    UI.view = v; try{ localStorage.setItem('tt-exp-view', v); }catch(e){}
    renderHub();
  }
  function navHtml(){
    const n = expenses().filter(function(e){ return e.status === 'review'; }).length;
    return [['health', 'Health'], ['entries', 'Entries'], ['review', 'Review' + (n ? ' (' + n + ')' : '')], ['plan', 'Plan']]
      .map(function(x){ return '<button data-v="' + x[0] + '" class="' + (UI.view === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('');
  }
  function renderHub(){
    runRecurring();
    nav.innerHTML = navHtml();
    Object.keys(views).forEach(function(v){ views[v].style.display = v === UI.view ? '' : 'none'; });
    try{
      if(UI.view === 'health') renderHealth();
      else if(UI.view === 'review') renderReview();
      else if(UI.view === 'plan') renderPlan();
    }catch(err){ views[UI.view].innerHTML = '<div class="eh-alert bad">Couldn’t draw this view: ' + esc(err.message) + '</div>'; }
  }
  const baseRender = window.renderExpenses;
  window.renderExpenses = function(){ const r = baseRender.apply(this, arguments); renderHub(); return r; };

  function monthPicker(id, k){
    return '<div class="eh-month" id="' + id + '"><button data-d="-1">‹</button>' + esc(mLabel(k)) + '<button data-d="1">›</button></div>';
  }
  function wirePicker(root, id, key){
    const p = root.querySelector('#' + id); if(!p) return;
    p.addEventListener('click', function(e){ const b = e.target.closest('button[data-d]'); if(!b) return; UI[key] = mShift(UI[key], +b.getAttribute('data-d')); renderHub(); });
  }
  function kpi(l, v, s, h, bad){ return '<div class="eh-kpi"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div>' + (h ? '<div class="h' + (bad ? ' bad' : '') + '">' + esc(h) + '</div>' : '') + '</div>'; }
  function money(n){ return '<span class="r">₹</span>' + Math.round(n || 0).toLocaleString('en-IN'); }
  function moneyS(n){ const s = inrS(n); return s.replace('₹', '<span class="r">₹</span>'); }

  // ================= HEALTH =================
  function renderHealth(){
    const k = UI.month, S = monthStats(k), P = monthStats(mShift(k, -1)), D = dataHealth(k), C = cfg();
    const isCur = k === mKey(new Date());
    let h = '<div class="eh-head"><h3>Expenses · Health<span class="eh-sub">' + esc(mLabel(k, true)) + (isCur ? ' · month in progress' : '') + ' · from orders and expenses in Studio</span></h3>' + monthPicker('ehHM', k) + '<button class="eh-btn" data-act="add">+ Add expense</button></div>';

    // data health strip
    const dh = [];
    if(D.noVendor) dh.push(chip('over', D.noVendor + ' missing vendor'));
    if(D.badCat) dh.push(chip('watch', D.badCat + ' with an old or no category'));
    if(D.review) dh.push(chip('watch', D.review + ' waiting for review'));
    if(D.unlinked) dh.push(chip('info', D.unlinked + ' part/consumable costs not linked to an order'));
    dh.push(D.bankUsed ? (D.bankOpen ? chip('watch', D.bankOpen + ' bank debits not matched') : chip('ok', 'Bank statement matched')) : chip('info', 'No bank statement imported for this month'));
    h += '<div class="eh-strip"><b>Data health</b>' + dh.join('') + '<span style="flex:1"></span>' + (D.badCat ? '<button class="eh-link" data-act="tidy">Tidy categories</button>&nbsp;&nbsp;' : '') + (D.review ? '<button class="eh-link" data-act="review">Review now →</button>' : '') + '</div>';

    // 1. cover the month
    const runwayBase = [1, 2, 3].map(function(i){ const m = monthStats(mShift(k, -i)); return m.opex + m.raw; }).filter(function(x){ return x > 0; });
    const burnAvg = runwayBase.length ? runwayBase.reduce(function(a, b){ return a + b; }, 0) / runwayBase.length : (S.opex + S.raw);
    const recv = receivables().reduce(function(a, x){ return a + x.due; }, 0);
    const cashSet = C.cash && C.cash.amount != null && C.cash.amount !== '';
    const runway = cashSet && burnAvg > 0 ? (+C.cash.amount + recv) / burnAvg : null;
    const opexChg = P.opex > 0 ? Math.round((S.opex / P.opex - 1) * 100) : null;
    const mult = S.breakeven > 0 ? S.rev / S.breakeven : null;
    h += '<div class="eh-sec"><h4>1 · Can we cover the month?</h4><div class="eh-sub">Cash and runway — read this first every month</div><div class="eh-kpis">' +
      kpi('Fixed monthly burn', money(S.fixed), 'Office & operations + payroll' + (cfg().recurring.length ? ' (or recurring bills, if higher)' : '') + ' · paid even at zero orders', 'Floor for next month’s plan') +
      kpi('Total overheads', money(S.opex), (S.rev > 0 ? pct(S.opex, S.rev).toFixed(1) + '% of revenue' : 'No revenue yet') + (opexChg !== null ? ' · ' + (opexChg >= 0 ? '▲' : '▼') + Math.abs(opexChg) + '% vs ' + esc(mLabel(P.k)) : ''), 'Opex only — raw materials and capex shown separately') +
      kpi('Breakeven revenue', S.breakeven ? moneyS(S.breakeven) : '—', S.margin > 0 ? 'Overheads ÷ ' + Math.round(S.margin * 100) + '% gross margin' : 'Needs priced orders this month', 'Sales needed before any profit') +
      kpi('Revenue vs breakeven', mult ? mult.toFixed(1) + '×' : '—', moneyS(S.rev) + ' sold vs ' + (S.breakeven ? moneyS(S.breakeven) : '—') + ' needed', mult === null ? '' : mult >= 1.3 ? 'Comfortable cushion' : mult >= 1 ? 'Just above breakeven' : 'Below breakeven so far', mult !== null && mult < 1) +
      kpi('Cash runway', runway !== null ? runway.toFixed(1) + ' months' : '—', cashSet ? 'Cash ' + inr(C.cash.amount) + ' + ' + inrS(recv) + ' to collect ÷ ' + inrS(burnAvg) + '/month spend' : inrS(recv) + ' to collect · add your bank balance to see runway', cashSet ? (C.cash.date ? 'Balance as of ' + dayLabel(C.cash.date) : '') : 'Set it in Plan', !cashSet) +
      '</div>';
    if(S.breakeven > 0){
      const days = Object.keys(S.revByDay).sort(); let cum = 0, crossed = '';
      days.forEach(function(d){ cum += S.revByDay[d]; if(!crossed && cum >= S.breakeven) crossed = d; });
      const full = Math.max(S.rev, S.breakeven), w = S.rev / full * 100, m = S.breakeven / full * 100;
      h += '<div class="eh-bar-l"><span><b>' + inrS(S.rev) + '</b> sold of ' + inrS(S.breakeven) + ' breakeven</span><span style="color:' + (crossed ? '#2f9e44' : '#b7791f') + ';font-weight:600">' + (crossed ? 'Breakeven crossed on ' + dayLabel(crossed) : inrS(S.breakeven - S.rev) + ' more sales to break even') + '</span></div>' +
        '<div class="eh-track"><i style="width:' + w.toFixed(1) + '%;background:' + (crossed ? 'var(--green)' : 'var(--amber)') + '"></i><em style="left:' + m.toFixed(1) + '%"></em></div>';
    }
    h += '</div>';

    // 2. efficiency + cash calendar
    h += '<div class="eh-row two"><div class="eh-sec"><h4>2 · Are we spending efficiently?</h4><div class="eh-sub">Each category as % of revenue, against its ceiling (edit ceilings in Plan)</div>' +
      '<table class="eh-t"><thead><tr><th>Category</th><th>Spent</th><th>% of rev</th><th style="width:30%">vs ceiling</th><th>Status</th></tr></thead><tbody>';
    let catTotal = 0;
    CAT_NAMES.concat(S.spend.Uncategorised ? ['Uncategorised'] : []).forEach(function(c){
      const v = S.spend[c] || 0; catTotal += v;
      const p = pct(v, S.rev), ceil = ceilingOf(c);
      const st = c === 'Uncategorised' ? ['watch', 'Pick categories'] : !v ? ['info', 'Nothing logged'] : !S.rev ? ['info', 'No revenue'] : p > ceil ? ['over', 'Over by ' + (p - ceil).toFixed(1) + ' pts'] : p > ceil * 0.9 ? ['watch', 'Near ceiling'] : ['ok', 'OK'];
      const col = st[0] === 'over' ? 'var(--red)' : st[0] === 'watch' ? 'var(--amber)' : 'var(--cyan)';
      h += '<tr><td><b style="font-weight:600">' + esc(c) + '</b></td><td class="m">' + inr(v) + '</td><td class="m"><b>' + p.toFixed(1) + '%</b></td>' +
        '<td><div style="display:flex;gap:8px;align-items:center"><div class="eh-cbar" style="flex:1"><i style="width:' + (ceil ? Math.min(100, p / ceil * 100) : 0).toFixed(1) + '%;background:' + col + '"></i></div><span style="font:11px JetBrains Mono,monospace;color:var(--dim)">' + (ceil != null ? ceil + '%' : '—') + '</span></div></td><td>' + chip(st[0], st[1]) + '</td></tr>';
    });
    h += '<tr class="tot"><td>Total spend</td><td class="m">' + inr(catTotal) + '</td><td class="m">' + pct(catTotal, S.rev).toFixed(1) + '%</td><td colspan="2" style="font-weight:400;color:var(--dim);font-size:12px">Overheads ' + inr(S.opex) + ' · raw materials & parts ' + inr(S.raw) + ' · capex ' + inr(S.capex) + '</td></tr></tbody></table></div>';

    // cash calendar by week
    const bankT = ((state.bank && state.bank.txns) || []).filter(function(t){ return inMonth(t.date, k); });
    const useBank = bankT.length > 0;
    const weeks = [0, 0, 0, 0, 0].map(function(_, i){ return { l: 'W' + (i + 1), inn: 0, out: 0 }; });
    const wk = function(d){ return Math.min(4, Math.floor((+String(d).slice(8, 10) - 1) / 7)); };
    if(useBank) bankT.forEach(function(t){ if(t.amount > 0) weeks[wk(t.date)].inn += t.amount; else weeks[wk(t.date)].out += -t.amount; });
    else {
      (state.orders || []).forEach(function(o){ (o.paymentLog || []).forEach(function(p){ if(inMonth(p.date, k)) weeks[wk(p.date)].inn += +p.amount || 0; }); });
      S.list.forEach(function(e){ weeks[wk(e.date)].out += +e.cost || 0; });
    }
    const wmax = Math.max.apply(null, weeks.map(function(w){ return Math.max(w.inn, w.out); }).concat([1]));
    const bad = weeks.filter(function(w){ return w.out > w.inn && w.out > 0; });
    h += '<div class="eh-sec"><h4>Cash in vs out · by week</h4><div class="eh-sub">Spot weeks where bills land before dealer payments</div><div class="eh-weeks">' +
      weeks.map(function(w){ return '<div class="eh-week" title="' + w.l + ': in ' + inr(w.inn) + ', out ' + inr(w.out) + '"><div class="b"><i style="height:' + Math.max(2, w.inn / wmax * 116) + 'px;background:var(--green)"></i><i style="height:' + Math.max(2, w.out / wmax * 116) + 'px;background:' + (w.out > w.inn ? 'var(--red)' : 'var(--pink)') + '"></i></div><span>' + w.l + '</span></div>'; }).join('') + '</div>' +
      '<div style="display:flex;gap:14px;font-size:11px;font-weight:600;margin-top:6px"><span style="color:#2f9e44">■ Cash in</span><span style="color:#c92a2a">■ Cash out</span></div>';
    if(bad.length){ const w = bad.sort(function(a, b){ return (b.out - b.inn) - (a.out - a.inn); })[0]; h += '<div class="eh-alert bad">' + w.l + ': ' + inrS(w.out) + ' out vs ' + inrS(w.inn) + ' in. Collect dues before that week or move a big purchase.</div>'; }
    h += '<div class="eh-note">' + (useBank ? 'From your imported bank statement.' : 'From payments recorded on orders and expense dates. Import a bank statement in Bank reconciliation for exact cash.') + '</div></div></div>';

    // 3. unit economics
    const filE = S.list.filter(function(e){ return canonCat(e.category) === 'Raw Materials' && +e.qtyKg > 0; });
    const filKg = filE.reduce(function(a, e){ return a + +e.qtyKg; }, 0), filRs = filE.reduce(function(a, e){ return a + (+e.cost || 0); }, 0);
    const setRate = (state.fleet && state.fleet.filamentPrice) || 0;
    const realKg = filKg > 0 ? filRs / filKg : null;
    const ohHr = S.hours > 0 ? S.opex / S.hours : null;
    const logi = S.spend['Logistics & Distribution'] || 0, perPc = S.piecesShipped > 0 ? logi / S.piecesShipped : null;
    const parts = S.list.filter(function(e){ const c = canonCat(e.category); return c === 'Bought-in Parts' || c === 'Print Consumables'; });
    const partsTot = parts.reduce(function(a, e){ return a + (+e.cost || 0); }, 0), partsUn = parts.filter(function(e){ return !e.orderId; }).reduce(function(a, e){ return a + (+e.cost || 0); }, 0);
    h += '<div class="eh-sec"><h4>3 · Are we pricing right?</h4><div class="eh-sub">Unit economics — feeds back into order cost and product pricing</div><div class="eh-kpis">' +
      kpi('Real filament cost', realKg !== null ? money(realKg) + ' /kg' : '—', realKg !== null ? inr(filRs) + ' for ' + filKg + ' kg · Settings uses ' + inr(setRate) + '/kg' : 'Add kg when logging filament · Settings uses ' + inr(setRate) + '/kg', realKg !== null && setRate ? (Math.abs(realKg - setRate) / setRate > 0.05 ? 'Update Settings rate to ' + inr(realKg) + '/kg' : 'Settings rate is right') : 'Needs kg on filament entries', realKg !== null && setRate && Math.abs(realKg - setRate) / setRate > 0.05) +
      kpi('Overhead per print hour', ohHr !== null ? money(ohHr) + ' /hr' : '—', inr(S.opex) + ' ÷ ' + Math.round(S.hours) + ' print hours booked', 'Add to order cost for true margin') +
      kpi('Delivery + packing per piece', perPc !== null ? money(perPc) + ' /pc' : '—', 'Logistics ' + inr(logi) + ' ÷ ' + S.piecesShipped + ' pieces shipped', perPc !== null ? 'Compare with what you charge for delivery' : 'Needs delivery dates on orders') +
      kpi('Parts & consumables', money(partsTot), partsTot ? inr(partsUn) + ' not linked to any order' : 'Nothing logged this month', partsUn ? 'Link to orders so their margin is real' : (partsTot ? 'All linked' : ''), partsUn > 0) +
      '</div></div>';

    // 4. vendors + 5. growth
    const byV = {}, supV = {};
    const SUPPLY = ['Raw Materials', 'Bought-in Parts', 'Print Consumables', 'Logistics & Distribution', 'Equipment & Hardware'];
    S.list.forEach(function(e){ const n = String(e.vendor || '').trim() || 'No vendor'; byV[n] = (byV[n] || 0) + (+e.cost || 0); if(n !== 'No vendor' && SUPPLY.indexOf(canonCat(e.category)) !== -1) supV[n] = (supV[n] || 0) + (+e.cost || 0); });
    const topSup = Object.keys(supV).sort(function(a, b){ return supV[b] - supV[a]; })[0];
    const topV = Object.keys(byV).map(function(n){ return [n, byV[n]]; }).sort(function(a, b){ return b[1] - a[1]; }).slice(0, 6);
    const vmax = topV.length ? topV[0][1] : 1, vcols = ['var(--cyan)', 'var(--purple)', 'var(--amber)', 'var(--pink)', 'var(--green)', 'var(--cyan)'];
    const drift = driftRows(k);
    h += '<div class="eh-row lever"><div class="eh-sec"><h4>4 · Who are we dependent on?</h4><div class="eh-sub">Top vendors this month and price changes on repeat buys</div>' +
      (topV.length ? topV.map(function(v, i){ return '<div class="eh-vend"><span>' + esc(v[0]) + '</span><div class="t" style="width:' + (v[1] / vmax * 100).toFixed(1) + '%;background:' + vcols[i] + '"></div><span class="a">' + inr(v[1]) + '</span></div>'; }).join('') : '<div class="eh-empty">No expenses logged this month.</div>') +
      '<div class="eh-box"><div class="cap">Price drift on repeat items</div>' + (drift.length ? drift.map(function(d){ return '<div class="eh-li"><span class="g">' + esc(d.label) + '</span><span class="m">' + esc(d.text) + '</span>' + chip(d.kind, d.chip) + '</div>'; }).join('') : '<div class="eh-note" style="margin:0">No repeat buys this month to compare.</div>') + '</div>' +
      (topSup ? '<div class="eh-dec">Decision: ' + esc(topSup) + ' is your biggest supplier this month (' + inrS(supV[topSup]) + ') — ask for a volume rate.</div>' : '') + '</div>';

    const mkt = S.spend['Sales & Marketing'] || 0;
    const comm = S.list.filter(function(e){ return /commis+ion/i.test(e.item || ''); }).reduce(function(a, e){ return a + (+e.cost || 0); }, 0);
    const capexList = expenses().filter(function(e){ return e.type === 'capex' && e.date && e.date >= mStart(mShift(k, -5)) && e.date <= mEnd(k); }).sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); });
    const capTot = capexList.reduce(function(a, e){ return a + (+e.cost || 0); }, 0);
    const gp6 = [0, 1, 2, 3, 4, 5].reduce(function(a, i){ const m = monthStats(mShift(k, -i)); return a + m.gp - m.opex; }, 0) / 6;
    h += '<div class="eh-sec"><h4>5 · Is the investment paying back?</h4><div class="eh-sub">Growth spend against what it brought in</div><div class="eh-kpis">' +
      kpi('Marketing per order', S.n ? money(mkt / S.n) : '—', inr(mkt) + ' on sales & marketing · ' + S.n + ' orders', mkt ? '' : 'Log content and ad spend here') +
      kpi('Dealer commission', S.b2bRev && comm ? pct(comm, S.b2bRev).toFixed(1) + '%' : '—', inr(comm) + ' commission on ' + inrS(S.b2bRev) + ' dealer sales', comm ? 'Fair if they reorder' : 'Name commission entries “Commission – …”') +
      '</div><div class="eh-box"><div class="cap">Capex · last 6 months · ' + inr(capTot) + '</div>' +
      (capexList.length ? capexList.slice(0, 5).map(function(e){ return '<div class="eh-li"><span class="g">' + esc(e.item || e.category || 'Capex') + '</span><span class="m">' + inr(e.cost) + '</span><span style="font-size:12px;color:var(--dim)">' + dayLabel(e.date) + '</span></div>'; }).join('') : '<div class="eh-note" style="margin:0">No capex logged.</div>') +
      (capTot && gp6 > 0 ? '<div class="eh-note">At the 6-month average net profit of ' + inrS(gp6) + '/month, this capex pays back in about ' + (capTot / gp6).toFixed(1) + ' months.</div>' : '') +
      '</div></div></div>';

    h += '<div class="eh-note" style="border:1px dashed var(--line);border-radius:8px;padding:10px 12px">Revenue and gross profit use orders dated in the month (quotes, lost, cancelled and returned left out), excluding GST. Overheads are Opex expenses; raw materials, parts and capex are kept apart. “—” means Studio needs a bit more data for that number.</div>';

    views.health.innerHTML = h;
    wirePicker(views.health, 'ehHM', 'month');
  }
  function driftRows(k){
    const list = expenses().filter(function(e){ return inMonth(e.date, k) && String(e.vendor || '').trim(); });
    const out = [], seen = {};
    list.forEach(function(e){
      const key = vendorKey(e.vendor) + '|' + (canonCat(e.category) === 'Raw Materials' && +e.qtyKg > 0 ? 'kg' : String(e.item || '').trim().toLowerCase());
      if(seen[key]) return; seen[key] = 1;
      const prev = expenses().filter(function(x){ return x !== e && vendorKey(x.vendor) === vendorKey(e.vendor) && (x.date || '') < mStart(k); })
        .filter(function(x){ return key.endsWith('|kg') ? +x.qtyKg > 0 : String(x.item || '').trim().toLowerCase() === key.split('|')[1]; })
        .sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); })[0];
      if(!prev) return;
      const now = key.endsWith('|kg') ? e.cost / e.qtyKg : +e.cost, was = key.endsWith('|kg') ? prev.cost / prev.qtyKg : +prev.cost;
      if(!was) return;
      const d = (now / was - 1) * 100;
      out.push({ label: (e.item || canonCat(e.category)) + ' (' + e.vendor.trim() + ')' + (key.endsWith('|kg') ? ' per kg' : ''), text: inr(was) + ' → ' + inr(now), kind: d > 5 ? 'over' : d < -5 ? 'ok' : 'ok', chip: Math.abs(d) < 1 ? 'Same as last buy' : (d > 0 ? '+' : '') + Math.round(d) + '%', d: d });
    });
    return out.sort(function(a, b){ return Math.abs(b.d) - Math.abs(a.d); }).slice(0, 5);
  }

  // ================= REVIEW =================
  function renderReview(){
    const all = expenses(), list = all.filter(function(e){ return e.status === 'review'; }).sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); });
    const now = new Date(), dow = (now.getDay() + 6) % 7, mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow), sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    const ws = isoLocal(mon), we = isoLocal(sun);
    const logged = all.filter(function(e){ return e.date >= ws && e.date <= we; }).reduce(function(a, e){ return a + (+e.cost || 0); }, 0);
    const bankW = ((state.bank && state.bank.txns) || []).filter(function(t){ return t.date >= ws && t.date <= we && t.amount < 0; });
    const debits = bankW.reduce(function(a, t){ return a - t.amount; }, 0);
    const rows = list.map(function(e){ return { e: e, f: flagsOf(e, all) }; });
    const clean = rows.filter(function(r){ return r.f[0][0] === 'ok'; });
    let h = '<div class="eh-head"><h3>Review · week of ' + dayLabel(ws) + '–' + dayLabel(we) + '<span class="eh-sub">' + list.length + ' entr' + (list.length === 1 ? 'y' : 'ies') + ' waiting · approve, fix or delete. About 10 minutes a week.</span></h3>' +
      (clean.length ? '<button class="eh-btn" data-act="approve-clean">Approve ' + clean.length + ' clean entr' + (clean.length === 1 ? 'y' : 'ies') + '</button>' : '') + '<button class="eh-btn ghost" data-act="add">+ Add expense</button></div>';
    h += '<div class="eh-sum"><div><div class="l">Logged this week</div><div class="v">' + inr(logged) + '</div></div>';
    if(bankW.length){
      const gap = debits - logged;
      h += '<div><div class="l">Bank / UPI debits</div><div class="v">' + inr(debits) + '</div></div><div><div class="l">Unexplained gap</div><div class="v" style="color:' + (Math.abs(gap) > 100 ? '#c92a2a' : '#2f9e44') + '">' + inr(gap) + '</div></div>' +
        '<span style="flex:1;font-size:12px;font-weight:600;color:' + (Math.abs(gap) > 100 ? '#c92a2a' : '#2f9e44') + '">' + (gap > 100 ? '→ Some payments have no expense entry yet. Ask the team before closing the week.' : gap < -100 ? '→ More logged than left the bank — check for cash payments or duplicates.' : '→ Matches the bank.') + '</span>';
    } else h += '<span style="flex:1;font-size:12px;color:var(--dim)">Import this week’s bank statement in Bank reconciliation to compare against what left the bank.</span>';
    h += '</div>';
    if(!rows.length){ h += '<div class="eh-sec"><div class="eh-empty">Nothing waiting. New expenses land here until you approve them.</div></div>'; views.review.innerHTML = h; return; }
    const catOpts = function(cur){ const c = canonCat(cur); return '<option value="">Pick…</option>' + CAT_NAMES.map(function(n){ return '<option' + (n === c ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join(''); };
    h += '<div class="eh-sec" style="padding:6px 10px"><table class="eh-t"><thead><tr><th>Date</th><th>Item</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Paid / order</th><th>Check</th><th></th></tr></thead><tbody>';
    rows.forEach(function(r){
      const e = r.e, o = e.orderId ? findOrder(e.orderId) : null;
      h += '<tr data-id="' + esc(e.id) + '"><td class="m">' + dayLabel(e.date) + '</td><td><input data-f="item" value="' + esc(e.item) + '" placeholder="What was it?"></td>' +
        '<td><input data-f="vendor" list="expenseVendorSuggestions" value="' + esc(e.vendor) + '" placeholder="Vendor"></td><td><select data-f="category">' + catOpts(e.category) + '</select></td>' +
        '<td class="m">' + inr(e.cost) + (+e.qtyKg > 0 ? '<div style="font-size:11px;color:var(--dim)">' + e.qtyKg + ' kg</div>' : (canonCat(e.category) === 'Raw Materials' ? '<input data-f="qtyKg" type="number" min="0" step="0.1" placeholder="kg" class="num" style="margin-top:4px">' : '')) + '</td>' +
        '<td style="font-size:12px">' + esc((PAID.find(function(p){ return p[0] === e.paidVia; }) || [0, '—'])[1]) + '<br><span style="color:var(--dim)">' + (o ? esc(o.displayId || '') : '<input data-f="order" list="ehOrderList" placeholder="TT-… (optional)" style="margin-top:3px">') + '</span></td>' +
        '<td><div class="eh-flags">' + r.f.map(function(x){ return chip(x[0], x[1]); }).join('') + '</div></td>' +
        '<td style="white-space:nowrap"><button class="eh-btn sm" data-act="approve">Approve</button> <button class="eh-link" data-act="del" style="color:#c92a2a;margin-left:6px">Delete</button></td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<datalist id="ehOrderList">' + (state.orders || []).filter(isSale).slice(-80).reverse().map(function(o){ return '<option value="' + esc(o.displayId || '') + '">' + esc(orderLabel(o)) + '</option>'; }).join('') + '</datalist>';
    views.review.innerHTML = h;
    views.review.querySelectorAll('tr[data-id] [data-f]').forEach(function(inp){
      inp.addEventListener('change', function(){
        const e = all.find(function(x){ return x.id === inp.closest('tr').getAttribute('data-id'); }); if(!e) return;
        const f = inp.getAttribute('data-f'), v = inp.value;
        if(f === 'category'){ e.category = v; if(v) e.type = typeFor(v); }
        else if(f === 'qtyKg') e.qtyKg = +v > 0 ? +v : null;
        else if(f === 'order'){ const o = (state.orders || []).find(function(x){ return (x.displayId || '').toLowerCase() === v.trim().toLowerCase(); }); if(o) e.orderId = o.id; else if(v.trim()){ showNoticeModal('No order ' + v + ' found.'); return; } }
        else e[f] = v;
        scheduleSave(); renderHub();
      });
    });
  }

  // ================= PLAN =================
  function renderPlan(){
    const C = cfg(), k = UI.planMonth, prev = mShift(k, -1), S = monthStats(k), PS = monthStats(prev);
    const plan = C.plans[k] = C.plans[k] || {};
    const revs = [1, 2, 3].map(function(i){ return monthStats(mShift(k, -i)).rev; }).filter(function(x){ return x > 0; });
    const expRev = plan.expectedRevenue != null && plan.expectedRevenue !== '' ? +plan.expectedRevenue : (revs.length ? Math.round(revs.reduce(function(a, b){ return a + b; }, 0) / revs.length / 1000) * 1000 : 0);
    const prevReview = expenses().filter(function(e){ return e.status === 'review' && inMonth(e.date, prev); }).length;
    const prevNoVendor = expenses().filter(function(e){ return inMonth(e.date, prev) && !String(e.vendor || '').trim(); }).length;
    const steps = [
      ['Close ' + mLabel(prev), prevReview || prevNoVendor ? prevReview + ' waiting for review · ' + prevNoVendor + ' missing vendor in ' + mLabel(prev) : 'All ' + mLabel(prev) + ' entries reviewed. Check against the bank statement.'],
      ['Budget vs actual', 'Explain any category more than 15% off its budget for ' + mLabel(prev)],
      ['Set ' + mLabel(k) + ' budget', 'Fixed costs, plus variable costs scaled to expected revenue'],
      ['Check cash calendar', 'Big bills going out vs dealer payments coming in'],
      ['Pick one cost lever', 'One concrete action for the month']
    ];
    plan.steps = plan.steps || {};
    let h = '<div class="eh-head"><h3>Plan · ' + esc(mLabel(k, true)) + '<span class="eh-sub">30-minute routine in the first week: close ' + esc(mLabel(prev)) + ', then set ' + esc(mLabel(k)) + '</span></h3>' + monthPicker('ehPM', k) + '</div>';
    h += '<div class="eh-row plan"><div class="eh-sec"><h4>Monthly routine</h4><div class="eh-sub">' + Object.keys(plan.steps).filter(function(x){ return plan.steps[x]; }).length + ' of 5 done</div>' +
      steps.map(function(s, i){ return '<label class="eh-step"><input type="checkbox" data-step="' + i + '"' + (plan.steps[i] ? ' checked' : '') + '><div class="g"><b>' + (i + 1) + ' · ' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div></label>'; }).join('') +
      '<div class="eh-box"><div class="cap">Cash balance (for runway)</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="number" id="ehCash" min="0" step="100" placeholder="₹ in bank today" value="' + (C.cash.amount != null ? esc(C.cash.amount) : '') + '" style="width:150px"><input type="date" id="ehCashDate" value="' + esc(C.cash.date || '') + '" style="width:150px"></div></div></div>';

    // budget table
    h += '<div class="eh-sec"><h4>' + esc(mLabel(k)) + ' budget by category</h4><div class="eh-sub">Expected revenue <input type="number" id="ehExpRev" min="0" step="1000" value="' + (expRev || '') + '" style="width:120px;display:inline-block;margin:0 6px"> · suggestions use each category’s ceiling</div>' +
      '<table class="eh-t"><thead><tr><th>Category</th><th>' + esc(mLabel(prev)) + '</th><th>Ceiling %</th><th>Budget</th><th>So far</th><th>Left</th><th>Note</th></tr></thead><tbody>';
    plan.budget = plan.budget || {};
    let tPrev = 0, tBud = 0, tSo = 0;
    CAT_NAMES.forEach(function(c){
      const pv = PS.spend[c] || 0, so = S.spend[c] || 0, ceil = ceilingOf(c);
      const sugg = FIXED.indexOf(c) !== -1 ? Math.round(pv / 100) * 100 : Math.round(expRev * ceil / 100 / 100) * 100;
      const bud = plan.budget[c] != null && plan.budget[c] !== '' ? +plan.budget[c] : sugg;
      tPrev += pv; tBud += bud; tSo += so;
      const left = bud - so;
      const note = so > bud && bud > 0 ? ['over', 'Over budget'] : FIXED.indexOf(c) !== -1 ? ['info', 'Fixed'] : bud > 0 && so > bud * 0.85 ? ['watch', 'Nearly used'] : pv > sugg * 1.15 && pv > 0 ? ['watch', 'Cut vs ' + mLabel(prev)] : ['ok', ''];
      h += '<tr><td><b style="font-weight:600">' + esc(c) + '</b></td><td class="m">' + inr(pv) + '</td>' +
        '<td><input type="number" class="num" data-ceil="' + esc(c) + '" min="0" step="0.5" value="' + (ceil != null ? ceil : '') + '" style="max-width:70px"></td>' +
        '<td><input type="number" class="num" data-bud="' + esc(c) + '" min="0" step="100" value="' + (plan.budget[c] != null && plan.budget[c] !== '' ? esc(plan.budget[c]) : '') + '" placeholder="' + sugg + '"></td>' +
        '<td class="m">' + inr(so) + '</td><td class="m" style="color:' + (left < 0 ? '#c92a2a' : 'inherit') + '">' + inr(left) + '</td><td>' + (note[1] ? chip(note[0], note[1]) : '') + '</td></tr>';
    });
    h += '<tr class="tot"><td>Total</td><td class="m">' + inr(tPrev) + '</td><td></td><td class="m">' + inr(tBud) + '</td><td class="m">' + inr(tSo) + '</td><td class="m">' + inr(tBud - tSo) + '</td><td></td></tr></tbody></table>';
    const logged = S.list.length;
    if(k === mKey(new Date()) && logged < 5) h += '<div class="eh-alert warn">Only ' + logged + ' entr' + (logged === 1 ? 'y' : 'ies') + ' logged for ' + esc(mLabel(k)) + ' so far — “so far” stays low until pending bills are logged.</div>';
    h += '</div></div>';

    // cash calendar + lever
    const rec = C.recurring.slice().sort(function(a, b){ return (+a.day || 0) - (+b.day || 0); });
    const dues = receivables().slice(0, 5);
    h += '<div class="eh-row lever"><div class="eh-sec"><h4>Cash calendar · ' + esc(mLabel(k)) + '</h4><div class="eh-sub">Recurring bills going out and money owed to you</div>' +
      (rec.length ? rec.map(function(r){ return '<div class="eh-li"><span class="m" style="color:var(--dim);width:58px">' + (+r.day || 1) + ' ' + esc(mLabel(k).split(' ')[0]) + '</span><span class="g">' + esc(r.item || r.vendor || 'Bill') + '<span style="color:var(--dim);font-size:12px"> · ' + esc(r.category || '') + '</span></span><span class="m" style="color:#c92a2a;font-weight:700">− ' + inr(r.amount) + '</span><button class="eh-link" data-act="rec-del" data-id="' + esc(r.id) + '" style="color:var(--dim)">✕</button></div>'; }).join('') : '<div class="eh-note">No recurring bills yet. Add rent, electricity, salaries and subscriptions below — they’ll be added to Review on their day each month.</div>') +
      '<div class="eh-box"><div class="cap">Add a recurring bill</div><div class="eh-rec">' +
      '<input id="ehRItem" placeholder="Bill, e.g. Rent"><input id="ehRVendor" list="expenseVendorSuggestions" placeholder="Vendor"><select id="ehRCat">' + CAT_NAMES.map(function(n){ return '<option' + (n === 'Office & Operations' ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select><input id="ehRAmt" type="number" min="0" placeholder="Amount ₹"><input id="ehRDay" type="number" min="1" max="31" placeholder="Day of month"><button class="eh-btn sm" data-act="rec-add">Add bill</button></div></div>' +
      (dues.length ? '<div class="eh-box"><div class="cap">To collect · ' + inr(receivables().reduce(function(a, x){ return a + x.due; }, 0)) + '</div>' + dues.map(function(x){ return '<div class="eh-li"><span class="g">' + esc(orderLabel(x.o)) + '</span><span class="m" style="color:#2f9e44;font-weight:700">+ ' + inr(x.due) + '</span></div>'; }).join('') + '</div>' : '') + '</div>';

    const levers = leverIdeas(PS);
    const prevPlan = C.plans[prev] || {};
    h += '<div class="eh-sec"><h4>This month’s cost lever</h4><div class="eh-sub">Pick one · check the result next month</div>' +
      (prevPlan.lever ? '<div class="eh-box" style="margin-top:0"><div class="cap">Last month: ' + esc(prevPlan.lever) + '</div><input id="ehLeverResult" placeholder="How did it go? e.g. got 6% off" value="' + esc(prevPlan.leverResult || '') + '"></div>' : '') +
      levers.map(function(l){ return '<div class="eh-lever' + (plan.lever === l[0] ? ' on' : '') + '" data-lever="' + esc(l[0]) + '"><input type="radio"' + (plan.lever === l[0] ? ' checked' : '') + '><div><b>' + esc(l[0]) + '</b><span>' + esc(l[1]) + '</span></div></div>'; }).join('') +
      '<input id="ehLeverOwn" placeholder="Or write your own…" style="margin-top:10px;width:100%" value="' + esc(levers.some(function(l){ return l[0] === plan.lever; }) ? '' : (plan.lever || '')) + '"></div></div>';

    views.plan.innerHTML = h;
    wirePicker(views.plan, 'ehPM', 'planMonth');
    const save = function(){ scheduleSave(); };
    views.plan.querySelectorAll('[data-step]').forEach(function(cb){ cb.addEventListener('change', function(){ plan.steps[cb.getAttribute('data-step')] = cb.checked; save(); renderHub(); }); });
    views.plan.querySelectorAll('[data-bud]').forEach(function(inp){ inp.addEventListener('change', function(){ plan.budget[inp.getAttribute('data-bud')] = inp.value === '' ? null : +inp.value; save(); renderHub(); }); });
    views.plan.querySelectorAll('[data-ceil]').forEach(function(inp){ inp.addEventListener('change', function(){ C.ceilings[inp.getAttribute('data-ceil')] = inp.value === '' ? null : +inp.value; save(); renderHub(); }); });
    const er = views.plan.querySelector('#ehExpRev'); er.addEventListener('change', function(){ plan.expectedRevenue = er.value === '' ? null : +er.value; save(); renderHub(); });
    const ca = views.plan.querySelector('#ehCash'), cd = views.plan.querySelector('#ehCashDate');
    ca.addEventListener('change', function(){ C.cash.amount = ca.value === '' ? null : +ca.value; if(!C.cash.date) C.cash.date = isoLocal(); save(); renderHub(); });
    cd.addEventListener('change', function(){ C.cash.date = cd.value; save(); });
    views.plan.querySelectorAll('[data-lever]').forEach(function(el){ el.addEventListener('click', function(){ plan.lever = el.getAttribute('data-lever'); save(); renderHub(); }); });
    const own = views.plan.querySelector('#ehLeverOwn'); own.addEventListener('change', function(){ if(own.value.trim()){ plan.lever = own.value.trim(); save(); renderHub(); } });
    const lr = views.plan.querySelector('#ehLeverResult'); if(lr) lr.addEventListener('change', function(){ prevPlan.leverResult = lr.value; save(); });
  }
  function leverIdeas(PS){
    const out = [];
    const byV = {}; PS.list.forEach(function(e){ const n = String(e.vendor || '').trim(); if(n && ['Raw Materials', 'Bought-in Parts', 'Print Consumables', 'Logistics & Distribution'].indexOf(canonCat(e.category)) !== -1) byV[n] = (byV[n] || 0) + (+e.cost || 0); });
    const top = Object.keys(byV).sort(function(a, b){ return byV[b] - byV[a]; })[0];
    if(top) out.push(['Negotiate a volume rate with ' + top, 'Biggest supplier · ' + inrS(byV[top]) + ' last month']);
    const over = CAT_NAMES.map(function(c){ return [c, pct(PS.spend[c] || 0, PS.rev) - (ceilingOf(c) || 0)]; }).filter(function(x){ return x[1] > 0 && PS.rev > 0; }).sort(function(a, b){ return b[1] - a[1]; })[0];
    if(over) out.push(['Bring ' + over[0] + ' under ' + ceilingOf(over[0]) + '% of revenue', 'Over its ceiling by ' + over[1].toFixed(1) + ' pts last month']);
    const logi = PS.spend['Logistics & Distribution'] || 0;
    if(logi) out.push(['Bulk-buy courier credits or renegotiate courier rates', inrS(logi) + ' on logistics last month']);
    out.push(['Bulk-buy filament for the quarter', 'Lock the price before it drifts']);
    return out.slice(0, 3);
  }

  // ---------- actions shared by views ----------
  document.getElementById('tabExpenses').addEventListener('click', function(e){
    const b = e.target.closest('[data-act]'); if(!b) return;
    const a = b.getAttribute('data-act');
    if(a === 'add') openAddExpenseModal();
    else if(a === 'review') show('review');
    else if(a === 'tidy') tidyCategories();
    else if(a === 'approve' || a === 'del'){
      const id = b.closest('tr').getAttribute('data-id'), ex = expenses().find(function(x){ return x.id === id; }); if(!ex) return;
      if(a === 'approve'){ delete ex.status; scheduleSave(); renderHub(); }
      else showConfirmModal('Delete this expense (' + inr(ex.cost) + (ex.vendor ? ', ' + ex.vendor : '') + ')?', function(){ state.expenses = expenses().filter(function(x){ return x !== ex; }); scheduleSave(); renderExpenses(); }, 'Delete');
    }
    else if(a === 'approve-clean'){
      const all = expenses(); let n = 0;
      all.filter(function(x){ return x.status === 'review'; }).forEach(function(x){ if(flagsOf(x, all)[0][0] === 'ok'){ delete x.status; n++; } });
      scheduleSave(); renderHub(); showNoticeModal('Approved ' + n + ' entr' + (n === 1 ? 'y' : 'ies') + '.');
    }
    else if(a === 'rec-add'){
      const g = function(id){ return document.getElementById(id).value; };
      if(!(+g('ehRAmt') > 0) || !g('ehRItem').trim()){ showNoticeModal('Add a name and an amount for the recurring bill.'); return; }
      cfg().recurring.push({ id: newId(), item: g('ehRItem').trim(), vendor: g('ehRVendor').trim(), category: g('ehRCat'), amount: +g('ehRAmt'), day: Math.min(31, Math.max(1, +g('ehRDay') || 1)), from: mKey(new Date()) });
      scheduleSave(); renderHub();
    }
    else if(a === 'rec-del'){ const C = cfg(); C.recurring = C.recurring.filter(function(r){ return r.id !== b.getAttribute('data-id'); }); scheduleSave(); renderHub(); }
  });

  function tidyCategories(){
    const moves = {}; let n = 0;
    expenses().forEach(function(e){ const raw = String(e.category || '').trim(), c = canonCat(raw); if(c && c !== raw){ moves[raw + ' → ' + c] = (moves[raw + ' → ' + c] || 0) + 1; n++; } });
    const none = expenses().filter(function(e){ return !canonCat(e.category); }).length;
    if(!n){ showNoticeModal(none ? none + ' entr' + (none === 1 ? 'y has' : 'ies have') + ' no category Studio can map. Fix them in Entries.' : 'All categories are already tidy.'); return; }
    showConfirmModal('Rename old categories to the fixed list?\n\n' + Object.keys(moves).map(function(m){ return m + ' (' + moves[m] + ')'; }).join('\n') +
      '\n\nTypes follow the new category. Where the old name had a place in it (e.g. Chandni Chowk), it’s kept as a tag on the entry.' + (none ? '\n' + none + ' with no category stay as they are.' : ''),
      function(){
        expenses().forEach(function(e){
          const raw = String(e.category || '').trim(), c = canonCat(raw);
          if(!c || c === raw) return;
          if(/chandni chowk/i.test(raw)) e.tag = 'Chandni Chowk';
          e.category = c; e.type = typeFor(c);
        });
        scheduleSave(); renderExpenses();
      }, 'Rename ' + n);
    try{ modalMsg.style.whiteSpace = 'pre-line'; }catch(e){}
  }

  // ---------- quick-add popup support (used by index.html) ----------
  function fillQuickAdd(){
    const vs = recentVendors(8), wrap = document.getElementById('newExpVendorChips'), dl = document.getElementById('expenseVendorSuggestions');
    if(wrap) wrap.innerHTML = vs.map(function(v){ return '<button type="button" data-vendor="' + esc(v.name) + '">' + esc(v.name) + '</button>'; }).join('') +
      '<button type="button" class="qa-new" data-newvendor="1">+ New vendor</button>';
    if(dl){ const idx = vendorIndex(); dl.innerHTML = Object.keys(idx).map(function(k){ return '<option value="' + esc(idx[k].name) + '">'; }).join(''); }
    const sel = document.getElementById('newExpCategory');
    if(sel) sel.innerHTML = '<option value="">Pick a category…</option>' + CATS.map(function(c){ return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');
    const ord = document.getElementById('newExpOrder');
    if(ord) ord.innerHTML = '<option value="">Not for a specific order</option>' + (state.orders || []).filter(function(o){ return isSale(o) && o.status !== 'delivered'; }).slice().reverse().slice(0, 60)
      .concat((state.orders || []).filter(function(o){ return o.status === 'delivered'; }).slice(-20).reverse())
      .map(function(o){ return '<option value="' + esc(o.id) + '">' + esc(orderLabel(o)) + '</option>'; }).join('');
  }
  function onCategory(){
    const sel = document.getElementById('newExpCategory'), c = CATS.find(function(x){ return x.name === sel.value; });
    const note = document.getElementById('newExpTypeNote'); if(note) note.textContent = c ? c.hint + ' · counted as ' + TYPE_LABEL[c.type] : '';
    const kg = document.getElementById('newExpKgWrap'); if(kg) kg.style.display = sel.value === 'Raw Materials' ? '' : 'none';
  }
  function onVendor(name){
    const v = vendorIndex()[vendorKey(name)];
    document.querySelectorAll('#newExpVendorChips button').forEach(function(b){ b.classList.toggle('on', vendorKey(b.getAttribute('data-vendor')) === vendorKey(name)); });
    const hint = document.getElementById('newExpCatHint'), sel = document.getElementById('newExpCategory');
    if(v && v.category){ sel.value = v.category; if(hint) hint.textContent = 'auto from ' + v.name; if(v.paidVia) setPaid(v.paidVia); }
    else if(hint) hint.textContent = '';
    onCategory();
    vendorPanel(name, v);
  }
  // Below the vendor field: a one-line summary for a known vendor (with Edit), or the
  // details form for a vendor Studio hasn't seen before.
  const VD = ['phone', 'upi', 'gstin', 'city', 'notes'];
  const VD_ID = { phone: 'vdPhone', upi: 'vdUpi', gstin: 'vdGstin', city: 'vdCity', notes: 'vdNotes' };
  function vendorPanel(name, v, forceForm){
    const info = document.getElementById('newExpVendorInfo'), form = document.getElementById('newExpVendorForm'), title = document.getElementById('newExpVendorFormTitle');
    if(!info || !form) return;
    const nm = String(name || '').trim(), d = v && v.details;
    if(!nm && !forceForm){ info.innerHTML = ''; form.style.display = 'none'; return; }
    if(v && !forceForm){
      const bits = d ? [d.phone, d.upi, d.gstin ? 'GST ' + d.gstin : '', d.city].filter(Boolean) : [];
      info.innerHTML = '<span>' + (bits.length ? esc(bits.join(' · ')) : 'No contact details saved') + '</span><button type="button" class="eh-link" data-vdedit="1">' + (bits.length ? 'Edit details' : 'Add details') + '</button>';
      form.style.display = 'none';
      return;
    }
    info.innerHTML = '';
    title.textContent = nm ? (v ? 'Details for ' + nm : 'New vendor: ' + nm + ' · add details (optional)') : 'New vendor · type the name above, details below (optional)';
    VD.forEach(function(f){ const el = document.getElementById(VD_ID[f]); if(el) el.value = d && d[f] ? d[f] : ''; });
    form.style.display = '';
  }
  function setPaid(p){ document.querySelectorAll('#newExpPaidChips button').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-paid') === p); }); }
  function wireQuickAdd(){
    const wrap = document.getElementById('newExpVendorChips'); if(!wrap || wrap._wired) return; wrap._wired = true;
    wrap.addEventListener('click', function(e){
      if(e.target.closest('button[data-newvendor]')){
        const inp = document.getElementById('newExpVendor'); inp.value = '';
        document.querySelectorAll('#newExpVendorChips button').forEach(function(b){ b.classList.toggle('on', !!b.getAttribute('data-newvendor')); });
        document.getElementById('newExpCatHint').textContent = '';
        vendorPanel('', null, true); inp.focus(); return;
      }
      const b = e.target.closest('button[data-vendor]'); if(!b) return; document.getElementById('newExpVendor').value = b.getAttribute('data-vendor'); onVendor(b.getAttribute('data-vendor'));
    });
    document.getElementById('newExpVendorInfo').addEventListener('click', function(e){
      if(!e.target.closest('[data-vdedit]')) return;
      const n = document.getElementById('newExpVendor').value; vendorPanel(n, vendorIndex()[vendorKey(n)], true);
    });
    document.getElementById('newExpVendor').addEventListener('input', function(e){
      const form = document.getElementById('newExpVendorForm');
      if(form && form.style.display !== 'none'){ const t = document.getElementById('newExpVendorFormTitle'); const n = e.target.value.trim(); const known = vendorIndex()[vendorKey(n)]; t.textContent = n ? (known ? 'Details for ' + n : 'New vendor: ' + n + ' · add details (optional)') : 'New vendor · type the name above, details below (optional)'; }
    });
    const g = document.getElementById('vdGstin'); if(g) g.addEventListener('input', function(){ g.value = g.value.toUpperCase().replace(/\s/g, ''); });
    document.getElementById('newExpVendor').addEventListener('change', function(e){ onVendor(e.target.value); });
    document.getElementById('newExpCategory').addEventListener('change', function(){ document.getElementById('newExpCatHint').textContent = ''; onCategory(); });
    document.getElementById('newExpPaidChips').addEventListener('click', function(e){ const b = e.target.closest('button[data-paid]'); if(b) setPaid(b.getAttribute('data-paid')); });
  }
  function resetQuickAdd(){
    wireQuickAdd(); fillQuickAdd();
    document.getElementById('newExpCatHint').textContent = '';
    ['newExpKg', 'newExpRef'].forEach(function(id){ const el = document.getElementById(id); if(el) el.value = ''; });
    setPaid('upi'); onCategory();
    vendorPanel('', null);
    VD.forEach(function(f){ const el = document.getElementById(VD_ID[f]); if(el) el.value = ''; });
  }
  // Saves the vendor's details (if the form was open or this is a new vendor) along with
  // the category and payment method used, so the next entry for them fills itself in.
  function saveVendor(vendor, cat, paid){
    const k = vendorKey(vendor); if(!k) return;
    const form = document.getElementById('newExpVendorForm'), open = form && form.style.display !== 'none';
    const C = cfg(), cur = C.vendors[k], known = vendorIndex()[k];
    if(!open && known && !cur) return;
    const d = cur || { name: vendor, addedAt: new Date().toISOString() };
    d.name = vendor;
    if(open) VD.forEach(function(f){ const el = document.getElementById(VD_ID[f]); if(el) d[f] = el.value.trim(); });
    if(d.gstin) d.gstin = d.gstin.toUpperCase();
    if(cat) d.category = cat;
    if(paid) d.paidVia = paid;
    d.updatedAt = new Date().toISOString();
    C.vendors[k] = d;
  }
  function readQuickAdd(){
    const paid = document.querySelector('#newExpPaidChips button.on');
    const cat = document.getElementById('newExpCategory').value, vendor = document.getElementById('newExpVendor').value.trim();
    saveVendor(vendor, cat, paid ? paid.getAttribute('data-paid') : '');
    const item = document.getElementById('newExpItem').value.trim();
    return {
      id: newId(), date: document.getElementById('newExpDate').value || isoLocal(),
      item: item || (cat ? cat + (vendor ? ' – ' + vendor : '') : vendor),
      category: cat, type: typeFor(cat), cost: posNum(document.getElementById('newExpCost').value), vendor: vendor,
      paidVia: paid ? paid.getAttribute('data-paid') : '', orderId: document.getElementById('newExpOrder').value || '',
      qtyKg: cat === 'Raw Materials' && +document.getElementById('newExpKg').value > 0 ? +document.getElementById('newExpKg').value : null,
      ref: (document.getElementById('newExpRef') || {}).value || '', status: 'review', addedAt: new Date().toISOString()
    };
  }

  window.EXP = { CATS: CATS, CAT_NAMES: CAT_NAMES, canonCat: canonCat, typeFor: typeFor, vendorIndex: vendorIndex, resetQuickAdd: resetQuickAdd, readQuickAdd: readQuickAdd, renderHub: renderHub, show: show, PAID: PAID, flagsOf: flagsOf };
  runRecurring();
})();
