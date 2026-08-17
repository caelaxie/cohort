import type { AppStateDto, BoxStatusDto, ThreadMessageDto, WorkspaceDto } from '../shared/workspace'
import { listWorkspaceFiles } from './files'

export function buildAppState(input: {
  home: string
  workspaces: WorkspaceDto[]
  boxStatus: BoxStatusDto
  thread?: ThreadMessageDto[]
  boxError?: string
  folderError?: string
}): AppStateDto {
  const state: AppStateDto = {
    workspaces: input.workspaces,
    boxStatus: input.boxStatus,
    boxError: input.boxError,
    folderError: input.folderError
  }
  const currentUuid = input.workspaces.find((item) => item.current)?.uuid
  if (!currentUuid) {
    return state
  }
  if (input.thread) {
    state.thread = input.thread
  }
  if (input.folderError) {
    state.files = []
    return state
  }
  try {
    state.files = listWorkspaceFiles(input.home, currentUuid)
  } catch {
    state.files = []
  }
  return state
}
