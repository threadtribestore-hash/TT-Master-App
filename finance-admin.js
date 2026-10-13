// ===================================================================
// ========================= FINANCE (Studio) ========================
// ===================================================================
// Bank reconciliation. Import a bank or UPI statement (CSV, XLS or XLSX from any Indian bank;
// columns are detected, not hard-coded) and every line gets matched:
//   money in   to an order: a payment Studio hasn't recorded yet (amount, the client's name or
//              the TT-number in the narration), or a payment already marked paid (confirmed);
//   money out  to an expense already entered, or added as a new expense with a guessed category;
//   anything else (own-account transfers, owner drawings, loans) can be set aside with a reason.
// Recording a payment updates the order's amount paid, status, cleared date and payment log,
// and every match can be undone. Bank lines sync as their own rows (state.bank.txns).
(function(){
  if(window.TT_STOCK_MODE) return;

  const IGNORE_WHY = ['Transfer between own accounts', 'Owner drawing or capital', 'Loan or EMI', 'Refund to a client', 'Other'];
  // Narration words that point at an expense category: [pattern, category, type].
  const GUESS = [
    [/bambu|filament|esun|elegoo|polymaker|sunlu|creality|\bpla\b|petg/i, 'Filament', 'raw_materials'],
    [/delhivery|shiprocket|blue ?dart|dtdc|porter|courier|xpressbees|ecom ?express|india ?post|borzo|dunzo/i, 'Shipping', 'opex'],
    [/electric|bescom|bses|tata ?power|adani ?elec|msedcl|tneb|uppcl/i, 'Electricity', 'opex'],
    [/\brent\b/i, 'Rent', 'opex'],
    [/salary|salaries|wages|\bsal\b/i, 'Salaries', 'opex'],
    [/jio|airtel|vodafone|\bvi\b|bsnl|act ?fibernet|broadband/i, 'Internet and phone', 'opex'],
    [/facebook|meta ?platforms|instagram|google ?ads|adwords/i, 'Marketing', 'opex'],
    [/zoho|canva|shopify|github|supabase|anthropic|claude|google ?workspace|microsoft|adobe/i, 'Software', 'opex'],
    [/\bgst\b|cbic|tds|income ?tax/i, 'Taxes', 'opex'],
    [/amazon|flipkart|indiamart|moglix|udaan/i, 'Supplies', 'raw_materials'],
    [/bank ?charges|sms ?charges|annual ?fee|chrg|charges/i, 'Bank charges', 'opex']
  ];
  const V = { filter: 'review', dir: 'all', q: '', show: 60 };

  // ---------- helpers ----------
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function money(v){ return '₹' + Math.round(Math.abs(v) || 0).toLocaleString('en-IN'); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmt(s){ if(!s) return '—'; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }); }
  function days(a, b){ return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
  function bank(){
    if(!state.bank || typeof state.bank !== 'object') state.bank = {};
    if(!Array.isArray(state.bank.txns)) state.bank.txns = [];
    if(!Array.isArray(state.bank.imports)) state.bank.imports = [];
    return state.bank;
  }
  function squash(s){ return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function hash(s){ let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function counts(o){ return ['quoted', 'lost', 'cancelled'].indexOf(o.status) === -1; }
  function total(o){ try{ return orderTotals(o).grandTotal || 0; }catch(e){ return 0; } }
  function due(o){ return Math.max(0, Math.round(total(o) - (o.amountPaid || 0))); }
  function who(o){ const c = (state.clients || []).find(function(x){ return x.id === o.clientId; }); return (c && c.name) || o.clientName || o.name || 'Order'; }
  function orderDay(o){ return o.orderedDate || o.productionStartDate || o.dueDate || ''; }

  // ---------- reading a statement ----------
  function parseDate(v){
    if(v == null || v === '') return '';
    if(typeof v === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF){ const d = XLSX.SSF.parse_date_code(v); return d ? d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0') : ''; }
    if(v instanceof Date) return iso(v);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})/); // Indian banks write day first
    if(m){ const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    m = s.match(/^(\d{1,2})[\/\-. ]?([A-Za-z]{3})[A-Za-z]*[\/\-., ]+(\d{2,4})/);
    if(m){ const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()) + 1; if(mo){ const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + String(mo).padStart(2, '0') + '-' + m[1].padStart(2, '0'); } }
    return '';
  }
  function parseAmount(v){
    if(v == null || v === '') return 0;
    if(typeof v === 'number') return v;
    const s = String(v).replace(/[,\s₹]|INR|Rs\.?/gi, '');
    const n = parseFloat(s.replace(/(cr|dr)$/i, ''));
    return isFinite(n) ? n : 0;
  }
  function csvRows(text){
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for(let i = 0; i < text.length; i++){
      const ch = text[i];
      if(q){ if(ch === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; }
      else if(ch === '"') q = true;
      else if(ch === ',' || ch === '\t'){ row.push(cell); cell = ''; }
      else if(ch === '\n' || ch === '\r'){ if(ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if(cell || row.length){ row.push(cell); rows.push(row); }
    return rows;
  }
  // Banks put account details above the table, so find the header row first.
  function readStatement(rows){
    const low = function(r){ return (r || []).map(function(c){ return String(c == null ? '' : c).trim().toLowerCase(); }); };
    let hi = -1;
    for(let i = 0; i < Math.min(rows.length, 60); i++){
      const r = low(rows[i]);
      const hasDate = r.some(function(c){ return /date/.test(c); });
      const hasMoney = r.some(function(c){ return /withdraw|debit|deposit|credit|amount|^dr$|^cr$/.test(c); });
      if(hasDate && hasMoney){ hi = i; break; }
    }
    if(hi === -1) throw new Error('Couldn’t find the transaction table. The file needs columns for date, description and amounts.');
    const h = low(rows[hi]);
    const find = function(res){ for(const re of res){ const i = h.findIndex(function(c){ return re.test(c); }); if(i !== -1) return i; } return -1; };
    const C = {
      date: find([/^(txn|tran|transaction)\.? ?date/, /^date/, /value ?date/, /date/]),
      desc: find([/narration/, /description/, /particular/, /remark/, /details/]),
      ref: find([/chq|cheque|ref|utr/]),
      debit: find([/withdraw/, /^debit|debit ?amount|dr ?amount/, /^dr$/]),
      credit: find([/deposit/, /^credit|credit ?amount|cr ?amount/, /^cr$/]),
      amount: find([/^amount|txn ?amount|transaction ?amount/]),
      type: find([/^(dr|cr) ?\/ ?(cr|dr)$|^type$|dr\/cr|cr\/dr/]),
      balance: find([/balance/])
    };
    if(C.date === -1 || (C.debit === -1 && C.credit === -1 && C.amount === -1)) throw new Error('Couldn’t tell which columns hold the date and the amounts.');
    const out = [];
    for(let i = hi + 1; i < rows.length; i++){
      const r = rows[i] || [];
      const date = parseDate(r[C.date]); if(!date) continue;
      let amt = 0;
      if(C.debit !== -1 || C.credit !== -1){
        const cr = C.credit !== -1 ? parseAmount(r[C.credit]) : 0, dr = C.debit !== -1 ? parseAmount(r[C.debit]) : 0;
        amt = Math.abs(cr) - Math.abs(dr);
      } else {
        amt = parseAmount(r[C.amount]);
        const t = String((C.type !== -1 ? r[C.type] : r[C.amount]) || '');
        if(/\bdr\b|debit|withdraw/i.test(t) && amt > 0) amt = -amt;
      }
      if(!amt) continue;
      const desc = String(C.desc !== -1 ? r[C.desc] || '' : '').replace(/\s+/g, ' ').trim();
      const ref = String(C.ref !== -1 ? r[C.ref] || '' : '').trim();
      const balance = C.balance !== -1 ? parseAmount(r[C.balance]) : null;
      out.push({ date: date, desc: desc, ref: ref, amount: Math.round(amt * 100) / 100, balance: balance });
    }
    return out;
  }
  async function importFile(file){
    let rows;
    if(/\.(xlsx|xls)$/i.test(file.name)){
      if(typeof XLSX === 'undefined') throw new Error('The Excel reader hasn’t loaded. Check the connection, or save the statement as CSV.');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    } else rows = csvRows(await file.text());
    const lines = readStatement(rows), B = bank(), have = {};
    B.txns.forEach(function(t){ have[t.id] = 1; });
    let added = 0, dup = 0;
    const seenInFile = {};
    lines.forEach(function(l){
      // Same date, amount, narration and balance is the same line, so a re-import adds nothing.
      let id = 'bk_' + hash([l.date, l.amount, l.desc, l.ref, l.balance].join('|'));
      seenInFile[id] = (seenInFile[id] || 0) + 1;
      if(seenInFile[id] > 1) id += '_' + seenInFile[id];
      if(have[id]){ dup++; return; }
      B.txns.push(Object.assign({ id: id, file: file.name, match: null }, l)); added++;
    });
    const dates = lines.map(function(l){ return l.date; }).sort();
    B.imports.push({ id: 'imp_' + Date.now().toString(36), file: file.name, at: new Date().toISOString(), lines: lines.length, added: added, from: dates[0] || '', to: dates[dates.length - 1] || '' });
    B.txns.sort(function(a, b){ return b.date.localeCompare(a.date); });
    scheduleSave();
    return { lines: lines.length, added: added, dup: dup, from: dates[0], to: dates[dates.length - 1] };
  }

  // ---------- matching ----------
  const STOP = { PVT: 1, LTD: 1, PRIVATE: 1, LIMITED: 1, THE: 1, AND: 1, CO: 1, LLP: 1, ENTERPRISES: 1, TRADERS: 1, STORE: 1, SHOP: 1, INDIA: 1, MR: 1, MRS: 1, MS: 1 };
  function nameHit(o, desc){
    const d = squash(desc);
    return who(o).toUpperCase().split(/[^A-Z0-9]+/).filter(function(w){ return w.length >= 4 && !STOP[w]; }).some(function(w){ return d.indexOf(w) !== -1; });
  }
  function idHit(o, desc){ return o.displayId && squash(desc).indexOf(squash(o.displayId)) !== -1; }
  function matchedTo(kind, id){ return bank().txns.some(function(t){ return t.match && t.match.kind === kind && (t.match.orderId === id || t.match.expenseId === id); }); }
  // Best orders for money in, highest score first. 100+ is near certain.
  function orderCandidates(t){
    const amt = t.amount, out = [];
    state.orders.filter(counts).forEach(function(o){
      const tot = total(o); if(!tot) return;
      const d = due(o), paid = o.paymentStatus === 'paid' || d === 0;
      const od = orderDay(o);
      if(od && days(t.date, od) < -15) return; // paid long before the order existed
      let s = 0, why = [];
      if(idHit(o, t.desc)){ s += 80; why.push((o.displayId || '') + ' in the narration'); }
      if(nameHit(o, t.desc)){ s += 40; why.push('client name in the narration'); }
      if(!paid && Math.abs(d - amt) <= 1){ s += 60; why.push('exact amount due'); }
      else if(paid && Math.abs(tot - amt) <= 1){ s += 45; why.push('same as the order total'); }
      else if(!paid && amt < d && s >= 40){ s += 10; why.push('part payment'); }
      if(s < 50) return;
      out.push({ o: o, score: s, paid: paid, why: why.join(', ') });
    });
    return out.sort(function(a, b){ return b.score - a.score; }).slice(0, 4);
  }
  function expenseCandidates(t){
    const amt = -t.amount;
    return (state.expenses || []).filter(function(e){ return Math.abs((+e.cost || 0) - amt) <= 1 && (!e.date || Math.abs(days(t.date, e.date)) <= 10) && !matchedTo('expense', e.id); })
      .sort(function(a, b){ return Math.abs(days(t.date, a.date || t.date)) - Math.abs(days(t.date, b.date || t.date)); }).slice(0, 3);
  }
  function guess(t){
    const g = GUESS.find(function(x){ return x[0].test(t.desc); });
    // UPI narrations read like UPI/DR/123/NAME/BANK/...; take the name part as the vendor.
    const m = t.desc.match(/UPI[\/\-]?(?:DR|CR)?[\/\-]\d+[\/\-]([A-Za-z][A-Za-z .&]{2,40})/i) || t.desc.match(/(?:NEFT|IMPS|RTGS)[\/\- ][^\/\-]*[\/\-]([A-Za-z][A-Za-z .&]{2,40})/i);
    return { category: g ? g[1] : '', type: g ? g[2] : 'opex', vendor: m ? m[1].trim().replace(/\s+/g, ' ') : '' };
  }
  function suggestion(t){
    if(t.match) return null;
    if(t.amount > 0){ const c = orderCandidates(t); return c.length ? { kind: 'order', list: c } : null; }
    const e = expenseCandidates(t); return e.length ? { kind: 'expense', list: e } : null;
  }

  // ---------- actions ----------
  function recordPayment(t, o, confirmOnly){
    if(!confirmOnly){
      const tot = total(o);
      o.amountPaid = Math.round(((o.amountPaid || 0) + t.amount) * 100) / 100;
      o.paymentStatus = o.amountPaid >= tot - 1 ? 'paid' : 'partial';
      if(o.paymentStatus === 'paid' && !o.paymentClearedDate) o.paymentClearedDate = t.date;
      if(!o.paymentMode) o.paymentMode = /UPI/i.test(t.desc) ? 'UPI' : 'Bank transfer';
    } else if(!o.paymentClearedDate) o.paymentClearedDate = t.date;
    o.paymentLog = (o.paymentLog || []).concat([{ date: t.date, amount: t.amount, via: 'bank', ref: t.ref || '', txnId: t.id }]);
    t.match = { kind: 'order', orderId: o.id, amount: t.amount, confirm: !!confirmOnly, at: new Date().toISOString() };
  }
  function undo(t){
    const m = t.match; if(!m) return;
    if(m.kind === 'order'){
      const o = state.orders.find(function(x){ return x.id === m.orderId; });
      if(o){
        o.paymentLog = (o.paymentLog || []).filter(function(p){ return p.txnId !== t.id; });
        if(!m.confirm){
          o.amountPaid = Math.max(0, Math.round(((o.amountPaid || 0) - m.amount) * 100) / 100);
          o.paymentStatus = o.amountPaid <= 0 ? 'unpaid' : o.amountPaid >= total(o) - 1 ? 'paid' : 'partial';
          if(o.paymentStatus !== 'paid') o.paymentClearedDate = '';
        }
      }
    } else if(m.kind === 'expense'){
      if(m.created) state.expenses = (state.expenses || []).filter(function(e){ return e.id !== m.expenseId; });
      else { const e = (state.expenses || []).find(function(x){ return x.id === m.expenseId; }); if(e) delete e.bankTxnId; }
    }
    t.match = null;
  }
  function after(msg){
    scheduleSave(); render();
    if(typeof renderOrders === 'function') try{ renderOrders(); }catch(e){}
    if(msg && typeof ttToast === 'function') ttToast(msg, { ms: 3500 }); else if(msg) showToast(msg);
  }

  // ---------- view ----------
  function stats(){
    const T = bank().txns;
    const inn = T.filter(function(t){ return t.amount > 0; }), out = T.filter(function(t){ return t.amount < 0; });
    const sum = function(l){ return l.reduce(function(s, t){ return s + Math.abs(t.amount); }, 0); };
    const paidNotLogged = inn.filter(function(t){ const s = suggestion(t); return s && s.kind === 'order' && !s.list[0].paid && s.list[0].score >= 100; });
    // Delivered and unpaid in Studio, with no bank credit that could be theirs since delivery.
    const unpaid = state.orders.filter(function(o){ return o.status === 'delivered' && due(o) > 0; });
    const noCredit = unpaid.filter(function(o){
      const since = o.deliveryDate || orderDay(o) || '0000';
      return !T.some(function(t){ return t.amount > 0 && t.date >= since && ((t.match && t.match.orderId === o.id) || nameHit(o, t.desc) || idHit(o, t.desc)); });
    });
    const dates = T.map(function(t){ return t.date; }).sort();
    return { n: T.length, from: dates[0], to: dates[dates.length - 1],
      inMatched: sum(inn.filter(function(t){ return t.match; })), inOpen: sum(inn.filter(function(t){ return !t.match; })),
      outMatched: sum(out.filter(function(t){ return t.match; })), outOpen: sum(out.filter(function(t){ return !t.match; })),
      open: T.filter(function(t){ return !t.match; }).length,
      paidNotLogged: paidNotLogged, unpaid: unpaid, noCredit: noCredit, strong: T.filter(function(t){ const s = suggestion(t); return s && s.kind === 'order' && s.list[0].score >= 100; }) };
  }
  function rowHtml(t){
    const s = suggestion(t), m = t.match, inMoney = t.amount > 0;
    let act = '';
    if(m){
      let what = '';
      if(m.kind === 'order'){ const o = state.orders.find(function(x){ return x.id === m.orderId; }); what = o ? (m.confirm ? 'Confirms payment of ' : 'Payment for ') + '<a href="#" data-fi="open" data-id="' + o.id + '">' + esc((o.displayId ? o.displayId + ' · ' : '') + who(o)) + '</a>' : 'Order no longer in Studio'; }
      else if(m.kind === 'expense'){ const e = (state.expenses || []).find(function(x){ return x.id === m.expenseId; }); what = e ? (m.created ? 'Added as expense: ' : 'Expense: ') + esc([e.category, e.vendor || e.item].filter(Boolean).join(' · ')) : 'Expense no longer in Studio'; }
      else what = 'Set aside: ' + esc(m.why || '');
      act = '<span class="fi-done">✓ ' + what + '</span><button class="fi-link" data-fi="undo" data-id="' + t.id + '">Undo</button>';
    } else if(inMoney){
      const list = s ? s.list : [];
      act = (list.length ? '<span class="fi-sug">' + (list[0].paid ? 'Already marked paid: ' : 'Looks like ') + '<b>' + esc((list[0].o.displayId ? list[0].o.displayId + ' · ' : '') + who(list[0].o)) + '</b><i>' + esc(list[0].why) + (list[0].paid ? '' : ' · ' + money(due(list[0].o)) + ' due') + '</i></span>' +
          '<button class="fi-btn primary" data-fi="pay" data-id="' + t.id + '" data-o="' + list[0].o.id + '">' + (list[0].paid ? 'Confirm' : 'Record payment') + '</button>' : '<span class="fi-dim">No matching order found</span>') +
        '<select class="fi-sel" data-fi-pick="' + t.id + '"><option value="">' + (list.length ? 'Another order…' : 'Pick the order…') + '</option>' +
          state.orders.filter(function(o){ return counts(o) && due(o) > 0; }).sort(function(a, b){ return Math.abs(due(a) - t.amount) - Math.abs(due(b) - t.amount); }).slice(0, 40)
            .map(function(o){ return '<option value="' + o.id + '">' + esc((o.displayId ? o.displayId + ' · ' : '') + who(o)) + ' — ' + money(due(o)) + ' due</option>'; }).join('') + '</select>' +
        '<select class="fi-sel" data-fi-ignore="' + t.id + '"><option value="">Set aside…</option>' + IGNORE_WHY.map(function(w){ return '<option>' + esc(w) + '</option>'; }).join('') + '</select>';
    } else {
      const g = guess(t), list = s ? s.list : [];
      act = (list.length ? '<span class="fi-sug">Matches expense <b>' + esc([list[0].category, list[0].vendor || list[0].item].filter(Boolean).join(' · ') || 'entered') + '</b><i>' + fmt(list[0].date) + '</i></span><button class="fi-btn primary" data-fi="link-exp" data-id="' + t.id + '" data-e="' + list[0].id + '">Link</button>' :
        '<input class="fi-cat" data-fi-cat="' + t.id + '" list="fiCats" placeholder="Category" value="' + esc(g.category) + '"><input class="fi-ven" data-fi-ven="' + t.id + '" placeholder="Vendor" value="' + esc(g.vendor) + '">' +
        '<select class="fi-sel fi-type" data-fi-type="' + t.id + '">' + [['opex', 'Running cost'], ['raw_materials', 'Raw material'], ['capex', 'Equipment (capex)']].map(function(o){ return '<option value="' + o[0] + '"' + (g.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<button class="fi-btn primary" data-fi="add-exp" data-id="' + t.id + '">Add expense</button>') +
        '<select class="fi-sel" data-fi-ignore="' + t.id + '"><option value="">Set aside…</option>' + IGNORE_WHY.map(function(w){ return '<option>' + esc(w) + '</option>'; }).join('') + '</select>';
    }
    return '<div class="fi-row' + (m ? ' done' : '') + '"><span class="fi-date">' + fmt(t.date) + '</span>' +
      '<span class="fi-desc" title="' + esc(t.desc) + '">' + esc(t.desc || '—') + (t.ref ? '<i>' + esc(t.ref) + '</i>' : '') + '</span>' +
      '<span class="fi-amt ' + (inMoney ? 'in' : 'out') + '">' + (inMoney ? '+' : '−') + money(t.amount) + '</span><span class="fi-act">' + act + '</span></div>';
  }
  function render(){
    const root = document.getElementById('financeRoot'); if(!root) return;
    const B = bank(), S = stats();
    const cats = {}; (state.expenses || []).forEach(function(e){ if(e.category) cats[e.category] = 1; }); GUESS.forEach(function(g){ cats[g[1]] = 1; });
    let h = '<datalist id="fiCats">' + Object.keys(cats).sort().map(function(c){ return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
      '<div class="fi-head"><div><div class="fi-title">Finance</div><div class="fi-sub">Bank reconciliation' + (S.n ? ' · ' + S.n + ' bank lines, ' + fmt(S.from) + ' – ' + fmt(S.to) : '') + '</div></div>' +
      '<label class="fi-btn primary">Import bank statement<input type="file" accept=".csv,.xls,.xlsx,text/csv" data-fi-file hidden></label></div>';
    if(!S.n){ root.innerHTML = h + '<div class="panel fi-empty"><b>Start with a bank statement.</b><p>Download it from your bank’s net banking as <b>CSV or Excel</b> (any Indian bank works; PDF doesn’t), for the months you want to check, and import it. Payment gateway or UPI business-app exports work too. Studio matches money in to orders and money out to expenses, and you confirm each one.</p><p class="fi-dim">Bank lines are stored in Studio like your orders: visible only to signed-in admins.</p></div>'; return; }
    h += '<div class="fi-tiles">' +
      '<div class="fi-tile warn"><div class="k">Paid in the bank, unpaid in Studio</div><div class="v">' + S.paidNotLogged.length + '</div><div class="s">' + money(S.paidNotLogged.reduce(function(s, t){ return s + t.amount; }, 0)) + ' to record' + (S.strong.length ? ' · <a href="#" data-fi="accept-strong">Record all ' + S.strong.length + ' sure matches</a>' : '') + '</div></div>' +
      '<div class="fi-tile"><div class="k">Delivered and unpaid</div><div class="v">' + S.unpaid.length + '</div><div class="s">' + money(S.unpaid.reduce(function(s, o){ return s + due(o); }, 0)) + ' · ' + S.noCredit.length + ' with no payment in the bank</div></div>' +
      '<div class="fi-tile"><div class="k">Money in</div><div class="v">' + money(S.inMatched) + '</div><div class="s">matched · ' + money(S.inOpen) + ' to review</div></div>' +
      '<div class="fi-tile"><div class="k">Money out</div><div class="v">' + money(S.outMatched) + '</div><div class="s">matched · ' + money(S.outOpen) + ' to review</div></div>' +
    '</div>';
    const f = V.filter, q = V.q.trim().toLowerCase();
    let list = B.txns.filter(function(t){
      if(V.dir === 'in' && t.amount < 0) return false;
      if(V.dir === 'out' && t.amount > 0) return false;
      if(f === 'review' && t.match) return false;
      if(f === 'suggested' && (t.match || !suggestion(t))) return false;
      if(f === 'matched' && !(t.match && t.match.kind !== 'ignore')) return false;
      if(f === 'ignored' && !(t.match && t.match.kind === 'ignore')) return false;
      return !q || (t.desc + ' ' + t.ref + ' ' + Math.abs(t.amount)).toLowerCase().indexOf(q) !== -1;
    });
    const n = function(k){ return B.txns.filter(function(t){ return k === 'review' ? !t.match : k === 'suggested' ? !t.match && suggestion(t) : k === 'matched' ? t.match && t.match.kind !== 'ignore' : k === 'ignored' ? t.match && t.match.kind === 'ignore' : true; }).length; };
    h += '<div class="panel"><div class="fi-bar"><div class="fi-chips">' + [['review', 'To review'], ['suggested', 'Suggested'], ['matched', 'Matched'], ['ignored', 'Set aside'], ['all', 'All']].map(function(c){ return '<button class="' + (f === c[0] ? 'on' : '') + '" data-fi-f="' + c[0] + '">' + c[1] + ' <b>' + n(c[0]) + '</b></button>'; }).join('') + '</div>' +
      '<div class="fi-chips">' + [['all', 'In and out'], ['in', 'Money in'], ['out', 'Money out']].map(function(c){ return '<button class="' + (V.dir === c[0] ? 'on' : '') + '" data-fi-d="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>' +
      '<input class="fi-q" data-fi-q placeholder="Search narration, reference, amount" value="' + esc(V.q) + '"></div>' +
      (list.length ? '<div class="fi-list">' + list.slice(0, V.show).map(rowHtml).join('') + '</div>' + (list.length > V.show ? '<button class="fi-more" data-fi="more">Show ' + Math.min(60, list.length - V.show) + ' more of ' + (list.length - V.show) + '</button>' : '') :
        '<p class="fi-dim">' + (f === 'review' ? 'Everything here is matched or set aside.' : 'No bank lines here.') + '</p>') + '</div>';
    if(S.noCredit.length) h += '<div class="panel"><div class="panel-title">Delivered, unpaid, and no payment in the bank</div><p class="fi-dim">These are real dues as far as this statement shows. Chase these, not the whole unpaid list.</p>' +
      S.noCredit.sort(function(a, b){ return due(b) - due(a); }).slice(0, 30).map(function(o){ return '<div class="fi-due"><a href="#" data-fi="open" data-id="' + o.id + '">' + esc((o.displayId ? o.displayId + ' · ' : '') + who(o)) + '</a><span class="fi-dim">delivered ' + fmt(o.deliveryDate) + '</span><b>' + money(due(o)) + '</b></div>'; }).join('') + '</div>';
    h += '<p class="fi-dim">Imported: ' + B.imports.slice(-5).reverse().map(function(i){ return esc(i.file) + ' (' + i.added + ' new of ' + i.lines + ')'; }).join(' · ') + '</p>';
    root.innerHTML = h;
  }
  window.renderFinance = render;

  // ---------- events ----------
  function inTab(e){ const t = document.getElementById('tabFinance'); return t && t.contains(e.target); }
  function txn(id){ return bank().txns.find(function(t){ return t.id === id; }); }
  document.addEventListener('click', function(e){
    if(!inTab(e)) return;
    const fb = e.target.closest('[data-fi-f]'); if(fb){ V.filter = fb.getAttribute('data-fi-f'); V.show = 60; render(); return; }
    const db = e.target.closest('[data-fi-d]'); if(db){ V.dir = db.getAttribute('data-fi-d'); render(); return; }
    const b = e.target.closest('[data-fi]'); if(!b) return;
    if(b.tagName === 'A') e.preventDefault();
    const a = b.getAttribute('data-fi'), t = txn(b.getAttribute('data-id'));
    if(a === 'open'){ const i = state.orders.findIndex(function(o){ return o.id === b.getAttribute('data-id'); }); if(i !== -1) openOrderDetailModal(state.orders[i].id, i); }
    else if(a === 'more'){ V.show += 60; render(); }
    else if(a === 'pay' && t){ const o = state.orders.find(function(x){ return x.id === b.getAttribute('data-o'); }); if(!o) return; const paid = o.paymentStatus === 'paid' || due(o) === 0; recordPayment(t, o, paid); after((paid ? 'Confirmed payment for ' : 'Recorded ' + money(t.amount) + ' for ') + (o.displayId || who(o))); }
    else if(a === 'undo' && t){ undo(t); after('Undone'); }
    else if(a === 'link-exp' && t){ const ex = (state.expenses || []).find(function(x){ return x.id === b.getAttribute('data-e'); }); if(!ex) return; ex.bankTxnId = t.id; t.match = { kind: 'expense', expenseId: ex.id, at: new Date().toISOString() }; after('Linked to the expense'); }
    else if(a === 'add-exp' && t){
      const root = document.getElementById('financeRoot'), g = function(k){ const el = root.querySelector('[data-fi-' + k + '="' + t.id + '"]'); return el ? el.value.trim() : ''; };
      if(!g('cat')){ showNoticeModal('Give it a category first, e.g. Filament, Shipping, Rent.'); return; }
      if(!state.expenses) state.expenses = [];
      const ex = { id: newId(), date: t.date, item: t.desc.slice(0, 80), category: g('cat'), cost: Math.abs(t.amount), type: g('type') || 'opex', vendor: g('ven'), bankTxnId: t.id };
      state.expenses.push(ex);
      t.match = { kind: 'expense', expenseId: ex.id, created: true, at: new Date().toISOString() };
      if(typeof renderExpenses === 'function') try{ renderExpenses(); }catch(err){}
      after('Added ' + money(ex.cost) + ' to Expenses');
    }
    else if(a === 'accept-strong'){
      const S = stats();
      showConfirmModal('Record ' + S.strong.length + ' payments where the order number or the exact amount and client name are in the bank narration? Each one can be undone.', function(){
        let n = 0;
        S.strong.forEach(function(x){ const s = suggestion(x); if(!s) return; const best = s.list[0]; recordPayment(x, best.o, best.paid); n++; });
        after('Recorded ' + n + ' payments');
      }, 'Record all');
    }
  });
  document.addEventListener('change', async function(e){
    if(!inTab(e)) return;
    const el = e.target;
    if(el.hasAttribute('data-fi-file')){
      const f = el.files && el.files[0]; if(!f) return;
      try{
        const r = await importFile(f);
        showNoticeModal('Read ' + r.lines + ' bank lines (' + fmt(r.from) + ' – ' + fmt(r.to) + '). ' + r.added + ' new' + (r.dup ? ', ' + r.dup + ' already imported' : '') + '.');
      }catch(err){ showNoticeModal(err.message || String(err)); }
      el.value = ''; V.filter = 'review'; render();
    } else if(el.hasAttribute('data-fi-pick') && el.value){
      const t = txn(el.getAttribute('data-fi-pick')), o = state.orders.find(function(x){ return x.id === el.value; }); if(!t || !o) return;
      recordPayment(t, o, false); after('Recorded ' + money(t.amount) + ' for ' + (o.displayId || who(o)));
    } else if(el.hasAttribute('data-fi-ignore') && el.value){
      const t = txn(el.getAttribute('data-fi-ignore')); if(!t) return;
      t.match = { kind: 'ignore', why: el.value, at: new Date().toISOString() }; after('Set aside');
    }
  });
  document.addEventListener('input', function(e){
    if(!inTab(e) || !e.target.hasAttribute('data-fi-q')) return;
    V.q = e.target.value; const pos = e.target.selectionStart; render();
    const q = document.querySelector('#financeRoot [data-fi-q]'); if(q){ q.focus(); try{ q.setSelectionRange(pos, pos); }catch(err){} }
  });

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent = [
    '#tabFinance{font-family:"Space Grotesk",sans-serif}',
    '#tabFinance .fi-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin:4px 0 14px}',
    '#tabFinance .fi-title{font-size:26px;font-weight:700;color:var(--text)}',
    '#tabFinance .fi-sub,#tabFinance .fi-dim{color:var(--dim);font-size:12.5px}',
    '#tabFinance .fi-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:7px 13px;font:13px "Space Grotesk",sans-serif;cursor:pointer;white-space:nowrap;display:inline-block}',
    '#tabFinance .fi-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600}',
    '#tabFinance .fi-empty p{font-size:13.5px;line-height:1.55;max-width:640px}',
    '#tabFinance .fi-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:14px}',
    '#tabFinance .fi-tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;position:relative;overflow:hidden}',
    '#tabFinance .fi-tile::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:var(--cyan)}',
    '#tabFinance .fi-tile.warn::before{background:var(--amber)}',
    '#tabFinance .fi-tile .k{font:10.5px "JetBrains Mono",monospace;letter-spacing:1px;text-transform:uppercase;color:var(--dim)}',
    '#tabFinance .fi-tile .v{font-size:26px;font-weight:700;color:var(--text);margin-top:4px}',
    '#tabFinance .fi-tile .s{font-size:12.5px;color:var(--dim);margin-top:2px}',
    '#tabFinance .fi-tile a{color:var(--cyan)}',
    '#tabFinance .fi-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
    '#tabFinance .fi-chips{display:flex;gap:4px;background:var(--input-bg);border-radius:10px;padding:3px;flex-wrap:wrap}',
    '#tabFinance .fi-chips button{border:none;background:transparent;border-radius:8px;padding:6px 11px;font:13px "Space Grotesk",sans-serif;color:var(--dim);cursor:pointer}',
    '#tabFinance .fi-chips button b{font-weight:600;margin-left:2px}',
    '#tabFinance .fi-chips button.on{background:var(--panel);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '#tabFinance .fi-q{flex:1 1 220px;min-height:36px;border-radius:9px;font-family:"Space Grotesk",sans-serif}',
    '#tabFinance .fi-row{display:grid;grid-template-columns:78px minmax(160px,1.3fr) 110px minmax(280px,2fr);gap:12px;align-items:center;padding:10px 4px;border-top:1px solid var(--line);font-size:13px}',
    '#tabFinance .fi-row.done{opacity:.75}',
    '#tabFinance .fi-date{font:12px "JetBrains Mono",monospace;color:var(--dim)}',
    '#tabFinance .fi-desc{min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;color:var(--text)}',
    '#tabFinance .fi-desc i{display:block;font-style:normal;font-size:11px;color:var(--dim)}',
    '#tabFinance .fi-amt{font:600 13.5px "JetBrains Mono",monospace;text-align:right}',
    '#tabFinance .fi-amt.in{color:var(--green)} #tabFinance .fi-amt.out{color:var(--text)}',
    '#tabFinance .fi-act{display:flex;gap:6px;flex-wrap:wrap;align-items:center;min-width:0}',
    '#tabFinance .fi-sug{flex:1 1 100%;font-size:12.5px} #tabFinance .fi-sug i{font-style:normal;color:var(--dim);margin-left:6px}',
    '#tabFinance .fi-sel,#tabFinance .fi-cat,#tabFinance .fi-ven{min-height:32px;border-radius:8px;font:12.5px "Space Grotesk",sans-serif;max-width:190px}',
    '#tabFinance .fi-cat{width:120px} #tabFinance .fi-ven{width:130px} #tabFinance .fi-type{width:130px}',
    '#tabFinance .fi-done{color:var(--green);font-size:12.5px} #tabFinance .fi-done a{color:var(--cyan)}',
    '#tabFinance .fi-link{background:none;border:none;color:var(--dim);text-decoration:underline;cursor:pointer;font:12px "Space Grotesk",sans-serif}',
    '#tabFinance .fi-more{background:none;border:none;color:var(--cyan);cursor:pointer;font:13px "Space Grotesk",sans-serif;margin-top:8px}',
    '#tabFinance .fi-due{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line);font-size:13.5px}',
    '#tabFinance .fi-due a{color:var(--cyan);text-decoration:none;font-weight:600} #tabFinance .fi-due b{margin-left:auto;font-family:"JetBrains Mono",monospace}',
    '@media (max-width:820px){#tabFinance .fi-row{grid-template-columns:70px 1fr auto}#tabFinance .fi-act{grid-column:1/-1}}'
  ].join('');
  document.head.appendChild(css);
})();
