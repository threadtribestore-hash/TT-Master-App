// ===================================================================
// ========================= SHOP (Studio) ===========================
// ===================================================================
// Add designs to the Buyer app shop in two steps: drop in photos (one design each, any number),
// then publish. Photos go to the public Storage bucket 'shop'; each design is a row in
// shop_products (shop_setup.sql). Brand partners see live designs straight away, priced from the
// MRP with the same per-product discount table as everything else.
(function(){
  if(window.TT_STOCK_MODE) return;

  const X = { items: [], loaded: false, missing: false, drafts: [], publishing: false, progress: '', bulk: { category: '', mrp: '' } };
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  async function load(){
    if(!on()) return;
    const r = await cloud.sb.from('shop_products').select('*').order('created_at', { ascending: false }).limit(5000);
    X.loaded = true;
    if(r.error){ X.missing = /shop_products|does not exist|schema cache|relation/i.test(r.error.message || ''); return; }
    X.missing = false; X.items = r.data || [];
  }
  // For buyers-admin.js: live designs, and lookup by the Buyer app's 'sp:<id>' product id.
  window.TTShop = {
    list: function(){ return X.items.filter(function(x){ return x.status === 'live'; }); },
    find: function(pid){ const id = /^sp:/.test(pid || '') ? pid.slice(3) : null; return id ? X.items.find(function(x){ return x.id === id; }) : null; },
    load: load
  };

  // ---------- categories offered in the shop ----------
  function categories(){
    const seen = {};
    if(window.TTBuyers && window.TTBuyers.catalogue) window.TTBuyers.catalogue().forEach(function(p){ if(p.category) seen[p.category] = 1; });
    X.items.forEach(function(x){ seen[x.category] = 1; });
    return Object.keys(seen).sort();
  }
  function nameFromFile(f){
    return String(f.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/\b(img|dsc|image|photo|whatsapp image)\b.*$/i, '').trim().replace(/\b\w/g, function(c){ return c.toUpperCase(); });
  }

  // ---------- step 1: photos in, drafts out ----------
  function readPreview(file){
    return new Promise(function(res){ const fr = new FileReader(); fr.onload = function(){ res(fr.result); }; fr.onerror = function(){ res(''); }; fr.readAsDataURL(file); });
  }
  async function addFiles(files){
    const list = Array.prototype.slice.call(files || []).filter(function(f){ return /^image\//.test(f.type); });
    for(const f of list){
      X.drafts.push({ key: uid(), file: f, preview: await readPreview(f), name: nameFromFile(f), category: X.bulk.category, mrp: X.bulk.mrp, err: '' });
    }
    if(files && files.length && !list.length) showToast('Choose image files (JPG, PNG or WebP)');
    render();
  }
  // Photos are resized to 1200 px JPEG so the shop stays quick on phones.
  function shrink(file){
    return new Promise(function(resolve, reject){
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = function(){
        const sc = Math.min(1, 1200 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function(b){ b ? resolve(b) : reject(new Error('Could not read the photo')); }, 'image/jpeg', 0.84);
      };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('Could not read the photo')); };
      img.src = url;
    });
  }
  async function uploadPhoto(file, id){
    const blob = await shrink(file), path = id + '-' + uid() + '.jpg';
    const r = await cloud.sb.storage.from('shop').upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if(r.error) throw r.error;
    return cloud.sb.storage.from('shop').getPublicUrl(path).data.publicUrl;
  }

  // ---------- step 2: publish ----------
  function readDraftInputs(){
    document.querySelectorAll('#tabShop [data-draft]').forEach(function(el){
      const d = X.drafts.find(function(x){ return x.key === el.getAttribute('data-draft'); }); if(!d) return;
      d[el.getAttribute('data-f')] = el.value;
    });
  }
  async function publish(){
    readDraftInputs();
    let bad = 0;
    X.drafts.forEach(function(d){
      d.err = !String(d.name || '').trim() ? 'Add a name' : !String(d.category || '').trim() ? 'Pick a category' : !(parseFloat(d.mrp) > 0) ? 'Add the MRP' : '';
      if(d.err) bad++;
    });
    if(bad){ render(); showToast(bad + ' design' + (bad === 1 ? ' needs' : 's need') + ' a name, category or MRP'); return; }
    X.publishing = true;
    let done = 0, failed = 0;
    for(const d of X.drafts.slice()){
      X.progress = 'Publishing ' + (done + failed + 1) + ' of ' + X.drafts.length + '…'; render();
      try{
        const id = 'sp' + uid();
        const photo = await uploadPhoto(d.file, id);
        const row = { id: id, name: d.name.trim().slice(0, 120), category: d.category.trim().slice(0, 60), mrp: Math.round(parseFloat(d.mrp)), photos: [photo], status: 'live' };
        const r = await cloud.sb.from('shop_products').insert(row);
        if(r.error) throw r.error;
        X.items.unshift(Object.assign({ created_at: new Date().toISOString() }, row));
        X.drafts = X.drafts.filter(function(x){ return x !== d; });
        done++;
      }catch(e){ d.err = 'Couldn’t publish: ' + (e.message || e); failed++; }
    }
    X.publishing = false; X.progress = '';
    render();
    if(done){ showToast(done + ' design' + (done === 1 ? '' : 's') + ' live in the Buyer app' + (failed ? ' · ' + failed + ' failed' : '')); if(typeof cloudPublishPacks === 'function') cloudPublishPacks(); }
    else if(failed) showToast('Nothing published — see the errors');
  }

  // ---------- view ----------
  function render(){
    const root = document.getElementById('shopRoot'); if(!root) return;
    if(!on()){ root.innerHTML = '<div class="panel"><p class="sh-dim">Sign in to Cloud sync to add designs.</p></div>'; return; }
    if(X.missing){ root.innerHTML = '<div class="panel"><p class="sh-dim">Run <code>shop_setup.sql</code> in Supabase → SQL Editor, then reload.</p></div>'; return; }
    const cats = categories(), live = X.items.filter(function(x){ return x.status === 'live'; }).length;
    let h = '<datalist id="shCats">' + cats.map(function(c){ return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>';
    // step 1 + 2
    h += '<div class="panel"><div class="panel-title">Add designs to the shop</div>' +
      '<label class="sh-drop" id="shDrop"><input type="file" id="shFiles" accept="image/*" multiple hidden><b>1 · Drop photos here or click to choose</b><span class="sh-dim">One photo = one design. Add as many as you like.</span></label>';
    if(X.drafts.length){
      h += '<div class="sh-bulk"><span class="sh-dim">Set for all ' + X.drafts.length + ':</span><input list="shCats" id="shBulkCat" placeholder="Category" value="' + esc(X.bulk.category) + '"><input type="number" min="1" id="shBulkMrp" placeholder="MRP ₹" value="' + esc(X.bulk.mrp) + '"><button class="sh-btn" data-sh="apply-all">Apply</button><button class="sh-btn" data-sh="clear-drafts">Clear</button></div>' +
        '<div class="sh-grid">' + X.drafts.map(function(d){
          return '<div class="sh-card' + (d.err ? ' bad' : '') + '"><img src="' + d.preview + '" alt=""><button class="sh-x" data-sh="drop-draft" data-k="' + d.key + '" aria-label="Remove">✕</button>' +
            '<input data-draft="' + d.key + '" data-f="name" placeholder="Name" value="' + esc(d.name) + '">' +
            '<input data-draft="' + d.key + '" data-f="category" list="shCats" placeholder="Category" value="' + esc(d.category) + '">' +
            '<input data-draft="' + d.key + '" data-f="mrp" type="number" min="1" placeholder="MRP ₹" value="' + esc(d.mrp) + '">' +
            (d.err ? '<div class="sh-err">' + esc(d.err) + '</div>' : '') + '</div>';
        }).join('') + '</div>' +
        '<button class="sh-btn primary big" data-sh="publish"' + (X.publishing ? ' disabled' : '') + '>' + (X.publishing ? esc(X.progress) : '2 · Publish ' + X.drafts.length + ' design' + (X.drafts.length === 1 ? '' : 's')) + '</button>';
    }
    h += '</div>';
    // manage
    h += '<div class="panel"><div class="panel-title">Shop designs <span class="sh-dim">' + live + ' live' + (X.items.length > live ? ' · ' + (X.items.length - live) + ' hidden' : '') + '</span></div>' +
      (X.items.length ? '<p class="sh-dim">Changes save as you type. Weight and print time are optional — they feed the below-cost check and production planning.</p><div style="overflow-x:auto"><table class="ba-table"><tr><th></th><th>Name</th><th>Category</th><th class="num">MRP ₹</th><th class="num">Weight g</th><th class="num">Print h</th><th>Status</th><th></th></tr>' +
        X.items.map(function(x){
          return '<tr' + (x.status === 'live' ? '' : ' style="opacity:.55"') + '><td>' + (x.photos && x.photos[0] ? '<img class="sh-th" src="' + esc(x.photos[0]) + '" alt="">' : '') + '</td>' +
            '<td><input data-item="' + esc(x.id) + '" data-f="name" value="' + esc(x.name) + '"></td>' +
            '<td><input data-item="' + esc(x.id) + '" data-f="category" list="shCats" value="' + esc(x.category) + '" style="width:140px"></td>' +
            '<td class="num"><input data-item="' + esc(x.id) + '" data-f="mrp" type="number" min="1" value="' + esc(x.mrp) + '" style="width:80px"></td>' +
            '<td class="num"><input data-item="' + esc(x.id) + '" data-f="weight" type="number" min="0" value="' + esc(x.weight || '') + '" style="width:70px"></td>' +
            '<td class="num"><input data-item="' + esc(x.id) + '" data-f="hours" type="number" min="0" step="0.1" value="' + esc(x.hours || '') + '" style="width:60px"></td>' +
            '<td><button class="sh-btn" data-sh="toggle" data-id="' + esc(x.id) + '">' + (x.status === 'live' ? 'Live' : 'Hidden') + '</button></td>' +
            '<td><button class="sh-btn" data-sh="delete" data-id="' + esc(x.id) + '">Delete</button></td></tr>';
        }).join('') + '</table></div>' : '<p class="sh-dim">' + (X.loaded ? 'No designs added here yet.' : 'Loading…') + '</p>') + '</div>';
    root.innerHTML = h;
  }
  window.renderShopAdmin = function(){ render(); load().then(render); };

  // ---------- events ----------
  async function saveItem(id, patch){
    const x = X.items.find(function(i){ return i.id === id; }); if(!x) return;
    const r = await cloud.sb.from('shop_products').update(patch).eq('id', id);
    if(r.error){ showNoticeModal('Couldn’t save: ' + r.error.message); return; }
    Object.assign(x, patch); showToast('Saved');
    if(typeof cloudPublishPacks === 'function') cloudPublishPacks();
  }
  document.addEventListener('click', async function(e){
    const tab = document.getElementById('tabShop'); if(!tab || !tab.contains(e.target)) return;
    const b = e.target.closest('[data-sh]'); if(!b) return;
    const act = b.getAttribute('data-sh'), id = b.getAttribute('data-id');
    if(act === 'publish') publish();
    else if(act === 'drop-draft'){ readDraftInputs(); X.drafts = X.drafts.filter(function(d){ return d.key !== b.getAttribute('data-k'); }); render(); }
    else if(act === 'clear-drafts'){ X.drafts = []; render(); }
    else if(act === 'apply-all'){
      readDraftInputs();
      X.bulk.category = (document.getElementById('shBulkCat').value || '').trim(); X.bulk.mrp = document.getElementById('shBulkMrp').value || '';
      X.drafts.forEach(function(d){ if(X.bulk.category) d.category = X.bulk.category; if(X.bulk.mrp) d.mrp = X.bulk.mrp; d.err = ''; });
      render();
    }
    else if(act === 'toggle'){ const x = X.items.find(function(i){ return i.id === id; }); if(x){ await saveItem(id, { status: x.status === 'live' ? 'hidden' : 'live' }); render(); } }
    else if(act === 'delete'){
      const x = X.items.find(function(i){ return i.id === id; }); if(!x || !confirm('Delete “' + x.name + '” from the shop? Past orders keep their lines.')) return;
      const r = await cloud.sb.from('shop_products').delete().eq('id', id);
      if(r.error){ showNoticeModal('Couldn’t delete: ' + r.error.message); return; }
      const paths = (x.photos || []).map(function(u){ const m = String(u).match(/\/shop\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; }).filter(Boolean);
      if(paths.length) cloud.sb.storage.from('shop').remove(paths).catch(function(){});
      X.items = X.items.filter(function(i){ return i.id !== id; }); render(); showToast('Deleted');
      if(typeof cloudPublishPacks === 'function') cloudPublishPacks();
    }
  });
  document.addEventListener('change', function(e){
    const tab = document.getElementById('tabShop'); if(!tab || !tab.contains(e.target)) return;
    const t = e.target;
    if(t.id === 'shFiles'){ addFiles(t.files); t.value = ''; return; }
    const id = t.getAttribute('data-item'); if(!id) return;
    const f = t.getAttribute('data-f'), v = t.value.trim();
    if(f === 'name' || f === 'category'){ if(!v){ showToast('Can’t be empty'); render(); return; } saveItem(id, { [f]: v.slice(0, f === 'name' ? 120 : 60) }); }
    else if(f === 'mrp'){ const n = Math.round(parseFloat(v)); if(!(n > 0)){ showToast('MRP must be more than 0'); render(); return; } saveItem(id, { mrp: n }); }
    else saveItem(id, { [f]: v === '' ? null : Math.max(0, parseFloat(v) || 0) });
  });
  ['dragover', 'drop'].forEach(function(ev){
    document.addEventListener(ev, function(e){
      const drop = e.target.closest && e.target.closest('#shDrop'); if(!drop) return;
      e.preventDefault();
      if(ev === 'drop') addFiles(e.dataTransfer.files);
    });
  });

  // Keep the list current for the Buyer app pack even when the tab isn't open.
  if(typeof cloudPullReports === 'function'){
    const origPull = cloudPullReports;
    cloudPullReports = async function(){
      const r = await origPull.apply(this, arguments);
      try{ await load(); }catch(e){}
      return r;
    };
  }

  const css = document.createElement('style');
  css.textContent =
    '#tabShop .sh-dim{color:var(--dim);font-size:12px}' +
    '#tabShop .sh-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 11px;font:12px "JetBrains Mono",monospace;cursor:pointer;margin:2px 4px 2px 0}' +
    '#tabShop .sh-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#0d1117;font-weight:600} #tabShop .sh-btn.big{display:block;width:100%;padding:12px;font-size:14px;margin-top:12px}' +
    '#tabShop .sh-drop{display:flex;flex-direction:column;align-items:center;gap:6px;padding:28px 12px;border:2px dashed var(--line);border-radius:12px;cursor:pointer;text-align:center}' +
    '#tabShop .sh-drop:hover{border-color:var(--cyan)}' +
    '#tabShop .sh-bulk{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}' +
    '#tabShop .sh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}' +
    '#tabShop .sh-card{position:relative;background:var(--input-bg);border:1px solid var(--line);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px}' +
    '#tabShop .sh-card.bad{border-color:var(--red)} #tabShop .sh-card img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px}' +
    '#tabShop .sh-x{position:absolute;top:12px;right:12px;background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:12px;width:24px;height:24px;cursor:pointer}' +
    '#tabShop .sh-err{color:var(--red);font-size:12px}' +
    '#tabShop input{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:12.5px inherit}' +
    '#tabShop .sh-card input{width:100%;box-sizing:border-box} #tabShop .sh-th{width:40px;height:40px;object-fit:cover;border-radius:6px}';
  document.head.appendChild(css);
})();
