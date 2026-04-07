export const RESOLVED_RESOLUTION_CODES = [
  { code: 'violation_content_removed', label: 'Violation Confirmed — Content Removed' },
  { code: 'violation_content_hidden', label: 'Violation Confirmed — Content Hidden' },
  { code: 'violation_visibility_restricted', label: 'Violation Confirmed — Visibility Restricted' },
  { code: 'violation_warning_issued', label: 'Violation Confirmed — Warning Issued' },
  { code: 'violation_temp_suspension', label: 'Violation Confirmed — Temporary Suspension' },
  { code: 'violation_perm_suspension', label: 'Violation Confirmed — Permanent Suspension' },
  { code: 'violation_comment_removed', label: 'Violation Confirmed — Comment Removed' },
  { code: 'violation_account_action_taken', label: 'Violation Confirmed — Account Action Taken' },
  { code: 'violation_escalated_trust_safety', label: 'Violation Confirmed — Escalated to Trust & Safety' },
  { code: 'violation_escalated_legal', label: 'Violation Confirmed — Escalated to Legal' },
  { code: 'valid_report_already_handled', label: 'Valid Report — Already Handled' },
  { code: 'valid_report_logged_monitoring', label: 'Valid Report — Logged for Monitoring' },
] as const

export const DISMISSED_RESOLUTION_CODES = [
  { code: 'no_violation_found', label: 'No Violation Found' },
  { code: 'insufficient_evidence', label: 'Insufficient Evidence' },
  { code: 'context_mismatch', label: 'Context Mismatch (Wrong Space/Culture)' },
  { code: 'policy_not_applicable', label: 'Policy Not Applicable' },
  { code: 'duplicate_report', label: 'Duplicate Report' },
  { code: 'out_of_scope', label: 'Out of Scope' },
  { code: 'false_or_malicious_report', label: 'False or Malicious Report' },
  { code: 'spam_report', label: 'Spam Report' },
  { code: 'test_or_accidental_report', label: 'Test or Accidental Report' },
] as const

export type ResolvedResolutionCode = (typeof RESOLVED_RESOLUTION_CODES)[number]['code']
export type DismissedResolutionCode = (typeof DISMISSED_RESOLUTION_CODES)[number]['code']
export type AnyResolutionCode = ResolvedResolutionCode | DismissedResolutionCode

const RESOLVED_CODE_SET = new Set<string>(RESOLVED_RESOLUTION_CODES.map((it) => it.code))
const DISMISSED_CODE_SET = new Set<string>(DISMISSED_RESOLUTION_CODES.map((it) => it.code))

const LABEL_BY_CODE = new Map<string, string>([
  ...RESOLVED_RESOLUTION_CODES.map((it) => [it.code, it.label] as const),
  ...DISMISSED_RESOLUTION_CODES.map((it) => [it.code, it.label] as const),
])

export const ALL_RESOLUTION_CODES: ReadonlyArray<{ code: AnyResolutionCode; label: string; terminalStatus: 'resolved' | 'dismissed' }> = [
  ...RESOLVED_RESOLUTION_CODES.map((it) => ({ code: it.code, label: it.label, terminalStatus: 'resolved' as const })),
  ...DISMISSED_RESOLUTION_CODES.map((it) => ({ code: it.code, label: it.label, terminalStatus: 'dismissed' as const })),
]

export function isResolvedResolutionCode(value: string): value is ResolvedResolutionCode {
  return RESOLVED_CODE_SET.has(String(value || ''))
}

export function isDismissedResolutionCode(value: string): value is DismissedResolutionCode {
  return DISMISSED_CODE_SET.has(String(value || ''))
}

export function getResolutionCodeLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return LABEL_BY_CODE.get(String(value)) || null
}

export function getResolutionTerminalStatus(value: string | null | undefined): 'resolved' | 'dismissed' | null {
  const v = String(value || '').trim()
  if (!v) return null
  if (isResolvedResolutionCode(v)) return 'resolved'
  if (isDismissedResolutionCode(v)) return 'dismissed'
  return null
}
