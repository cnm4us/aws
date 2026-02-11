import React from 'react'
import { clamp, roundToTenth } from '../timelineMath'
import { normalizeSpeedPresetMs } from '../screenTitleHelpers'

type GraphicEditorModalProps = {
  graphicEditor: any
  graphicEditorError: string | null
  setGraphicEditor: React.Dispatch<React.SetStateAction<any>>
  setGraphicEditorError: React.Dispatch<React.SetStateAction<string | null>>
  maxEndSeconds: number
  onClose: () => void
  onSave: () => void
}

export default function GraphicEditorModal({
  graphicEditor,
  graphicEditorError,
  setGraphicEditor,
  setGraphicEditorError,
  maxEndSeconds,
  onClose,
  onSave,
}: GraphicEditorModalProps) {
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
              <div style={{ fontSize: 18, fontWeight: 900 }}>Graphic Properties</div>
              <button
                type="button"
                onClick={onClose}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {(() => {
                const start = Number(graphicEditor.start)
                const end = Number(graphicEditor.end)
                const minLen = 0.2
                const cap = maxEndSeconds

                const adjustStart = (delta: number) => {
                  setGraphicEditorError(null)
                  setGraphicEditor((p) => {
                    if (!p) return p
                    const next = roundToTenth(Number(p.start) + delta)
                    const maxStart = Math.max(0, (Number(p.end) - minLen))
                    return { ...p, start: clamp(next, 0, maxStart) }
                  })
                }

                const adjustEnd = (delta: number) => {
                  setGraphicEditorError(null)
                  setGraphicEditor((p) => {
                    if (!p) return p
                    const next = roundToTenth(Number(p.end) + delta)
                    const minEnd = Math.max(0, (Number(p.start) + minLen))
                    return { ...p, end: clamp(next, minEnd, cap) }
                  })
                }

                const statBox: React.CSSProperties = {
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: 10,
                  minWidth: 0,
                }

                const adjustBtn = (enabled: boolean): React.CSSProperties => ({
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: `1px solid ${enabled ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.10)'}`,
                  background: enabled ? 'rgba(96,165,250,0.14)' : 'rgba(255,255,255,0.03)',
                  color: enabled ? '#fff' : 'rgba(255,255,255,0.55)',
                  fontWeight: 900,
                  cursor: enabled ? 'pointer' : 'not-allowed',
                })

                const canStartDec1 = Number.isFinite(start) && start > 0 + 1e-9
                const canStartDec01 = Number.isFinite(start) && start - 0.1 >= 0 - 1e-9
                const canStartInc01 = Number.isFinite(start) && Number.isFinite(end) && start + 0.1 <= end - minLen + 1e-9
                const canEndDec01 = Number.isFinite(start) && Number.isFinite(end) && end - 0.1 >= start + minLen - 1e-9
                const canEndInc01 = Number.isFinite(end) && end + 0.1 <= cap + 1e-9
                const mode = graphicEditor.mode
                const isFull = mode === 'full'
                const isPositioned = mode === 'positioned'
                const isAnimated = mode === 'animated'
                const isDocReveal = isAnimated && String(graphicEditor.animate || '') === 'doc_reveal'

	                return (
	                  <>
		                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
		                      <div style={statBox}>
		                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Start</div>
		                        <div style={{ fontSize: 14, fontWeight: 900 }}>{Number.isFinite(start) ? `${start.toFixed(1)}s` : '—'}</div>
		                      </div>
		                      <div style={statBox}>
		                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Duration</div>
		                        <div style={{ fontSize: 14, fontWeight: 900 }}>{Number.isFinite(start) && Number.isFinite(end) ? `${Math.max(0, end - start).toFixed(1)}s` : '—'}</div>
		                      </div>
		                      <div style={statBox}>
		                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>End</div>
		                        <div style={{ fontSize: 14, fontWeight: 900 }}>{Number.isFinite(end) ? `${end.toFixed(1)}s` : '—'}</div>
		                      </div>
		                    </div>

		                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
		                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
		                        <div>
		                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust Start</div>
		                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
		                            <button type="button" disabled={!canStartDec01} onClick={() => adjustStart(-0.1)} style={adjustBtn(canStartDec01)}>-0.1s</button>
		                            <button type="button" disabled={!canStartInc01} onClick={() => adjustStart(0.1)} style={adjustBtn(canStartInc01)}>+0.1s</button>
		                          </div>
		                        </div>
		                        <div>
		                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust End</div>
		                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
		                            <button type="button" disabled={!canEndDec01} onClick={() => adjustEnd(-0.1)} style={adjustBtn(canEndDec01)}>-0.1s</button>
		                            <button type="button" disabled={!canEndInc01} onClick={() => adjustEnd(0.1)} style={adjustBtn(canEndInc01)}>+0.1s</button>
		                          </div>
		                          <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Max end: {cap.toFixed(1)}s</div>
		                        </div>
		                      </div>
		                    </div>

		                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
		                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
		                        <div style={{ fontSize: 14, fontWeight: 900 }}>Mode</div>
		                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() =>
                              setGraphicEditor((p) =>
                                p
                                  ? {
                                      ...p,
                                      mode: 'full',
                                      fitMode: 'cover_full',
                                      animate: 'none',
                                    }
                                  : p
                              )
                            }
                            style={{
                              padding: '8px 10px',
                              borderRadius: 10,
                              border: isFull ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
                              background: isFull ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            Full Frame
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setGraphicEditor((p) =>
                                p
                                  ? {
                                      ...p,
                                      mode: 'positioned',
                                      fitMode: 'contain_transparent',
                                      animate: 'none',
                                    }
                                  : p
                              )
                            }
                            style={{
                              padding: '8px 10px',
                              borderRadius: 10,
                              border: isPositioned ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
                              background: isPositioned ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
	                            Positioned
	                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setGraphicEditor((p) => {
                                if (!p) return p
                                const posRaw = String(p.position || 'middle_center')
                                let position = posRaw
                                if (posRaw.includes('top')) position = 'top_center'
                                else if (posRaw.includes('bottom')) position = 'bottom_center'
                                else position = 'middle_center'
                                const currentAnimate = String(p.animate || 'none')
                                const nextAnimate = currentAnimate === 'doc_reveal' ? 'doc_reveal' : currentAnimate !== 'none' ? 'slide_in_out' : 'slide_in_out'
                                if (nextAnimate === 'doc_reveal') position = 'middle_center'
                                return {
                                  ...p,
                                  mode: 'animated',
                                  fitMode: 'contain_transparent',
                                  position,
                                  insetXPx: 0,
                                  insetYPx: nextAnimate === 'doc_reveal' ? 0 : p.insetYPx,
                                  sizePctWidth: nextAnimate === 'doc_reveal' ? 100 : p.sizePctWidth,
                                  animate: nextAnimate,
                                  fadeDurationMs: Number.isFinite(Number(p.fadeDurationMs)) ? Number(p.fadeDurationMs) : 600,
                                  animateDurationMs: Number.isFinite(Number(p.animateDurationMs)) ? Number(p.animateDurationMs) : 600,
                                }
                              })
                            }
	                            style={{
	                              padding: '8px 10px',
	                              borderRadius: 10,
	                              border: isAnimated ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
	                              background: isAnimated ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
	                              color: '#fff',
	                              fontWeight: 900,
	                              cursor: 'pointer',
	                            }}
                          >
                            Animated
                          </button>
	                        </div>
	                      </div>

	                      {isPositioned ? (
	                          <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
	                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, alignItems: 'end' }}>
	                            <div />
	                            <div style={{ gridColumn: '2 / 4', color: '#ddd', fontSize: 14, fontWeight: 900 }}>Insets (px)</div>
	                            <div style={{ color: '#ddd', fontSize: 14, fontWeight: 900 }}>Size (% width)</div>
	                            <div style={{ color: '#bbb', fontSize: 13, textAlign: 'left' }}>Left/Right</div>
	                            <div style={{ color: '#bbb', fontSize: 13, textAlign: 'left' }}>Top/Bottom</div>
	                            <select
	                              value={String(graphicEditor.sizePctWidth)}
	                              onChange={(e) => {
	                                const v = Math.round(Number(e.target.value))
	                                setGraphicEditor((p) => (p ? { ...p, sizePctWidth: v } : p))
	                              }}
	                              style={{
	                                width: '100%',
	                                padding: '10px 12px',
	                                borderRadius: 12,
	                                border: '1px solid rgba(255,255,255,0.16)',
	                                background: '#0c0c0c',
	                                color: '#fff',
	                                fontWeight: 900,
                                  boxSizing: 'border-box',
	                              }}
	                            >
	                              {[25, 33, 40, 50, 60, 70, 80, 90, 100].map((n) => (
	                                <option key={n} value={String(n)}>
	                                  {n}%
	                                </option>
	                              ))}
	                            </select>
	                            <input
	                              type="number"
	                              inputMode="numeric"
	                              min={0}
	                              max={300}
	                              value={String(graphicEditor.insetXPx)}
	                              onChange={(e) => {
	                                const v = Math.round(clamp(Number(e.target.value), 0, 300))
	                                setGraphicEditor((p) => (p ? { ...p, insetXPx: v } : p))
	                              }}
	                              style={{
	                                width: '100%',
	                                padding: '10px 12px',
	                                borderRadius: 12,
	                                border: '1px solid rgba(255,255,255,0.16)',
	                                background: '#0c0c0c',
	                                color: '#fff',
	                                fontWeight: 900,
                                  boxSizing: 'border-box',
	                              }}
	                              aria-label="Horizontal inset px"
	                              title="Horizontal inset (px)"
	                            />
	                            <input
	                              type="number"
	                              inputMode="numeric"
	                              min={0}
	                              max={300}
	                              value={String(graphicEditor.insetYPx)}
	                              onChange={(e) => {
	                                const v = Math.round(clamp(Number(e.target.value), 0, 300))
	                                setGraphicEditor((p) => (p ? { ...p, insetYPx: v } : p))
	                              }}
	                              style={{
	                                width: '100%',
	                                padding: '10px 12px',
	                                borderRadius: 12,
	                                border: '1px solid rgba(255,255,255,0.16)',
	                                background: '#0c0c0c',
	                                color: '#fff',
	                                fontWeight: 900,
                                  boxSizing: 'border-box',
	                              }}
	                              aria-label="Vertical inset px"
	                              title="Vertical inset (px)"
	                            />
	                          </div>

	                          <div>
	                            <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Position</div>
	                            {(() => {
	                              const cells: Array<{ key: any; label: string }> = [
	                                { key: 'top_left', label: '↖' },
	                                { key: 'top_center', label: '↑' },
	                                { key: 'top_right', label: '↗' },
	                                { key: 'middle_left', label: '←' },
	                                { key: 'middle_center', label: '•' },
	                                { key: 'middle_right', label: '→' },
	                                { key: 'bottom_left', label: '↙' },
	                                { key: 'bottom_center', label: '↓' },
	                                { key: 'bottom_right', label: '↘' },
	                              ]
	                              return (
	                                <div
	                                  style={{
	                                    display: 'grid',
	                                    gridTemplateColumns: 'repeat(3, 1fr)',
	                                    gap: 8,
	                                    maxWidth: 240,
	                                  }}
	                                >
	                                  {cells.map((c) => {
	                                    const selected = String(graphicEditor.position) === String(c.key)
	                                    return (
	                                      <button
	                                        key={String(c.key)}
	                                        type="button"
	                                        onClick={() => setGraphicEditor((p) => (p ? { ...p, position: c.key as any } : p))}
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
	                          </div>
	                        </div>
	                      ) : isAnimated ? (
                          <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
                            {!isDocReveal ? (
                              <div style={{ display: 'grid', gap: 12 }}>
	                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, alignItems: 'end' }}>
	                                  <div />
	                                  <div style={{ gridColumn: '2 / 4', color: '#ddd', fontSize: 14, fontWeight: 900 }}>Insets (px)</div>
	                                  <div style={{ color: '#ddd', fontSize: 14, fontWeight: 900 }}>Size (% width)</div>
	                                  <div style={{ color: '#bbb', fontSize: 13, textAlign: 'left' }}>Left/Right</div>
	                                  <div style={{ color: '#bbb', fontSize: 13, textAlign: 'left' }}>Top/Bottom</div>
	                                  <select
	                                    value={String(graphicEditor.sizePctWidth)}
	                                    onChange={(e) => {
	                                      const v = Math.round(Number(e.target.value))
	                                      setGraphicEditor((p) => (p ? { ...p, sizePctWidth: v } : p))
	                                    }}
	                                    style={{
	                                      width: '100%',
	                                      padding: '10px 12px',
	                                      borderRadius: 12,
	                                      border: '1px solid rgba(255,255,255,0.16)',
	                                      background: '#0c0c0c',
	                                      color: '#fff',
	                                      fontWeight: 900,
	                                      boxSizing: 'border-box',
	                                    }}
	                                  >
	                                    {[25, 33, 40, 50, 60, 70, 80, 90, 100].map((n) => (
	                                      <option key={n} value={String(n)}>
	                                        {n}%
	                                      </option>
	                                    ))}
	                                  </select>
	                                  <input
	                                    type="number"
	                                    inputMode="numeric"
	                                    min={0}
	                                    max={300}
	                                    disabled
	                                    value={String(graphicEditor.insetXPx)}
	                                    style={{
	                                      width: '100%',
	                                      padding: '10px 12px',
	                                      borderRadius: 12,
	                                      border: '1px solid rgba(255,255,255,0.16)',
	                                      background: '#0c0c0c',
	                                      color: '#fff',
	                                      fontWeight: 900,
	                                      boxSizing: 'border-box',
	                                      opacity: 0.45,
	                                      cursor: 'not-allowed',
	                                    }}
	                                    aria-label="Horizontal inset px (disabled for slide animation)"
	                                    title="Horizontal inset is locked for slide animation"
	                                  />
	                                  <input
	                                    type="number"
	                                    inputMode="numeric"
	                                    min={0}
	                                    max={300}
	                                    value={String(graphicEditor.insetYPx)}
	                                    onChange={(e) => {
	                                      const v = Math.round(clamp(Number(e.target.value), 0, 300))
	                                      setGraphicEditor((p) => (p ? { ...p, insetYPx: v } : p))
	                                    }}
	                                    style={{
	                                      width: '100%',
	                                      padding: '10px 12px',
	                                      borderRadius: 12,
	                                      border: '1px solid rgba(255,255,255,0.16)',
	                                      background: '#0c0c0c',
	                                      color: '#fff',
	                                      fontWeight: 900,
	                                      boxSizing: 'border-box',
	                                    }}
	                                    aria-label="Vertical inset px"
	                                    title="Vertical inset (px)"
	                                  />
	                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Position</div>
                                  {(() => {
                                    const cells: Array<{ key: any; label: string }> = [
                                      { key: 'top_left', label: '↖' },
                                      { key: 'top_center', label: '↑' },
                                      { key: 'top_right', label: '↗' },
                                      { key: 'middle_left', label: '←' },
                                      { key: 'middle_center', label: '•' },
                                      { key: 'middle_right', label: '→' },
                                      { key: 'bottom_left', label: '↙' },
                                      { key: 'bottom_center', label: '↓' },
                                      { key: 'bottom_right', label: '↘' },
                                    ]
                                    return (
                                      <div
                                        style={{
                                          display: 'grid',
                                          gridTemplateColumns: 'repeat(3, 1fr)',
                                          gap: 8,
                                          maxWidth: 240,
                                        }}
                                      >
                                        {cells.map((c) => {
                                          const key = String(c.key)
                                          const selected = String(graphicEditor.position) === key
                                          const enabled = key.endsWith('_center')
                                          return (
                                            <button
                                              key={key}
                                              type="button"
                                              onClick={() => {
                                                if (!enabled) return
                                                setGraphicEditor((p) => (p ? { ...p, position: c.key as any } : p))
                                              }}
                                              disabled={!enabled}
                                              style={{
                                                height: 44,
                                                borderRadius: 12,
	                                                border: selected ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
	                                                background: selected ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                                                color: '#fff',
                                                fontWeight: 900,
                                                cursor: enabled ? 'pointer' : 'not-allowed',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: 18,
                                                opacity: enabled ? 1 : 0.45,
                                              }}
                                              aria-label={`Position ${key}${enabled ? '' : ' (disabled for slide animation)'}`}
                                            >
                                              {c.label}
                                            </button>
                                          )
                                        })}
                                      </div>
                                    )
                                  })()}
                                </div>
                              </div>
                            ) : null}
                            <div style={{ color: '#888', fontSize: 12 }}>
                              {isDocReveal
                                ? 'Document Reveal is designed for portrait documents (1080×1920).'
                                : 'Slide animation locks horizontal position; use the center column for top/middle/bottom placement.'}
                            </div>
                          </div>
                        ) : (
	                        <div style={{ marginTop: 10, color: '#888', fontSize: 13 }}>
	                          Full-frame graphics fill the canvas and may crop to cover.
	                        </div>
	                      )}
	                    </div>

	                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
	                      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Effects</div>
	                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, alignItems: 'end' }}>
	                          {isAnimated ? (
	                            <div>
                              <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Animation</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
                                <select
                                  value={String(graphicEditor.animate || 'none') === 'doc_reveal' ? 'doc_reveal' : 'slide_in_out'}
                                  onChange={(e) =>
                                    setGraphicEditor((p) => {
                                      if (!p) return p
                                      const next = e.target.value as any
                                      if (next === 'doc_reveal') {
                                        return {
                                          ...p,
                                          animate: next,
                                          sizePctWidth: 100,
                                          position: 'middle_center',
                                          insetXPx: 0,
                                          insetYPx: 0,
                                        }
                                      }
                                      return { ...p, animate: next }
                                    })
                                  }
                                  style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: 12,
                                    border: '1px solid rgba(255,255,255,0.16)',
                                    background: '#0c0c0c',
                                    color: '#fff',
                                    fontWeight: 900,
                                    boxSizing: 'border-box',
                                  }}
                                >
                                  <option value="slide_in_out">Slide In + Out</option>
                                  <option value="doc_reveal">Document Reveal</option>
                                </select>
	                                <select
	                                  value={String(normalizeSpeedPresetMs(Number(graphicEditor.animateDurationMs), 600))}
	                                  onChange={(e) => {
	                                    const v = Math.round(Number(e.target.value))
	                                    setGraphicEditor((p) => (p ? { ...p, animateDurationMs: v } : p))
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: 12,
                                    border: '1px solid rgba(255,255,255,0.16)',
                                    background: '#0c0c0c',
                                    color: '#fff',
                                    fontWeight: 900,
                                    boxSizing: 'border-box',
                                  }}
                                  aria-label="Animation speed"
                                  title="Animation speed"
                                >
                                  <option value="400">Faster (400ms)</option>
                                  <option value="600">Medium (600ms)</option>
                                  <option value="800">Smoother (800ms)</option>
                                </select>
	                              </div>
	                              <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Preset durations (400–800ms).</div>
	                            </div>
	                          ) : null}
	                        <div>
	                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Fade</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
	                            <select
	                              value={isDocReveal ? 'in_out' : String(graphicEditor.fade || 'none') === 'none' ? 'none' : 'in_out'}
                                disabled={isDocReveal}
	                              onChange={(e) => setGraphicEditor((p) => (p ? { ...p, fade: e.target.value as any } : p))}
	                              style={{
	                                width: '100%',
	                                padding: '10px 12px',
	                                borderRadius: 12,
	                                border: '1px solid rgba(255,255,255,0.16)',
	                                background: '#0c0c0c',
	                                color: '#fff',
	                                fontWeight: 900,
                                  boxSizing: 'border-box',
                                  opacity: isDocReveal ? 0.65 : 1,
                                  cursor: isDocReveal ? 'not-allowed' : 'pointer',
	                              }}
	                              aria-label={isDocReveal ? 'Fade type (locked for Document Reveal)' : 'Fade type'}
	                              title={isDocReveal ? 'Document Reveal always uses Fade In/Out' : 'Fade type'}
	                            >
	                              <option value="none">None</option>
	                              <option value="in_out">Fade In/Out</option>
	                            </select>
                              <select
                                value={String(normalizeSpeedPresetMs(Number(graphicEditor.fadeDurationMs), 600))}
                                onChange={(e) => {
                                  const v = Math.round(Number(e.target.value))
                                  setGraphicEditor((p) => (p ? { ...p, fadeDurationMs: v } : p))
                                }}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  borderRadius: 12,
                                  border: '1px solid rgba(255,255,255,0.16)',
                                  background: '#0c0c0c',
                                  color: '#fff',
                                  fontWeight: 900,
                                  boxSizing: 'border-box',
                                }}
                                aria-label="Fade speed"
                                title="Fade speed"
                              >
                                <option value="400">Faster (400ms)</option>
                                <option value="600">Medium (600ms)</option>
                                <option value="800">Smoother (800ms)</option>
                              </select>
                            </div>
	                          <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>
                              {isDocReveal ? 'Document Reveal always uses fade in/out with this speed.' : 'Fade speed presets (400–800ms).'}
                            </div>
                          </div>
	                      </div>
	                      {!isFull ? (
	                        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
	                          <div>
	                            <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Border</div>
	                            <select
	                              value={String(graphicEditor.borderWidthPx || 0)}
	                              onChange={(e) => setGraphicEditor((p) => (p ? { ...p, borderWidthPx: Number(e.target.value) as any } : p))}
	                              style={{
	                                width: '100%',
	                                padding: '10px 12px',
	                                borderRadius: 12,
	                                border: '1px solid rgba(255,255,255,0.16)',
	                                background: '#0c0c0c',
	                                color: '#fff',
	                                fontWeight: 900,
                                  boxSizing: 'border-box',
	                              }}
	                            >
	                              <option value="0">None</option>
	                              <option value="2">Thin (2px)</option>
	                              <option value="4">Medium (4px)</option>
	                              <option value="6">Thick (6px)</option>
	                            </select>
	                          </div>
	                          <div>
	                            <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Border color</div>
	                            <input
	                              type="color"
	                              value={String(graphicEditor.borderColor || '#000000')}
	                              disabled={Number(graphicEditor.borderWidthPx || 0) <= 0}
	                              onChange={(e) => setGraphicEditor((p) => (p ? { ...p, borderColor: e.target.value } : p))}
	                              style={{
	                                width: '100%',
	                                height: 44,
	                                padding: 0,
	                                borderRadius: 12,
	                                border: '1px solid rgba(255,255,255,0.16)',
	                                background: '#0c0c0c',
	                                cursor: Number(graphicEditor.borderWidthPx || 0) <= 0 ? 'default' : 'pointer',
	                                opacity: Number(graphicEditor.borderWidthPx || 0) <= 0 ? 0.5 : 1,
                                  boxSizing: 'border-box',
	                              }}
	                            />
	                            <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>
	                              Default: black
	                            </div>
	                          </div>
	                        </div>
	                      ) : null}
	                    </div>

	                  </>
	                )
	              })()}
              {graphicEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{graphicEditorError}</div> : null}
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
