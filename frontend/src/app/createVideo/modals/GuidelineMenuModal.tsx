import React from 'react'

export default function GuidelineMenuModal(props: any) {
  const ctx = props?.ctx || props
  const { closeGuidelineMenu, guidelineMenuOpen, guidelines, removeAllGuidelines, removeNearestGuideline } = ctx as any

  if (!guidelineMenuOpen) return null

  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 1400 }} onPointerDown={() => closeGuidelineMenu()}>
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 200,
          background: 'rgba(0,0,0,0.92)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 12,
          padding: 8,
          display: 'grid',
          gap: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 4px' }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#bbb' }}>Guidelines</div>
          <button
            type="button"
            onClick={() => closeGuidelineMenu()}
            style={{
              width: 28,
              height: 28,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.06)',
              color: '#fff',
              fontWeight: 900,
              cursor: 'pointer',
              lineHeight: '26px',
              textAlign: 'center',
            }}
          >
            ×
          </button>
        </div>

        <button
          type="button"
          disabled={!guidelines.length}
          onClick={() => {
            removeNearestGuideline()
            closeGuidelineMenu()
          }}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: guidelines.length ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.06)',
            color: '#fff',
            fontWeight: 900,
            cursor: guidelines.length ? 'pointer' : 'default',
            textAlign: 'left',
          }}
        >
          Remove nearest
        </button>

        <button
          type="button"
          disabled={!guidelines.length}
          onClick={() => {
            removeAllGuidelines()
            closeGuidelineMenu()
          }}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,155,155,0.40)',
            background: guidelines.length ? 'rgba(255,0,0,0.14)' : 'rgba(255,255,255,0.06)',
            color: '#fff',
            fontWeight: 900,
            cursor: guidelines.length ? 'pointer' : 'default',
            textAlign: 'left',
          }}
        >
          Remove all
        </button>
      </div>
    </div>
  )
}
