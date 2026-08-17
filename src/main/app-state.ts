import type { AppStateDto, BoxStatusDto, ThreadMessageDto, WorkspaceDto } from '../shared/workspace'
import { listWorkspaceFiles } from './files'

export function buildAppState(input: {
  home: string
  workspaces: WorkspaceDto[]
  boxStatus: BoxStatusDto
  thread?: ThreadMessageDto[]
  /** Precomputed name list; when absent it is listed and reported via onFilesListed. */
  files?: string[]
  boxError?: string
  folderError?: string
  onFilesListed?: (files: string[]) => void
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
  if (input.files) {
    state.files = input.files
    return state
  }
  try {
    state.files = listWorkspaceFiles(input.home, currentUuid)
    input.onFilesListed?.(state.files)
  } catch {
    state.files = []
  }
  return state
}
