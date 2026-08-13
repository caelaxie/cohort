import { Button } from '@/components/ui/button'
import type { WorkspaceDto } from '../../../shared/workspace'

type Props = {
  workspaces: WorkspaceDto[]
  onCreate: () => void
  onSelect: (uuid: string) => void
}

export function WorkspaceSidebar({ workspaces, onCreate, onSelect }: Props): React.JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Workspaces</h2>
        <Button type="button" size="sm" onClick={onCreate}>
          New
        </Button>
      </div>
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
