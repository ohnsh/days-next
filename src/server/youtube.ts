import type { Client } from '@libsql/client/web'
import { dayCachePolicy, plainDay } from '../lib/dates'
import { readYoutubeItems } from './database'

export interface YoutubeRouteCache {
  enabled: boolean
  set(options: { maxAge: number; swr: number; tags: string[] } | false): void
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
}

export async function handleYoutubeRequest(
  request: Request,
  openDatabase: () => Client,
  cache?: YoutubeRouteCache
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (cache?.enabled) cache.set(false)
    return new Response('Method not allowed', {
      status: 405,
      headers: {
        ...corsHeaders,
        Allow: 'GET, HEAD, OPTIONS',
        'Cache-Control': 'no-store',
      },
    })
  }
  const url = new URL(request.url)
  let day: string
  try {
    day = plainDay(url.searchParams.get('day') ?? '')
  } catch {
    if (cache?.enabled) cache.set(false)
    return Response.json(
      { error: 'Expected day=YYYY-MM-DD' },
      { status: 400, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } }
    )
  }
  let db: Client | undefined
  try {
    db = openDatabase()
    const items = await readYoutubeItems(db, day)
    if (cache?.enabled) {
      cache.set({ ...dayCachePolicy(day), tags: ['days', `day:${day}`] })
    }
    return Response.json(items, {
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=0, must-revalidate' },
    })
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'youtube-api-error', day, message: String(error) })
    )
    if (cache?.enabled) cache.set(false)
    return Response.json(
      { error: 'YouTube items are temporarily unavailable' },
      { status: 503, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } }
    )
  } finally {
    db?.close()
  }
}
