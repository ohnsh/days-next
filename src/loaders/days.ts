import type { LiveLoader } from 'astro/loaders'
import type { Day } from '../lib/types'
import { getDay, getDays } from '../server/days'

export function daysLoader(): LiveLoader<
  Day,
  { id: string },
  { before?: string; limit?: number }
> {
  return {
    name: 'days-database',
    async loadEntry({ filter }) {
      const data = await getDay(filter.id)
      return { id: data.day, data, cacheHint: { tags: [`day:${data.day}`] } }
    },
    async loadCollection({ filter }) {
      const days = await getDays(filter?.before, filter?.limit)
      return {
        entries: days.map((data) => ({
          id: data.day,
          data,
          cacheHint: { tags: [`day:${data.day}`] },
        })),
      }
    },
  }
}
