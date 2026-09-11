import type { KernelStatus } from '../../../shared/kernel'
import { WorkingStatus } from './working-status'

type ComposerProps = {
  kernelStatus: KernelStatus
  draft: string
  busy: boolean
  canSend: boolean
  sendError: string | null
  showStop: boolean
  leading?: React.ReactNode
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
}

export function TalkComposer({
  kernelStatus,
  draft,
  busy,
  canSend,
  sendError,
  showStop,
  leading,
  onDraftChange,
  onSend,
  onStop
}: ComposerProps): React.JSX.Element {
  const message = (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-ink">
      Message
      <textarea
        value={draft}
        disabled={busy}
        className="min-h-16 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
        onChange={(event) => {
          onDraftChange(event.target.value)
        }}
      />
    </label>
  )

  return (
    <form
      className="shrink-0 border-t border-hairline px-6 py-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSend) return
        onSend()
      }}
    >
      {kernelStatus.kind === 'needs_login' ? (
        <p className="mb-3 text-sm text-ink-muted">Connect a model in Settings</p>
      ) : null}
      {leading ? (
        <div className="flex flex-wrap items-end gap-3">
          {leading}
          {message}
        </div>
      ) : (
        message
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
        >
          Send
        </button>
        {showStop ? <WorkingStatus onStop={onStop} /> : null}
      </div>
      {sendError ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {sendError}
        </p>
      ) : null}
    </form>
  )
}
