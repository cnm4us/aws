import React, { useEffect, useMemo, useState } from 'react'
const CLOSE_CIRCLE_X_ICON_URL = new URL('./icons/close-circle-x.svg', import.meta.url).toString()

function ChevronIcon(props: { direction: 'left' | 'right' | 'down' }) {
  const { direction } = props
  const rotation = direction === 'left' ? '135deg' : direction === 'down' ? '45deg' : '-45deg'
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height: 10,
        borderRight: '2px solid #fff',
        borderBottom: '2px solid #fff',
        transform: `rotate(${rotation})`,
      }}
    />
  )
}

type OptionsRule = {
  id: number
  slug: string
  title: string
  priority?: number
  isDefault?: boolean
}

type OptionsReason = {
  id: number
  label: string
  shortDescription?: string | null
  groupKey?: string | null
  groupLabel?: string | null
  displayOrder?: number
  rules: OptionsRule[]
}

type OptionsGroup = {
  key?: string | null
  label?: string | null
  reasons: OptionsReason[]
}

type OptionsResponse = {
  spacePublicationId: number
  spaceId: number
  reportedByMe: boolean
  myReport?: {
    ruleId: number
    ruleSlug: string | null
    ruleTitle: string | null
    userFacingRuleId?: number | null
    userFacingRuleLabel?: string | null
    userFacingGroupKey?: string | null
    userFacingGroupLabel?: string | null
    reportedStartSeconds?: number | null
    reportedEndSeconds?: number | null
    createdAt: string
  } | null
  groups: OptionsGroup[]
}

