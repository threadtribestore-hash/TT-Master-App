// ===================================================================
// =================== PRINT FILES ON PARTNER JOBS ===================
// ===================================================================
// Attach sliced files (.3mf, .gcode, .stl …) to a partner job. They upload to the
// private "print-files" bucket at <jobId>/<file>, ride along in the partner's job pack
// as names and paths, and the Partner app downloads them with a short-lived link.
// Storage rules: print_files_setup.sql (partners read only jobs in their own pack).
(function(){
  if(window.TT_STOCK_MODE) return;
  const BUCKET = 'print-files', MAX = 50 * 1024 * 1024;
  const ACCEPT = '.3mf,.gcode,.stl,.step,.stp,.obj,.zip';
  const F = { busy: 0, missing: false };

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function on(){ return typeof cloudIsOn === 'function' && cloudIsOn() && cloud.sb; }
  function size(n){ n = +n || 0; return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function safe(name){ return String(name || 'file').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-120); }
  function saved(id){ return (state.pon.jobs || []).find(function(j){ return j.id === id; }); }
  function redraw(){ if(ponDraft) ponOpenModal(ponJobModalHtml(), true); }
  // Keep a saved job in step with the draft, so an upload isn't lost if the form is cancelled.
  function setFiles(files){
    ponDraft.files = files;
    const j = saved(ponDraft.id);
    if(j){ j.files = files.slice(); scheduleSave(); }
  }

  window.ponFilesHtml = function(d){
    const files = d.files || [];
    let h = '<div class="pon-section-label">Print files (partner downloads)</div>';
    if(!on()) return h + '<div class="pon-dim">Sign in to Cloud sync to attach print files.</div>';
    if(F.missing) return h + '<div class="pon-dim pf-warn">Run <code>print_files_setup.sql</code> in Supabase → SQL Editor to switch on print files, then try again.</div>';
    h += files.length ? '<div class="pf-list">' + files.map(function(f, i){
      return '<div class="pf-row"><span class="pf-ico">' + (/\.(3mf|gcode)$/i.test(f.name) ? '🧩' : '📄') + '</span><div class="pf-n"><b>' + esc(f.name) + '</b><span class="pon-dim">' + size(f.size) + (f.plates ? ' · ' + esc(f.plates) : '') + '</span></div>' +
        '<button class="client-trend-mini-btn" data-pfile="open" data-i="' + i + '">Download</button><button class="client-trend-mini-btn" data-pfile="del" data-i="' + i + '" style="color:var(--red);">Remove</button></div>';
    }).join('') + '</div>' : '<div class="pon-dim">No files yet. Add the sliced .3mf (or .gcode) so the partner prints exactly what you tested.</div>';
    h += '<label class="client-trend-mini-btn pf-add">' + (F.busy ? 'Uploading ' + F.busy + ' file' + (F.busy === 1 ? '' : 's') + '…' : '+ Add files') +
      '<input type="file" id="ponFileInput" multiple accept="' + ACCEPT + '" hidden' + (F.busy ? ' disabled' : '') + '></label>' +
      '<span class="pon-dim" style="margin-left:8px;">Up to 50 MB each · .3mf, .gcode, .stl, .step, .zip</span>';
    return h;
  };

  async function upload(list){
    const d = ponDraft; if(!d) return;
    const files = Array.prototype.slice.call(list || []);
    const big = files.filter(function(f){ return f.size > MAX; });
    if(big.length) showNoticeModal(big.map(function(f){ return f.name; }).join(', ') + (big.length === 1 ? ' is' : ' are') + ' over 50 MB. Zip it, or slice fewer plates per file.');
    const ok = files.filter(function(f){ return f.size <= MAX; });
    if(!ok.length) return;
    F.busy = ok.length; redraw();
    const added = [], failed = [];
    for(const f of ok){
      const path = d.id + '/' + Date.now().toString(36) + '-' + safe(f.name);
      const r = await cloud.sb.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' });
      if(r.error){
        if(/bucket not found|not found/i.test(r.error.message || '')) F.missing = true;
        failed.push(f.name + ': ' + r.error.message);
      } else {
        added.push({ name: f.name, path: path, size: f.size, at: new Date().toISOString() });
      }
      F.busy = Math.max(0, F.busy - 1);
    }
    if(ponDraft && ponDraft.id === d.id) setFiles((ponDraft.files || []).concat(added));
    F.busy = 0; redraw();
    if(added.length) showToast(added.length + ' file' + (added.length === 1 ? '' : 's') + ' attached' + (saved(d.id) ? ' — the partner can download now' : ' — create the job to share'));
    if(failed.length && !F.missing) showNoticeModal('Couldn’t upload:\n' + failed.join('\n'));
  }
  async function remove(i){
    const d = ponDraft, f = d && (d.files || [])[i]; if(!f) return;
    if(!confirm('Remove ' + f.name + '? The partner won’t be able to download it any more.')) return;
    const r = await cloud.sb.storage.from(BUCKET).remove([f.path]);
    if(r.error){ showNoticeModal('Couldn’t remove it: ' + r.error.message); return; }
    setFiles(d.files.filter(function(_, k){ return k !== i; }));
    redraw();
  }
  async function open(i){
    const f = ponDraft && (ponDraft.files || [])[i]; if(!f) return;
    const r = await cloud.sb.storage.from(BUCKET).createSignedUrl(f.path, 600, { download: f.name });
    if(r.error){ showNoticeModal('Couldn’t open it: ' + r.error.message); return; }
    window.open(r.data.signedUrl, '_blank');
  }

  document.addEventListener('click', function(e){
    const b = e.target.closest && e.target.closest('#ponModalBody [data-pfile]'); if(!b) return;
    e.preventDefault(); e.stopPropagation();
    const i = +b.getAttribute('data-i');
    if(b.getAttribute('data-pfile') === 'del') remove(i); else open(i);
  }, true);
  document.addEventListener('change', function(e){
    if(e.target.id !== 'ponFileInput') return;
    const list = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    upload(list);
  });

  // Files travel to the partner in their job pack (names and paths only, never the bytes).
  const origPack = ponBuildPack;
  ponBuildPack = function(pid){
    const pack = origPack(pid);
    (pack.jobs || []).forEach(function(pj){
      const j = saved(pj.id);
      if(j && j.files && j.files.length) pj.files = j.files.map(function(f){ return { name: f.name, path: f.path, size: f.size }; });
    });
    return pack;
  };

  // Deleting a job deletes its files too (called from ponDeleteJob once confirmed).
  window.ponFilesGone = function(j){
    const files = (j && j.files) || [];
    if(files.length && on()) cloud.sb.storage.from(BUCKET).remove(files.map(function(f){ return f.path; })).catch(function(){});
  };

  const css = document.createElement('style');
  css.textContent =
    '#ponModalBody .pf-list{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}' +
    '#ponModalBody .pf-row{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:8px 10px}' +
    '#ponModalBody .pf-ico{font-size:18px} #ponModalBody .pf-n{flex:1;min-width:0;display:flex;flex-direction:column}' +
    '#ponModalBody .pf-n b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#ponModalBody .pf-add{display:inline-block;cursor:pointer;color:var(--cyan);border-color:var(--cyan);margin-top:4px}' +
    '#ponModalBody .pf-warn{color:var(--amber)}';
  document.head.appendChild(css);
})();
