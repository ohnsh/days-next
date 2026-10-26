import {
  githubItem,
  youtubeItem,
  type GithubRepo,
  type GithubCommit,
  type YoutubeItem,
} from '../src/lib/sources'
import type { SourceItem } from '../src/lib/types'
import { getSourceState, replaceSource, upsertSource } from './db'
import { mkdir } from 'node:fs/promises'

type GithubPage = { etag: string; next: string; items: unknown[] }
const githubCache: Record<string, GithubPage> = await Bun.file('.data/github-http.json')
  .json()
  .catch(() => ({}))

async function githubPages<T>(
  initialUrl: string,
  useCache = true,
  stopAfterPage?: (items: T[]) => boolean
): Promise<T[]> {
  const all: T[] = []
  let url = initialUrl
  while (url) {
    const cached = useCache ? githubCache[url] : undefined
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
      },
      signal: AbortSignal.timeout(30000),
    })
    if (response.status === 304 && cached) {
      const items = cached.items as T[]
      all.push(...items)
      if (stopAfterPage?.(items)) break
      url = cached.next
      continue
    }
    // GitHub represents a repository with no commits as 409.
    if (response.status === 409 && new URL(url).pathname.endsWith('/commits')) break
    if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`)
    const items = (await response.json()) as T[]
    const next = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1] ?? ''
    githubCache[url] = { etag: response.headers.get('etag') || '', next, items }
    all.push(...items)
    if (stopAfterPage?.(items)) break
    url = next
  }
  return all
}

async function saveGithubCache() {
  await mkdir('.data', { recursive: true })
  await Bun.write('.data/github-http.json', JSON.stringify(githubCache))
}

function githubItems(repos: GithubRepo[], commitsByRepo: Map<string, GithubCommit[]>) {
  const items: SourceItem[] = []
  for (const repo of repos) {
    for (const commit of commitsByRepo.get(repo.full_name) ?? []) {
      const item = githubItem(repo, commit)
      if (item) items.push(item)
    }
  }
  return items
}

async function syncGithub(full: boolean) {
  if (!process.env.GITHUB_TOKEN) throw new Error('Set GITHUB_TOKEN')
  const state = await getSourceState('github')
  if (full || !state.finishedAt || state.existing.size === 0) {
    const repos = await githubPages<GithubRepo>(
      'https://api.github.com/user/repos?sort=pushed&per_page=100',
      !full
    )
    const publicRepos = repos.filter((repo) => !repo.private)
    const commitsByRepo = new Map<string, GithubCommit[]>()
    for (const repo of publicRepos) {
      const url = new URL(repo.commits_url.replace(/\{.*\}/, ''))
      url.searchParams.set('per_page', '100')
      if (repo.name === 'mdn-content') url.searchParams.set('author', 'ohnsh')
      commitsByRepo.set(repo.full_name, await githubPages<GithubCommit>(url.href, !full))
    }
    await replaceSource('github', githubItems(publicRepos, commitsByRepo))
    await saveGithubCache()
    return
  }

  const cutoffMs = Date.parse(state.finishedAt) - 60000
  const since = new Date(cutoffMs).toISOString()
  const repos = await githubPages<GithubRepo>(
    'https://api.github.com/user/repos?sort=pushed&per_page=100',
    false,
    (page) => page.some((repo) => repo.pushed_at && Date.parse(repo.pushed_at) < cutoffMs)
  )
  const recentRepos = repos.filter(
    (repo) =>
      !repo.private &&
      (!repo.pushed_at || Date.parse(repo.pushed_at) >= cutoffMs)
  )
  const commitsByRepo = new Map<string, GithubCommit[]>()
  for (const repo of recentRepos) {
    const url = new URL(repo.commits_url.replace(/\{.*\}/, ''))
    url.searchParams.set('per_page', '100')
    url.searchParams.set('since', since)
    if (repo.name === 'mdn-content') url.searchParams.set('author', 'ohnsh')
    commitsByRepo.set(repo.full_name, await githubPages<GithubCommit>(url.href, false))
  }
  await upsertSource('github', githubItems(recentRepos, commitsByRepo))
  await saveGithubCache()
}

async function youtubeApi<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://youtube.googleapis.com/youtube/v3/${path}`)
  url.search = new URLSearchParams({ ...params, key: process.env.YT_API_KEY! }).toString()
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`YouTube: HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function playlistPage(id: string, token = '') {
  return youtubeApi<{ items: YoutubeItem[]; nextPageToken?: string }>('playlistItems', {
    playlistId: id,
    part: 'snippet',
    maxResults: '50',
    ...(token ? { pageToken: token } : {}),
  })
}

async function playlist(id: string) {
  let token = ''
  const items: YoutubeItem[] = []
  do {
    const page = await playlistPage(id, token)
    items.push(...page.items)
    token = page.nextPageToken ?? ''
  } while (token)
  return items
}

async function youtubeChannelUploads() {
  const channel = await youtubeApi<{
    items: { contentDetails: { relatedPlaylists: { uploads: string } } }[]
  }>('channels', { part: 'contentDetails', forHandle: 'ohn-sh' })
  const uploads = channel.items[0]?.contentDetails.relatedPlaylists.uploads
  if (!uploads) throw new Error('YouTube: uploads playlist not found')
  return uploads
}

async function syncYoutube(full: boolean) {
  if (!process.env.YT_API_KEY) throw new Error('Set YT_API_KEY')
  const state = await getSourceState('youtube')
  const uploadsId = await youtubeChannelUploads()
  const shortsId = uploadsId.replace(/^UU/, 'UUSH')

  if (full || !state.finishedAt || state.existing.size === 0) {
    const [uploads, shorts] = await Promise.all([playlist(uploadsId), playlist(shortsId)])
    const shortIds = new Set(shorts.map((video) => video.snippet.resourceId.videoId))
    await replaceSource(
      'youtube',
      uploads.map((video) => youtubeItem(video, shortIds)).filter((item): item is SourceItem => item !== null)
    )
    return
  }

  const newUploads: YoutubeItem[] = []
  let token = ''
  let foundKnown = false
  do {
    const page = await playlistPage(uploadsId, token)
    for (const video of page.items) {
      const id = `youtube:${video.snippet.resourceId.videoId}`
      if (state.existing.has(id)) {
        foundKnown = true
        break
      }
      newUploads.push(video)
    }
    if (foundKnown) break
    token = page.nextPageToken ?? ''
  } while (token)

  if (newUploads.length === 0) {
    await upsertSource('youtube', [])
    return
  }

  const pendingShortIds = new Set(newUploads.map((video) => video.snippet.resourceId.videoId))
  const oldestNewUpload = Math.min(...newUploads.map((video) => Date.parse(video.snippet.publishedAt)))
  const shortIds = new Set<string>()
  token = ''
  let shortsDone = false
  do {
    const page = await playlistPage(shortsId, token)
    for (const video of page.items) {
      const id = video.snippet.resourceId.videoId
      if (pendingShortIds.has(id)) {
        shortIds.add(id)
        pendingShortIds.delete(id)
      }
      const publishedAt = Date.parse(video.snippet.publishedAt)
      if (Number.isFinite(publishedAt) && publishedAt < oldestNewUpload) {
        shortsDone = true
        break
      }
    }
    if (pendingShortIds.size === 0 || shortsDone) break
    token = page.nextPageToken ?? ''
  } while (token)

  const items = newUploads
    .map((video) => youtubeItem(video, shortIds))
    .filter((item): item is SourceItem => item !== null)
  await upsertSource('youtube', items)
}

const args = process.argv.slice(2)
const full = args.includes('--full')
const targets = args.filter((arg) => arg !== '--full')
if (targets.length > 1 || (targets[0] && !['all', 'github', 'youtube'].includes(targets[0])))
  throw new Error('Expected optional target all, github, or youtube, and optional --full')
const source = targets[0] || 'all'
if (source !== 'youtube') await syncGithub(full)
if (source !== 'github') await syncYoutube(full)
