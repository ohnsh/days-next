import type { SourceItem } from './types'

/** Read only replacement identities; rendering never resolves local paths or fetches Git. */
export function githubReplacements(value: unknown): Set<string> {
  if (!Array.isArray(value)) throw new Error('Git manifest must be an array')
  const repositories = new Set<string>()
  for (const repo of value) {
    if (!repo || typeof repo !== 'object')
      throw new Error('Git manifest entries must be objects')
    if (repo.github === undefined) continue
    if (
      typeof repo.github !== 'string' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/.test(repo.github) ||
      ['.', '..'].includes(repo.github.split('/')[1])
    )
      throw new Error(`${repo.id}: github must be an owner/repo identity`)
    repositories.add(repo.github.toLowerCase())
  }
  return repositories
}

export function isVisibleSourceItem(item: SourceItem, replacements: ReadonlySet<string>) {
  return item.source !== 'github' || !replacements.has(item.group.toLowerCase())
}
