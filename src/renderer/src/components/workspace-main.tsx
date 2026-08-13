import { Button } from '@/components/ui/button'
import type { AddFilesResultDto, AppStateDto } from '../../../shared/workspace'

type Props = {
  state: AppStateDto
  notice: string | null
  onAddFiles: () => void
  onDropFiles: (files: File[]) => void
}

function currentName(state: AppStateDto): string | null {
  return state.workspaces.find((item) => item.current)?.name ?? null
}

export function WorkspaceMain({ state, notice, onAddFiles, onDropFiles }: Props): React.JSX.Element {
  const name = currentName(state)
  const canAdd = Boolean(name)

  return (
    <section
      className="flex flex-1 flex-col gap-3 p-6"
      onDragOver={(event) => {
        if (!canAdd) return
        event.preventDefault()
      }}
      onDrop={(event) => {
        if (!canAdd) return
        event.preventDefault()
        onDropFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {name ? (
        <>
          <h1 className="text-xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">Files you add land in this workspace.</p>
          <Button type="button" onClick={onAddFiles}>
            Add files
          </Button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Cohort</h1>
          <p className="text-sm text-muted-foreground">Create a workspace to get started.</p>
        </>
      )}
      {state.boxStatus === 'starting' ? (
        <p className="text-sm text-muted-foreground">Starting sandbox…</p>
      ) : null}
      {state.boxStatus === 'error' && state.boxError ? (
        <p className="text-sm text-red-600">{state.boxError}</p>
      ) : null}
      {state.folderError ? <p className="text-sm text-red-600">{state.folderError}</p> : null}
      {notice ? <p className="text-sm">{notice}</p> : null}
    </section>
  )
}

export function formatAddNotice(result: AddFilesResultDto): string {
  if (result.error && result.copied === 0) return result.error
  if (result.total === 0) return 'No files added.'
  if (result.copied === result.total) return `Added ${result.copied} file${result.copied === 1 ? '' : 's'}.`
  return `Added ${result.copied} of ${result.total} files.`
}
