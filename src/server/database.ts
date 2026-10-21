import { createClient, type Client, type Row } from '@libsql/client/web'
import type { EditorialEvent, SourceItem } from '../lib/types'

export function database(url: string | undefined, token?: string) {
  if (!url) throw new Error('Days database is not configured. Set DAYS_DATABASE_URL.')
  return createClient({ url, authToken: token })
}
export async function readItems(db: Client, first: string, last: string) {
  const result = await db.execute({
    sql: 'SELECT payload FROM source_items WHERE day>=? AND day<=? AND is_public=1 ORDER BY day DESC, id LIMIT 5001',
    args: [first, last],
  })
  if (result.rows.length > 5000) throw new Error('Too many source items; narrow the date range')
  return result.rows.map((row) => JSON.parse(String(row.payload)) as SourceItem)
}
export function eventFromRow(row: Row): EditorialEvent {
  return {
    id: String(row.id),
    day: String(row.day),
    title: String(row.title),
    notes: String(row.notes),
    tags: JSON.parse(String(row.tags)),
    public: Boolean(row.is_public),
    version: Number(row.version),
    camera: String(row.camera),
    at: String(row.at),
  }
}
export async function readEvents(db: Client, first: string, last: string, admin = false) {
  const result = await db.execute({
    sql: `SELECT * FROM events WHERE day>=? AND day<=? ${admin ? '' : 'AND is_public=1'} ORDER BY day DESC, updated_at DESC LIMIT 1001`,
    args: [first, last],
  })
  if (result.rows.length > 1000) throw new Error('Too many events; narrow the date range')
  return result.rows.map(eventFromRow)
}
