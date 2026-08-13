import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { WorkspaceDto } from '../../../shared/workspace'

type Props = {
  workspaces: WorkspaceDto[]
  error: string | null
  onCreate: (name: string) => Promise<void>
  onSelect: (uuid: string) => void
}

export function WorkspaceSidebar({
  workspaces,
  error,
  onCreate,
  onSelect
}: Props): React.JSX.Element {
  const [drafting, setDrafting] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await onCreate(name)
      setName('')
      setDrafting(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Workspaces</h2>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => {
            setDrafting(true)
          }}
        >
          New
        </Button>
      </div>
      {drafting ? (
        <form
          className="mb-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input
            autoFocus
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            placeholder="Name (optional)"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              Create
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDrafting(false)
                setName('')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      <ul className="flex flex-1 flex-col gap-1 overflow-auto">
        {workspaces.length === 0 ? (
          <li className="text-sm text-muted-foreground">No workspaces yet.</li>
        ) : (
          workspaces.map((workspace) => (
            <li key={workspace.uuid}>
              <button
                type="button"
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  workspace.current ? 'bg-muted font-medium' : 'hover:bg-muted/60'
                }`}
                onClick={() => onSelect(workspace.uuid)}
              >
                {workspace.name}
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  )
}
