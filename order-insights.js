// Order insights: clicking a decision card at the top of the Orders tab opens a pop-up
// with a chart, a small working tool and the numbers behind it.
// Uses index.html globals: state, orderTotals, orderBucketDate, isOrderComplete,
// orderAmountDue, daysSinceDelivery, computeProductionCost, isoLocal, escapeHtml,
// openOrderDetailModal, schedDayText.
(function(){
  if(typeof state === 'undefined') return;

  // ---------- data ----------
  function inr(n){
    n = Math.round(n || 0); var a = Math.abs(n), s = n < 0 ? '-' : '';
    if(a >= 100000) return s + '₹' + (a / 100000).toFixed(a >= 1000000 ? 0 : 1).replace(/\.0$/, '') + 'L';
    if(a >= 10000) return s + '₹' + Math.round(a / 1000) + 'k';
    return s + '₹' + a.toLocaleString('en-IN');
  }
  function full(n){ return (n < 0 ? '-' : '') + '₹' + Math.abs(Math.round(n || 0)).toLocaleString('en-IN'); }
  function esc(s){ return escapeHtml(String(s == null ? '' : s)); }
  function who(o){ return (o.clientName || o.name || 'Order').trim(); }
  function iso(y, m, d){ return isoLocal(new Date(y, m, d)); }
  function fmtDate(s){ if(!s) return '—'; var p = s.split('-'); return +p[2] + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1] - 1]; }
  function fullHours(o){ return ((o.costSnapshot && o.costSnapshot.hours) || computeProductionCost(o, { useFullQty: true }).hours) || 0; }

  // Six calendar months ending with this one: revenue, orders, profit, operating expenses.
  function months(){
    var now = new Date(), out = [];
    for(var i = 5; i >= 0; i--){
      var y = now.getFullYear(), m = now.getMonth() - i;
      var s = iso(y, m, 1), e = iso(y, m + 1, 0), d = new Date(y, m, 1);
      out.push({ start: s, end: e, label: d.toLocaleString('en-IN', { month: 'short' }), current: i === 0, rev: 0, n: 0, profit: 0, opex: 0, revTD: 0,
        // Same day of the month as today (or the month's last day), for fair month-to-date comparisons.
        sameDay: iso(y, m, Math.min(now.getDate(), new Date(y, m + 1, 0).getDate())) });
    }
    state.orders.forEach(function(o){
      if(!isOrderComplete(o.status)) return;
      var bd = orderBucketDate(o), t;
      out.forEach(function(x){ if(bd >= x.start && bd <= x.end){ t = t || orderTotals(o); x.rev += t.orderValue; x.n++; x.profit += t.profit; if(bd <= x.sameDay) x.revTD += t.orderValue; } });
    });
    (state.expenses || []).forEach(function(e){
      if((e.type || 'opex') !== 'opex' || !e.date) return;
      out.forEach(function(x){ if(e.date >= x.start && e.date <= x.end) x.opex += +e.cost || 0; });
    });
    return out;
  }
  function winRate(){
    var won = 0, lost = 0;
    state.orders.forEach(function(o){ if(isOrderComplete(o.status)) won++; if(o.status === 'lost') lost++; });
    return won + lost > 0 ? won / (won + lost) : 0;
  }
  function fleetDailyCap(){
    var running = 0;
    (state.printers || []).forEach(function(p){ if(p.status !== 'down') running++; });
    if(!(state.printers || []).length) running = state.fleet.printers || 0;
    return running * (state.fleet.hoursPerDay || 0);
  }

  // ---------- charts (inline SVG, one hue per chart, values on hover) ----------
  var W = 560, H = 180, PL = 44, PR = 10, PT = 14, PB = 26;
  function axisY(max, min){
    min = min || 0; var g = '';
    [0, 0.5, 1].forEach(function(f){
      var v = min + (max - min) * f, y = PT + (H - PT - PB) * (1 - f);
      g += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (PL - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="oi-ax">' + (Math.abs(max) >= 1000 ? inr(v) : Math.round(v)) + '</text>';
    });
    return g;
  }
  // Bars with rounded data ends. vals may be negative (drawn below a zero line in red).
  function bars(labels, vals, color, opts){
    opts = opts || {};
    var max = Math.max.apply(null, vals.concat([opts.ref || 0, 1])), min = Math.min.apply(null, vals.concat([0]));
    if(opts.refSeries) max = Math.max(max * 1.3, Math.min(Math.max.apply(null, opts.refSeries), max * 1.3));
    var span = max - min || 1, n = vals.length, slot = (W - PL - PR) / n, bw = Math.min(46, slot * 0.6);
    function Y(v){ return PT + (H - PT - PB) * (1 - (v - min) / span); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="oi-svg" role="img" aria-label="' + esc(opts.title || '') + '">' + axisY(max, min);
    vals.forEach(function(v, i){
      var x = PL + slot * i + (slot - bw) / 2, y0 = Y(0), y1 = Y(v), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
      var fill = v < 0 ? 'var(--red)' : (opts.colors ? opts.colors[i] : color);
      var r = Math.min(4, h / 2);
      // Rounded only at the data end, square at the baseline.
      var d = v >= 0
        ? 'M' + x + ',' + (top + h) + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + top + ' ' + (x + bw) + ',' + (top + r) + 'V' + (top + h) + 'Z'
        : 'M' + x + ',' + top + 'V' + (top + h - r) + 'Q' + x + ',' + (top + h) + ' ' + (x + r) + ',' + (top + h) + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + (top + h) + ' ' + (x + bw) + ',' + (top + h - r) + 'V' + top + 'Z';
      s += '<g class="oi-mark"><rect x="' + (PL + slot * i) + '" y="' + PT + '" width="' + slot + '" height="' + (H - PT - PB) + '" fill="transparent"/>' +
        '<path d="' + d + '" fill="' + fill + '"' + (opts.faded && opts.faded[i] ? ' opacity="0.45"' : '') + '/>' +
        '<title>' + esc(labels[i] + ': ' + (opts.fmt ? opts.fmt(v) : v)) + '</title></g>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="oi-ax">' + esc(labels[i]) + '</text>';
      if(opts.showLast && i === n - 1) s += '<text x="' + (x + bw / 2) + '" y="' + (top - 5) + '" text-anchor="middle" class="oi-val">' + esc(opts.fmt ? opts.fmt(v) : v) + '</text>';
    });
    if(opts.refSeries){
      // A dashed line for a second series in the same unit, clipped to the chart.
      var pts = opts.refSeries.map(function(v, i){ return (PL + slot * i + slot / 2) + ',' + Y(Math.min(v, max)); }).join(' ');
      s += '<polyline points="' + pts + '" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="4,3"><title>' + esc(opts.refLabel || '') + '</title></polyline>';
    }
    if(opts.ref){ var ry = Y(opts.ref); s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + ry + '" y2="' + ry + '" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="4,3"/><text x="' + (W - PR) + '" y="' + (ry - 4) + '" text-anchor="end" class="oi-ax">' + esc(opts.refLabel || '') + '</text>'; }
    return s + '</svg>';
  }
  function line(labels, vals, color, fmtFn, title){
    var ok = vals.filter(function(v){ return v != null; });
    var max = Math.max.apply(null, ok.concat([1])) * 1.1, min = 0, n = vals.length, slot = (W - PL - PR) / n;
    function Y(v){ return PT + (H - PT - PB) * (1 - (v - min) / (max - min)); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="oi-svg" role="img" aria-label="' + esc(title) + '">' + axisY(max, min), pts = [];
    vals.forEach(function(v, i){ if(v != null) pts.push([PL + slot * i + slot / 2, Y(v), v, i]); });
    if(pts.length > 1) s += '<polyline points="' + pts.map(function(p){ return p[0] + ',' + p[1]; }).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
    pts.forEach(function(p){ s += '<g class="oi-mark"><circle cx="' + p[0] + '" cy="' + p[1] + '" r="12" fill="transparent"/><circle cx="' + p[0] + '" cy="' + p[1] + '" r="4.5" fill="' + color + '" stroke="var(--panel)" stroke-width="2"/><title>' + esc(labels[p[3]] + ': ' + fmtFn(p[2])) + '</title></g>'; });
    labels.forEach(function(l, i){ s += '<text x="' + (PL + slot * i + slot / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="oi-ax">' + esc(l) + '</text>'; });
    if(pts.length) { var p = pts[pts.length - 1]; s += '<text x="' + p[0] + '" y="' + (p[1] - 10) + '" text-anchor="middle" class="oi-val">' + esc(fmtFn(p[2])) + '</text>'; }
    return s + '</svg>';
  }
  // One horizontal stacked bar with labelled segments (2px surface gaps between them).
  function stack(parts, total, ref, refLabel){
    var max = Math.max(total, ref || 0, 1), x = 0, s = '<div class="oi-stack">';
    parts.forEach(function(p){ if(p.v <= 0) return; var w = p.v / max * 100; s += '<span style="left:' + x + '%;width:calc(' + w + '% - 2px);background:' + p.c + '" title="' + esc(p.l + ': ' + full(p.v)) + '"></span>'; x += w; });
    if(ref) s += '<i style="left:' + (ref / max * 100) + '%" title="' + esc(refLabel) + '"></i>';
    s += '</div><div class="oi-legend">' + parts.map(function(p){ return '<span><b style="background:' + p.c + '"></b>' + esc(p.l) + ' <strong>' + full(p.v) + '</strong></span>'; }).join('') +
      (ref ? '<span><b class="oi-dash"></b>' + esc(refLabel) + '</span>' : '') + '</div>';
    return s;
  }
  function table(head, rows, numCols){
    numCols = numCols || [];
    return '<div class="oi-tw"><table class="oi-t"><thead><tr>' + head.map(function(h, i){ return '<th' + (numCols.indexOf(i) !== -1 ? ' class="n"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function(r){ return '<tr>' + r.map(function(c, i){ return '<td' + (numCols.indexOf(i) !== -1 ? ' class="n"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + head.length + '" class="oi-empty">Nothing here yet</td></tr>') +
      '</tbody></table></div>';
  }
  function openBtn(o){ return '<button type="button" class="oi-open" data-oid="' + esc(o.id) + '">Open</button>'; }

  // ---------- the six pop-ups ----------
  var VIEWS = {
    // Forecast: what's done, what's due, what quotes may add; tool = what-if win rate and extra sales.
    forecast: function(){
      var ms = months(), cur = ms[5], prev = ms[4], today = isoLocal(), wr = winRate();
      var due = [], quotes = [];
      state.orders.forEach(function(o){
        var t = orderTotals(o);
        if(['booked', 'in_production', 'production_done'].indexOf(o.status) !== -1 && (o.status === 'production_done' || (o.dueDate && o.dueDate <= cur.end))) due.push({ o: o, v: t.orderValue });
        if(o.status === 'quoted') quotes.push({ o: o, v: t.orderValue, age: Math.floor((new Date() - new Date(o.quotedDate || o.orderedDate || today)) / 86400000) });
      });
      var dueV = due.reduce(function(s, x){ return s + x.v; }, 0), qV = quotes.reduce(function(s, x){ return s + x.v; }, 0);
      return {
        title: 'Forecast · ' + cur.label,
        body: '<div id="oiFcStack"></div>' +
          '<div class="oi-tool"><div class="oi-tool-h">What if</div>' +
            '<label>Quote win rate <input type="range" id="oiWr" min="0" max="100" value="' + Math.round(wr * 100) + '"> <b id="oiWrV">' + Math.round(wr * 100) + '%</b></label>' +
            '<label>Extra orders this month (₹) <input type="number" id="oiExtra" min="0" step="1000" value="0"></label>' +
            '<div class="oi-answer" id="oiFcAns"></div></div>' +
          '<h4>Due this month or ready to ship · ' + full(dueV) + '</h4>' +
          table(['Client', 'Order', 'Due', 'Value', ''], due.sort(function(a, b){ return (a.o.dueDate || '').localeCompare(b.o.dueDate || ''); }).map(function(x){ return [esc(who(x.o)), esc(x.o.displayId || ''), fmtDate(x.o.dueDate), full(x.v), openBtn(x.o)]; }), [3]) +
          '<h4>Open quotes · ' + full(qV) + '</h4>' +
          table(['Client', 'Quote', 'Age', 'Value', ''], quotes.sort(function(a, b){ return b.v - a.v; }).map(function(x){ return [esc(who(x.o)), esc(x.o.displayId || ''), x.age + 'd' + (x.age > 7 ? ' ⚠' : ''), full(x.v), openBtn(x.o)]; }), [2, 3]),
        after: function(root){
          function draw(){
            var w = +root.querySelector('#oiWr').value / 100, extra = Math.max(0, +root.querySelector('#oiExtra').value || 0);
            root.querySelector('#oiWrV').textContent = Math.round(w * 100) + '%';
            var parts = [{ l: 'Done', v: cur.rev, c: 'var(--cyan)' }, { l: 'Due', v: dueV, c: 'color-mix(in srgb, var(--cyan) 60%, var(--panel))' }, { l: 'Quotes × ' + Math.round(w * 100) + '%', v: qV * w, c: 'color-mix(in srgb, var(--cyan) 30%, var(--panel))' }];
            if(extra) parts.push({ l: 'Extra', v: extra, c: 'var(--purple)' });
            var total = cur.rev + dueV + qV * w + extra;
            root.querySelector('#oiFcStack').innerHTML = '<div class="oi-big">' + full(total) + ' <span>forecast</span></div>' + stack(parts, total, prev.rev, prev.label + ' total ' + full(prev.rev));
            var gap = prev.rev - total;
            root.querySelector('#oiFcAns').innerHTML = prev.rev <= 0 ? 'No ' + prev.label + ' revenue to compare.'
              : gap <= 0 ? 'Beats ' + prev.label + ' by <b>' + full(-gap) + '</b> (' + Math.round(-gap / prev.rev * 100) + '%).'
              : 'Still <b>' + full(gap) + '</b> short of ' + prev.label + '. ' + (qV > 0 ? 'You would need to win <b>' + Math.min(100, Math.ceil((prev.rev - cur.rev - dueV - extra) / qV * 100)) + '%</b> of open quotes.' : 'There are no open quotes to close it.');
          }
          root.querySelector('#oiWr').addEventListener('input', draw);
          root.querySelector('#oiExtra').addEventListener('input', draw);
          draw();
        }
      };
    },
    // Growth: six-month bars; tool = switch the measure.
    growth: function(){
      var ms = months(), L = ms.map(function(m){ return m.label + (m.current ? '*' : ''); });
      var series = {
        rev: { name: 'Revenue', v: ms.map(function(m){ return m.rev; }), f: full },
        n: { name: 'Orders', v: ms.map(function(m){ return m.n; }), f: function(v){ return String(v); } },
        aov: { name: 'Avg order', v: ms.map(function(m){ return m.n ? m.rev / m.n : 0; }), f: full }
      };
      var rows = ms.map(function(m, i){ var p = i ? ms[i - 1] : null, base = p ? (m.current ? p.revTD : p.rev) : 0, g = base ? Math.round((m.rev - base) / base * 100) : null;
        return [esc(m.label) + (m.current ? ' (to date)' : ''), full(m.rev), m.n, m.n ? full(m.rev / m.n) : '—', g === null ? '—' : '<span style="color:' + (g >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (g >= 0 ? '▲' : '▼') + Math.abs(g) + '%</span>']; });
      return {
        title: 'Growth · last 6 months',
        body: '<div class="oi-seg" id="oiGrSeg"><button data-k="rev" class="on">Revenue</button><button data-k="n">Orders</button><button data-k="aov">Avg order</button></div>' +
          '<div id="oiGrChart"></div><p class="oi-note">* this month so far; its change is against last month up to the same date. Ex-GST, by completion date.</p>' +
          table(['Month', 'Revenue', 'Orders', 'Avg order', 'vs previous'], rows, [1, 2, 3, 4]),
        after: function(root){
          function draw(k){
            var s = series[k];
            root.querySelector('#oiGrChart').innerHTML = bars(L, s.v, 'var(--green)', { fmt: s.f, faded: ms.map(function(m){ return m.current; }), showLast: true, title: s.name + ' by month' });
            root.querySelectorAll('#oiGrSeg button').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-k') === k); });
          }
          root.querySelector('#oiGrSeg').addEventListener('click', function(e){ var b = e.target.closest('[data-k]'); if(b) draw(b.getAttribute('data-k')); });
          draw('rev');
        }
      };
    },
    // Gross profit: margin trend, margin by client; tool = price change simulator.
    profit: function(){
      var ms = months(), cur = ms[5], byC = {};
      state.orders.forEach(function(o){
        if(!isOrderComplete(o.status)) return;
        var bd = orderBucketDate(o); if(bd < cur.start || bd > cur.end) return;
        var t = orderTotals(o), k = who(o); byC[k] = byC[k] || { rev: 0, profit: 0, n: 0 }; byC[k].rev += t.orderValue; byC[k].profit += t.profit; byC[k].n++;
      });
      var rows = Object.keys(byC).filter(function(k){ return byC[k].rev > 0; }).sort(function(a, b){ return byC[a].profit / byC[a].rev - byC[b].profit / byC[b].rev; }).map(function(k){
        var m = byC[k].profit / byC[k].rev * 100;
        return [esc(k), byC[k].n, full(byC[k].rev), full(byC[k].profit), '<span style="color:' + (m < 20 ? 'var(--red)' : m < 30 ? 'var(--amber)' : 'var(--green)') + '">' + Math.round(m) + '%</span>'];
      });
      return {
        title: 'Gross profit · margin',
        body: line(ms.map(function(m){ return m.label + (m.current ? '*' : ''); }), ms.map(function(m){ return m.rev ? m.profit / m.rev * 100 : null; }), 'var(--purple)', function(v){ return Math.round(v) + '%'; }, 'Gross margin by month') +
          '<p class="oi-note">Gross margin % by month. * this month so far.</p>' +
          '<div class="oi-tool"><div class="oi-tool-h">Price check</div>' +
            '<label>Change prices by <input type="number" id="oiPx" value="5" step="1" min="-50" max="100">%</label>' +
            '<div class="oi-answer" id="oiPxAns"></div></div>' +
          '<h4>This month by client, lowest margin first</h4>' + table(['Client', 'Orders', 'Revenue', 'Profit', 'Margin'], rows, [1, 2, 3, 4]),
        after: function(root){
          function draw(){
            var p = (+root.querySelector('#oiPx').value || 0) / 100, rev = cur.rev * (1 + p), prof = cur.profit + cur.rev * p;
            root.querySelector('#oiPxAns').innerHTML = !cur.rev ? 'Nothing completed this month yet.'
              : 'On this month\'s orders: margin <b>' + Math.round(cur.profit / cur.rev * 100) + '% → ' + Math.round(rev ? prof / rev * 100 : 0) + '%</b>, profit ' + full(cur.profit) + ' → <b>' + full(prof) + '</b> (same quantities sold).';
          }
          root.querySelector('#oiPx').addEventListener('input', draw); draw();
        }
      };
    },
    // Net profit: monthly net bars; tool = break-even revenue.
    net: function(){
      var ms = months(), cur = ms[5], cats = {};
      (state.expenses || []).forEach(function(e){ if((e.type || 'opex') === 'opex' && e.date >= cur.start && e.date <= cur.end){ var c = e.category || e.item || 'Other'; cats[c] = (cats[c] || 0) + (+e.cost || 0); } });
      var m3 = ms.slice(2, 5).reduce(function(a, m){ a.r += m.rev; a.p += m.profit; return a; }, { r: 0, p: 0 }), margin = cur.rev ? cur.profit / cur.rev : (m3.r ? m3.p / m3.r : 0);
      return {
        title: 'Net profit · after operating expenses',
        body: bars(ms.map(function(m){ return m.label + (m.current ? '*' : ''); }), ms.map(function(m){ return m.profit - m.opex; }), 'var(--green)', { fmt: full, faded: ms.map(function(m){ return m.current; }), title: 'Net profit by month' }) +
          '<p class="oi-note">Gross profit minus operating expenses. Red bars are losses. Capital spend left out. * this month so far.</p>' +
          '<div class="oi-tool"><div class="oi-tool-h">Break-even</div><div class="oi-answer">' +
            (margin > 0 ? 'At a ' + Math.round(margin * 100) + '% gross margin, this month\'s ' + full(cur.opex) + ' of expenses needs <b>' + full(cur.opex / margin) + '</b> of revenue. ' +
              (cur.rev >= cur.opex / margin ? 'You are past it by ' + full(cur.rev - cur.opex / margin) + '.' : 'You need <b>' + full(cur.opex / margin - cur.rev) + '</b> more.') : 'No margin data yet to work out break-even.') + '</div></div>' +
          table(['Month', 'Gross profit', 'Expenses', 'Net'], ms.map(function(m){ var n = m.profit - m.opex; return [esc(m.label) + (m.current ? ' (to date)' : ''), full(m.profit), full(m.opex), '<b style="color:' + (n < 0 ? 'var(--red)' : 'var(--text)') + '">' + full(n) + '</b>']; }), [1, 2, 3]) +
          '<h4>This month\'s expenses by category</h4>' + table(['Category', 'Amount'], Object.keys(cats).sort(function(a, b){ return cats[b] - cats[a]; }).map(function(c){ return [esc(c), full(cats[c])]; }), [1])
      };
    },
    // Cash: ageing bars; tool = list with Open and a WhatsApp reminder.
    cash: function(){
      var owed = [];
      state.orders.forEach(function(o){
        if(['production_done', 'delivered'].indexOf(o.status) === -1) return;
        var ps = o.paymentStatus || 'unpaid'; if(ps === 'paid' || ps === 'refunded') return;
        var due = orderAmountDue(o); if(due > 0) owed.push({ o: o, due: due, days: daysSinceDelivery(o) });
      });
      var B = [['Not delivered', function(d){ return d == null || d < 0; }], ['0–7 days', function(d){ return d >= 0 && d <= 7; }], ['8–30 days', function(d){ return d > 7 && d <= 30; }], ['30+ days', function(d){ return d > 30; }]];
      var vals = B.map(function(b){ return owed.filter(function(x){ return b[1](x.days); }).reduce(function(s, x){ return s + x.due; }, 0); });
      owed.sort(function(a, b){ return (b.days || -1) - (a.days || -1) || b.due - a.due; });
      return {
        title: 'Cash to collect · ' + full(owed.reduce(function(s, x){ return s + x.due; }, 0)),
        body: bars(B.map(function(b){ return b[0]; }), vals, 'var(--pink)', { fmt: full, colors: ['var(--dim)', 'var(--pink)', 'var(--amber)', 'var(--red)'], title: 'Money owed by days since delivery' }) +
          '<p class="oi-note">Unpaid amount by days since delivery, incl. GST.</p>' +
          table(['Client', 'Order', 'Delivered', 'Owed', ''], owed.map(function(x){
            var ph = String(x.o.clientPhone || '').replace(/\D/g, ''); if(ph.length === 10) ph = '91' + ph;
            var msg = 'Hi ' + who(x.o) + ', a reminder that ' + full(x.due) + ' is pending for order ' + (x.o.displayId || '') + '. Thank you! — Thread Tribe';
            return [esc(who(x.o)), esc(x.o.displayId || ''), x.days == null || x.days < 0 ? 'not yet' : x.days + 'd ago', full(x.due),
              openBtn(x.o) + (ph ? ' <a class="oi-open" target="_blank" rel="noopener" href="https://wa.me/' + ph + '?text=' + encodeURIComponent(msg) + '">WhatsApp</a>' : '')];
          }), [3])
      };
    },
    // Capacity: hours due by date vs capacity; tool = "can I take this order?".
    capacity: function(){
      var cap = fleetDailyCap(), today = isoLocal(), base = new Date(); base.setHours(0, 0, 0, 0);
      var work = [], undated = 0;
      state.orders.forEach(function(o){
        if(o.status !== 'booked' && o.status !== 'in_production') return;
        var h = orderTotals(o).hours || 0; if(h <= 0) return;
        var di = o.dueDate ? Math.max(1, Math.round((new Date(o.dueDate + 'T00:00:00') - base) / 86400000) + 1) : null;
        if(di == null) undated += h;
        work.push({ o: o, h: h, di: di });
      });
      var total = work.reduce(function(s, x){ return s + x.h; }, 0);
      var L = [], cum = [], c = 0;
      for(var d = 1; d <= 14; d++){
        work.forEach(function(x){ if(x.di === d || (d === 1 && x.di != null && x.di < 1)) c += x.h; });
        L.push(d === 1 ? 'Today' : String(new Date(base.getTime() + (d - 1) * 86400000).getDate())); cum.push(Math.round(c));
      }
      var late = cum.map(function(v, i){ return cap > 0 && v > cap * (i + 1); });
      return {
        title: 'Capacity · next 14 days',
        body: (cap > 0 ? bars(L, cum, 'var(--cyan)', { fmt: function(v){ return v + 'h due by then'; }, colors: late.map(function(x){ return x ? 'var(--red)' : 'var(--cyan)'; }), refSeries: cum.map(function(v, i){ return Math.round(cap * (i + 1)); }), refLabel: 'What the fleet can print by each day', title: 'Print hours due by each day' }) +
            '<div class="oi-legend"><span><b style="background:var(--cyan)"></b>Print hours due by each day (running total)</span><span><b class="oi-dash"></b>What the fleet can print by then (' + Math.round(cap) + 'h a day)</span><span><b style="background:var(--red)"></b>More due than can be printed</span></div><p class="oi-note">' + (undated ? Math.round(undated) + 'h of orders have no due date and are not in the bars.' : '') + '</p>'
            : '<p class="oi-note">Set printers and hours per day in Settings to see capacity.</p>') +
          '<div class="oi-tool"><div class="oi-tool-h">Can I take this order?</div>' +
            '<label>Print hours <input type="number" id="oiCh" min="0" step="1" value="20"></label>' +
            '<label>Wanted by <input type="date" id="oiCd" value="' + isoLocal(new Date(base.getTime() + 7 * 86400000)) + '"></label>' +
            '<div class="oi-answer" id="oiCapAns"></div></div>' +
          '<h4>Work on hand · ' + Math.round(total) + 'h</h4>' +
          table(['Client', 'Order', 'Due', 'Hours left', ''], work.sort(function(a, b){ return (a.o.dueDate || '9').localeCompare(b.o.dueDate || '9'); }).map(function(x){ return [esc(who(x.o)), esc(x.o.displayId || ''), fmtDate(x.o.dueDate), Math.round(x.h) + 'h', openBtn(x.o)]; }), [3]),
        after: function(root){
          function draw(){
            var h = Math.max(0, +root.querySelector('#oiCh').value || 0), by = root.querySelector('#oiCd').value, ans = root.querySelector('#oiCapAns');
            if(!(cap > 0)){ ans.textContent = 'Set fleet capacity in Settings first.'; return; }
            // Earliest finish if it joins the back of the queue, and whether work due before it still fits.
            var finish = Math.ceil((total + h) / cap), finishDate = new Date(base.getTime() + (finish - 1) * 86400000);
            var di = by ? Math.round((new Date(by + 'T00:00:00') - base) / 86400000) + 1 : null;
            var dueBefore = work.filter(function(x){ return x.di != null && di != null && x.di <= di; }).reduce(function(s, x){ return s + x.h; }, 0);
            var fits = di != null && dueBefore + h <= cap * di;
            ans.innerHTML = 'In the queue it would finish about <b>' + (typeof schedDayText === 'function' ? schedDayText(finish) : finishDate.toDateString()) + '</b>. ' +
              (di == null ? '' : fits ? '<span style="color:var(--green)">✓ Fits by ' + fmtDate(by) + '</span> if it is printed ahead of orders due later.' : '<span style="color:var(--red)">✗ Won\'t fit by ' + fmtDate(by) + '</span>: ' + Math.round(dueBefore + h - cap * Math.max(0, di)) + 'h over. Use partners or agree a later date.');
          }
          root.querySelector('#oiCh').addEventListener('input', draw); root.querySelector('#oiCd').addEventListener('input', draw); draw();
        }
      };
    }
  };
  var CARD_VIEW = { 'pc-forecast': 'forecast', 'pc-month': 'growth', 'pc-revenue': 'profit', 'pc-conversion': 'net', 'pc-queue': 'cash', 'pc-velocity': 'capacity' };

  // ---------- pop-up ----------
  function close(){ var o = document.getElementById('oiOverlay'); if(o) o.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e){ if(e.key === 'Escape') close(); }
  function open(key){
    close();
    var v = VIEWS[key]();
    var ov = document.createElement('div');
    ov.id = 'oiOverlay';
    ov.innerHTML = '<div class="oi-modal" role="dialog" aria-modal="true" aria-label="' + esc(v.title) + '"><div class="oi-head"><div class="oi-title">' + esc(v.title) + '</div><button type="button" class="oi-x" aria-label="Close">✕</button></div><div class="oi-body">' + v.body + '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){
      if(e.target === ov || e.target.closest('.oi-x')){ close(); return; }
      var b = e.target.closest('button.oi-open[data-oid]');
      if(b){ var id = b.getAttribute('data-oid'), idx = state.orders.findIndex(function(o){ return o.id === id; }); close(); openOrderDetailModal(id, idx); }
    });
    document.addEventListener('keydown', onKey);
    if(v.after) v.after(ov);
  }
  document.addEventListener('click', function(e){
    var c = e.target.closest('#pipelineForecastStrip .pipeline-card'); if(!c) return;
    for(var k in CARD_VIEW){ if(c.classList.contains(k)){ open(CARD_VIEW[k]); return; } }
  });

  var css = document.createElement('style');
  css.textContent = [
    '#pipelineForecastStrip .pipeline-card{cursor:pointer;transition:border-color .15s}',
    '#pipelineForecastStrip .pipeline-card:hover{border-color:var(--cyan)}',
    '#pipelineForecastStrip .pipeline-card .pc-label::after{content:" ›";opacity:.6}',
    '#oiOverlay{position:fixed;inset:0;z-index:4000;background:rgba(8,12,18,.55);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow-y:auto}',
    '.oi-modal{background:var(--panel);border:1px solid var(--line);border-radius:16px;width:100%;max-width:680px;box-shadow:0 24px 60px rgba(0,0,0,.35)}',
    '.oi-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line)}',
    '.oi-title{font-weight:700;font-size:17px}',
    '.oi-x{background:none;border:1px solid var(--line);border-radius:8px;color:var(--dim);cursor:pointer;padding:4px 9px}',
    '.oi-body{padding:16px 20px 20px}',
    '.oi-body h4{font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);margin:18px 0 8px;font-family:"JetBrains Mono",monospace;font-weight:500}',
    '.oi-svg{width:100%;height:auto;display:block}',
    '.oi-svg .oi-ax{font:10px "JetBrains Mono",monospace;fill:var(--dim)}',
    '.oi-svg .oi-val{font:600 11px "Space Grotesk",sans-serif;fill:var(--text)}',
    '.oi-svg .oi-mark:hover path,.oi-svg .oi-mark:hover circle+circle{filter:brightness(1.15)}',
    '.oi-note{font-size:12px;color:var(--dim);margin:6px 0 0}',
    '.oi-big{font-size:26px;font-weight:700;margin-bottom:8px}.oi-big span{font-size:13px;color:var(--dim);font-weight:500}',
    '.oi-stack{position:relative;height:22px;background:var(--panel2);border-radius:6px;margin:4px 0 8px}',
    '.oi-stack span{position:absolute;top:0;bottom:0;border-radius:4px}',
    '.oi-stack i{position:absolute;top:-5px;bottom:-5px;width:0;border-left:2px dashed var(--text)}',
    '.oi-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--dim)}',
    '.oi-legend b{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}',
    '.oi-legend b.oi-dash{width:0;height:12px;border-left:2px dashed var(--text);border-radius:0}',
    '.oi-legend strong{color:var(--text);font-weight:600}',
    '.oi-tool{margin-top:14px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center}',
    '.oi-tool-h{width:100%;font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--cyan);font-family:"JetBrains Mono",monospace}',
    '.oi-tool label{font-size:13px;display:flex;align-items:center;gap:8px}',
    '.oi-tool input[type=number],.oi-tool input[type=date]{width:110px;padding:5px 8px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text);font:inherit}',
    '.oi-answer{width:100%;font-size:13.5px;line-height:1.45}',
    '.oi-seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:2px;margin-bottom:8px}',
    '.oi-seg button{background:none;border:none;border-radius:999px;padding:5px 12px;font:12.5px "Space Grotesk",sans-serif;color:var(--dim);cursor:pointer}',
    '.oi-seg button.on{background:rgba(79,209,197,.15);color:var(--text)}',
    '.oi-tw{overflow-x:auto}',
    '.oi-t{width:100%;border-collapse:collapse;font-size:13px}',
    '.oi-t th{text-align:left;font-weight:500;color:var(--dim);font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line)}',
    '.oi-t td{padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}',
    '.oi-t .n{text-align:right;font-variant-numeric:tabular-nums}',
    '.oi-t .oi-empty{color:var(--dim);text-align:center}',
    '.oi-open{background:none;border:1px solid var(--line);border-radius:7px;padding:3px 9px;font-size:12px;color:var(--cyan);cursor:pointer;text-decoration:none;display:inline-block}',
    '@media (max-width:640px){#oiOverlay{padding:0}.oi-modal{border-radius:0;min-height:100%}}'
  ].join('');
  document.head.appendChild(css);
})();
