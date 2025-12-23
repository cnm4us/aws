import React, { useEffect, useState } from 'react'

type PageResponse = {
  slug: string
  title: string
  html: string
  visibility: string
  layout: string
  updatedAt: string | null
  children?: Array<{ slug: string; title: string; url: string }>
}

export default function HomePage() {
  const [data, setData] = useState<PageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/pages/home', { credentials: 'same-origin' })
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
  }, [])

  if (loading) {
    return <div style={{ padding: 20, color: '#fff' }}>Loading…</div>
  }

  if (error) {
    const msg =
      error === 'unauthorized' ? 'Please log in to view this page.' :
      error === 'forbidden' ? 'You do not have access to this page.' :
      error === 'page_not_found' ? 'Home page has not been configured yet.' :
      'Unable to load home page.'
    return <div style={{ padding: 20, color: '#fff', opacity: 0.9 }}>{msg}</div>
  }

  if (!data) {
    return <div style={{ padding: 20, color: '#fff', opacity: 0.9 }}>Unable to load home page.</div>
  }

  return (
    <div style={{ minHeight: '100%', background: '#000', padding: '16px 0 32px 0' }}>
      <main style={{ flex: '1 1 auto', maxWidth: 900, margin: '0 auto' }}>
        <div
          style={{ padding: 20, maxWidth: 840, margin: '0 auto', color: '#fff', lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: data.html }}
        />
      </main>
    </div>
  )
}

