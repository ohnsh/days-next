import { afterEach, expect, test } from 'bun:test'
import { createClient, type Client } from '@libsql/client'
import { getSourceState, replaceSource, upsertSource } from '../scripts/db'
import type { SourceItem } from '../src/lib/types'

const clients: Client[] = []

function database() {
  const db = createClient({ url: ':memory:' })
  clients.push(db)
  return db
}

async function schema(db: Client) {
  await db.executeMultiple(`
    CREATE TABLE source_items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      day TEXT NOT NULL,
      payload TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sync_runs (
      source TEXT PRIMARY KEY,
      finished_at TEXT NOT NULL,
      item_count INTEGER NOT NULL
    );
  `)
}

function item(id: string, title = id): SourceItem {
  return {
    id: `github:${id}`,
    source: 'github',
    day: '2026-10-20',
    title,
    url: `https://example.com/${id}`,
    description: title,
    occurredAt: '2026-10-20T12:00:00Z',
    group: 'example/repo',
    tags: [],
  }
}

afterEach(() => {
  for (const db of clients.splice(0)) db.close()
})

test('replaceSource inserts a snapshot and records its sync run', async () => {
  const db = database()
  await schema(db)
  const result = await replaceSource('github', [item('one'), item('two')], db)

  expect(result).toEqual({ upserted: 2, deleted: 0, total: 2 })
  expect((await getSourceState('github', db)).existing.size).toBe(2)
  const run = await db.execute({ sql: 'SELECT finished_at, item_count FROM sync_runs WHERE source=?', args: ['github'] })
  expect(run.rows[0].finished_at).toBeTruthy()
  expect(run.rows[0].item_count).toBe(2)
})

test('replaceSource diffs rows and preserves unchanged updated_at timestamps', async () => {
  const db = database()
  await schema(db)
  await replaceSource('github', [item('changed'), item('unchanged'), item('removed')], db)
  await db.execute({
    sql: "UPDATE source_items SET updated_at='original timestamp' WHERE id='github:unchanged'",
  })

  const result = await replaceSource('github', [item('changed', 'updated'), item('unchanged')], db)
  const unchanged = await db.execute({
    sql: 'SELECT updated_at FROM source_items WHERE id=?',
    args: ['github:unchanged'],
  })
  const ids = await db.execute({ sql: 'SELECT id FROM source_items WHERE source=?', args: ['github'] })

  expect(result).toEqual({ upserted: 1, deleted: 1, total: 2 })
  expect(unchanged.rows[0].updated_at).toBe('original timestamp')
  expect(ids.rows.map((row) => row.id).sort()).toEqual(['github:changed', 'github:unchanged'])
})

test('upsertSource writes only changed/new items and leaves other source rows intact', async () => {
  const db = database()
  await schema(db)
  await replaceSource('github', [item('same'), item('untouched')], db)

  const result = await upsertSource('github', [item('same'), item('new')], db)
  const rows = await db.execute({ sql: 'SELECT id FROM source_items WHERE source=?', args: ['github'] })

  expect(result).toEqual({ upserted: 1, total: 3 })
  expect(rows.rows.map((row) => row.id).sort()).toEqual([
    'github:new',
    'github:same',
    'github:untouched',
  ])
  expect((await getSourceState('github', db)).existing.size).toBe(3)
})
