import React from 'react'

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
    applyTimelineExpandEndAction,
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
    getTimelineCtxSegmentEnd,
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

  return (
		        <div
		          role="dialog"
		          aria-modal="true"
		          style={{ position: 'fixed', inset: 0, zIndex: 1400 }}
		          onClickCapture={(e) => {
		            const openedAt = timelineCtxMenuOpenedAtRef.current
		            if (openedAt == null) return
		            if (performance.now() - openedAt < 120) {
		              timelineCtxMenuOpenedAtRef.current = null
		              e.preventDefault()
		              e.stopPropagation()
		            }
		          }}
		          onPointerDown={() => setTimelineCtxMenu(null)}
		        >
		          <div
		            style={{
		              position: 'fixed',
		              left: timelineCtxMenu.x,
		              top: timelineCtxMenu.y,
		              width: 170,
		              background: (timelineCtxMenu.view || 'main') === 'guidelines' ? 'rgba(48,209,88,0.95)' : '#0756a6',
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
			              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
			                <div
			                  style={{
			                    fontSize: 13,
			                    fontWeight: 900,
			                    color: (timelineCtxMenu.view || 'main') === 'guidelines' ? '#0b0b0b' : '#bbb',
			                  }}
			                >
				                  {(timelineCtxMenu.view || 'main') === 'guidelines'
				                    ? 'Actions'
                              : (timelineCtxMenu.view || 'main') === 'screenTitlePlacementPick'
                                ? 'Quick Changes'
					                    : timelineCtxMenu.kind === 'audioSegment'
					                      ? 'Audio'
					                    : timelineCtxMenu.kind === 'still'
					                      ? 'Freeze Frame'
					                    : timelineCtxMenu.kind === 'videoOverlayStill'
					                      ? 'Overlay Freeze'
					                    : timelineCtxMenu.kind === 'logo'
					                      ? 'Logo'
					                      : timelineCtxMenu.kind === 'lowerThird'
				                        ? 'Lower Third'
				                        : timelineCtxMenu.kind === 'screenTitle'
				                          ? 'Screen Title'
						                    : timelineCtxMenu.kind === 'narration'
						                            ? 'Narration'
						                          : timelineCtxMenu.kind === 'clip'
						                            ? 'Video'
						                          : timelineCtxMenu.kind === 'videoOverlay'
						                            ? 'Video Overlay'
					                        : 'Graphic'}
					                </div>
			              </div>
			              <button
			                type="button"
			                onClick={() => setTimelineCtxMenu(null)}
			                style={{
			                  width: 28,
			                  height: 28,
			                  borderRadius: 10,
			                  border: '1px solid rgba(255,255,255,0.18)',
			                  background: '#000',
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
                        {timelineCtxMenu.kind === 'clip' || timelineCtxMenu.kind === 'videoOverlay' || timelineCtxMenu.kind === 'narration' ? (
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
                                    : (narration.find((n: any) => String((n as any).id) === String(timelineCtxMenu.id)) as any)?.audioEnabled !== false
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
                              Customize Style
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
                              Quick Changes
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
			                  const edgeIntent: any = timelineCtxMenu.edgeIntent || 'move'
			                  if (edgeIntent === 'move') return null
			                  const expandAction = edgeIntent === 'start' ? 'expand_start' : 'expand_end'
			                  const contractAction = edgeIntent === 'start' ? 'contract_start' : 'contract_end'
			                  const expandDir: 'left' | 'right' = edgeIntent === 'start' ? 'left' : 'right'
			                  const contractDir: 'left' | 'right' = edgeIntent === 'start' ? 'right' : 'left'
			                  const snapDir: 'left' | 'right' = edgeIntent === 'start' ? 'left' : 'right'
                        const renderMenuArrowLabel = (text: string, dir: 'left' | 'right') => (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span>{text}</span>
                            <img
                              src={ACTION_ARROW_ICON_URL}
                              alt=""
                              aria-hidden
                              style={{
                                width: 20,
                                height: 20,
                                display: 'block',
                                transform: dir === 'left' ? 'scaleX(-1)' : 'none',
                                filter: 'brightness(0) invert(1)',
                              }}
                            />
                          </span>
                        )
			                  const playheadGuidelinesOverride = [roundToTenth(playhead)]
                        const segEnd = getTimelineCtxSegmentEnd(timelineCtxMenu.kind, timelineCtxMenu.id)
                        const timelineExpandDisabled =
                          edgeIntent !== 'end' || segEnd == null || Number(segEnd) >= roundToTenth(Number(totalSeconds) || 0) - 1e-6
			                  return (
			                    <>
			                      <div style={{ fontSize: 12, fontWeight: 900, color: '#0b0b0b', padding: '2px 2px 0' }}>Guidelines</div>
			                      <button
			                        type="button"
						                        onClick={() => {
						                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          setTimelineCtxMenu(null)
			                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(212,175,55,0.92)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {renderMenuArrowLabel('Expand', expandDir)}
			                      </button>
			                      <button
			                        type="button"
						                        onClick={() => {
						                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          setTimelineCtxMenu(null)
			                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(212,175,55,0.92)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {renderMenuArrowLabel('Contract', contractDir)}
			                      </button>
			                      <button
			                        type="button"
						                        onClick={() => {
						                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          setTimelineCtxMenu(null)
			                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(212,175,55,0.92)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {renderMenuArrowLabel('Snap to', snapDir)}
			                      </button>

			                      <div style={{ fontSize: 12, fontWeight: 900, color: '#0b0b0b', padding: '2px 2px 0', marginTop: 6 }}>
			                        Playhead
			                      </div>
			                      <button
			                        type="button"
				                        onClick={() => {
				                          const opts = { edgeIntent, guidelinesOverride: playheadGuidelinesOverride, noopIfNoCandidate: true }
				                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          setTimelineCtxMenu(null)
				                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(255,59,48,0.92)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {renderMenuArrowLabel('Expand', expandDir)}
			                      </button>
			                      <button
			                        type="button"
				                        onClick={() => {
				                          const opts = { edgeIntent, guidelinesOverride: playheadGuidelinesOverride, noopIfNoCandidate: true }
				                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          setTimelineCtxMenu(null)
				                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(255,59,48,0.92)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {renderMenuArrowLabel('Contract', contractDir)}
			                      </button>
			                      <button
			                        type="button"
				                        onClick={() => {
				                          const opts = { edgeIntent, guidelinesOverride: playheadGuidelinesOverride, noopIfNoCandidate: true }
				                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          setTimelineCtxMenu(null)
				                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(255,59,48,0.92)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {renderMenuArrowLabel('Snap to', snapDir)}
			                      </button>

                            <div style={{ fontSize: 12, fontWeight: 900, color: '#0b0b0b', padding: '2px 2px 0', marginTop: 6 }}>
                              Timeline
                            </div>
			                      <button
			                        type="button"
                              disabled={timelineExpandDisabled}
				                        onClick={() => {
                                if (timelineExpandDisabled) return
                                applyTimelineExpandEndAction(timelineCtxMenu.kind, timelineCtxMenu.id)
				                          setTimelineCtxMenu(null)
			                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(56,142,255,0.92)',
			                          background: '#000',
			                          color: timelineExpandDisabled ? 'rgba(255,255,255,0.45)' : '#fff',
			                          fontWeight: 900,
			                          cursor: timelineExpandDisabled ? 'not-allowed' : 'pointer',
			                          textAlign: 'left',
                              opacity: timelineExpandDisabled ? 0.7 : 1,
			                        }}
			                      >
			                        {renderMenuArrowLabel('Expand', 'right')}
			                      </button>
			                    </>
			                  )
			                })()}
			              </>
			            ))}
			          </div>
			        </div>
  )
}
