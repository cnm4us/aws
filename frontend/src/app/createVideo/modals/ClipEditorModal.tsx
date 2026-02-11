import React from 'react'

type ClipEditorModalProps = {
  clipEditor: any
  clipEditorError: string | null
  setClipEditor: React.Dispatch<React.SetStateAction<any>>
  setClipEditorError: React.Dispatch<React.SetStateAction<string | null>>
  freezeInsertBusy: boolean
  freezeInsertError: string | null
  clips: any[]
  durationsByUploadId: Record<number, number | undefined>
  namesByUploadId: Record<number, string>
  dimsByUploadId: Record<number, { width: number; height: number }>
  openClipBackgroundPicker: () => void
  insertFreezeStill: (which: 'first' | 'last') => void
  onToggleClipAudioEnabled: (clipId: string, enabled: boolean) => void
  onClose: () => void
  onSave: () => void
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function normalizeHexColor(raw: any, fallback = '#000000'): string {
  const s = String(raw == null ? fallback : raw).trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(s)) return fallback
  return s.startsWith('#') ? s : `#${s}`
}

export default function ClipEditorModal({
  clipEditor,
  clipEditorError,
  setClipEditor,
  setClipEditorError,
  freezeInsertBusy,
  freezeInsertError,
  clips,
  durationsByUploadId,
  namesByUploadId,
  dimsByUploadId,
  openClipBackgroundPicker,
  insertFreezeStill,
  onToggleClipAudioEnabled,
  onClose,
  onSave,
}: ClipEditorModalProps) {
  const clip = clips.find((c) => c.id === clipEditor.id) || null
  const maxDur = clip ? (durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds) : null
  const safeMax = maxDur != null && Number.isFinite(Number(maxDur)) ? roundToTenth(Number(maxDur)) : null
  const start = clip ? roundToTenth(Number(clip.sourceStartSeconds || 0)) : 0
  const end = clip ? roundToTenth(Number(clip.sourceEndSeconds || 0)) : 0
  const dur = roundToTenth(Math.max(0, end - start))

  const statBox: React.CSSProperties = {
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.04)',
    padding: 10,
    minWidth: 0,
  }

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
          <div style={{ fontSize: 18, fontWeight: 900 }}>Video Properties</div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
          >
            Close
          </button>
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div style={statBox}>
              <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Start</div>
              <div style={{ fontSize: 14, fontWeight: 900 }}>{`${start.toFixed(1)}s`}</div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.14)', margin: '6px 0' }} />
              <div style={{ fontSize: 12, fontWeight: 900, color: '#bbb' }}>0.0s</div>
            </div>
            <div style={statBox}>
              <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Total</div>
              <div style={{ fontSize: 14, fontWeight: 900 }}>{`${dur.toFixed(1)}s`}</div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.14)', margin: '6px 0' }} />
              <div style={{ fontSize: 12, fontWeight: 900, color: '#bbb' }}>{safeMax != null ? `${safeMax.toFixed(1)}s` : '—'}</div>
            </div>
            <div style={statBox}>
              <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>End</div>
              <div style={{ fontSize: 14, fontWeight: 900 }}>{`${end.toFixed(1)}s`}</div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.14)', margin: '6px 0' }} />
              <div style={{ fontSize: 12, fontWeight: 900, color: '#bbb' }}>{safeMax != null ? `${safeMax.toFixed(1)}s` : '—'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
            <div style={{ color: '#bbb', fontSize: 13, fontWeight: 800 }}>Clip audio</div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={clip ? (clip as any).audioEnabled !== false : true}
                disabled={!clip}
                onChange={(e) => {
                  if (!clip) return
                  onToggleClipAudioEnabled(String(clipEditor.id), Boolean(e.target.checked))
                }}
              />
              <span style={{ color: '#fff', fontWeight: 900 }}>{clip && (clip as any).audioEnabled === false ? 'Muted' : 'Enabled'}</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
            <div style={{ color: '#bbb', fontSize: 13, fontWeight: 800 }}>Audio Boost</div>
            <select
              value={String(clipEditor.boostDb)}
              onChange={(e) => setClipEditor((p) => (p ? { ...p, boostDb: Number(e.target.value) } : p))}
              style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '8px 10px', fontSize: 14, fontWeight: 900 }}
            >
              <option value="0">None</option>
              <option value="3">+3 dB</option>
              <option value="6">+6 dB</option>
              <option value="9">+9 dB</option>
            </select>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
            <div style={{ color: '#bbb', fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Background Fill</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Style</div>
                <select
                  value={String(clipEditor.bgFillStyle || 'none')}
                  onChange={(e) => setClipEditor((p) => (p ? { ...p, bgFillStyle: e.target.value as any } : p))}
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                >
                  <option value="none">Use Timeline Background</option>
                  <option value="blur">Blur</option>
                  <option value="color">Color</option>
                  <option value="image">Image</option>
                </select>
              </label>
              {String(clipEditor.bgFillStyle || 'none') === 'blur' ? (
                <>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontSize: 13 }}>Backdrop brightness</div>
                    <select
                      value={String(clipEditor.bgFillBrightness || 'neutral')}
                      onChange={(e) => setClipEditor((p) => (p ? { ...p, bgFillBrightness: e.target.value as any } : p))}
                      style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                    >
                      <option value="light3">Lighten 3</option>
                      <option value="light2">Lighten 2</option>
                      <option value="light1">Lighten 1</option>
                      <option value="neutral">Neutral</option>
                      <option value="dim1">Dim 1</option>
                      <option value="dim2">Dim 2</option>
                      <option value="dim3">Dim 3</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontSize: 13 }}>Blur</div>
                    <select
                      value={String(clipEditor.bgFillBlur || 'medium')}
                      onChange={(e) => setClipEditor((p) => (p ? { ...p, bgFillBlur: e.target.value as any } : p))}
                      style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                    >
                      <option value="soft">Soft</option>
                      <option value="medium">Medium</option>
                      <option value="strong">Strong</option>
                      <option value="very_strong">Very strong</option>
                    </select>
                  </label>
                </>
              ) : null}
              {String(clipEditor.bgFillStyle || 'none') === 'color' ? (
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Color</div>
                  <input
                    type="color"
                    value={normalizeHexColor((clipEditor as any).bgFillColor, '#000000')}
                    onChange={(e) =>
                      setClipEditor((p) => (p ? { ...p, bgFillColor: normalizeHexColor(e.target.value, '#000000') } : p))
                    }
                    style={{
                      width: '100%',
                      height: 42,
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: '#0b0b0b',
                      boxSizing: 'border-box',
                      padding: 4,
                    }}
                  />
                </label>
              ) : null}
              {String(clipEditor.bgFillStyle || 'none') === 'image' ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontSize: 13 }}>Image</div>
                    <input
                      type="text"
                      readOnly
                      value={
                        (clipEditor as any).bgFillImageUploadId != null
                          ? namesByUploadId[Number((clipEditor as any).bgFillImageUploadId)] || 'Selected image'
                          : 'No image selected'
                      }
                      style={{
                        width: '100%',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#0b0b0b',
                        color: '#fff',
                        padding: '10px 12px',
                        fontSize: 14,
                        fontWeight: 800,
                        boxSizing: 'border-box',
                      }}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={openClipBackgroundPicker}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(96,165,250,0.95)',
                        background: 'rgba(96,165,250,0.14)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      Pick Image
                    </button>
                    <button
                      type="button"
                      onClick={() => setClipEditor((p) => (p ? { ...p, bgFillImageUploadId: null } : p))}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: 'rgba(255,255,255,0.06)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div style={{ color: '#9aa3ad', fontSize: 12 }}>
                    {(clipEditor as any).bgFillImageUploadId != null
                      ? `${namesByUploadId[Number((clipEditor as any).bgFillImageUploadId)] || 'Selected image'}${
                          dimsByUploadId[Number((clipEditor as any).bgFillImageUploadId)]
                            ? ` • ${dimsByUploadId[Number((clipEditor as any).bgFillImageUploadId)].width}x${dimsByUploadId[Number((clipEditor as any).bgFillImageUploadId)].height}`
                            : ''
                        }`
                      : 'No clip background image selected.'}
                  </div>
                </div>
              ) : null}
              {String(clipEditor.bgFillStyle || 'none') === 'blur' ? (
                <div style={{ color: '#888', fontSize: 12 }}>
                  Blur applies only when the source is landscape and the output is portrait.
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
            <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Freeze Frames - Duration: 2.0s</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', flex: '1 1 auto' }}>
                <button
                  type="button"
                  disabled={freezeInsertBusy}
                  onClick={() => insertFreezeStill('first')}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(96,165,250,0.95)',
                    background: 'rgba(96,165,250,0.14)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: freezeInsertBusy ? 'not-allowed' : 'pointer',
                    opacity: freezeInsertBusy ? 0.6 : 1,
                  }}
                >
                  First Frame
                </button>
                <button
                  type="button"
                  disabled={freezeInsertBusy}
                  onClick={() => insertFreezeStill('last')}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(96,165,250,0.95)',
                    background: 'rgba(96,165,250,0.14)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: freezeInsertBusy ? 'not-allowed' : 'pointer',
                    opacity: freezeInsertBusy ? 0.6 : 1,
                  }}
                >
                  Last Frame
                </button>
              </div>
            </div>
            {freezeInsertBusy ? <div style={{ color: '#bbb', fontSize: 12, marginTop: 8 }}>Generating freeze frame…</div> : null}
            {freezeInsertError ? <div style={{ color: '#ff9b9b', fontSize: 13, marginTop: 8 }}>{freezeInsertError}</div> : null}
            <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
              Freeze frames are inserted as still segments and ripple-shift later items. Clip audio is silent during the still segment.
            </div>
          </div>

          {clipEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{clipEditorError}</div> : null}
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
