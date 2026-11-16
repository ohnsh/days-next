import { mkdir, realpath } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import type { Client } from '@libsql/client'
import { replaceSource } from './db'
import { dayFromInstant } from '../src/lib/dates'
import { isMyCommit } from '../src/lib/sources'
import type { SourceItem } from '../src/lib/types'
import { githubReplacements } from '../src/lib/git-repositories'

export interface GitRepository {
  id: string
  path?: string
  remote?: string
  defaultBranch?: string
  refs?: string[]
  commitUrl?: string
  github?: string
  authors?: { names?: string[]; emails?: string[] }
}

export function parseManifest(value: unknown): GitRepository[] {
  if (!Array.isArray(value)) throw new Error('Git manifest must be an array')
  githubReplacements(value)
  const ids = new Set<string>()
  for (const repo of value) {
    if (
      !repo ||
      typeof repo !== 'object' ||
      typeof repo.id !== 'string' ||
      !repo.id.trim()
    )
      throw new Error('Every Git repository needs a nonempty id')
    if (ids.has(repo.id)) throw new Error(`Duplicate Git repository id: ${repo.id}`)
    ids.add(repo.id)
    if (!!repo.path === !!repo.remote)
      throw new Error(`${repo.id}: specify exactly one of path or remote`)
    for (const key of ['path', 'remote', 'defaultBranch', 'commitUrl']) {
      if (repo[key] !== undefined && (typeof repo[key] !== 'string' || !repo[key].trim()))
        throw new Error(`${repo.id}: invalid ${key}`)
    }
    if (
      repo.refs !== undefined &&
      (!Array.isArray(repo.refs) ||
        !repo.refs.length ||
        repo.refs.some((ref: unknown) => typeof ref !== 'string' || !ref))
    )
      throw new Error(`${repo.id}: refs must be a nonempty array of branch names`)
    if (repo.commitUrl !== undefined) {
      if (
        !repo.commitUrl.includes('{sha}') ||
        !['http:', 'https:'].includes(new URL(repo.commitUrl).protocol)
      )
        throw new Error(
          `${repo.id}: commitUrl must be an HTTP(S) template containing {sha}`
        )
    }
    if (repo.authors !== undefined) {
      if (
        !repo.authors ||
        typeof repo.authors !== 'object' ||
        Array.isArray(repo.authors)
      )
        throw new Error(`${repo.id}: invalid authors`)
      for (const key of ['names', 'emails']) {
        const entries = repo.authors[key]
        if (
          entries !== undefined &&
          (!Array.isArray(entries) ||
            entries.some((entry: unknown) => typeof entry !== 'string' || !entry))
        )
          throw new Error(`${repo.id}: invalid author ${key}`)
      }
    }
  }
  return value as GitRepository[]
}

async function git(path: string, args: string[], optional = false): Promise<string> {
  const proc = Bun.spawn(['git', '-C', path, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
    },
  })
  const [out, err, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (status !== 0) {
    if (optional) return ''
    throw new Error(`git ${args[0]} (${path}): ${err.trim()}`)
  }
  return out
}

async function repositoryPath(repo: GitRepository, base: string, cache: string) {
  if (repo.path) {
    const path = await realpath(resolve(base, expandPath(repo.path)))
    const bare =
      (await git(path, ['rev-parse', '--is-bare-repository'])).trim() === 'true'
    const root = (
      await git(path, ['rev-parse', bare ? '--absolute-git-dir' : '--show-toplevel'])
    ).trim()
    if ((await realpath(root)) !== path)
      throw new Error(`${repo.id}: path must be a repository root, not a subdirectory`)
    return path
  }
  const path = resolve(cache, createHash('sha256').update(repo.remote!).digest('hex'))
  await mkdir(path, { recursive: true })
  if (!(await Bun.file(resolve(path, 'HEAD')).exists()))
    await git(path, ['init', '--bare'])
  // Fetch only branch refs, including forced updates and deletions, into an owned cache.
  await git(path, [
    'fetch',
    '--prune',
    '--no-tags',
    '--',
    repo.remote!,
    '+refs/heads/*:refs/heads/*',
  ])
  return path
}

function branchRef(value: string) {
  return value.startsWith('refs/') ? value : `refs/heads/${value}`
}

async function defaultRef(repo: GitRepository, path: string): Promise<string> {
  if (repo.defaultBranch) return branchRef(repo.defaultBranch)
  if (repo.remote) {
    const head = await git(path, ['ls-remote', '--symref', '--', repo.remote, 'HEAD'])
    const ref = /^ref: (refs\/heads\/[^\t]+)\tHEAD$/m.exec(head)?.[1]
    if (ref) return ref
  } else {
    const remoteHead = (
      await git(path, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], true)
    ).trim()
    if (remoteHead) return remoteHead.replace(/^refs\/remotes\/origin\//, 'refs/heads/')
    if ((await git(path, ['rev-parse', '--is-bare-repository'])).trim() === 'true') {
      const head = (await git(path, ['symbolic-ref', '--quiet', 'HEAD'], true)).trim()
      if (head) return head
    }
  }
  throw new Error(`${repo.id}: cannot determine default branch; set defaultBranch`)
}

export function expandPath(
  path: string,
  env: Record<string, string | undefined> = process.env
) {
  return path.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, braced, bare) => {
      const name = braced ?? bare
      if (!env[name]) throw new Error(`Unset or empty path environment variable: ${name}`)
      return env[name]!
    }
  )
}

interface GitRefSnapshot {
  repository: string
  ref: string
  sha: string
  ancestors: Set<string>
}

