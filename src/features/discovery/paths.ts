/** Browser destinations only. Publication/API identities are unchanged. */
export function spacePath(space: { type: string; slug: string }, global = false): string {
  if (global || space.type === 'channel' && ['global', 'global-feed'].includes(space.slug)) return '/global';
  if (space.type === 'personal') return '/personal';
  return `/${space.type === 'group' ? 'groups' : 'channels'}/${encodeURIComponent(space.slug)}`;
}

export function canonicalViewerUrl(value: string): string | null {
  const url = new URL(value, 'https://viewer.invalid');
  const alias = /^\/(?:channels\/(?:global|global-feed)|global)\/$/.test(url.pathname)
    || /^\/channels\/(?:global|global-feed)$/.test(url.pathname);
  const intent = url.pathname === '/' && ['pin', 'publication_id', 't', 't_end'].some(key => {
    const raw = url.searchParams.get(key);
    if (!raw) return false;
    if (key === 'pin') return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(raw);
    return /^\d+(?:\.\d+)?$/.test(raw) && Number(raw) <= (key === 'publication_id' ? Number.MAX_SAFE_INTEGER : 86400 * 30)
      && (key !== 'publication_id' || (Number(raw) > 0 && Number.isInteger(Number(raw))));
  });
  return alias || intent ? `/global${url.search}${url.hash}` : null;
}
