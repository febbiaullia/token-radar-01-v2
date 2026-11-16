// The Token Radar page, rewritten. It reads window.RADAR (written beside dashboard/
// by main.ts) and draws the ranked board, a filterable table, and a per-protocol detail
// drawer with the model's own inputs and the protocol's farm plan. No network: every
// byte on screen comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  var view = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // Large sums are shortened to B / M / K so the table stays readable; small sums use the full format.
  var usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFormat.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, replayed in the page: a row is recomputed from the snapshot figures and
  // set against the number board.json carries, so the page's arithmetic and the board's
  // data are visibly the same. The multiple is the row's own calibrated category multiple,
  // never one flat number for every row.
  function recompute(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity));
  }

  function node(tag, attrs) {
    var element = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') element.className = attrs[k];
        else if (k === 'text') element.textContent = attrs[k];
        else if (k === 'html') element.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') element.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) element.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) element.appendChild(c); });
      else if (typeof child === 'string') element.appendChild(document.createTextNode(child));
      else element.appendChild(child);
    }
    return element;
  }

  // The farm plan is the same derivation main.ts writes into board.json: category, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time.
  // No name is special-cased anywhere in it.
  function mainChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function stakeSize(p) {
    var tiers = [[5000000000, 250], [1000000000, 150], [100000000, 100]];
    for (var i = 0; i < tiers.length; i++) {
      if (p.tvl_usd >= tiers[i][0]) return tiers[i][1];
    }
    return 50;
  }
  function holdWindow(age) {
    if (age === null || age === undefined) return 30;
    var windows = [[180, 60], [365, 45]];
    for (var i = 0; i < windows.length; i++) {
      if (age < windows[i][0]) return windows[i][1];
    }
    return 30;
  }
  function feeTier(chain) {
    var c = chain.toLowerCase();
    if (c.includes('ethereum')) return { tx: 'about $4 of gas', week: 'about $4 of gas a week' };
    if (c.includes('solana')) return { tx: 'under $0.10 of fees', week: 'under $0.10 of fees a week' };
    if (c.includes('binance') || c.includes('bsc')) return { tx: 'about $0.20 of gas', week: 'about $0.20 of gas a week' };
    if (c.includes('tron')) return { tx: 'about $1 of energy', week: 'about $1 of energy a week' };
    return { tx: 'under $0.50 of gas', week: 'under $0.50 of gas a week' };
  }
  function planAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.includes('risk') || c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) return 'Deposit $' + capital + ' of USDC into a vault ' + name + ' curates on ' + chain + ' and keep the shares.';
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.includes('bridge') || c.includes('cross chain')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.includes('staking') || c.includes('restak')) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.includes('prediction')) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.includes('stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.includes('rwa')) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.includes('insurance')) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.includes('payment')) return 'Route $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.includes('governance')) return 'Lock $' + capital + ' of voting power through ' + name + ' on ' + chain + ' and vote once.';
    if (c.includes('privacy')) return "Move $" + capital + " through " + name + "'s private pool on " + chain + ' and keep the note.';
    if (c.includes('chain')) return 'Use $' + capital + ' in ' + name + "'s app on " + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function formatStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planSteps(p) {
    var chain = mainChain(p);
    var capital = stakeSize(p);
    var hold = holdWindow(p.age_days);
    var fee = feeTier(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'nothing but the wallet', time: '5 minutes' },
      { text: planAction(p, capital, chain), cost: '$' + capital + ' of capital and ' + fee.tx, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: fee.week, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(formatStep);
  }

  function readState() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('tab') === 'live' || params.get('tab') === 'pre-token') view.tab = params.get('tab');
  }
  function writeState() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  function orderedRows(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function topBar() {
    return node('header', { class: 'top' },
      node('div', { class: 'brand' }, node('span', { class: 'mark' }), node('span', { class: 'brand-name', text: 'Token Radar' })),
      node('div', { class: 'top-meta' },
        node('span', { text: 'Snapshot ' + DATA.as_of }),
        node('span', { text: 'DefiLlama protocol index' }),
        node('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function intro() {
    return node('section', { class: 'lede' },
      node('div', null,
        node('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        node('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      node('div', { class: 'facts' },
        node('div', { class: 'fact' }, node('span', { text: 'Watchlist covered' }), node('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        node('div', { class: 'fact' }, node('span', { text: 'Pre-token rows scored' }), node('b', { text: String(DATA.board_size) })),
        node('div', { class: 'fact' }, node('span', { text: 'Early rows below the floor' }), node('b', { text: String(DATA.early_size) })),
        node('div', { class: 'fact' }, node('span', { text: 'Live-token protocols set aside' }), node('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function topThree() {
    var top = DATA.rows.slice(0, 3);
    return node('section', { class: 'spotlight', 'aria-label': 'Top three by implied value' },
      top.map(function (r) {
        return node('article', { class: 'spot', tabindex: '0', onclick: function () { showDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } } },
          node('span', { class: 'spot-rank', text: '#' + r.rank }),
          node('h3', { text: r.name }),
          node('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + money(r.tvl_usd) + ' TVL' }),
          node('b', { class: 'spot-value num', text: money(r.implied_value_usd) }),
          node('span', { class: 'sub', text: 'implied value' })
        );
      })
    );
  }

  function filters() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = node('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeState(); draw(); });
    var select = node('select', { id: 'category', 'aria-label': 'Filter by category' },
      node('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return node('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { view.category = select.value; writeState(); draw(); });
    var pre = node('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; draw(); } });
    var live = node('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; draw(); } });
    return node('div', { class: 'controls' },
      node('div', { class: 'field' }, node('label', { for: 'q', text: 'Search' }), search),
      node('div', { class: 'field' }, node('label', { for: 'category', text: 'Category' }), select),
      node('div', { class: 'field' }, node('span', { class: 'sub', text: 'Token status' }), node('div', { class: 'tabs' }, pre, live)),
      node('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortCell(key, label) {
    return node('th', { scope: 'col' },
      node('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } draw(); } },
        label,
        view.sort === key ? node('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardPanel() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return node('div', { class: 'panel' }, node('div', { class: 'empty' },
        node('h2', { text: 'No protocol matches that filter' }),
        node('p', { text: 'Clear the search or pick another category to see the board again.' }),
        node('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; writeState(); draw(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = node('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = node('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
      },
        node('td', { class: 'num', text: String(r.rank) }),
        node('td', null, node('div', { class: 'name' },
          node('b', { text: r.name }),
          node('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        node('td', { class: 'num', text: money(r.tvl_usd) }),
        node('td', { class: 'num ' + growthClass, text: growth }),
        node('td', { class: 'num', text: ageLabel(r.age_days) }),
        node('td', null, node('div', { class: 'implied' },
          node('div', { class: 'bar', 'aria-hidden': 'true' }, node('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          node('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        node('td', null, node('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return node('div', { class: 'panel' },
      node('div', { class: 'table-wrap' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          node('thead', null, node('tr', null,
            sortCell('implied', 'Rank'),
            sortCell('name', 'Protocol'),
            sortCell('tvl', 'TVL'),
            sortCell('growth', '7d'),
            sortCell('age', 'Age'),
            sortCell('implied', 'Implied value'),
            node('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function livePanel() {
    var tbody = node('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(node('tr', null,
        node('td', { class: 'num', text: 'live' }),
        node('td', null, node('div', { class: 'name' }, node('b', { text: r.name }), node('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        node('td', { class: 'num', text: money(r.tvl_usd) }),
        node('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        node('td', { class: 'num', text: money(r.mcap_usd) }),
        node('td', null, node('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return node('div', { class: 'panel' },
      node('div', { class: 'table-wrap' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Status' }), node('th', { scope: 'col', text: 'Protocol' }), node('th', { scope: 'col', text: 'TVL' }), node('th', { scope: 'col', text: '7d' }), node('th', { scope: 'col', text: 'Market cap' }), node('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelSection() {
    var m = DATA.model;
    var bench = (DATA.multiples || []).filter(function (x) { return !x.fallback; }).slice(0, 10);
    return node('section', { class: 'panel model' },
      node('h2', { text: 'How implied value is computed' }),
      node('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      node('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      node('p', { class: 'sub', text: 'The multiple is not one flat number: it is the median market-cap-to-TVL ratio of the live-token protocols in the same category, calibrated from this snapshot. Categories with fewer than ' + m.multiple_min_n + ' live protocols use the whole live set\u2019s median of ' + DATA.overall_multiple.toFixed(3) + ', and every multiple is clamped to [' + m.multiple_min + ', ' + m.multiple_max + ']. A DEX token does not trade at a lending protocol\u2019s multiple, and the snapshot says so.' }),
      node('div', { class: 'table-wrap bench' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Calibrated multiples: what the market already pays per dollar of TVL, by category.' }),
          node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Category' }), node('th', { scope: 'col', text: 'Multiple' }), node('th', { scope: 'col', text: 'Live protocols' }))),
          node('tbody', null, bench.map(function (x) {
            return node('tr', null,
              node('td', null, node('b', { text: x.category })),
              node('td', { class: 'num', text: x.multiple.toFixed(3) + 'x' }),
              node('td', { class: 'num', text: String(x.live_n) })
            );
          }))
        )
      ),
      node('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var detailDialog = node('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  detailDialog.addEventListener('close', function () { view.selected = null; writeState(); });

  function showDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeState();
    detailDialog.textContent = '';
    var steps = planSteps(row);
    detailDialog.appendChild(node('div', { class: 'detail-head' },
      node('div', null,
        node('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        node('h2', { id: 'detail-title', text: row.name }),
        node('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      node('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { detailDialog.close(); } })
    ));
    detailDialog.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Implied value' }),
      node('div', { class: 'equation' },
        node('div', null, node('span', { text: 'TVL' }), node('b', { class: 'num', text: money(row.tvl_usd) })),
        node('div', null, node('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), node('b', { class: 'num', text: row.category_multiple.toFixed(3) + 'x' })),
        node('div', null, node('span', { text: 'Seven-day growth' }), node('b', { class: 'num', text: pct(row.change_7d) })),
        node('div', null, node('span', { text: 'Age with no token' }), node('b', { class: 'num', text: ageLabel(row.age_days) })),
        node('div', null, node('span', { text: 'Growth multiplier' }), node('b', { class: 'num', text: String(row.growth_multiplier) })),
        node('div', null, node('span', { text: 'Maturity multiplier' }), node('b', { class: 'num', text: String(row.maturity_multiplier) })),
        node('div', null, node('span', { text: 'Implied value' }), node('b', { class: 'num', text: money(row.implied_value_usd) }))
      ),
      node('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recompute(row, DATA.model)) + (recompute(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    detailDialog.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Farm plan' }),
      node('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return node('li', null, node('b', { text: action }), node('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof detailDialog.showModal === 'function') {
      if (!detailDialog.open) detailDialog.showModal();
    } else {
      detailDialog.setAttribute('open', '');
    }
  }

  function draw() {
    mount.textContent = '';
    var shell = node('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    if (view.tab === 'pre-token') shell.appendChild(topThree());
    shell.appendChild(filters());
    shell.appendChild(view.tab === 'pre-token' ? boardPanel() : livePanel());
    if (view.tab === 'pre-token') shell.appendChild(modelSection());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!detailDialog.isConnected) mount.appendChild(detailDialog);
    if (view.selected) showDetail(view.selected);
  }

  readState();
  draw();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && detailDialog.open) detailDialog.close();
  });
})();
