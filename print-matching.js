// ===================================================================
// ======================= PRINT MATCHING (Studio) ===================
// ===================================================================
// Which order a farm print counts towards. Most prints are started without
// picking the order's Bambuddy project, so the workshop bridge (tt-bridge)
// matches each print to open order lines by its file name and gives the plate
// to the earliest-due order that still needs that product. This screen lists
// the last two weeks of print files and how each was matched. Files no order
// claims are at the top: link one to a product once (with pieces per plate),
// or mark it not for orders, and the bridge uses that link from its next run
// (every 5 minutes) for this and every later print of the file.
//
// Data: print_file_matches (written by the bridge) and print_file_rules (the
// links made here). Both come from print_matching_setup.sql.
(function(){
  if(window.TT_STOCK_MODE) return;

  const OPEN = ['booked', 'in_production'];
  const M = { rows: [], rules: [], at: 0, missing: false, err: '', busy: false, show: 'todo' };
  const STATUS = {
    unmatched: ['No order', 'No open order’s products appear in this file name. Link it to a product, or mark it not for orders.'],
    spare: ['Spare', 'Matches a product, but every open order for it already has enough. Kept as stock.'],
    learned: ['Same file as before', 'Filed because the same file was filed under that order by hand.'],
    name: ['By name', 'The product’s name is in the file name.'],
    rule: ['Linked', 'Linked here or in match_rules.json.'],
    filed: ['Under the order', 'Already in the order’s Bambuddy project.']
  };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function norm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function when(s){ if(!s) return ''; const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function ruleFor(name){
    const n = norm(name);
    return M.rules.filter(function(r){ const f = norm(r.file); return f && n.indexOf(f) !== -1; })
      .sort(function(a, b){ return norm(b.file).length - norm(a.file).length; })[0] || null;
  }
  function products(){
    const seen = {}, out = [];
    function add(n){ n = String(n || '').trim(); if(n && !seen[n.toLowerCase()]){ seen[n.toLowerCase()] = 1; out.push(n); } }
    (state.orders || []).filter(function(o){ return OPEN.indexOf(o.status) !== -1; })
      .forEach(function(o){ (o.products || []).forEach(function(p){ add(p.name); }); });
    (state.productCatalog || []).forEach(function(p){ add(p.name || p.product); });
    return out.sort(function(a, b){ return a.localeCompare(b); });
  }
  function todo(){ return M.rows.filter(function(r){ return r.status === 'unmatched' && !ruleFor(r.name); }); }

  async function pull(){
    if(!on() || M.busy) return;
    M.busy = true;
    try{
      const res = await Promise.all([
        cloud.sb.from('print_file_matches').select('*').order('last_at', { ascending: false }),
        cloud.sb.from('print_file_rules').select('*').order('updated_at', { ascending: false })
      ]);
      const err = res[0].error || res[1].error;
      if(err){
        M.missing = /print_file|does not exist|schema cache|relation/i.test(err.message || '');
        M.err = M.missing ? '' : (err.message || 'Could not load');
      } else {
        M.missing = false; M.err = '';
        M.rows = res[0].data || []; M.rules = res[1].data || []; M.at = Date.now();
      }
    } finally { M.busy = false; }
    badge();
    if(box && box.style.display !== 'none') render();
  }

  async function saveRule(file, product, perPlate){
    file = String(file || '').trim();
    if(norm(file).length < 3){ showToast('“File name contains” needs at least 3 letters or numbers'); return; }
    if(!product){ showToast('Pick a product, or choose Not for orders'); return; }
    const row = { file: file, product: product, per_plate: Math.max(1, Math.min(500, parseInt(perPlate, 10) || 1)), updated_by: cloud.email || null, updated_at: new Date().toISOString() };
    const r = await cloud.sb.from('print_file_rules').upsert(row, { onConflict: 'file' });
    if(r.error){ showToast('Could not save: ' + r.error.message); return; }
    showToast(product === '-' ? 'Marked not for orders' : 'Linked to ' + product + ' — counts from the bridge’s next run (within 5 min)');
    await pull();
  }
  async function removeRule(file){
    const r = await cloud.sb.from('print_file_rules').delete().eq('file', file);
    if(r.error){ showToast('Could not remove: ' + r.error.message); return; }
    showToast('Link removed');
    await pull();
  }

  // ---------- screen ----------
  let box = null;
  function rowHtml(r){
    const rule = ruleFor(r.name);
    const st = STATUS[r.status] || [r.status, ''];
    let match;
    if(rule){
      match = rule.product === '-' ? '<b>Not for orders</b>' : '<b>' + esc(rule.product) + '</b> · ' + rule.per_plate + ' per plate';
      match += ' <span class="pm-dim">linked' + (rule.updated_by ? ' by ' + esc(rule.updated_by) : '') + (norm(rule.file) !== norm(r.name) ? ' · file contains “' + esc(rule.file) + '”' : '') + '</span>' +
        ' <button class="pm-btn" data-rm="' + esc(rule.file) + '">Remove link</button>';
      if(r.status === 'unmatched' || r.status === 'spare') match += '<div class="pm-dim">Bridge picks this up on its next run.</div>';
    } else if(r.product){
      match = '<b>' + esc(r.product) + '</b>' + (r.per_plate > 1 ? ' · ' + r.per_plate + ' per plate' : '');
    } else {
      match = '<span class="pm-dim">—</span>';
    }
    const orders = (r.orders || []).length ? ' → ' + r.orders.map(esc).join(', ') : '';
    const fix = rule ? '' :
      '<div class="pm-fix" data-name="' + esc(r.name) + '">' +
        '<label>File name contains <input class="pm-file" value="' + esc(r.name) + '"></label>' +
        '<label>Product <input class="pm-prod" list="pmProducts" placeholder="Pick or type" value="' + esc(r.status === 'unmatched' ? ((r.guesses || [])[0] || '') : (r.product || '')) + '"></label>' +
        '<label>Per plate <input class="pm-per" type="number" min="1" max="500" value="' + (r.per_plate || 1) + '"></label>' +
        '<button class="pm-btn pm-save">' + (r.status === 'unmatched' ? 'Link' : 'Change') + '</button>' +
        '<button class="pm-btn pm-skip">Not for orders</button>' +
      '</div>';
    return '<div class="pm-row pm-' + esc(r.status) + '">' +
      '<div class="pm-top"><div class="pm-name">' + esc(r.name) + '</div>' +
        '<span class="pm-tag" title="' + esc(st[1]) + '">' + esc(st[0]) + '</span></div>' +
      '<div class="pm-meta">' + (r.plates || 0) + ' good plate' + (r.plates === 1 ? '' : 's') + (r.failed ? ' · ' + r.failed + ' failed' : '') +
        ((r.printers || []).length ? ' · ' + r.printers.map(esc).join(', ') : '') + (r.last_at ? ' · last ' + esc(when(r.last_at)) : '') + '</div>' +
      '<div class="pm-match">' + match + orders + '</div>' + fix +
    '</div>';
  }
  function render(){
    const root = document.getElementById('printMatchRoot');
    if(!root) return;
    if(!on()){ root.innerHTML = '<div class="card"><h3>Print matching</h3><p class="pm-dim">Turn on cloud sync (Settings) to see farm prints.</p></div>'; return; }
    if(M.missing){ root.innerHTML = '<div class="card"><h3>Print matching</h3><p>One-time setup: run <code>print_matching_setup.sql</code> (in ~/PrintFarm/tt-bridge) in Supabase → SQL Editor. The list fills in within 5 minutes.</p></div>'; return; }
    const t = todo();
    const list = M.show === 'todo' ? t : M.show === 'all' ? M.rows : M.rows.filter(function(r){ return r.status === M.show; });
    const count = function(s){ return M.rows.filter(function(r){ return r.status === s; }).length; };
    const fresh = M.rows.reduce(function(a, r){ return r.updated_at > a ? r.updated_at : a; }, '');
    root.innerHTML =
      '<div class="card">' +
        '<div class="pm-head"><div><h3 style="margin:0">Print matching</h3>' +
          '<div class="pm-dim">Farm prints from the last 14 days and the order each counts towards. Plates go to the earliest-due order that still needs the product.' +
          (fresh ? ' Bridge last updated ' + esc(when(fresh)) + '.' : '') + '</div></div>' +
          '<button class="pm-btn" id="pmRefresh">Refresh</button></div>' +
        '<div class="pm-chips">' +
          [['todo', 'Needs a product', t.length], ['spare', 'Spare', count('spare')], ['name', 'By name', count('name')], ['rule', 'Linked', count('rule')],
           ['filed', 'Under the order', count('filed')], ['all', 'All', M.rows.length]].map(function(c){
            return '<button class="pm-chip' + (M.show === c[0] ? ' on' : '') + '" data-show="' + c[0] + '">' + c[1] + ' <b>' + c[2] + '</b></button>';
          }).join('') +
        '</div>' +
        (M.err ? '<p style="color:var(--red)">' + esc(M.err) + '</p>' : '') +
        (list.length ? list.map(rowHtml).join('') : '<p class="pm-dim">' + (M.show === 'todo' ? 'Every recent print is matched to an order or marked not for orders.' : 'Nothing here.') + '</p>') +
        (M.rules.length ? '<details class="pm-rules"><summary>All links (' + M.rules.length + ')</summary>' + M.rules.map(function(r){
            return '<div class="pm-li"><span>“' + esc(r.file) + '” → <b>' + (r.product === '-' ? 'Not for orders' : esc(r.product)) + '</b>' + (r.product !== '-' ? ' · ' + r.per_plate + ' per plate' : '') + '</span> <button class="pm-btn" data-rm="' + esc(r.file) + '">Remove</button></div>';
          }).join('') + '</details>' : '') +
      '</div>' +
      '<datalist id="pmProducts">' + products().map(function(p){ return '<option value="' + esc(p) + '"></option>'; }).join('') + '</datalist>';
  }
  function badge(){
    const b = document.querySelector('.tab-btn[data-tab="printmatch"]');
    if(!b) return;
    const n = todo().length;
    b.innerHTML = 'Print matching' + (n ? ' <span class="pm-badge">' + n + '</span>' : '');
  }

  document.addEventListener('click', function(e){
    if(!box || !box.contains(e.target)) return;
    const chip = e.target.closest('[data-show]');
    if(chip){ M.show = chip.getAttribute('data-show'); render(); return; }
    if(e.target.id === 'pmRefresh'){ pull(); return; }
    const rm = e.target.closest('[data-rm]');
    if(rm){ if(confirm('Remove the link for “' + rm.getAttribute('data-rm') + '”?')) removeRule(rm.getAttribute('data-rm')); return; }
    const fix = e.target.closest('.pm-fix');
    if(!fix) return;
    const file = fix.querySelector('.pm-file').value;
    if(e.target.classList.contains('pm-save')) saveRule(file, fix.querySelector('.pm-prod').value.trim(), fix.querySelector('.pm-per').value);
    else if(e.target.classList.contains('pm-skip')) saveRule(file, '-', 1);
  });

  const css = document.createElement('style');
  css.textContent =
    '.pm-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px}' +
    '.pm-dim{color:var(--dim);font-size:12px;font-weight:400}' +
    '.pm-chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 12px}' +
    '.pm-chip{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:999px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer}.pm-chip.on{border-color:var(--cyan);color:var(--cyan)}' +
    '.pm-row{border-top:1px solid var(--line);padding:10px 0}' +
    '.pm-top{display:flex;justify-content:space-between;gap:8px;align-items:center}' +
    '.pm-name{font-weight:600;font-size:14px;word-break:break-word}' +
    '.pm-tag{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--dim);white-space:nowrap;cursor:help}' +
    '.pm-unmatched .pm-tag{color:var(--amber);border-color:var(--amber)}.pm-spare .pm-tag{color:var(--cyan);border-color:var(--cyan)}' +
    '.pm-meta{font-size:12px;color:var(--dim);margin-top:2px}.pm-match{font-size:13px;margin-top:4px}' +
    '.pm-fix{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px}' +
    '.pm-fix label{display:flex;flex-direction:column;font-size:11px;color:var(--dim);gap:2px}' +
    '.pm-fix input{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:5px 8px;font:inherit;font-size:13px}' +
    '.pm-file{width:220px}.pm-prod{width:200px}.pm-per{width:70px}' +
    '@media (max-width:600px){.pm-fix label{flex:1 1 100%}.pm-file,.pm-prod{width:100%;box-sizing:border-box}}' +
    '.pm-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer}.pm-btn:hover{border-color:var(--cyan);color:var(--cyan)}' +
    '.pm-rules{margin-top:12px;font-size:13px}.pm-rules summary{cursor:pointer;color:var(--dim)}.pm-li{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--line)}' +
    '.pm-badge{display:inline-block;min-width:18px;padding:0 6px;border-radius:999px;background:var(--amber);color:#111;font-size:11px;font-weight:700;text-align:center;margin-left:6px}';
  document.head.appendChild(css);

  // Screen: a menu entry in Operations (after Projects), and its container.
  const anchorBtn = document.querySelector('.tab-btn[data-tab="projects"]');
  const settingsTab = document.getElementById('tabSettings');
  if(anchorBtn && settingsTab){
    const btn = document.createElement('button');
    btn.className = 'tab-btn'; btn.setAttribute('data-tab', 'printmatch'); btn.textContent = 'Print matching';
    anchorBtn.insertAdjacentElement('afterend', btn);
    box = document.createElement('div');
    box.id = 'tabPrintmatch'; box.style.display = 'none'; box.innerHTML = '<div id="printMatchRoot"></div>';
    settingsTab.parentNode.insertBefore(box, settingsTab);
    // The core tab handler only knows its own screens, so show and hide this one here.
    function wire(b){
      b.addEventListener('click', function(){
        const show = b.getAttribute('data-tab') === 'printmatch';
        box.style.display = show ? '' : 'none';
        if(show){
          document.querySelectorAll('.tab-btn').forEach(function(x){ x.classList.toggle('active', x === b); });
          const lab = document.getElementById('currentTabLabel'); if(lab) lab.textContent = 'Print matching';
          const bar = document.getElementById('tabBar'); if(bar) bar.classList.remove('open');
          document.querySelectorAll('.wrap > [id^="tab"]').forEach(function(el){ if(el !== box && /^tab[A-Z]/.test(el.id) && el.id !== 'tabBar') el.style.display = 'none'; });
          render(); pull();
        }
      });
    }
    document.querySelectorAll('.tab-btn').forEach(wire);
    const sheet = document.getElementById('moreSheetList');
    if(sheet){
      const lab = [].filter.call(sheet.querySelectorAll('.msheet-label'), function(el){ return /^operations/i.test(el.textContent.trim()); })[0];
      const grid = lab && lab.nextElementSibling;
      if(grid){ const it = document.createElement('button'); it.className = 'msheet-item'; it.setAttribute('data-goto', 'printmatch'); it.textContent = 'Print matching'; grid.appendChild(it); }
    }
  }

  setTimeout(pull, 7000);
  setInterval(function(){ if(!document.hidden) pull(); }, 120000);

  window.TTPrintMatch = { pull: pull, todo: function(){ return todo().length; }, open: function(){ const b = document.querySelector('.tab-btn[data-tab="printmatch"]'); if(b) b.click(); } };
})();
