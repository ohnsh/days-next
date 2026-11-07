import { createClient, type Client } from '@libsql/client'
import type { SourceItem } from '../src/lib/types'
import { parseEnv } from 'node:util'

// Use the same local connection as the Worker; explicit shell variables win.
const vars = Bun.file(new URL('../.dev.vars', import.meta.url))
if (await vars.exists()) {
  for (const [key, value] of Object.entries(parseEnv(await vars.text())))
    process.env[key] ??= value
}

export function scriptDatabase() {
  return createClient({
    url: process.env.DAYS_DATABASE_URL || 'http://127.0.0.1:8080',
    authToken: process.env.DAYS_AUTH_TOKEN,
  })
}

type ExistingRows = Map<string, string>
type SqlReader = Pick<Client, 'execute'>
type SqlBatcher = Pick<Client, 'batch'>

async function readExisting(
  db: SqlReader,
  source: SourceItem['source']
): Promise<ExistingRows> {
  const rows = await db.execute({
    sql: 'SELECT id, payload FROM source_items WHERE source=?',
    args: [source],
  })
  return new Map(rows.rows.map((row) => [String(row.id), String(row.payload)]))
}

export async function getSourceState(
  source: SourceItem['source'],
  db?: Client
): Promise<{ finishedAt: string | null; existing: Map<string, string> }> {
  const client = db ?? scriptDatabase()
  try {
    const [run, existing] = await Promise.all([
      client.execute({
        sql: 'SELECT finished_at FROM sync_runs WHERE source = ?',
        args: [source],
      }),
      readExisting(client, source),
    ])
    return {
      finishedAt:
        run.rows[0]?.finished_at == null ? null : String(run.rows[0].finished_at),
      existing,
    }
  } finally {
    if (!db) client.close()
  }
}

function upsertStatements(
  source: SourceItem['source'],
  items: SourceItem[],
  now: string
) {
  return items.map((item) => ({
    sql: 'INSERT OR REPLACE INTO source_items (id,source,day,payload,is_public,updated_at) VALUES (?,?,?,?,1,?)',
    args: [item.id, source, item.day, JSON.stringify(item), now],
  }))
}

async function batchStatements(
  db: SqlBatcher,
  statements: ReturnType<typeof upsertStatements>
) {
  for (let offset = 0; offset < statements.length; offset += 100)
    await db.batch(statements.slice(offset, offset + 100))
}

// Replace one complete source snapshot atomically, but do not rewrite unchanged rows.
export async function replaceSource(
  source: SourceItem['source'],
  items: SourceItem[],
  db?: Client
) {
  const client = db ?? scriptDatabase()
  let tx: Awaited<ReturnType<Client['transaction']>> | undefined
  try {
    tx = await client.transaction('write')
    const existing = await readExisting(tx, source)
    const itemIds = new Set(items.map((item) => item.id))
    const toDelete = [...existing.keys()].filter((id) => !itemIds.has(id))
    const toUpsert = items.filter(
      (item) => existing.get(item.id) !== JSON.stringify(item)
    )
    const now = new Date().toISOString()

    for (let offset = 0; offset < toDelete.length; offset += 100) {
      await tx.batch(
        toDelete
          .slice(offset, offset + 100)
          .map((id) => ({
            sql: 'DELETE FROM source_items WHERE source=? AND id=?',
            args: [source, id],
          }))
      )
    }
    await batchStatements(tx, upsertStatements(source, toUpsert, now))
    await tx.execute({
      sql: 'INSERT OR REPLACE INTO sync_runs VALUES (?,?,?)',
      args: [source, now, items.length],
    })
    await tx.commit()
    console.log(
      `${source} (full): ${toUpsert.length} upserted, ${toDelete.length} removed (${items.length} total)`
    )
    return { upserted: toUpsert.length, deleted: toDelete.length, total: items.length }
  } catch (error) {
    if (tx && !tx.closed) await tx.rollback()
    throw error
  } finally {
    tx?.close()
    if (!db) client.close()
  }
}

export async function upsertSource(
  source: SourceItem['source'],
  items: SourceItem[],
  db?: Client
) {
  const client = db ?? scriptDatabase()
  let tx: Awaited<ReturnType<Client['transaction']>> | undefined
  try {
    tx = await client.transaction('write')
    const existing = await readExisting(tx, source)
    const toUpsert = items.filter(
      (item) => existing.get(item.id) !== JSON.stringify(item)
    )
    const now = new Date().toISOString()
    await batchStatements(tx, upsertStatements(source, toUpsert, now))
    const total = new Set([...existing.keys(), ...items.map((item) => item.id)]).size
    await tx.execute({
      sql: 'INSERT OR REPLACE INTO sync_runs VALUES (?,?,?)',
      args: [source, now, total],
    })
    await tx.commit()
    console.log(`${source} (incremental): ${toUpsert.length} upserted (${total} total)`)
    return { upserted: toUpsert.length, total }
  } catch (error) {
    if (tx && !tx.closed) await tx.rollback()
    throw error
  } finally {
    tx?.close()
    if (!db) client.close()
  }
}
