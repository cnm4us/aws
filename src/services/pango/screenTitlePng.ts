import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'

export type ScreenTitlePngInput = {
  text: string
  preset: any
  frame: { width: number; height: number }
}

export async function renderScreenTitlePngWithPango(opts: {
  input: ScreenTitlePngInput
  outPath: string
}): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-pango-screen-title-'))
  const inputPath = path.join(tmpDir, `input-${randomUUID()}.json`)
  try {
    fs.writeFileSync(inputPath, JSON.stringify(opts.input), 'utf8')
    await runPythonPangoRenderer(inputPath, opts.outPath)
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

async function runPythonPangoRenderer(inputJsonPath: string, outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'pango', 'render_screen_title_png.py')
    const args = ['-u', scriptPath, '--input-json', inputJsonPath, '--out', outPath]
    const p = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const maxStderr = 8000
    p.stderr.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-maxStderr)
    })
    p.on('error', (err) => reject(err))
    p.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`pango_renderer_failed:${code}:${stderr.slice(0, 800)}`))
    })
  })
}

