# Seven-day feed benchmark

Date: 2026-11-16. Status: observation.
Source commit: `c0d5e8923670899908716dedf5eaacdf564cb16e` (seven-day feed and benchmark);
baseline parent: `83cc9d3`. Evidence: `scripts/benchmark-feed.mjs`, `src/pages/index.astro`,
and the local raw results listed below.

Measured `/` on November 16, 2026 using
`bun run dev:prod-vod --host 127.0.0.1 --port 4322`, with the configured Days database and
production public VOD API. Baseline covered November 14–16; the updated feed covered
November 10–16.

## Method

- Chromium via Playwright, desktop viewport 1440 × 1000, no throttling.
- Ten sequential navigations per version, after two discarded warmups.
- Fresh browser context per navigation (cold browser cache, warm dev server and upstream
  caches). Baseline measured first, then seven days.
- Paint and resource observations collected two seconds after `load`, without scrolling or
  interacting. HTML size is the decoded document body.
- Initial Vite dependency optimization caused a failed startup request; a later
  development reload interrupted another attempt. Neither incomplete run is included.
- Local development assets and real upstream network variation affect these numbers; they
  are not deployed production or CDN-cache-hit measurements.

## Results

| Metric (median)          |   3 days |   7 days |          Change |
| ------------------------ | -------: | -------: | --------------: |
| TTFB                     | 232.3 ms | 289.3 ms | +57.0 ms (+25%) |
| Document received        | 232.8 ms | 289.9 ms |        +57.1 ms |
| First contentful paint   |   440 ms |   476 ms |          +36 ms |
| Largest contentful paint |   542 ms |   584 ms |    +42 ms (+8%) |
| Load event               | 579.3 ms | 634.8 ms |        +55.5 ms |
| Layout shift sum         |  0.00225 |  0.00225 |       unchanged |
| HTML bytes               |  144,279 |  266,167 | +121,888 (+84%) |
| DOM elements             |      574 |    1,176 |            +602 |
| Resource requests        |       51 |       55 |              +4 |
| Player elements          |        9 |       21 |             +12 |
| Loaded iframes           |        0 |        0 |       unchanged |

TTFB ranges overlap: 172.5–348.6 ms versus 223.8–358.7 ms. LCP ranges also overlap:
500–680 ms versus 540–724 ms. The observed timing increase is modest, but these small
sequential samples do not isolate it from network noise. HTML and DOM growth are the
clearest costs. Day coverage is already fetched concurrently (`src/server/days.ts`), and
players remain lazy.

## Verification and reproduction

59 unit tests passed; `bun run check` reported zero errors or warnings (18 existing
hints). Read-only mobile checks at 390 × 844 confirmed seven cards, no horizontal
overflow, and seven distinct older days after pagination. The admin-mutating browser smoke
suite was not run against production VOD.

```sh
bun run dev:prod-vod --host 127.0.0.1 --port 4322
node scripts/benchmark-feed.mjs http://127.0.0.1:4322/ 7 10
```

For the baseline, set the collection limit in `src/pages/index.astro` to `3` and pass `3`
as the script's expected day count. Keep the same environment and date window. Raw results
from this run are stored locally in `.data/feed-benchmark-3.json` and
`.data/feed-benchmark-7.json`.
