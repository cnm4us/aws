import React from 'react'

type ScreenTitlePlacementAdvancedModalProps = {
  screenTitlePlacementEditor: any
  setScreenTitlePlacementEditor: React.Dispatch<React.SetStateAction<any>>
  screenTitlePlacementError: string | null
  setScreenTitlePlacementError: React.Dispatch<React.SetStateAction<string | null>>
  setScreenTitlePlacementAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>
  normalizeScreenTitlePlacementRectForEditor: (rect: any) => any
  defaultScreenTitlePlacementRect: () => any
  screenTitlePlacementStageRef: React.RefObject<HTMLDivElement | null>
  screenTitlePlacementControlMode: string
  setScreenTitlePlacementControlMode: React.Dispatch<React.SetStateAction<any>>
  screenTitlePlacementMoveVertical: boolean
  screenTitlePlacementMoveHorizontal: boolean
  beginScreenTitlePlacementDrag: (kind: any, activeRect: any, e: React.PointerEvent<any>) => void
  SCREEN_TITLE_PLACEMENT_MIN_W_PCT: number
  SCREEN_TITLE_PLACEMENT_MIN_H_PCT: number
  screenTitleRenderBusy: boolean
  saveScreenTitlePlacement: (closeEditorOnSuccess?: boolean) => Promise<void>
}

