import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, createApiClient } from '../src/api/client';

test('anonymous calls use the configured API prefix, JSON, and no ambient cookies', async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ ok: true });
  };
  const client = createApiClient('https://example.com/service', { fetchImpl });
  assert.deepEqual(await client.getJson('/health'), { ok: true });
  assert.equal(calls[0].url, 'https://example.com/service/health');
  assert.equal(calls[0].options?.credentials, 'omit');
  assert.deepEqual(calls[0].options?.headers, { Accept: 'application/json' });
});

test('HTTP and malformed JSON failures produce useful errors without leaking server bodies', async () => {
  const client = createApiClient('https://example.com', {
    fetchImpl: async () => new Response('private server detail', { status: 503 }),
  });
  await assert.rejects(client.getJson('/health'), (error: unknown) =>
    error instanceof ApiError && error.status === 503 && !error.message.includes('private'));
  const badJson = createApiClient('https://example.com', {
    fetchImpl: async () => new Response('<html>wrong proxy</html>'),
  });
  await assert.rejects(badJson.getJson('/health'), /unreadable/);
});

test('cancelling an in-flight request propagates abort and is distinct from a network failure', async () => {
  let requestSignal: AbortSignal | null = null;
  const client = createApiClient('https://example.com', {
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      requestSignal = options?.signal ?? null;
      requestSignal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }),
  });
  const controller = new AbortController();
  const request = client.getJson('/health', controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal((requestSignal as AbortSignal | null)?.aborted, true);
});

test('an already cancelled request never starts a fetch', async () => {
  let called = false;
  const client = createApiClient('https://example.com', {
    fetchImpl: async () => { called = true; return Response.json({}); },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.getJson('/health', controller.signal), { name: 'AbortError' });
  assert.equal(called, false);
});

test('request timeout aborts the fetch and returns a retryable timeout message', async () => {
  const client = createApiClient('https://example.com', {
    timeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }),
  });
  await assert.rejects(client.getJson('/health'), /timed out/);
});
