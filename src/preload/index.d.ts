import type { CohortApi } from '../shared/roster'

declare global {
  interface Window {
    cohort: CohortApi
  }
}

export {}
