import React, { useEffect, useState } from 'react'
import debug from '../debug'
import { getHelpDoc, isHelpLoaded, preloadHelpDocs } from '../help/helpDocs'

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

function HelpContent({ topic, ready }: { topic: Topic; ready: boolean }) {
  const key = `${topic}.html`
  const html = ready ? getHelpDoc(key) : null
  try {
    debug.log(
      'render',
      'HelpContent resolve',
      { topic, key, ready, hasHtml: !!html },
      { ctx: 'help' }
    )
  } catch {}
  if (!ready) {
    return <div style={{ padding: 20, color: '#000' }}>Loading help…</div>
  }
  if (!html) {
    return <div style={{ padding: 20, color: '#000' }}>Unable to load this help topic.</div>
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
      const initial = normalizeTopicFromPath(window.location.pathname || '/help')
      try {
        debug.log('render', 'Help initial topic', { path: window.location.pathname, topic: initial }, { ctx: 'help' })
      } catch {}
      return initial
    } catch {
      return 'about'
    }
  })

  useEffect(() => {
    try {
      debug.log('render', 'Help mount', { path: window.location.pathname, loaded: isHelpLoaded() }, { ctx: 'help' })
    } catch {}
    const handler = () => {
      try {
        const next = normalizeTopicFromPath(window.location.pathname || '/help')
        try {
          debug.log('render', 'Help popstate', { path: window.location.pathname, topic: next }, { ctx: 'help' })
        } catch {}
        setTopic(next)
      } catch {}
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const [ready, setReady] = useState(() => isHelpLoaded())
  useEffect(() => {
    try {
      debug.log('render', 'Help ready effect', { loaded: isHelpLoaded(), readyInitial: ready }, { ctx: 'help' })
    } catch {}
    if (isHelpLoaded()) {
      // Ensure local state aligns with global loaded flag
      if (!ready) setReady(true)
      return
    }
    let canceled = false
    ;(async () => {
      try {
        debug.log('render', 'Help preload start', undefined, { ctx: 'help' })
        await preloadHelpDocs()
        debug.log('render', 'Help preload done', { loaded: isHelpLoaded() }, { ctx: 'help' })
      } catch {}
      if (!canceled) setReady(true)
    })()
    return () => { canceled = true }
  }, [ready])

  return (
    <div style={{ minHeight: '100%', background: '#f7f7f7', padding: '16px 0 32px 0' }}>
      <main style={{ flex: '1 1 auto', maxWidth: 900, margin: '0 auto' }}>
        <HelpContent topic={topic} ready={ready} />
      </main>
    </div>
  )
}
