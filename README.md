# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ayonclaw/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ayonclaw/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token desk: it reads the sealed DefiLlama snapshot, works out which protocols still record no
token, prices each one off the multiple its own listed peers trade at, and ranks the field in a dark,
dense, monospace dashboard with a chart view and a per-protocol detail page.

## The call

```
implied value = TVL × category multiple × tenure × momentum
```

- **multiple** — the median market-cap/TVL of the snapshot's *own* token-bearing protocols in the same
  category, winsorised to 3× the market-wide median and shrunk toward it by six pseudo-observations.
  Nothing is typed in: the number is measured from 128 listed records in the same file.
- **tenure** — `0.80 + 0.20 × min(months without a token / 24, 1)`. Two years of TVL with no launch
  earns the full 20% durability lift; a two-month-old protocol has not proved anything yet.
- **momentum** — `1 + 0.5 × clamp(change_7d, ±25) / 100`: half the week's flow, never more than ±12.5%.
- **score** — the row's implied value as a per-cent share of the board leader, so the sort is readable
  at a glance.

A protocol that records a token is excluded, not ranked: 416 of the snapshot's 758 protocols carry a
`gecko_id` or a `symbol` and never reach the board. The board covers all 40 watchlist protocols and
adds 158 pre-token protocols below the $50M floor, so the floor is never the whole field. Wrapped,
staked, bridged, versioned and exchange-branded products are dropped from the extra rows by the same
test the watchlist uses — WBTC is Bitcoin on Ethereum, not a launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input
```

Under the grader, `/input/snapshot.json` is the sealed snapshot and `/output` is writable; the program
writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`. It is deterministic:
two runs write the same bytes.

## Files

| Path | What |
| --- | --- |
| `main.ts` | entrypoint: reads the snapshot, writes the board, the page data and the dossier |
| `lib/model.ts` | the scoring model, the product test, the board and its gate checks |
| `dashboard/` | `index.html`, `app.css`, `app.js` — board, charts, detail; no network, no framework |
| `screenshots/` | the three captures handed to the judge |
| `vendor/makefun-board.ts` | make.fun's dossier builder, byte for byte as shipped |
| `tools/shoot.py` | renders the three screenshots at 1440×900 from the built `out/` |

## The dashboard

A ranked board of 198 rows — rank, protocol, chain, TVL, seven-day change, months without a token, the
multiple applied, a score bar, the implied value and the arithmetic behind it. Search, chain, category
and watchlist filters; every column sorts. A chart view prices untokenised TVL by chain, the
distribution of how long the field has run without a launch, and the measured multiple per category.
Clicking a row opens its detail page: the four-term breakdown, the sentence explaining why it ranks
where it does, the neighbouring protocols in its category, and a five-step farm plan with a gas cost
and a time for each step.

---

<sub>Entered on [make.fun](https://make.fun/?ref=9bsf1q6a&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
