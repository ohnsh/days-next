import { createRemoteJWKSet, jwtVerify } from 'jose'

export async function adminIdentity(request: Request, issuer: string, audience: string) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token || !issuer || !audience) return null
  try {
    const url = new URL(issuer)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.cloudflareaccess.com')) return null
    const keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer))
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'email'],
    })
    return typeof payload.sub === 'string' && typeof payload.email === 'string'
      ? { id: payload.sub, email: payload.email }
      : null
  } catch {
    return null
  }
}
