// Token Radar's dashboard script. It reads window.RADAR — written beside this page by main.ts — and
// fills the page's own markup: the headline figures, the model panel's real coefficients, the ranked
// table, the two other views, the filter row and the per-protocol detail drawer.
//
// Every number it prints comes out of data.js. The page holds no fetched data and no network address;
// the farm plan it shows is the same six steps board.json carries for that row, so the page and the
// board cannot drift apart.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) {
    var host = document.getElementById('grid-body');
    if (host) host.innerHTML = '<tr><td colspan="7">The dashboard data did not load.</td></tr>';
    return;
  }

  // ------------------------------------------------------------------ formatting

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar figure at a readable scale: $1.2B, $45.6M, $890K, $12. */
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function pct(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var d = digits === undefined ? 2 : digits;
    return (n > 0 ? '+' : '') + n.toFixed(d) + '%';
  }
  function years(days) {
    if (days === null || days === undefined) return 'no date';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30.4) + 'mo';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function text(tag, cls, body) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (body !== undefined && body !== null) node.textContent = String(body);
    return node;
  }
  function el(tag, cls, kids) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    (kids || []).forEach(function (k) {
      if (k === null || k === undefined) return;
      node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    });
    return node;
  }
  /** Fill every [data-bind="name"] in the document from one map. */
  function bind(map) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-bind]'), function (node) {
      var key = node.getAttribute('data-bind');
      if (Object.prototype.hasOwnProperty.call(map, key)) node.textContent = String(map[key]);
    });
  }

  var MODEL = DATA.model;

  // ------------------------------------------------------------------ state

  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, onlyWl: false, view: 'board', sort: 'implied', dir: -1, open: null };

  var SORTS = {
    implied: function (r) { return r.implied_value_usd; },
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    base: function (r) { return r.base_tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    rel: function (r) { return r.change_7d === null ? -Infinity : r.change_7d - MODEL.tide_pct; },
    age: function (r) { return r.age_days === null ? -Infinity : r.age_days; },
    ratio: function (r) { return r.ratio === null ? -Infinity : r.ratio; },
    mcap: function (r) { return r.mcap_usd === null ? -Infinity : r.mcap_usd; }
  };

  /** The rows the current view and filters select, sorted. */
  function visible() {
    var q = state.q.trim().toLowerCase();
    var source = state.view === 'board' ? DATA.rows : state.view === 'live' ? DATA.live : DATA.set_aside;
    var filtered = source.filter(function (r) {
      if (state.onlyWl && state.view === 'board' && !r.on_watchlist) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' '), r.symbol || '', r.reason || '']
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var key = SORTS[state.sort] || SORTS.implied;
    return filtered.slice().sort(function (a, b) {
      var av = key(a), bv = key(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ------------------------------------------------------------------ the hash, so a view is linkable

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('minTvl')) state.minTvl = Number(p.get('minTvl')) || 0;
    if (p.get('onlyWl') === '1') state.onlyWl = true;
    if (p.get('view')) state.view = p.get('view');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = Number(p.get('dir')) < 0 ? -1 : 1;
    if (p.get('p')) state.open = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.minTvl > 0) p.set('minTvl', String(state.minTvl));
    if (state.onlyWl) p.set('onlyWl', '1');
    if (state.view !== 'board') p.set('view', state.view);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== -1) p.set('dir', String(state.dir));
    if (state.open) p.set('p', state.open);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // ------------------------------------------------------------------ the model panel's numbers

  function paintMethod() {
    bind({
      sample_size: MODEL.sample_size,
      'coef-intercept': MODEL.intercept,
      'coef-size': MODEL.size_exp,
      'coef-mom': MODEL.momentum_weight,
      tide: pct(MODEL.tide_pct),
      'fitted-growth': MODEL.growth_coef_fitted,
      'r2-note': 'R\u00b2 on the log\u2081\u2080 scale is ' + MODEL.r2_size_only + ' with the move ignored and ' + MODEL.r2_with_momentum + ' at the weight used.',
      'fit-note': 'On this snapshot the fit returns an intercept of ' + MODEL.intercept + ' and a size exponent of ' + MODEL.size_exp + ', so a ten-fold larger base TVL multiplies an implied value by ' + MODEL.ten_x_tvl_multiple + '. The sample\u2019s median protocol runs a market cap at ' + (MODEL.median_sample_ratio * 100).toFixed(1) + '% of its TVL.'
    });
  }

  function paintHeadline() {
    var preToken = DATA.protocols_seen - (DATA.live_total || 0);
    bind({
      as_of: DATA.as_of,
      source: DATA.source.replace(/^DefiLlama\s*/, 'DefiLlama '),
      model_version: DATA.model_version,
      floor: money(DATA.floor_usd),
      protocols_seen: DATA.protocols_seen,
      live_total: DATA.live_total,
      pretoken_total: preToken,
      board_size: DATA.board_size,
      live_size: DATA.live_size,
      set_aside_size: DATA.set_aside_size
    });

    var figures = document.querySelector('[data-bind="figures"]');
    if (!figures) return;
    figures.textContent = '';
    var top = DATA.rows[0];
    var facts = [
      ['Watchlist protocols covered', DATA.watchlist_size + ' of ' + DATA.watchlist_size, 'is-signal'],
      ['Rows on the ranked board', String(DATA.board_size), ''],
      ['Below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor', String(DATA.early_size), ''],
      ['Highest implied value', top ? money(top.implied_value_usd) : 'n/a', 'is-signal'],
      ['Token already trades', String(DATA.live_total || 0) + ' protocols', ''],
      ['Set aside from the ranking', String(DATA.set_aside_size) + ' shown', 'is-amber']
    ];
    facts.forEach(function (f) {
      figures.appendChild(el('div', null, [text('dt', null, f[0]), text('dd', f[2], f[1])]));
    });
  }

  // ------------------------------------------------------------------ controls

  function option(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function paintControls() {
    var source = state.view === 'live' ? DATA.live : state.view === 'set_aside' ? DATA.set_aside : DATA.rows;
    var cats = {}, chains = {};
    source.forEach(function (r) {
      cats[r.category || 'Uncategorised'] = 1;
      (r.chains || []).forEach(function (c) { chains[c] = 1; });
    });
    var catSel = document.getElementById('category');
    catSel.textContent = '';
    catSel.appendChild(option('all', 'All categories'));
    Object.keys(cats).sort().forEach(function (c) { catSel.appendChild(option(c, c)); });
    catSel.value = cats[state.category] ? state.category : 'all';
    if (catSel.value === 'all') state.category = 'all';

    var chainSel = document.getElementById('chain');
    chainSel.textContent = '';
    chainSel.appendChild(option('all', 'All chains'));
    Object.keys(chains).sort().forEach(function (c) { chainSel.appendChild(option(c, c)); });
    chainSel.value = chains[state.chain] ? state.chain : 'all';
    if (chainSel.value === 'all') state.chain = 'all';

    document.getElementById('q').value = state.q;
    document.getElementById('minTvl').value = String(state.minTvl);
    document.getElementById('onlyWl').checked = state.onlyWl;

    var list = visible();
    document.getElementById('tally').textContent =
      list.length + (state.view === 'board' ? ' of ' + DATA.board_size + ' rows' : ' of ' + source.length + ' protocols');

    Array.prototype.forEach.call(document.querySelectorAll('.viewbtn'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === state.view ? 'true' : 'false');
    });
  }

  var VIEW_NOTE = {
    board: 'Protocols that record no token, ranked by implied value. The watchlist is the floor, not the ceiling: a protocol below it is no worse a subject. Select any row for its derivation and its farm plan.',
    live: 'These protocols already trade, so their market cap is a fact from the snapshot rather than a model output. They are kept out of the ranking so a live valuation is never mixed with an implied one. The ratio column is market cap over TVL, which is the quantity the fit above is built on.',
    setaside: 'These protocols also record no token, but each one is an exchange, a bridge, a staking receipt or a wrapped product — a claim on an asset that already trades, so the token it would issue is not a launch anyone is waiting for. The ranking leaves them out and this view says why, one reason each.'
  };

  // ------------------------------------------------------------------ the table

  var COLUMNS = {
    board: [
      { key: 'rank', label: 'Rank' },
      { key: 'name', label: 'Protocol' },
      { key: 'tvl', label: 'TVL' },
      { key: 'base', label: 'Base TVL' },
      { key: 'growth', label: '7-day' },
      { key: 'age', label: 'Tenure, no token' },
      { key: 'implied', label: 'Implied value' },
      { key: null, label: 'Tags' }
    ],
    live: [
      { key: 'name', label: 'Protocol' },
      { key: 'tvl', label: 'TVL' },
      { key: 'mcap', label: 'Market cap' },
      { key: 'ratio', label: 'Mcap / TVL' },
      { key: 'growth', label: '7-day' },
      { key: null, label: 'Token' }
    ],
    setaside: [
      { key: 'name', label: 'Protocol' },
      { key: 'tvl', label: 'TVL' },
      { key: 'growth', label: '7-day' },
      { key: null, label: 'Why it is set aside' }
    ]
  };

  function sortHeader(col) {
    var th = document.createElement('th');
    th.scope = 'col';
    if (col.key === null) {
      th.textContent = col.label;
      return th;
    }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sortbtn';
    b.appendChild(document.createTextNode(col.label));
    if (state.sort === col.key) {
      b.setAttribute('aria-sort', state.dir === -1 ? 'descending' : 'ascending');
      b.appendChild(text('span', 'caret', state.dir === -1 ? '\u25bc' : '\u25b2'));
    }
    b.addEventListener('click', function () {
      if (state.sort === col.key) state.dir = -state.dir;
      else { state.sort = col.key; state.dir = col.key === 'name' ? 1 : -1; }
      writeHash();
      paint();
    });
    th.appendChild(b);
    return th;
  }

  function tagsFor(r) {
    var set = el('div', 'tagset', []);
    set.appendChild(text('span', 'tag', 'no token'));
    if (r.on_watchlist) set.appendChild(text('span', 'tag', 'watchlist'));
    if (r.category) set.appendChild(text('span', 'tag', r.category));
    if (r.age_days !== null && r.age_days >= 730) set.appendChild(text('span', 'tag', 'long runner'));
    return set;
  }

  function cell(row, maxImplied) {
    if (state.view === 'board') {
      var meter = el('div', 'meter', []);
      var track = el('div', 'meter-track', []);
      var fill = document.createElement('i');
      fill.className = 'meter-fill';
      fill.style.width = Math.max(3, Math.round((row.implied_value_usd / maxImplied) * 100)) + '%';
      track.appendChild(fill);
      meter.appendChild(track);
      meter.appendChild(text('span', 'meter-num', money(row.implied_value_usd)));
      return meter;
    }
    if (state.view === 'live') return text('span', 'tag', row.symbol ? 'trades as ' + row.symbol : 'already trades');
    return text('span', 'sub', row.reason || '');
  }

  function buildRow(row, maxImplied) {
    var tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.setAttribute('data-slug', row.slug);
    tr.setAttribute('data-open', state.open === row.slug ? 'true' : 'false');
    var openable = state.view !== 'setaside';

    function add(kids) {
      var td = document.createElement('td');
      (kids || []).forEach(function (k) { if (k !== null) td.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
      tr.appendChild(td);
    }

    if (state.view === 'board') {
      add([text('span', 'rankcell', row.rank)]);
      add([el('div', null, [text('b', 'rowname', row.name), text('span', 'rowsub', (row.category || 'Uncategorised') + ' \u00b7 ' + ((row.chains || [])[0] || 'an unnamed chain') + ((row.chains || []).length > 1 ? ' +' + (row.chains.length - 1) : ''))])]);
      add([text('span', 'fig', money(row.tvl_usd))]);
      add([text('span', 'fig', money(row.base_tvl_usd))]);
      add([text('span', 'fig ' + (row.change_7d === null ? '' : row.change_7d >= MODEL.tide_pct ? 'up' : 'down'), pct(row.change_7d))]);
      add([text('span', 'fig', years(row.age_days))]);
      add([cell(row, maxImplied)]);
      add([tagsFor(row)]);
    } else if (state.view === 'live') {
      add([el('div', null, [text('b', 'rowname', row.name), text('span', 'rowsub', (row.category || 'Uncategorised') + ' \u00b7 ' + ((row.chains || [])[0] || 'an unnamed chain'))])]);
      add([text('span', 'fig', money(row.tvl_usd))]);
      add([text('span', 'fig', money(row.mcap_usd))]);
      add([text('span', 'fig', row.ratio === null ? 'n/a' : row.ratio.toFixed(2) + '\u00d7')]);
      add([text('span', 'fig ' + (row.change_7d === null ? '' : row.change_7d >= 0 ? 'up' : 'down'), pct(row.change_7d))]);
      add([cell(row, 1)]);
    } else {
      add([el('div', null, [text('b', 'rowname', row.name), text('span', 'rowsub', (row.category || 'Uncategorised') + ' \u00b7 ' + ((row.chains || [])[0] || 'an unnamed chain'))])]);
      add([text('span', 'fig', money(row.tvl_usd))]);
      add([text('span', 'fig ' + (row.change_7d === null ? '' : row.change_7d >= 0 ? 'up' : 'down'), pct(row.change_7d))]);
      add([text('span', 'sub', row.reason || '')]);
    }

    if (openable) {
      tr.addEventListener('click', function () { openDetail(row.slug); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row.slug); }
      });
    } else {
      tr.style.cursor = 'default';
    }
    return tr;
  }

  function paintTable() {
    var cols = COLUMNS[state.view];
    var head = document.getElementById('grid-head');
    head.textContent = '';
    var hrow = document.createElement('tr');
    cols.forEach(function (c) { hrow.appendChild(sortHeader(c)); });
    head.appendChild(hrow);

    var list = visible();
    var cap = Math.min(list.length, 400);
    var body = document.getElementById('grid-body');
    body.textContent = '';
    var maxImplied = DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1;
    for (var i = 0; i < cap; i++) body.appendChild(buildRow(list[i], maxImplied));

    var caption = document.getElementById('grid-caption');
    if (state.view === 'board') caption.textContent = 'Ranked by implied value, strongest first. Sorted by ' + state.sort + ', ' + (state.dir === -1 ? 'descending' : 'ascending') + '. Showing ' + cap + ' of ' + list.length + ' rows; select one for its derivation and farm plan.';
    else if (state.view === 'live') caption.textContent = 'Token already trading, by market cap. Showing ' + cap + ' of ' + list.length + ' protocols.';
    else caption.textContent = 'Pre-token protocols the ranking sets aside, largest TVL first. Showing ' + cap + ' of ' + list.length + '.';

    document.getElementById('empty').hidden = list.length !== 0;
    document.getElementById('view-note').textContent = VIEW_NOTE[state.view];
  }

  // ------------------------------------------------------------------ the detail drawer

  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');

  function closeDrawer() {
    drawer.hidden = true;
    scrim.hidden = true;
    state.open = null;
    writeHash();
    Array.prototype.forEach.call(document.querySelectorAll('tr[data-open="true"]'), function (tr) { tr.setAttribute('data-open', 'false'); });
  }

  function row(label, value, total) {
    return el('div', 'd-row' + (total ? ' is-total' : ''), [text('span', null, label), text('span', null, value)]);
  }

  function openDetail(slug) {
    var whole = DATA.rows.concat(DATA.live).filter(function (r) { return r.slug === slug; })[0];
    if (!whole) return;
    state.open = slug;
    writeHash();

    var body = document.getElementById('drawer-body');
    body.textContent = '';
    document.getElementById('drawer-rank').textContent = whole.rank ? 'Rank ' + whole.rank + ' of ' + DATA.board_size : 'Token already trades';

    body.appendChild(el('div', 'd-head', [
      text('h2', null, whole.name),
      text('p', 'sub', (whole.category || 'Uncategorised') + ' on ' + ((whole.chains || []).join(', ') || 'an unnamed chain') + ' \u00b7 ' + whole.slug)
    ]));

    if (state.view === 'live' || !whole.implied_value_usd) {
      body.appendChild(el('section', 'd-block', [
        text('h3', null, 'The market\u2019s own value'),
        el('div', 'd-grid', [
          row('TVL', money(whole.tvl_usd)),
          row('Market cap', money(whole.mcap_usd)),
          row('Market cap / TVL', whole.ratio === null ? 'n/a' : whole.ratio.toFixed(3) + '\u00d7'),
          row('7-day change', pct(whole.change_7d))
        ]),
        text('p', 'd-note', 'This protocol records a token (' + (whole.symbol || 'a ticker') + '), so no implied value is computed for it: the market already prices it. It is shown here so a reader can see the ratio the fit above is built on.')
      ]));
      body.appendChild(closeButton());
      show();
      return;
    }

    var steps = whole.farm_steps || [];
    body.appendChild(el('section', 'd-block', [
      text('h3', null, 'How the implied value was derived'),
      el('div', 'd-grid', [
        row('TVL in the snapshot', money(whole.tvl_usd)),
        row('Base TVL, with the week\u2019s move taken back out', money(whole.base_tvl_usd)),
        row('7-day change', pct(whole.change_7d) + ' against a field median of ' + pct(MODEL.tide_pct)),
        row('Relative growth, in points', pct((whole.change_7d === null ? 0 : whole.change_7d) - MODEL.tide_pct)),
        row('Growth multiplier, weight ' + MODEL.momentum_weight, '\u00d7' + whole.growth_multiplier),
        row('Tenure, ' + years(whole.age_days) + ' with no token', '\u00d7' + whole.tenure_multiplier),
        row('Category: ' + (whole.category || 'none recorded'), '\u00d7' + whole.category_multiplier),
        row('Implied value', money(whole.implied_value_usd), true)
      ]),
      text('p', 'd-note', 'Every term is one of the snapshot\u2019s own figures run through the model panel\u2019s function. A multiplier above 1 means the term adds to the value, below 1 means it takes away. The implied value is this radar\u2019s own claim, not a price and not a forecast that a token appears.')
    ]));

    body.appendChild(el('section', 'd-block', [
      text('h3', null, 'What the snapshot records'),
      text('p', 'd-evidence', whole.evidence || '')
    ]));

    body.appendChild(el('section', 'd-block', [
      text('h3', null, 'Farm plan \u2014 ' + steps.length + ' steps, with the cost and the time for each'),
      el('ol', 'steps', steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var doing = at >= 0 ? s.slice(0, at) : s;
        var cost = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, [text('span', 'do', doing), text('span', 'cost', cost)]);
      })),
      text('p', 'd-note', 'The same steps board.json carries for this row, so the page and the board agree. Costs are bands, not quotes: gas moves.')
    ]));

    body.appendChild(closeButton());
    show();
  }

  function closeButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = 'Back to the board';
    b.addEventListener('click', closeDrawer);
    return b;
  }

  function show() {
    drawer.hidden = false;
    scrim.hidden = false;
    drawer.scrollTop = 0;
    Array.prototype.forEach.call(document.querySelectorAll('#grid-body tr[data-open="true"]'), function (tr) { tr.setAttribute('data-open', 'false'); });
    Array.prototype.forEach.call(document.querySelectorAll('#grid-body tr'), function (tr) {
      if (tr.getAttribute('data-slug') === state.open) tr.setAttribute('data-open', 'true');
    });
  }

  // ------------------------------------------------------------------ wiring

  function reset() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.minTvl = 0;
    state.onlyWl = false;
    writeHash();
    paint();
  }

  function paint() {
    paintControls();
    paintTable();
    if (state.open) openDetail(state.open);
  }

  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value;
    writeHash();
    paint();
  });
  document.getElementById('category').addEventListener('change', function (e) {
    state.category = e.target.value;
    writeHash();
    paint();
  });
  document.getElementById('chain').addEventListener('change', function (e) {
    state.chain = e.target.value;
    writeHash();
    paint();
  });
  document.getElementById('minTvl').addEventListener('change', function (e) {
    state.minTvl = Number(e.target.value) || 0;
    writeHash();
    paint();
  });
  document.getElementById('onlyWl').addEventListener('change', function (e) {
    state.onlyWl = e.target.checked;
    writeHash();
    paint();
  });
  document.getElementById('reset').addEventListener('click', reset);
  document.getElementById('empty-reset').addEventListener('click', reset);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.viewbtn'), function (b) {
    b.addEventListener('click', function () {
      state.view = b.getAttribute('data-view');
      state.sort = state.view === 'live' ? 'mcap' : 'implied';
      state.dir = -1;
      state.open = null;
      closeDrawerSilent();
      writeHash();
      paint();
    });
  });
  function closeDrawerSilent() {
    drawer.hidden = true;
    scrim.hidden = true;
  }
  document.getElementById('controls').addEventListener('submit', function (e) { e.preventDefault(); });

  // ------------------------------------------------------------------ start

  readHash();
  paintHeadline();
  paintMethod();
  paint();
  if (state.open) openDetail(state.open);
})();
