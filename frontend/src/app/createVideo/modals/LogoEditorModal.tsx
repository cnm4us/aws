import React from 'react'
import { roundToTenth } from '../timelineMath'

type LogoEditorState = {
  id: string
  start: number
  end: number
  sizePctWidth: number
  opacityPct: number
  position: string
  insetPreset?: 'small' | 'medium' | 'large'
  fade?: 'none' | 'in' | 'out' | 'in_out'
}

type LogoEditorModalProps = {
  logoEditor: LogoEditorState
  logoEditorError: string | null
  setLogoEditor: React.Dispatch<React.SetStateAction<LogoEditorState | null>>
  setLogoEditorError: React.Dispatch<React.SetStateAction<string | null>>
  logos: any[]
  namesByUploadId: Record<number, string>
  onClose: () => void
  onSave: () => void
}

export default function LogoEditorModal({
  logoEditor,
  logoEditorError,
  setLogoEditor,
  setLogoEditorError,
  logos,
  namesByUploadId,
  onClose,
  onSave,
}: LogoEditorModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 560,
          margin: '0 auto',
          borderRadius: 14,
          border: '1px solid rgba(96,165,250,0.95)',
          background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Logo Properties</div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
          >
            Close
          </button>
        </div>

        {(() => {
          const seg = logos.find((l) => String((l as any).id) === String(logoEditor.id)) as any
          const uploadId = Number(seg?.uploadId)
          const name = Number.isFinite(uploadId) && uploadId > 0 ? (namesByUploadId[uploadId] || `Logo ${uploadId}`) : 'Logo'
          return (
            <div style={{ marginTop: 10, color: '#fff', fontWeight: 900 }}>
              {name}
            </div>
          )
        })()}

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ color: '#bbb', fontSize: 12, fontWeight: 800 }}>Start</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{Number(logoEditor.start).toFixed(1)}s</div>
            </div>
            <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ color: '#bbb', fontSize: 12, fontWeight: 800 }}>Duration</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{Math.max(0, Number(logoEditor.end) - Number(logoEditor.start)).toFixed(1)}s</div>
            </div>
            <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ color: '#bbb', fontSize: 12, fontWeight: 800 }}>End</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{Number(logoEditor.end).toFixed(1)}s</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13, fontWeight: 900 }}>Adjust Start</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setLogoEditor((p) => (p ? { ...p, start: Math.max(0, roundToTenth(Number(p.start) - 0.1)) } : p))}
                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.65)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  −0.1s
                </button>
                <button
                  type="button"
                  onClick={() => setLogoEditor((p) => (p ? { ...p, start: roundToTenth(Number(p.start) + 0.1) } : p))}
                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.65)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  +0.1s
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13, fontWeight: 900 }}>Adjust End</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setLogoEditor((p) => (p ? { ...p, end: Math.max(0, roundToTenth(Number(p.end) - 0.1)) } : p))}
                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.65)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  −0.1s
                </button>
                <button
                  type="button"
                  onClick={() => setLogoEditor((p) => (p ? { ...p, end: roundToTenth(Number(p.end) + 0.1) } : p))}
                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.65)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  +0.1s
                </button>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Placement</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
                <label style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Size (% width)</div>
                  <select
                    value={String(logoEditor.sizePctWidth)}
                    onChange={(e) => {
                      setLogoEditorError(null)
                      setLogoEditor((p) => (p ? { ...p, sizePctWidth: Number(e.target.value) } : p))
                    }}
                    style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                  >
                    {[10, 20, 30, 40, 50].map((n) => (
                      <option key={`logo_sz_${n}`} value={String(n)}>{`${n}%`}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Opacity (%)</div>
                  <select
                    value={String(Math.round(Number(logoEditor.opacityPct)))}
                    onChange={(e) => {
                      setLogoEditorError(null)
                      setLogoEditor((p) => (p ? { ...p, opacityPct: Number(e.target.value) } : p))
                    }}
                    style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                  >
                    {Array.from({ length: 11 }).map((_, i) => {
                      const n = i * 10
                      return (
                        <option key={`logo_op_${n}`} value={String(n)}>
                          {`${n}%`}
                        </option>
                      )
                    })}
                  </select>
                </label>
              </div>

              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Inset</div>
                <select
                  value={String(logoEditor.insetPreset || 'medium')}
                  onChange={(e) => {
                    setLogoEditorError(null)
                    setLogoEditor((p) => (p ? { ...p, insetPreset: e.target.value as any } : p))
                  }}
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Position</div>
                {(() => {
                  const cells = [
                    { key: 'top_left', label: '↖' },
                    { key: 'top_center', label: '↑' },
                    { key: 'top_right', label: '↗' },
                    { key: 'middle_left', label: '←' },
                    { key: 'middle_center', label: '•' },
                    { key: 'middle_right', label: '→' },
                    { key: 'bottom_left', label: '↙' },
                    { key: 'bottom_center', label: '↓' },
                    { key: 'bottom_right', label: '↘' },
                  ] as const
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxWidth: 240 }}>
                      {cells.map((c) => {
                        const selected = String(logoEditor.position) === String(c.key)
                        return (
                          <button
                            key={String(c.key)}
                            type="button"
                            onClick={() => {
                              setLogoEditorError(null)
                              setLogoEditor((p) => (p ? { ...p, position: c.key } : p))
                            }}
                            style={{
                              height: 44,
                              borderRadius: 12,
                              border: selected ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
                              background: selected ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 18,
                            }}
                            aria-label={`Position ${String(c.key)}`}
                          >
                            {c.label}
                          </button>
                        )
                      })}
                    </div>
                  )
                })()}
              </label>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Effects</div>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Fade</div>
              <select
                value={String(logoEditor.fade || 'none')}
                onChange={(e) => setLogoEditor((p) => (p ? { ...p, fade: e.target.value as any } : p))}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
              >
                <option value="none">None</option>
                <option value="in">Fade In</option>
                <option value="out">Fade Out</option>
                <option value="in_out">Fade In/Out</option>
              </select>
              <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Fixed duration: 0.35s</div>
            </label>
          </div>

          {logoEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{logoEditorError}</div> : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
