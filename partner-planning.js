// ===================================================================
// =================== PARTNER PLANNING (Studio side) ================
// ===================================================================
// Planning layer for print-farm partners, on top of the Partner Network:
//   capacity   partners set printers, hours/day and days off in their app; Studio
//              turns that into free printer-hours per day across the network
//   progress   partners log pieces printed each day; jobs get a pace and a
//              forecast finish against their due date
//   scorecard  on-time %, reject % and print success over 90 days, mapped to
//              reward tiers (bonus ₹/g) that Studio sets; partners see their own
//   pickups    partners book a pickup / shipment per job; Studio confirms courier
//              and AWB, and pickups show on the Control Room calendar
// Partner data lives in partner_docs (see partner_tools_setup.sql).
(function(){
  if(window.TT_STOCK_MODE) return;

  const DAYS = 14, DEFAULT_HPD = 20, GRAMS_PER_HOUR = 10;
  const PP = { docs: {}, at: 0, missing: false, loading: false };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DEFAULT_TIERS = [
    { name: 'Standard', minOnTime: 0, maxReject: 100, bonus: 0 },
    { name: 'Silver', minOnTime: 85, maxReject: 5, bonus: 0.25 },
    { name: 'Gold', minOnTime: 95, maxReject: 2, bonus: 0.5 }
  ];

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function money(v){ return '₹' + Math.round(v || 0).toLocaleString('en-IN'); }
  function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today(){ return iso(new Date()); }
  function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function fmt(s){ if(!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn(); }

  // ---------- data ----------
  async function load(force){
    if(!on() || PP.loading || (!force && Date.now() - PP.at < 60000)) return;
    PP.loading = true;
    try{
      const r = await cloud.sb.from('partner_docs').select('partner_id,coll,id,data,deleted,updated_at').eq('deleted', false).limit(20000);
      if(r.error){ PP.missing = /partner_docs|does not exist|schema cache|relation/i.test(r.error.message || ''); return; }
      PP.missing = false; PP.docs = {};
      (r.data || []).forEach(function(x){
        const p = PP.docs[x.partner_id] = PP.docs[x.partner_id] || { capacity: null, progress: [], pickup: {} };
        if(x.coll === 'capacity') p.capacity = x.data;
        else if(x.coll === 'progress') p.progress.push(x.data);
        else if(x.coll === 'pickup') p.pickup[x.id] = Object.assign({ _updated: x.updated_at }, x.data);
      });
      PP.at = Date.now();
    } finally { PP.loading = false; }
  }
  function docs(pid){ return PP.docs[pid] || { capacity: null, progress: [], pickup: {} }; }
  function partners(){ ensurePon(); return state.pon.partners.filter(function(p){ return p.status !== 'paused'; }); }

  // ---------- capacity ----------
  function capOf(p){
    const c = docs(p.id).capacity;
    return c ? { printers: +c.printers || 0, hpd: +c.hoursPerDay || 0, off: c.weeklyOff || [], daysOff: c.daysOff || [], set: true, updated: c.updatedAt || '' }
      : { printers: +p.printers || 0, hpd: DEFAULT_HPD, off: [0], daysOff: [], set: false };
  }
  function hoursOn(cap, day){
    if(cap.off.indexOf(new Date(day + 'T00:00:00').getDay()) !== -1 || cap.daysOff.indexOf(day) !== -1) return 0;
    return cap.printers * cap.hpd;
  }
  function hoursPerUnit(j){
    const n = (j.productName || '').trim().toLowerCase();
    const it = n && (state.productCatalog || []).find(function(i){ return (i.name || '').trim().toLowerCase() === n; });
    if(it && +it.hours > 0) return { h: +it.hours * bufferMult(), est: false };
    return { h: Math.max(0.25, (+j.gramsPerUnit || 0) / GRAMS_PER_HOUR) * bufferMult(), est: true };
  }
  function printedFor(pid, jobId){
    return docs(pid).progress.filter(function(x){ return x.jobId === jobId; }).reduce(function(t, x){ return t + (+x.printed || 0); }, 0);
  }
  function paceFor(pid, jobId){
    const logs = docs(pid).progress.filter(function(x){ return x.jobId === jobId && +x.printed > 0; }).sort(function(a, b){ return (b.date || '').localeCompare(a.date || ''); }).slice(0, 3);
    return logs.length >= 2 ? logs.reduce(function(t, x){ return t + (+x.printed || 0); }, 0) / logs.length : 0;
  }
  // Per partner: day-by-day load from their open jobs (earliest due first) and each job's finish.
  function plan(p){
    const cap = capOf(p), t = today(), days = [], finish = {};
    for(let i = 0; i < 120; i++){ const d = addDays(t, i); days.push({ d: d, cap: hoursOn(cap, d), used: 0 }); }
    const jobs = state.pon.jobs.filter(function(j){ return j.partnerId === p.id && ['assigned', 'accepted', 'printing'].indexOf(j.status) !== -1; })
      .sort(function(a, b){ return (a.dueDate || '9').localeCompare(b.dueDate || '9'); });
    let di = 0;
    jobs.forEach(function(j){
      const hpu = hoursPerUnit(j), printed = printedFor(p.id, j.id), left = Math.max(0, (+j.qty || 0) - printed);
      let need = left * hpu.h;
      while(need > 0 && di < days.length){
        const free = days[di].cap - days[di].used;
        if(free <= 0){ di++; continue; }
        const take = Math.min(free, need); days[di].used += take; need -= take;
        if(need > 0) di++;
      }
      const pace = paceFor(p.id, j.id);
      const capFinish = days[Math.min(di, days.length - 1)].d;
      const paceFinish = pace > 0 ? addDays(t, Math.max(0, Math.ceil(left / pace) - 1)) : '';
      finish[j.id] = { job: j, printed: printed, left: left, hpu: hpu, pace: pace, finish: left <= 0 ? t : (paceFinish || capFinish), basis: pace > 0 ? 'pace' : 'capacity' };
    });
    return { cap: cap, days: days, finish: finish };
  }
  // Free printer-hours per day across all partners for the next n days (for the delivery calculator).
  function freePerDay(n){
    let free = 0;
    partners().forEach(function(p){ plan(p).days.slice(0, n).forEach(function(x){ free += Math.max(0, x.cap - x.used); }); });
    return free / n;
  }

  // ---------- scorecard and rewards ----------
  function tiers(){ return (Array.isArray(state.ponRewards) && state.ponRewards.length ? state.ponRewards : DEFAULT_TIERS).slice().sort(function(a, b){ return (a.bonus || 0) - (b.bonus || 0); }); }
  function scorecard(pid){
    const since = addDays(today(), -90), month = today().slice(0, 7);
    let due = 0, onTime = 0, shipped = 0, rejects = 0, failed = 0, printedOk = 0, monthGrams = 0, jobs = 0;
    state.pon.jobs.forEach(function(j){
      if(j.partnerId !== pid || j.status !== 'delivered') return;
      const d = j.deliveredDate || j.shippedDate || '';
      if(d < since) return;
      jobs++;
      if(j.dueDate){ due++; if((j.shippedDate || j.deliveredDate) && (j.shippedDate || j.deliveredDate) <= j.dueDate) onTime++; }
      shipped += +j.unitsShipped || 0; rejects += +j.clientRejects || 0;
      failed += +j.failedPrints || 0; printedOk += +j.unitsShipped || 0;
      if(d.slice(0, 7) === month) monthGrams += ponPayableGrams(j);
    });
    const s = { jobs: jobs, onTime: due ? Math.round(100 * onTime / due) : null, reject: shipped ? Math.round(1000 * rejects / shipped) / 10 : null,
      success: (printedOk + failed) ? Math.round(100 * printedOk / (printedOk + failed)) : null, monthGrams: monthGrams };
    const ok = function(t){ return jobs >= 3 && (s.onTime == null ? 0 : s.onTime) >= t.minOnTime && (s.reject == null ? 0 : s.reject) <= t.maxReject; };
    const ts = tiers();
    s.tier = ts.filter(ok).pop() || ts[0];
    s.next = ts.find(function(t){ return (t.bonus || 0) > (s.tier.bonus || 0); }) || null;
    s.bonusMonth = Math.round(monthGrams * (s.tier.bonus || 0));
    s.need = jobs < 3 ? (3 - jobs) + ' more delivered job' + (3 - jobs === 1 ? '' : 's') + ' to qualify' : '';
    return s;
  }

  // ---------- job packs: give partners their scorecard, tiers and hours per piece ----------
  const origBuild = ponBuildPack;
  ponBuildPack = function(pid){
    const pack = origBuild(pid);
    try{
      const s = scorecard(pid);
      pack.scorecard = { onTime: s.onTime, reject: s.reject, success: s.success, jobs: s.jobs, tier: s.tier, next: s.next, bonusMonth: s.bonusMonth, need: s.need };
      pack.rewards = tiers();
      (pack.jobs || []).forEach(function(j){ const full = state.pon.jobs.find(function(x){ return x.id === j.id; }); if(full) j.hoursPerUnit = Math.round(hoursPerUnit(full).h * 100) / 100; });
    }catch(e){ console.warn('[planning] pack', e); }
    return pack;
  };

  // ---------- pickups ----------
  function pickups(){
    const out = [];
    partners().forEach(function(p){
      Object.keys(docs(p.id).pickup).forEach(function(jid){
        const b = docs(p.id).pickup[jid], j = state.pon.jobs.find(function(x){ return x.id === jid; });
        if(b && b.date) out.push({ p: p, job: j, b: b, jid: jid });
      });
    });
    return out.sort(function(a, b){ return (a.b.date || '').localeCompare(b.b.date || ''); });
  }
  async function confirmPickup(pid, jid, patch){
    const cur = Object.assign({}, docs(pid).pickup[jid] || {}); delete cur._updated;
    const data = Object.assign(cur, patch, { confirmedAt: new Date().toISOString() });
    const r = await cloud.sb.from('partner_docs').upsert({ partner_id: pid, coll: 'pickup', id: jid, data: data, deleted: false }, { onConflict: 'partner_id,coll,id' });
    if(r.error){ showNoticeModal('Couldn’t save: ' + r.error.message); return; }
    docs(pid).pickup[jid] = data;
    if(typeof cloudPing === 'function') cloudPing('packs');
    showToast('Pickup confirmed — the partner sees it now');
    renderPartners();
  }

  // ---------- view ----------
  const MODE = { pickup: 'Courier pickup', direct: 'Partner ships to customer', drop: 'Partner drops at Thread Tribe' };
  function planningHtml(){
    if(!on()) return '<div class="panel"><p class="pp-dim">Sign in to Cloud sync to see partner planning.</p></div>';
    if(PP.missing) return '<div class="panel"><p class="pp-dim">Run <code>partner_tools_setup.sql</code> once in Supabase → SQL Editor to switch on partner planning, then reload.</p></div>';
    const ps = partners(), t = today(), days = [];
    for(let i = 0; i < DAYS; i++) days.push(addDays(t, i));
    const plans = {}; ps.forEach(function(p){ plans[p.id] = plan(p); });

    // capacity grid
    let html = '<div class="panel"><div class="panel-title">Network capacity · next 2 weeks</div>' +
      '<p class="pp-dim">Free printer-hours per day after each partner’s open jobs. Partners set printers, hours and days off in their app. ' +
      'Network free ≈ <b>' + Math.round(freePerDay(DAYS)) + ' h/day</b> — the Control Room calculator can count it.</p><div style="overflow-x:auto"><table class="pp-grid"><tr><th>Partner</th>' +
      days.map(function(d){ const x = new Date(d + 'T00:00:00'); return '<th>' + WEEKDAYS[x.getDay()].slice(0, 2) + '<br>' + x.getDate() + '</th>'; }).join('') + '</tr>' +
      ps.map(function(p){
        const pl = plans[p.id];
        return '<tr><td><b>' + esc(p.name || 'Partner') + '</b><div class="pp-dim" style="margin:0">' + pl.cap.printers + ' × ' + pl.cap.hpd + ' h' + (pl.cap.set ? '' : ' · <span class="pp-warn">not set by partner</span>') + '</div></td>' +
          pl.days.slice(0, DAYS).map(function(x){
            if(!x.cap) return '<td class="pp-off">off</td>';
            const free = Math.max(0, x.cap - x.used), pct = x.used / x.cap;
            return '<td class="' + (pct >= 0.99 ? 'pp-full' : pct >= 0.6 ? 'pp-busy' : 'pp-free') + '" title="' + Math.round(x.used) + ' of ' + Math.round(x.cap) + ' h booked">' + Math.round(free) + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</table></div></div>';

    // job progress
    const rows = [];
    ps.forEach(function(p){ Object.keys(plans[p.id].finish).forEach(function(id){ rows.push(Object.assign({ p: p }, plans[p.id].finish[id])); }); });
    rows.sort(function(a, b){ return (a.job.dueDate || '9').localeCompare(b.job.dueDate || '9'); });
    html += '<div class="panel"><div class="panel-title">Job progress &amp; forecast</div>' + (rows.length ? '<div style="overflow-x:auto"><table class="pp-table"><tr><th>Job</th><th>Partner</th><th>Made</th><th>Pace</th><th>Due</th><th>Forecast</th><th></th></tr>' +
      rows.map(function(r){
        const qty = +r.job.qty || 0, pct = qty ? Math.min(100, Math.round(100 * r.printed / qty)) : 0, late = r.job.dueDate && r.finish > r.job.dueDate;
        const stale = !docs(r.p.id).progress.some(function(x){ return x.jobId === r.job.id && x.date >= addDays(t, -2); }) && r.job.status === 'printing';
        return '<tr><td><b>' + esc(r.job.jobCode || '') + '</b> ' + esc(r.job.productName || '') + '</td><td>' + esc(r.p.name || '') + '</td>' +
          '<td><div class="pp-bar"><i style="width:' + pct + '%"></i></div><span class="pp-dim" style="margin:0">' + r.printed + '/' + qty + '</span></td>' +
          '<td>' + (r.pace ? Math.round(r.pace) + '/day' : '<span class="pp-dim" style="margin:0">—</span>') + '</td><td>' + fmt(r.job.dueDate) + '</td>' +
          '<td class="' + (late ? 'pp-bad' : '') + '">' + fmt(r.finish) + ' <span class="pp-dim" style="margin:0">' + (r.basis === 'pace' ? 'by pace' : 'by capacity') + (r.hpu.est ? ', est. hours' : '') + '</span></td>' +
          '<td>' + (late ? '<span class="pp-pill bad">at risk</span>' : '') + (stale ? '<span class="pp-pill warn">no update 2d</span>' : '') + '</td></tr>';
      }).join('') + '</table></div>' : '<p class="pp-dim">No open partner jobs.</p>') + '</div>';

    // scorecards and rewards
    const ts = tiers();
    html += '<div class="panel"><div class="panel-title">Scorecards &amp; rewards · last 90 days</div>' +
      '<p class="pp-dim">Partners see their own scorecard and what the next tier needs. Bonus is per gram of accepted pieces delivered; pay it with a normal payout (ref “Bonus”). Needs 3+ delivered jobs.</p>' +
      '<div style="overflow-x:auto"><table class="pp-table"><tr><th>Partner</th><th>Jobs</th><th>On time</th><th>Rejects</th><th>Print success</th><th>Tier</th><th>Bonus this month</th></tr>' +
      ps.map(function(p){ const s = scorecard(p.id);
        return '<tr><td>' + esc(p.name || '') + '</td><td>' + s.jobs + '</td><td>' + (s.onTime == null ? '—' : s.onTime + '%') + '</td><td>' + (s.reject == null ? '—' : s.reject + '%') + '</td><td>' + (s.success == null ? '—' : s.success + '%') + '</td>' +
          '<td><span class="pp-pill ' + ((s.tier.bonus || 0) > 0 ? 'ok' : '') + '">' + esc(s.tier.name) + '</span>' + (s.need ? ' <span class="pp-dim" style="margin:0">' + esc(s.need) + '</span>' : '') + '</td><td>' + (s.bonusMonth ? money(s.bonusMonth) : '—') + '</td></tr>';
      }).join('') + '</table></div>' +
      '<details style="margin-top:10px"><summary class="pp-dim">Reward tiers</summary><table class="pp-table" style="max-width:560px"><tr><th>Tier</th><th>On time ≥ %</th><th>Rejects ≤ %</th><th>Bonus ₹/g</th><th></th></tr>' +
      ts.map(function(x, i){ return '<tr><td><input data-pt="name" data-i="' + i + '" value="' + esc(x.name) + '"></td><td><input type="number" data-pt="minOnTime" data-i="' + i + '" value="' + x.minOnTime + '"></td><td><input type="number" step="0.5" data-pt="maxReject" data-i="' + i + '" value="' + x.maxReject + '"></td><td><input type="number" step="0.05" data-pt="bonus" data-i="' + i + '" value="' + x.bonus + '"></td><td>' + (i ? '<button class="pp-btn" data-pp="tier-del" data-i="' + i + '">✕</button>' : '') + '</td></tr>'; }).join('') +
      '</table><button class="pp-btn" data-pp="tier-add">+ Add tier</button></details></div>';

    // pickups
    const pk = pickups().filter(function(x){ return x.b.date >= addDays(t, -3); });
    html += '<div class="panel"><div class="panel-title">Pickups &amp; partner shipments</div>' + (pk.length ? pk.map(function(x){
      const b = x.b, done = !!b.confirmedAt;
      return '<div class="pp-pk ' + (done ? 'done' : '') + '"><div><b>' + fmt(b.date) + '</b> ' + esc(b.slot || '') + ' · ' + esc(MODE[b.mode] || b.mode || '') + '</div>' +
        '<div class="pp-dim" style="margin:2px 0">' + esc(x.p.name || '') + ' · ' + esc((x.job && (x.job.jobCode + ' ' + x.job.productName)) || 'job') + ' · ' + (b.boxes || '?') + ' box' + (+b.boxes === 1 ? '' : 'es') + (b.weightKg ? ', ' + b.weightKg + ' kg' : '') + (b.notes ? ' · ' + esc(b.notes) : '') + '</div>' +
        '<div class="pp-pk-f"><input placeholder="Courier" data-pk="courier" data-pid="' + x.p.id + '" data-jid="' + x.jid + '" value="' + esc(b.courier || '') + '"><input placeholder="AWB" data-pk="awb" data-pid="' + x.p.id + '" data-jid="' + x.jid + '" value="' + esc(b.awb || '') + '">' +
        '<button class="pp-btn ' + (done ? '' : 'primary') + '" data-pp="pk-confirm" data-pid="' + x.p.id + '" data-jid="' + x.jid + '">' + (done ? 'Update' : 'Confirm') + '</button>' + (done ? '<span class="pp-pill ok">confirmed</span>' : '') + '</div></div>';
    }).join('') : '<p class="pp-dim">No pickups booked. Partners book them from a job in their app.</p>') + '</div>';
    return html;
  }

  // Add a "Planning" chip to the Partner Network views and render it there.
  function ensureChip(){
    const chips = document.getElementById('ponViewChips');
    if(chips && !chips.querySelector('[data-view="planning"]')){
      const b = document.createElement('button'); b.className = 'filter-chip'; b.setAttribute('data-view', 'planning'); b.textContent = 'Planning';
      chips.appendChild(b);
    }
  }
  const origRender = renderPartners;
  renderPartners = function(){
    ensureChip();
    if(ponView === 'planning'){
      ensurePon();
      document.querySelectorAll('#ponViewChips .filter-chip').forEach(function(c){ c.classList.toggle('active', c.getAttribute('data-view') === 'planning'); });
      const body = document.getElementById('ponBody');
      if(body) body.innerHTML = planningHtml();
      load().then(function(){ if(ponView === 'planning' && Date.now() - PP.at < 2000){ const b2 = document.getElementById('ponBody'); if(b2 && !(document.activeElement && b2.contains(document.activeElement) && /INPUT/.test(document.activeElement.tagName))) b2.innerHTML = planningHtml(); } });
      return;
    }
    origRender();
  };
  document.addEventListener('click', function(e){
    const chip = e.target.closest('#ponViewChips [data-view="planning"]');
    if(chip){ ponView = 'planning'; renderPartners(); return; }
    const b = e.target.closest('[data-pp]'); if(!b || !document.getElementById('tabPartners').contains(b)) return;
    const act = b.getAttribute('data-pp');
    if(act === 'tier-add'){ const ts = tiers(); ts.push({ name: 'New tier', minOnTime: 98, maxReject: 1, bonus: (ts[ts.length - 1].bonus || 0) + 0.25 }); state.ponRewards = ts; scheduleSave(); renderPartners(); }
    else if(act === 'tier-del'){ const ts = tiers(); ts.splice(+b.getAttribute('data-i'), 1); state.ponRewards = ts; scheduleSave(); renderPartners(); }
    else if(act === 'pk-confirm'){
      const pid = b.getAttribute('data-pid'), jid = b.getAttribute('data-jid'), box = b.parentNode;
      confirmPickup(pid, jid, { courier: (box.querySelector('[data-pk="courier"]').value || '').trim().slice(0, 60), awb: (box.querySelector('[data-pk="awb"]').value || '').trim().slice(0, 60) });
    }
  });
  document.addEventListener('change', function(e){
    const t = e.target; if(!t.hasAttribute || !t.hasAttribute('data-pt')) return;
    const ts = tiers(), i = +t.getAttribute('data-i'), k = t.getAttribute('data-pt');
    ts[i][k] = k === 'name' ? String(t.value || '').slice(0, 30) : Math.max(0, parseFloat(t.value) || 0);
    state.ponRewards = ts; scheduleSave(); showToast('Reward tiers saved — partners see them on the next sync');
  });

  // Studio only republished job packs after a local edit, so partners waited for someone
  // to change something before seeing scorecards or new job details. Ride along with the
  // regular pull: refresh partner planning data and republish packs every 2 minutes
  // (cloudPublishPacks only uploads packs whose content changed).
  let lastPublish = 0;
  const origPull = cloudPullReports;
  cloudPullReports = async function(){
    await origPull();
    try{
      await load();
      if(Date.now() - lastPublish > 120000){ lastPublish = Date.now(); await cloudPublishPacks(); }
    }catch(e){ console.warn('[planning] sync', e); }
  };

  // For the Control Room: partner capacity for the calculator, pickups for the calendar.
  window.TTPartners = { freePerDay: freePerDay, pickups: pickups, load: load, ready: function(){ return !!PP.at && !PP.missing; } };

  const css = document.createElement('style');
  css.textContent =
    '#tabPartners .pp-dim{color:var(--dim);font-size:12px;margin:2px 0 8px}' +
    '#tabPartners .pp-warn{color:var(--amber)} #tabPartners .pp-bad{color:var(--red);font-weight:600}' +
    '#tabPartners .pp-grid{border-collapse:collapse;font-size:11.5px;width:100%}' +
    '#tabPartners .pp-grid th,#tabPartners .pp-grid td{border:1px solid var(--line);padding:4px 5px;text-align:center;white-space:nowrap}' +
    '#tabPartners .pp-grid td:first-child,#tabPartners .pp-grid th:first-child{text-align:left}' +
    '#tabPartners .pp-free{background:color-mix(in srgb,var(--green) 16%,transparent)} #tabPartners .pp-busy{background:color-mix(in srgb,var(--amber) 18%,transparent)}' +
    '#tabPartners .pp-full{background:color-mix(in srgb,var(--red) 16%,transparent)} #tabPartners .pp-off{color:var(--dim);background:var(--input-bg)}' +
    '#tabPartners .pp-table{width:100%;border-collapse:collapse;font-size:12.5px}' +
    '#tabPartners .pp-table th,#tabPartners .pp-table td{text-align:left;padding:6px 7px;border-top:1px solid var(--line);vertical-align:middle}' +
    '#tabPartners .pp-table th{color:var(--dim);font-weight:500;font-size:11px}' +
    '#tabPartners .pp-table input{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px 6px;width:90px;font:12px inherit}' +
    '#tabPartners .pp-bar{height:5px;width:90px;background:var(--input-bg);border-radius:3px;overflow:hidden} #tabPartners .pp-bar i{display:block;height:100%;background:var(--cyan)}' +
    '#tabPartners .pp-pill{border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:11px;color:var(--dim);margin-right:4px}' +
    '#tabPartners .pp-pill.ok{color:var(--green);border-color:var(--green)} #tabPartners .pp-pill.bad{color:var(--red);border-color:var(--red)} #tabPartners .pp-pill.warn{color:var(--amber);border-color:var(--amber)}' +
    '#tabPartners .pp-btn{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 11px;font:12px "JetBrains Mono",monospace;cursor:pointer;margin:2px 4px 2px 0}' +
    '#tabPartners .pp-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#0d1117;font-weight:600}' +
    '#tabPartners .pp-pk{border:1px solid var(--amber);border-radius:10px;padding:8px 12px;margin-bottom:8px} #tabPartners .pp-pk.done{border-color:var(--line)}' +
    '#tabPartners .pp-pk-f{display:flex;gap:6px;flex-wrap:wrap;align-items:center} #tabPartners .pp-pk-f input{background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 7px;font:12px inherit;width:140px}';
  document.head.appendChild(css);
})();
