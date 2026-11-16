import { expect, test } from 'bun:test'
import { githubReplacements, isVisibleSourceItem } from '../src/lib/git-repositories'
import { parseManifest } from '../scripts/git'
import type { SourceItem } from '../src/lib/types'

function item(source: SourceItem['source'], group: string): SourceItem {
  return {
    id: `${source}:unrelated-sha`,
    source,
    group,
    day: '2026-11-16',
    title: 'Commit',
    description: '',
    occurredAt: '2026-11-16T12:00:00Z',
    tags: [],
  }
}

test('explicit mappings suppress whole GitHub repositories without matching Git commits', () => {
  const replacements = githubReplacements([
    { id: 'local-name', path: '${UNSET}/repo', github: 'Owner/Repo' },
    { id: 'other', path: '.', commitUrl: 'https://github.com/owner/other/commit/{sha}' },
  ])
  expect(isVisibleSourceItem(item('github', 'OWNER/REPO'), replacements)).toBe(false)
  expect(isVisibleSourceItem(item('github', 'owner/other'), replacements)).toBe(true)
  expect(isVisibleSourceItem(item('github', 'another/repo'), replacements)).toBe(true)
  expect(isVisibleSourceItem(item('git', 'owner/repo'), replacements)).toBe(true)
  expect(isVisibleSourceItem(item('youtube', 'owner/repo'), replacements)).toBe(true)
  expect(isVisibleSourceItem(item('github', 'owner/repo'), githubReplacements([]))).toBe(true)
})

test('Git imports validate optional GitHub repository identities', () => {
  expect(parseManifest([{ id: 'x', path: '.', github: 'owner/repo.name' }])[0].github)
    .toBe('owner/repo.name')
  for (const github of ['', 'repo', 'owner/repo/extra', 'https://github.com/owner/repo', ' owner/repo', 'owner/repo ', 42, null, 'owner/..']) {
    expect(() => parseManifest([{ id: 'x', path: '.', github }])).toThrow('owner/repo')
  }
})
