'use strict';
/* Financials page (#/financials). Reads data/financials.json per site-contract.md.
   Uses helpers from app.js (el, svg, shape, safeUrl, load, setTitle) at call time. */

const FIN_KNOWN = ['epiroc', 'sandvik', 'caterpillar', 'komatsu'];
const FIN_STYLE = [
  { dash: '', mk: 'circle' }, { dash: '7 4', mk: 'square' }, { dash: '2 4', mk: 'tri' }, { dash: '9 3 2 3', mk: 'diamond' }
];
const qi = q => { const m = /^(\d{4})Q([1-4])$/.exec(q); return m ? +m[1] * 4 + (+m[2] - 1) : NaN; };
const qLong = q => q.slice(0, 4) + ' Q' + q.slice(5);
const qShort = n => String(Math.floor(n / 4)).slice(2) + '.' + (n % 4 + 1);
const qLongI = n => Math.floor(n / 4) + ' Q' + (n % 4 + 1);
const MINUS = '−';
const sgn = (v, d, unit) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(d) + unit;
const thousands = n => Math.round(n).toLocaleString('en').replace(/,/g, ' ');

function finPrep(data) {
  const unknownSlot = [];
  return data.companies.map((c, idx) => {
    let slot = FIN_KNOWN.indexOf(c.slug);
    if (slot < 0) slot = idx % 4;
    const qs = (c.quarters || []).map(q => ({ ...q, qi: qi(q.quarter) })).filter(q => !isNaN(q.qi) && q.revenue > 0).sort((a, b) => a.qi - b.qi);
    return { c, slot, qs, byQi: new Map(qs.map(q => [q.qi, q])), last: qi(c.latest_quarter) };
  });
}
function marginSeries(co, mode) {
  const pts = [];
  co.qs.forEach((q, i) => {
    if (mode === 'ltm') {
      if (i < 3) return;
      const w = co.qs.slice(i - 3, i + 1);
      if (w[3].qi - w[0].qi !== 3) return; // need 4 consecutive quarters
      const rev = w.reduce((a, b) => a + b.revenue, 0);
      if (!(rev > 0)) return;
      pts.push({ qi: q.qi, v: w.reduce((a, b) => a + b.profit, 0) / rev * 100, q, derived: w.some(x => x.profit_derived === true) });
    } else pts.push({ qi: q.qi, v: q.profit / q.revenue * 100, q, derived: q.profit_derived === true });
  });
  return pts;
}
const revenueSeries = co => co.qs.map(q => ({ qi: q.qi, v: q.revenue_msek, q }));

function niceDomain(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08; min -= pad; max += pad;
  const raw = (max - min) / 5, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(+t.toFixed(6));
  return { lo, hi, ticks };
}

