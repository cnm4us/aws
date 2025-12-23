import React, { useEffect, useMemo, useState } from 'react'

type PageResponse = {
  slug: string
  title: string
  html: string
  visibility: string
  layout: string
  updatedAt: string | null
  children?: Array<{ slug: string; title: string; url: string }>
}

function normalizeSlugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/pages\/(.+)$/)
  if (!m) return null
  const raw = m[1] || ''
  try {
    // Preserve slashes; only decode percent-escapes.
    return decodeURIComponent(raw).replace(/^\/+|\/+$/g, '')
  } catch {
    return raw.replace(/^\/+|\/+$/g, '')
  }
}

export default function PageView() {
  const slug = useMemo(() => normalizeSlugFromPath(window.location.pathname || ''), [])
  const [data, setData] = useState<PageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        if (!slug) throw new Error('bad_slug')
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/pages/${encodeURIComponent(slug)}`, { credentials: 'same-origin' })
        if (!res.ok) {
          let body: any = null
          try { body = await res.json() } catch {}
          const code = body?.error || `http_${res.status}`
          throw new Error(code)
        }
        const json = (await res.json()) as PageResponse
        if (!canceled) setData(json)
      } catch (e: any) {
        if (!canceled) setError(String(e?.message || e))
      } finally {
        if (!canceled) setLoading(false)
      }
    })()
    return () => { canceled = true }
  }, [slug])

  if (loading) {
    return <div style={{ padding: 20, color: '#fff' }}>Loading…</div>
  }

  if (error) {
    const msg =
      error === 'unauthorized' ? 'Please log in to view this page.' :
      error === 'forbidden' ? 'You do not have access to this page.' :
      error === 'page_not_found' ? 'Page not found.' :
      error === 'bad_slug' ? 'Bad page slug.' :
      'Unable to load page.'
    return <div style={{ padding: 20, color: '#fff', opacity: 0.9 }}>{msg}</div>
  }

  if (!data) {
    return <div style={{ padding: 20, color: '#fff', opacity: 0.9 }}>Unable to load page.</div>
  }

  return (
    <div style={{ minHeight: '100%', background: '#000', padding: '16px 0 32px 0' }}>
      <main style={{ flex: '1 1 auto', maxWidth: 900, margin: '0 auto' }}>
        <div
          style={{ padding: 20, maxWidth: 840, margin: '0 auto', color: '#fff', lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: data.html }}
        />
        {Array.isArray(data.children) && data.children.length ? (
          <div style={{ padding: '0 20px 20px 20px', maxWidth: 840, margin: '0 auto' }}>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>In this section</div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
              {data.children.map((c) => (
                <li key={c.slug}>
                  <a href={c.url} style={{ color: '#9cf' }}>{c.title || c.slug}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </main>
    </div>
  )
}

