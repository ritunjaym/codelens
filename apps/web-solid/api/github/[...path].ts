import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cookie = req.cookies?.gh_session
  if (!cookie) return res.status(401).json({ error: 'Unauthorized' })

  const { accessToken } = JSON.parse(Buffer.from(cookie, 'base64').toString())
  const rawPath = req.query.path
  const path = Array.isArray(rawPath) ? rawPath.join('/') : rawPath ?? ''
  const query = new URL(req.url!, 'http://localhost').search

  const ghRes = await fetch(`https://api.github.com/${path}${query}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'If-None-Match': '',
      'If-Modified-Since': '',
      ...(req.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(req.body ? { body: JSON.stringify(req.body) } : {}),
  })

  const rl = ghRes.headers.get('x-ratelimit-remaining')
  if (rl) res.setHeader('x-ratelimit-remaining', rl)
  const rll = ghRes.headers.get('x-ratelimit-limit')
  if (rll) res.setHeader('x-ratelimit-limit', rll)
  const rlr = ghRes.headers.get('x-ratelimit-reset')
  if (rlr) res.setHeader('x-ratelimit-reset', rlr)

  if (ghRes.status === 304 || ghRes.status === 204) {
    return res.status(ghRes.status).end()
  }
  const text = await ghRes.text()
  try {
    res.status(ghRes.status).json(JSON.parse(text))
  } catch {
    res.status(ghRes.status).send(text)
  }
}
