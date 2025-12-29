import React, { Suspense } from 'react'
import './styles/variables.css'
import './styles/base.css'
import './styles/buttons.css'
import { createRoot } from 'react-dom/client'
import { SpaceAdminPlaceholder } from './app/Placeholders'
import SpaceMembersPage from './app/SpaceMembers'
import SpaceSettingsPage from './app/SpaceSettings'
import SpaceModerationPage from './app/SpaceModeration'
import SpaceReviewGroupsPage from './app/SpaceReviewGroups'
import SpaceReviewChannelsPage from './app/SpaceReviewChannels'

const root = createRoot(document.getElementById('root')!)

function normPath(p: string): string {
  const s = String(p || '').trim()
  if (!s) return '/'
  return s.length > 1 ? s.replace(/\/+$/, '') : s
}

function SpaceConsoleShell(props: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#000', color: '#fff', padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <a className="btn" href="/" style={{ textDecoration: 'none' }}>Feed</a>
        <a className="btn" href="/space/admin" style={{ textDecoration: 'none' }}>Space Admin</a>
        <a className="btn" href="/space/moderation" style={{ textDecoration: 'none' }}>Moderation</a>
      </div>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>{props.title}</h1>
      {props.children}
    </div>
  )
}

function SpaceAdminLanding() {
  return (
    <SpaceConsoleShell title="Space Admin">
      <div style={{ opacity: 0.85, marginBottom: 14 }}>Manage spaces where you are a space_admin.</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <a className="btn" href="/space/admin/groups">Group Admin</a>
        <a className="btn" href="/space/admin/channels">Channel Admin</a>
      </div>
      <div style={{ marginTop: 16, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: 12, background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Review</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a className="btn" href="/space/review/groups">Review Groups</a>
          <a className="btn" href="/space/review/channels">Review Channels</a>
        </div>
      </div>
      <div style={{ marginTop: 16, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: 12, background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Moderation</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a className="btn" href="/space/moderation/groups">Moderate Groups</a>
          <a className="btn" href="/space/moderation/channels">Moderate Channels</a>
        </div>
        <div style={{ opacity: 0.75, marginTop: 10, fontSize: 13 }}>Coming soon: flags/reports, analytics, and triage tools.</div>
      </div>
    </SpaceConsoleShell>
  )
}

function SpaceModerationLanding() {
  return (
    <SpaceConsoleShell title="Space Moderation">
      <div style={{ opacity: 0.85, marginBottom: 14 }}>Post-publish moderation (flags/reports) and analytics.</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <a className="btn" href="/space/moderation/groups">Moderate Groups</a>
        <a className="btn" href="/space/moderation/channels">Moderate Channels</a>
      </div>
      <div style={{ marginTop: 16, opacity: 0.75, fontSize: 13 }}>
        Coming soon: inbox, severity/tolerance summaries, reviewer performance, and per-space controls.
      </div>
    </SpaceConsoleShell>
  )
}

function ComingSoon(props: { title: string; body?: string; backHref?: string }) {
  return (
    <SpaceConsoleShell title={props.title}>
      <div style={{ opacity: 0.85, marginBottom: 14 }}>{props.body || 'Coming soon.'}</div>
      {props.backHref ? <a className="btn" href={props.backHref}>Back</a> : null}
    </SpaceConsoleShell>
  )
}

function SpaceConsoleRoot() {
  const p = normPath(typeof window !== 'undefined' ? window.location.pathname : '/')

  if (p === '/space/admin') return <SpaceAdminLanding />
  if (p === '/space/moderation') return <SpaceModerationLanding />

  if (p === '/space/admin/groups') return <ComingSoon title="Group Admin" body="Group admin console is coming soon." backHref="/space/admin" />
  if (p === '/space/admin/channels') return <ComingSoon title="Channel Admin" body="Channel admin console is coming soon." backHref="/space/admin" />

  if (p === '/space/moderation/groups') return <ComingSoon title="Moderate Groups" body="Group moderation console is coming soon." backHref="/space/moderation" />
  if (p === '/space/moderation/channels') return <ComingSoon title="Moderate Channels" body="Channel moderation console is coming soon." backHref="/space/moderation" />

  if (p === '/space/review/groups') {
    return (
      <Suspense fallback={<ComingSoon title="Review Groups" body="Loading…" backHref="/space/admin" />}>
        <SpaceReviewGroupsPage />
      </Suspense>
    )
  }
  if (p === '/space/review/channels') {
    return (
      <Suspense fallback={<ComingSoon title="Review Channels" body="Loading…" backHref="/space/admin" />}>
        <SpaceReviewChannelsPage />
      </Suspense>
    )
  }

  // Per-space admin routes
  if (/^\/spaces\/\d+\/admin(?:\/members)?$/.test(p)) return <SpaceMembersPage />
  if (/^\/spaces\/\d+\/admin\/settings$/.test(p)) return <SpaceSettingsPage />
  if (/^\/spaces\/\d+\/review$/.test(p)) return <SpaceModerationPage />
  if (/^\/spaces\/\d+\/admin\/users\/\d+$/.test(p)) return <SpaceAdminPlaceholder />

  return <ComingSoon title="Space Console" body={`Unknown space console route: ${p}`} backHref="/space/admin" />
}

root.render(<SpaceConsoleRoot />)
