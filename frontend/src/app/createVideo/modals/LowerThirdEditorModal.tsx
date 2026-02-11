import React from 'react'

type LowerThirdEditorState = {
  id: string
  configId: number
  start: number
  end: number
}

type LowerThirdEditorModalProps = {
  lowerThirdEditor: LowerThirdEditorState
  lowerThirdEditorError: string | null
  setLowerThirdEditor: React.Dispatch<React.SetStateAction<LowerThirdEditorState | null>>
  setLowerThirdEditorError: React.Dispatch<React.SetStateAction<string | null>>
  lowerThirds: any[]
  lowerThirdConfigs: any[]
  namesByUploadId: Record<number, string>
  onClose: () => void
  onSave: () => void
}

export default function LowerThirdEditorModal({
  lowerThirdEditor,
  lowerThirdEditorError,
  setLowerThirdEditor,
  setLowerThirdEditorError,
  lowerThirds,
  lowerThirdConfigs,
  namesByUploadId,
  onClose,
  onSave,
}: LowerThirdEditorModalProps) {
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
          <div style={{ fontSize: 18, fontWeight: 900 }}>Lower Third Properties</div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
          >
            Close
          </button>
        </div>

        {(() => {
          const seg = lowerThirds.find((lt) => String((lt as any).id) === String(lowerThirdEditor.id)) as any
          const uploadId = Number(seg?.uploadId)
          const name = Number.isFinite(uploadId) && uploadId > 0 ? namesByUploadId[uploadId] || `Lower third ${uploadId}` : 'Lower third'
          const cfgName = seg?.configSnapshot?.name || (seg?.configId ? `Config ${seg.configId}` : 'Config')
          return <div style={{ marginTop: 10, color: '#bbb', fontSize: 13 }}>{name} • {cfgName}</div>
        })()}

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Lower Third Config</div>
            <select
              value={String(lowerThirdEditor.configId)}
              onChange={(e) => {
                setLowerThirdEditorError(null)
                setLowerThirdEditor((p) => (p ? { ...p, configId: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            >
              {lowerThirdConfigs
                .filter((c: any) => !(c && typeof c === 'object' && c.archived_at))
                .map((c: any) => (
                  <option key={`ltcfg-${c.id}`} value={String(c.id)}>{String(c.name || `Config ${c.id}`)}</option>
                ))}
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
              <input
                type="number"
                step={0.1}
                min={0}
                value={String(lowerThirdEditor.start)}
                onChange={(e) => {
                  setLowerThirdEditorError(null)
                  setLowerThirdEditor((p) => (p ? { ...p, start: Number(e.target.value) } : p))
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
                value={String(lowerThirdEditor.end)}
                onChange={(e) => {
                  setLowerThirdEditorError(null)
                  setLowerThirdEditor((p) => (p ? { ...p, end: Number(e.target.value) } : p))
                }}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
              />
            </label>
          </div>

          {lowerThirdEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{lowerThirdEditorError}</div> : null}

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
