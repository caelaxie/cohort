import type { CohortApi } from '../shared/cohort'

declare global {
  interface Window {
    cohort: CohortApi
  }
}

export {}
