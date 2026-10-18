export type Environment = { apiBaseUrl: string };
export type EnvironmentResult =
  | { ok: true; value: Environment }
  | { ok: false; message: string };

export function readEnvironment(
  rawBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL,
): EnvironmentResult {
  if (!rawBaseUrl?.trim()) {
    return { ok: false, message: 'Set EXPO_PUBLIC_API_BASE_URL in mobile/.env, then restart Expo.' };
  }
  try {
    const url = new URL(rawBaseUrl.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid API address');
    }
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) {
      return { ok: false, message: 'Use an HTTPS API address reachable from your iPhone. Localhost points to the phone.' };
    }
    return { ok: true, value: { apiBaseUrl: url.toString().replace(/\/+$/, '') } };
  } catch {
    return { ok: false, message: 'EXPO_PUBLIC_API_BASE_URL must be an HTTPS address without credentials, a query, or a fragment.' };
  }
}
