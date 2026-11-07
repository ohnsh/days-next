import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { collectGit, parseManifest, expandPath, syncGit } from '../scripts/git'
import { replaceSource } from '../scripts/db'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'days-git-'))
  directories.push(path)
  function git(...args: string[]) {
    const result = Bun.spawnSync(['git', '-C', path, ...args])
    if (result.exitCode) throw new Error(result.stderr.toString())
    return result.stdout.toString().trim()
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test Author')
  git('config', 'user.email', 'test@example.com')
  git('config', 'commit.gpgsign', 'false')
  const commit = (message: string) => {
    git('commit', '--allow-empty', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  const manifest = join(path, 'manifest.json')
  async function configure(extra = {}) {
    await Bun.write(
      manifest,
      JSON.stringify([
        {
          id: 'fixture',
          path: '.',
          defaultBranch: 'main',
          authors: { emails: ['test@example.com'] },
          ...extra,
        },
      ])
    )
  }
  return { path, git, commit, manifest, configure }
}

test('labels only non-default history, deduplicates shared topic commits, reconciles rewrites and removals', async () => {
  const f = await fixture()
  const base = f.commit('base\n\nBody with tabs\tand Unicode 🌱')
  f.git('checkout', '-b', 'topic')
  const topic = f.commit('topic')
  f.git('branch', 'other')
  await f.configure({ refs: ['topic', 'main', 'other'] })
  let items = await collectGit(f.manifest)
  expect(items).toHaveLength(2)
  expect(items.find((i) => i.id.endsWith(base))?.branches).toEqual([])
  expect(items.find((i) => i.id.endsWith(topic))?.branches).toEqual(['other', 'topic'])
  expect(items.find((i) => i.id.endsWith(base))?.description).toContain('Unicode 🌱')
  expect(items[0].url).toBeUndefined()

  const db = createClient({ url: ':memory:' })
  try {
    await db.executeMultiple(await Bun.file('migrations/001_days.sql').text())
    // Verify existing GitHub data survives the migration and Git reconciliation.
    await db.execute(
      "INSERT INTO source_items VALUES ('github:old','github','2026-01-01','{}',1,'original')"
    )
    await db.executeMultiple(await Bun.file('migrations/002_git_source.sql').text())
    await replaceSource('git', items, db)
    await db.execute("UPDATE source_items SET updated_at='original'")
    expect(await replaceSource('git', items, db)).toEqual({
      upserted: 0,
      deleted: 0,
      total: 2,
    })
    expect(
      (await db.execute('SELECT DISTINCT updated_at FROM source_items')).rows.map(
        (row) => row.updated_at
      )
    ).toEqual(['original'])

    f.git('checkout', 'main')
    f.git('merge', '--ff-only', 'topic')
    items = await collectGit(f.manifest)
    expect(items.every((i) => i.branches?.length === 0)).toBe(true)
    expect((await replaceSource('git', items, db)).upserted).toBe(1)

    f.git('checkout', 'topic')
    const temporary = f.commit('temporary')
    await replaceSource('git', await collectGit(f.manifest), db)
    f.git('commit', '--amend', '--allow-empty', '-m', 'rewritten')
    items = await collectGit(f.manifest)
    expect(items.some((i) => i.id.endsWith(temporary))).toBe(false)
    expect(await replaceSource('git', items, db)).toEqual({
      upserted: 1,
      deleted: 1,
      total: 3,
    })
    await f.configure()
    expect(await replaceSource('git', await collectGit(f.manifest), db)).toEqual({
      upserted: 0,
      deleted: 1,
      total: 2,
    })
    expect(
      (await db.execute("SELECT id FROM source_items WHERE source='github'")).rows
    ).toHaveLength(1)
  } finally {
    db.close()
  }
})

test('requires the default branch, fails missing refs, and never guesses the checked-out topic is default', async () => {
  const f = await fixture()
  f.commit('base')
  f.git('checkout', '-b', 'topic')
  await f.configure({ refs: ['topic'] })
  await expect(collectGit(f.manifest)).rejects.toThrow('explicitly include')
  await f.configure({ refs: ['main', 'missing'] })
  await expect(collectGit(f.manifest)).rejects.toThrow('rev-parse')
  await f.configure({ defaultBranch: undefined })
  await expect(collectGit(f.manifest)).rejects.toThrow('cannot determine default')
  f.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  expect(await collectGit(f.manifest)).toHaveLength(1)
})

test('remote cache discovers HEAD, fetches forced updates, and prunes removed branches', async () => {
  const f = await fixture()
  f.commit('base')
  // A local transport exercises the same fetch/cache code as an SSH transport.
  await f.configure({
    path: undefined,
    remote: f.path,
    defaultBranch: undefined,
    commitUrl: 'https://example.com/commit/{sha}',
  })
  const cache = join(f.path, 'cache')
  const first = await collectGit(f.manifest, cache)
  expect(first).toHaveLength(1)
  expect(first[0].url).toBe(`https://example.com/commit/${f.git('rev-parse', 'HEAD')}`)
  f.git('commit', '--amend', '--allow-empty', '-m', 'replacement')
  const second = await collectGit(f.manifest, cache)
  expect(second).toHaveLength(1)
  expect(second[0].id).not.toBe(first[0].id)
  f.git('branch', 'topic')
  await f.configure({ path: undefined, remote: f.path, refs: ['main', 'topic'] })
  await collectGit(f.manifest, cache)
  f.git('branch', '-D', 'topic')
  await expect(collectGit(f.manifest, cache)).rejects.toThrow('rev-parse')
})

test('manifest rejects ambiguous locations, duplicate IDs and unsafe viewer URLs', () => {
  expect(() => parseManifest([{ id: 'x', path: '.', remote: 'host:repo' }])).toThrow()
  expect(() =>
    parseManifest([
      { id: 'x', path: '.' },
      { id: 'x', path: '..' },
    ])
  ).toThrow()
  expect(() =>
    parseManifest([{ id: 'x', path: '.', commitUrl: 'javascript:{sha}' }])
  ).toThrow()
})

test('YAML paths expand environment variables and fail for missing values', async () => {
  expect(
    expandPath('$REPOS_ROOT/${PROJECT}', { REPOS_ROOT: '/repos', PROJECT: 'days' })
  ).toBe('/repos/days')
  expect(() => expandPath('${UNSET}/repo', {})).toThrow('Unset or empty')
  expect(() => expandPath('$EMPTY/repo', { EMPTY: '' })).toThrow('Unset or empty')
  const f = await fixture()
  f.commit('base')
  const old = process.env.DAYS_TEST_REPOS_ROOT
  process.env.DAYS_TEST_REPOS_ROOT = f.path
  try {
    await Bun.write(
      f.manifest,
      `# portable manifest\n- id: fixture\n  path: \${DAYS_TEST_REPOS_ROOT}\n  defaultBranch: main\n  authors:\n    emails: [test@example.com]\n`
    )
    expect(await collectGit(f.manifest)).toHaveLength(1)
  } finally {
    if (old === undefined) delete process.env.DAYS_TEST_REPOS_ROOT
    else process.env.DAYS_TEST_REPOS_ROOT = old
  }
})

test('shared database checkpoints reject stale/divergent refs, removals and missing repositories atomically', async () => {
  const f = await fixture()
  const base = f.commit('base')
  await f.configure()
  const db = createClient({ url: ':memory:' })
  const snapshot = async () =>
    Promise.all(
      ['source_items', 'git_sync_refs', 'sync_runs'].map(
        async (table) => (await db.execute(`SELECT * FROM ${table}`)).rows
      )
    )
  try {
    for (const name of ['001_days', '002_git_source', '003_git_refs'])
      await db.executeMultiple(await Bun.file(`migrations/${name}.sql`).text())
    await syncGit(f.manifest, { db })
    // Advance with an excluded author: ancestry must be protected even without new feed rows.
    f.git('config', 'user.email', 'someone-else@example.com')
    const latest = f.commit('excluded author')
    expect((await syncGit(f.manifest, { db })).upserted).toBe(0)
    const saved = await snapshot()
    f.git('reset', '--hard', base)
    await expect(syncGit(f.manifest, { db })).rejects.toThrow('requires --force')
    expect(await snapshot()).toEqual(saved)
    f.commit('divergent')
    await expect(syncGit(f.manifest, { db })).rejects.toThrow('requires --force')
    expect(await snapshot()).toEqual(saved)

    await f.configure({ path: 'missing-directory' })
    await expect(syncGit(f.manifest, { db, force: true })).rejects.toThrow()
    expect(await snapshot()).toEqual(saved)
    await f.configure({ refs: ['main', 'missing'] })
    await expect(syncGit(f.manifest, { db, force: true })).rejects.toThrow()
    expect(await snapshot()).toEqual(saved)

    await f.configure()
    await syncGit(f.manifest, { db, force: true })
    expect((await db.execute('SELECT sha FROM git_sync_refs')).rows[0].sha).not.toBe(
      latest
    )
    f.git('branch', 'topic')
    await f.configure({ refs: ['main', 'topic'] })
    await syncGit(f.manifest, { db })
    await f.configure()
    await expect(syncGit(f.manifest, { db })).rejects.toThrow('removed ref')
    await syncGit(f.manifest, { db, force: true })
    await Bun.write(f.manifest, '[]')
    await expect(syncGit(f.manifest, { db })).rejects.toThrow('requires --force')
    await syncGit(f.manifest, { db, force: true })
    expect((await db.execute('SELECT * FROM source_items')).rows).toHaveLength(0)
    expect((await db.execute('SELECT * FROM git_sync_refs')).rows).toHaveLength(0)
  } finally {
    db.close()
  }
})

test('legacy imports cannot lose records when establishing the first ref checkpoints', async () => {
  const f = await fixture()
  f.commit('base')
  await f.configure()
  const db = createClient({ url: ':memory:' })
  try {
    for (const name of ['001_days', '002_git_source', '003_git_refs'])
      await db.executeMultiple(await Bun.file(`migrations/${name}.sql`).text())
    await replaceSource('git', await collectGit(f.manifest), db)
    f.git('commit', '--amend', '--allow-empty', '-m', 'rewritten')
    await expect(syncGit(f.manifest, { db })).rejects.toThrow('previously imported')
    expect((await db.execute('SELECT * FROM git_sync_refs')).rows).toHaveLength(0)
    await syncGit(f.manifest, { db, force: true })
  } finally {
    db.close()
  }
})
