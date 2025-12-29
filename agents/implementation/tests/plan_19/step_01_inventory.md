# Plan 19 — Step 1 Inventory (Pin video first)

Date: 2025-12-29

## Findings (summary)

- Backend feed items already include `publication.production_ulid` for both global and space feeds (from `src/features/feeds/service.ts`).
- Frontend `UploadItem` does **not** currently keep `production_ulid` as a field; it only folds it into `videoId` (`frontend/src/app/Feed.tsx:117`) which can also be an `asset_uuid` fallback.
- Jump modal currently receives only `publicationId` and builds destination links without any `pin` param (`frontend/src/app/JumpToSpaceModal.tsx:15` and `:131`).
- Space feed API route is `/api/spaces/:id/feed` in `src/routes/spaces.ts:396` and currently supports only `limit` + `cursor`.
- Space feed fetch URL is built in `fetchSpaceFeed()` (`frontend/src/app/Feed.tsx:145`).

## Source references

### Frontend: production_ulid availability

```bash
rg -n "production_ulid|videoId" frontend/src/app/Feed.tsx -S
```

```bash
nl -ba frontend/src/app/Feed.tsx | sed -n '99,170p'
```

### Frontend: Jump modal link building

```bash
nl -ba frontend/src/app/JumpToSpaceModal.tsx | sed -n '1,180p'
```

### Backend: feed service includes production_ulid

```bash
rg -n "production_ulid" src/features/feeds/service.ts src/features/feeds/repo.ts -S
```

### Backend: space feed route (where pin will be parsed)

```bash
nl -ba src/routes/spaces.ts | sed -n '396,410p'
```

## Runtime verification (authenticated)