/* generic multi-series line chart with tooltip, keyboard and pointer support */
function lineChart(cfg) {
  // cfg: {label, series:[{co,slot,pts}], fmtAxis, fmtVal, valueLabel(s,p), srcLabel(p)}
  const wrap = el('div', { class: 'fin-wrap' });
  const plot = el('div', { class: 'fin-plot', tabindex: '0', role: 'group' });
  const tip = el('div', { class: 'fin-tip', hidden: true });
  const live = el('div', { class: 'vh', 'aria-live': 'polite' });
  wrap.append(plot, tip, live);
  const all = cfg.series.flatMap(s => s.pts);
  let state = null, pinned = false, geo = null;

  function draw() {
    const W = Math.max(wrap.clientWidth || 320, 260), H = W < 480 ? 250 : 320;
    const vals = all.map(p => p.v);
    plot.setAttribute('aria-label', cfg.label + '. Arrow keys: left and right change quarter, up and down change company, Escape closes the tooltip.');
    if (!vals.length) { plot.replaceChildren(el('p', { class: 'status-line', text: 'No data to plot.' })); geo = null; return; }
    const dom = niceDomain(Math.min(...vals), Math.max(...vals));
    const padL = Math.max(...dom.ticks.map(t => cfg.fmtAxis(t).length)) * 6.6 + 14, padR = 14, padT = 10, padB = 28;
    const q0 = Math.min(...all.map(p => p.qi)), q1 = Math.max(...all.map(p => p.qi)), nq = Math.max(q1 - q0, 1);
    const x = n => padL + (n - q0) / nq * (W - padL - padR);
    const y = v => padT + (1 - (v - dom.lo) / (dom.hi - dom.lo)) * (H - padT - padB);
    const pxq = (W - padL - padR) / nq, k = pxq >= 34 ? 1 : pxq >= 17 ? 2 : 4;
    const g = svg('svg', { class: 'fin-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
    dom.ticks.forEach(t => g.append(
      svg('line', { class: t === 0 ? 'fin-zero' : 'fin-grid', x1: padL, x2: W - padR, y1: y(t), y2: y(t) }),
      svg('text', { class: 'fin-lbl', x: padL - 6, y: y(t) + 4, 'text-anchor': 'end' }, cfg.fmtAxis(t))));
    for (let n = q0; n <= q1; n++) if ((n % 4) % k === 0) g.append(
      svg('line', { class: 'fin-tick', x1: x(n), x2: x(n), y1: H - padB, y2: H - padB + 4 }),
      svg('text', { class: 'fin-lbl', x: x(n), y: H - padB + 17, 'text-anchor': 'middle' }, qShort(n)));
    const cross = svg('line', { class: 'fin-cross', y1: padT, y2: H - padB, visibility: 'hidden' });
    g.append(cross);
    const ring = svg('g', { visibility: 'hidden' });
    g.append(ring);
    cfg.series.forEach(s => {
      if (!s.pts.length) return;
      const st = FIN_STYLE[s.slot], col = `color:var(--s${s.slot + 1})`;
      let d = '', dd = '';
      s.pts.forEach((p, i) => {
        const pt = x(p.qi).toFixed(1) + ' ' + y(p.v).toFixed(1), prev = s.pts[i - 1];
        if (i && p.qi - prev.qi === 1) {
          if (p.derived && prev.derived) dd += 'M' + x(prev.qi).toFixed(1) + ' ' + y(prev.v).toFixed(1) + 'L' + pt;
          else d += 'M' + x(prev.qi).toFixed(1) + ' ' + y(prev.v).toFixed(1) + 'L' + pt;
        }
      });
      const grp = svg('g', { style: col }, svg('path', { class: 'fin-line', d, 'stroke-dasharray': st.dash || null }),
        dd ? svg('path', { class: 'fin-line light', d: dd, 'stroke-dasharray': st.dash || null }) : null);
      s.pts.forEach((p, i) => { if (pxq >= 22 || p.qi % 4 === 0 || i === s.pts.length - 1 || p.derived !== (s.pts[i - 1] || {}).derived) grp.append(shape(st.mk, x(p.qi), y(p.v), 3.6, 'shp fin-mk' + (p.derived ? ' hollow' : ''))); });
      g.append(grp);
    });
    const over = svg('rect', { class: 'fin-over', x: padL, y: padT, width: W - padL - padR, height: H - padT - padB, fill: 'transparent' });
    g.append(over);
    plot.replaceChildren(g);
    geo = { x, y, W, H, padL, padR, padT, padB, q0, q1, cross, ring };
    const at = ev => {
      const r = over.getBoundingClientRect(), px = ev.clientX - r.left + padL, py = ev.clientY - r.top + padT;
      const n = Math.round(q0 + (px - padL) / (W - padL - padR) * nq);
      let best = null;
      cfg.series.forEach((s, si) => {
        let bi = -1, bd = 1e9;
        s.pts.forEach((p, i) => { const dd = Math.abs(p.qi - n); if (dd < bd) { bd = dd; bi = i; } });
        if (bi < 0 || bd > 1) return;
        const dy = Math.abs(y(s.pts[bi].v) - py);
        if (!best || dy < best.dy) best = { si, i: bi, dy };
      });
      return best;
    };
    over.addEventListener('pointermove', ev => { if (!pinned) { const b = at(ev); if (b) show(b.si, b.i); } });
    over.addEventListener('pointerdown', ev => { const b = at(ev); if (b) { show(b.si, b.i); pinned = true; } else { pinned = false; hide(); } });
    if (state) show(state.si, Math.min(state.i, cfg.series[state.si].pts.length - 1), true);
  }

  function show(si, i, keep) {
    const s = cfg.series[si], p = s && s.pts[i];
    if (!p || !geo) return;
    state = { si, i };
    const px = geo.x(p.qi), py = geo.y(p.v);
    geo.cross.setAttribute('x1', px); geo.cross.setAttribute('x2', px); geo.cross.setAttribute('visibility', 'visible');
    geo.ring.replaceChildren(svg('g', { style: `color:var(--s${s.slot + 1})` }, shape(FIN_STYLE[s.slot].mk, px, py, 7, 'shp fin-ring' + (p.derived ? ' hollow' : ''))));
    geo.ring.setAttribute('visibility', 'visible');
    const src = p.q.source || {};
    tip.replaceChildren(
      el('div', { class: 'ft-q', text: qLongI(p.qi) }),
      el('div', { class: 'ft-co', style: `color:var(--s${s.slot + 1})` }, el('span', { class: 'ft-sw', 'aria-hidden': 'true' }), el('span', { class: 'ft-name', text: s.co.c.name })),
      el('div', { class: 'ft-v', text: cfg.fmtVal(p.v) }),
      el('div', { class: 'ft-m', text: cfg.valueLabel(s, p) }),
      p.derived ? el('div', { class: 'ft-der', text: 'Derived (EBIT + amortisation)' }) : null,
      src.url ? el('a', { href: safeUrl(src.url), target: '_blank', rel: 'noopener noreferrer' }, cfg.srcLabel(p) + ' ↗') : null,
      src.locator ? el('div', { class: 'ft-m', text: src.locator }) : null);
    live.textContent = qLongI(p.qi) + ', ' + s.co.c.name + ': ' + cfg.fmtVal(p.v) + ', ' + cfg.valueLabel(s, p);
    tip.hidden = false;
    const hw = tip.offsetWidth / 2, th = tip.offsetHeight;
    const below = py - th - 16 < 0;
    tip.classList.toggle('below', below);
    tip.style.left = Math.min(Math.max(px, hw + 4), geo.W - hw - 4) + 'px';
    tip.style.top = (below ? py + 14 : py - 14) + 'px';
    tip.style.transform = below ? 'translate(-50%,0)' : 'translate(-50%,-100%)';
  }
  function hide() {
    tip.hidden = true; pinned = false;
    if (geo) { geo.cross.setAttribute('visibility', 'hidden'); geo.ring.setAttribute('visibility', 'hidden'); }
  }
  plot.addEventListener('keydown', ev => {
    const ns = cfg.series.length; if (!ns) return;
    let { si, i } = state || { si: cfg.series.findIndex(s => s.pts.length), i: -1 };
    if (si < 0) return;
    const pts = () => cfg.series[si].pts;
    if (ev.key === 'ArrowRight') i = Math.min(i + 1, pts().length - 1);
    else if (ev.key === 'ArrowLeft') i = Math.max(i < 0 ? 0 : i - 1, 0);
    else if (ev.key === 'Home') i = 0;
    else if (ev.key === 'End') i = pts().length - 1;
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      const cur = pts()[Math.max(i, 0)], d = ev.key === 'ArrowUp' ? -1 : 1;
      let n = si; do { n = (n + d + ns) % ns; } while (!cfg.series[n].pts.length && n !== si);
      si = n; const np = pts(); let bi = 0, bd = 1e9;
      np.forEach((p, j) => { const dd = Math.abs(p.qi - (cur ? cur.qi : 0)); if (dd < bd) { bd = dd; bi = j; } });
      i = bi;
    } else if (ev.key === 'Escape') { hide(); return; } else return;
    ev.preventDefault(); pinned = false; show(si, Math.max(i, 0));
  });
  plot.addEventListener('focus', () => { if (!state) { const si = cfg.series.findIndex(s => s.pts.length); if (si >= 0) show(si, cfg.series[si].pts.length - 1); } else show(state.si, state.i); });
  wrap.addEventListener('focusout', ev => { if (!wrap.contains(ev.relatedTarget)) hide(); });
  wrap.addEventListener('mouseleave', () => { if (!wrap.matches(':focus-within') && !pinned) hide(); });
  return { node: wrap, draw };
}

function legendFor(rows, withMetric, opts) {
  return el('ul', { class: 'fin-legend' }, rows.map(s => {
    const on = !(opts && opts.hidden.has(s.co.c.slug));
    const last = on && opts && opts.count() <= 1;
    const inner = [svg('svg', { width: 34, height: 14, viewBox: '0 0 34 14', 'aria-hidden': 'true', style: `color:var(--s${s.slot + 1})` },
      svg('line', { x1: 1, x2: 33, y1: 7, y2: 7, class: 'fin-line', 'stroke-dasharray': FIN_STYLE[s.slot].dash || null }), shape(FIN_STYLE[s.slot].mk, 17, 7, 3.6, 'shp')),
    el('span', {}, el('strong', { text: s.co.c.name }), withMetric ? ' \u2014 ' + s.co.c.profit_metric : '')];
    return el('li', {}, opts ? el('button', { type: 'button', class: 'fin-lb' + (on ? '' : ' off'), 'aria-pressed': String(on), 'aria-disabled': last ? 'true' : null, title: last ? 'At least one company must stay visible' : (on ? 'Hide ' : 'Show ') + s.co.c.name, onclick: () => opts.onToggle(s.co.c.slug) }, inner) : inner);
  }));
}

function dataTable(caption, rows, cols, fmt) {
  // rows: quarter indices; cols: [{name, get(qi) -> {v, url}|null}]
  return el('details', { class: 'fin-data' }, el('summary', {}, 'Show data as a table'),
    el('div', { class: 'fin-tablewrap' }, el('table', {}, el('caption', { class: 'vh', text: caption }),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Quarter'), cols.map(c => el('th', { scope: 'col' }, c.name)))),
      el('tbody', {}, rows.map(n => el('tr', {}, el('th', { scope: 'row' }, qLongI(n)), cols.map(c => {
        const d = c.get(n);
        if (c.plain) return el('td', { class: 'ft-basis', text: d || '\u2013' });
        return el('td', {}, d ? [fmt(d.v), ' ', d.url ? el('a', { href: safeUrl(d.url), target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Source for ' + c.name + ' ' + qLongI(n) }, 'src') : null] : '–');
      })))))));
}

function tileDelta(txt, dir) {
  return el('span', { class: 'fin-delta ' + (dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat') },
    el('span', { 'aria-hidden': 'true', text: dir > 0 ? '▲ ' : dir < 0 ? '▼ ' : '▬ ' }), txt);
}

async function viewFinancials(route0) {
  route0 = route0 || {};
  setTitle('Financials');
  let data;
  try { data = await load('data/financials.json'); } catch (e) {
    const missing = /HTTP 404/.test(String(e.message));
    return app.replaceChildren(el('h1', { text: 'Financials' }), el('div', { class: 'state', role: missing ? null : 'alert' },
      el('h2', { text: missing ? 'Financials not published yet' : 'Could not load the financials' }),
      el('p', { text: missing ? 'The quarterly comparison will appear here once the first numbers have been extracted.' : String(e.message || e) })));
  }
  const cos = finPrep(data || { companies: [] });
  if (!cos.length) return app.replaceChildren(el('h1', { text: 'Financials' }), el('div', { class: 'state' }, el('h2', { text: 'Financials not published yet' }), el('p', { text: 'The file contains no companies.' })));
  const newest = Math.max(...cos.map(c => c.last).filter(n => !isNaN(n)));
  let mode = 'quarterly';

  /* status chips */
  const chips = el('ul', { class: 'fin-chips', 'aria-label': 'Reporting status per company' }, cos.map(co => {
    const behind = co.last < newest;
    return el('li', { class: 'chip' + (behind ? ' wait' : '') },
      el('strong', { text: co.c.name }), ' · ',
      behind ? [el('span', { 'aria-hidden': 'true', text: '⏳ ' }), 'awaiting ' + qLongI(co.last + 1) + ' report' + (co.c.next_report_date ? ' · due ' + co.c.next_report_date : '')]
        : 'latest quarter ' + qLongI(co.last));
  }));
  const metrics = cos.map(co => co.c.name + ': ' + co.c.profit_metric + ' (' + co.c.segment + ', ' + co.c.reporting_currency + ')').join(' · ');
  const metricNote = el('p', { class: 'fin-note' }, el('strong', { text: 'Metrics differ: ' }), metrics + '. Margins are comparable in direction, not strictly like-for-like.');

  /* shared show/hide state (kept in the URL hash query) */
  const hidden = new Set((route0.hide || '').split(',').filter(s => cos.some(c => c.c.slug === s)));
  if (hidden.size >= cos.length) hidden.clear();
  let revMode = route0.rev === 'indexed' ? 'indexed' : 'msek';
  function syncUrl() {
    const p = new URLSearchParams();
    if (hidden.size) p.set('hide', [...hidden].join(','));
    if (revMode === 'indexed') p.set('rev', 'indexed');
    const qs = p.toString();
    try { history.replaceState(null, '', '#/financials' + (qs ? '?' + qs.replace(/%2C/g, ',') : '')); } catch (e) { /* ignore */ }
  }
  const visible = () => cos.filter(co => !hidden.has(co.c.slug));
  function toggleCo(slug) {
    if (hidden.has(slug)) hidden.delete(slug);
    else if (visible().length > 1) hidden.add(slug);
    else return;
    syncUrl(); buildProfit(); buildRevenue();
  }
  const legendOpts = { hidden, onToggle: toggleCo, count: () => visible().length };
  const hasBreak = co => (co.c.notes || []).some(n => /structural break/i.test(n));
  const breakChip = co => hasBreak(co) ? el('p', { class: 'fin-break' }, el('span', { 'aria-hidden': 'true', text: 'ⓘ ' }), 'series break — see data notes') : null;
  const tileCls = co => 'fin-tile' + (hidden.has(co.c.slug) ? ' dim' : '');

  /* profit panel */
  const profitHost = el('div', {}), profitLegend = el('div', {}), profitTiles = el('div', {}), profitData = el('div', {});
  let profitChart = null, revChart = null;
  const segBtns = [['quarterly', 'Quarterly'], ['ltm', 'LTM']].map(([m, t]) => el('button', { type: 'button', class: 'seg', onclick: () => { mode = m; buildProfit(); } }, t));
  function buildProfit() {
    segBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['quarterly', 'ltm'][i] === mode)));
    const all = cos.map(co => ({ co, slot: co.slot, pts: marginSeries(co, mode) }));
    const series = all.filter(s => !hidden.has(s.co.c.slug));
    profitChart = lineChart({
      series, label: 'Operating margin per company, ' + (mode === 'ltm' ? 'last twelve months' : 'quarterly'),
      fmtAxis: v => v.toFixed(v % 1 ? 1 : 0) + '%', fmtVal: v => v.toFixed(1) + '%',
      valueLabel: (s, p) => s.co.c.profit_metric + (mode === 'ltm' ? ' margin, LTM' : ' margin, quarter'),
      srcLabel: p => mode === 'ltm' ? 'Source (latest quarter in window)' : 'Source'
    });
    profitHost.replaceChildren(profitChart.node);
    profitLegend.replaceChildren(legendFor(all, true, legendOpts),
      cos.some(co => co.qs.some(q => q.profit_derived === true)) ? el('p', { class: 'fin-der-note' }, el('span', { 'aria-hidden': 'true', class: 'hollow-key' }), ' Hollow markers: EBITA derived from reported EBIT + amortisation (see data notes)') : null);
    profitTiles.replaceChildren(el('ul', { class: 'fin-tiles' }, all.map(s => {
      const f = s.pts[0], l = s.pts[s.pts.length - 1];
      if (!f || !l) return el('li', { class: tileCls(s.co) }, tileHead(s), el('p', { class: 'muted', text: mode === 'ltm' ? 'Needs four consecutive quarters.' : 'No data.' }), breakChip(s.co));
      const d = l.v - f.v;
      return el('li', { class: tileCls(s.co) }, tileHead(s),
        el('p', { class: 'ft-big' }, f.v.toFixed(1) + '% → ' + l.v.toFixed(1) + '%'),
        el('p', { class: 'ft-sub' }, tileDelta(sgn(d, 1, ' pp'), Math.abs(d) < 0.05 ? 0 : d), ' · ' + qLongI(f.qi) + ' → ' + qLongI(l.qi) + (mode === 'ltm' ? ' (LTM)' : '')), breakChip(s.co));
    })));
    const rows = [...new Set(series.flatMap(s => s.pts.map(p => p.qi)))].sort((a, b) => a - b);
    const tcols = [];
    series.forEach(s => {
      tcols.push({ name: s.co.c.name, get: n => { const p = s.pts.find(x => x.qi === n); return p && { v: p.v, url: p.q.source && p.q.source.url }; } });
      if (s.pts.some(p => p.derived)) tcols.push({ name: 'Basis' + (series.length > 1 ? ' (' + s.co.c.name + ')' : ''), plain: true, get: n => { const p = s.pts.find(x => x.qi === n); return p && (p.derived ? 'derived' : 'reported'); } });
    });
    profitData.replaceChildren(dataTable('Operating margin by quarter', rows, tcols, v => v.toFixed(1) + '%'));
    profitChart.draw();
  }
  function tileHead(s) {
    return el('h3', { class: 'ft-head' }, svg('svg', { width: 22, height: 12, viewBox: '0 0 22 12', 'aria-hidden': 'true', style: `color:var(--s${s.slot + 1})` },
      svg('line', { x1: 1, x2: 21, y1: 6, y2: 6, class: 'fin-line', 'stroke-dasharray': FIN_STYLE[s.slot].dash || null }), shape(FIN_STYLE[s.slot].mk, 11, 6, 3, 'shp')), s.co.c.name);
  }

  /* revenue panel */
  const revHost = el('div', {}), revLegend = el('div', {}), revTiles = el('div', {}), revData = el('div', {});
  const revSub = el('p', { class: 'meta' });
  const revSegs = [['msek', 'MSEK'], ['indexed', 'Indexed']].map(([m, t]) => el('button', { type: 'button', class: 'seg', onclick: () => { revMode = m; syncUrl(); buildRevenue(); } }, t));
  function buildRevenue() {
    revSegs.forEach((b, i) => b.setAttribute('aria-pressed', String(['msek', 'indexed'][i] === revMode)));
    const idx = revMode === 'indexed';
    const all = cos.map(co => {
      const base = co.qs.length ? co.qs[0].revenue_msek : 1;
      return { co, slot: co.slot, base, pts: revenueSeries(co).map(p => ({ ...p, msek: p.v, v: idx ? p.v / base * 100 : p.v })) };
    });
    const series = all.filter(s => !hidden.has(s.co.c.slug));
    const firsts = [...new Set(all.filter(s => s.pts.length).map(s => s.pts[0].qi))];
    revSub.textContent = idx ? 'Indexed, ' + (firsts.length === 1 ? qLongI(firsts[0]) : 'each company’s first quarter') + ' = 100' : 'MSEK per calendar quarter';
    revChart = lineChart({
      series, label: idx ? 'Quarterly revenue per company, indexed to first quarter = 100' : 'Quarterly revenue per company in MSEK',
      fmtAxis: v => idx ? String(Math.round(v)) : thousands(v), fmtVal: v => idx ? 'Index ' + v.toFixed(1) : thousands(v) + ' MSEK',
      valueLabel: (s, p) => (idx ? 'Revenue indexed to ' + qLongI(s.pts[0].qi) + ' = 100 · ' + thousands(p.msek) + ' MSEK' : 'Revenue, MSEK') + (s.co.c.reporting_currency !== 'SEK' ? ' (converted from ' + s.co.c.reporting_currency + ' at ' + (p.q.fx_rate_to_sek || '?') + ')' : ''),
      srcLabel: () => 'Source'
    });
    revHost.replaceChildren(revChart.node);
    revLegend.replaceChildren(legendFor(all, false, legendOpts));
    revTiles.replaceChildren(el('ul', { class: 'fin-tiles' }, all.map(s => {
      const co = s.co, l = co.qs[co.qs.length - 1], p = l && co.byQi.get(l.qi - 4);
      if (!l || !p) return el('li', { class: tileCls(co) }, tileHead(s), el('p', { class: 'muted', text: 'No year-earlier quarter to compare.' }), breakChip(co));
      const g = (l.revenue / p.revenue - 1) * 100;
      return el('li', { class: tileCls(co) }, tileHead(s),
        el('p', { class: 'ft-big' }, tileDelta(sgn(g, 1, '%'), Math.abs(g) < 0.05 ? 0 : g)),
        el('p', { class: 'ft-sub', text: 'YoY Q' + (l.qi % 4 + 1) + ' ' + Math.floor(l.qi / 4) + ' vs Q' + (l.qi % 4 + 1) + ' ' + (Math.floor(l.qi / 4) - 1) + ' · in ' + co.c.reporting_currency }), breakChip(co));
    })));
    const rows = [...new Set(series.flatMap(s => s.pts.map(p => p.qi)))].sort((a, b) => a - b);
    revData.replaceChildren(dataTable(idx ? 'Revenue index by quarter' : 'Revenue by quarter in MSEK', rows, series.map(s => ({ name: s.co.c.name, get: n => { const p = s.pts.find(x => x.qi === n); return p && { v: p.v, url: p.q.source && p.q.source.url }; } })), v => idx ? v.toFixed(1) : thousands(v)));
    revChart.draw();
  }

  /* comments */
  const comments = el('div', { class: 'fin-comments' }, cos.map(co => {
    const cm = co.c.comments || {}, notes = (co.c.notes || []).concat(co.c.fiscal_year_note ? [co.c.fiscal_year_note] : []);
    return el('article', { class: 'fin-comment', style: `--cc:var(--s${co.slot + 1})` },
      el('h3', {}, co.c.name, ' ', el('span', { class: 'badge type', text: cm.quarter ? qLong(cm.quarter) : '' })),
      el('ul', {}, (cm.points || []).map(t => el('li', { text: t }))),
      cm.source_url ? el('p', { class: 'meta' }, el('a', { href: safeUrl(cm.source_url), target: '_blank', rel: 'noopener noreferrer' }, 'from ' + co.c.name + '’s ' + (cm.quarter ? qLong(cm.quarter) : 'latest') + ' report ↗')) : null,
      notes.length ? el('details', { class: 'fin-notes' }, el('summary', {}, 'Data notes'), el('ul', {}, notes.map(n => el('li', { text: n })))) : null);
  }));

  const fx = data.fx_source || {};
  app.replaceChildren(
    el('h1', { text: 'Financials' }),
    el('p', { class: 'lede', text: 'Like-for-like quarterly comparison of Epiroc and its listed competitors, from each company’s own reports.' }),
    chips, metricNote,
    el('section', { class: 'panel', 'aria-labelledby': 'fp-h' },
      el('div', { class: 'lu-head' }, el('div', {}, el('h2', { id: 'fp-h', text: 'Operating margin' }), el('p', { class: 'meta', text: 'Profit ÷ revenue, % per calendar quarter' })),
        el('div', { class: 'segs', role: 'group', 'aria-label': 'Margin basis' }, segBtns)),
      profitLegend, profitHost, profitTiles, profitData),
    el('section', { class: 'panel', 'aria-labelledby': 'fr-h' },
      el('div', { class: 'lu-head' }, el('div', {}, el('h2', { id: 'fr-h', text: 'Revenue' }), revSub),
        el('div', { class: 'segs', role: 'group', 'aria-label': 'Revenue view' }, revSegs)),
      revLegend, revHost, revTiles, revData),
    el('section', { class: 'panel', 'aria-labelledby': 'fc-h' }, el('h2', { id: 'fc-h', text: 'What the companies said' }), comments),
    el('p', { class: 'fin-foot' }, 'Numbers from each company’s own quarterly reports; revenue converted to MSEK at Riksbank quarterly average rates; margins computed from reported revenue and profit.',
      fx.url ? [' FX source: ', el('a', { href: safeUrl(fx.url), target: '_blank', rel: 'noopener noreferrer' }, fx.name || fx.url), '.'] : null,
      data.generated ? ' Data generated ' + data.generated + '.' : ''));
  function redrawAll() { if (profitChart) profitChart.draw(); if (revChart) revChart.draw(); }
  buildProfit(); buildRevenue();
  window.__redraw = redrawAll;
}
