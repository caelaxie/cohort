// Stage a workspace for the UI smoke: roster entry + per-workspace model pin.
import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

app.whenReady().then(async () => {
  const home = process.env.COHORT_HOME
  const { WorkspaceStore } = await import('../src/main/workspaces')
  const { primeWorkspaceAgentDir } = await import('../src/main/captain')
  const store = new WorkspaceStore(home)
  const a = store.create('Alpha')
  const b = store.create('Beta')
  for (const uuid of [a.workspace.uuid, b.workspace.uuid]) {
    const agentDir = primeWorkspaceAgentDir(home, uuid)
    mkdirSync(join(agentDir, 'sessions'), { recursive: true })
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ defaultProvider: 'zai-coding-cn', defaultModel: 'glm-5.2' })
    )
  }
  console.log(`STAGED ${a.workspace.uuid} ${b.workspace.uuid}`)
  store.close()
  app.exit(0)
})
