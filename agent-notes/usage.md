# Days usage

Last reviewed: 2026-11-16 against `f185527`. Status: observation.
Evidence: `package.json`, `src/pages/index.astro`, and the implementation paths below.
These are maintained operating notes; recheck them when commands, integrations, or caching
behavior change. Local checks do not establish deployed cache behavior.

A day-oriented personal archive, rendered on demand with Astro 7, its Cloudflare adapter, and an
aggregated `days` live content collection. The application is branded **Days**; `days-next` is the
temporary checkout and Worker name.

## Local development

Astro may automatically background its dev server when launched by an agent; `--ignore-lock` keeps
it in the foreground for a harness-managed process.

VOD footage is read from the existing public `https://vod.ohn.sh` API; media and players load from
their existing public origins.

### Connections and credentials

- `DAYS_DATABASE_URL`: local HTTP endpoint, or the new Days Turso database URL.
- `DAYS_AUTH_TOKEN`: Days database token; empty for the local development server.
- `GITHUB_TOKEN` / `YT_API_KEY`: optional import-script credentials. Rendering pages does not call
  those source APIs or require those credentials.
- `VOD_ADMIN_API_TOKEN`: optional VOD admin credential used by `/admin/` through the local
  `/api/admin/events` proxy. Without it, event editing is unavailable.

`VOD_BASE_URL`, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD` are non-secret configuration in
`wrangler.jsonc`. Configure `VOD_ADMIN_API_TOKEN` as a Worker secret in production.

## Routes and data flow

- `/`: seven calendar days per page, newest first; `?before=YYYY-MM-DD` is an exclusive date cursor.
  Empty days remain visible and can still have notes added.
- `/YYYY/MM/DD/`: a permanent day page with previous/next-day navigation.
- `/posts/...`: individual file-based Markdown/MDX posts from `src/content/posts/`.
- `/admin/`: source import status and VOD event editing.
- `/api/admin/events`: same-origin event mutations, proxied to VOD with optimistic version checks.

```text
GitHub / YouTube → sync scripts → Days libSQL database
VOD `/api/events`               → events and camera/day coverage
Days `/api/admin/events` → VOD `/api/admin/events` (admin token)
                                      ↓
                           server/days.ts aggregation
                                      ↓
                          loaders/days.ts live loader
                                      ↓
                           Astro feed and day routes
