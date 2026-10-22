export type ViewerBuildKind = 'development' | 'internal-preview' | 'release';
export type ViewerBuildIdentity = {
  kind: ViewerBuildKind;
  appVersion?: string;
  appBuild?: string;
  sourceId?: string;
  diagnostics: boolean;
};

export function readBuildPolicy(development: boolean, kind?: string, flag?: string) {
  const buildKind: ViewerBuildKind = development ? 'development' : kind === 'internal-preview' ? kind : 'release';
  return { kind: buildKind, diagnostics: development || (buildKind === 'internal-preview' && flag === '1') };
}

// Copy only public, bounded identity fields. Never spread arbitrary config into a report.
export function sanitizeBuildIdentity(raw: unknown): ViewerBuildIdentity | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as Record<string, unknown>;
  if (!['development', 'internal-preview', 'release'].includes(String(value.kind)) || typeof value.diagnostics !== 'boolean') return;
  const identity: ViewerBuildIdentity = { kind: value.kind as ViewerBuildKind, diagnostics: value.diagnostics };
  if (typeof value.appVersion === 'string' && /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(value.appVersion)) identity.appVersion = value.appVersion;
  if (typeof value.appBuild === 'string' && /^\d{1,10}(?:\.\d{1,10}){0,2}$/.test(value.appBuild)) identity.appBuild = value.appBuild;
  if (typeof value.sourceId === 'string' && /^[a-f0-9]{64}$/.test(value.sourceId)) identity.sourceId = value.sourceId;
  return identity;
}
