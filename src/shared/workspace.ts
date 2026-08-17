export type WorkspaceDto = {
  uuid: string
  name: string
  current: boolean
}

export type BoxStatusDto = 'none' | 'starting' | 'running' | 'error'

export type AppStateDto = {
  workspaces: WorkspaceDto[]
  boxStatus: BoxStatusDto
  boxError?: string
  thread?: ThreadMessageDto[]
  folderError?: string
  files?: string[]
}

export type ThreadMessageDto = {
  role: 'user' | 'assistant'
  text: string
}

export type AddFilesResultDto = {
  copied: number
  total: number
  error?: string
}
