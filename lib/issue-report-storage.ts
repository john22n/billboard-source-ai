import type { IssueReportResponse } from '@/lib/issue-report-schema'

const ISSUE_REPORT_RESULT_STORAGE_KEY = 'reported-issue-result'
export const ISSUE_REPORT_RESULT_CLEARED_EVENT = 'reported-issue-result-cleared'

interface PersistedIssueReport {
  version: 1
  reporterEmail: string
  result: IssueReportResponse
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function loadPersistedIssueReport(
  reporterEmail: string,
): IssueReportResponse | null {
  if (typeof window === 'undefined') return null

  try {
    const value = window.sessionStorage.getItem(ISSUE_REPORT_RESULT_STORAGE_KEY)
    if (!value) return null

    const persisted = JSON.parse(value) as PersistedIssueReport
    if (
      persisted.version !== 1 ||
      normalizeEmail(persisted.reporterEmail) !==
        normalizeEmail(reporterEmail) ||
      !persisted.result
    ) {
      clearPersistedIssueReport()
      return null
    }

    return persisted.result
  } catch {
    clearPersistedIssueReport()
    return null
  }
}

export function persistIssueReport(
  reporterEmail: string,
  result: IssueReportResponse,
) {
  if (typeof window === 'undefined') return

  try {
    const persisted: PersistedIssueReport = {
      version: 1,
      reporterEmail: normalizeEmail(reporterEmail),
      result,
    }
    window.sessionStorage.setItem(
      ISSUE_REPORT_RESULT_STORAGE_KEY,
      JSON.stringify(persisted),
    )
  } catch {
    // The current result remains visible when browser storage is unavailable.
  }
}

export function clearPersistedIssueReport() {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.removeItem(ISSUE_REPORT_RESULT_STORAGE_KEY)
  } catch {
    // The reset event still clears any mounted issue page state.
  }

  window.dispatchEvent(new Event(ISSUE_REPORT_RESULT_CLEARED_EVENT))
}
