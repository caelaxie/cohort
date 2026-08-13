import type { AddFilesResultDto, AppStateDto } from '../shared/workspace'

export interface CohortApi {
  list: () => Promise<AppStateDto>
  create: (name: string) => Promise<AppStateDto>
  setCurrent: (uuid: string) => Promise<AppStateDto>
  addFiles: (paths?: string[]) => Promise<AddFilesResultDto>
  pathsForFiles: (files: File[]) => string[]
  onState: (listener: (state: AppStateDto) => void) => () => void
}

declare global {
  interface Window {
    cohort: CohortApi
  }
}

export {}
