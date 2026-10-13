// ===================================================================
// ========================= SUPPORT (Studio) ========================
// ===================================================================
// One inbox for brand partners (Buyer app messages and damage claims), triaged by urgency, each
// with a reply drafted from the facts Studio holds: the order's progress and dispatch date, the
// invoice and what's due. Replies go back to the Buyer app. Also customer-voice themes over 90 days,
// and the Help & FAQ brand partners see in the Buyer app (nothing is published until you save it).
// Requests live in buyer_requests (buyers-admin.js); the FAQ in state.buyerFaq, sent in each buyer pack.
(function(){
  if(window.TT_STOCK_MODE) return;

  const V = { view: 'inbox', show: 'open' };
  // {minPerProduct} and {minOrder} are filled in the Buyer app from each partner's own terms.
  const DEFAULT_FAQ = [
    ['What is the minimum order?', 'At least {minPerProduct} pieces of each product and {minOrder} pieces per order. Different products add up toward the order minimum.'],
    ['Do the prices include GST?', 'No. Prices are ex-GST; GST is added on your invoice.'],
    ['When do I pay?', 'Pay on delivery, with 7 days’ grace. What you owe and every invoice are under Account.'],
    ['How do bigger orders get cheaper?', 'The more pieces of a product you order, the bigger the discount. Each product in the Shop shows its price breaks.'],
    ['How do I track my order?', 'Purchases shows how many pieces are made, and the courier and tracking number once it is dispatched.'],
    ['Something arrived broken or wrong. What do I do?', 'Open the order in Purchases and tap Report a problem. Add photos and choose replacements or credit.'],
    ['Will I get a GST invoice?', 'Yes. Every order has a GST invoice under Account → Thread Tribe invoices. Add your GSTIN to your details so it shows on the invoice.'],
    ['Which bulbs can I use in the lamps?', 'LED bulbs only. The lamps are 3D-printed in PLA, a plant-based plastic that softens with heat, so never use halogen or incandescent bulbs.'],
    ['Can I share the catalogue with my own customers?', 'Yes. Promote has a catalogue under your business name, as a PDF or a WhatsApp list, and photos and captions for your posts.']
  ];
  // What a message is about, from its words.
  const TOPICS = [
    ['delay', 'Delays and status', /when|where|status|update|dispatch|deliver|late|delay|kab|kitna time|how long|track/i],
    ['quality', 'Damage and quality', /broken|damage|crack|defect|wrong|missing|faulty|poor|quality|toot/i],
    ['price', 'Price and discounts', /price|rate|discount|cheaper|costly|expensive|margin|offer/i],
    ['payment', 'Payments and invoices', /pay|paid|invoice|bill|gst|upi|bank|credit|due/i],
    ['product', 'New products and custom', /new design|custom|personali[sz]|do you (have|make)|can you make|bigger|smaller|another colou?r|catalog/i],
    ['praise', 'Praise', /thank|great|love|amazing|beautiful|nice|happy|excellent|superb/i]
  ];

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function reqs(){ return (window.TTBuyers && window.TTBuyers.requests()) || []; }
  function name(q){ return (window.TTBuyers && window.TTBuyers.clientName && window.TTBuyers.clientName(q.client_id)) || 'Brand partner'; }
  function first(n){ return String(n || '').split(' ')[0]; }
  function text(q){ const p = q.payload || {}; return [p.text, p.notes].filter(Boolean).join(' '); }
  function ageH(q){ return Math.max(0, (Date.now() - Date.parse(q.created_at || 0)) / 3600000); }
  function ago(q){ const h = ageH(q); return h < 1 ? 'just now' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; }
  function topic(t){ const x = TOPICS.find(function(k){ return k[2].test(t); }); return x ? x[0] : 'other'; }
  function target(o){ return o.dispatchBy || o.dueDate || ''; }
  function fmt(s){ if(!s) return ''; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  // The order a request is about: the one it names, else the partner's latest open order.
  function orderOf(q){
    const p = q.payload || {}, mine = state.orders.filter(function(o){ return o.clientId === q.client_id; });
    const named = mine.find(function(o){ return (p.displayId && o.displayId === p.displayId) || (p.orderId && o.id === p.orderId) || (o.displayId && text(q).toUpperCase().replace(/\s/g, '').indexOf(o.displayId.replace(/\s/g, '')) !== -1); });
    if(named) return named;
    const open = mine.filter(function(o){ return ['booked', 'in_production', 'production_done'].indexOf(o.status) !== -1; }).sort(function(a, b){ return (target(a) || '9').localeCompare(target(b) || '9'); });
    // Payment questions are about money owed, so prefer the order with a balance.
    const owing = mine.filter(function(o){ return owed(o) > 0; }).sort(function(a, b){ return (b.deliveryDate || b.orderedDate || '').localeCompare(a.deliveryDate || a.orderedDate || ''); });
    return (topic(text(q)) === 'payment' ? owing[0] || open[0] : open[0] || owing[0]) || mine[mine.length - 1] || null;
  }
  function made(o){
    const prod = (window.TTBuyers && window.TTBuyers.prod()) || {}, ps = prod[o.id];
    let m = 0, t = 0; (o.products || []).forEach(function(p){ const f = ps && ps.lines && ps.lines[p.id]; t += +p.qty || 0; m += Math.min(+p.qty || 0, Math.max(+p.already || 0, f ? f.made || 0 : 0)); });
    return { made: m, total: t };
  }
  function owed(o){ try{ return o.paymentStatus === 'paid' || o.paymentStatus === 'refunded' ? 0 : Math.max(0, Math.round(orderTotals(o).grandTotal - (o.amountPaid || 0))); }catch(e){ return 0; } }
  function urgency(q){
    if(q.kind === 'claim') return 0;
    const o = orderOf(q), tp = topic(text(q)), late = o && target(o) && target(o) < new Date().toISOString().slice(0, 10) && !o.shippedDate && o.status !== 'delivered';
    if(late || tp === 'payment') return 1;
    if(tp === 'delay' || ageH(q) > 24) return 1;
    return 2;
  }
  function draft(q){
    const n = first(name(q)), o = orderOf(q), tp = q.kind === 'claim' ? 'claim' : topic(text(q)), biz = (state.business && state.business.name) || 'Thread Tribe';
    const ref = o ? o.displayId || 'your order' : 'your order';
    let body;
    if(tp === 'claim'){ const p = q.payload || {}, pcs = (p.lines || []).reduce(function(t, l){ return t + (+l.qty || 0); }, 0); body = 'sorry about the ' + pcs + ' piece' + (pcs === 1 ? '' : 's') + ' on ' + (p.displayId || ref) + '. We have your photos and will ' + (p.want === 'credit' ? 'credit them on your account' : 'send replacements with your next dispatch') + '. You will see it in the app once it is done.'; }
    else if(tp === 'delay' && o){
      const m = made(o);
      if(o.shippedDate) body = ref + ' was dispatched on ' + fmt(o.shippedDate) + (o.courier ? ' with ' + o.courier : '') + (o.trackingNo ? ', tracking ' + o.trackingNo : '') + '. You can follow it under Purchases.';
      else if(o.status === 'production_done') body = ref + ' is ready, all ' + m.total + ' pieces, and goes out ' + (target(o) ? 'by ' + fmt(target(o)) : 'shortly') + '.';
      else body = ref + ': ' + m.made + ' of ' + m.total + ' pieces are made' + (target(o) ? ', and it is planned to dispatch by ' + fmt(target(o)) : '') + '. We will update you when it leaves.';
    }
    else if(tp === 'payment' && o){ const d = owed(o); body = (o.invoiceNumber ? 'the invoice for ' + ref + ' (' + o.invoiceNumber + ') is in the app under Account. ' : '') + (d ? 'The balance on ' + ref + ' is ' + money(d) + ', due on delivery with 7 days’ grace.' : ref + ' is fully paid. Thank you!'); }
    else if(tp === 'price') body = 'your prices in the app already include your trade discount, and bigger quantities of a product unlock the next price break shown in the Shop. Tell us the quantities you have in mind and we will check the best price.';
    else if(tp === 'product') body = 'thanks for the idea! We have added it to our product list, which we review every month, and will tell you if we make it.';
    else if(tp === 'praise') body = 'thank you, that made our day! Tag us when you post them.';
    else body = 'thanks for your message. We will get back to you today.';
    return 'Hi ' + n + ', ' + body + '\n— ' + biz;
  }

  // ---------- views ----------
  function inboxHtml(){
    const list = reqs().filter(function(q){ return (q.kind === 'message' || q.kind === 'claim') && (V.show === 'all' || q.status === 'open'); })
      .sort(function(a, b){ return urgency(a) - urgency(b) || (a.created_at || '').localeCompare(b.created_at || ''); });
    const open = reqs().filter(function(q){ return (q.kind === 'message' || q.kind === 'claim') && q.status === 'open'; });
    const U = ['Urgent', 'Soon', 'Normal'];
    let h = '<div class="sp-bar"><div class="sp-chips"><button class="' + (V.show === 'open' ? 'on' : '') + '" data-sp-show="open">Open <b>' + open.length + '</b></button><button class="' + (V.show === 'all' ? 'on' : '') + '" data-sp-show="all">All</button></div>' +
      '<span class="sp-dim">Order requests and profile changes stay in the Buyer App tab.</span></div>';
    if(!list.length) return h + '<div class="panel"><p class="sp-dim">' + (window.TTBuyers ? 'No open messages or claims from brand partners.' : 'Sign in to cloud sync to see brand-partner messages.') + '</p></div>';
    return h + list.map(function(q){
      const u = urgency(q), o = orderOf(q), p = q.payload || {}, done = q.status !== 'open';
      const what = q.kind === 'claim' ? 'Problem with ' + (p.displayId || 'an order') + ': ' + (p.lines || []).map(function(l){ return (+l.qty || 0) + ' × ' + l.name; }).join(', ') + (p.notes ? '. “' + p.notes + '”' : '') : '“' + text(q) + '”';
      return '<div class="panel sp-item' + (done ? ' done' : '') + '"><div class="sp-h"><span class="sp-u u' + u + '">' + (done ? 'Answered' : U[u]) + '</span><b>' + esc(name(q)) + '</b><span class="sp-dim">' + (q.kind === 'claim' ? 'Claim' : 'Message') + ' · ' + ago(q) + (o ? ' · ' + esc(o.displayId || '') + ' ' + esc(o.status.replace(/_/g, ' ')) : '') + '</span></div>' +
        '<div class="sp-text">' + esc(what) + '</div>' +
        (done ? (q.reply ? '<div class="sp-reply-done">You replied: ' + esc(q.reply) + '</div>' : '') :
          '<textarea class="sp-draft" data-sp-draft="' + esc(q.id) + '" rows="3">' + esc(draft(q)) + '</textarea>' +
          '<div class="sp-a"><button class="sp-btn primary" data-sp="send" data-id="' + esc(q.id) + '">Send reply</button>' +
          (q.kind === 'claim' ? '<button class="sp-btn" data-sp="buyers">Replace or credit in Buyer App</button>' : '') +
          '<button class="sp-btn" data-sp="task" data-id="' + esc(q.id) + '">Make a task</button>' +
          (o ? '<button class="sp-btn" data-sp="order" data-id="' + esc(o.id) + '">Open ' + esc(o.displayId || 'order') + '</button>' : '') + '</div>') + '</div>';
    }).join('');
  }
  function voiceHtml(){
    const now = Date.now(), cut = function(d){ return new Date(now - d * 86400000).toISOString(); };
    const all = reqs().filter(function(q){ return (q.kind === 'message' || q.kind === 'claim' || q.kind === 'order') && text(q); });
    const cur = all.filter(function(q){ return (q.created_at || '') >= cut(90); }), prev = all.filter(function(q){ return (q.created_at || '') < cut(90) && (q.created_at || '') >= cut(180); });
    const count = function(list, k){ return list.filter(function(q){ return (q.kind === 'claim' ? 'quality' : topic(text(q))) === k; }); };
    return '<div class="panel"><div class="panel-title">What brand partners talk about · last 90 days</div><p class="sp-dim">From messages, claims and order notes, against the 90 days before. New-product requests also feed Product Lab.</p>' +
      TOPICS.map(function(t){
        const c = count(cur, t[0]), p = count(prev, t[0]).length;
        return '<div class="sp-topic"><div class="sp-topic-h"><b>' + t[1] + '</b><span>' + c.length + '</span><span class="sp-dim">' + (p ? (c.length >= p ? '▲ ' : '▼ ') + 'was ' + p : '') + '</span></div>' +
          c.slice(0, 2).map(function(q){ return '<div class="sp-q">“' + esc(text(q).slice(0, 160)) + '” <i>' + esc(name(q)) + '</i></div>'; }).join('') + '</div>';
      }).join('') + '</div>';
  }
  function faqHtml(){
    const saved = Array.isArray(state.buyerFaq), list = saved ? state.buyerFaq : DEFAULT_FAQ.map(function(x){ return { q: x[0], a: x[1] }; });
    return '<div class="panel"><div class="panel-title">Help & FAQ in the Buyer app</div>' +
      (saved ? '<p class="sp-dim">Live in the Buyer app (Account → Help & FAQ). Changes go out the next time packs publish.</p>' : '<p class="sp-warn">Not live yet. Check each answer matches how you work, then save to publish it to brand partners.</p>') +
      '<p class="sp-dim">{minPerProduct} and {minOrder} are filled in with each partner’s own minimums.</p>' +
      list.map(function(f, i){ return '<div class="sp-faq"><input data-sp-fq="' + i + '" value="' + esc(f.q) + '"><textarea data-sp-fa="' + i + '" rows="2">' + esc(f.a) + '</textarea><button class="sp-link" data-sp="faq-del" data-i="' + i + '">Remove</button></div>'; }).join('') +
      '<div class="sp-a"><button class="sp-btn" data-sp="faq-add">+ Question</button><button class="sp-btn primary" data-sp="faq-save">' + (saved ? 'Save' : 'Save and publish') + '</button>' + (saved ? '<button class="sp-link" data-sp="faq-off">Take it down</button>' : '') + '</div></div>';
  }
  function faqFromForm(){
    const root = document.getElementById('supportRoot'), out = [];
    root.querySelectorAll('[data-sp-fq]').forEach(function(el){ const i = el.getAttribute('data-sp-fq'), a = root.querySelector('[data-sp-fa="' + i + '"]'); if(el.value.trim() && a && a.value.trim()) out.push({ q: el.value.trim().slice(0, 200), a: a.value.trim().slice(0, 1000) }); });
    return out;
  }
  function render(){
    const root = document.getElementById('supportRoot'); if(!root) return;
    const tab = function(v, t){ return '<button class="sp-tab' + (V.view === v ? ' on' : '') + '" data-sp-view="' + v + '">' + t + '</button>'; };
    const open = reqs().filter(function(q){ return (q.kind === 'message' || q.kind === 'claim') && q.status === 'open'; }).length;
    root.innerHTML = '<div class="sp-head"><div class="sp-title">Support inbox</div><div class="sp-dim">Brand partners’ messages and claims from the Buyer app</div></div>' +
      '<div class="sp-tabs">' + tab('inbox', 'Inbox' + (open ? ' · ' + open : '')) + tab('voice', 'Customer voice') + tab('faq', 'Help & FAQ') + '</div>' +
      (V.view === 'voice' ? voiceHtml() : V.view === 'faq' ? faqHtml() : inboxHtml());
  }
  window.renderSupport = function(){ render(); if(window.TTBuyers) window.TTBuyers.refresh().then(render).catch(function(){}); };

  document.addEventListener('click', async function(e){
    const t = document.getElementById('tabSupport'); if(!t || !t.contains(e.target)) return;
    const vw = e.target.closest('[data-sp-view]'); if(vw){ V.view = vw.getAttribute('data-sp-view'); render(); return; }
    const sh = e.target.closest('[data-sp-show]'); if(sh){ V.show = sh.getAttribute('data-sp-show'); render(); return; }
    const b = e.target.closest('[data-sp]'); if(!b) return;
    const a = b.getAttribute('data-sp'), id = b.getAttribute('data-id');
    if(a === 'send'){
      const ta = document.querySelector('#supportRoot [data-sp-draft="' + id + '"]'), msg = ta ? ta.value.trim() : '';
      if(!msg){ showNoticeModal('Write a reply first.'); return; }
      if(window.TTBuyers && await window.TTBuyers.reply(id, 'done', msg)){ showToast('Reply sent to the Buyer app'); render(); }
    } else if(a === 'buyers'){ const tb = document.querySelector('.tab-btn[data-tab="buyers"]'); if(tb) tb.click(); }
    else if(a === 'order'){ const i = state.orders.findIndex(function(o){ return o.id === id; }); if(i !== -1) openOrderDetailModal(id, i); }
    else if(a === 'task'){
      const q = reqs().find(function(x){ return x.id === id; }); if(!q || !window.TTTasks) return;
      const o = orderOf(q);
      await window.TTTasks.add('Support: ' + name(q) + ' — ' + (q.kind === 'claim' ? 'claim on ' + ((q.payload || {}).displayId || 'an order') : text(q).slice(0, 60)), '', new Date().toISOString().slice(0, 10), q.kind === 'claim' ? 'high' : 'normal', o ? { type: 'order', id: o.id } : null, text(q));
      showToast('Task added');
    }
    else if(a === 'faq-add'){ state.buyerFaq = faqFromForm().concat([{ q: 'New question', a: 'Answer' }]); render(); }
    else if(a === 'faq-del'){ const list = faqFromForm(); list.splice(+b.getAttribute('data-i'), 1); state.buyerFaq = list; render(); }
    else if(a === 'faq-save'){ state.buyerFaq = faqFromForm(); scheduleSave(); if(typeof cloudPublishPacks === 'function') try{ cloudPublishPacks(); }catch(err){} showToast('Help & FAQ saved; brand partners see it after the next publish'); render(); }
    else if(a === 'faq-off'){ showConfirmModal('Take Help & FAQ out of the Buyer app?', function(){ delete state.buyerFaq; scheduleSave(); if(typeof cloudPublishPacks === 'function') try{ cloudPublishPacks(); }catch(err){} render(); }, 'Take down'); }
  });

  // Needs you: open claims and messages waiting more than a day.
  window.TTSupport = { open: function(){ return reqs().filter(function(q){ return (q.kind === 'message' || q.kind === 'claim') && q.status === 'open'; }); }, faq: function(){ return Array.isArray(state.buyerFaq) ? state.buyerFaq : null; } };

  const css = document.createElement('style');
  css.textContent = [
    '#tabSupport{font-family:"Space Grotesk",sans-serif}',
    '#tabSupport .sp-head{margin:4px 0 14px} #tabSupport .sp-title{font-size:26px;font-weight:700;color:var(--text)}',
    '#tabSupport .sp-dim{color:var(--dim);font-size:12.5px} #tabSupport .sp-warn{color:var(--amber);font-size:13px;font-weight:600}',
    '#tabSupport .sp-tabs{display:flex;gap:4px;background:var(--input-bg);border-radius:12px;padding:4px;margin-bottom:14px;width:fit-content;max-width:100%;flex-wrap:wrap}',
    '#tabSupport .sp-tab{border:none;background:transparent;border-radius:9px;padding:8px 14px;font:13.5px "Space Grotesk",sans-serif;color:var(--dim);cursor:pointer}',
    '#tabSupport .sp-tab.on{background:var(--panel);color:var(--text);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '#tabSupport .sp-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}',
    '#tabSupport .sp-chips{display:flex;gap:4px} #tabSupport .sp-chips button{border:1px solid var(--line);background:transparent;border-radius:999px;padding:5px 12px;font:13px "Space Grotesk",sans-serif;color:var(--text);cursor:pointer} #tabSupport .sp-chips button.on{border-color:var(--cyan);background:rgba(79,209,197,.12)}',
    '#tabSupport .sp-item{margin-bottom:10px} #tabSupport .sp-item.done{opacity:.7}',
    '#tabSupport .sp-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14px}',
    '#tabSupport .sp-u{font:10.5px "JetBrains Mono",monospace;letter-spacing:.6px;text-transform:uppercase;border-radius:999px;padding:2px 9px;border:1px solid var(--line);color:var(--dim)}',
    '#tabSupport .sp-u.u0{color:var(--red);border-color:var(--red)} #tabSupport .sp-u.u1{color:var(--amber);border-color:var(--amber)}',
    '#tabSupport .sp-text{font-size:13.5px;margin:8px 0;line-height:1.5}',
    '#tabSupport .sp-draft{width:100%;box-sizing:border-box;border-radius:10px;font:13.5px "Space Grotesk",sans-serif;min-height:70px}',
    '#tabSupport .sp-reply-done{font-size:13px;color:var(--dim);border-left:3px solid var(--green);padding-left:10px}',
    '#tabSupport .sp-a{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center}',
    '#tabSupport .sp-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:7px 13px;font:13px "Space Grotesk",sans-serif;cursor:pointer}',
    '#tabSupport .sp-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600}',
    '#tabSupport .sp-link{background:none;border:none;color:var(--dim);text-decoration:underline;cursor:pointer;font:12.5px "Space Grotesk",sans-serif}',
    '#tabSupport .sp-topic{padding:10px 0;border-top:1px solid var(--line)} #tabSupport .sp-topic-h{display:flex;gap:10px;align-items:baseline} #tabSupport .sp-topic-h span:first-of-type{font:600 16px "JetBrains Mono",monospace}',
    '#tabSupport .sp-q{font-size:12.5px;color:var(--dim);margin-top:4px} #tabSupport .sp-q i{font-style:normal;color:var(--text)}',
    '#tabSupport .sp-faq{display:grid;gap:6px;padding:10px 0;border-top:1px solid var(--line)} #tabSupport .sp-faq input{font-weight:600}',
    '#tabSupport .sp-faq input,#tabSupport .sp-faq textarea{width:100%;box-sizing:border-box;border-radius:9px;font:13.5px "Space Grotesk",sans-serif} #tabSupport .sp-faq .sp-link{justify-self:start}'
  ].join('');
  document.head.appendChild(css);
})();
