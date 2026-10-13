// ===================================================================
// ========================== UI POLISH (Studio) =====================
// ===================================================================
// A cleaner order pop-up. The title bar holds the order name, status pills and
// labelled actions (Invoice, Duplicate, move up/down); Cancel and Delete sit in a
// footer so the Delete cross is never next to Close. The form is grouped into cards
// in working order: Client, Order details, Products, Pricing, Payment, Dates and
// capacity, Production and profit. A linked client shows as a contact card instead
// of read-only inputs, and order source is a row of chips.
// Elements are only moved, relabelled or hidden, never rebuilt, so every listener and
// live updater keeps working. Styles are scoped to the pop-up.
(function(){
  if(window.TT_STOCK_MODE) return;

  const SANS = '"Space Grotesk",sans-serif';
  const css = document.createElement('style');
  css.textContent = [
    '.gantt-wrap{overflow-x:auto;max-width:100%;position:relative}',
    '.order-detail-modal-box{max-width:960px;border:none;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden}',
    '.order-detail-modal-close{position:absolute;float:none;top:18px;right:18px;margin:0;border-radius:999px;padding:7px 14px;font-size:13px;z-index:3}',

    // Title bar: name on the first line, pills left and actions right on the second.
    '.order-detail-modal-box .order-head{flex-wrap:wrap;gap:10px 8px;padding:20px 24px 16px;background:var(--panel);border-bottom:1px solid var(--line)}',
    '.order-detail-modal-box .order-color-tag{width:12px;height:12px;margin-right:2px}',
    '.order-detail-modal-box .order-name-input{flex:1 1 calc(100% - 140px);font-family:' + SANS + ';font-size:22px;font-weight:700;padding:6px 10px;margin:0 96px 0 -10px;border:1px solid transparent;border-radius:10px;background:transparent;min-height:0;transition:border-color .15s,background .15s}',
    '.order-detail-modal-box .order-name-input:hover{border-color:var(--line);background:transparent}',
    '.order-detail-modal-box .order-name-input:focus{border-color:var(--cyan);background:var(--input-bg)}',
    '.order-detail-modal-box .order-head .om-break{flex-basis:100%;height:0}',
    '.order-detail-modal-box .order-head .status-toggle,.order-detail-modal-box .order-head .due-soon-badge,.order-detail-modal-box .order-head .payment-remind-badge{font-size:11px;padding:5px 12px;border-radius:999px}',
    '.om-actions{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '.om-actions .icon-btn{width:auto;height:34px;padding:0 12px;border-radius:9px;font-size:13px;font-family:' + SANS + ';background:var(--input-bg);white-space:nowrap;display:inline-flex;align-items:center;gap:6px}',
    '.om-move{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden}',
    '.om-move .icon-btn{border:none;border-radius:0;width:34px;padding:0;justify-content:center}',
    '.om-move .icon-btn + .icon-btn{border-left:1px solid var(--line)}',

    // Body and section cards.
    '.order-detail-modal-box .order-body{padding:20px 24px 24px;background:var(--bg)}',
    '.om-sec{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px 6px;margin-bottom:14px}',
    '.om-sec-title{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--dim);margin:0 0 12px;display:flex;align-items:center;gap:8px}',
    '.om-sec-title::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--cyan)}',
    '.om-sec > *{margin-bottom:12px}',
    '.om-sec,.om-sec > *,.om-sec .order-meta > *{min-width:0}',
    '.om-sec .due-flag{white-space:normal}',

    // Fields: text in the UI font, numbers and dates stay monospaced.
    '.order-detail-modal-box label{font-size:12px;font-weight:500;color:var(--dim);margin-bottom:6px}',
    '.order-detail-modal-box input[type=text],.order-detail-modal-box input[type=number],.order-detail-modal-box input[type=tel],.order-detail-modal-box input[type=date],.order-detail-modal-box select,.order-detail-modal-box textarea{border-radius:10px;min-height:42px;transition:border-color .15s,box-shadow .15s}',
    '.order-detail-modal-box .order-body input[type=text],.order-detail-modal-box .order-body input[type=tel],.order-detail-modal-box .order-body select,.order-detail-modal-box .order-body textarea{font-family:' + SANS + ';font-size:14px}',
    '.order-detail-modal-box input:focus,.order-detail-modal-box select:focus,.order-detail-modal-box textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(79,209,197,.15);outline:none}',
    '.order-detail-modal-box textarea{min-height:64px}',
    '.order-detail-modal-box input,.order-detail-modal-box select,.order-detail-modal-box textarea{min-width:0;max-width:100%}',
    '.order-detail-modal-box .order-body,.order-detail-modal-box .order-card{min-width:0;max-width:100%}',
    '.order-detail-modal-box .add-btn{border-radius:10px}',
    '.om-hidden{display:none!important}',

    // Client: contact card when linked, picker plus inputs when not.
    '.om-client-card{display:flex;align-items:flex-start;gap:14px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}',
    '.om-avatar{flex:none;width:42px;height:42px;border-radius:50%;background:rgba(79,209,197,.16);color:var(--cyan);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;font-family:' + SANS + '}',
    '.om-client-info{flex:1;min-width:0;font-family:' + SANS + '}',
    '.om-client-name{font-size:16px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.om-client-type{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--cyan);border:1px solid rgba(79,209,197,.4);border-radius:999px;padding:2px 8px;font-weight:400}',
    '.om-client-line{font-size:13px;color:var(--dim);margin-top:4px;line-height:1.45;overflow-wrap:anywhere}',
    '.om-client-line a{color:var(--text);text-decoration:none;font-weight:500}',
    '.om-client-btns{display:flex;gap:6px;flex:none}',
    '.om-link-btn{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:6px 11px;font-size:12px;font-family:' + SANS + ';cursor:pointer;white-space:nowrap}',
    '.om-link-btn:hover{border-color:var(--cyan);color:var(--cyan)}',
    '.om-client-hint{font-size:12px;color:var(--dim);font-family:' + SANS + ';margin-top:-4px}',
    '.order-detail-modal-box .client-picker{margin-bottom:0}',
    '.order-detail-modal-box .client-row{margin-bottom:0!important;margin-top:0!important}',

    // Order source chips.
    '.om-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.om-chip{background:var(--input-bg);border:1px solid transparent;color:var(--text);border-radius:999px;padding:7px 14px;font-size:13px;font-family:' + SANS + ';cursor:pointer}',
    '.om-chip:hover{border-color:var(--line)}',
    '.om-chip.on{background:rgba(79,209,197,.14);border-color:var(--cyan);color:var(--text);font-weight:600}',

    // Pricing summary and payment status.
    '.om-sec[data-sec="pricing"] .pricing-row > div:first-child > label:first-child{display:none}',
    '.om-sec[data-sec="pricing"] .selling-price-hint{font-size:14px;color:var(--text);background:var(--bg);border-radius:10px;padding:10px 12px;margin:0}',
    '.order-detail-modal-box .payment-due-hint{font-size:13px;font-weight:600}',
    '.order-detail-modal-box .pay-status{font-size:11px;padding:9px 14px;border-radius:10px;min-height:42px;display:inline-flex!important;align-items:center;gap:6px}',
    '.order-detail-modal-box .pay-status::after{content:"\\21BB";opacity:.6}',

    // Product lines: name on top, then quantities, then print settings, then prices.
    '.om-sec .products-scroll > div{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:12px}',
    '.om-sec .products-scroll > div > .catalog-pick{margin-bottom:10px}',
    '.order-detail-modal-box .product{grid-template-columns:repeat(12,minmax(0,1fr));gap:10px;align-items:end}',
    '.order-detail-modal-box .product > :nth-child(1){grid-column:span 11}',
    '.order-detail-modal-box .product > :nth-child(2),.order-detail-modal-box .product > :nth-child(3),.order-detail-modal-box .product > :nth-child(4){grid-column:span 4}',
    '.order-detail-modal-box .product > :nth-child(5),.order-detail-modal-box .product > :nth-child(6),.order-detail-modal-box .product > :nth-child(7){grid-column:span 3}',
    '.order-detail-modal-box .product > :nth-child(8){grid-column:span 1}',
    '.order-detail-modal-box .product > :nth-child(9){grid-column:span 2}',
    '.order-detail-modal-box .product > .rm-btn{grid-column:12;grid-row:1;height:42px;width:100%;border-radius:10px}',
    '.order-detail-modal-box .product input[type=color]{width:100%;height:42px;padding:3px;border-radius:10px}',
    '.order-detail-modal-box .product-price-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}',
    '.order-detail-modal-box .product label{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

    '.om-sec .order-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:12px}',

    // Footer with the destructive actions.
    '.om-danger{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 2px 0}',
    '.om-danger-note{font-size:12px;color:var(--dim);font-family:' + SANS + '}',
    '.om-danger-btns{display:flex;gap:8px}',
    '.om-danger .icon-btn{width:auto;height:36px;padding:0 14px;border-radius:9px;font-size:13px;font-family:' + SANS + ';white-space:nowrap;background:transparent;border:1px solid rgba(232,97,90,.45);color:var(--red)}',
    '.om-danger .icon-btn:hover{background:rgba(232,97,90,.08)}',

    '@media (max-width:640px){' +
      '.order-detail-modal-box .order-head{padding:16px 16px 12px}' +
      '.order-detail-modal-close{top:12px;right:12px}' +
      '.order-detail-modal-box .order-name-input{font-size:18px;margin:0 84px 0 0;flex-basis:calc(100% - 110px)}' +
      '.om-actions{margin-left:0;width:100%}' +
      '.order-detail-modal-box .order-body{padding:14px 14px 96px}' +
      '.om-sec{padding:14px 14px 4px}' +
      '.om-client-card{flex-wrap:wrap}.om-client-btns{width:100%}' +
      '.order-detail-modal-box .product{grid-template-columns:repeat(6,minmax(0,1fr))}' +
      '.order-detail-modal-box .product > :nth-child(1){grid-column:span 5}' +
      '.order-detail-modal-box .product > :nth-child(n+2):nth-child(-n+4){grid-column:span 2}' +
      '.order-detail-modal-box .product > :nth-child(5),.order-detail-modal-box .product > :nth-child(6),.order-detail-modal-box .product > :nth-child(7){grid-column:span 3}' +
      '.order-detail-modal-box .product > :nth-child(8){grid-column:span 1}' +
      '.order-detail-modal-box .product > :nth-child(9){grid-column:span 2}' +
      '.order-detail-modal-box .product > .rm-btn{grid-column:6}' +
    '}'
  ].join('');
  document.head.appendChild(css);

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function section(title, nodes){
    const els = nodes.filter(Boolean);
    if(!els.length) return null;
    const sec = document.createElement('div');
    sec.className = 'om-sec';
    sec.setAttribute('data-sec', title.toLowerCase().split(' ')[0]);
    sec.innerHTML = '<div class="om-sec-title">' + title + '</div>';
    els[0].parentNode.insertBefore(sec, els[0]);
    els.forEach(function(el){ sec.appendChild(el); });
    return sec;
  }

  function byTitle(head, title){
    return [].slice.call(head.querySelectorAll('.icon-btn')).find(function(b){ return b.title === title; });
  }

  function polishHead(head, body){
    const up = byTitle(head, 'Move up'), down = byTitle(head, 'Move down');
    const dup = byTitle(head, 'Duplicate order'), inv = byTitle(head, 'Open invoice (print / save as PDF)');
    const del = byTitle(head, 'Delete order');
    const cancel = byTitle(head, 'Cancel this order') || byTitle(head, 'Mark this quote as lost');

    const name = head.querySelector('.order-name-input');
    if(name){ const br = document.createElement('div'); br.className = 'om-break'; name.after(br); }

    const actions = document.createElement('div');
    actions.className = 'om-actions';
    if(inv){ inv.textContent = '🧾 Invoice'; actions.appendChild(inv); }
    if(dup){ dup.textContent = '⧉ Duplicate'; actions.appendChild(dup); }
    if(up && down){
      const move = document.createElement('div');
      move.className = 'om-move';
      move.title = 'Move this order up or down the list';
      up.title = 'Move up the list'; down.title = 'Move down the list';
      move.appendChild(up); move.appendChild(down);
      actions.appendChild(move);
    }
    head.appendChild(actions);

    if(cancel || del){
      const foot = document.createElement('div');
      foot.className = 'om-danger';
      foot.innerHTML = '<div class="om-danger-note">' + (cancel ? 'Cancelling keeps the order on record. Deleting removes it.' : 'Deleting removes this order for good.') + '</div><div class="om-danger-btns"></div>';
      const btns = foot.querySelector('.om-danger-btns');
      if(cancel){ cancel.textContent = cancel.title === 'Cancel this order' ? '⊘ Cancel order' : '⊘ Mark as lost'; btns.appendChild(cancel); }
      if(del){ del.textContent = 'Delete order'; btns.appendChild(del); }
      body.appendChild(foot);
    }
  }

  function polishClient(block, order){
    const picker = block.querySelector('.client-picker');
    const rows = [].slice.call(block.querySelectorAll(':scope > .client-row'));
    const nameRow = rows[0], addrRow = rows[1], sourceRow = rows[2];
    const note = block.querySelector(':scope > .linked-note');
    const client = order && order.clientId && typeof getClientById === 'function' ? getClientById(order.clientId) : null;

    if(client){
      [picker, nameRow, addrRow, note].forEach(function(el){ if(el) el.classList.add('om-hidden'); });
      const nm = order.clientName || client.name || 'Client';
      const initials = nm.trim().split(/\s+/).slice(0, 2).map(function(w){ return w[0]; }).join('').toUpperCase();
      const phone = order.clientPhone || '';
      const addr = order.clientAddress || '';
      const card = document.createElement('div');
      card.className = 'om-client-card';
      card.innerHTML =
        '<div class="om-avatar">' + esc(initials) + '</div>' +
        '<div class="om-client-info">' +
          '<div class="om-client-name">' + esc(nm) + (client.type ? '<span class="om-client-type">' + esc(client.type) + '</span>' : '') + '</div>' +
          (phone ? '<div class="om-client-line"><a href="tel:' + esc(phone.replace(/[^\d+]/g, '')) + '">' + esc(phone) + '</a></div>' : '') +
          '<div class="om-client-line">' + (addr ? esc(addr) : 'No address saved') + '</div>' +
        '</div>' +
        '<div class="om-client-btns"><button type="button" class="om-link-btn om-change">Change</button><button type="button" class="om-link-btn om-unlink">Unlink</button></div>';
      block.insertBefore(card, block.firstChild);
      const hint = document.createElement('div');
      hint.className = 'om-client-hint';
      hint.textContent = 'Details come from the Clients tab. Edit them there, or unlink to type different ones for this order.';
      card.after(hint);
      card.querySelector('.om-change').addEventListener('click', function(){
        picker.classList.toggle('om-hidden');
        if(!picker.classList.contains('om-hidden')) picker.focus();
      });
      card.querySelector('.om-unlink').addEventListener('click', function(){
        if(typeof unlinkOrderClient === 'function') unlinkOrderClient(order.id);
      });
    } else if(picker && picker.options.length){
      picker.options[0].textContent = (state.clients || []).length ? 'Pick a saved client, or type a new one below' : 'No saved clients yet. Add one in the Clients tab';
    }
    return sourceRow;
  }

  function sourceChips(select){
    const wrap = document.createElement('div');
    wrap.innerHTML = '<label>Order source</label><div class="om-chips"></div>';
    const chips = wrap.querySelector('.om-chips');
    [].slice.call(select.options).forEach(function(opt){
      if(!opt.value) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'om-chip' + (select.value === opt.value ? ' on' : '');
      b.textContent = opt.textContent;
      b.addEventListener('click', function(){
        select.value = select.value === opt.value ? '' : opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        [].slice.call(chips.children).forEach(function(c){ c.classList.remove('on'); });
        if(select.value) b.classList.add('on');
      });
      chips.appendChild(b);
    });
    return wrap;
  }

  function relabelProducts(body){
    const names = { 'Hrs/unit': 'Print hrs / unit', 'Fil(g)/unit': 'Filament g / unit', 'Already made': 'Made', 'List price/pc (₹)': 'List price / pc (₹)', 'Actual price/pc (₹)': 'Selling price / pc (₹)' };
    body.querySelectorAll('.products-scroll label').forEach(function(l){
      const t = l.textContent.trim();
      if(names[t]) l.textContent = names[t];
    });
    body.querySelectorAll('.products-scroll .catalog-pick').forEach(function(p){
      if(p.options[0] && !p.options[0].value) p.options[0].textContent = 'Fill from product catalogue…';
    });
  }

  function polish(){
    const card = document.querySelector('#orderDetailModalBody .order-card');
    const body = card && card.querySelector('.order-body');
    if(!body || body.querySelector('.om-sec')) return;
    const order = (state.orders || []).find(function(o){ return 'card-' + o.id === card.id; });
    const head = card.querySelector('.order-head');

    let detailsSec = null, clientSec = null, priceSec = null, paySec = null;
    const first = body.firstElementChild;
    if(first && first.querySelector('.client-picker')){
      const sourceRow = polishClient(first, order);
      const notes = first.querySelector(':scope > .order-notes');
      const select = sourceRow && sourceRow.querySelector('.order-source-select');
      let chips = null;
      if(select){
        chips = sourceChips(select);
        sourceRow.classList.add('om-hidden');
        sourceRow.before(chips);
      }
      const kids = [].slice.call(first.children);
      const priceIdx = kids.findIndex(function(el){ return el.classList.contains('pricing-row') && !el.querySelector('.pay-status'); });
      const payIdx = kids.findIndex(function(el){ return !!el.querySelector('.pay-status'); });
      const cut = [priceIdx, payIdx].filter(function(i){ return i >= 0; });
      const clientEnd = cut.length ? Math.min.apply(null, cut) : kids.length;
      const clientKids = kids.slice(0, clientEnd).filter(function(el){ return el !== chips && el !== sourceRow && el !== notes; });
      clientSec = section('Client', clientKids);
      detailsSec = section('Order details', [chips, sourceRow, notes]);
      if(priceIdx >= 0) priceSec = section('Pricing', [kids[priceIdx]]);
      if(payIdx >= 0) paySec = section('Payment', kids.slice(payIdx).filter(function(el){ return el !== kids[priceIdx]; }));
    }
    const datesSec = section('Dates and capacity', [body.querySelector(':scope > .order-meta')]);
    const prodSec = section('Products', [body.querySelector(':scope > .products-scroll'), body.querySelector(':scope > .add-btn')]);
    const statsSec = section('Production and profit', [body.querySelector(':scope > .order-stats'), body.querySelector(':scope > .order-progress'), body.querySelector(':scope > .profit-band')]);

    // Working order: who, what, how much, paid, when, results.
    [clientSec, detailsSec, prodSec, priceSec, paySec, datesSec, statsSec].forEach(function(sec){ if(sec) body.appendChild(sec); });
    relabelProducts(body);
    if(head) polishHead(head, body);
  }

  if(typeof openOrderDetailModal === 'function'){
    const orig = openOrderDetailModal;
    openOrderDetailModal = function(){
      const r = orig.apply(this, arguments);
      try{ polish(); }catch(e){ console.warn('[ui polish]', e); }
      return r;
    };
  }
})();