async function collectGitSnapshot(manifest: string, cache = '.data/git-repositories') {
  const repos = parseManifest(parse(await Bun.file(manifest).text()))
  const items: SourceItem[] = []
  const checkpoints: GitRefSnapshot[] = []
  for (const repo of repos) {
    const path = await repositoryPath(repo, dirname(resolve(manifest)), cache)
    if ((await git(path, ['rev-parse', '--is-shallow-repository'])).trim() === 'true')
      throw new Error(`${repo.id}: whole-history sync requires a non-shallow repository`)
    const main = await defaultRef(repo, path)
    const refs = [...new Set((repo.refs ?? [main]).map(branchRef))].sort()
    if (!refs.includes(main))
      throw new Error(`${repo.id}: refs must explicitly include ${main}`)
    // Resolve all branch tips first so the scan uses a consistent set of objects.
    const tips = new Map<string, string>()
    for (const ref of refs) {
      if (!ref.startsWith('refs/heads/') && !ref.startsWith('refs/remotes/'))
        throw new Error(`${repo.id}: expected a branch ref: ${ref}`)
      await git(path, ['check-ref-format', ref])
      tips.set(
        ref,
        (await git(path, ['rev-parse', '--verify', `${ref}^{commit}`])).trim()
      )
    }
    const branches = new Map<string, string[]>()
    const histories = new Map<string, Set<string>>()
    for (const [ref, sha] of tips) {
      const history = new Set(
        (await git(path, ['rev-list', sha, '--'])).trim().split('\n').filter(Boolean)
      )
      histories.set(ref, history)
      checkpoints.push({ repository: repo.id, ref, sha, ancestors: history })
    }
    for (const ref of refs.filter((ref) => ref !== main)) {
      for (const sha of histories.get(ref)!) {
        if (histories.get(main)!.has(sha)) continue
        branches.set(sha, [
          ...(branches.get(sha) ?? []),
          ref.replace(/^refs\/(heads|remotes)\//, ''),
        ])
      }
    }
    const log = await git(path, [
      'log',
      '--no-show-signature',
      '--no-use-mailmap',
      '-z',
      '--format=%H%x00%an%x00%ae%x00%aI%x00%B',
      ...tips.values(),
      '--',
    ])
    const fields = log.split('\0')
    if (fields.at(-1) === '') fields.pop()
    if (fields.length % 5) throw new Error(`${repo.id}: invalid Git log framing`)
    for (let i = 0; i < fields.length; i += 5) {
      const [sha, name, email, date, message] = fields.slice(i, i + 5)
      const author = { name, email, date }
      const mine = repo.authors
        ? (repo.authors.names ?? []).some(
            (v) => v.toLowerCase() === name.toLowerCase()
          ) ||
          (repo.authors.emails ?? []).some((v) => v.toLowerCase() === email.toLowerCase())
        : isMyCommit({ sha, html_url: '', commit: { author, message } })
      if (!mine) continue
      items.push({
        id: `git:${repo.id}:${sha}`,
        source: 'git',
        group: repo.id,
        day: dayFromInstant(date),
        occurredAt: date,
        title: message.split('\n')[0],
        description: message,
        ...(repo.commitUrl ? { url: repo.commitUrl.replaceAll('{sha}', sha) } : {}),
        tags: [],
        branches: branches.get(sha) ?? [],
      })
    }
  }
  return { items, checkpoints }
}

export async function collectGit(
  manifest: string,
  cache?: string
): Promise<SourceItem[]> {
  return (await collectGitSnapshot(manifest, cache)).items
}

export async function syncGit(
  manifest: string,
  options: { force?: 'all' | string[]; db?: Client; cache?: string } = {}
) {
  const forced = (repository: string) =>
    options.force === 'all' || options.force?.includes(repository) === true
  // Any missing repository/ref or failed fetch aborts here, including with --force.
  const { items, checkpoints } = await collectGitSnapshot(manifest, options.cache)
  return replaceSource('git', items, options.db, async (tx, existing) => {
    const previous = await tx.execute('SELECT repository, ref, sha FROM git_sync_refs')
    const problems: string[] = []
    for (const row of previous.rows) {
      if (forced(String(row.repository))) continue
      const current = checkpoints.find(
        (entry) => entry.repository === row.repository && entry.ref === row.ref
      )
      if (!current) problems.push(`${row.repository}: removed ref ${row.ref}`)
      else if (!current.ancestors.has(String(row.sha)))
        problems.push(
          `${row.repository} ${row.ref}: ${row.sha} is not an ancestor of ${current.sha} (behind, divergent, or unavailable)`
        )
    }
    // Also protects pre-checkpoint imports and author-filter/configuration changes.
    const ids = new Set(items.map((item) => item.id))
    const removed = new Map<string, number>()
    for (const [id, payload] of existing) {
      if (ids.has(id)) continue
      const repository = (JSON.parse(payload) as SourceItem).group
      if (forced(repository)) continue
      removed.set(repository, (removed.get(repository) ?? 0) + 1)
    }
    for (const [repository, count] of removed)
      problems.push(
        `${repository}: ${count} previously imported commit(s) would be removed`
      )
    if (problems.length)
      throw new Error(
        `Git sync requires --force=<repository IDs> or --force=all:\n${problems.join('\n')}`
      )
    // Checkpoints and feed rows commit together, under the same write transaction.
    await tx.execute('DELETE FROM git_sync_refs')
    for (const { repository, ref, sha } of checkpoints)
      await tx.execute({
        sql: 'INSERT INTO git_sync_refs VALUES (?,?,?)',
        args: [repository, ref, sha],
      })
  })
}
