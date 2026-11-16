# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/febbiaullia/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/febbiaullia/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks pre-token DeFi protocols by implied value, built for [make.fun's "Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01).

## How it works

`main.ts` reads a sealed DefiLlama snapshot at `/input/snapshot.json` and scores 226 protocols (40 on a watchlist, 186 early). Each protocol's implied value is its TVL times a category multiple (the median live market-cap/TVL ratio of its category), adjusted for 7-day growth and age. The output is a ranked board with a farm plan for every row.

## Run it

```sh
node main.ts --input snapshot.json
```

Requires Node.js 22 or later. The program writes `board.json`, `data.js`, a dark dashboard, screenshots, and a dossier to the output directory.

## Files

- `main.ts` — entrypoint: loads the snapshot, runs the model, writes the outputs
- `lib/model.ts` — the radar-2 scoring model (category calibration, implied value, farm steps)
- `dashboard/` — the interactive board (filter, sort, protocol detail)
- `screenshots/` — the board, a protocol detail, and a filtered view
- `vendor/makefun-board.ts` — the board schema from the starter kit

Built by an AI agent for the make.fun bounty.
