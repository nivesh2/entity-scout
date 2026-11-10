'use strict';
/* Entity Scout dashboard. Reads data/index.json + data/<slug>/*.json|md per site-contract.md. */

const AREAS = [
  'Strategy & stated priorities', 'Financial performance', 'M&A, investments, divestments',
  'Restructurings & organizational changes', 'Hiring, talent signals & leadership changes',
  'Product launches & portfolio changes', 'Sustainability & ESG disclosures',
  'Capital market events & reporting calendar', 'Share price movements (with market/peer context)'
];
const TYPES = { own_company: 'Own company', competitor: 'Competitor', customer: 'Customer', supplier_partner: 'Supplier / partner' };
const MAT = {
  new: { label: 'New', icon: '✦', hint: 'Not previously disclosed or done' },
  acceleration: { label: 'Acceleration', icon: '▲', hint: 'Continues an existing direction, faster or bigger' },
  reversal: { label: 'Reversal', icon: '↺', hint: 'Goes against prior strategy, behaviour or guidance' },
  inconsistency: { label: 'Inconsistency', icon: '≠', hint: 'Contradicts what the entity said earlier or elsewhere' }
};
const SRC = { official: 'Official', media: 'Media', market_data: 'Market data' };
const MODES = { baseline: 'Baseline', update: 'Update' };

const app = document.getElementById('app');
const cache = new Map();
let manifest = null;
let filters = { key: '', mat: '', area: '', src: '', q: '' };

/* ---------- helpers ---------- */
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
function safeUrl(u) {
  try { const p = new URL(u, location.href); return /^https?:$/.test(p.protocol) ? p.href : '#'; } catch (e) { return '#'; }
}
async function load(path, kind) {
  if (cache.has(path)) return cache.get(path);
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' returned HTTP ' + r.status);
  const v = kind === 'text' ? await r.text() : await r.json();
  cache.set(path, v);
  return v;
}
const fmtDate = d => d || '';
function matBadge(m) {
  const d = MAT[m] || { label: m, icon: '•', hint: '' };
  return el('span', { class: 'badge m-' + m, title: d.hint }, el('span', { class: 'icon', 'aria-hidden': 'true', text: d.icon }), d.label);
}
const typeBadge = t => el('span', { class: 'badge type' }, TYPES[t] || t);
function setTitle(t) { document.title = t ? t + ' · Entity Scout' : 'Entity Scout'; }

/* ---------- routing ---------- */
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(qs || '');
  if (!parts.length) return { view: 'overview' };
  if (parts[0] === 'financials' && parts.length === 1) return { view: 'financials', hide: q.get('hide'), rev: q.get('rev') };
  if (parts[0] === 'e' && parts[1] && parts.length === 2) return { view: 'entity', slug: parts[1], scan: q.get('scan') };
  if (parts[0] === 'e' && parts[1] && parts[2] === 'brief' && parts.length === 3) return { view: 'brief', slug: parts[1], scan: q.get('scan') };
  return { view: 'missing' };
}
const entityHref = (slug, scan, brief) => '#/e/' + encodeURIComponent(slug) + (brief ? '/brief' : '') + (scan ? '?scan=' + encodeURIComponent(scan) : '');

