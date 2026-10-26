// Publication writers store UTC SQL DATETIME strings. The viewer boundary must
// supply an explicit instant rather than asking a phone to interpret SQL dates.
export function publicationTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || match[1].startsWith('0000')) return null;
  const base = `${match[1]}T${match[2]}`;
  const calendar = new Date(`${base}Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== base) return null;
  const zone = match[4] ?? 'Z';
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
    if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) return null;
  }
  const instant = new Date(`${base}.${(match[3] ?? '').padEnd(3, '0').slice(0, 3)}${zone}`);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}
