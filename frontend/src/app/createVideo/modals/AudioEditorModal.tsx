import React from 'react'

type AudioEditorState = {
  id: string
  start: number
  end: number
  audioConfigId: number
  audioEnabled: boolean
  musicMode: '' | 'opener_cutoff' | 'replace' | 'mix' | 'mix_duck'
  musicLevel: '' | 'quiet' | 'medium' | 'loud'
  duckingIntensity: '' | 'min' | 'medium' | 'max'
}

type AudioEditorModalProps = {
  audioEditor: AudioEditorState
  audioEditorError: string | null
  setAudioEditor: React.Dispatch<React.SetStateAction<AudioEditorState | null>>
  setAudioEditorError: React.Dispatch<React.SetStateAction<string | null>>
  audioSegments: any[]
  namesByUploadId: Record<number, string>
  audioConfigNameById: Record<number, string>
  audioPreviewPlayingId: number | null
  toggleAudioPreview: (uploadId: number, options?: { beforePlay?: (player: HTMLAudioElement) => void }) => void
  playPauseGlyph: (isPlaying: boolean) => string
  onClose: () => void
  onSave: () => void
}

export default function AudioEditorModal({
  audioEditor,
  audioEditorError,
  setAudioEditor,
  setAudioEditorError,
  audioSegments,
  namesByUploadId,
  audioConfigNameById,
  audioPreviewPlayingId,
  toggleAudioPreview,
  playPauseGlyph,
  onClose,
  onSave,
}: AudioEditorModalProps) {
  const seg: any = audioSegments.find((s: any) => String(s?.id) === String(audioEditor.id))
  const uploadId = seg ? Number(seg.uploadId) : NaN
  const audioConfigId = seg?.audioConfigId == null ? null : Number(seg.audioConfigId)
  const mode = seg?.musicMode ? String(seg.musicMode) : ''
  const level = seg?.musicLevel ? String(seg.musicLevel) : ''

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
          <div style={{ fontSize: 18, fontWeight: 900 }}>Audio Properties</div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
          >
            Close
          </button>
        </div>

        {seg ? (
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ color: '#fff', fontWeight: 900 }}>
              {namesByUploadId[uploadId] || `Audio ${uploadId}`}
              {audioConfigId && (audioConfigNameById[audioConfigId] || `Config ${audioConfigId}`) ? (
                <span style={{ color: '#bbb', fontWeight: 800 }}>{' * ' + (audioConfigNameById[audioConfigId] || `Config ${audioConfigId}`)}</span>
              ) : null}
              {mode && level ? <span style={{ color: '#bbb', fontWeight: 800 }}>{' * ' + mode + ' ' + level}</span> : null}
            </div>
            <button
              type="button"
              onClick={() => toggleAudioPreview(uploadId)}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(48,209,88,0.65)',
                background: audioPreviewPlayingId === uploadId ? 'rgba(48,209,88,0.22)' : 'rgba(48,209,88,0.12)',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
                minWidth: 44,
                height: 40,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={audioPreviewPlayingId === uploadId ? 'Pause preview' : 'Play preview'}
              aria-label={audioPreviewPlayingId === uploadId ? 'Pause preview' : 'Play preview'}
            >
              <span style={{ display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
                {playPauseGlyph(audioPreviewPlayingId === uploadId)}
              </span>
            </button>
          </div>
        ) : null}

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6, maxWidth: 240 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Audio</div>
            <select
              value={audioEditor.audioEnabled ? 'on' : 'off'}
              onChange={(e) => {
                setAudioEditorError(null)
                const next = String(e.target.value || '') === 'on'
                setAudioEditor((p) => (p ? ({ ...p, audioEnabled: next } as any) : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Music Mode</div>
              <select
                value={String(audioEditor.musicMode)}
                onChange={(e) => {
                  setAudioEditorError(null)
                  const next = String(e.target.value || '')
                  setAudioEditor((p) =>
                    p
                      ? ({
                          ...p,
                          musicMode: next as any,
                          ...(next !== 'mix_duck' ? { duckingIntensity: '' } : {}),
                        } as any)
                      : p
                  )
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              >
                <option value="">Select…</option>
                <option value="opener_cutoff">Opener (auto-cut on speech)</option>
                <option value="replace">Replace</option>
                <option value="mix">Mix (no ducking)</option>
                <option value="mix_duck">Mix + Ducking</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Music Level</div>
              <select
                value={String(audioEditor.musicLevel)}
                onChange={(e) => {
                  setAudioEditorError(null)
                  setAudioEditor((p) => (p ? ({ ...p, musicLevel: String(e.target.value || '') as any } as any) : p))
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              >
                <option value="">Select…</option>
                <option value="quiet">Quiet</option>
                <option value="medium">Medium</option>
                <option value="loud">Loud</option>
              </select>
            </label>
          </div>

          {String(audioEditor.musicMode) === 'mix_duck' ? (
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Ducking</div>
              <select
                value={String(audioEditor.duckingIntensity)}
                onChange={(e) => {
                  setAudioEditorError(null)
                  setAudioEditor((p) => (p ? ({ ...p, duckingIntensity: String(e.target.value || '') as any } as any) : p))
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              >
                <option value="">Select…</option>
                <option value="min">Min</option>
                <option value="medium">Medium</option>
                <option value="max">Max</option>
              </select>
            </label>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
              <input
                type="number"
                step={0.1}
                min={0}
                value={String(audioEditor.start)}
                onChange={(e) => {
                  setAudioEditorError(null)
                  setAudioEditor((p) => (p ? { ...p, start: Number(e.target.value) } : p))
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
                value={String(audioEditor.end)}
                onChange={(e) => {
                  setAudioEditorError(null)
                  setAudioEditor((p) => (p ? { ...p, end: Number(e.target.value) } : p))
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              />
            </label>
          </div>

          {audioEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{audioEditorError}</div> : null}

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
