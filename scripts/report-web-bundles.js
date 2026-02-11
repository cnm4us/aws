#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

function safe(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function readAssets(assetsDir) {
  const entries = fs.readdirSync(assetsDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!/\.(js|css|svg|html)$/.test(name)) continue;
    const fullPath = path.join(assetsDir, name);
    const raw = fs.readFileSync(fullPath);
    const gzip = zlib.gzipSync(raw, { level: 9 });
    files.push({
      name,
      path: fullPath,
      rawBytes: raw.length,
      gzipBytes: gzip.length,
    });
  }
  return files.sort((a, b) => b.rawBytes - a.rawBytes);
}

function getOneByPrefix(files, prefix) {
  return files.find((f) => f.name.startsWith(prefix)) || null;
}

function parseArgs(argv) {
  const out = { append: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--append') {
      const next = argv[i + 1];
      out.append = next && !next.startsWith('--') ? next : 'agents/implementation/metrics/web-bundle-snapshots.jsonl';
      if (next && !next.startsWith('--')) i += 1;
      continue;
    }
  }
  return out;
}

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const assetsDir = path.resolve(repoRoot, 'public/app/assets');
  if (!fs.existsSync(assetsDir)) {
    console.error(`[web:bundle-snapshot] missing assets directory: ${assetsDir}`);
    console.error('Run `npm run web:build` first.');
    process.exit(1);
  }

  const files = readAssets(assetsDir);
  const jsFiles = files.filter((f) => f.name.endsWith('.js'));
  const cssFiles = files.filter((f) => f.name.endsWith('.css'));
  const jsRawTotal = jsFiles.reduce((sum, f) => sum + f.rawBytes, 0);
  const jsGzipTotal = jsFiles.reduce((sum, f) => sum + f.gzipBytes, 0);
  const cssRawTotal = cssFiles.reduce((sum, f) => sum + f.rawBytes, 0);
  const cssGzipTotal = cssFiles.reduce((sum, f) => sum + f.gzipBytes, 0);

  const createVideo = getOneByPrefix(files, 'CreateVideo-');
  const hlsVideo = getOneByPrefix(files, 'HLSVideo-');
  const index = getOneByPrefix(files, 'index-');

  const ts = new Date().toISOString();
  const commit = safe('git rev-parse --short=12 HEAD') || 'unknown';
  const branch = safe('git rev-parse --abbrev-ref HEAD') || 'unknown';

  console.log('[web:bundle-snapshot]');
  console.log(`timestamp: ${ts}`);
  console.log(`git: ${branch}@${commit}`);
  console.log(`assets dir: ${assetsDir}`);
  console.log('');
  console.log(`js total:   ${formatBytes(jsRawTotal)} raw | ${formatBytes(jsGzipTotal)} gzip`);
  console.log(`css total:  ${formatBytes(cssRawTotal)} raw | ${formatBytes(cssGzipTotal)} gzip`);
  console.log('');
  console.log('top assets (raw):');
  for (const f of files.slice(0, 12)) {
    const name = f.name.padEnd(40, ' ');
    console.log(`- ${name} ${formatBytes(f.rawBytes).padStart(10, ' ')} | ${formatBytes(f.gzipBytes).padStart(10, ' ')}`);
  }
  console.log('');
  if (createVideo) console.log(`CreateVideo: ${createVideo.name} (${formatBytes(createVideo.rawBytes)} raw | ${formatBytes(createVideo.gzipBytes)} gzip)`);
  if (hlsVideo) console.log(`HLSVideo:    ${hlsVideo.name} (${formatBytes(hlsVideo.rawBytes)} raw | ${formatBytes(hlsVideo.gzipBytes)} gzip)`);
  if (index) console.log(`Index:       ${index.name} (${formatBytes(index.rawBytes)} raw | ${formatBytes(index.gzipBytes)} gzip)`);

  if (args.append) {
    const outPath = path.resolve(repoRoot, args.append);
    ensureDir(outPath);
    const payload = {
      timestamp: ts,
      git: { branch, commit },
      totals: {
        jsRawBytes: jsRawTotal,
        jsGzipBytes: jsGzipTotal,
        cssRawBytes: cssRawTotal,
        cssGzipBytes: cssGzipTotal,
      },
      keyChunks: {
        createVideo: createVideo
          ? { name: createVideo.name, rawBytes: createVideo.rawBytes, gzipBytes: createVideo.gzipBytes }
          : null,
        hlsVideo: hlsVideo
          ? { name: hlsVideo.name, rawBytes: hlsVideo.rawBytes, gzipBytes: hlsVideo.gzipBytes }
          : null,
        index: index
          ? { name: index.name, rawBytes: index.rawBytes, gzipBytes: index.gzipBytes }
          : null,
      },
    };
    fs.appendFileSync(outPath, `${JSON.stringify(payload)}\n`, 'utf8');
    console.log('');
    console.log(`[web:bundle-snapshot] appended snapshot -> ${outPath}`);
  }
}

main();

