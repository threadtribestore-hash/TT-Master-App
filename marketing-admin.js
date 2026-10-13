// ===================================================================
// ======================= MARKETING (Studio) ========================
// ===================================================================
// Instagram marketing, run from Studio: campaigns, the content pipeline and calendar, the
// asset library (files stay in Google Drive; rows hold links, tags and status), campaign
// templates, gap reminders, ideas drawn from the business, and campaign and channel results.
//
// Measures, Instagram only for now:
//   North star     trade enquiries from Instagram per week (logged enquiries + Sales-app leads
//                  with source Instagram), and new trade accounts from Instagram per month.
//   Content health sends per reach first, then saves per reach, follows per 1k reach, reach per
//                  post and posts per week, from the weekly Meta Business Suite export.
// Campaigns are tied to results by a campaign code (WhatsApp link, DM keyword) and by the
// Campaign field on orders.
//
// Tables: mkt_team, mkt_docs (~/PrintFarm/tt-bridge/marketing_setup.sql). Signed out, data is
// kept on this device only (state.mktLocal) so the tab still works.
(function(){
  if(window.TT_STOCK_MODE) return;

  const ACCOUNT = '@threadtribe.india';
  const STAGES = [['idea', 'Idea'], ['script', 'Script'], ['shoot', 'Shoot'], ['edit', 'Edit'], ['review', 'Review'], ['scheduled', 'Scheduled'], ['posted', 'Posted']];
  const PHASES = [['awareness', 'Awareness'], ['engagement', 'Engagement & trust'], ['conversion', 'Conversion']];
  const FORMATS = ['Reel', 'Carousel', 'Static', 'Story'];
  const VOICES = ['Brand', 'Founder'];
  const ASSET_STATUS = [['raw', 'Raw'], ['edited', 'Edited'], ['review', 'Needs approval'], ['approved', 'Approved'], ['used', 'Used']];
  const COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#e34948', '#008300'];
  const DAY = 86400000;
  // Campaign templates: steps are days from the campaign date, so one date lays out the whole plan.
  const TEMPLATES = [
    { id: 'launch', name: 'Product launch', phase: 'conversion', steps: [
      [-7, 'Reel', 'Brand', 'awareness', 'Teaser: {p} in the dark'],
      [-3, 'Reel', 'Founder', 'engagement', 'Making of {p}'],
      [0, 'Reel', 'Brand', 'conversion', '{p} is here (WhatsApp CTA)'],
      [1, 'Carousel', 'Brand', 'engagement', '{p}: sizes, colours, details'],
      [3, 'Story', 'Brand', 'engagement', '{p} Q&A in stories'],
      [7, 'Reel', 'Founder', 'conversion', 'Why dealers stock {p} (margin, MOQ 25)'] ] },
    { id: 'festival', name: 'Festival push', phase: 'conversion', steps: [
      [-14, 'Carousel', 'Brand', 'awareness', 'Festive lookbook'],
      [-10, 'Reel', 'Brand', 'awareness', 'Festive glow reel'],
      [-7, 'Reel', 'Brand', 'engagement', 'Gifting and hampers'],
      [-3, 'Story', 'Brand', 'conversion', 'Last dates to order'],
      [0, 'Static', 'Brand', 'awareness', 'Festival greeting'] ] },
    { id: 'trade', name: 'Trade push', phase: 'conversion', steps: [
      [0, 'Reel', 'Brand', 'awareness', 'Why shops stock Thread Tribe'],
      [2, 'Carousel', 'Brand', 'conversion', 'Dealer margin and MOQ 25'],
      [4, 'Reel', 'Founder', 'engagement', 'Founder: how we build for dealers'],
      [7, 'Reel', 'Brand', 'engagement', 'Dealer story / testimonial'] ] },
    { id: 'toys', name: 'Toy drop', phase: 'conversion', steps: [
      [-3, 'Reel', 'Brand', 'awareness', 'Teaser: {p}'],
      [0, 'Reel', 'Brand', 'conversion', '{p} drop'],
      [2, 'Carousel', 'Brand', 'engagement', '{p} colours and pack'],
      [5, 'Reel', 'Brand', 'engagement', 'Kids react to {p}'] ] }
  ];

  const X = { docs: [], team: [], loaded: false, loading: false, missing: false, local: false, leads: [] };
  const V = { view: 'overview', month: null, edit: null, assetQ: '', assetSt: '' };

  // ---------- helpers ----------
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }
  function uid(p){ return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  // Stored timestamps are UTC ("...Z"); read them as the local date. Plain dates and local times pass through.
  function dayOf(s){ if(!s) return ''; s = String(s); if(/Z$|[+-]\d\d:\d\d$/.test(s)){ const d = new Date(s); if(!isNaN(d)) return iso(d); } return s.slice(0, 10); }
  function fmt(s){ if(!s) return '—'; const d = new Date(dayOf(s) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function pct(v){ return v == null || !isFinite(v) ? '—' : (Math.round(v * 1000) / 10) + '%'; }
  function label(list, k){ const x = list.find(function(i){ return i[0] === k; }); return x ? x[1] : k; }
  function opts(list, cur){ return list.map(function(o){ const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join(''); }
  function kind(k){ return X.docs.filter(function(d){ return d.kind === k; }).map(function(d){ return d.data; }); }
  function byId(id){ const d = X.docs.find(function(x){ return x.id === id; }); return d ? d.data : null; }
  function settings(){ return Object.assign({ cadenceMin: 6, cadenceMax: 8, driveFolder: '', waPhone: (state.business && state.business.phone) || '', dismissed: {} }, byId('settings') || {}); }
  function campaigns(){ return kind('campaign').sort(function(a, b){ return (b.start || '').localeCompare(a.start || ''); }); }
  function pieces(){ return kind('piece'); }
  function campaign(id){ return id ? kind('campaign').find(function(c){ return c.id === id; }) : null; }
  function campColour(c){ return c ? (c.colour || COLOURS[Math.abs(hash(c.id)) % COLOURS.length]) : 'var(--dim)'; }
  function hash(s){ let h = 0; String(s).split('').forEach(function(ch){ h = (h * 31 + ch.charCodeAt(0)) | 0; }); return h; }
  function waPhone(raw){ let d = String(raw || '').replace(/\D/g, ''); if(d.length === 10) d = '91' + d; return d; }
  function driveId(url){ const m = String(url || '').match(/\/d\/([\w-]{10,})|[?&]id=([\w-]{10,})|\/folders\/([\w-]{10,})/); return m ? (m[1] || m[2] || m[3]) : ''; }
  function thumb(a){ const id = driveId(a.url); return a.thumb || (id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400' : ''); }

  // ---------- data ----------
  async function load(){
    if(X.loading) return;
    X.loading = true;
    try{
      if(!on()){
        X.local = true; X.missing = false;
        X.docs = Array.isArray(state.mktLocal) ? state.mktLocal : (state.mktLocal = []);
        X.team = []; X.loaded = true; return;
      }
      X.local = false;
      const r = await cloud.sb.from('mkt_docs').select('id,kind,data,updated_by,updated_at').limit(10000);
      if(r.error){ X.missing = /mkt_docs|does not exist|schema cache|relation/i.test(r.error.message || ''); X.loaded = true; return; }
      const t = await cloud.sb.from('mkt_team').select('email,name,role,active').order('name');
      X.docs = r.data || []; X.team = t.data || []; X.missing = false; X.loaded = true;
      // Sales-app leads say where they came from; Instagram ones count as enquiries.
      const since = new Date(Date.now() - 70 * DAY).toISOString();
      const l = await cloud.sb.from('sales_leads').select('id,data,updated_at').gte('updated_at', since).limit(5000);
      X.leads = (l.data || []).filter(function(x){ return /insta/i.test((x.data || {}).source || ''); });
    } finally { X.loading = false; }
  }
  async function save(kindName, data){
    if(!data.id) data.id = uid(kindName.slice(0, 2) + '_');
    const row = { id: data.id, kind: kindName, data: data, updated_at: new Date().toISOString() };
    const i = X.docs.findIndex(function(d){ return d.id === data.id; });
    if(i === -1) X.docs.push(row); else X.docs[i] = row;
    if(X.local){ state.mktLocal = X.docs; scheduleSave(); return true; }
    const r = await cloud.sb.from('mkt_docs').upsert({ id: row.id, kind: kindName, data: data });
    if(r.error){ showNoticeModal('Couldn’t save: ' + r.error.message); return false; }
    return true;
  }
  async function remove(id){
    X.docs = X.docs.filter(function(d){ return d.id !== id; });
    if(X.local){ state.mktLocal = X.docs; scheduleSave(); return; }
    const r = await cloud.sb.from('mkt_docs').delete().eq('id', id);
    if(r.error) showNoticeModal('Couldn’t delete: ' + r.error.message);
  }
  async function saveSettings(patch){ const s = Object.assign(settings(), patch, { id: 'settings' }); await save('settings', s); }

  // ---------- measures ----------
  function weekStart(s){ const d = new Date(s + 'T00:00:00'); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return iso(d); }
  function enquiriesBetween(a, b){
    const logged = kind('enquiry').filter(function(e){ return e.date >= a && e.date < b; });
    const leads = X.leads.filter(function(l){ const d = dayOf((l.data || {}).createdAt || l.updated_at); return d >= a && d < b; });
    return { logged: logged, leads: leads, n: logged.length + leads.length };
  }
  function isTrade(c){ return c && !/\bd2c\b|consumer|individual/i.test((c.type || '') + ' ' + (c.notes || '')); }
  function counts(o){ return ['quoted', 'lost', 'cancelled'].indexOf(o.status) === -1; }
  function orderDay(o){ return o.orderedDate || o.productionStartDate || o.dueDate || ''; }
  function fromInstagram(o){
    if(o.campaignId || o.orderSource === 'insta_dm') return true;
    return X.leads.some(function(l){ return (l.data || {}).clientId && (l.data || {}).clientId === o.clientId; });
  }
  // A client's first counted order, when it came through Instagram, makes a new trade account.
  function newAccounts(a, b){
    const first = {};
    state.orders.filter(counts).forEach(function(o){
      if(!o.clientId) return;
      const d = orderDay(o); if(!d) return;
      if(!first[o.clientId] || d < orderDay(first[o.clientId])) first[o.clientId] = o;
    });
    return Object.keys(first).map(function(k){ return first[k]; }).filter(function(o){
      const d = orderDay(o), c = (state.clients || []).find(function(x){ return x.id === o.clientId; });
      return d >= a && d < b && isTrade(c) && fromInstagram(o);
    });
  }
  function metrics(){ return kind('metric'); }
  function rate(list, num){ const reach = list.reduce(function(s, m){ return s + (m.reach || 0); }, 0); return reach ? list.reduce(function(s, m){ return s + (m[num] || 0); }, 0) / reach : null; }
  function health(){
    const t = today(), ms = metrics();
    const recent = ms.filter(function(m){ return dayOf(m.publishedAt) > addDays(t, -7); });
    const base = ms.filter(function(m){ const d = dayOf(m.publishedAt); return d <= addDays(t, -7) && d > addDays(t, -37); });
    const s = settings();
    const postsWeek = pieces().filter(function(p){ return p.stage === 'posted' && dayOf(p.postAt) > addDays(t, -7) && dayOf(p.postAt) <= t; }).length || recent.length;
    function row(name, cur, was, fmtFn, note){
      let st = 'none';
      if(cur != null && was != null && was > 0) st = cur >= was ? 'good' : cur >= was * 0.85 ? 'watch' : 'bad';
      return { name: name, cur: cur, was: was, fmt: fmtFn, st: st, note: note };
    }
    const avgReach = function(l){ return l.length ? l.reduce(function(s, m){ return s + (m.reach || 0); }, 0) / l.length : null; };
    const follows = function(l){ const r = rate(l, 'follows'); return r == null ? null : r * 1000; };
    return {
      has: ms.length > 0, lastImport: ms.reduce(function(m, x){ return x.importedAt > m ? x.importedAt : m; }, ''),
      rows: [
        row('Sends per reach', rate(recent, 'shares'), rate(base, 'shares'), pct, 'Main measure: people forwarding a post'),
        row('Saves per reach', rate(recent, 'saves'), rate(base, 'saves'), pct, 'Posts worth coming back to'),
        row('Follows per 1,000 reached', follows(recent), follows(base), function(v){ return v == null ? '—' : (Math.round(v * 10) / 10).toString(); }, 'New people choosing to stay'),
        row('Reach per post', avgReach(recent), avgReach(base), function(v){ return v == null ? '—' : Math.round(v).toLocaleString('en-IN'); }, 'How far each post travels'),
        { name: 'Posts this week', cur: postsWeek, was: s.cadenceMin, fmt: function(v){ return String(v); }, st: postsWeek >= s.cadenceMin ? 'good' : postsWeek >= s.cadenceMin - 2 ? 'watch' : 'bad', note: 'Target ' + s.cadenceMin + '–' + s.cadenceMax + ' a week' }
      ]
    };
  }
  function scorecard(c){
    const ps = pieces().filter(function(p){ return p.campaignId === c.id; });
    const posted = ps.filter(function(p){ return p.stage === 'posted'; });
    const ms = metrics().filter(function(m){ return m.pieceId && ps.some(function(p){ return p.id === m.pieceId; }); });
    const enq = kind('enquiry').filter(function(e){ return e.campaignId === c.id; }).length +
      X.leads.filter(function(l){ const d = l.data || {}; return d.campaignId === c.id || (c.code && new RegExp('\\b' + c.code + '\\b', 'i').test((d.notes || '') + ' ' + (d.campaign || ''))); }).length;
    const orders = state.orders.filter(function(o){ return counts(o) && o.campaignId === c.id; });
    const revenue = orders.reduce(function(s, o){ try{ return s + orderTotals(o).orderValue; }catch(e){ return s; } }, 0);
    const accounts = newAccounts('0000-00-00', '9999-99-99').filter(function(o){ return o.campaignId === c.id; }).length;
    const cost = (+c.budget || 0);
    return { pieces: ps.length, posted: posted.length, reach: ms.reduce(function(s, m){ return s + (m.reach || 0); }, 0), sendsRate: rate(ms, 'shares'),
      enquiries: enq, orders: orders.length, revenue: revenue, accounts: accounts,
      perEnquiry: enq ? cost / enq : null, perAccount: accounts ? cost / accounts : null, cost: cost };
  }

  // ---------- gaps, reminders and ideas ----------
  function needs(){
    if(!X.loaded || X.missing) return [];
    const out = [], t = today(), s = settings(), ps = pieces();
    const next7 = ps.filter(function(p){ const d = dayOf(p.postAt); return d >= t && d < addDays(t, 7) && p.stage !== 'idea'; }).length;
    if(next7 < s.cadenceMin) out.push({ level: 1, rank: 2, score: s.cadenceMin - next7, text: 'Instagram: ' + next7 + ' post' + (next7 === 1 ? '' : 's') + ' planned for the next 7 days (target ' + s.cadenceMin + '–' + s.cadenceMax + ')', act: 'tab', id: 'marketing', btn: 'Plan' });
    const late = ps.filter(function(p){ return p.postAt && dayOf(p.postAt) < t && ['scheduled', 'posted'].indexOf(p.stage) === -1 && p.stage !== 'idea'; });
    if(late.length) out.push({ level: 1, rank: 2, score: late.length, text: late.length + ' Instagram post' + (late.length === 1 ? ' is' : 's are') + ' past their date and not scheduled', act: 'tab', id: 'marketing', btn: 'Pipeline' });
    const stuck = ps.filter(function(p){ return (p.stage === 'shoot' && p.shootBy && p.shootBy < t) || (p.stage === 'edit' && p.editBy && p.editBy < t); });
    if(stuck.length) out.push({ level: 2, rank: 1, score: stuck.length, text: stuck.length + ' shoot or edit deadline' + (stuck.length === 1 ? '' : 's') + ' missed', act: 'tab', id: 'marketing', btn: 'Pipeline' });
    const toApprove = kind('asset').filter(function(a){ return a.status === 'review'; }).length;
    if(toApprove) out.push({ level: 2, rank: 1, score: toApprove, text: toApprove + ' asset' + (toApprove === 1 ? '' : 's') + ' waiting for approval', act: 'tab', id: 'marketing', btn: 'Assets' });
    const h = health();
    if(ps.some(function(p){ return p.stage === 'posted'; }) && (!h.lastImport || h.lastImport < addDays(t, -8))) out.push({ level: 2, rank: 2, score: 1, text: 'Instagram results not imported this week', act: 'tab', id: 'marketing', btn: 'Import' });
    return out;
  }
  function ideas(){
    const t = today(), s = settings(), dis = s.dismissed || {}, ps = pieces(), out = [];
    const featured = {}; ps.forEach(function(p){ if(p.product && dayOf(p.postAt || p.created) > addDays(t, -120)) featured[p.product.toLowerCase()] = 1; });
    (state.productCatalog || []).filter(function(c){ return c.name && !featured[c.name.toLowerCase()]; }).slice(-40).reverse().slice(0, 5).forEach(function(c){
      out.push({ id: 'new:' + c.id, kind: 'Never featured', title: 'Feature ' + c.name, why: 'In the catalogue but not in any post for 4 months.', product: c.name, format: 'Reel', phase: 'awareness' });
    });
    state.orders.filter(function(o){ const d = o.deliveryDate || o.productionDoneDate || ''; return ['production_done', 'delivered'].indexOf(o.status) !== -1 && d >= addDays(t, -21); })
      .map(function(o){ return { o: o, q: (o.products || []).reduce(function(s, p){ return s + (+p.qty || 0); }, 0) }; })
      .filter(function(x){ return x.q >= 50; }).sort(function(a, b){ return b.q - a.q; }).slice(0, 3).forEach(function(x){
        const top = (x.o.products || []).slice().sort(function(a, b){ return (b.qty || 0) - (a.qty || 0); })[0] || {};
        out.push({ id: 'big:' + x.o.id, kind: 'Big order finished', title: 'Behind the scenes: ' + x.q + ' pieces of ' + (top.name || 'an order') + ' leaving the farm', why: (x.o.displayId || '') + '. Ask the client before naming them.', product: top.name || '', format: 'Reel', phase: 'engagement' });
      });
    const sold = {};
    state.orders.filter(function(o){ return counts(o) && orderDay(o) >= addDays(t, -30); }).forEach(function(o){ (o.products || []).forEach(function(p){ if(p.name) sold[p.name] = (sold[p.name] || 0) + (+p.qty || 0); }); });
    Object.keys(sold).sort(function(a, b){ return sold[b] - sold[a]; }).slice(0, 3).forEach(function(n){
      out.push({ id: 'top:' + n.toLowerCase(), kind: 'Top seller', title: n + ': our bestseller this month', why: sold[n] + ' pieces ordered in the last 30 days.', product: n, format: 'Reel', phase: 'conversion' });
    });
    if(window.TTUpsell){
      try{
        const cross = {};
        window.TTUpsell.analyse().opps.filter(function(x){ return x.type === 'cross'; }).forEach(function(x){ const n = x.title.replace(/^Offer /, ''); cross[n] = (cross[n] || 0) + 1; });
        Object.keys(cross).sort(function(a, b){ return cross[b] - cross[a]; }).slice(0, 2).forEach(function(n){
          out.push({ id: 'up:' + n.toLowerCase(), kind: 'Upsell pick', title: 'Why dealers add ' + n, why: cross[n] + ' client' + (cross[n] === 1 ? '' : 's') + ' are likely to add it (Upsell analysis).', product: n, format: 'Carousel', phase: 'conversion' });
        });
      }catch(e){}
    }
    return out.filter(function(i){ return !dis[i.id]; });
  }

  // ---------- campaign templates ----------
  function templates(){
    const custom = kind('template');
    return TEMPLATES.map(function(t){ return custom.find(function(c){ return c.id === 'tpl_' + t.id; }) || Object.assign({}, t, { id: 'tpl_' + t.id }); })
      .concat(custom.filter(function(c){ return !TEMPLATES.some(function(t){ return 'tpl_' + t.id === c.id; }); }));
  }
  async function applyTemplate(c, tplId){
    const tpl = templates().find(function(t){ return t.id === tplId; }); if(!tpl || !c.start) return 0;
    let n = 0;
    for(const st of tpl.steps){
      const day = addDays(c.start, st[0]);
      await save('piece', { title: st[4].replace(/\{p\}/g, c.product || c.name), stage: 'script', campaignId: c.id, format: st[1], voice: st[2], phase: st[3],
        product: c.product || '', postAt: day + 'T20:00', shootBy: addDays(day, -3), editBy: addDays(day, -1), cta: c.code ? 'WhatsApp link with ' + c.code : '', created: today() });
      n++;
    }
    return n;
  }

  // ---------- CSV import ----------
  function parseCSV(text){
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for(let i = 0; i < text.length; i++){
      const ch = text[i];
      if(q){ if(ch === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; }
      else if(ch === '"') q = true;
      else if(ch === ',' || ch === '\t'){ row.push(cell); cell = ''; }
      else if(ch === '\n' || ch === '\r'){ if(ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if(cell || row.length){ row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map(function(h){ return h.trim().toLowerCase(); });
    return rows.filter(function(r){ return r.some(function(c){ return c.trim(); }); }).map(function(r){ const o = {}; head.forEach(function(h, i){ o[h] = (r[i] || '').trim(); }); return o; });
  }
  function col(row, names){ for(const n of names){ for(const k in row){ if(k === n || k.indexOf(n) === 0) return row[k]; } } return ''; }
  function num(v){ const n = parseFloat(String(v || '').replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function parseWhen(v){
    v = String(v || '').trim(); if(!v) return '';
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if(m) return m[1] + '-' + m[2] + '-' + m[3] + (m[4] ? 'T' + m[4].padStart(2, '0') + ':' + m[5] : '');
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); // Meta exports use MM/DD/YYYY
    if(m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') + (m[4] ? 'T' + m[4].padStart(2, '0') + ':' + m[5] : '');
    const d = new Date(v); return isNaN(d) ? '' : iso(d);
  }
  // Meta Business Suite > Insights > Content > Export: one row per post.
  async function importResults(text){
    const rows = parseCSV(text), now = new Date().toISOString(), ps = pieces();
    let added = 0, matched = 0;
    for(const r of rows){
      const link = col(r, ['permalink', 'link']), pid = col(r, ['post id', 'media id', 'id']) || link;
      if(!pid) continue;
      const when = parseWhen(col(r, ['publish time', 'published', 'date', 'created']));
      const m = { id: 'm_' + String(pid).replace(/\W/g, '').slice(-40), postId: pid, permalink: link, publishedAt: when, caption: col(r, ['description', 'caption', 'title']).slice(0, 300),
        type: col(r, ['post type', 'type']), reach: num(col(r, ['reach', 'accounts reached'])), views: num(col(r, ['views', 'plays', 'impressions'])),
        likes: num(col(r, ['likes'])), comments: num(col(r, ['comments'])), shares: num(col(r, ['shares', 'sends'])), saves: num(col(r, ['saves'])),
        follows: num(col(r, ['follows'])), importedAt: now };
      const prev = byId(m.id);
      let piece = ps.find(function(p){ return (link && p.permalink === link) || (prev && prev.pieceId === p.id); });
      if(!piece && when) piece = ps.find(function(p){ return !p.permalink && p.postAt && Math.abs(new Date(dayOf(p.postAt)) - new Date(dayOf(when))) <= DAY && ['scheduled', 'posted', 'review'].indexOf(p.stage) !== -1; });
      if(piece){
        m.pieceId = piece.id; matched++;
        if(!piece.permalink || piece.stage !== 'posted'){ piece.permalink = link || piece.permalink; piece.stage = 'posted'; await save('piece', piece); }
      }
      await save('metric', m); added++;
    }
    return { added: added, matched: matched };
  }
  // The Notion pipeline export (and an Upbase export with the same columns): Instagram rows only.
  async function importPipeline(text){
    const rows = parseCSV(text); let n = 0;
    for(const r of rows){
      const plat = col(r, ['platforms', 'platform']);
      if(plat && !/insta/i.test(plat)) continue;
      const title = col(r, ['piece', 'title', 'name', 'task']); if(!title) continue;
      const st = col(r, ['stage', 'status']).toLowerCase();
      const stage = (STAGES.find(function(s){ return st.indexOf(s[0]) === 0 || st === s[1].toLowerCase(); }) || ['idea'])[0];
      await save('piece', { title: title, stage: stage, format: /carousel/i.test(col(r, ['format'])) ? 'Carousel' : /static|post/i.test(col(r, ['format'])) ? 'Static' : 'Reel',
        voice: /founder/i.test(col(r, ['voice'])) ? 'Founder' : 'Brand', phase: 'awareness', pillar: col(r, ['pillar']), product: /^none$/i.test(col(r, ['product'])) ? '' : col(r, ['product']),
        postAt: parseWhen(col(r, ['ig date', 'instagram date', 'post date', 'date', 'due'])), hook: col(r, ['hook']), shootSetup: col(r, ['shoot setup', 'shoot']),
        notes: [col(r, ['dependency']) ? 'Needs: ' + col(r, ['dependency']) : '', col(r, ['notes', 'description'])].filter(Boolean).join('\n'), created: today() });
      n++;
    }
    return n;
  }

  // ---------- view ----------
  function chip(view, text){ return '<button class="mk-tab' + (V.view === view ? ' on' : '') + '" data-mk-view="' + view + '">' + text + '</button>'; }
  function header(){
    let h = '<div class="mk-head"><div><div class="mk-title">Marketing</div><div class="mk-sub">Instagram · ' + ACCOUNT + '</div></div>' +
      '<div class="mk-actions"><button class="mk-btn" data-mk="log-enq">+ Log enquiry</button><button class="mk-btn" data-mk="new-piece">+ Post</button><button class="mk-btn primary" data-mk="new-camp">+ Campaign</button></div></div>';
    if(X.missing) h += '<div class="mk-note warn">Marketing isn’t set up in the cloud yet. Run <b>marketing_setup.sql</b> (in ~/PrintFarm/tt-bridge) in Supabase → SQL Editor, then reopen this tab.</div>';
    else if(X.local) h += '<div class="mk-note">Not signed in to cloud sync: marketing data is kept on this device only and isn’t shared with your team.</div>';
    return h + '<div class="mk-tabs">' + chip('overview', 'Overview') + chip('calendar', 'Calendar') + chip('pipeline', 'Pipeline') + chip('campaigns', 'Campaigns') + chip('assets', 'Assets') + chip('ideas', 'Ideas') + chip('settings', 'Settings') + '</div>';
  }
  function trend(cur, was){ if(was == null) return ''; const d = cur - was; return '<span class="mk-trend ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + (d === 0 ? 'same as' : Math.abs(d) + (d > 0 ? ' more than' : ' fewer than')) + ' last ' + '</span>'; }
  function overviewHtml(){
    const t = today(), ws = weekStart(t), lastWs = addDays(ws, -7);
    const eNow = enquiriesBetween(ws, addDays(ws, 7)), eWas = enquiriesBetween(lastWs, ws);
    const ms = t.slice(0, 7) + '-01', d = new Date(ms + 'T00:00:00'); d.setMonth(d.getMonth() - 1);
    const lastMs = iso(d), nextMs = (function(){ const x = new Date(ms + 'T00:00:00'); x.setMonth(x.getMonth() + 1); return iso(x); })();
    const aNow = newAccounts(ms, nextMs), aWas = newAccounts(lastMs, ms), h = health(), s = settings();
    let out = '<div class="mk-ns">' +
      '<div class="mk-tile hero"><div class="k">North star · this week</div><div class="v">' + eNow.n + '</div><div class="s">trade enquir' + (eNow.n === 1 ? 'y' : 'ies') + ' from Instagram ' + trend(eNow.n, eWas.n) + 'week</div><div class="s2">' + eNow.logged.length + ' logged · ' + eNow.leads.length + ' Sales-app lead' + (eNow.leads.length === 1 ? '' : 's') + '</div></div>' +
      '<div class="mk-tile hero"><div class="k">This month</div><div class="v">' + aNow.length + '</div><div class="s">new trade account' + (aNow.length === 1 ? '' : 's') + ' from Instagram ' + trend(aNow.length, aWas.length) + 'month</div><div class="s2">' + (aNow.length ? esc(aNow.map(function(o){ return o.clientName || o.displayId; }).slice(0, 3).join(', ')) : 'First orders from Instagram-sourced clients') + '</div></div>' +
    '</div>';
    out += '<div class="mk-grid"><div class="panel"><div class="panel-title">Instagram health · last 7 days vs the 30 before</div>';
    if(!h.has) out += '<p class="mk-dim">No post results yet. Once a week, export your posts from Meta Business Suite (Insights → Content → Export) and import the file here.</p>';
    out += '<div class="mk-health">' + h.rows.map(function(r){
      return '<div class="mk-h-r"><span class="mk-dot ' + r.st + '"></span><span class="mk-h-n">' + esc(r.name) + '<i>' + esc(r.note) + '</i></span><span class="mk-h-v">' + r.fmt(r.cur) + '</span><span class="mk-h-w">' + (r.name === 'Posts this week' ? 'target ' + s.cadenceMin : 'was ' + r.fmt(r.was)) + '</span></div>';
    }).join('') + '</div><div class="mk-row-a"><label class="mk-btn">Import post results<input type="file" accept=".csv,text/csv" data-mk-file="results" hidden></label>' +
      (h.lastImport ? '<span class="mk-dim">Last import ' + fmt(h.lastImport) + '</span>' : '') + '</div></div>';
    const nd = needs();
    out += '<div class="panel"><div class="panel-title">Needs attention</div>' + (nd.length ? nd.map(function(n){ return '<div class="mk-need"><span class="mk-dot ' + (n.level <= 1 ? 'bad' : 'watch') + '"></span>' + esc(n.text) + '</div>'; }).join('') : '<p class="mk-dim">Nothing waiting. The next 7 days are planned.</p>');
    const up = pieces().filter(function(p){ const d = dayOf(p.postAt); return d >= t && d < addDays(t, 7); }).sort(function(a, b){ return (a.postAt || '').localeCompare(b.postAt || ''); });
    out += '<div class="panel-title" style="margin-top:16px">Next 7 days</div>' + (up.length ? up.map(pieceRow).join('') : '<p class="mk-dim">Nothing planned.</p>') + '</div></div>';
    return out;
  }
  function pieceRow(p){
    const c = campaign(p.campaignId);
    return '<div class="mk-prow" data-mk="edit-piece" data-id="' + p.id + '"><span class="mk-cdot" style="background:' + campColour(c) + '"></span><b>' + esc(p.title || 'Untitled') + '</b>' +
      '<span class="mk-dim">' + fmt(p.postAt) + ' · ' + esc(p.format || '') + (c ? ' · ' + esc(c.name) : '') + '</span><span class="mk-stage st-' + p.stage + '">' + esc(label(STAGES, p.stage)) + '</span></div>';
  }
  function calendarHtml(){
    const base = V.month || today().slice(0, 7);
    const first = new Date(base + '-01T00:00:00'), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const t = today(), s = settings(), byDay = {};
    pieces().forEach(function(p){ const d = dayOf(p.postAt); if(d) (byDay[d] = byDay[d] || []).push(p); });
    let h = '<div class="mk-cal-head"><button class="mk-btn" data-mk="month" data-d="-1">‹</button><b>' + first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + '</b><button class="mk-btn" data-mk="month" data-d="1">›</button><button class="mk-btn" data-mk="month" data-d="0">Today</button>' +
      '<span class="mk-legend">' + campaigns().slice(0, 6).map(function(c){ return '<span><i style="background:' + campColour(c) + '"></i>' + esc(c.name) + '</span>'; }).join('') + '</span></div>';
    h += '<div class="mk-cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map(function(n){ return '<div class="mk-cal-h">' + n + '</div>'; }).join('');
    const d = new Date(start);
    for(let w = 0; w < 6; w++){
      let wk = 0;
      for(let i = 0; i < 7; i++){
        const k = iso(d), list = (byDay[k] || []).sort(function(a, b){ return (a.postAt || '').localeCompare(b.postAt || ''); });
        wk += list.filter(function(p){ return p.stage !== 'idea'; }).length;
        h += '<div class="mk-day' + (k.slice(0, 7) !== base ? ' out' : '') + (k === t ? ' today' : '') + '" data-mk="day" data-d="' + k + '"><span class="mk-dn">' + d.getDate() + '</span>' +
          list.map(function(p){ const c = campaign(p.campaignId); return '<div class="mk-chip st-' + p.stage + '" data-mk="edit-piece" data-id="' + p.id + '" style="border-left-color:' + campColour(c) + ';--c:' + campColour(c) + '" title="' + esc(label(STAGES, p.stage) + ' · ' + (p.title || '')) + '">' + esc(p.format === 'Reel' ? '▶ ' : p.format === 'Carousel' ? '▦ ' : '') + esc(p.title || 'Untitled') + '</div>'; }).join('') + '</div>';
        d.setDate(d.getDate() + 1);
      }
      h += '<div class="mk-wk ' + (wk >= s.cadenceMin ? 'ok' : wk ? 'low' : '') + '">' + wk + '<i>/' + s.cadenceMin + '</i></div>';
      if(iso(d).slice(0, 7) > base) break; // next week starts in the following month
    }
    return h + '</div><p class="mk-dim">Tap a day to add a post. The week column counts planned posts against your target of ' + s.cadenceMin + '–' + s.cadenceMax + '.</p>';
  }
  function pipelineHtml(){
    const ps = pieces();
    return '<div class="mk-board">' + STAGES.map(function(st){
      const list = ps.filter(function(p){ return p.stage === st[0]; }).sort(function(a, b){ return (a.postAt || '9').localeCompare(b.postAt || '9'); });
      const shown = st[0] === 'posted' ? list.slice(-12).reverse() : list;
      return '<div class="mk-col"><div class="mk-col-h">' + st[1] + ' <b>' + list.length + '</b></div>' + shown.map(function(p){
        const c = campaign(p.campaignId), late = p.postAt && dayOf(p.postAt) < today() && ['scheduled', 'posted'].indexOf(p.stage) === -1 && p.stage !== 'idea';
        return '<div class="mk-card" data-mk="edit-piece" data-id="' + p.id + '" style="border-left-color:' + campColour(c) + '"><b>' + esc(p.title || 'Untitled') + '</b>' +
          '<span class="' + (late ? 'mk-bad' : 'mk-dim') + '">' + (p.postAt ? fmt(p.postAt) : 'no date') + ' · ' + esc(p.format || '') + ' · ' + esc(p.voice || '') + '</span>' +
          (c ? '<span class="mk-dim">' + esc(c.name) + '</span>' : '') + '</div>';
      }).join('') + (st[0] === 'idea' ? '<button class="mk-add" data-mk="new-piece">+ Idea</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function campaignsHtml(){
    const cs = campaigns();
    if(!cs.length) return '<div class="panel"><p class="mk-dim">No campaigns yet. Start one from a template: Product launch, Festival push, Trade push or Toy drop.</p><button class="mk-btn primary" data-mk="new-camp">+ Campaign</button></div>';
    const s = settings();
    return cs.map(function(c){
      const sc = scorecard(c), waText = 'Hi, I saw the ' + c.name + (c.code ? ' (' + c.code + ')' : '') + ' on Instagram. Please share details.';
      const link = 'https://wa.me/' + waPhone(s.waPhone) + '?text=' + encodeURIComponent(waText);
      function goal(cur, target, name){ if(!target) return ''; const p = Math.min(100, Math.round(cur / target * 100)); return '<div class="mk-goal"><span>' + name + ' <b>' + cur + '</b> / ' + target + '</span><i><i style="width:' + p + '%"></i></i></div>'; }
      return '<div class="panel mk-camp"><div class="mk-camp-h"><span class="mk-cdot" style="background:' + campColour(c) + '"></span><b>' + esc(c.name) + '</b>' +
        '<span class="mk-pill">' + esc(label(PHASES, c.phase)) + '</span><span class="mk-dim">' + fmt(c.start) + (c.end ? ' – ' + fmt(c.end) : '') + '</span>' +
        (c.code ? '<span class="mk-code">' + esc(c.code) + '</span>' : '') +
        '<span class="mk-camp-a"><button class="mk-btn" data-mk="copy" data-v="' + esc(link) + '">Copy WhatsApp link</button><button class="mk-btn" data-mk="edit-camp" data-id="' + c.id + '">Edit</button></span></div>' +
        (c.goal ? '<p class="mk-dim">Goal: ' + esc(c.goal) + '</p>' : '') +
        '<div class="mk-goals">' + goal(sc.enquiries, +c.targetEnquiries || 0, 'Enquiries') + goal(sc.orders, +c.targetOrders || 0, 'Orders') + '</div>' +
        '<div class="mk-sc">' +
          '<div><i>Posts</i><b>' + sc.posted + '/' + sc.pieces + '</b></div>' +
          '<div><i>Reach</i><b>' + sc.reach.toLocaleString('en-IN') + '</b></div>' +
          '<div><i>Sends / reach</i><b>' + pct(sc.sendsRate) + '</b></div>' +
          '<div><i>Enquiries</i><b>' + sc.enquiries + '</b></div>' +
          '<div><i>Orders</i><b>' + sc.orders + '</b></div>' +
          '<div><i>Revenue</i><b>' + money(sc.revenue) + '</b></div>' +
          '<div><i>New accounts</i><b>' + sc.accounts + '</b></div>' +
          '<div><i>Cost / enquiry</i><b>' + (sc.perEnquiry == null ? '—' : money(sc.perEnquiry)) + '</b></div>' +
          '<div><i>Cost / new account</i><b>' + (sc.perAccount == null ? '—' : money(sc.perAccount)) + '</b></div>' +
        '</div>' + (c.keyword ? '<p class="mk-dim">DM keyword: <b>' + esc(c.keyword) + '</b></p>' : '') + '</div>';
    }).join('');
  }
  function assetsHtml(){
    const s = settings(), q = V.assetQ.toLowerCase();
    const list = kind('asset').filter(function(a){
      return (!V.assetSt || a.status === V.assetSt) && (!q || [a.title, a.product, (a.tags || []).join(' '), (campaign(a.campaignId) || {}).name].join(' ').toLowerCase().indexOf(q) !== -1);
    }).sort(function(a, b){ return (b.added || '').localeCompare(a.added || ''); });
    const used = {}; pieces().forEach(function(p){ (p.assetIds || []).forEach(function(id){ (used[id] = used[id] || []).push(p); }); });
    let h = '<div class="mk-a-bar"><input data-mk-q placeholder="Search title, product, tag, campaign" value="' + esc(V.assetQ) + '"><select data-mk-ast><option value="">All statuses</option>' + opts(ASSET_STATUS, V.assetSt) + '</select>' +
      (s.driveFolder ? '<a class="mk-btn" href="' + esc(s.driveFolder) + '" target="_blank" rel="noopener">Open Drive folder</a>' : '') +
      '<button class="mk-btn primary" data-mk="new-asset">+ Add from Drive</button></div>';
    if(!s.driveFolder) h += '<p class="mk-dim">Files live in Google Drive. Add your shared marketing folder in Settings so everyone opens the same place.</p>';
    if(!list.length) return h + '<p class="mk-dim">' + (kind('asset').length ? 'No assets match.' : 'No assets yet. Paste Google Drive links to add them.') + '</p>';
    return h + '<div class="mk-assets">' + list.map(function(a){
      const c = campaign(a.campaignId), th = thumb(a), u = used[a.id] || [];
      return '<div class="mk-asset"><a class="mk-thumb" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + (th ? '<img src="' + esc(th) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span>' + esc((a.type || 'File').slice(0, 5)) + '</span>') + '</a>' +
        '<div class="mk-asset-b"><b>' + esc(a.title || 'Untitled') + '</b><span class="mk-dim">' + esc([a.product, c && c.name].filter(Boolean).join(' · ') || '—') + '</span>' +
        ((a.tags || []).length ? '<span class="mk-tags">' + a.tags.map(function(t){ return '<i>' + esc(t) + '</i>'; }).join('') + '</span>' : '') +
        '<select data-mk-asset-st="' + a.id + '">' + opts(ASSET_STATUS, a.status) + '</select>' +
        '<span class="mk-dim">' + (u.length ? 'Used in ' + u.length + ' post' + (u.length === 1 ? '' : 's') : 'Not used yet') + ' · <a href="#" data-mk="edit-asset" data-id="' + a.id + '">Edit</a></span></div></div>';
    }).join('') + '</div>';
  }
  function ideasHtml(){
    const list = ideas();
    if(!list.length) return '<div class="panel"><p class="mk-dim">No new ideas from the business right now. They come from new catalogue products, big finished orders, top sellers and the Upsell analysis.</p></div>';
    return '<div class="mk-ideas">' + list.map(function(i){
      return '<div class="panel mk-idea"><span class="mk-pill">' + esc(i.kind) + '</span><b>' + esc(i.title) + '</b><p class="mk-dim">' + esc(i.why) + '</p>' +
        '<div class="mk-row-a"><button class="mk-btn primary" data-mk="idea-add" data-id="' + esc(i.id) + '">Add to pipeline</button><button class="mk-btn" data-mk="idea-skip" data-id="' + esc(i.id) + '">Dismiss</button></div></div>';
    }).join('') + '</div>';
  }
  function settingsHtml(){
    const s = settings();
    let h = '<div class="mk-grid"><div class="panel"><div class="panel-title">Basics</div>' +
      '<label>Shared Google Drive folder</label><input data-mk-set="driveFolder" placeholder="https://drive.google.com/drive/folders/…" value="' + esc(s.driveFolder) + '">' +
      '<label>WhatsApp number for campaign links</label><input data-mk-set="waPhone" value="' + esc(s.waPhone) + '">' +
      '<div class="mk-2"><div><label>Posts a week, at least</label><input type="number" min="0" data-mk-set="cadenceMin" value="' + s.cadenceMin + '"></div><div><label>at most</label><input type="number" min="0" data-mk-set="cadenceMax" value="' + s.cadenceMax + '"></div></div>' +
      '<div class="panel-title" style="margin-top:16px">Import</div>' +
      '<p class="mk-dim">Post results: Meta Business Suite → Insights → Content → Export (CSV). Pipeline: the Notion or Upbase content pipeline export (CSV); only Instagram rows are taken.</p>' +
      '<div class="mk-row-a"><label class="mk-btn">Import post results<input type="file" accept=".csv,text/csv" data-mk-file="results" hidden></label><label class="mk-btn">Import pipeline CSV<input type="file" accept=".csv,text/csv" data-mk-file="pipeline" hidden></label></div></div>';
    h += '<div class="panel"><div class="panel-title">Team</div>' + (X.local || X.missing ? '<p class="mk-dim">Sign in to cloud sync (and run the setup) to add your content creator.</p>' :
      (X.team.length ? X.team.map(function(m){ return '<div class="mk-team"><b>' + esc(m.name) + '</b><span class="mk-dim">' + esc(m.email) + ' · ' + esc(m.role) + (m.active ? '' : ' · off') + '</span><button class="mk-btn" data-mk="team-toggle" data-id="' + esc(m.email) + '">' + (m.active ? 'Turn off' : 'Turn on') + '</button></div>'; }).join('') : '<p class="mk-dim">No one yet.</p>') +
      '<div class="mk-2"><input data-mk-team="name" placeholder="Name"><input data-mk-team="email" placeholder="Email they sign in with"></div><select data-mk-team="role">' + opts([['creator', 'Content creator'], ['manager', 'Marketing manager']], 'creator') + '</select><button class="mk-btn primary" data-mk="team-add">Add to team</button>');
    h += '<div class="panel-title" style="margin-top:16px">Campaign templates</div>' + templates().map(function(t){
      return '<details class="mk-tpl"><summary>' + esc(t.name) + ' <span class="mk-dim">' + t.steps.length + ' posts</span></summary><textarea data-mk-tpl="' + esc(t.id) + '" rows="' + (t.steps.length + 1) + '">' +
        esc(t.steps.map(function(st){ return [st[0], st[1], st[2], st[3], st[4]].join(' | '); }).join('\n')) + '</textarea><p class="mk-dim">One post a line: days from the campaign date | format | voice | phase | title ({p} = product).</p></details>';
    }).join('') + '</div></div>';
    return h;
  }

  function render(){
    const root = document.getElementById('marketingRoot'); if(!root) return;
    if(!X.loaded){ root.innerHTML = '<p class="mk-dim">Loading…</p>'; load().then(render); return; }
    const body = V.view === 'calendar' ? calendarHtml() : V.view === 'pipeline' ? pipelineHtml() : V.view === 'campaigns' ? campaignsHtml() :
      V.view === 'assets' ? assetsHtml() : V.view === 'ideas' ? ideasHtml() : V.view === 'settings' ? settingsHtml() : overviewHtml();
    root.innerHTML = header() + body;
  }
  window.renderMarketing = function(){ X.loaded = false; render(); };

  // ---------- forms (one modal for every editor) ----------
  let modal = null;
  function openModal(title, html, onSave, extra){
    if(!modal){ modal = document.createElement('div'); modal.className = 'mk-modal'; document.body.appendChild(modal); }
    modal.innerHTML = '<div class="mk-box"><div class="mk-box-h"><b>' + esc(title) + '</b><button class="mk-x" data-mkm="close">✕</button></div><div class="mk-box-b">' + html + '</div>' +
      '<div class="mk-box-f">' + (extra || '') + '<span style="flex:1"></span><button class="mk-btn" data-mkm="close">Cancel</button><button class="mk-btn primary" data-mkm="save">Save</button></div></div>';
    modal.classList.add('on');
    modal.onclick = async function(e){
      const b = e.target.closest('[data-mkm]'); if(!b && e.target !== modal) return;
      const a = b ? b.getAttribute('data-mkm') : 'close';
      if(a === 'close'){ modal.classList.remove('on'); return; }
      if(a === 'save'){ const ok = await onSave(field); if(ok !== false){ modal.classList.remove('on'); render(); } return; }
      if(a === 'delete' && b.dataset.id){ showConfirmModal('Delete this for everyone?', async function(){ await remove(b.dataset.id); modal.classList.remove('on'); render(); }, 'Delete'); }
    };
  }
  function field(name){ const el = modal.querySelector('[name="' + name + '"]'); if(!el) return ''; if(el.type === 'checkbox') return el.checked; if(el.multiple) return [].filter.call(el.options, function(o){ return o.selected; }).map(function(o){ return o.value; }); return el.value.trim(); }
  function inp(name, labelText, val, type, ph){ return '<label>' + labelText + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></label>'; }
  function sel(name, labelText, list, cur){ return '<label>' + labelText + '<select name="' + name + '">' + opts(list, cur) + '</select></label>'; }
  function area(name, labelText, val, ph){ return '<label>' + labelText + '<textarea name="' + name + '" rows="3"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>' + esc(val || '') + '</textarea></label>'; }
  function productList(){ return [['', '—']].concat((state.productCatalog || []).filter(function(c){ return c.name; }).map(function(c){ return [c.name, c.name]; })); }
  function campaignList(){ return [['', 'No campaign']].concat(campaigns().map(function(c){ return [c.id, c.name]; })); }

  function editPiece(p){
    p = p || { stage: 'idea', format: 'Reel', voice: 'Brand', phase: 'awareness' };
    const assets = kind('asset');
    const html = inp('title', 'Title', p.title) +
      '<div class="mk-2">' + sel('stage', 'Stage', STAGES, p.stage) + inp('postAt', 'Post on', p.postAt ? String(p.postAt).slice(0, 16) : '', 'datetime-local') + '</div>' +
      '<div class="mk-3">' + sel('format', 'Format', FORMATS, p.format) + sel('voice', 'Voice', VOICES, p.voice) + sel('phase', 'Funnel phase', PHASES, p.phase) + '</div>' +
      '<div class="mk-2">' + sel('campaignId', 'Campaign', campaignList(), p.campaignId || '') + sel('product', 'Product', productList(), p.product || '') + '</div>' +
      area('hook', 'Hook (first 2 seconds)', p.hook) + '<div class="mk-2">' + area('shootSetup', 'Shoot setup', p.shootSetup) + area('caption', 'Caption', p.caption) + '</div>' +
      '<div class="mk-2">' + inp('shootBy', 'Shoot by', p.shootBy, 'date') + inp('editBy', 'Edit by', p.editBy, 'date') + '</div>' +
      inp('cta', 'Call to action', p.cta, 'text', 'e.g. WhatsApp link with KARA25, or DM KARA') +
      (assets.length ? '<label>Assets<select name="assetIds" multiple size="4">' + assets.map(function(a){ return '<option value="' + a.id + '"' + ((p.assetIds || []).indexOf(a.id) !== -1 ? ' selected' : '') + '>' + esc(a.title || a.url) + '</option>'; }).join('') + '</select></label>' : '') +
      inp('permalink', 'Instagram link (once posted)', p.permalink) + area('notes', 'Notes', p.notes);
    openModal(p.id ? 'Edit post' : 'New post', html, async function(f){
      if(!f('title')){ showNoticeModal('Give the post a title.'); return false; }
      ['title', 'stage', 'format', 'voice', 'phase', 'campaignId', 'product', 'hook', 'shootSetup', 'caption', 'shootBy', 'editBy', 'cta', 'permalink', 'notes', 'postAt'].forEach(function(k){ p[k] = f(k); });
      if(assets.length) p.assetIds = f('assetIds');
      if(!p.created) p.created = today();
      await save('piece', p); showToast('Post saved');
    }, p.id ? '<button class="mk-btn danger" data-mkm="delete" data-id="' + p.id + '">Delete</button>' : '');
  }
  function editCampaign(c){
    const isNew = !c; c = c || { phase: 'conversion', start: addDays(today(), 7) };
    const html = inp('name', 'Campaign name', c.name, 'text', 'e.g. Kara launch') +
      '<div class="mk-2">' + sel('product', 'Product', productList(), c.product || '') + sel('phase', 'Funnel phase', PHASES, c.phase) + '</div>' +
      '<div class="mk-2">' + inp('start', 'Campaign date (launch day)', c.start, 'date') + inp('end', 'Ends', c.end, 'date') + '</div>' +
      inp('goal', 'Goal, in one line', c.goal, 'text', 'e.g. 15 trade enquiries and 3 first orders in 30 days') +
      '<div class="mk-3">' + inp('targetEnquiries', 'Target enquiries', c.targetEnquiries, 'number') + inp('targetOrders', 'Target orders', c.targetOrders, 'number') + inp('budget', 'Budget / cost (₹)', c.budget, 'number') + '</div>' +
      '<div class="mk-3">' + inp('code', 'Campaign code', c.code, 'text', 'e.g. KARA25') + inp('keyword', 'DM keyword', c.keyword, 'text', 'e.g. KARA') + inp('colour', 'Colour', c.colour || COLOURS[campaigns().length % COLOURS.length], 'color') + '</div>' +
      (isNew ? sel('template', 'Start from a template', [['', 'Blank — add posts yourself']].concat(templates().map(function(t){ return [t.id, t.name + ' (' + t.steps.length + ' posts)']; })), 'tpl_launch') : '');
    openModal(isNew ? 'New campaign' : 'Edit campaign', html, async function(f){
      if(!f('name')){ showNoticeModal('Give the campaign a name.'); return false; }
      ['name', 'product', 'phase', 'start', 'end', 'goal', 'targetEnquiries', 'targetOrders', 'budget', 'keyword', 'colour'].forEach(function(k){ c[k] = f(k); });
      c.code = (f('code') || (c.name.replace(/[^a-z0-9]/gi, '').slice(0, 6) + (c.start || '').slice(8, 10))).toUpperCase();
      await save('campaign', c);
      const n = isNew && f('template') ? await applyTemplate(c, f('template')) : 0;
      showToast(n ? 'Campaign created with ' + n + ' posts' : 'Campaign saved');
      if(n){ V.view = 'calendar'; V.month = (c.start || today()).slice(0, 7); }
    }, !isNew ? '<button class="mk-btn danger" data-mkm="delete" data-id="' + c.id + '">Delete</button>' : '');
  }
  function editAsset(a){
    const isNew = !a; a = a || { status: 'raw' };
    const html = (isNew ? area('urls', 'Google Drive links, one a line', '', 'https://drive.google.com/file/d/…') : inp('url', 'Google Drive link', a.url)) +
      inp('title', isNew ? 'Title (optional, used for all)' : 'Title', a.title) +
      '<div class="mk-2">' + sel('product', 'Product', productList(), a.product || '') + sel('campaignId', 'Campaign', campaignList(), a.campaignId || '') + '</div>' +
      '<div class="mk-2">' + sel('type', 'Type', ['Reel', 'Photo', 'Raw footage', 'Carousel', 'Catalogue', 'Brand file'], a.type || 'Photo') + sel('status', 'Status', ASSET_STATUS, a.status) + '</div>' +
      inp('tags', 'Tags, comma separated', (a.tags || []).join(', '), 'text', 'e.g. night shot, warm white, flat lay') +
      '<label class="mk-check"><input type="checkbox" name="rights"' + (a.rights ? ' checked' : '') + '> Has people or client products: permission recorded</label>';
    openModal(isNew ? 'Add assets from Drive' : 'Edit asset', html, async function(f){
      const common = { title: f('title'), product: f('product'), campaignId: f('campaignId'), type: f('type'), status: f('status'), tags: f('tags').split(',').map(function(t){ return t.trim(); }).filter(Boolean), rights: f('rights') };
      if(isNew){
        const urls = f('urls').split(/\s+/).filter(function(u){ return /^https?:\/\//.test(u); });
        if(!urls.length){ showNoticeModal('Paste at least one Google Drive link.'); return false; }
        for(let i = 0; i < urls.length; i++) await save('asset', Object.assign({}, common, { url: urls[i], title: common.title ? common.title + (urls.length > 1 ? ' ' + (i + 1) : '') : 'Drive file ' + driveId(urls[i]).slice(0, 6), added: new Date().toISOString() }));
        showToast(urls.length + ' asset' + (urls.length === 1 ? '' : 's') + ' added');
      } else { Object.assign(a, common, { url: f('url') }); await save('asset', a); showToast('Asset saved'); }
    }, !isNew ? '<button class="mk-btn danger" data-mkm="delete" data-id="' + a.id + '">Delete</button>' : '');
  }
  function logEnquiry(){
    const html = '<div class="mk-2">' + inp('date', 'Date', today(), 'date') + sel('via', 'Came in by', ['Instagram DM', 'WhatsApp (from Instagram)', 'Comment', 'Call'], 'Instagram DM') + '</div>' +
      '<div class="mk-2">' + inp('name', 'Business or person', '') + inp('phone', 'Phone (optional)', '', 'tel') + '</div>' + sel('campaignId', 'Campaign (if they mentioned a code or post)', campaignList(), '') +
      (window.TTSales && window.TTSales.createLead ? sel('channel', 'Hand to a salesperson as a lead', [['', 'No, just count it'], ['toys', 'Toys'], ['lighting', 'Lighting'], ['gifting', 'HoReCa & gifting']], '') : '') +
      '<label class="mk-check"><input type="checkbox" name="trade" checked> Trade enquiry (dealer, wholesaler, reseller, corporate)</label>' + area('note', 'Note', '') +
      '<p class="mk-dim">Don’t log ones a rep has already added as a lead with source Instagram; those are counted already.</p>';
    openModal('Log an Instagram enquiry', html, async function(f){
      if(!f('trade')){ showToast('Only trade enquiries count toward the north star'); }
      const ch = f('channel'), c = campaign(f('campaignId'));
      let leadNote = '';
      if(ch && window.TTSales && window.TTSales.createLead){
        if(!f('name')){ showNoticeModal('Add the business or person to hand it to a salesperson.'); return false; }
        const r = await window.TTSales.createLead(ch, { business: f('name'), phone: f('phone'), notes: [f('via'), c ? 'Campaign ' + c.name + (c.code ? ' (' + c.code + ')' : '') : '', f('note')].filter(Boolean).join(' \u00b7 '), campaignId: f('campaignId') || '', campaign: c ? c.code || c.name : '' });
        // Leads with source Instagram already count toward the north star, so don't count it twice.
        if(r.ok){ showToast('Lead created' + (r.owner ? ' for ' + r.owner : '') + '; it counts as an Instagram enquiry'); return; }
        leadNote = ' (lead not created: ' + r.why + ')';
      }
      await save('enquiry', { date: f('date'), via: f('via'), name: f('name'), phone: f('phone'), campaignId: f('campaignId'), trade: f('trade'), note: f('note') });
      showToast('Enquiry logged' + leadNote);
    });
  }

  // ---------- events ----------
  function inTab(e){ const t = document.getElementById('tabMarketing'); return t && t.contains(e.target); }
  document.addEventListener('click', async function(e){
    if(!inTab(e)) return;
    const v = e.target.closest('[data-mk-view]'); if(v){ V.view = v.getAttribute('data-mk-view'); render(); return; }
    const b = e.target.closest('[data-mk]'); if(!b) return;
    const a = b.getAttribute('data-mk'), id = b.getAttribute('data-id');
    if(b.tagName === 'A') e.preventDefault();
    if(a === 'edit-piece'){ e.stopPropagation(); editPiece(byId(id)); }
    else if(a === 'new-piece') editPiece(null);
    else if(a === 'day'){ editPiece({ stage: 'idea', format: 'Reel', voice: 'Brand', phase: 'awareness', postAt: b.getAttribute('data-d') + 'T20:00' }); }
    else if(a === 'new-camp') editCampaign(null);
    else if(a === 'edit-camp') editCampaign(byId(id));
    else if(a === 'new-asset') editAsset(null);
    else if(a === 'edit-asset') editAsset(byId(id));
    else if(a === 'log-enq') logEnquiry();
    else if(a === 'month'){ const d = +b.getAttribute('data-d'); if(!d) V.month = null; else { const m = new Date((V.month || today().slice(0, 7)) + '-01T00:00:00'); m.setMonth(m.getMonth() + d); V.month = iso(m).slice(0, 7); } render(); }
    else if(a === 'copy'){ const t = b.getAttribute('data-v'); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function(){ showToast('Link copied'); }).catch(function(){ prompt('Copy:', t); }); }
    else if(a === 'idea-add' || a === 'idea-skip'){
      const i = ideas().find(function(x){ return x.id === id; }); if(!i) return;
      if(a === 'idea-add') await save('piece', { title: i.title, stage: 'idea', product: i.product, format: i.format, voice: 'Brand', phase: i.phase, notes: i.kind + ': ' + i.why, created: today() });
      const d = Object.assign({}, settings().dismissed); d[id] = today(); await saveSettings({ dismissed: d });
      showToast(a === 'idea-add' ? 'Added to the pipeline as an idea' : 'Dismissed'); render();
    }
    else if(a === 'team-add'){
      const root = document.getElementById('marketingRoot'), g = function(k){ const el = root.querySelector('[data-mk-team="' + k + '"]'); return el ? el.value.trim() : ''; };
      const email = g('email').toLowerCase();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !g('name')){ showNoticeModal('Add a name and a valid email.'); return; }
      const r = await cloud.sb.from('mkt_team').upsert({ email: email, name: g('name'), role: g('role') || 'creator', active: true });
      if(r.error){ showNoticeModal('Couldn’t add: ' + r.error.message); return; }
      X.loaded = false; render(); showToast(g('name') + ' added');
    }
    else if(a === 'team-toggle'){
      const m = X.team.find(function(x){ return x.email === id; }); if(!m) return;
      const r = await cloud.sb.from('mkt_team').update({ active: !m.active }).eq('email', id);
      if(r.error){ showNoticeModal(r.error.message); return; }
      X.loaded = false; render();
    }
  });
  document.addEventListener('change', async function(e){
    if(!inTab(e)) return;
    const t = e.target;
    if(t.hasAttribute('data-mk-file')){
      const f = t.files && t.files[0]; if(!f) return;
      const text = await f.text();
      if(t.getAttribute('data-mk-file') === 'results'){ const r = await importResults(text); showNoticeModal('Imported ' + r.added + ' post' + (r.added === 1 ? '' : 's') + '; ' + r.matched + ' matched to posts in the calendar.'); }
      else { const n = await importPipeline(text); showNoticeModal('Imported ' + n + ' Instagram post' + (n === 1 ? '' : 's') + ' into the pipeline.'); }
      t.value = ''; render();
    } else if(t.hasAttribute('data-mk-set')){
      const k = t.getAttribute('data-mk-set'), val = /cadence/.test(k) ? Math.max(0, Math.round(+t.value || 0)) : t.value.trim();
      await saveSettings({ [k]: val }); showToast('Saved');
    } else if(t.hasAttribute('data-mk-asset-st')){
      const a = byId(t.getAttribute('data-mk-asset-st')); if(!a) return; a.status = t.value; await save('asset', a); showToast('Status updated');
    } else if(t.hasAttribute('data-mk-ast')){ V.assetSt = t.value; render(); }
    else if(t.hasAttribute('data-mk-tpl')){
      const id = t.getAttribute('data-mk-tpl'), base = templates().find(function(x){ return x.id === id; }); if(!base) return;
      const steps = t.value.split('\n').map(function(l){ const p = l.split('|').map(function(x){ return x.trim(); }); return p.length >= 5 && isFinite(+p[0]) ? [+p[0], p[1], p[2], p[3], p.slice(4).join(' | ')] : null; }).filter(Boolean);
      if(!steps.length){ showNoticeModal('Each line needs: days | format | voice | phase | title'); return; }
      await save('template', { id: id, name: base.name, phase: base.phase, steps: steps }); showToast('Template saved');
    }
  });
  document.addEventListener('input', function(e){
    if(!inTab(e) || !e.target.hasAttribute('data-mk-q')) return;
    V.assetQ = e.target.value; const pos = e.target.selectionStart; render();
    const el = document.querySelector('#marketingRoot [data-mk-q]'); if(el){ el.focus(); try{ el.setSelectionRange(pos, pos); }catch(err){} }
  });

  // For Home (Needs you) and the order pop-up's Campaign field.
  window.TTMarketing = { needs: needs, campaigns: campaigns, pieces: pieces, team: function(){ return X.team; }, save: save,
    // For Product Lab: a launch campaign laid out from a template (posts start at Script).
    createCampaign: async function(c, tplId){ if(!X.loaded) await load(); await save('campaign', c); return tplId ? applyTemplate(c, tplId) : 0; }, load: function(){ return X.loaded ? Promise.resolve() : load(); }, loaded: function(){ return X.loaded; } };
  setTimeout(function(){ load().catch(function(){}); }, 3000);

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent = [
    '#tabMarketing{font-family:"Space Grotesk",sans-serif}',
    '#tabMarketing .mk-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin:4px 0 14px}',
    '#tabMarketing .mk-title{font-size:26px;font-weight:700;color:var(--text)}',
    '#tabMarketing .mk-sub,#tabMarketing .mk-dim{color:var(--dim);font-size:12.5px}',
    '#tabMarketing p.mk-dim{margin:4px 0 10px}',
    '#tabMarketing .mk-bad{color:var(--red);font-size:12.5px}',
    '#tabMarketing .mk-actions,#tabMarketing .mk-row-a{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.mk-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:7px 13px;font:13px "Space Grotesk",sans-serif;cursor:pointer;text-decoration:none;display:inline-block}',
    '.mk-btn:hover{border-color:var(--cyan)}',
    '.mk-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#06201d;font-weight:600}',
    '.mk-btn.danger{color:var(--red);border-color:rgba(232,97,90,.45);background:transparent}',
    '#tabMarketing .mk-note{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px}',
    '#tabMarketing .mk-note.warn{border-color:var(--amber);background:rgba(240,168,60,.08)}',
    '#tabMarketing .mk-tabs{display:flex;gap:4px;flex-wrap:wrap;background:var(--input-bg);border-radius:12px;padding:4px;margin-bottom:14px;width:fit-content;max-width:100%}',
    '#tabMarketing .mk-tab{border:none;background:transparent;border-radius:9px;padding:8px 14px;font:13.5px "Space Grotesk",sans-serif;color:var(--dim);cursor:pointer}',
    '#tabMarketing .mk-tab.on{background:var(--panel);color:var(--text);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '#tabMarketing .mk-ns{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:14px}',
    '#tabMarketing .mk-tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;position:relative;overflow:hidden}',
    '#tabMarketing .mk-tile::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:var(--cyan)}',
    '#tabMarketing .mk-tile .k{font:10.5px "JetBrains Mono",monospace;letter-spacing:1px;text-transform:uppercase;color:var(--dim)}',
    '#tabMarketing .mk-tile .v{font-size:34px;font-weight:700;color:var(--text);margin-top:4px}',
    '#tabMarketing .mk-tile .s{font-size:13px;color:var(--text)}',
    '#tabMarketing .mk-tile .s2{font-size:12px;color:var(--dim);margin-top:4px}',
    '#tabMarketing .mk-trend{color:var(--dim)} #tabMarketing .mk-trend.up{color:var(--green)} #tabMarketing .mk-trend.down{color:var(--red)}',
    '#tabMarketing .mk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start}',
    '#tabMarketing .mk-health{display:flex;flex-direction:column}',
    '#tabMarketing .mk-h-r{display:grid;grid-template-columns:14px 1fr auto auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line);font-size:13.5px}',
    '#tabMarketing .mk-h-n i{display:block;font-style:normal;font-size:11.5px;color:var(--dim)}',
    '#tabMarketing .mk-h-v{font:600 14px "JetBrains Mono",monospace;color:var(--text)}',
    '#tabMarketing .mk-h-w{font-size:12px;color:var(--dim);min-width:80px;text-align:right}',
    '#tabMarketing .mk-dot{width:9px;height:9px;border-radius:50%;background:var(--line);display:inline-block;flex:none}',
    '#tabMarketing .mk-dot.good{background:var(--green)} #tabMarketing .mk-dot.watch{background:var(--amber)} #tabMarketing .mk-dot.bad{background:var(--red)}',
    '#tabMarketing .mk-need{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line);font-size:13.5px}',
    '#tabMarketing .mk-prow{display:grid;grid-template-columns:10px 1fr auto;grid-template-areas:"d t s" "d m s";gap:2px 10px;align-items:center;padding:8px 0;border-top:1px solid var(--line);cursor:pointer;font-size:13.5px}',
    '#tabMarketing .mk-prow .mk-cdot{grid-area:d} #tabMarketing .mk-prow b{grid-area:t;font-weight:600} #tabMarketing .mk-prow .mk-dim{grid-area:m} #tabMarketing .mk-prow .mk-stage{grid-area:s}',
    '#tabMarketing .mk-cdot{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none}',
    '#tabMarketing .mk-stage,#tabMarketing .mk-pill{font:10.5px "JetBrains Mono",monospace;letter-spacing:.6px;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;padding:2px 8px;color:var(--dim);white-space:nowrap}',
    '#tabMarketing .st-scheduled{color:var(--cyan);border-color:rgba(79,209,197,.5)} #tabMarketing .st-posted{color:var(--green);border-color:rgba(126,208,138,.5)} #tabMarketing .st-review{color:var(--amber);border-color:rgba(240,168,60,.5)}',
    '#tabMarketing .mk-cal-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}',
    '#tabMarketing .mk-cal-head b{font-size:16px;min-width:140px;text-align:center}',
    '#tabMarketing .mk-legend{display:flex;gap:10px;flex-wrap:wrap;margin-left:auto;font-size:12px;color:var(--dim)}',
    '#tabMarketing .mk-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}',
    '#tabMarketing .mk-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr)) 54px;gap:4px}',
    '#tabMarketing .mk-cal-h{font:10.5px "JetBrains Mono",monospace;color:var(--dim);text-transform:uppercase;text-align:center;padding:4px 0}',
    '#tabMarketing .mk-day{background:var(--panel);border:1px solid var(--line);border-radius:8px;min-height:96px;padding:5px;cursor:pointer;display:flex;flex-direction:column;gap:3px;min-width:0}',
    '#tabMarketing .mk-day:hover{border-color:var(--cyan)}',
    '#tabMarketing .mk-day.out{opacity:.45} #tabMarketing .mk-day.today{border-color:var(--cyan);box-shadow:inset 0 0 0 1px var(--cyan)}',
    '#tabMarketing .mk-dn{font-size:11.5px;color:var(--dim)}',
    '#tabMarketing .mk-chip{font-size:11.5px;background:var(--input-bg);border-left:3px solid var(--dim);border-radius:4px;padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}',
    '#tabMarketing .mk-chip.st-idea{opacity:.6;border-style:dashed} #tabMarketing .mk-chip.st-posted{text-decoration:none;opacity:.75}',
    '#tabMarketing .mk-wk{display:flex;align-items:center;justify-content:center;font:600 15px "JetBrains Mono",monospace;color:var(--dim);border-radius:8px;background:var(--input-bg)}',
    '#tabMarketing .mk-wk i{font-style:normal;font-size:11px;font-weight:400}',
    '#tabMarketing .mk-wk.ok{color:var(--green)} #tabMarketing .mk-wk.low{color:var(--amber)}',
    '#tabMarketing .mk-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(210px,1fr);gap:10px;overflow-x:auto;padding-bottom:8px}',
    '#tabMarketing .mk-col{background:var(--input-bg);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:120px}',
    '#tabMarketing .mk-col-h{font:11px "JetBrains Mono",monospace;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);padding:2px 4px 4px}',
    '#tabMarketing .mk-card{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--dim);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;cursor:pointer;font-size:13px}',
    '#tabMarketing .mk-card:hover{border-color:var(--cyan)}',
    '#tabMarketing .mk-add{border:1px dashed var(--line);background:transparent;border-radius:8px;padding:7px;color:var(--dim);cursor:pointer;font:13px "Space Grotesk",sans-serif}',
    '#tabMarketing .mk-camp-h{display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap;font-size:15px}',
    '#tabMarketing .mk-camp-a{margin-left:auto;display:flex;gap:6px}',
    '#tabMarketing .mk-code{font:600 12px "JetBrains Mono",monospace;background:var(--input-bg);border-radius:6px;padding:2px 8px}',
    '#tabMarketing .mk-goals{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:10px 0}',
    '#tabMarketing .mk-goal span{font-size:13px} #tabMarketing .mk-goal > i{display:block;height:6px;background:var(--line);border-radius:3px;margin-top:4px;overflow:hidden} #tabMarketing .mk-goal > i > i{display:block;height:100%;background:var(--cyan)}',
    '#tabMarketing .mk-sc{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}',
    '#tabMarketing .mk-sc div{background:var(--input-bg);border-radius:9px;padding:8px 10px}',
    '#tabMarketing .mk-sc i{display:block;font-style:normal;font-size:11px;color:var(--dim)} #tabMarketing .mk-sc b{font:600 15px "JetBrains Mono",monospace}',
    '#tabMarketing .mk-a-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
    '#tabMarketing .mk-a-bar input{flex:1 1 240px;min-height:38px;border-radius:9px}',
    '#tabMarketing .mk-a-bar select{min-height:38px;border-radius:9px}',
    '#tabMarketing .mk-assets{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}',
    '#tabMarketing .mk-asset{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}',
    '#tabMarketing .mk-thumb{aspect-ratio:4/3;background:var(--input-bg);display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:12px;text-decoration:none}',
    '#tabMarketing .mk-thumb img{width:100%;height:100%;object-fit:cover}',
    '#tabMarketing .mk-asset-b{padding:10px;display:flex;flex-direction:column;gap:5px;font-size:13px}',
    '#tabMarketing .mk-asset-b select{min-height:32px;border-radius:8px;font-size:12.5px}',
    '#tabMarketing .mk-tags{display:flex;gap:4px;flex-wrap:wrap} #tabMarketing .mk-tags i{font-style:normal;font-size:11px;background:var(--input-bg);border-radius:999px;padding:1px 7px;color:var(--dim)}',
    '#tabMarketing .mk-ideas{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}',
    '#tabMarketing .mk-idea{display:flex;flex-direction:column;gap:6px;margin:0} #tabMarketing .mk-idea .mk-pill{align-self:flex-start}',
    '#tabMarketing label{display:block;font-size:12px;color:var(--dim);margin:8px 0 4px}',
    '#tabMarketing .panel input:not([type=checkbox]):not([type=file]),#tabMarketing .panel select,#tabMarketing .panel textarea{width:100%;box-sizing:border-box;border-radius:9px;min-height:38px;font-family:"Space Grotesk",sans-serif}',
    '#tabMarketing .mk-2,.mk-box .mk-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.mk-box .mk-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}',
    '#tabMarketing .mk-team{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)}',
    '#tabMarketing .mk-team .mk-btn{margin-left:auto}',
    '#tabMarketing .mk-tpl summary{cursor:pointer;padding:6px 0;font-size:13.5px} #tabMarketing .mk-tpl textarea{font:12px "JetBrains Mono",monospace!important}',
    '.mk-modal{position:fixed;inset:0;z-index:1100;background:rgba(5,8,12,.6);display:none;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow-y:auto}',
    '.mk-modal.on{display:flex}',
    '.mk-box{background:var(--panel);border-radius:16px;width:min(640px,100%);box-shadow:0 24px 70px rgba(0,0,0,.35);font-family:"Space Grotesk",sans-serif}',
    '.mk-box-h{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line);font-size:17px}',
    '.mk-x{background:none;border:none;font-size:16px;color:var(--dim);cursor:pointer}',
    '.mk-box-b{padding:6px 18px 14px;max-height:68vh;overflow-y:auto}',
    '.mk-box-b label{display:block;font-size:12px;color:var(--dim);margin:10px 0 0}',
    '.mk-box-b input:not([type=checkbox]),.mk-box-b select,.mk-box-b textarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;border-radius:9px;min-height:38px;font:14px "Space Grotesk",sans-serif}',
    '.mk-box-b input[type=color]{padding:3px}',
    '.mk-box-b .mk-check{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text)}',
    '.mk-box-b p{font-size:12px;color:var(--dim)}',
    '.mk-box-f{display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid var(--line)}',
    '@media (max-width:760px){' +
      '#tabMarketing .mk-cal{grid-template-columns:repeat(7,minmax(0,1fr))}#tabMarketing .mk-cal-h:nth-child(8),#tabMarketing .mk-wk{display:none}' +
      '#tabMarketing .mk-day{min-height:58px;padding:3px}#tabMarketing .mk-chip{font-size:0;height:6px;padding:0;border-left-width:0;background:var(--c,var(--dim))}' +
      '#tabMarketing .mk-camp-a{margin-left:0}.mk-box .mk-3,#tabMarketing .mk-2,.mk-box .mk-2{grid-template-columns:1fr}' +
      '#tabMarketing .mk-grid{grid-template-columns:1fr}' +
    '}'
  ].join('');
  document.head.appendChild(css);
})();
