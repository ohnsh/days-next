import type { APIRoute } from 'astro'
import { plainDay } from '../../lib/dates'
import { vodBaseUrl } from '../../server/runtime'
import { vodCalendar } from '../../server/vod'

export const GET: APIRoute = async ({ url }) => {
  const month = url.searchParams.get('month') ?? ''
  try {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month')
    plainDay(`${month}-01`)
  } catch {
    return Response.json({ error: 'Expected a valid YYYY-MM month' }, { status: 400 })
  }
  try {
    // Upstream owns cache invalidation; do not add a long-lived aggregate cache.
    return Response.json(await vodCalendar(vodBaseUrl(), month), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'vod-calendar-failed', message: String(error) })
    )
    return Response.json(
      { error: 'VOD availability is temporarily unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