```

Posts are authored as `.md` or `.mdx` files under `src/content/posts/`, served individually at
`/posts/...`, and excerpted on day and feed pages. Events are owned by VOD and read from its
`/api/events` endpoint; the Days database stores imported source items, not event records.

`src/live.config.ts` exposes `getLiveEntry('days', date)` and
`getLiveCollection('days', { before, limit })`. Collection queries are bounded to 1–7 days. Database
services are independent of Astro and reused by administration. Source failures are distinguished
from empty days: VOD outages display a notice, while database failures return a 503 rather than an
empty archive.

Successful public pages use Astro's Cloudflare route cache. Recent days (within the last 7 days)
are cached for 60 seconds, with up to 15 seconds stale-while-revalidate. Historical day pages and
posts, and feeds containing only historical days, are cached for 7 days with 1 day
stale-while-revalidate. A feed containing any recent day keeps the short TTL. The adapter enables
Workers Caching in the generated deployment config; cache hits skip rendering and all its
database/API requests. Browser responses require revalidation. The small cache-provider wrapper
sets `stale-if-error=0` so failures cannot extend cached content indefinitely. Admin responses and
degraded pages use `no-store` and do not opt into route caching. Cache storage is platform-managed;
no KV binding or in-process query cache is used.

Pages carry a `days` tag and `day:YYYY-MM-DD` tags for every represented day, so a per-day purge
also clears feeds containing that day. Successful editorial writes purge `days` (including the old
date when an event moves). A purge failure is logged without reporting an already-committed write as
failed; the TTL remains the fallback. Deployments start with a fresh cache.

Authenticated administrators can request targeted invalidation using
`POST /api/admin/cache?day=2026-10-18`, with same-origin `Origin` and
`Content-Type: application/json` headers, under the existing Access authentication. In development,
Astro disables route caching and the purge endpoint returns `purged: false`.

VOD owns query optimization and its discovery API response cache (30 seconds fresh plus 15 seconds
SWR). The two independent layers can accumulate staleness: allow roughly two minutes under normal
conditions for an unannounced change to appear in Days. The live collection does not cache database
queries itself, and click-to-load players still make their own VOD requests.

After deployment, verify repeated requests produce `Cf-Cache-Status: HIT`, verify degraded/admin
responses bypass caching, and verify a day purge causes a miss on both the day page and a feed
containing it. Local builds validate headers/configuration, not Cloudflare's distributed cache.

### VOD views and transcripts

Days discovers published views through `/api/views` and uses view day/calendar endpoints.

Transcripts include audio-only views and attached audio supplied by each view endpoint.
The combined transcript deduplicates `(recordingId, segmentIndex)` across views, retaining
the first view in API order and its playback link. Individual view counts and selected-view
transcripts remain complete; the combined count reflects unique segments. New links use
`?view=`.

### Dates

- The site timezone is **America/Chicago**.
- Explicit dates, including YouTube title dates, remain plain `YYYY-MM-DD` values.
- GitHub author timestamps and undated YouTube publication timestamps map to a Chicago date.
  Title-derived YouTube dates take precedence over publication.
- VOD intervals appear on every Chicago day they overlap. Camera-local API dates are mapped
  separately, and coverage is clipped to the Chicago day and merged across overlapping recordings.
  DST days can contain 23 or 25 hours.
- Playback links retain UTC instants; the embedded player uses its camera timezone.

## Imports

```sh
bun run db:seed /path/to/old-days/.days
bun run sync                    # incremental, both sources
bun run sync github
bun run sync youtube
bun run sync --full             # full reconciliation of both sources
bun run sync github --full
bun run sync:full                # alias for full reconciliation
```

Routine syncs are incremental: GitHub checks recently pushed public repositories and commits since
the last successful run, while YouTube scans new uploads and only the relevant portion of Shorts.
They write only changed/new items and never remove older entries. First syncs and explicit `--full`
syncs reconcile complete source snapshots, removing entries that are no longer present while
leaving unchanged database rows untouched. Explicit full GitHub syncs bypass the `.data/` ETag cache
so amended commits and visibility changes are fetched fresh. Failed fetches do not publish partial
source updates. These are explicit CLI jobs, not page-request work or a configured scheduled job.

GitHub imports only public repositories and retains the original author-matching rules. IDs include
repository identity and SHA. YouTube preserves title-based day assignment, emoji/description tags,
and Shorts classification. Import data is plain text rendered with Astro escaping.

## Git repository prototype

Git imports are a separate source from GitHub, with their own IDs and sync status.
`src/data/git-repositories.yaml` explicitly opts repositories into the public feed.

```sh
bun run sync:git                       # src/data/git-repositories.yaml
bun run sync:git /path/to/manifest.yaml
bun run sync:git --force=days-next     # accept changes/removals only for this repository
bun run sync:git --force=days-next,other-repo
bun run sync:git --force=all           # accept changes/removals for every repository
```

The existing `sync`, `sync github`, and `sync --full` commands retain their existing behavior;
they do not invoke Git imports. Running both importers for the same history intentionally
produces separate Git and GitHub entries. To switch, stop running the GitHub importer;
its already-imported rows remain until explicitly removed.

The manifest schema and examples are documented alongside the configuration in
[`src/data/README.md`](../src/data/README.md#git-repositories).

Every run scans the complete history reachable from the selected branch tips and reconciles
the entire Git source atomically after all repositories succeed. Unchanged rows retain their
timestamps. Per-repository/ref tips are stored in the shared Days database. Each previously synced
tip must remain reachable from that same ref's new tip: a behind checkout, divergent/rebased
branch, or unavailable prior commit requires `--force=<id>`. Removed repositories/refs also require
`--force=<id>`.

Force requires a comma-separated list of repository IDs; bare `--force` is rejected.
Only listed repositories may bypass these checks. A problem in any other repository still
aborts the entire sync. Use `--force=all` explicitly to bypass checks for every repository.

A missing configured repository/ref, unset path variable, shallow repository, or failed fetch
aborts the entire import without changing database records, **even with `--force=all`**. Removing
an entry from the manifest is different: it intentionally removes its history, requiring
`--force=<removed-id>` or `--force=all`. An empty manifest can clear the Git source with `--force=all`.

Run `bun run db:migrate` when upgrading to install the checkpoint table. On the first sync
after upgrading, existing feed records are protected against removal, and current ref tips
establish the baseline. Use an up-to-date checkout for this first run.

Commits outside default-branch history display labels for every selected topic branch that reaches
them. Labels disappear when the commit becomes reachable from the default branch.

## Checks

```sh
bun run types
bun run check
bun run test
bun run build
bun run test:browser            # local database + dev server + VOD admin API access required
```

For production-runtime checks, `bun run preview --port 4322` serves the built Worker locally. Public
pages should load and unauthenticated admin routes should return 403 even on localhost.

## Social images

Days uses `og-snap` for capture publication and metadata helpers. The linked package picks up
client edits directly, without pulling Browser Run's development tooling into Days.

```sh
bun run social:capture --day 2026-11-12
bun run social:capture --day 2026-11-12 --section youtube
bun run social:capture --day 2026-11-12 --section vod --all-cameras
bun run social:capture --id 'youtube:VIDEO_ID'
bun run social:capture --day 2026-11-12 --camera quad
bun run social:capture --day 2026-11-12 --camera quad --for-day 2026-11-12
bun run social:capture --id 'youtube:VIDEO_ID' --for-day 2026-11-12
```

Set `OG_SNAP_TOKEN` to the Days consumer token. Set `DAYS_ACCESS_JWT` to a current
Cloudflare Access **user** JWT for Days to invalidate cached HTML after publishing
a day image (for example, obtain it with `cloudflared access token --app=https://days.ohn.sh`).
The existing admin endpoint still verifies JWT identity and same-origin JSON.
Tokens remain local to the CLI; preview routes are public and only select public
content. Never commit credentials or request journals.

Preview the composition at `/social/preview?day=2026-11-12`,
`/social/preview?id=youtube%3AVIDEO_ID`, or
`/social/preview?day=2026-11-12&camera=quad`. These are fixed 1200×630 poster-only
pages. Grids show one row of up to three posters, VOD first and then YouTube in the same order
as DayContent, with an overflow count. VOD defaults and poster-time overrides are
shared with the normal page. YouTube posters use 16:9 cover frames to crop their
baked-in letterboxing; VOD posters use contain fitting.

Requests are journaled in ignored `.og-snap/` before submission. After an uncertain
outcome, inspect the journal before starting a new capture:

```sh
bun run social:capture --status .og-snap/REQUEST.json
bun run social:capture --purge-day 2026-11-12
```
