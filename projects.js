// ===================================================================
// ========================= PROJECTS (Studio) =======================
// ===================================================================
// Custom design projects with a designer partner, from idea to live product:
//   pitch → brief → concept → CAD → prototype → approval → production-ready → live
// Shared with the designer (Partner app) and, for client projects, the brand partner
// (Buyer app) through the projects / project_items tables (projects_setup.sql).
//
// Money stays here, never in the shared tables: the designer can edit the project row,
// so hourly rate, royalty, approved hours and payouts live in state.projectTerms and
// in TT-authored approval items. Studio writes a read-only earnings summary onto the
// project for the designer to see.
(function(){
  if(window.TT_STOCK_MODE) return;

  const STAGES = [['pitch', 'Pitch'], ['brief', 'Brief'], ['concept', 'Concept'], ['cad', 'CAD'], ['prototype', 'Prototype'], ['approval', 'Approval'], ['production', 'Production-ready'], ['live', 'Live']];
  const OTHER = [['on_hold', 'On hold'], ['cancelled', 'Cancelled']];
  const REQ = { filament: 'Filament / material', parts: 'Hardware parts', printer: 'Printer time', client: 'Client clarification', budget: 'Budget', other: 'Other' };
  const X = { projects: [], items: {}, missing: false, loaded: false, sel: null, chan: null, showOther: false };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function today(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmt(s){ if(!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function when(s){ const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function stageName(k){ const s = STAGES.concat(OTHER).find(function(x){ return x[0] === k; }); return s ? s[1] : k; }
  function partnerName(id){ ensurePon(); const p = state.pon.partners.find(function(x){ return x.id === id; }); return p ? (p.name || 'Partner') : '—'; }
  function clientName(id){ const c = (state.clients || []).find(function(x){ return x.id === id; }); return c ? (c.name || 'Client') : ''; }
  function isImg(d){ return typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(d) && d.length < 200000; }
  function isUrl(u){ return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u); }

  // ---------- data ----------
  async function load(){
    if(!on()) return;
    const r = await cloud.sb.from('projects').select('id,designer_id,client_id,data,created_by,updated_at').order('updated_at', { ascending: false });
    if(r.error){ X.missing = /projects|does not exist|schema cache|relation/i.test(r.error.message || ''); X.loaded = true; return; }
    const it = await cloud.sb.from('project_items').select('project_id,id,kind,author,data,deleted,updated_at').eq('deleted', false).limit(20000);
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
    syncEarnings();
  }
  let t = null;
  function soon(){ clearTimeout(t); t = setTimeout(function(){ load().then(refresh); }, 400); }
  function project(id){ return X.projects.find(function(p){ return p.id === id; }); }
  function items(id, kind){ return (X.items[id] || []).filter(function(x){ return !kind || x.kind === kind; }); }
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

  // ---------- money (Studio-only) ----------
  function terms(pid){ if(!state.projectTerms) state.projectTerms = {}; return state.projectTerms[pid] = Object.assign({ hourlyRate: 0, royaltyType: 'piece', royaltyValue: 0, catalogId: '', liveDate: '' }, state.projectTerms[pid] || {}); }
  // Approved hours are TT-authored approval items pointing at a designer's hours item.
  function verdicts(pid){
    const v = {};
    items(pid, 'approval').filter(function(a){ return a.author === 'tt'; }).forEach(function(a){ if(a.data && a.data.target) v[a.data.target] = a.data; });
    return v;
  }
  function earnings(p){
    const tm = terms(p.id), v = verdicts(p.id);
    const hours = items(p.id, 'hours').reduce(function(acc, h){
      const st = v[h.id] ? v[h.id].decision : 'pending', n = +(h.data && h.data.hours) || 0;
      acc[st] = (acc[st] || 0) + n; return acc;
    }, {});
    let pieces = 0, sales = 0;
    if(tm.catalogId){
      const item = (state.productCatalog || []).find(function(i){ return i.id === tm.catalogId; });
      const name = item ? (item.name || '').trim().toLowerCase() : '';
      state.orders.forEach(function(o){
        if(['quoted', 'lost', 'cancelled'].indexOf(o.status) !== -1) return;
        if(tm.liveDate && (o.orderedDate || '') < tm.liveDate) return;
        o.products.forEach(function(l){
          if(l.catalogId === tm.catalogId || (name && (l.name || '').trim().toLowerCase() === name)){ pieces += +l.qty || 0; sales += (+l.qty || 0) * (+l.actualPrice || 0); }
        });
      });
    }
    const royalty = tm.royaltyType === 'percent' ? sales * (+tm.royaltyValue || 0) / 100 : pieces * (+tm.royaltyValue || 0);
    const hourly = (hours.approved || 0) * (+tm.hourlyRate || 0);
    ensurePon();
    const paid = state.pon.payouts.filter(function(x){ return x.projectId === p.id; }).reduce(function(t2, x){ return t2 + (+x.amount || 0); }, 0);
    return { hoursApproved: hours.approved || 0, hoursPending: hours.pending || 0, hourly: Math.round(hourly), pieces: pieces, royalty: Math.round(royalty), total: Math.round(hourly + royalty), paid: Math.round(paid), due: Math.max(0, Math.round(hourly + royalty - paid)) };
  }
  // Read-only copy for the designer's app.
  async function syncEarnings(){
    for(const p of X.projects){
      const e = earnings(p), tm = terms(p.id);
      const view = { hoursApproved: e.hoursApproved, hourlyRate: +tm.hourlyRate || 0, pieces: e.pieces, royalty: e.royalty, royaltyTerms: tm.royaltyType === 'percent' ? tm.royaltyValue + '% of sales' : '₹' + (+tm.royaltyValue || 0) + ' per piece', total: e.total, paid: e.paid, due: e.due };
      if(JSON.stringify((p.data || {}).earnings || {}) !== JSON.stringify(view)){
        p.data = Object.assign({}, p.data, { earnings: view });
        await cloud.sb.from('projects').update({ data: p.data }).eq('id', p.id);
      }
    }
  }
  // Prototype filament counts as used filament on the designer's balance.
  function protoGrams(pid, color){
    let g = 0;
    X.projects.forEach(function(p){
      if(p.designer_id !== pid) return;
      items(p.id, 'proto').forEach(function(x){ if(!color || colorKey(x.data.color || '') === colorKey(color)) g += +x.data.grams || 0; });
    });
    return g;
  }
  const origBalances = ponFilamentBalances;
  ponFilamentBalances = function(pidFilter){
    const rows = origBalances(pidFilter);
    try{
      const extra = {};
      X.projects.forEach(function(p){
        if(!p.designer_id || (pidFilter && p.designer_id !== pidFilter)) return;
        items(p.id, 'proto').forEach(function(x){ const k = p.designer_id + '|' + colorKey(x.data.color || ''); extra[k] = (extra[k] || 0) + (+x.data.grams || 0); });
      });
      rows.forEach(function(r){ const k = r.partnerId + '|' + colorKey(r.color); if(extra[k]){ r.used += extra[k]; r.held -= extra[k]; delete extra[k]; } });
      Object.keys(extra).forEach(function(k){
        const pid = k.split('|')[0], x = X.projects.map(function(p){ return items(p.id, 'proto'); }).flat().find(function(i){ return colorKey(i.data.color || '') === k.slice(pid.length + 1); });
        rows.push({ partnerId: pid, color: (x && x.data.color) || 'Unspecified', issued: 0, returned: 0, used: extra[k], held: -extra[k] });
      });
    }catch(e){}
    return rows;
  };

  // ---------- view ----------
  function card(p){
    const d = p.data || {}, open = items(p.id, 'request').filter(function(r){ return !r.data.status || r.data.status === 'open'; }).length;
    const next = items(p.id, 'task').find(function(x){ return !x.data.done; });
    return '<button class="pj-card' + (X.sel === p.id ? ' on' : '') + '" data-pj="open" data-id="' + esc(p.id) + '"><b>' + esc(d.title || 'Untitled') + '</b>' +
      '<span class="pj-dim">' + esc([clientName(p.client_id) || (p.created_by === 'designer' ? 'Designer’s idea' : 'Catalogue'), p.designer_id ? partnerName(p.designer_id) : ''].filter(Boolean).join(' · ')) + '</span>' +
      (next ? '<span class="pj-dim">Next: ' + esc(next.data.title) + (next.data.due ? ' · ' + fmt(next.data.due) : '') + '</span>' : '') +
      '<span class="pj-tags">' + (d.due ? '<i>due ' + fmt(d.due) + '</i>' : '') + (open ? '<i class="warn">' + open + ' request' + (open === 1 ? '' : 's') + '</i>' : '') + '</span></button>';
  }
  function board(){
    const cols = STAGES.concat(X.showOther ? OTHER : []);
    return '<div class="pj-board">' + cols.map(function(s){
      const ps = X.projects.filter(function(p){ return ((p.data || {}).stage || 'brief') === s[0]; });
      return '<div class="pj-col"><div class="pj-col-h">' + s[1] + ' <span>' + ps.length + '</span></div>' + ps.map(card).join('') + '</div>';
    }).join('') + '</div>' +
      '<button class="pj-btn" data-pj="toggle-other">' + (X.showOther ? 'Hide' : 'Show') + ' on hold / cancelled (' + X.projects.filter(function(p){ return ['on_hold', 'cancelled'].indexOf((p.data || {}).stage) !== -1; }).length + ')</button>';
  }
  function opts(list, sel, blank){ return (blank ? '<option value="">' + blank + '</option>' : '') + list.map(function(x){ return '<option value="' + esc(x[0]) + '"' + (x[0] === sel ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join(''); }
  function detail(p){
    ensurePon();
    const d = p.data || {}, tm = terms(p.id), e = earnings(p), v = verdicts(p.id);
    const partners = state.pon.partners.map(function(x){ return [x.id, x.name || 'Partner']; });
    const clients = (state.clients || []).filter(function(c){ return c.buyerApp; }).map(function(c){ return [c.id, c.name || 'Client']; });
    const protos = items(p.id, 'proto'), gUsed = protos.reduce(function(t2, x){ return t2 + (+x.data.grams || 0); }, 0);
    let h = '<div class="panel pj-detail"><div class="panel-title" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>' + esc(d.title || 'Untitled') + '</span><button class="pj-btn" data-pj="close">Close</button></div>' +
      '<div class="pj-form">' +
        '<label>Title<input data-pf="title" value="' + esc(d.title || '') + '"></label>' +
        '<label>Stage<select data-pf="stage">' + opts(STAGES.concat(OTHER), d.stage || 'brief') + '</select></label>' +
        '<label>Designer<select data-pf="designer_id">' + opts(partners, p.designer_id, '— none —') + '</select></label>' +
        '<label>Client (brand partner)<select data-pf="client_id">' + opts(clients, p.client_id, '— our catalogue —') + '</select></label>' +
        '<label>Due<input type="date" data-pf="due" value="' + esc(d.due || '') + '"></label>' +
        '<label>Quantity<input type="number" min="0" data-pf="qty" value="' + esc(d.qty || '') + '"></label>' +
        '<label>Target cost / piece ₹<input type="number" min="0" data-pf="targetPrice" value="' + esc(d.targetPrice || '') + '"></label>' +
        '<label>Prototype filament budget (g)<input type="number" min="0" data-pf="budgetGrams" value="' + esc(d.budgetGrams || '') + '"></label>' +
      '</div><label class="pj-wide">Brief<textarea data-pf="brief" rows="3">' + esc(d.brief || '') + '</textarea></label>' +
      '<label class="pj-wide">Reference links (one per line)<textarea data-pf="refs" rows="2">' + esc((d.refs || []).join('\n')) + '</textarea></label>' +
      '<div class="pj-dim">Prototype filament: <b>' + Math.round(gUsed) + ' g</b>' + (d.budgetGrams ? ' of ' + d.budgetGrams + ' g budget' + (gUsed > d.budgetGrams ? ' — <span class="pj-bad">over budget</span>' : '') : '') + ' · counts against ' + esc(partnerName(p.designer_id)) + '’s filament balance.</div>';

    // tasks
    h += '<div class="pj-sec"><b>Milestones &amp; tasks</b>' + items(p.id, 'task').map(function(x){
      return '<div class="pj-row"><input type="checkbox" data-pj="task-done" data-id="' + esc(x.id) + '"' + (x.data.done ? ' checked' : '') + '><span' + (x.data.done ? ' class="pj-done"' : '') + '>' + esc(x.data.title) + '</span>' +
        '<span class="pj-dim">' + (x.data.owner === 'designer' ? 'Designer' : 'Thread Tribe') + (x.data.due ? ' · ' + fmt(x.data.due) : '') + (x.author === 'designer' ? ' · added by designer' : '') + '</span></div>';
    }).join('') + '<div class="pj-add"><input id="pjTask" placeholder="New task or milestone"><select id="pjTaskOwner"><option value="designer">Designer</option><option value="tt">Thread Tribe</option></select><input type="date" id="pjTaskDue"><button class="pj-btn" data-pj="task-add">Add</button></div></div>';

    // prototypes
    h += '<div class="pj-sec"><b>Prototype rounds</b>' + (protos.length ? protos.map(function(x, i){
      const dv = v[x.id], cv = items(p.id, 'approval').filter(function(a){ return a.author === 'client' && a.data.target === x.id; }).pop();
      return '<div class="pj-proto">' + (isImg(x.data.thumb) ? '<img src="' + x.data.thumb + '" alt="">' : '<div class="pj-noimg">🧪</div>') + '<div style="flex:1;min-width:0">' +
        '<b>Round ' + (i + 1) + '</b> <span class="pj-dim">' + when(x.data.at) + '</span>' +
        '<div class="pj-dim">' + esc([x.data.color, x.data.grams ? x.data.grams + ' g' : '', x.data.hours ? x.data.hours + ' h print' : ''].filter(Boolean).join(' · ')) + '</div>' +
        (x.data.notes ? '<div>' + esc(x.data.notes) + '</div>' : '') + (isUrl(x.data.link) ? '<a href="' + esc(x.data.link) + '" target="_blank" rel="noopener">Photos / files ↗</a>' : '') +
        '<div class="pj-tags">' + (dv ? '<i class="' + (dv.decision === 'approved' ? 'ok' : 'warn') + '">TT: ' + esc(dv.decision === 'approved' ? 'approved' : 'changes requested') + (dv.note ? ' — ' + esc(dv.note) : '') + '</i>' : '') +
          (cv ? '<i class="' + (cv.data.decision === 'approved' ? 'ok' : 'warn') + '">Client: ' + esc(cv.data.decision === 'approved' ? 'approved' : 'changes requested') + (cv.data.note ? ' — ' + esc(cv.data.note) : '') + '</i>' : '') +
          (x.data.internal ? '<i>hidden from client</i>' : '') + '</div>' +
        '<div><button class="pj-btn primary" data-pj="proto-ok" data-id="' + esc(x.id) + '">Approve</button><button class="pj-btn" data-pj="proto-change" data-id="' + esc(x.id) + '">Request changes</button>' +
          (p.client_id ? '<button class="pj-btn" data-pj="proto-share" data-id="' + esc(x.id) + '">' + (x.data.internal ? 'Show to client' : 'Hide from client') + '</button>' : '') + '</div></div></div>';
    }).join('') : '<div class="pj-dim">No prototypes yet — the designer adds each round from their app.</div>') + '</div>';

    // files
    h += '<div class="pj-sec"><b>Design files</b>' + items(p.id, 'file').map(function(x){
      return '<div class="pj-row">' + (isUrl(x.data.url) ? '<a href="' + esc(x.data.url) + '" target="_blank" rel="noopener">' + esc(x.data.label || x.data.url) + ' ↗</a>' : esc(x.data.label || '')) + '<span class="pj-dim">' + esc(x.data.version || '') + ' · ' + when(x.data.at) + '</span></div>';
    }).join('') + '<div class="pj-add"><input id="pjFileLabel" placeholder="Label, e.g. Final STL"><input id="pjFileUrl" placeholder="https:// link"><button class="pj-btn" data-pj="file-add">Add link</button></div></div>';

    // requests
    h += '<div class="pj-sec"><b>Help requests</b>' + (items(p.id, 'request').length ? items(p.id, 'request').map(function(x){
      const open = !x.data.status || x.data.status === 'open';
      return '<div class="pj-req ' + (open ? 'open' : '') + '"><b>' + esc(REQ[x.data.type] || 'Request') + '</b> <span class="pj-dim">' + when(x.data.at) + '</span><div>' + esc(x.data.text || '') + '</div>' +
        (x.data.reply ? '<div class="pj-dim">Reply: ' + esc(x.data.reply) + '</div>' : '') +
        (open ? '<div class="pj-add"><input data-reqreply="' + esc(x.id) + '" placeholder="Reply"><button class="pj-btn primary" data-pj="req-done" data-id="' + esc(x.id) + '">Done</button><button class="pj-btn" data-pj="req-decline" data-id="' + esc(x.id) + '">Decline</button>' +
          (x.data.type === 'filament' ? '<button class="pj-btn" data-pj="req-issue" data-id="' + esc(x.id) + '">Issue filament…</button>' : '') + '</div>' : '') + '</div>';
    }).join('') : '<div class="pj-dim">None.</div>') + '</div>';

    // hours + money
    h += '<div class="pj-sec"><b>Hours &amp; earnings</b><div class="pj-form">' +
      '<label>Hourly rate ₹<input type="number" min="0" data-pt="hourlyRate" value="' + tm.hourlyRate + '"></label>' +
      '<label>Royalty<select data-pt="royaltyType">' + opts([['piece', '₹ per piece'], ['percent', '% of sales']], tm.royaltyType) + '</select></label>' +
      '<label>Royalty value<input type="number" min="0" step="0.5" data-pt="royaltyValue" value="' + tm.royaltyValue + '"></label></div>' +
      items(p.id, 'hours').map(function(x){
        const dv = v[x.id];
        return '<div class="pj-row"><span><b>' + (+x.data.hours || 0) + ' h</b> ' + fmt(x.data.date) + ' — ' + esc(x.data.note || '') + '</span>' +
          (dv ? '<span class="pj-tags"><i class="' + (dv.decision === 'approved' ? 'ok' : 'warn') + '">' + dv.decision + '</i></span>' : '<span><button class="pj-btn primary" data-pj="hrs-ok" data-id="' + esc(x.id) + '">Approve</button><button class="pj-btn" data-pj="hrs-no" data-id="' + esc(x.id) + '">Reject</button></span>') + '</div>';
      }).join('') +
      '<div class="pj-earn"><div><span>Approved hours</span><b>' + e.hoursApproved + ' h · ' + money(e.hourly) + '</b></div><div><span>Royalty</span><b>' + e.pieces + ' pcs · ' + money(e.royalty) + '</b></div>' +
      '<div><span>Paid</span><b>' + money(e.paid) + '</b></div><div><span>Due to designer</span><b class="' + (e.due ? 'pj-warn' : '') + '">' + money(e.due) + '</b></div></div>' +
      (e.due && p.designer_id ? '<button class="pj-btn primary" data-pj="pay">Record payment of ' + money(e.due) + '</button>' : '') +
      (e.hoursPending ? '<div class="pj-dim">' + e.hoursPending + ' h waiting for approval.</div>' : '') + '</div>';

    // production
    const cat = tm.catalogId && (state.productCatalog || []).find(function(i){ return i.id === tm.catalogId; });
    h += '<div class="pj-sec"><b>Production &amp; launch</b>' + (cat ? '<div class="pj-dim">Catalogue product: <b>' + esc(cat.name) + '</b> · ' + (cat.weight || 0) + ' g · ' + (cat.hours || 0) + ' h. Royalty counts orders' + (tm.liveDate ? ' from ' + fmt(tm.liveDate) : '') + '.</div>' +
        ((d.stage !== 'live') ? '<button class="pj-btn primary" data-pj="go-live">Mark live (start royalty today)</button>' : '')
      : '<div class="pj-dim">When a prototype is approved, add it to the Product Catalog with its weight and print time. Royalty is counted on orders of that product.</div><button class="pj-btn primary" data-pj="make-product">Make production-ready…</button>') + '</div>';

    // comments
    h += '<div class="pj-sec"><b>Conversation</b>' + items(p.id, 'comment').map(function(x){
      return '<div class="pj-msg ' + x.author + '"><b>' + (x.author === 'tt' ? 'Thread Tribe' : x.author === 'designer' ? partnerName(p.designer_id) : clientName(p.client_id) || 'Client') + '</b> <span class="pj-dim">' + when(x.data.at) + (x.data.internal ? ' · internal' : '') + '</span><div>' + esc(x.data.text || '') + '</div></div>';
    }).join('') + '<div class="pj-add"><input id="pjComment" placeholder="Write to the designer' + (p.client_id ? ' and client' : '') + '…">' + (p.client_id ? '<label class="pj-dim"><input type="checkbox" id="pjInternal"> internal (hide from client)</label>' : '') + '<button class="pj-btn primary" data-pj="comment">Send</button></div></div>';
    return h + '</div>';
  }
  function render(){
    const root = document.getElementById('projectsRoot'); if(!root) return;
    if(!on()){ root.innerHTML = '<div class="panel"><p class="pj-dim">Sign in to Cloud sync to use Projects.</p></div>'; return; }
    if(X.missing){ root.innerHTML = '<div class="panel"><p class="pj-dim">Run <code>projects_setup.sql</code> in Supabase → SQL Editor to switch on Projects, then reload.</p></div>'; return; }
    const sel = X.sel && project(X.sel);
    root.innerHTML = '<div class="panel"><div class="panel-title" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>Custom projects</span><button class="pj-btn primary" data-pj="new">+ New project</button></div>' +
      (X.loaded ? (X.projects.length ? board() : '<p class="pj-dim">No projects yet. Start one, or wait for your designer to pitch an idea from the Partner app.</p>') : '<p class="pj-dim">Loading…</p>') + '</div>' + (sel ? detail(sel) : '');
  }
  function refresh(){
    const t2 = document.getElementById('tabProjects');
    if(t2 && t2.style.display !== 'none' && !(document.activeElement && t2.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render();
  }
  window.renderProjects = function(){ render(); load().then(render); };
  window.TTProjects = { openCount: function(){ let n = 0; X.projects.forEach(function(p){ n += items(p.id, 'request').filter(function(r){ return !r.data.status || r.data.status === 'open'; }).length + items(p.id, 'hours').filter(function(h){ return !verdicts(p.id)[h.id]; }).length; }); return n; } };

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
      if(await saveProject(np)){ X.projects.unshift(np); X.sel = np.id; render(); }
      return;
    }
    if(!p) return;
    if(act === 'task-add'){
      const title = (document.getElementById('pjTask').value || '').trim(); if(!title) return;
      await addItem(p.id, 'task', { title: title.slice(0, 200), owner: document.getElementById('pjTaskOwner').value, due: document.getElementById('pjTaskDue').value, done: false }); render();
    } else if(act === 'task-done'){
      const row = items(p.id, 'task').find(function(x){ return x.id === id; });
      if(row && row.author === 'tt') await updateItem(row, { done: b.checked });
      else if(row){ b.checked = !!row.data.done; showToast('Only the designer can tick off their own tasks'); }
      render();
    } else if(act === 'proto-ok' || act === 'proto-change'){
      const note = act === 'proto-change' ? prompt('What should change?') : '';
      if(act === 'proto-change' && !note) return;
      await addItem(p.id, 'approval', { target: id, decision: act === 'proto-ok' ? 'approved' : 'changes', note: note || '' }); render();
    } else if(act === 'proto-share'){
      const row = items(p.id, 'proto').find(function(x){ return x.id === id; }); if(row){ await updateItem(row, { internal: !row.data.internal }); render(); }
    } else if(act === 'file-add'){
      const url = (document.getElementById('pjFileUrl').value || '').trim();
      if(!isUrl(url)){ showToast('Paste a full https:// link'); return; }
      await addItem(p.id, 'file', { label: (document.getElementById('pjFileLabel').value || '').trim().slice(0, 120), url: url }); render();
    } else if(act === 'req-done' || act === 'req-decline'){
      const row = items(p.id, 'request').find(function(x){ return x.id === id; }); if(!row) return;
      const inp = tab.querySelector('[data-reqreply="' + id + '"]');
      await updateItem(row, { status: act === 'req-done' ? 'done' : 'declined', reply: inp ? inp.value.trim().slice(0, 500) : '' }); render();
    } else if(act === 'req-issue'){
      const row = items(p.id, 'request').find(function(x){ return x.id === id; }); if(!row || !p.designer_id) return;
      const color = prompt('Filament colour', ''); if(color === null) return;
      const grams = Math.round(parseFloat(prompt('Grams issued', '1000')) || 0); if(!grams) return;
      ensurePon();
      state.pon.filamentIssues.push({ id: newId(), partnerId: p.designer_id, type: 'issue', color: color.trim() || 'Unspecified', grams: grams, date: today(), note: 'Project: ' + ((p.data || {}).title || '') });
      scheduleSave();
      await updateItem(row, { status: 'done', reply: grams + ' g of ' + (color || 'filament') + ' issued' }); render();
      showToast('Filament issued — it shows on the designer’s balance');
    } else if(act === 'hrs-ok' || act === 'hrs-no'){
      await addItem(p.id, 'approval', { target: id, decision: act === 'hrs-ok' ? 'approved' : 'rejected', internal: false }); await syncEarnings(); render();
    } else if(act === 'pay'){
      const e2 = earnings(p); if(!e2.due) return;
      const amt = Math.round(parseFloat(prompt('Amount paid to the designer (₹)', String(e2.due))) || 0); if(!amt) return;
      ensurePon();
      const rec = { id: newId(), partnerId: p.designer_id, date: today(), amount: amt, mode: 'UPI', ref: '', note: 'Design · ' + ((p.data || {}).title || ''), projectId: p.id, expenseId: null };
      if(!state.expenses) state.expenses = [];
      const exp = { id: newId(), date: rec.date, item: 'Design fee — ' + ((p.data || {}).title || 'project'), category: 'Partner Network', cost: amt, type: 'opex', vendor: partnerName(p.designer_id) };
      state.expenses.push(exp); rec.expenseId = exp.id;
      state.pon.payouts.push(rec);
      scheduleSave(); await syncEarnings(); render(); showToast('Payment recorded — the designer sees it in Money');
    } else if(act === 'make-product'){
      const protos = items(p.id, 'proto'), last = protos[protos.length - 1];
      const name = prompt('Product name for the catalogue', (p.data || {}).title || ''); if(!name) return;
      const weight = parseFloat(prompt('Weight per piece (g)', last && last.data.grams ? String(last.data.grams) : '')) || 0;
      const hours = parseFloat(prompt('Print time per piece (hours)', last && last.data.hours ? String(last.data.hours) : '')) || 0;
      const category = prompt('Category (e.g. Fidget Clickers, Flexi Toys)', '') || '';
      if(!state.productCatalog) state.productCatalog = [];
      const item = { id: newId(), name: name.trim(), category: category.trim(), weight: weight, hours: hours, material: 'PLA', color: last ? (last.data.color || '') : '', size: '', photo: last && isImg(last.data.thumb) ? last.data.thumb : '', wholesalePrice: null, d2cPrice: null };
      state.productCatalog.push(item);
      terms(p.id).catalogId = item.id;
      scheduleSave();
      p.data = Object.assign({}, p.data, { stage: 'production', productName: item.name });
      await saveProject(p);
      if(typeof renderProductCatalog === 'function') renderProductCatalog();
      render(); showToast(item.name + ' added to the Product Catalog');
    } else if(act === 'go-live'){
      terms(p.id).liveDate = today(); scheduleSave();
      p.data = Object.assign({}, p.data, { stage: 'live', liveDate: today() }); await saveProject(p); render();
      showToast('Live — royalty counts orders from today');
    } else if(act === 'comment'){
      const txt = (document.getElementById('pjComment').value || '').trim(); if(!txt) return;
      const internal = !!(document.getElementById('pjInternal') && document.getElementById('pjInternal').checked);
      await addItem(p.id, 'comment', { text: txt.slice(0, 2000), internal: internal }); render();
    }
  });
  document.addEventListener('change', async function(e){
    const tab = document.getElementById('tabProjects'); if(!tab || !tab.contains(e.target)) return;
    const p = X.sel && project(X.sel); if(!p) return;
    const f = e.target.getAttribute('data-pf'), tf = e.target.getAttribute('data-pt');
    if(f){
      const v = e.target.value;
      if(f === 'designer_id' || f === 'client_id') p[f] = v || null;
      else if(f === 'refs') p.data = Object.assign({}, p.data, { refs: v.split('\n').map(function(s){ return s.trim(); }).filter(isUrl).slice(0, 20) });
      else p.data = Object.assign({}, p.data, { [f]: ['qty', 'targetPrice', 'budgetGrams'].indexOf(f) !== -1 ? (+v || 0) : String(v).slice(0, f === 'brief' ? 4000 : 200) });
      if(await saveProject(p)){ showToast('Saved'); if(f === 'stage' || f === 'title') render(); }
    } else if(tf){
      terms(p.id)[tf] = tf === 'royaltyType' ? e.target.value : Math.max(0, parseFloat(e.target.value) || 0);
      scheduleSave(); await syncEarnings(); render();
    }
  });

  const css = document.createElement('style');
  css.textContent =
    '#tabProjects .pj-dim{color:var(--dim);font-size:12px}' +
    '#tabProjects .pj-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 11px;font:12px "JetBrains Mono",monospace;cursor:pointer;margin:2px 4px 2px 0}' +
    '#tabProjects .pj-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#0d1117;font-weight:600}' +
    '#tabProjects .pj-board{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px}' +
    '#tabProjects .pj-col{flex:0 0 200px;background:var(--input-bg);border-radius:10px;padding:8px;min-height:120px}' +
    '#tabProjects .pj-col-h{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin-bottom:6px} #tabProjects .pj-col-h span{float:right}' +
    '#tabProjects .pj-card{display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:6px;cursor:pointer;color:var(--text);font:12.5px inherit}' +
    '#tabProjects .pj-card.on{border-color:var(--cyan)}' +
    '#tabProjects .pj-tags{display:flex;gap:4px;flex-wrap:wrap} #tabProjects .pj-tags i{font-style:normal;font-size:10.5px;border:1px solid var(--line);border-radius:999px;padding:0 6px;color:var(--dim)}' +
    '#tabProjects .pj-tags i.warn{color:var(--amber);border-color:var(--amber)} #tabProjects .pj-tags i.ok{color:var(--green);border-color:var(--green)}' +
    '#tabProjects .pj-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:8px 0}' +
    '#tabProjects label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dim)} #tabProjects .pj-wide{margin:6px 0}' +
    '#tabProjects input,#tabProjects select,#tabProjects textarea{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:12.5px inherit}' +
    '#tabProjects .pj-sec{border-top:1px dashed var(--line);margin-top:12px;padding-top:10px}' +
    '#tabProjects .pj-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0;font-size:13px} #tabProjects .pj-done{text-decoration:line-through;color:var(--dim)}' +
    '#tabProjects .pj-add{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px} #tabProjects .pj-add input:not([type=checkbox]){flex:1;min-width:140px}' +
    '#tabProjects .pj-proto{display:flex;gap:10px;border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0;font-size:12.5px}' +
    '#tabProjects .pj-proto img,#tabProjects .pj-noimg{width:90px;height:90px;object-fit:cover;border-radius:8px;flex:none;background:var(--input-bg);display:flex;align-items:center;justify-content:center;font-size:28px}' +
    '#tabProjects .pj-req{border:1px solid var(--line);border-radius:8px;padding:8px;margin:6px 0;font-size:12.5px} #tabProjects .pj-req.open{border-color:var(--amber)}' +
    '#tabProjects .pj-earn{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:8px 0}' +
    '#tabProjects .pj-earn div{background:var(--input-bg);border-radius:8px;padding:8px} #tabProjects .pj-earn span{display:block;font-size:11px;color:var(--dim)}' +
    '#tabProjects .pj-warn{color:var(--amber)} #tabProjects .pj-bad{color:var(--red);font-weight:600}' +
    '#tabProjects .pj-msg{border-left:3px solid var(--line);padding:4px 10px;margin:6px 0;font-size:13px} #tabProjects .pj-msg.designer{border-color:var(--cyan)} #tabProjects .pj-msg.client{border-color:var(--amber)}';
  document.head.appendChild(css);
})();
