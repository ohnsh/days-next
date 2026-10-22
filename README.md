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

`VOD_BASE_URL`, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD` are non-secret configuration in
`wrangler.jsonc`. No VOD write token is used by this prototype.

## Routes and data flow

- `/`: three calendar days per page, newest first; `?before=YYYY-MM-DD` is an exclusive date cursor.
  Empty days remain visible and can still have notes added.
- `/YYYY/MM/DD/`: a permanent day page with previous/next-day navigation.
- `/admin/`: source import status and create/edit/delete for day notes/highlights.
- `/api/admin/events`: same-origin JSON mutations, optimistic version checks.

```text
GitHub / YouTube → sync scripts → Days libSQL database
VOD public API                 → camera/day coverage
                                      ↓
                           server/days.ts aggregation
                                      ↓
                          loaders/days.ts live loader
                                      ↓
                          Astro feed and day routes
```

`src/live.config.ts` exposes `getLiveEntry('days', date)` and
`getLiveCollection('days', { before, limit })`. Collection queries are bounded to 1–7 days. Database
services are independent of Astro and reused by administration. Source failures are distinguished
from empty days: VOD outages display a notice, while database failures return a 503 rather than an
empty archive.

Successful public pages use Astro's Cloudflare route cache: 60 seconds fresh, with up to 15 seconds
stale-while-revalidate. The adapter enables Workers Caching in the generated deployment config;
cache hits skip rendering and all its database/API requests. Browser responses require revalidation.
The small cache-provider wrapper sets `stale-if-error=0` so failures cannot extend cached content
indefinitely. Admin responses and degraded pages use `no-store` and do not opt into route caching.
Cache storage is platform-managed; no KV binding or in-process query cache is used.

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
bun run sync                    # both sources
bun run sync github
bun run sync youtube
```

Importing replaces a complete source snapshot atomically. Failed fetches do not publish a partial
source. GitHub uses ETag conditional requests cached under `.data/`; full reconciliation handles
amendments, removals, and changed repository visibility. YouTube currently refreshes its complete
uploads/Shorts playlists so updated titles and removed entries are reconciled. These are explicit
CLI jobs, not page-request work or a configured scheduled job.

GitHub imports only public repositories and retains the original author-matching rules. IDs include
repository identity and SHA. YouTube preserves title-based day assignment, emoji/description tags,
and Shorts classification. Import data is plain text rendered with Astro escaping.

## Administration and VOD ownership

In `astro dev`, administration is available locally and edits are attributed to `local-dev`. This is
a compile-time development bypass. Keep the dev server on loopback; it can write to whichever
database `.dev.vars` selects.

Production builds require a validated Cloudflare Access JWT, including issuer, audience, expiry,
subject, and email. Configure one Access application covering `/admin`, `/admin/*`, `/api/admin`,
and `/api/admin/*`, and set its team domain and audience in `wrangler.jsonc`. An absent
configuration denies access. Mutation requests must carry same-origin JSON, and stale
updates/deletes return 409.

Days events currently have a plain day, title, notes, tags, public/private visibility, and an
optional camera/timestamp playback link. Private is the default. They are **editorial notes, not VOD
retention protections**.

The prototype introduces the new Days workspace without cutting over existing VOD event storage or
deleting its administrator UI. The subsequent cutover needs VOD-owned recording-protection records
coordinated with the CLI pruning lock, plus reliable reconciliation of protection changes from Days.
Existing VOD timeline event overlays still read the existing VOD events. The old Days Markdown/MDX
posts and their custom components have not yet been migrated.

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
