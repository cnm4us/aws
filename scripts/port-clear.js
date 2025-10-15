#!/usr/bin/env node
const { execSync } = require('child_process');

function getPort() {
  const envPort = Number(process.env.PORT || '');
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  return 3300; // default from src/config.ts
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

function uniqueNums(list) {
  const s = new Set();
  const out = [];
  for (const n of list) {
    if (!s.has(n)) { s.add(n); out.push(n); }
  }
  return out;
}

function parsePidsFromString(str) {
  return uniqueNums(
    String(str)
      .split(/\s+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 1 && n !== process.pid)
  );
}

function findPidsOnPort(port) {
  // Try lsof first
  let out = safeExec(`lsof -ti :${port}`);
  let pids = parsePidsFromString(out);
  if (pids.length) return pids;

  // Try fuser
  out = safeExec(`fuser -n tcp ${port}`);
  pids = parsePidsFromString(out);
  if (pids.length) return pids;

  // Try ss (Linux)
  out = safeExec(`ss -lptn '( sport = :${port} )' || ss -lptn | grep ':${port} '`);
  const pidMatches = Array.from(out.matchAll(/pid=(\d+)/g)).map((m) => parseInt(m[1], 10));
  pids = uniqueNums(pidMatches.filter((n) => Number.isFinite(n) && n > 1 && n !== process.pid));
  return pids;
}

function killPids(pids) {
  const killed = [];
  for (const pid of pids) {
    try {
      // Try graceful first
      process.kill(pid, 'SIGTERM');
      killed.push(pid);
    } catch {}
  }
  // Small wait
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  for (const pid of pids) {
    try {
      // If still alive, force kill
      process.kill(pid, 0);
      try { process.kill(pid, 'SIGKILL'); } catch {}
    } catch {}
  }
  return killed;
}

(function main() {
  const port = getPort();
  const pids = findPidsOnPort(port);
  if (!pids.length) {
    console.log(`[port-clear] No processes found on port ${port}.`);
    return;
  }
  console.log(`[port-clear] Clearing port ${port}. PIDs: ${pids.join(', ')}`);
  killPids(pids);
  console.log('[port-clear] Done.');
})();

