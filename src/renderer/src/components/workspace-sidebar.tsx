import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
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
  const nameId = useId()
  const [drafting, setDrafting] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const closeDraft = (): void => {
    setDrafting(false)
    setName('')
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await onCreate(name)
      closeDraft()
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex w-[244px] shrink-0 flex-col border-r border-hairline bg-surface-1">
      <div className="flex h-14 items-center px-3">
        <p className="font-display text-sm font-medium tracking-[-0.05px] text-ink">Cohort</p>
      </div>

      <div className="flex items-center justify-between px-3 pb-2">
        <h2 className="text-[13px] font-medium tracking-[0.4px] text-ink-subtle">Workspaces</h2>
        <Button
          type="button"
          size="sm"
          variant="secondary"
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
          className="flex flex-col gap-2 px-3 pb-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="flex flex-col gap-1.5" htmlFor={nameId}>
            <span className="text-[13px] font-medium tracking-[0.4px] text-ink-subtle">Name</span>
            <Input
              id={nameId}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Optional"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeDraft()
                }
              }}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={closeDraft}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="px-3 pb-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-1 flex-col gap-0.5 overflow-auto px-2 pb-3">
        {workspaces.length === 0 ? (
          <li className="px-1 pt-4 text-sm text-ink-subtle">
            <p className="font-medium text-ink-muted">No workspaces</p>
            <p className="mt-1 text-[13px] leading-[1.4]">Create a workspace to start.</p>
          </li>
        ) : (
          workspaces.map((workspace) => (
            <li key={workspace.uuid}>
              <button
                type="button"
                aria-current={workspace.current ? 'page' : undefined}
                className={cn(
                  'flex min-h-8 w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-ink-muted',
                  'transition-[background-color,color] duration-150 ease-out',
                  'hover:bg-surface-2 hover:text-ink',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                  'focus-visible:outline-[color-mix(in_srgb,var(--color-primary-focus)_50%,transparent)]',
                  workspace.current && 'bg-surface-2 text-ink'
                )}
                onClick={() => onSelect(workspace.uuid)}
              >
                <span className="truncate">{workspace.name}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  )
}
