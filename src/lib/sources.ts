import { dayFromInstant, plainDay } from './dates'
import type { SourceItem } from './types'

export interface GithubRepo {
  name: string
  full_name: string
  private: boolean
  commits_url: string
}
export interface GithubCommit {
  sha: string
  html_url: string
  commit: { message: string; author: { name: string; email: string; date: string } | null }
}
export interface YoutubeItem {
  id: string
  snippet: {
    title: string
    description: string
    publishedAt: string
    resourceId: { videoId: string }
    thumbnails?: Record<string, { url: string }>
  }
}
export function isMyCommit(commit: GithubCommit) {
  const author = commit.commit.author
  if (!author) return false
  return (
    ['jonathan sherrell', 'john sherrell'].includes(author.name.toLowerCase()) ||
    ['ohn.sh', 'jom.sh', 'jomsh.cc'].includes(author.email.split('@')[1])
  )
}
export function githubItem(repo: GithubRepo, commit: GithubCommit): SourceItem | null {
  if (repo.private || !isMyCommit(commit) || !commit.commit.author) return null
  return {
    id: `github:${repo.full_name}:${commit.sha}`,
    source: 'github',
    day: dayFromInstant(commit.commit.author.date),
    occurredAt: commit.commit.author.date,
    title: commit.commit.message.split('\n')[0],
    description: commit.commit.message,
    url: commit.html_url,
    group: repo.full_name,
    tags: [],
  }
}
const months = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
export function youtubeDay(title: string, publishedAt: string) {
  const publishedDay = dayFromInstant(publishedAt)
  const numeric = /\b(?<month>\d{1,2})\/(?<day>\d{1,2})(?:\/(?<year>\d{4}))?\b/.exec(title)
  const named = new RegExp(
    `\\b(?<month>${months.map((m) => `${m}|${m.slice(0, 3)}`).join('|')})\\.? (?<day>\\d{1,2})\\b(?:,? (?<year>\\d{4}))?`,
    'i'
  ).exec(title)
  const match = numeric ?? named
  if (!match?.groups) return publishedDay
  const month = numeric
    ? Number(match.groups.month)
    : months.findIndex((m) => m.startsWith(match.groups!.month.toLowerCase())) + 1
  const year = Number(publishedDay.slice(0, 4))
  const years = match.groups.year ? [Number(match.groups.year)] : [year - 1, year, year + 1]
  const candidates = years.flatMap((y) => {
    try {
      return [
        plainDay(`${y}-${String(month).padStart(2, '0')}-${match.groups!.day.padStart(2, '0')}`),
      ]
    } catch {
      return []
    }
  })
  return (
    candidates.sort(
      (a, b) =>
        Math.abs(Date.parse(a) - Date.parse(publishedDay)) -
        Math.abs(Date.parse(b) - Date.parse(publishedDay))
    )[0] ?? publishedDay
  )
}
export function youtubeTags(title: string, description: string) {
  const tags = new Set<string>()
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(title)) {
    if (/\p{Emoji}/u.test(segment)) tags.add(segment)
    else break
  }
  for (const tag of description.match(/^Tags: (.+)$/im)?.[1].split(',') ?? []) {
    if (tag.trim()) tags.add(tag.trim())
  }
  return [...tags]
}
export function youtubeItem(item: YoutubeItem, shorts: Set<string>): SourceItem | null {
  const s = item.snippet,
    id = s.resourceId.videoId
  if (['Private video', 'Deleted video'].includes(s.title)) return null
  return {
    id: `youtube:${id}`,
    source: 'youtube',
    day: youtubeDay(s.title, s.publishedAt),
    title: s.title,
    description: s.description,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    occurredAt: s.publishedAt,
    group: 'ohn-sh',
    tags: youtubeTags(s.title, s.description),
    thumbnail: (s.thumbnails?.high ?? s.thumbnails?.medium ?? s.thumbnails?.default)?.url,
    isShort: shorts.has(id),
  }
}
