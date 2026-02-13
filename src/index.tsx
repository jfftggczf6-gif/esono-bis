import { Hono } from 'hono'
import { renderer } from './renderer'
import { cors } from 'hono/cors'
import { hashPassword, verifyPassword, generateToken, verifyToken } from './auth'
import { getCookie, setCookie } from 'hono/cookie'
import { getUserWithProgress } from './dashboard'
import { getCookieOptions } from './cookies'
import { moduleRoutes, renderEsanoLayout } from './module-routes'
import {
  getGuidedQuestionsForModule,
  getLearningStageKeysForModule,
  getModuleVariant,
  listLearningModules,
  getHybridModules,
  getAutomaticModules,
  getLearningModuleDefinition,
  isModuleUnlocked,
  getAllDeliverables,
  LEARNING_MODULES,
  type LearningStageKey,
  type LearningModuleDefinition,
} from './module-content'
import { getScoreLabel, getSectionName } from './ai-feedback'
import { analyzeWithClaude, type AnalysisResult, type AnswerInput } from './services/ai-analysis'
import { analyzeSIC, generateSicDiagnosticHtml, getSicScoreLabel, QUESTION_SECTION_MAP, SIC_SECTION_LABELS, type SicAnalysisResult } from './sic-engine'
import { generateFullSicDeliverable, type SicDeliverableData } from './sic-deliverable-engine'
import { generateFullBmcDeliverable, generateBmcDiagnosticHtml, type BmcDeliverableData } from './bmc-deliverable-engine'
import {
  analyzeInputs, generateInputsDiagnosticHtml, getInputsReadinessLabel,
  INPUT_TAB_ORDER, INPUT_TAB_LABELS, TAB_COACHING, TAB_FIELDS, scoreTab,
  type InputTabKey, type InputsAnalysisResult
} from './inputs-engine'
import { analyzePme, generatePmeExcelXml, generatePmePreviewHtml, type PmeInputData } from './framework-pme-engine'

type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY?: string
}

const MIN_VALIDATION_SCORE = 60

const parseDateValue = (value?: string | null) => {
  if (!value) return null
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const withTimezone = normalized.endsWith('Z') ? normalized : `${normalized}Z`
  const date = new Date(withTimezone)
  return Number.isNaN(date.getTime()) ? null : date
}

const getGuidedQuestions = (moduleCode: string) => {
  return getGuidedQuestionsForModule(moduleCode)
}

const getStageRouteForModule = (moduleCode: string, stage: LearningStageKey): string => {
  const variant = getModuleVariant(moduleCode)

  switch (stage) {
    case 'microLearning':
      return `/module/${moduleCode}/video`
    case 'quiz':
      return `/module/${moduleCode}/quiz`
    case 'inputs':
      return variant === 'finance'
        ? `/module/${moduleCode}/inputs`
        : `/module/${moduleCode}/questions`
    case 'analysis':
      return `/module/${moduleCode}/analysis`
    case 'iteration':
      return `/module/${moduleCode}/improve`
    case 'validation':
      return `/module/${moduleCode}/validate`
    case 'deliverable':
    default:
      return `/module/${moduleCode}/download`
  }
}

type FeedbackExtraction = {
  suggestions: string[]
  questions: string[]
  percentage: number | null
  scoreLabel: string | null
}

type SectionSnapshot = {
  order: number
  questionId: number
  section: string
  questionText: string
  answer: string
  iterationCount: number
  qualityScore: number | null
  percentage: number | null
  scoreLabel: string
  suggestions: string[]
  questions: string[]
  updatedAt: string | null
}

type SectionBuildResult = {
  sections: SectionSnapshot[]
  missingAnswers: number
  clarifications: number
  qualityMissing: number
  latestAnswerTimestamp: number | null
}

const parseAiFeedbackPayload = (raw: unknown): FeedbackExtraction => {
  if (!raw) {
    return { suggestions: [], questions: [], percentage: null, scoreLabel: null }
  }

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.map((item: any) => {
          if (!item) return ''
          if (typeof item === 'string') return item
          if (typeof item?.message === 'string') return item.message
          return String(item)
        }).filter((item: string) => item.length > 0)
      : []
    const questions = Array.isArray(parsed?.questions)
      ? parsed.questions.map((item: any) => {
          if (!item) return ''
          if (typeof item === 'string') return item
          if (typeof item?.message === 'string') return item.message
          return String(item)
        }).filter((item: string) => item.length > 0)
      : []
    const percentage = typeof parsed?.percentage === 'number' ? Math.round(parsed.percentage) : null
    const scoreLabel = typeof parsed?.scoreLabel === 'string' ? parsed.scoreLabel : null

    return { suggestions, questions, percentage, scoreLabel }
  } catch (error) {
    console.warn('parseAiFeedbackPayload error', error)
    return { suggestions: [], questions: [], percentage: null, scoreLabel: null }
  }
}

const buildSectionsSnapshot = (moduleCode: string, questionRows: any[]): SectionBuildResult => {
  const guided = getGuidedQuestions(moduleCode)
  const rowsByNumber = new Map<number, any>()

  questionRows.forEach((row) => {
    const numberValue = Number(row.question_number)
    if (!Number.isNaN(numberValue)) {
      rowsByNumber.set(numberValue, row)
    }
  })

  const baseQuestions = guided.length
    ? guided.map((q) => ({ id: q.id, section: q.section, question: q.question }))
    : questionRows.map((row: any) => {
        const id = Number(row.question_number)
        return {
          id,
          section: row.question_text ?? getSectionName(id),
          question: row.question_text ?? `Question ${id}`
        }
      })

  let missingAnswers = 0
  let clarifications = 0
  let qualityMissing = 0
  let latestAnswerTimestamp: number | null = null

  const sections: SectionSnapshot[] = baseQuestions.map((info, index) => {
    const row = rowsByNumber.get(info.id)
    const currentAnswer = (row?.user_response as string | null)?.trim() ?? ''

    if (!currentAnswer) {
      missingAnswers += 1
    }

    if (row?.updated_at) {
      const ts = parseDateValue(row.updated_at)?.getTime()
      if (ts && (!latestAnswerTimestamp || ts > latestAnswerTimestamp)) {
        latestAnswerTimestamp = ts
      }
    }

    const iterationCount = Number(row?.iteration_count ?? 0)
    const qualityScore = typeof row?.quality_score === 'number' ? Number(row.quality_score) : null

    if (qualityScore === null) {
      qualityMissing += 1
    }

    const feedback = parseAiFeedbackPayload(row?.ai_feedback)
    if (feedback.questions.length > 0) {
      clarifications += 1
    }

    const percentage = qualityScore ?? feedback.percentage
    const scoreLabel = percentage !== null
      ? getScoreLabel(percentage).label
      : feedback.scoreLabel ?? 'Analyse IA à générer'

    return {
      order: index + 1,
      questionId: info.id,
      section: info.section,
      questionText: info.question,
      answer: currentAnswer,
      iterationCount,
      qualityScore,
      percentage,
      scoreLabel,
      suggestions: feedback.suggestions,
      questions: feedback.questions,
      updatedAt: row?.updated_at ?? null
    }
  })

  return {
    sections,
    missingAnswers,
    clarifications,
    qualityMissing,
    latestAnswerTimestamp
  }
}

type FinancialMetricStatus = 'ok' | 'attention' | 'critical'

type FinancialMetricSnapshot = {
  code: string
  label: string
  value: number | null
  formattedValue: string
  status: FinancialMetricStatus
  explanation: string
}

type FinancialSummarySnapshot = {
  highlights: string[]
  warnings: string[]
  risks: string[]
}

type FinancialAnalysisResult = {
  metrics: FinancialMetricSnapshot[]
  overallScore: number
  summary: FinancialSummarySnapshot
}

type FinancialInputsRecord = {
  id?: number
  user_id?: number
  project_id?: number | null
  module_id?: number
  progress_id?: number | null
  period_label?: string | null
  currency?: string | null
  revenue_total?: number | null
  revenue_recurring?: number | null
  revenue_one_time?: number | null
  cogs_total?: number | null
  gross_margin_pct?: number | null
  operating_expenses?: number | null
  payroll_expenses?: number | null
  marketing_expenses?: number | null
  other_expenses?: number | null
  ebitda?: number | null
  net_income?: number | null
  cash_on_hand?: number | null
  runway_months?: number | null
  debt_total?: number | null
  debt_service?: number | null
  ltv?: number | null
  cac?: number | null
  arpu?: number | null
  notes?: string | null
  created_at?: string
  updated_at?: string
}

const FINANCIAL_NUMERIC_FIELDS = [
  'revenue_total',
  'revenue_recurring',
  'revenue_one_time',
  'cogs_total',
  'gross_margin_pct',
  'operating_expenses',
  'payroll_expenses',
  'marketing_expenses',
  'other_expenses',
  'ebitda',
  'net_income',
  'cash_on_hand',
  'runway_months',
  'debt_total',
  'debt_service',
  'ltv',
  'cac',
  'arpu'
] as const

type FinancialNumericField = typeof FINANCIAL_NUMERIC_FIELDS[number]

const FINANCIAL_TEXT_FIELDS = ['period_label', 'currency', 'notes'] as const

type FinancialTextField = typeof FINANCIAL_TEXT_FIELDS[number]

const FINANCIAL_METRIC_SCORES: Record<FinancialMetricStatus, number> = {
  ok: 100,
  attention: 70,
  critical: 45
}

const FINANCE_VALIDATION_SCORE = 65
const FINANCIAL_ANALYSIS_MAX_AGE_DAYS = 7

// --- Activity report (narrative) helpers ---
const ACTIVITY_REPORT_TEXT_FIELDS = [
  'vision',
  'mission',
  'problem_statement',
  'solution',
  'differentiation',
  'customer_segments',
  'market_size',
  'market_trends',
  'competition',
  'traction',
  'business_model',
  'revenue_streams',
  'pricing_strategy',
  'go_to_market',
  'team_summary',
  'team_gaps',
  'financial_needs',
  'fund_usage',
  'proof_points',
  'risks',
  'notes'
] as const

type ActivityReportFieldKey = typeof ACTIVITY_REPORT_TEXT_FIELDS[number]

type ActivityReportInputsRecord = {
  id?: number
  user_id: number
  project_id?: number | null
  module_id: number
  progress_id?: number | null
  vision?: string | null
  mission?: string | null
  problem_statement?: string | null
  solution?: string | null
  differentiation?: string | null
  customer_segments?: string | null
  market_size?: string | null
  market_trends?: string | null
  competition?: string | null
  traction?: string | null
  business_model?: string | null
  revenue_streams?: string | null
  pricing_strategy?: string | null
  go_to_market?: string | null
  team_summary?: string | null
  team_gaps?: string | null
  financial_needs?: string | null
  fund_usage?: string | null
  proof_points?: string | null
  risks?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
}

const ACTIVITY_REPORT_CATEGORY_FIELDS = {
  clarity: ['vision', 'mission', 'problem_statement', 'solution', 'differentiation', 'customer_segments'] as ActivityReportFieldKey[],
  realism: ['market_size', 'market_trends', 'competition', 'traction', 'proof_points', 'team_summary', 'team_gaps', 'risks'] as ActivityReportFieldKey[],
  precision: ['business_model', 'revenue_streams', 'pricing_strategy', 'go_to_market', 'financial_needs', 'fund_usage'] as ActivityReportFieldKey[]
} as const

type ActivityReportCategoryKey = keyof typeof ACTIVITY_REPORT_CATEGORY_FIELDS

const ACTIVITY_REPORT_FIELD_LABELS: Record<ActivityReportFieldKey, string> = {
  vision: 'Vision',
  mission: 'Mission',
  problem_statement: 'Problème client',
  solution: 'Solution proposée',
  differentiation: 'Différenciation',
  customer_segments: 'Marché cible',
  market_size: 'Taille de marché',
  market_trends: 'Tendances de marché',
  competition: 'Concurrence',
  traction: 'Traction et preuves',
  business_model: "Modèle d'affaires",
  revenue_streams: 'Sources de revenus',
  pricing_strategy: 'Stratégie de prix',
  go_to_market: 'Go-to-market',
  team_summary: 'Équipe',
  team_gaps: "Lacunes de l'équipe", 
  financial_needs: 'Besoins financiers',
  fund_usage: "Usage des fonds",
  proof_points: 'Preuves et indicateurs',
  risks: 'Risques et mitigation',
  notes: 'Notes supplémentaires'
}

const getActivityReportFieldScore = (value: string | null | undefined): number => {
  if (!value) return 0
  const length = value.trim().length
  if (!length) return 0
  let score = 0
  if (length >= 420) score = 100
  else if (length >= 280) score = 90
  else if (length >= 200) score = 80
  else if (length >= 140) score = 65
  else if (length >= 80) score = 50
  else if (length >= 40) score = 35
  else score = 20
  const evidenceBonus = /\d/.test(value) || /%|€|fcfa|usd|xaf/i.test(value) ? 10 : 0
  return Math.min(100, score + evidenceBonus)
}

const computeActivityReportCategoryScore = (
  inputs: ActivityReportInputsRecord,
  category: ActivityReportCategoryKey
): number => {
  const fields = ACTIVITY_REPORT_CATEGORY_FIELDS[category]
  if (!fields.length) return 0
  const total = fields.reduce((sum, key) => sum + getActivityReportFieldScore(inputs[key] ?? null), 0)
  return Math.round(total / fields.length)
}

type ActivityReportAnalysisResult = {
  clarityScore: number
  realismScore: number
  precisionScore: number
  overallScore: number
  strengths: string[]
  improvements: string[]
  missingSections: string[]
}

const analyseActivityReportNarrative = (inputs: ActivityReportInputsRecord): ActivityReportAnalysisResult => {
  const clarityScore = computeActivityReportCategoryScore(inputs, 'clarity')
  const realismScore = computeActivityReportCategoryScore(inputs, 'realism')
  const precisionScore = computeActivityReportCategoryScore(inputs, 'precision')
  const overallScore = Math.round((clarityScore + realismScore + precisionScore) / 3)

  const strengths: string[] = []
  const improvements: string[] = []
  const missingSections: string[] = []

  ACTIVITY_REPORT_TEXT_FIELDS.forEach((key) => {
    const value = inputs[key] ?? null
    const label = ACTIVITY_REPORT_FIELD_LABELS[key]
    const fieldScore = getActivityReportFieldScore(value)
    if (!value || !value.trim()) {
      if (['notes'].includes(key)) {
        return
      }
      missingSections.push(label)
      improvements.push(`${label} est manquant ou trop court.`)
      return
    }

    if (fieldScore >= 75) {
      strengths.push(`${label} est bien argumenté (${value.trim().length} caractères).`)
    } else if (fieldScore < 55) {
      improvements.push(`${label} gagnerait à être détaillé (actuellement ${value.trim().length} caractères).`)
    }
  })

  return {
    clarityScore,
    realismScore,
    precisionScore,
    overallScore,
    strengths,
    improvements,
    missingSections
  }
}

const sanitizeActivityReportPayload = (payload: Record<string, unknown>) => {
  const sanitized: Partial<ActivityReportInputsRecord> = {}
  ACTIVITY_REPORT_TEXT_FIELDS.forEach((field) => {
    if (payload.hasOwnProperty(field)) {
      sanitized[field] = parseTextInput(payload[field])
    }
  })
  return sanitized
}

const getActivityReportInputsRow = async (db: D1Database, userId: number, moduleId: number): Promise<ActivityReportInputsRecord | null> => {
  const row = await db.prepare(`
    SELECT *
    FROM activity_report_inputs
    WHERE user_id = ? AND module_id = ?
    LIMIT 1
  `).bind(userId, moduleId).first()

  return row ? (row as ActivityReportInputsRecord) : null
}

const ACTIVITY_REPORT_ALLOWED_MODULES = new Set<string>(['step1_activity_report', 'mod3_inputs'])

const buildActivityReportSummaryPayload = (analysis: ActivityReportAnalysisResult, timestampIso: string) => {
  return {
    updatedAt: timestampIso,
    overallScore: analysis.overallScore,
    overallLabel: getScoreLabel(analysis.overallScore).label,
    dimensions: {
      clarity: {
        score: analysis.clarityScore,
        label: getScoreLabel(analysis.clarityScore).label
      },
      realism: {
        score: analysis.realismScore,
        label: getScoreLabel(analysis.realismScore).label
      },
      precision: {
        score: analysis.precisionScore,
        label: getScoreLabel(analysis.precisionScore).label
      }
    },
    strengths: analysis.strengths,
    improvements: analysis.improvements,
    missingSections: analysis.missingSections
  }
}

const parseNumericInput = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/\s/g, '').replace(',', '.')
    if (!normalized.length) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const parseTextInput = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const determineStatus = (
  value: number | null,
  thresholds: { ok: number; attention: number; direction: 'higher' | 'lower' }
): FinancialMetricStatus => {
  if (value === null) return 'critical'
  if (thresholds.direction === 'higher') {
    if (value >= thresholds.ok) return 'ok'
    if (value >= thresholds.attention) return 'attention'
    return 'critical'
  }
  if (value <= thresholds.ok) return 'ok'
  if (value <= thresholds.attention) return 'attention'
  return 'critical'
}

const formatNumber = (value: number | null, decimals = 0): string => {
  if (value === null) return '—'
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

const formatPercentage = (value: number | null, decimals = 1): string => {
  if (value === null) return '—'
  return `${value.toFixed(decimals)} %`
}

const formatMonths = (value: number | null): string => {
  if (value === null) return '—'
  return `${value.toFixed(1)} mois`
}

const formatCurrencyValue = (value: number | null, currency: string | null): string => {
  if (value === null) return '—'
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency && currency.length === 3 ? currency.toUpperCase() : 'XOF',
      maximumFractionDigits: 0
    }).format(value)
  } catch (error) {
    return `${formatNumber(value)} ${currency ?? ''}`.trim()
  }
}

const formatRatio = (value: number | null): string => {
  if (value === null) return '—'
  return value.toFixed(2)
}

