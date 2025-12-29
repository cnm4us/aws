#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function rmrfContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}

const assetsDir = path.resolve(__dirname, '../public/space-app/assets');
try {
  rmrfContents(assetsDir);
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  console.log(`[space:web:clean] cleaned ${assetsDir}`);
} catch (e) {
  console.error('[space:web:clean] failed', e);
  process.exit(1);
}

