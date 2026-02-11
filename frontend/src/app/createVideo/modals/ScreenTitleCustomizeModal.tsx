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
  screenTitlePresets,
  buildScreenTitlePresetSnapshot,
  applyScreenTitleCustomStyle,
  resolveScreenTitleFamilyForFontKey,
  getScreenTitleSizeOptions,
  pickScreenTitleSizeKey,
  screenTitleGradients,
  screenTitleFontFamilies,
  screenTitleTextAreaRef,
  screenTitleTextAreaHeight,
  setScreenTitleTextAreaHeight,
  screenTitleRenderBusy,
  generateScreenTitle,
}: ScreenTitleCustomizeModalProps) {
  return (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 96px' }}
          onClick={() => { setScreenTitleCustomizeEditor(null); setScreenTitleCustomizeError(null) }}
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
            <style>{`
              .cv-color-picker {
                -webkit-appearance: none;
                appearance: none;
              }
              .cv-color-picker::-webkit-color-swatch-wrapper {
                padding: 0;
              }
              .cv-color-picker::-webkit-color-swatch {
                border: none;
                border-radius: 0;
              }
              .cv-color-picker::-moz-color-swatch {
                border: none;
                border-radius: 0;
              }
            `}</style>
            {(() => {
              const presetId = Number(screenTitleCustomizeEditor.presetId || 0)
              const instances = Array.isArray(screenTitleCustomizeEditor.instances) ? screenTitleCustomizeEditor.instances : []
              const activeInstanceId = String(screenTitleCustomizeEditor.activeInstanceId || '')
              const activeIndex = instances.findIndex((inst) => String(inst.id) === activeInstanceId)
              const activeInstance = activeIndex >= 0 ? instances[activeIndex] : instances[0]
              const preset = screenTitlePresets.find((p: any) => Number((p as any).id) === presetId) as any
              const baseSnapshot = preset ? buildScreenTitlePresetSnapshot(preset) : null
              const customStyle = activeInstance?.customStyle || null
              const activeText = activeInstance?.text == null ? '' : String(activeInstance.text)
              const effective = baseSnapshot ? applyScreenTitleCustomStyle(baseSnapshot, customStyle) : null
              const effectiveFontKey = String((effective as any)?.fontKey || (baseSnapshot as any)?.fontKey || '')
              const family = resolveScreenTitleFamilyForFontKey(effectiveFontKey)
              const familyKey = family?.familyKey || ''
              const sizeOptions = getScreenTitleSizeOptions(familyKey, effectiveFontKey)
              const sizeKey = pickScreenTitleSizeKey(
                Number((effective as any)?.fontSizePct ?? (baseSnapshot as any)?.fontSizePct ?? sizeOptions[0]?.fontSizePct),
                sizeOptions
              )
              const align = String((effective as any)?.alignment || 'center') as 'left' | 'center' | 'right'
              const effectiveGradient =
                customStyle && (customStyle as any).fontGradientKey !== undefined
                  ? (customStyle as any).fontGradientKey
                  : (effective as any)?.fontGradientKey ?? null
              const gradientValue = effectiveGradient == null ? '' : String(effectiveGradient)
              const fontColorValue =
                (customStyle as any)?.fontColor != null && String((customStyle as any).fontColor).trim()
                  ? String((customStyle as any).fontColor)
                  : String((baseSnapshot as any)?.fontColor || '#ffffff')
              const alignItems: Array<{ key: 'left' | 'center' | 'right'; label: string }> = [
                { key: 'left', label: 'Left' },
                { key: 'center', label: 'Center' },
                { key: 'right', label: 'Right' },
              ]

              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const from = `${window.location.pathname}${window.location.search}${window.location.hash || ''}`
                          window.location.href = `/assets/screen-titles?return=${encodeURIComponent(from)}`
                        } catch {}
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
                      Manage Styles
                    </button>
                    <button
                      type="button"
                      onClick={() => { setScreenTitleCustomizeEditor(null); setScreenTitleCustomizeError(null) }}
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
                  <div style={{ fontSize: 18, fontWeight: 900, marginTop: 8 }}>Customize Screen Title Style</div>

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
                          setScreenTitleCustomizeEditor((p) => {
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
                      {instances.map((inst, idx) => {
                        const isActive = String(inst.id) === String(activeInstanceId)
                        return (
                          <div key={String(inst.id)} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => setScreenTitleCustomizeEditor((p) => (p ? { ...p, activeInstanceId: String(inst.id) } : p))}
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
                                  setScreenTitleCustomizeEditor((p) => {
                                    if (!p) return p
                                    const list = (p.instances || []).filter((it) => String(it.id) !== String(inst.id))
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
                      <div style={{ color: '#bbb', fontSize: 13 }}>Select Style</div>
                      <select
                        value={Number.isFinite(presetId) && presetId > 0 ? String(presetId) : ''}
                        onChange={(e) => {
                          const nextId = Number(e.target.value)
                          setScreenTitleCustomizeEditor((p) => {
                            if (!p) return p
                            const nextPreset = Number.isFinite(nextId) ? nextId : null
                            const nextInstances = (p.instances || []).map((inst) => ({ ...inst, customStyle: null }))
                            return { ...p, presetId: nextPreset, instances: nextInstances }
                          })
                          setScreenTitleCustomizeError(null)
                        }}
                        style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                      >
                        <option value="">Select...</option>
                        {screenTitlePresets.map((p: any) => (
                          <option key={String((p as any).id)} value={String((p as any).id)}>
                            {String((p as any).name || `Style ${String((p as any).id)}`)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Text</div>
                      <textarea
                        ref={screenTitleTextAreaRef}
                        value={activeText}
                        onChange={(e) => {
                          const next = e.target.value
                          setScreenTitleCustomizeEditor((p) => {
                            if (!p) return p
                            const nextInstances = (p.instances || []).map((inst) =>
                              String(inst.id) === String(activeInstanceId)
                                ? { ...inst, text: next }
                                : inst
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

                    <div style={{ display: 'grid', gap: 8 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Text Align</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                        {alignItems.map((item) => {
                          const isActive = align === item.key
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => {
                                setScreenTitleCustomizeEditor((p) => {
                                  if (!p) return p
                                  const nextInstances = (p.instances || []).map((inst) =>
                                    String(inst.id) === String(activeInstanceId)
                                      ? { ...inst, customStyle: { ...(inst.customStyle || {}), alignment: item.key } }
                                      : inst
                                  )
                                  return { ...p, instances: nextInstances }
                                })
                                setScreenTitleCustomizeError(null)
                              }}
                              style={{
                                height: 34,
                                borderRadius: 8,
                                border: `1px solid ${isActive ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.18)'}`,
                                background: isActive ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.06)',
                                color: '#fff',
                                fontWeight: 900,
                                cursor: 'pointer',
                              }}
                            >
                              {item.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Reset</div>
                      <button
                        type="button"
                        onClick={() => {
                          setScreenTitleCustomizeEditor((p) => {
                            if (!p) return p
                            const nextInstances = (p.instances || []).map((inst) =>
                              String(inst.id) === String(activeInstanceId) ? { ...inst, customStyle: null } : inst
                            )
                            return { ...p, instances: nextInstances }
                          })
                        }}
                        style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                      >
                        Reset to Base
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <div style={{ color: '#bbb', fontSize: 13 }}>Font Family</div>
                        <select
                          value={familyKey}
                          onChange={(e) => {
                            const nextFamily = String(e.target.value)
                            const fam = screenTitleFontFamilies.find((f) => String(f.familyKey) === nextFamily) || screenTitleFontFamilies[0]
                            const nextVariant = fam?.variants?.[0]?.key || ''
                            setScreenTitleCustomizeEditor((p) => {
                              if (!p) return p
                              const nextInstances = (p.instances || []).map((inst) =>
                                String(inst.id) === String(activeInstanceId)
                                  ? { ...inst, customStyle: { ...(inst.customStyle || {}), fontKey: nextVariant } }
                                  : inst
                              )
                              return { ...p, instances: nextInstances }
                            })
                          }}
                          style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                        >
                          {screenTitleFontFamilies.map((f) => (
                            <option key={String(f.familyKey)} value={String(f.familyKey)}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <div style={{ color: '#bbb', fontSize: 13 }}>Variant</div>
                        <select
                          value={effectiveFontKey}
                          onChange={(e) => {
                            const nextKey = String(e.target.value)
                            setScreenTitleCustomizeEditor((p) => {
                              if (!p) return p
                              const nextInstances = (p.instances || []).map((inst) =>
                                String(inst.id) === String(activeInstanceId)
                                  ? { ...inst, customStyle: { ...(inst.customStyle || {}), fontKey: nextKey } }
                                  : inst
                              )
                              return { ...p, instances: nextInstances }
                            })
                          }}
                          style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                        >
                          {family?.variants?.map((v) => (
                            <option key={String(v.key)} value={String(v.key)}>
                              {String(v.label || v.key)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <div style={{ color: '#bbb', fontSize: 13 }}>Text Size</div>
                        <select
                          value={sizeKey}
                          onChange={(e) => {
                            const nextKey = String(e.target.value)
                            const opt = sizeOptions.find((o) => o.key === nextKey)
                            if (!opt) return
                            setScreenTitleCustomizeEditor((p) => {
                              if (!p) return p
                              const nextInstances = (p.instances || []).map((inst) =>
                                String(inst.id) === String(activeInstanceId)
                                  ? { ...inst, customStyle: { ...(inst.customStyle || {}), fontSizePct: opt.fontSizePct } }
                                  : inst
                              )
                              return { ...p, instances: nextInstances }
                            })
                          }}
                          style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                        >
                          {sizeOptions.map((opt) => (
                            <option key={opt.key} value={opt.key}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <div style={{ color: '#bbb', fontSize: 13 }}>Font Color</div>
                        <div
                          style={{
                            width: '100%',
                            height: 38,
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: fontColorValue,
                            boxSizing: 'border-box',
                            overflow: 'hidden',
                          }}
                        >
                          <input
                            type="color"
                            value={fontColorValue}
                            onChange={(e) => {
                              const nextColor = String(e.target.value || '#ffffff')
                              setScreenTitleCustomizeEditor((p) => {
                                if (!p) return p
                                const nextInstances = (p.instances || []).map((inst) =>
                                  String(inst.id) === String(activeInstanceId)
                                    ? { ...inst, customStyle: { ...(inst.customStyle || {}), fontColor: nextColor } }
                                    : inst
                                )
                                return { ...p, instances: nextInstances }
                              })
                            }}
                            className="cv-color-picker"
                            style={{
                              width: '100%',
                              height: '100%',
                              padding: 0,
                              border: 0,
                              background: 'transparent',
                              boxSizing: 'border-box',
                              cursor: 'pointer',
                              WebkitAppearance: 'none',
                              appearance: 'none',
                            }}
                          />
                        </div>
                      </label>
                    </div>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Text Gradient</div>
                      <select
                        value={gradientValue}
                        onChange={(e) => {
                          const next = String(e.target.value || '')
                          setScreenTitleCustomizeEditor((p) => {
                            if (!p) return p
                            const nextInstances = (p.instances || []).map((inst) =>
                              String(inst.id) === String(activeInstanceId)
                                ? { ...inst, customStyle: { ...(inst.customStyle || {}), fontGradientKey: next ? next : null } }
                                : inst
                            )
                            return { ...p, instances: nextInstances }
                          })
                        }}
                        style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                      >
                        <option value="">None</option>
                        {screenTitleGradients.map((g) => (
                          <option key={g.key} value={g.key}>
                            {g.label || g.key}
                          </option>
                        ))}
                      </select>
                    </label>

                    {screenTitleCustomizeError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{screenTitleCustomizeError}</div> : null}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => { setScreenTitleCustomizeEditor(null); setScreenTitleCustomizeError(null) }}
                        style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
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
                </>
              )
            })()}
          </div>
        </div>
  )
}
