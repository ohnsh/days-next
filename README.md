# Days

A day-oriented personal archive, rendered on demand with Astro 7, its Cloudflare adapter, and an
aggregated `days` live content collection. The application is branded **Days**; `days-next` is the
temporary checkout and Worker name.

## Local development

Requires Node 22.22+, Bun, and the Turso CLI. Keep the sibling `../vod-misc/vod-player-astro`
component available (it is a local package dependency).

```sh
bun install
cp .dev.vars.example .dev.vars
bun run db:dev
```

Leave the database server running. In another terminal:

```sh
bun run db:migrate
bun run db:seed                 # imports ../days/.days
bun run dev --host 127.0.0.1
```

Open <http://127.0.0.1:4321/>. A useful populated example is <http://127.0.0.1:4321/2026/10/19/>.
`/admin/` provides the editorial workspace. Astro may automatically background its dev server when
launched by an agent; `--ignore-lock` keeps it in the foreground for a harness-managed process.

The checked-out prototype has already been seeded into `.data/days.db`. All database files,
screenshots, cached responses, and local credentials are ignored. VOD footage is read from the
existing public `https://vod.ohn.sh` API; media and players load from their existing public origins.

### Connections and credentials

Both the Worker and command-line scripts read `.dev.vars`. Script environment variables supplied
explicitly by the shell take precedence. Set:

- `DAYS_DATABASE_URL`: local HTTP endpoint, or the new Days Turso database URL.
- `DAYS_AUTH_TOKEN`: Days database token; empty for the local development server.
- `GITHUB_TOKEN` / `YT_API_KEY`: optional import-script credentials. Rendering pages does not call
  those source APIs or require those credentials.
- `VOD_ADMIN_API_TOKEN`: optional VOD admin credential used by `/admin/` through the local
  `/api/admin/events` proxy. Without it, event editing is unavailable.

`VOD_BASE_URL`, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD` are non-secret configuration in
`wrangler.jsonc`. Configure `VOD_ADMIN_API_TOKEN` as a Worker secret in production.

## Routes and data flow

- `/`: three calendar days per page, newest first; `?before=YYYY-MM-DD` is an exclusive date cursor.
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
`Content-Type: application/json` headers, under the existing Access authentication. This endpoint
purges rendered Days routes, not VOD's separate response cache. External VOD/import notifications
are not wired automatically; otherwise new recordings/imports become visible through expiry. Dates
are in America/Chicago. In development Astro disables route caching and the purge endpoint returns
`purged: false`.

VOD owns query optimization and its discovery API response cache (30 seconds fresh plus 15 seconds
SWR). The two independent layers can accumulate staleness: allow roughly two minutes under normal
conditions for an unannounced change to appear in Days. The live collection does not cache database
queries itself, and click-to-load players still make their own VOD requests.

After deployment, verify repeated requests produce `Cf-Cache-Status: HIT`, verify degraded/admin
responses bypass caching, and verify a day purge causes a miss on both the day page and a feed
containing it. Local builds validate headers/configuration, not Cloudflare's distributed cache.

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

## Administration and VOD ownership

In `astro dev`, administration is available locally and edits are attributed to `local-dev`. This is
a compile-time development bypass. Keep the dev server on loopback; it can write to whichever
database `.dev.vars` selects and, when configured, modify VOD events.

Production builds require a validated Cloudflare Access JWT, including issuer, audience, expiry,
subject, and email. Configure one Access application covering `/admin`, `/admin/*`, `/api/admin`,
and `/api/admin/*`, and set its team domain and audience in `wrangler.jsonc`. An absent
configuration denies access. Mutation requests must carry same-origin JSON, and stale
updates/deletes return 409.

VOD is the source of truth for events, including their visibility, tags, camera scope, and recording
retention protection. Public day pages read events from VOD's `/api/events`. The Days `/admin/`
workspace sends event changes through `/api/admin/events`, which uses `VOD_ADMIN_API_TOKEN` to call
VOD's `/api/admin/events` API. Set that secret locally in `.dev.vars` and in production as a Worker
secret. Events marked for protection prevent their associated recordings from being pruned by VOD.

## Checks

```sh
bun run types
bun run check
bun run test
bun run build
bun run test:browser            # local database + dev server must be running
```

Unit/integration tests cover DST, midnight boundaries, explicit YouTube dates, private repository
exclusion, overlap coverage, private/public notes, and concurrent edits. Browser smoke tests
exercise a real VOD day, click-to-load players, mobile layout, invalid dates, same-origin
enforcement, and the full note lifecycle. They create and delete a temporary local event. Install
Chromium with `bunx playwright install chromium` if needed. Screenshots are written beneath
`.data/screenshots/`.

For production-runtime checks, `bun run preview --port 4322` serves the built Worker locally. Public
pages should load and unauthenticated admin routes should return 403 even on localhost.

## Separate Cloudflare deployment

The prototype is configured as Worker `days-next`; no production domain is attached. Create a
dedicated Days Turso database, migrate and seed it using the scripts above with that database's
connection, then configure the Worker secrets `DAYS_DATABASE_URL` and `DAYS_AUTH_TOKEN`. Local
`.dev.vars` is not uploaded by the build. Configure Access before using the deployed admin
workspace.

```sh
bun run check
bun run deploy
```

Deployment uses the standard Astro Cloudflare Worker output. Sessions are disabled and images use
compile-time processing; no session KV or Images binding is required. The compatibility date is
October 19, 2026, the newest date supported by the adapter's installed workerd binary. This checkout
has only been run locally; no remote database or Worker has been provisioned or deployed.
