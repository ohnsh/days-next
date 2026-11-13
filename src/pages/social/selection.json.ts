import type { APIRoute } from 'astro'
import { parseSocialSelection } from '../../lib/social'
import { resolveSocialSelection, SocialSelectionError } from '../../server/social'

/** Resolve against the same public deployed data that Browser Run will render. */
export const GET: APIRoute = async ({ url, cache }) => {
  cache.set(false)
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
  try {
    let input
    try {
      input = parseSocialSelection(url.searchParams)
    } catch (error) {
      throw new SocialSelectionError(String(error))
    }
    const selection = await resolveSocialSelection(input)
    return Response.json(
      { request: selection.request, affectedDays: selection.affectedDays },
      { headers }
    )
  } catch (error) {
    const known = error instanceof SocialSelectionError
    if (!known)
      console.error(
        JSON.stringify({ event: 'social-selection-error', message: String(error) })
      )
    return Response.json(
      { error: known ? error.message : 'Selection temporarily unavailable' },
      { status: known ? error.status : 503, headers }
    )
  }
}
