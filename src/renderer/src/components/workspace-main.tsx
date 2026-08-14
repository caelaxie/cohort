import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AppStateDto, BoxStatusDto } from '../../../shared/workspace'

type Props = {
  state: AppStateDto
  notice: string | null
  onAddFiles: () => void
  onDropFiles: (files: File[]) => void
}

function currentName(state: AppStateDto): string | null {
  return state.workspaces.find((item) => item.current)?.name ?? null
}

function sandboxLabel(status: BoxStatusDto): string | null {
  if (status === 'starting') return 'Sandbox starting'
  if (status === 'running') return 'Sandbox ready'
  if (status === 'error') return 'Sandbox error'
  return null
}

export function WorkspaceMain({
  state,
  notice,
  onAddFiles,
  onDropFiles
}: Props): React.JSX.Element {
  const name = currentName(state)
  const canAdd = Boolean(name)
  const [dragging, setDragging] = useState(false)
  const badge = sandboxLabel(state.boxStatus)

  return (
    <section
      className="flex min-w-0 flex-1 flex-col bg-canvas"
      onDragOver={(event) => {
        if (!canAdd) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        if (!canAdd) return
        event.preventDefault()
        setDragging(false)
        onDropFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-hairline px-6">
        <h1 className="font-display truncate text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
          {name ?? 'Cohort'}
        </h1>
        {badge ? (
          <span
            className={cn(
              'inline-flex h-5 shrink-0 items-center rounded-full bg-surface-2 px-2 text-xs leading-[1.4] text-ink-muted',
              state.boxStatus === 'running' && 'text-success',
              state.boxStatus === 'error' && 'text-danger'
            )}
          >
            {badge}
          </span>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        {name ? (
          <>
            <p className="max-w-[65ch] text-sm text-ink-subtle">
              Files you add land in this workspace.
            </p>
            <div
              className={cn(
                'flex max-w-xl flex-col items-start gap-4 rounded-xl border border-hairline bg-surface-1 p-6',
                'shadow-[inset_0_1px_0_0_color-mix(in_srgb,white_8%,transparent)]',
                'transition-[background-color,border-color] duration-150 ease-out',
                dragging && 'border-hairline-strong bg-surface-2'
              )}
            >
              <div className="flex flex-col gap-1">
                <p className="font-display text-xl font-normal tracking-[-0.2px] text-ink">
                  {dragging ? 'Drop files here' : 'Add files'}
                </p>
                <p className="text-sm text-ink-subtle">
                  Drop files onto this panel, or pick them from disk.
                </p>
              </div>
              <Button type="button" onClick={onAddFiles}>
                Add files
              </Button>
            </div>
          </>
        ) : (
          <div className="flex max-w-xl flex-col gap-2 rounded-xl border border-hairline bg-surface-1 p-6 shadow-[inset_0_1px_0_0_color-mix(in_srgb,white_8%,transparent)]">
            <p className="font-display text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
              Create a workspace
            </p>
            <p className="max-w-[65ch] text-sm text-ink-subtle">
              Use New in the sidebar. Files and the sandbox stay with the workspace you select.
            </p>
          </div>
        )}

        {state.boxStatus === 'error' && state.boxError ? (
          <p className="max-w-[65ch] text-sm text-danger" role="alert">
            {state.boxError}
          </p>
        ) : null}
        {state.folderError ? (
          <p className="max-w-[65ch] text-sm text-danger" role="alert">
            {state.folderError}
          </p>
        ) : null}
        {notice ? <p className="max-w-[65ch] text-sm text-ink-muted">{notice}</p> : null}
      </div>
    </section>
  )
}
