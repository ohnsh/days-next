import { createClient, type Client } from '@libsql/client/web'
import type { SourceItem } from '../lib/types'

export function database(url: string | undefined, token?: string) {
  if (!url) throw new Error('Days database is not configured. Set DAYS_DATABASE_URL.')
  return createClient({ url, authToken: token })
}
export async function readItems(db: Client, first: string, last: string) {
  const result = await db.execute({
    sql: 'SELECT payload FROM source_items WHERE day>=? AND day<=? AND is_public=1 ORDER BY day DESC, id LIMIT 5001',
    args: [first, last],
  })
  if (result.rows.length > 5000)
    throw new Error('Too many source items; narrow the date range')
  return result.rows.map((row) => JSON.parse(String(row.payload)) as SourceItem)
}
export async function readYoutubeItems(db: Client, day: string) {
  const result = await db.execute({
    sql: "SELECT payload FROM source_items WHERE day=? AND source='youtube' AND is_public=1 ORDER BY id LIMIT 5001",
    args: [day],
  })
  if (result.rows.length > 5000)
    throw new Error('Too many source items; narrow the date range')
  return result.rows
    .map((row) => JSON.parse(String(row.payload)) as SourceItem)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
