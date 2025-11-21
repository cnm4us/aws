import React, { useEffect, useState } from 'react'

type Topic = 'about' | 'groups' | 'channels' | 'moderation'

function normalizeTopicFromPath(pathname: string): Topic {
  try {
    const m = pathname.match(/^\/help\/(?:([^/]+))\/?$/)
    if (!m) return 'about'
    const slug = (m[1] || '').toLowerCase()
    if (slug === 'about' || slug === 'about-us') return 'about'
    if (slug === 'groups') return 'groups'
    if (slug === 'channels') return 'channels'
    if (slug === 'moderation') return 'moderation'
    return 'about'
  } catch {
    return 'about'
  }
}

function topicToPath(t: Topic): string {
  if (t === 'about') return '/help/about'
  return `/help/${t}`
}

function HelpContent({ topic }: { topic: Topic }) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    setLoading(true)
    setError(null)
    setHtml(null)
    const file = `/help/${topic}.html`
    ;(async () => {
      try {
        const res = await fetch(file)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const txt = await res.text()
        if (!canceled) setHtml(txt)
      } catch (err: any) {
        if (!canceled) setError(err?.message ? String(err.message) : 'failed_to_load_help')
      } finally {
        if (!canceled) setLoading(false)
      }
    })()
    return () => { canceled = true }
  }, [topic])

  if (loading && !html) {
    return <div style={{ padding: 20, color: '#000' }}>Loading help…</div>
  }
  if (error) {
    return <div style={{ padding: 20, color: '#000' }}>Unable to load this help topic.</div>
  }
  if (!html) {
    return null
  }
  return (
    <div
      className="helpContent"
      style={{ padding: 20, maxWidth: 840, margin: '0 auto', color: '#000', lineHeight: 1.6 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default function Help() {
  const [topic, setTopic] = useState<Topic>(() => {
    try {
      return normalizeTopicFromPath(window.location.pathname || '/help')
    } catch {
      return 'about'
    }
  })

  useEffect(() => {
    const handler = () => {
      try {
        const next = normalizeTopicFromPath(window.location.pathname || '/help')
        setTopic(next)
      } catch {}
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  return (
    <div style={{ minHeight: '100%', background: '#f7f7f7', padding: '16px 0 32px 0' }}>
      <main style={{ flex: '1 1 auto', maxWidth: 900, margin: '0 auto' }}>
        <HelpContent topic={topic} />
      </main>
    </div>
  )
}
