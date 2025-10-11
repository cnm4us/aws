import React, { useEffect, useMemo, useRef, useState } from 'react'

type UploadItem = {
  id: number
  url: string
  poster?: string
}

async function fetchUploads(cursor?: number): Promise<UploadItem[]> {
  const params = new URLSearchParams({ status: 'completed', limit: '20' })
  if (cursor) params.set('cursor', String(cursor))
  const res = await fetch(`/api/uploads?${params.toString()}`)
  if (!res.ok) throw new Error('failed to fetch uploads')
  const data = await res.json()
  return (data as any[]).map((r) => ({ id: r.id, url: r.cdn_master || r.s3_master, poster: r.poster_cdn || r.poster_s3 }))
}

export default function Feed() {
  const [items, setItems] = useState<UploadItem[]>([])
  const [cursor, setCursor] = useState<number | undefined>(undefined)
  const [index, setIndex] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // initial load
  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const page = await fetchUploads()
        if (canceled) return
        setItems(page)
        if (page.length) setCursor(page[page.length - 1].id)
      } catch {}
    })()
    return () => {
      canceled = true
    }
  }, [])

  // Preload next posters
  useEffect(() => {
    const nexts = [index + 1, index + 2]
    nexts.forEach((i) => {
      const p = items[i]?.poster
      if (p) {
        const img = new Image()
        img.src = p
      }
    })
  }, [index, items])

  // Attach and play current item
  const attachAndPlay = async (i: number) => {
    const v = videoRef.current
    const r = railRef.current
    if (!v || !r) return
    const slide = r.children[i] as HTMLDivElement | undefined
    if (!slide) return
    const holder = slide.querySelector('.holder') as HTMLDivElement | null
    if (!holder) return
    if (v.parentElement !== holder) {
      holder.innerHTML = ''
      holder.appendChild(v)
    }
    v.style.opacity = '0'
    try {
      v.src = items[i].url
      v.preload = 'auto'
      v.playsInline = true
      v.muted = !unlocked
      await v.play().catch(() => {})
    } catch {}
    const onLoaded = () => {
      v.style.opacity = '1'
      v.removeEventListener('loadeddata', onLoaded)
    }
    v.addEventListener('loadeddata', onLoaded)
  }

  // On unlock
  const unlock = () => {
    if (unlocked) return
    setUnlocked(true)
    attachAndPlay(index)
  }

  // Compute active index on scroll (snap to nearest)
  const onScroll = () => {
    const r = railRef.current
    if (!r) return
    const y = r.scrollTop
    const h = r.clientHeight || window.innerHeight
    const i = Math.max(0, Math.min(items.length - 1, Math.round(y / Math.max(1, h))))
    if (i !== index) {
      setIndex(i)
      if (unlocked) attachAndPlay(i)
      // pagination
      if (!loadingMore && items.length - i < 5 && cursor) {
        setLoadingMore(true)
        fetchUploads(cursor)
          .then((page) => {
            if (page.length) {
              setItems((prev) => prev.concat(page))
              setCursor(page[page.length - 1].id)
            }
          })
          .finally(() => setLoadingMore(false))
      }
    }
  }

  // Render cards
  const slides = useMemo(
    () =>
      items.map((it, i) => (
        <div
          key={it.id}
          className="slide"
          style={{
            backgroundImage: it.poster ? `url('${it.poster}')` : undefined,
          }}
        >
          <div className="holder" />
        </div>
      )),
    [items]
  )

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', background: '#000' }}>
      {!unlocked && (
        <div
          onClick={unlock}
          onTouchEnd={unlock}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(180deg,#000,#111)',
            zIndex: 10,
          }}
        >
          <button style={{ color: '#fff', background: '#0a84ff', border: 'none', padding: '14px 20px', borderRadius: 12, fontSize: 16 }}>
            Tap to start
          </button>
        </div>
      )}
      <div
        ref={railRef}
        onScroll={onScroll}
        style={{ position: 'fixed', inset: 0, overflowY: 'auto', scrollSnapType: 'y mandatory', scrollBehavior: 'smooth' }}
      >
        {slides.length ? slides : <div style={{ color: '#fff', padding: 20 }}>Loading…</div>}
      </div>
      <video
        ref={videoRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0, transition: 'opacity .12s linear', pointerEvents: 'none' }}
      />
      <style>{`
        .slide{position:relative; width:100vw; height:100dvh; scroll-snap-align:start; scroll-snap-stop:always; background:#000; background-size:cover; background-position:center; background-repeat:no-repeat;}
        .holder{position:absolute; inset:0;}
      `}</style>
    </div>
  )
}

