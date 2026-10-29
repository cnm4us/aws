import type {SourceContext,AggregateKind} from './context';
import type { AccessProof } from '../auth/accessProof';
export type FeedVideoItem = {
  publicationId: number;
  sourceContext?:SourceContext;
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

export type FeedPage = { access?:AccessProof;sourceProofs?:AccessProof[];aggregateAccess?:{kind:AggregateKind;until:number;publications:FeedVideoItem[]};reviewRequired?:Array<{id:number;name:string;type:string}>;items: FeedVideoItem[]; nextCursor: string | null;
  resume?: {requestedPublicationId:number;restoredPublicationId:number|null;outcome:'restored'|'unavailable'} };
