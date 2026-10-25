const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
export function validateDiscoveryDescription(value: unknown): string | null {
  if (value !== null && (typeof value !== 'string' || value.length > 500)) {
    throw Object.assign(new Error('bad_discovery_description'), { code: 'bad_discovery_description', status: 400 });
  }
  return typeof value === 'string' ? clean(value) || null : null;
}
export function discoveryDescription(settings: unknown): string | null {
  const parsed = typeof settings === 'string' ? JSON.parse(settings) : settings;
  const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).discoveryDescription : null;
  return typeof value === 'string' ? clean(value).slice(0, 500) || null : null;
}
