import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { OgSnap, type CaptureRequest } from 'og-snap/client'
import { runCapture, inspectJournal } from 'og-snap/cli'
import { parseSocialSelection, socialOrigin } from '../src/lib/social'
import { plainDay } from '../src/lib/dates'

const { values } = parseArgs({
  options: {
    day: { type: 'string' },
    id: { type: 'string' },
    camera: { type: 'string' },
    section: { type: 'string' },
    'all-cameras': { type: 'boolean' },
    'for-day': { type: 'string' },
    alt: { type: 'string' },
    status: { type: 'string' },
    'purge-day': { type: 'string' },
    help: { type: 'boolean' },
  },
})

async function purge(day: string) {
  plainDay(day)
  const jwt = process.env.DAYS_ACCESS_JWT
  if (!jwt)
    throw new Error(
      'Set DAYS_ACCESS_JWT to a Cloudflare Access user JWT to purge cached pages'
    )
  const url = new URL('/api/admin/cache', socialOrigin)
  url.searchParams.set('day', day)
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Origin: socialOrigin,
      Cookie: `CF_Authorization=${jwt}`,
      'Cf-Access-Jwt-Assertion': jwt,
    },
    body: '{}',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Cache purge failed (${response.status})`)
  const result = (await response.json()) as { purged?: boolean }
  if (!result.purged) throw new Error('Server cache invalidation is disabled')
  console.error(`Purged day:${day}`)
}

async function main() {
  if (values.help) {
    console.log(`social:capture --day YYYY-MM-DD [--section all|vod|youtube] [--all-cameras]
social:capture --id youtube:ID [--for-day YYYY-MM-DD]
social:capture --day YYYY-MM-DD --camera ID [--for-day YYYY-MM-DD]
social:capture --status JOURNAL
social:capture --purge-day YYYY-MM-DD
Optional: --alt DESCRIPTION. Credentials: OG_SNAP_TOKEN, DAYS_ACCESS_JWT (cache purge).`)
    return
  }
  if (values.status || values['purge-day']) {
    const mode = values.status ? 'status' : 'purge-day'
    if (Object.keys(values).some((key) => key !== mode))
      throw new Error(`--${mode} must be used alone`)
    if (values['purge-day']) return purge(values['purge-day'])
  }
  if (!process.env.OG_SNAP_TOKEN) throw new Error('Set OG_SNAP_TOKEN')
  const client = new OgSnap({ consumer: 'days', token: process.env.OG_SNAP_TOKEN })
  if (values.status) {
    console.log(JSON.stringify(await inspectJournal(client, values.status), null, 2))
    return
  }
  const params = new URLSearchParams()
  for (const key of [
    'day',
    'id',
    'camera',
    'section',
    'all-cameras',
    'for-day',
  ] as const) {
    if (values[key] !== undefined) params.set(key, String(values[key]))
  }
  parseSocialSelection(params)
  if (values.alt !== undefined && values.alt.length > 500)
    throw new Error('--alt must be at most 500 characters')
  const url = new URL('/social/selection.json', socialOrigin)
  url.search = params.toString()
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(`Selection failed (${response.status}): ${await response.text()}`)
  const { request, affectedDays } = (await response.json()) as {
    request: Omit<CaptureRequest, 'publication'>
    affectedDays: string[]
  }
  if (values.alt !== undefined) request.alt = values.alt
  const result = await runCapture({
    client,
    request,
    journalDirectory: fileURLToPath(new URL('../.og-snap/', import.meta.url)),
    onJournal: (path) =>
      console.error(
        `Request journal: ${path}\nInspect with: bun run social:capture --status ${path}`
      ),
  })
  console.log(JSON.stringify(result, null, 2))
  for (const day of affectedDays) {
    try {
      await purge(day)
    } catch (error) {
      console.error(
        `Image published successfully. ${error}\nRetry only the purge: bun run social:capture --purge-day ${day}`
      )
      process.exitCode = 1
    }
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
