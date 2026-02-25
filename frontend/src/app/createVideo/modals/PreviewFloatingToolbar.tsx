import React from 'react'

export default function PreviewFloatingToolbar(props: any) {
  const ctx = props?.ctx || props
  const {
    audioSegments,
    canJumpNext,
    canJumpPrev,
    clamp,
    jumpNextBoundary,
    jumpPrevBoundary,
    musicPreviewPlaying,
    narrationPreviewPlaying,
    narrationButtonSwatch,
    nudgePlayhead,
    overlayVideoRef,
    playPauseGlyph,
    playing,
    playingRef,
    playhead,
    playheadFromVideoRef,
    playheadRef,
    previewMiniDragRef,
    previewMiniTimelineRef,
    previewToolbarBottomPx,
    previewToolbarDragRef,
    previewToolbarRef,
    pxPerSecond,
    roundToTenth,
    seek,
    seekOverlay,
    setPlaying,
    setPreviewToolbarDragging,
    setTimeline,
    sortedNarration,
    audioButtonSwatch,
    toggleMusicPlay,
    toggleNarrationPlay,
    togglePlay,
    totalSeconds,
    videoRef,
    playbackClockRef,
    previewMotionSource,
    baseHasVideo,
    overlayHasVideo,
  } = ctx as any

  const narrationSwatch = narrationButtonSwatch || 'rgba(175,82,222,0.90)'
  const audioSwatch = audioButtonSwatch || 'rgba(48,209,88,0.90)'

  React.useEffect(() => {
    const c = previewMiniTimelineRef.current
    if (!c) return

    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    const parent = c.parentElement
    const wCss = Math.max(120, Math.floor(parent?.getBoundingClientRect?.().width || 0))
    const hCss = 32
    c.width = Math.floor(wCss * dpr)
    c.height = Math.floor(hCss * dpr)
    c.style.width = `${wCss}px`
    c.style.height = `${hCss}px`

    const ctx2d = c.getContext('2d')
    if (!ctx2d) return
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx2d.clearRect(0, 0, wCss, hCss)

    ctx2d.fillStyle = 'rgba(0,0,0,0.18)'
    ctx2d.fillRect(0, 0, wCss, hCss)

    const centerX = Math.floor(wCss / 2)
    const rangeSeconds = wCss / pxPerSecond
    const leftT = clamp(playhead - rangeSeconds / 2, 0, Math.max(0, totalSeconds))
    const rightT = clamp(playhead + rangeSeconds / 2, 0, Math.max(0, totalSeconds))

    const tStart = Math.floor(leftT * 10) / 10
    const tEnd = Math.ceil(rightT * 10) / 10
    for (let t = tStart; t <= tEnd + 1e-6; t = roundToTenth(t + 0.1)) {
      if (t < 0 || t > totalSeconds + 1e-6) continue
      const dx = (t - playhead) * pxPerSecond
      const x = Math.round(centerX + dx)
      if (x < -2 || x > wCss + 2) continue

      const isSecond = Math.abs(t - Math.round(t)) < 1e-6
      ctx2d.beginPath()
      ctx2d.strokeStyle = isSecond ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)'
      ctx2d.lineWidth = 1
      const y0 = 0
      const y1 = isSecond ? hCss : Math.round(hCss * 0.62)
      ctx2d.moveTo(x + 0.5, y0)
      ctx2d.lineTo(x + 0.5, y1)
      ctx2d.stroke()
    }

    ctx2d.beginPath()
    ctx2d.strokeStyle = '#ff3b30'
    ctx2d.lineWidth = 1
    ctx2d.moveTo(centerX + 0.5, 0)
    ctx2d.lineTo(centerX + 0.5, hCss)
    ctx2d.stroke()
  }, [clamp, playhead, previewMiniTimelineRef, pxPerSecond, roundToTenth, totalSeconds])

  return (
    <div
      ref={previewToolbarRef}
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: previewToolbarBottomPx,
        zIndex: 4000,
        width: 'min(94vw, 560px)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          onPointerDown={(e) => {
            if (e.button != null && e.button !== 0) return
            e.preventDefault()
            e.stopPropagation()
            try {
              ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)
            } catch {}
            previewToolbarDragRef.current = { pointerId: e.pointerId, startY: e.clientY, startBottom: previewToolbarBottomPx }
            setPreviewToolbarDragging(true)
          }}
          style={{
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'grab',
            touchAction: 'none',
          }}
          title="Drag to move preview controls"
        >
          <div style={{ width: 44, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.22)' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', padding: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start' }}>
            <button
              type="button"
              onClick={jumpPrevBoundary}
              disabled={totalSeconds <= 0 || !canJumpPrev}
              style={{
                padding: 0,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0c0c0c',
                color: '#ffd24a',
                fontWeight: 900,
                fontSize: 26,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: totalSeconds <= 0 || !canJumpPrev ? 'default' : 'pointer',
                flex: '0 0 auto',
                minWidth: 40,
                height: 40,
                opacity: 1,
              }}
              title="Jump to previous boundary"
              aria-label="Jump to previous boundary"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => nudgePlayhead(-0.1)}
              disabled={totalSeconds <= 0}
              style={{
                padding: 0,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0c0c0c',
                color: '#ffd24a',
                fontWeight: 900,
                fontSize: 26,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                flex: '0 0 auto',
                minWidth: 40,
                height: 40,
              }}
              title="Nudge backward 0.1s"
              aria-label="Nudge backward 0.1 seconds"
            >
              ‹
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
            {(() => {
              const baseHas = Boolean(baseHasVideo)
              const overlayHas = Boolean(overlayHasVideo)
              const showDual = baseHas && overlayHas
              if (!showDual) {
                const singleSource = baseHas ? 'video' : overlayHas ? 'videoOverlay' : undefined
                return (
                  <button
                    type="button"
                    onClick={() => togglePlay(singleSource)}
                    disabled={totalSeconds <= 0}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(10,132,255,0.55)',
                      background: playing ? 'rgba(10,132,255,0.18)' : '#0a84ff',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                      flex: '0 0 auto',
                      minWidth: 40,
                      height: 40,
                      lineHeight: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title={playing ? 'Pause' : 'Play'}
                    aria-label={playing ? 'Pause' : 'Play'}
                  >
                    <span style={{ display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
                      {playPauseGlyph(playing)}
                    </span>
                  </button>
                )
              }
              const activeMotion =
                playing
                  ? playbackClockRef?.current === 'overlay'
                    ? 'videoOverlay'
                    : playbackClockRef?.current === 'base'
                      ? 'video'
                      : previewMotionSource || 'video'
                  : previewMotionSource || 'video'
              const baseActive = activeMotion === 'video'
              const overlayActive = activeMotion === 'videoOverlay'
              const basePlaying = playing && baseActive
              const overlayPlaying = playing && overlayActive
              const baseStyle = {
                padding: '10px 10px',
                borderRadius: 10,
                border: '1px solid #0a84ff',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                flex: '0 0 auto' as const,
                minWidth: 40,
                height: 40,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }
              const overlayStyle = {
                padding: '10px 10px',
                borderRadius: 10,
                border: '1px solid #0a84ff',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                flex: '0 0 auto' as const,
                minWidth: 40,
                height: 40,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }
              return (
                <>
                  <button
                    type="button"
                    onClick={() => togglePlay('video')}
                    disabled={totalSeconds <= 0}
                    style={baseStyle}
                title={basePlaying ? 'Pause video (V1)' : 'Play video (V1)'}
                aria-label={basePlaying ? 'Pause video (V1)' : 'Play video (V1)'}
              >
                <span style={{ display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
                  {playPauseGlyph(basePlaying)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => togglePlay('videoOverlay')}
                disabled={totalSeconds <= 0}
                    style={overlayStyle}
                title={overlayPlaying ? 'Pause overlay (V2)' : 'Play overlay (V2)'}
                aria-label={overlayPlaying ? 'Pause overlay (V2)' : 'Play overlay (V2)'}
              >
                <span style={{ position: 'relative', display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
                  {playPauseGlyph(overlayPlaying)}
                  <span
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -6,
                      fontSize: 10,
                      fontWeight: 900,
                      lineHeight: 1,
                    }}
                  >
                    O
                  </span>
                </span>
              </button>
            </>
          )
        })()}
            {sortedNarration.length ? (
              <button
                type="button"
                onClick={toggleNarrationPlay}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${narrationSwatch}`,
                  background: narrationPreviewPlaying ? 'rgba(175,82,222,0.18)' : narrationSwatch,
                  color: '#fff',
                  fontWeight: 900,
                  cursor: 'pointer',
                  flex: '0 0 auto',
                  minWidth: 40,
                  height: 40,
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Play narration (voice memo)"
                aria-label={narrationPreviewPlaying ? 'Pause voice' : 'Play voice'}
              >
                <span style={{ display: 'inline-block', width: 18, textAlign: 'center', fontSize: 18 }}>
                  {playPauseGlyph(narrationPreviewPlaying)}
                </span>
              </button>
            ) : null}
            {audioSegments.length ? (
              <button
                type="button"
                onClick={toggleMusicPlay}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${audioSwatch}`,
                  background: musicPreviewPlaying ? 'rgba(48,209,88,0.18)' : audioSwatch,
                  color: '#fff',
                  fontWeight: 900,
                  cursor: 'pointer',
                  flex: '0 0 auto',
                  minWidth: 40,
                  height: 40,
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Play music"
                aria-label={musicPreviewPlaying ? 'Pause music' : 'Play music'}
              >
                <span style={{ display: 'inline-block', width: 18, textAlign: 'center', fontSize: 18 }}>
                  {playPauseGlyph(musicPreviewPlaying)}
                </span>
              </button>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => nudgePlayhead(0.1)}
              disabled={totalSeconds <= 0}
              style={{
                padding: 0,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0c0c0c',
                color: '#ffd24a',
                fontWeight: 900,
                fontSize: 26,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                flex: '0 0 auto',
                minWidth: 40,
                height: 40,
              }}
              title="Nudge forward 0.1s"
              aria-label="Nudge forward 0.1 seconds"
            >
              ›
            </button>
            <button
              type="button"
              onClick={jumpNextBoundary}
              disabled={totalSeconds <= 0 || !canJumpNext}
              style={{
                padding: 0,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0c0c0c',
                color: '#ffd24a',
                fontWeight: 900,
                fontSize: 26,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: totalSeconds <= 0 || !canJumpNext ? 'default' : 'pointer',
                flex: '0 0 auto',
                minWidth: 40,
                height: 40,
                opacity: 1,
              }}
              title="Jump to next boundary"
              aria-label="Jump to next boundary"
            >
              »
            </button>
          </div>
        </div>
        <div style={{ padding: '0 10px 10px' }}>
          <div
            style={{
              position: 'relative',
              height: 32,
              borderRadius: 10,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.12)',
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
            onPointerDown={(e) => {
              if (e.button != null && e.button !== 0) return
              if (!(totalSeconds > 0)) return
              e.preventDefault()
              e.stopPropagation()
              if (playingRef.current) {
                try {
                  videoRef.current?.pause?.()
                } catch {}
                try {
                  overlayVideoRef.current?.pause?.()
                } catch {}
                setPlaying(false)
              }
              try {
                ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)
              } catch {}
              previewMiniDragRef.current = { pointerId: e.pointerId, startX: e.clientX, startPlayhead: Number(playheadRef.current || 0) }
            }}
            onPointerMove={(e) => {
              const cur = previewMiniDragRef.current
              if (!cur) return
              if (e.pointerId !== cur.pointerId) return
              const dx = e.clientX - cur.startX
              const deltaSeconds = -dx / pxPerSecond
              const next = clamp(roundToTenth(cur.startPlayhead + deltaSeconds), 0, Math.max(0, totalSeconds))
              playheadFromVideoRef.current = true
              playheadRef.current = next
              setTimeline((prev: any) => ({ ...prev, playheadSeconds: next }))
              void seek(next)
              void seekOverlay(next)
            }}
            onPointerUp={(e) => {
              const cur = previewMiniDragRef.current
              if (!cur) return
              if (e.pointerId !== cur.pointerId) return
              previewMiniDragRef.current = null
            }}
            onPointerCancel={() => {
              previewMiniDragRef.current = null
            }}
            title="Scrub timeline"
            aria-label="Scrub timeline"
          >
            <canvas ref={previewMiniTimelineRef} style={{ display: 'block', width: '100%', height: '100%' }} />
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                transform: 'translateX(-50%)',
                color: '#ddd',
                fontSize: 12,
                fontWeight: 900,
                fontVariantNumeric: 'tabular-nums',
                padding: '2px 6px',
                borderRadius: 999,
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(255,255,255,0.10)',
                pointerEvents: 'none',
              }}
            >
              {playhead.toFixed(1)}s
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
