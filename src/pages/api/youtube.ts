import type { APIRoute } from 'astro'
import { daysDatabase } from '../../server/runtime'
import { handleYoutubeRequest } from '../../server/youtube'

export const ALL: APIRoute = ({ request, cache }) =>
  handleYoutubeRequest(request, daysDatabase, cache)
