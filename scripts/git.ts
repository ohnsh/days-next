import { mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { dayFromInstant } from '../src/lib/dates'
import { isMyCommit } from '../src/lib/sources'
import type { SourceItem } from '../src/lib/types'

export interface GitRepository {
  id: string
  path?: string
  remote?: string
  defaultBranch?: string
  refs?: string[]
  commitUrl?: string
  authors?: { names?: string[]; emails?: string[] }
}

export function parseManifest(value: unknown): GitRepository[] {
  if (!Array.isArray(value)) throw new Error('Git manifest must be an array')
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
  if (repo.path) return resolve(base, repo.path)
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

export async function collectGit(
  manifest: string,
  cache = '.data/git-repositories'
): Promise<SourceItem[]> {
  const repos = parseManifest(await Bun.file(manifest).json())
  const items: SourceItem[] = []
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
    for (const ref of refs.filter((ref) => ref !== main)) {
      const hashes = await git(path, [
        'rev-list',
        tips.get(ref)!,
        '--not',
        tips.get(main)!,
        '--',
      ])
      for (const sha of hashes.trim().split('\n').filter(Boolean)) {
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
  return items
}
