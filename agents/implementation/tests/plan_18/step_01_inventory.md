# Plan 18 — Step 1 Inventory

Date: 2025-12-29

## Commands + Output

### Locate Like/Comment rendering

```bash
rg -n "Like|Comment|likesCount|commentsCount|onLike|onComment" frontend/src/app/Feed.tsx -S
```

Output (excerpt):
```
1625:              {/* Avatar, Like, and Comment controls (right side) */}
1705:                      aria-label={likedMap[it.publicationId] ? 'Unlike' : 'Like'}
1707:                      onClick={(e) => { e.stopPropagation(); ensureLikeSummary(it.publicationId); toggleLike(it.publicationId) }}
1745:                    {/* Comment icon */}
1747:                      aria-label={'Comments'}
1748:                      onClick={(e) => { e.stopPropagation(); ensureCommentCountHydrated(it.publicationId, it.commentsCount ?? null); openComments(it.publicationId) }}
1781:                      {commentsCountMap[it.publicationId] != null ? commentsCountMap[it.publicationId] : (typeof it.commentsCount === 'number' ? it.commentsCount : 0)}
```

### Action cluster snippet (line-numbered)

```bash
nl -ba frontend/src/app/Feed.tsx | sed -n '1625,1820p'
```

Key section:
- The right-side action column renders when `it.publicationId != null`.
- Like action block starts at `Feed.tsx:1703`.
- Comment action block starts at `Feed.tsx:1744`.
- Report/Flag action block starts at `Feed.tsx:1784`.

Like block (full):

```bash
nl -ba frontend/src/app/Feed.tsx | sed -n '1703,1743p'
```

### How “Global Feed active” is detected

- `feedMode` state is initialized to global:

```bash
rg -n "const \[feedMode, setFeedMode\]" frontend/src/app/Feed.tsx -S
```

Output:
```
223:  const [feedMode, setFeedMode] = useState<FeedMode>({ kind: 'global' })
```

- Fetch/load branches explicitly on `feedMode.kind === 'global'`:

```bash
nl -ba frontend/src/app/Feed.tsx | sed -n '900,930p'
```

Output (excerpt):
```
925        } else if (feedMode.kind === 'global') {
926          const { items: page, nextCursor: cursorStr } = await fetchGlobalFeed()
```

- Switching back to global uses `handleSelectGlobal()`:

```bash
nl -ba frontend/src/app/Feed.tsx | sed -n '2031,2060p'
```

Output (excerpt):
```
2058    setFeedMode({ kind: 'global' })
```

## Implementation Notes (for Step 4)

- The correct insertion point to remove Like/Comment and add Jump is the right-side action column (`frontend/src/app/Feed.tsx` around `1625+`).
- We should keep the avatar and Report/Flag button in place, and replace the Like + Comment blocks with a single Jump block when `feedMode.kind === 'global'`.
- There is also a `useEffect` that eagerly calls `ensureLikeSummary()` on index changes when authed (currently for all feed modes); once Like UI is removed on global, we may want to gate that effect on `feedMode.kind !== 'global'` to reduce needless calls.
