// ===================================================================
// ===================== PAYMENT LADDER + CREDIT HOLD ================
// ===================================================================
// Trade terms are payment on delivery with a 7-day grace period. Two rules,
// both switched on in System → Automations:
//
//   Payment ladder  An unpaid delivered order gets a reminder at day 7, a
//                   firmer one at day 14 and a final one at day 21 after
//                   delivery. Each shows in Home → Needs you with a ready
//                   WhatsApp message; tapping Send opens WhatsApp and records
//                   that step on the order, so the next one comes due a week
//                   later. At day 21 the client's sales rep also gets a task.
//   Credit hold     Booking an order for a client who owes money delivered
//                   21 or more days ago asks first, and the order pop-up
//                   shows the amount while the order is a quote or booked.
//
// Nothing is sent without a person tapping Send. Reminders sent are stored on
// the order (payReminders), so every device sees the same step.
(function(){
  if(window.TT_STOCK_MODE) return;

  const STEPS = [7, 14, 21];     // days after delivery
  const HOLD_DAYS = 21;

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function dayDiff(a, b){ return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
  function fmt(s){ if(!s) return ''; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function rupees(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function isOn(id){ return !!(window.TTAutomations && window.TTAutomations.isOn(id)); }
  function client(id){ return (state.clients || []).find(function(c){ return c.id === id; }); }
  function who(o){ const c = client(o.clientId); return (c && c.name) || o.clientName || o.name || 'there'; }
  function owed(o){ return orderOwed(o); }
  function deliveredOn(o){ return (o.status === 'delivered' || o.shippedDate) ? (o.deliveryDate || o.shippedDate || '').slice(0, 10) : ''; }
  // WhatsApp wants 91XXXXXXXXXX: accepts 98765 43210, 098765 43210, +91 98765 43210.
  function phoneOf(o){
    const c = client(o.clientId);
    let raw = String((c && c.phone) || o.clientPhone || '').replace(/\D/g, '');
    if(raw.length === 11 && raw[0] === '0') raw = raw.slice(1);
    return raw.length === 10 ? '91' + raw : raw;
  }
  function save(){ if(typeof scheduleSave === 'function') scheduleSave(); }

  // ---------- the ladder ----------
  // step: how many reminders are due by now (0–3); sentStep: the highest one already sent.
  function info(o){
    const since = deliveredOn(o), due = owed(o);
    if(!since || !due) return null;
    const days = dayDiff(today(), since);
    if(!isFinite(days)) return null;   // a delivery date Studio can't read
    const step = STEPS.filter(function(d){ return days >= d; }).length;
    const sentStep = (o.payReminders || []).reduce(function(m, r){ return Math.max(m, +r.step || 0); }, 0);
    return { o: o, days: days, due: due, since: since, step: step, sentStep: sentStep,
      next: sentStep < STEPS.length ? addDays(since, STEPS[sentStep]) : '' };
  }
  function all(){ return state.orders.map(info).filter(Boolean); }
  function pending(){ return all().filter(function(x){ return x.step > x.sentStep; }).sort(function(a, b){ return b.step - a.step || b.days - a.days; }); }
  function waiting(){ return all().filter(function(x){ return x.step > 0 && x.step <= x.sentStep; }); }

  function message(x, step){
    const o = x.o, ord = o.displayId ? 'order ' + o.displayId : 'your order', upi = state.business && state.business.upi ? ' UPI: ' + state.business.upi + '.' : '';
    if(step <= 1) return 'Hi ' + who(o) + ', a friendly reminder that ' + rupees(x.due) + ' for ' + ord + ' (delivered ' + fmt(x.since) + ') is now due. Our terms are payment on delivery with 7 days’ grace.' + upi + ' Thank you! — Thread Tribe';
    if(step === 2) return 'Hi ' + who(o) + ', following up on ' + rupees(x.due) + ' for ' + ord + ', delivered ' + fmt(x.since) + ' — it’s now two weeks past delivery. Could you let us know when we can expect it?' + upi + ' — Thread Tribe';
    return 'Hi ' + who(o) + ', ' + rupees(x.due) + ' for ' + ord + ' is now three weeks past delivery (' + fmt(x.since) + '). Please clear it this week or call us to agree a date — we’ll need it settled before we book new orders.' + upi + ' — Thread Tribe';
  }
  const STEP_NAME = ['', 'Reminder', 'Second reminder', 'Final reminder'];

  // Opens WhatsApp with the message for the step that's due, and records it on the order.
  function send(orderId){
    const o = state.orders.find(function(x){ return x.id === orderId; });
    const x = o && info(o);
    if(!x) return;
    const step = Math.max(1, Math.min(STEPS.length, x.step || 1));
    const phone = phoneOf(o), text = message(x, step);
    if(phone.length >= 11) window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank');
    else{
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      if(window.ttToast) window.ttToast('No phone number saved for ' + who(o) + ' — pick the chat in WhatsApp');
    }
    if(x.step > x.sentStep){
      o.payReminders = (o.payReminders || []).concat([{ step: step, at: new Date().toISOString(), by: (typeof cloud !== 'undefined' && cloud.email) || '' }]);
      save();
    }
  }

  // Day 21: a task for the client's sales rep, once per order.
  async function flagReps(){
    if(!isOn('pay-remind') || !window.TTTasks || !window.TTSales || !window.TTSales.loaded()) return;
    const late = all().filter(function(x){ return x.step >= 3 && !x.o.payRepFlaggedAt; });
    if(!late.length) return;
    await window.TTTasks.load();
    for(const x of late){
      const c = client(x.o.clientId), ch = c && window.TTSales.channelOf ? window.TTSales.channelOf(c) : '';
      const rep = ch && window.TTSales.repFor ? window.TTSales.repFor(ch) : null;
      x.o.payRepFlaggedAt = new Date().toISOString();
      const ok = await window.TTTasks.add('Collect ' + rupees(x.due) + ' from ' + who(x.o) + ' (' + (x.o.displayId || 'order') + ')',
        rep || '', today(), 'high', null,
        'Delivered ' + fmt(x.since) + ', ' + x.days + ' days ago. Three WhatsApp reminders are due or sent; a call is next. New bookings for this client ask first (credit hold).');
      if(!ok) delete x.o.payRepFlaggedAt;
    }
    save();
  }

  // For Home → Needs you.
  function needs(){
    if(!isOn('pay-remind')) return [];
    const out = pending().map(function(x){
      return { level: x.step >= 3 ? 0 : 1, rank: 3, score: x.days,
        text: who(x.o) + ' owes ' + rupees(x.due) + ' · ' + x.days + ' days since delivery · ' + STEP_NAME[Math.min(3, x.step)].toLowerCase() + ' due' + (x.o.payRepFlaggedAt ? ' · rep has a task' : ''),
        act: 'ladder', id: x.o.id, btn: x.step >= 3 ? 'Send final reminder' : x.step === 2 ? 'Send 2nd reminder' : 'Send reminder' };
    });
    const w = waiting();
    if(w.length){
      const sum = w.reduce(function(s, x){ return s + x.due; }, 0);
      const nexts = w.map(function(x){ return x.next; }).filter(Boolean).sort();
      out.push({ level: 2, rank: 4, score: 0, text: w.length + ' unpaid order' + (w.length === 1 ? '' : 's') + ' already reminded · ' + rupees(sum) + (nexts.length ? ' · next reminder ' + fmt(nexts[0]) : ' · all reminders sent'), act: 'tab', id: 'invoices', btn: 'See all' });
    }
    return out;
  }

  // ---------- credit hold ----------
  function hold(clientId){
    if(!clientId) return null;
    const late = all().filter(function(x){ return x.o.clientId === clientId && x.days >= HOLD_DAYS; });
    if(!late.length) return null;
    return { due: late.reduce(function(s, x){ return s + x.due; }, 0), days: Math.max.apply(null, late.map(function(x){ return x.days; })), orders: late.map(function(x){ return x.o.displayId || ''; }).filter(Boolean) };
  }
  function holdText(o, h){ return (client(o.clientId) ? client(o.clientId).name : 'This client') + ' owes ' + rupees(h.due) + (h.orders.length ? ' (' + h.orders.join(', ') + ')' : '') + ', delivered ' + h.days + ' days ago. Payment was due by day 7.'; }

  // Ask before an order moves to Booked.
  function guard(orderId, go){
    const o = state.orders.find(function(x){ return x.id === orderId; });
    const h = isOn('credit-hold') && o ? hold(o.clientId) : null;
    if(!h || typeof showConfirmModal !== 'function') return go();
    showConfirmModal(holdText(o, h) + ' Book anyway?', go, 'Book anyway');
  }
  if(typeof convertQuoteToOrder === 'function'){
    const orig = convertQuoteToOrder;
    convertQuoteToOrder = function(orderId){ const self = this, args = arguments; guard(orderId, function(){ orig.apply(self, args); }); };
  }
  if(typeof setOrderStatusDirect === 'function'){
    const orig = setOrderStatusDirect;
    setOrderStatusDirect = function(orderId, status){
      const self = this, args = arguments, o = state.orders.find(function(x){ return x.id === orderId; });
      if(status !== 'booked' || !o || o.status === 'booked') return orig.apply(self, args);
      guard(orderId, function(){ orig.apply(self, args); });
    };
  }

  // A banner in the order pop-up while a quote or booking is open for a client on hold.
  function banner(){
    const body = document.getElementById('orderDetailModalBody');
    const card = body && body.querySelector('.order-card');
    if(!card) return;
    const o = state.orders.find(function(x){ return 'card-' + x.id === card.id; });
    let el = body.querySelector('.pl-hold');
    const h = isOn('credit-hold') && o && ['quoted', 'booked'].indexOf(o.status) !== -1 ? hold(o.clientId) : null;
    if(!h){ if(el) el.remove(); return; }
    // Under the pop-up's header (which sticks to the top), above Client.
    if(!el){ el = document.createElement('div'); el.className = 'pl-hold'; card.insertBefore(el, card.children[1] || null); }
    el.innerHTML = '<b>Credit hold</b> ' + esc(holdText(o, h)) + ' Collect before starting, or book anyway if agreed.';
  }
  if(typeof openOrderDetailModal === 'function'){
    const orig = openOrderDetailModal;
    openOrderDetailModal = function(){ const r = orig.apply(this, arguments); try{ banner(); }catch(e){} return r; };
  }
  document.addEventListener('change', function(e){ if(e.target.closest && e.target.closest('#orderDetailModalBody')) setTimeout(banner, 0); });
  document.addEventListener('click', function(e){ if(e.target.closest && e.target.closest('#orderDetailModalBody')) setTimeout(banner, 0); });

  const css = document.createElement('style');
  css.textContent = '.pl-hold{margin:12px 16px;padding:10px 14px;border:1px solid var(--red);border-radius:10px;background:rgba(240,82,82,.08);font-size:13px;line-height:1.5}.pl-hold b{color:var(--red);margin-right:6px}';
  document.head.appendChild(css);

  setTimeout(function(){ flagReps().catch(function(e){ console.warn('[payment ladder]', e); }); }, 15000);
  setInterval(function(){ if(!document.hidden) flagReps().catch(function(){}); }, 30 * 60000);

  window.TTPayLadder = { on: function(){ return isOn('pay-remind'); }, needs: needs, send: send, info: info, hold: hold, pending: pending };
})();
