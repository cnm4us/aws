// Native responses require a zone. Only the legacy adapter opts into the SQL
// UTC convention used by publication writers; never parse bare SQL as local.
export function publicationTime(value: unknown, allowSql = false): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !match[4] && !allowSql || match[1].startsWith('0000')) return null;
  const base = `${match[1]}T${match[2]}`, calendar = new Date(`${base}Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== base) return null;
  const zone = match[4] ?? 'Z';
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
    if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) return null;
  }
  const instant = new Date(`${base}.${(match[3] ?? '').padEnd(3, '0').slice(0, 3)}${zone}`);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

export function formatPublicationTime(value: unknown, options: { locale?: string; timeZone?: string } = {}): string {
  const instant = publicationTime(value);
  if (instant) {
    try {
      return new Intl.DateTimeFormat(options.locale, { year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', ...(options.timeZone ? { timeZone: options.timeZone } : {}) }).format(new Date(instant));
    } catch { /* Invalid/missing runtime formatting support must not break video. */ }
  }
  return 'Publishing time unavailable';
}
