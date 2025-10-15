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

const assetsDir = path.resolve(__dirname, '../public/app/assets');
try {
  rmrfContents(assetsDir);
  // Ensure directory exists for build output
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  console.log(`[web:clean] cleaned ${assetsDir}`);
} catch (e) {
  console.error('[web:clean] failed', e);
  process.exit(1);
}

