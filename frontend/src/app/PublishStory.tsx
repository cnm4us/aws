import React, { useEffect, useMemo, useState } from 'react'

function parsePublicationId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('publication')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseFromHref(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('from')
    if (!raw) return null
    const s = String(raw)
    if (!s.startsWith('/')) return null
    if (s.startsWith('//')) return null
    return s
  } catch {
    return null
  }
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export default function PublishStoryPage() {
  const publicationId = useMemo(() => parsePublicationId(), [])
  const fromHref = useMemo(() => parseFromHref(), [])
  const backHref = fromHref || '/publish'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!publicationId) {
      setError('Missing publication id.')
      setLoading(false)
      return
    }
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/publications/${publicationId}/story`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to load story')
        const storyText = typeof data?.storyText === 'string' ? String(data.storyText) : ''
        if (!cancelled) setText(storyText)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load story')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [publicationId])

  const remaining = 2000 - text.length

  const save = async (nextText: string) => {
    if (!publicationId) return
    setSaving(true)
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/publications/${publicationId}/story`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ storyText: nextText }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to save story')
      window.location.href = backHref
    } catch (err: any) {
      setError(err?.message || 'Failed to save story')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#fff', background: '#050505', minHeight: '100vh' }}>
        <h1>Story</h1>
        <p style={{ color: '#888' }}>Loading…</p>
      </div>
    )
  }

  if (!publicationId) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#fff', background: '#050505', minHeight: '100vh' }}>
        <h1>Story</h1>
        <p style={{ color: '#ff6b6b' }}>Missing publication id.</p>
        <p><a href={backHref} style={{ color: '#0a84ff' }}>Back</a></p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 80px' }}>
        <header style={{ marginBottom: 16 }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 4px', fontSize: 28 }}>Story</h1>
          <div style={{ color: '#888', fontSize: 13 }}>Publication #{publicationId} • {remaining} chars remaining</div>
        </header>

        {error ? (
          <div style={{ margin: '0 0 14px 0', padding: '10px 14px', borderRadius: 12, background: '#2a1010', color: '#ff9b9b' }}>
            {error}
          </div>
        ) : null}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your story…"
          rows={12}
          style={{
            width: '100%',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            padding: '12px 12px',
            resize: 'vertical',
            fontSize: 15,
            lineHeight: 1.35,
            outline: 'none',
            whiteSpace: 'pre-wrap',
          }}
        />

        <div style={{ marginTop: 14, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            disabled={saving}
            onClick={() => save('')}
            style={{
              background: 'transparent',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 10,
              padding: '10px 16px',
              fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            Clear
          </button>
          <button
            disabled={saving || text.length > 2000}
            onClick={() => save(text)}
            style={{
              background: '#0a84ff',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '10px 18px',
              fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
              opacity: saving || text.length > 2000 ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

