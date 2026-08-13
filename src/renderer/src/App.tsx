import { useEffect, useState } from 'react'
import { WorkspaceSidebar } from '@/components/workspace-sidebar'
import { formatAddNotice, WorkspaceMain } from '@/components/workspace-main'
import type { AppStateDto } from '../../shared/workspace'

const emptyState: AppStateDto = {
  workspaces: [],
  boxStatus: 'none'
}

function App(): React.JSX.Element {
  const [state, setState] = useState<AppStateDto>(emptyState)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void window.cohort.list().then(setState)
    return window.cohort.onState(setState)
  }, [])

  const create = async (): Promise<void> => {
    const name = window.prompt('Workspace name', '') ?? ''
    setState(await window.cohort.create(name))
  }

  const addFromPicker = async (): Promise<void> => {
    const result = await window.cohort.addFiles()
    setNotice(formatAddNotice(result))
  }

  const addFromDrop = async (files: File[]): Promise<void> => {
    const paths = window.cohort.pathsForFiles(files)
    const result = await window.cohort.addFiles(paths)
    setNotice(formatAddNotice(result))
  }

  return (
    <div className="flex min-h-screen">
      <WorkspaceSidebar
        workspaces={state.workspaces}
        onCreate={() => {
          void create()
        }}
        onSelect={(uuid) => {
          void window.cohort.setCurrent(uuid).then(setState)
        }}
      />
      <WorkspaceMain
        state={state}
        notice={notice}
        onAddFiles={() => {
          void addFromPicker()
        }}
        onDropFiles={(files) => {
          void addFromDrop(files)
        }}
      />
    </div>
  )
}

export default App
