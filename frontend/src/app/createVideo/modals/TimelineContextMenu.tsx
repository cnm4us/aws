import React from 'react'
import { normalizeNarrationVisualizer } from '../timelineTypes'

export default function TimelineContextMenu(props: any) {
  const ctx = props?.ctx || props
  const {
    ACTION_ARROW_ICON_URL,
    applyAudioSegmentGuidelineAction,
    applyClipGuidelineAction,
    applyGraphicGuidelineAction,
    applyLogoGuidelineAction,
    applyLowerThirdGuidelineAction,
    applyNarrationGuidelineAction,
    applyScreenTitleGuidelineAction,
    applyStillGuidelineAction,
    applyTimelineArrowAction,
    applyVideoOverlayGuidelineAction,
    applyVideoOverlayStillGuidelineAction,
    audioSegments,
    clamp,
    deleteAudioSegmentById,
    deleteClipById,
    deleteGraphicById,
    deleteLogoById,
    deleteLowerThirdById,
    deleteNarrationById,
    deleteScreenTitleById,
    deleteStillById,
    deleteVideoOverlayById,
    deleteVideoOverlayStillById,
    duplicateAudioSegmentById,
    duplicateClipById,
    duplicateGraphicById,
    duplicateLogoById,
    duplicateLowerThirdById,
    duplicateNarrationById,
    duplicateScreenTitleById,
    duplicateStillById,
    duplicateVideoOverlayById,
    duplicateVideoOverlayStillById,
    ensureAudioConfigs,
    ensureScreenTitleFonts,
    ensureScreenTitlePresets,
    graphics,
    logos,
    lowerThirds,
    narration,
    normalizeHexColor,
    normalizeSpeedPresetMs,
    openScreenTitlePlacementById,
    playhead,
    roundToTenth,
    screenTitleLastInstanceById,
    screenTitles,
    setAudioEditor,
    setAudioEditorError,
    setClipEditor,
    setClipEditorError,
    setFreezeInsertError,
    setGraphicEditor,
    setGraphicEditorError,
    setLogoEditor,
    setLogoEditorError,
    setLowerThirdEditor,
    setLowerThirdEditorError,
    setNarrationEditor,
    setNarrationEditorError,
    setScreenTitleCustomizeEditor,
    setScreenTitleCustomizeError,
    setScreenTitleEditor,
    setScreenTitleEditorError,
    setSelectedAudioId,
    setSelectedClipId,
    setSelectedGraphicId,
    setSelectedLogoId,
    setSelectedLowerThirdId,
    setSelectedNarrationId,
    setSelectedScreenTitleId,
    setSelectedStillId,
    setSelectedVideoOverlayId,
    setSelectedVideoOverlayStillId,
    setStillEditor,
    setStillEditorError,
    setTimeline,
    setTimelineCtxMenu,
    setVideoOverlayEditor,
    setVideoOverlayEditorError,
    setVideoOverlayStillEditor,
    setVideoOverlayStillEditorError,
    snapshotUndo,
    splitAudioSegmentById,
    splitClipById,
    splitGraphicById,
    splitLogoById,
    splitLowerThirdById,
    splitNarrationById,
    splitScreenTitleById,
    splitStillById,
    splitVideoOverlayById,
    splitVideoOverlayStillById,
    stills,
    timeline,
    timelineCtxMenu,
    timelineCtxMenuOpenedAtRef,
    totalSeconds,
    videoOverlayStills,
    videoOverlays,
  } = ctx as any
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const menuKey = `${String(timelineCtxMenu?.kind || '')}:${String(timelineCtxMenu?.id || '')}:${String(
    timelineCtxMenu?.view || 'main',
  )}:${String(timelineCtxMenu?.edgeIntent || '')}`
  const [menuPos, setMenuPos] = React.useState(() => ({
    x: timelineCtxMenu?.x ?? 0,
    y: timelineCtxMenu?.y ?? 0,
  }))
  const snapTargetRef = (ctx as any).timelineCtxSnapTargetRef as
    | React.MutableRefObject<'timeline' | 'guideline' | 'object_lane' | 'object_any'>
    | undefined
  const [snapTarget, setSnapTarget] = React.useState<'timeline' | 'guideline' | 'object_lane' | 'object_any'>(() => {
    const initial = snapTargetRef?.current
    return initial || 'guideline'
  })
  const readHeaderPx = React.useCallback(() => {
    if (typeof window === 'undefined') return 44
    const headerEl = document.querySelector('[class*="sharedNav_container__"]') as HTMLElement | null
    if (headerEl) {
      const rect = headerEl.getBoundingClientRect()
      if (rect.height > 0) return rect.height
    }
    try {
      const probe = document.createElement('div')
      probe.style.position = 'fixed'
      probe.style.visibility = 'hidden'
      probe.style.height = 'var(--header-h, 44px)'
      document.body.appendChild(probe)
      const h = probe.getBoundingClientRect().height
      probe.remove()
      if (h > 0) return h
    } catch {}
    return 44
  }, [])
  const dragRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    startLeft: number
    startTop: number
  } | null>(null)

  React.useEffect(() => {
    if (!snapTargetRef) return
    snapTargetRef.current = snapTarget
  }, [snapTarget, snapTargetRef])

  React.useLayoutEffect(() => {
    if (!timelineCtxMenu) return
    setMenuPos({ x: timelineCtxMenu.x, y: timelineCtxMenu.y })
  }, [timelineCtxMenu, menuKey])

  React.useLayoutEffect(() => {
    if (!timelineCtxMenu) return
    const el = menuRef.current
    if (!el) return
    const margin = 8
    const rect = el.getBoundingClientRect()
    const viewportW = window.innerWidth || 0
    const viewportH = window.innerHeight || 0
    const headerPx = readHeaderPx()
    const minY = Math.max(margin, Math.round(headerPx) + 8)
    const maxX = Math.max(margin, viewportW - rect.width - margin)
    const maxY = Math.max(minY, viewportH - rect.height - margin)
    const nextX = Math.min(maxX, Math.max(margin, menuPos.x))
    const nextY = Math.min(maxY, Math.max(minY, menuPos.y))
    if (nextX !== menuPos.x || nextY !== menuPos.y) {
      setMenuPos({ x: nextX, y: nextY })
    }
  }, [timelineCtxMenu, menuKey, menuPos.x, menuPos.y])

  React.useEffect(() => {
    if (!timelineCtxMenu) return
    setTimelineCtxMenu((prev: any) => {
      if (!prev) return prev
      if (prev.x === menuPos.x && prev.y === menuPos.y) return prev
      return { ...prev, x: menuPos.x, y: menuPos.y }
    })
  }, [menuPos.x, menuPos.y, setTimelineCtxMenu, timelineCtxMenu])

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)
    } catch {}
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: menuPos.x,
      startTop: menuPos.y,
    }
  }

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const el = menuRef.current
    const rect = el ? el.getBoundingClientRect() : null
    const margin = 8
    const viewportW = window.innerWidth || 0
    const viewportH = window.innerHeight || 0
    const headerPx = readHeaderPx()
    const minY = Math.max(margin, Math.round(headerPx) + 8)
    const maxX = Math.max(margin, viewportW - (rect?.width || 0) - margin)
    const maxY = Math.max(minY, viewportH - (rect?.height || 0) - margin)
    const nextX = Math.min(maxX, Math.max(margin, drag.startLeft + dx))
    const nextY = Math.min(maxY, Math.max(minY, drag.startTop + dy))
    setMenuPos({ x: nextX, y: nextY })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
  }

  return (
		          <div
		            role="dialog"
		            aria-modal="true"
		            style={{ position: 'fixed', inset: 0, zIndex: 1400, pointerEvents: 'none' }}
		            onClickCapture={(e) => {
		              const openedAt = timelineCtxMenuOpenedAtRef.current
		              if (openedAt == null) return
		              if (performance.now() - openedAt < 120) {
		              timelineCtxMenuOpenedAtRef.current = null
		              e.preventDefault()
		              e.stopPropagation()
		            }
		          }}
		        >
		          <div
                ref={menuRef}
		            style={{
		              position: 'fixed',
		              left: menuPos.x,
		              top: menuPos.y,
		              width: 170,
		              background: 'rgba(0,0,0,0.55)',
		              backdropFilter: 'blur(6px)',
		              WebkitBackdropFilter: 'blur(6px)',
		              border: '1px solid rgba(255,255,255,0.18)',
		              borderRadius: 14,
		              padding: 8,
		              display: 'grid',
		              gap: 8,
		              boxShadow: 'none',
                  maxHeight: 'calc(100vh - 16px)',
                  overflowY: 'auto',
                  pointerEvents: 'auto',
		            }}
		            onPointerDown={(e) => e.stopPropagation()}
			          >
                  <div
                    onPointerDown={startDrag}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    style={{
                      height: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'grab',
                      touchAction: 'none',
                      position: 'relative',
                    }}
                    title="Drag panel"
                  >
                    <div style={{ width: 44, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.22)' }} />
                    <button
                      type="button"
                      onClick={() => setTimelineCtxMenu(null)}
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 28,
                        height: 28,
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#0c0c0c',
                        color: '#fff',
                        fontWeight: 800,
                        cursor: 'pointer',
                        lineHeight: '26px',
                        textAlign: 'center',
                      }}
                    >
                      ×
                    </button>
                  </div>

			            {(timelineCtxMenu.view || 'main') === 'main' ? (
			              <>
			                <button
			                  type="button"
			                  onClick={() => {
				                    if (timelineCtxMenu.kind === 'graphic') {
				                      const g = graphics.find((gg) => String((gg as any).id) === String(timelineCtxMenu.id)) as any
				                      if (g) {
				                        const s = roundToTenth(Number((g as any).startSeconds || 0))
				                        const e2 = roundToTenth(Number((g as any).endSeconds || 0))
                        const fitModeRaw = (g as any).fitMode != null ? String((g as any).fitMode) : ''
                        const fitMode: 'cover_full' | 'contain_transparent' =
                          fitModeRaw === 'contain_transparent' ? 'contain_transparent' : 'cover_full'
                        const sizePctWidthRaw = Number((g as any).sizePctWidth)
                        const sizePctWidth = Number.isFinite(sizePctWidthRaw)
                          ? Math.round(clamp(sizePctWidthRaw, 10, 100))
                          : fitMode === 'cover_full'
                            ? 100
                            : 70
                        const posRaw = String((g as any).position || 'middle_center')
                        const allowedPos = new Set([
                          'top_left',
                          'top_center',
                          'top_right',
                          'middle_left',
                          'middle_center',
                          'middle_right',
                          'bottom_left',
                          'bottom_center',
                          'bottom_right',
                        ])
                        let position = (allowedPos.has(posRaw) ? posRaw : 'middle_center') as any
                        const insetXPxRaw = Number((g as any).insetXPx)
                        const insetYPxRaw = Number((g as any).insetYPx)
                        const insetXPx = Math.round(clamp(Number.isFinite(insetXPxRaw) ? insetXPxRaw : 24, 0, 300))
                        const insetYPx = Math.round(clamp(Number.isFinite(insetYPxRaw) ? insetYPxRaw : 24, 0, 300))
                        const borderWidthAllowed = new Set([0, 2, 4, 6])
                        const borderWidthRaw = Number((g as any).borderWidthPx)
                        const borderWidthPx = (borderWidthAllowed.has(borderWidthRaw) ? borderWidthRaw : 0) as any
                        const borderColor = String((g as any).borderColor || '#000000')
                        const fadeRaw = String((g as any).fade || 'none').trim().toLowerCase()
                        const fade = (fadeRaw === 'none' ? 'none' : 'in_out') as any
                        const fadeDurationRaw = Number((g as any).fadeDurationMs)
                        const fadeDurationMs = normalizeSpeedPresetMs(fadeDurationRaw, 600)
                        const animateRaw = String((g as any).animate || 'none').trim().toLowerCase()
                        const animateAllowed = new Set(['none', 'slide_in', 'slide_out', 'slide_in_out', 'doc_reveal'])
                        const animateModeRaw = animateAllowed.has(animateRaw) ? animateRaw : 'none'
                        const animate = (animateModeRaw === 'doc_reveal' ? 'doc_reveal' : animateModeRaw === 'none' ? 'none' : 'slide_in_out') as any
                        const animateDurationRaw = Number((g as any).animateDurationMs)
                        const animateDurationMs = normalizeSpeedPresetMs(animateDurationRaw, 600)
                        const mode: 'full' | 'positioned' | 'animated' =
                          animate !== 'none' ? 'animated' : fitMode === 'contain_transparent' ? 'positioned' : 'full'
                        if (mode === 'animated') {
                          if (position.includes('top')) position = 'top_center'
                          else if (position.includes('bottom')) position = 'bottom_center'
                          else position = 'middle_center'
                        }
                        if (mode === 'animated' && animate === 'doc_reveal') {
                          position = 'middle_center'
                        }
                        setSelectedGraphicId(String((g as any).id))
                        setSelectedClipId(null)
                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
                        setSelectedNarrationId(null)
                        setSelectedStillId(null)
                        setSelectedAudioId(null)
                        setGraphicEditor({
                          id: String((g as any).id),
                          start: s,
                          end: e2,
                          mode,
                          fitMode,
                          sizePctWidth: animate === 'doc_reveal' ? 100 : sizePctWidth,
                          position,
                          insetXPx: mode === 'animated' ? 0 : insetXPx,
                          insetYPx: animate === 'doc_reveal' ? 0 : insetYPx,
                          borderWidthPx,
                          borderColor,
                          fade,
                          fadeDurationMs,
                          animate,
                          animateDurationMs,
                        })
                        setGraphicEditorError(null)
                      }
                    } else if (timelineCtxMenu.kind === 'logo') {
                      const l = logos.find((ll) => String((ll as any).id) === String(timelineCtxMenu.id)) as any
	                      if (l) {
	                        const s = roundToTenth(Number((l as any).startSeconds || 0))
	                        const e2 = roundToTenth(Number((l as any).endSeconds || 0))
	                        const sizePctWidthRaw = Math.round(Number((l as any).sizePctWidth))
                        const sizeAllowed = new Set([10, 20, 30, 40, 50])
                        const sizePctWidth = sizeAllowed.has(sizePctWidthRaw) ? sizePctWidthRaw : 20
                        const posRaw = String((l as any).position || 'top_left')
                        const posAllowed = new Set([
                          'top_left',
                          'top_center',
                          'top_right',
                          'middle_left',
                          'middle_center',
                          'middle_right',
                          'bottom_left',
                          'bottom_center',
                          'bottom_right',
                        ])
                        const position = (posAllowed.has(posRaw) ? posRaw : 'top_left') as any
	                        const opacityRaw = Number((l as any).opacityPct)
	                        const opacityPct = Math.round(clamp(Number.isFinite(opacityRaw) ? opacityRaw : 100, 0, 100))
	                        const fadeRaw = String((l as any).fade || 'none')
	                        const fadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
	                        const fade = (fadeAllowed.has(fadeRaw) ? fadeRaw : 'none') as any
	                        const insetXPxRaw = Number((l as any).insetXPx)
	                        const insetYPxRaw = Number((l as any).insetYPx)
	                        const insetXPx = Math.round(clamp(Number.isFinite(insetXPxRaw) ? insetXPxRaw : 24, 0, 300))
	                        const insetYPx = Math.round(clamp(Number.isFinite(insetYPxRaw) ? insetYPxRaw : 24, 0, 300))
	                        const insetMax = Math.max(insetXPx, insetYPx)
	                        const insetPreset = (insetMax <= 75 ? 'small' : insetMax <= 125 ? 'medium' : 'large') as any
	                        setSelectedLogoId(String((l as any).id))
	                        setSelectedClipId(null)
	                        setSelectedGraphicId(null)
	                        setSelectedLowerThirdId(null)
	                        setSelectedScreenTitleId(null)
	                        setSelectedNarrationId(null)
	                        setSelectedStillId(null)
	                        setSelectedAudioId(null)
	                        setLogoEditor({ id: String((l as any).id), start: s, end: e2, sizePctWidth, insetPreset, position, opacityPct, fade })
	                        setLogoEditorError(null)
	                      }
	                    } else if (timelineCtxMenu.kind === 'lowerThird') {
			                      const lt = lowerThirds.find((ll) => String((ll as any).id) === String(timelineCtxMenu.id)) as any
			                      if (lt) {
			                        const s = roundToTenth(Number((lt as any).startSeconds || 0))
			                        const e2 = roundToTenth(Number((lt as any).endSeconds || 0))
			                        setSelectedLowerThirdId(String((lt as any).id))
			                        setSelectedClipId(null)
			                        setSelectedGraphicId(null)
			                        setSelectedLogoId(null)
			                        setSelectedScreenTitleId(null)
			                        setSelectedNarrationId(null)
			                        setSelectedStillId(null)
			                        setSelectedAudioId(null)
			                        setLowerThirdEditor({
			                          id: String((lt as any).id),
			                          start: s,
			                          end: e2,
			                          configId: Number((lt as any).configId || 0),
			                        })
			                        setLowerThirdEditorError(null)
			                      }
				                    } else if (timelineCtxMenu.kind === 'screenTitle') {
				                      const st = screenTitles.find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
				                      if (st) {
				                        const s = roundToTenth(Number((st as any).startSeconds || 0))
				                        const e2 = roundToTenth(Number((st as any).endSeconds || 0))
				                        setSelectedScreenTitleId(String((st as any).id))
				                        setSelectedClipId(null)
				                        setSelectedVideoOverlayId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
				                        setScreenTitleEditor({ id: String((st as any).id), start: s, end: e2 })
				                        setScreenTitleEditorError(null)
				                      }
				                    } else if (timelineCtxMenu.kind === 'videoOverlay') {
				                      const o = videoOverlays.find((oo: any) => String((oo as any).id) === String(timelineCtxMenu.id)) as any
				                      if (o) {
					                        const sizePctWidth = Number((o as any).sizePctWidth || 33)
					                        const position = String((o as any).position || 'top_right') as any
					                        const audioEnabled = Boolean((o as any).audioEnabled)
					                        const boostDb = (o as any).boostDb == null ? 0 : Number((o as any).boostDb)
                              const plateStyle = String((o as any).plateStyle || 'none') as any
                              const plateColor = String((o as any).plateColor || '#000000')
                              const plateOpacityPct = Number((o as any).plateOpacityPct ?? 85)
					                        setSelectedVideoOverlayId(String((o as any).id))
					                        setSelectedVideoOverlayStillId(null)
					                        setSelectedClipId(null)
					                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
					                        setSelectedNarrationId(null)
					                        setSelectedStillId(null)
					                        setSelectedAudioId(null)
					                        setVideoOverlayEditor({
                              id: String((o as any).id),
                              sizePctWidth,
                              position,
                              audioEnabled,
                              boostDb,
                              plateStyle,
                              plateColor,
                              plateOpacityPct,
                            })
					                        setVideoOverlayEditorError(null)
					                      }
				                    } else if (timelineCtxMenu.kind === 'videoOverlayStill') {
				                      const s0 = (videoOverlayStills as any[]).find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
				                      if (s0) {
				                        const s = roundToTenth(Number((s0 as any).startSeconds || 0))
				                        const e2 = roundToTenth(Number((s0 as any).endSeconds || 0))
				                        setSelectedVideoOverlayStillId(String((s0 as any).id))
				                        setSelectedVideoOverlayId(null)
				                        setSelectedClipId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
				                        setVideoOverlayStillEditor({ id: String((s0 as any).id), start: s, end: e2 })
				                        setVideoOverlayStillEditorError(null)
				                      }
				                    } else if (timelineCtxMenu.kind === 'still') {
				                      const s0 = stills.find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
				                      if (s0) {
				                        const s = roundToTenth(Number((s0 as any).startSeconds || 0))
				                        const e2 = roundToTenth(Number((s0 as any).endSeconds || 0))
				                        setSelectedStillId(String((s0 as any).id))
				                        setSelectedClipId(null)
				                        setSelectedVideoOverlayId(null)
				                        setSelectedVideoOverlayStillId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedAudioId(null)
				                        setStillEditor({ id: String((s0 as any).id), start: s, end: e2 })
				                        setStillEditorError(null)
				                      }
				                    } else if (timelineCtxMenu.kind === 'clip') {
				                      const idx = timeline.clips.findIndex((c) => String(c.id) === String(timelineCtxMenu.id))
				                      if (idx >= 0) {
				                        const clip = timeline.clips[idx]
				                        setSelectedClipId(String(clip.id))
				                        setSelectedVideoOverlayId(null)
				                        setSelectedVideoOverlayStillId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
					                        setClipEditor({
					                          id: clip.id,
					                          start: clip.sourceStartSeconds,
					                          end: clip.sourceEndSeconds,
					                          boostDb: (clip as any).boostDb == null ? 0 : Number((clip as any).boostDb),
					                          bgFillStyle:
					                            String((clip as any).bgFillStyle || 'none').toLowerCase() === 'blur'
					                              ? 'blur'
					                              : String((clip as any).bgFillStyle || 'none').toLowerCase() === 'color'
					                                ? 'color'
					                                : String((clip as any).bgFillStyle || 'none').toLowerCase() === 'image'
					                                  ? 'image'
					                                  : 'none',
					                          bgFillBrightness:
					                            String((clip as any).bgFillBrightness || 'neutral').toLowerCase() === 'light3'
					                              ? 'light3'
					                              : String((clip as any).bgFillBrightness || 'neutral').toLowerCase() === 'light2'
					                                ? 'light2'
					                                : String((clip as any).bgFillBrightness || 'neutral').toLowerCase() === 'light1'
					                                  ? 'light1'
					                                  : String((clip as any).bgFillBrightness || 'neutral').toLowerCase() === 'dim1'
					                                    ? 'dim1'
					                                    : String((clip as any).bgFillBrightness || 'neutral').toLowerCase() === 'dim3'
					                                      ? 'dim3'
					                                      : String((clip as any).bgFillBrightness || 'neutral').toLowerCase() === 'dim2'
					                                        ? 'dim2'
					                                        : 'neutral',
					                          bgFillBlur:
					                            String((clip as any).bgFillBlur || 'medium').toLowerCase() === 'soft'
					                              ? 'soft'
					                              : String((clip as any).bgFillBlur || 'medium').toLowerCase() === 'strong'
					                                ? 'strong'
					                                : String((clip as any).bgFillBlur || 'medium').toLowerCase() === 'very_strong'
					                                  ? 'very_strong'
					                                  : 'medium',
					                          bgFillColor: normalizeHexColor((clip as any).bgFillColor, '#000000'),
					                          bgFillImageUploadId:
					                            Number.isFinite(Number((clip as any).bgFillImageUploadId)) && Number((clip as any).bgFillImageUploadId) > 0
					                              ? Number((clip as any).bgFillImageUploadId)
					                              : null,
					                        })
				                        setClipEditorError(null)
				                        setFreezeInsertError(null)
				                      }
					                    } else if (timelineCtxMenu.kind === 'narration') {
					                      const n = narration.find((nn: any) => String((nn as any).id) === String(timelineCtxMenu.id)) as any
					                      if (n) {
				                        const s = roundToTenth(Number((n as any).startSeconds || 0))
				                        const e2 = roundToTenth(Number((n as any).endSeconds || 0))
				                        setSelectedNarrationId(String((n as any).id))
				                        setSelectedClipId(null)
				                        setSelectedVideoOverlayId(null)
				                        setSelectedVideoOverlayStillId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
					                        setNarrationEditor({
					                          id: String((n as any).id),
					                          start: s,
					                          end: e2,
					                          boostDb:
					                            (n as any).boostDb != null && Number.isFinite(Number((n as any).boostDb))
					                              ? Number((n as any).boostDb)
					                              : (n as any).gainDb == null
					                                ? 0
					                                : Number((n as any).gainDb),
                                    visualizer: normalizeNarrationVisualizer((n as any).visualizer),
					                        })
					                        setNarrationEditorError(null)
					                      }
					                    } else if (timelineCtxMenu.kind === 'audioSegment') {
					                      const seg = audioSegments.find((aa: any) => String((aa as any).id) === String(timelineCtxMenu.id)) as any
					                      if (seg) {
					                        const s = roundToTenth(Number((seg as any).startSeconds || 0))
					                        const e2 = roundToTenth(Number((seg as any).endSeconds || 0))
					                        setSelectedAudioId(String((seg as any).id))
					                        setSelectedClipId(null)
					                        setSelectedVideoOverlayId(null)
					                        setSelectedVideoOverlayStillId(null)
					                        setSelectedGraphicId(null)
					                        setSelectedLogoId(null)
					                        setSelectedLowerThirdId(null)
					                        setSelectedScreenTitleId(null)
					                        setSelectedNarrationId(null)
					                        setSelectedStillId(null)
					                        setAudioEditorError(null)
					                        void (async () => {
					                          try {
					                            await ensureAudioConfigs()
					                          } catch {}
					                        })()
						                        setAudioEditor({
						                          id: String((seg as any).id),
						                          start: s,
						                          end: e2,
						                          audioConfigId: (seg as any).audioConfigId == null ? 0 : Number((seg as any).audioConfigId),
						                          musicMode: (seg as any).musicMode == null ? '' : (String((seg as any).musicMode) as any),
						                          musicLevel: (seg as any).musicLevel == null ? '' : (String((seg as any).musicLevel) as any),
						                          duckingIntensity: (seg as any).duckingIntensity == null ? '' : (String((seg as any).duckingIntensity) as any),
						                        })
						                      }
						                    }
						                    setTimelineCtxMenu(null)
						                  }}
			                  style={{
			                    width: '100%',
			                    padding: '10px 12px',
			                    borderRadius: 10,
			                    border: '1px solid rgba(255,255,255,0.18)',
			                    background: '#000',
			                    color: '#fff',
			                    fontWeight: 900,
			                    cursor: 'pointer',
			                    textAlign: 'left',
			                  }}
					                >
					                  Properties
					                </button>
                        {timelineCtxMenu.kind === 'clip' || timelineCtxMenu.kind === 'videoOverlay' || timelineCtxMenu.kind === 'narration' || timelineCtxMenu.kind === 'audioSegment' ? (
                          <button
                            type="button"
                            onClick={() => {
                              snapshotUndo()
                              setTimeline((prev) => {
                                if (timelineCtxMenu.kind === 'clip') {
                                  const prevClips: any[] = Array.isArray((prev as any).clips) ? ((prev as any).clips as any[]) : []
                                  const idx = prevClips.findIndex((c: any) => String(c?.id) === String(timelineCtxMenu.id))
                                  if (idx < 0) return prev
                                  const cur = prevClips[idx]
                                  const nextEnabled = cur?.audioEnabled === false
                                  const nextClips = prevClips.slice()
                                  nextClips[idx] = { ...(cur as any), audioEnabled: nextEnabled }
                                  return { ...(prev as any), clips: nextClips } as any
                                }
                                if (timelineCtxMenu.kind === 'videoOverlay') {
                                  const prevVos: any[] = Array.isArray((prev as any).videoOverlays) ? ((prev as any).videoOverlays as any[]) : []
                                  const idx = prevVos.findIndex((o: any) => String(o?.id) === String(timelineCtxMenu.id))
                                  if (idx < 0) return prev
                                  const cur = prevVos[idx]
                                  const nextEnabled = !(cur?.audioEnabled === true)
                                  const next = prevVos.slice()
                                  next[idx] = { ...(cur as any), audioEnabled: nextEnabled }
                                  return { ...(prev as any), videoOverlays: next } as any
                                }
                                if (timelineCtxMenu.kind === 'narration') {
                                  const prevNs: any[] = Array.isArray((prev as any).narration) ? ((prev as any).narration as any[]) : []
                                  const idx = prevNs.findIndex((n: any) => String(n?.id) === String(timelineCtxMenu.id))
                                  if (idx < 0) return prev
                                  const cur = prevNs[idx]
                                  const nextEnabled = cur?.audioEnabled === false
                                  const next = prevNs.slice()
                                  next[idx] = { ...(cur as any), audioEnabled: nextEnabled }
                                  return { ...(prev as any), narration: next } as any
                                }
                                if (timelineCtxMenu.kind === 'audioSegment') {
                                  const prevSegs: any[] = Array.isArray((prev as any).audioSegments) ? ((prev as any).audioSegments as any[]) : []
                                  const idx = prevSegs.findIndex((s: any) => String(s?.id) === String(timelineCtxMenu.id))
                                  if (idx < 0) return prev
                                  const cur = prevSegs[idx]
                                  const nextEnabled = cur?.audioEnabled === false
                                  const next = prevSegs.slice()
                                  next[idx] = { ...(cur as any), audioEnabled: nextEnabled }
                                  return { ...(prev as any), audioSegments: next } as any
                                }
                                return prev
                              })
                            }}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(255,255,255,0.18)',
                              background: '#000',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            {(() => {
                              const enabled =
                                timelineCtxMenu.kind === 'clip'
                                  ? (timeline.clips.find((c) => String((c as any).id) === String(timelineCtxMenu.id)) as any)?.audioEnabled !== false
                                  : timelineCtxMenu.kind === 'videoOverlay'
                                    ? Boolean(
                                        (videoOverlays.find((o: any) => String((o as any).id) === String(timelineCtxMenu.id)) as any)?.audioEnabled
                                      )
                                    : timelineCtxMenu.kind === 'narration'
                                      ? (narration.find((n: any) => String((n as any).id) === String(timelineCtxMenu.id)) as any)?.audioEnabled !== false
                                      : (audioSegments.find((s: any) => String((s as any).id) === String(timelineCtxMenu.id)) as any)?.audioEnabled !== false
                              return (
                                <>
                                  <span style={{ color: '#bbb', fontWeight: 900 }}>Audio: </span>
                                  <span style={{ color: enabled ? '#30d158' : '#ff453a', fontWeight: 900 }}>{enabled ? 'On' : 'Off'}</span>
                                </>
                              )
                            })()}
                          </button>
                        ) : null}
                        {timelineCtxMenu.kind === 'screenTitle' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const st = screenTitles.find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
                                if (!st) return
                                const presetId = Number((st as any)?.presetId || 0)
                                if (!Number.isFinite(presetId) || presetId <= 0) {
                                  setScreenTitleCustomizeError('Pick a screen title style.')
                                  return
                                }
                                setSelectedScreenTitleId(String((st as any).id))
                                setSelectedClipId(null)
                                setSelectedVideoOverlayId(null)
                                setSelectedGraphicId(null)
                                setSelectedLogoId(null)
                                setSelectedLowerThirdId(null)
                                setSelectedNarrationId(null)
                                setSelectedStillId(null)
                                setSelectedAudioId(null)
                                const rawInstances = Array.isArray((st as any).instances) ? ((st as any).instances as any[]) : []
                                const instances =
                                  rawInstances.length > 0
                                    ? rawInstances.map((inst: any, idx: number) => ({
                                        id: String(inst?.id || `${String((st as any).id)}_i${idx + 1}`),
                                        text: inst?.text == null ? '' : String(inst.text),
                                        customStyle: inst?.customStyle ? { ...(inst.customStyle as any) } : null,
                                      }))
                                    : [
                                        {
                                          id: `${String((st as any).id)}_i1`,
                                          text: String((st as any).text || ''),
                                          customStyle: (st as any).customStyle ? { ...(st as any).customStyle } : null,
                                        },
                                      ]
                                const stId = String((st as any).id)
                                const preferred = screenTitleLastInstanceById[stId]
                                const preferredExists = preferred && instances.some((inst: any) => String(inst.id) === String(preferred))
                                setScreenTitleCustomizeEditor({
                                  id: stId,
                                  presetId,
                                  instances,
                                  activeInstanceId: String(preferredExists ? preferred : instances[0]?.id || ''),
                                })
                                setScreenTitleCustomizeError(null)
                                void ensureScreenTitlePresets()
                                void ensureScreenTitleFonts()
                                setTimelineCtxMenu(null)
                              }}
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid rgba(255,255,255,0.18)',
                                background: '#000',
                                color: '#fff',
                                fontWeight: 900,
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                            >
                              Text
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setTimelineCtxMenu((prev) =>
                                  prev
                                    ? { ...prev, view: 'screenTitlePlacementPick' }
                                    : prev
                                )
                              }}
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid rgba(255,255,255,0.18)',
                                background: '#000',
                                color: '#fff',
                                fontWeight: 900,
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                            >
                              Style/Placement
                            </button>
                          </>
                        ) : null}
			                <button
			                  type="button"
				                  onClick={() => {
					                    if (timelineCtxMenu.kind === 'graphic') splitGraphicById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'still') splitStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlayStill') splitVideoOverlayStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'logo') splitLogoById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'lowerThird') splitLowerThirdById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'screenTitle') splitScreenTitleById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlay') splitVideoOverlayById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'clip') splitClipById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'narration') splitNarrationById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'audioSegment') splitAudioSegmentById(timelineCtxMenu.id)
					                    setTimelineCtxMenu(null)
					                  }}
			                  style={{
			                    width: '100%',
			                    padding: '10px 12px',
			                    borderRadius: 10,
			                    border: '1px solid rgba(255,255,255,0.18)',
			                    background: '#000',
			                    color: '#fff',
			                    fontWeight: 900,
			                    cursor: 'pointer',
			                    textAlign: 'left',
			                  }}
			                >
			                  Split
			                </button>
			                <button
			                  type="button"
				                  onClick={() => {
					                    if (timelineCtxMenu.kind === 'graphic') duplicateGraphicById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'still') duplicateStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlayStill') duplicateVideoOverlayStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'logo') duplicateLogoById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'lowerThird') duplicateLowerThirdById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'screenTitle') duplicateScreenTitleById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlay') duplicateVideoOverlayById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'clip') duplicateClipById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'narration') duplicateNarrationById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'audioSegment') duplicateAudioSegmentById(timelineCtxMenu.id)
					                    setTimelineCtxMenu(null)
					                  }}
			                  style={{
			                    width: '100%',
			                    padding: '10px 12px',
			                    borderRadius: 10,
			                    border: '1px solid rgba(255,255,255,0.18)',
			                    background: '#000',
			                    color: '#fff',
			                    fontWeight: 900,
			                    cursor: 'pointer',
			                    textAlign: 'left',
			                  }}
			                >
			                  Duplicate
			                </button>
			                <button
			                  type="button"
				                  onClick={() => {
					                    if (timelineCtxMenu.kind === 'graphic') deleteGraphicById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'still') deleteStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlayStill') deleteVideoOverlayStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'logo') deleteLogoById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'lowerThird') deleteLowerThirdById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'screenTitle') deleteScreenTitleById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlay') deleteVideoOverlayById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'clip') deleteClipById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'narration') deleteNarrationById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'audioSegment') deleteAudioSegmentById(timelineCtxMenu.id)
					                    setTimelineCtxMenu(null)
					                  }}
			                  style={{
			                    width: '100%',
			                    padding: '10px 12px',
			                    borderRadius: 10,
			                    border: '1px solid rgba(255,155,155,0.40)',
			                    background: '#300',
			                    color: '#fff',
			                    fontWeight: 900,
			                    cursor: 'pointer',
			                    textAlign: 'left',
			                  }}
			                >
			                  Delete
			                </button>
			              </>
			            ) : (timelineCtxMenu.view === 'screenTitlePlacementPick' ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setTimelineCtxMenu((prev) => (prev ? { ...prev, view: 'main' } : prev))
                        }
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: '#000',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        Back
                      </button>
                      {(() => {
                        if (timelineCtxMenu.kind !== 'screenTitle') return null
                        const st = screenTitles.find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
                        if (!st) {
                          return (
                            <div style={{ color: '#ff9b9b', fontSize: 13, fontWeight: 800, padding: '4px 2px' }}>
                              Screen title not found.
                            </div>
                          )
                        }
                        const rawInstances = Array.isArray((st as any).instances) ? ((st as any).instances as any[]) : []
                        const instances =
                          rawInstances.length > 0
                            ? rawInstances.map((inst: any, idx: number) => ({
                                id: String(inst?.id || `${String((st as any).id)}_i${idx + 1}`),
                              }))
                            : [{ id: `${String((st as any).id)}_i1` }]
                        const stId = String((st as any).id)
                        const preferred = String(screenTitleLastInstanceById[stId] || instances[0]?.id || '')
                        return instances.map((inst: any, idx: number) => {
                          const isPreferred = String(inst.id) === preferred
                          return (
                            <button
                              key={String(inst.id)}
                              type="button"
                              onClick={() => {
                                if (openScreenTitlePlacementById(String(stId), String(inst.id))) {
                                  setTimelineCtxMenu(null)
                                }
                              }}
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: `1px solid ${isPreferred ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.18)'}`,
                                background: isPreferred ? 'rgba(96,165,250,0.14)' : '#000',
                                color: '#fff',
                                fontWeight: 900,
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                            >
                              {`Instance ${idx + 1}`}
                            </button>
                          )
                        })
                      })()}
                    </>
                  ) : (
                    <>
                      {(() => {
                        const edgeIntentRaw: any = timelineCtxMenu.edgeIntent || 'move'
                        const resizeEdge: 'start' | 'end' | null =
                          edgeIntentRaw === 'start' || edgeIntentRaw === 'end' ? edgeIntentRaw : null
                        const snapLabel =
                          snapTarget === 'guideline'
                            ? 'Guidelines'
                            : snapTarget === 'object_lane'
                              ? 'Objects'
                              : snapTarget === 'object_any'
                                ? 'Objects *'
                                : 'Timeline'
                        const snapTitle = snapLabel
                        const cycleSnapTarget = () => {
                          setSnapTarget((prev) => {
                            if (prev === 'guideline') return 'object_lane'
                            if (prev === 'object_lane') return 'object_any'
                            if (prev === 'object_any') return 'timeline'
                            return 'guideline'
                          })
                        }
                        const arrowButtonStyle = (disabled?: boolean) => ({
                          width: '100%',
                          height: 44,
                          borderRadius: 12,
                          border: '1px solid rgba(96,165,250,0.95)',
                          background: '#000',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: 1,
                        })
                        const handleAction = (mode: 'move' | 'resize', dir: 'left' | 'right') => {
                          if (mode === 'resize' && !resizeEdge) return
                          applyTimelineArrowAction(
                            timelineCtxMenu.kind,
                            timelineCtxMenu.id,
                            mode,
                            dir,
                            snapTarget,
                            resizeEdge || undefined
                          )
                        }
                        return (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 2px 0' }}>
                              <button
                                type="button"
                                onClick={cycleSnapTarget}
                                title={`Target: ${snapTitle}`}
                                style={{
                                  borderRadius: 10,
                                  border: '1px solid rgba(212,175,55,0.92)',
                                  background: '#000',
                                  color: 'rgba(212,175,55,0.95)',
                                  fontWeight: 900,
                                  padding: '6px 10px',
                                  cursor: 'pointer',
                                  minWidth: 90,
                                  textAlign: 'center',
                                }}
                              >
                                {snapLabel}
                              </button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 2px 0' }}>
                              <div style={{ fontSize: 12, fontWeight: 900, color: '#fff' }}>Move</div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                              <button type="button" onClick={() => handleAction('move', 'left')} style={arrowButtonStyle()}>
                                <img
                                  src={ACTION_ARROW_ICON_URL}
                                  alt=""
                                  aria-hidden
                                  style={{ width: 22, height: 22, display: 'block', transform: 'scaleX(-1)', filter: 'brightness(0) invert(1)' }}
                                />
                              </button>
                              <button type="button" onClick={() => handleAction('move', 'right')} style={arrowButtonStyle()}>
                                <img
                                  src={ACTION_ARROW_ICON_URL}
                                  alt=""
                                  aria-hidden
                                  style={{ width: 22, height: 22, display: 'block', filter: 'brightness(0) invert(1)' }}
                                />
                              </button>
                            </div>

                            <div style={{ fontSize: 12, fontWeight: 900, color: '#fff', padding: '6px 2px 0' }}>Expand/Contract</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                              <button
                                type="button"
                                disabled={!resizeEdge}
                                onClick={() => handleAction('resize', 'left')}
                                style={arrowButtonStyle(!resizeEdge)}
                              >
                                <img
                                  src={ACTION_ARROW_ICON_URL}
                                  alt=""
                                  aria-hidden
                                  style={{ width: 22, height: 22, display: 'block', transform: 'scaleX(-1)', filter: 'brightness(0) invert(1)' }}
                                />
                              </button>
                              <button
                                type="button"
                                disabled={!resizeEdge}
                                onClick={() => handleAction('resize', 'right')}
                                style={arrowButtonStyle(!resizeEdge)}
                              >
                                <img
                                  src={ACTION_ARROW_ICON_URL}
                                  alt=""
                                  aria-hidden
                                  style={{ width: 22, height: 22, display: 'block', filter: 'brightness(0) invert(1)' }}
                                />
                              </button>
                            </div>
                          </>
                        )
                      })()}
                    </>
                  ))}
			          </div>
			        </div>
  )
}
