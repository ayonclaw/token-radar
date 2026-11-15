# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ayonclaw/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ayonclaw/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A dashboard that ranks pre-token protocols by an implied value derived from the snapshot's own figures,
with a farm plan for each one.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9bsf1q6a&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

## The value model

The model is calibrated on the snapshot's own priced protocols, then applied to the ones that record no
token. Nothing is special-cased by name.

```
log10(market cap) = 3.025 + 0.522 x log10(base TVL) + 0.25 x relative 7-day move + category adjustment
```

- **base TVL** takes the week's move back out of the size denominator
  (`tvl / (1 + clamp(change_7d/100, -0.6, 1.5))`), so growth enters the score once rather than twice.
- **relative growth** is the 7-day move against the snapshot's own field median.
- **tenure** is how long the protocol has run with no token on record.
- **category** is an empirical-Bayes-shrunk residual over 34 categories.

## The dashboard

`dashboard/` holds `index.html`, `app.css` and `app.js`, plus `data.js` written beside the page by
`main.ts`. The board is sortable and filterable (search, category, chain, TVL floor, watchlist-only),
every row opens a detail drawer with the full derivation and a farm plan giving each step's cost and
time, and the token-already-trades and set-aside protocols have their own views.
