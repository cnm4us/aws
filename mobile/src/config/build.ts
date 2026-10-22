import stamp from './buildIdentity.json';
import { readBuildPolicy, sanitizeBuildIdentity } from './buildPolicy';

// Expo substitutes these public constants in the embedded bundle.
export const viewerBuildPolicy = readBuildPolicy(__DEV__,
  process.env.EXPO_PUBLIC_VIEWER_BUILD_KIND, process.env.EXPO_PUBLIC_VIEWER_DIAGNOSTICS);
// A Metro bundle may be running inside an older native development binary.
// Only the verified embedded preview can claim the prepared native build stamp.
export const viewerBuildIdentity = sanitizeBuildIdentity({
  ...(viewerBuildPolicy.kind === 'internal-preview' ? stamp : {}), ...viewerBuildPolicy,
})!;
