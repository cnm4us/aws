import React, { useEffect, useMemo, useState } from 'react'

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
}) {
  const { publicationId, onClose, onReported } = props

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
    setSubmitBusyKey(input.busyKey)
    setSubmitError(null)
    try {
      const csrf = getCsrfToken()
      const payload: Record<string, any> = {}
      if (input.userFacingRuleId != null) payload.userFacingRuleId = Number(input.userFacingRuleId)
      if (input.ruleId != null) payload.ruleId = Number(input.ruleId)
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

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(0,0,0,0.82)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, calc(100vw - 32px))',
          maxHeight: '86vh',
          background: 'rgba(18,18,18,0.98)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 14,
          boxSizing: 'border-box',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
        }}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Report</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Choose a reason and submit, or drill down to a specific rule.</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 10, padding: '6px 10px', fontSize: 16 }}>
            Close
          </button>
        </div>

        <div style={{ overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 16, opacity: 0.85 }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: 16, color: '#ffb3b3' }}>{error}</div>
          ) : detailSlug ? (
            <div style={{ padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => { setDetailSlug(null); setDetailContext(null); setDetail(null); setDetailError(null) }}
                  style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 10, padding: '6px 10px', fontSize: 16 }}
                >
                  Back
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
                        background: (reportedByMe || !!submitBusyKey) ? '#333' : '#e53935',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.22)',
                        borderRadius: 10,
                        padding: '6px 10px',
                        fontSize: 14,
                        cursor: (reportedByMe || !!submitBusyKey) ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {submitBusyKey === `detail:${detailContext.userFacingRuleId}:${detailContext.ruleId}` ? 'Submitting…' : 'Submit'}
                    </button>
                  ) : null}
                  <div style={{ fontSize: 12, opacity: 0.8, textAlign: 'right' }}>Publication #{publicationId}</div>
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
                    <button onClick={() => setDetailTab('long')} style={{ background: detailTab === 'long' ? '#1976d2' : '#222', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '6px 10px', fontSize: 16 }}>Long</button>
                    <button onClick={() => setDetailTab('allowed')} style={{ background: detailTab === 'allowed' ? '#1976d2' : '#222', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '6px 10px', fontSize: 16 }}>Allowed</button>
                    <button onClick={() => setDetailTab('disallowed')} style={{ background: detailTab === 'disallowed' ? '#1976d2' : '#222', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '6px 10px', fontSize: 16 }}>Disallowed</button>
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
              {expandedReasonId != null ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedReasonId(null)}
                    style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 10, padding: '6px 10px', fontSize: 16 }}
                  >
                    Back
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
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.22)',
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
                          <span
                            aria-hidden="true"
                            style={{
                              width: 10,
                              height: 10,
                              borderRight: '2px solid #fff',
                              borderBottom: '2px solid #fff',
                              transform: groupExpanded ? 'rotate(45deg)' : 'rotate(-45deg)',
                              marginTop: groupExpanded ? -3 : 0,
                            }}
                          />
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
                                    background: (reportedByMe || !!submitBusyKey) ? '#333' : '#e53935',
                                    color: '#fff',
                                    border: '1px solid rgba(255,255,255,0.22)',
                                    borderRadius: 10,
                                    padding: '6px 10px',
                                    fontSize: 14,
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
                                          display: 'grid',
                                          gridTemplateColumns: '1fr auto',
                                          gap: 8,
                                          alignItems: 'start',
                                          padding: '6px 0 6px 10px',
                                          marginLeft: 6,
                                          borderLeft: '3px solid rgba(255,255,255,0.9)',
                                        }}
                                      >
                                        <div style={{ display: 'grid', gap: 3 }}>
                                          <button
                                            type="button"
                                            onClick={() => openDetail(r.slug, { userFacingRuleId: Number(reason.id), ruleId: Number(r.id) })}
                                            style={{
                                              background: 'transparent',
                                              border: 'none',
                                              padding: 0,
                                              margin: 0,
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
                                                textAlign: 'left',
                                              color: '#fff',
                                              fontSize: 13,
                                              opacity: 0.82,
                                              lineHeight: 1.3,
                                              cursor: 'pointer',
                                              }}
                                            >
                                              {r.shortDescription}
                                            </button>
                                          ) : null}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => submitReport({ userFacingRuleId: Number(reason.id), ruleId: Number(r.id), busyKey: `rule:${reason.id}:${r.id}` })}
                                          disabled={reportedByMe || !!submitBusyKey}
                                          style={{
                                            background: (reportedByMe || !!submitBusyKey) ? '#333' : '#e53935',
                                            color: '#fff',
                                            border: '1px solid rgba(255,255,255,0.22)',
                                            borderRadius: 10,
                                            padding: '6px 10px',
                                            fontSize: 14,
                                            cursor: (reportedByMe || !!submitBusyKey) ? 'not-allowed' : 'pointer',
                                          }}
                                        >
                                          {ruleBusy ? 'Submitting…' : 'Submit'}
                                        </button>
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

        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {reportedByMe ? 'This publication is already reported by you.' : 'Select a reason or drill down to a specific rule.'}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {submitError ? <span style={{ color: '#ffb3b3', fontSize: 12 }}>{submitError}</span> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
