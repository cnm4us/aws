export type FeedVideoItem = {
  publicationId: number;
  uploadId: number | null;
  productionUlid: string | null;
  spaceId: number | null;
  playbackUrl: string | null;
  posterUrl: string | null;
  creator: { id: number | null; displayName: string; avatarUrl: string | null };
  description: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

export type FeedPage = { items: FeedVideoItem[]; nextCursor: string | null;
  resume?: {requestedPublicationId:number;restoredPublicationId:number|null;outcome:'restored'|'unavailable'} };
