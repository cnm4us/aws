import React from 'react'

type VideoOverlayEditorState = {
  id: string
  sizePctWidth: number
  position: string
  plateStyle?: string
  plateColor?: string
  plateOpacityPct?: number
  boostDb: number
}

type VideoOverlayEditorModalProps = {
  videoOverlayEditor: VideoOverlayEditorState
  videoOverlayEditorError: string | null
  setVideoOverlayEditor: React.Dispatch<React.SetStateAction<VideoOverlayEditorState | null>>
  setVideoOverlayEditorError: React.Dispatch<React.SetStateAction<string | null>>
  videoOverlays: any[]
  namesByUploadId: Record<number, string>
  overlayFreezeInsertBusy: boolean
  overlayFreezeInsertError: string | null
  insertVideoOverlayFreezeStill: (which: 'first' | 'last') => void
  onClose: () => void
  onSave: () => void
}

export default function VideoOverlayEditorModal({
  videoOverlayEditor,
  videoOverlayEditorError,
  setVideoOverlayEditor,
  setVideoOverlayEditorError,
  videoOverlays,
  namesByUploadId,
  overlayFreezeInsertBusy,
  overlayFreezeInsertError,
  insertVideoOverlayFreezeStill,
  onClose,
  onSave,
}: VideoOverlayEditorModalProps) {
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
          <div style={{ fontSize: 18, fontWeight: 900 }}>Video Overlay Properties</div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
          >
            Close
          </button>
        </div>

        {(() => {
          const o = videoOverlays.find((oo: any) => String((oo as any).id) === String(videoOverlayEditor.id)) as any
          if (!o) return null
          const uploadId = Number((o as any).uploadId)
          return (
            <div style={{ marginTop: 10, color: '#fff', fontWeight: 900 }}>
              {namesByUploadId[uploadId] || `Video ${uploadId}`}
            </div>
          )
        })()}

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Size (% width)</div>
            <select
              value={String(videoOverlayEditor.sizePctWidth)}
              onChange={(e) => {
                setVideoOverlayEditorError(null)
                setVideoOverlayEditor((p) => (p ? { ...p, sizePctWidth: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
            >
              {[25, 33, 40, 50, 70, 90, 100].map((n) => (
                <option key={`sz-${n}`} value={String(n)}>{`${n}%`}</option>
              ))}
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
                    const selected = String(videoOverlayEditor.position) === String(c.key)
                    return (
                      <button
                        key={String(c.key)}
                        type="button"
                        onClick={() => {
                          setVideoOverlayEditorError(null)
                          setVideoOverlayEditor((p) => (p ? { ...p, position: c.key as any } : p))
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

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Overlay Frame</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, alignItems: 'end' }}>
              <div>
                <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Style</div>
                <select
                  value={String(videoOverlayEditor.plateStyle || 'none')}
                  onChange={(e) => setVideoOverlayEditor((p) => (p ? { ...p, plateStyle: e.target.value as any } : p))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#0c0c0c',
                    color: '#fff',
                    fontWeight: 900,
                  }}
                >
                  <option value="none">None</option>
                  <option value="thin">Thin</option>
                  <option value="medium">Medium</option>
                  <option value="thick">Thick</option>
                  <option value="band">Band</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
              <div>
                <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Frame color</div>
                <input
                  type="color"
                  value={String(videoOverlayEditor.plateColor || '#000000')}
                  onChange={(e) =>
                    setVideoOverlayEditor((p) => (p ? { ...p, plateColor: e.target.value } : p))
                  }
                  style={{
                    width: '100%',
                    height: 44,
                    padding: 0,
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#0c0c0c',
                    cursor: 'pointer',
                  }}
                />
                <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Default: black</div>
              </div>
              <div>
                <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Frame opacity</div>
                <select
                  value={String(Number(videoOverlayEditor.plateOpacityPct ?? 85))}
                  onChange={(e) =>
                    setVideoOverlayEditor((p) => (p ? { ...p, plateOpacityPct: Number(e.target.value) } : p))
                  }
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#0c0c0c',
                    color: '#fff',
                    fontWeight: 900,
                  }}
                >
                  {Array.from({ length: 11 }, (_, i) => i * 10).map((n) => (
                    <option key={`plate-op-${n}`} value={String(n)}>
                      {n}%
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, fontWeight: 900 }}>Freeze Frames - Duration: 2.0s</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => insertVideoOverlayFreezeStill('first')}
                disabled={overlayFreezeInsertBusy}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: overlayFreezeInsertBusy ? 'default' : 'pointer',
                  minWidth: 120,
                }}
              >
                First Frame
              </button>
              <button
                type="button"
                onClick={() => insertVideoOverlayFreezeStill('last')}
                disabled={overlayFreezeInsertBusy}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: overlayFreezeInsertBusy ? 'default' : 'pointer',
                  minWidth: 120,
                }}
              >
                Last Frame
              </button>
            </div>
            {overlayFreezeInsertBusy ? <div style={{ color: '#bbb', fontSize: 12, marginTop: 8 }}>Generating freeze frame…</div> : null}
            {overlayFreezeInsertError ? <div style={{ color: '#ff9b9b', fontSize: 13, marginTop: 8 }}>{overlayFreezeInsertError}</div> : null}
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Audio Boost</div>
            <select
              value={String(videoOverlayEditor.boostDb)}
              onChange={(e) => {
                setVideoOverlayEditorError(null)
                setVideoOverlayEditor((p) => (p ? { ...p, boostDb: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
            >
              <option value="0">None</option>
              <option value="3">+3 dB</option>
              <option value="6">+6 dB</option>
              <option value="9">+9 dB</option>
            </select>
          </label>

          {videoOverlayEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{videoOverlayEditorError}</div> : null}

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
