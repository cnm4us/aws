import React, { useEffect, useRef } from 'react'
import Hls from 'hls.js'
import { isSafari } from '../utils/isSafari'
import debug from '../debug'

type Props = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> & {
  src: string
  warm?: boolean
  onReady?: (video: HTMLVideoElement) => void
  // Warm strategy: none (default), attach (manifest only), buffer (few seconds buffered then stop)
  warmMode?: 'none' | 'attach' | 'buffer'
  bufferTargetSec?: number
  // Optional debug identifier (e.g., ULID) for logging
  debugId?: string
}

export default function HLSVideo({
  src,
  autoPlay = false,
  muted = true,
  playsInline = true,
  warm = false,
  onReady,
  warmMode = 'none',
  bufferTargetSec = 3,
  debugId,
  ...rest
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const stoppedRef = useRef<boolean>(false)
  const checkTimerRef = useRef<number | null>(null)
  const manifestParsedRef = useRef<boolean>(false)
  const lastLoadSrcRef = useRef<string | null>(null)

  // Attach/detach only when src changes; do not destroy on warm/warmMode flips
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Debug: environment + decision snapshot
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'
      const mse = typeof (window as any).MediaSource !== 'undefined'
      const canTypeM3U8 = !!(video.canPlayType && (video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL')))
      debug.log('video', 'mount', { ua, isSafari: isSafari(), hlsSupported: Hls.isSupported(), mse, canTypeM3U8, autoPlay, muted, playsInline, src, warmMode }, { id: debugId || null })
    } catch {}

    // ensure attributes are in place before wiring
    try {
      video.autoplay = !!autoPlay
      video.muted = !!muted
      ;(video as any).playsInline = !!playsInline
    } catch {}

    const manifest = src
    video.dataset.videoSrc = manifest

    // Cleanup helper
    const cleanup = () => {
      try { video.removeEventListener('loadeddata', onLoadedData) } catch {}
      try { video.removeEventListener('play', onPlay) } catch {}
      // Gentle destroy: stop first, then wait briefly or until next FRAG_LOADED to avoid mid-fragment aborts
      if (hlsRef.current) {
        const h = hlsRef.current
        hlsRef.current = null
        try { h.stopLoad() } catch {}
        let done = false
        let timer: number | null = null
        const finish = () => {
          if (done) return; done = true
          try { if (timer != null) window.clearTimeout(timer) } catch {}
          try { h.off(Hls.Events.FRAG_LOADED, onFragLoaded) } catch {}
          try { h.destroy() } catch {}
        }
        const onFragLoaded = () => { finish() }
        try { h.on(Hls.Events.FRAG_LOADED, onFragLoaded) } catch {}
        try { timer = window.setTimeout(finish, 160) as unknown as number } catch { finish() }
      }
      // Clear src only when not Safari to avoid Chrome trying to use native pipeline inadvertently later
      if (!isSafari()) {
        try { video.removeAttribute('src'); video.load?.() } catch {}
      }
      try { debug.log('video', 'cleanup', { currentSrc: (video as any).currentSrc, src: video.getAttribute('src'), warmMode, srcKey: src }, { id: debugId || null }) } catch {}
      if (checkTimerRef.current) { try { window.clearInterval(checkTimerRef.current) } catch {} ; checkTimerRef.current = null }
      stoppedRef.current = false
      manifestParsedRef.current = false
      lastLoadSrcRef.current = null
    }

    const onLoadedData = () => {
      try {
        // TEMP DEBUG: event trace
        try {
          const rs = video.readyState
          const ns = (video as any).networkState
          const cur = (video as any).currentSrc
          debug.log('video', 'loadeddata', { readyState: rs, networkState: ns, currentSrc: cur, muted: video.muted, paused: video.paused }, { id: debugId || null })
        } catch {}
        if (warmMode !== 'none') {
          video.pause()
        }
        if (onReady) onReady(video)
      } catch {}
    }

    const onPlay = () => {
      // Ensure loading resumes when user starts playback (covers attach + buffer warm)
      const h = hlsRef.current
      if (h) {
        try { debug.log('video', 'resume startLoad on play', { src, warmMode }, { id: debugId || null }) } catch {}
        try {
          if (!manifestParsedRef.current) {
            // Ensure manifest is (re)loaded before starting
            if (lastLoadSrcRef.current !== manifest) {
              try { h.loadSource(manifest); lastLoadSrcRef.current = manifest } catch {}
            }
          }
          h.startLoad(-1)
        } catch {}
        stoppedRef.current = false
      }
    }

    // Capability & platform probes
    const canNative = !!(video.canPlayType && (video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL')))
    const vendor = (typeof navigator !== 'undefined' && navigator.vendor) ? navigator.vendor : ''
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : ''
    const isAppleVendor = vendor === 'Apple Computer, Inc.'
    const isiOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any)?.maxTouchPoints > 1)

    // Safari (Apple vendor) native HLS only
    if (isAppleVendor && isSafari() && canNative) {
      try {
        debug.log('video', 'branch', { mode: 'safari-native', warmMode }, { id: debugId || null })
        // Adjust preload behavior based on warmMode for Safari
        try { video.preload = warmMode === 'attach' ? 'metadata' : 'auto' } catch {}
        if (video.src !== manifest) {
          video.src = manifest
          try { video.load() } catch {}
        }
      } catch {}
      try {
        video.addEventListener('error', () => {
          const err = (video as any).error
          debug.warn('video', 'video.error', { code: err?.code, message: err?.message }, { id: debugId || null })
        })
        video.addEventListener('loadedmetadata', () => debug.log('video', 'loadedmetadata', undefined, { id: debugId || null }))
        video.addEventListener('canplay', () => debug.log('video', 'canplay', undefined, { id: debugId || null }))
        video.addEventListener('playing', () => debug.log('video', 'playing', undefined, { id: debugId || null }))
        video.addEventListener('waiting', () => debug.log('video', 'waiting', undefined, { id: debugId || null }))
        video.addEventListener('stalled', () => debug.log('video', 'stalled', undefined, { id: debugId || null }))
        video.addEventListener('play', onPlay)
      } catch {}
      try { video.addEventListener('loadeddata', onLoadedData) } catch {}
      // TEMP DEBUG: warn if src is manifest on non-Safari (should never happen here)
      try { if (!isSafari() && (video.getAttribute('src') || '').endsWith('.m3u8')) debug.warn('video', 'WARN non-Safari has manifest src', { src: video.getAttribute('src') }, { id: debugId || null }) } catch {}
      return cleanup
    }

    // Other browsers with MSE: use hls.js
    if (Hls.isSupported()) {
      const hls = new Hls({ autoStartLoad: warmMode === 'attach' ? false : true })
      hlsRef.current = hls
      try {
        debug.log('video', 'branch', { mode: 'hls.js', warmMode }, { id: debugId || null })
        // Attach media first; defer manifest for attach-warm to avoid canceled requests
        hls.attachMedia(video)
        if (warmMode !== 'attach') {
          try { hls.loadSource(manifest); lastLoadSrcRef.current = manifest } catch {}
        }
        // TEMP DEBUG: key Hls events only
        hls.on(Hls.Events.MEDIA_ATTACHED, () => debug.log('video', 'hls MEDIA_ATTACHED', undefined, { id: debugId || null }))
        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data: any) => { manifestParsedRef.current = true; debug.log('video', 'hls MANIFEST_PARSED', { levels: data?.levels?.length, audioTracks: data?.audioTracks?.length }, { id: debugId || null }) })
        hls.on(Hls.Events.LEVEL_LOADED, (_e, data: any) => debug.log('video', 'hls LEVEL_LOADED', { level: data?.level, totalduration: data?.details?.totalduration, live: data?.details?.live, codecs: { audio: data?.details?.audioCodec, video: data?.details?.videoCodec } }, { id: debugId || null }))
        hls.on(Hls.Events.ERROR, (_e, data: any) => {
          debug.warn('video', 'hls ERROR', { type: data?.type, details: data?.details, fatal: data?.fatal }, { id: debugId || null })
          if (!data?.fatal) return
          try {
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              debug.log('video', 'hls recoverMediaError', undefined, { id: debugId || null })
              hls.recoverMediaError()
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              debug.log('video', 'hls startLoad (network recover)', undefined, { id: debugId || null })
              hls.startLoad()
            } else {
              debug.log('video', 'hls destroy (fatal other)', undefined, { id: debugId || null })
              hls.destroy()
              hlsRef.current = null
            }
          } catch {}
        })
        // Buffer warm handled by separate effect reacting to warmMode
      } catch {}
      try {
        video.addEventListener('error', () => {
          const err = (video as any).error
          debug.warn('video', 'video.error', { code: err?.code, message: err?.message }, { id: debugId || null })
        })
        video.addEventListener('loadedmetadata', () => debug.log('video', 'loadedmetadata', undefined, { id: debugId || null }))
        video.addEventListener('canplay', () => debug.log('video', 'canplay', undefined, { id: debugId || null }))
        video.addEventListener('playing', () => debug.log('video', 'playing', undefined, { id: debugId || null }))
        video.addEventListener('waiting', () => debug.log('video', 'waiting', undefined, { id: debugId || null }))
        video.addEventListener('stalled', () => debug.log('video', 'stalled', undefined, { id: debugId || null }))
        video.addEventListener('play', onPlay)
      } catch {}
      try { video.addEventListener('loadeddata', onLoadedData) } catch {}
      // TEMP DEBUG: after a tick, verify currentSrc is blob: when loaded
      setTimeout(() => {
        try {
          const s = video.getAttribute('src') || ''
          const cs = (video as any).currentSrc || ''
          debug.log('video', 'post-attach src check', { src: s, currentSrc: cs }, { id: debugId || null })
          if ((s && s.endsWith('.m3u8')) || (cs && cs.endsWith('.m3u8'))) {
            debug.warn('video', 'WARN Chrome has manifest in src/currentSrc — unexpected for hls.js path', undefined, { id: debugId || null })
          }
        } catch {}
      }, 0)
      return cleanup
    }

    // Fallback: allow native only on iOS WebKit where MSE is unavailable
    if (isiOS && canNative) {
      try {
        debug.log('video', 'branch', { mode: 'fallback-native-ios' }, { id: debugId || null })
        video.src = manifest
        video.addEventListener('loadeddata', onLoadedData)
      } catch {}
      return cleanup
    }

    // As a safety, do not assign manifest src on non-Apple desktop if we reach here
    try { debug.error('video', 'no supported playback path (not assigning manifest to src)', { src, warmMode }, { id: debugId || null }) } catch {}
    return cleanup
  }, [src])

  // React to warmMode changes without destroying the instance
  useEffect(() => {
    const video = videoRef.current
    const hls = hlsRef.current
    // Safari native: adjust preload and keep paused during warm
    if (video && !hls && isSafari()) {
      try { video.preload = warmMode === 'attach' ? 'metadata' : 'auto' } catch {}
      if (warmMode !== 'none') { try { video.pause() } catch {} }
      return
    }
    if (!hls) return
    // Clear any prior checker
    if (checkTimerRef.current) { try { window.clearInterval(checkTimerRef.current) } catch {} ; checkTimerRef.current = null }
    if (warmMode === 'attach') {
      // Defer manifest load for attach warm to avoid canceled requests; do nothing here
    } else if (warmMode === 'buffer') {
      // Ensure manifest is loaded, then buffer a few seconds and stop
      try {
        if (!manifestParsedRef.current) {
          if (lastLoadSrcRef.current !== src) { try { hls.loadSource(src); lastLoadSrcRef.current = src } catch {} }
        }
        hls.startLoad(-1); stoppedRef.current = false
      } catch {}
      checkTimerRef.current = window.setInterval(() => {
        const v = videoRef.current
        if (!v) return
        try {
          if (!v.buffered || v.buffered.length === 0) return
          const end = v.buffered.end(v.buffered.length - 1)
          if (end >= bufferTargetSec) {
            try { hls.stopLoad(); stoppedRef.current = true } catch {}
            if (checkTimerRef.current) { window.clearInterval(checkTimerRef.current); checkTimerRef.current = null }
          }
        } catch {}
      }, 250)
    } else {
      try {
        if (!manifestParsedRef.current) {
          if (lastLoadSrcRef.current !== src) { try { hls.loadSource(src); lastLoadSrcRef.current = src } catch {} }
        }
        hls.startLoad(-1); stoppedRef.current = false
      } catch {}
    }
  }, [warmMode, bufferTargetSec, src])

  return (
    <video
      ref={videoRef}
      autoPlay={autoPlay}
      muted={muted}
      playsInline={playsInline}
      data-video-src={src}
      {...rest}
    />
  )
}
