import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../services/s3';
import { ViewerApiError } from '../native-sessions/service';
import * as feeds from '../feeds/repo';
import * as spaces from '../spaces/service';
import * as publications from './repo';

export const MAX_VTT_BYTES = 1024 * 1024;
export type TextContext = { kind: 'global' } | { kind: 'space'; spaceId: number };
export function textId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ViewerApiError(400, 'invalid_query');
  return Number(value);
}

// Injectable boundaries allow permission/failure tests without weakening production selection.
const dependencies = {
  global: feeds.listGlobalFeedRows,
  space: feeds.listSpaceFeedRows,
  assertSpace: spaces.assertCanViewSpaceFeed,
  publication: publications.getById,
  pointer: publications.getCaptionsPointerByProductionId,
  object: (bucket: string, key: string, signal: AbortSignal) => s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal }),
};

export async function readBoundedVtt(body: any, length?: number, signal?: AbortSignal): Promise<string> {
  if (!body || length !== undefined && length > MAX_VTT_BYTES) {
    body?.destroy?.(); throw new ViewerApiError(503, 'captions_unavailable');
  }
  const chunks: Buffer[] = []; let bytes = 0;
  try {
    for await (const chunk of body) {
      if (signal?.aborted) throw Error('cancelled');
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_VTT_BYTES) throw Error('oversize');
      chunks.push(buffer);
    }
    if (signal?.aborted) throw Error('cancelled');
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
  } catch {
    body.destroy?.(); throw new ViewerApiError(503, 'captions_unavailable');
  }
}

export function createViewerTextService(deps = dependencies) {
  const eligible = async (context: TextContext, publicationId: number, userId: number | null) => {
    if (context.kind === 'space') {
      if (!userId) throw new ViewerApiError(401, 'unauthorized');
      await deps.assertSpace(context.spaceId, userId);
    }
    const selection = { publicationId, limit: 1, userId };
    const rows = context.kind === 'global' ? await deps.global(selection) : await deps.space(context.spaceId, selection);
    const row = rows[0];
    if (!row || Number(row.publication_id) !== publicationId || context.kind === 'space' && Number(row.space_id) !== context.spaceId)
      throw new ViewerApiError(404, 'publication_not_found');
    return row;
  };
  return {
    story: async (context: TextContext, publicationId: number, userId: number | null) => {
      await eligible(context, publicationId, userId);
      const publication = await deps.publication(publicationId);
      if (!publication) throw new ViewerApiError(404, 'publication_not_found');
      const text = publication.story_text;
      if (text && text.length > 2000) throw new ViewerApiError(503, 'story_unavailable');
      await eligible(context, publicationId, userId);
      return { context, publicationId, storyText: text?.trim() ? text : null };
    },
    captions: async (context: TextContext, publicationId: number, userId: number | null, signal: AbortSignal) => {
      const row = await eligible(context, publicationId, userId);
      if (!row.production_id) throw new ViewerApiError(404, 'captions_not_found');
      const pointer = await deps.pointer(Number(row.production_id));
      if (!pointer) throw new ViewerApiError(404, 'captions_not_found');
      const controller = new AbortController();
      let body: any;
      const cancel = () => { controller.abort(); body?.destroy?.(); };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      const timeout = setTimeout(cancel, 12_000);
      try {
        const response = await deps.object(pointer.bucket, pointer.key, controller.signal);
        body = response.Body;
        if (controller.signal.aborted) throw Error('cancelled');
        const text = await readBoundedVtt(body, response.ContentLength, controller.signal);
        await eligible(context, publicationId, userId);
        if (controller.signal.aborted) throw Error('cancelled');
        return text;
      } catch (error) {
        if (error instanceof ViewerApiError) throw error;
        if ([403, 404].includes((error as any)?.status)) throw error;
        throw new ViewerApiError(503, 'captions_unavailable');
      } finally {
        clearTimeout(timeout); signal.removeEventListener('abort', cancel); body?.destroy?.();
      }
    },
  };
}
export const viewerText = createViewerTextService();
