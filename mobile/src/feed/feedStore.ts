import type { FeedPage, FeedVideoItem } from './types';
import { ApiError } from '../api/client';

export type FeedSnapshot = {
  sessionId: number;
  items: FeedVideoItem[];
  initialLoading: boolean;
  loadingMore: boolean;
  initialError: string | null;
  moreError: string | null;
  nextCursor: string | null;
  autoPaused: boolean;
  errorStatus: number | null;
  errorCode?: string;
  resume?: FeedPage['resume'];reviewRequired?:FeedPage['reviewRequired'];
};

export type PageLoader = (cursor: string | null, signal: AbortSignal) => Promise<FeedPage>;

export class FeedStore {
  private state: FeedSnapshot = {
    sessionId: 0, items: [], initialLoading: true, loadingMore: false,
    initialError: null, moreError: null, nextCursor: null, autoPaused: false, errorStatus:null, errorCode:undefined, resume:undefined,
  };
  private listeners = new Set<() => void>();
  private request: { controller: AbortController; promise?: Promise<void> } | null = null;
  private visitedCursors = new Set<string>();
  private emptyAdvances = 0;

  constructor(private readonly loadPage: PageLoader, private readonly onFailure: (error:unknown)=>void = ()=>{},seed?:FeedPage) {
    if(seed)this.state={...this.state,...seed,sessionId:1,initialLoading:false};
  }
  reconcileItems=(items:FeedVideoItem[])=>{
    const replacements=new Map(items.map(i=>[i.publicationId,i]));
    if(this.state.items.some(i=>replacements.has(i.publicationId)))this.publish({items:this.state.items.map(i=>replacements.get(i.publicationId)??i)});
  };
  revalidate=async()=>{
    if(this.request)return;const request={controller:new AbortController(),promise:undefined as Promise<void>|undefined};this.request=request;
    try{const page=await this.loadPage(null,request.controller.signal);if(this.request!==request||request.controller.signal.aborted)return;
      // Preserve a visible selected row/time. A missing origin is a real new feed.
      const missing=page.resume?.outcome==='unavailable';
      this.publish({items:page.items,nextCursor:page.nextCursor,resume:page.resume,
        ...(missing?{sessionId:this.state.sessionId+1}:{}),initialError:null,moreError:null,errorStatus:null});
    }catch(error){if(this.request!==request||request.controller.signal.aborted)return;
      if(error instanceof ApiError&&[401,403,404].includes(error.status??0))this.denyAccess(error);
      else this.publish({moreError:error instanceof Error?error.message:'Cannot refresh feed.'});
    }finally{if(this.request===request)this.request=null;}
  };

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<FeedSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  cancel = () => {
    this.request?.controller.abort();
    this.request = null;
  };
  denyAccess = (error:ApiError) => {
    this.cancel();
    this.publish({items:[],nextCursor:null,initialLoading:false,loadingMore:false,initialError:error.message,
      moreError:null,errorStatus:error.status??403,errorCode:error.code,autoPaused:true});
    this.onFailure(error);
  };

  refresh = () => {
    this.cancel();
    this.visitedCursors.clear();
    this.emptyAdvances = 0;
    this.publish({
      sessionId: this.state.sessionId + 1, items: [], initialLoading: true,
      loadingMore: false, initialError: null, moreError: null, nextCursor: null, autoPaused: false, errorStatus:null, errorCode:undefined, resume:undefined,
    });
    return this.fetchPage(null, true);
  };

  loadMore = (manual = false): Promise<void> => {
    if (this.request) return this.request.promise ?? Promise.resolve();
    if (this.state.initialLoading || !this.state.nextCursor || (this.state.autoPaused && !manual)) {
      return Promise.resolve();
    }
    if (manual) this.emptyAdvances = 0;
    return this.fetchPage(this.state.nextCursor, false);
  };

  ensureAhead = (index: number) => {
    if (this.state.items.length - 1 - index <= 5) void this.loadMore();
  };

  private fetchPage(cursor: string | null, initial: boolean): Promise<void> {
    const request = { controller: new AbortController(), promise: undefined as Promise<void> | undefined };
    this.request = request;
    this.publish(initial ? { initialError: null } : { loadingMore: true, moreError: null, autoPaused: false });
    request.promise = (async () => {
      try {
        const page = await this.loadPage(cursor, request.controller.signal);
        if (this.request !== request || request.controller.signal.aborted) return;
        const seen = new Set(this.state.items.map(item => item.publicationId));
        const added = page.items.filter(item => {
          if (seen.has(item.publicationId)) return false;
          seen.add(item.publicationId);
          return true;
        });
        if (!initial && !added.some(item => item.playbackUrl)) this.emptyAdvances += 1;
        else this.emptyAdvances = 0;
        if (cursor) this.visitedCursors.add(cursor);
        const repeatedCursor = page.nextCursor !== null && this.visitedCursors.has(page.nextCursor);
        this.request = null;
        this.publish({
          items: [...this.state.items, ...added], initialLoading: false, loadingMore: false,
          nextCursor: repeatedCursor ? cursor : page.nextCursor,
          moreError: repeatedCursor ? 'The feed could not advance. Try again.' : null,
          autoPaused: repeatedCursor || this.emptyAdvances >= 2,
          ...(initial?{resume:page.resume,reviewRequired:page.reviewRequired}:{reviewRequired:Array.from(new Map([...(this.state.reviewRequired??[]),...(page.reviewRequired??[])].map(r=>[r.id,r])).values())}),
        });
      } catch (error) {
        if (this.request !== request || request.controller.signal.aborted) return;
        this.request = null;
        const message = error instanceof Error ? error.message : 'The feed could not be loaded. Try again.';
        if(error instanceof ApiError && [401,403,404].includes(error.status??0)) {
          this.publish({items:[],nextCursor:null,initialLoading:false,loadingMore:false,initialError:message,moreError:null,errorStatus:error.status!,errorCode:error.code,autoPaused:true});
          this.onFailure(error);return;
        }
        this.publish(initial
          ? { initialLoading: false, initialError: message }
          : { loadingMore: false, moreError: message, autoPaused: true });
        this.onFailure(error);
      }
    })();
    return request.promise;
  }
}
