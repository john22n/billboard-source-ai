import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IssueReportResponse } from '@/lib/issue-report-schema'
import {
  clearPersistedIssueReport,
  ISSUE_REPORT_RESULT_CLEARED_EVENT,
  loadPersistedIssueReport,
  persistIssueReport,
} from './issue-report-storage'

const report: IssueReportResponse = {
  reportId: 'ISS-12345678',
  diagnosis: {
    severity: 'medium',
    summary: 'The worker was unavailable when the call arrived.',
    evidence: [],
    missingData: [],
    needsAmpEscalation: false,
    escalationReason: null,
    twilioCallInfoRequested: false,
    twilioCallContext: null,
  },
  unavailableSources: [],
  ampEscalated: false,
}

function installBrowserStorage() {
  const values = new Map<string, string>()
  const dispatchEvent = vi.fn()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    dispatchEvent,
  })
  return { dispatchEvent, values }
}

describe('issue report browser persistence', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('restores a finding for the same employee account', () => {
    installBrowserStorage()

    persistIssueReport(' User@Example.com ', report)

    expect(loadPersistedIssueReport('user@example.com')).toEqual(report)
  })

  it('does not expose a finding to another employee account', () => {
    const { values } = installBrowserStorage()
    persistIssueReport('first@example.com', report)

    expect(loadPersistedIssueReport('second@example.com')).toBeNull()
    expect(values.size).toBe(0)
  })

  it('clears storage and notifies a mounted issue page', () => {
    const { dispatchEvent, values } = installBrowserStorage()
    persistIssueReport('user@example.com', report)

    clearPersistedIssueReport()

    expect(values.size).toBe(0)
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: ISSUE_REPORT_RESULT_CLEARED_EVENT }),
    )
  })
})
