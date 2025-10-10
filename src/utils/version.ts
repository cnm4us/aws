import { execSync } from 'child_process';

function safe(cmd: string): string | undefined {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return undefined;
  }
}

const commit = safe('git rev-parse --short=7 HEAD');
const commitDate = safe('git show -s --format=%cI HEAD');
const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
export const BUILD_TAG = `${commit || 'nocmt'}-${(commitDate || iso).replace(/[:]/g, '').replace(/\..+$/, 'Z')}`;

export function getVersionInfo() {
  return { buildTag: BUILD_TAG, commit: commit || null, commitDate: commitDate || null, now: new Date().toISOString() };
}

