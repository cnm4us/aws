import React, { useMemo } from 'react'

type Mode = 'manage' | 'pick'

type AssetType = {
  key: string
  label: string
  description: string
  href: string
}

function parseMode(): Mode {
  try {
    const qs = new URLSearchParams(window.location.search)
    const raw = String(qs.get('mode') || '').trim().toLowerCase()
    return raw === 'pick' ? 'pick' : 'manage'
  } catch {
    return 'manage'
  }
}

function withParams(href: string, extra: Record<string, string>): string {
  try {
    const u = new URL(href, window.location.origin)
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
    return u.pathname + (u.search ? u.search : '')
  } catch {
    return href
  }
}

export default function Assets() {
  const mode = useMemo(() => parseMode(), [])

  const passthrough = useMemo(() => {
    try {
      const qs = new URLSearchParams(window.location.search)
      const out: Record<string, string> = {}
      const project = qs.get('project')
      const ret = qs.get('return')
      if (mode === 'pick') {
        if (project) out.project = String(project)
        if (ret) out.return = String(ret)
        out.mode = 'pick'
      }
      return out
    } catch {
      return mode === 'pick' ? { mode: 'pick' } : {}
    }
  }, [mode])

  const types: AssetType[] = useMemo(() => {
    const base: AssetType[] = [
      { key: 'video', label: 'Videos', description: 'Raw uploaded videos (source clips).', href: '/assets/video' },
      { key: 'graphic', label: 'Graphics', description: 'Full-screen images for overlays and cutaways.', href: '/assets/graphic' },
      { key: 'logo', label: 'Logos', description: 'Watermark logos to place above everything.', href: '/assets/logo' },
      { key: 'lower_third', label: 'Lower Thirds', description: 'Lower third images and configs.', href: '/assets/lower-third' },
      { key: 'screen_title', label: 'Screen Titles', description: 'Screen title styles and presets.', href: '/assets/screen-titles' },
      { key: 'narration', label: 'Narration', description: 'Voice clips for narration track.', href: '/assets/narration' },
      { key: 'audio', label: 'Audio/Music', description: 'System + user music tracks.', href: '/assets/audio' },
    ]
    return base.map((t) => ({ ...t, href: Object.keys(passthrough).length ? withParams(t.href, passthrough) : t.href }))
  }, [passthrough])

  const headerRight = useMemo(() => {
    if (mode === 'pick') {
      const ret = passthrough.return
      return ret ? (
        <a href={ret} style={{ color: '#0a84ff', textDecoration: 'none' }}>
          ← Back to Timeline
        </a>
      ) : null
    }
    return (
      <a href="/timelines" style={{ color: '#0a84ff', textDecoration: 'none' }}>
        Timelines
      </a>
    )
  }, [mode, passthrough.return])

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/create-video" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Create Video
          </a>
          {headerRight}
        </div>

        <h1 style={{ margin: '12px 0 10px', fontSize: 28 }}>Assets</h1>
        <p style={{ margin: 0, color: '#bbb' }}>
          {mode === 'pick' ? 'Select an asset type to add to your timeline.' : 'Browse and manage your assets.'}
        </p>

        <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
          {types.map((t) => (
            <a
              key={t.key}
              href={t.href}
              style={{
                display: 'block',
                textDecoration: 'none',
                color: '#fff',
                borderRadius: 16,
                border: '1px solid rgba(212,175,55,0.55)',
                background: 'rgba(255,255,255,0.03)',
                padding: 14,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{t.label}</div>
                <div style={{ color: '#d4af37', fontWeight: 900 }}>→</div>
              </div>
              <div style={{ marginTop: 6, color: '#bbb', lineHeight: 1.35 }}>{t.description}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

