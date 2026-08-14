import { useEffect, useState } from 'react'
import { WorkspaceSidebar } from '@/components/workspace-sidebar'
import { WorkspaceMain } from '@/components/workspace-main'
import { formatAddNotice } from '@/lib/notice'
import type { AppStateDto } from '../../shared/workspace'

const emptyState: AppStateDto = {
  workspaces: [],
  boxStatus: 'none'
}

function App(): React.JSX.Element {
  const [state, setState] = useState<AppStateDto>(emptyState)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(() =>
    window.cohort ? null : 'The app bridge is missing. Restart Cohort.'
  )

  useEffect(() => {
    if (!window.cohort) return
    void window.cohort
      .list()
      .then((next) => {
        setState(next)
        setError(null)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not load workspaces')
      })
    return window.cohort.onState(setState)
  }, [])

  const create = async (name: string): Promise<void> => {
    try {
      setState(await window.cohort.create(name))
      setError(null)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not create workspace'
      setError(message)
      throw reason
    }
  }

  const addFromPicker = async (): Promise<void> => {
    try {
      const result = await window.cohort.addFiles()
      setNotice(formatAddNotice(result))
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Could not add files')
    }
  }

  const addFromDrop = async (files: File[]): Promise<void> => {
    try {
      const paths = window.cohort.pathsForFiles(files)
      const result = await window.cohort.addFiles(paths)
      setNotice(formatAddNotice(result))
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Could not add files')
    }
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas text-ink">
      <WorkspaceSidebar
        workspaces={state.workspaces}
        error={error}
        onCreate={create}
        onSelect={(uuid) => {
          void window.cohort
            .setCurrent(uuid)
            .then((next) => {
              setState(next)
              setError(null)
            })
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : 'Could not switch workspace')
            })
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
