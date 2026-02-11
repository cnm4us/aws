import React from 'react'

type NarrationEditorState = {
  id: string
  start: number
  end: number
  boostDb: number
}

type NarrationEditorModalProps = {
  narrationEditor: NarrationEditorState
  narrationEditorError: string | null
  setNarrationEditor: React.Dispatch<React.SetStateAction<NarrationEditorState | null>>
  setNarrationEditorError: React.Dispatch<React.SetStateAction<string | null>>
  narration: any[]
  namesByUploadId: Record<number, string>
  audioPreviewPlayingId: number | null
  toggleAudioPreview: (uploadId: number) => void
  onClose: () => void
  onSave: () => void
}

export default function NarrationEditorModal({
  narrationEditor,
  narrationEditorError,
  setNarrationEditor,
  setNarrationEditorError,
  narration,
  namesByUploadId,
  audioPreviewPlayingId,
  toggleAudioPreview,
  onClose,
  onSave,
}: NarrationEditorModalProps) {
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
          <div style={{ fontSize: 18, fontWeight: 900 }}>Narration Properties</div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
          >
            Close
          </button>
        </div>

        {(() => {
          const seg = narration.find((n: any) => String((n as any).id) === String(narrationEditor.id)) as any
          const uploadId = seg ? Number(seg.uploadId) : null
          const name = uploadId != null ? namesByUploadId[uploadId] || `Narration ${uploadId}` : 'Narration'
          const isPlaying = uploadId != null && audioPreviewPlayingId === uploadId
          return (
            <div style={{ marginTop: 10, color: '#bbb', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 900, color: '#fff' }}>{name}</div>
                {uploadId != null ? (
                  <button
                    type="button"
                    onClick={() => toggleAudioPreview(uploadId)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: isPlaying ? 'rgba(48,209,88,0.20)' : 'rgba(255,255,255,0.06)',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    {isPlaying ? 'Pause preview' : 'Play preview'}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })()}

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
            <input
              type="number"
              step={0.1}
              min={0}
              value={String(narrationEditor.start)}
              onChange={(e) => {
                setNarrationEditorError(null)
                setNarrationEditor((p) => (p ? { ...p, start: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
            <input
              type="number"
              step={0.1}
              min={0}
              value={String(narrationEditor.end)}
              onChange={(e) => {
                setNarrationEditorError(null)
                setNarrationEditor((p) => (p ? { ...p, end: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Boost</div>
            <select
              value={String(narrationEditor.boostDb)}
              onChange={(e) => {
                setNarrationEditorError(null)
                setNarrationEditor((p) => (p ? { ...p, boostDb: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            >
              <option value="0">None</option>
              <option value="3">+3 dB</option>
              <option value="6">+6 dB</option>
              <option value="9">+9 dB</option>
            </select>
          </label>

          {narrationEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{narrationEditorError}</div> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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