const calculateFinancialMetrics = (inputs: FinancialInputsRecord): FinancialAnalysisResult => {
  const metrics: FinancialMetricSnapshot[] = []
  const currency = inputs.currency ?? 'XOF'

  const revenue = parseNumericInput(inputs.revenue_total)
  const cogs = parseNumericInput(inputs.cogs_total)
  const ebitda = parseNumericInput(inputs.ebitda)
  const netIncome = parseNumericInput(inputs.net_income)
  const runway = parseNumericInput(inputs.runway_months)
  const cash = parseNumericInput(inputs.cash_on_hand)
  const debtService = parseNumericInput(inputs.debt_service)
  const ltv = parseNumericInput(inputs.ltv)
  const cac = parseNumericInput(inputs.cac)

  // Marge brute
  const grossMarginValue = inputs.gross_margin_pct !== undefined && inputs.gross_margin_pct !== null
    ? parseNumericInput(inputs.gross_margin_pct)
    : revenue !== null && cogs !== null && revenue !== 0
      ? ((revenue - cogs) / revenue) * 100
      : null
  const grossMarginStatus = determineStatus(grossMarginValue, { direction: 'higher', ok: 55, attention: 35 })
  const grossMarginExplanation = grossMarginValue === null
    ? 'Impossible de calculer la marge brute (revenus et coûts requis).'
    : grossMarginStatus === 'ok'
      ? 'Marge brute solide et attractive pour les investisseurs.'
      : grossMarginStatus === 'attention'
        ? 'Marge brute correcte mais des optimisations de coûts ou de pricing sont envisageables.'
        : 'Marge brute insuffisante : investiguer les coûts variables ou le positionnement prix.'
  metrics.push({
    code: 'gross_margin_pct',
    label: 'Marge brute',
    value: grossMarginValue,
    formattedValue: formatPercentage(grossMarginValue),
    status: grossMarginStatus,
    explanation: grossMarginExplanation
  })

  // Marge EBITDA
  const ebitdaMargin = revenue !== null && revenue !== 0 && ebitda !== null
    ? (ebitda / revenue) * 100
    : null
  const ebitdaStatus = determineStatus(ebitdaMargin, { direction: 'higher', ok: 18, attention: 8 })
  const ebitdaExplanation = ebitdaMargin === null
    ? "Marge EBITDA non disponible : renseignez l'EBITDA et le chiffre d'affaires."
    : ebitdaStatus === 'ok'
      ? 'Marge opérationnelle maîtrisée.'
      : ebitdaStatus === 'attention'
        ? 'Marge opérationnelle à surveiller, des gains de productivité sont possibles.'
        : 'Marge opérationnelle fragile : prioriser la réduction des charges fixes/variables.'
  metrics.push({
    code: 'ebitda_margin_pct',
    label: 'Marge EBITDA',
    value: ebitdaMargin,
    formattedValue: formatPercentage(ebitdaMargin),
    status: ebitdaStatus,
    explanation: ebitdaExplanation
  })

  // Trésorerie / Runway
  const runwayStatus = determineStatus(runway, { direction: 'higher', ok: 9, attention: 6 })
  const runwayExplanation = runway === null
    ? 'Runway inconnu : renseignez la trésorerie et/ou la consommation mensuelle.'
    : runwayStatus === 'ok'
      ? 'Runway confortable (> 9 mois).' 
      : runwayStatus === 'attention'
        ? 'Runway acceptable mais à consolider (6-9 mois).'
        : 'Runway critique : plan d’action de financement ou réduction des coûts urgent.'
  metrics.push({
    code: 'runway_months',
    label: 'Runway de trésorerie',
    value: runway,
    formattedValue: formatMonths(runway),
    status: runwayStatus,
    explanation: runwayExplanation
  })

  // LTV/CAC
  const ltvCacRatio = ltv !== null && cac !== null && cac !== 0 ? ltv / cac : null
  const ltvCacStatus = determineStatus(ltvCacRatio, { direction: 'higher', ok: 3, attention: 2 })
  const ltvCacExplanation = ltvCacRatio === null
    ? 'Ratio LTV/CAC indisponible : renseignez LTV et CAC.'
    : ltvCacStatus === 'ok'
      ? 'LTV/CAC solide : chaque client couvre largement son coût d’acquisition.'
      : ltvCacStatus === 'attention'
        ? 'LTV/CAC correct mais fragile : optimiser la fidélisation ou réduire le CAC.'
        : 'LTV/CAC insuffisant : chaque client ne couvre pas son acquisition.'
  metrics.push({
    code: 'ltv_cac_ratio',
    label: 'Ratio LTV / CAC',
    value: ltvCacRatio,
    formattedValue: formatRatio(ltvCacRatio),
    status: ltvCacStatus,
    explanation: ltvCacExplanation
  })

  // Couverture du service de la dette (DSCR)
  const dscr = debtService !== null && debtService !== 0 && ebitda !== null ? ebitda / debtService : null
  const dscrStatus = determineStatus(dscr, { direction: 'higher', ok: 1.5, attention: 1.1 })
  const dscrExplanation = dscr === null
    ? 'Couverture du service de la dette non calculable : renseignez EBITDA et service de la dette.'
    : dscrStatus === 'ok'
      ? 'Couverture de la dette sécurisée.'
      : dscrStatus === 'attention'
        ? 'Capacité de remboursement acceptable mais à surveiller.'
        : 'Couverture insuffisante : risque de tension de trésorerie vis-à-vis des prêteurs.'
  metrics.push({
    code: 'debt_service_coverage',
    label: 'Couverture service de la dette',
    value: dscr,
    formattedValue: formatRatio(dscr),
    status: dscrStatus,
    explanation: dscrExplanation
  })

  // Marge nette
  const netMargin = revenue !== null && revenue !== 0 && netIncome !== null ? (netIncome / revenue) * 100 : null
  const netMarginStatus = determineStatus(netMargin, { direction: 'higher', ok: 12, attention: 5 })
  const netMarginExplanation = netMargin === null
    ? 'Marge nette indisponible : renseignez le résultat net et le chiffre d’affaires.'
    : netMarginStatus === 'ok'
      ? 'Rentabilité nette positive et attractive.'
      : netMarginStatus === 'attention'
        ? 'Rentabilité positive mais limitée. Des optimisations sont possibles.'
        : 'Rentabilité négative ou trop faible : prioriser l’amélioration des marges.'
  metrics.push({
    code: 'net_margin_pct',
    label: 'Marge nette',
    value: netMargin,
    formattedValue: formatPercentage(netMargin),
    status: netMarginStatus,
    explanation: netMarginExplanation
  })

  const overallScore = metrics.length
    ? Math.round(metrics.reduce((acc, metric) => acc + FINANCIAL_METRIC_SCORES[metric.status], 0) / metrics.length)
    : 0

  const summary: FinancialSummarySnapshot = {
    highlights: metrics
      .filter((metric) => metric.status === 'ok')
      .map((metric) => `${metric.label} : ${metric.formattedValue}`),
    warnings: metrics
      .filter((metric) => metric.status === 'attention')
      .map((metric) => `${metric.label} à surveiller (${metric.formattedValue})`),
    risks: metrics
      .filter((metric) => metric.status === 'critical')
      .map((metric) => `${metric.label} critique (${metric.formattedValue})`)
  }

  // Ajout d’un indicateur synthétique de trésorerie
  if (cash !== null) {
    summary.highlights.push(`Trésorerie disponible : ${formatCurrencyValue(cash, currency)}`)
  }

  return {
    metrics,
    overallScore,
    summary
  }
}

const ensureUserDefaultProject = async (db: D1Database, userId: number): Promise<number | null> => {
  const existing = await db.prepare(`
    SELECT id
    FROM projects
    WHERE user_id = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).bind(userId).first()

  if (existing?.id) {
    return Number(existing.id)
  }

  const result = await db.prepare(`
    INSERT INTO projects (user_id, name, description)
    VALUES (?, ?, ?)
  `).bind(userId, 'Projet principal', 'Projet généré automatiquement').run()

  return typeof result.meta.last_row_id === 'number' ? result.meta.last_row_id : null
}

const ensureProgressRecord = async (db: D1Database, userId: number, moduleId: number) => {
  const existing = await db.prepare(`
    SELECT id, project_id, status
    FROM progress
    WHERE user_id = ? AND module_id = ?
    LIMIT 1
  `).bind(userId, moduleId).first()

  if (existing?.id) {
    const progressId = Number(existing.id)
    let projectId = existing.project_id !== undefined && existing.project_id !== null ? Number(existing.project_id) : null

    if (!projectId) {
      projectId = await ensureUserDefaultProject(db, userId)
      if (projectId) {
        await db.prepare(`
          UPDATE progress
          SET project_id = ?
          WHERE id = ?
        `).bind(projectId, progressId).run()
      }
    }

    return {
      id: progressId,
      project_id: projectId,
      status: typeof existing.status === 'string' ? existing.status : null
    }
  }

  const projectId = await ensureUserDefaultProject(db, userId)
  const result = await db.prepare(`
    INSERT INTO progress (
      user_id,
      project_id,
      module_id,
      status,
      started_at,
      updated_at,
      created_at
    ) VALUES (?, ?, ?, 'in_progress', datetime('now'), datetime('now'), datetime('now'))
  `).bind(userId, projectId, moduleId).run()

  return {
    id: Number(result.meta.last_row_id),
    project_id: projectId,
    status: 'in_progress'
  }
}

const getFinancialInputsRow = async (db: D1Database, userId: number, moduleId: number): Promise<FinancialInputsRecord | null> => {
  const row = await db.prepare(`
    SELECT *
    FROM financial_inputs
    WHERE user_id = ? AND module_id = ?
    LIMIT 1
  `).bind(userId, moduleId).first()

  return row ? (row as FinancialInputsRecord) : null
}

const sanitizeFinancialPayload = (payload: Record<string, unknown>) => {
  const sanitized: Partial<FinancialInputsRecord> = {}

  FINANCIAL_TEXT_FIELDS.forEach((key) => {
    if (payload.hasOwnProperty(key)) {
      const value = parseTextInput(payload[key])
      if (value !== null) {
        sanitized[key] = value as never
      } else if (key !== 'currency') {
        sanitized[key] = null as never
      }
    }
  })

  FINANCIAL_NUMERIC_FIELDS.forEach((key) => {
    if (payload.hasOwnProperty(key)) {
      const value = parseNumericInput(payload[key])
      sanitized[key] = value as never
    }
  })

  if (!sanitized.currency) {
    sanitized.currency = 'XOF'
  }

  return sanitized
}

const isFinancialAnalysisFresh = (timestamp?: string | null) => {
  if (!timestamp) return false
  const date = parseDateValue(timestamp)
  if (!date) return false
  const now = Date.now()
  const diffMs = now - date.getTime()
  const days = diffMs / (1000 * 60 * 60 * 24)
  return days <= FINANCIAL_ANALYSIS_MAX_AGE_DAYS
}

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use(renderer)
app.use('/api/*', cors())

// Mount module routes
app.route('/', moduleRoutes)

// Landing Page - A1
app.get('/', (c) => {
  return c.render(
    <div class="esono-public">
      <div class="esono-public__shell">
        <header class="esono-public__header">
          <div class="esono-public__brand">
            <span class="esono-public__logo">ESONO</span>
            <span class="esono-public__subtitle">Parcours entrepreneur</span>
          </div>
          <a href="/login" class="esono-btn esono-btn--ghost">
            <i class="fas fa-arrow-right-to-bracket"></i>
            Se connecter
          </a>
        </header>

        <section class="esono-card esono-public__hero">
          <div class="esono-card__body esono-public__hero-body">
            <div class="esono-public__hero-text">
              <h1 class="esono-public__hero-title">
                Préparez votre dossier d'investissement en 8 étapes
              </h1>
              <p class="esono-public__hero-description">
                Une plateforme hybride (IA + coaching humain) qui accompagne les PME africaines de la structuration du business model jusqu'au dossier investisseur complet.
              </p>
              <div class="esono-public__hero-actions">
                <span class="esono-badge esono-badge--accent">
                  <i class="fas fa-graduation-cap"></i>
                  Micro-learning
                </span>
                <span class="esono-badge esono-badge--info">
                  <i class="fas fa-robot"></i>
                  IA assistée
                </span>
                <span class="esono-badge esono-badge--success">
                  <i class="fas fa-user-tie"></i>
                  Coach humain
                </span>
              </div>
              <div class="esono-cta-grid">
                <a href="/register?type=entrepreneur" class="esono-btn esono-btn--primary">
                  <i class="fas fa-rocket"></i>
                  Commencer mon parcours
                </a>
                <a href="/register?type=pre_entrepreneur" class="esono-btn esono-btn--secondary">
                  <i class="fas fa-seedling"></i>
                  Découvrir la plateforme
                </a>
              </div>
            </div>
            <div class="esono-public__hero-metrics">
              <div class="esono-public__hero-metric">
                <p class="esono-public__hero-metric-value">8 modules</p>
                <p class="esono-public__hero-metric-label">Parcours séquentiel complet</p>
              </div>
              <div class="esono-public__hero-metric">
                <p class="esono-public__hero-metric-value">3 hybrides</p>
                <p class="esono-public__hero-metric-label">Apprentissage + IA + Coach</p>
              </div>
              <div class="esono-public__hero-metric">
                <p class="esono-public__hero-metric-value">+10 livrables</p>
                <p class="esono-public__hero-metric-label">Excel, HTML, Word, XLSM</p>
              </div>
            </div>
          </div>
        </section>

        <section class="esono-public__choices">
          <div class="esono-card esono-public__choice">
            <div class="esono-public__choice-icon" style="background: rgba(74, 111, 165, 0.12); color: var(--esono-secondary);">
              <i class="fas fa-graduation-cap"></i>
            </div>
            <h2 class="esono-public__choice-title">Modules 1-3 : Approche hybride</h2>
            <p class="esono-public__choice-text">
              Remplissez votre dossier en apprenant. Chaque section combine capsules éducatives, saisie assistée par l'IA et coaching humain.
            </p>
            <ul class="esono-public__choice-list">
              <li><strong>BMC</strong> — Business Model Canvas (9 blocs)</li>
              <li><strong>SIC</strong> — Social Impact Canvas (ODD, indicateurs)</li>
              <li><strong>Inputs</strong> — Données financières (historiques, RH, CAPEX)</li>
            </ul>
            <span class="esono-public__choice-cta">
              <i class="fas fa-brain"></i>
              Apprendre + Remplir + Coaching
            </span>
          </div>

          <div class="esono-card esono-public__choice">
            <div class="esono-public__choice-icon" style="background: rgba(5, 150, 105, 0.12); color: var(--esono-success);">
              <i class="fas fa-robot"></i>
            </div>
            <h2 class="esono-public__choice-title">Modules 4-8 : Génération IA</h2>
            <p class="esono-public__choice-text">
              L'IA génère automatiquement vos livrables investisseurs à partir des données saisies dans les modules 1-3.
            </p>
            <ul class="esono-public__choice-list">
              <li><strong>Framework</strong> — Modélisation financière 5 ans</li>
              <li><strong>Diagnostic</strong> — Score crédibilité + plan d'action</li>
              <li><strong>OVO + BP + ODD</strong> — Livrables complets</li>
            </ul>
            <span class="esono-public__choice-cta">
              <i class="fas fa-wand-magic-sparkles"></i>
              Génération automatique
            </span>
          </div>
        </section>

        <section class="esono-public__stats">
          <div class="esono-public__stats-body">
            <div class="esono-public__stats-grid">
              <div>
                <p class="esono-public__stats-value">8 modules</p>
                <p class="esono-public__stats-label">Parcours séquentiel</p>
              </div>
              <div>
                <p class="esono-public__stats-value">XOF / FCFA</p>
                <p class="esono-public__stats-label">Devise par défaut</p>
              </div>
              <div>
                <p class="esono-public__stats-value">IA + Coach</p>
                <p class="esono-public__stats-label">Double validation</p>
              </div>
            </div>
          </div>
        </section>

        <footer class="esono-public__footer">
          Déjà inscrit ? <a href="/login">Se connecter</a>
        </footer>
      </div>
    </div>
  )
})

// Register Page - A2
app.get('/register', (c) => {
  const userType = c.req.query('type') || 'entrepreneur'
  const isPreEntrepreneur = userType === 'pre_entrepreneur'
  
  return c.render(
    <div class="esono-auth">
      <div class="esono-auth__shell">
        <header class="esono-auth__header">
          <a href="/" class="esono-auth__brand">ES</a>
          <h1 class="esono-auth__title">
            {isPreEntrepreneur ? 'Commencer votre apprentissage' : 'Structurer votre entreprise'}
          </h1>
          <p class="esono-auth__subtitle">
            {isPreEntrepreneur
              ? 'Créez votre compte pour accéder aux formations et modules guidés.'
              : 'Créez votre compte pour consolider votre projet et générer vos livrables.'}
          </p>
        </header>

        <div class="esono-card esono-auth__card">
          <div class="esono-card__body">
            <form id="registerForm" class="esono-form">
              <input type="hidden" name="user_type" value={userType} />

              <div class="esono-form__group">
                <label for="name" class="esono-form__label">
                  Nom complet <span class="esono-text-danger">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  class="esono-input"
                  placeholder="John Doe"
                />
              </div>

              <div class="esono-form__group">
                <label for="email" class="esono-form__label">
                  Email <span class="esono-text-danger">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  class="esono-input"
                  placeholder="john@example.com"
                />
              </div>

              <div class="esono-form__group">
                <label for="password" class="esono-form__label">
                  Mot de passe <span class="esono-text-danger">*</span>
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  required
                  minlength="6"
                  class="esono-input"
                  placeholder="••••••••"
                />
                <p class="esono-form__note">Minimum 6 caractères</p>
              </div>

              <div class="esono-form__group">
                <label for="country" class="esono-form__label">
                  Pays <span class="esono-text-danger">*</span>
                </label>
                <select
                  id="country"
                  name="country"
                  required
                  class="esono-select"
                >
                  <option value="">Sélectionner un pays</option>
                  <option value="SN">Sénégal</option>
                  <option value="CI">Côte d'Ivoire</option>
                  <option value="BF">Burkina Faso</option>
                  <option value="ML">Mali</option>
                  <option value="BJ">Bénin</option>
                  <option value="TG">Togo</option>
                  <option value="NE">Niger</option>
                  <option value="CM">Cameroun</option>
                  <option value="MA">Maroc</option>
                  <option value="DZ">Algérie</option>
                  <option value="TN">Tunisie</option>
                  <option value="KE">Kenya</option>
                  <option value="NG">Nigeria</option>
                  <option value="GH">Ghana</option>
                  <option value="RW">Rwanda</option>
                </select>
              </div>

              <div class="esono-form__group">
                <label for="status" class="esono-form__label">
                  Statut <span class="esono-text-danger">*</span>
                </label>
                <select
                  id="status"
                  name="status"
                  required
                  class="esono-select"
                >
                  <option value="">Sélectionner un statut</option>
                  <option value="student">Étudiant</option>
                  <option value="entrepreneur">Entrepreneur</option>
                  <option value="alumni">Alumni</option>
                </select>
              </div>

              <div class="esono-checkbox">
                <input
                  type="checkbox"
                  id="terms"
                  name="terms"
                  required
                />
                <label for="terms">
                  J'accepte les conditions d'utilisation et la politique de confidentialité.
                </label>
              </div>

              <div id="error-message" class="esono-alert esono-alert--danger hidden" role="alert"></div>

              <button type="submit" class="esono-btn esono-btn--primary esono-btn--block">
                <span id="submit-text">Créer mon compte</span>
                <span id="submit-loading" class="hidden">
                  <i class="fas fa-spinner fa-spin"></i>
                  Création en cours...
                </span>
              </button>
            </form>
          </div>
        </div>

        <div class="esono-auth__footer">
          Déjà inscrit ? <a href="/login">Se connecter</a>
        </div>
      </div>

      <script src="/static/register.js"></script>
    </div>
  )
})

// Login Page
app.get('/login', (c) => {
  return c.render(
    <div class="esono-auth">
      <div class="esono-auth__shell">
        <header class="esono-auth__header">
          <a href="/" class="esono-auth__brand">ES</a>
          <h1 class="esono-auth__title">Bon retour !</h1>
          <p class="esono-auth__subtitle">
            Connectez-vous pour reprendre votre progression et retrouver vos livrables.
          </p>
        </header>

        <div class="esono-card esono-auth__card">
          <div class="esono-card__body">
            <form id="loginForm" class="esono-form">
              <div class="esono-form__group">
                <label for="email" class="esono-form__label">Email</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  class="esono-input"
                  placeholder="john@example.com"
                />
              </div>

              <div class="esono-form__group">
                <label for="password" class="esono-form__label">Mot de passe</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  required
                  class="esono-input"
                  placeholder="••••••••"
                />
              </div>

              <div id="error-message" class="esono-alert esono-alert--danger hidden" role="alert"></div>

              <button type="submit" class="esono-btn esono-btn--primary esono-btn--block">
                <span id="submit-text">Se connecter</span>
                <span id="submit-loading" class="hidden">
                  <i class="fas fa-spinner fa-spin"></i>
                  Connexion...
                </span>
              </button>
            </form>
          </div>
        </div>

        <div class="esono-auth__footer">
          Pas encore de compte ? <a href="/">Créer un compte</a>
        </div>
      </div>

      <script src="/static/login.js"></script>
    </div>
  )
})

// API: Register
app.post('/api/register', async (c) => {
  try {
    const { name, email, password, country, status, user_type } = await c.req.json()

    // Validate inputs
    if (!name || !email || !password || !country || !status || !user_type) {
      return c.json({ error: 'Tous les champs sont requis' }, 400)
    }

    if (password.length < 6) {
      return c.json({ error: 'Le mot de passe doit contenir au moins 6 caractères' }, 400)
    }

    // Check if email already exists
    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email).first()

    if (existingUser) {
      return c.json({ error: 'Cet email est déjà utilisé' }, 400)
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Insert user
    const result = await c.env.DB.prepare(`
      INSERT INTO users (email, password_hash, name, country, user_type, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(email, passwordHash, name, country, user_type, status).run()

    // Create default project
    const userId = result.meta.last_row_id
    await c.env.DB.prepare(`
      INSERT INTO projects (user_id, name, description)
      VALUES (?, ?, ?)
    `).bind(userId, `Projet de ${name}`, 'Mon projet entrepreneurial').run()

    // Generate JWT token
    const token = await generateToken({
      userId: Number(userId),
      email,
      userType: user_type
    })

    setCookie(c, 'auth_token', token, getCookieOptions(c))

    return c.json({
      success: true,
      user: { id: userId, name, email, userType: user_type }
    })
  } catch (error) {
    console.error('Registration error:', error)
    return c.json({ error: 'Erreur lors de la création du compte' }, 500)
  }
})

