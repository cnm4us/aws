export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
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

export function createApiClient(baseUrl: string, options: ClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
      if (!path.startsWith('/') || path.startsWith('//')) {
        throw new ApiError('API paths must be relative to the configured server.');
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
          method: 'GET', credentials: 'omit',
          headers: { Accept: 'application/json', ...options.getHeaders?.() },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new ApiError('The feed could not be loaded. Please try again.', response.status);
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
    },
  };
}