21:  videoId?: string | null
117:  const productionUlid: string | null = publication?.production_ulid ? String(publication.production_ulid) : null
119:  const videoId: string | null = productionUlid || assetUuid || null
127:    videoId,
347:    videoId: string | null
676:    const vid = (it as any).videoId ? String((it as any).videoId) : null
685:  function readVideoProgress(_videoId: string | null | undefined): number | null { return null }
1004:            if (iPub < 0 && last.videoId) iVid = fetchedItems.findIndex((it) => ((it as any).videoId ?? null) === last.videoId)
1375:        const vid = (it as any).videoId ? String((it as any).videoId) : null
    99	function buildUploadItem(raw: any, owner?: { id: number | null; displayName?: string | null; email?: string | null; avatarUrl?: string | null } | null, publication?: any | null): UploadItem {
   100	  const posterPortrait = raw.poster_portrait_cdn || raw.poster_portrait_s3 || raw.poster_cdn || raw.poster_s3 || ''
   101	  const posterLandscape = raw.poster_landscape_cdn || raw.poster_landscape_s3 || ''
   102	  const master = raw.cdn_master || raw.s3_master || ''
   103	  const { portrait: masterPortrait, landscape: masterLandscape } = swapOrientation(master)
   104	  const ownerId = owner?.id != null ? Number(owner.id) : (raw.user_id != null ? Number(raw.user_id) : null)
   105	  const ownerName = owner?.displayName ?? null
   106	  const ownerEmail = owner?.email ?? null
   107	  const ownerAvatarUrl = owner?.avatarUrl ?? null
   108	  const publicationId = publication?.id != null ? Number(publication.id) : null
   109	  const spaceId = publication?.space_id != null ? Number(publication.space_id) : (raw.space_id != null ? Number(raw.space_id) : null)
   110	  const publishedAt = publication?.published_at ? String(publication.published_at) : null
   111	  const likesCount = typeof publication?.likes_count === 'number' ? Number(publication.likes_count) : null
   112	  const commentsCount = typeof publication?.comments_count === 'number' ? Number(publication.comments_count) : null
   113	  const likedByMe = typeof (publication as any)?.liked_by_me === 'boolean' ? Boolean((publication as any).liked_by_me) : null
   114	  const commentedByMe = typeof (publication as any)?.commented_by_me === 'boolean' ? Boolean((publication as any).commented_by_me) : null
   115	  const reportedByMe = typeof (publication as any)?.reported_by_me === 'boolean' ? Boolean((publication as any).reported_by_me) : null
   116	  // Prefer production ULID; fallback to upload asset UUID; ensure string or null
   117	  const productionUlid: string | null = publication?.production_ulid ? String(publication.production_ulid) : null
   118	  const assetUuid: string | null = raw.asset_uuid ? String(raw.asset_uuid) : null
   119	  const videoId: string | null = productionUlid || assetUuid || null
   120	  return {
   121	    id: Number(raw.id),
   122	    url: masterPortrait || master,
   123	    posterPortrait,
   124	    posterLandscape,
   125	    masterPortrait,
   126	    masterLandscape,
   127	    videoId,
   128	    ownerId,
   129	    ownerName,
   130	    ownerEmail,
   131	    ownerAvatarUrl,
   132	    publicationId,
   133	    spaceId,
   134	    publishedAt,
   135	    likesCount,
   136	    commentsCount,
   137	    likedByMe,
   138	    commentedByMe,
   139	    reportedByMe,
   140	  }
   141	}
   142	
   143	// Legacy feed removed: feeds are driven by publications only.
   144	
   145	async function fetchSpaceFeed(spaceId: number, opts: { cursor?: string | null; limit?: number } = {}): Promise<{ items: UploadItem[]; nextCursor: string | null }> {
   146	  const params = new URLSearchParams({ limit: String(opts.limit ?? 20) })
   147	  if (opts.cursor) params.set('cursor', opts.cursor)
   148	  const res = await fetch(`/api/spaces/${spaceId}/feed?${params.toString()}`)
   149	  if (!res.ok) throw new Error('failed to fetch space feed')
   150	  const payload = await res.json()
   151	  const items = Array.isArray(payload?.items)
   152	    ? payload.items.map((entry: any) =>
   153	        buildUploadItem(
   154	          entry.upload,
   155	          entry.owner
   156	            ? {
   157	                id: entry.owner.id ?? null,
   158	                displayName: entry.owner.displayName ?? null,
   159	                email: entry.owner.email ?? null,
   160	                avatarUrl: entry.owner.avatarUrl ?? null,
   161	              }
   162	            : null,
   163	          entry.publication ?? null,
   164	        )
   165	      )
   166	    : []
   167	  const nextCursor = typeof payload?.nextCursor === 'string' && payload.nextCursor.length ? payload.nextCursor : null
   168	  return { items, nextCursor }
   169	}
   170	
     1	import React, { useEffect, useMemo, useState } from 'react'
     2	
     3	type JumpSpaceItem = {
     4	  spaceId: number
     5	  spaceUlid: string | null
     6	  spaceName: string
     7	  spaceSlug: string
     8	  spaceType: 'group' | 'channel' | string
     9	}
    10	
    11	type JumpSpacesResponse = {
    12	  items: JumpSpaceItem[]
    13	}
    14	
    15	export default function JumpToSpaceModal(props: {
    16	  open: boolean
    17	  publicationId: number | null
    18	  onClose: () => void
    19	}) {
    20	  const { open, publicationId, onClose } = props
    21	
    22	  const [loading, setLoading] = useState(false)
    23	  const [error, setError] = useState<string | null>(null)
    24	  const [items, setItems] = useState<JumpSpaceItem[]>([])
    25	
    26	  useEffect(() => {
    27	    if (!open) return
    28	    function onKeyDown(e: KeyboardEvent) {
    29	      if (e.key === 'Escape') onClose()
    30	    }
    31	    window.addEventListener('keydown', onKeyDown)
    32	    return () => window.removeEventListener('keydown', onKeyDown)
    33	  }, [open, onClose])
    34	
    35	  useEffect(() => {
    36	    if (!open) return
    37	    if (publicationId == null) {
    38	      setItems([])
    39	      setError('Missing publication id')
    40	      setLoading(false)
    41	      return
    42	    }
    43	
    44	    const controller = new AbortController()
    45	    setLoading(true)
    46	    setError(null)
    47	    setItems([])
    48	
    49	    ;(async () => {
    50	      try {
    51	        const res = await fetch(`/api/publications/${publicationId}/jump-spaces`, { credentials: 'same-origin', signal: controller.signal })
    52	        if (!res.ok) throw new Error('fetch_failed')
    53	        const data = (await res.json()) as JumpSpacesResponse
    54	        const next = Array.isArray(data?.items) ? data.items : []
    55	        setItems(
    56	          next
    57	            .map((it: any) => ({
    58	              spaceId: Number(it.spaceId),
    59	              spaceUlid: it.spaceUlid == null ? null : String(it.spaceUlid),
    60	              spaceName: String(it.spaceName || ''),
    61	              spaceSlug: String(it.spaceSlug || ''),
    62	              spaceType: String(it.spaceType || ''),
    63	            }))
    64	            .filter((it) => Number.isFinite(it.spaceId) && it.spaceId > 0 && it.spaceSlug.length > 0 && it.spaceName.length > 0)
    65	        )
    66	      } catch (e: any) {
    67	        if (String(e?.name || '') === 'AbortError') return
    68	        setError('Failed to load spaces')
    69	      } finally {
    70	        setLoading(false)
    71	      }
    72	    })()
    73	
    74	    return () => controller.abort()
    75	  }, [open, publicationId])
    76	
    77	  const title = useMemo(() => 'Jump to Space', [])
    78	
    79	  if (!open) return null
    80	
    81	  return (
    82	    <div
    83	      onClick={onClose}
    84	      style={{
    85	        position: 'fixed',
    86	        inset: 0,
    87	        zIndex: 90,
    88	        display: 'grid',
    89	        placeItems: 'center',
    90	        background: 'transparent',
    91	        paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
    92	        paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
    93	        paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
    94	        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
    95	      }}
    96	    >
    97	      <div
    98	        onClick={(e) => e.stopPropagation()}
    99	        style={{
   100	          width: 'min(560px, 100%)',
   101	          maxHeight: '86vh',
   102	          background: 'rgba(18,18,18,0.98)',
   103	          color: '#fff',
   104	          border: '1px solid rgba(255,255,255,0.16)',
   105	          borderRadius: 14,
   106	          overflow: 'hidden',
   107	          display: 'grid',
   108	          gridTemplateRows: 'auto 1fr',
   109	        }}
   110	      >
   111	        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
   112	          <div style={{ display: 'grid', gap: 2 }}>
   113	            <div style={{ fontWeight: 700 }}>{title}</div>
   114	            <div style={{ fontSize: 12, opacity: 0.8 }}>Pick a space to view and interact.</div>
   115	          </div>
   116	          <button onClick={onClose} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 10, padding: '6px 10px', fontSize: 16 }}>
   117	            Close
   118	          </button>
   119	        </div>
   120	
   121	        <div style={{ overflowY: 'auto', padding: 14 }}>
   122	          {loading ? (
   123	            <div style={{ padding: 6, opacity: 0.85 }}>Loading…</div>
   124	          ) : error ? (
   125	            <div style={{ padding: 6, color: '#ffb3b3' }}>{error}</div>
   126	          ) : items.length === 0 ? (
   127	            <div style={{ padding: 6, color: '#bbb' }}>Not published to any spaces yet.</div>
   128	          ) : (
   129	            <div style={{ display: 'grid', gap: 10 }}>
   130	              {items.map((s) => {
   131	                const href = s.spaceType === 'group' ? `/groups/${encodeURIComponent(s.spaceSlug)}` : `/channels/${encodeURIComponent(s.spaceSlug)}`
   132	                const meta = s.spaceType === 'group' ? 'Group' : s.spaceType === 'channel' ? 'Channel' : s.spaceType
   133	                return (
   134	                  <a
   135	                    key={String(s.spaceId)}
   136	                    href={href}
   137	                    style={{
   138	                      display: 'flex',
   139	                      alignItems: 'center',
   140	                      justifyContent: 'space-between',
   141	                      gap: 10,
   142	                      padding: '12px 12px',
   143	                      borderRadius: 12,
   144	                      border: '1px solid rgba(255,255,255,0.14)',
   145	                      background: 'rgba(255,255,255,0.04)',
   146	                      color: '#fff',
   147	                      textDecoration: 'none',
   148	                    }}
   149	                  >
   150	                    <div style={{ display: 'grid', gap: 2 }}>
   151	                      <div style={{ fontWeight: 650 }}>{s.spaceName}</div>
   152	                      <div style={{ fontSize: 12, opacity: 0.75 }}>
   153	                        {meta}
   154	                        {s.spaceUlid ? <span style={{ opacity: 0.7 }}> · {s.spaceUlid}</span> : null}
   155	                      </div>
   156	                    </div>
   157	                    <div style={{ fontSize: 18, opacity: 0.85 }}>→</div>
   158	                  </a>
   159	                )
   160	              })}
   161	            </div>
   162	          )}
   163	        </div>
   164	      </div>
   165	    </div>
   166	  )
   167	}
