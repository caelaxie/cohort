import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type {
  AppStateDto,
  BoxStatusDto,
  ThreadMessageDto,
  WorkspaceDto
} from '../../../shared/workspace'

type Props = {
  state: AppStateDto
  notice: string | null
  sending: boolean
  onSend: (text: string) => void
  onAddFiles: () => void
  onDropFiles: (files: File[]) => void
}

function currentWorkspace(state: AppStateDto): WorkspaceDto | null {
  return state.workspaces.find((item) => item.current) ?? null
}

function sandboxLabel(status: BoxStatusDto): string | null {
  if (status === 'starting') return 'Sandbox starting'
  if (status === 'running') return 'Sandbox ready'
  if (status === 'error') return 'Sandbox error'
  return null
}

function ThreadMessageView({ message }: { message: ThreadMessageDto }): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="flex max-w-[75ch] flex-col items-end self-end">
        <p className="text-xs text-ink-tertiary">You</p>
        <p className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink">
          {message.text}
        </p>
      </div>
    )
  }
  return (
    <div className="flex max-w-[75ch] flex-col items-start">
      <p className="text-xs text-ink-tertiary">Captain</p>
      <p
        className={cn(
          'text-sm text-ink-muted',
          message.text.length === 0 && 'text-ink-tertiary italic'
        )}
      >
        {message.text.length === 0 ? 'thinking…' : message.text}
      </p>
    </div>
  )
}

export function WorkspaceMain({
  state,
  notice,
  sending,
  onSend,
  onAddFiles,
  onDropFiles
}: Props): React.JSX.Element {
  const current = currentWorkspace(state)
  const name = current?.name ?? null
  const uuid = current?.uuid ?? null
  const canAdd = Boolean(name)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState('')
  const badge = sandboxLabel(state.boxStatus)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [state.thread])

  const submit = (): void => {
    const text = draft.trim()
    if (!text || !uuid || sending) return
    onSend(text)
    setDraft('')
  }

  return (
    <section
      className={cn('flex min-w-0 flex-1 flex-col bg-canvas', dragging && 'bg-surface-1')}
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
        <div className="flex shrink-0 items-center gap-2">
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
          {canAdd ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={onAddFiles}
            >
              Add files
            </Button>
          ) : null}
        </div>
      </header>

      {name ? (
        <>
          <div ref={threadRef} className="flex flex-1 flex-col gap-4 overflow-auto p-6">
            {state.thread && state.thread.length > 0 ? (
              state.thread.map((message, index) => (
                <ThreadMessageView key={index} message={message} />
              ))
            ) : state.threadError ? (
              <p className="max-w-[65ch] text-sm text-danger" role="alert">
                {state.threadError}
              </p>
            ) : (
              <p className="max-w-[65ch] text-sm text-ink-subtle">
                Talk to this workspace&apos;s captain. It can read and change the files here.
              </p>
            )}
          </div>
          <footer className="shrink-0 border-t border-hairline p-4">
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                placeholder={sending ? 'Captain is working…' : 'Message the captain'}
                disabled={sending}
                onChange={(event) => {
                  setDraft(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <Button type="button" onClick={submit} disabled={!draft.trim() || sending}>
                Send
              </Button>
            </div>
          </footer>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-start justify-center gap-2 p-6">
          <div className="flex max-w-xl flex-col gap-2 rounded-xl border border-hairline bg-surface-1 p-6 shadow-[inset_0_1px_0_0_color-mix(in_srgb,white_8%,transparent)]">
            <p className="font-display text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
              Create a workspace
            </p>
            <p className="max-w-[65ch] text-sm text-ink-subtle">
              Use New in the sidebar. Files and the sandbox stay with the workspace you select.
            </p>
          </div>
        </div>
      )}

      {state.boxStatus === 'error' && state.boxError ? (
        <p className="max-w-[65ch] px-6 pb-2 text-sm text-danger" role="alert">
          {state.boxError}
        </p>
      ) : null}
      {state.folderError ? (
        <p className="max-w-[65ch] px-6 pb-2 text-sm text-danger" role="alert">
          {state.folderError}
        </p>
      ) : null}
      {notice ? <p className="max-w-[65ch] px-6 pb-2 text-sm text-ink-muted">{notice}</p> : null}
    </section>
  )
}
