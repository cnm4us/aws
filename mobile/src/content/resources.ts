import { ApiError, type ApiClient } from '../api/client';
import type { FeedContext } from '../feed/context';
import { parseVtt, type Cue } from './vtt';
import { verificationClock, type Verified } from '../auth/verifiedRefresh';

export function textPath(context: FeedContext, publicationId: number, resource: 'story' | 'captions.vtt') {
  return `/api/viewer/v1/${context.kind === 'global' ? 'feed/global' : `spaces/${context.spaceId}`}/publications/${publicationId}/${resource}`;
}
type Resource = string | null | Cue[];
export class TextResources {
  private cache = new Map<string, { value: Resource; at: number; bytes: number }>();
  private pending = new Set<AbortController>();
  private generation = 0;
  constructor(private readonly client: Pick<ApiClient, 'getJson' | 'getText'>, readonly context: FeedContext,
    private readonly denied: (error: ApiError) => void, readonly now = verificationClock) {}
  clear = () => {
    this.generation++;
    for (const request of this.pending) request.abort();
    this.pending.clear(); this.cache.clear();
  };
  private async load(kind: 'story' | 'captions.vtt', publicationId: number, signal: AbortSignal, duration?: number | null, force = false): Promise<Verified<Resource>> {
    if (signal.aborted) throw Object.assign(Error('Cancelled'), { name: 'AbortError' });
    const key = `${kind}:${publicationId}:${duration ?? ''}`, cached = this.cache.get(key);
    if (!force && cached && this.now() - cached.at < 60_000) {
      this.cache.delete(key); this.cache.set(key, cached); return { value: cached.value, verifiedAt: cached.at };
    }
    const generation = this.generation, request = new AbortController(), verifiedAt = this.now();
    this.pending.add(request);
    const cancel = () => request.abort(); signal.addEventListener('abort', cancel, { once: true });
    try {
      let value: Resource;
      if (kind === 'story') {
        const raw = await this.client.getJson(textPath(this.context, publicationId, kind), request.signal) as any;
        if (raw?.publicationId !== publicationId || raw?.context?.kind !== this.context.kind ||
          this.context.kind === 'space' && raw.context.spaceId !== this.context.spaceId ||
          !(raw.storyText === null || typeof raw.storyText === 'string' && raw.storyText.length <= 2000))
          throw new ApiError('The server returned an unexpected story.');
        value = raw.storyText;
      } else value = parseVtt(await this.client.getText(textPath(this.context, publicationId, kind), request.signal), duration);
      if (generation !== this.generation || request.signal.aborted) throw Object.assign(Error('Cancelled'), { name: 'AbortError' });
      const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (size > 2 * 1024 * 1024) throw new ApiError('This text is too large to display.');
      this.cache.delete(key); this.cache.set(key, { value, at: verifiedAt, bytes: size });
      let total = [...this.cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      while (this.cache.size > 20 || total > 2 * 1024 * 1024) {
        const oldest = this.cache.keys().next().value!; total -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
      }
      return { value, verifiedAt };
    } catch (error) {
      if (request.signal.aborted || generation !== this.generation) throw Object.assign(Error('Cancelled'), { name: 'AbortError' });
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.code === 'publication_not_found' || error.code === 'space_not_found')) {
        this.clear(); this.denied(error);
      }
      throw error;
    } finally { signal.removeEventListener('abort', cancel); this.pending.delete(request); }
  }
  verifiedStory = (id: number, signal: AbortSignal, force = false) => this.load('story', id, signal, undefined, force) as Promise<Verified<string | null>>;
  verifiedCaptions = (id: number, duration: number | null, signal: AbortSignal, force = false) => this.load('captions.vtt', id, signal, duration, force) as Promise<Verified<Cue[]>>;
  story = async (id: number, signal: AbortSignal, force = false) => (await this.verifiedStory(id, signal, force)).value;
  captions = async (id: number, duration: number | null, signal: AbortSignal, force = false) => (await this.verifiedCaptions(id, duration, signal, force)).value;
}
