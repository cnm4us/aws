import React, { useEffect, useRef } from 'react'
import Hls from 'hls.js'
import { isSafari } from '../utils/isSafari'

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

    // TEMP DEBUG: environment + decision snapshot
    const dbgPrefix = `[HLSVideo]${warmMode !== 'none' ? '[warm]' : '[active]'}${debugId ? `[id:${debugId}]` : ''} `
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'
      const mse = typeof (window as any).MediaSource !== 'undefined'
      const canTypeM3U8 = !!(video.canPlayType && (video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL'))) 
      // eslint-disable-next-line no-console
      console.log(dbgPrefix + 'mount', { ua, isSafari: isSafari(), hlsSupported: Hls.isSupported(), mse, canTypeM3U8, autoPlay, muted, playsInline, src })
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
      try { console.log(dbgPrefix + 'cleanup', { currentSrc: (video as any).currentSrc, src: video.getAttribute('src'), warmMode, srcKey: src }) } catch {}
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
          console.log(dbgPrefix + 'loadeddata', { readyState: rs, networkState: ns, currentSrc: cur, muted: video.muted, paused: video.paused })
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
        try { console.log(dbgPrefix + 'resume startLoad on play') } catch {}
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
        console.log(dbgPrefix + 'branch', { mode: 'safari-native', warmMode })
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
          console.log(dbgPrefix + 'video.error', { code: err?.code, message: err?.message })
        })
        video.addEventListener('loadedmetadata', () => console.log(dbgPrefix + 'loadedmetadata'))
        video.addEventListener('canplay', () => console.log(dbgPrefix + 'canplay'))
        video.addEventListener('playing', () => console.log(dbgPrefix + 'playing'))
        video.addEventListener('waiting', () => console.log(dbgPrefix + 'waiting'))
        video.addEventListener('stalled', () => console.log(dbgPrefix + 'stalled'))
        video.addEventListener('play', onPlay)
      } catch {}
      try { video.addEventListener('loadeddata', onLoadedData) } catch {}
      // TEMP DEBUG: warn if src is manifest on non-Safari (should never happen here)
      try { if (!isSafari() && (video.getAttribute('src') || '').endsWith('.m3u8')) console.error(dbgPrefix + 'WARN non-Safari has manifest src', video.getAttribute('src')) } catch {}
      return cleanup
    }

    // Other browsers with MSE: use hls.js
    if (Hls.isSupported()) {
      const hls = new Hls({ autoStartLoad: warmMode === 'attach' ? false : true })
      hlsRef.current = hls
      try {
        console.log(dbgPrefix + 'branch', { mode: 'hls.js', warmMode })
        // Attach media first; defer manifest for attach-warm to avoid canceled requests
        hls.attachMedia(video)
        if (warmMode !== 'attach') {
          try { hls.loadSource(manifest); lastLoadSrcRef.current = manifest } catch {}
        }
        // TEMP DEBUG: key Hls events only
        hls.on(Hls.Events.MEDIA_ATTACHED, () => console.log(dbgPrefix + 'hls MEDIA_ATTACHED'))
        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data: any) => { manifestParsedRef.current = true; console.log(dbgPrefix + 'hls MANIFEST_PARSED', { levels: data?.levels?.length, audioTracks: data?.audioTracks?.length }) })
        hls.on(Hls.Events.LEVEL_LOADED, (_e, data: any) => console.log(dbgPrefix + 'hls LEVEL_LOADED', { level: data?.level, totalduration: data?.details?.totalduration, live: data?.details?.live, codecs: { audio: data?.details?.audioCodec, video: data?.details?.videoCodec } }))
        hls.on(Hls.Events.ERROR, (_e, data: any) => {
          console.log(dbgPrefix + 'hls ERROR', { type: data?.type, details: data?.details, fatal: data?.fatal })
          if (!data?.fatal) return
          try {
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              console.log(dbgPrefix + 'hls recoverMediaError')
              hls.recoverMediaError()
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              console.log(dbgPrefix + 'hls startLoad (network recover)')
              hls.startLoad()
            } else {
              console.log(dbgPrefix + 'hls destroy (fatal other)')
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
          console.log(dbgPrefix + 'video.error', { code: err?.code, message: err?.message })
        })
        video.addEventListener('loadedmetadata', () => console.log(dbgPrefix + 'loadedmetadata'))
        video.addEventListener('canplay', () => console.log(dbgPrefix + 'canplay'))
        video.addEventListener('playing', () => console.log(dbgPrefix + 'playing'))
        video.addEventListener('waiting', () => console.log(dbgPrefix + 'waiting'))
        video.addEventListener('stalled', () => console.log(dbgPrefix + 'stalled'))
        video.addEventListener('play', onPlay)
      } catch {}
      try { video.addEventListener('loadeddata', onLoadedData) } catch {}
      // TEMP DEBUG: after a tick, verify currentSrc is blob: when loaded
      setTimeout(() => {
        try {
          const s = video.getAttribute('src') || ''
          const cs = (video as any).currentSrc || ''
          console.log(dbgPrefix + 'post-attach src check', { src: s, currentSrc: cs })
          if ((s && s.endsWith('.m3u8')) || (cs && cs.endsWith('.m3u8'))) {
            console.error(dbgPrefix + 'WARN Chrome has manifest in src/currentSrc — unexpected for hls.js path')
          }
        } catch {}
      }, 0)
      return cleanup
    }

    // Fallback: allow native only on iOS WebKit where MSE is unavailable
    if (isiOS && canNative) {
      try {
        console.log(dbgPrefix + 'branch', { mode: 'fallback-native-ios' })
        video.src = manifest
        video.addEventListener('loadeddata', onLoadedData)
      } catch {}
      return cleanup
    }

    // As a safety, do not assign manifest src on non-Apple desktop if we reach here
    try {
      console.error(dbgPrefix + 'no supported playback path (not assigning manifest to src)')
    } catch {}
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