async function route() {
  window.scrollTo(0, 0);
  window.__redraw = null;
  const r = parseRoute();
  app.replaceChildren(el('p', { class: 'state', text: 'Loading…' }));
  try {
    if (!manifest) manifest = await load('data/index.json');
  } catch (e) {
    document.getElementById('updated').textContent = 'unavailable';
    return app.replaceChildren(el('div', { class: 'state error', role: 'alert' },
      el('h2', { text: 'Could not load the data' }),
      el('p', {}, 'The page could not read ', el('code', { text: 'data/index.json' }), '. It must be served over http (for example on GitHub Pages, or locally with ', el('code', { text: 'python3 -m http.server' }), '); opening the file directly from disk will not work.'),
      el('p', { class: 'muted', text: String(e.message || e) })));
  }
  document.getElementById('updated').textContent = fmtDate(manifest.updated);
  document.querySelectorAll('[data-nav]').forEach(a => { const on = a.dataset.nav === (r.view === 'financials' ? 'fin' : 'home'); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  try {
    if (r.view === 'overview') await viewOverview();
    else if (r.view === 'financials') await viewFinancials(r);
    else if (r.view === 'missing') viewMissing('This address does not match any page.');
    else {
      const ent = manifest.entities.find(x => x.slug === r.slug);
      if (!ent) viewMissing('There is no entity called “' + r.slug + '” on the watchlist.');
      else if (!ent.latest) viewQueued(ent);
      else if (r.view === 'entity') await viewEntity(ent, r);
      else await viewBrief(ent, r);
    }
  } catch (e) {
    app.replaceChildren(el('div', { class: 'state error', role: 'alert' },
      el('h2', { text: 'Something went wrong' }), el('p', { text: String(e.message || e) }),
      el('p', {}, el('a', { href: '#/' }, 'Back to overview'))));
  }
  app.focus({ preventScroll: true });
}

/* ---------- views ---------- */
function viewMissing(msg) {
  setTitle('Not found');
  app.replaceChildren(el('div', { class: 'state' }, el('h2', { text: 'Not found' }), el('p', { text: msg }), el('a', { href: '#/' }, 'Back to overview')));
}
function viewQueued(ent) {
  setTitle(ent.name);
  app.replaceChildren(
    el('p', { class: 'crumbs' }, el('a', { href: '#/' }, '← All entities')),
    el('div', { class: 'entity-head' }, el('h1', { text: ent.name }), typeBadge(ent.type)),
    el('div', { class: 'state' }, el('h2', { text: 'Queued' }), el('p', { text: 'This entity has not been scanned yet. Its first brief will appear here once the agent has run.' })));
}

async function viewOverview() {
  setTitle('');
  const built = manifest.entities.map(buildCard);
  app.replaceChildren(
    el('h1', { text: 'Watchlist' }),
    el('p', { class: 'lede', text: 'Latest scan per company. Select a card for the full findings and the brief.' }),
    el('ul', { class: 'grid' }, built.map(b => b.li)));
  built.forEach(b => { if (b.fill) b.fill(); });
}

function buildCard(ent) {
  const l = ent.latest;
  const li = el('li', {});
  if (!l) {
    li.append(el('div', { class: 'card queued' },
      el('h2', {}, el('a', { href: entityHref(ent.slug) }, ent.name)),
      el('div', {}, typeBadge(ent.type), ' ', el('span', { class: 'badge type' }, 'Queued')),
      el('p', { class: 'meta', text: 'Not scanned yet.' })));
    return { li };
  }
  const mixHost = el('div', { class: 'mixhost' });
  li.append(el('div', { class: 'card' },
    el('h2', {}, el('a', { href: entityHref(ent.slug) }, ent.name)),
    el('div', {}, typeBadge(ent.type)),
    el('p', { class: 'meta' }, 'Last scan ' + l.generated + ' · ' + (MODES[l.mode] || l.mode), el('br'), 'Window ' + l.window_start + ' to ' + l.window_end),
    el('dl', { class: 'stats' },
      el('div', { class: 'stat' }, el('dt', { text: 'Findings' }), el('dd', { text: l.findings })),
      el('div', { class: 'stat' }, el('dt', { text: 'Top changes' }), el('dd', { text: l.top }))),
    mixHost));
  // materiality mix is not in the manifest: derive it from the scan JSON
  const fill = () => load(l.json).then(j => {
    const counts = {};
    (j.findings || []).forEach(f => { counts[f.materiality] = (counts[f.materiality] || 0) + 1; });
    const total = (j.findings || []).length;
    if (!total) return;
    const newest = j.findings.map(f => f.date).sort().pop();
    mixHost.before(el('p', { class: 'meta', text: 'Latest finding ' + newest }));
    const bar = el('div', { class: 'mix', role: 'img', 'aria-label': 'Materiality mix: ' + Object.keys(MAT).map(k => (counts[k] || 0) + ' ' + MAT[k].label.toLowerCase()).join(', ') });
    const legend = el('ul', { class: 'mix-legend' });
    Object.keys(MAT).forEach(k => {
      if (!counts[k]) return;
      bar.append(el('span', { class: 'm-' + k, style: 'flex:' + counts[k] }));
      legend.append(el('li', { class: 'm-' + k }, el('span', { class: 'icon', 'aria-hidden': 'true', text: MAT[k].icon }), counts[k] + ' ' + MAT[k].label.toLowerCase()));
    });
    mixHost.append(bar, legend);
  }).catch(() => {});
  return { li, fill };
}

function scanChoices(ent) {
  const list = (ent.history || []).slice();
  if (ent.latest && !list.some(h => h.generated === ent.latest.generated)) {
    list.unshift({ generated: ent.latest.generated, mode: ent.latest.mode, json: ent.latest.json, brief: ent.latest.brief });
  }
  return list;
}
function pickScan(ent, r) {
  const hit = r.scan && scanChoices(ent).find(h => h.generated === r.scan);
  const isLatest = !hit || hit.generated === ent.latest.generated;
  const chosen = isLatest ? ent.latest : hit;
  return { json: chosen.json, brief: chosen.brief, date: isLatest ? ent.latest.generated : hit.generated, isLatest };
}
function entityHeader(ent, r, active, scan) {
  const choices = scanChoices(ent);
  const parts = [
    el('p', { class: 'crumbs' }, el('a', { href: '#/' }, '← All entities')),
    el('div', { class: 'entity-head' }, el('h1', { text: ent.name }), typeBadge(ent.type))
  ];
  if (choices.length > 1) {
    const sel = el('select', { id: 'scan-select', 'aria-label': 'Scan' });
    choices.forEach(h => sel.append(el('option', { value: h.generated, selected: h.generated === scan.date }, h.generated + ' · ' + (MODES[h.mode] || h.mode))));
    sel.addEventListener('change', () => {
      const first = choices[0].generated;
      location.hash = entityHref(ent.slug, sel.value === first ? '' : sel.value, active === 'brief');
    });
    parts.push(el('div', { class: 'history' }, el('label', { for: 'scan-select' }, 'Scan history'), sel));
  }
  const scanQ = r.scan && !scan.isLatest ? r.scan : '';
  parts.push(el('nav', { class: 'tabs', 'aria-label': 'Views' },
    el('a', { href: entityHref(ent.slug, scanQ), 'aria-current': active === 'findings' ? 'page' : null }, 'Findings'),
    el('a', { href: entityHref(ent.slug, scanQ, true), 'aria-current': active === 'brief' ? 'page' : null }, 'Brief')));
  return parts;
}

async function viewEntity(ent, r) {
  const scan = pickScan(ent, r);
  const data = await load(scan.json);
  setTitle(ent.name);
  const key = ent.slug + '|' + scan.date;
  if (filters.key !== key) filters = { key, mat: '', area: '', src: '', q: '' };

  const s = data.scan || {};
  const findings = data.findings || [];
  const byId = Object.fromEntries(findings.map(f => [f.id, f]));
  const areasHost = el('div', { id: 'areas' });
  const countEl = el('p', { class: 'count', role: 'status' });

  const top = (data.top_material_changes || []).map(id => byId[id]).filter(Boolean);
  const topPanel = el('section', { class: 'panel', 'aria-labelledby': 'top-h' },
    el('h2', { id: 'top-h', text: 'Top material changes' }),
    top.length ? el('ol', { class: 'top-list' }, top.map(f => el('li', {},
      el('a', { href: '#f-' + f.id, onclick: ev => { ev.preventDefault(); jumpTo(f.id); } }, f.title),
      matBadge(f.materiality)))) : el('p', { class: 'status-line', text: 'No material changes in this scan.' }));

  // filters
  const sel = (id, label, opts, val) => {
    const s2 = el('select', { id }, el('option', { value: '' }, 'All'), opts.map(([v, t]) => el('option', { value: v, selected: v === val }, t)));
    return el('label', { for: id }, label, s2);
  };
  const search = el('input', { type: 'search', id: 'f-q', placeholder: 'Search findings', value: filters.q, autocomplete: 'off' });
  const bar = el('form', { class: 'filters', role: 'search', 'aria-label': 'Filter findings', onsubmit: e => e.preventDefault() },
    el('label', { for: 'f-q' }, 'Search', search),
    sel('f-mat', 'Materiality', Object.entries(MAT).map(([k, v]) => [k, v.label]), filters.mat),
    sel('f-area', 'Area', AREAS.map(a => [a, a]), filters.area),
    sel('f-src', 'Source type', Object.entries(SRC), filters.src),
    el('button', { type: 'button', class: 'btn', id: 'f-clear', onclick: () => { filters = { key, mat: '', area: '', src: '', q: '' }; bar.reset(); search.value = ''; bar.querySelectorAll('select').forEach(x => { x.value = ''; }); drawAreas(); } }, 'Clear filters'));
  bar.addEventListener('input', () => {
    filters.q = search.value.trim();
    filters.mat = bar.querySelector('#f-mat').value;
    filters.area = bar.querySelector('#f-area').value;
    filters.src = bar.querySelector('#f-src').value;
    drawAreas();
  });

  let grid = null;
  function matches(f) {
    if (filters.mat && f.materiality !== filters.mat) return false;
    if (filters.area && f.area !== filters.area) return false;
    if (filters.src && !(f.sources || []).some(x => x.type === filters.src)) return false;
    if (filters.q) {
      const hay = [f.id, f.title, f.what_happened, f.compared_to_before, f.why_it_matters, f.area]
        .concat((f.sources || []).flatMap(x => [x.publisher, x.title])).join(' ').toLowerCase();
      if (!filters.q.toLowerCase().split(/\s+/).every(t => hay.includes(t))) return false;
    }
    return true;
  }
  function drawAreas() {
    const active = !!(filters.mat || filters.area || filters.src || filters.q);
    const shown = findings.filter(matches);
    const nodes = [];
    (data.areas || []).forEach(a => {
      const all = findings.filter(f => f.area === a.area);
      const fl = all.filter(matches);
      if (active && !fl.length) return;
      const sec = el('section', { class: 'area', 'aria-labelledby': 'a-' + AREAS.indexOf(a.area) },
        el('h3', { id: 'a-' + AREAS.indexOf(a.area) }, a.area, all.length ? el('small', { text: all.length + (all.length === 1 ? ' finding' : ' findings') }) : null));
      if (fl.length) fl.forEach(f => sec.append(findingCard(f)));
      else if (a.status === 'not_assessable') sec.append(el('p', { class: 'status-line na', text: 'Not assessable from public sources this run: ' + (a.reason || 'no reason given') + (/[.!?]$/.test(a.reason || '') ? '' : '.') }));
      else sec.append(el('p', { class: 'status-line', text: 'No material change found in the window.' }));
      nodes.push(sec);
    });
    if (active && !shown.length) nodes.push(el('div', { class: 'state', text: 'No findings match these filters.' }));
    areasHost.replaceChildren(...nodes);
    if (grid) grid.sync();
    countEl.textContent = active ? 'Showing ' + shown.length + ' of ' + findings.length + ' findings' : findings.length + (findings.length === 1 ? ' finding' : ' findings') + ' in this scan';
  }

  const gridApi = {
    get: () => filters,
    toggle(area, mat) {
      const same = filters.area === area && filters.mat === mat;
      filters.area = same ? '' : area; filters.mat = same ? '' : mat;
      bar.querySelector('#f-area').value = filters.area;
      bar.querySelector('#f-mat').value = filters.mat;
      drawAreas();
      if (!same) bar.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  };
  grid = buildGrid(data, gridApi);
  const tl = buildTimeline(data, jumpTo);
  const merged = await mergedFindings(ent).catch(() => []);
  const local = new Map(findings.map(f => [fkey(f), f.id]));
  const latestPanel = buildLatest(ent, merged, ent.latest.generated, i => {
    const id = local.get(fkey(i.f));
    return id ? { href: '#f-' + id, id } : { href: entityHref(ent.slug, i.scan === ent.latest.generated ? '' : i.scan), id: null };
  });

  app.replaceChildren(
    ...entityHeader(ent, r, 'findings', scan),
    el('dl', { class: 'scan-meta' },
      el('div', {}, el('dt', { text: 'Window' }), el('dd', { text: s.window_start + ' to ' + s.window_end })),
      el('div', {}, el('dt', { text: 'Mode' }), el('dd', { text: MODES[s.mode] || s.mode })),
      el('div', {}, el('dt', { text: 'Generated' }), el('dd', { text: s.generated }))),
    latestPanel, tl.node,
    el('div', { class: 'viz-row' }, grid.node, buildSources(data)),
    topPanel, bar, countEl, areasHost);
  window.__redraw = tl.draw;
  tl.draw();
  drawAreas();
}

/* ---------- visual blocks ---------- */
const SHORT = ['Strategy', 'Financials', 'M&A', 'Restructuring', 'People & leadership', 'Products', 'Sustainability', 'Capital markets', 'Share price'];
const SHAPE = { new: 'circle', acceleration: 'tri', reversal: 'diamond', inconsistency: 'square' };
const DAY = 864e5;
const NS = 'http://www.w3.org/2000/svg';
const pd = s => Date.parse(s + 'T00:00:00Z');
const fkey = f => f.title + '|' + f.date;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function svg(tag, attrs, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  kids.flat().forEach(c => { if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
}
function shape(kind, cx, cy, r, cls) {
  const p = (...pts) => pts.map(q => q.join(',')).join(' ');
  if (kind === 'circle') return svg('circle', { cx, cy, r, class: cls });
  if (kind === 'tri') return svg('polygon', { class: cls, points: p([cx, cy - r * 1.2], [cx + r * 1.15, cy + r * .9], [cx - r * 1.15, cy + r * .9]) });
  if (kind === 'diamond') return svg('polygon', { class: cls, points: p([cx, cy - r * 1.3], [cx + r * 1.3, cy], [cx, cy + r * 1.3], [cx - r * 1.3, cy]) });
  return svg('rect', { class: cls, x: cx - r * .9, y: cy - r * .9, width: r * 1.8, height: r * 1.8 });
}

/* Latest updates: merged across all scans, anchored to the newest scan's date */
async function mergedFindings(ent) {
  const choices = scanChoices(ent).slice().sort((a, b) => (a.generated < b.generated ? 1 : -1));
  const docs = await Promise.all(choices.map(h => load(h.json).catch(() => null)));
  const out = new Map();
  docs.forEach((j, i) => ((j && j.findings) || []).forEach(f => {
    const k = fkey(f);
    if (!out.has(k)) out.set(k, { f, scan: choices[i].generated }); // newest scan wins
  }));
  return [...out.values()];
}
function buildLatest(ent, items, asOf, linkFor) {
  const own = ent.type === 'own_company';
  const inWin = n => items.filter(i => { const t = pd(i.f.date), a = pd(asOf); return t <= a && t >= a - n * DAY; })
    .sort((a, b) => (a.f.date < b.f.date ? 1 : a.f.date > b.f.date ? -1 : 0));
  let days = 7, auto = false;
  if (!inWin(7).length && inWin(30).length) { days = 30; auto = true; }
  const list = el('ul', { class: 'lu-list' });
  const note = el('p', { class: 'lu-note', role: 'status' });
  const btns = [7, 30].map(n => el('button', { type: 'button', class: 'seg', onclick: () => { days = n; auto = false; draw(); } }, 'Last ' + n + ' days'));
  function row(i) {
    const f = i.f, l = linkFor(i);
    const sum = (f.what_happened || '').length > 150 ? f.what_happened.slice(0, 147).trimEnd() + '…' : f.what_happened;
    return el('li', { class: 'lu-item' },
      el('div', { class: 'lu-top' }, el('time', { datetime: f.date, text: f.date }), matBadge(f.materiality)),
      el('a', { class: 'lu-title', href: l.href, onclick: l.id ? ev => { ev.preventDefault(); jumpTo(l.id); } : null }, f.title),
      el('p', { class: 'lu-sum', text: sum }));
  }
  function draw() {
    btns.forEach((b, i) => b.setAttribute('aria-pressed', String([7, 30][i] === days)));
    const rows = inWin(days);
    list.replaceChildren(...rows.map(row));
    note.textContent = !rows.length ? 'No new findings in the last ' + days + ' days as of ' + asOf
      : auto ? 'No new findings in the last 7 days; showing the last 30 days.' : '';
    note.hidden = !note.textContent;
  }
  const node = el('section', { class: 'panel latest' + (own ? ' feature' : ''), 'aria-labelledby': 'lu-h' },
    el('div', { class: 'lu-head' },
      el('div', {}, el('h2', { id: 'lu-h', text: own ? 'Latest updates for ' + ent.name : 'Latest updates' }),
        own ? el('p', { class: 'lu-for', text: 'For employees: the newest public developments' }) : null,
        el('p', { class: 'meta', text: 'as of ' + asOf })),
      el('div', { class: 'segs', role: 'group', 'aria-label': 'Time window' }, btns)),
    note, list);
  draw();
  return node;
}

/* Timeline */
function buildTimeline(data, onJump) {
  const s = data.scan || {}, findings = data.findings || [];
  const t0 = pd(s.window_start), t1 = pd(s.window_end), span = Math.max(t1 - t0, DAY);
  const svgHost = el('div', { class: 'tl-svg' });
  const tip = el('div', { class: 'tl-tip', role: 'tooltip', hidden: true });
  const legend = el('ul', { class: 'tl-legend' }, Object.keys(MAT).map(k => el('li', { class: 'm-' + k },
    svg('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, shape(SHAPE[k], 8, 8, 5, 'shp')), MAT[k].label)));
  const node = el('section', { class: 'panel tl', 'aria-labelledby': 'tl-h' },
    el('h2', { id: 'tl-h', text: 'Timeline' }),
    el('p', { class: 'meta', text: 'Findings across the scan window, ' + s.window_start + ' to ' + s.window_end + '. Select a mark to jump to the finding.' }),
    el('div', { class: 'tl-wrap' }, svgHost, tip), legend);

  function draw() {
    const W = Math.max(svgHost.clientWidth || 320, 260), padL = 16, padR = 16, lane = 20;
    const x = t => padL + Math.min(Math.max((t - t0) / span, 0), 1) * (W - padL - padR);
    const sorted = findings.slice().sort((a, b) => pd(a.date) - pd(b.date) || (a.id < b.id ? -1 : 1));
    const last = [];
    const placed = sorted.map(f => {
      const px = x(pd(f.date)); let l = 0;
      while (last[l] !== undefined && px - last[l] < 20) l++;
      last[l] = px; return { f, px, l };
    });
    const lanes = Math.max(1, last.length), axisY = lanes * lane + 14, H = axisY + 30;
    const g = svg('svg', { class: 'tl-chart', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': 'Timeline of ' + findings.length + ' findings' });
    g.append(svg('line', { class: 'tl-axis', x1: padL, x2: W - padR, y1: axisY, y2: axisY }));
    const d0 = new Date(t0);
    let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + (d0.getUTCDate() === 1 ? 0 : 1), 1)), first = true;
    for (; +d <= t1; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const tx = x(+d), m = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
      const label = (first || d.getUTCMonth() === 0) ? m + ' ’' + String(d.getUTCFullYear()).slice(2) : m;
      g.append(svg('line', { class: 'tl-tick', x1: tx, x2: tx, y1: axisY, y2: axisY + 5 }),
        svg('text', { class: 'tl-lbl', x: tx, y: axisY + 19, 'text-anchor': tx < padL + 24 ? 'start' : tx > W - padR - 24 ? 'end' : 'middle' }, label));
      first = false;
    }
    placed.forEach(({ f, px, l }) => {
      const cy = axisY - 12 - l * lane;
      const show = () => {
        tip.replaceChildren(el('strong', { text: f.title }), el('span', { text: f.date + ' · ' + f.area + ' · ' + (MAT[f.materiality] || {}).label }));
        tip.hidden = false;
        const hw = tip.offsetWidth / 2;
        tip.style.left = Math.min(Math.max(px, hw + 4), W - hw - 4) + 'px';
        tip.style.top = (cy - 12) + 'px';
      };
      const hide = () => { tip.hidden = true; };
      g.append(svg('g', {
        class: 'tl-mark m-' + f.materiality, tabindex: '0', role: 'link',
        'aria-label': f.date + ', ' + (MAT[f.materiality] || {}).label + ', ' + f.title + ', ' + f.area,
        onmouseenter: show, onmouseleave: hide, onfocus: show, onblur: hide,
        onclick: () => onJump(f.id),
        onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onJump(f.id); } }
      }, svg('circle', { class: 'hit', cx: px, cy, r: 11 }), shape(SHAPE[f.materiality] || 'circle', px, cy, 6, 'shp')));
    });
    svgHost.replaceChildren(g);
  }
  return { node, draw };
}

/* Signal grid */
function buildGrid(data, api) {
  const findings = data.findings || [], mats = Object.keys(MAT), cnt = {};
  let max = 1;
  findings.forEach(f => { const k = f.area + '|' + f.materiality; cnt[k] = (cnt[k] || 0) + 1; max = Math.max(max, cnt[k]); });
  const cells = [];
  const STATUS = { not_assessable: ['n/a', 'Not assessable from public sources this run'], no_material_change: ['none', 'No material change found'], findings: ['—', 'Has findings'] };
  const body = el('tbody', {}, (data.areas || []).map(a => {
    const i = AREAS.indexOf(a.area), st = STATUS[a.status] || ['?', a.status];
    return el('tr', {},
      el('th', { scope: 'row', title: a.area }, SHORT[i] || a.area),
      mats.map(m => {
        const n = cnt[a.area + '|' + m] || 0;
        if (!n) return el('td', {}, el('span', { class: 'gz', title: a.area + ', ' + MAT[m].label + ': none', text: '0' }));
        const b = el('button', { type: 'button', class: 'gc gc-' + m, style: '--i:' + (0.1 + 0.3 * n / max).toFixed(2), 'aria-label': a.area + ', ' + MAT[m].label + ': ' + n + (n === 1 ? ' finding' : ' findings'), onclick: () => api.toggle(a.area, m) }, String(n));
        cells.push({ b, area: a.area, mat: m });
        return el('td', {}, b);
      }),
      el('td', { class: 'gs' + (a.status === 'not_assessable' ? ' na' : ''), title: st[1] + (a.reason ? ': ' + a.reason : '') }, st[0], el('span', { class: 'vh', text: ' ' + st[1] })));
  }));
  const head = el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Area'),
    mats.map(m => el('th', { scope: 'col', class: 'm-' + m, title: MAT[m].hint }, el('span', { class: 'icon', 'aria-hidden': 'true', text: MAT[m].icon }), el('span', { class: 'lbl' }, MAT[m].label))),
    el('th', { scope: 'col' }, 'Status')));
  const node = el('section', { class: 'panel', 'aria-labelledby': 'sg-h' },
    el('h2', { id: 'sg-h', text: 'Signal grid' }),
    el('p', { class: 'meta', text: 'Findings per area and materiality. Select a count to filter the list below; select it again to clear.' }),
    el('table', { class: 'sg' }, el('caption', { class: 'vh', text: 'Number of findings by area and materiality' }), head, body));
  const sync = () => {
    const f = api.get();
    cells.forEach(c => c.b.setAttribute('aria-pressed', String(f.area === c.area && f.mat === c.mat)));
  };
  return { node, sync };
}

/* Source credibility mix */
function buildSources(data) {
  const srcs = (data.findings || []).flatMap(f => f.sources || []);
  const total = srcs.length, types = Object.keys(SRC), by = {};
  types.forEach(t => { by[t] = srcs.filter(s => s.type === t).length; });
  const headline = srcs.filter(s => s.access === 'headline_only').length;
  const unique = new Set(srcs.map(s => s.url)).size;
  const node = el('section', { class: 'panel', 'aria-labelledby': 'sm-h' }, el('h2', { id: 'sm-h', text: 'Source mix' }));
  if (!total) { node.append(el('p', { class: 'status-line', text: 'No sources cited in this scan.' })); return node; }
  const pct = t => Math.round(by[t] / total * 100);
  node.append(
    el('div', { class: 'sx-bar', role: 'img', 'aria-label': 'Share of ' + total + ' source links: ' + types.map(t => SRC[t] + ' ' + pct(t) + '%').join(', ') },
      types.filter(t => by[t]).map(t => el('span', { class: 'sx sx-' + t, style: 'flex:' + by[t] }))),
    el('dl', { class: 'sx-tiles' }, types.map(t => el('div', { class: 'sx-tile' },
      el('dt', {}, el('span', { class: 'sx-key sx-' + t, 'aria-hidden': 'true' }), SRC[t]),
      el('dd', {}, el('strong', { text: by[t] }), ' · ' + pct(t) + '%')))),
    el('p', { class: 'sx-foot' }, el('strong', { text: headline }), ' headline only · ', el('strong', { text: unique }), ' unique pages'));
  return node;
}

function jumpTo(id) {
  // top-list links point at filtered-out findings too: clear filters first
  if (filters.mat || filters.area || filters.src || filters.q) {
    const c = document.getElementById('f-clear'); if (c) c.click();
  }
  const t = document.getElementById('f-' + id);
  if (!t) return;
  t.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true });
  t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600);
}

function findingCard(f) {
  const part = (label, text) => [el('dt', { text: label }), el('dd', { text: text })];
  return el('article', { class: 'finding m-' + f.materiality, id: 'f-' + f.id, 'aria-labelledby': 'ft-' + f.id },
    el('div', { class: 'finding-top' }, el('span', { class: 'fid', text: f.id }), el('time', { datetime: f.date, text: f.date }), el('span', { text: f.area }), matBadge(f.materiality)),
    el('h4', { id: 'ft-' + f.id, text: f.title }),
    el('dl', { class: 'parts' },
      part('What happened', f.what_happened), part('Compared to before', f.compared_to_before), part('Why it might matter', f.why_it_matters)),
    el('ul', { class: 'sources', 'aria-label': 'Sources for ' + f.id }, (f.sources || []).map(x => el('li', {},
      el('a', { href: safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer' }, (x.publisher ? x.publisher + ' — ' : '') + (x.title || x.url)),
      el('span', { class: 'badge src' }, SRC[x.type] || x.type),
      x.access === 'headline_only' ? el('span', { class: 'badge src warn', title: 'Paywalled or login-only: only the headline or snippet was seen' }, 'Headline only') : null))));
}

async function viewBrief(ent, r) {
  const scan = pickScan(ent, r);
  setTitle(ent.name + ' brief');
  const host = el('article', { class: 'brief' }, el('p', { class: 'muted', text: 'Loading brief…' }));
  app.replaceChildren(
    ...entityHeader(ent, r, 'brief', scan),
    el('div', { class: 'actions' },
      el('a', { class: 'btn primary', href: scan.brief, download: 'brief-' + ent.slug + '-' + scan.date + '.md' }, 'Download brief.md'),
      el('a', { class: 'btn', href: scan.json, download: 'findings-' + ent.slug + '-' + scan.date + '.json' }, 'Download findings.json')),
    host);
  const md = await load(scan.brief, 'text');
  if (window.marked && window.DOMPurify) {
    if (!window.__dpHook) {
      window.__dpHook = true;
      DOMPurify.addHook('afterSanitizeAttributes', n => {
        if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
      });
    }
    host.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true }), { USE_PROFILES: { html: true } });
  } else {
    host.replaceChildren(el('p', { class: 'muted', text: 'Formatting library unavailable; showing the raw markdown.' }), el('pre', { class: 'raw', text: md }));
  }
}

window.addEventListener('hashchange', e => {
  // in-page "#f-F01" style anchors are handled by click handlers; only route on real routes
  if (!location.hash || location.hash.startsWith('#/')) route();
});
route();

let __rz = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(__rz);
  __rz = requestAnimationFrame(() => { if (window.__redraw) window.__redraw(); });
});
