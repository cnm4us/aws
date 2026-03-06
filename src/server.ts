import 'dotenv/config'
import { getLogger, logError } from './lib/logger'
import { initObservability } from './lib/observability'

const bootstrapLogger = getLogger({ component: 'server.bootstrap' })

async function bootstrap() {
  try {
    await initObservability()
    await import('./server-main')
  } catch (err) {
    logError(bootstrapLogger, err, 'server_bootstrap_failed')
    process.exit(1)
  }
}

void bootstrap()

