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

  const STAGES = [['brief', 'Brief'], ['design', 'Design'], ['prototype', 'Prototype'], ['approval', 'Approval'], ['live', 'Live']];
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
    const it = await cloud.sb.from('project_items').select('project_id,id,kind,author,data,deleted,updated_at').in('kind', ['task', 'comment']).eq('deleted', false).limit(20000);
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
  function soon(){ clearTimeout(t); t = setTimeout(function(){ load().then(refresh); }, 400); }
  function project(id){ return X.projects.find(function(p){ return p.id === id; }); }
  // Steps run in date order (undated last); updates in the order they were posted.
  function byDue(a, b){ return (a.data.due || '9999').localeCompare(b.data.due || '9999') || (a.data.at || '').localeCompare(b.data.at || ''); }
  function items(id, kind){ const l = (X.items[id] || []).filter(function(x){ return !kind || x.kind === kind; }); return kind === 'task' ? l.slice().sort(byDue) : l; }
  // The designer fills in their own steps once Thread Tribe has started the project.
  function needsPlan(p){ return !!p.designer_id && ['live', 'cancelled', 'on_hold'].indexOf(stageOf(p)) === -1 && !items(p.id, 'task').some(function(x){ return x.data.owner !== 'tt'; }); }
  // Thread Tribe's own steps on every new project.
  const TT_STEPS = [['Share brief and references', 1], ['Review prototype', null], ['Final approval', null]];
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
      try{ await load(); refresh(); }catch(e){}
      return r;
    };
  }

  // ---------- view ----------
  function bar(pr){ return pr.total ? '<span class="pj-bar"><i style="width:' + Math.round(100 * pr.done / pr.total) + '%"></i></span><span class="pj-dim">' + pr.done + ' of ' + pr.total + ' steps</span>' : ''; }
  function card(p){
    const d = p.data || {}, pr = progress(p.id), next = items(p.id, 'task').find(function(x){ return !x.data.done; });
    const late = d.due && d.due < today() && stageOf(p) !== 'live';
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
    let h = '<div class="panel pj-detail"><div class="panel-title" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>' + esc(d.title || 'Untitled') + '</span><span><button class="pj-btn" data-pj="delete">Delete</button><button class="pj-btn" data-pj="close">Close</button></span></div>' +
      '<div class="pj-form">' +
        '<label>Title<input data-pf="title" value="' + esc(d.title || '') + '"></label>' +
        '<label>Stage<select data-pf="stage">' + opts(STAGES.concat(OTHER), stageOf(p)) + '</select></label>' +
        '<label>Designer<select data-pf="designer_id">' + opts(partners, p.designer_id, '— none —') + '</select></label>' +
        '<label>Client (brand partner)<select data-pf="client_id">' + opts(clients, p.client_id, '— our own product —') + '</select></label>' +
        '<label>Due<input type="date" data-pf="due" value="' + esc(d.due || '') + '"></label>' +
      '</div><label class="pj-wide">Brief<textarea data-pf="brief" rows="3">' + esc(d.brief || '') + '</textarea></label>';

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
  window.renderProjects = function(){ render(); load().then(render); };

  // ---------- actions ----------
  document.addEventListener('click', async function(e){
    const tab = document.getElementById('tabProjects'); if(!tab || !tab.contains(e.target)) return;
    const b = e.target.closest('[data-pj]'); if(!b) return;
    const act = b.getAttribute('data-pj'), id = b.getAttribute('data-id'), p = X.sel && project(X.sel);
    if(act === 'open'){ X.sel = id; render(); const dEl = tab.querySelector('.pj-detail'); if(dEl) dEl.scrollIntoView({ behavior: 'smooth' }); return; }
    if(act === 'close'){ X.sel = null; render(); return; }
    if(act === 'toggle-other'){ X.showOther = !X.showOther; render(); return; }
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
    const f = e.target.getAttribute('data-pf'); if(!f) return;
    const v = e.target.value;
    if(f === 'designer_id') p.designer_id = v || null;
    else if(f === 'client_id'){ p.client_id = v || null; p.data = Object.assign({}, p.data, { clientName: clientName(v) || '' }); }
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
    '#tabProjects .pj-msg{border-left:3px solid var(--line);padding:4px 10px;margin:6px 0;font-size:13px} #tabProjects .pj-msg.designer{border-color:var(--cyan)} #tabProjects .pj-msg.client{border-color:var(--amber)}';
  document.head.appendChild(css);
})();
