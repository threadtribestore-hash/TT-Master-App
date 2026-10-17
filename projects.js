// ===================================================================
// ========================= PROJECTS (Studio) =======================
// ===================================================================
// Simple tracking for custom design projects with a designer partner:
//   Brief → Design → Prototype → Approval → Live
// Each project has a stage, a due date, a list of steps and an update thread.
// Shared with the designer (Partner app) and, for client projects, the brand partner
// (Buyer app) through the projects / project_items tables (projects_setup.sql).
(function(){
  if(window.TT_STOCK_MODE) return;

  const STAGES = [['request', 'Requests'], ['brief', 'Brief'], ['design', 'Design'], ['prototype', 'Prototype'], ['approval', 'Approval'], ['live', 'Live']];
  const OTHER = [['on_hold', 'On hold'], ['cancelled', 'Cancelled']];
  // Stage names used by earlier versions.
  const OLD = { pitch: 'brief', concept: 'design', cad: 'design', production: 'approval' };
  const X = { projects: [], items: {}, missing: false, loaded: false, sel: null, chan: null, showOther: false };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function today(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmt(s){ if(!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function when(s){ const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function stageOf(p){ const s = (p.data || {}).stage || 'brief'; return OLD[s] || s; }
  function partnerName(id){ ensurePon(); const p = state.pon.partners.find(function(x){ return x.id === id; }); return p ? (p.name || 'Partner') : '—'; }
  function clientName(id){ const c = (state.clients || []).find(function(x){ return x.id === id; }); return c ? (c.name || 'Client') : ''; }

  // ---------- data ----------
  async function load(){
    if(!on()) return;
    const r = await cloud.sb.from('projects').select('id,designer_id,client_id,data,created_by,updated_at').order('updated_at', { ascending: false });
    if(r.error){ X.missing = /projects|does not exist|schema cache|relation/i.test(r.error.message || ''); X.loaded = true; return; }
    const it = await cloud.sb.from('project_items').select('project_id,id,kind,author,data,deleted,updated_at').in('kind', ['task', 'comment', 'image']).eq('deleted', false).limit(20000);
    X.missing = false; X.loaded = true;
    X.projects = r.data || [];
    X.items = {};
    (it.data || []).forEach(function(x){ (X.items[x.project_id] = X.items[x.project_id] || []).push(x); });
    Object.keys(X.items).forEach(function(k){ X.items[k].sort(function(a, b){ return (a.data && a.data.at || a.updated_at || '').localeCompare(b.data && b.data.at || b.updated_at || ''); }); });
    if(!X.chan){
      try{
        X.chan = cloud.sb.channel('tt-projects-' + Math.random().toString(36).slice(2, 7))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, function(){ soon(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'project_items' }, function(){ soon(); })
          .subscribe();
      }catch(e){}
    }
  }
  let t = null;
  function soon(){ clearTimeout(t); t = setTimeout(function(){ load().then(function(){ refresh(); badge(); }); }, 400); }
  function project(id){ return X.projects.find(function(p){ return p.id === id; }); }
  // Steps run in date order (undated last); updates in the order they were posted.
  function byDue(a, b){ return (a.data.due || '9999').localeCompare(b.data.due || '9999') || (a.data.at || '').localeCompare(b.data.at || ''); }
  function items(id, kind){ const l = (X.items[id] || []).filter(function(x){ return !kind || x.kind === kind; }); return kind === 'task' ? l.slice().sort(byDue) : l; }
  // The designer fills in their own steps once Thread Tribe has started the project.
  function needsPlan(p){ return !!p.designer_id && ['request', 'live', 'cancelled', 'on_hold'].indexOf(stageOf(p)) === -1 && !items(p.id, 'task').some(function(x){ return x.data.owner !== 'tt'; }); }
  // Thread Tribe's own steps on every new project.
  const TT_STEPS = [['Share brief and references', 1], ['Review prototype', null], ['Final approval', null]];
  // ---------- the brief ----------
  // A structured brief the designer can work from, in project.data.spec. The free-text
  // brief stays as notes. The same fields show (read-only) in the designer's Partner app.
  const SPEC = [
    { sec: 'What it is', fields: [
      { k: 'type', label: 'Product type', type: 'select', opts: ['Lamp / lighting', 'Home décor', 'Toy / fidget', 'Gift / hamper item', 'Corporate merchandise', 'Desk / organiser', 'Signage / display', 'Other'], key: true },
      { k: 'purpose', label: 'What it’s for, where it’s used', ph: 'e.g. Paperweight for a door company’s showroom desks', key: true, wide: true },
      { k: 'audience', label: 'Who it’s for', ph: 'e.g. Their dealers and walk-in customers' } ] },
    { sec: 'Size & build', fields: [
      { k: 'dims', label: 'Size W × D × H (mm)', ph: 'e.g. 90 × 20 × 120', key: true },
      { k: 'material', label: 'Material', type: 'select', opts: ['PLA', 'PETG', 'TPU (flexible)', 'PLA + PETG', 'Silk PLA', 'Wood-fill PLA', 'Designer to suggest'], key: true },
      { k: 'colours', label: 'Colours', ph: 'e.g. Walnut brown + brass gold accent', key: true },
      { k: 'finish', label: 'Finish', type: 'select', opts: ['Matte', 'Silk / satin', 'Gloss', 'Textured', 'Painted / post-processed', 'Any'] },
      { k: 'parts', label: 'Parts & assembly', ph: 'e.g. 3 parts, snap-fit, no glue' },
      { k: 'moving', label: 'Moving parts', ph: 'e.g. The door opens and closes on a print-in-place hinge' },
      { k: 'hardware', label: 'Inserts & hardware', ph: 'e.g. NFC tag (25 mm round) near the handle, 2 magnets', wide: true } ] },
    { sec: 'Branding', fields: [
      { k: 'branding', label: 'Logo, text or engraving', ph: 'e.g. “Infinity Woodkraft” embossed on the base, 2 mm deep', wide: true } ] },
    { sec: 'Constraints', fields: [
      { k: 'printer', label: 'Must print on', type: 'select', opts: ['Any farm printer (256 mm bed)', 'A1 mini (180 mm bed)', 'Large format (300 mm+)', 'Designer to suggest'] },
      { k: 'supports', label: 'Supports', type: 'select', opts: ['Avoid supports', 'OK if easy to remove', 'Any'] },
      { k: 'printTime', label: 'Print time / piece (h)', type: 'number', ph: 'e.g. 3' },
      { k: 'safety', label: 'Safety', type: 'select', opts: ['None', 'Kid-safe (no small parts)', 'Food contact', 'Outdoor / UV', 'Heat (near a bulb)'] } ] }
  ];
  const DELIVERABLES = [['files', 'Print-ready 3MF / STL with settings'], ['renders', 'Renders or photos'], ['cad', 'Source CAD (STEP / F3D)'], ['proto', 'Printed prototype'], ['notes', 'Assembly & print notes']];
  function specOf(p){ return Object.assign({}, (p.data || {}).spec || {}); }
  // How complete the brief is, and what's missing, for the meter.
  function briefCheck(p){
    const d = p.data || {}, sp = specOf(p), need = [];
    SPEC.forEach(function(g){ g.fields.forEach(function(f){ if(f.key && !String(sp[f.k] || '').trim()) need.push(f.label.replace(/ \(.*$/, '')); }); });
    if(!(sp.deliverables || []).length) need.push('Deliverables');
    if(!String(sp.doneWhen || '').trim()) need.push('Done when');
    if(!d.due) need.push('Due date');
    if(!(d.inspo || []).length && !((d.refs || []).length) && !items(p.id, 'image').length) need.push('Inspiration or references');
    const total = SPEC.reduce(function(n, g){ return n + g.fields.filter(function(f){ return f.key; }).length; }, 0) + 4;
    return { pct: Math.round(100 * (total - need.length) / total), need: need };
  }
  function specField(f, sp){
    const v = sp[f.k] == null ? '' : sp[f.k];
    const ctl = f.type === 'select'
      ? '<select data-ps="' + f.k + '"><option value="">—</option>' + f.opts.map(function(o){ return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + (v && f.opts.indexOf(v) === -1 ? '<option selected>' + esc(v) + '</option>' : '') + '</select>'
      : '<input' + (f.type === 'number' ? ' type="number" min="0" step="0.5"' : '') + ' data-ps="' + f.k + '" value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '">';
    return '<label class="' + (f.wide ? 'pj-span2' : '') + (f.key && !String(v).trim() ? ' pj-need' : '') + '"><span>' + esc(f.label) + (f.key ? ' <i class="pj-key">key</i>' : '') + '</span>' + ctl + '</label>';
  }
  function licenceText(l){
    const t = String(l || '').toLowerCase();
    if(!t) return '';
    if(/public domain|cc0/.test(t)) return 'Free to use';
    if(/noncommercial|non-commercial/.test(t)) return 'Not for sale';
    if(/standard digital|all rights/.test(t)) return 'Personal use only';
    if(/noderiv/.test(t)) return 'No changes';
    return 'Can sell, credit maker';
  }
  function inspoHtml(p){
    const list = (p.data || {}).inspo || [];
    return '<div class="pj-brief-g"><b>Inspiration</b> <span class="pj-dim">From Design research · the designer sees these with the brief</span>' +
      '<div class="pj-inspo">' + list.map(function(x, i){
        return '<div class="pj-insp"><a href="' + esc(x.url || '#') + '" target="_blank" rel="noopener">' + (x.image ? '<img loading="lazy" src="' + esc(x.image) + '" alt="">' : '<span class="pj-noimg"></span>') + '</a>' +
          '<span class="pj-insp-t">' + esc(x.title || '') + '</span>' + (x.license ? '<span class="pj-dim">' + esc(licenceText(x.license)) + '</span>' : x.store ? '<span class="pj-dim">' + esc(x.store) + '</span>' : '') +
          (x.note ? '<span class="pj-dim">“' + esc(x.note) + '”</span>' : '') +
          '<button class="pj-x" data-pj="inspo-del" data-i="' + i + '" title="Remove">×</button></div>';
      }).join('') + '<button class="pj-insp pj-insp-add" data-pj="inspo-pick">+ Add from<br>Design research</button></div>' +
      (X.pick === p.id ? pickerHtml(p) : '') + '</div>';
  }
  function pickerHtml(p){
    const R = window.TTResearch && window.TTResearch._x;
    if(!R || !R.items) return '<div class="pj-pick"><p class="pj-dim">Open Design research once to load it.</p></div>';
    const q = String(X.pickQ || '').toLowerCase().trim(), have = ((p.data || {}).inspo || []).map(function(x){ return x.source + '|' + x.ext_id; });
    let pool = R.items.slice();
    (R.ideas || []).forEach(function(i){ (i.refs || []).forEach(function(r){ if(r.image) pool.unshift(Object.assign({ fromIdea: i.title }, r)); }); });
    if(q) pool = pool.filter(function(i){ return ((i.title || '') + ' ' + (i.tags || []).join(' ') + ' ' + (i.keyword || '') + ' ' + (i.store || '') + ' ' + (i.fromIdea || '')).toLowerCase().indexOf(q) !== -1; });
    else pool.sort(function(a, b){ return (b.fromIdea ? 1 : 0) - (a.fromIdea ? 1 : 0) || (+b.score || 0) - (+a.score || 0); });
    const seen = {};
    pool = pool.filter(function(i){ const k = i.source + '|' + i.ext_id; if(!i.image || seen[k] || have.indexOf(k) !== -1) return false; seen[k] = 1; return true; }).slice(0, 24);
    return '<div class="pj-pick"><div class="pj-add"><input id="pjPickQ" placeholder="Search designs, e.g. door, voronoi, ribbed" value="' + esc(X.pickQ || '') + '"><button class="pj-btn" data-pj="inspo-close">Done</button></div>' +
      (pool.length ? '<div class="pj-inspo">' + pool.map(function(i){
        return '<button class="pj-insp pj-insp-pick" data-pj="inspo-add" data-src="' + esc(i.source) + '" data-id="' + esc(i.ext_id) + '"><img loading="lazy" src="' + esc(i.image) + '" alt=""><span class="pj-insp-t">' + esc(i.title) + '</span><span class="pj-dim">' + esc(i.fromIdea ? 'Idea: ' + i.fromIdea : i.source === 'store' ? i.store : licenceText(i.license)) + '</span></button>';
      }).join('') + '</div>' : '<p class="pj-dim">No designs match.</p>') + '</div>';
  }
  function briefHtml(p){
    const sp = specOf(p), chk = briefCheck(p);
    return '<div class="pj-brief"><div class="pj-brief-h"><b>Brief</b><span class="pj-bar"><i style="width:' + chk.pct + '%;background:' + (chk.pct >= 80 ? 'var(--green)' : 'var(--amber)') + '"></i></span>' +
        '<span class="pj-dim">' + chk.pct + '% complete' + (chk.need.length ? ' · the designer still needs: ' + esc(chk.need.join(', ')) : ' · ready for the designer') + '</span></div>' +
      SPEC.map(function(g){ return '<div class="pj-brief-g"><b>' + esc(g.sec) + '</b><div class="pj-form">' + g.fields.map(function(f){ return specField(f, sp); }).join('') + '</div></div>'; }).join('') +
      '<div class="pj-brief-g"><b>Deliverables</b> <i class="pj-key">key</i><div class="pj-dels">' + DELIVERABLES.map(function(x){
        return '<label class="pj-chip"><input type="checkbox" data-pdel="' + x[0] + '"' + ((sp.deliverables || []).indexOf(x[0]) !== -1 ? ' checked' : '') + '> ' + esc(x[1]) + '</label>';
      }).join('') + '</div></div>' +
      '<label class="pj-wide' + (!String(sp.doneWhen || '').trim() ? ' pj-need' : '') + '"><span>Done when <i class="pj-key">key</i> — how you’ll judge it</span><textarea data-ps="doneWhen" rows="2" placeholder="e.g. Door swings open and shut 50 times without wear; NFC tag reads through the shell; fits in a 100 mm box">' + esc(sp.doneWhen || '') + '</textarea></label>' +
      '<label class="pj-wide">Notes, story and anything else<textarea data-pf="brief" rows="3">' + esc((p.data || {}).brief || '') + '</textarea></label>' +
      inspoHtml(p) + '</div>';
  }
  async function addInspo(pid, ref){
    const p = project(pid); if(!p) return false;
    const list = ((p.data || {}).inspo || []).slice();
    if(list.some(function(x){ return x.source === ref.source && x.ext_id === ref.ext_id; })) return true;
    list.push({ source: ref.source, ext_id: ref.ext_id, title: String(ref.title || '').slice(0, 200), image: ref.image || null, url: ref.url || null,
      license: ref.license || null, store: ref.store || null, note: ref.note || '', by: 'tt', at: new Date().toISOString() });
    p.data = Object.assign({}, p.data, { inspo: list.slice(-16) });
    return saveProject(p);
  }

  function progress(id){ const ts = items(id, 'task'); return { done: ts.filter(function(x){ return x.data.done; }).length, total: ts.length }; }
  async function saveProject(p){
    const r = await cloud.sb.from('projects').upsert({ id: p.id, designer_id: p.designer_id || null, client_id: p.client_id || null, data: p.data, created_by: p.created_by || 'tt' }, { onConflict: 'id' });
    if(r.error){ showNoticeModal('Couldn’t save: ' + r.error.message); return false; }
    return true;
  }
  async function addItem(pid, kind, data){
    const row = { project_id: pid, id: uid(), kind: kind, author: 'tt', data: Object.assign({ at: new Date().toISOString() }, data) };
    const r = await cloud.sb.from('project_items').insert(row);
    if(r.error){ showNoticeModal('Couldn’t save: ' + r.error.message); return null; }
    (X.items[pid] = X.items[pid] || []).push(row);
    return row;
  }
  async function updateItem(row, patch){
    const data = Object.assign({}, row.data, patch);
    const r = await cloud.sb.from('project_items').update({ data: data }).eq('project_id', row.project_id).eq('id', row.id);
    if(r.error){ showNoticeModal('Couldn’t save: ' + r.error.message); return false; }
    row.data = data; return true;
  }

  // Partners ticked as designers get a Designer profile in their Partner app.
  function isDesigner(pid){ return !!(state.projectDesigners || {})[pid]; }
  const origBuild = ponBuildPack;
  ponBuildPack = function(pid){
    const pack = origBuild(pid);
    try{ if(pack && isDesigner(pid)) pack.designer = true; }catch(e){}
    return pack;
  };
  if(typeof cloudPullReports === 'function'){
    const origPull = cloudPullReports;
    cloudPullReports = async function(){
      const r = await origPull.apply(this, arguments);
      try{ await load(); refresh(); badge(); }catch(e){}
      return r;
    };
  }

  // ---------- view ----------
  function isImg(d){ return typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(d); }
  function isUrl(u){ return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u); }
  function requests(){ return X.projects.filter(function(p){ return stageOf(p) === 'request'; }); }
  // Projects tab button shows how many brand-partner requests are waiting.
  function badge(){
    const b = document.querySelector('.tab-btn[data-tab="projects"]'), n = requests().length;
    if(b) b.innerHTML = 'Projects' + (n ? ' <span class="pon-badge">' + n + '</span>' : '');
  }
  function refsHtml(p){
    const imgs = items(p.id, 'image').filter(function(x){ return isImg(x.data && x.data.img); }), refs = ((p.data || {}).refs || []).filter(isUrl);
    if(!imgs.length && !refs.length) return '';
    return '<div class="pj-sec"><b>References</b><div class="pj-refs">' + imgs.map(function(x){ return '<a href="#" data-pj="zoom" data-id="' + esc(x.id) + '"><img src="' + x.data.img + '" alt=""></a>'; }).join('') + '</div>' +
      refs.map(function(u){ return '<div><a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u.replace(/^https?:\/\//, '').slice(0, 60)) + ' ↗</a></div>'; }).join('') + '</div>';
  }
  function bar(pr){ return pr.total ? '<span class="pj-bar"><i style="width:' + Math.round(100 * pr.done / pr.total) + '%"></i></span><span class="pj-dim">' + pr.done + ' of ' + pr.total + ' steps</span>' : ''; }
  function card(p){
    const d = p.data || {}, pr = progress(p.id), next = items(p.id, 'task').find(function(x){ return !x.data.done; });
    const late = d.due && d.due < today() && stageOf(p) !== 'live';
    const nImg = items(p.id, 'image').length;
    if(stageOf(p) === 'request') return '<button class="pj-card pj-req' + (X.sel === p.id ? ' on' : '') + '" data-pj="open" data-id="' + esc(p.id) + '"><b>' + esc(d.title || 'Untitled') + '</b>' +
      '<span class="pj-dim">From ' + esc(clientName(p.client_id) || d.clientName || 'a brand partner') + ' · ' + fmt((d.createdAt || '').slice(0, 10)) + '</span>' +
      '<span class="pj-tags">' + (d.qty ? '<i>' + d.qty + ' pcs</i>' : '') + (nImg ? '<i>📷 ' + nImg + '</i>' : '') + (d.due ? '<i>by ' + fmt(d.due) + '</i>' : '') + '</span></button>';
    return '<button class="pj-card' + (X.sel === p.id ? ' on' : '') + '" data-pj="open" data-id="' + esc(p.id) + '"><b>' + esc(d.title || 'Untitled') + '</b>' +
      '<span class="pj-dim">' + esc([p.designer_id ? partnerName(p.designer_id) : '', clientName(p.client_id)].filter(Boolean).join(' · ') || 'No designer yet') + '</span>' +
      bar(pr) + (next ? '<span class="pj-dim">Next: ' + esc(next.data.title) + (next.data.due ? ' · ' + fmt(next.data.due) : '') + '</span>' : '') +
      ((d.due || needsPlan(p)) ? '<span class="pj-tags">' + (d.due ? '<i' + (late ? ' class="warn"' : '') + '>due ' + fmt(d.due) + '</i>' : '') + (needsPlan(p) ? '<i class="warn">waiting for designer’s plan</i>' : '') + '</span>' : '') + '</button>';
  }
  function board(){
    const cols = STAGES.concat(X.showOther ? OTHER : []);
    const nOther = X.projects.filter(function(p){ return ['on_hold', 'cancelled'].indexOf(stageOf(p)) !== -1; }).length;
    return '<div class="pj-board">' + cols.map(function(s){
      const ps = X.projects.filter(function(p){ return stageOf(p) === s[0]; });
      return '<div class="pj-col"><div class="pj-col-h">' + s[1] + ' <span>' + ps.length + '</span></div>' + ps.map(card).join('') + '</div>';
    }).join('') + '</div>' + (nOther ? '<button class="pj-btn" data-pj="toggle-other">' + (X.showOther ? 'Hide' : 'Show') + ' on hold / cancelled (' + nOther + ')</button>' : '');
  }
  function opts(list, sel, blank){ return (blank ? '<option value="">' + blank + '</option>' : '') + list.map(function(x){ return '<option value="' + esc(x[0]) + '"' + (x[0] === sel ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join(''); }
  function detail(p){
    ensurePon();
    const d = p.data || {};
    const partners = state.pon.partners.filter(function(x){ return isDesigner(x.id) || x.id === p.designer_id; }).map(function(x){ return [x.id, x.name || 'Partner'] ; });
    const clients = (state.clients || []).filter(function(c){ return c.buyerApp; }).map(function(c){ return [c.id, c.name || 'Client']; });
    let h = '<div class="panel pj-detail"><div class="panel-title" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>' + esc(d.title || 'Untitled') + '</span><span>' + (p.designer_id && window.TTNotify ? '<button class="pj-btn" data-pj="notify-designer">🔔 Notify designer</button>' : '') + '<button class="pj-btn" data-pj="delete">Delete</button><button class="pj-btn" data-pj="close">Close</button></span></div>' +
      '<div class="pj-form">' +
        '<label>Title<input data-pf="title" value="' + esc(d.title || '') + '"></label>' +
        '<label>Stage<select data-pf="stage">' + opts(STAGES.concat(OTHER), stageOf(p)) + '</select></label>' +
        '<label>Designer<select data-pf="designer_id">' + opts(partners, p.designer_id, '— none —') + '</select></label>' +
        '<label>Client (brand partner)<select data-pf="client_id">' + opts(clients, p.client_id, '— our own product —') + '</select></label>' +
        '<label>Due<input type="date" data-pf="due" value="' + esc(d.due || '') + '"></label>' +
        '<label>Quantity<input type="number" min="0" data-pf="qty" value="' + esc(d.qty || '') + '"></label>' +
        '<label>Target price / pc ₹<input type="number" min="0" data-pf="targetPrice" value="' + esc(d.targetPrice || '') + '"></label>' +
      '</div>' + briefHtml(p) + refsHtml(p);
    if(stageOf(p) === 'request'){
      h = h.replace('<div class="pj-form">', '<div class="pj-banner">Request from <b>' + esc(clientName(p.client_id) || d.clientName || 'a brand partner') + '</b>. Accept it to start the design (pick a designer), or decline with a reason.' +
        '<div><button class="pj-btn primary" data-pj="accept">Accept → Brief</button><button class="pj-btn" data-pj="decline">Decline</button></div></div><div class="pj-form">');
    }

    h += '<div class="pj-sec"><b>Steps</b> ' + bar(progress(p.id)) +
      (p.designer_id && !isDesigner(p.designer_id) ? '<div class="pj-dim pj-warn">' + esc(partnerName(p.designer_id)) + ' isn’t ticked as a designer above, so they can’t see this project.</div>' :
       !p.designer_id ? '<div class="pj-dim pj-warn">' + (Object.keys(state.projectDesigners || {}).length ? 'Pick a designer' : 'Tick a partner as a designer above, then pick them here') + ' — they add their own steps and dates in the Partner app.</div>' : needsPlan(p) ? '<div class="pj-dim pj-warn">Waiting for ' + esc(partnerName(p.designer_id)) + ' to add their steps and dates.</div>' : '') +
      items(p.id, 'task').map(function(x){
      const late = !x.data.done && x.data.due && x.data.due < today();
      return '<div class="pj-row"><input type="checkbox" data-pj="task-done" data-id="' + esc(x.id) + '"' + (x.data.done ? ' checked' : '') + '><span' + (x.data.done ? ' class="pj-done"' : '') + '>' + esc(x.data.title) + '</span>' +
        '<span class="pj-dim' + (late ? ' pj-warn' : '') + '">' + (x.data.owner === 'tt' ? 'Thread Tribe' : 'Designer') + (x.data.due ? ' · ' + fmt(x.data.due) : '') + '</span></div>';
    }).join('') + '<div class="pj-add"><input id="pjTask" placeholder="New step, e.g. First CAD draft"><select id="pjTaskOwner"><option value="designer">Designer</option><option value="tt">Thread Tribe</option></select><input type="date" id="pjTaskDue"><button class="pj-btn" data-pj="task-add">Add</button></div></div>';

    h += '<div class="pj-sec"><b>Updates</b>' + items(p.id, 'comment').map(function(x){
      return '<div class="pj-msg ' + x.author + '"><b>' + (x.author === 'tt' ? 'Thread Tribe' : x.author === 'designer' ? partnerName(p.designer_id) : clientName(p.client_id) || 'Client') + '</b> <span class="pj-dim">' + when(x.data.at) + (x.data.internal ? ' · internal' : '') + '</span><div>' + esc(x.data.text || '') + '</div></div>';
    }).join('') + '<div class="pj-add"><input id="pjComment" placeholder="Post an update…">' + (p.client_id ? '<label class="pj-chip pj-dim"><input type="checkbox" id="pjInternal"> hide from client</label>' : '') + '<button class="pj-btn primary" data-pj="comment">Post</button></div></div>';
    return h + '</div>';
  }
  function designersRow(){
    ensurePon();
    const d = state.projectDesigners || {};
    return '<div class="pj-dim" style="margin-bottom:8px">Designers (get a Designer profile in their Partner app): ' + state.pon.partners.map(function(x){
      return '<label class="pj-chip"><input type="checkbox" data-pj-designer="' + esc(x.id) + '"' + (d[x.id] ? ' checked' : '') + '> ' + esc(x.name || 'Partner') + '</label>';
    }).join(' ') + '</div>';
  }
  function render(){
    const root = document.getElementById('projectsRoot'); if(!root) return;
    if(!on()){ root.innerHTML = '<div class="panel"><p class="pj-dim">Sign in to Cloud sync to use Projects.</p></div>'; return; }
    if(X.missing){ root.innerHTML = '<div class="panel"><p class="pj-dim">Run <code>projects_setup.sql</code> in Supabase → SQL Editor to switch on Projects, then reload.</p></div>'; return; }
    const sel = X.sel && project(X.sel);
    root.innerHTML = '<div class="panel"><div class="panel-title" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>Custom projects</span><button class="pj-btn primary" data-pj="new">+ New project</button></div>' +
      designersRow() + (X.loaded ? (X.projects.length ? board() : '<p class="pj-dim">No projects yet.</p>') : '<p class="pj-dim">Loading…</p>') + '</div>' + (sel ? detail(sel) : '');
  }
  function refresh(){
    const t2 = document.getElementById('tabProjects');
    if(t2 && t2.style.display !== 'none' && !(document.activeElement && t2.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render();
  }
  window.renderProjects = function(){ render(); load().then(function(){ render(); badge(); }); };

  document.addEventListener('input', function(e){
    if(e.target.id !== 'pjPickQ') return;
    X.pickQ = e.target.value;
    const p = X.sel && project(X.sel), box = document.querySelector('#tabProjects .pj-pick');
    if(!p || !box) return;
    const tmp = document.createElement('div'); tmp.innerHTML = pickerHtml(p);
    const grid = box.querySelector('.pj-inspo, p.pj-dim'), next = tmp.querySelector('.pj-inspo, p.pj-dim');
    if(grid && next) grid.replaceWith(next); else if(next) box.appendChild(next);
  });

  // For Design research: add a design to a project's brief from there.
  window.TTProjects = {
    open: function(){ return X.projects.filter(function(p){ return ['live', 'cancelled'].indexOf(stageOf(p)) === -1; }).map(function(p){ return { id: p.id, title: (p.data || {}).title || 'Untitled', designer: p.designer_id ? partnerName(p.designer_id) : '' }; }); },
    load: function(){ return X.loaded ? Promise.resolve() : load(); },
    addInspo: addInspo
  };

  // ---------- actions ----------
  document.addEventListener('click', async function(e){
    const tab = document.getElementById('tabProjects'); if(!tab || !tab.contains(e.target)) return;
    const b = e.target.closest('[data-pj]'); if(!b) return;
    const act = b.getAttribute('data-pj'), id = b.getAttribute('data-id'), p = X.sel && project(X.sel);
    if(act === 'open'){ X.sel = id; render(); const dEl = tab.querySelector('.pj-detail'); if(dEl) dEl.scrollIntoView({ behavior: 'smooth' }); return; }
    if(act === 'close'){ X.sel = null; render(); return; }
    if(act === 'toggle-other'){ X.showOther = !X.showOther; render(); return; }
    if(act === 'notify-designer' && p){
      ensurePon();
      const des = state.pon.partners.find(function(x){ return x.id === p.designer_id; }), d = p.data || {}, chk = briefCheck(p);
      if(!des || !/@/.test(des.email || '')){ showToast('Add an email for ' + partnerName(p.designer_id) + ' in Partner Network first'); return; }
      window.TTNotify.compose({ to: [{ email: des.email, app: 'partner' }],
        title: (chk.pct >= 80 ? 'Brief ready: ' : 'Update: ') + (d.title || 'your project'),
        body: chk.pct >= 80 ? 'The brief is complete in your Designer profile' + ((d.inspo || []).length ? ', with ' + d.inspo.length + ' inspiration picture' + (d.inspo.length === 1 ? '' : 's') : '') + '. Please add your steps and dates' + (d.due ? ' (due ' + fmt(d.due) + ')' : '') + '.' : 'There’s an update on this project in your Designer profile.' });
      return;
    }
    if(act === 'inspo-pick' && p){
      X.pick = p.id; X.pickQ = '';
      if(window.TTResearch && !(window.TTResearch._x.items || []).length) await window.TTResearch.load();
      render(); const q = document.getElementById('pjPickQ'); if(q) q.focus(); return;
    }
    if(act === 'inspo-close'){ X.pick = null; render(); return; }
    if(act === 'inspo-add' && p){
      const R = window.TTResearch && window.TTResearch._x, src = b.getAttribute('data-src'), ext = b.getAttribute('data-id');
      let ref = R && (R.items || []).find(function(i){ return i.source === src && i.ext_id === ext; });
      if(!ref && R) (R.ideas || []).forEach(function(i){ (i.refs || []).forEach(function(r){ if(r.source === src && r.ext_id === ext) ref = r; }); });
      if(ref && await addInspo(p.id, ref)){ showToast('Added to the brief'); render(); const q = document.getElementById('pjPickQ'); if(q){ q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
      return;
    }
    if(act === 'inspo-del' && p){
      const i = +b.getAttribute('data-i'), list = ((p.data || {}).inspo || []).filter(function(_, j){ return j !== i; });
      p.data = Object.assign({}, p.data, { inspo: list });
      if(await saveProject(p)){ showToast('Removed'); render(); }
      return;
    }
    if(act === 'new'){
      const title = prompt('Project name'); if(!title) return;
      const np = { id: 'pj' + uid(), designer_id: null, client_id: null, created_by: 'tt', data: { title: title.slice(0, 120), stage: 'brief', createdAt: new Date().toISOString() } };
      if(await saveProject(np)){
        X.projects.unshift(np); X.sel = np.id;
        for(const st of TT_STEPS){
          const due = st[1] == null ? '' : (function(){ const d = new Date(); d.setDate(d.getDate() + st[1]); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
          await addItem(np.id, 'task', { title: st[0], owner: 'tt', due: due, done: false });
        }
        render(); showToast('Pick the designer — they’ll add their steps in the Partner app');
      }
      return;
    }
    if(!p) return;
    if(act === 'zoom'){
      e.preventDefault();
      const im = items(p.id, 'image').find(function(x){ return x.id === id; });
      if(im && isImg(im.data.img)){ const w = window.open(''); if(w){ w.document.title = 'Reference'; const img = w.document.createElement('img'); img.src = im.data.img; img.style.maxWidth = '100%'; w.document.body.style.margin = '0'; w.document.body.style.background = '#111'; w.document.body.appendChild(img); } }
      return;
    }
    if(act === 'accept'){
      p.data = Object.assign({}, p.data, { stage: 'brief', acceptedAt: new Date().toISOString() });
      if(await saveProject(p)){
        await addItem(p.id, 'comment', { text: 'Thanks! We’ve accepted your request and our design team is starting on it. You can follow progress here.', internal: false });
        for(const st of TT_STEPS){ await addItem(p.id, 'task', { title: st[0], owner: 'tt', due: '', done: false }); }
        render(); badge(); showToast('Accepted — now pick a designer');
      }
      return;
    }
    if(act === 'decline'){
      const why = prompt('Reason for declining (the brand partner sees this):', 'Sorry, we can’t take this one on right now.'); if(why === null) return;
      p.data = Object.assign({}, p.data, { stage: 'cancelled', declinedAt: new Date().toISOString() });
      if(await saveProject(p)){
        if(why.trim()) await addItem(p.id, 'comment', { text: why.trim().slice(0, 2000), internal: false });
        X.sel = null; render(); badge(); showToast('Request declined');
      }
      return;
    }
    if(act === 'delete'){
      if(!confirm('Delete “' + ((p.data || {}).title || 'this project') + '” and all its steps and updates?')) return;
      const r = await cloud.sb.from('projects').delete().eq('id', p.id);
      if(r.error){ showNoticeModal('Couldn’t delete: ' + r.error.message); return; }
      X.projects = X.projects.filter(function(x){ return x.id !== p.id; }); X.sel = null; render(); showToast('Project deleted');
    } else if(act === 'task-add'){
      const title = (document.getElementById('pjTask').value || '').trim(); if(!title) return;
      await addItem(p.id, 'task', { title: title.slice(0, 200), owner: document.getElementById('pjTaskOwner').value, due: document.getElementById('pjTaskDue').value, done: false }); render();
    } else if(act === 'task-done'){
      const row = items(p.id, 'task').find(function(x){ return x.id === id; });
      if(row) await updateItem(row, { done: b.checked });
      render();
    } else if(act === 'comment'){
      const txt = (document.getElementById('pjComment').value || '').trim(); if(!txt) return;
      const internal = !!(document.getElementById('pjInternal') && document.getElementById('pjInternal').checked);
      await addItem(p.id, 'comment', { text: txt.slice(0, 2000), internal: internal }); render();
    }
  });
  // Partner Network cards carry the same switch as the Designers row here.
  document.addEventListener('change', function(e){
    const id = e.target.getAttribute && e.target.getAttribute('data-pon-designer'); if(!id) return;
    if(!state.projectDesigners) state.projectDesigners = {};
    if(e.target.checked) state.projectDesigners[id] = true; else delete state.projectDesigners[id];
    scheduleSave(); if(typeof cloudPublishPacks === 'function') cloudPublishPacks();
    showToast(e.target.checked ? 'Designer profile switched on in their Partner app' : 'Designer profile removed');
  });
  document.addEventListener('change', async function(e){
    const tab = document.getElementById('tabProjects'); if(!tab || !tab.contains(e.target)) return;
    const dz = e.target.getAttribute('data-pj-designer');
    if(dz){
      if(!state.projectDesigners) state.projectDesigners = {};
      if(e.target.checked) state.projectDesigners[dz] = true; else delete state.projectDesigners[dz];
      scheduleSave(); if(typeof cloudPublishPacks === 'function') cloudPublishPacks();
      render(); showToast(e.target.checked ? 'Designer profile switched on in their Partner app' : 'Designer profile removed'); return;
    }
    const p = X.sel && project(X.sel); if(!p) return;
    const sk = e.target.getAttribute('data-ps'), dk = e.target.getAttribute('data-pdel');
    if(sk || dk){
      const sp = specOf(p);
      if(sk) sp[sk] = sk === 'printTime' ? (e.target.value === '' ? '' : Math.max(0, +e.target.value || 0)) : String(e.target.value).slice(0, sk === 'doneWhen' ? 1500 : 300);
      else { const l = (sp.deliverables || []).filter(function(x){ return x !== dk; }); if(e.target.checked) l.push(dk); sp.deliverables = l; }
      p.data = Object.assign({}, p.data, { spec: sp });
      if(await saveProject(p)){ showToast('Saved'); const h = document.querySelector('#tabProjects .pj-brief-h'); if(h){ const c = briefCheck(p); h.outerHTML = '<div class="pj-brief-h"><b>Brief</b><span class="pj-bar"><i style="width:' + c.pct + '%;background:' + (c.pct >= 80 ? 'var(--green)' : 'var(--amber)') + '"></i></span><span class="pj-dim">' + c.pct + '% complete' + (c.need.length ? ' · the designer still needs: ' + esc(c.need.join(', ')) : ' · ready for the designer') + '</span></div>'; } }
      return;
    }
    const f = e.target.getAttribute('data-pf'); if(!f) return;
    const v = e.target.value;
    if(f === 'designer_id') p.designer_id = v || null;
    else if(f === 'client_id'){ p.client_id = v || null; p.data = Object.assign({}, p.data, { clientName: clientName(v) || '' }); }
    else if(f === 'qty' || f === 'targetPrice') p.data = Object.assign({}, p.data, { [f]: Math.max(0, +v || 0) });
    else p.data = Object.assign({}, p.data, { [f]: String(v).slice(0, f === 'brief' ? 4000 : 200) });
    if(await saveProject(p)){ showToast('Saved'); if(f === 'stage' || f === 'title') render(); }
  });

  const css = document.createElement('style');
  css.textContent =
    '#tabProjects .pj-dim{color:var(--dim);font-size:12px} #tabProjects .pj-chip{display:inline-flex;flex-direction:row;align-items:center;gap:4px;margin-right:10px;color:var(--text)}' +
    '#tabProjects .pj-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 11px;font:12px "JetBrains Mono",monospace;cursor:pointer;margin:2px 4px 2px 0}' +
    '#tabProjects .pj-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#0d1117;font-weight:600}' +
    '#tabProjects .pj-board{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px}' +
    '#tabProjects .pj-col{flex:1 0 190px;background:var(--input-bg);border-radius:10px;padding:8px;min-height:120px}' +
    '#tabProjects .pj-col-h{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin-bottom:6px} #tabProjects .pj-col-h span{float:right}' +
    '#tabProjects .pj-card{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:6px;cursor:pointer;color:var(--text);font:12.5px inherit}' +
    '#tabProjects .pj-card.on{border-color:var(--cyan)}' +
    '#tabProjects .pj-bar{display:block;height:5px;background:var(--line);border-radius:4px;overflow:hidden;margin-top:2px} #tabProjects .pj-bar i{display:block;height:100%;background:var(--green)}' +
    '#tabProjects .pj-sec .pj-bar{display:inline-block;width:120px;vertical-align:middle;margin:0 6px}' +
    '#tabProjects .pj-tags{display:flex;gap:4px;flex-wrap:wrap} #tabProjects .pj-tags i{font-style:normal;font-size:10.5px;border:1px solid var(--line);border-radius:999px;padding:0 6px;color:var(--dim)}' +
    '#tabProjects .pj-tags i.warn{color:var(--amber);border-color:var(--amber)}' +
    '#tabProjects .pj-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:8px 0}' +
    '#tabProjects label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dim)} #tabProjects .pj-wide{margin:6px 0}' +
    '#tabProjects input,#tabProjects select,#tabProjects textarea{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:12.5px inherit}' +
    '#tabProjects .pj-sec{border-top:1px dashed var(--line);margin-top:12px;padding-top:10px}' +
    '#tabProjects .pj-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0;font-size:13px} #tabProjects .pj-done{text-decoration:line-through;color:var(--dim)}' +
    '#tabProjects .pj-add{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px} #tabProjects .pj-add input:not([type=checkbox]){flex:1;min-width:140px}' +
    '#tabProjects .pj-warn{color:var(--amber)}' +
    '#tabProjects .pj-card.pj-req{border-color:var(--amber)} #tabProjects .pj-banner{background:var(--input-bg);border:1px solid var(--amber);border-radius:8px;padding:10px;margin:8px 0;font-size:13px}' +
    '#tabProjects .pj-refs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0} #tabProjects .pj-refs img{width:110px;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}' +
    '#tabProjects .pj-msg{border-left:3px solid var(--line);padding:4px 10px;margin:6px 0;font-size:13px} #tabProjects .pj-msg.designer{border-color:var(--cyan)} #tabProjects .pj-msg.client{border-color:var(--amber)}';
  css.textContent +=
    '#tabProjects .pj-brief{border-top:1px dashed var(--line);margin-top:12px;padding-top:10px}' +
    '#tabProjects .pj-brief-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}#tabProjects .pj-brief-h b{font-size:15px}#tabProjects .pj-brief-h .pj-bar{display:inline-block;width:140px}' +
    '#tabProjects .pj-brief-g{margin:10px 0 4px}#tabProjects .pj-brief-g > b{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim)}' +
    '#tabProjects .pj-span2{grid-column:span 2}@media (max-width:600px){#tabProjects .pj-span2{grid-column:auto}}' +
    '#tabProjects .pj-key{font-style:normal;font-size:9.5px;border:1px solid var(--line);border-radius:999px;padding:0 5px;color:var(--dim);margin-left:2px}' +
    '#tabProjects label.pj-need input,#tabProjects label.pj-need select,#tabProjects label.pj-need textarea{border-color:var(--amber)}' +
    '#tabProjects .pj-dels{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px}#tabProjects .pj-dels label{flex-direction:row;align-items:center;color:var(--text);font-size:12.5px}' +
    '#tabProjects .pj-inspo{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:8px}' +
    '#tabProjects .pj-insp{position:relative;display:flex;flex-direction:column;gap:2px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--panel);text-align:left;font:inherit;color:var(--text);min-width:0}' +
    '#tabProjects .pj-insp img,#tabProjects .pj-noimg{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:var(--input-bg);display:block}' +
    '#tabProjects .pj-insp-t{font-size:11.5px;font-weight:600;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
    '#tabProjects .pj-insp-add{align-items:center;justify-content:center;text-align:center;border-style:dashed;color:var(--cyan);cursor:pointer;min-height:110px;font-size:12px}' +
    '#tabProjects .pj-insp-pick{cursor:pointer}#tabProjects .pj-insp-pick:hover{border-color:var(--cyan)}' +
    '#tabProjects .pj-x{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;line-height:22px;padding:0}' +
    '#tabProjects .pj-pick{border:1px solid var(--line);border-radius:10px;padding:10px;margin-top:10px;background:var(--input-bg)}';
  document.head.appendChild(css);
})();
