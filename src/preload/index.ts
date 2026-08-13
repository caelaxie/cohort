import { contextBridge } from 'electron'

const cohort = {
  listWorkspaces: async (): Promise<never[]> => []
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must stay enabled')
}

contextBridge.exposeInMainWorld('cohort', cohort)
