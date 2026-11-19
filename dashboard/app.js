/* token-radar — the desk. Reads window.RADAR (written by main.ts) and renders the board, the charts
   and a protocol's detail view. No network, no framework, no state outside this closure. */

(() => {
  'use strict';

  const R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.body.innerHTML = '<p style="padding:24px;color:#888">No radar data: data.js beside the page is missing.</p>';
    return;
  }
  const M = R.meta;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // ---------------------------------------------------------------- formatters

  const usd = (n) => {
    const v = Math.abs(n);
    if (v >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(n / 1e9).toFixed(v >= 1e11 ? 0 : 2)}B`;
    if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
    return `$${n.toFixed(0)}`;
  };
  const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);
  const months = (v) => (v >= 24 ? `${(v / 12).toFixed(1)}y` : `${v.toFixed(1)}mo`);
  const mult = (v) => `${v.toFixed(2)}×`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const year = (iso) => (iso ? iso.slice(0, 7) : '—');

  // ---------------------------------------------------------------- header, kpis, controls

  $('meta').innerHTML =
    `<span>snapshot <b>${esc(M.as_of)}</b></span>` +
    `<span>floor <b>${usd(M.floor)}</b></span>` +
    `<span>model <b>radar-3</b></span>`;

  $('kpis').innerHTML = [
    { lab: 'untokenised tvl', val: usd(M.pre_tvl), sub: `across ${M.n_pre} protocols that record no token`, bar: 1 },
    { lab: 'protocols in the snapshot', val: String(M.n_protocols), sub: `${M.n_tok} record a token, ${M.n_pre} do not (${M.n_launchable} launchable)`, bar: M.n_pre / M.n_protocols },
    { lab: 'watchlist covered', val: `${M.n_watch}<small>/ ${M.n_watch}</small>`, sub: `${usd(M.watch_tvl)} above the ${usd(M.floor)} floor`, bar: 1 },
    { lab: 'market multiple', val: `${M.median_mult.toFixed(2)}×`, sub: `median mcap/tvl of ${M.market_n} listed peers`, bar: Math.min(1, M.median_mult) },
    { lab: 'top implied value', val: usd(M.top_implied), sub: `board of ${M.n_board} rows, ranked by implied $`, bar: 1, acid: true },
  ]
    .map(
      (k) =>
        `<div class="kpi${k.acid ? ' acid' : ''}"><div class="lab">${k.lab}</div>` +
        `<div class="val">${k.val}</div><div class="sub">${k.sub}</div>` +
        `<div class="bar"><i style="width:${Math.max(2, Math.min(100, k.bar * 100)).toFixed(1)}%"></i></div></div>`,
    )
    .join('');

  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = `<option value="all">all chains</option>` + chains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const cats = [...new Set(R.rows.map((r) => r.category))].sort();
  $('cat').innerHTML = `<option value="all">all categories</option>` + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  const state = { q: params.get('q') || '', chain: params.get('chain') || 'all', cat: params.get('cat') || 'all', watch: params.get('watch') === '1', sort: params.get('sort') || 'rank', view: params.get('view') === 'charts' ? 'charts' : params.get('view') === 'excluded' ? 'excluded' : 'board' };
  $('q').value = state.q;
  $('chain').value = chains.includes(state.chain) ? state.chain : 'all';
  $('cat').value = cats.includes(state.cat) ? state.cat : 'all';
  $('watchOnly').checked = state.watch;
  $('sort').value = ['rank', 'tvl', 'months', 'mult', 'chg7', 'name'].includes(state.sort) ? state.sort : 'rank';

  // ---------------------------------------------------------------- selection

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    const out = R.rows.filter((r) => {
      if (state.watch && !r.watch) return false;
      if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (q && !(`${r.name} ${r.slug} ${r.category} ${r.chains.join(' ')}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const dir = state.sort === 'name' || state.sort === 'rank' ? 1 : -1;
    const key = state.sort === 'chg7' ? 'chg7' : state.sort;
    out.sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name);
      const av = a[key] === null ? -Infinity : a[key];
      const bv = b[key] === null ? -Infinity : b[key];
      return (av - bv) * dir || a.rank - b.rank;
    });
    return out;
  };

  // ---------------------------------------------------------------- table

  const chainCell = (r) => {
    // With a chain filter on, name the chain that matched the filter, not the protocol's first one.
    const first = state.chain !== 'all' && r.chains.includes(state.chain) ? state.chain : r.chains[0] ?? '—';
    const more = r.chains.length > 1 ? `<span class="more">+${r.chains.length - 1}</span>` : '';
    return `<svg><use href="#i-chain"/></svg><span>${esc(first)}</span>${more}`;
  };

  const rowHtml = (r) => {
    const chg = r.chg7 === null ? 'chg-nil' : r.chg7 >= 0 ? 'chg-pos' : 'chg-neg';
    const whyA = `${mult(r.mult)} ${esc(r.category.toLowerCase())}${r.mult_n ? ` n=${r.mult_n}` : ' market'}`;
    const whyB = `${months(r.months)} no token · ${pct(r.chg7)} 7d`;
    return (
      `<tr data-slug="${esc(r.slug)}" class="${params.get('p') === r.slug ? 'sel' : ''}">` +
      `<td class="c-rank"><span class="rank">${r.rank}</span></td>` +
      `<td class="c-name"><div class="nm"><span class="name">${esc(r.name)}</span>${r.watch ? '<span class="flag">watch</span>' : ''}</div>` +
      `<div class="cat">${esc(r.category)}${r.chains.length > 1 ? ` · ${r.chains.length} chains` : ''}</div></td>` +
      `<td class="c-chain"><div class="ch">${chainCell(r)}</div></td>` +
      `<td class="c-num tvl">${usd(r.tvl)}</td>` +
      `<td class="c-num"><span class="${chg}">${pct(r.chg7)}</span></td>` +
      `<td class="c-num months"><b>${months(r.months)}</b></td>` +
      `<td class="c-num mult">${mult(r.mult)}</td>` +
      `<td class="c-score"><div class="score"><span class="sbar"><i style="width:${Math.max(3, r.score).toFixed(1)}%"></i></span><span class="sv">${r.score.toFixed(0)}</span></div></td>` +
      `<td class="c-num implied">${usd(r.implied)}</td>` +
      `<td class="c-why"><div class="why"><b>${whyA}</b><br>${whyB}</div></td>` +
      `</tr>`
    );
  };

  const renderBoard = () => {
    const rows = filtered();
    $('rows').innerHTML = rows.map(rowHtml).join('');
    $('empty').hidden = rows.length > 0;
    $('empty').textContent = rows.length === 0 ? 'No protocol on the board matches that filter.' : '';
    $('count').innerHTML = `showing <b>${rows.length}</b> of <b>${R.rows.length}</b> rows · ${M.n_watch} watchlist protocols priced`;
    document.querySelectorAll('#rows tr').forEach((tr) => tr.addEventListener('click', () => open(tr.dataset.slug)));
    ['rank', 'tvl', 'chg7', 'months'].forEach((k) => {
      const th = document.querySelector(`th[data-sort="${k}"]`);
      if (th) th.classList.toggle('on', state.sort === k || (k === 'rank' && state.sort === 'rank'));
    });
  };

  // ---------------------------------------------------------------- rail

  const barList = (items, max, fmt, cls) =>
    `<div class="bars">${items
      .map(
        (it) =>
          `<span class="l" title="${esc(it.label)}">${esc(it.label)}</span>` +
          `<span class="t"><i class="${cls || ''}" style="width:${Math.max(1, (it.value / max) * 100).toFixed(1)}%"></i></span>` +
          `<span class="v">${fmt(it.value)}</span>`,
      )
      .join('')}</div>`;

  const hist = (w, h, data, accent) => {
    const max = Math.max(...data.map((d) => d.value), 1);
    const bw = w / data.length;
    return (
      `<svg class="wide" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="histogram">` +
      data
        .map((d, i) => {
          const bh = Math.max(1, (d.value / max) * (h - 26));
          return (
            `<rect x="${(i * bw + 2).toFixed(1)}" y="${(h - 18 - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${bh.toFixed(1)}" fill="${i === data.length - 1 ? accent : '#2f3a16'}"/>` +
            `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${h - 6}" font-size="8" fill="#6b6b64" text-anchor="middle" font-family="monospace">${esc(d.label)}</text>` +
            `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${(h - 22 - bh).toFixed(1)}" font-size="8.5" fill="#9a9a92" text-anchor="middle" font-family="monospace">${d.value}</text>`
          );
        })
        .join('') +
      '</svg>'
    );
  };

  const renderRail = () => {
    const top = R.chains.slice(0, 7).map((c) => ({ label: c.chain, value: c.tvl }));
    const max = top[0] ? top[0].value : 1;
    const mHist = R.months.map((b) => ({ label: b.bucket, value: b.n }));
    $('rail').innerHTML =
      `<div class="card"><h3>untokenised tvl by chain <em>${usd(M.pre_tvl)}</em></h3>` +
      barList(top, max, usd, 'hot') +
      `<div class="note" style="margin-top:6px">Each protocol counted on its first listed chain, so no dollar counts twice.</div></div>` +
      `<div class="card"><h3>months without a token <em>${M.n_pre} protocols</em></h3>` +
      hist(300, 92, mHist, '#c8f751') +
      `<div class="note" style="margin-top:6px">Tenure is an input, not decoration: a 24-month record earns the full 20% durability lift.</div></div>` +
      `<div class="card"><h3>the call</h3>` +
      `<div class="note"><code>implied = tvl × multiple × tenure × momentum</code><br><br>` +
      `The multiple is measured from the snapshot's own listed peers in the same category (median mcap/tvl, shrunk to the market's ${M.median_mult.toFixed(2)}×), never typed in. Tenure runs 0.80→1.00 over 24 months. Momentum is half the 7-day move, capped at ±12.5%.</div></div>` +
      `<div class="card"><h3>coverage</h3><dl class="dl">` +
      `<dt>watchlist priced</dt><dd>${M.n_watch} / ${M.n_watch}</dd>` +
      `<dt>board rows</dt><dd>${M.n_board}</dd>` +
      `<dt>at or above the floor</dt><dd>${R.rows.filter((r) => r.tvl >= M.floor).length}</dd>` +
      `<dt>token already trades</dt><dd>${M.n_tok} excluded</dd>` +
      `</dl></div>`;
  };

  // ---------------------------------------------------------------- charts view

  const renderCharts = () => {
    const chainRows = R.chains.slice(0, 12).map((c) => ({ label: c.chain, value: c.tvl, n: c.n }));
    const cMax = chainRows[0] ? chainRows[0].value : 1;
    const catMax = Math.max(...R.cats.map((c) => c.median), M.median_mult);
    $('charts').innerHTML =
      `<div class="panel wide"><h2>untokenised tvl by chain</h2><p>${usd(M.pre_tvl)} of TVL sits in ${M.n_pre} protocols that record no token. Each is counted once, on its first listed chain.</p>` +
      `<div class="bars" style="grid-template-columns:120px 1fr 150px 60px;font-size:10.5px;margin-top:10px">${chainRows
        .map(
          (c) =>
            `<span class="l">${esc(c.label)}</span><span class="t" style="height:9px"><i class="${c.value / cMax > 0.55 ? 'hot' : ''}" style="width:${((c.value / cMax) * 100).toFixed(1)}%"></i></span>` +
            `<span class="v" style="text-align:right"><b>${usd(c.value)}</b></span><span class="v" style="text-align:right">${c.n} prot.</span>`,
        )
        .join('')}</div></div>` +
      `<div class="panel"><h2>months without a token</h2><p>Count of pre-token protocols by age since DefiLlama began tracking them. The 12–24 month band is where most of the field sits.</p>` +
      hist(520, 180, R.months.map((b) => ({ label: b.bucket, value: b.n })), '#c8f751') +
      `<div class="legend"><span><i style="background:#2f3a16"></i>protocols</span><span><i style="background:#c8f751"></i>oldest band</span></div></div>` +
      `<div class="panel"><h2>measured multiple by category</h2><p>Median market-cap / TVL of the snapshot's own token-bearing protocols, per category. A protocol with more than a few listed peers is priced off its own category, not a guess.</p>` +
      `<div class="bars" style="grid-template-columns:120px 1fr 74px;font-size:10.5px;margin-top:10px">${R.cats
        .map(
          (c) =>
            `<span class="l">${esc(c.category)}</span><span class="t" style="height:9px"><i class="${c.median > M.median_mult ? 'hot' : ''}" style="width:${((c.median / catMax) * 100).toFixed(1)}%"></i></span>` +
            `<span class="v" style="text-align:right"><b>${c.median.toFixed(2)}×</b> <span style="color:#55554f">n=${c.n}</span></span>`,
        )
        .join('')}</div>` +
      `<div class="note" style="margin-top:10px">Market-wide median ${M.median_mult.toFixed(2)}× over ${M.market_n} listed records. A category with fewer than four peers is shrunk toward that median before it prices anything.</div></div>`;
  };

  // ---------------------------------------------------------------- detail view

  const open = (slug) => {
    const r = R.rows.find((x) => x.slug === slug);
    if (!r) return;
    const prev = R.rows[r.rank - 2];
    const next = R.rows[r.rank];
    const peers = R.cats.find((c) => c.category === r.category);
    const driver = r.mult >= 1 ? 'multiple' : r.months >= 24 ? 'tenure' : 'size';
    const verdict =
      r.rank <= 3
        ? `Top of the board. ${usd(r.tvl)} of TVL with no token recorded and ${months(r.months)} of history behind it — the largest untokenised pile its category has. At its peers' ${mult(r.mult)} it would carry ${usd(r.implied)}, the ${r.rank === 1 ? 'highest' : `#${r.rank}`} claim on this board.`
        : `Priced off its category, not its name: ${peers ? `${peers.n} listed ${esc(r.category.toLowerCase())} peers trade at a median ${mult(peers.median)}` : `the market's median ${mult(M.median_mult)}`} of TVL, and its ${months(r.months)} without a token earns the tenure lift. The dominant term in this call is ${driver}.`;
    $('detail').innerHTML =
      `<div class="head"><div class="who"><h1>${esc(r.name)}</h1>` +
      `<div class="sub"><span><svg><use href="#i-chain"/></svg>${esc(r.chains.join(' · ') || 'no chain recorded')}</span>` +
      `<span><svg><use href="#i-dot"/></svg>${esc(r.category)}</span>` +
      `<span><svg><use href="#i-check"/></svg>no token recorded — gecko_id and symbol both null</span>` +
      `${r.watch ? '<span><svg><use href="#i-check"/></svg>on the watchlist</span>' : '<span>below the watchlist floor, still priced</span>'}</div></div>` +
      `<div class="big"><div class="k">implied value</div><div class="v">${usd(r.implied)}</div><div class="r">rank ${r.rank} of ${M.n_board} · score ${r.score.toFixed(0)}</div></div></div>` +
      `<div class="col left"><h2>how the number is made</h2><div class="calc">` +
      `<span class="op"> </span><span class="term">TVL as of ${esc(M.as_of)}</span><span class="amt">${usd(r.tvl)}</span>` +
      `<span class="op">×</span><span class="term">${peers ? `${esc(peers.category)} multiple <b>${mult(r.mult)}</b> — median of ${peers.n} listed peers` : `market multiple <b>${mult(r.mult)}</b> — too few listed peers in its category`}</span><span class="amt">${r.mult.toFixed(3)}</span>` +
      `<span class="op">×</span><span class="term">tenure <b>${r.tenure.toFixed(2)}</b> — ${months(r.months)} without a token</span><span class="amt">${r.tenure.toFixed(2)}</span>` +
      `<span class="op">×</span><span class="term">momentum <b>${r.momentum.toFixed(2)}</b> — ${pct(r.chg7)} over 7 days, halved and capped</span><span class="amt">${r.momentum.toFixed(2)}</span>` +
      `<span class="op">=</span><span class="term total"><b>implied value</b></span><span class="amt">${usd(r.implied)}</span></div>` +
      `<div class="verdict"><b>Why it ranks here.</b> ${verdict}</div>` +
      `<dl class="kv"><dt>tvl</dt><dd>${usd(r.tvl)}</dd><dt>7-day change</dt><dd>${pct(r.chg7)}</dd>` +
      `<dt>tracked for</dt><dd>${months(r.months)} without a token</dd>` +
      `<dt>chains</dt><dd>${r.chains.length}</dd><dt>token</dt><dd>none recorded</dd>` +
      `<dt>market cap</dt><dd>none recorded</dd></dl>` +
      `<div class="foot-note">A protocol that records a token never reaches this board: ${M.n_tok} of the snapshot's ${M.n_protocols} protocols are listed and stay out of the ranking. This one is not among them.</div></div>` +
      `<div class="col right"><h2>farm it before the launch</h2><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` +
      `<div class="foot-note">Five steps, about $25 of gas and ten minutes a week; every cost above is denominated in this protocol's own chain.</div>` +
      `<h2 style="margin-top:12px">${esc(r.category)} — the rest of the lane</h2><div class="bars" style="grid-template-columns:1fr 46px;font-size:10.5px">${R.rows
        .filter((x) => x.category === r.category && x.slug !== r.slug)
        .slice(0, 4)
        .map((x) => `<span class="l">${x.rank}. ${esc(x.name)}</span><span class="v">${usd(x.implied)}</span>`)
        .join('') || '<span class="l">No other pre-token protocol in this category.</span><span class="v">—</span>'}</div>` +
      `<div class="foot-note">At the market-wide ${mult(M.median_mult)} instead of its category's ${mult(r.mult)}, this protocol would imply ${usd(r.tvl * M.median_mult * r.tenure * r.momentum)} — the multiple is the assumption that moves the call most.</div>` +
      `<h2 style="margin-top:12px">next to it on the board</h2><div class="neigh">` +
      (prev ? `<a href="?p=${esc(prev.slug)}">↑ ${esc(prev.name)} · ${usd(prev.implied)}</a>` : '') +
      (next ? `<a href="?p=${esc(next.slug)}">↓ ${esc(next.name)} · ${usd(next.implied)}</a>` : '') +
      `<a href="?">← back to the board</a></div></div>`;
  };

  // ---------------------------------------------------------------- views

  const show = (view) => {
    const detailSlug = params.get('p');
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    const isDetail = Boolean(detailSlug);
    document.querySelector('main').hidden = view !== 'board' || isDetail;
    $('controls').hidden = view !== 'board' || isDetail;
    $('charts').hidden = view !== 'charts';
    $('detail').hidden = !(isDetail && view === 'board');
    if (isDetail && view === 'board') open(detailSlug);
  };

  document.querySelectorAll('#tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      const u = new URL(location.href);
      u.search = '';
      u.searchParams.set('view', b.dataset.view);
      location.href = u.toString();
    }),
  );

  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
  $('watchOnly').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });
  $('reset').addEventListener('click', () => {
    state.q = ''; state.chain = 'all'; state.cat = 'all'; state.watch = false; state.sort = 'rank';
    $('q').value = ''; $('chain').value = 'all'; $('cat').value = 'all'; $('watchOnly').checked = false; $('sort').value = 'rank';
    renderBoard();
  });
  document.querySelectorAll('th[data-sort]').forEach((th) =>
    th.addEventListener('click', () => { state.sort = th.dataset.sort; $('sort').value = state.sort; renderBoard(); }),
  );

  $('formula').innerHTML = `implied = <code>tvl × category multiple × tenure × momentum</code> · score = share of the board leader`;
  $('src').textContent = `${M.n_protocols} protocols · DefiLlama · snapshot ${M.as_of}`;

  renderBoard();
  renderRail();
  renderCharts();
  show(state.view);
})();
