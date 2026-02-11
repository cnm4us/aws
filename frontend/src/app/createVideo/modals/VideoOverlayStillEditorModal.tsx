import React from 'react'
import { clamp, roundToTenth } from '../timelineMath'

type VideoOverlayStillEditorState = { id: string; start: number; end: number }

type VideoOverlayStillEditorModalProps = {
  videoOverlayStillEditor: VideoOverlayStillEditorState
  videoOverlayStillEditorError: string | null
  setVideoOverlayStillEditor: React.Dispatch<React.SetStateAction<VideoOverlayStillEditorState | null>>
  setVideoOverlayStillEditorError: React.Dispatch<React.SetStateAction<string | null>>
  onClose: () => void
  onSave: () => void
}

export default function VideoOverlayStillEditorModal({
  videoOverlayStillEditor,
  videoOverlayStillEditorError,
  setVideoOverlayStillEditor,
  setVideoOverlayStillEditorError,
  onClose,
  onSave,
}: VideoOverlayStillEditorModalProps) {
  const start = Number(videoOverlayStillEditor.start)
  const end = Number(videoOverlayStillEditor.end)
  const minLen = 0.1
  const cap = 20 * 60

  const adjustStart = (delta: number) => {
    setVideoOverlayStillEditorError(null)
    setVideoOverlayStillEditor((p) => {
      if (!p) return p
      const next = roundToTenth(Number(p.start) + delta)
      const maxStart = Math.max(0, Number(p.end) - minLen)
      return { ...p, start: clamp(next, 0, maxStart) }
    })
  }

  const adjustEnd = (delta: number) => {
    setVideoOverlayStillEditorError(null)
    setVideoOverlayStillEditor((p) => {
      if (!p) return p
      const next = roundToTenth(Number(p.end) + delta)
      const minEnd = Math.max(0, Number(p.start) + minLen)
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

  const canStartDec01 = Number.isFinite(start) && start - 0.1 >= 0 - 1e-9
  const canStartInc01 = Number.isFinite(start) && Number.isFinite(end) && start + 0.1 <= end - minLen + 1e-9
  const canEndDec01 = Number.isFinite(start) && Number.isFinite(end) && end - 0.1 >= start + minLen - 1e-9
  const canEndInc01 = Number.isFinite(end) && end + 0.1 <= cap + 1e-9

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
          <div style={{ fontSize: 18, fontWeight: 900 }}>Overlay Freeze Frame Properties</div>
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

          {videoOverlayStillEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{videoOverlayStillEditorError}</div> : null}
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

