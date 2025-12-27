import React, { useEffect, useMemo, useState } from 'react'

type OptionsRule = { id: number; slug: string; title: string; shortDescription?: string }
type OptionsCategory = { id: number; name: string; rules: OptionsRule[] }
type OptionsResponse = {
  spacePublicationId: number
  spaceId: number
  reportedByMe: boolean
  myReport?: { ruleId: number; ruleSlug: string | null; ruleTitle: string | null; createdAt: string } | null
  categories: OptionsCategory[]
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

  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null)
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null)
  const [selectedRuleSlug, setSelectedRuleSlug] = useState<string | null>(null)

  const [detailSlug, setDetailSlug] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detail, setDetail] = useState<RuleDetailResponse | null>(null)
  const [detailTab, setDetailTab] = useState<'long' | 'allowed' | 'disallowed'>('long')

  const [submitBusy, setSubmitBusy] = useState(false)
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
        if (data?.myReport?.ruleId) {
          const rid = Number(data.myReport.ruleId)
          if (Number.isFinite(rid) && rid > 0) {
            setSelectedRuleId(rid)
            const slug = data.myReport.ruleSlug
            if (slug) setSelectedRuleSlug(String(slug))
          }
        }
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
    for (const cat of options?.categories || []) {
      for (const r of cat.rules || []) {
        map.set(Number(r.id), r)
      }
    }
    return map
  }, [options])

  useEffect(() => {
    if (!options?.myReport?.ruleId) return
    const rid = Number(options.myReport.ruleId)
    if (!Number.isFinite(rid) || rid <= 0) return
    if (selectedRuleId == null) setSelectedRuleId(rid)
    if (!selectedRuleSlug) {
      const slug = options.myReport.ruleSlug || flatRules.get(rid)?.slug || null
      if (slug) setSelectedRuleSlug(String(slug))
    }
  }, [options, flatRules, selectedRuleId, selectedRuleSlug])

  async function openDetail(slug: string) {
    setDetailSlug(slug)
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

  async function submit() {
    if (submitBusy) return
    if (!selectedRuleId) return
    if (options?.reportedByMe) return
    setSubmitBusy(true)
    setSubmitError(null)
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/publications/${publicationId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ ruleId: selectedRuleId }),
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
      setSubmitBusy(false)
    }
  }

  const reportedByMe = Boolean(options?.reportedByMe)
  const reportedTitle =
    selectedRuleId != null && flatRules.has(selectedRuleId)
      ? flatRules.get(selectedRuleId)!.title
      : options?.myReport?.ruleTitle || null

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
          width: 'min(760px, 96vw)',
          maxHeight: '86vh',
          background: 'rgba(18,18,18,0.98)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
        }}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Report</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Select the single rule that best matches.</div>
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
                  onClick={() => { setDetailSlug(null); setDetail(null); setDetailError(null) }}
                  style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 10, padding: '6px 10px', fontSize: 16 }}
                >
                  Back
                </button>
                <div style={{ fontSize: 12, opacity: 0.8, textAlign: 'right' }}>Publication #{publicationId}</div>
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
              {reportedByMe ? (
                <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: '#b3ffd2' }}>
                  You already reported this post{reportedTitle ? ` (rule: ${reportedTitle}).` : '.'}
                </div>
              ) : null}

              {!options?.categories?.length ? (
                <div style={{ padding: 10, opacity: 0.85 }}>
                  No reporting rules are configured for this space yet.
                </div>
              ) : (
                options.categories.map((cat) => (
                  <div key={cat.id} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.04)', fontWeight: 700 }}>
                      {cat.name}
                    </div>
                    <div style={{ display: 'grid' }}>
                      {(cat.rules || []).map((r) => {
                        const checked = selectedRuleId === r.id
                        const expanded = expandedRuleId === r.id
                        return (
                          <div key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '10px 12px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr', columnGap: 10, rowGap: 8, alignItems: 'start' }}>
                              <div>
                                <input
                                  type="radio"
                                  name={`report-rule-${publicationId}`}
                                  checked={checked}
                                  disabled={reportedByMe}
                                  onChange={() => {
                                    setSelectedRuleId(r.id)
                                    setSelectedRuleSlug(r.slug)
                                  }}
                                  style={{ marginTop: 2 }}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => setExpandedRuleId(expanded ? null : r.id)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 0,
                                  margin: 0,
                                  color: '#fff',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  fontSize: 'inherit',
                                  lineHeight: 1.25,
                                  whiteSpace: 'normal',
                                }}
                              >
                                {r.title}
                              </button>

                              {expanded && r.shortDescription ? (
                                <>
                                  <div style={{ gridColumn: '1 / -1', fontSize: 'inherit', fontWeight: 400, opacity: 0.9, lineHeight: 1.35 }}>
                                    {r.shortDescription}
                                  </div>
                                  <div style={{ gridColumn: '2 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                                    <button
                                      onClick={() => openDetail(r.slug)}
                                      style={{ background: 'transparent', color: '#9cf', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 10, padding: '6px 10px', fontSize: 16 }}
                                    >
                                      More
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {selectedRuleId && selectedRuleSlug && flatRules.has(selectedRuleId) ? (
              <>Selected: <span style={{ fontWeight: 700 }}>{flatRules.get(selectedRuleId)!.title}</span></>
            ) : (
              <>Select a rule to submit.</>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {submitError ? <span style={{ color: '#ffb3b3', fontSize: 12 }}>{submitError}</span> : null}
            <button
              onClick={submit}
              disabled={submitBusy || reportedByMe || !selectedRuleId}
              style={{
                background: (submitBusy || reportedByMe || !selectedRuleId) ? '#333' : '#e53935',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 10,
                padding: '8px 12px',
                fontSize: 16,
                cursor: (submitBusy || reportedByMe || !selectedRuleId) ? 'not-allowed' : 'pointer',
              }}
            >
              {reportedByMe ? 'Reported' : submitBusy ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
