// DSH loads Hello '84 in the Web client.
// Optional zero-dependency server proxy route for CORS-restricted OpenAI-compatible endpoints.
export const name = 'dsh-hello84'

export function apply(ctx) {
  const server = ctx?.server
  if (!server || typeof server.post !== 'function') return
  try {
    server.post('/hello84/proxy', async (req, res) => {
      try {
        const body = req?.body ?? {}
        const target = typeof body.url === 'string' ? body.url.trim() : ''
        if (!/^https?:\/\//i.test(target)) {
          res?.status?.(400)?.json?.({ error: 'Invalid target URL' })
          return
        }
        const upstream = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(body.authorization ? { Authorization: String(body.authorization) } : {}),
          },
          body: JSON.stringify(body.payload ?? {}),
        })
        const text = await upstream.text()
        res?.status?.(upstream.status)
        if (typeof res?.setHeader === 'function') {
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
        }
        if (typeof res?.send === 'function') res.send(text)
      } catch (error) {
        res?.status?.(502)?.json?.({ error: String(error?.message || error) })
      }
    })
  } catch {
    // Host Cordis server does not expose Express-style routes; client falls back to direct fetch.
  }
}
