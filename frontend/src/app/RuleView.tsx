import React, { useEffect, useMemo, useState } from 'react'

type RuleVersionMeta = {
  version: number
  url: string
  createdAt: string | null
  changeSummary?: string
}

type RuleResponse = {
  slug: string
  title: string
  html: string
  shortDescription?: string
  allowedExamplesHtml?: string
  disallowedExamplesHtml?: string
  guidanceHtml?: string
  visibility: string
  currentVersion: RuleVersionMeta
  versions: RuleVersionMeta[]
}

function normalizeSlugFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/rules/')) return null
  const raw = pathname.slice('/rules/'.length).replace(/^\/+|\/+$/g, '')
  if (!raw) return null
  try { return decodeURIComponent(raw) } catch { return raw }
}

export default function RuleView() {
  const slug = useMemo(() => normalizeSlugFromPath(window.location.pathname || ''), [])
  const [data, setData] = useState<RuleResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        if (!slug) throw new Error('bad_slug')
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/rules/${encodeURIComponent(slug)}`, { credentials: 'same-origin' })
        if (!res.ok) {
          let body: any = null
          try { body = await res.json() } catch {}
          const code = body?.error || `http_${res.status}`
          throw new Error(code)
        }
        const json = (await res.json()) as RuleResponse
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
      error === 'unauthorized' ? 'Please log in to view this rule.' :
      error === 'forbidden' ? 'You do not have access to this rule.' :
      error === 'rule_not_found' ? 'Rule not found.' :
      error === 'bad_slug' ? 'Bad rule slug.' :
      'Unable to load rule.'
    return <div style={{ padding: 20, color: '#fff', opacity: 0.9 }}>{msg}</div>
  }

  if (!data) {
    return <div style={{ padding: 20, color: '#fff', opacity: 0.9 }}>Unable to load rule.</div>
  }

  const current = data.currentVersion
  const versions = Array.isArray(data.versions) ? data.versions : []

  return (
    <div style={{ minHeight: '100%', background: '#000', padding: '16px 0 32px 0' }}>
      <main style={{ flex: '1 1 auto', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ padding: '14px 20px 0 20px', maxWidth: 840, margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 8px 0', fontSize: 22, color: '#fff' }}>{data.title || data.slug}</h1>
          {data.shortDescription ? (
            <div style={{ marginBottom: 10, opacity: 0.9, color: '#fff' }}>{data.shortDescription}</div>
          ) : null}
        </div>
        <div style={{ padding: '0 20px 6px 20px', maxWidth: 840, margin: '0 auto', opacity: 0.85, fontSize: 13 }}>
          <div>
            Current version v{current?.version ?? '–'}{' '}
            {current?.url ? (
              <a href={current.url} style={{ color: '#9cf' }}>(permalink)</a>
            ) : null}
          </div>
          {current?.changeSummary ? <div style={{ marginTop: 4, opacity: 0.85 }}>{current.changeSummary}</div> : null}
          {versions.length > 1 ? (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', color: '#9cf' }}>Versions</summary>
              <ul style={{ margin: '8px 0 0 0', paddingLeft: 18, lineHeight: 1.55 }}>
                {versions.map((v) => (
                  <li key={v.version}>
                    <a href={v.url} style={{ color: '#9cf' }}>v{v.version}</a>
                    {v.changeSummary ? <span style={{ opacity: 0.75 }}> — {v.changeSummary}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <div
          style={{ padding: 20, maxWidth: 840, margin: '0 auto', color: '#fff', lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: data.html }}
        />
        {data.allowedExamplesHtml ? (
          <div style={{ padding: '0 20px 20px 20px', maxWidth: 840, margin: '0 auto', color: '#fff', lineHeight: 1.6 }}>
            <h2 style={{ margin: '18px 0 10px 0', fontSize: 18 }}>Allowed Examples</h2>
            <div dangerouslySetInnerHTML={{ __html: data.allowedExamplesHtml }} />
          </div>
        ) : null}
        {data.disallowedExamplesHtml ? (
          <div style={{ padding: '0 20px 20px 20px', maxWidth: 840, margin: '0 auto', color: '#fff', lineHeight: 1.6 }}>
            <h2 style={{ margin: '18px 0 10px 0', fontSize: 18 }}>Disallowed Examples</h2>
            <div dangerouslySetInnerHTML={{ __html: data.disallowedExamplesHtml }} />
          </div>
        ) : null}
        {data.guidanceHtml ? (
          <div style={{ padding: '0 20px 20px 20px', maxWidth: 840, margin: '0 auto', color: '#fff', lineHeight: 1.6, opacity: 0.95 }}>
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', color: '#9cf' }}>Guidance (moderators only)</summary>
              <div style={{ marginTop: 10 }} dangerouslySetInnerHTML={{ __html: data.guidanceHtml }} />
            </details>
          </div>
        ) : null}
      </main>
    </div>
  )
}
