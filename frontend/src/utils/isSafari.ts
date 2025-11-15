export function isSafari(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const vendor = navigator.vendor || ''
  if (vendor !== 'Apple Computer, Inc.') return false
  const ua = navigator.userAgent || ''
  // True Safari should include Safari and exclude other engines, including iOS Chrome/Firefox/Edge
  const isSafariUa = /safari/i.test(ua) && !/(chrome|crios|chromium|edg|edgios|opr|fxios)/i.test(ua)
  return isSafariUa
}
