import React from 'react'

const LazyGraphicEditorModal = React.lazy(() => import('./GraphicEditorModal'))
const LazyStillEditorModal = React.lazy(() => import('./StillEditorModal'))
const LazyVideoOverlayStillEditorModal = React.lazy(() => import('./VideoOverlayStillEditorModal'))
const LazyAudioEditorModal = React.lazy(() => import('./AudioEditorModal'))
const LazyLogoEditorModal = React.lazy(() => import('./LogoEditorModal'))
const LazyLowerThirdEditorModal = React.lazy(() => import('./LowerThirdEditorModal'))
const LazyVideoOverlayEditorModal = React.lazy(() => import('./VideoOverlayEditorModal'))
const LazyScreenTitleEditorModal = React.lazy(() => import('./ScreenTitleEditorModal'))
const LazyScreenTitleCustomizeModal = React.lazy(() => import('./ScreenTitleCustomizeModal'))
const LazyScreenTitlePlacementAdvancedModal = React.lazy(() => import('./ScreenTitlePlacementAdvancedModal'))
const LazyClipEditorModal = React.lazy(() => import('./ClipEditorModal'))
const LazyNarrationEditorModal = React.lazy(() => import('./NarrationEditorModal'))
const LazyVisualizerEditorModal = React.lazy(() => import('./VisualizerEditorModal'))