src/features/feeds/repo.ts:78:      p.ulid AS production_ulid
src/features/feeds/repo.ts:169:      p.ulid AS production_ulid
src/features/feeds/service.ts:24:      production_ulid: row.production_ulid ? String(row.production_ulid) : null,
src/features/feeds/service.ts:105:      production_ulid: row.production_ulid ? String(row.production_ulid) : null,
   396	spacesRouter.get('/api/spaces/:id/feed', requireAuth, async (req, res, next) => {
   397	  try {
   398	    const spaceId = Number(req.params.id)
   399	    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).json({ error: 'bad_space_id' })
   400	    const userId = Number(req.user!.id)
   401	    await spacesSvc.assertCanViewSpaceFeed(spaceId, userId)
   402	    const limitRaw = Number(req.query.limit ?? 20)
   403	    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20
   404	    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
   405	    const data = await feedsSvc.getSpaceFeed(spaceId, { userId, limit, cursor })
   406	    res.json(data)
   407	  } catch (err: any) {
   408	    // Preserve legacy error code shape while using centralized error middleware
   409	    if (err instanceof DomainError) return next(err)
   410	    return next(new DomainError(String(err?.message || err), 'failed_to_load_feed', 500))

### 2025-12-29T21:56:11+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/feed/global?limit=1`
- Status: `200`
```
{"items":[{"publication":{"id":148,"upload_id":45,"production_id":57,"production_ulid":"01KD6EJPP0BJRB3MB91GW0G497","space_id":29,"likes_count":0,"comments_count":0,"liked_by_me":false,"commented_by_me":false,"reported_by_me":true,"status":"published","requested_by":1,"approved_by":1,"is_primary":false,"visibility":"inherit","distribution_flags":null,"published_at":"2025-12-23 20:32:59","unpublished_at":null,"created_at":"2025-12-23 20:32:59","updated_at":"2025-12-23 20:32:59"},"upload":{"id":45,"s3_bucket":"bacs-mc-uploads","s3_key":"2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/video.mp4","original_filename":"6370356_Drone Forest Trees Vertical Format_By_Animedias_Artlist_Vertical_HD.mp4","modified_filename":"Drone Forest Trees","description":null,"content_type":"video/mp4","size_bytes":35820760,"width":1080,"height":1920,"duration_seconds":28,"status":"completed","etag":"bb46b200af60a71a86838edf2086a8f3","mediaconvert_job_id":"1766521920359-55q10t","output_prefix":"2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/","asset_uuid":"97cbfde0-3ea7-4aea-a282-fd4051a6f034","date_ymd":"2025-12-23","profile":null,"orientation":"portrait","created_at":"2025-12-23 20:31:28","uploaded_at":"2025-12-23 20:31:33","user_id":1,"space_id":1,"origin_space_id":1,"cdn_prefix":"https://videos.bawebtech.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/","cdn_master":"https://videos.bawebtech.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video.m3u8","poster_cdn":"https://videos.bawebtech.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video_poster.0000000.jpg","poster_portrait_cdn":"https://videos.bawebtech.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video_poster.0000000.jpg","s3_master":"https://bacs-mc-public-stream.s3.us-west-1.amazonaws.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video.m3u8","poster_s3":"https://bacs-mc-public-stream.s3.us-west-1.amazonaws.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video_poster.0000000.jpg","poster_portrait_s3":"https://bacs-mc-public-stream.s3.us-west-1.amazonaws.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video_poster.0000000.jpg"},"owner":{"id":1,"displayName":"Admin","email":"michael@bayareacreativeservices.com","avatarUrl":"https://videos.bawebtech.com/profiles/avatars/1/2025-12/6e9b1ad8-e01d-44c9-be4b-f64a28b921ac.png"}}],"nextCursor":"2025-12-23 20:32:59|148"}
```

### 2025-12-29T21:56:13+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/spaces/16/feed?limit=1`
- Status: `200`
```
{"items":[{"publication":{"id":146,"upload_id":45,"production_id":57,"production_ulid":"01KD6EJPP0BJRB3MB91GW0G497","space_id":16,"likes_count":0,"comments_count":0,"liked_by_me":false,"commented_by_me":false,"reported_by_me":false,"status":"published","requested_by":1,"approved_by":1,"is_primary":false,"visibility":"inherit","distribution_flags":null,"published_at":"2025-12-23 20:32:59","unpublished_at":null,"created_at":"2025-12-23 20:32:59","updated_at":"2025-12-23 20:32:59"},"upload":{"id":45,"s3_bucket":"bacs-mc-uploads","s3_key":"2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/video.mp4","original_filename":"6370356_Drone Forest Trees Vertical Format_By_Animedias_Artlist_Vertical_HD.mp4","modified_filename":"Drone Forest Trees","description":null,"content_type":"video/mp4","size_bytes":35820760,"width":1080,"height":1920,"duration_seconds":28,"status":"completed","etag":"bb46b200af60a71a86838edf2086a8f3","mediaconvert_job_id":"1766521920359-55q10t","output_prefix":"2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/","asset_uuid":"97cbfde0-3ea7-4aea-a282-fd4051a6f034","date_ymd":"2025-12-23","profile":null,"orientation":"portrait","created_at":"2025-12-23 20:31:28","uploaded_at":"2025-12-23 20:31:33","user_id":1,"space_id":1,"origin_space_id":1,"cdn_prefix":"https://videos.bawebtech.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/","cdn_master":"https://videos.bawebtech.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video.m3u8","poster_cdn":"https://videos.bawebtech.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video_poster.0000000.jpg","poster_portrait_cdn":"https://videos.bawebtech.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video_poster.0000000.jpg","s3_master":"https://bacs-mc-public-stream.s3.us-west-1.amazonaws.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video.m3u8","poster_s3":"https://bacs-mc-public-stream.s3.us-west-1.amazonaws.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video_poster.0000000.jpg","poster_portrait_s3":"https://bacs-mc-public-stream.s3.us-west-1.amazonaws.com/2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/01KD6EJPP0BJRB3MB91GW0G497/portrait/video_poster.0000000.jpg"},"owner":{"id":1,"displayName":"Admin","email":"michael@bayareacreativeservices.com","avatarUrl":"https://videos.bawebtech.com/profiles/avatars/1/2025-12/6e9b1ad8-e01d-44c9-be4b-f64a28b921ac.png"}}],"nextCursor":"2025-12-23 20:32:59|146"}
```
