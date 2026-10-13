// ===================================================================
// ========================== UI POLISH (Studio) =====================
// ===================================================================
// A cleaner order pop-up: a two-line title bar (large name and Close, then status
// pills and actions), the long form grouped into titled cards (Client, Pricing,
// Payment, Dates and capacity, Products, Production and profit) and softer inputs.
// Elements are only moved into the new cards, never rebuilt, so every listener and
// live updater keeps working. Styles are scoped to the pop-up.
(function(){
  if(window.TT_STOCK_MODE) return;

  const css = document.createElement('style');
  css.textContent = [
    '.gantt-wrap{overflow-x:auto;max-width:100%}',
    '.order-detail-modal-box{max-width:960px;border:none;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden}',
    '.order-detail-modal-close{position:absolute;float:none;top:18px;right:18px;margin:0;border-radius:999px;padding:7px 14px;font-size:13px;z-index:3}',
    '.order-detail-modal-box .order-head{flex-wrap:wrap;gap:10px 8px;padding:20px 110px 16px 24px;background:var(--panel);border-bottom:1px solid var(--line)}',
    '.order-detail-modal-box .order-color-tag{width:12px;height:12px;margin-right:2px}',
    '.order-detail-modal-box .order-name-input{flex:1 1 calc(100% - 30px);font-size:22px;font-weight:700;padding:6px 10px;margin-left:-10px;border:1px solid transparent;border-radius:10px;transition:border-color .15s,background .15s}',
    '.order-detail-modal-box .order-name-input:hover{border-color:var(--line)}',
    '.order-detail-modal-box .order-name-input:focus{border-color:var(--cyan);background:var(--input-bg)}',
    '.order-detail-modal-box .order-head .status-toggle,.order-detail-modal-box .order-head .due-soon-badge,.order-detail-modal-box .order-head .payment-remind-badge{font-size:11px;padding:5px 12px;border-radius:999px}',
    '.order-detail-modal-box .order-head .icon-btn{width:36px;height:36px;border-radius:10px;font-size:15px;background:var(--input-bg)}',
    '.order-detail-modal-box .order-head .icon-btn:first-of-type{margin-left:auto}',
    '.order-detail-modal-box .order-head .icon-btn.danger:first-of-type{width:auto;padding:0 14px;font-size:13px;white-space:nowrap}',
    '.order-detail-modal-box .order-body{padding:20px 24px 24px;background:var(--bg)}',
    '.om-sec{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px 6px;margin-bottom:14px}',
    '.om-sec-title{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--dim);margin:0 0 12px;display:flex;align-items:center;gap:8px}',
    '.om-sec-title::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--cyan)}',
    '.om-sec > *{margin-bottom:12px}',
    '.om-sec,.om-sec > *,.om-sec .order-meta > *{min-width:0}',
    '.om-sec .due-flag{white-space:normal}',
    '.order-detail-modal-box label{font-size:12px;font-weight:500;color:var(--dim);margin-bottom:6px}',
    '.order-detail-modal-box input[type=text],.order-detail-modal-box input[type=number],.order-detail-modal-box input[type=tel],.order-detail-modal-box input[type=date],.order-detail-modal-box select,.order-detail-modal-box textarea{border-radius:10px;min-height:42px;transition:border-color .15s,box-shadow .15s}',
    '.order-detail-modal-box input:focus,.order-detail-modal-box select:focus,.order-detail-modal-box textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(79,209,197,.15);outline:none}',
    '.order-detail-modal-box textarea{min-height:64px}',
    '.order-detail-modal-box .client-picker{margin-bottom:14px}',
    '.order-detail-modal-box .linked-note{font-size:12px;color:var(--dim);background:var(--input-bg);border-radius:8px;padding:8px 12px}',
    '.order-detail-modal-box .payment-due-hint{font-size:13px;font-weight:600}',
    '.order-detail-modal-box .add-btn{border-radius:10px}',
    '.order-detail-modal-box .order-name-input,.order-detail-modal-box .order-name-input:hover{background:transparent}',
    '.order-detail-modal-box .order-name-input:focus{background:var(--input-bg)}',
    '.om-sec .products-scroll > div{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:12px}',
    '.om-sec .products-scroll > div > .catalog-pick{margin-bottom:10px}',
    '.order-detail-modal-box .product{grid-template-columns:minmax(120px,1.4fr) 76px 84px 56px 80px 76px minmax(70px,1fr) 40px minmax(70px,1fr) 34px}',
    '.om-sec[data-sec="pricing"] .pricing-row > div:first-child > label:first-child{display:none}',
    '@media (max-width:900px){.order-detail-modal-box .product{grid-template-columns:repeat(3,minmax(0,1fr))}}',
    '@media (max-width:640px){.order-detail-modal-box .product{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.order-detail-modal-box input,.order-detail-modal-box select,.order-detail-modal-box textarea{min-width:0;max-width:100%}',
    '.order-detail-modal-box .order-body,.order-detail-modal-box .order-card{min-width:0;max-width:100%}',
    '@media (max-width:640px){.order-detail-modal-box .order-head{padding:16px 16px 12px}.order-detail-modal-close{top:12px;right:12px}.order-detail-modal-box .order-name-input{font-size:18px;flex-basis:100%;margin-left:0;padding-right:84px}.order-detail-modal-box .order-body{padding:14px}.om-sec{padding:14px 14px 4px}}'
  ].join('');
  document.head.appendChild(css);

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

  function polish(){
    const body = document.querySelector('#orderDetailModalBody .order-body');
    if(!body || body.querySelector('.om-sec')) return;
    const first = body.firstElementChild;
    if(first && first.querySelector('.client-picker')){
      const kids = [].slice.call(first.children);
      const priceIdx = kids.findIndex(function(el){ return el.classList.contains('pricing-row') && !el.querySelector('.pay-status'); });
      const payIdx = kids.findIndex(function(el){ return !!el.querySelector('.pay-status'); });
      const cut = [priceIdx, payIdx].filter(function(i){ return i >= 0; });
      const clientEnd = cut.length ? Math.min.apply(null, cut) : kids.length;
      section('Client', kids.slice(0, clientEnd));
      if(priceIdx >= 0) section('Pricing', [kids[priceIdx]]);
      if(payIdx >= 0) section('Payment', kids.slice(payIdx).filter(function(el){ return el !== kids[priceIdx]; }));
    }
    section('Dates and capacity', [body.querySelector(':scope > .order-meta')]);
    section('Products', [body.querySelector(':scope > .products-scroll'), body.querySelector(':scope > .add-btn')]);
    section('Production and profit', [body.querySelector(':scope > .order-stats'), body.querySelector(':scope > .order-progress'), body.querySelector(':scope > .profit-band')]);
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
