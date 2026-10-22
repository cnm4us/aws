// Public build identity only. No environment/credential file is ever hashed or uploaded.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stampPath = 'src/config/buildIdentity.json';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function identify(directory = root) {
  const files = [];
  const walk = relative => {
    const target = path.join(directory, relative), stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw Error('Build inputs must not be symbolic links');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target).sort()) walk(`${relative}/${name}`);
    } else if (stat.isFile() && relative !== stampPath) files.push(relative);
  };
  for (const name of fs.readdirSync(directory).sort()) {
    if (['.nvmrc', 'package.json', 'package-lock.json', 'app.json', 'eas.json', 'tsconfig.json', 'index.ts', 'App.tsx', 'src', 'assets'].includes(name)
      || /^(app|babel|metro|react-native)\.config\.[cm]?[jt]s$/.test(name)) walk(name);
  }
  walk('scripts/preview-build.cjs');
  files.sort();
  const inputs = files.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(directory, file))) }));
  const app = JSON.parse(fs.readFileSync(path.join(directory, 'app.json'))).expo;
  return { version: 1, appVersion: app.version, appBuild: app.ios.buildNumber,
    sourceId: hash(JSON.stringify(inputs)), inputs };
}

function run(action) {
  if (action === 'verify' && process.env.EAS_BUILD_PROFILE !== 'preview') return;
  if (!['prepare', 'verify', 'export', 'build'].includes(action)) throw Error('Use prepare, verify, export or build');
  const { inputs, ...identity } = identify();
  if (action === 'verify') {
    if (JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, stampPath)))) !== JSON.stringify(identity)) {
      throw Error('Preview source identity is stale. Run npm run prepare:preview before EAS upload.');
    }
  } else {
    fs.writeFileSync(path.join(root, stampPath), JSON.stringify(identity, null, 2) + '\n');
  }
  console.log(JSON.stringify({ ...identity, inputFiles: inputs.length }));
  if (action === 'build' || action === 'export') {
    const profile = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'))).build.preview;
    const args = action === 'build' ? ['eas-cli@25.2.0', 'build', '--platform', 'ios', '--profile', 'preview', ...process.argv.slice(3)]
      : ['expo', 'export', '--platform', 'ios', '--output-dir', process.env.VIEWER_EXPORT_DIR || '/dev/shm/plan171-ios-export'];
    const result = spawnSync('npx', args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...profile.env } });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}

if (require.main === module) {
  try { run(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { identify };
