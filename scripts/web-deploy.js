#!/usr/bin/env node
const { execSync } = require('child_process');
function safe(cmd){ try{ return execSync(cmd,{stdio:['ignore','pipe','ignore']}).toString().trim(); }catch{ return ''; } }
const commit = safe('git rev-parse --short=7 HEAD') || 'nocmt';
const cdate = safe('git show -s --format=%cI HEAD');
const iso = new Date().toISOString().replace(/\..+$/, 'Z');
const ts = (cdate || iso).replace(/[:]/g,'');
const tag = `${commit}-${ts}`;

const mode = process.argv[2] || 'root';
const env = process.env;
const base = env.APP_BASE_URL || `http://localhost:${env.PORT||3300}`;

if (mode === 'scoped') {
  const url = `${base.replace(/\/$/,'')}/exp/${tag}/`;
  console.log('Scoped deploy ready at:');
  console.log(url);
  process.exit(0);
} else {
  console.log('Root deploy URL:');
  console.log(base);
  process.exit(0);
}

