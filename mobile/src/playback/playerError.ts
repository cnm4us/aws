export type PlayerErrorDetails = {
  nativeErrorDomain?: 'AVFoundationErrorDomain' | 'NSURLErrorDomain' | 'CoreMediaErrorDomain' | 'NSOSStatusErrorDomain';
  nativeErrorCode?: number;
};

// Native messages can contain signed media URLs. Export only recognized OS
// domains and their numeric codes; never retain the original error text.
export function playerErrorDetails(error: unknown): PlayerErrorDetails {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') return {};
  const match = /\b(AVFoundationErrorDomain|NSURLErrorDomain|CoreMediaErrorDomain|NSOSStatusErrorDomain)\b(?:\s+error\s+|\s+Code\s*=\s*)(-?\d{1,10})\b/i.exec(error.message);
  if (!match) return {};
  const domains = ['AVFoundationErrorDomain', 'NSURLErrorDomain', 'CoreMediaErrorDomain', 'NSOSStatusErrorDomain'] as const;
  return { nativeErrorDomain: domains.find(domain => domain.toLowerCase() === match[1].toLowerCase()), nativeErrorCode: Number(match[2]) };
}
