// U1 spike: prove the Prime SDK loads and creates an in-process session
// inside a live Electron main process — no CLI, no network prompt.
// Run: npx electron scripts/spike-prime.mjs ; exits 0 on success.
import { app } from 'electron'

const result = { loaded: false, session: false, error: null }

app.whenReady().then(async () => {
  try {
    const sdk = await import('@earendil-works/pi-coding-agent')
    result.loaded = true
    const { session } = await sdk.createAgentSession({
      cwd: app.getPath('temp'),
      sessionManager: sdk.SessionManager.inMemory()
    })
    result.session = true
    session.dispose()
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
  console.log(`PRIME_SPIKE_RESULT ${JSON.stringify(result)}`)
  app.exit(result.loaded && result.session ? 0 : 1)
})
