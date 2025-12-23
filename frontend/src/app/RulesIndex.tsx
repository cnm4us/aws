import React, { useEffect, useState } from 'react'

type RuleItem = {
  slug: string
  title: string
  visibility: string
  url: string
  currentVersion: { version: number; url: string; createdAt: string | null; changeSummary?: string }
}

type RulesIndexResponse = {
  items: RuleItem[]
}

export default function RulesIndex() {
  const [items, setItems] = useState<RuleItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/rules', { credentials: 'same-origin' })
        if (!res.ok) {
          let body: any = null
          try { body = await res.json() } catch {}
          const code = body?.error || `http_${res.status}`
          throw new Error(code)
        }
        const json = (await res.json()) as RulesIndexResponse
        if (!canceled) setItems(Array.isArray(json?.items) ? json.items : [])
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
    return <div style={{ padding: 20, color: '#fff', opacity: 0.9 }}>Unable to load rules.</div>
  }

  return (
    <div style={{ minHeight: '100%', background: '#000', padding: '16px 0 32px 0' }}>
      <main style={{ flex: '1 1 auto', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ padding: 20, maxWidth: 840, margin: '0 auto' }}>
          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>Rules</div>
          {items.length === 0 ? (
            <div style={{ opacity: 0.85 }}>No rules found.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              {items.map((r) => (
                <li key={r.slug} style={{ marginBottom: 8 }}>
                  <a href={r.url} style={{ color: '#9cf' }}>{r.title || r.slug}</a>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    v{r.currentVersion?.version ?? '–'}{' '}
                    {r.currentVersion?.changeSummary ? `— ${r.currentVersion.changeSummary}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}