export default function ScreenTitlePlacementAdvancedModal({
  screenTitlePlacementEditor,
  setScreenTitlePlacementEditor,
  screenTitlePlacementError,
  setScreenTitlePlacementError,
  setScreenTitlePlacementAdvancedOpen,
  normalizeScreenTitlePlacementRectForEditor,
  defaultScreenTitlePlacementRect,
  screenTitlePlacementStageRef,
  screenTitlePlacementControlMode,
  setScreenTitlePlacementControlMode,
  screenTitlePlacementMoveVertical,
  screenTitlePlacementMoveHorizontal,
  beginScreenTitlePlacementDrag,
  SCREEN_TITLE_PLACEMENT_MIN_W_PCT,
  SCREEN_TITLE_PLACEMENT_MIN_H_PCT,
  screenTitleRenderBusy,
  saveScreenTitlePlacement,
}: ScreenTitlePlacementAdvancedModalProps) {
  return (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 96px' }}
          onClick={() => { setScreenTitlePlacementAdvancedOpen(false); setScreenTitlePlacementError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 640,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
          >
            {(() => {
              const instances = Array.isArray(screenTitlePlacementEditor.instances) ? screenTitlePlacementEditor.instances : []
              const activeInstanceId = String(screenTitlePlacementEditor.activeInstanceId || '')
              const activeIndex = instances.findIndex((inst) => String(inst.id) === activeInstanceId)
              const activeInstance = activeIndex >= 0 ? instances[activeIndex] : instances[0]
              const activeRect = normalizeScreenTitlePlacementRectForEditor((activeInstance?.customStyle as any)?.placementRect)
              const safeRect = defaultScreenTitlePlacementRect()
              const handleStyle: React.CSSProperties = {
                position: 'absolute',
                width: 16,
                height: 16,
                borderRadius: 8,
                border: '2px solid rgba(96,165,250,1)',
                background: 'rgba(8,12,18,0.95)',
                cursor: 'pointer',
                touchAction: 'none',
                boxSizing: 'border-box',
              }

              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>Customize Screen Title Placement</div>
                    <button
                      type="button"
                      onClick={() => { setScreenTitlePlacementAdvancedOpen(false); setScreenTitlePlacementError(null) }}
                      style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
                    >
                      Close
                    </button>
                  </div>

                  <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                    <div style={{ color: '#bbb', fontSize: 13, fontWeight: 800 }}>Instances</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {instances.map((inst, idx) => {
                        const isActive = String(inst.id) === String(activeInstanceId)
                        return (
                          <button
                            key={String(inst.id)}
                            type="button"
                            onClick={() => {
                              setScreenTitlePlacementEditor((p) => (p ? { ...p, activeInstanceId: String(inst.id) } : p))
                              setScreenTitlePlacementError(null)
                            }}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 10,
                              border: `1px solid ${isActive ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.18)'}`,
                              background: isActive ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.06)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            Instance {idx + 1}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div style={{ marginTop: 10, color: '#9aa3ad', fontSize: 13 }}>
                    Drag the box to move. Drag side handles to resize. Placement is constrained to safe area.
                  </div>

                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ width: '100%', maxWidth: 360 }}>
                      <div
                        ref={screenTitlePlacementStageRef}
                        style={{
                          position: 'relative',
                          width: '100%',
                          aspectRatio: '9 / 16',
                          borderRadius: 12,
                          border: '1px solid rgba(255,255,255,0.22)',
                          background:
                            'linear-gradient(180deg, rgba(23,29,36,0.96) 0%, rgba(8,12,18,0.96) 100%)',
                          overflow: 'hidden',
                          touchAction: 'none',
                          userSelect: 'none',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: `${safeRect.xPct}%`,
                            top: `${safeRect.yPct}%`,
                            width: `${safeRect.wPct}%`,
                            height: `${safeRect.hPct}%`,
                            border: '1px dashed rgba(180,200,220,0.85)',
                            background: 'rgba(80,104,128,0.07)',
                            pointerEvents: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                        {activeInstance ? (
                          <div
                            style={{
                              position: 'absolute',
                              left: `${activeRect.xPct}%`,
                              top: `${activeRect.yPct}%`,
                              width: `${activeRect.wPct}%`,
                              height: `${activeRect.hPct}%`,
                              border: '2px solid rgba(96,165,250,1)',
                              background: 'rgba(96,165,250,0.16)',
                              borderRadius: 8,
                              boxSizing: 'border-box',
                              cursor: 'move',
                              touchAction: 'none',
                              overflow: 'hidden',
                            }}
                            onPointerDown={(e) => {
                              setScreenTitlePlacementControlMode('move')
                              beginScreenTitlePlacementDrag('move', activeRect, e)
                            }}
                          >
                            <div style={{ position: 'absolute', left: 8, top: 6, fontSize: 12, fontWeight: 900, color: '#dbeafe', textShadow: '0 1px 2px rgba(0,0,0,0.65)' }}>
                              {String(activeInstance.text || '').trim() ? 'Text Area' : 'Empty'}
                            </div>

                            <button
                              type="button"
                              aria-label="Resize top"
                              onPointerDown={(e) => {
                                setScreenTitlePlacementControlMode('top')
                                beginScreenTitlePlacementDrag('top', activeRect, e)
                              }}
                              style={{
                                ...handleStyle,
                                left: '50%',
                                top: -8,
                                transform: 'translateX(-50%)',
                                width: 32,
                                height: 16,
                                cursor: 'ns-resize',
                                background:
                                  screenTitlePlacementControlMode === 'top' || screenTitlePlacementMoveVertical
                                    ? 'rgba(96,165,250,0.40)'
                                    : 'rgba(8,12,18,0.95)',
                              }}
                            />
                            <button
                              type="button"
                              aria-label="Resize right"
                              onPointerDown={(e) => {
                                setScreenTitlePlacementControlMode('right')
                                beginScreenTitlePlacementDrag('right', activeRect, e)
                              }}
                              style={{
                                ...handleStyle,
                                right: -8,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: 16,
                                height: 32,
                                cursor: 'ew-resize',
                                background:
                                  screenTitlePlacementControlMode === 'right' || screenTitlePlacementMoveHorizontal
                                    ? 'rgba(96,165,250,0.40)'
                                    : 'rgba(8,12,18,0.95)',
                              }}
                            />
                            <button
                              type="button"
                              aria-label="Resize bottom"
                              onPointerDown={(e) => {
                                setScreenTitlePlacementControlMode('bottom')
                                beginScreenTitlePlacementDrag('bottom', activeRect, e)
                              }}
                              style={{
                                ...handleStyle,
                                left: '50%',
                                bottom: -8,
                                transform: 'translateX(-50%)',
                                width: 32,
                                height: 16,
                                cursor: 'ns-resize',
                                background:
                                  screenTitlePlacementControlMode === 'bottom' || screenTitlePlacementMoveVertical
                                    ? 'rgba(96,165,250,0.40)'
                                    : 'rgba(8,12,18,0.95)',
                              }}
                            />
                            <button
                              type="button"
                              aria-label="Resize left"
                              onPointerDown={(e) => {
                                setScreenTitlePlacementControlMode('left')
                                beginScreenTitlePlacementDrag('left', activeRect, e)
                              }}
                              style={{
                                ...handleStyle,
                                left: -8,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: 16,
                                height: 32,
                                cursor: 'ew-resize',
                                background:
                                  screenTitlePlacementControlMode === 'left' || screenTitlePlacementMoveHorizontal
                                    ? 'rgba(96,165,250,0.40)'
                                    : 'rgba(8,12,18,0.95)',
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, color: '#9aa3ad', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    Min size: {SCREEN_TITLE_PLACEMENT_MIN_W_PCT}% W, {SCREEN_TITLE_PLACEMENT_MIN_H_PCT}% H
                  </div>
                  {screenTitlePlacementError ? <div style={{ marginTop: 10, color: '#ff9b9b', fontSize: 13 }}>{screenTitlePlacementError}</div> : null}

                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => { setScreenTitlePlacementAdvancedOpen(false); setScreenTitlePlacementError(null) }}
                      style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={screenTitleRenderBusy}
                      onClick={() => { void saveScreenTitlePlacement() }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(96,165,250,0.95)',
                        background: screenTitleRenderBusy ? 'rgba(96,165,250,0.08)' : 'rgba(96,165,250,0.25)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: screenTitleRenderBusy ? 'default' : 'pointer',
                      }}
                    >
                      {screenTitleRenderBusy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
  )
}
