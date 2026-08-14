import type { AppStateDto, BoxStatusDto, WorkspaceDto } from '../shared/workspace'
import { listWorkspaceFiles } from './files'

export function buildAppState(input: {
  home: string
  workspaces: WorkspaceDto[]
  currentUuid: string | null
  boxStatus: BoxStatusDto
  boxError?: string
  folderError?: string
}): AppStateDto {
  const state: AppStateDto = {
    workspaces: input.workspaces,
    boxStatus: input.boxStatus,
    boxError: input.boxError,
    folderError: input.folderError
  }
  if (!input.currentUuid) {
    return state
  }
  if (input.folderError) {
    state.files = []
    return state
  }
  try {
    state.files = listWorkspaceFiles(input.home, input.currentUuid)
  } catch {
    state.files = []
  }
  return state
}