export default function EditorModalHost(props: any) {
  const ctx = props?.ctx || props
  const {
    audioConfigNameById,
    audioEditor,
    audioEditorError,
    audioPreviewPlayingId,
    audioPreviewRef,
    audioSegments,
    buildScreenTitlePresetSnapshot,
    clipEditor,
    clipEditorError,
    defaultScreenTitlePlacementRect,
    dimsByUploadId,
    durationsByUploadId,
    freezeInsertBusy,
    freezeInsertError,
    generateScreenTitle,
    getScreenTitleSizeOptions,
    graphicEditor,
    graphicEditorError,
    insertFreezeStill,
    insertVideoOverlayFreezeStill,
    logoEditor,
    logoEditorError,
    logos,
    lowerThirdConfigs,
    lowerThirdEditor,
    lowerThirdEditorError,
    lowerThirds,
    namesByUploadId,
    narration,
    narrationEditor,
    narrationEditorError,
    visualizerEditor,
    visualizerEditorError,
    visualizerPresets,
    clipStarts,
    normalizeScreenTitlePlacementRectForEditor,
    openClipBackgroundPicker,
    overlayFreezeInsertBusy,
    overlayFreezeInsertError,
    pickScreenTitleSizeKey,
    playPauseGlyph,
    resolveScreenTitleFamilyForFontKey,
    saveAudioEditor,
    saveClipEditor,
    saveGraphicEditor,
    saveLogoEditor,
    saveLowerThirdEditor,
    saveNarrationEditor,
    saveVisualizerEditor,
    saveScreenTitleEditor,
    saveScreenTitlePlacement,
    saveStillEditor,
    saveVideoOverlayEditor,
    saveVideoOverlayStillEditor,
    screenTitleCustomizeEditor,
    screenTitleCustomizeError,
    screenTitleFontFamilies,
    screenTitleGradients,
    screenTitlePlacementAdvancedOpen,
    screenTitlePlacementControlMode,
    screenTitlePlacementEditor,
    screenTitlePlacementError,
    screenTitlePlacementMoveHorizontal,
    screenTitlePlacementMoveVertical,
    screenTitlePlacementStageRef,
    screenTitlePresets,
    screenTitleRenderBusy,
    screenTitleTextAreaHeight,
    screenTitleTextAreaRef,
    screenTitleEditor,
    screenTitleEditorError,
    setAudioEditor,
    setAudioEditorError,
    setClipEditor,
    setClipEditorError,
    setFreezeInsertBusy,
    setFreezeInsertError,
    setGraphicEditor,
    setGraphicEditorError,
    setLogoEditor,
    setLogoEditorError,
    setLowerThirdEditor,
    setLowerThirdEditorError,
    setNarrationEditor,
    setNarrationEditorError,
    setVisualizerEditor,
    setVisualizerEditorError,
    setScreenTitleCustomizeEditor,
    setScreenTitleCustomizeError,
    setScreenTitleEditor,
    setScreenTitleEditorError,
    setScreenTitlePlacementAdvancedOpen,
    setScreenTitlePlacementControlMode,
    setScreenTitlePlacementEditor,
    setScreenTitlePlacementError,
    setScreenTitleTextAreaHeight,
    setStillEditor,
    setStillEditorError,
    setTimeline,
    setVideoOverlayEditor,
    setVideoOverlayEditorError,
    setVideoOverlayStillEditor,
    setVideoOverlayStillEditorError,
    snapshotUndo,
    stillEditor,
    stillEditorError,
    timeline,
    videoOverlayStarts,
    toggleAudioPreview,
    totalSeconds,
    totalSecondsVideo,
    videoOverlayEditor,
    videoOverlayEditorError,
    videoOverlayStillEditor,
    videoOverlayStillEditorError,
    videoOverlays,
    visualizers,
    beginScreenTitlePlacementDrag,
    SCREEN_TITLE_PLACEMENT_MIN_H_PCT,
    SCREEN_TITLE_PLACEMENT_MIN_W_PCT,
    applyScreenTitleCustomStyle,
  } = ctx as any

  return (
    <>
      {graphicEditor ? (
        <React.Suspense fallback={null}>
          <LazyGraphicEditorModal
            graphicEditor={graphicEditor}
            graphicEditorError={graphicEditorError}
            setGraphicEditor={setGraphicEditor}
            setGraphicEditorError={setGraphicEditorError}
            maxEndSeconds={timeline.clips.length ? totalSecondsVideo : 20 * 60}
            onClose={() => {
              setGraphicEditor(null)
              setGraphicEditorError(null)
            }}
            onSave={saveGraphicEditor}
          />
        </React.Suspense>
      ) : null}

      {stillEditor ? (
        <React.Suspense fallback={null}>
          <LazyStillEditorModal
            stillEditor={stillEditor}
            stillEditorError={stillEditorError}
            setStillEditor={setStillEditor}
            setStillEditorError={setStillEditorError}
            onClose={() => {
              setStillEditor(null)
              setStillEditorError(null)
            }}
            onSave={saveStillEditor}
          />
        </React.Suspense>
      ) : null}

      {videoOverlayStillEditor ? (
        <React.Suspense fallback={null}>
          <LazyVideoOverlayStillEditorModal
            videoOverlayStillEditor={videoOverlayStillEditor}
            videoOverlayStillEditorError={videoOverlayStillEditorError}
            setVideoOverlayStillEditor={setVideoOverlayStillEditor}
            setVideoOverlayStillEditorError={setVideoOverlayStillEditorError}
            onClose={() => {
              setVideoOverlayStillEditor(null)
              setVideoOverlayStillEditorError(null)
            }}
            onSave={saveVideoOverlayStillEditor}
          />
        </React.Suspense>
      ) : null}

      {audioEditor ? (
        <React.Suspense fallback={null}>
          <LazyAudioEditorModal
            audioEditor={audioEditor}
            audioEditorError={audioEditorError}
            setAudioEditor={setAudioEditor}
            setAudioEditorError={setAudioEditorError}
            audioSegments={audioSegments as any[]}
            namesByUploadId={namesByUploadId}
            audioConfigNameById={audioConfigNameById}
            audioPreviewPlayingId={audioPreviewPlayingId}
            toggleAudioPreview={toggleAudioPreview}
            playPauseGlyph={playPauseGlyph}
            onClose={() => {
              setAudioEditor(null)
              setAudioEditorError(null)
            }}
            onSave={saveAudioEditor}
          />
        </React.Suspense>
      ) : null}

      {visualizerEditor ? (
        <React.Suspense fallback={null}>
          <LazyVisualizerEditorModal
            visualizerEditor={visualizerEditor}
            visualizerEditorError={visualizerEditorError}
            setVisualizerEditor={setVisualizerEditor}
            setVisualizerEditorError={setVisualizerEditorError}
            visualizerPresets={visualizerPresets}
            clips={timeline.clips}
            clipStarts={clipStarts as any}
            videoOverlays={videoOverlays}
            videoOverlayStarts={videoOverlayStarts as any}
            narration={narration}
            audioSegments={audioSegments}
            namesByUploadId={namesByUploadId}
            onClose={() => {
              setVisualizerEditor(null)
              setVisualizerEditorError(null)
            }}
            onSave={saveVisualizerEditor}
          />
        </React.Suspense>
      ) : null}

      {logoEditor ? (
        <React.Suspense fallback={null}>
          <LazyLogoEditorModal
            logoEditor={logoEditor as any}
            logoEditorError={logoEditorError}
            setLogoEditor={setLogoEditor as any}
            setLogoEditorError={setLogoEditorError}
            logos={logos as any[]}
            namesByUploadId={namesByUploadId}
            onClose={() => {
              setLogoEditor(null)
              setLogoEditorError(null)
            }}
            onSave={saveLogoEditor}
          />
        </React.Suspense>
      ) : null}

      {lowerThirdEditor ? (
        <React.Suspense fallback={null}>
          <LazyLowerThirdEditorModal
            lowerThirdEditor={lowerThirdEditor as any}
            lowerThirdEditorError={lowerThirdEditorError}
            setLowerThirdEditor={setLowerThirdEditor as any}
            setLowerThirdEditorError={setLowerThirdEditorError}
            lowerThirds={lowerThirds as any[]}
            lowerThirdConfigs={lowerThirdConfigs as any[]}
            namesByUploadId={namesByUploadId}
            onClose={() => {
              setLowerThirdEditor(null)
              setLowerThirdEditorError(null)
            }}
            onSave={saveLowerThirdEditor}
          />
        </React.Suspense>
      ) : null}

      {videoOverlayEditor ? (
        <React.Suspense fallback={null}>
          <LazyVideoOverlayEditorModal
            videoOverlayEditor={videoOverlayEditor as any}
            videoOverlayEditorError={videoOverlayEditorError}
            setVideoOverlayEditor={setVideoOverlayEditor as any}
            setVideoOverlayEditorError={setVideoOverlayEditorError}
            videoOverlays={videoOverlays as any[]}
            namesByUploadId={namesByUploadId}
            overlayFreezeInsertBusy={overlayFreezeInsertBusy}
            overlayFreezeInsertError={overlayFreezeInsertError}
            insertVideoOverlayFreezeStill={insertVideoOverlayFreezeStill}
            onClose={() => {
              setVideoOverlayEditor(null)
              setVideoOverlayEditorError(null)
            }}
            onSave={saveVideoOverlayEditor}
          />
        </React.Suspense>
      ) : null}

      {screenTitleEditor ? (
        <React.Suspense fallback={null}>
          <LazyScreenTitleEditorModal
            screenTitleEditor={screenTitleEditor as any}
            screenTitleEditorError={screenTitleEditorError}
            setScreenTitleEditor={setScreenTitleEditor as any}
            setScreenTitleEditorError={setScreenTitleEditorError}
            totalSeconds={totalSeconds}
            onClose={() => {
              setScreenTitleEditor(null)
              setScreenTitleEditorError(null)
            }}
            onSave={saveScreenTitleEditor}
          />
        </React.Suspense>
      ) : null}

      {screenTitleCustomizeEditor ? (
        <React.Suspense fallback={null}>
          <LazyScreenTitleCustomizeModal
            screenTitleCustomizeEditor={screenTitleCustomizeEditor}
            screenTitleCustomizeError={screenTitleCustomizeError}
            setScreenTitleCustomizeEditor={setScreenTitleCustomizeEditor}
            setScreenTitleCustomizeError={setScreenTitleCustomizeError}
            screenTitlePresets={screenTitlePresets as any[]}
            buildScreenTitlePresetSnapshot={buildScreenTitlePresetSnapshot as any}
            applyScreenTitleCustomStyle={applyScreenTitleCustomStyle as any}
            resolveScreenTitleFamilyForFontKey={resolveScreenTitleFamilyForFontKey as any}
            getScreenTitleSizeOptions={getScreenTitleSizeOptions as any}
            pickScreenTitleSizeKey={pickScreenTitleSizeKey as any}
            screenTitleGradients={screenTitleGradients as any[]}
            screenTitleFontFamilies={screenTitleFontFamilies as any[]}
            screenTitleTextAreaRef={screenTitleTextAreaRef}
            screenTitleTextAreaHeight={screenTitleTextAreaHeight}
            setScreenTitleTextAreaHeight={setScreenTitleTextAreaHeight}
            screenTitleRenderBusy={screenTitleRenderBusy}
            generateScreenTitle={generateScreenTitle}
          />
        </React.Suspense>
      ) : null}

      {screenTitlePlacementEditor && screenTitlePlacementAdvancedOpen ? (
        <React.Suspense fallback={null}>
          <LazyScreenTitlePlacementAdvancedModal
            screenTitlePlacementEditor={screenTitlePlacementEditor}
            setScreenTitlePlacementEditor={setScreenTitlePlacementEditor}
            screenTitlePlacementError={screenTitlePlacementError}
            setScreenTitlePlacementError={setScreenTitlePlacementError}
            setScreenTitlePlacementAdvancedOpen={setScreenTitlePlacementAdvancedOpen}
            normalizeScreenTitlePlacementRectForEditor={normalizeScreenTitlePlacementRectForEditor as any}
            defaultScreenTitlePlacementRect={defaultScreenTitlePlacementRect as any}
            screenTitlePlacementStageRef={screenTitlePlacementStageRef}
            screenTitlePlacementControlMode={screenTitlePlacementControlMode}
            setScreenTitlePlacementControlMode={setScreenTitlePlacementControlMode}
            screenTitlePlacementMoveVertical={screenTitlePlacementMoveVertical}
            screenTitlePlacementMoveHorizontal={screenTitlePlacementMoveHorizontal}
            beginScreenTitlePlacementDrag={beginScreenTitlePlacementDrag as any}
            SCREEN_TITLE_PLACEMENT_MIN_W_PCT={SCREEN_TITLE_PLACEMENT_MIN_W_PCT}
            SCREEN_TITLE_PLACEMENT_MIN_H_PCT={SCREEN_TITLE_PLACEMENT_MIN_H_PCT}
            screenTitleRenderBusy={screenTitleRenderBusy}
            saveScreenTitlePlacement={saveScreenTitlePlacement}
          />
        </React.Suspense>
      ) : null}

      {clipEditor ? (
        <React.Suspense fallback={null}>
          <LazyClipEditorModal
            clipEditor={clipEditor}
            clipEditorError={clipEditorError}
            setClipEditor={setClipEditor}
            setClipEditorError={setClipEditorError}
            freezeInsertBusy={freezeInsertBusy}
            freezeInsertError={freezeInsertError}
            clips={timeline.clips as any[]}
            durationsByUploadId={durationsByUploadId}
            namesByUploadId={namesByUploadId}
            dimsByUploadId={dimsByUploadId as any}
            openClipBackgroundPicker={openClipBackgroundPicker}
            insertFreezeStill={insertFreezeStill}
            onToggleClipAudioEnabled={(clipId, enabled) => {
              snapshotUndo()
              setTimeline((prev: any) => ({
                ...prev,
                clips: prev.clips.map((c: any) => (c.id === clipId ? ({ ...c, audioEnabled: enabled } as any) : c)),
              }))
            }}
            onClose={() => {
              setClipEditor(null)
              setClipEditorError(null)
              setFreezeInsertError(null)
              setFreezeInsertBusy(false)
            }}
            onSave={saveClipEditor}
          />
        </React.Suspense>
      ) : null}

      {narrationEditor ? (
        <React.Suspense fallback={null}>
          <LazyNarrationEditorModal
            narrationEditor={narrationEditor as any}
            narrationEditorError={narrationEditorError}
            setNarrationEditor={setNarrationEditor as any}
            setNarrationEditorError={setNarrationEditorError}
            narration={narration as any[]}
            namesByUploadId={namesByUploadId}
            audioPreviewPlayingId={audioPreviewPlayingId}
            toggleAudioPreview={toggleAudioPreview}
            audioPreviewRef={audioPreviewRef}
            onClose={() => {
              setNarrationEditor(null)
              setNarrationEditorError(null)
            }}
            onSave={saveNarrationEditor}
          />
        </React.Suspense>
      ) : null}
    </>
  )
}
