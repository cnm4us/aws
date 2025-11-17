import React, { CSSProperties } from 'react'
import HLSVideo from './HLSVideo'

type Props = {
  src: string
  active: boolean
  warm: boolean
  muted?: boolean
  poster?: string
  className?: string
  style?: CSSProperties
  onClick?: React.MouseEventHandler<HTMLVideoElement>
  onTouchStart?: React.TouchEventHandler<HTMLVideoElement>
  onTouchMove?: React.TouchEventHandler<HTMLVideoElement>
  onTouchEnd?: React.TouchEventHandler<HTMLVideoElement>
  warmMode?: 'none' | 'attach' | 'buffer'
  debugId?: string
}

export default function FeedVideo({ src, active, warm, muted = true, poster, className, style, onClick, onTouchStart, onTouchMove, onTouchEnd, warmMode = 'none', debugId }: Props) {
  return (
    <HLSVideo
      src={src}
      autoPlay={false}
      loop
      warm={warm}
      warmMode={warmMode}
      debugId={debugId}
      muted={muted}
      playsInline
      poster={poster}
      className={className}
      style={style}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    />
  )
}
