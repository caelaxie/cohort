import { useEffect, useState } from 'react'
import { WorkspaceSidebar } from '@/components/workspace-sidebar'
import { WorkspaceMain } from '@/components/workspace-main'
import { WorkspaceFilesSidebar } from '@/components/workspace-files-sidebar'
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

  const [sending, setSending] = useState(false)
  const send = async (text: string): Promise<void> => {
    const current = state.workspaces.find((item) => item.current)
    if (!current) return
    setSending(true)
    try {
      setState(await window.cohort.send(current.uuid, text))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reach the captain')
    } finally {
      setSending(false)
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
        key={state.workspaces.find((item) => item.current)?.uuid ?? 'empty'}
        state={state}
        notice={notice}
        sending={sending}
        onSend={(text) => {
          void send(text)
        }}
        onAddFiles={() => {
          void addFromPicker()
        }}
        onDropFiles={(files) => {
          void addFromDrop(files)
        }}
      />
      {state.files != null ? <WorkspaceFilesSidebar files={state.files} /> : null}
    </div>
  )
}

export default App
