import type { AccessProof } from '../auth/accessProof';
export type FeedVideoItem = {
  publicationId: number;
  publishedAt: string | null;
  uploadId: number | null;
  productionUlid: string | null;
  spaceId: number | null;
  playbackUrl: string | null;
  posterUrl: string | null;
  creator: { id: number | null; displayName: string; avatarUrl: string | null };
  description: string | null;
  reportedByMe?: boolean;
  hasStory?: boolean;
  storyPreview?: string | null;
  hasCaptions?: boolean;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

export type FeedPage = { access?:AccessProof;items: FeedVideoItem[]; nextCursor: string | null;
  resume?: {requestedPublicationId:number;restoredPublicationId:number|null;outcome:'restored'|'unavailable'} };
