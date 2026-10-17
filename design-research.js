// ===================================================================
// ======================== DESIGN RESEARCH (Studio) =================
// ===================================================================
// Ideas for new designs, from outside and inside the business:
//   Rising themes   words and word pairs appearing more in the newest designs and competitor
//                   products than in the ones just before them, with examples.
//   Trending        Printables designs for your watch keywords, ranked by momentum
//                   (engagement per day, so a new design taking off beats an old favourite),
//                   with what each licence allows.
//   Competitors     the stores you watch: what's new, and their price range.
//   Your customers  what brand partners ask for that isn't in the catalogue, quotes you
//                   lost, what's selling more than last quarter, and rising themes nothing
//                   in your range covers yet.
//   Idea board      shortlist ideas, move them from sketching to launched, make a task.
//
// The workshop bridge gathers the outside signals twice a day (research.py); "Refresh now"
// asks it to run within 5 minutes. Data: research_* tables (research_setup.sql).
// Designs found are for inspiration: competitors' products and makers' models belong to them.
(function(){
  if(window.TT_STOCK_MODE) return;

  const V = { view: 'themes', kw: '', store: '', loaded: false, missing: false, err: '', busy: false };
  const X = { cfg: null, items: [], themes: [], runs: [], ideas: [] };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function norm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function days(ts){ return ts ? Math.floor((Date.now() - Date.parse(ts)) / 86400000) : null; }
  function ago(ts){ const d = days(ts); return d == null ? '' : d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? d + ' days ago' : Math.round(d / 30) + ' months ago'; }
  function when(ts){ if(!ts) return ''; const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function money(v, cur){ if(v == null || v === '') return ''; const n = Math.round(+v); return (cur && cur !== 'INR' ? cur + ' ' : '₹') + n.toLocaleString('en-IN'); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function median(a){ if(!a.length) return null; const s = a.slice().sort(function(x, y){ return x - y; }); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // What a maker's licence allows, in a word. Always check the design's page before using it.
  function licence(l){
    const t = String(l || '').toLowerCase();
    if(!t) return { cls: 'dr-lic-unk', text: 'Licence unknown' };
    if(/public domain|cc0/.test(t)) return { cls: 'dr-lic-ok', text: 'Free to use' };
    if(/noncommercial|non-commercial/.test(t)) return { cls: 'dr-lic-no', text: 'Not for sale' };
    if(/standard digital|all rights/.test(t)) return { cls: 'dr-lic-no', text: 'Personal use only' };
    if(/noderiv/.test(t)) return { cls: 'dr-lic-warn', text: 'Sell as-is, no changes' };
    if(/share ?alike/.test(t)) return { cls: 'dr-lic-ok', text: 'Can sell, credit + share alike' };
    if(/attribution/.test(t)) return { cls: 'dr-lic-ok', text: 'Can sell, credit maker' };
    if(/gnu|gpl/.test(t)) return { cls: 'dr-lic-ok', text: 'Can sell, share alike' };
    if(/\bmit\b|bsd|apache/.test(t)) return { cls: 'dr-lic-ok', text: 'Can sell, credit maker' };
    return { cls: 'dr-lic-unk', text: 'Check licence' };
  }

  // ---------- data ----------
  async function load(){
    if(!on() || V.busy) return;
    V.busy = true;
    try{
      const since = new Date(Date.now() - 95 * 86400000).toISOString();
      const res = await Promise.all([
        cloud.sb.from('research_config').select('*').eq('id', 1).maybeSingle(),
        cloud.sb.from('research_items').select('source,ext_id,store,title,url,image,price,currency,category,tags,keyword,likes,downloads,makes,license,published_at,first_seen,score').gte('last_seen', since).order('score', { ascending: false }).limit(3000),
        cloud.sb.from('research_themes').select('*').order('score', { ascending: false }).limit(60),
        cloud.sb.from('research_runs').select('*').order('at', { ascending: false }).limit(5),
        cloud.sb.from('research_ideas').select('*').order('updated_at', { ascending: false })
      ]);
      const err = res.map(function(r){ return r.error; }).filter(Boolean)[0];
      if(err){
        V.missing = /research_|does not exist|schema cache|relation/i.test(err.message || '');
        V.err = V.missing ? '' : err.message;
      } else {
        V.missing = false; V.err = '';
        X.cfg = res[0].data || { keywords: [], stores: [] }; X.items = res[1].data || []; X.themes = res[2].data || [];
        X.runs = res[3].data || []; X.ideas = res[4].data || [];
      }
      V.loaded = true;
    } finally { V.busy = false; }
    if(box && box.style.display !== 'none') render();
  }
  async function saveCfg(patch, msg){
    const r = await cloud.sb.from('research_config').update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq('id', 1);
    if(r.error){ showToast('Could not save: ' + r.error.message); return; }
    Object.assign(X.cfg, patch); if(msg) showToast(msg); render();
  }
  async function saveIdea(idea){
    idea.updated_at = new Date().toISOString();
    const r = await cloud.sb.from('research_ideas').upsert(idea);
    if(r.error){ showToast('Could not save the idea: ' + r.error.message); return false; }
    const i = X.ideas.findIndex(function(x){ return x.id === idea.id; });
    if(i === -1) X.ideas.unshift(idea); else X.ideas[i] = idea;
    return true;
  }

  // ---------- your own signals ----------
  function catalogNames(){ return (state.productCatalog || []).map(function(p){ return norm(p.name); }).filter(Boolean); }
  function inCatalog(name){ const n = norm(name); return !!n && catalogNames().some(function(c){ return c === n || c.indexOf(n) !== -1 || n.indexOf(c) !== -1; }); }
  function customerAsks(){
    const out = {};
    const reqs = (window.TTBuyers && window.TTBuyers.requests && window.TTBuyers.requests()) || [];
    reqs.forEach(function(q){
      const p = q.payload || {};
      (p.lines || []).forEach(function(l){
        const n = String(l.name || '').trim();
        if(!n || inCatalog(n)) return;
        const k = norm(n), e = out[k] || (out[k] = { name: n, count: 0, qty: 0, who: {}, last: '' });
        e.count++; e.qty += +l.qty || 0; e.who[(window.TTBuyers.clientName && window.TTBuyers.clientName(q.client_id)) || 'A buyer'] = 1;
        if((q.created_at || '') > e.last) e.last = q.created_at;
      });
    });
    return Object.values(out).sort(function(a, b){ return b.count - a.count || b.qty - a.qty; });
  }
  function lostQuotes(){
    const cut = isoLocal(new Date(Date.now() - 120 * 86400000));
    return state.orders.filter(function(o){ return o.status === 'lost' && (o.lostDate || o.quotedDate || '') >= cut; })
      .sort(function(a, b){ return (b.lostDate || '').localeCompare(a.lostDate || ''); }).slice(0, 12);
  }
  function salesTrend(){
    const now = Date.now(), d90 = isoLocal(new Date(now - 90 * 86400000)), d180 = isoLocal(new Date(now - 180 * 86400000));
    const units = {};
    state.orders.forEach(function(o){
      if(['quoted', 'lost', 'cancelled'].indexOf(o.status) !== -1) return;
      const d = (o.orderedDate || o.productionStartDate || '').slice(0, 10);
      const bucket = d >= d90 ? 'now' : d >= d180 ? 'prev' : null;
      if(!bucket) return;
      (o.products || []).forEach(function(p){
        const n = String(p.name || '').trim(); if(!n) return;
        const e = units[norm(n)] || (units[norm(n)] = { name: n, now: 0, prev: 0, colors: {} });
        e[bucket] += +p.qty || 0;
        if(bucket === 'now' && p.color) e.colors[p.color] = (e.colors[p.color] || 0) + (+p.qty || 0);
      });
    });
    return Object.values(units).filter(function(e){ return e.now > 0; })
      .map(function(e){ e.growth = e.prev ? (e.now - e.prev) / e.prev : null; return e; })
      .sort(function(a, b){ return (b.growth == null ? 9 : b.growth) - (a.growth == null ? 9 : a.growth) || b.now - a.now; });
  }
  function gaps(){
    const cat = (state.productCatalog || []).map(function(p){ return norm(p.name + ' ' + (p.category || '')); }).join(' | ');
    return X.themes.filter(function(t){ return t.term.split(' ').every(function(w){ return cat.indexOf(w) === -1; }); }).slice(0, 12);
  }

  // ---------- rendering ----------
  let box = null;
  function thumbs(list){
    return '<div class="dr-thumbs">' + (list || []).slice(0, 6).map(function(e){
      return '<a href="' + esc(e.url) + '" target="_blank" rel="noopener" title="' + esc(e.title) + '"><img loading="lazy" src="' + esc(e.image) + '" alt="' + esc(e.title) + '"></a>';
    }).join('') + '</div>';
  }
  function themesHtml(){
    if(!X.themes.length) return empty('No rising themes yet. They appear once a few designs share a word across makers (after the first runs).');
    return '<p class="dr-dim">Words and word pairs showing up more in the newest designs than in the ones just before them, within each keyword and each competitor store. Counted at most twice per maker, so one store’s colour range isn’t a trend, and your own keywords are left out.</p>' +
      '<div class="dr-grid">' + X.themes.slice(0, 30).map(function(t){
        const src = Object.keys(t.sources || {}).map(function(k){ return (k === 'printables' ? 'Printables' : 'competitors') + ' ' + t.sources[k]; }).join(' · ');
        return '<div class="dr-card"><div class="dr-card-h"><b>' + esc(t.term) + '</b><span class="dr-pill" title="In the newer half of designs vs the older half">' + t.now_count + ' newer · ' + t.prev_count + ' older</span></div>' +
          '<div class="dr-dim">' + esc(src) + '</div>' + thumbs(t.examples) +
          '<button class="dr-btn" data-dr="idea-theme" data-term="' + esc(t.term) + '">+ Idea board</button></div>';
      }).join('') + '</div>';
  }
  function itemCard(it){
    const lic = it.source === 'printables' ? licence(it.license) : null;
    return '<div class="dr-card">' + (it.image ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener"><img class="dr-img" loading="lazy" src="' + esc(it.image) + '" alt=""></a>' : '<div class="dr-img dr-noimg"></div>') +
      '<div class="dr-t"><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a></div>' +
      '<div class="dr-dim">' + esc(it.store || '') + (it.published_at ? ' · ' + ago(it.published_at) : '') + '</div>' +
      (it.source === 'printables'
        ? '<div class="dr-dim">♥ ' + (it.likes || 0) + ' · made ' + (it.makes || 0) + ' · ↓ ' + (it.downloads || 0) + '</div><span class="dr-lic ' + lic.cls + '" title="' + esc(it.license || '') + '">' + esc(lic.text) + '</span>'
        : (it.price != null ? '<div><b>' + esc(money(it.price, it.currency)) + '</b></div>' : '')) +
      '<div class="dr-actions"><button class="dr-btn" data-dr="idea-item" data-src="' + esc(it.source) + '" data-id="' + esc(it.ext_id) + '">+ Idea board</button>' +
      '<button class="dr-btn" data-dr="to-project" data-src="' + esc(it.source) + '" data-id="' + esc(it.ext_id) + '">+ Project</button></div></div>';
  }
  function trendingHtml(){
    const list = X.items.filter(function(i){ return i.source === 'printables' && (!V.kw || i.keyword === V.kw); })
      .sort(function(a, b){ return (+b.score || 0) - (+a.score || 0); });
    const kws = (X.cfg.keywords || []);
    return '<div class="dr-chips"><button class="dr-chip' + (!V.kw ? ' on' : '') + '" data-dr="kw" data-kw="">All</button>' +
      kws.map(function(k){ return '<button class="dr-chip' + (V.kw === k ? ' on' : '') + '" data-dr="kw" data-kw="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>' +
      '<p class="dr-dim">Ranked by momentum: likes, makes and downloads per day since posting. The badge says what the maker’s licence allows; open the design to check before using anything.</p>' +
      (list.length ? '<div class="dr-grid">' + list.slice(0, 48).map(itemCard).join('') + '</div>' : empty('Nothing yet for this keyword.'));
  }
  function competitorsHtml(){
    const stores = X.cfg.stores || [];
    if(!stores.length) return empty('Add competitor stores under Watch list below. Shopify stores and most others (Wix, WooCommerce) work.');
    const items = X.items.filter(function(i){ return i.source === 'store'; });
    const by = {};
    items.forEach(function(i){ (by[i.store] = by[i.store] || []).push(i); });
    const names = stores.map(function(s){ return s.name || s.url; });
    const pick = V.store && by[V.store] ? V.store : '';
    let h = '<div class="dr-table"><div class="dr-tr dr-th"><span>Store</span><span>Products</span><span>New in 30 days</span><span>Price range (median)</span></div>' +
      names.map(function(n){
        const list = by[n] || [], prices = list.map(function(i){ return +i.price; }).filter(function(p){ return p > 0; });
        const cur = (list.find(function(i){ return i.currency; }) || {}).currency;
        const fresh = list.filter(function(i){ const d = days(i.published_at || i.first_seen); return d != null && d <= 30; }).length;
        return '<div class="dr-tr dr-click" data-dr="store" data-store="' + esc(n) + '"><span><b>' + esc(n) + '</b></span><span>' + list.length + '</span><span>' + fresh + '</span><span>' +
          (prices.length ? esc(money(Math.min.apply(null, prices), cur) + ' – ' + money(Math.max.apply(null, prices), cur) + ' (' + money(median(prices), cur) + ')') : '—') + '</span></div>';
      }).join('') + '</div>';
    const show = (pick ? by[pick] : items).slice().sort(function(a, b){ return (b.published_at || b.first_seen || '').localeCompare(a.published_at || a.first_seen || ''); });
    h += '<div class="dr-sub">' + (pick ? esc(pick) + ' · newest first <button class="dr-link" data-dr="store" data-store="">show all</button>' : 'Newest across all stores') + '</div>';
    h += show.length ? '<div class="dr-grid">' + show.slice(0, 36).map(itemCard).join('') + '</div>' : empty('No products read from these stores yet. Check the last run under Watch list.');
    return h;
  }
  function customersHtml(){
    const asks = customerAsks(), lost = lostQuotes(), trend = salesTrend().slice(0, 10), gp = gaps();
    return '<div class="dr-two">' +
      '<div class="panel"><div class="panel-title">Asked for, not in your catalogue</div>' +
        (asks.length ? asks.slice(0, 12).map(function(a){ return '<div class="dr-li"><b>' + esc(a.name) + '</b><span>' + a.count + ' request' + (a.count === 1 ? '' : 's') + (a.qty ? ' · ' + a.qty + ' pcs' : '') + ' · ' + esc(Object.keys(a.who).slice(0, 3).join(', ')) + '</span><button class="dr-btn" data-dr="idea-text" data-t="' + esc(a.name) + '" data-n="' + esc('Asked for in the Buyer app: ' + a.count + ' request(s)') + '">+ Idea</button></div>'; }).join('')
          : '<p class="dr-dim">' + (window.TTBuyers ? 'No Buyer app requests for products outside the catalogue.' : 'Open the Buyer App tab once to load requests.') + '</p>') + '</div>' +
      '<div class="panel"><div class="panel-title">Rising themes nothing in your range covers</div>' +
        (gp.length ? gp.map(function(t){ return '<div class="dr-li"><b>' + esc(t.term) + '</b><span>' + t.now_count + ' new designs</span><button class="dr-btn" data-dr="idea-theme" data-term="' + esc(t.term) + '">+ Idea</button></div>'; }).join('') : '<p class="dr-dim">No gaps found yet.</p>') + '</div>' +
      '<div class="panel"><div class="panel-title">Selling more than last quarter</div>' +
        (trend.length ? trend.map(function(e){ const top = Object.keys(e.colors).sort(function(a, b){ return e.colors[b] - e.colors[a]; }).slice(0, 2).join(', ');
          return '<div class="dr-li"><b>' + esc(e.name) + '</b><span>' + e.now + ' pcs in 90 days' + (e.growth == null ? ' · new' : ' · ' + (e.growth >= 0 ? '+' : '') + Math.round(e.growth * 100) + '%') + (top ? ' · ' + esc(top) : '') + '</span></div>'; }).join('') : '<p class="dr-dim">No orders in the last 90 days.</p>') + '</div>' +
      '<div class="panel"><div class="panel-title">Quotes lost (last 4 months)</div>' +
        (lost.length ? lost.map(function(o){ return '<div class="dr-li"><b>' + esc((o.products || []).map(function(p){ return p.name; }).filter(Boolean).join(', ') || o.name || 'Quote') + '</b><span>' + esc(o.displayId || '') + (o.notes ? ' · ' + esc(String(o.notes).slice(0, 90)) : '') + '</span></div>'; }).join('') : '<p class="dr-dim">No lost quotes. Note why when you mark one lost; it shows here.</p>') + '</div>' +
    '</div>';
  }
  const STATUSES = [['new', 'New'], ['sketching', 'Sketching'], ['prototype', 'Prototype'], ['launched', 'Launched'], ['dropped', 'Dropped']];
  function ideasHtml(){
    if(!X.ideas.length) return empty('Tap “+ Idea board” on any theme, design or request to shortlist it here.');
    return STATUSES.map(function(s){
      const list = X.ideas.filter(function(i){ return i.status === s[0]; });
      if(!list.length) return '';
      return '<div class="dr-sub">' + s[1] + ' <span class="dr-dim">' + list.length + '</span></div>' + list.map(function(i){
        return '<div class="dr-idea" data-id="' + esc(i.id) + '"><div class="dr-idea-h"><input class="dr-idea-t" value="' + esc(i.title) + '">' +
          '<select class="dr-idea-s">' + STATUSES.map(function(x){ return '<option value="' + x[0] + '"' + (x[0] === i.status ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
          '<textarea class="dr-idea-n" placeholder="Notes: size, material, price point, who it’s for…">' + esc(i.notes) + '</textarea>' +
          thumbs((i.refs || []).filter(function(r){ return r.image; })) +
          '<div class="dr-dim">' + esc(i.created_by || '') + ' · ' + ago(i.created_at) + '</div>' +
          '<label class="dr-share"><input type="checkbox" class="dr-idea-sh"' + (i.shared ? ' checked' : '') + '> Share with designers <span class="dr-dim">(they see it in their Partner app)</span></label>' +
          '<div class="dr-actions"><button class="dr-btn" data-dr="idea-save">Save</button><button class="dr-btn" data-dr="idea-task">Make a task</button><button class="dr-btn" data-dr="idea-del">Delete</button></div></div>';
      }).join('');
    }).join('');
  }
  function watchHtml(){
    const run = X.runs[0], s = (run && run.summary) || {};
    return '<details class="dr-watch"' + (V.openWatch ? ' open' : '') + '><summary><b>Watch list</b> <span class="dr-dim">' + (X.cfg.keywords || []).length + ' keywords · ' + (X.cfg.stores || []).length + ' stores</span></summary>' +
      '<label class="dr-lab">Keywords (comma separated)<textarea id="drKw">' + esc((X.cfg.keywords || []).join(', ')) + '</textarea></label><button class="dr-btn" data-dr="save-kw">Save keywords</button>' +
      '<div class="dr-lab">Competitor stores</div>' + (X.cfg.stores || []).map(function(st, i){
        return '<div class="dr-li"><b>' + esc(st.name || '') + '</b><span>' + esc(st.url) + (s.stores && s.stores[st.name] ? ' · ' + esc(s.stores[st.name]) : '') + '</span><button class="dr-btn" data-dr="store-del" data-i="' + i + '">Remove</button></div>';
      }).join('') +
      '<div class="dr-add"><input id="drStoreName" placeholder="Name, e.g. Sonogo"><input id="drStoreUrl" placeholder="https://their-shop.com"><button class="dr-btn" data-dr="store-add">Add store</button></div>' +
      '<div class="dr-lab">Runs</div>' + (X.runs.length ? X.runs.map(function(r){ const m = r.summary || {};
        return '<div class="dr-li"><b>' + esc(when(r.at)) + '</b><span>' + (r.ok ? '' : '⚠ ') + (m.printables || 0) + ' designs · ' + (m.store_items || 0) + ' store products · ' + (m.themes || 0) + ' themes' + (m.seconds ? ' · ' + m.seconds + ' s' : '') +
          ((m.errors || []).length ? '<br><span class="dr-warn">' + esc(m.errors.slice(0, 3).join(' · ')) + '</span>' : '') + '</span></div>'; }).join('') : '<p class="dr-dim">No runs yet.</p>') +
    '</details>';
  }
  function pickHtml(){
    if(!V.pickFor) return '';
    const it = findItem(V.pickFor.source, V.pickFor.ext_id); if(!it) return '';
    return '<div class="dr-pickp" id="drProjPick"><div class="dr-pickp-h">' + (it.image ? '<img src="' + esc(it.image) + '" alt="">' : '') + '<div><b>Add to a project brief</b><div class="dr-dim">' + esc(it.title) + '</div></div></div>' +
      '<input id="drProjNote" placeholder="Note for the designer (optional), e.g. like the hinge, not the shape">' +
      '<div class="dr-pickp-list">' + (V.pickList || []).map(function(pr){ return '<button class="dr-btn" data-dr="pick-project" data-id="' + esc(pr.id) + '">' + esc(pr.title) + (pr.designer ? ' · ' + esc(pr.designer) : '') + '</button>'; }).join('') +
      '<button class="dr-link" data-dr="pick-cancel">Cancel</button></div></div>';
  }
  function empty(t){ return '<p class="dr-dim dr-empty">' + esc(t) + '</p>'; }
  function render(){
    const root = document.getElementById('designResearchRoot');
    if(!root) return;
    if(!on()){ root.innerHTML = '<div class="card"><h3>Design research</h3><p class="dr-dim">Turn on cloud sync (Settings) to see research.</p></div>'; return; }
    if(V.missing){ root.innerHTML = '<div class="card"><h3>Design research</h3><p>One-time setup: run <code>research_setup.sql</code> (in ~/PrintFarm/tt-bridge) in Supabase → SQL Editor.</p></div>'; return; }
    if(!V.loaded){ root.innerHTML = '<div class="card"><p class="dr-dim">Loading research…</p></div>'; return; }
    const run = X.runs[0], asked = X.cfg.requested_at;
    const tabs = [['themes', 'Rising themes', X.themes.length], ['trending', 'Trending designs', X.items.filter(function(i){ return i.source === 'printables'; }).length],
      ['competitors', 'Competitors', X.items.filter(function(i){ return i.source === 'store'; }).length], ['customers', 'Your customers', ''], ['ideas', 'Idea board', X.ideas.filter(function(i){ return i.status !== 'dropped' && i.status !== 'launched'; }).length]];
    const body = V.view === 'trending' ? trendingHtml() : V.view === 'competitors' ? competitorsHtml() : V.view === 'customers' ? customersHtml() : V.view === 'ideas' ? ideasHtml() : themesHtml();
    root.innerHTML = '<div class="card">' +
      '<div class="dr-head"><div><h3 style="margin:0">Design research</h3><div class="dr-dim">' +
        (run ? 'Last gathered ' + esc(when(run.at)) + ' · refreshes every 12 hours' : 'Not gathered yet') + (asked ? ' · refresh requested, within 5 min' : '') + '</div></div>' +
        '<button class="dr-btn" data-dr="refresh"' + (asked ? ' disabled' : '') + '>Refresh now</button></div>' +
      '<div class="dr-tabs">' + tabs.map(function(t){ return '<button class="dr-tab' + (V.view === t[0] ? ' on' : '') + '" data-dr="view" data-v="' + t[0] + '">' + t[1] + (t[2] !== '' ? ' <span>' + t[2] + '</span>' : '') + '</button>'; }).join('') + '</div>' +
      (V.err ? '<p class="dr-warn">' + esc(V.err) + '</p>' : '') + pickHtml() + body +
      '<p class="dr-note">For inspiration only. Competitors’ products and makers’ models belong to them: design your own take, and check a model’s licence before printing or selling it.</p>' +
      watchHtml() + '</div>';
  }

  // ---------- actions ----------
  function findItem(src, id){ return X.items.find(function(i){ return i.source === src && i.ext_id === id; }); }
  function ref(it){ return { source: it.source, ext_id: it.ext_id, title: it.title, image: it.image, url: it.url, license: it.license || null, store: it.store || null }; }
  async function addIdea(title, notes, refs){
    const ok = await saveIdea({ id: uid(), title: title, notes: notes || '', status: 'new', refs: refs || [], created_by: cloud.email || null, created_at: new Date().toISOString() });
    if(ok) showToast('Added to the idea board');
  }
  document.addEventListener('click', async function(e){
    if(!box || !box.contains(e.target)) return;
    const b = e.target.closest('[data-dr]'); if(!b) return;
    const act = b.getAttribute('data-dr');
    if(act === 'view'){ V.view = b.getAttribute('data-v'); render(); }
    else if(act === 'kw'){ V.kw = b.getAttribute('data-kw'); render(); }
    else if(act === 'store'){ V.store = b.getAttribute('data-store'); render(); }
    else if(act === 'refresh'){ await saveCfg({ requested_at: new Date().toISOString() }, 'The workshop bridge will gather within 5 minutes'); }
    else if(act === 'idea-theme'){
      const t = X.themes.find(function(x){ return x.term === b.getAttribute('data-term'); });
      if(t) await addIdea(t.term.charAt(0).toUpperCase() + t.term.slice(1), 'Rising theme: ' + t.now_count + ' new designs in 30 days (was ' + t.prev_count + ').', t.examples || []);
    }
    else if(act === 'idea-item'){ const it = findItem(b.getAttribute('data-src'), b.getAttribute('data-id')); if(it) await addIdea(it.title, (it.source === 'printables' ? 'Printables · ' + (it.license || 'licence unknown') : 'Seen at ' + (it.store || 'a competitor') + (it.price != null ? ' · ' + money(it.price, it.currency) : '')), [ref(it)]); }
    else if(act === 'idea-text'){ await addIdea(b.getAttribute('data-t'), b.getAttribute('data-n'), []); }
    else if(act === 'to-project'){
      const it = findItem(b.getAttribute('data-src'), b.getAttribute('data-id'));
      if(!it || !window.TTProjects){ showToast('Projects aren’t available'); return; }
      await window.TTProjects.load();
      const list = window.TTProjects.open();
      if(!list.length){ showToast('No open projects. Start one in Projects first.'); return; }
      V.pickFor = { source: it.source, ext_id: it.ext_id }; V.pickList = list; render();
      const el = document.getElementById('drProjPick'); if(el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    else if(act === 'pick-project'){
      const it = V.pickFor && findItem(V.pickFor.source, V.pickFor.ext_id);
      const note = (document.getElementById('drProjNote') || {}).value || '';
      if(it && await window.TTProjects.addInspo(b.getAttribute('data-id'), Object.assign(ref(it), { note: note.slice(0, 200) }))){ showToast('Added to the project brief'); V.pickFor = null; render(); }
    }
    else if(act === 'pick-cancel'){ V.pickFor = null; render(); }
    else if(act === 'save-kw'){
      const kws = (document.getElementById('drKw').value || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean).slice(0, 30);
      V.openWatch = true; await saveCfg({ keywords: kws }, 'Keywords saved · used from the next run');
    }
    else if(act === 'store-add'){
      const name = document.getElementById('drStoreName').value.trim(), url = document.getElementById('drStoreUrl').value.trim();
      if(!/^https?:\/\/[^\s/]+\.[^\s]+/i.test(url)){ showToast('Enter the store’s web address, starting with https://'); return; }
      V.openWatch = true; await saveCfg({ stores: (X.cfg.stores || []).concat([{ name: name || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], url: url }]).slice(0, 20) }, 'Store added · read from the next run');
    }
    else if(act === 'store-del'){ const i = +b.getAttribute('data-i'); V.openWatch = true; await saveCfg({ stores: (X.cfg.stores || []).filter(function(_, j){ return j !== i; }) }, 'Store removed'); }
    else if(act.indexOf('idea-') === 0){
      const card = b.closest('.dr-idea'); if(!card) return;
      const idea = X.ideas.find(function(x){ return x.id === card.getAttribute('data-id'); }); if(!idea) return;
      if(act === 'idea-save'){
        idea.title = card.querySelector('.dr-idea-t').value.trim() || idea.title; idea.notes = card.querySelector('.dr-idea-n').value; idea.status = card.querySelector('.dr-idea-s').value;
        if(await saveIdea(idea)){ showToast('Saved'); render(); }
      } else if(act === 'idea-task'){
        if(!window.TTTasks){ showToast('Tasks aren’t available'); return; }
        await window.TTTasks.load();
        const ok = await window.TTTasks.add('Design: ' + idea.title, '', null, 'normal', null, (idea.notes || '') + ((idea.refs || []).length ? '\nReferences: ' + idea.refs.map(function(r){ return r.url; }).filter(Boolean).join(' ') : ''));
        if(ok) showToast('Task created on the Tasks board');
      } else if(act === 'idea-del'){
        if(!confirm('Delete the idea “' + idea.title + '”?')) return;
        const r = await cloud.sb.from('research_ideas').delete().eq('id', idea.id);
        if(r.error){ showToast('Could not delete: ' + r.error.message); return; }
        X.ideas = X.ideas.filter(function(x){ return x.id !== idea.id; }); render();
      }
    }
  });
  document.addEventListener('change', function(e){
    const sh = e.target.closest && e.target.closest('.dr-idea-sh');
    if(sh){
      const card = sh.closest('.dr-idea'), idea = X.ideas.find(function(x){ return x.id === card.getAttribute('data-id'); });
      if(idea){ idea.shared = sh.checked; saveIdea(idea).then(function(ok){ if(ok) showToast(sh.checked ? 'Shared with designers' : 'No longer shared'); }); }
      return;
    }
    const s = e.target.closest && e.target.closest('.dr-idea-s'); if(!s) return;
    const card = s.closest('.dr-idea'), idea = X.ideas.find(function(x){ return x.id === card.getAttribute('data-id'); });
    if(idea){ idea.status = s.value; idea.title = card.querySelector('.dr-idea-t').value.trim() || idea.title; idea.notes = card.querySelector('.dr-idea-n').value; saveIdea(idea).then(function(ok){ if(ok) render(); }); }
  });

  // Previews: fall back to the full photo if a Printables preview size is missing, else hide.
  document.addEventListener('error', function(e){
    const img = e.target;
    if(!img || img.tagName !== 'IMG' || !box || !box.contains(img)) return;
    const m = /^(.*)\/thumbs\/inside\/\d+x\d+\/(\w+)\/([^/]+)\.webp$/.exec(img.getAttribute('src') || '');
    if(m && !img.dataset.full){ img.dataset.full = '1'; img.src = m[1] + '/' + m[3] + '.' + m[2]; }
    else img.style.visibility = 'hidden';
  }, true);

  const css = document.createElement('style');
  css.textContent =
    '.dr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px}' +
    '.dr-dim{color:var(--dim);font-size:12px}.dr-warn{color:var(--amber);font-size:12px}.dr-empty{padding:16px 0}' +
    '.dr-tabs,.dr-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px}' +
    '.dr-tab,.dr-chip{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}' +
    '.dr-tab span{color:var(--dim);font-size:11px}.dr-tab.on,.dr-chip.on{border-color:var(--cyan);color:var(--cyan)}.dr-chip{font-size:12px;padding:3px 10px}' +
    '.dr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}' +
    '.dr-card{border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:5px;min-width:0}' +
    '.dr-card-h{display:flex;justify-content:space-between;gap:8px;align-items:center}.dr-card-h b{font-size:15px;text-transform:capitalize}' +
    '.dr-pill{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--dim);white-space:nowrap}' +
    '.dr-img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;background:var(--input-bg);display:block}.dr-noimg{aspect-ratio:4/3}' +
    '.dr-t{font-weight:600;font-size:13px;line-height:1.3;overflow-wrap:anywhere}.dr-t a{color:var(--text);text-decoration:none}.dr-t a:hover{color:var(--cyan)}' +
    '.dr-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:4px 0}.dr-thumbs img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:var(--input-bg);display:block}' +
    '.dr-lic{align-self:flex-start;font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid}.dr-lic-ok{color:var(--green)}.dr-lic-no{color:var(--red)}.dr-lic-warn{color:var(--amber)}.dr-lic-unk{color:var(--dim)}' +
    '.dr-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer;align-self:flex-start}.dr-btn:hover{border-color:var(--cyan);color:var(--cyan)}.dr-btn[disabled]{opacity:.5;cursor:default}' +
    '.dr-link{background:none;border:none;color:var(--cyan);font:inherit;font-size:12px;cursor:pointer}' +
    '.dr-table{display:grid;font-size:13px;margin-bottom:12px;overflow-x:auto}.dr-tr{display:grid;grid-template-columns:1.4fr .7fr .8fr 1.6fr;gap:8px;padding:7px 4px;border-top:1px solid var(--line);min-width:520px}.dr-th{color:var(--dim);border-top:none;font-size:12px}.dr-click{cursor:pointer}.dr-click:hover{background:var(--input-bg)}' +
    '.dr-sub{font-weight:600;margin:14px 0 8px}' +
    '.dr-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.dr-two .panel{margin:0}' +
    '.dr-li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:7px 0;border-top:1px solid var(--line);font-size:13px}.dr-li span{color:var(--dim);flex:1;min-width:140px}.dr-li b{overflow-wrap:anywhere}' +
    '.dr-idea{border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:6px}' +
    '.dr-idea-h{display:flex;gap:8px;flex-wrap:wrap}.dr-idea-t{flex:1;min-width:180px;font-weight:600}' +
    '.dr-idea input,.dr-idea select,.dr-idea textarea,.dr-watch textarea,.dr-watch input{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;box-sizing:border-box}' +
    '.dr-idea textarea{min-height:56px;width:100%}.dr-idea .dr-thumbs{grid-template-columns:repeat(6,1fr);max-width:420px}.dr-actions{display:flex;gap:6px;flex-wrap:wrap}' +
    '.dr-share{display:flex;gap:6px;align-items:center;font-size:12.5px;cursor:pointer}' +
    '.dr-pickp{border:1px solid var(--cyan);border-radius:12px;padding:12px;margin-bottom:12px;display:flex;flex-direction:column;gap:8px}.dr-pickp-h{display:flex;gap:10px;align-items:center}.dr-pickp-h img{width:56px;height:42px;object-fit:cover;border-radius:6px}' +
    '.dr-pickp input{background:var(--input-bg);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font:inherit;font-size:13px}.dr-pickp-list{display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
    '.dr-note{font-size:12px;color:var(--dim);border-top:1px solid var(--line);margin-top:16px;padding-top:10px}' +
    '.dr-watch{margin-top:10px}.dr-watch summary{cursor:pointer;padding:6px 0}.dr-lab{display:block;font-size:12px;color:var(--dim);margin:12px 0 4px}.dr-watch textarea{width:100%;min-height:60px;margin-top:4px}' +
    '.dr-add{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.dr-add input{flex:1;min-width:160px}' +
    '@media (max-width:600px){.dr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dr-tr{min-width:0;grid-template-columns:1fr 1fr}}';
  document.head.appendChild(css);

  // Screen: in Sales & marketing, after Product Lab.
  const anchor = document.querySelector('.tab-btn[data-tab="lab"]') || document.querySelector('.tab-btn[data-tab="products"]');
  const settingsTab = document.getElementById('tabSettings');
  if(anchor && settingsTab){
    const btn = document.createElement('button');
    btn.className = 'tab-btn'; btn.setAttribute('data-tab', 'research'); btn.textContent = 'Design research';
    anchor.insertAdjacentElement('afterend', btn);
    box = document.createElement('div');
    box.id = 'tabResearch'; box.style.display = 'none'; box.innerHTML = '<div id="designResearchRoot"></div>';
    settingsTab.parentNode.insertBefore(box, settingsTab);
    function wire(b){
      b.addEventListener('click', function(){
        const show = b.getAttribute('data-tab') === 'research';
        box.style.display = show ? '' : 'none';
        if(show){
          document.querySelectorAll('.tab-btn').forEach(function(x){ x.classList.toggle('active', x === b); });
          const lab = document.getElementById('currentTabLabel'); if(lab) lab.textContent = 'Design research';
          const bar = document.getElementById('tabBar'); if(bar) bar.classList.remove('open');
          document.querySelectorAll('.wrap > [id^="tab"]').forEach(function(el){ if(el !== box && /^tab[A-Z]/.test(el.id) && el.id !== 'tabBar') el.style.display = 'none'; });
          render(); load();
        }
      });
    }
    document.querySelectorAll('.tab-btn').forEach(wire);
    const sheet = document.getElementById('moreSheetList');
    if(sheet){
      const lab = [].filter.call(sheet.querySelectorAll('.msheet-label'), function(el){ return /^sales/i.test(el.textContent.trim()); })[0];
      const grid = lab && lab.nextElementSibling;
      if(grid){ const it = document.createElement('button'); it.className = 'msheet-item'; it.setAttribute('data-goto', 'research'); it.textContent = 'Design research'; grid.appendChild(it); }
    }
  }
  window.TTResearch = { load: load, render: render, _x: X, _v: V };
})();
