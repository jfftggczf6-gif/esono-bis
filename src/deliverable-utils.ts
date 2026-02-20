// ═══════════════════════════════════════════════════════════════════
// Shared utilities for deliverable rendering
// ═══════════════════════════════════════════════════════════════════

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function getScoreColor(score: number): string {
  if (score >= 86) return '#059669'
  if (score >= 71) return '#0284c7'
  if (score >= 51) return '#c9a962'
  if (score >= 31) return '#d97706'
  return '#dc2626'
}

export function getScoreLabel(score: number): string {
  if (score >= 86) return 'Excellent'
  if (score >= 71) return 'Très bien'
  if (score >= 51) return 'Correct'
  if (score >= 31) return 'À renforcer'
  return 'Insuffisant'
}
