export interface CohortApi {
  listWorkspaces: () => Promise<never[]>
}

declare global {
  interface Window {
    cohort: CohortApi
  }
}

export {}
