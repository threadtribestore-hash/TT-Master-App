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
    '.gantt-wrap{overflow-x:auto;max-width:100%}',
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
