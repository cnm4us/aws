import { useEffect } from 'react'

// Simple warm-up hook: when currentIndex changes, ensure next video pauses after it buffers
export function useVideoWarmup(currentIndex: number, videoRefs: Array<React.RefObject<HTMLVideoElement>>) {
  useEffect(() => {
    const next = videoRefs[currentIndex + 1]
    const el = next?.current
    if (!el) return

    const warm = () => {
      try { el.pause() } catch {}
    }

    if (el.readyState >= 2) {
      warm()
      return
    }

    try { el.addEventListener('loadeddata', warm) } catch {}
    return () => { try { el.removeEventListener('loadeddata', warm) } catch {} }
  }, [currentIndex, videoRefs])
}

