import React from 'react'

export default function ScreenTitleQuickPanelOverlay(props: any) {
  const {
    screenTitlePlacementStageRef,
    screenTitlePlacementPanelRef,
    screenTitlePlacementPanelPos,
    screenTitleMiniPanelTab,
    SCREEN_TITLE_STYLE_PANEL_WIDTH_PX,
    SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX,
    beginScreenTitlePlacementPanelDrag,
    closeScreenTitlePlacement,
    screenTitleRenderBusy,
    screenTitlePlacementEditor,
    setScreenTitlePlacementEditor,
    setScreenTitleStyleAlignMenuOpen,
    setScreenTitlePlacementError,
    setScreenTitleMiniPanelTab,
    SCREEN_TITLE_PLACEMENT_COL_GAP_PX,
    SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX,
    setScreenTitlePlacementControlMode,
    screenTitlePlacementControlMode,
    screenTitlePlacementMoveVertical,
    screenTitlePlacementMoveHorizontal,
    setScreenTitlePlacementMoveAxis,
    SCREEN_TITLE_PLACEMENT_CONTROL_GAP_PX,
    SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX,
    SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_HEIGHT_PX,
    setScreenTitlePlacementStepPx,
    screenTitlePlacementStepPx,
    beginScreenTitleNudgeRepeat,
    screenTitlePlacementArrowControls,
    endScreenTitleNudgeRepeat,
    beginScreenTitleNudgeRepeatMouse,
    endScreenTitleNudgeRepeatLegacy,
    beginScreenTitleNudgeRepeatTouch,
    ACTION_ARROW_ICON_URL,
    normalizeScreenTitlePlacementRect,
    screenTitlePresets,
    buildScreenTitlePresetSnapshot,
    applyScreenTitleCustomStyle,
    resolveScreenTitleFamilyForFontKey,
    getScreenTitleSizeOptions,
    pickScreenTitleSizeKey,
    setScreenTitlePlacementDirty,
    screenTitleStyleAlignMenuRef,
    screenTitleStyleAlignMenuOpen,
    screenTitleFontFamilies,
    screenTitleGradients,
    screenTitlePlacementDirty,
    saveScreenTitlePlacement,
    screenTitlePlacementError,
    screenTitlePlacementInRange,
    screenTitlePlacementActiveRect,
    SCREEN_TITLE_SAFE_AREA_LEFT_PCT,
    SCREEN_TITLE_SAFE_AREA_TOP_PCT,
    SCREEN_TITLE_SAFE_AREA_RIGHT_PCT,
    SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT,
    screenTitlePlacementPassiveRects,
    beginScreenTitlePlacementDrag,
    SCREEN_TITLE_PLACEMENT_ACTION_BUTTON_WIDTH_PX,
  } = props as any

  return (
                <div
                  ref={screenTitlePlacementStageRef}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 120,
                    pointerEvents: 'none',
                    touchAction: 'none',
                  }}
                >
                    <div
                      ref={screenTitlePlacementPanelRef}
                      onContextMenu={(e) => {
                        e.preventDefault()
                      }}
                      style={{
                        position: 'absolute',
                        left: Math.round(screenTitlePlacementPanelPos.x),
                        top: Math.round(screenTitlePlacementPanelPos.y),
                        zIndex: 60,
                        width:
                          screenTitleMiniPanelTab === 'style'
                            ? SCREEN_TITLE_STYLE_PANEL_WIDTH_PX
                            : SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX,
                        borderRadius: 14,
                        border: '1px solid rgba(96,165,250,0.95)',
                        background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
                        boxShadow: '0 10px 26px rgba(0,0,0,0.55)',
                        pointerEvents: 'auto',
                        boxSizing: 'border-box',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                        WebkitTouchCallout: 'none',
                      }}
                    >
                      <div
                        onPointerDown={beginScreenTitlePlacementPanelDrag}
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid rgba(96,165,250,0.45)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          cursor: 'grab',
                          touchAction: 'none',
                        }}
                        title="Drag panel"
                      >
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            minWidth: 0,
                          }}
                        >
                          <span style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>
                            {screenTitleMiniPanelTab === 'style' ? 'Style' : 'Placement'}
                          </span>
                          <span style={{ color: '#9aa3ad', fontSize: 12, fontWeight: 900 }}>::</span>
                        </div>
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.stopPropagation()
                          }}
                          onClick={closeScreenTitlePlacement}
                          disabled={screenTitleRenderBusy}
                          style={{
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: screenTitleRenderBusy ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)',
                            color: '#fff',
                            width: 28,
                            height: 28,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 13,
                            fontWeight: 800,
                            cursor: screenTitleRenderBusy ? 'default' : 'pointer',
                            flex: '0 0 auto',
                            opacity: screenTitleRenderBusy ? 0.6 : 1,
                          }}
                          aria-label="Close placement tools"
                        >
                          X
                        </button>
                      </div>
                      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
                        <select
                          value={String(screenTitlePlacementEditor.activeInstanceId || '')}
                          onChange={(e) => {
                            const nextId = String(e.target.value || '')
                            setScreenTitlePlacementEditor((p) => (p ? { ...p, activeInstanceId: nextId } : p))
                            setScreenTitleStyleAlignMenuOpen(false)
                            setScreenTitlePlacementError(null)
                          }}
                          style={{
                            width: '100%',
                            maxWidth: '100%',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: '#0b0b0b',
                            color: '#fff',
                            padding: '10px 12px',
                            fontSize: 13,
                            fontWeight: 900,
                            boxSizing: 'border-box',
                          }}
                        >
                          {(screenTitlePlacementEditor.instances || []).map((inst: any, idx: number) => (
                            <option key={String(inst?.id || idx)} value={String(inst?.id || '')}>
                              {`Instance ${idx + 1}`}
                            </option>
                          ))}
                        </select>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setScreenTitleMiniPanelTab('style')
                              setScreenTitleStyleAlignMenuOpen(false)
                            }}
                            style={{
                              padding: '8px 0',
                              borderRadius: 10,
                              border: `1px solid ${screenTitleMiniPanelTab === 'style' ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.22)'}`,
                              background: screenTitleMiniPanelTab === 'style' ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.08)',
                              color: '#fff',
                              fontSize: 13,
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            Style
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setScreenTitleMiniPanelTab('placement')
                              setScreenTitleStyleAlignMenuOpen(false)
                            }}
                            style={{
                              padding: '8px 0',
                              borderRadius: 10,
                              border: `1px solid ${screenTitleMiniPanelTab === 'placement' ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.22)'}`,
                              background: screenTitleMiniPanelTab === 'placement' ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.08)',
                              color: '#fff',
                              fontSize: 13,
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            Placement
                          </button>
                        </div>
                        {screenTitleMiniPanelTab === 'placement' ? (
                        <div style={{ display: 'flex', gap: SCREEN_TITLE_PLACEMENT_COL_GAP_PX, alignItems: 'flex-start' }}>
                          <div
                            style={{
                              position: 'relative',
                              width: SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX,
                              height: SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX,
                              borderRadius: 8,
                              border: '1px solid rgba(255,255,255,0.22)',
                              background: 'rgba(255,255,255,0.04)',
                              overflow: 'hidden',
                              flex: '0 0 auto',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => setScreenTitlePlacementControlMode('top')}
                              style={{
                                position: 'absolute',
                                left: 20,
                                right: 20,
                                top: 0,
                                height: 20,
                                border: 0,
                                boxShadow:
                                  screenTitlePlacementControlMode === 'top' || screenTitlePlacementMoveVertical
                                    ? 'inset 0 0 0 1px rgba(96,165,250,0.95)'
                                    : 'none',
                                background:
                                  screenTitlePlacementControlMode === 'top' || screenTitlePlacementMoveVertical
                                    ? '#0f2538'
                                    : 'transparent',
                                color: '#fff',
                                cursor: 'pointer',
                              }}
                              aria-label="Select top edge"
                            />
                            <button
                              type="button"
                              onClick={() => setScreenTitlePlacementControlMode('right')}
                              style={{
                                position: 'absolute',
                                top: 20,
                                right: 0,
                                width: 20,
                                bottom: 20,
                                border: 0,
                                boxShadow:
                                  screenTitlePlacementControlMode === 'right' || screenTitlePlacementMoveHorizontal
                                    ? 'inset 0 0 0 1px rgba(96,165,250,0.95)'
                                    : 'none',
                                background:
                                  screenTitlePlacementControlMode === 'right' || screenTitlePlacementMoveHorizontal
                                    ? '#0f2538'
                                    : 'transparent',
                                color: '#fff',
                                cursor: 'pointer',
                              }}
                              aria-label="Select right edge"
                            />
                            <button
                              type="button"
                              onClick={() => setScreenTitlePlacementControlMode('bottom')}
                              style={{
                                position: 'absolute',
                                left: 20,
                                right: 20,
                                bottom: 0,
                                height: 20,
                                border: 0,
                                boxShadow:
                                  screenTitlePlacementControlMode === 'bottom' || screenTitlePlacementMoveVertical
                                    ? 'inset 0 0 0 1px rgba(96,165,250,0.95)'
                                    : 'none',
                                background:
                                  screenTitlePlacementControlMode === 'bottom' || screenTitlePlacementMoveVertical
                                    ? '#0f2538'
                                    : 'transparent',
                                color: '#fff',
                                cursor: 'pointer',
                              }}
                              aria-label="Select bottom edge"
                            />
                            <button
                              type="button"
                              onClick={() => setScreenTitlePlacementControlMode('left')}
                              style={{
                                position: 'absolute',
                                top: 20,
                                left: 0,
                                width: 20,
                                bottom: 20,
                                border: 0,
                                boxShadow:
                                  screenTitlePlacementControlMode === 'left' || screenTitlePlacementMoveHorizontal
                                    ? 'inset 0 0 0 1px rgba(96,165,250,0.95)'
                                    : 'none',
                                background:
                                  screenTitlePlacementControlMode === 'left' || screenTitlePlacementMoveHorizontal
                                    ? '#0f2538'
                                    : 'transparent',
                                color: '#fff',
                                cursor: 'pointer',
                              }}
                              aria-label="Select left edge"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (screenTitlePlacementControlMode === 'move') {
                                  setScreenTitlePlacementMoveAxis((prev) =>
                                    prev === 'vertical' ? 'horizontal' : 'vertical'
                                  )
                                } else {
                                  setScreenTitlePlacementControlMode('move')
                                  setScreenTitlePlacementMoveAxis('vertical')
                                }
                              }}
                              style={{
                                position: 'absolute',
                                left: '50%',
                                top: '50%',
                                width: 24,
                                height: 24,
                                transform: 'translate(-50%, -50%)',
                                borderRadius: 999,
                                border: `1px solid ${screenTitlePlacementControlMode === 'move' ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.4)'}`,
                                background: screenTitlePlacementControlMode === 'move' ? '#0f2538' : '#0b0b0b',
                                color: '#fff',
                                cursor: 'pointer',
                              }}
                              aria-label="Select move mode"
                            >
                              •
                            </button>
                          </div>
                          <div
                            style={{
                              display: 'grid',
                              gap: SCREEN_TITLE_PLACEMENT_CONTROL_GAP_PX,
                              minWidth: 0,
                              width: SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX,
                              height: SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX,
                              flex: '0 0 auto',
                            }}
                          >
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(2, ${SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX}px)`,
                                gap: SCREEN_TITLE_PLACEMENT_CONTROL_GAP_PX,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setScreenTitlePlacementStepPx(1)}
                                style={{
                                  width: SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX,
                                  height: SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_HEIGHT_PX,
                                  borderRadius: 8,
                                  border: `1px solid ${screenTitlePlacementStepPx === 1 ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.22)'}`,
                                  background: screenTitlePlacementStepPx === 1 ? '#0f2538' : '#0b0b0b',
                                  color: '#fff',
                                  fontSize: 11,
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                }}
                              >
                                1px
                              </button>
                              <button
                                type="button"
                                onClick={() => setScreenTitlePlacementStepPx(5)}
                                style={{
                                  width: SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX,
                                  height: SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_HEIGHT_PX,
                                  borderRadius: 8,
                                  border: `1px solid ${screenTitlePlacementStepPx === 5 ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.22)'}`,
                                  background: screenTitlePlacementStepPx === 5 ? '#0f2538' : '#0b0b0b',
                                  color: '#fff',
                                  fontSize: 11,
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                }}
                              >
                                5px
                              </button>
                            </div>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(2, ${SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX}px)`,
                                gap: SCREEN_TITLE_PLACEMENT_CONTROL_GAP_PX,
                              }}
                            >
                              <button
                                type="button"
                                onPointerDown={beginScreenTitleNudgeRepeat(screenTitlePlacementArrowControls.firstAction)}
                                onPointerUp={endScreenTitleNudgeRepeat}
                                onPointerCancel={endScreenTitleNudgeRepeat}
                                onMouseDown={beginScreenTitleNudgeRepeatMouse(screenTitlePlacementArrowControls.firstAction)}
                                onMouseUp={endScreenTitleNudgeRepeatLegacy}
                                onMouseLeave={endScreenTitleNudgeRepeatLegacy}
                                onTouchStart={beginScreenTitleNudgeRepeatTouch(screenTitlePlacementArrowControls.firstAction)}
                                onTouchEnd={endScreenTitleNudgeRepeatLegacy}
                                onTouchCancel={endScreenTitleNudgeRepeatLegacy}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                }}
                                style={{
                                  width: SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX,
                                  height: SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_HEIGHT_PX,
                                  borderRadius: 8,
                                  border: '1px solid rgba(255,255,255,0.18)',
                                  background: '#0b0b0b',
                                  color: '#fff',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  touchAction: 'none',
                                  opacity: 1,
                                }}
                                aria-label={screenTitlePlacementArrowControls.firstAria}
                              >
                                <img
                                  src={ACTION_ARROW_ICON_URL}
                                  alt=""
                                  aria-hidden="true"
                                  style={{
                                    width: 14,
                                    height: 14,
                                    display: 'block',
                                    filter: 'brightness(0) invert(1)',
                                    transform: `rotate(${screenTitlePlacementArrowControls.firstRotation}deg)`,
                                  }}
                                />
                              </button>
                              <button
                                type="button"
                                onPointerDown={beginScreenTitleNudgeRepeat(screenTitlePlacementArrowControls.secondAction)}
                                onPointerUp={endScreenTitleNudgeRepeat}
                                onPointerCancel={endScreenTitleNudgeRepeat}
                                onMouseDown={beginScreenTitleNudgeRepeatMouse(screenTitlePlacementArrowControls.secondAction)}
                                onMouseUp={endScreenTitleNudgeRepeatLegacy}
                                onMouseLeave={endScreenTitleNudgeRepeatLegacy}
                                onTouchStart={beginScreenTitleNudgeRepeatTouch(screenTitlePlacementArrowControls.secondAction)}
                                onTouchEnd={endScreenTitleNudgeRepeatLegacy}
                                onTouchCancel={endScreenTitleNudgeRepeatLegacy}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                }}
                                style={{
                                  width: SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX,
                                  height: SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_HEIGHT_PX,
                                  borderRadius: 8,
                                  border: '1px solid rgba(255,255,255,0.18)',
                                  background: '#0b0b0b',
                                  color: '#fff',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  touchAction: 'none',
                                  opacity: 1,
                                }}
                                aria-label={screenTitlePlacementArrowControls.secondAria}
                              >
                                <img
                                  src={ACTION_ARROW_ICON_URL}
                                  alt=""
                                  aria-hidden="true"
                                  style={{
                                    width: 14,
                                    height: 14,
                                    display: 'block',
                                    filter: 'brightness(0) invert(1)',
                                    transform: `rotate(${screenTitlePlacementArrowControls.secondRotation}deg)`,
                                  }}
                                />
                              </button>
                            </div>
                          </div>
                        </div>
                        ) : (
                          (() => {
                            const presetId = Number(screenTitlePlacementEditor.presetId || 0)
                            const instances = Array.isArray(screenTitlePlacementEditor.instances)
                              ? screenTitlePlacementEditor.instances
                              : []
                            const activeInstanceId = String(screenTitlePlacementEditor.activeInstanceId || '')
                            const activeInstance =
                              instances.find((inst: any) => String(inst?.id || '') === activeInstanceId) || instances[0] || null
                            if (!activeInstance) {
                              return (
                                <div
                                  style={{
                                    borderRadius: 10,
                                    border: '1px solid rgba(255,255,255,0.16)',
                                    background: 'rgba(255,255,255,0.05)',
                                    padding: '10px',
                                    color: '#dbeafe',
                                    fontSize: 12,
                                  }}
                                >
                                  Select an instance to edit style.
                                </div>
                              )
                            }

                            const preset = screenTitlePresets.find((p: any) => Number((p as any).id) === presetId) as any
                            const baseSnapshot = preset ? buildScreenTitlePresetSnapshot(preset) : null
                            const customStyle = activeInstance?.customStyle || null
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
                            const alignItems: Array<{ key: 'left' | 'center' | 'right'; label: string }> = [
                              { key: 'left', label: 'Align Left' },
                              { key: 'center', label: 'Align Center' },
                              { key: 'right', label: 'Align Right' },
                            ]
                            const renderAlignIcon = (key: 'left' | 'center' | 'right') => (
                              <span
                                style={{
                                  display: 'grid',
                                  gap: 2,
                                  width: 15,
                                  justifyItems: key === 'left' ? 'start' : key === 'center' ? 'center' : 'end',
                                }}
                              >
                                <span style={{ width: 15, height: 2, borderRadius: 2, background: '#fff', opacity: 0.95 }} />
                                <span style={{ width: 11, height: 2, borderRadius: 2, background: '#fff', opacity: 0.95 }} />
                                <span style={{ width: 13, height: 2, borderRadius: 2, background: '#fff', opacity: 0.95 }} />
                              </span>
                            )
                            const effectiveGradient =
                              customStyle && (customStyle as any).fontGradientKey !== undefined
                                ? (customStyle as any).fontGradientKey
                                : (effective as any)?.fontGradientKey ?? null
                            const gradientValue = effectiveGradient == null ? '' : String(effectiveGradient)
                            const fontColorValue =
                              (customStyle as any)?.fontColor != null && String((customStyle as any).fontColor).trim()
                                ? String((customStyle as any).fontColor)
                                : String((baseSnapshot as any)?.fontColor || '#ffffff')

                            return (
                              <div style={{ display: 'grid', gap: 9 }}>
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
                                    gap: 8,
                                    alignItems: 'end',
                                  }}
                                >
                                  <label style={{ display: 'grid', gap: 4 }}>
                                    <select
                                      value={Number.isFinite(presetId) && presetId > 0 ? String(presetId) : ''}
                                      onChange={(e) => {
                                        const nextIdRaw = String(e.target.value || '')
                                        const nextPresetId = nextIdRaw ? Number(nextIdRaw) : null
                                        const currentPresetId = Number.isFinite(presetId) && presetId > 0 ? presetId : null
                                        if (String(nextPresetId || '') === String(currentPresetId || '')) return
                                        setScreenTitlePlacementEditor((prev) => {
                                          if (!prev) return prev
                                          const nextInstances = (prev.instances || []).map((inst) => {
                                            const keepRect = normalizeScreenTitlePlacementRect((inst.customStyle as any)?.placementRect)
                                            return {
                                              ...inst,
                                              customStyle: keepRect ? { placementRect: keepRect } : null,
                                            }
                                          })
                                          return { ...prev, presetId: nextPresetId, instances: nextInstances }
                                        })
                                        setScreenTitleStyleAlignMenuOpen(false)
                                        setScreenTitlePlacementDirty(true)
                                        setScreenTitlePlacementError(null)
                                      }}
                                      style={{
                                        width: '100%',
                                        maxWidth: '100%',
                                        borderRadius: 10,
                                        border: '1px solid rgba(255,255,255,0.18)',
                                        background: '#0b0b0b',
                                        color: '#fff',
                                        padding: '10px 12px',
                                        fontSize: 13,
                                        fontWeight: 900,
                                        boxSizing: 'border-box',
                                      }}
                                    >
                                      <option value="">Select Style...</option>
                                      {screenTitlePresets.map((p: any) => (
                                        <option key={String((p as any).id)} value={String((p as any).id)}>
                                          {String((p as any).name || `Style ${String((p as any).id)}`)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <div ref={screenTitleStyleAlignMenuRef} style={{ position: 'relative', display: 'grid', gap: 4 }}>
                                    <button
                                      type="button"
                                      onClick={() => setScreenTitleStyleAlignMenuOpen((prev) => !prev)}
                                      aria-haspopup="menu"
                                      aria-expanded={screenTitleStyleAlignMenuOpen}
                                      aria-label={`Text align: ${align}`}
                                      style={{
                                        width: '100%',
                                        maxWidth: '100%',
                                        height: 38,
                                        borderRadius: 10,
                                        border: '1px solid rgba(96,165,250,0.95)',
                                        background: 'rgba(96,165,250,0.16)',
                                        color: '#fff',
                                        cursor: 'pointer',
                                        display: 'grid',
                                        gridTemplateColumns: '1fr auto',
                                        alignItems: 'center',
                                        justifyItems: 'center',
                                        padding: '0 8px',
                                      }}
                                    >
                                      {renderAlignIcon(align)}
                                      <span style={{ fontSize: 10, color: '#dbeafe', marginLeft: 6 }}>▼</span>
                                    </button>
                                    {screenTitleStyleAlignMenuOpen ? (
                                      <div
                                        role="menu"
                                        style={{
                                          position: 'absolute',
                                          top: '100%',
                                          right: 0,
                                          marginTop: 6,
                                          zIndex: 10,
                                          display: 'grid',
                                          gap: 4,
                                          minWidth: 84,
                                          padding: 6,
                                          borderRadius: 10,
                                          border: '1px solid rgba(255,255,255,0.18)',
                                          background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
                                          boxShadow: '0 8px 20px rgba(0,0,0,0.42)',
                                        }}
                                      >
                                        {alignItems.map((item) => {
                                          const isActive = align === item.key
                                          return (
                                            <button
                                              key={item.key}
                                              type="button"
                                              role="menuitemradio"
                                              aria-checked={isActive}
                                              onClick={() => {
                                                setScreenTitleStyleAlignMenuOpen(false)
                                                if (align === item.key) return
                                                setScreenTitlePlacementEditor((prev) => {
                                                  if (!prev) return prev
                                                  const activeId = String(prev.activeInstanceId || '')
                                                  const nextInstances = (prev.instances || []).map((inst) =>
                                                    String(inst.id) === activeId
                                                      ? { ...inst, customStyle: { ...(inst.customStyle || {}), alignment: item.key } }
                                                      : inst
                                                  )
                                                  return { ...prev, instances: nextInstances }
                                                })
                                                setScreenTitlePlacementDirty(true)
                                                setScreenTitlePlacementError(null)
                                              }}
                                              aria-label={item.label}
                                              style={{
                                                height: 38,
                                                borderRadius: 10,
                                                border: `1px solid ${isActive ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.18)'}`,
                                                background: isActive ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.06)',
                                                color: '#fff',
                                                cursor: 'pointer',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                              }}
                                            >
                                              {renderAlignIcon(item.key)}
                                            </button>
                                          )
                                        })}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
                                    gap: 8,
                                  }}
                                >
                                  <label style={{ display: 'grid', gap: 4 }}>
                                    <select
                                      value={familyKey}
                                      onChange={(e) => {
                                        const nextFamily = String(e.target.value || '')
                                        const fam =
                                          screenTitleFontFamilies.find((f) => String(f.familyKey) === nextFamily) ||
                                          screenTitleFontFamilies[0]
                                        const nextVariant = fam?.variants?.[0]?.key || ''
                                        if (!nextVariant || String(nextVariant) === String(effectiveFontKey)) return
                                        setScreenTitlePlacementEditor((prev) => {
                                          if (!prev) return prev
                                          const activeId = String(prev.activeInstanceId || '')
                                          const nextInstances = (prev.instances || []).map((inst) =>
                                            String(inst.id) === activeId
                                              ? { ...inst, customStyle: { ...(inst.customStyle || {}), fontKey: nextVariant } }
                                              : inst
                                          )
                                          return { ...prev, instances: nextInstances }
                                        })
                                        setScreenTitlePlacementDirty(true)
                                        setScreenTitlePlacementError(null)
                                      }}
                                      style={{
                                        width: '100%',
                                        maxWidth: '100%',
                                        borderRadius: 10,
                                        border: '1px solid rgba(255,255,255,0.18)',
                                        background: '#0b0b0b',
                                        color: '#fff',
                                        padding: '10px 12px',
                                        fontSize: 13,
                                        fontWeight: 900,
                                        boxSizing: 'border-box',
                                      }}
                                    >
                                      <option value="" disabled>
                                        Select Font...
                                      </option>
                                      {screenTitleFontFamilies.map((f) => (
                                        <option key={String(f.familyKey)} value={String(f.familyKey)}>
                                          {String(f.label || f.familyKey)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label style={{ display: 'grid', gap: 4 }}>
                                    <select
                                      value={effectiveFontKey}
                                      onChange={(e) => {
                                        const nextKey = String(e.target.value || '')
                                        if (!nextKey || nextKey === effectiveFontKey) return
                                        setScreenTitlePlacementEditor((prev) => {
                                          if (!prev) return prev
                                          const activeId = String(prev.activeInstanceId || '')
                                          const nextInstances = (prev.instances || []).map((inst) =>
                                            String(inst.id) === activeId
                                              ? { ...inst, customStyle: { ...(inst.customStyle || {}), fontKey: nextKey } }
                                              : inst
                                          )
                                          return { ...prev, instances: nextInstances }
                                        })
                                        setScreenTitlePlacementDirty(true)
                                        setScreenTitlePlacementError(null)
                                      }}
                                      style={{
                                        width: '100%',
                                        maxWidth: '100%',
                                        borderRadius: 10,
                                        border: '1px solid rgba(255,255,255,0.18)',
                                        background: '#0b0b0b',
                                        color: '#fff',
                                        padding: '10px 12px',
                                        fontSize: 13,
                                        fontWeight: 900,
                                        boxSizing: 'border-box',
                                      }}
                                    >
                                      <option value="" disabled>
                                        Select Variant...
                                      </option>
                                      {(family?.variants || []).map((v) => (
                                        <option key={String(v.key)} value={String(v.key)}>
                                          {String(v.label || v.key)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>

                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
                                    gap: 8,
                                  }}
                                >
                                  <label style={{ display: 'grid', gap: 4 }}>
                                    <select
                                      value={sizeKey}
                                      onChange={(e) => {
                                        const nextKey = String(e.target.value || '')
                                        const opt = sizeOptions.find((o) => String(o.key) === nextKey)
                                        if (!opt) return
                                        if (Math.abs(Number(opt.fontSizePct) - Number((effective as any)?.fontSizePct || 0)) < 0.001) return
                                        setScreenTitlePlacementEditor((prev) => {
                                          if (!prev) return prev
                                          const activeId = String(prev.activeInstanceId || '')
                                          const nextInstances = (prev.instances || []).map((inst) =>
                                            String(inst.id) === activeId
                                              ? {
                                                  ...inst,
                                                  customStyle: { ...(inst.customStyle || {}), fontSizePct: Number(opt.fontSizePct) },
                                                }
                                              : inst
                                          )
                                          return { ...prev, instances: nextInstances }
                                        })
                                        setScreenTitlePlacementDirty(true)
                                        setScreenTitlePlacementError(null)
                                      }}
                                      style={{
                                        width: '100%',
                                        maxWidth: '100%',
                                        borderRadius: 10,
                                        border: '1px solid rgba(255,255,255,0.18)',
                                        background: '#0b0b0b',
                                        color: '#fff',
                                        padding: '10px 12px',
                                        fontSize: 13,
                                        fontWeight: 900,
                                        boxSizing: 'border-box',
                                      }}
                                    >
                                      <option value="" disabled>
                                        Select Size...
                                      </option>
                                      {sizeOptions.map((opt) => (
                                        <option key={String(opt.key)} value={String(opt.key)}>
                                          {String(opt.label || opt.key)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label style={{ display: 'grid', gap: 4 }}>
                                    <input
                                      type="color"
                                      value={fontColorValue}
                                      onChange={(e) => {
                                        const nextColor = String(e.target.value || '#ffffff')
                                        if (nextColor.toLowerCase() === fontColorValue.toLowerCase()) return
                                        setScreenTitlePlacementEditor((prev) => {
                                          if (!prev) return prev
                                          const activeId = String(prev.activeInstanceId || '')
                                          const nextInstances = (prev.instances || []).map((inst) =>
                                            String(inst.id) === activeId
                                              ? { ...inst, customStyle: { ...(inst.customStyle || {}), fontColor: nextColor } }
                                              : inst
                                          )
                                          return { ...prev, instances: nextInstances }
                                        })
                                        setScreenTitlePlacementDirty(true)
                                        setScreenTitlePlacementError(null)
                                      }}
                                      style={{
                                        width: '100%',
                                        maxWidth: '100%',
                                        height: 38,
                                        borderRadius: 10,
                                        border: '1px solid rgba(255,255,255,0.18)',
                                        background: '#0b0b0b',
                                        padding: 0,
                                        cursor: 'pointer',
                                      }}
                                    />
                                  </label>
                                </div>

                                <label style={{ display: 'grid', gap: 4 }}>
                                  <select
                                    value={gradientValue}
                                    onChange={(e) => {
                                      const next = String(e.target.value || '')
                                      const nextValue = next ? next : null
                                      if (String(nextValue || '') === String(gradientValue || '')) return
                                      setScreenTitlePlacementEditor((prev) => {
                                        if (!prev) return prev
                                        const activeId = String(prev.activeInstanceId || '')
                                        const nextInstances = (prev.instances || []).map((inst) =>
                                          String(inst.id) === activeId
                                            ? {
                                                ...inst,
                                                customStyle: { ...(inst.customStyle || {}), fontGradientKey: nextValue },
                                              }
                                            : inst
                                        )
                                        return { ...prev, instances: nextInstances }
                                      })
                                      setScreenTitlePlacementDirty(true)
                                      setScreenTitlePlacementError(null)
                                    }}
                                    style={{
                                      width: '100%',
                                      maxWidth: '100%',
                                      borderRadius: 10,
                                      border: '1px solid rgba(255,255,255,0.18)',
                                      background: '#0b0b0b',
                                      color: '#fff',
                                      padding: '10px 12px',
                                      fontSize: 13,
                                      fontWeight: 900,
                                      boxSizing: 'border-box',
                                    }}
                                  >
                                    <option value="">Select Gradient...</option>
                                    {screenTitleGradients.map((g) => (
                                      <option key={String(g.key)} value={String(g.key)}>
                                        {String(g.label || g.key)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            )
                          })()
                        )}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              screenTitleMiniPanelTab === 'style'
                                ? 'repeat(2, minmax(0, 1fr))'
                                : `repeat(2, ${SCREEN_TITLE_PLACEMENT_ACTION_BUTTON_WIDTH_PX}px)`,
                            gap: SCREEN_TITLE_PLACEMENT_COL_GAP_PX,
                          }}
                        >
                          <button
                            type="button"
                            disabled={screenTitleRenderBusy}
                            onClick={closeScreenTitlePlacement}
                            style={{
                              width:
                                screenTitleMiniPanelTab === 'style'
                                  ? '100%'
                                  : SCREEN_TITLE_PLACEMENT_ACTION_BUTTON_WIDTH_PX,
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(255,255,255,0.18)',
                              background: 'rgba(255,255,255,0.06)',
                              color: '#fff',
                              fontWeight: 800,
                              cursor: screenTitleRenderBusy ? 'default' : 'pointer',
                            }}
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            disabled={screenTitleRenderBusy || !screenTitlePlacementDirty}
                            onClick={() => { void saveScreenTitlePlacement(false) }}
                            style={{
                              width:
                                screenTitleMiniPanelTab === 'style'
                                  ? '100%'
                                  : SCREEN_TITLE_PLACEMENT_ACTION_BUTTON_WIDTH_PX,
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: `1px solid ${screenTitlePlacementDirty ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.22)'}`,
                              background:
                                screenTitleRenderBusy
                                  ? 'rgba(96,165,250,0.08)'
                                  : screenTitlePlacementDirty
                                    ? 'rgba(96,165,250,0.14)'
                                    : 'rgba(255,255,255,0.06)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: screenTitleRenderBusy || !screenTitlePlacementDirty ? 'default' : 'pointer',
                              opacity: screenTitleRenderBusy || !screenTitlePlacementDirty ? 0.7 : 1,
                            }}
                          >
                            {screenTitleRenderBusy ? 'Rendering...' : 'Render'}
                          </button>
                        </div>
                      </div>
                    </div>
	                  {screenTitlePlacementError ? (
	                    <div
	                      style={{
                        position: 'absolute',
                        left: 8,
                        right: 8,
                        top: 62,
                        color: '#ff9b9b',
                        fontSize: 12,
                        fontWeight: 900,
                        background: 'rgba(0,0,0,0.52)',
                        border: '1px solid rgba(255,155,155,0.35)',
                        borderRadius: 8,
                        padding: '6px 8px',
                        pointerEvents: 'none',
                      }}
                    >
                      {screenTitlePlacementError}
                    </div>
                  ) : null}
                  {screenTitlePlacementInRange && screenTitlePlacementActiveRect ? (
                    <>
                      <div
                        style={{
                          position: 'absolute',
                          left: `${SCREEN_TITLE_SAFE_AREA_LEFT_PCT}%`,
                          top: `${SCREEN_TITLE_SAFE_AREA_TOP_PCT}%`,
                          width: `${100 - SCREEN_TITLE_SAFE_AREA_LEFT_PCT - SCREEN_TITLE_SAFE_AREA_RIGHT_PCT}%`,
                          height: `${100 - SCREEN_TITLE_SAFE_AREA_TOP_PCT - SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT}%`,
                          border: '1px dashed rgba(180,200,220,0.75)',
                          background: 'rgba(80,104,128,0.05)',
                          boxSizing: 'border-box',
                          pointerEvents: 'none',
                        }}
                      />
                      {screenTitlePlacementPassiveRects.map((item, idx) => (
                        <div
                          key={`st_place_passive_${String(item.id || idx)}`}
                          style={{
                            position: 'absolute',
                            left: `${item.rect.xPct}%`,
                            top: `${item.rect.yPct}%`,
                            width: `${item.rect.wPct}%`,
                            height: `${item.rect.hPct}%`,
                            border: '1px solid rgba(200,220,245,0.55)',
                            background: 'rgba(150,180,210,0.06)',
                            borderRadius: 8,
                            boxSizing: 'border-box',
                            pointerEvents: 'none',
                          }}
                        />
                      ))}
                      <div
                        style={{
                          position: 'absolute',
                          left: `${screenTitlePlacementActiveRect.xPct}%`,
                          top: `${screenTitlePlacementActiveRect.yPct}%`,
                          width: `${screenTitlePlacementActiveRect.wPct}%`,
                          height: `${screenTitlePlacementActiveRect.hPct}%`,
                          border: '2px solid rgba(96,165,250,1)',
                          background: 'rgba(96,165,250,0.16)',
                          borderRadius: 8,
                          boxSizing: 'border-box',
                          cursor: 'move',
                          touchAction: 'none',
                          pointerEvents: 'auto',
                        }}
                        onPointerDown={(e) => {
                          setScreenTitlePlacementControlMode('move')
                          beginScreenTitlePlacementDrag('move', screenTitlePlacementActiveRect, e)
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: 8,
                            top: 6,
                            fontSize: 12,
                            fontWeight: 900,
                            color: '#dbeafe',
                            textShadow: '0 1px 2px rgba(0,0,0,0.65)',
                            pointerEvents: 'none',
                          }}
                        >
                          Text Area
                        </div>
                        <button
                          type="button"
                          aria-label="Resize top"
                          onPointerDown={(e) => {
                            setScreenTitlePlacementControlMode('top')
                            beginScreenTitlePlacementDrag('top', screenTitlePlacementActiveRect, e)
                          }}
                          style={{
                            position: 'absolute',
                            left: '50%',
                            top: -8,
                            transform: 'translateX(-50%)',
                            width: 32,
                            height: 16,
                            borderRadius: 8,
                            border: '2px solid rgba(96,165,250,1)',
                            background:
                              screenTitlePlacementControlMode === 'top' || screenTitlePlacementMoveVertical
                                ? 'rgba(96,165,250,1)'
                                : 'rgba(8,12,18,0.95)',
                            cursor: 'ns-resize',
                            touchAction: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Resize right"
                          onPointerDown={(e) => {
                            setScreenTitlePlacementControlMode('right')
                            beginScreenTitlePlacementDrag('right', screenTitlePlacementActiveRect, e)
                          }}
                          style={{
                            position: 'absolute',
                            right: -8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 16,
                            height: 32,
                            borderRadius: 8,
                            border: '2px solid rgba(96,165,250,1)',
                            background:
                              screenTitlePlacementControlMode === 'right' || screenTitlePlacementMoveHorizontal
                                ? 'rgba(96,165,250,1)'
                                : 'rgba(8,12,18,0.95)',
                            cursor: 'ew-resize',
                            touchAction: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Resize bottom"
                          onPointerDown={(e) => {
                            setScreenTitlePlacementControlMode('bottom')
                            beginScreenTitlePlacementDrag('bottom', screenTitlePlacementActiveRect, e)
                          }}
                          style={{
                            position: 'absolute',
                            left: '50%',
                            bottom: -8,
                            transform: 'translateX(-50%)',
                            width: 32,
                            height: 16,
                            borderRadius: 8,
                            border: '2px solid rgba(96,165,250,1)',
                            background:
                              screenTitlePlacementControlMode === 'bottom' || screenTitlePlacementMoveVertical
                                ? 'rgba(96,165,250,1)'
                                : 'rgba(8,12,18,0.95)',
                            cursor: 'ns-resize',
                            touchAction: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Resize left"
                          onPointerDown={(e) => {
                            setScreenTitlePlacementControlMode('left')
                            beginScreenTitlePlacementDrag('left', screenTitlePlacementActiveRect, e)
                          }}
                          style={{
                            position: 'absolute',
                            left: -8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 16,
                            height: 32,
                            borderRadius: 8,
                            border: '2px solid rgba(96,165,250,1)',
                            background:
                              screenTitlePlacementControlMode === 'left' || screenTitlePlacementMoveHorizontal
                                ? 'rgba(96,165,250,1)'
                                : 'rgba(8,12,18,0.95)',
                            cursor: 'ew-resize',
                            touchAction: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        position: 'absolute',
                        left: 8,
                        right: 8,
                        bottom: 8,
                        color: '#ffd24a',
                        fontSize: 12,
                        fontWeight: 900,
                        background: 'rgba(0,0,0,0.62)',
                        border: '1px solid rgba(212,175,55,0.5)',
                        borderRadius: 8,
                        padding: '6px 8px',
                        pointerEvents: 'none',
                      }}
                    >
                      Playhead is outside this screen title segment. Move playhead into the segment to adjust placement.
                    </div>
                  )}
                </div>
  )
}
