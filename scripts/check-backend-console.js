#!/usr/bin/env node
/* Guardrail: block introducing new console.* usage in backend runtime code.
 * Existing usage is temporarily allowlisted by per-file max count until migration completes.
 */
const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const SRC_DIR = path.join(ROOT, 'src')
const FILE_EXTS = new Set(['.ts', '.js'])
const CONSOLE_RE = /\bconsole\.(log|info|warn|error|debug|trace)\b/g

// Baseline inventory captured during Plan 109 Phase A.
// Policy: counts may go down; they may not increase, and new files may not introduce console.*.
const ALLOWED_MAX_BY_FILE = {
  'src/routes/pages.ts': 73,
  'src/routes/uploads.ts': 22,
  'src/server.ts': 14,
  'src/app.ts': 5,
  'src/tools/mediaconvert/describe-endpoints.ts': 4,
  'src/routes/admin.ts': 3,
  'src/tools/mediaconvert/create-job.ts': 2,
  'src/services/mediaJobs/worker.ts': 2,
  'src/routes/signing.ts': 2,
  'src/routes/publish-single.ts': 2,
  'src/routes/library.ts': 2,
  'src/index.ts': 2,
  'src/utils/requestLog.ts': 1,
  'src/routes/publish.ts': 1,
  'src/middleware/sessionParse.ts': 1,
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const ent of entries) {
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walk(abs, out)
      continue
    }
    const ext = path.extname(ent.name).toLowerCase()
    if (!FILE_EXTS.has(ext)) continue
    out.push(abs)
  }
  return out
}

function rel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

function countConsoleInFile(absPath) {
  const content = fs.readFileSync(absPath, 'utf8')
  let count = 0
  for (const _m of content.matchAll(CONSOLE_RE)) count += 1
  return count
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('[check:console:backend] missing src directory')
    process.exit(1)
  }

  const counts = {}
  for (const file of walk(SRC_DIR)) {
    const c = countConsoleInFile(file)
    if (c > 0) counts[rel(file)] = c
  }

  const violations = []

  for (const [file, count] of Object.entries(counts)) {
    const allowed = ALLOWED_MAX_BY_FILE[file]
    if (allowed == null) {
      violations.push(`${file}: ${count} (new file not in allowlist)`)
      continue
    }
    if (count > allowed) {
      violations.push(`${file}: ${count} > allowed ${allowed}`)
    }
  }

  if (violations.length) {
    console.error('[check:console:backend] failed: console.* usage exceeded policy')
    for (const v of violations) console.error(` - ${v}`)
    console.error('Use src/lib/logger (Pino) for new backend logging.')
    process.exit(1)
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`[check:console:backend] ok. files=${Object.keys(counts).length} total=${total}`)
}

main()