// API: Login
app.post('/api/login', async (c) => {
  try {
    const { email, password } = await c.req.json()

    if (!email || !password) {
      return c.json({ error: 'Email et mot de passe requis' }, 400)
    }

    // Find user
    const user = await c.env.DB.prepare(`
      SELECT id, email, password_hash, name, user_type
      FROM users
      WHERE email = ?
    `).bind(email).first()

    if (!user) {
      return c.json({ error: 'Email ou mot de passe incorrect' }, 401)
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash as string)
    if (!isValid) {
      return c.json({ error: 'Email ou mot de passe incorrect' }, 401)
    }

    // Generate JWT token
    const token = await generateToken({
      userId: user.id as number,
      email: user.email as string,
      userType: user.user_type as 'pre_entrepreneur' | 'entrepreneur'
    })

    setCookie(c, 'auth_token', token, getCookieOptions(c))

    return c.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        userType: user.user_type
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: 'Erreur lors de la connexion' }, 500)
  }
})

// API: Logout
app.post('/api/logout', (c) => {
  const opts = getCookieOptions(c)
  setCookie(c, 'auth_token', '', {
    ...opts,
    maxAge: 0
  })
  return c.json({ success: true })
})

// API: Get current user
app.get('/api/user', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    
    if (!token) {
      return c.json({ error: 'Non authentifié' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.json({ error: 'Token invalide' }, 401)
    }

    const user = await c.env.DB.prepare(`
      SELECT id, email, name, country, user_type, status, created_at
      FROM users
      WHERE id = ?
    `).bind(payload.userId).first()

    if (!user) {
      return c.json({ error: 'Utilisateur non trouvé' }, 404)
    }

    return c.json({ user })
  } catch (error) {
    console.error('Get user error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Learning modules registry
app.get('/api/modules/learning', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')

    if (!token) {
      return c.json({ error: 'Non authentifié' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.json({ error: 'Token invalide' }, 401)
    }

    const definitions = listLearningModules()
    if (definitions.length === 0) {
      return c.json({ modules: [] })
    }

    const moduleCodes = definitions.map((definition) => definition.code)
    const placeholders = moduleCodes.map(() => '?').join(', ')

    const modulesResult = await c.env.DB.prepare(`
      SELECT id, module_code, title, description, display_order
      FROM modules
      WHERE module_code IN (${placeholders})
    `).bind(...moduleCodes).all()

    const moduleMap = new Map<string, any>()
    modulesResult.results.forEach((row: any) => {
      if (row?.module_code) {
        moduleMap.set(row.module_code as string, row)
      }
    })

    const progressResult = await c.env.DB.prepare(`
      SELECT p.id,
             p.module_id,
             p.status,
             p.ai_score,
             p.financial_score,
             p.ai_last_analysis,
             p.financial_last_refresh,
             m.module_code
      FROM progress p
      INNER JOIN modules m ON m.id = p.module_id
      WHERE p.user_id = ?
    `).bind(payload.userId).all()

    const progressMap = new Map<string, any>()
    progressResult.results.forEach((row: any) => {
      if (row?.module_code) {
        progressMap.set(row.module_code as string, row)
      }
    })

    const modulesPayload = definitions.map((definition) => {
      const dbModule = moduleMap.get(definition.code)
      const progress = progressMap.get(definition.code)
      const stageKeys = getLearningStageKeysForModule(definition.code)

      const stageRoutes = stageKeys.reduce<Record<string, string>>((acc, stage) => {
        acc[stage] = getStageRouteForModule(definition.code, stage)
        return acc
      }, {} as Record<string, string>)

      const aiScore = typeof progress?.ai_score === 'number'
        ? progress.ai_score
        : typeof progress?.financial_score === 'number'
          ? progress.financial_score
          : null

      const lastAnalysisAt = progress?.ai_last_analysis ?? progress?.financial_last_refresh ?? null

      return {
        code: definition.code,
        title: dbModule?.title ?? definition.title,
        shortTitle: definition.shortTitle,
        slug: definition.slug,
        summary: definition.summary,
        type: definition.type,
        order: definition.order,
        variant: definition.variant ?? getModuleVariant(definition.code),
        learningObjectives: definition.learningObjectives,
        dependencies: definition.dependencies,
        downstreamFeeds: definition.downstreamFeeds,
        flow: definition.flow,
        outputs: definition.outputs,
        stages: stageKeys,
        stageCount: stageKeys.length,
        stageRoutes,
        progress: {
          status: progress?.status ?? 'not_started',
          aiScore,
          lastAnalysisAt
        },
        links: {
          overview: `/module/${definition.code}`,
          ...stageRoutes
        },
        metadata: {
          moduleId: dbModule?.id ?? null,
          displayOrder: dbModule?.display_order ?? null,
          description: dbModule?.description ?? null
        }
      }
    })

    return c.json({ modules: modulesPayload })
  } catch (error) {
    console.error('Learning modules registry error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// Dashboard - A3 (nouvelle architecture 8 modules)
app.get('/dashboard', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const data = await getUserWithProgress(c.env.DB, payload.userId)
    if (!data) return c.redirect('/login')

    const { user, project, modules: dbModules, progress } = data

    // Build progress map par module_code
    const progressList = (progress as any[]) ?? []
    const dbModulesList = (dbModules as any[]) ?? []
    const progressByCode = new Map<string, any>()
    
    for (const entry of progressList) {
      const dbMod = dbModulesList.find((m: any) => m.id === entry.module_id)
      if (dbMod?.module_code) {
        progressByCode.set(dbMod.module_code as string, entry)
      }
    }

    // Utiliser la définition des 8 modules
    const allModules = LEARNING_MODULES
    const completedCodes = new Set<string>()
    for (const mod of allModules) {
      const p = progressByCode.get(mod.code)
      if (p?.status === 'completed' || p?.status === 'validated') {
        completedCodes.add(mod.code)
      }
    }

    const totalModules = allModules.length
    const completedCount = completedCodes.size
    const progressPercentage = totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0

    // Trouver le prochain module
    let nextModule: LearningModuleDefinition | null = null
    for (const mod of allModules) {
      if (!completedCodes.has(mod.code)) {
        if (isModuleUnlocked(mod.code, completedCodes)) {
          nextModule = mod
          break
        }
      }
    }

    type ModuleStatusKey = 'completed' | 'in_progress' | 'locked' | 'not_started'

    const getModuleStatus = (mod: LearningModuleDefinition): ModuleStatusKey => {
      const p = progressByCode.get(mod.code)
      if (p?.status === 'completed' || p?.status === 'validated') return 'completed'
      if (p?.status === 'in_progress') return 'in_progress'
      if (!isModuleUnlocked(mod.code, completedCodes)) return 'locked'
      return 'not_started'
    }

    const statusConfig: Record<ModuleStatusKey, { label: string; badgeClass: string; icon: string; cardClass: string }> = {
      completed: { label: 'Terminé', badgeClass: 'esono-badge esono-badge--success', icon: 'fas fa-check-circle', cardClass: 'esono-module-card--completed' },
      in_progress: { label: 'En cours', badgeClass: 'esono-badge esono-badge--info', icon: 'fas fa-spinner fa-spin', cardClass: 'esono-module-card--active' },
      not_started: { label: 'Disponible', badgeClass: 'esono-badge esono-badge--accent', icon: 'fas fa-play-circle', cardClass: '' },
      locked: { label: 'Verrouillé', badgeClass: 'esono-badge esono-badge--neutral', icon: 'fas fa-lock', cardClass: 'esono-module-card--locked' }
    }

    const headerActions = (
      <div class="esono-header-actions">
        <div class="esono-user-summary">
          <span class="esono-user-summary__name">{user.name}</span>
          <span class="esono-user-summary__email">{user.email}</span>
        </div>
        <button type="button" class="esono-btn esono-btn--secondary" onclick="logout()">
          <i class="fas fa-arrow-right-from-bracket"></i>
          Déconnexion
        </button>
      </div>
    )

    const pageContent = (
      <div class="esono-dashboard-stack">
        {/* Hero */}
        <section class="esono-hero">
          <div class="esono-hero__header">
            <div>
              <h2 class="esono-hero__title">Bienvenue, {user.name}</h2>
              <p class="esono-hero__subtitle">
                {project?.name ? `Projet : ${project.name}` : 'Parcours Investment Readiness — PME Afrique'}
              </p>
            </div>
            <span class="esono-hero__badge">
              <i class="fas fa-flag-checkered"></i>
              {completedCount} / {totalModules} modules
            </span>
          </div>
          <div class="esono-hero__metrics">
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{completedCount}</p>
              <p class="esono-hero__metric-label">Modules complétés</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{progressPercentage}%</p>
              <p class="esono-hero__metric-label">Progression</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{nextModule ? nextModule.moduleNumber : '—'}</p>
              <p class="esono-hero__metric-label">Prochaine étape</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">XOF</p>
              <p class="esono-hero__metric-label">Devise</p>
            </div>
          </div>
        </section>

        {/* Barre de progression 8 étapes */}
        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-route esono-card__title-icon"></i>
              Parcours Investment Readiness
            </h2>
            <span class="esono-badge esono-badge--info">
              {progressPercentage}% complété
            </span>
          </div>
          <div class="esono-card__body">
            <div class="esono-progress esono-mb-lg">
              <div class="esono-progress__bar" style={`width: ${progressPercentage}%`}></div>
            </div>
            <div class="esono-steps-list">
              {allModules.map((mod) => {
                const status = getModuleStatus(mod)
                const cfg = statusConfig[status]
                const isHybrid = mod.category === 'hybrid'
                return (
                  <div class={`esono-steps-list__item esono-steps-list__item--${status === 'completed' ? 'completed' : status === 'in_progress' ? 'current' : 'upcoming'}`} key={`step-${mod.code}`}>
                    <div class="esono-steps-list__marker" style={status !== 'locked' ? `background: ${mod.color}; color: white;` : ''}>
                      {status === 'completed' ? <i class="fas fa-check"></i> : status === 'locked' ? <i class="fas fa-lock"></i> : mod.moduleNumber}
                    </div>
                    <div class="esono-steps-list__content">
                      <p class="esono-steps-list__title">
                        Module {mod.moduleNumber} — {mod.shortTitle}
                        {isHybrid && <span style="margin-left: 8px; font-size: 0.7em; padding: 2px 6px; background: rgba(201, 169, 98, 0.15); color: #b8941f; border-radius: 4px;">HYBRIDE</span>}
                        {!isHybrid && <span style="margin-left: 8px; font-size: 0.7em; padding: 2px 6px; background: rgba(124, 58, 237, 0.1); color: #7c3aed; border-radius: 4px;">AUTO IA</span>}
                      </p>
                      <p class="esono-steps-list__subtitle">{mod.summary}</p>
                    </div>
                    <span class={cfg.badgeClass}>
                      <i class={cfg.icon}></i>
                      {cfg.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* Prochaine étape recommandée */}
        {nextModule && (
          <section class="esono-card esono-card--accent">
            <div class="esono-card__header">
              <h2 class="esono-card__title">
                <i class="fas fa-star esono-card__title-icon"></i>
                Prochaine étape recommandée
              </h2>
            </div>
            <div class="esono-card__body esono-stack--md">
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                <div style={`width: 48px; height: 48px; border-radius: 12px; background: ${nextModule.color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.2em;`}>
                  <i class={nextModule.icon}></i>
                </div>
                <div>
                  <div class="esono-text-muted esono-text-sm">
                    Module {nextModule.moduleNumber} • {nextModule.category === 'hybrid' ? 'Micro-learning + IA + Coaching' : 'Traitement IA automatique'}
                  </div>
                  <h3 class="esono-font-semibold">{nextModule.title}</h3>
                </div>
              </div>
              <p>{nextModule.summary}</p>
              {nextModule.category === 'hybrid' && (
                <div style="display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0;">
                  <span class="esono-badge esono-badge--accent"><i class="fas fa-graduation-cap"></i> Micro-learning</span>
                  <span class="esono-badge esono-badge--info"><i class="fas fa-robot"></i> Saisie assistée IA</span>
                  <span class="esono-badge esono-badge--success"><i class="fas fa-user-tie"></i> Coaching</span>
                </div>
              )}
              <div class="esono-cta-grid">
                <a href={`/module/${nextModule.code}`} class="esono-btn esono-btn--primary">
                  {nextModule.category === 'hybrid' ? 'Commencer le module' : 'Générer le livrable'}
                  <i class="fas fa-arrow-right"></i>
                </a>
              </div>
            </div>
          </section>
        )}

        {/* Modules hybrides (1-3) */}
        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-graduation-cap esono-card__title-icon"></i>
              Modules hybrides (1-3)
            </h2>
            <span class="esono-badge esono-badge--accent">
              Micro-learning + IA + Coaching
            </span>
          </div>
          <div class="esono-card__body">
            <div class="esono-grid esono-grid--3">
              {getHybridModules().map((mod) => {
                const status = getModuleStatus(mod)
                const cfg = statusConfig[status]
                const isLocked = status === 'locked'
                return (
                  <a href={isLocked ? '#' : `/module/${mod.code}`} class={`esono-module-card__link ${isLocked ? 'esono-module-card--disabled' : ''}`} key={`mod-${mod.code}`} style={isLocked ? 'pointer-events: none; opacity: 0.5;' : ''}>
                    <div class={`esono-card esono-module-card ${cfg.cardClass}`}>
                      <div class="esono-card__header">
                        <div style="display: flex; align-items: center; gap: 10px;">
                          <div style={`width: 36px; height: 36px; border-radius: 8px; background: ${mod.color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 0.9em;`}>
                            <i class={mod.icon}></i>
                          </div>
                          <div>
                            <span class="esono-text-xs esono-text-muted">Module {mod.moduleNumber}</span>
                            <h3 class="esono-module-card__title">{mod.shortTitle}</h3>
                          </div>
                        </div>
                        <span class={cfg.badgeClass}>
                          <i class={cfg.icon}></i>
                          {cfg.label}
                        </span>
                      </div>
                      <div class="esono-card__body">
                        <p class="esono-module-card__description">{mod.summary}</p>
                      </div>
                      <div class="esono-card__footer">
                        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                          <span style="font-size: 0.7em; padding: 1px 5px; background: rgba(201,169,98,0.12); color: #b8941f; border-radius: 3px;"><i class="fas fa-graduation-cap"></i></span>
                          <span style="font-size: 0.7em; padding: 1px 5px; background: rgba(2,132,199,0.1); color: #0284c7; border-radius: 3px;"><i class="fas fa-robot"></i></span>
                          <span style="font-size: 0.7em; padding: 1px 5px; background: rgba(5,150,105,0.1); color: #059669; border-radius: 3px;"><i class="fas fa-user-tie"></i></span>
                        </div>
                        <span class="esono-module-card__cta">
                          {status === 'completed' ? 'Revoir' : status === 'in_progress' ? 'Continuer' : 'Commencer'}
                          <i class="fas fa-arrow-right"></i>
                        </span>
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        </section>

        {/* Modules automatiques (4-8) */}
        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-wand-magic-sparkles esono-card__title-icon"></i>
              Modules automatiques (4-8)
            </h2>
            <span class="esono-badge esono-badge--info">
              Traitement IA
            </span>
          </div>
          <div class="esono-card__body">
            <div class="esono-grid esono-grid--3">
              {getAutomaticModules().map((mod) => {
                const status = getModuleStatus(mod)
                const cfg = statusConfig[status]
                const isLocked = status === 'locked'
                return (
                  <a href={isLocked ? '#' : `/module/${mod.code}`} class={`esono-module-card__link ${isLocked ? 'esono-module-card--disabled' : ''}`} key={`mod-${mod.code}`} style={isLocked ? 'pointer-events: none; opacity: 0.5;' : ''}>
                    <div class={`esono-card esono-module-card ${cfg.cardClass}`}>
                      <div class="esono-card__header">
                        <div style="display: flex; align-items: center; gap: 10px;">
                          <div style={`width: 36px; height: 36px; border-radius: 8px; background: ${mod.color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 0.9em;`}>
                            <i class={mod.icon}></i>
                          </div>
                          <div>
                            <span class="esono-text-xs esono-text-muted">Module {mod.moduleNumber}</span>
                            <h3 class="esono-module-card__title">{mod.shortTitle}</h3>
                          </div>
                        </div>
                        <span class={cfg.badgeClass}>
                          <i class={cfg.icon}></i>
                          {cfg.label}
                        </span>
                      </div>
                      <div class="esono-card__body">
                        <p class="esono-module-card__description">{mod.summary}</p>
                        <div style="margin-top: 8px;">
                          {mod.outputs.map((output, i) => (
                            <span key={`out-${i}`} style="font-size: 0.75em; padding: 2px 6px; background: rgba(124,58,237,0.08); color: #7c3aed; border-radius: 4px; margin-right: 4px;">
                              <i class="fas fa-file"></i> {output.format.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div class="esono-card__footer">
                        <span style="font-size: 0.7em; padding: 1px 5px; background: rgba(124,58,237,0.1); color: #7c3aed; border-radius: 3px;">
                          <i class="fas fa-wand-magic-sparkles"></i> Auto IA
                        </span>
                        <span class="esono-module-card__cta">
                          {status === 'completed' ? 'Télécharger' : isLocked ? 'Verrouillé' : 'Générer'}
                          <i class={isLocked ? 'fas fa-lock' : 'fas fa-arrow-right'}></i>
                        </span>
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        </section>

        {/* Livrables rapide */}
        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-download esono-card__title-icon"></i>
              Livrables
            </h2>
            <a href="/livrables" class="esono-btn esono-btn--ghost">
              Voir tous les livrables <i class="fas fa-arrow-right"></i>
            </a>
          </div>
          <div class="esono-card__body">
            <p class="esono-text-muted esono-text-sm" style="margin-bottom: 12px;">
              Les livrables sont générés au fur et à mesure de votre progression. Complétez les modules hybrides (1-3) pour débloquer les livrables automatiques.
            </p>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;">
              {getAllDeliverables().map((d) => {
                const isGenerated = completedCodes.has(d.moduleCode)
                return d.outputs.map((output, i) => (
                  <div key={`del-${d.moduleCode}-${i}`} style={`padding: 10px 12px; border-radius: 8px; border: 1px solid ${isGenerated ? 'rgba(5,150,105,0.3)' : 'rgba(0,0,0,0.08)'}; background: ${isGenerated ? 'rgba(5,150,105,0.05)' : '#fafafa'}; display: flex; align-items: center; gap: 8px;`}>
                    <i class={isGenerated ? 'fas fa-check-circle' : 'fas fa-hourglass-half'} style={`color: ${isGenerated ? '#059669' : '#999'};`}></i>
                    <div style="flex: 1; min-width: 0;">
                      <div style="font-size: 0.8em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">M{d.moduleNumber} — {output.format.toUpperCase()}</div>
                      <div style="font-size: 0.7em; color: #888;">{d.moduleTitle}</div>
                    </div>
                  </div>
                ))
              })}
            </div>
          </div>
        </section>
      </div>
    )

    return c.html(
      renderEsanoLayout({
        pageTitle: 'Tableau de bord',
        pageDescription: project?.name
          ? `Suivi du projet « ${project.name} »`
          : 'Parcours Investment Readiness — PME Afrique',
        activeNav: 'dashboard',
        content: pageContent,
        headerActions,
        extraHead: <script src="/static/dashboard.js" defer></script>
      })
    )
  } catch (error) {
    console.error('Dashboard error:', error)
    return c.redirect('/login')
  }
})

// Module entry point - redirect based on module category
app.get('/module/:code', async (c) => {
  const moduleCode = c.req.param('code')
  const definition = getLearningModuleDefinition(moduleCode)
  
  if (!definition) {
    // Fallback ancien code
    return c.redirect(`/module/${moduleCode}/video`)
  }

  if (definition.category === 'automatic') {
    return c.redirect(`/module/${moduleCode}/overview`)
  }

  // Module hybride → commence par le micro-learning (vidéo)
  return c.redirect(`/module/${moduleCode}/video`)
})

// Page module automatique - Overview
app.get('/module/:code/overview', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    const definition = getLearningModuleDefinition(moduleCode)

    if (!definition || definition.category !== 'automatic') {
      return c.redirect(`/module/${moduleCode}/video`)
    }

    const depModules = definition.dependencies
    const depLabels = depModules.map((dep) => {
      const d = getLearningModuleDefinition(dep)
      return d ? `Module ${d.moduleNumber} — ${d.shortTitle}` : dep
    })

    const outputsHtml = definition.outputs.map((output) => 
      `<div style="padding: 16px; border: 1px solid rgba(0,0,0,0.1); border-radius: 10px; background: white;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <span style="padding: 4px 10px; background: rgba(124,58,237,0.1); color: #7c3aed; border-radius: 6px; font-weight: 600; font-size: 0.85em;">${output.format.toUpperCase()}</span>
        </div>
        <p style="font-size: 0.85em; color: #555;">${output.description}</p>
      </div>`
    ).join('')

    const pageContent = (
      <div class="esono-dashboard-stack">
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
          <div style={`width: 56px; height: 56px; border-radius: 14px; background: ${definition.color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.5em;`}>
            <i class={definition.icon}></i>
          </div>
          <div>
            <span class="esono-text-xs esono-text-muted">Module {definition.moduleNumber} — Traitement IA automatique</span>
            <h2 style="margin: 0; font-size: 1.5em;">{definition.title}</h2>
          </div>
        </div>

        <section class="esono-card">
          <div class="esono-card__body">
            <p style="font-size: 1.05em; line-height: 1.6; margin-bottom: 16px;">{definition.summary}</p>
            
            <div style="background: rgba(124,58,237,0.05); border: 1px solid rgba(124,58,237,0.15); border-radius: 10px; padding: 16px; margin-bottom: 20px;">
              <h3 style="margin: 0 0 8px; font-size: 0.95em; color: #7c3aed;">
                <i class="fas fa-info-circle"></i> Ce module est automatique
              </h3>
              <p style="margin: 0; font-size: 0.9em; color: #555;">
                L'IA génère automatiquement les livrables à partir des données que vous avez saisies dans les modules précédents. Aucune saisie manuelle requise.
              </p>
            </div>

            <h3 style="font-size: 1em; margin-bottom: 10px;"><i class="fas fa-database"></i> Données utilisées</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px;">
              {depLabels.map((label, i) => (
                <span key={`dep-${i}`} class="esono-badge esono-badge--info">{label}</span>
              ))}
            </div>

            <h3 style="font-size: 1em; margin-bottom: 10px;"><i class="fas fa-file-export"></i> Livrables générés</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin-bottom: 24px;" dangerouslySetInnerHTML={{ __html: outputsHtml }} />

            <div style="text-align: center; padding-top: 16px;">
              <a href={`/module/${moduleCode}/generate`} class="esono-btn esono-btn--primary" style={`background: ${definition.color}; border-color: ${definition.color};`}>
                <i class="fas fa-wand-magic-sparkles"></i>
                Générer le livrable
              </a>
            </div>
          </div>
        </section>
      </div>
    )

    return c.html(
      renderEsanoLayout({
        pageTitle: `Module ${definition.moduleNumber} — ${definition.title}`,
        pageDescription: definition.summary,
        activeNav: 'dashboard',
        content: pageContent,
        breadcrumb: [
          { label: 'Tableau de bord', href: '/dashboard' },
          { label: `Module ${definition.moduleNumber}` }
        ]
      })
    )
  } catch (error) {
    console.error('Module overview error:', error)
    return c.redirect('/dashboard')
  }
})

// Page module automatique - Génération
app.get('/module/:code/generate', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    const definition = getLearningModuleDefinition(moduleCode)

    if (!definition) return c.redirect('/dashboard')

    const pageContent = (
      <div class="esono-dashboard-stack">
        <section class="esono-card">
          <div class="esono-card__body" style="text-align: center; padding: 60px 20px;">
            <div style={`width: 80px; height: 80px; border-radius: 20px; background: ${definition.color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 2em; margin: 0 auto 20px;`}>
              <i class={definition.icon}></i>
            </div>
            <h2 style="margin-bottom: 8px;">Génération en cours...</h2>
            <p class="esono-text-muted" style="margin-bottom: 24px;">
              L'IA analyse vos données et génère le livrable. Cette opération peut prendre quelques instants.
            </p>
            <div class="esono-progress" style="max-width: 400px; margin: 0 auto 24px;">
              <div class="esono-progress__bar" style="width: 0%; animation: progressAnim 8s ease-in-out forwards;"></div>
            </div>
            <p class="esono-text-sm esono-text-muted">
              <i class="fas fa-spinner fa-spin"></i> Traitement des données de {definition.dependencies.length} module(s) source...
            </p>
            <div style="margin-top: 32px;">
              <a href={`/module/${moduleCode}/download`} class="esono-btn esono-btn--primary">
                <i class="fas fa-download"></i> Accéder aux livrables
              </a>
            </div>
          </div>
        </section>
      </div>
    )

    return c.html(
      renderEsanoLayout({
        pageTitle: `Génération — ${definition.title}`,
        pageDescription: 'Traitement IA en cours...',
        activeNav: 'dashboard',
        content: pageContent,
        extraScripts: `
          @keyframes progressAnim {
            0% { width: 0%; }
            50% { width: 65%; }
            80% { width: 88%; }
            100% { width: 100%; }
          }
        `
      })
    )
  } catch (error) {
    console.error('Module generate error:', error)
    return c.redirect('/dashboard')
  }
})

// Page Livrables centralisée
app.get('/livrables', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const data = await getUserWithProgress(c.env.DB, payload.userId)
    if (!data) return c.redirect('/login')

    const { user, modules: dbModules, progress } = data
    const progressList = (progress as any[]) ?? []
    const dbModulesList = (dbModules as any[]) ?? []

    const completedCodes = new Set<string>()
    for (const entry of progressList) {
      if (entry?.status === 'completed' || entry?.status === 'validated') {
        const dbMod = dbModulesList.find((m: any) => m.id === entry.module_id)
        if (dbMod?.module_code) completedCodes.add(dbMod.module_code as string)
      }
    }

    const allDeliverables = getAllDeliverables()

    const headerActions = (
      <div class="esono-header-actions">
        <a href="/dashboard" class="esono-btn esono-btn--ghost">
          <i class="fas fa-arrow-left"></i> Retour au tableau de bord
        </a>
      </div>
    )

    const pageContent = (
      <div class="esono-dashboard-stack">
        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-folder-open esono-card__title-icon"></i>
              Tous les livrables
            </h2>
            <span class="esono-badge esono-badge--info">
              {allDeliverables.reduce((acc, d) => acc + d.outputs.length, 0)} fichiers
            </span>
          </div>
          <div class="esono-card__body">
            <p class="esono-text-muted" style="margin-bottom: 20px;">
              Les livrables sont générés module par module. Complétez les modules hybrides (1-3) pour débloquer la génération des modules automatiques (4-8).
            </p>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              {allDeliverables.map((d) => {
                const isGenerated = completedCodes.has(d.moduleCode)
                const definition = getLearningModuleDefinition(d.moduleCode)
                return (
                  <div key={`liv-${d.moduleCode}`} style={`padding: 16px; border: 1px solid ${isGenerated ? 'rgba(5,150,105,0.3)' : 'rgba(0,0,0,0.1)'}; border-radius: 12px; background: ${isGenerated ? 'rgba(5,150,105,0.03)' : 'white'};`}>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <div style={`width: 32px; height: 32px; border-radius: 8px; background: ${definition?.color ?? '#666'}; color: white; display: flex; align-items: center; justify-content: center; font-size: 0.8em;`}>
                          <i class={definition?.icon ?? 'fas fa-file'}></i>
                        </div>
                        <div>
                          <strong style="font-size: 0.95em;">Module {d.moduleNumber} — {d.moduleTitle}</strong>
                          <br />
                          <span class="esono-text-xs esono-text-muted">
                            {definition?.category === 'hybrid' ? 'Module hybride' : 'Module automatique'}
                          </span>
                        </div>
                      </div>
                      <span class={isGenerated ? 'esono-badge esono-badge--success' : 'esono-badge esono-badge--neutral'}>
                        <i class={isGenerated ? 'fas fa-check-circle' : 'fas fa-hourglass-half'}></i>
                        {isGenerated ? 'Généré' : 'En attente'}
                      </span>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                      {d.outputs.map((output, i) => (
                        <div key={`out-${i}`} style={`padding: 8px 12px; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; display: flex; align-items: center; gap: 8px; background: ${isGenerated ? 'white' : '#fafafa'};`}>
                          <span style="padding: 2px 8px; background: rgba(124,58,237,0.1); color: #7c3aed; border-radius: 4px; font-size: 0.75em; font-weight: 600;">
                            {output.format.toUpperCase()}
                          </span>
                          <span style="font-size: 0.8em; color: #555;">{output.description}</span>
                          {isGenerated && (
                            <button class="esono-btn esono-btn--ghost" style="padding: 2px 8px; font-size: 0.75em;">
                              <i class="fas fa-download"></i>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </div>
    )

    return c.html(
      renderEsanoLayout({
        pageTitle: 'Livrables',
        pageDescription: 'Téléchargez vos livrables générés',
        activeNav: 'livrables',
        content: pageContent,
        headerActions
      })
    )
  } catch (error) {
    console.error('Livrables page error:', error)
    return c.redirect('/dashboard')
  }
})

// API: Save quiz results
app.post('/api/module/quiz', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) {
      return c.json({ error: 'Non authentifié' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.json({ error: 'Token invalide' }, 401)
    }

    const { module_code, score, passed, answers } = await c.req.json()

    // Get module
    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(module_code).first()

    if (!module) {
      return c.json({ error: 'Module non trouvé' }, 404)
    }

    // Get progress
    const progress = await c.env.DB.prepare(`
      SELECT id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (progress) {
      // Update progress
      await c.env.DB.prepare(`
        UPDATE progress 
        SET quiz_score = ?, quiz_passed = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(score, passed ? 1 : 0, progress.id).run()

      // Save quiz attempt
      await c.env.DB.prepare(`
        INSERT INTO quiz_attempts (progress_id, score, passed, answers_json)
        VALUES (?, ?, ?, ?)
      `).bind(progress.id, score, passed ? 1 : 0, JSON.stringify(answers)).run()
    }

    return c.json({ success: true, score, passed })
  } catch (error) {
    console.error('Quiz save error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Save single answer
app.post('/api/module/answer', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const { module_code, question_number, answer } = await c.req.json()

    // Get module and progress
    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(module_code).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    // Save to questions table (existing logic)
    const existing = await c.env.DB.prepare(`
      SELECT id FROM questions WHERE progress_id = ? AND question_number = ?
    `).bind(progress.id, question_number).first()

    if (existing) {
      await c.env.DB.prepare(`
        UPDATE questions 
        SET user_response = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(answer, existing.id).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO questions (progress_id, question_number, question_text, user_response)
        VALUES (?, ?, ?, ?)
      `).bind(progress.id, question_number, `Question ${question_number}`, answer).run()
    }

    // Also save to user_answers table for B5/B7 compatibility
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO user_answers (user_id, module_code, question_id, answer_text, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).bind(payload.userId, module_code, question_number, answer).run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Answer save error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Submit all answers
app.post('/api/module/submit-answers', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const { module_code, answers } = await c.req.json()

    // Get module and progress
    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(module_code).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    // Save all answers
    for (const ans of answers) {
      const existing = await c.env.DB.prepare(`
        SELECT id FROM questions WHERE progress_id = ? AND question_number = ?
      `).bind(progress.id, ans.question_number).first()

      if (existing) {
        await c.env.DB.prepare(`
          UPDATE questions 
          SET user_response = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(ans.answer, existing.id).run()
      } else {
        await c.env.DB.prepare(`
          INSERT INTO questions (progress_id, question_number, question_text, user_response)
          VALUES (?, ?, ?, ?)
        `).bind(progress.id, ans.question_number, `Question ${ans.question_number}`, ans.answer).run()
      }
      
      // Also save to user_answers
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO user_answers (user_id, module_code, question_id, answer_text, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(payload.userId, module_code, ans.question_number, ans.answer).run()
    }

    // Update progress status
    await c.env.DB.prepare(`
      UPDATE progress 
      SET status = 'in_progress', current_question = 9, updated_at = datetime('now')
      WHERE id = ?
    `).bind(progress.id).run()

    // ── Trigger Claude AI analysis (non-blocking on failure) ──
    let analysisReady = false
    let analysisError: string | undefined
    try {
      const aiAnswers: AnswerInput[] = answers.map((a: any) => ({
        question_number: a.question_number,
        answer: a.answer || ''
      }))

      const { analysis, source, error } = await analyzeWithClaude(
        c.env.ANTHROPIC_API_KEY,
        module_code,
        aiAnswers
      )

      // Store analysis in module_analyses table
      await c.env.DB.prepare(`
        INSERT INTO module_analyses (user_id, module_code, global_score, global_level, analysis_json, source, error_message, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, module_code) DO UPDATE SET
          global_score = excluded.global_score,
          global_level = excluded.global_level,
          analysis_json = excluded.analysis_json,
          source = excluded.source,
          error_message = excluded.error_message,
          updated_at = datetime('now')
      `).bind(
        payload.userId,
        module_code,
        analysis.globalScore,
        analysis.globalLevel,
        JSON.stringify(analysis),
        source,
        error || null
      ).run()

      // Also update progress.ai_score
      await c.env.DB.prepare(`
        UPDATE progress SET ai_score = ?, ai_last_analysis = datetime('now'), updated_at = datetime('now') WHERE id = ?
      `).bind(analysis.globalScore, progress.id).run()

      analysisReady = true
      if (error) analysisError = error
    } catch (aiErr: any) {
      console.error('Claude analysis error on submit:', aiErr.message || aiErr)
      analysisError = 'Analyse IA temporairement indisponible'
    }

    return c.json({ success: true, analysisReady, analysisError })
  } catch (error) {
    console.error('Submit answers error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// Activity report APIs (Phase 1 bis)
app.get('/api/activity-report/inputs', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleQuery = c.req.query('module')?.trim()
    const moduleCode = moduleQuery && moduleQuery.length ? moduleQuery : 'step1_activity_report'

    if (!ACTIVITY_REPORT_ALLOWED_MODULES.has(moduleCode)) {
      return c.json({ error: 'Module non supporté par cette API.' }, 400)
    }

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title, description
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module introuvable' }, 404)
    }

    const moduleId = Number(module.id)
    if (Number.isNaN(moduleId)) {
      return c.json({ error: 'Module invalide' }, 400)
    }

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, moduleId)
    const inputs = await getActivityReportInputsRow(c.env.DB, payload.userId, moduleId)

    return c.json({
      success: true,
      module: {
        code: module.module_code,
        title: module.title,
        description: module.description
      },
      progress,
      inputs
    })
  } catch (error) {
    console.error('Activity report inputs fetch error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.post('/api/activity-report/inputs', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const moduleCodeRaw = typeof body.moduleCode === 'string' ? body.moduleCode : (typeof body.module_code === 'string' ? body.module_code : null)
    const moduleCode = moduleCodeRaw && moduleCodeRaw.trim().length ? moduleCodeRaw.trim() : 'step1_activity_report'

    if (!ACTIVITY_REPORT_ALLOWED_MODULES.has(moduleCode)) {
      return c.json({ error: 'Module non supporté par cette API.' }, 400)
    }

    const rawPayload = (body.payload ?? body.data ?? body.inputs ?? {}) as Record<string, unknown>
    const sanitized = sanitizeActivityReportPayload(rawPayload)

    if (Object.keys(sanitized).length === 0) {
      return c.json({ error: 'Aucune donnée à enregistrer' }, 400)
    }

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module introuvable' }, 404)
    }

    const moduleId = Number(module.id)
    if (Number.isNaN(moduleId)) {
      return c.json({ error: 'Module invalide' }, 400)
    }

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, moduleId)
    const existing = await getActivityReportInputsRow(c.env.DB, payload.userId, moduleId)

    const columns = Object.keys(sanitized)

    if (existing?.id) {
      const assignments = columns.map((column) => `${column} = ?`).join(', ')
      const values = columns.map((column) => (sanitized as Record<string, unknown>)[column])
      await c.env.DB.prepare(`
        UPDATE activity_report_inputs
        SET ${assignments}, project_id = ?, progress_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(...values, progress.project_id ?? null, progress.id, existing.id).run()
    } else {
      const baseColumns = ['user_id', 'project_id', 'module_id', 'progress_id']
      const allColumns = [...baseColumns, ...columns]
      const placeholders = allColumns.map(() => '?').join(', ')
      const values = [
        payload.userId,
        progress.project_id ?? null,
        moduleId,
        progress.id,
        ...columns.map((column) => (sanitized as Record<string, unknown>)[column])
      ]

      await c.env.DB.prepare(`
        INSERT INTO activity_report_inputs (${allColumns.join(', ')})
        VALUES (${placeholders})
      `).bind(...values).run()
    }

    await c.env.DB.prepare(`
      UPDATE progress
      SET status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(progress.id).run()

    const refreshed = await getActivityReportInputsRow(c.env.DB, payload.userId, moduleId)

    return c.json({
      success: true,
      inputs: refreshed
    })
  } catch (error) {
    console.error('Activity report inputs save error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.post('/api/activity-report/analyze', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as { moduleCode?: string; analysisType?: string }
    const moduleCode = body?.moduleCode?.trim() || 'step1_activity_report'

    if (!ACTIVITY_REPORT_ALLOWED_MODULES.has(moduleCode)) {
      return c.json({ error: 'Module non supporté par cette API.' }, 400)
    }

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module introuvable' }, 404)
    }

    const moduleId = Number(module.id)
    if (Number.isNaN(moduleId)) {
      return c.json({ error: 'Module invalide' }, 400)
    }

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, moduleId)
    const inputs = await getActivityReportInputsRow(c.env.DB, payload.userId, moduleId)

    if (!inputs) {
      return c.json({ error: 'Veuillez compléter le formulaire avant de lancer l’analyse.' }, 400)
    }

    const analysis = analyseActivityReportNarrative(inputs)
    const nowIso = new Date().toISOString()
    const summaryPayload = buildActivityReportSummaryPayload(analysis, nowIso)

    await c.env.DB.prepare(`
      INSERT INTO activity_report_analysis_logs (progress_id, analysis_type, overall_score, clarity_score, realism_score, precision_score, summary_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(progress.id, body?.analysisType ?? 'auto', analysis.overallScore, analysis.clarityScore, analysis.realismScore, analysis.precisionScore, JSON.stringify(summaryPayload)).run()

    await c.env.DB.prepare(`
      UPDATE progress
      SET ai_score = ?,
          ai_feedback_json = ?,
          narrative_last_refresh = datetime('now'),
          ai_last_analysis = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(analysis.overallScore, JSON.stringify(summaryPayload), progress.id).run()

    const summaryText = `Analyse IA du ${new Date(nowIso).toLocaleDateString('fr-FR')}  · Score ${analysis.overallScore}%`

    await c.env.DB.prepare(`
      UPDATE deliverables
      SET status = 'draft',
          summary = ?,
          ai_score = ?
      WHERE user_id = ? AND module_id = ? AND deliverable_type = 'activity_report'
    `).bind(summaryText, analysis.overallScore, payload.userId, moduleId).run()

    return c.json({
      success: true,
      analysis,
      summary: summaryPayload
    })
  } catch (error) {
    console.error('Activity report analysis error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.get('/api/activity-report/deliverable', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleQuery = c.req.query('module')?.trim()
    const moduleCode = moduleQuery && moduleQuery.length ? moduleQuery : 'step1_activity_report'

    if (!ACTIVITY_REPORT_ALLOWED_MODULES.has(moduleCode)) {
      return c.json({ error: 'Module non supporté par cette API.' }, 400)
    }

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module introuvable' }, 404)
    }

    const moduleId = Number(module.id)
    if (Number.isNaN(moduleId)) {
      return c.json({ error: 'Module invalide' }, 400)
    }

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, moduleId)

    const deliverable = await c.env.DB.prepare(`
      SELECT id, title, summary, ai_score, content_json, status, validated_at, coach_comment
      FROM deliverables
      WHERE user_id = ? AND module_id = ? AND deliverable_type = 'activity_report'
      ORDER BY id DESC
      LIMIT 1
    `).bind(payload.userId, moduleId).first()

    let content: any = null
    if (deliverable?.content_json) {
      try {
        content = JSON.parse(deliverable.content_json as string)
      } catch (error) {
        console.warn('Impossible de parser le contenu du livrable activité', error)
      }
    }

    const analysisHistory = await c.env.DB.prepare(`
      SELECT overall_score, clarity_score, realism_score, precision_score, summary_json, created_at
      FROM activity_report_analysis_logs
      WHERE progress_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `).bind(progress.id).all()

    return c.json({
      success: true,
      deliverable: deliverable
        ? {
            id: deliverable.id,
            title: deliverable.title,
            summary: deliverable.summary,
            ai_score: deliverable.ai_score,
            status: deliverable.status,
            validated_at: deliverable.validated_at,
            coach_comment: deliverable.coach_comment,
            content
          }
        : null,
      analysisHistory: Array.isArray(analysisHistory.results) ? analysisHistory.results : []
    })
  } catch (error) {
    console.error('Activity report deliverable fetch error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.post('/api/activity-report/deliverable', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as { moduleCode?: string }
    const moduleCode = body?.moduleCode?.trim() || 'step1_activity_report'

    if (!ACTIVITY_REPORT_ALLOWED_MODULES.has(moduleCode)) {
      return c.json({ error: 'Module non supporté par cette API.' }, 400)
    }

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module introuvable' }, 404)
    }

    const moduleId = Number(module.id)
    if (Number.isNaN(moduleId)) {
      return c.json({ error: 'Module invalide' }, 400)
    }

    const progressRow = await c.env.DB.prepare(`
      SELECT id, project_id, ai_score, ai_feedback_json, narrative_last_refresh
      FROM progress
      WHERE user_id = ? AND module_id = ?
      LIMIT 1
    `).bind(payload.userId, moduleId).first()

    if (!progressRow?.id) {
      return c.json({ error: 'Progress non trouvé' }, 404)
    }

    const progressId = Number(progressRow.id)
    const inputs = await getActivityReportInputsRow(c.env.DB, payload.userId, moduleId)

    if (!inputs) {
      return c.json({ error: 'Aucune donnée enregistrée pour générer le livrable.' }, 400)
    }

    let summaryPayload: any = null
    if (progressRow.ai_feedback_json) {
      try {
        summaryPayload = JSON.parse(progressRow.ai_feedback_json as string)
      } catch (error) {
        console.warn('Impossible de parser le résumé IA existant', error)
      }
    }

    let analysis = summaryPayload && summaryPayload?.dimensions
      ? {
          clarityScore: summaryPayload.dimensions?.clarity?.score ?? 0,
          realismScore: summaryPayload.dimensions?.realism?.score ?? 0,
          precisionScore: summaryPayload.dimensions?.precision?.score ?? 0,
          overallScore: summaryPayload.overallScore ?? 0,
          strengths: Array.isArray(summaryPayload.strengths) ? summaryPayload.strengths : [],
          improvements: Array.isArray(summaryPayload.improvements) ? summaryPayload.improvements : [],
          missingSections: Array.isArray(summaryPayload.missingSections) ? summaryPayload.missingSections : []
        } as ActivityReportAnalysisResult
      : null

    if (!analysis) {
      const freshAnalysis = analyseActivityReportNarrative(inputs)
      const nowIso = new Date().toISOString()
      summaryPayload = buildActivityReportSummaryPayload(freshAnalysis, nowIso)
      analysis = freshAnalysis

      await c.env.DB.prepare(`
        INSERT INTO activity_report_analysis_logs (progress_id, analysis_type, overall_score, clarity_score, realism_score, precision_score, summary_json)
        VALUES (?, 'auto', ?, ?, ?, ?, ?)
      `).bind(progressId, freshAnalysis.overallScore, freshAnalysis.clarityScore, freshAnalysis.realismScore, freshAnalysis.precisionScore, JSON.stringify(summaryPayload)).run()

      await c.env.DB.prepare(`
        UPDATE progress
        SET ai_score = ?,
            ai_feedback_json = ?,
            narrative_last_refresh = datetime('now'),
            ai_last_analysis = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(freshAnalysis.overallScore, JSON.stringify(summaryPayload), progressId).run()
    }

    const nowIso = new Date().toISOString()
    const deliverableUrl = `/module/${moduleCode}/download`

    const deliverableContent = {
      moduleCode,
      generatedAt: nowIso,
      summary: summaryPayload,
      sections: ACTIVITY_REPORT_TEXT_FIELDS.reduce((acc, key) => {
        acc[key] = inputs[key] ?? null
        return acc
      }, {} as Record<ActivityReportFieldKey, string | null>),
      strengths: analysis.strengths,
      improvements: analysis.improvements,
      missingSections: analysis.missingSections
    }

    const summaryText = `Rapport généré le ${new Date(nowIso).toLocaleDateString('fr-FR')}  · Score ${analysis.overallScore}%`

    const existingDeliverable = await c.env.DB.prepare(`
      SELECT id
      FROM deliverables
      WHERE user_id = ? AND module_id = ? AND deliverable_type = 'activity_report'
      LIMIT 1
    `).bind(payload.userId, moduleId).first()

    if (existingDeliverable?.id) {
      await c.env.DB.prepare(`
        UPDATE deliverables
        SET title = ?,
            file_url = ?,
            content_json = ?,
            status = 'ready',
            summary = ?,
            ai_score = ?,
            validated_at = datetime('now')
        WHERE id = ?
      `).bind(
        `${module.title ?? "Rapport d'activité"} – Diagnostic narratif`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        analysis.overallScore,
        existingDeliverable.id
      ).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO deliverables (
          user_id,
          project_id,
          module_id,
          deliverable_type,
          title,
          file_url,
          content_json,
          status,
          summary,
          ai_score,
          coach_comment,
          validated_at,
          created_at
        ) VALUES (?, ?, ?, 'activity_report', ?, ?, ?, 'ready', ?, ?, NULL, datetime('now'), datetime('now'))
      `).bind(
        payload.userId,
        progressRow.project_id ?? null,
        moduleId,
        `${module.title ?? "Rapport d'activité"} – Diagnostic narratif`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        analysis.overallScore
      ).run()
    }

    await c.env.DB.prepare(`
      UPDATE progress
      SET narrative_last_refresh = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(progressId).run()

    return c.json({
      success: true,
      deliverable: {
        title: `${module.title ?? "Rapport d'activité"} – Diagnostic narratif`,
        summary: summaryText,
        ai_score: analysis.overallScore,
        content: deliverableContent,
        url: deliverableUrl
      }
    })
  } catch (error) {
    console.error('Activity report deliverable generation error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// Finance APIs (Phase 2)
app.get('/api/finance/inputs', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.query('module')?.trim() || 'step2_financial_analysis'

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title, description
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module financier introuvable' }, 404)
    }

    if (getModuleVariant(module.module_code as string) !== 'finance') {
      return c.json({ error: 'Ce module ne correspond pas à la phase financière.' }, 400)
    }

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, Number(module.id))
    const inputs = await getFinancialInputsRow(c.env.DB, payload.userId, Number(module.id))

    return c.json({
      success: true,
      module: {
        code: module.module_code,
        title: module.title,
        description: module.description
      },
      progress,
      inputs
    })
  } catch (error) {
    console.error('Finance inputs fetch error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.post('/api/finance/inputs', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const moduleCode = (typeof body.moduleCode === 'string' && body.moduleCode.trim().length)
      ? body.moduleCode.trim()
      : (typeof body.module_code === 'string' && body.module_code.trim().length)
        ? body.module_code.trim()
        : 'step2_financial_analysis'

    const rawData = (body.payload ?? body.data ?? body.inputs ?? {}) as Record<string, unknown>
    const sanitized = sanitizeFinancialPayload(rawData)

    if (Object.keys(sanitized).length === 0) {
      return c.json({ error: 'Aucune donnée à enregistrer' }, 400)
    }

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module financier introuvable' }, 404)
    }

    if (getModuleVariant(module.module_code as string) !== 'finance') {
      return c.json({ error: 'Ce module ne correspond pas à la phase financière.' }, 400)
    }

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, Number(module.id))
    const existing = await getFinancialInputsRow(c.env.DB, payload.userId, Number(module.id))

    if (existing?.id) {
      const columns = Object.keys(sanitized)
      if (columns.length > 0) {
        const assignments = columns.map((column) => `${column} = ?`).join(', ')
        const values = columns.map((column) => (sanitized as Record<string, unknown>)[column])
        await c.env.DB.prepare(`
          UPDATE financial_inputs
          SET ${assignments}, updated_at = datetime('now')
          WHERE id = ?
        `).bind(...values, existing.id).run()
      }
    } else {
      const columns = Object.keys(sanitized)
      const baseColumns = ['user_id', 'project_id', 'module_id', 'progress_id']
      const allColumns = [...baseColumns, ...columns]
      const placeholders = allColumns.map(() => '?').join(', ')
      const values = [
        payload.userId,
        progress.project_id ?? null,
        Number(module.id),
        progress.id,
        ...columns.map((column) => (sanitized as Record<string, unknown>)[column])
      ]

      await c.env.DB.prepare(`
        INSERT INTO financial_inputs (${allColumns.join(', ')})
        VALUES (${placeholders})
      `).bind(...values).run()
    }

    await c.env.DB.prepare(`
      UPDATE progress
      SET status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(progress.id).run()

    const refreshedInputs = await getFinancialInputsRow(c.env.DB, payload.userId, Number(module.id))

    return c.json({
      success: true,
      module: {
        code: module.module_code,
        title: module.title
      },
      inputs: refreshedInputs
    })
  } catch (error) {
    console.error('Finance inputs save error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.post('/api/finance/analyze', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const moduleCode = (typeof body.moduleCode === 'string' && body.moduleCode.trim().length)
      ? body.moduleCode.trim()
      : 'step2_financial_analysis'

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module financier introuvable' }, 404)
    }

    if (getModuleVariant(module.module_code as string) !== 'finance') {
      return c.json({ error: 'Ce module ne correspond pas à la phase financière.' }, 400)
    }

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, Number(module.id))
    const inputs = await getFinancialInputsRow(c.env.DB, payload.userId, Number(module.id))

    if (!inputs) {
      return c.json({ error: 'Veuillez d’abord remplir vos données financières (étape B3).' }, 400)
    }

    const analysis = calculateFinancialMetrics(inputs)

    await c.env.DB.prepare(`
      DELETE FROM financial_metrics WHERE progress_id = ?
    `).bind(progress.id).run()

    for (const metric of analysis.metrics) {
      await c.env.DB.prepare(`
        INSERT INTO financial_metrics (progress_id, metric_code, metric_label, value, status, explanation)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        progress.id,
        metric.code,
        metric.label,
        metric.value,
        metric.status,
        metric.explanation
      ).run()
    }

    await c.env.DB.prepare(`
      INSERT INTO financial_analysis_logs (progress_id, analysis_type, overall_score, summary_json)
      VALUES (?, ?, ?, ?)
    `).bind(
      progress.id,
      body?.analysisType ?? 'auto',
      analysis.overallScore,
      JSON.stringify({ ...analysis.summary, overallScore: analysis.overallScore })
    ).run()

    await c.env.DB.prepare(`
      UPDATE progress
      SET financial_score = ?,
          financial_summary_json = ?,
          financial_last_refresh = datetime('now'),
          ai_score = ?,
          ai_last_analysis = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      analysis.overallScore,
      JSON.stringify(analysis.summary),
      analysis.overallScore,
      progress.id
    ).run()

    await c.env.DB.prepare(`
      UPDATE deliverables
      SET status = 'draft'
      WHERE user_id = ? AND module_id = ? AND deliverable_type = 'report'
    `).bind(payload.userId, module.id).run()

    return c.json({
      success: true,
      analysis,
      module: {
        code: module.module_code,
        title: module.title
      }
    })
  } catch (error) {
    console.error('Finance analysis error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.post('/api/finance/validate', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as { moduleCode?: string; comment?: string }
    const moduleCode = body?.moduleCode?.trim() || 'step2_financial_analysis'

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module financier introuvable' }, 404)
    }

    if (getModuleVariant(module.module_code as string) !== 'finance') {
      return c.json({ error: 'Ce module ne correspond pas à la phase financière.' }, 400)
    }

    const progressRow = await c.env.DB.prepare(`
      SELECT id, project_id, financial_score, financial_summary_json, financial_last_refresh,
             quiz_passed, quiz_score, status
      FROM progress
      WHERE user_id = ? AND module_id = ?
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    if (!progressRow?.id) {
      return c.json({ error: 'Progress non trouvé' }, 404)
    }

    const progress = {
      id: Number(progressRow.id),
      project_id: progressRow.project_id !== undefined && progressRow.project_id !== null ? Number(progressRow.project_id) : null,
      financial_score: typeof progressRow.financial_score === 'number' ? Number(progressRow.financial_score) : null,
      financial_summary_json: typeof progressRow.financial_summary_json === 'string' ? progressRow.financial_summary_json : null,
      financial_last_refresh: progressRow.financial_last_refresh as string | null,
      quiz_passed: Number(progressRow.quiz_passed ?? 0) === 1,
      quiz_score: typeof progressRow.quiz_score === 'number' ? Number(progressRow.quiz_score) : null,
      status: typeof progressRow.status === 'string' ? progressRow.status : 'in_progress'
    }

    const inputs = await getFinancialInputsRow(c.env.DB, payload.userId, Number(module.id))
    if (!inputs) {
      return c.json({ error: 'Veuillez d’abord compléter vos données financières (étape B3).' }, 400)
    }

    const metricsRes = await c.env.DB.prepare(`
      SELECT metric_code, metric_label, value, status, explanation
      FROM financial_metrics
      WHERE progress_id = ?
    `).bind(progress.id).all()

    const metrics = Array.isArray(metricsRes.results) ? metricsRes.results as any[] : []
    if (metrics.length === 0) {
      return c.json({ error: 'Aucune analyse trouvée. Relancez l’étape B4 avant de valider.' }, 400)
    }

    const overallScore = progress.financial_score ?? Math.round(
      metrics.reduce((acc, metric: any) => acc + FINANCIAL_METRIC_SCORES[(metric.status as FinancialMetricStatus) ?? 'critical'], 0) / metrics.length
    )

    const summary = progress.financial_summary_json
      ? JSON.parse(progress.financial_summary_json)
      : {
          highlights: metrics.filter((metric: any) => metric.status === 'ok').map((metric: any) => `${metric.metric_label} : ${formatNumber(metric.value ?? null)}`),
          warnings: metrics.filter((metric: any) => metric.status === 'attention').map((metric: any) => `${metric.metric_label} à surveiller`),
          risks: metrics.filter((metric: any) => metric.status === 'critical').map((metric: any) => `${metric.metric_label} critique`)
        }

    const quizPassed = progress.quiz_passed
    const blockingReasons: string[] = []

    if (!quizPassed) {
      blockingReasons.push('Le quiz de l’étape B2 doit être réussi avec un score d’au moins 80 %.')
    }

    if (!isFinancialAnalysisFresh(progress.financial_last_refresh)) {
      blockingReasons.push('L’analyse IA doit dater de moins de 7 jours. Relancez B4 pour rafraîchir les données.')
    }

    if (overallScore < FINANCE_VALIDATION_SCORE) {
      blockingReasons.push(`Le score financier doit atteindre au moins ${FINANCE_VALIDATION_SCORE} % (score actuel : ${overallScore} %).`)
    }

    const requiredFields: Array<{ key: keyof FinancialInputsRecord; label: string }> = [
      { key: 'revenue_total', label: 'Chiffre d’affaires' },
      { key: 'ebitda', label: 'EBITDA' },
      { key: 'cash_on_hand', label: 'Trésorerie disponible' },
      { key: 'runway_months', label: 'Runway' }
    ]

    requiredFields.forEach((field) => {
      const value = inputs[field.key]
      if (value === null || value === undefined) {
        blockingReasons.push(`${field.label} doit être renseigné pour valider le diagnostic.`)
      }
    })

    if (blockingReasons.length > 0) {
      return c.json({ error: 'Conditions de validation non remplies', blockingReasons }, 400)
    }

    const nowIso = new Date().toISOString()
    const deliverableUrl = `/module/${moduleCode}/download`

    await c.env.DB.prepare(`
      UPDATE progress
      SET status = 'validated',
          validated_at = datetime('now'),
          completed_at = COALESCE(completed_at, datetime('now')),
          updated_at = datetime('now'),
          financial_score = ?,
          financial_summary_json = ?,
          financial_last_refresh = COALESCE(financial_last_refresh, datetime('now')),
          ai_score = ?
      WHERE id = ?
    `).bind(
      overallScore,
      JSON.stringify(summary),
      overallScore,
      progress.id
    ).run()

    const deliverableContent = {
      moduleCode,
      generatedAt: nowIso,
      overallScore,
      summary,
      metrics: metrics.map((metric: any) => ({
        code: metric.metric_code,
        label: metric.metric_label,
        value: metric.value,
        status: metric.status,
        explanation: metric.explanation
      })),
      inputs: {
        period: inputs.period_label,
        currency: inputs.currency ?? 'XOF',
        revenue: inputs.revenue_total,
        ebitda: inputs.ebitda,
        netIncome: inputs.net_income,
        cashOnHand: inputs.cash_on_hand,
        runwayMonths: inputs.runway_months,
        debtService: inputs.debt_service
      }
    }

    const summaryText = `Diagnostic validé le ${new Date(nowIso).toLocaleDateString('fr-FR')} · Score financier ${overallScore}%`
    const kpiSummary = metrics.map((metric: any) => ({
      code: metric.metric_code,
      label: metric.metric_label,
      value: metric.value,
      status: metric.status
    }))

    const existingDeliverable = await c.env.DB.prepare(`
      SELECT id
      FROM deliverables
      WHERE user_id = ? AND module_id = ? AND deliverable_type = 'report'
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    if (existingDeliverable?.id) {
      await c.env.DB.prepare(`
        UPDATE deliverables
        SET title = ?,
            file_url = ?,
            content_json = ?,
            status = 'ready',
            summary = ?,
            ai_score = ?,
            coach_comment = ?,
            validated_at = datetime('now'),
            period_covered = ?,
            currency = ?,
            kpi_summary_json = ?
        WHERE id = ?
      `).bind(
        `${module.title ?? 'Analyse financière'} - Diagnostic validé`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        overallScore,
        body.comment ?? null,
        inputs.period_label ?? null,
        inputs.currency ?? 'XOF',
        JSON.stringify(kpiSummary),
        existingDeliverable.id
      ).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO deliverables (
          user_id,
          project_id,
          module_id,
          deliverable_type,
          title,
          file_url,
          content_json,
          status,
          summary,
          ai_score,
          coach_comment,
          validated_at,
          created_at,
          period_covered,
          currency,
          kpi_summary_json
        ) VALUES (?, ?, ?, 'report', ?, ?, ?, 'ready', ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?)
      `).bind(
        payload.userId,
        progress.project_id ?? null,
        module.id,
        `${module.title ?? 'Analyse financière'} - Diagnostic validé`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        overallScore,
        body.comment ?? null,
        inputs.period_label ?? null,
        inputs.currency ?? 'XOF',
        JSON.stringify(kpiSummary)
      ).run()
    }

    return c.json({
      success: true,
      validatedAt: nowIso,
      score: overallScore,
      deliverableUrl
    })
  } catch (error) {
    console.error('Finance validation error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.get('/api/finance/deliverable', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.query('module')?.trim() || 'step2_financial_analysis'

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module financier introuvable' }, 404)
    }

    if (getModuleVariant(module.module_code as string) !== 'finance') {
      return c.json({ error: 'Ce module ne correspond pas à la phase financière.' }, 400)
    }

    const progress = await c.env.DB.prepare(`
      SELECT id, status, financial_score, financial_summary_json, financial_last_refresh, validated_at
      FROM progress
      WHERE user_id = ? AND module_id = ?
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    if (!progress?.id) {
      return c.json({ error: 'Progress non trouvé' }, 404)
    }

    if (progress.status !== 'validated') {
      return c.json({ error: 'Diagnostic non validé', status: progress.status }, 409)
    }

    const deliverable = await c.env.DB.prepare(`
      SELECT id, title, file_url, content_json, summary, ai_score, coach_comment, validated_at, status, period_covered, currency, kpi_summary_json
      FROM deliverables
      WHERE user_id = ? AND module_id = ? AND deliverable_type = 'report'
      ORDER BY validated_at DESC, created_at DESC
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    const inputs = await getFinancialInputsRow(c.env.DB, payload.userId, module.id)
    const metricsRes = await c.env.DB.prepare(`
      SELECT metric_code, metric_label, value, status, explanation
      FROM financial_metrics
      WHERE progress_id = ?
    `).bind(progress.id).all()
    const metrics = Array.isArray(metricsRes.results) ? metricsRes.results as any[] : []

    let content = null
    if (deliverable?.content_json) {
      try {
        content = JSON.parse(deliverable.content_json as string)
      } catch (error) {
        console.warn('Impossible de parser le livrable financier', error)
      }
    }

    return c.json({
      success: true,
      module: {
        code: module.module_code,
        title: module.title
      },
      progress: {
        status: progress.status,
        score: typeof progress.financial_score === 'number' ? Number(progress.financial_score) : null,
        summary: progress.financial_summary_json ? JSON.parse(progress.financial_summary_json) : null,
        lastRefresh: progress.financial_last_refresh,
        validatedAt: progress.validated_at
      },
      deliverable: deliverable ? {
        id: deliverable.id,
        title: deliverable.title,
        fileUrl: deliverable.file_url,
        summary: deliverable.summary,
        score: deliverable.ai_score,
        coachComment: deliverable.coach_comment,
        validatedAt: deliverable.validated_at,
        status: deliverable.status,
        period: deliverable.period_covered,
        currency: deliverable.currency,
        kpiSummary: deliverable.kpi_summary_json ? JSON.parse(deliverable.kpi_summary_json as string) : null
      } : null,
      metrics,
      inputs,
      content
    })
  } catch (error) {
    console.error('Finance deliverable fetch error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

app.post('/api/finance/deliverable/refresh', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as { moduleCode?: string }
    const moduleCode = body?.moduleCode?.trim() || 'step2_financial_analysis'

    const module = await c.env.DB.prepare(`
      SELECT id, module_code, title
      FROM modules
      WHERE module_code = ?
      LIMIT 1
    `).bind(moduleCode).first()

    if (!module) {
      return c.json({ error: 'Module financier introuvable' }, 404)
    }

    if (getModuleVariant(module.module_code as string) !== 'finance') {
      return c.json({ error: 'Ce module ne correspond pas à la phase financière.' }, 400)
    }

    const progressRow = await c.env.DB.prepare(`
      SELECT id, financial_score, financial_summary_json, financial_last_refresh, status, project_id
      FROM progress
      WHERE user_id = ? AND module_id = ?
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    if (!progressRow?.id) {
      return c.json({ error: 'Progress non trouvé' }, 404)
    }

    if (progressRow.status !== 'validated') {
      return c.json({ error: 'Le module doit être validé avant de régénérer le livrable.', status: progressRow.status }, 409)
    }

    const metricsRes = await c.env.DB.prepare(`
      SELECT metric_code, metric_label, value, status, explanation
      FROM financial_metrics
      WHERE progress_id = ?
    `).bind(progressRow.id).all()
    const metrics = Array.isArray(metricsRes.results) ? metricsRes.results as any[] : []

    if (metrics.length === 0) {
      return c.json({ error: 'Aucune analyse existante. Relancez B4 avant la régénération.' }, 400)
    }

    const inputs = await getFinancialInputsRow(c.env.DB, payload.userId, module.id)
    const summary = progressRow.financial_summary_json ? JSON.parse(progressRow.financial_summary_json) : null
    const score = typeof progressRow.financial_score === 'number' ? Number(progressRow.financial_score) : null
    const nowIso = new Date().toISOString()
    const deliverableUrl = `/module/${moduleCode}/download`

    const deliverableContent = {
      moduleCode,
      refreshedAt: nowIso,
      summary,
      overallScore: score,
      metrics: metrics.map((metric: any) => ({
        code: metric.metric_code,
        label: metric.metric_label,
        value: metric.value,
        status: metric.status,
        explanation: metric.explanation
      })),
      inputs: inputs ? {
        period: inputs.period_label,
        currency: inputs.currency ?? 'XOF',
        revenue: inputs.revenue_total,
        ebitda: inputs.ebitda,
        netIncome: inputs.net_income,
        cashOnHand: inputs.cash_on_hand,
        runwayMonths: inputs.runway_months
      } : null
    }

    const summaryText = score !== null
      ? `Diagnostic régénéré le ${new Date(nowIso).toLocaleDateString('fr-FR')} · Score ${score}%`
      : `Diagnostic régénéré le ${new Date(nowIso).toLocaleDateString('fr-FR')}`

    const kpiSummary = metrics.map((metric: any) => ({
      code: metric.metric_code,
      label: metric.metric_label,
      value: metric.value,
      status: metric.status
    }))

    const deliverable = await c.env.DB.prepare(`
      SELECT id
      FROM deliverables
      WHERE user_id = ? AND module_id = ? AND deliverable_type = 'report'
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    if (deliverable?.id) {
      await c.env.DB.prepare(`
        UPDATE deliverables
        SET content_json = ?,
            summary = ?,
            validated_at = datetime('now'),
            status = 'ready',
            kpi_summary_json = ?,
            period_covered = ?,
            currency = ?,
            ai_score = COALESCE(ai_score, ?),
            file_url = ?
        WHERE id = ?
      `).bind(
        JSON.stringify(deliverableContent),
        summaryText,
        JSON.stringify(kpiSummary),
        inputs?.period_label ?? null,
        inputs?.currency ?? 'XOF',
        score,
        deliverableUrl,
        deliverable.id
      ).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO deliverables (
          user_id,
          project_id,
          module_id,
          deliverable_type,
          title,
          file_url,
          content_json,
          status,
          summary,
          ai_score,
          coach_comment,
          validated_at,
          created_at,
          period_covered,
          currency,
          kpi_summary_json
        ) VALUES (?, ?, ?, 'report', ?, ?, ?, 'ready', ?, ?, NULL, datetime('now'), datetime('now'), ?, ?, ?)
      `).bind(
        payload.userId,
        progressRow.project_id ?? null,
        module.id,
        `${module.title ?? 'Analyse financière'} - Diagnostic régénéré`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        score,
        inputs?.period_label ?? null,
        inputs?.currency ?? 'XOF',
        JSON.stringify(kpiSummary)
      ).run()
    }

    await c.env.DB.prepare(`
      UPDATE progress
      SET financial_last_refresh = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(progressRow.id).run()

    return c.json({
      success: true,
      refreshedAt: nowIso,
      summary: summaryText,
      score
    })
  } catch (error) {
    console.error('Finance deliverable refresh error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Save improved answer
app.post('/api/module/improve-answer', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const { module_code, question_number, improved_answer } = await c.req.json()

    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(module_code).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id, status FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    const question = await c.env.DB.prepare(`
      SELECT id, user_response FROM questions
      WHERE progress_id = ? AND question_number = ?
    `).bind(progress.id, question_number).first()

    if (!question) return c.json({ error: 'Question non trouvée' }, 404)

    const previousResponse = (question.user_response as string | null) ?? ''
    const normalizedPrevious = previousResponse.trim()
    const normalizedNew = improved_answer.trim()

    if (!normalizedNew.length) {
      return c.json({ error: 'Réponse vide non autorisée' }, 400)
    }

    if (normalizedPrevious === normalizedNew) {
      return c.json({ success: true, unchanged: true })
    }

    if (normalizedPrevious) {
      await c.env.DB.prepare(`
        INSERT INTO question_history (question_id, previous_response)
        VALUES (?, ?)
      `).bind(question.id, previousResponse).run()
    }

    await c.env.DB.prepare(`
      UPDATE questions 
      SET user_response = ?, 
          iteration_count = COALESCE(iteration_count, 0) + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(normalizedNew, question.id).run()

    // Also update user_answers
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO user_answers (user_id, module_code, question_id, answer_text, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).bind(payload.userId, module_code, question_number, normalizedNew).run()

    await c.env.DB.prepare(`
      UPDATE progress
      SET status = CASE WHEN status = 'validated' THEN 'in_progress' ELSE status END,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(progress.id).run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Improve answer error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Valider le module (B6)
app.post('/api/module/validate', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as { moduleCode?: string; comment?: string }
    const moduleCode = body?.moduleCode?.trim()
    const comment = typeof body?.comment === 'string' ? body.comment.trim() : ''

    if (!moduleCode) {
      return c.json({ error: 'moduleCode est requis' }, 400)
    }

    const module = await c.env.DB.prepare(`
      SELECT id, title, module_code
      FROM modules
      WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id, project_id, ai_score, ai_last_analysis, quiz_passed, quiz_score, status
      FROM progress
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    const questions = await c.env.DB.prepare(`
      SELECT question_number, question_text, user_response, ai_feedback, quality_score, iteration_count, updated_at
      FROM questions
      WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress.id).all()

    const questionRows = Array.isArray(questions.results) ? questions.results as any[] : []

    const snapshot = buildSectionsSnapshot(module.module_code as string, questionRows)
    const sections = snapshot.sections
    const expectedQuestionCount = sections.length
    const answeredBlocks = sections.filter((section) => section.answer.length > 0).length
    const missingAnswers = snapshot.missingAnswers
    const clarifications = snapshot.clarifications
    const qualityMissing = snapshot.qualityMissing
    const latestAnswerTimestamp = snapshot.latestAnswerTimestamp

    const aiScore = typeof progress.ai_score === 'number' ? Number(progress.ai_score) : 0
    const quizPassed = Number(progress.quiz_passed ?? 0) === 1
    const lastAnalysisDate = parseDateValue(progress.ai_last_analysis as string | null)
    const latestActivity = latestAnswerTimestamp ?? 0
    const needsRefresh = !!(lastAnalysisDate && latestActivity && latestActivity > lastAnalysisDate.getTime())

    const blockingReasons: string[] = []

    if (!quizPassed) {
      blockingReasons.push('Le quiz de validation (B2) doit être réussi avec un score d’au moins 80 %.')
    }

    if (!lastAnalysisDate) {
      blockingReasons.push('L’analyse IA (B4) doit être effectuée avant la validation.')
    }

    if (qualityMissing > 0) {
      blockingReasons.push('Relancez l’analyse IA après vos améliorations pour obtenir un score sur chaque bloc.')
    }

    if (needsRefresh) {
      blockingReasons.push('Certaines réponses ont été modifiées après la dernière analyse IA. Relancez l’étape B4 pour actualiser le score.')
    }

    if (answeredBlocks < expectedQuestionCount) {
      const missingCount = expectedQuestionCount - answeredBlocks
      blockingReasons.push(`${missingCount} bloc${missingCount > 1 ? 's' : ''} du Canvas n’est pas encore complété.`)
    }

    if (clarifications > 0) {
      blockingReasons.push(`L’IA attend encore des précisions sur ${clarifications} bloc${clarifications > 1 ? 's' : ''}.`)
    }

    if (aiScore < MIN_VALIDATION_SCORE) {
      blockingReasons.push(`Le score IA doit atteindre au moins ${MIN_VALIDATION_SCORE} % (score actuel : ${aiScore} %).`)
    }

    if (blockingReasons.length > 0) {
      return c.json({ error: 'Conditions de validation non remplies', blockingReasons }, 400)
    }

    const deliverableUrl = `/module/${moduleCode}/download`
    const nowIso = new Date().toISOString()

    await c.env.DB.prepare(`
      UPDATE progress
      SET status = 'validated',
          validated_at = datetime('now'),
          completed_at = COALESCE(completed_at, datetime('now')),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(progress.id).run()

    await c.env.DB.prepare(`
      UPDATE questions
      SET is_validated = 1
      WHERE progress_id = ?
    `).bind(progress.id).run()

    const deliverableContent = {
      moduleCode,
      validatedAt: nowIso,
      score: aiScore,
      sections: sections.map((section) => ({
        questionId: section.questionId,
        section: section.section,
        question: section.questionText,
        answer: section.answer,
        score: section.percentage,
        scoreLabel: section.scoreLabel,
        suggestions: section.suggestions,
        questions: section.questions
      }))
    }

    const summaryText = `Canvas validé le ${new Date(nowIso).toLocaleDateString('fr-FR')} · Score IA ${aiScore}%`

    const existingDeliverable = await c.env.DB.prepare(`
      SELECT id FROM deliverables WHERE user_id = ? AND module_id = ? LIMIT 1
    `).bind(payload.userId, module.id).first()

    if (existingDeliverable) {
      await c.env.DB.prepare(`
        UPDATE deliverables
        SET deliverable_type = ?,
            title = ?,
            file_url = ?,
            content_json = ?,
            status = 'ready',
            summary = ?,
            ai_score = ?,
            coach_comment = ?,
            validated_at = datetime('now')
        WHERE id = ?
      `).bind(
        'canvas',
        `${module.title ?? 'Module'} - Canvas validé`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        aiScore,
        comment || null,
        existingDeliverable.id
      ).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO deliverables (
          user_id,
          project_id,
          module_id,
          deliverable_type,
          title,
          file_url,
          content_json,
          status,
          summary,
          ai_score,
          coach_comment,
          validated_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(
        payload.userId,
        progress.project_id ?? null,
        module.id,
        'canvas',
        `${module.title ?? 'Module'} - Canvas validé`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        aiScore,
        comment || null
      ).run()
    }

    return c.json({
      success: true,
      validatedAt: nowIso,
      deliverableUrl,
      score: aiScore
    })
  } catch (error) {
    console.error('Validation error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Récupérer le livrable (B7)
app.get('/api/module/:code/deliverable', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.param('code')
    const module = await c.env.DB.prepare(`
      SELECT id, title, module_code
      FROM modules
      WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id, status, ai_score, validated_at, ai_last_analysis, quiz_score, quiz_passed
      FROM progress
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    if (progress.status !== 'validated') {
      return c.json({ error: 'Module non validé', status: progress.status }, 409)
    }

    const deliverable = await c.env.DB.prepare(`
      SELECT id, deliverable_type, title, file_url, content_json, status, summary, ai_score, coach_comment, validated_at, created_at
      FROM deliverables
      WHERE user_id = ? AND module_id = ?
      ORDER BY validated_at DESC, created_at DESC
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    const questionsRes = await c.env.DB.prepare(`
      SELECT question_number, question_text, user_response, ai_feedback, quality_score, iteration_count, updated_at
      FROM questions
      WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress.id).all()

    const questionRows = Array.isArray(questionsRes.results) ? questionsRes.results as any[] : []
    const snapshot = buildSectionsSnapshot(module.module_code as string, questionRows)

    const sections = snapshot.sections.map((section) => ({
      order: section.order,
      questionId: section.questionId,
      section: section.section,
      question: section.questionText,
      answer: section.answer,
      score: section.percentage,
      scoreLabel: section.scoreLabel,
      suggestions: section.suggestions,
      questions: section.questions
    }))

    let deliverableContent: any = null
    if (deliverable?.content_json) {
      try {
        deliverableContent = JSON.parse(deliverable.content_json as string)
      } catch (error) {
        console.warn('Impossible de parser deliverable.content_json', error)
      }
    }

    const validatedAt = deliverable?.validated_at ?? progress.validated_at
    const aiScore = typeof deliverable?.ai_score === 'number'
      ? Number(deliverable.ai_score)
      : typeof progress.ai_score === 'number'
        ? Number(progress.ai_score)
        : null

    return c.json({
      success: true,
      module: {
        code: module.module_code,
        title: module.title
      },
      progress: {
        status: progress.status,
        aiScore,
        validatedAt,
        aiLastAnalysis: progress.ai_last_analysis,
        quizScore: progress.quiz_score,
        quizPassed: progress.quiz_passed
      },
      deliverable: deliverable
        ? {
            id: deliverable.id,
            status: deliverable.status,
            summary: deliverable.summary,
            aiScore: deliverable.ai_score,
            coachComment: deliverable.coach_comment,
            validatedAt: deliverable.validated_at,
            fileUrl: deliverable.file_url,
            title: deliverable.title
          }
        : null,
      content: {
        meta: {
          validatedAt: deliverableContent?.validatedAt ?? validatedAt,
          score: deliverableContent?.score ?? aiScore
        },
        sections
      },
      canRefresh: progress.status === 'validated'
    })
  } catch (error) {
    console.error('Deliverable fetch error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Régénérer le livrable (B7)
app.post('/api/module/:code/deliverable/refresh', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.param('code')
    const module = await c.env.DB.prepare(`
      SELECT id, title, module_code
      FROM modules
      WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id, status, ai_score, validated_at, project_id
      FROM progress
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    if (progress.status !== 'validated') {
      return c.json({ error: 'Le module doit être validé avant de régénérer le livrable.', status: progress.status }, 409)
    }

    const deliverable = await c.env.DB.prepare(`
      SELECT id, coach_comment
      FROM deliverables
      WHERE user_id = ? AND module_id = ?
      ORDER BY validated_at DESC, created_at DESC
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    const questionsRes = await c.env.DB.prepare(`
      SELECT question_number, question_text, user_response, ai_feedback, quality_score, iteration_count, updated_at
      FROM questions
      WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress.id).all()

    const questionRows = Array.isArray(questionsRes.results) ? questionsRes.results as any[] : []
    const snapshot = buildSectionsSnapshot(module.module_code as string, questionRows)
    const sections = snapshot.sections

    const deliverableUrl = `/module/${moduleCode}/download`
    const refreshIso = new Date().toISOString()
    const aiScore = typeof progress.ai_score === 'number' ? Number(progress.ai_score) : null

    const deliverableContent = {
      moduleCode,
      refreshedAt: refreshIso,
      validatedAt: progress.validated_at ?? refreshIso,
      score: aiScore,
      sections: sections.map((section) => ({
        questionId: section.questionId,
        section: section.section,
        question: section.questionText,
        answer: section.answer,
        score: section.percentage,
        scoreLabel: section.scoreLabel,
        suggestions: section.suggestions,
        questions: section.questions
      }))
    }

    const formattedDate = new Date(refreshIso).toLocaleDateString('fr-FR')
    const summaryText = aiScore !== null
      ? `Canvas généré le ${formattedDate} · Score IA ${aiScore}%`
      : `Canvas généré le ${formattedDate}`

    if (deliverable) {
      await c.env.DB.prepare(`
        UPDATE deliverables
        SET deliverable_type = ?,
            title = ?,
            file_url = ?,
            content_json = ?,
            status = 'ready',
            summary = ?,
            ai_score = ?,
            coach_comment = ?,
            validated_at = datetime('now')
        WHERE id = ?
      `).bind(
        'canvas',
        `${module.title ?? 'Module'} - Canvas validé`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        aiScore,
        deliverable.coach_comment ?? null,
        deliverable.id
      ).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO deliverables (
          user_id,
          project_id,
          module_id,
          deliverable_type,
          title,
          file_url,
          content_json,
          status,
          summary,
          ai_score,
          coach_comment,
          validated_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(
        payload.userId,
        progress.project_id ?? null,
        module.id,
        'canvas',
        `${module.title ?? 'Module'} - Canvas validé`,
        deliverableUrl,
        JSON.stringify(deliverableContent),
        summaryText,
        aiScore,
        null
      ).run()
    }

    return c.json({
      success: true,
      refreshedAt: refreshIso,
      summary: summaryText,
      aiScore
    })
  } catch (error) {
    console.error('Deliverable refresh error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════
// MODULE 2 — SIC (Social Impact Canvas) API Endpoints
// ═══════════════════════════════════════════════════════════════

const SIC_MODULE_CODES = new Set(['mod2_sic', 'step1_social_impact'])

// Helper: get or create SIC data row
async function ensureSicDataRow(db: D1Database, userId: number, projectId: number | null, moduleId: number, progressId: number) {
  const existing = await db.prepare(`
    SELECT * FROM sic_data WHERE user_id = ? AND module_id = ?
  `).bind(userId, moduleId).first()
  if (existing) return existing

  await db.prepare(`
    INSERT INTO sic_data (user_id, project_id, module_id, progress_id) VALUES (?, ?, ?, ?)
  `).bind(userId, projectId, moduleId, progressId).run()

  return await db.prepare(`
    SELECT * FROM sic_data WHERE user_id = ? AND module_id = ?
  `).bind(userId, moduleId).first()
}

// POST /api/sic/analyze - Run SIC analysis
app.post('/api/sic/analyze', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifie' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json()
    const moduleCode = body?.moduleCode?.trim() || 'mod2_sic'

    if (!SIC_MODULE_CODES.has(moduleCode)) {
      return c.json({ error: 'Module non supporte pour SIC' }, 400)
    }

    const db = c.env.DB

    // Get module
    const module = await db.prepare(`SELECT id FROM modules WHERE module_code = ?`).bind(moduleCode).first()
    if (!module) return c.json({ error: 'Module non trouve' }, 404)

    const moduleId = Number(module.id)

    // Get progress
    const progress = await db.prepare(`
      SELECT id, project_id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, moduleId).first()
    if (!progress) return c.json({ error: 'Pas de progression' }, 404)

    // Get user answers for SIC
    const answersResult = await db.prepare(`
      SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
    `).bind(progress.id).all()

    const sicAnswers = new Map<number, string>()
    for (const row of (answersResult.results ?? [])) {
      const qNum = Number((row as any).question_number)
      const resp = (row as any).user_response as string ?? ''
      if (resp.trim()) sicAnswers.set(qNum, resp.trim())
    }

    if (sicAnswers.size === 0) {
      return c.json({ error: 'Aucune reponse SIC soumise' }, 400)
    }

    // Try to get BMC answers for coherence check
    const bmcModule = await db.prepare(`SELECT id FROM modules WHERE module_code = 'mod1_bmc'`).first()
    let bmcAnswers: Map<number, string> | undefined
    if (bmcModule) {
      const bmcProgress = await db.prepare(`
        SELECT id FROM progress WHERE user_id = ? AND module_id = ?
      `).bind(payload.userId, bmcModule.id).first()
      if (bmcProgress) {
        const bmcResult = await db.prepare(`
          SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
        `).bind(bmcProgress.id).all()
        bmcAnswers = new Map<number, string>()
        for (const row of (bmcResult.results ?? [])) {
          const qNum = Number((row as any).question_number)
          const resp = (row as any).user_response as string ?? ''
          if (resp.trim()) bmcAnswers.set(qNum, resp.trim())
        }
      }
    }

    // Run analysis
    const analysis = analyzeSIC(sicAnswers, bmcAnswers)

    // Update progress with scores
    await db.prepare(`
      UPDATE progress
      SET ai_score = ?, ai_feedback_json = ?, ai_last_analysis = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      Math.round(analysis.scoreGlobal * 10), // Convert /10 to /100 percentage
      JSON.stringify(analysis),
      progress.id
    ).run()

    // Update per-question feedback
    for (const section of analysis.sections) {
      const questionIds = Object.entries(QUESTION_SECTION_MAP)
        .filter(([, sec]) => sec === section.key)
        .map(([id]) => Number(id))

      for (const qId of questionIds) {
        const feedbackPayload = JSON.stringify({
          suggestions: section.feedback,
          questions: section.warnings,
          percentage: section.percentage,
          scoreLabel: section.score >= 7 ? 'Excellent' : section.score >= 5 ? 'Bien' : section.score >= 3 ? 'A ameliorer' : 'Insuffisant'
        })

        await db.prepare(`
          UPDATE questions
          SET ai_feedback = ?, quality_score = ?, feedback_updated_at = datetime('now')
          WHERE progress_id = ? AND question_number = ?
        `).bind(feedbackPayload, Math.round(section.score * 10), progress.id, qId).run()
      }
    }

    // Save/update SIC data
    const projectId = progress.project_id ? Number(progress.project_id) : null
    await ensureSicDataRow(db, payload.userId, projectId, moduleId, Number(progress.id))

    await db.prepare(`
      UPDATE sic_data
      SET score_global = ?, score_coherence_bmc = ?, analysis_json = ?,
          analysis_timestamp = datetime('now'), impact_matrix_json = ?,
          odd_selected = ?, updated_at = datetime('now')
      WHERE user_id = ? AND module_id = ?
    `).bind(
      analysis.scoreGlobal,
      analysis.scoreCoherenceBmc,
      JSON.stringify(analysis),
      JSON.stringify(analysis.impactMatrix),
      JSON.stringify(analysis.oddMappings.map(o => o.oddNumber)),
      payload.userId,
      moduleId
    ).run()

    return c.json({
      success: true,
      analysis: {
        scoreGlobal: analysis.scoreGlobal,
        sections: analysis.sections.map(s => ({
          key: s.key,
          label: s.label,
          score: s.score,
          percentage: s.percentage,
          strengths: s.strengths,
          warnings: s.warnings
        })),
        smartCheck: analysis.smartCheck,
        impactWashingRisk: analysis.impactWashingRisk,
        oddCount: analysis.oddMappings.length,
        verdict: analysis.verdict,
        scoreCoherenceBmc: analysis.scoreCoherenceBmc
      }
    })
  } catch (error) {
    console.error('SIC analyze error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// GET /api/sic/deliverable - Get SIC deliverable (HTML diagnostic)
app.get('/api/sic/deliverable', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifie' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.query('module')?.trim() || 'mod2_sic'
    const format = c.req.query('format')?.trim() || 'html'
    const db = c.env.DB

    const module = await db.prepare(`SELECT id FROM modules WHERE module_code = ?`).bind(moduleCode).first()
    if (!module) return c.json({ error: 'Module non trouve' }, 404)

    const progress = await db.prepare(`
      SELECT id, project_id, ai_score, ai_feedback_json FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()
    if (!progress) return c.json({ error: 'Pas de progression' }, 404)

    const analysisJson = progress.ai_feedback_json as string | null
    if (!analysisJson) {
      return c.json({ error: 'Lancez d\'abord l\'analyse IA (etape B4)' }, 400)
    }

    let analysis: SicAnalysisResult
    try {
      analysis = JSON.parse(analysisJson)
    } catch {
      return c.json({ error: 'Donnees d\'analyse corrompues' }, 500)
    }

    // Get user info
    const user = await db.prepare(`SELECT name FROM users WHERE id = ?`).bind(payload.userId).first()
    const userName = (user?.name as string) ?? 'Entrepreneur'

    // Get project info
    const project = await db.prepare(`SELECT name FROM projects WHERE id = ?`).bind(progress.project_id).first()
    const projectName = (project?.name as string) ?? 'Mon Projet'

    if (format === 'full') {
      // Full professional deliverable (matching SIC_GOTCHE_FINAL.pdf format)
      // Get additional user data for the full deliverable
      const answersResult = await db.prepare(`
        SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
      `).bind(progress.id).all()

      const sicAnswers = new Map<number, string>()
      for (const row of (answersResult.results ?? [])) {
        const qNum = Number((row as any).question_number)
        const resp = (row as any).user_response as string ?? ''
        if (resp.trim()) sicAnswers.set(qNum, resp.trim())
      }

      // Get BMC answers for coherence
      let bmcAnswers: Map<number, string> | undefined
      const bmcModule = await db.prepare(`SELECT id FROM modules WHERE module_code = 'mod1_bmc'`).first()
      if (bmcModule) {
        const bmcProgress = await db.prepare(`SELECT id FROM progress WHERE user_id = ? AND module_id = ?`).bind(payload.userId, bmcModule.id).first()
        if (bmcProgress) {
          const bmcRes = await db.prepare(`SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number`).bind(bmcProgress.id).all()
          bmcAnswers = new Map<number, string>()
          for (const row of (bmcRes.results ?? [])) {
            const r = (row as any).user_response as string ?? ''
            if (r.trim()) bmcAnswers.set(Number((row as any).question_number), r.trim())
          }
        }
      }

      // Get project details
      const projectDetails = progress.project_id
        ? await db.prepare(`SELECT name, sector, location, country FROM projects WHERE id = ?`).bind(progress.project_id).first()
        : null

      const deliverableData: SicDeliverableData = {
        companyName: (projectDetails?.name as string) ?? projectName,
        entrepreneurName: userName,
        sector: (projectDetails?.sector as string) ?? '',
        location: (projectDetails?.location as string) ?? '',
        country: (projectDetails?.country as string) ?? 'Côte d\'Ivoire',
        analysis,
        answers: sicAnswers,
        bmcAnswers
      }

      const fullHtml = generateFullSicDeliverable(deliverableData)
      return c.html(fullHtml)
    }

    if (format === 'html') {
      const html = generateSicDiagnosticHtml(analysis, projectName, userName)
      return c.html(html)
    }

    // JSON format (for Excel generation client-side or future API)
    return c.json({
      success: true,
      analysis,
      user: userName,
      project: projectName
    })
  } catch (error) {
    console.error('SIC deliverable error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// POST /api/sic/deliverable/refresh - Regenerate SIC deliverable
app.post('/api/sic/deliverable/refresh', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifie' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json()
    const moduleCode = body?.moduleCode?.trim() || 'mod2_sic'
    const db = c.env.DB

    const module = await db.prepare(`SELECT id FROM modules WHERE module_code = ?`).bind(moduleCode).first()
    if (!module) return c.json({ error: 'Module non trouve' }, 404)

    // First re-run analysis
    const progress = await db.prepare(`
      SELECT id, project_id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()
    if (!progress) return c.json({ error: 'Pas de progression' }, 404)

    const answersResult = await db.prepare(`
      SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
    `).bind(progress.id).all()

    const sicAnswers = new Map<number, string>()
    for (const row of (answersResult.results ?? [])) {
      const qNum = Number((row as any).question_number)
      const resp = (row as any).user_response as string ?? ''
      if (resp.trim()) sicAnswers.set(qNum, resp.trim())
    }

    if (sicAnswers.size === 0) {
      return c.json({ error: 'Aucune reponse SIC' }, 400)
    }

    // BMC answers for coherence
    const bmcModule = await db.prepare(`SELECT id FROM modules WHERE module_code = 'mod1_bmc'`).first()
    let bmcAnswers: Map<number, string> | undefined
    if (bmcModule) {
      const bmcProgress = await db.prepare(`
        SELECT id FROM progress WHERE user_id = ? AND module_id = ?
      `).bind(payload.userId, bmcModule.id).first()
      if (bmcProgress) {
        const bmcResult = await db.prepare(`
          SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
        `).bind(bmcProgress.id).all()
        bmcAnswers = new Map<number, string>()
        for (const row of (bmcResult.results ?? [])) {
          bmcAnswers.set(Number((row as any).question_number), ((row as any).user_response as string ?? '').trim())
        }
      }
    }

    const analysis = analyzeSIC(sicAnswers, bmcAnswers)

    await db.prepare(`
      UPDATE progress
      SET ai_score = ?, ai_feedback_json = ?, ai_last_analysis = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(Math.round(analysis.scoreGlobal * 10), JSON.stringify(analysis), progress.id).run()

    return c.json({
      success: true,
      refreshedAt: analysis.timestamp,
      scoreGlobal: analysis.scoreGlobal,
      verdict: analysis.verdict
    })
  } catch (error) {
    console.error('SIC refresh error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════
// Module 1 — BMC Deliverable APIs
// ═══════════════════════════════════════════════════════════════

// GET /api/bmc/deliverable - Get BMC deliverable (HTML)
app.get('/api/bmc/deliverable', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifie' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const format = c.req.query('format')?.trim() || 'html'
    const db = c.env.DB

    const module = await db.prepare(`SELECT id FROM modules WHERE module_code = 'mod1_bmc'`).first()
    if (!module) return c.json({ error: 'Module BMC non trouve' }, 404)

    const progress = await db.prepare(`
      SELECT id, project_id, ai_score, ai_feedback_json FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()
    if (!progress) return c.json({ error: 'Pas de progression BMC' }, 404)

    // Get BMC answers
    const answersResult = await db.prepare(`
      SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
    `).bind(progress.id).all()

    const bmcAnswers = new Map<number, string>()
    for (const row of (answersResult.results ?? [])) {
      const qNum = Number((row as any).question_number)
      const resp = (row as any).user_response as string ?? ''
      if (resp.trim()) bmcAnswers.set(qNum, resp.trim())
    }

    if (bmcAnswers.size === 0) {
      return c.json({ error: 'Aucune reponse BMC. Remplissez d\'abord le questionnaire.' }, 400)
    }

    // Get user info
    const user = await db.prepare(`SELECT name FROM users WHERE id = ?`).bind(payload.userId).first()
    const userName = (user?.name as string) ?? 'Entrepreneur'

    // Get project info
    let projectName = 'Mon Projet'
    let projectSector = ''
    let projectLocation = ''
    let projectCountry = 'Côte d\'Ivoire'
    if (progress.project_id) {
      try {
        const project = await db.prepare(`SELECT name, description FROM projects WHERE id = ?`).bind(progress.project_id).first()
        if (project?.name) projectName = project.name as string
      } catch {}
    }

    const deliverableData: BmcDeliverableData = {
      companyName: projectName,
      entrepreneurName: userName,
      sector: projectSector,
      location: projectLocation,
      country: projectCountry,
      brandName: '',
      tagline: '',
      analysisDate: new Date().toISOString(),
      answers: bmcAnswers
    }

    if (format === 'full') {
      const fullHtml = generateFullBmcDeliverable(deliverableData)
      return c.html(fullHtml)
    }

    if (format === 'diagnostic' || format === 'html') {
      const diagHtml = generateBmcDiagnosticHtml(deliverableData)
      return c.html(diagHtml)
    }

    // JSON format
    return c.json({
      success: true,
      user: userName,
      project: projectName,
      answersCount: bmcAnswers.size
    })
  } catch (error) {
    console.error('BMC deliverable error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// POST /api/bmc/deliverable/refresh - Regenerate BMC analysis and store
app.post('/api/bmc/deliverable/refresh', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifie' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const db = c.env.DB

    const module = await db.prepare(`SELECT id FROM modules WHERE module_code = 'mod1_bmc'`).first()
    if (!module) return c.json({ error: 'Module BMC non trouve' }, 404)

    const progress = await db.prepare(`
      SELECT id, project_id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()
    if (!progress) return c.json({ error: 'Pas de progression BMC' }, 404)

    const answersResult = await db.prepare(`
      SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
    `).bind(progress.id).all()

    const bmcAnswers = new Map<number, string>()
    for (const row of (answersResult.results ?? [])) {
      const qNum = Number((row as any).question_number)
      const resp = (row as any).user_response as string ?? ''
      if (resp.trim()) bmcAnswers.set(qNum, resp.trim())
    }

    if (bmcAnswers.size === 0) {
      return c.json({ error: 'Aucune reponse BMC' }, 400)
    }

    return c.json({
      success: true,
      refreshedAt: new Date().toISOString(),
      answersCount: bmcAnswers.size,
      message: 'BMC deliverable refreshed'
    })
  } catch (error) {
    console.error('BMC refresh error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════
// Module 4 — Framework Analyse PME (Excel 8 feuilles)
// ═══════════════════════════════════════════════════════════════

// Helper: Build PmeInputData from Module 3 financial_inputs
function buildPmeInputDataFromInputs(
  infos: any, historiques: any, produits: any, rh: any,
  hypotheses: any, couts: any, bfr: any, investissements: any,
  financement: any, companyName: string, userName: string
): PmeInputData {
  // Extract activities
  const acts = produits?.produits ?? produits?.activites ?? []
  const activities = Array.isArray(acts) && acts.length > 0
    ? acts.map((a: any) => ({ name: a.nom || a.name || 'Activité', isStrategic: a.strategique !== false }))
    : [{ name: 'Activité principale', isStrategic: true }]

  // Parse historique (N-2, N-1, N)
  const hist = historiques || {}
  const parseArr3 = (key: string, fallback = [0, 0, 0]): [number, number, number] => {
    const v = hist[key]
    if (Array.isArray(v) && v.length >= 3) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
    if (typeof v === 'number') return [0, 0, v]
    return fallback as [number, number, number]
  }

  // CA by activity
  const caByActivity: [number, number, number][] = activities.map((_: any, i: number) => {
    const key = `ca_activite_${i + 1}`
    return parseArr3(key, [0, 0, 0])
  })

  // Hypotheses projection
  const hyp = hypotheses || {}
  const parseArr5 = (key: string, def: number): [number, number, number, number, number] => {
    const v = hyp[key]
    if (Array.isArray(v) && v.length >= 5) return [Number(v[0]) || def, Number(v[1]) || def, Number(v[2]) || def, Number(v[3]) || def, Number(v[4]) || def]
    const single = Number(v) || def
    return [single, single, single, single, single]
  }

  // Investissements
  const inv = investissements || {}
  const capexArr = parseArr5('capex', 0)
  const invDetails = inv.investissements_details
  const investissementsList = Array.isArray(invDetails)
    ? invDetails.map((d: any) => ({
        description: d.description || 'Investissement',
        montants: (d.montants || capexArr) as [number, number, number, number, number]
      }))
    : undefined

  // BFR
  const bfrData = bfr || {}

  // Couts
  const coutsData = couts || {}

  return {
    companyName: infos?.nom_entreprise || companyName || 'Mon Entreprise',
    sector: infos?.secteur || infos?.secteur_activite || '',
    analysisDate: new Date().toISOString().split('T')[0],
    consultant: 'ESONO Investment Readiness',
    location: infos?.localisation || infos?.ville || '',
    country: infos?.pays || 'Côte d\'Ivoire',
    activities,
    historique: {
      caTotal: parseArr3('ca_total'),
      caByActivity,
      achatsMP: parseArr3('achats_mp', [0, 0, 0]),
      sousTraitance: parseArr3('sous_traitance', [0, 0, 0]),
      coutsProduction: parseArr3('couts_production', [0, 0, 0]),
      salaires: parseArr3('salaires', [0, 0, 0]),
      loyers: parseArr3('loyers', [0, 0, 0]),
      assurances: parseArr3('assurances', [0, 0, 0]),
      fraisGeneraux: parseArr3('frais_generaux', [0, 0, 0]),
      marketing: parseArr3('marketing', [0, 0, 0]),
      fraisBancaires: parseArr3('frais_bancaires', [0, 0, 0]),
      resultatNet: parseArr3('resultat_net', [0, 0, 0]),
      tresoDebut: parseArr3('treso_debut', [0, 0, 0]),
      tresoFin: parseArr3('treso_fin', [0, 0, 0]),
      dso: parseArr3('dso', [30, 30, 30]),
      dpo: parseArr3('dpo', [30, 30, 30]),
      stockJours: parseArr3('stock_jours', [15, 15, 15]),
      detteCT: parseArr3('dette_ct', [0, 0, 0]),
      detteLT: parseArr3('dette_lt', [0, 0, 0]),
      serviceDette: parseArr3('service_dette', [0, 0, 0]),
      amortissements: parseArr3('amortissements', [0, 0, 0]),
    },
    hypotheses: {
      croissanceCA: parseArr5('croissance_ca', 15),
      croissanceParActivite: activities.length > 1
        ? activities.map((_: any, i: number) => parseArr5(`croissance_activite_${i + 1}`, 15))
        : undefined,
      evolutionPrix: parseArr5('evolution_prix', 3),
      evolutionCoutsDirects: parseArr5('evolution_couts_directs', 3),
      inflationChargesFixes: parseArr5('inflation_charges_fixes', 3),
      evolutionMasseSalariale: parseArr5('evolution_masse_salariale', 5),
      capex: capexArr,
      amortissement: Number(inv.duree_amortissement) || 5,
      embauches: rh?.plan_embauche ?? undefined,
      investissements: investissementsList,
    }
  }
}

// GET /api/pme/framework - Get PME Framework deliverable (Excel XML or HTML preview)
app.get('/api/pme/framework', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const format = c.req.query('format') || 'excel' // excel | html | json

    // Get Module 4 (framework)
    const mod4 = await c.env.DB.prepare('SELECT id, module_code, title FROM modules WHERE module_code = ?')
      .bind('mod4_framework').first<any>()
    if (!mod4) return c.json({ error: 'Module non trouvé' }, 404)

    // Get Module 3 (inputs) to read financial data
    const mod3 = await c.env.DB.prepare('SELECT id FROM modules WHERE module_code = ?')
      .bind('mod3_inputs').first<any>()

    // Get financial_inputs from Module 3
    let inputsRow: any = null
    if (mod3) {
      inputsRow = await c.env.DB.prepare(
        'SELECT * FROM financial_inputs WHERE user_id = ? AND module_id = ?'
      ).bind(payload.userId, mod3.id).first<any>()
    }

    if (!inputsRow) {
      return c.json({ error: 'Aucune donnée financière. Remplissez d\'abord les Inputs Entrepreneur (Module 3).' }, 400)
    }

    // Parse all JSON tabs
    const infos = inputsRow.infos_generales_json ? JSON.parse(inputsRow.infos_generales_json) : {}
    const historiques = inputsRow.donnees_historiques_json ? JSON.parse(inputsRow.donnees_historiques_json) : {}
    const produits = inputsRow.produits_services_json ? JSON.parse(inputsRow.produits_services_json) : {}
    const rh = inputsRow.ressources_humaines_json ? JSON.parse(inputsRow.ressources_humaines_json) : {}
    const hypotheses = inputsRow.hypotheses_croissance_json ? JSON.parse(inputsRow.hypotheses_croissance_json) : {}
    const coutsData = inputsRow.couts_fixes_variables_json ? JSON.parse(inputsRow.couts_fixes_variables_json) : {}
    const bfrData = inputsRow.bfr_tresorerie_json ? JSON.parse(inputsRow.bfr_tresorerie_json) : {}
    const invData = inputsRow.investissements_json ? JSON.parse(inputsRow.investissements_json) : {}
    const finData = inputsRow.financement_json ? JSON.parse(inputsRow.financement_json) : {}

    // Get user name
    const user = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(payload.userId).first<any>()
    const userName = user?.name || 'Entrepreneur'

    // Get project name
    let companyName = 'Mon Entreprise'
    const progress4 = await c.env.DB.prepare('SELECT project_id FROM progress WHERE user_id = ? AND module_id = ?')
      .bind(payload.userId, mod4.id).first<any>()
    if (progress4?.project_id) {
      const proj = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(progress4.project_id).first<any>()
      if (proj?.name) companyName = proj.name
    }

    // Build PmeInputData
    const pmeInput = buildPmeInputDataFromInputs(
      infos, historiques, produits, rh, hypotheses, coutsData, bfrData, invData, finData,
      companyName, userName
    )

    // Run analysis
    const analysis = analyzePme(pmeInput)

    if (format === 'excel') {
      const xml = generatePmeExcelXml(pmeInput, analysis)
      return new Response(xml, {
        headers: {
          'Content-Type': 'application/vnd.ms-excel',
          'Content-Disposition': `attachment; filename="Framework_Analyse_${companyName.replace(/[^a-zA-Z0-9]/g, '_')}.xls"`,
        }
      })
    }

    if (format === 'html') {
      const html = generatePmePreviewHtml(analysis, pmeInput)
      return c.html(html)
    }

    // JSON format
    return c.json({ success: true, analysis, input: pmeInput })

  } catch (e: any) {
    console.error('PME framework error:', e)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// POST /api/pme/framework/refresh - Regenerate PME analysis
app.post('/api/pme/framework/refresh', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const mod4 = await c.env.DB.prepare('SELECT id FROM modules WHERE module_code = ?')
      .bind('mod4_framework').first<any>()
    if (!mod4) return c.json({ error: 'Module non trouvé' }, 404)

    const mod3 = await c.env.DB.prepare('SELECT id FROM modules WHERE module_code = ?')
      .bind('mod3_inputs').first<any>()

    let inputsRow: any = null
    if (mod3) {
      inputsRow = await c.env.DB.prepare(
        'SELECT * FROM financial_inputs WHERE user_id = ? AND module_id = ?'
      ).bind(payload.userId, mod3.id).first<any>()
    }
    if (!inputsRow) return c.json({ error: 'Aucune donnée financière' }, 400)

    const infos = inputsRow.infos_generales_json ? JSON.parse(inputsRow.infos_generales_json) : {}
    const historiques = inputsRow.donnees_historiques_json ? JSON.parse(inputsRow.donnees_historiques_json) : {}
    const produits = inputsRow.produits_services_json ? JSON.parse(inputsRow.produits_services_json) : {}
    const rh = inputsRow.ressources_humaines_json ? JSON.parse(inputsRow.ressources_humaines_json) : {}
    const hypotheses = inputsRow.hypotheses_croissance_json ? JSON.parse(inputsRow.hypotheses_croissance_json) : {}
    const coutsData = inputsRow.couts_fixes_variables_json ? JSON.parse(inputsRow.couts_fixes_variables_json) : {}
    const bfrData = inputsRow.bfr_tresorerie_json ? JSON.parse(inputsRow.bfr_tresorerie_json) : {}
    const invData = inputsRow.investissements_json ? JSON.parse(inputsRow.investissements_json) : {}
    const finData = inputsRow.financement_json ? JSON.parse(inputsRow.financement_json) : {}

    const user = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(payload.userId).first<any>()
    const userName = user?.name || 'Entrepreneur'

    let companyName = 'Mon Entreprise'
    const progress4 = await c.env.DB.prepare('SELECT id, project_id FROM progress WHERE user_id = ? AND module_id = ?')
      .bind(payload.userId, mod4.id).first<any>()
    if (progress4?.project_id) {
      const proj = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(progress4.project_id).first<any>()
      if (proj?.name) companyName = proj.name
    }

    const pmeInput = buildPmeInputDataFromInputs(
      infos, historiques, produits, rh, hypotheses, coutsData, bfrData, invData, finData,
      companyName, userName
    )

    const analysis = analyzePme(pmeInput)

    // Update progress with score
    const score = Math.round(
      (analysis.historique.margeEbitdaPct[2] > 0 ? 30 : 0) +
      (analysis.historique.margeBrutePct[2] >= 25 ? 20 : 10) +
      (analysis.alertes.filter(a => a.type === 'danger').length === 0 ? 20 : 0) +
      (analysis.projection.tresoCumulee[4] > 0 ? 20 : 10) +
      (analysis.forces.length >= 3 ? 10 : 5)
    )

    if (progress4?.id) {
      const now = new Date().toISOString()
      await c.env.DB.prepare(
        'UPDATE progress SET ai_score = ?, ai_feedback_json = ?, ai_last_analysis = ?, updated_at = ? WHERE id = ?'
      ).bind(score, JSON.stringify(analysis), now, now, progress4.id).run()
    }

    return c.json({
      success: true,
      refreshedAt: analysis.analysisDate,
      score,
      alertes: analysis.alertes.length,
      forces: analysis.forces.length,
      faiblesses: analysis.faiblesses.length
    })

  } catch (e: any) {
    console.error('PME framework refresh error:', e)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════
// Module 3 — Inputs Financiers (9 onglets) APIs
// ═══════════════════════════════════════════════════════════════

const INPUT_TAB_COLUMNS: Record<InputTabKey, string> = {
  infos_generales: 'infos_generales_json',
  donnees_historiques: 'donnees_historiques_json',
  produits_services: 'produits_services_json',
  ressources_humaines: 'ressources_humaines_json',
  hypotheses_croissance: 'hypotheses_croissance_json',
  couts_fixes_variables: 'couts_fixes_variables_json',
  bfr_tresorerie: 'bfr_tresorerie_json',
  investissements: 'investissements_json',
  financement: 'financement_json'
}

// GET /api/inputs/tabs — Load all 9 tabs data + coaching
app.get('/api/inputs/tabs', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.query('module')?.trim() || 'mod3_inputs'
    const module = await c.env.DB.prepare('SELECT id FROM modules WHERE module_code = ? LIMIT 1').bind(moduleCode).first()
    if (!module) return c.json({ error: 'Module introuvable' }, 404)

    const row = await c.env.DB.prepare('SELECT * FROM financial_inputs WHERE user_id = ? AND module_id = ? LIMIT 1')
      .bind(payload.userId, module.id).first()

    const tabsData: Record<string, any> = {}
    for (const tabKey of INPUT_TAB_ORDER) {
      const col = INPUT_TAB_COLUMNS[tabKey]
      const raw = row ? (row as any)[col] : null
      tabsData[tabKey] = raw ? JSON.parse(raw) : {}
    }

    return c.json({
      success: true,
      tabs: tabsData,
      coaching: TAB_COACHING,
      fields: TAB_FIELDS,
      tabOrder: INPUT_TAB_ORDER,
      tabLabels: INPUT_TAB_LABELS,
      completeness: row ? (row as any).completeness_pct ?? 0 : 0,
      readinessScore: row ? (row as any).readiness_score ?? 0 : 0
    })
  } catch (error) {
    console.error('Inputs tabs fetch error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// POST /api/inputs/save-tab — Save a single tab's data
app.post('/api/inputs/save-tab', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const moduleCode = (body.moduleCode as string)?.trim() || 'mod3_inputs'
    const tabKey = body.tab as InputTabKey
    const tabData = body.data as Record<string, any>

    if (!tabKey || !INPUT_TAB_COLUMNS[tabKey]) {
      return c.json({ error: 'Onglet invalide' }, 400)
    }

    const module = await c.env.DB.prepare('SELECT id FROM modules WHERE module_code = ? LIMIT 1').bind(moduleCode).first()
    if (!module) return c.json({ error: 'Module introuvable' }, 404)

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, Number(module.id))
    const existing = await c.env.DB.prepare('SELECT id FROM financial_inputs WHERE user_id = ? AND module_id = ? LIMIT 1')
      .bind(payload.userId, module.id).first()

    const col = INPUT_TAB_COLUMNS[tabKey]
    const jsonStr = JSON.stringify(tabData || {})

    if (existing?.id) {
      await c.env.DB.prepare(`UPDATE financial_inputs SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(jsonStr, existing.id).run()
    } else {
      await c.env.DB.prepare(`INSERT INTO financial_inputs (user_id, module_id, progress_id, ${col}) VALUES (?, ?, ?, ?)`)
        .bind(payload.userId, module.id, progress.id, jsonStr).run()
    }

    // Update progress to in_progress
    await c.env.DB.prepare(`UPDATE progress SET status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END, updated_at = datetime('now') WHERE id = ?`)
      .bind(progress.id).run()

    // Score this tab in real-time
    const tabScore = scoreTab(tabKey, tabData || {})

    return c.json({
      success: true,
      tab: tabKey,
      score: tabScore
    })
  } catch (error) {
    console.error('Inputs save-tab error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// POST /api/inputs/analyze — Run full 9-tab analysis
app.post('/api/inputs/analyze', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const moduleCode = (body.moduleCode as string)?.trim() || 'mod3_inputs'

    const module = await c.env.DB.prepare('SELECT id FROM modules WHERE module_code = ? LIMIT 1').bind(moduleCode).first()
    if (!module) return c.json({ error: 'Module introuvable' }, 404)

    const progress = await ensureProgressRecord(c.env.DB, payload.userId, Number(module.id))

    // Load all tabs
    const row = await c.env.DB.prepare('SELECT * FROM financial_inputs WHERE user_id = ? AND module_id = ? LIMIT 1')
      .bind(payload.userId, module.id).first()
    if (!row) return c.json({ error: 'Aucune donnée saisie. Remplissez vos onglets avant de lancer l\'analyse.' }, 400)

    const allData: Record<InputTabKey, Record<string, any>> = {} as any
    for (const tabKey of INPUT_TAB_ORDER) {
      const col = INPUT_TAB_COLUMNS[tabKey]
      const raw = (row as any)[col]
      allData[tabKey] = raw ? JSON.parse(raw) : {}
    }

    // Run analysis engine
    const analysis = analyzeInputs(allData)

    // Persist scores
    await c.env.DB.prepare(`
      UPDATE financial_inputs 
      SET completeness_pct = ?, readiness_score = ?, analysis_json = ?, analysis_timestamp = datetime('now'),
          marge_brute_pct = ?, marge_op_pct = ?, marge_nette_pct = ?,
          ca_annee_n = ?, ca_cible_an5 = ?, updated_at = datetime('now')
      WHERE user_id = ? AND module_id = ?
    `).bind(
      analysis.overallCompleteness, analysis.readinessScore, JSON.stringify(analysis),
      analysis.financialRatios.margeBrute, analysis.financialRatios.margeOperationnelle, analysis.financialRatios.margeNette,
      null, null,
      payload.userId, module.id
    ).run()

    // Update progress
    await c.env.DB.prepare(`
      UPDATE progress SET ai_score = ?, ai_feedback_json = ?, ai_last_analysis = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).bind(analysis.readinessScore, JSON.stringify(analysis), progress.id).run()

    // Persist alerts
    await c.env.DB.prepare('DELETE FROM input_alerts WHERE user_id = ? AND module_id = ?').bind(payload.userId, module.id).run()
    for (const alert of analysis.alerts.slice(0, 50)) {
      await c.env.DB.prepare(`INSERT INTO input_alerts (user_id, module_id, tab_key, field_key, alert_level, message, rule_name) VALUES (?,?,?,?,?,?,?)`)
        .bind(payload.userId, Number(module.id), alert.tab, alert.field, alert.level, alert.message, alert.rule).run()
    }

    return c.json({
      success: true,
      analysis,
      readinessScore: analysis.readinessScore,
      readinessLabel: analysis.readinessLabel,
      verdict: analysis.verdict
    })
  } catch (error) {
    console.error('Inputs analysis error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// GET /api/inputs/diagnostic — Generate HTML diagnostic
app.get('/api/inputs/diagnostic', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.query('module')?.trim() || 'mod3_inputs'
    const module = await c.env.DB.prepare('SELECT id FROM modules WHERE module_code = ? LIMIT 1').bind(moduleCode).first()
    if (!module) return c.json({ error: 'Module introuvable' }, 404)

    const row = await c.env.DB.prepare('SELECT analysis_json FROM financial_inputs WHERE user_id = ? AND module_id = ? LIMIT 1')
      .bind(payload.userId, module.id).first()
    if (!row || !(row as any).analysis_json) return c.json({ error: 'Aucune analyse disponible. Lancez l\'analyse d\'abord.' }, 400)

    const analysis: InputsAnalysisResult = JSON.parse((row as any).analysis_json)

    // Get company name from infos_generales
    const inputRow = await c.env.DB.prepare('SELECT infos_generales_json FROM financial_inputs WHERE user_id = ? AND module_id = ? LIMIT 1')
      .bind(payload.userId, module.id).first()
    let companyName = 'Mon Entreprise'
    let entrepreneurName = 'Entrepreneur'
    if (inputRow && (inputRow as any).infos_generales_json) {
      try {
        const infos = JSON.parse((inputRow as any).infos_generales_json)
        companyName = infos.nom_entreprise || companyName
        entrepreneurName = infos.dirigeant_nom || entrepreneurName
      } catch {}
    }

    // Also get user name
    const user = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(payload.userId).first()
    if (user && (user as any).name) entrepreneurName = (user as any).name

    const html = generateInputsDiagnosticHtml(analysis, companyName, entrepreneurName)
    return c.html(html)
  } catch (error) {
    console.error('Inputs diagnostic error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════
// Claude AI Analysis Endpoints
// ═══════════════════════════════════════════════════════════════════

// GET /api/module/:moduleCode/analysis — Retrieve stored Claude analysis
app.get('/api/module/:moduleCode/analysis', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifie' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.param('moduleCode')

    const row = await c.env.DB.prepare(`
      SELECT id, global_score, global_level, analysis_json, source, error_message, created_at, updated_at
      FROM module_analyses
      WHERE user_id = ? AND module_code = ?
    `).bind(payload.userId, moduleCode).first()

    if (!row) {
      return c.json({
        success: true,
        analysis: null,
        generatedAt: null,
        message: 'Aucune analyse disponible. Soumettez vos reponses ou lancez une analyse.'
      })
    }

    let analysis: AnalysisResult | null = null
    try {
      analysis = JSON.parse(row.analysis_json as string)
    } catch {
      return c.json({ error: 'Analyse corrompue en base' }, 500)
    }

    return c.json({
      success: true,
      analysis,
      source: row.source,
      globalScore: row.global_score,
      globalLevel: row.global_level,
      generatedAt: row.updated_at || row.created_at,
      errorMessage: row.error_message || null
    })
  } catch (error) {
    console.error('GET analysis error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// POST /api/module/:moduleCode/regenerate — Re-run Claude analysis
app.post('/api/module/:moduleCode/regenerate', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifie' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const moduleCode = c.req.param('moduleCode')

    // ── Rate limiting: max 3 regenerations per module per hour ──
    const existing = await c.env.DB.prepare(`
      SELECT regenerate_count, last_regenerate_at
      FROM module_analyses
      WHERE user_id = ? AND module_code = ?
    `).bind(payload.userId, moduleCode).first()

    if (existing && existing.last_regenerate_at) {
      const lastRegen = new Date(existing.last_regenerate_at as string).getTime()
      const oneHourAgo = Date.now() - 3600_000
      if (lastRegen > oneHourAgo && (existing.regenerate_count as number) >= 3) {
        return c.json({
          error: 'Limite atteinte : maximum 3 analyses par heure par module. Reessayez plus tard.',
          retryAfter: Math.ceil((lastRegen + 3600_000 - Date.now()) / 1000)
        }, 429)
      }
      // Reset counter if last regen was more than 1 hour ago
      if (lastRegen <= oneHourAgo) {
        await c.env.DB.prepare(`
          UPDATE module_analyses SET regenerate_count = 0 WHERE user_id = ? AND module_code = ?
        `).bind(payload.userId, moduleCode).run()
      }
    }

    // ── Fetch current answers from DB ──
    const module = await c.env.DB.prepare(`SELECT id FROM modules WHERE module_code = ?`).bind(moduleCode).first()
    if (!module) return c.json({ error: 'Module non trouve' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()
    if (!progress) return c.json({ error: 'Aucune progression trouvee. Completez d\'abord le module.' }, 404)

    const answersResult = await c.env.DB.prepare(`
      SELECT question_number, user_response
      FROM questions
      WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress.id).all()

    const aiAnswers: AnswerInput[] = (answersResult.results ?? [])
      .filter((r: any) => r.user_response && r.user_response.trim())
      .map((r: any) => ({
        question_number: Number(r.question_number),
        answer: r.user_response as string
      }))

    if (aiAnswers.length === 0) {
      return c.json({ error: 'Aucune reponse trouvee. Remplissez vos blocs avant de lancer l\'analyse.' }, 400)
    }

    // ── Call Claude ──
    const { analysis, source, error } = await analyzeWithClaude(
      c.env.ANTHROPIC_API_KEY,
      moduleCode,
      aiAnswers
    )

    // ── Store result ──
    await c.env.DB.prepare(`
      INSERT INTO module_analyses (user_id, module_code, global_score, global_level, analysis_json, source, error_message, regenerate_count, last_regenerate_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(user_id, module_code) DO UPDATE SET
        global_score = excluded.global_score,
        global_level = excluded.global_level,
        analysis_json = excluded.analysis_json,
        source = excluded.source,
        error_message = excluded.error_message,
        regenerate_count = module_analyses.regenerate_count + 1,
        last_regenerate_at = datetime('now'),
        updated_at = datetime('now')
    `).bind(
      payload.userId,
      moduleCode,
      analysis.globalScore,
      analysis.globalLevel,
      JSON.stringify(analysis),
      source,
      error || null
    ).run()

    // Update progress score
    await c.env.DB.prepare(`
      UPDATE progress SET ai_score = ?, ai_last_analysis = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).bind(analysis.globalScore, progress.id).run()

    // Also persist per-question feedback from Claude analysis
    for (const block of analysis.blocks) {
      const feedbackPayload = JSON.stringify({
        sectionName: block.blockName,
        strengths: block.forces,
        suggestions: block.axes,
        questions: block.questions,
        percentage: block.score,
        scoreLabel: block.level
      })
      await c.env.DB.prepare(`
        UPDATE questions SET ai_feedback = ?, quality_score = ?, feedback_updated_at = datetime('now')
        WHERE progress_id = ? AND question_number = ?
      `).bind(feedbackPayload, block.score, progress.id, block.questionNumber).run()
    }

    // Update global feedback
    await c.env.DB.prepare(`
      UPDATE progress SET ai_feedback_json = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(JSON.stringify({
      overallScore: analysis.globalScore,
      overallLabel: analysis.globalLevel,
      strengthsCount: analysis.forcesCount,
      suggestionsCount: analysis.axesCount,
      questionsCount: analysis.questionsCount,
      sectionsNeedingWork: analysis.blocksToConsolidate,
      topSuggestions: analysis.recommandationsPrioritaires.slice(0, 3).map((msg, i) => ({
        section: 'Recommandation',
        questionId: i + 1,
        message: msg,
        score: 1
      }))
    }), progress.id).run()

    return c.json({
      success: true,
      analysis,
      source,
      generatedAt: new Date().toISOString(),
      errorMessage: error || null
    })
  } catch (error: any) {
    console.error('Regenerate analysis error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

export default app
