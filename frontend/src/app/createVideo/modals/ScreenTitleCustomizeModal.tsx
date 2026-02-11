import React from 'react'

type ScreenTitleCustomizeModalProps = {
  screenTitleCustomizeEditor: any
  screenTitleCustomizeError: string | null
  setScreenTitleCustomizeEditor: React.Dispatch<React.SetStateAction<any>>
  setScreenTitleCustomizeError: React.Dispatch<React.SetStateAction<string | null>>
  screenTitlePresets: any[]
  buildScreenTitlePresetSnapshot: (preset: any) => any
  applyScreenTitleCustomStyle: (snapshot: any, customStyle: any) => any
  resolveScreenTitleFamilyForFontKey: (fontKey: string) => any
  getScreenTitleSizeOptions: (familyKey: string, fontKey: string) => Array<{ key: string; label: string; fontSizePct: number }>
  pickScreenTitleSizeKey: (fontSizePct: number, options: Array<{ key: string; fontSizePct: number }>) => string
  screenTitleGradients: Array<{ key: string; label?: string }>
  screenTitleFontFamilies: Array<{ familyKey: string; label: string; variants: Array<{ key: string; label: string }> }>
  screenTitleTextAreaRef: React.RefObject<HTMLTextAreaElement | null>
  screenTitleTextAreaHeight: number
  setScreenTitleTextAreaHeight: React.Dispatch<React.SetStateAction<number>>
  screenTitleRenderBusy: boolean
  generateScreenTitle: () => void
}

export default function ScreenTitleCustomizeModal({
  screenTitleCustomizeEditor,
  screenTitleCustomizeError,
  setScreenTitleCustomizeEditor,
  setScreenTitleCustomizeError,
  screenTitleTextAreaRef,
  screenTitleTextAreaHeight,
  setScreenTitleTextAreaHeight,
  screenTitleRenderBusy,
  generateScreenTitle,
}: ScreenTitleCustomizeModalProps) {
  const instances = Array.isArray(screenTitleCustomizeEditor?.instances) ? screenTitleCustomizeEditor.instances : []
  const activeInstanceId = String(screenTitleCustomizeEditor?.activeInstanceId || '')
  const activeIndex = instances.findIndex((inst: any) => String(inst.id) === activeInstanceId)
  const activeInstance = activeIndex >= 0 ? instances[activeIndex] : instances[0]
  const activeText = activeInstance?.text == null ? '' : String(activeInstance.text)

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.86)',
        zIndex: 1100,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '64px 16px 96px',
      }}
      onClick={() => {
        setScreenTitleCustomizeEditor(null)
        setScreenTitleCustomizeError(null)
      }}
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              setScreenTitleCustomizeEditor(null)
              setScreenTitleCustomizeError(null)
            }}
            style={{
              color: '#fff',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.20)',
              padding: '8px 10px',
              borderRadius: 10,
              cursor: 'pointer',
              fontWeight: 800,
            }}
          >
            Close
          </button>
        </div>
        <div style={{ fontSize: 18, fontWeight: 900, marginTop: 8 }}>Screen Titles Text</div>

        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ color: '#bbb', fontSize: 13, fontWeight: 800 }}>Instances</div>
            <button
              type="button"
              disabled={instances.length >= 5}
              onClick={() => {
                const newId = `sti_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
                const base = instances.length ? instances[instances.length - 1] : { text: '', customStyle: null }
                const nextInst: any = {
                  id: newId,
                  text: String(base?.text || ''),
                  customStyle: base?.customStyle ? { ...(base.customStyle as any) } : null,
                }
                setScreenTitleCustomizeEditor((p: any) => {
                  if (!p) return p
                  return { ...p, instances: [...(p.instances || []), nextInst], activeInstanceId: newId }
                })
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 10,
                border: '1px solid rgba(96,165,250,0.95)',
                background: instances.length >= 5 ? 'rgba(96,165,250,0.08)' : 'rgba(96,165,250,0.14)',
                color: '#fff',
                fontWeight: 900,
                cursor: instances.length >= 5 ? 'not-allowed' : 'pointer',
              }}
            >
              + Add Instance
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {instances.map((inst: any, idx: number) => {
              const isActive = String(inst.id) === String(activeInstanceId)
              return (
                <div key={String(inst.id)} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() =>
                      setScreenTitleCustomizeEditor((p: any) => (p ? { ...p, activeInstanceId: String(inst.id) } : p))
                    }
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
                  {instances.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setScreenTitleCustomizeEditor((p: any) => {
                          if (!p) return p
                          const list = (p.instances || []).filter((it: any) => String(it.id) !== String(inst.id))
                          const nextActive =
                            String(p.activeInstanceId) === String(inst.id)
                              ? String(list[Math.max(0, idx - 1)]?.id || list[0]?.id || '')
                              : p.activeInstanceId
                          return { ...p, instances: list, activeInstanceId: nextActive }
                        })
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: 'rgba(255,69,58,0.2)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      −
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Text</div>
            <textarea
              ref={screenTitleTextAreaRef}
              value={activeText}
              onChange={(e) => {
                const next = e.target.value
                setScreenTitleCustomizeEditor((p: any) => {
                  if (!p) return p
                  const nextInstances = (p.instances || []).map((inst: any) =>
                    String(inst.id) === String(activeInstanceId) ? { ...inst, text: next } : inst
                  )
                  return { ...p, instances: nextInstances }
                })
                setScreenTitleCustomizeError(null)
                if (screenTitleTextAreaRef.current) {
                  const el = screenTitleTextAreaRef.current
                  const nextHeight = Math.max(96, Math.min(360, el.scrollHeight))
                  setScreenTitleTextAreaHeight(nextHeight)
                }
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                minHeight: 96,
                height: screenTitleTextAreaHeight,
                resize: 'vertical',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0b0b0b',
                color: '#fff',
                padding: '10px 12px',
                fontSize: 14,
                fontWeight: 700,
              }}
            />
          </label>

          {screenTitleCustomizeError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{screenTitleCustomizeError}</div> : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={() => {
                setScreenTitleCustomizeEditor(null)
                setScreenTitleCustomizeError(null)
              }}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={screenTitleRenderBusy}
              onClick={generateScreenTitle}
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
        </div>
      </div>
    </div>
  )
}
