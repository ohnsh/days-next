# Days

Days is a day-oriented personal archive, succeeding [the original Days](https://days-og.ohn.sh).
It uses server-rendered Astro with Cloudflare, aggregating posts, Git/GitHub activity,
YouTube, and [VOD](https://vod.ohn.sh). Live at https://days.ohn.sh.
`days-next` is the checkout and Worker name. This repository is a single application;
`og-snap` and `vod-player-astro` are linked dependencies.

## Notes

- [Usage](usage.md): development, credentials, routes and data flow, imports, checks, and social images.
- [Feed benchmark](feed-benchmark.md): November 16, 2026 measurements comparing three- and seven-day feeds, with reproduction steps and limitations.

These notes are agent-maintained context, not necessarily reviewed or endorsed by the
repository owner. Verify historical observations against current code.

Git repository schema and poster override instructions remain alongside the configuration in
[`src/data/README.md`](../src/data/README.md).