type RuleDetailResponse = {
  slug: string
  title: string
  html: string
  shortDescription?: string
  allowedExamplesHtml?: string
  disallowedExamplesHtml?: string
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

export default function ReportModal(props: {
  publicationId: number
  onClose: () => void
  onReported: (publicationId: number) => void
  initialRange?: { startSeconds: number | null; endSeconds: number | null } | null
  onRangeChange?: (publicationId: number, next: { startSeconds: number | null; endSeconds: number | null }) => void
  getCurrentPlaybackSeconds?: (publicationId: number) => number | null
}) {
  const { publicationId, onClose, onReported, initialRange, onRangeChange, getCurrentPlaybackSeconds } = props

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<OptionsResponse | null>(null)

  const [expandedReasonId, setExpandedReasonId] = useState<number | null>(null)

  const [detailSlug, setDetailSlug] = useState<string | null>(null)
  const [detailContext, setDetailContext] = useState<{ userFacingRuleId: number; ruleId: number } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detail, setDetail] = useState<RuleDetailResponse | null>(null)
  const [detailTab, setDetailTab] = useState<'long' | 'allowed' | 'disallowed'>('long')

  const [submitBusyKey, setSubmitBusyKey] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [reportedStartSeconds, setReportedStartSeconds] = useState<number | null>(initialRange?.startSeconds ?? null)
  const [reportedEndSeconds, setReportedEndSeconds] = useState<number | null>(initialRange?.endSeconds ?? null)

  useEffect(() => {
    let canceled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/publications/${publicationId}/reporting/options`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('fetch_failed')
        const data = (await res.json()) as OptionsResponse
        if (canceled) return
        setOptions(data)
        setLoading(false)
      } catch {
        if (!canceled) {
          setError('Failed to load reporting options')
          setLoading(false)
        }
      }
    }
    load()
    return () => { canceled = true }
  }, [publicationId])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    setReportedStartSeconds(initialRange?.startSeconds ?? null)
    setReportedEndSeconds(initialRange?.endSeconds ?? null)
  }, [publicationId, initialRange?.startSeconds, initialRange?.endSeconds])

  function applyReportedRange(nextStart: number | null, nextEnd: number | null) {
    setReportedStartSeconds(nextStart)
    setReportedEndSeconds(nextEnd)
    try { onRangeChange?.(publicationId, { startSeconds: nextStart, endSeconds: nextEnd }) } catch {}
  }

  function captureAtPlayhead(kind: 'start' | 'end') {
    const raw = getCurrentPlaybackSeconds?.(publicationId)
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      setSubmitError('Unable to capture playback time right now.')
      return
    }
    const seconds = Math.max(0, Math.floor(n))
    if (kind === 'start') applyReportedRange(seconds, reportedEndSeconds)
    else applyReportedRange(reportedStartSeconds, seconds)
  }

  const flatRules = useMemo(() => {
    const map = new Map<number, OptionsRule>()
    for (const group of options?.groups || []) {
      for (const reason of group.reasons || []) {
        for (const r of reason.rules || []) {
          map.set(Number(r.id), r)
        }
      }
    }
    return map
  }, [options])

  async function openDetail(slug: string, context: { userFacingRuleId: number; ruleId: number }) {
    setDetailSlug(slug)
    setDetailContext(context)
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    setDetailTab('long')
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(slug)}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('fetch_failed')
      const data = (await res.json()) as RuleDetailResponse
      setDetail(data)
    } catch {
      setDetailError('Failed to load rule details')
    } finally {
      setDetailLoading(false)
    }
  }

  async function submitReport(input: { userFacingRuleId?: number | null; ruleId?: number | null; busyKey: string }) {
    if (submitBusyKey) return
    if (options?.reportedByMe) return
    if (invalidTimeRange) {
      setSubmitError('End time must be greater than or equal to start time.')
      return
    }
    setSubmitBusyKey(input.busyKey)
    setSubmitError(null)
    try {
      const csrf = getCsrfToken()
      const payload: Record<string, any> = {}
      if (input.userFacingRuleId != null) payload.userFacingRuleId = Number(input.userFacingRuleId)
      if (input.ruleId != null) payload.ruleId = Number(input.ruleId)
      if (reportedStartSeconds != null) payload.reported_start_seconds = Number(reportedStartSeconds)
      if (reportedEndSeconds != null) payload.reported_end_seconds = Number(reportedEndSeconds)
      const res = await fetch(`/api/publications/${publicationId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      if (res.status === 409) {
        onReported(publicationId)
        onClose()
        return
      }
      if (!res.ok) throw new Error('submit_failed')
      onReported(publicationId)
      onClose()
    } catch {
      setSubmitError('Failed to submit report')
    } finally {
      setSubmitBusyKey(null)
    }
  }

  const reportedByMe = Boolean(options?.reportedByMe)
  const reportedTitle =
    options?.myReport?.ruleId != null && flatRules.has(Number(options.myReport.ruleId))
      ? flatRules.get(Number(options.myReport.ruleId))?.title || null
      : options?.myReport?.ruleTitle || null
  const hasReasons = Array.isArray(options?.groups) && (options?.groups || []).some((g) => Array.isArray(g.reasons) && g.reasons.length > 0)
  const invalidTimeRange =
    reportedStartSeconds != null &&
    reportedEndSeconds != null &&
    Number(reportedEndSeconds) < Number(reportedStartSeconds)
  const secondaryButtonStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 10,
    fontWeight: 800,
  }
  const primaryButtonStyle: React.CSSProperties = {
    background: 'rgba(96,165,250,0.14)',
    color: '#fff',
    border: '1px solid rgba(96,165,250,0.95)',
    borderRadius: 10,
    fontWeight: 900,
  }

  function formatSecondsLabel(seconds: number | null): string {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--'
    const total = Math.floor(seconds)
    const mm = Math.floor(total / 60)
    const ss = total % 60
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0,0,0,0.5)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '64px 16px 80px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 560,
          width: '100%',
          margin: '0 auto',
          maxHeight: 'calc(100vh - 144px)',
          background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
          color: '#fff',
          border: '1px solid rgba(96,165,250,0.95)',
          borderRadius: 14,
          padding: 16,
          boxSizing: 'border-box',
          overflow: 'hidden',
          boxShadow: 'none',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
        }}
      >
        <div style={{ paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Report</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Let us know if a video, or comment is violating the community guidelines or a group's or channel's cultural norms. Submitting a general complaint is helpful. Drilling down to more sepcific complaints is even more helpful.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close report modal"
            title="Close"
            style={{
              ...secondaryButtonStyle,
              border: 'none',
              color: '#fff',
              width: 40,
              height: 36,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <img
              src={CLOSE_CIRCLE_X_ICON_URL}
              alt=""
              aria-hidden="true"
              style={{ width: 22, height: 22, filter: 'invert(1)' }}
            />
          </button>
        </div>

        <div style={{ overflowY: 'auto', paddingTop: 10 }}>
          {loading ? (
            <div style={{ padding: 16, opacity: 0.85 }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: 16, color: '#ffb3b3' }}>{error}</div>
          ) : detailSlug ? (
            <div style={{ padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <button
                  onClick={() => { setDetailSlug(null); setDetailContext(null); setDetail(null); setDetailError(null) }}
                  aria-label="Back"
                  title="Back"
                  style={{
                    ...secondaryButtonStyle,
                    width: 40,
                    height: 36,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  <ChevronIcon direction="left" />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {detailContext ? (
                    <button
                      type="button"
                      onClick={() => submitReport({
                        userFacingRuleId: detailContext.userFacingRuleId,
                        ruleId: detailContext.ruleId,
                        busyKey: `detail:${detailContext.userFacingRuleId}:${detailContext.ruleId}`,
                      })}
                      disabled={reportedByMe || !!submitBusyKey}
                      style={{
                        ...(reportedByMe || !!submitBusyKey ? { background: '#333', border: '1px solid rgba(255,255,255,0.18)' } : primaryButtonStyle),
                        color: '#fff',
                        borderRadius: 10,
                        padding: '6px 10px',
                        fontSize: 14,
                        fontWeight: 900,
                        cursor: (reportedByMe || !!submitBusyKey) ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {submitBusyKey === `detail:${detailContext.userFacingRuleId}:${detailContext.ruleId}` ? 'Submitting…' : 'Submit'}
                    </button>
                  ) : null}
                </div>
              </div>

              {detailLoading ? (
                <div style={{ padding: 10, opacity: 0.85 }}>Loading rule…</div>
              ) : detailError ? (
                <div style={{ padding: 10, color: '#ffb3b3' }}>{detailError}</div>
              ) : detail ? (
                <>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{detail.title}</div>
                    {detail.shortDescription ? <div style={{ fontSize: 16, fontWeight: 400, opacity: 0.9, lineHeight: 1.35 }}>{detail.shortDescription}</div> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => setDetailTab('long')} style={{ background: detailTab === 'long' ? 'rgba(25,118,210,0.35)' : 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '6px 10px', fontSize: 16, fontWeight: 900 }}>Long</button>
                    <button onClick={() => setDetailTab('allowed')} style={{ background: detailTab === 'allowed' ? 'rgba(25,118,210,0.35)' : 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '6px 10px', fontSize: 16, fontWeight: 900 }}>Allowed</button>
                    <button onClick={() => setDetailTab('disallowed')} style={{ background: detailTab === 'disallowed' ? 'rgba(25,118,210,0.35)' : 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '6px 10px', fontSize: 16, fontWeight: 900 }}>Disallowed</button>
                  </div>
                  <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 12, background: 'rgba(255,255,255,0.03)' }}>
                    {detailTab === 'long' ? (
                      <div dangerouslySetInnerHTML={{ __html: detail.html || '' }} />
                    ) : detailTab === 'allowed' ? (
                      <div dangerouslySetInnerHTML={{ __html: detail.allowedExamplesHtml || '<div style=\"opacity:.8\">No allowed examples.</div>' }} />
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: detail.disallowedExamplesHtml || '<div style=\"opacity:.8\">No disallowed examples.</div>' }} />
                    )}
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div style={{ padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 10, background: 'rgba(255,255,255,0.04)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 8, background: 'rgba(0,0,0,0.18)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => captureAtPlayhead('start')}
                        style={{
                          ...secondaryButtonStyle,
                          borderRadius: 10,
                          padding: '6px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        Start
                      </button>
                      {reportedStartSeconds != null ? (
                        <button
                          type="button"
                          onClick={() => applyReportedRange(null, reportedEndSeconds)}
                          style={{
                            ...secondaryButtonStyle,
                            borderRadius: 10,
                            padding: '4px 8px',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <div style={{ marginTop: 8, fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>
                      {formatSecondsLabel(reportedStartSeconds)}
                    </div>
                  </div>
                  <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 8, background: 'rgba(0,0,0,0.18)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => captureAtPlayhead('end')}
                        style={{
                          ...secondaryButtonStyle,
                          borderRadius: 10,
                          padding: '6px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        End
                      </button>
                      {reportedEndSeconds != null ? (
                        <button
                          type="button"
                          onClick={() => applyReportedRange(reportedStartSeconds, null)}
                          style={{
                            ...secondaryButtonStyle,
                            borderRadius: 10,
                            padding: '4px 8px',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <div style={{ marginTop: 8, fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>
                      {formatSecondsLabel(reportedEndSeconds)}
                    </div>
                  </div>
                </div>
                {invalidTimeRange ? (
                  <div style={{ color: '#ffb3b3', fontSize: 12 }}>
                    End time must be greater than or equal to start time.
                  </div>
                ) : null}
              </div>
              {expandedReasonId != null ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedReasonId(null)}
                    aria-label="Back"
                    title="Back"
                    style={{
                      ...secondaryButtonStyle,
                      width: 40,
                      height: 36,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    <ChevronIcon direction="left" />
                  </button>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Reason details</div>
                </div>
              ) : null}
              {reportedByMe ? (
                <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: '#b3ffd2' }}>
                  You already reported this post{reportedTitle ? ` (rule: ${reportedTitle}).` : '.'}
                </div>
              ) : null}

              {!hasReasons ? (
                <div style={{ padding: 10, opacity: 0.85 }}>
                  No moderation rules available for this space.
                </div>
              ) : (
                (options?.groups || []).map((group, gIdx) => {
                  const reasons = group.reasons || []
                  const expandedReasonInGroup = reasons.find((r) => expandedReasonId === Number(r.id))
                  const groupExpanded = Boolean(expandedReasonInGroup)
                  const firstReasonId = reasons.length ? Number(reasons[0].id) : null
                  return (
                    <div key={`${group.key || 'group'}-${gIdx}`} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.04)', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{group.label || 'General'}</span>
                        <button
                          type="button"
                          aria-label={groupExpanded ? 'Hide details' : 'Drill down'}
                          title={groupExpanded ? 'Hide details' : 'Drill down'}
                          onClick={() => {
                            if (firstReasonId == null) return
                            setExpandedReasonId(groupExpanded ? null : firstReasonId)
                          }}
                          style={{
                            ...secondaryButtonStyle,
                            borderRadius: 10,
                            width: 44,
                            height: 36,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            boxSizing: 'border-box',
                          }}
                        >
                          <span style={{ marginTop: groupExpanded ? -3 : 0, display: 'inline-flex' }}>
                            <ChevronIcon direction={groupExpanded ? 'down' : 'right'} />
                          </span>
                        </button>
                      </div>
                      <div style={{ display: 'grid' }}>
                        {(group.reasons || []).map((reason) => {
                          const expanded = expandedReasonId === Number(reason.id)
                          const reasonBusy = submitBusyKey === `reason:${reason.id}`
                          return (
                            <div key={reason.id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '10px 12px', display: 'grid', gap: 8 }}>
                              <div style={{ position: 'relative', paddingBottom: 42, minHeight: 72 }}>
                                <div style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.25 }}>
                                  {reason.label}
                                </div>
                                {reason.shortDescription ? (
                                  <div style={{ fontSize: 'inherit', fontWeight: 400, opacity: 0.9, lineHeight: 1.35 }}>
                                    {reason.shortDescription}
                                    <span aria-hidden="true" style={{ display: 'inline-block', width: 94, height: 1 }} />
                                  </div>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => submitReport({ userFacingRuleId: Number(reason.id), busyKey: `reason:${reason.id}` })}
                                  disabled={reportedByMe || !!submitBusyKey}
                                  style={{
                                    position: 'absolute',
                                    right: 0,
                                    bottom: 0,
                                    ...(reportedByMe || !!submitBusyKey ? { background: '#333', border: '1px solid rgba(255,255,255,0.18)' } : primaryButtonStyle),
                                    color: '#fff',
                                    borderRadius: 10,
                                    padding: '6px 10px',
                                    fontSize: 14,
                                    fontWeight: 900,
                                    cursor: (reportedByMe || !!submitBusyKey) ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {reasonBusy ? 'Submitting…' : 'Submit'}
                                </button>
                              </div>
                              {expanded ? (
                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4, paddingTop: 8, display: 'grid', gap: 8 }}>
                                  {(reason.rules || []).map((r) => {
                                    const ruleBusy = submitBusyKey === `rule:${reason.id}:${r.id}`
                                    return (
                                      <div
                                        key={r.id}
                                        style={{
                                          padding: '6px 0 6px 10px',
                                          marginLeft: 6,
                                          borderLeft: '3px solid rgba(255,255,255,0.9)',
                                        }}
                                      >
                                        <div style={{ position: 'relative', paddingBottom: 42, minHeight: 68 }}>
                                          <button
                                            type="button"
                                            onClick={() => openDetail(r.slug, { userFacingRuleId: Number(reason.id), ruleId: Number(r.id) })}
                                            style={{
                                              background: 'transparent',
                                              border: 'none',
                                              padding: 0,
                                              margin: 0,
                                              display: 'block',
                                              width: '100%',
                                              textAlign: 'left',
                                              color: '#fff',
                                              fontWeight: 600,
                                              fontSize: 'inherit',
                                              lineHeight: 1.25,
                                              cursor: 'pointer',
                                            }}
                                          >
                                            {r.title}
                                          </button>
                                          {r.shortDescription ? (
                                            <button
                                              type="button"
                                              onClick={() => openDetail(r.slug, { userFacingRuleId: Number(reason.id), ruleId: Number(r.id) })}
                                              style={{
                                              background: 'transparent',
                                              border: 'none',
                                              padding: 0,
                                              margin: 0,
                                              display: 'block',
                                              width: '100%',
                                              textAlign: 'left',
                                              color: '#fff',
                                              fontSize: 13,
                                              opacity: 0.82,
                                              lineHeight: 1.3,
                                              cursor: 'pointer',
                                              }}
                                            >
                                              {r.shortDescription}
                                              <span aria-hidden="true" style={{ display: 'inline-block', width: 94, height: 1 }} />
                                            </button>
                                          ) : null}
                                          <button
                                            type="button"
                                            aria-label="More details"
                                            title="More details"
                                            onClick={() => openDetail(r.slug, { userFacingRuleId: Number(reason.id), ruleId: Number(r.id) })}
                                            style={{
                                              ...secondaryButtonStyle,
                                              position: 'absolute',
                                              left: 0,
                                              bottom: 0,
                                              width: 40,
                                              height: 36,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              padding: 0,
                                              cursor: 'pointer',
                                            }}
                                          >
                                            <ChevronIcon direction="right" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => submitReport({ userFacingRuleId: Number(reason.id), ruleId: Number(r.id), busyKey: `rule:${reason.id}:${r.id}` })}
                                            disabled={reportedByMe || !!submitBusyKey}
                                            style={{
                                              position: 'absolute',
                                              right: 0,
                                              bottom: 0,
                                              ...(reportedByMe || !!submitBusyKey ? { background: '#333', border: '1px solid rgba(255,255,255,0.18)' } : primaryButtonStyle),
                                              color: '#fff',
                                              borderRadius: 10,
                                              padding: '6px 10px',
                                              fontSize: 14,
                                              fontWeight: 900,
                                              cursor: (reportedByMe || !!submitBusyKey) ? 'not-allowed' : 'pointer',
                                            }}
                                          >
                                            {ruleBusy ? 'Submitting…' : 'Submit'}
                                          </button>
                                        </div>
                                  </div>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        <div style={{ paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {submitError ? <span style={{ color: '#ffb3b3', fontSize: 12 }}>{submitError}</span> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
