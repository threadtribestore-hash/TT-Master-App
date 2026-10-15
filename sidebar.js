// ===================================================================
// =========================== SIDEBAR (Studio) ======================
// ===================================================================
// On laptops and desktops (1024 px and wider) the menu lives in a fixed left
// sidebar instead of the drop-down in the top bar. It moves the existing menu
// element, so every screen, group and add-on entry (Print farm, Automations, …)
// keeps working. Narrower screens get the top menu back; phones keep the
// bottom bar. The sidebar can be hidden, which brings the top menu back, and
// the choice is remembered on the device.
(function(){
  if(window.TT_STOCK_MODE) return;

  const BP = 1024;
  const KEY = 'tt-sidebar-hidden-v1';
  const dd = document.getElementById('tabDropdown');
  const bar = document.getElementById('tabBar');
  if(!dd || !bar) return;

  function hidden(){ try { return localStorage.getItem(KEY) === '1'; } catch(e){ return false; } }
  function setHidden(v){ try { localStorage.setItem(KEY, v ? '1' : '0'); } catch(e){} place(); }

  const side = document.createElement('aside');
  side.id = 'ttSidebar';
  side.setAttribute('aria-label', 'Menu');
  side.innerHTML = '<div class="sb-brand" title="Home"><i class="sb-logo" role="img" aria-label="Thread Tribe"></i><span>Studio</span></div><nav class="sb-nav"></nav>' +
    '<div class="sb-foot"><button type="button" class="sb-hide" title="Hide the sidebar and use the top menu">« Hide sidebar</button></div>';
  document.body.appendChild(side);
  const nav = side.querySelector('.sb-nav');

  const show = document.createElement('button');
  show.type = 'button'; show.className = 'sb-show'; show.textContent = '☰ Show sidebar';
  bar.appendChild(show);

  function place(){
    const wide = window.innerWidth >= BP && !hidden();
    document.documentElement.classList.toggle('tt-has-sidebar', wide);
    document.documentElement.classList.toggle('tt-sidebar-off', window.innerWidth >= BP && hidden());
    if(wide && dd.parentNode !== nav){ bar.classList.remove('open'); nav.appendChild(dd); }
    else if(!wide && dd.parentNode !== bar){ bar.insertBefore(dd, show); }
  }

  side.querySelector('.sb-hide').addEventListener('click', function(){ setHidden(true); });
  show.addEventListener('click', function(){ setHidden(false); });
  side.querySelector('.sb-brand').addEventListener('click', function(){ const b = document.querySelector('.tab-btn[data-tab="home"]'); if(b) b.click(); window.scrollTo(0, 0); });
  // Keep the active screen in view inside a long menu.
  dd.addEventListener('click', function(e){ const b = e.target.closest('.tab-btn'); if(b && document.documentElement.classList.contains('tt-has-sidebar')) setTimeout(function(){ b.scrollIntoView({ block: 'nearest' }); }, 0); });
  window.addEventListener('resize', place);

  const W = 248;
  const css = document.createElement('style');
  css.textContent =
    '#ttSidebar{display:none}.sb-show{display:none}' +
    'html.tt-has-sidebar body{padding-left:' + (W + 18) + 'px}' +
    'html.tt-has-sidebar #ttSidebar{display:flex;flex-direction:column;position:fixed;left:0;top:0;bottom:0;width:' + W + 'px;background:var(--panel);border-right:1px solid var(--line);z-index:950}' +
    '.sb-brand{padding:18px 20px 12px;cursor:pointer;border-bottom:1px solid var(--line)}' +
    '.sb-logo{display:block;width:132px;height:76px;margin-bottom:6px;background:var(--text);-webkit-mask:url(brand/tt-lockup.svg) left center/contain no-repeat;mask:url(brand/tt-lockup.svg) left center/contain no-repeat}' +
    '.sb-brand b{display:block;font-size:17px}.sb-brand span{font-size:12px;color:var(--dim);font-family:"JetBrains Mono",monospace;letter-spacing:1.5px;text-transform:uppercase}' +
    '.sb-nav{flex:1;overflow-y:auto;padding:8px 10px 16px}' +
    'html.tt-has-sidebar #ttSidebar .tab-dropdown{display:block;position:static;border:none;border-radius:0;box-shadow:none;background:transparent;max-height:none;overflow:visible;padding:0}' +
    'html.tt-has-sidebar #tabBar{display:none}' +
    '#ttSidebar .tab-group-label{padding:16px 12px 6px}' +
    '#ttSidebar .tab-btn,#ttSidebar .ttf-menu-item{font-family:inherit;text-transform:none;letter-spacing:0;font-size:14px;color:var(--text);opacity:.82;padding:8px 12px;border-radius:8px;margin:1px 0}' +
    '#ttSidebar .tab-btn:hover,#ttSidebar .ttf-menu-item:hover{opacity:1;background:var(--input-bg);color:var(--text)}' +
    '#ttSidebar .tab-btn.active{opacity:1;background:rgba(79,209,197,.14);color:var(--cyan);font-weight:600}' +
    '.sb-foot{padding:10px;border-top:1px solid var(--line)}' +
    '.sb-hide,.sb-show{background:var(--input-bg);border:1px solid var(--line);color:var(--dim);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer;width:100%}' +
    '.sb-hide:hover,.sb-show:hover{color:var(--cyan);border-color:var(--cyan)}' +
    'html.tt-sidebar-off .sb-show{display:block;width:auto;margin-top:8px}';
  document.head.appendChild(css);

  place();
})();
