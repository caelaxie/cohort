import type { AddFilesResultDto } from '../../../shared/workspace'

export function formatAddNotice(result: AddFilesResultDto): string {
  if (result.error && result.copied === 0) return result.error
  if (result.total === 0) return 'No files added.'
  if (result.copied === result.total)
    return `Added ${result.copied} file${result.copied === 1 ? '' : 's'}.`
  return `Added ${result.copied} of ${result.total} files.`
}
