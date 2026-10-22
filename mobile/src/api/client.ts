export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

type ClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  getHeaders?: () => Record<string, string>;
};

export type ApiClient = ReturnType<typeof createApiClient>;

export async function readBoundedText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ApiError('This text is too large to display.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = []; let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('Cancelled');
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new ApiError('This text is too large to display.');
      parts.push(decoder.decode(value, { stream: true }));
    }
    if (signal.aborted) throw new Error('Cancelled');
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

export function createApiClient(baseUrl: string, options: ClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestJson = async (path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, signal?: AbortSignal, text = false): Promise<unknown> => {
      if (!path.startsWith('/') || path.startsWith('//') || /[\\\s]/.test(path) || new URL(`${baseUrl}${path}`).origin !== new URL(baseUrl).origin) {
        throw new ApiError('API paths must be relative to the configured server.');
      }
      const headers = { Accept: text ? 'text/vtt' : 'application/json', ...options.getHeaders?.() } as Record<string,string>;
      if (Object.keys(headers).some(k=>k.toLowerCase()==='authorization') && !/^\/api\/(native|viewer)\/v1\//.test(path)) {
        throw new ApiError('Credentials are only available to the viewing API.');
      }
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs ?? 15_000);

      try {
        if (controller.signal.aborted) throw new Error('Cancelled');
        const response = await fetchImpl(`${baseUrl}${path}`, {
          method, credentials: 'omit', redirect: 'error',
          headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.redirected || (response.url && new URL(response.url).origin !== new URL(baseUrl).origin)) {
          throw new ApiError('The server redirected this request. Check your connection.');
        }
        if (!response.ok) {
          let code: string | undefined;
          try { const data = await response.json(); if (typeof data?.error === 'string') code = data.error; } catch {}
          const messages: Record<string,string> = {
            invalid_credentials: 'Email or password is incorrect.', unauthorized: 'Please sign in again.',
            forbidden: 'You do not currently have access to this space.', space_not_found: 'This space is unavailable.',
            rate_limited: 'Too many sign-in attempts. Please wait and try again.',
            native_unavailable: 'App sign-in is temporarily unavailable.',
            publication_not_found: 'This video is no longer available in this feed.',
            captions_not_found: 'Captions are not available for this video.',
            captions_unavailable: 'Cannot load captions. Please try again.',
            story_unavailable: 'Cannot load the story. Please try again.',
          };
          const safeCode = code && Object.hasOwn(messages,code) ? code : undefined;
          const retry = Number(response.headers.get('Retry-After'));
          throw new ApiError(safeCode ? messages[safeCode] : 'The request could not be completed. Please try again.', response.status,
            safeCode, Number.isFinite(retry) && retry>0 ? retry : undefined);
        }
        if (response.status === 204) return null;
        if (text) {
          if (!/^text\/vtt(?:;|$)/i.test(response.headers.get('content-type') || '')) {
            await response.body?.cancel().catch(() => {});
            throw new ApiError('The server returned unexpected captions.');
          }
          return await readBoundedText(response, 1024 * 1024, controller.signal);
        }
        try {
          return await response.json();
        } catch {
          if (controller.signal.aborted) throw new Error('Cancelled');
          throw new ApiError('The server returned an unreadable feed. Please try again.');
        }
      } catch (error) {
        if (signal?.aborted) {
          const cancelled = new Error('Request cancelled');
          cancelled.name = 'AbortError';
          throw cancelled;
        }
        if (timedOut) throw new ApiError('The connection timed out. Please try again.');
        if (error instanceof ApiError) throw error;
        throw new ApiError('Cannot reach the server. Check your connection and try again.');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    };
  return {
    getText: (path: string, signal?: AbortSignal) => requestJson(path,'GET',undefined,signal,true) as Promise<string>,
    getJson: (path: string, signal?: AbortSignal) => requestJson(path,'GET',undefined,signal),
    postJson: (path: string, body: unknown, signal?: AbortSignal) => requestJson(path,'POST',body,signal),
    deleteJson: (path: string, signal?: AbortSignal) => requestJson(path,'DELETE',undefined,signal),
  };
}