// ===================================================================
// A calmer Orders screen. A header with the add buttons and one "Import / export" menu
// (the Excel buttons and the long column list used to sit on top of the page); the
// delivery and payment banners as side-by-side alert cards; quieter stat cards; and one
// filter toolbar: search, sort and view on a line, status chips with counts, and
// priority, payment and source behind a Filters button. Elements are moved, not rebuilt,
// so every existing filter, sort and button keeps working.
(function(){
  if(window.TT_STOCK_MODE) return;
  const tab = document.getElementById('tabOrders');
  const search = document.getElementById('orderSearchInput');
  if(!tab || !search) return;

  const SANS = '"Space Grotesk",sans-serif';
  const css = document.createElement('style');
  css.textContent = [
    // Payment reminders live on Home \u2192 Needs you; velocity and the calculator gave way to Upsell opportunities.
    '#tabOrders #paymentReminderBanner,#tabOrders #orderVelocityPanel,#tabOrders #calcToggle,#tabOrders #calcBody{display:none!important}',
    '#tabOrders .panel:has(#paymentsSummaryTotal){display:none!important}',
    '.op-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;margin:4px 0 16px}',
    '.op-title{font-family:' + SANS + ';font-size:26px;font-weight:700;color:var(--text);line-height:1.1}',
    '.op-sub{font-size:13px;color:var(--dim);margin-top:4px;font-family:' + SANS + '}',
    '.op-sub b{color:var(--text);font-weight:600}',
    '.op-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;position:relative}',
    '.op-actions .add-order-btn{white-space:nowrap;margin:0;width:auto;border-radius:10px;height:40px;padding:0 16px;font-family:' + SANS + ';font-size:14px;letter-spacing:0;text-transform:none;border-style:solid}',
    '.op-actions #addOrderBtn{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600}',
    '.op-actions #addOrderBtn:hover{filter:brightness(1.05)}',
    '.op-menu-btn{height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);padding:0 14px;font-family:' + SANS + ';font-size:13px;cursor:pointer}',
    '.op-menu-btn:hover{border-color:var(--cyan);color:var(--cyan)}',
    '.op-pop{position:absolute;right:0;top:calc(100% + 8px);z-index:50;width:min(460px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.18);padding:14px;display:none}',
    '.op-pop.on{display:block}',
    '.op-pop .backup-bar{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;border:none;background:none}',
    '.op-pop .backup-btn{width:100%;text-align:left;border-radius:9px}',
    '.op-pop details{margin-top:10px;font-size:12px;color:var(--dim)}',
    '.op-pop summary{cursor:pointer;color:var(--text);font-family:' + SANS + '}',
    '.op-pop .op-help{margin:8px 0 0!important;max-height:180px;overflow:auto}',

    '.op-alerts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:14px}',
    '.op-alerts:not(:has(.warn-banner:not(.hidden))){display:none}',
    '#tabOrders .op-alerts .warn-banner{margin:0;border-radius:12px;padding:12px 14px;font-size:13px;font-family:' + SANS + ';align-items:center;line-height:1.45;border-width:1px 1px 1px 4px}',
    '#tabOrders .op-alerts .warn-banner .reminder-msg{flex:1 1 220px;min-width:0}',
    '#tabOrders .op-alerts .warn-banner a{white-space:nowrap;font-weight:600;text-decoration:none;border:1px solid currentColor;border-radius:8px;padding:5px 10px}',

    '#tabOrders .pipeline-strip{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}',
    '#tabOrders .pipeline-card{border-radius:14px;padding:14px 16px}',
    '#tabOrders .pipeline-card::before{width:100%;height:3px;border-radius:0}',
    '#tabOrders .pc-label{font-size:10.5px;letter-spacing:1px}',
    '#tabOrders .pc-val{font-family:' + SANS + ';font-size:24px;margin-top:6px}',
    '#tabOrders .pc-sub{font-family:' + SANS + ';font-size:12px;margin-top:4px}',

    '.op-bar{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:16px}',
    '.op-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.op-row + .op-row{margin-top:12px}',
    '.op-search{flex:1 1 260px;position:relative}',
    '.op-search::before{content:"\\2315";position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--dim);font-size:16px;pointer-events:none}',
    '.op-search input{width:100%;box-sizing:border-box;padding-left:36px!important;border-radius:10px;min-height:42px;font-family:' + SANS + ';font-size:14px}',
    '.op-bar .sort-controls{display:flex;align-items:center;gap:6px}',
    '.op-bar .sort-controls label{display:none}',
    '.op-bar .sort-controls select{min-height:42px;border-radius:10px;font-family:' + SANS + ';font-size:13px}',
    '.op-bar #ordersViewToggle{flex-wrap:nowrap;background:var(--input-bg);border-radius:10px;padding:3px;gap:2px}',
    '.op-bar #ordersViewToggle .filter-chip{border:none;border-radius:8px;padding:8px 12px}',
    '.op-bar #ordersViewToggle .filter-chip.active{background:var(--panel);box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '.op-status{flex:1 1 0;min-width:0;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex-wrap:nowrap!important}',
    '.op-status::-webkit-scrollbar{display:none}',
    '.op-status .filter-chip{flex:none;font-family:' + SANS + ';font-size:13px;letter-spacing:0;padding:7px 12px;display:inline-flex;gap:6px;align-items:center}',
    '.op-n{font-size:11px;opacity:.65;font-variant-numeric:tabular-nums}',
    '.op-filters-btn{flex:none;height:36px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--text);padding:0 14px;font-family:' + SANS + ';font-size:13px;cursor:pointer}',
    '.op-filters-btn.has{border-color:var(--cyan);color:var(--cyan);background:rgba(79,209,197,.1)}',
    '.op-count{flex:none;font-size:12px;color:var(--dim);font-family:"JetBrains Mono",monospace}',
    '.op-more{display:none;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}',
    '.op-more.on{display:block}',
    '.op-more .filter-chip-groups{gap:18px 28px}',
    '.op-more .filter-chip{font-family:' + SANS + ';font-size:13px;letter-spacing:0}',
    '.op-clear{background:none;border:none;color:var(--dim);font-size:12px;cursor:pointer;text-decoration:underline;margin-left:auto;font-family:' + SANS + '}',
    '@media (max-width:640px){' +
      '.op-title{font-size:22px}.op-head{align-items:flex-start;margin-bottom:12px}' +
      '.op-actions{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
      '.op-actions .op-menu-btn{grid-column:1/-1}' +
      '.op-alerts{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:10px;margin:0 -12px 12px;padding:0 12px;scrollbar-width:none}' +
      '.op-alerts::-webkit-scrollbar{display:none}' +
      '#tabOrders .op-alerts .warn-banner{flex:0 0 86%;scroll-snap-align:start;font-size:12.5px}' +
      '#tabOrders .op-alerts .warn-banner .reminder-msg{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
      '#tabOrders .pipeline-strip{grid-template-columns:1fr 1fr;gap:10px}' +
      '#tabOrders .pc-val{font-size:20px}' +
      '.op-bar .sort-controls{flex:1}.op-bar .sort-controls select{width:100%}' +
    '}'
  ].join('');
  document.head.appendChild(css);

  const filterPanel = search.closest('.panel');
  const sortBar = document.getElementById('ordersSortBy').closest('.panel-title');
  const addRow = document.getElementById('addOrderBtn').parentElement;
  const backupBar = tab.querySelector(':scope > .backup-bar');
  const help = backupBar && backupBar.nextElementSibling;
  const strip = document.getElementById('pipelineForecastStrip');

  // ---------- header ----------
  const head = document.createElement('div');
  head.className = 'op-head';
  head.innerHTML = '<div><div class="op-title">Orders</div><div class="op-sub" id="opSub"></div></div><div class="op-actions"></div>';
  const actions = head.querySelector('.op-actions');
  const quoteBtn = document.getElementById('addQuoteBtn'), orderBtn = document.getElementById('addOrderBtn');
  if(quoteBtn){ quoteBtn.textContent = '+ New quote'; actions.appendChild(quoteBtn); }
  orderBtn.textContent = '+ New order';
  actions.appendChild(orderBtn);
  if(backupBar){
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'op-menu-btn';
    menuBtn.textContent = 'Import / export ▾';
    const pop = document.createElement('div');
    pop.className = 'op-pop';
    pop.appendChild(backupBar);
    if(help && !help.id && /Supported columns/.test(help.textContent)){
      const det = document.createElement('details');
      det.innerHTML = '<summary>Which Excel columns can I import?</summary>';
      help.classList.add('op-help');
      det.appendChild(help);
      pop.appendChild(det);
    }
    menuBtn.addEventListener('click', function(e){ e.stopPropagation(); pop.classList.toggle('on'); });
    document.addEventListener('click', function(e){ if(!pop.contains(e.target) && e.target !== menuBtn) pop.classList.remove('on'); });
    actions.appendChild(menuBtn);
    actions.appendChild(pop);
  }
  tab.insertBefore(head, tab.firstChild);
  if(addRow && !addRow.children.length) addRow.style.display = 'none';

  // ---------- alerts ----------
  const alerts = document.createElement('div');
  alerts.className = 'op-alerts';
  head.after(alerts);
  ['backupReminder', 'deliveryReminderBanner', 'paymentReminderBanner'].forEach(function(id){ const el = document.getElementById(id); if(el) alerts.appendChild(el); });
  if(strip) alerts.after(strip);

  // ---------- filter toolbar ----------
  const bar = document.createElement('div');
  bar.className = 'op-bar';
  bar.innerHTML = '<div class="op-row op-r1"><div class="op-search"></div></div><div class="op-row op-r2"></div><div class="op-more"></div>';
  search.placeholder = 'Search orders, clients or products…';
  bar.querySelector('.op-search').appendChild(search);
  const r1 = bar.querySelector('.op-r1');
  [].slice.call(sortBar.querySelectorAll('.sort-controls, #ordersViewToggle, #exportOrdersTableBtn')).forEach(function(el){ r1.appendChild(el); });

  const statusChips = document.getElementById('statusFilterChips');
  statusChips.classList.add('op-status');
  const r2 = bar.querySelector('.op-r2');
  r2.appendChild(statusChips);
  const filtersBtn = document.createElement('button');
  filtersBtn.type = 'button';
  filtersBtn.className = 'op-filters-btn';
  r2.appendChild(filtersBtn);
  const count = document.getElementById('filterCount');
  if(count){ count.className = 'op-count'; r2.appendChild(count); }

  const more = bar.querySelector('.op-more');
  const groups = filterPanel.querySelector('.filter-chip-groups');
  const statusGroup = statusChips && filterPanel.querySelector('.filter-chip-group:not(:has(.filter-chip))');
  if(statusGroup) statusGroup.remove();
  more.appendChild(groups);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'op-clear';
  clear.textContent = 'Clear these filters';
  more.appendChild(clear);
  filtersBtn.addEventListener('click', function(){ more.classList.toggle('on'); });
  clear.addEventListener('click', function(){
    ['priorityFilterChips', 'paymentFilterChips', 'sourceFilterChips'].forEach(function(id){
      const all = document.querySelector('#' + id + ' [data-value="all"]');
      if(all && !all.classList.contains('active')) all.click();
    });
    setTimeout(refresh, 0);
  });

  filterPanel.parentNode.insertBefore(bar, filterPanel);
  filterPanel.remove();
  sortBar.style.display = 'none';

  // ---------- live bits: header summary, status counts, active filter count ----------
  const LABELS = {};
  [].slice.call(statusChips.querySelectorAll('.filter-chip')).forEach(function(c){ LABELS[c.getAttribute('data-value')] = c.textContent.trim(); });
  function statusOf(o){ return typeof boardStatus === 'function' ? boardStatus(o) : o.status; }
  function refresh(){
    const orders = (typeof state !== 'undefined' && state.orders) || [];
    const n = {};
    orders.forEach(function(o){ const s = statusOf(o); n[s] = (n[s] || 0) + 1; });
    [].slice.call(statusChips.querySelectorAll('.filter-chip')).forEach(function(c){
      const v = c.getAttribute('data-value');
      const k = v === 'all' ? orders.length : (n[v] || 0);
      c.innerHTML = esc(LABELS[v]) + ' <span class="op-n">' + k + '</span>';
    });
    const active = ['booked', 'in_production', 'production_done'].reduce(function(s, k){ return s + (n[k] || 0); }, 0);
    document.getElementById('opSub').innerHTML = '<b>' + orders.length + '</b> orders · <b>' + active + '</b> in progress · <b>' + (n.quoted || 0) + '</b> open quotes';
    const on = ['priorityFilterChips', 'paymentFilterChips', 'sourceFilterChips'].filter(function(id){
      const a = document.querySelector('#' + id + ' .filter-chip.active');
      return a && a.getAttribute('data-value') !== 'all';
    }).length;
    filtersBtn.textContent = on ? 'Filters · ' + on : 'Filters';
    filtersBtn.classList.toggle('has', !!on);
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  bar.addEventListener('click', function(e){ if(e.target.closest('.filter-chip')) setTimeout(refresh, 0); });
  if(typeof renderOrders === 'function'){
    const orig = renderOrders;
    renderOrders = function(){
      const r = orig.apply(this, arguments);
      try{ refresh(); }catch(e){ console.warn('[orders polish]', e); }
      return r;
    };
  }
  refresh();
})();
