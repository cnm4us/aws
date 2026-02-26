import React from 'react'

export type VisualizerEditorState = {
  id: string
  start: number
  end: number
  presetId: number
  audioSourceKind: 'video' | 'video_overlay' | 'narration' | 'music'
  audioSourceSegmentId: string | null
}

type VisualizerPresetItem = {
  id: number
  name: string
}

type VisualizerEditorModalProps = {
  visualizerEditor: VisualizerEditorState
  visualizerEditorError: string | null
  setVisualizerEditor: React.Dispatch<React.SetStateAction<VisualizerEditorState | null>>
  setVisualizerEditorError: React.Dispatch<React.SetStateAction<string | null>>
  visualizerPresets: VisualizerPresetItem[]
  clips: any[]
  clipStarts: number[]
  videoOverlays: any[]
  videoOverlayStarts: number[]
  narration: any[]
  audioSegments: any[]
  namesByUploadId: Record<number, string>
  onClose: () => void
  onSave: () => void
}

type SourceOption = { id: string; label: string }

export default function VisualizerEditorModal({
  visualizerEditor,
  visualizerEditorError,
  setVisualizerEditor,
  setVisualizerEditorError,
  visualizerPresets,
  clips,
  clipStarts,
  videoOverlays,
  videoOverlayStarts,
  narration,
  audioSegments,
  namesByUploadId,
  onClose,
  onSave,
}: VisualizerEditorModalProps) {
  const presetOptions = Array.isArray(visualizerPresets) ? visualizerPresets : []

  const sourceOptions = React.useMemo<SourceOption[]>(() => {
    const kind = String(visualizerEditor.audioSourceKind || 'narration')
    if (kind === 'video') {
      return (clips || []).map((c: any) => ({
        id: String(c?.id || ''),
        label: namesByUploadId[Number(c?.uploadId)] || `Video ${Number(c?.uploadId) || ''}`,
      }))
    }
    if (kind === 'video_overlay') {
      return (videoOverlays || []).map((o: any) => ({
        id: String(o?.id || ''),
        label: namesByUploadId[Number(o?.uploadId)] || `Overlay ${Number(o?.uploadId) || ''}`,
      }))
    }
    if (kind === 'music') {
      return (audioSegments || []).map((seg: any) => ({
        id: String(seg?.id || ''),
        label: namesByUploadId[Number(seg?.uploadId)] || `Audio ${Number(seg?.uploadId) || ''}`,
      }))
    }
    return (narration || []).map((n: any) => ({
      id: String(n?.id || ''),
      label: namesByUploadId[Number(n?.uploadId)] || `Narration ${Number(n?.uploadId) || ''}`,
    }))
  }, [audioSegments, clips, narration, namesByUploadId, videoOverlays, visualizerEditor.audioSourceKind])

  React.useEffect(() => {
    if (!visualizerEditor) return
    const cur = String(visualizerEditor.audioSourceSegmentId || '')
    if (!sourceOptions.length) {
      if (cur) {
        setVisualizerEditor((prev) => (prev ? { ...prev, audioSourceSegmentId: null } : prev))
      }
      return
    }
    if (!sourceOptions.some((opt) => opt.id === cur)) {
      setVisualizerEditor((prev) => (prev ? { ...prev, audioSourceSegmentId: sourceOptions[0].id } : prev))
    }
  }, [setVisualizerEditor, sourceOptions, visualizerEditor])

  const pickRebindCandidate = React.useCallback(() => {
    const start = Number(visualizerEditor.start)
    const end = Number(visualizerEditor.end)
    const kind = String(visualizerEditor.audioSourceKind || 'narration')
    const rangeStart = Number.isFinite(start) ? start : 0
    const rangeEnd = Number.isFinite(end) && end > rangeStart ? end : rangeStart

    const pickFrom = (segments: Array<{ id: string; startSeconds: number; endSeconds: number }>) => {
      if (!segments.length) return null
      const within = segments.find((s) => rangeStart + 1e-6 >= s.startSeconds && rangeStart <= s.endSeconds - 1e-6)
      if (within) return within.id
      const overlap = segments.find((s) => s.startSeconds < rangeEnd - 1e-6 && s.endSeconds > rangeStart + 1e-6)
      if (overlap) return overlap.id
      return segments[0].id
    }

    if (kind === 'video') {
      const segments = (clips || []).map((c: any, idx: number) => ({
        id: String(c?.id || ''),
        startSeconds: Number((clipStarts as any)[idx] || 0),
        endSeconds: Number((clipStarts as any)[idx] || 0) + Math.max(0, Number(c?.sourceEndSeconds || 0) - Number(c?.sourceStartSeconds || 0)),
      }))
      return pickFrom(segments)
    }
    if (kind === 'video_overlay') {
      const segments = (videoOverlays || []).map((o: any, idx: number) => ({
        id: String(o?.id || ''),
        startSeconds: Number((videoOverlayStarts as any)[idx] || 0),
        endSeconds: Number((videoOverlayStarts as any)[idx] || 0) + Math.max(0, Number(o?.sourceEndSeconds || 0) - Number(o?.sourceStartSeconds || 0)),
      }))
      return pickFrom(segments)
    }
    if (kind === 'music') {
      const segments = (audioSegments || []).map((s: any) => ({
        id: String(s?.id || ''),
        startSeconds: Number(s?.startSeconds || 0),
        endSeconds: Number(s?.endSeconds || 0),
      }))
      return pickFrom(segments)
    }
    const segments = (narration || []).map((n: any) => ({
      id: String(n?.id || ''),
      startSeconds: Number(n?.startSeconds || 0),
      endSeconds: Number(n?.endSeconds || 0),
    }))
    return pickFrom(segments)
  }, [audioSegments, clipStarts, clips, narration, videoOverlayStarts, videoOverlays, visualizerEditor])

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
          <div style={{ fontSize: 18, fontWeight: 900 }}>Visualizer Properties</div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
          >
            Close
          </button>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Preset</div>
            <select
              value={visualizerEditor.presetId ? String(visualizerEditor.presetId) : ''}
              onChange={(e) => {
                setVisualizerEditorError(null)
                const next = Number(e.target.value || 0)
                setVisualizerEditor((prev) => (prev ? { ...prev, presetId: Number.isFinite(next) ? next : 0 } : prev))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            >
              <option value="">Select…</option>
              {presetOptions.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name || `Preset ${p.id}`}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Start (s)</div>
              <input
                type="number"
                step="0.1"
                value={Number.isFinite(visualizerEditor.start) ? String(visualizerEditor.start) : ''}
                onChange={(e) => {
                  setVisualizerEditorError(null)
                  const next = Number(e.target.value)
                  setVisualizerEditor((prev) => (prev ? { ...prev, start: next } : prev))
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>End (s)</div>
              <input
                type="number"
                step="0.1"
                value={Number.isFinite(visualizerEditor.end) ? String(visualizerEditor.end) : ''}
                onChange={(e) => {
                  setVisualizerEditorError(null)
                  const next = Number(e.target.value)
                  setVisualizerEditor((prev) => (prev ? { ...prev, end: next } : prev))
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Audio Source</div>
              <select
                value={visualizerEditor.audioSourceKind}
                onChange={(e) => {
                  setVisualizerEditorError(null)
                  const next = String(e.target.value || '')
                  setVisualizerEditor((prev) => (prev ? { ...prev, audioSourceKind: next as any } : prev))
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              >
                <option value="video">Video</option>
                <option value="video_overlay">Video Overlay</option>
                <option value="narration">Narration</option>
                <option value="music">Music</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Segment</div>
              <select
                value={visualizerEditor.audioSourceSegmentId || ''}
                onChange={(e) => {
                  setVisualizerEditorError(null)
                  const next = String(e.target.value || '')
                  setVisualizerEditor((prev) => (prev ? { ...prev, audioSourceSegmentId: next || null } : prev))
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              >
                {!sourceOptions.length ? <option value="">No segments available</option> : null}
                {sourceOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => {
                setVisualizerEditorError(null)
                const nextId = pickRebindCandidate()
                if (!nextId) {
                  setVisualizerEditorError('No matching source segment to rebind.')
                  return
                }
                setVisualizerEditor((prev) => (prev ? { ...prev, audioSourceSegmentId: nextId } : prev))
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.22)',
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Rebind
            </button>
          </div>
        </div>

        {visualizerEditorError ? <div style={{ marginTop: 12, color: '#ff9b9b', fontWeight: 800 }}>{visualizerEditorError}</div> : null}

        <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onSave}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px solid rgba(10,132,255,0.75)',
              background: 'rgba(10,132,255,0.24)',
              color: '#fff',
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
