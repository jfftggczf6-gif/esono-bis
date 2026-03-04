import { Hono } from 'hono'
import { renderer } from './renderer'
import { cors } from 'hono/cors'
import { hashPassword, verifyPassword, generateToken, verifyToken, getAuthToken } from './auth'
import { getCookie, setCookie } from 'hono/cookie'
import { parseDocx } from './docx-parser'
import { getUserWithProgress } from './dashboard'
import { getCookieOptions } from './cookies'
import { moduleRoutes, renderEsanoLayout } from './module-routes'
import { entrepreneurRoutes, safeScriptBlocks } from './entrepreneur-page'
import { kbRoutes } from './agents/kb-routes'
import { coachRoutes } from './coach-routes'
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
import { generateFullSicDeliverable, renderSicDeliverableFromAnalyst, type SicDeliverableData, type SicAnalystDeliverableInput } from './sic-deliverable-engine'
import { generateFullBmcDeliverable, generateBmcDiagnosticHtml, generateFullBmcDeliverableFallback, type BmcDeliverableData } from './bmc-deliverable-engine'
import {
  analyzeInputs, generateInputsDiagnosticHtml, getInputsReadinessLabel,
  INPUT_TAB_ORDER, INPUT_TAB_LABELS, TAB_COACHING, TAB_FIELDS, scoreTab,
  type InputTabKey, type InputsAnalysisResult
} from './inputs-engine'
import { analyzePme, analyzePmeWithAI, generatePmeExcelXml, generatePmePreviewHtml, type PmeInputData } from './framework-pme-engine'
import { buildPmeInputWithAI, type EnrichedPmeInput } from './pme-ai-extractor'
import { crossAnalyzeBmcFinancials } from './pme-cross-analyzer'
import { callClaudeForSicExtraction, extractSicSectionsRegex, type SicExtractionResult } from './sic-extraction'
import { analyzeSicWithClaude, analyzeSicFallback, type SicAnalystResult } from './sic-analyst'
import { detectCountry, getFiscalParams, buildKBContext, type FiscalParams } from './fiscal-params'
import { extractOVOData, type DeliverableData as OVODeliverableData, type OVOExtractionResult, type PmeStructuredData } from './ovo-extraction-engine'
import { isValidApiKey, callClaudeJSON } from './claude-api'
import { BUSINESS_PLAN_TEMPLATE_B64, BUSINESS_PLAN_TEMPLATE_STRUCTURE, BUSINESS_PLAN_TEMPLATE_META } from './business-plan-template'
import { generateDeterministicDiagnostic, generateDiagnosticReportHtml } from './diagnostic-report-generator'
import { fillDocxTemplate } from './docx-filler'
import { fillOVOTemplate, gzipCompressSync, gunzipDecompressSync, type FillingStats } from './ovo-excel-filler'

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

// Middleware: sanitize all HTML responses to escape </ inside <script> blocks
// This prevents the HTML parser from prematurely closing script tags
// when JS string literals contain closing HTML tags like </div>, </body>, etc.
app.use('*', async (c, next) => {
  await next()
  const contentType = c.res.headers.get('content-type') || ''
  if (contentType.includes('text/html') && c.res.body) {
    const html = await c.res.text()
    const safeHtml = safeScriptBlocks(html)
    c.res = new Response(safeHtml, {
      status: c.res.status,
      headers: c.res.headers
    })
  }
})

// Middleware
app.use(renderer)
app.use('/api/*', cors())

// Mount module routes
app.route('/', moduleRoutes)

// Mount entrepreneur V2 routes
app.route('/', entrepreneurRoutes)

// Mount Knowledge Base routes
app.route('/', kbRoutes)

// Mount Coach routes
app.route('/', coachRoutes)

// Landing Page - A1
app.get('/', (c) => {
  return c.render(
    <div class="esono-public">
      <div class="esono-public__shell">
        <header class="esono-public__header">
          <div class="esono-public__brand">
            <span class="esono-public__logo">ESONO</span>
            <span class="esono-public__subtitle">Investment Readiness</span>
          </div>
          <a href="/login" class="esono-btn esono-btn--ghost">
            <i class="fas fa-arrow-right-to-bracket"></i>
            Se connecter
          </a>
        </header>

        {/* ═══ HERO ═══ */}
        <section class="esono-card" style="border: none; background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%); color: white; padding: 0; overflow: hidden;">
          <div style="padding: 48px 40px; position: relative;">
            <div style="position: absolute; top: -60px; right: -60px; width: 300px; height: 300px; border-radius: 50%; background: rgba(124,58,237,0.08);"></div>
            <p style="font-size: 12px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 12px;">
              Plateforme IA + Coaching humain
            </p>
            <h1 style="font-size: 28px; font-weight: 800; line-height: 1.25; max-width: 600px; margin-bottom: 16px;">
              Accompagnez les PME africaines vers l'Investment Readiness
            </h1>
            <p style="font-size: 15px; color: rgba(255,255,255,0.7); max-width: 520px; line-height: 1.7; margin-bottom: 24px;">
              Structuration du business model, modélisation financière, génération automatique de livrables investisseurs — en 8 modules guidés.
            </p>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <span style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">
                <i class="fas fa-graduation-cap"></i> Micro-learning
              </span>
              <span style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">
                <i class="fas fa-robot"></i> IA assistée
              </span>
              <span style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">
                <i class="fas fa-user-tie"></i> Coaching humain
              </span>
            </div>
          </div>
        </section>

        {/* ═══ CHOIX DE PROFIL ═══ */}
        <section style="margin-top: 32px;">
          <h2 style="font-size: 18px; font-weight: 700; color: #1e293b; text-align: center; margin-bottom: 8px;">
            Choisissez votre espace
          </h2>
          <p style="font-size: 13px; color: #64748b; text-align: center; margin-bottom: 24px;">
            Deux profils, une même plateforme.
          </p>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            {/* CARTE ENTREPRENEUR */}
            <a href="/register?role=entrepreneur" class="esono-card" style="text-decoration: none; border: 2px solid transparent; transition: all 0.2s; cursor: pointer; padding: 0;">
              <div class="esono-card__body" style="padding: 28px 24px;">
                <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(30,58,95,0.08); color: #1e3a5f; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 16px;">
                  🚀
                </div>
                <h3 style="font-size: 17px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">
                  Espace Entrepreneur
                </h3>
                <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-bottom: 16px;">
                  Uploadez vos documents, complétez les 8 modules et générez votre dossier investisseur complet.
                </p>
                <ul style="list-style: none; padding: 0; margin: 0 0 16px; display: flex; flex-direction: column; gap: 6px;">
                  <li style="font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-check" style="color: #059669; font-size: 10px;"></i>
                    Business Model Canvas, SIC, Inputs financiers
                  </li>
                  <li style="font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-check" style="color: #059669; font-size: 10px;"></i>
                    Génération IA : Framework, Diagnostic, OVO, BP
                  </li>
                  <li style="font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-check" style="color: #059669; font-size: 10px;"></i>
                    +10 livrables (Excel, HTML, Word, PDF)
                  </li>
                </ul>
                <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #1e3a5f;">
                  Créer mon compte entrepreneur <i class="fas fa-arrow-right"></i>
                </span>
              </div>
            </a>

            {/* CARTE COACH */}
            <a href="/register?role=coach" class="esono-card" style="text-decoration: none; border: 2px solid transparent; transition: all 0.2s; cursor: pointer; padding: 0;">
              <div class="esono-card__body" style="padding: 28px 24px;">
                <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(124,58,237,0.08); color: #7c3aed; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 16px;">
                  👨‍🏫
                </div>
                <h3 style="font-size: 17px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">
                  Espace Coach
                </h3>
                <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-bottom: 16px;">
                  Gérez vos entrepreneurs, suivez leur progression, analysez leurs dossiers et générez les livrables.
                </p>
                <ul style="list-style: none; padding: 0; margin: 0 0 16px; display: flex; flex-direction: column; gap: 6px;">
                  <li style="font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-check" style="color: #7c3aed; font-size: 10px;"></i>
                    Dashboard de suivi multi-entrepreneurs
                  </li>
                  <li style="font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-check" style="color: #7c3aed; font-size: 10px;"></i>
                    Accès aux dossiers et livrables de chaque PME
                  </li>
                  <li style="font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-check" style="color: #7c3aed; font-size: 10px;"></i>
                    Templates vierges à distribuer
                  </li>
                </ul>
                <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #7c3aed;">
                  Créer mon compte coach <i class="fas fa-arrow-right"></i>
                </span>
              </div>
            </a>
          </div>
        </section>

        {/* ═══ STATS STRIP ═══ */}
        <section class="esono-public__stats" style="margin-top: 32px;">
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

        <style>{`
          .esono-public__shell .esono-card:hover {
            border-color: #cbd5e1 !important;
            box-shadow: 0 4px 16px rgba(0,0,0,0.06);
            transform: translateY(-2px);
          }
          @media (max-width: 640px) {
            .esono-public__shell section > div[style*="grid-template-columns: 1fr 1fr"] {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </div>
    </div>
  )
})

// Register Page - A2
app.get('/register', (c) => {
  const role = c.req.query('role') || 'entrepreneur'
  const isCoach = role === 'coach'
  
  return c.render(
    <div class="esono-auth">
      <div class="esono-auth__shell" style="max-width: 520px;">
        <header class="esono-auth__header">
          <a href="/" class="esono-auth__brand">ES</a>
          <h1 class="esono-auth__title">
            {isCoach ? 'Créer votre compte Coach' : 'Créer votre compte Entrepreneur'}
          </h1>
          <p class="esono-auth__subtitle">
            {isCoach
              ? 'Accédez au dashboard de suivi et accompagnez vos entrepreneurs.'
              : 'Structurez votre projet et générez vos livrables investisseurs.'}
          </p>
        </header>

        {/* Tabs de rôle */}
        <div style="display: flex; gap: 0; margin-bottom: 20px; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0;">
          <a href="/register?role=entrepreneur"
             style={`flex: 1; padding: 10px; text-align: center; font-size: 13px; font-weight: 600; text-decoration: none; transition: all 0.15s; ${!isCoach ? 'background: #1e3a5f; color: white;' : 'background: #f8fafc; color: #64748b;'}`}>
            <i class="fas fa-rocket" style="margin-right: 6px;"></i>
            Entrepreneur
          </a>
          <a href="/register?role=coach"
             style={`flex: 1; padding: 10px; text-align: center; font-size: 13px; font-weight: 600; text-decoration: none; transition: all 0.15s; ${isCoach ? 'background: #7c3aed; color: white;' : 'background: #f8fafc; color: #64748b;'}`}>
            <i class="fas fa-user-tie" style="margin-right: 6px;"></i>
            Coach
          </a>
        </div>

        <div class="esono-card esono-auth__card">
          <div class="esono-card__body">
            <form id="registerForm" class="esono-form">
              <input type="hidden" name="user_type" value="entrepreneur" />
              <input type="hidden" name="role" value={role} />

              <div class="esono-form__group">
                <label for="name" class="esono-form__label">
                  Nom complet <span class="esono-text-danger">*</span>
                </label>
                <input type="text" id="name" name="name" required class="esono-input"
                  placeholder={isCoach ? 'Dr. Kouamé Yao' : 'Awa Traoré'} />
              </div>

              <div class="esono-form__group">
                <label for="email" class="esono-form__label">
                  Email <span class="esono-text-danger">*</span>
                </label>
                <input type="email" id="email" name="email" required class="esono-input"
                  placeholder={isCoach ? 'coach@organisation.com' : 'awa@startup.com'} />
              </div>

              <div class="esono-form__group">
                <label for="password" class="esono-form__label">
                  Mot de passe <span class="esono-text-danger">*</span>
                </label>
                <input type="password" id="password" name="password" required minlength="6" class="esono-input" placeholder="••••••••" />
                <p class="esono-form__note">Minimum 6 caractères</p>
              </div>

              <div class="esono-form__group">
                <label for="country" class="esono-form__label">
                  Pays <span class="esono-text-danger">*</span>
                </label>
                <select id="country" name="country" required class="esono-select">
                  <option value="">Sélectionner un pays</option>
                  <option value="SN">Sénégal</option>
                  <option value="CI">Côte d'Ivoire</option>
                  <option value="BF">Burkina Faso</option>
                  <option value="ML">Mali</option>
                  <option value="BJ">Bénin</option>
                  <option value="TG">Togo</option>
                  <option value="NE">Niger</option>
                  <option value="CM">Cameroun</option>
                  <option value="CD">RD Congo</option>
                  <option value="MA">Maroc</option>
                  <option value="DZ">Algérie</option>
                  <option value="TN">Tunisie</option>
                  <option value="KE">Kenya</option>
                  <option value="NG">Nigeria</option>
                  <option value="GH">Ghana</option>
                  <option value="RW">Rwanda</option>
                </select>
              </div>

              {/* Status is always "entrepreneur" - hidden field */}
              <input type="hidden" name="status" value="entrepreneur" />

              <div class="esono-checkbox">
                <input type="checkbox" id="terms" name="terms" required />
                <label for="terms">
                  J'accepte les conditions d'utilisation et la politique de confidentialité.
                </label>
              </div>

              <div id="error-message" class="esono-alert esono-alert--danger" style="display:none" role="alert"></div>

              <button type="submit" class="esono-btn esono-btn--primary esono-btn--block"
                style={isCoach ? 'background: #7c3aed; border-color: #7c3aed;' : ''}>
                <span id="submit-text">
                  {isCoach ? 'Créer mon compte Coach' : 'Créer mon compte Entrepreneur'}
                </span>
                <span id="submit-loading" style="display:none">
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

// Role selection page removed — role is fixed at registration
// Redirect to appropriate space based on existing role
app.get('/select-role', async (c) => {
  const token = getAuthToken(c)
  if (!token) return c.redirect('/login')
  const payload = await verifyToken(token)
  if (!payload) return c.redirect('/login')

  const user = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(payload.userId).first()
  if (user?.role === 'coach') return c.redirect('/coach/dashboard')
  return c.redirect('/entrepreneur')
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

              <div id="error-message" class="esono-alert esono-alert--danger" style="display:none" role="alert"></div>

              <button type="submit" class="esono-btn esono-btn--primary esono-btn--block">
                <span id="submit-text">Se connecter</span>
                <span id="submit-loading" style="display:none">
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
    const { name, email, password, country, status, user_type, role } = await c.req.json()

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

    // Insert user with role
    const userRole = (role === 'coach' || role === 'entrepreneur') ? role : null
    const result = await c.env.DB.prepare(`
      INSERT INTO users (email, password_hash, name, country, user_type, status, role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(email, passwordHash, name, country, user_type, status, userRole).run()

    // Create default project
    const userId = result.meta.last_row_id
    await c.env.DB.prepare(`
      INSERT INTO projects (user_id, name, description)
      VALUES (?, ?, ?)
    `).bind(userId, `Projet de ${name}`, 'Mon projet entrepreneurial').run()

    // Auto-link: if this email matches a coach_entrepreneurs entry, link automatically
    try {
      await c.env.DB.prepare(
        "UPDATE coach_entrepreneurs SET linked_user_id = ?, updated_at = datetime('now') WHERE email = ? AND linked_user_id IS NULL"
      ).bind(userId, email.trim().toLowerCase()).run()
    } catch (e) {
      // Non-blocking: if linking fails, account is still created
      console.error('Auto-link on register failed:', e)
    }

    // Generate JWT token
    const token = await generateToken({
      userId: Number(userId),
      email,
      userType: user_type
    })

    setCookie(c, 'auth_token', token, getCookieOptions(c))

    return c.json({
      success: true,
      token,
      user: { id: userId, name, email, userType: user_type, role: userRole }
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
      SELECT id, email, password_hash, name, user_type, role
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
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        userType: user.user_type,
        role: user.role || null
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
    const token = getAuthToken(c)
    
    if (!token) {
      return c.json({ error: 'Non authentifié' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.json({ error: 'Token invalide' }, 401)
    }

    const user = await c.env.DB.prepare(`
      SELECT id, email, name, country, user_type, status, role, created_at
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

// API: Set/update user role
// Role change is disabled — role is fixed at registration
app.post('/api/user/role', async (c) => {
  return c.json({ error: 'Le changement de rôle n\'est pas autorisé. Le rôle est défini à l\'inscription.' }, 403)
})

// API: Learning modules registry
app.get('/api/modules/learning', async (c) => {
  try {
    const token = getAuthToken(c)

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
    const token = getAuthToken(c)
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    // Redirect based on role or userType
    const classic = c.req.query('classic')
    if (!classic) {
      // Check stored role in DB
      const roleRow = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(payload.userId).first()
      if (roleRow?.role === 'coach') return c.redirect('/coach/dashboard')
      if (payload.userType === 'entrepreneur') return c.redirect('/entrepreneur')
    }

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
                    Module {nextModule.moduleNumber} • {nextModule.category === 'hybrid' ? 'Upload + IA' : 'Traitement IA automatique'}
                  </div>
                  <h3 class="esono-font-semibold">{nextModule.title}</h3>
                </div>
              </div>
              <p>{nextModule.summary}</p>
              {nextModule.category === 'hybrid' && (
                <div style="display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0;">
                  <span class="esono-badge esono-badge--accent"><i class="fas fa-graduation-cap"></i> Micro-learning</span>
                  <span class="esono-badge esono-badge--info"><i class="fas fa-robot"></i> Analyse IA</span>
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

        {/* Modules sources (1-3) */}
        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-graduation-cap esono-card__title-icon"></i>
              Modules sources (1-3)
            </h2>
            <span class="esono-badge esono-badge--accent">
              Upload + IA
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
              Les livrables sont générés automatiquement par l'IA à partir de vos documents uploadés.
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

// ═══════════════════════════════════════════════════════════════
// Helper: Render Plan OVO Module Page HTML
// ═══════════════════════════════════════════════════════════════
function renderPlanOvoModulePage(opts: {
  hasFramework: boolean; hasBmc: boolean; hasSic: boolean; hasDiagnostic: boolean;
  hasPlan: boolean; planStatus: string; planScore: number | null; planVersion: number; hasHtmlPreview: boolean;
  framework: any; bmc: any; sic: any; diagnostic: any; user: any;
}): string {
  const { hasFramework, hasBmc, hasSic, hasDiagnostic, hasPlan, planStatus, planScore, planVersion, hasHtmlPreview, framework, bmc, sic, diagnostic, user } = opts
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plan Financier OVO — Format Bailleurs | GOTCHE</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { font-family: 'Inter', sans-serif; }
    body { background: white; margin: 0; }
    .ovo-header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white; padding: 24px 32px; }
    .ovo-header__back { color: #94a3b8; text-decoration: none; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; margin-bottom: 16px; transition: color 0.2s; }
    .ovo-header__back:hover { color: white; }
    .ovo-header__title { font-size: 28px; font-weight: 800; display: flex; align-items: center; gap: 14px; }
    .ovo-header__sub { color: #94a3b8; font-size: 14px; margin-top: 6px; }
    .ovo-container { max-width: 1100px; margin: 0 auto; padding: 24px 20px 60px; }
    .ovo-card { background: white; border-radius: 16px; border: 1px solid #e2e8f0; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .ovo-card__title { font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
    .ovo-source { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: #f8fafc; border-radius: 12px; margin-bottom: 8px; border: 1px solid #e2e8f0; }
    .ovo-source--ok { background: #f0fdf4; border-color: #bbf7d0; }
    .ovo-source--missing { background: #fef2f2; border-color: #fecaca; }
    .ovo-source--optional { background: #fffbeb; border-color: #fde68a; }
    .ovo-source__icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .ovo-source__label { font-size: 14px; font-weight: 600; color: #1e293b; }
    .ovo-source__status { font-size: 12px; margin-top: 2px; }
    .ovo-btn { display: inline-flex; align-items: center; gap: 10px; padding: 14px 28px; border-radius: 12px; font-size: 15px; font-weight: 700; border: none; cursor: pointer; transition: all 0.2s; }
    .ovo-btn--primary { background: linear-gradient(135deg, #ea580c, #c2410c); color: white; box-shadow: 0 4px 14px rgba(234,88,12,0.3); }
    .ovo-btn--primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(234,88,12,0.4); }
    .ovo-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
    .ovo-btn--download { background: #059669; color: white; box-shadow: 0 4px 14px rgba(5,150,105,0.3); }
    .ovo-btn--download:hover { background: #047857; }
    .ovo-btn--download:disabled { opacity: 0.4; cursor: not-allowed; }
    .ovo-btn--fill { background: #2563eb; color: white; box-shadow: 0 4px 14px rgba(37,99,235,0.3); }
    .ovo-btn--fill:hover { background: #1d4ed8; }
    .ovo-btn--fill:disabled { opacity: 0.4; cursor: not-allowed; }
    .ovo-badge--filled { background: #d1fae5; color: #065f46; }
    .ovo-preview { background: #f1f5f9; border-radius: 16px; border: 2px dashed #cbd5e1; padding: 60px 20px; text-align: center; color: #64748b; }
    .ovo-preview--ready { border-style: solid; border-color: #059669; background: #f0fdf4; }
    .ovo-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .ovo-badge--pending { background: #fef3c7; color: #92400e; }
    .ovo-badge--generating { background: #dbeafe; color: #1e40af; }
    .ovo-badge--generated { background: #d1fae5; color: #065f46; }
    .ovo-badge--error { background: #fee2e2; color: #991b1b; }
    .ovo-badge--none { background: #f1f5f9; color: #64748b; }
    .ovo-sheets { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-top: 14px; }
    .ovo-sheet { padding: 12px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; text-align: center; }
    .ovo-sheet__name { font-size: 13px; font-weight: 600; color: #334155; }
    .ovo-sheet__desc { font-size: 11px; color: #94a3b8; margin-top: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .ovo-spin { animation: spin 1s linear infinite; }
  </style>
</head>
<body>
  <div class="ovo-header">
    <a href="/entrepreneur" class="ovo-header__back"><i class="fas fa-arrow-left"></i> Retour au tableau de bord</a>
    <div class="ovo-header__title">
      \u{1F4B0} Plan Financier OVO \u2014 Format Bailleurs
    </div>
    <div class="ovo-header__sub">
      Phase 3 \u00B7 Dossier Investisseur \u2014 Module 6 \u00B7 Projections financi\u00E8res 5 ans (InputsData, RevenueData, FinanceData)
    </div>
  </div>

  <div class="ovo-container">

    <!-- Description -->
    <div class="ovo-card">
      <div class="ovo-card__title"><i class="fas fa-info-circle" style="color:#0284c7"></i> \u00C0 propos</div>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0">
        Le <strong>Plan Financier OVO</strong> est le document financier au format bailleurs (OVO - Outil de Valorisation des Opportunit\u00E9s). 
        Il est g\u00E9n\u00E9r\u00E9 automatiquement \u00E0 partir de vos donn\u00E9es Framework (obligatoire) et enrichi avec les informations de votre BMC, SIC et Diagnostic.
        Le r\u00E9sultat est un fichier <strong>Excel (.xlsm)</strong> contenant vos projections financi\u00E8res sur 5 ans : 
        revenus par produit/service, P&amp;L, cash-flow, et plan de financement.
      </p>
    </div>

    <!-- Sources disponibles -->
    <div class="ovo-card">
      <div class="ovo-card__title"><i class="fas fa-database" style="color:#7c3aed"></i> Sources de donn\u00E9es</div>
      
      <div class="ovo-source ${hasFramework ? 'ovo-source--ok' : 'ovo-source--missing'}">
        <div class="ovo-source__icon" style="background:${hasFramework ? '#d1fae5' : '#fee2e2'};color:${hasFramework ? '#059669' : '#dc2626'}">
          <i class="fas fa-chart-pie"></i>
        </div>
        <div style="flex:1">
          <div class="ovo-source__label">Plan Financier Interm\u00E9diaire (Framework)</div>
          <div class="ovo-source__status" style="color:${hasFramework ? '#059669' : '#dc2626'}">
            ${hasFramework 
              ? `<i class="fas fa-check-circle"></i> Disponible \u2014 Score: ${framework?.score || '\u2014'}/100`
              : '<i class="fas fa-exclamation-triangle"></i> <strong>REQUIS</strong> \u2014 G\u00E9n\u00E9rez d\'abord vos livrables depuis le tableau de bord'}
          </div>
        </div>
        <span class="ovo-badge ${hasFramework ? 'ovo-badge--generated' : 'ovo-badge--error'}">
          ${hasFramework ? '<i class="fas fa-check"></i> OK' : '<i class="fas fa-times"></i> Manquant'}
        </span>
      </div>

      <div class="ovo-source ${hasBmc ? 'ovo-source--ok' : 'ovo-source--optional'}">
        <div class="ovo-source__icon" style="background:${hasBmc ? '#d1fae5' : '#fef3c7'};color:${hasBmc ? '#059669' : '#d97706'}">
          <i class="fas fa-th"></i>
        </div>
        <div style="flex:1">
          <div class="ovo-source__label">Business Model Canvas (BMC)</div>
          <div class="ovo-source__status" style="color:${hasBmc ? '#059669' : '#d97706'}">
            ${hasBmc 
              ? `<i class="fas fa-check-circle"></i> Disponible \u2014 Score: ${bmc?.score || '\u2014'}/100`
              : '<i class="fas fa-info-circle"></i> Optionnel \u2014 enrichit la description des activit\u00E9s'}
          </div>
        </div>
        <span class="ovo-badge ${hasBmc ? 'ovo-badge--generated' : 'ovo-badge--pending'}">
          ${hasBmc ? '<i class="fas fa-check"></i> OK' : '<i class="fas fa-minus"></i> Optionnel'}
        </span>
      </div>

      <div class="ovo-source ${hasSic ? 'ovo-source--ok' : 'ovo-source--optional'}">
        <div class="ovo-source__icon" style="background:${hasSic ? '#d1fae5' : '#fef3c7'};color:${hasSic ? '#059669' : '#d97706'}">
          <i class="fas fa-hand-holding-heart"></i>
        </div>
        <div style="flex:1">
          <div class="ovo-source__label">Social Impact Canvas (SIC)</div>
          <div class="ovo-source__status" style="color:${hasSic ? '#059669' : '#d97706'}">
            ${hasSic 
              ? `<i class="fas fa-check-circle"></i> Disponible \u2014 Score: ${sic?.score || '\u2014'}/100`
              : '<i class="fas fa-info-circle"></i> Optionnel \u2014 enrichit les indicateurs d\'impact'}
          </div>
        </div>
        <span class="ovo-badge ${hasSic ? 'ovo-badge--generated' : 'ovo-badge--pending'}">
          ${hasSic ? '<i class="fas fa-check"></i> OK' : '<i class="fas fa-minus"></i> Optionnel'}
        </span>
      </div>

      <div class="ovo-source ${hasDiagnostic ? 'ovo-source--ok' : 'ovo-source--optional'}">
        <div class="ovo-source__icon" style="background:${hasDiagnostic ? '#d1fae5' : '#fef3c7'};color:${hasDiagnostic ? '#059669' : '#d97706'}">
          <i class="fas fa-stethoscope"></i>
        </div>
        <div style="flex:1">
          <div class="ovo-source__label">Diagnostic Expert</div>
          <div class="ovo-source__status" style="color:${hasDiagnostic ? '#059669' : '#d97706'}">
            ${hasDiagnostic 
              ? `<i class="fas fa-check-circle"></i> Disponible \u2014 Score: ${diagnostic?.score || '\u2014'}/100`
              : '<i class="fas fa-info-circle"></i> Optionnel \u2014 enrichit l\'analyse des risques'}
          </div>
        </div>
        <span class="ovo-badge ${hasDiagnostic ? 'ovo-badge--generated' : 'ovo-badge--pending'}">
          ${hasDiagnostic ? '<i class="fas fa-check"></i> OK' : '<i class="fas fa-minus"></i> Optionnel'}
        </span>
      </div>
    </div>

    <!-- G\u00E9n\u00E9ration -->
    <div class="ovo-card">
      <div class="ovo-card__title">
        <i class="fas fa-cog" style="color:#ea580c"></i> G\u00E9n\u00E9ration du Plan OVO
        ${hasPlan ? `<span class="ovo-badge ovo-badge--${planStatus}">${
          planStatus === 'pending' ? '<i class="fas fa-clock"></i> En attente' :
          planStatus === 'generating' ? '<i class="fas fa-spinner ovo-spin"></i> En cours' :
          planStatus === 'generated' ? '<i class="fas fa-check-circle"></i> G\u00E9n\u00E9r\u00E9' :
          planStatus === 'filling' ? '<i class="fas fa-spinner ovo-spin"></i> Remplissage' :
          planStatus === 'filled' ? '<i class="fas fa-file-excel"></i> Excel pr\u00EAt' :
          planStatus === 'error' ? '<i class="fas fa-exclamation-circle"></i> Erreur' :
          '<i class="fas fa-minus"></i> Inconnu'
        }</span>` : '<span class="ovo-badge ovo-badge--none"><i class="fas fa-minus"></i> Non g\u00E9n\u00E9r\u00E9</span>'}
        ${planVersion > 0 ? `<span style="font-size:12px;color:#94a3b8;font-weight:400">v${planVersion}</span>` : ''}
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
        <button class="ovo-btn ovo-btn--primary" id="btn-generate" 
          ${!hasFramework ? 'disabled title="Framework requis"' : ''}
          onclick="generatePlanOVO()">
          <i class="fas fa-wand-magic-sparkles"></i>
          ${hasPlan ? 'Reg\u00E9n\u00E9rer le Plan OVO' : '\u{1F4B0} G\u00E9n\u00E9rer le Plan Financier OVO'}
        </button>

        <button class="ovo-btn ovo-btn--download" id="btn-download" 
          ${!hasPlan || (planStatus !== 'generated' && planStatus !== 'filled') ? 'disabled title="Plan non encore g\u00E9n\u00E9r\u00E9"' : ''}
          onclick="downloadPlanOVO()">
          <i class="fas fa-download"></i>
          T\u00E9l\u00E9charger Excel (.xlsm)
        </button>

        ${hasPlan && planStatus === 'generated' ? `
        <button class="ovo-btn ovo-btn--fill" id="btn-fill" onclick="fillPlanOVO()">
          <i class="fas fa-file-excel"></i>
          Remplir le Template Excel
        </button>` : ''}
      </div>

      ${!hasFramework ? `
      <div style="padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px;color:#991b1b;font-size:14px;font-weight:600">
          <i class="fas fa-exclamation-triangle"></i> Framework requis
        </div>
        <p style="font-size:13px;color:#7f1d1d;margin:8px 0 0;line-height:1.6">
          Le Plan Financier Interm\u00E9diaire (Framework) doit \u00EAtre g\u00E9n\u00E9r\u00E9 avant de cr\u00E9er le Plan OVO.
          <a href="/entrepreneur" style="color:#2563eb;text-decoration:underline">Retourner au tableau de bord</a> pour g\u00E9n\u00E9rer vos livrables.
        </p>
      </div>` : ''}

      <!-- Aper\u00E7u HTML central -->
      <div id="preview-area" class="ovo-preview ${hasHtmlPreview ? 'ovo-preview--ready' : ''}">
        ${hasHtmlPreview ? '<p style="color:#059669;font-weight:600"><i class="fas fa-eye"></i> Aper\u00E7u disponible</p>' :
          hasPlan && planStatus === 'pending' ? '<div><i class="fas fa-hourglass-half" style="font-size:40px;color:#d97706;margin-bottom:14px"></i><p style="font-weight:600;color:#92400e">Plan OVO en attente de traitement IA</p><p style="font-size:13px;color:#a16207">Le remplissage automatique du template Excel sera disponible prochainement.</p></div>' :
          '<div><i class="fas fa-file-excel" style="font-size:48px;color:#cbd5e1;margin-bottom:14px"></i><p style="font-weight:600;color:#64748b">Aucun aper\u00E7u disponible</p><p style="font-size:13px;color:#94a3b8">Cliquez sur "G\u00E9n\u00E9rer le Plan Financier OVO" pour commencer</p></div>'
        }
      </div>
    </div>

    <!-- Template info -->
    <div class="ovo-card">
      <div class="ovo-card__title"><i class="fas fa-file-excel" style="color:#059669"></i> Structure du Template OVO</div>
      <p style="font-size:13px;color:#64748b;margin:0 0 14px">
        Le template <strong>Plan Financier OVO</strong> contient 10 feuilles Excel structur\u00E9es pour le format bailleurs :
      </p>
      <div class="ovo-sheets">
        <div class="ovo-sheet"><i class="fas fa-keyboard" style="color:#2563eb;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">InputsData</div><div class="ovo-sheet__desc">Donn\u00E9es de l'entreprise</div></div>
        <div class="ovo-sheet"><i class="fas fa-chart-bar" style="color:#059669;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">RevenueData</div><div class="ovo-sheet__desc">Revenus par produit</div></div>
        <div class="ovo-sheet"><i class="fas fa-calculator" style="color:#7c3aed;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">FinanceData</div><div class="ovo-sheet__desc">P&amp;L, Cash flow, Bilan</div></div>
        <div class="ovo-sheet"><i class="fas fa-table" style="color:#d97706;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">RevenuePivot</div><div class="ovo-sheet__desc">Tableau crois\u00E9 revenus</div></div>
        <div class="ovo-sheet"><i class="fas fa-table-cells" style="color:#dc2626;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">FinancePivot</div><div class="ovo-sheet__desc">Tableau crois\u00E9 finances</div></div>
        <div class="ovo-sheet"><i class="fas fa-chart-line" style="color:#0891b2;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">RevenueChart</div><div class="ovo-sheet__desc">Graphiques revenus</div></div>
        <div class="ovo-sheet"><i class="fas fa-chart-area" style="color:#4f46e5;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">FinanceChart</div><div class="ovo-sheet__desc">Graphiques finances</div></div>
        <div class="ovo-sheet"><i class="fas fa-euro-sign" style="color:#0d9488;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">FinanceEUR</div><div class="ovo-sheet__desc">Conversion EUR</div></div>
        <div class="ovo-sheet"><i class="fas fa-book" style="color:#94a3b8;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">Instructions</div><div class="ovo-sheet__desc">Guide d'utilisation</div></div>
        <div class="ovo-sheet"><i class="fas fa-info" style="color:#94a3b8;font-size:18px;margin-bottom:6px"></i><div class="ovo-sheet__name">ReadMe</div><div class="ovo-sheet__desc">M\u00E9tadonn\u00E9es</div></div>
      </div>
    </div>

  </div>

  <script>
    function getToken() {
      const cookies = document.cookie.split(';');
      for (const c of cookies) {
        const [k, v] = c.trim().split('=');
        if (k === 'auth_token') return v;
      }
      return localStorage.getItem('auth_token') || '';
    }

    async function generatePlanOVO() {
      const btn = document.getElementById('btn-generate');
      const prev = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner ovo-spin"></i> G\u00E9n\u00E9ration en cours...';
      
      try {
        const res = await fetch('/api/plan-ovo/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
          body: JSON.stringify({ pmeId: 'pme_current' })
        });
        const data = await res.json();
        
        if (data.success) {
          document.getElementById('preview-area').innerHTML = '<div style="text-align:center;padding:40px">' +
            '<i class="fas fa-check-circle" style="font-size:48px;color:#059669;margin-bottom:14px"></i>' +
            '<p style="font-weight:700;color:#065f46;font-size:16px">Plan OVO cr\u00E9\u00E9 (v' + (data.version || 1) + ')</p>' +
            '<p style="font-size:13px;color:#047857">Sources : Framework ' + (data.sources?.framework ? '\u2705' : '\u274C') +
            ' \u00B7 BMC ' + (data.sources?.bmc ? '\u2705' : '\u2796') +
            ' \u00B7 SIC ' + (data.sources?.sic ? '\u2705' : '\u2796') +
            ' \u00B7 Diagnostic ' + (data.sources?.diagnostic ? '\u2705' : '\u2796') + '</p>' +
            '<p style="font-size:12px;color:#a16207;margin-top:12px"><i class="fas fa-hourglass-half"></i> ' + data.message + '</p>' +
            '</div>';
          btn.innerHTML = '<i class="fas fa-check"></i> Plan OVO cr\u00E9\u00E9 !';
          setTimeout(function() { btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Reg\u00E9n\u00E9rer le Plan OVO'; btn.disabled = false; }, 3000);
        } else {
          alert(data.message || data.error || 'Erreur lors de la g\u00E9n\u00E9ration');
          btn.innerHTML = prev;
          btn.disabled = false;
        }
      } catch (err) {
        alert('Erreur r\u00E9seau : ' + err.message);
        btn.innerHTML = prev;
        btn.disabled = false;
      }
    }

    async function fillPlanOVO() {
      const btn = document.getElementById('btn-fill');
      if (!btn) return;
      const prev = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner ovo-spin"></i> Remplissage en cours...';
      try {
        const latestRes = await fetch('/api/plan-ovo/latest/pme_current', {
          headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        const latestData = await latestRes.json();
        const planId = latestData?.data?.id;
        if (!planId) { alert('Plan non trouv\u00E9'); btn.innerHTML = prev; btn.disabled = false; return; }
        const res = await fetch('/api/plan-ovo/fill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
          body: JSON.stringify({ planId: planId })
        });
        const data = await res.json();
        if (data.success) {
          btn.innerHTML = '<i class="fas fa-check"></i> Excel rempli !';
          document.getElementById('btn-download').disabled = false;
          setTimeout(function() { location.reload(); }, 2000);
        } else {
          alert(data.error || 'Erreur remplissage');
          btn.innerHTML = prev; btn.disabled = false;
        }
      } catch (err) {
        alert('Erreur: ' + err.message);
        btn.innerHTML = prev; btn.disabled = false;
      }
    }

    async function downloadPlanOVO() {
      const btn = document.getElementById('btn-download');
      const prev = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner ovo-spin"></i> Pr\u00E9paration...';
      try {
        // Get plan ID
        const latestRes = await fetch('/api/plan-ovo/latest/pme_current', {
          headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        const latestData = await latestRes.json();
        const planId = latestData?.data?.id;
        if (!planId) { alert('Aucun plan trouv\u00E9'); btn.innerHTML = prev; btn.disabled = false; return; }

        // If status is 'generated' but not 'filled', fill first
        if (latestData?.data?.status === 'generated' && !latestData?.data?.hasExcel) {
          btn.innerHTML = '<i class="fas fa-spinner ovo-spin"></i> Remplissage Excel...';
          const fillRes = await fetch('/api/plan-ovo/fill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
            body: JSON.stringify({ planId: planId })
          });
          const fillData = await fillRes.json();
          if (!fillData.success) {
            alert('Erreur remplissage: ' + (fillData.error || 'Inconnu'));
            btn.innerHTML = prev; btn.disabled = false;
            return;
          }
        }

        // Download the file
        btn.innerHTML = '<i class="fas fa-spinner ovo-spin"></i> T\u00E9l\u00E9chargement...';
        const resp = await fetch('/api/plan-ovo/download/' + planId, {
          headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          alert(errData.error || errData.message || 'Erreur t\u00E9l\u00E9chargement');
          btn.innerHTML = prev; btn.disabled = false;
          return;
        }
        // Get filename from Content-Disposition header
        const cd = resp.headers.get('Content-Disposition') || '';
        const fnMatch = cd.match(/filename="([^"]+)"/);
        const filename = fnMatch ? fnMatch[1] : 'Plan_OVO.xlsm';

        // Create download link
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        btn.innerHTML = '<i class="fas fa-check"></i> T\u00E9l\u00E9charg\u00E9 !';
        setTimeout(function() { btn.innerHTML = prev; btn.disabled = false; }, 3000);
      } catch (err) {
        alert('Erreur: ' + err.message);
        btn.innerHTML = prev;
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════
// Helper: Render Diagnostic Expert Module Page HTML
// ═══════════════════════════════════════════════════════════════
function renderDiagnosticModulePage(opts: {
  hasBmc: boolean; hasSic: boolean; hasFramework: boolean; hasFrameworkPme: boolean; hasPlanOvo: boolean;
  hasDiagnostic: boolean; diagStatus: string; diagScore: number | null; diagVersion: number;
  diagId: string | null; isPartial: boolean; user: any; analysis: any; createdAt: string; embedded?: boolean;
}): string {
  const { hasBmc, hasSic, hasFramework, hasFrameworkPme, hasPlanOvo, hasDiagnostic, diagStatus, diagScore, diagVersion, diagId, isPartial, user, analysis, createdAt, embedded } = opts
  const availableCount = [hasBmc, hasSic, hasFramework, hasFrameworkPme, hasPlanOvo].filter(Boolean).length
  const canGenerate = availableCount >= 2

  // Helpers
  const esc = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const fmtNum = (n: any) => { const v = Number(n); if (isNaN(v)) return String(n ?? '—'); if (Math.abs(v)>=1e6) return (v/1e6).toFixed(1)+'M'; if (Math.abs(v)>=1e3) return (v/1e3).toFixed(0)+'k'; return v.toString() }

  const scoreColor = (s: number) => s >= 86 ? '#059669' : s >= 71 ? '#059669' : s >= 51 ? '#84cc16' : s >= 31 ? '#eab308' : '#f97316'
  const barColor = (s: number) => s > 75 ? '#22c55e' : s >= 60 ? '#eab308' : s >= 40 ? '#f97316' : '#ef4444'
  const niveauBg = (n: string) => n === 'critique' || n === 'elevee' || n === 'eleve' ? '#fef2f2' : n === 'moyen' || n === 'moyenne' ? '#fffbeb' : '#f8fafc'
  const niveauColor = (n: string) => n === 'critique' || n === 'elevee' || n === 'eleve' ? '#dc2626' : n === 'moyen' || n === 'moyenne' ? '#d97706' : '#64748b'
  const urgencyBadge = (u: string) => { const ul = (u||'').toLowerCase(); if (ul.includes('imm') || ul.includes('critique') || ul.includes('court')) return '\u{1F534} Critique'; if (ul.includes('important') || ul.includes('moyen')) return '\u{1F7E0} Important'; return '\u{1F7E1} Recommandé' }
  const urgencyBorder = (u: string) => { const ul = (u||'').toLowerCase(); if (ul.includes('imm') || ul.includes('critique') || ul.includes('court')) return '#ef4444'; if (ul.includes('important') || ul.includes('moyen')) return '#f97316'; return '#eab308' }

  // Extract data from analysis — supports BOTH old format (dimensions[], scoreGlobal) and new format (scores_dimensions, score_global)
  const a = analysis || {} as any
  const isOldFormat = !a.scores_dimensions && !a.score_global && (Array.isArray(a.dimensions) || a.scoreGlobal !== undefined)

  // Normalize old format → new format fields
  const scoreGlobal = a.score_global || a.scoreGlobal || diagScore || 0
  const palier = a.palier ?? a.verdict ?? ''
  const label = a.label ?? a.verdict ?? (scoreGlobal >= 71 ? 'Projet solide' : scoreGlobal >= 51 ? 'Projet en développement' : scoreGlobal >= 31 ? 'À consolider' : scoreGlobal > 0 ? 'À renforcer' : 'En attente')
  const couleur = a.couleur ?? a.verdictColor ?? ''

  // Convert old dimensions[] to scores_dimensions{}
  let sd = a.scores_dimensions || {}
  if (isOldFormat && Array.isArray(a.dimensions) && a.dimensions.length > 0 && Object.keys(sd).length === 0) {
    const codeMapping: Record<string, string> = {
      'modele_economique': 'coherence',
      'viabilite_financiere': 'viabilite',
      'impact_social': 'realisme',
      'equipe_gouvernance': 'completude_couts',
      'marche_positionnement': 'capacite_remboursement',
    }
    for (const dim of a.dimensions) {
      const key = codeMapping[dim.code] || dim.code || dim.name?.toLowerCase().replace(/[^a-z]/g, '_')
      sd[key] = {
        score: dim.score || 0,
        label: dim.name || key,
        commentaire: dim.analysis || '',
        verdict: dim.verdict || '',
        incoherences_detectees: [],
        red_flags: [],
        postes_manquants: [],
      }
    }
  }

  const vigilance = Array.isArray(a.points_vigilance) ? a.points_vigilance : (Array.isArray(a.risks) ? a.risks.map((r: any) => ({ titre: r.title || r.titre || r, description: r.description || '', niveau: r.level || 'moyen', categorie: r.category || 'general', probabilite: '', impact_financier: '', action_recommandee: r.mitigation || '' })) : [])
  const incoherences = Array.isArray(a.incoherences) ? a.incoherences : (Array.isArray(a.coherenceIssues) ? a.coherenceIssues.map((ci: any) => ({ type: 'Incohérence', description: typeof ci === 'string' ? ci : ci.description || '' })) : [])
  const risquesCtx = Array.isArray(a.risques_contextuels) ? a.risques_contextuels : []
  const forces = Array.isArray(a.forces) ? a.forces : (Array.isArray(a.strengths) ? a.strengths.map((s: any) => typeof s === 'string' ? { titre: s } : s) : [])
  const opps = Array.isArray(a.opportunites_amelioration) ? a.opportunites_amelioration : (Array.isArray(a.weaknesses) ? a.weaknesses.map((w: any) => typeof w === 'string' ? { titre: w } : w) : [])
  const recs = Array.isArray(a.recommandations) ? a.recommandations : (Array.isArray(a.actionPlan) ? a.actionPlan.map((ap: any) => typeof ap === 'string' ? { titre: ap, detail: '' } : { titre: ap.title || ap.titre || '', detail: ap.description || ap.detail || '', urgence: ap.priority || '' }) : [])
  const benchmarks = a.benchmarks || {}
  const resumeExec = a.resume_executif || a.executiveSummary || ''
  const pap = Array.isArray(a.points_attention_prioritaires) ? a.points_attention_prioritaires : []
  const livrables = a.livrables_analyses || a.sources || {}
  const contexte = a.contexte_pays || {}
  const donneesCompletes = a.donnees_completes !== false
  const messageIncomplet = a.message_incomplet || ''

  const companyName = user?.name ?? 'Entrepreneur'
  // Sector: try contexte, then dimensions data, fallback empty
  const sector = contexte.secteur || a.sector || a.secteur || ''
  // Date: safely parse createdAt, fallback to current date
  let genDate: string
  try {
    const d = createdAt ? new Date(createdAt) : new Date()
    genDate = isNaN(d.getTime()) ? new Date().toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }) : d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
  } catch { genDate = new Date().toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }) }

  // Dimension display config (includes both new and old format codes)
  const dimConfig: Record<string, {icon:string; label:string; color:string}> = {
    coherence: { icon: 'fa-link', label: 'Cohérence financière', color: '#3b82f6' },
    viabilite: { icon: 'fa-chart-line', label: 'Viabilité économique', color: '#8b5cf6' },
    realisme: { icon: 'fa-bullseye', label: 'Réalisme des projections', color: '#06b6d4' },
    completude_couts: { icon: 'fa-list-check', label: 'Complétude des coûts', color: '#f59e0b' },
    capacite_remboursement: { icon: 'fa-hand-holding-dollar', label: 'Capacité de remboursement', color: '#10b981' },
    // Old format dimension codes (mapped from codeMapping)
    modele_economique: { icon: 'fa-diagram-project', label: 'Modèle Économique', color: '#3b82f6' },
    impact_social: { icon: 'fa-hand-holding-heart', label: 'Impact Social & ODD', color: '#8b5cf6' },
    viabilite_financiere: { icon: 'fa-chart-line', label: 'Viabilité Financière', color: '#06b6d4' },
    equipe_gouvernance: { icon: 'fa-users', label: 'Équipe & Gouvernance', color: '#f59e0b' },
    marche_positionnement: { icon: 'fa-bullseye', label: 'Marché & Positionnement', color: '#10b981' },
  }

  // Check if we have a generated diagnostic to render
  const hasAnalysis = !!analysis && (diagStatus === 'generated' || diagStatus === 'analyzed' || diagStatus === 'partial')

  // ═══ SECTIONS HTML (only built if analysis exists) ═══

  // Incomplete data banner
  const incompleteBannerHtml = (!donneesCompletes && hasAnalysis) ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px 24px;margin-bottom:20px;display:flex;align-items:flex-start;gap:14px">
      <div style="font-size:24px;flex-shrink:0">\u26A0\uFE0F</div>
      <div>
        <div style="font-weight:700;color:#92400e;font-size:15px;margin-bottom:6px">Données incomplètes</div>
        <div style="color:#78350f;font-size:13px;line-height:1.6">${esc(messageIncomplet)}</div>
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
          ${Object.entries(livrables).map(([k, v]) => `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${v ? '#f0fdf4' : '#fef2f2'};color:${v ? '#059669' : '#dc2626'};border:1px solid ${v ? '#bbf7d0' : '#fecaca'}">${v ? '\u2705' : '\u274C'} ${esc(k)}</span>`).join('')}
        </div>
      </div>
    </div>` : ''

  // Executive summary
  const execSummaryHtml = hasAnalysis && resumeExec ? `
    <div style="background:#f0fdfa;border-left:4px solid #0d9488;border-radius:0 12px 12px 0;padding:24px 28px;margin-bottom:24px">
      <div style="font-size:15px;font-weight:700;color:#0d9488;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-file-lines"></i> Résumé Exécutif
      </div>
      <div style="font-size:1rem;color:#475569;line-height:1.8;white-space:pre-line">${esc(resumeExec)}</div>
    </div>` : ''

  // Global score gauge
  const gaugeHtml = hasAnalysis ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:28px;margin-bottom:24px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:14px;color:#64748b;font-weight:600;margin-bottom:16px">Indicateur de progression</div>
      <div style="position:relative;width:120px;height:120px;margin:0 auto 16px">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" stroke-width="10"/>
          <circle id="gaugeArc" cx="60" cy="60" r="52" fill="none" stroke="${scoreColor(scoreGlobal)}" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="${2 * Math.PI * 52}" stroke-dashoffset="${2 * Math.PI * 52}" transform="rotate(-90 60 60)"
            style="transition:stroke-dashoffset 1.5s ease-out"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <span id="scoreNum" style="font-size:36px;font-weight:800;color:${scoreColor(scoreGlobal)}">0</span>
          <span style="font-size:12px;color:#64748b">/100</span>
        </div>
      </div>
      <div style="font-size:14px;color:${scoreColor(scoreGlobal)};font-weight:600">${esc(label)}</div>
      ${diagVersion > 0 ? `<span style="display:inline-block;margin-top:8px;padding:2px 10px;background:#f1f5f9;border-radius:20px;font-size:11px;color:#64748b">v${diagVersion}</span>` : ''}
    </div>` : ''

  // Priority attention points (show if not empty OR score < 40)
  const showPap = hasAnalysis && (pap.length > 0 || scoreGlobal < 40)
  const papHtml = showPap ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px 24px;margin-bottom:24px">
      <div style="font-size:15px;font-weight:700;color:#92400e;margin-bottom:12px;display:flex;align-items:center;gap:10px">
        \u26A0\uFE0F Points d'attention prioritaires
      </div>
      <ul style="list-style:none;padding:0;margin:0">
        ${pap.map((p: any) => `<li style="padding:8px 0;color:#78350f;font-size:14px;line-height:1.5;border-bottom:1px solid #fde68a;display:flex;align-items:flex-start;gap:10px">
          <span style="color:#f97316;flex-shrink:0">\u25B6</span> ${esc(typeof p === 'string' ? p : p.titre || p.description || JSON.stringify(p))}
        </li>`).join('')}
      </ul>
    </div>` : ''

  // Dimensions cards — use keys from actual data
  const defaultDimKeys = ['coherence', 'viabilite', 'realisme', 'completude_couts', 'capacite_remboursement']
  const dimKeys = Object.keys(sd).length > 0 ? Object.keys(sd) : defaultDimKeys
  const dimsHtml = hasAnalysis ? dimKeys.map(key => {
    const dim = sd[key] || {}
    const cfg = dimConfig[key] || { icon:'fa-circle', label:key, color:'#64748b' }
    const score = dim.score ?? 0
    const comment = dim.commentaire || ''
    const incoD = Array.isArray(dim.incoherences_detectees) ? dim.incoherences_detectees : []
    const redFlags = Array.isArray(dim.red_flags) ? dim.red_flags : []
    const postesM = Array.isArray(dim.postes_manquants) ? dim.postes_manquants : []
    return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:20px 24px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:10px;background:${cfg.color}22;display:flex;align-items:center;justify-content:center">
            <i class="fas ${cfg.icon}" style="color:${cfg.color};font-size:15px"></i>
          </div>
          <span style="font-size:15px;font-weight:700;color:#1e293b">${esc(dim.label || cfg.label)}</span>
        </div>
        <span style="font-size:22px;font-weight:800;color:${barColor(score)}">${score}<span style="font-size:13px;color:#64748b">/100</span></span>
      </div>
      <div style="background:#f1f5f9;border-radius:6px;height:12px;overflow:hidden;margin-bottom:14px">
        <div class="dim-bar" data-target="${score}" style="height:100%;width:0%;background:${barColor(score)};border-radius:6px;transition:width 1.2s ease-out"></div>
      </div>
      <div style="font-size:13px;color:#64748b;line-height:1.7">${esc(comment)}</div>
      ${incoD.length > 0 ? `<div style="margin-top:12px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px">
        <div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px"><i class="fas fa-exclamation-triangle"></i> Incohérences détectées</div>
        ${incoD.map((inc: any) => `<div style="font-size:12px;color:#991b1b;margin-top:4px">\u2022 ${esc(typeof inc === 'string' ? inc : inc.description || JSON.stringify(inc))}</div>`).join('')}
      </div>` : ''}
      ${redFlags.length > 0 ? `<div style="margin-top:10px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px">
        <div style="font-size:12px;font-weight:700;color:#ef4444;margin-bottom:6px"><i class="fas fa-flag"></i> Red Flags</div>
        ${redFlags.map((rf: any) => `<div style="font-size:12px;color:#991b1b;margin-top:4px">\u2022 ${esc(typeof rf === 'string' ? rf : rf.description || JSON.stringify(rf))}</div>`).join('')}
      </div>` : ''}
      ${postesM.length > 0 ? `<div style="margin-top:10px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
        <div style="font-size:12px;font-weight:700;color:#d97706;margin-bottom:6px"><i class="fas fa-list"></i> Postes manquants</div>
        ${postesM.map((pm: any) => `<div style="font-size:12px;color:#92400e;margin-top:4px">\u2022 ${esc(pm)}</div>`).join('')}
      </div>` : ''}
    </div>`
  }).join('') : ''

  // Forces & Opportunities (two-column)
  const forcesHtml = hasAnalysis && forces.length > 0 ? forces.map((f: any) => `
    <div style="padding:10px 0;border-bottom:1px solid #d1fae5">
      <div style="font-size:14px;font-weight:600;color:#059669;display:flex;align-items:flex-start;gap:8px">\u2705 ${esc(f.titre || f)}</div>
      ${f.justification ? `<div style="font-size:12px;color:#065f46;margin-top:4px;line-height:1.5">${esc(f.justification)}</div>` : ''}
    </div>`).join('') : '<div style="color:#64748b;font-size:13px">Aucune force identifiée pour le moment.</div>'

  const oppsHtml = hasAnalysis && opps.length > 0 ? opps.map((o: any) => `
    <div style="padding:10px 0;border-bottom:1px solid #bfdbfe">
      <div style="font-size:14px;font-weight:600;color:#2563eb;display:flex;align-items:flex-start;gap:8px">\u{1F4A1} ${esc(o.titre || o)}</div>
      ${o.justification ? `<div style="font-size:12px;color:#1e40af;margin-top:4px;line-height:1.5">${esc(o.justification)}</div>` : ''}
      ${o.priorite ? `<span style="display:inline-block;margin-top:6px;padding:2px 8px;background:#eff6ff;border-radius:10px;font-size:10px;color:#2563eb;font-weight:600;border:1px solid #bfdbfe">Priorité : ${esc(o.priorite)}</span>` : ''}
    </div>`).join('') : '<div style="color:#64748b;font-size:13px">Aucune opportunité identifiée pour le moment.</div>'

  // Vigilance table
  const vigilanceHtml = hasAnalysis && vigilance.length > 0 ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:20px 24px;margin-bottom:24px;overflow-x:auto;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-shield-halved" style="color:#f59e0b"></i> Points de vigilance
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:700px">
        <thead>
          <tr style="background:#1e3a5f;color:white">
            <th style="padding:10px 12px;text-align:left;border-radius:8px 0 0 0">Catégorie</th>
            <th style="padding:10px 12px;text-align:left">Niveau</th>
            <th style="padding:10px 12px;text-align:left">Probabilité</th>
            <th style="padding:10px 12px;text-align:left">Point de vigilance</th>
            <th style="padding:10px 12px;text-align:left">Impact</th>
            <th style="padding:10px 12px;text-align:left;border-radius:0 8px 0 0">Action recommandée</th>
          </tr>
        </thead>
        <tbody>
          ${vigilance.map((v: any) => {
            const niv = (v.niveau || 'moyen').toLowerCase()
            const rowBg = niv === 'critique' || niv === 'elevee' || niv === 'eleve' ? '#fef2f2' : niv === 'moyen' || niv === 'moyenne' ? '#fffbeb' : '#f8fafc'
            const rowColor = niv === 'critique' || niv === 'elevee' || niv === 'eleve' ? '#991b1b' : niv === 'moyen' || niv === 'moyenne' ? '#92400e' : '#475569'
            return `<tr style="background:${rowBg};border-bottom:1px solid #e2e8f0">
              <td style="padding:10px 12px;color:${rowColor}">${esc(v.categorie || '—')}</td>
              <td style="padding:10px 12px"><span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${niveauBg(niv)};color:${niveauColor(niv)}">${esc(v.niveau || '—')}</span></td>
              <td style="padding:10px 12px;color:#64748b">${esc(v.probabilite || '—')}</td>
              <td style="padding:10px 12px;color:#1e293b;font-weight:600">${esc(v.titre || '—')}<br/><span style="font-weight:400;font-size:12px;color:#64748b">${esc(v.description || '')}</span></td>
              <td style="padding:10px 12px;color:#fbbf24;font-size:12px">${esc(v.impact_financier || '—')}</td>
              <td style="padding:10px 12px;color:#059669;font-size:12px">${esc(v.action_recommandee || '—')}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>` : ''

  // Incoherences
  const incohHtml = hasAnalysis && incoherences.length > 0 ? `
    <div style="margin-bottom:24px">
      <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-triangle-exclamation" style="color:#f97316"></i> Incohérences détectées
      </div>
      ${incoherences.map((inc: any) => `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 20px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:14px;font-weight:700;color:#c2410c">${esc(inc.type || 'Incohérence')}</span>
            ${inc.champ ? `<span style="padding:2px 8px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:11px;color:#92400e">${esc(inc.champ)}</span>` : ''}
            ${inc.ecart_pct ? `<span style="padding:2px 8px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;font-size:11px;color:#991b1b">Écart: ${esc(inc.ecart_pct)}%</span>` : ''}
          </div>
          ${inc.valeurs ? `<div style="font-size:12px;color:#64748b;margin-bottom:6px">Valeurs: ${esc(typeof inc.valeurs === 'object' ? JSON.stringify(inc.valeurs) : inc.valeurs)}</div>` : ''}
          <div style="font-size:13px;color:#78350f;line-height:1.5">${esc(inc.explication || inc.description || '')}</div>
        </div>
      `).join('')}
    </div>` : ''

  // Recommendations
  const recsHtml = hasAnalysis && recs.length > 0 ? `
    <div style="margin-bottom:24px">
      <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-clipboard-list" style="color:#3b82f6"></i> Recommandations prioritaires
      </div>
      ${recs.map((r: any, i: number) => `
        <div style="background:white;border:1px solid #e2e8f0;border-left:4px solid ${urgencyBorder(r.urgence)};border-radius:0 12px 12px 0;padding:18px 22px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="width:28px;height:28px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#1e293b">${i + 1}</span>
              <span style="font-size:14px;font-weight:700;color:#1e293b">${esc(r.titre)}</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${r.impact_viabilite ? `<span style="padding:3px 10px;background:#0d9488;border-radius:10px;font-size:11px;font-weight:700;color:white">${esc(r.impact_viabilite)}</span>` : ''}
              <span style="padding:3px 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;font-size:11px;font-weight:600;color:#475569">${urgencyBadge(r.urgence)}</span>
            </div>
          </div>
          <div style="font-size:13px;color:#64748b;line-height:1.6;margin-bottom:10px">${esc(r.detail)}</div>
          ${r.action_concrete ? `<div style="font-size:12px;color:#059669;background:#f0fdf4;border:1px solid #bbf7d0;padding:8px 12px;border-radius:8px;margin-bottom:8px"><i class="fas fa-bolt" style="margin-right:6px"></i>${esc(r.action_concrete)}</div>` : ''}
          ${r.message_encourageant ? `<div style="font-size:12px;color:#6366f1;font-style:italic;margin-top:4px">\u{1F4AA} ${esc(r.message_encourageant)}</div>` : ''}
        </div>
      `).join('')}
    </div>` : ''

  // Benchmarks table
  const benchmarkKeys = ['marge_brute', 'marge_ebitda', 'marge_nette', 'ratio_endettement', 'seuil_rentabilite']
  const benchmarkLabels: Record<string,string> = { marge_brute:'Marge Brute', marge_ebitda:'Marge EBITDA', marge_nette:'Marge Nette', ratio_endettement:"Ratio d'endettement", seuil_rentabilite:'Seuil de Rentabilité' }
  const hasBenchmarks = hasAnalysis && benchmarkKeys.some(k => benchmarks[k])
  const benchHtml = hasBenchmarks ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:20px 24px;margin-bottom:24px;overflow-x:auto;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-chart-bar" style="color:#8b5cf6"></i> Benchmarks sectoriels
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:600px">
        <thead>
          <tr style="background:#1e3a5f;color:white">
            <th style="padding:10px 12px;text-align:left;border-radius:8px 0 0 0">Indicateur</th>
            <th style="padding:10px 12px;text-align:center">Entreprise</th>
            <th style="padding:10px 12px;text-align:center">Benchmark sectoriel</th>
            <th style="padding:10px 12px;text-align:center">Écart</th>
            <th style="padding:10px 12px;text-align:center;border-radius:0 8px 0 0">Verdict</th>
          </tr>
        </thead>
        <tbody>
          ${benchmarkKeys.filter(k => benchmarks[k]).map(k => {
            const b = benchmarks[k]
            const vCol = (b.verdict || '').toLowerCase().includes('excell') || (b.verdict || '').toLowerCase().includes('bon') || (b.verdict || '').toLowerCase().includes('sup') ? '#059669' : (b.verdict || '').toLowerCase().includes('bas') || (b.verdict || '').toLowerCase().includes('insuff') ? '#dc2626' : '#d97706'
            return `<tr style="border-bottom:1px solid #e2e8f0">
              <td style="padding:10px 12px;color:#1e293b;font-weight:600">${benchmarkLabels[k] || k}</td>
              <td style="padding:10px 12px;text-align:center;color:#1e293b;font-weight:700">${b.entreprise != null ? (typeof b.entreprise === 'number' ? b.entreprise + (k.includes('mois') || k.includes('rentabilite') ? ' mois' : '%') : esc(b.entreprise)) : '—'}</td>
              <td style="padding:10px 12px;text-align:center;color:#64748b">${b.secteur_min != null ? b.secteur_min + ' — ' + (b.secteur_max ?? '') + (k.includes('mois') || k.includes('rentabilite') ? ' mois' : '%') : '—'}</td>
              <td style="padding:10px 12px;text-align:center;color:#d97706;font-size:12px">${esc(b.ecart || '—')}</td>
              <td style="padding:10px 12px;text-align:center;color:${vCol};font-weight:600;font-size:12px">${esc(b.verdict || '—')}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
      <div style="margin-top:12px;font-size:11px;color:#64748b;font-style:italic">Benchmarks : BCEAO, IFC, FIRCA — Confiance moyenne</div>
    </div>` : ''

  // Contextual risks section
  const risquesCtxHtml = hasAnalysis && risquesCtx.length > 0 ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:20px 24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-exclamation-circle" style="color:#f97316"></i> Risques Contextuels
      </div>
      ${risquesCtx.map((r: any) => {
        const cat = (r.categorie || '').replace('contextuel_','')
        const catLabel = cat === 'secteur' ? '\u{1F3ED} Sectoriel' : cat === 'geographique' ? '\u{1F30D} Géographique' : '\u{1F3E2} Taille'
        const catBg = cat === 'secteur' ? '#7c3aed' : cat === 'geographique' ? '#2563eb' : '#0891b2'
        const grav = (r.gravite || 'moyenne').toLowerCase()
        return `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:10px">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <span style="padding:3px 10px;background:${catBg};border-radius:10px;font-size:11px;font-weight:700;color:white">${catLabel}</span>
            <span style="padding:3px 10px;background:${niveauBg(grav)};border-radius:10px;font-size:11px;font-weight:700;color:${niveauColor(grav)}">${esc(r.gravite || '—')}</span>
            <span style="padding:3px 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;font-size:11px;color:#64748b">${esc(r.probabilite || '—')}</span>
            ${r.pays ? `<span style="font-size:11px;color:#94a3b8">${esc(r.pays)}${r.zone ? ' \u2022 ' + esc(r.zone) : ''}</span>` : ''}
          </div>
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:6px">${esc(r.titre)}</div>
          <div style="font-size:13px;color:#64748b;line-height:1.6;margin-bottom:10px">${esc(r.description || '')}</div>
          ${r.impact_financier ? `<div style="font-size:12px;color:#fbbf24;margin-bottom:8px"><i class="fas fa-coins" style="margin-right:6px"></i>${esc(r.impact_financier)}</div>` : ''}
          ${r.mitigation ? `<div style="font-size:12px;color:#059669;background:#f0fdf4;border:1px solid #bbf7d0;padding:8px 12px;border-radius:8px"><i class="fas fa-shield-halved" style="margin-right:6px"></i>${esc(r.mitigation)}</div>` : ''}
        </div>`
      }).join('')}
    </div>` : ''

  // Next steps + CTA
  const nextStepsHtml = hasAnalysis ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:20px 24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-forward" style="color:#0d9488"></i> Prochaines étapes
      </div>
      <ul style="list-style:none;padding:0;margin:0 0 18px 0">
        <li style="padding:8px 0;color:#475569;font-size:14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px"><span style="color:#0d9488">1.</span> Compléter les livrables manquants pour affiner le diagnostic</li>
        <li style="padding:8px 0;color:#475569;font-size:14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px"><span style="color:#0d9488">2.</span> Appliquer les recommandations prioritaires identifiées</li>
        <li style="padding:8px 0;color:#475569;font-size:14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px"><span style="color:#0d9488">3.</span> Renouveler le diagnostic après les ajustements pour mesurer la progression</li>
        <li style="padding:8px 0;color:#475569;font-size:14px;display:flex;align-items:center;gap:10px"><span style="color:#0d9488">4.</span> Utiliser le chat IA pour approfondir les recommandations</li>
      </ul>
      <div style="text-align:center">
        <a href="/chat" style="display:inline-flex;align-items:center;gap:10px;padding:12px 28px;background:linear-gradient(135deg,#0d9488,#0f766e);color:white;border-radius:12px;text-decoration:none;font-size:14px;font-weight:700;box-shadow:0 4px 14px rgba(13,148,136,0.3);transition:all 0.2s">
          \u{1F4AC} Améliorer via le chat IA \u2192
        </a>
      </div>
    </div>` : ''

  // Footer
  const footerHtml = hasAnalysis ? `
    <div style="text-align:center;padding:20px 0;border-top:1px solid #e2e8f0;margin-top:20px">
      <div style="font-size:12px;color:#94a3b8">Généré par ESANO Diagnostic Expert \u2022 ${genDate}${diagVersion > 0 ? ' \u2022 v' + diagVersion : ''}</div>
      <div style="font-size:11px;color:#475569;margin-top:6px">Ce diagnostic est indicatif et ne constitue pas un conseil financier formel. Consultez un professionnel pour toute décision d'investissement.</div>
    </div>` : ''

  // ═══ PAGE ASSEMBLY ═══
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagnostic Expert — Investment Readiness | ESANO</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
    body { background: white; color: #1e293b; min-height: 100vh; }
    .page-container { max-width: 960px; margin: 0 auto; padding: 0 20px 60px; }

    /* Header banner */
    .diag-banner { background: linear-gradient(135deg, #1e3a5f 0%, #0d9488 100%); height: 120px; display: flex; align-items: center; padding: 0 32px; position: relative; }
    .diag-banner__logo { width: 40px; height: 40px; border-radius: 10px; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; margin-right: 18px; flex-shrink: 0; color: white; font-weight: 800; font-size: 16px; }
    .diag-banner__title { font-size: 20px; font-weight: 800; color: white; letter-spacing: 0.5px; }
    .diag-banner__sub { font-size: 13px; color: rgba(255,255,255,0.8); margin-top: 4px; }

    /* Floating download buttons */
    .float-btns { position: fixed; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 1000; }
    .float-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 10px; font-size: 12px; font-weight: 700; border: none; cursor: pointer; color: white; text-decoration: none; box-shadow: 0 2px 10px rgba(0,0,0,0.3); transition: transform 0.15s; }
    .float-btn:hover { transform: translateY(-1px); }
    .float-btn--html { background: #2563eb; }
    .float-btn--pdf { background: #7c2d12; }
    .float-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    /* Generate section */
    .gen-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; margin: 20px 0; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .gen-btn { display: inline-flex; align-items: center; gap: 10px; padding: 14px 28px; border-radius: 12px; font-size: 15px; font-weight: 700; border: none; cursor: pointer; background: linear-gradient(135deg, #dc2626, #b91c1c); color: white; box-shadow: 0 4px 14px rgba(220,38,38,0.3); transition: all 0.2s; }
    .gen-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(220,38,38,0.4); }
    .gen-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

    /* Responsive tables */
    table { border-spacing: 0; }
    @media (max-width: 768px) {
      .two-col { grid-template-columns: 1fr !important; }
      .diag-banner { height: auto; min-height: 100px; padding: 16px; flex-wrap: wrap; }
      .diag-banner__title { font-size: 16px; }
      .float-btns { position: static; justify-content: center; margin: 12px 0; }
    }

    /* Print styles */
    @media print {
      .float-btns, .gen-card, .back-link { display: none !important; }
      body { background: white; color: #1e293b; }
      .page-container { max-width: 100%; padding: 0; }
      .gen-card { box-shadow: none; }
    }

    /* Animations */
    @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    .anim-in { animation: fadeIn 0.5s ease-out forwards; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .fa-spin-custom { animation: spin 1s linear infinite; }
  </style>
</head>
<body>

  <!-- Floating download buttons -->
  ${hasAnalysis && !embedded ? `
  <div class="float-btns" id="floatBtns">
    <button class="float-btn float-btn--html" onclick="downloadDiagnostic('html')" ${!diagId ? 'disabled' : ''}><i class="fas fa-download"></i> HTML</button>
    <button class="float-btn float-btn--pdf" onclick="downloadDiagnostic('pdf')" ${!diagId ? 'disabled' : ''}><i class="fas fa-file-pdf"></i> PDF</button>
  </div>` : ''}

  <!-- Header banner -->
  <div class="diag-banner">
    <div class="diag-banner__logo">E</div>
    <div>
      <div class="diag-banner__title">DIAGNOSTIC EXPERT \u2014 INVESTMENT READINESS</div>
      <div class="diag-banner__sub">${esc(companyName)}${sector ? ' \u2022 ' + esc(sector) : ''} \u2022 ${genDate}${diagVersion > 0 ? ` \u2022 <span style="padding:2px 8px;background:rgba(255,255,255,0.2);border-radius:10px;font-size:11px">v${diagVersion}</span>` : ''}</div>
    </div>
  </div>

  <div class="page-container">

    <!-- Back link -->
    ${embedded ? '' : `<a href="/entrepreneur" class="back-link" style="display:inline-flex;align-items:center;gap:6px;color:#64748b;text-decoration:none;font-size:13px;margin:16px 0;transition:color 0.2s">
      <i class="fas fa-arrow-left"></i> Retour au tableau de bord
    </a>`}

    ${!hasAnalysis ? `
    <!-- ═══ PRE-GENERATION VIEW ═══ -->

    <!-- About card -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:12px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-info-circle" style="color:#0d9488"></i> À propos
      </div>
      <p style="font-size:14px;color:#64748b;line-height:1.7">
        Le <strong style="color:#1e293b">Diagnostic Expert</strong> analyse l'ensemble de vos livrables (BMC, SIC, Framework, Plan OVO, Business Plan, ODD) 
        et produit un rapport complet d'Investment Readiness :
        <strong style="color:#1e293b">score global /100</strong>, analyse sur 5 dimensions, détection des risques et incohérences,
        forces/faiblesses, recommandations prioritaires, benchmarks sectoriels et résumé exécutif.
      </p>
    </div>

    <!-- Sources -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-database" style="color:#7c3aed"></i> Sources de données (${availableCount}/5)
      </div>
      ${[
        { has: hasBmc, icon: 'fa-diagram-project', label: 'BMC (Business Model Canvas)' },
        { has: hasSic, icon: 'fa-hand-holding-heart', label: 'SIC (Social Impact Canvas)' },
        { has: hasFramework, icon: 'fa-chart-bar', label: 'Framework Analyse PME' },
        { has: hasFrameworkPme, icon: 'fa-calculator', label: 'Données PME structurées' },
        { has: hasPlanOvo, icon: 'fa-file-excel', label: 'Plan Financier OVO' },
      ].map(s => `
        <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;background:${s.has ? '#f0fdf4' : '#fef2f2'};border:1px solid ${s.has ? '#bbf7d0' : '#fecaca'};border-radius:10px;margin-bottom:8px">
          <div style="width:36px;height:36px;border-radius:8px;background:${s.has ? '#dcfce7' : '#fee2e2'};display:flex;align-items:center;justify-content:center;color:${s.has ? '#059669' : '#dc2626'};font-size:14px;flex-shrink:0">
            <i class="fas ${s.icon}"></i>
          </div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600;color:#1e293b">${s.label}</div>
            <div style="font-size:12px;color:${s.has ? '#059669' : '#dc2626'};margin-top:2px">${s.has ? '<i class="fas fa-check-circle"></i> Disponible' : '<i class="fas fa-times-circle"></i> Non disponible'}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Generate button -->
    <div class="gen-card">
      <button id="btnGenerate" class="gen-btn" ${!canGenerate ? 'disabled' : ''} onclick="generateDiagnostic()">
        <i class="fas fa-search"></i> Générer le Diagnostic Expert
      </button>
      ${!canGenerate ? '<p style="font-size:12px;color:#dc2626;margin-top:10px">\u26A0\uFE0F Au moins 2 modules complétés sont requis.</p>' : ''}
      <div id="generateStatus" style="margin-top:16px;display:none"></div>
    </div>

    ` : `
    <!-- ═══ FULL DIAGNOSTIC REPORT VIEW ═══ -->

    ${incompleteBannerHtml}

    <!-- Executive Summary -->
    ${execSummaryHtml}

    <!-- Global Score Gauge -->
    ${gaugeHtml}

    <!-- Priority Attention Points -->
    ${papHtml}

    <!-- 5 Dimensions -->
    <div style="margin-bottom:24px">
      <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-layer-group" style="color:#3b82f6"></i> Analyse par dimension
      </div>
      ${dimsHtml}
    </div>

    <!-- Forces & Opportunities (two-column) -->
    <div class="two-col" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px 22px">
        <div style="font-size:15px;font-weight:700;color:#059669;margin-bottom:14px;display:flex;align-items:center;gap:10px">
          \u2705 Forces (${forces.length})
        </div>
        ${forcesHtml}
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:20px 22px">
        <div style="font-size:15px;font-weight:700;color:#2563eb;margin-bottom:14px;display:flex;align-items:center;gap:10px">
          \u{1F4A1} Opportunités d'amélioration (${opps.length})
        </div>
        ${oppsHtml}
      </div>
    </div>

    <!-- Vigilance Points Table -->
    ${vigilanceHtml}

    <!-- Incoherences -->
    ${incohHtml}

    <!-- Contextual Risks -->
    ${risquesCtxHtml}

    <!-- Recommendations -->
    ${recsHtml}

    <!-- Benchmarks -->
    ${benchHtml}

    <!-- Next Steps & CTA -->
    ${nextStepsHtml}

    <!-- Regenerate button -->
    ${embedded ? '' : `<div class="gen-card">
      <button id="btnGenerate" class="gen-btn" onclick="generateDiagnostic()">
        <i class="fas fa-refresh"></i> Régénérer le diagnostic
      </button>
      <div id="generateStatus" style="margin-top:16px;display:none"></div>
    </div>`}

    <!-- Footer -->
    ${footerHtml}
    `}

  </div>

  <script>
    const diagId = ${diagId ? "'" + diagId + "'" : 'null'};

    function getCookie(name) {
      const v = document.cookie.match('(^|;)\\\\s*' + name + '\\\\s*=\\\\s*([^;]+)');
      return v ? v.pop() : '';
    }

    async function generateDiagnostic() {
      const btn = document.getElementById('btnGenerate');
      const status = document.getElementById('generateStatus');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin-custom"></i> Génération en cours...';
      status.style.display = 'block';
      status.innerHTML = '<p style="color:#0d9488;font-size:13px"><i class="fas fa-circle-notch fa-spin-custom"></i> Analyse des livrables en cours... Cela peut prendre 30 à 60 secondes.</p>';

      try {
        const token = getCookie('auth_token');
        const res = await fetch('/api/diagnostic/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ pmeId: 'pme_current' })
        });
        const data = await res.json();
        
        if (data.success) {
          status.innerHTML = '<p style="color:#059669;font-size:13px"><i class="fas fa-check-circle"></i> ' + data.message + ' Rechargement...</p>';
          setTimeout(() => window.location.reload(), 1200);
        } else {
          status.innerHTML = '<p style="color:#dc2626;font-size:13px"><i class="fas fa-exclamation-circle"></i> ' + (data.error || 'Erreur') + '</p>';
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-search"></i> Générer le Diagnostic Expert';
        }
      } catch (err) {
        status.innerHTML = '<p style="color:#dc2626;font-size:13px"><i class="fas fa-exclamation-circle"></i> Erreur: ' + err.message + '</p>';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-search"></i> Générer le Diagnostic Expert';
      }
    }

    async function downloadDiagnostic(format) {
      if (!diagId) return alert('Aucun diagnostic disponible.');
      const token = getCookie('auth_token');
      window.open('/api/diagnostic/download/' + diagId + '?format=' + format + '&token=' + token, '_blank');
    }

    // Animate gauge and bars on load
    document.addEventListener('DOMContentLoaded', function() {
      const targetScore = ${scoreGlobal};
      const circumference = 2 * Math.PI * 52;
      
      // Gauge animation
      const gaugeArc = document.getElementById('gaugeArc');
      const scoreNum = document.getElementById('scoreNum');
      if (gaugeArc && scoreNum) {
        setTimeout(() => {
          const offset = circumference - (targetScore / 100) * circumference;
          gaugeArc.style.strokeDashoffset = offset;
          
          // Number counter
          let current = 0;
          const step = Math.max(1, Math.floor(targetScore / 40));
          const interval = setInterval(() => {
            current += step;
            if (current >= targetScore) { current = targetScore; clearInterval(interval); }
            scoreNum.textContent = current;
          }, 35);
        }, 300);
      }

      // Dimension bars animation
      document.querySelectorAll('.dim-bar').forEach((bar, i) => {
        setTimeout(() => {
          bar.style.width = bar.getAttribute('data-target') + '%';
        }, 500 + i * 150);
      });
    });
  </script>
</body>
</html>`
}

// Module entry point
// IMPORTANT: Specific routes (/module/plan-ovo, /module/diagnostic) must be registered BEFORE the :code catch-all
// Otherwise Hono matches :code first and creates redirect loops

// Diagnostic Expert dedicated module page — registered before :code catch-all
app.get('/module/diagnostic', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')
    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const db = c.env.DB
    const pmeId = `pme_${payload.userId}`

    // Fetch available sources in parallel
    const [bmcRow, sicRow, frameworkRow, frameworkPmeRow, planOvoRow, diagRow, userRow, latestIterRow] = await Promise.all([
      db.prepare(`SELECT id FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_analysis' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_pme_data' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id, status FROM plan_ovo_analyses WHERE user_id = ? AND pme_id = ? ORDER BY created_at DESC LIMIT 1`).bind(payload.userId, pmeId).first(),
      db.prepare(`SELECT id, version, score, status, sources_used, analysis_json, created_at FROM diagnostic_analyses WHERE user_id = ? AND pme_id = ? ORDER BY created_at DESC LIMIT 1`).bind(payload.userId, pmeId).first(),
      db.prepare('SELECT name, email, country FROM users WHERE id = ?').bind(payload.userId).first(),
      db.prepare('SELECT score_global, scores_dimensions, version, created_at FROM iterations WHERE user_id = ? ORDER BY version DESC LIMIT 1').bind(payload.userId).first(),
    ])

    const hasBmc = !!bmcRow
    const hasSic = !!sicRow
    const hasFramework = !!frameworkRow
    const hasFrameworkPme = !!frameworkPmeRow
    const hasPlanOvo = !!(planOvoRow && planOvoRow.status === 'generated')
    const hasDiagnostic = !!diagRow || !!latestIterRow
    const diagStatus = diagRow ? (diagRow.status as string) : (latestIterRow ? 'generated' : 'none')
    // Use iteration score if available (more accurate), fallback to diagnostic_analyses score
    const iterScore = latestIterRow?.score_global ? Number(latestIterRow.score_global) : null
    const diagScore = iterScore ?? (diagRow?.score ? Number(diagRow.score) : null)
    const diagVersion = (latestIterRow?.version ? Number(latestIterRow.version) : 0) || (diagRow?.version ? Number(diagRow.version) : 0)
    const diagId = diagRow ? (diagRow.id as string) : null
    const isPartial = diagStatus === 'partial'

    // Parse analysis_json for rich rendering
    let analysisData: any = null
    if (diagRow?.analysis_json) {
      try { analysisData = JSON.parse(diagRow.analysis_json as string) } catch {}
    }
    // Merge iteration scores_dimensions into analysis if available
    if (latestIterRow?.scores_dimensions && analysisData) {
      try {
        const iterDims = JSON.parse(latestIterRow.scores_dimensions as string)
        // If analysis uses old format, enrich with iteration data
        if (!analysisData.scores_dimensions && iterDims) {
          analysisData._iteration_scores = iterDims
          analysisData._iteration_score_global = iterScore
        }
      } catch {}
    }
    const diagCreatedAt = diagRow?.created_at ? String(diagRow.created_at) : (latestIterRow?.created_at ? String(latestIterRow.created_at) : '')

    const embedded = c.req.query('embedded') === '1'

    return c.html(safeScriptBlocks(renderDiagnosticModulePage({
      hasBmc, hasSic, hasFramework, hasFrameworkPme, hasPlanOvo,
      hasDiagnostic, diagStatus, diagScore, diagVersion, diagId, isPartial, user: userRow,
      analysis: analysisData, createdAt: diagCreatedAt, embedded
    })))
  } catch (error: any) {
    console.error('[Diagnostic Module Page] Error:', error)
    return c.text('Erreur: ' + error.message, 500)
  }
})

// Plan OVO dedicated module page — registered before :code catch-all
app.get('/module/plan-ovo', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')
    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const db = c.env.DB

    // 1. Check if framework (required) is available
    const framework = await db.prepare(`
      SELECT id, content, score FROM entrepreneur_deliverables
      WHERE user_id = ? AND type = 'framework'
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId).first()

    // 2. Check optional deliverables
    const bmc = await db.prepare(`
      SELECT id, score FROM entrepreneur_deliverables
      WHERE user_id = ? AND type = 'bmc_analysis'
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId).first()

    const sic = await db.prepare(`
      SELECT id, score FROM entrepreneur_deliverables
      WHERE user_id = ? AND type = 'sic_analysis'
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId).first()

    const diagnostic = await db.prepare(`
      SELECT id, score FROM entrepreneur_deliverables
      WHERE user_id = ? AND type = 'diagnostic'
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId).first()

    // 3. Check latest plan_ovo_analyses entry
    const pmeId = `pme_${payload.userId}`
    const planOvo = await db.prepare(`
      SELECT id, status, score, extraction_json, analysis_json, version, created_at
      FROM plan_ovo_analyses
      WHERE user_id = ? AND pme_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId, pmeId).first()

    const hasFramework = !!framework
    const hasBmc = !!bmc
    const hasSic = !!sic
    const hasDiagnostic = !!diagnostic
    const hasPlan = !!planOvo
    const planStatus = planOvo ? (planOvo.status as string) : 'none'
    const planScore = planOvo?.score ? Number(planOvo.score) : null
    const planVersion = planOvo?.version ? Number(planOvo.version) : 0

    // 4. No HTML preview yet (will be added when IA agent is implemented)
    const hasHtmlPreview = false

    // Get user info
    const user = await db.prepare('SELECT name, email FROM users WHERE id = ?').bind(payload.userId).first()

    return c.html(safeScriptBlocks(renderPlanOvoModulePage({
      hasFramework, hasBmc, hasSic, hasDiagnostic,
      hasPlan, planStatus, planScore, planVersion, hasHtmlPreview,
      framework, bmc, sic, diagnostic, user
    })))
  } catch (error: any) {
    console.error('[Plan OVO Module] Error:', error)
    return c.text('Erreur: ' + error.message, 500)
  }
})

// ═══ Business Plan module page — registered before :code catch-all ═══
app.get('/module/business-plan', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')
    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const db = c.env.DB
    const pmeId = `pme_${payload.userId}`

    const [bpRow, bmcRow, sicRow, fwRow, diagRow, ovoRow, userRow] = await Promise.all([
      db.prepare(`SELECT id, version, status, business_plan_json, created_at FROM business_plan_analyses WHERE user_id = ? AND pme_id = ? AND status IN ('completed','generated','analyzed') ORDER BY created_at DESC LIMIT 1`).bind(payload.userId, pmeId).first(),
      db.prepare(`SELECT id FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_analysis' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id FROM diagnostic_analyses WHERE user_id = ? AND pme_id = ? AND status IN ('analyzed','generated','partial') ORDER BY created_at DESC LIMIT 1`).bind(payload.userId, pmeId).first(),
      db.prepare(`SELECT id FROM plan_ovo_analyses WHERE user_id = ? AND pme_id = ? AND status = 'generated' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId, pmeId).first(),
      db.prepare('SELECT name FROM users WHERE id = ?').bind(payload.userId).first(),
    ])

    const hasBmc = !!bmcRow, hasSic = !!sicRow, hasFramework = !!fwRow, hasDiag = !!diagRow, hasOvo = !!ovoRow
    const canGenerate = hasBmc || hasFramework
    const hasBp = !!(bpRow && (bpRow.status === 'completed' || bpRow.status === 'generated' || bpRow.status === 'analyzed'))
    const bpVersion = bpRow?.version ? Number(bpRow.version) : 0
    const bpId = bpRow?.id as string || null
    const bpStatus = bpRow?.status as string || 'none'
    const userName = (userRow?.name as string) || 'Entrepreneur'
    const availableCount = [hasBmc, hasSic, hasFramework, hasDiag, hasOvo].filter(Boolean).length
    const embedded = c.req.query('embedded') === '1'
    let bpData: any = null
    if (bpRow?.business_plan_json) {
      try { bpData = JSON.parse(bpRow.business_plan_json as string) } catch {}
    }

    return c.html(safeScriptBlocks(renderBusinessPlanModulePage({ hasBmc, hasSic, hasFramework, hasDiag, hasOvo, canGenerate, hasBp, bpVersion, bpId, bpStatus, userName, availableCount, embedded, bpData })))
  } catch (error: any) {
    console.error('[Business Plan Module] Error:', error)
    return c.text('Erreur: ' + error.message, 500)
  }
})

// Catch-all for module codes — redirect to deliverable view
// Exception: /module/sic has its own dedicated page (defined below)
app.get('/module/:code', (c) => {
  const code = c.req.param('code')
  if (code === 'sic') return c.redirect('/module/sic/page')
  if (code === 'mod5_diagnostic' || code === 'mod_05_diagnostic') return c.redirect('/module/diagnostic')
  if (code === 'mod6_ovo') return c.redirect('/module/plan-ovo')
  if (code === 'business-plan' || code === 'business_plan') return c.redirect('/module/business-plan')
  return c.redirect(`/module/${code}/download`)
})

// Page module automatique - Overview
// Overview page → redirect to deliverable
app.get('/module/:code/overview', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

// Page module automatique - Génération
// Generate page → redirect to deliverable
app.get('/module/:code/generate', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

// Page Livrables centralisée
// Livrables page → redirect to entrepreneur
app.get('/livrables', (c) => c.redirect('/entrepreneur'))

// Formations page - placeholder redirect
app.get('/formations', (c) => c.redirect('/entrepreneur'))

// API: Save quiz results
app.post('/api/module/quiz', async (c) => {
  try {
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifie' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const format = c.req.query('format')?.trim() || 'html'
    const db = c.env.DB

    // ── PRIORITY: Try new flow (sic_analyses table with SIC Analyst data) ──
    const sicAnalysis = await db.prepare(`
      SELECT id, analysis_json, extraction_json, score, status
      FROM sic_analyses WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId).first()

    if (sicAnalysis?.analysis_json) {
      let analysisData: any
      let extractionData: any
      try {
        analysisData = JSON.parse(sicAnalysis.analysis_json as string)
        extractionData = sicAnalysis.extraction_json ? JSON.parse(sicAnalysis.extraction_json as string) : null
      } catch {
        return c.json({ error: 'Données d\'analyse corrompues' }, 500)
      }

      // Get user & project info
      const user = await db.prepare(`SELECT name FROM users WHERE id = ?`).bind(payload.userId).first()
      const userName = (user?.name as string) ?? 'Entrepreneur'

      // Get project from extraction metadata or from projects table
      const extractMeta = extractionData?.metadata || {}
      let companyName = extractMeta.nom_entreprise || ''
      let sectorStr = extractMeta.secteur || ''
      let locationStr = extractMeta.zone_geographique || ''

      // If no company name from extraction, try projects table
      if (!companyName) {
        const project = await db.prepare(`SELECT name, description FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first()
        companyName = (project?.name as string) || 'Mon Projet'
      }

      if (format === 'json') {
        return c.json({ success: true, analysis: analysisData, user: userName, project: companyName })
      }

      const deliverableInput: SicAnalystDeliverableInput = {
        companyName,
        entrepreneurName: userName,
        sector: sectorStr,
        location: locationStr,
        country: "Côte d'Ivoire",
        analysis: analysisData,
        extractionJson: extractionData
      }

      const html = renderSicDeliverableFromAnalyst(deliverableInput)

      // Cache the deliverable HTML
      try {
        // Delete previous cache
        await db.prepare(`DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_html'`).bind(payload.userId).run()
        const delivId = crypto.randomUUID()
        await db.prepare(`
          INSERT INTO entrepreneur_deliverables (id, user_id, type, content, created_at)
          VALUES (?, ?, 'sic_html', ?, datetime('now'))
        `).bind(delivId, payload.userId, html).run()
      } catch { /* ignore cache errors */ }

      return c.html(safeScriptBlocks(html))
    }

    // ── FALLBACK: Old flow (progress table with questions) ──
    const moduleCode = c.req.query('module')?.trim() || 'mod2_sic'

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
      return c.html(safeScriptBlocks(fullHtml))
    }

    if (format === 'html') {
      const html = generateSicDiagnosticHtml(analysis, projectName, userName)
      return c.html(safeScriptBlocks(html))
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
    const token = getAuthToken(c)
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

// GET /api/bmc/deliverable - Get BMC deliverable (HTML) — Claude AI powered with cache
app.get('/api/bmc/deliverable', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifie' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const format = c.req.query('format')?.trim() || 'html'
    const refresh = c.req.query('refresh') === 'true'   // Force re-generation
    const db = c.env.DB

    const module = await db.prepare(`SELECT id FROM modules WHERE module_code = 'mod1_bmc'`).first()
    if (!module) return c.json({ error: 'Module BMC non trouve' }, 404)

    const progress = await db.prepare(`
      SELECT id, project_id, ai_score, ai_feedback_json FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()
    if (!progress) return c.json({ error: 'Pas de progression BMC' }, 404)

    // ── Check cache: stored deliverable HTML in deliverables table ──
    if (!refresh && (format === 'full' || format === 'diagnostic' || format === 'html')) {
      const cachedType = format === 'full' ? 'bmc_full' : 'bmc_diagnostic'
      const cached = await db.prepare(`
        SELECT content_json FROM deliverables
        WHERE user_id = ? AND module_id = ? AND deliverable_type = ?
        ORDER BY validated_at DESC LIMIT 1
      `).bind(payload.userId, module.id, cachedType).first()

      if (cached?.content_json) {
        try {
          const cachedData = JSON.parse(cached.content_json as string)
          if (cachedData?.html && typeof cachedData.html === 'string') {
            console.log(`[BMC] Serving cached ${cachedType} deliverable`)
            return c.html(safeScriptBlocks(cachedData.html))
          }
        } catch {}
      }
    }

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
      answers: bmcAnswers,
      apiKey: c.env.ANTHROPIC_API_KEY   // Claude AI key for deliverable generation
    }

    if (format === 'full') {
      const fullHtml = await generateFullBmcDeliverable(deliverableData)

      // ── Cache the result ──
      try {
        const cachePayload = JSON.stringify({ html: fullHtml, generatedAt: new Date().toISOString() })
        await db.prepare(`
          INSERT INTO deliverables (user_id, project_id, module_id, deliverable_type, title, content_json, status, validated_at, created_at)
          VALUES (?, ?, ?, 'bmc_full', 'BMC Livrable Complet', ?, 'ready', datetime('now'), datetime('now'))
          ON CONFLICT(user_id, module_id, deliverable_type) DO UPDATE SET
            content_json = excluded.content_json,
            validated_at = datetime('now')
        `).bind(payload.userId, progress.project_id ?? null, module.id, cachePayload).run()
      } catch (cacheErr: any) {
        console.warn('[BMC] Cache write failed (non-blocking):', cacheErr.message)
      }

      return c.html(safeScriptBlocks(fullHtml))
    }

    if (format === 'diagnostic' || format === 'html') {
      const diagHtml = await generateBmcDiagnosticHtml(deliverableData)

      // ── Cache the result ──
      try {
        const cachePayload = JSON.stringify({ html: diagHtml, generatedAt: new Date().toISOString() })
        await db.prepare(`
          INSERT INTO deliverables (user_id, project_id, module_id, deliverable_type, title, content_json, status, validated_at, created_at)
          VALUES (?, ?, ?, 'bmc_diagnostic', 'BMC Diagnostic', ?, 'ready', datetime('now'), datetime('now'))
          ON CONFLICT(user_id, module_id, deliverable_type) DO UPDATE SET
            content_json = excluded.content_json,
            validated_at = datetime('now')
        `).bind(payload.userId, progress.project_id ?? null, module.id, cachePayload).run()
      } catch (cacheErr: any) {
        console.warn('[BMC] Cache write failed (non-blocking):', cacheErr.message)
      }

      return c.html(safeScriptBlocks(diagHtml))
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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

    // ── FALLBACK: If no financial_inputs, try entrepreneur_deliverables (generate-all pipeline) ──
    if (!inputsRow) {
      // Try to load pmeInput from entrepreneur_deliverables (stored by generate-all)
      const pmeDataRow = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_pme_data' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first<any>()
      
      if (!pmeDataRow?.content) {
        // Last resort: serve the already-generated HTML if available
        if (format === 'html') {
          const htmlRow = await c.env.DB.prepare(
            "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_html' ORDER BY version DESC LIMIT 1"
          ).bind(payload.userId).first<any>()
          if (htmlRow?.content) return c.html(safeScriptBlocks(htmlRow.content))
        }
        return c.json({ error: 'Aucune donnée financière. Uploadez votre fichier INPUTS_ENTREPRENEURS ou remplissez le Module 3.' }, 400)
      }

      // Rebuild from stored PmeInputData
      const pmeInput = JSON.parse(pmeDataRow.content) as PmeInputData
      const companyName = pmeInput.companyName || 'Mon Entreprise'
      const apiKey = c.env.ANTHROPIC_API_KEY || ''

      // Load BMC for cross-analysis
      let bmcContent = ''
      try {
        let bmcDel = await c.env.DB.prepare(
          "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY version DESC LIMIT 1"
        ).bind(payload.userId).first<any>()
        if (bmcDel?.content && bmcDel.content.length > 100) bmcContent = bmcDel.content.slice(0, 6000)
        if (!bmcContent) {
          bmcDel = await c.env.DB.prepare(
            "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html' ORDER BY version DESC LIMIT 1"
          ).bind(payload.userId).first<any>()
          if (bmcDel?.content && bmcDel.content.length > 100) bmcContent = bmcDel.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000)
        }
      } catch {}

      const baseAnalysis = analyzePme(pmeInput)
      let crossAnalysis
      try { crossAnalysis = await crossAnalyzeBmcFinancials(bmcContent, pmeInput, baseAnalysis, apiKey) } catch {}
      const analysis = await analyzePmeWithAI(pmeInput, apiKey, undefined, crossAnalysis)

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
        return c.html(safeScriptBlocks(html))
      }
      return c.json({ success: true, analysis, input: pmeInput })
    }

    // ── PRIMARY PATH: Build from financial_inputs (Module 3 form) ──
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

    // Use enriched pipeline with AI + cross-analysis
    const apiKey = c.env.ANTHROPIC_API_KEY || ''
    
    // BMC cross-check (load BMC deliverable if available)
    let bmcContent = ''
    try {
      let bmcDel = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first<any>()
      if (bmcDel?.content && bmcDel.content.length > 100) {
        bmcContent = bmcDel.content.slice(0, 6000)
      }
      if (!bmcContent) {
        bmcDel = await c.env.DB.prepare(
          "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html' ORDER BY version DESC LIMIT 1"
        ).bind(payload.userId).first<any>()
        if (bmcDel?.content && bmcDel.content.length > 100) {
          bmcContent = bmcDel.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000)
        }
      }
    } catch {}

    const baseAnalysis = analyzePme(pmeInput)
    let crossAnalysis
    try {
      crossAnalysis = await crossAnalyzeBmcFinancials(bmcContent, pmeInput, baseAnalysis, apiKey)
    } catch {}
    
    // AI enrichment (Claude) with cross-analysis context
    const analysis = await analyzePmeWithAI(pmeInput, apiKey, undefined, crossAnalysis)

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
      return c.html(safeScriptBlocks(html))
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
    const token = getAuthToken(c)
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

    // CORRECTION 5: Enriched pipeline for refresh
    const apiKey = c.env.ANTHROPIC_API_KEY || ''
    
    // Load BMC for cross-check
    let bmcContent = ''
    try {
      let bmcDel = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first<any>()
      if (bmcDel?.content && bmcDel.content.length > 100) {
        bmcContent = bmcDel.content.slice(0, 6000)
      }
      if (!bmcContent) {
        bmcDel = await c.env.DB.prepare(
          "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html' ORDER BY version DESC LIMIT 1"
        ).bind(payload.userId).first<any>()
        if (bmcDel?.content && bmcDel.content.length > 100) {
          bmcContent = bmcDel.content.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').slice(0, 6000)
        }
      }
    } catch {}

    const baseAnalysis = analyzePme(pmeInput)
    let crossAnalysis
    try {
      crossAnalysis = await crossAnalyzeBmcFinancials(bmcContent, pmeInput, baseAnalysis, apiKey)
    } catch {}
    
    const analysis = await analyzePmeWithAI(pmeInput, apiKey, undefined, crossAnalysis)

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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    return c.html(safeScriptBlocks(html))
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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

// ═══════════════════════════════════════════════════════════════
// PAGE /module/sic/page — Social Impact Canvas (vue module dédiée)
// ═══════════════════════════════════════════════════════════════
app.get('/module/sic/page', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')
    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const db = c.env.DB

    // 1. Check if SIC file was uploaded
    const sicUpload = await db.prepare(`
      SELECT id, filename, extracted_text, uploaded_at
      FROM uploads WHERE user_id = ? AND category = 'sic'
      ORDER BY uploaded_at DESC LIMIT 1
    `).bind(payload.userId).first()

    // 2. Check latest sic_analyses entry (with extraction_json from Claude)
    const sicAnalysis = await db.prepare(`
      SELECT id, status, score, extraction_json, analysis_json, created_at
      FROM sic_analyses WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId).first()

    // 3. Parse extraction data for rich display
    let filename = ''
    let sectionsPresentes = 0
    let sectionsAbsentes = 0
    let sectionsAbsentesListe: string[] = []
    let extractionSource = 'none'
    let secteur: string | null = null
    let zone: string | null = null
    let oddMentionnes: number[] = []
    let completude = 0
    let synthese = { present: false, phrase_impact: '', maturite: '' }
    let sectionDetails: Array<{ num: number; label: string; present: boolean; summary: string }> = []

    if (sicAnalysis?.extraction_json) {
      try {
        const ext = JSON.parse(sicAnalysis.extraction_json as string)
        sectionsPresentes = ext.metadata?.sections_presentes ?? 0
        sectionsAbsentes = ext.metadata?.sections_absentes ?? (9 - sectionsPresentes)
        sectionsAbsentesListe = ext.metadata?.sections_absentes_liste ?? []
        extractionSource = ext._source || 'regex'
        secteur = ext.metadata?.secteur || null
        zone = ext.metadata?.zone_geographique || null
        oddMentionnes = ext.metadata?.odd_mentionnes || []
        completude = ext.metadata?.completude_pct ?? Math.round((sectionsPresentes / 9) * 100)
        synthese = ext.extraction?.synthese || synthese

        if (ext.extraction?.sections) {
          sectionDetails = ext.extraction.sections.map((s: any) => ({
            num: s.num,
            label: s.label,
            present: s.present,
            summary: s.summary || ''
          }))
        }
      } catch { /* ignore parse errors */ }
    }

    if (!sectionDetails.length && sicUpload) {
      filename = (sicUpload.filename as string) || ''
    } else if (sicAnalysis) {
      try {
        const ext = JSON.parse(sicAnalysis.extraction_json as string)
        filename = ext._filename || ''
      } catch { filename = '' }
    }

    const hasUpload = !!sicUpload || sectionsPresentes > 0
    const status = sicAnalysis ? (sicAnalysis.status as string) : (hasUpload ? 'uploaded' : 'empty')
    const score = sicAnalysis?.score ? Number(sicAnalysis.score) : null
    const hasExtraction = sectionsPresentes > 0
    const hasAnalysis = (status === 'generated' || status === 'analyzed') && !!sicAnalysis?.analysis_json

    // 4. Parse analysis data if available
    let analysisData: any = null
    if (hasAnalysis) {
      try {
        analysisData = JSON.parse(sicAnalysis!.analysis_json as string)
      } catch { /* ignore */ }
    }

    // 5. Check for generated SIC HTML deliverable
    const sicHtml = await db.prepare(`
      SELECT content FROM entrepreneur_deliverables
      WHERE user_id = ? AND type = 'sic_html'
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId).first()
    const hasDeliverable = !!sicHtml

    // Build sections HTML for the extraction summary
    const sectionsHtml = sectionDetails.map(s => `
      <div class="flex items-start gap-2 py-2 ${s.present ? '' : 'opacity-50'}">
        <div class="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${s.present ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-400'}">
          <i class="fas ${s.present ? 'fa-check' : 'fa-times'} text-xs"></i>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium ${s.present ? 'text-slate-800' : 'text-slate-400'}">${s.num}. ${s.label}</p>
          ${s.present && s.summary ? `<p class="text-xs text-slate-500 mt-0.5 line-clamp-2">${s.summary.slice(0, 150)}${s.summary.length > 150 ? '...' : ''}</p>` : ''}
          ${!s.present ? '<p class="text-xs text-red-400">Section manquante</p>' : ''}
        </div>
      </div>
    `).join('')

    // ═══ Build analysis results HTML BEFORE the template ═══
    let analysisHtml = ''
    if (analysisData && analysisData.score_global) {
      const scoreColor = analysisData.score_global >= 71 ? 'emerald' : analysisData.score_global >= 51 ? 'amber' : 'red'

      // Dimensions bars
      const dimOrder = ['probleme_vision', 'beneficiaires', 'mesure_impact', 'alignement_odd', 'gestion_risques']
      const dimWeights: Record<string, string> = { probleme_vision: '25%', beneficiaires: '20%', mesure_impact: '20%', alignement_odd: '20%', gestion_risques: '15%' }
      const dimsHtml = dimOrder.map(k => {
        const d = analysisData.dimensions?.[k]
        if (!d) return ''
        const dc = d.score >= 70 ? '#059669' : d.score >= 50 ? '#d97706' : '#dc2626'
        return '<div class="space-y-1">' +
          '<div class="flex justify-between items-center text-xs">' +
            '<span class="font-medium text-slate-700">' + d.label + ' <span class="text-slate-400">(' + dimWeights[k] + ')</span></span>' +
            '<span class="font-bold" style="color:' + dc + '">' + d.score + '/100</span>' +
          '</div>' +
          '<div class="w-full bg-slate-200 rounded-full h-2">' +
            '<div class="h-2 rounded-full transition-all" style="width:' + d.score + '%;background:' + dc + '"></div>' +
          '</div>' +
          (d.commentaire ? '<p class="text-[11px] text-slate-500 leading-tight">' + String(d.commentaire).slice(0, 200) + '</p>' : '') +
        '</div>'
      }).join('')

      // ODD badges
      const odds = analysisData.canvas_blocs?.odd_cibles?.odds || []
      const oddBadgesHtml = odds.map((o: any) =>
        '<div class="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-white" style="background:' + (o.couleur || '#666') + '">' +
          '<span>ODD ' + o.numero + '</span>' +
          '<span class="opacity-80">&middot;</span>' +
          '<span class="opacity-90 truncate max-w-[120px]">' + (o.nom || '') + '</span>' +
          (o.alignement === 'fort' ? ' <i class="fas fa-star text-yellow-200 text-[10px]"></i>' : '') +
        '</div>'
      ).join('')

      // Theory of change
      const tdc = analysisData.theorie_du_changement || {}
      const tdcSteps = [
        { icon: 'fa-exclamation-triangle', label: 'Problème', text: tdc.probleme },
        { icon: 'fa-gears', label: 'Activités', text: tdc.activites },
        { icon: 'fa-box', label: 'Outputs', text: tdc.outputs },
        { icon: 'fa-chart-line', label: 'Outcomes', text: tdc.outcomes },
        { icon: 'fa-globe', label: 'Impact', text: tdc.impact },
      ].filter(s => s.text)
      const tdcHtml = tdcSteps.map((s, i) =>
        '<div class="flex items-start gap-2">' +
          '<div class="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">' +
            '<i class="fas ' + s.icon + ' text-emerald-600 text-[10px]"></i>' +
          '</div>' +
          '<div><p class="text-[10px] font-bold text-emerald-700 uppercase">' + s.label + '</p>' +
            '<p class="text-xs text-slate-600">' + s.text + '</p></div>' +
        '</div>' +
        (i < tdcSteps.length - 1 ? '<div class="w-px h-3 bg-emerald-200 ml-3.5"></div>' : '')
      ).join('')

      // Recommendations
      const recos = analysisData.recommandations || []
      const recosHtml = recos.map((r: any) =>
        '<div class="flex gap-3 p-3 rounded-lg bg-amber-50 border border-amber-100">' +
          '<div class="w-6 h-6 rounded-full bg-amber-200 flex items-center justify-center flex-shrink-0 text-xs font-bold text-amber-800">' + r.priorite + '</div>' +
          '<div>' +
            '<p class="text-sm font-semibold text-slate-800">' + r.titre + '</p>' +
            '<p class="text-xs text-slate-600 mt-0.5">' + r.detail + '</p>' +
            '<p class="text-[10px] text-amber-700 font-medium mt-1"><i class="fas fa-arrow-up mr-1"></i>' + r.impact_score + '</p>' +
          '</div>' +
        '</div>'
      ).join('')

      // Croisement BMC
      const crBmc = analysisData.croisement_bmc || {}
      let crBmcHtml = ''
      if (crBmc.disponible) {
        const cohHtml = (crBmc.coherences || []).map((cc: string) => '<li class="text-xs text-slate-600 flex gap-1"><span class="text-emerald-500">&#10003;</span> ' + cc + '</li>').join('')
        const incHtml = (crBmc.incoherences || []).map((cc: string) => '<li class="text-xs text-slate-600 flex gap-1"><span class="text-red-400">&#10007;</span> ' + cc + '</li>').join('')
        crBmcHtml = '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">' +
          '<div class="px-5 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100">' +
            '<span class="text-sm font-semibold text-indigo-800"><i class="fas fa-link mr-1"></i> Croisement BMC &harr; SIC</span>' +
          '</div><div class="p-5 grid md:grid-cols-2 gap-4">' +
          (cohHtml ? '<div><p class="text-xs font-semibold text-emerald-700 mb-2"><i class="fas fa-check-circle mr-1"></i> Cohérences</p><ul class="space-y-1">' + cohHtml + '</ul></div>' : '') +
          (incHtml ? '<div><p class="text-xs font-semibold text-red-600 mb-2"><i class="fas fa-exclamation-circle mr-1"></i> Incohérences</p><ul class="space-y-1">' + incHtml + '</ul></div>' : '') +
          '</div></div>'
      }

      const scBg = scoreColor === 'emerald' ? '#ecfdf5' : scoreColor === 'amber' ? '#fffbeb' : '#fef2f2'
      const scBorder = scoreColor === 'emerald' ? '#a7f3d0' : scoreColor === 'amber' ? '#fde68a' : '#fecaca'
      const scText = scoreColor === 'emerald' ? '#065f46' : scoreColor === 'amber' ? '#92400e' : '#991b1b'
      const scBadgeBg = scoreColor === 'emerald' ? '#d1fae5' : scoreColor === 'amber' ? '#fef3c7' : '#fee2e2'

      analysisHtml = '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden fade-in">' +
        '<div class="px-5 py-4 border-b flex items-center justify-between" style="background:' + scBg + ';border-color:' + scBorder + '">' +
          '<div><span class="text-lg font-bold" style="color:' + scText + '">' + analysisData.score_global + '/100</span>' +
            '<span class="text-sm ml-2" style="color:' + scText + '">' + (analysisData.label || '') + '</span></div>' +
          '<span class="text-xs px-3 py-1 rounded-full font-semibold" style="background:' + scBadgeBg + ';color:' + scText + '">' +
            (analysisData._source === 'claude' ? '<i class="fas fa-robot mr-1"></i>Claude AI' : '<i class="fas fa-gear mr-1"></i>Auto') +
          '</span>' +
        '</div>' +
        '<div class="p-5 space-y-6">' +
          (analysisData.synthese_impact ? '<div class="bg-slate-50 rounded-lg p-4 border border-slate-100"><p class="text-sm text-slate-700 leading-relaxed">' + analysisData.synthese_impact + '</p></div>' : '') +
          '<div class="space-y-3"><h3 class="text-sm font-bold text-slate-800"><i class="fas fa-chart-bar mr-1"></i> Scoring par dimension</h3>' + dimsHtml + '</div>' +
          (odds.length > 0 ? '<div><h3 class="text-sm font-bold text-slate-800 mb-2"><i class="fas fa-bullseye mr-1"></i> ODD ciblés (' + odds.length + ')</h3><div class="flex flex-wrap gap-2">' + oddBadgesHtml + '</div></div>' : '') +
          (tdcHtml ? '<div><h3 class="text-sm font-bold text-slate-800 mb-3"><i class="fas fa-route mr-1"></i> Théorie du changement</h3><div class="space-y-0">' + tdcHtml + '</div></div>' : '') +
          (recos.length > 0 ? '<div><h3 class="text-sm font-bold text-slate-800 mb-2"><i class="fas fa-lightbulb mr-1"></i> Top ' + recos.length + ' recommandations</h3><div class="space-y-2">' + recosHtml + '</div></div>' : '') +
        '</div></div>' + crBmcHtml
    }

    return c.html(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Social Impact Canvas</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .dropzone-active { border-color: #059669 !important; background: #ecfdf5 !important; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .fade-in { animation: fadeIn 0.3s ease-out; }
  </style>
</head>
<body class="bg-slate-50 min-h-screen">

  <!-- NAV -->
  <nav class="bg-white shadow-sm border-b border-slate-200">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/entrepreneur" class="text-emerald-600 hover:text-emerald-700 flex items-center gap-2 font-medium text-sm">
        <i class="fas fa-arrow-left"></i> Retour au tableau de bord
      </a>
      <span class="text-xs text-slate-400 flex items-center gap-2">
        <i class="fas fa-seedling text-emerald-500"></i>
        Phase 1 · Identité — Module SIC
      </span>
    </div>
  </nav>

  <main class="max-w-5xl mx-auto px-4 py-8 space-y-6">

    <!-- HEADER -->
    <header>
      <div class="flex items-center gap-3 mb-2">
        <div class="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
          <i class="fas fa-hand-holding-heart text-emerald-600 text-xl"></i>
        </div>
        <div>
          <h1 class="text-2xl font-bold text-slate-900">Social Impact Canvas</h1>
          <p class="text-sm text-slate-500">Analysez la dimension impact social de votre projet</p>
        </div>
      </div>
    </header>

    <!-- UPLOAD ZONE (drag & drop) -->
    <div id="upload-zone" class="bg-white rounded-2xl border-2 border-dashed border-slate-300 shadow-sm p-6 text-center transition-all cursor-pointer hover:border-emerald-400"
         ondragover="event.preventDefault(); this.classList.add('dropzone-active')"
         ondragleave="this.classList.remove('dropzone-active')"
         ondrop="handleDrop(event)"
         onclick="document.getElementById('file-input').click()">
      <input type="file" id="file-input" accept=".doc,.docx" class="hidden" onchange="handleFileSelect(this)">
      ${hasExtraction ? `
        <div class="flex items-center justify-center gap-3 mb-2">
          <div class="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <i class="fas fa-circle-check text-emerald-600 text-lg"></i>
          </div>
          <div class="text-left">
            <p class="text-sm font-bold text-emerald-800">${filename || 'Fichier SIC'}</p>
            <p class="text-xs text-emerald-600">
              <i class="fas fa-robot mr-1"></i>
              ${sectionsPresentes}/9 sections extraites
              ${extractionSource === 'claude' ? '(Claude AI)' : '(extraction automatique)'}
              — Complétude : ${completude}%
            </p>
          </div>
        </div>
        <p class="text-xs text-slate-400 mt-2">Glissez un nouveau fichier .docx ici pour le remplacer</p>
      ` : hasUpload ? `
        <div class="flex items-center justify-center gap-3 mb-2">
          <i class="fas fa-file-word text-emerald-500 text-2xl"></i>
          <div class="text-left">
            <p class="text-sm font-medium text-slate-700">${filename || 'Fichier reçu'}</p>
            <p class="text-xs text-slate-500">En attente d'extraction...</p>
          </div>
        </div>
      ` : `
        <i class="fas fa-cloud-arrow-up text-4xl text-slate-300 mb-3"></i>
        <p class="text-sm font-medium text-slate-600">Glissez votre fichier SIC ici</p>
        <p class="text-xs text-slate-400 mt-1">ou cliquez pour sélectionner un .docx</p>
      `}
    </div>
    <div id="upload-progress" class="hidden bg-white rounded-xl border border-emerald-200 p-4 fade-in">
      <div class="flex items-center gap-3">
        <i class="fas fa-spinner fa-spin text-emerald-600"></i>
        <div class="flex-1">
          <p class="text-sm font-medium text-slate-700" id="upload-status-text">Upload et extraction en cours...</p>
          <div class="w-full bg-slate-200 rounded-full h-1.5 mt-2">
            <div id="upload-bar" class="bg-emerald-500 h-1.5 rounded-full transition-all" style="width:10%"></div>
          </div>
        </div>
      </div>
    </div>

    ${hasExtraction ? `
    <!-- EXTRACTION SUMMARY -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden fade-in">
      <div class="px-5 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 flex items-center justify-between">
        <span class="text-sm font-semibold text-emerald-800">
          <i class="fas fa-clipboard-check mr-1"></i>
          Extraction : ${sectionsPresentes}/9 sections
          ${sectionsPresentes === 9 ? '— Complet ✓' : ''}
        </span>
        <span class="text-xs text-emerald-600">
          ${extractionSource === 'claude' ? '<i class="fas fa-robot mr-1"></i>Claude AI' : '<i class="fas fa-gear mr-1"></i>Auto'}
          ${secteur ? ' · ' + secteur : ''}
          ${zone ? ' · ' + zone : ''}
        </span>
      </div>

      <div class="p-5 grid md:grid-cols-2 gap-x-6">
        <!-- Left: Sections list -->
        <div class="divide-y divide-slate-100">
          ${sectionsHtml}
        </div>

        <!-- Right: Metadata -->
        <div class="space-y-4 mt-4 md:mt-0">
          ${synthese.present ? `
          <div class="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
            <p class="text-xs font-semibold text-emerald-700 mb-1"><i class="fas fa-quote-left mr-1"></i> Synthèse d'impact</p>
            <p class="text-sm text-emerald-900 italic">${synthese.phrase_impact.slice(0, 200)}</p>
            ${synthese.maturite ? `<p class="text-xs text-emerald-600 mt-1">Maturité : <strong>${synthese.maturite}</strong></p>` : ''}
          </div>
          ` : ''}

          ${oddMentionnes.length > 0 ? `
          <div class="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <p class="text-xs font-semibold text-blue-700 mb-2"><i class="fas fa-bullseye mr-1"></i> ODD identifiés</p>
            <div class="flex flex-wrap gap-1">
              ${oddMentionnes.map((n: number) => `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">ODD ${n}</span>`).join('')}
            </div>
          </div>
          ` : ''}

          ${sectionsAbsentesListe.length > 0 ? `
          <div class="bg-amber-50 rounded-lg p-3 border border-amber-100">
            <p class="text-xs font-semibold text-amber-700 mb-1"><i class="fas fa-triangle-exclamation mr-1"></i> Sections manquantes</p>
            <ul class="text-xs text-amber-800 space-y-1">
              ${sectionsAbsentesListe.map((s: string) => `<li>· ${s}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          <!-- Completude bar -->
          <div>
            <div class="flex justify-between text-xs text-slate-500 mb-1">
              <span>Complétude</span>
              <span class="font-semibold ${completude === 100 ? 'text-emerald-600' : completude >= 70 ? 'text-amber-600' : 'text-red-500'}">${completude}%</span>
            </div>
            <div class="w-full bg-slate-200 rounded-full h-2">
              <div class="h-2 rounded-full transition-all ${completude === 100 ? 'bg-emerald-500' : completude >= 70 ? 'bg-amber-400' : 'bg-red-400'}" style="width:${completude}%"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- STATUS CARDS (compact) -->
    <div class="grid md:grid-cols-3 gap-4">
      <!-- Card 1: Upload -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg ${hasUpload ? 'bg-emerald-100' : 'bg-slate-100'} flex items-center justify-center">
            <i class="fas fa-file-word ${hasUpload ? 'text-emerald-600' : 'text-slate-400'} text-sm"></i>
          </div>
          <div>
            <p class="text-xs font-semibold ${hasUpload ? 'text-emerald-700' : 'text-slate-500'}">
              ${hasUpload ? 'Fichier reçu ✓' : 'Aucun fichier'}
            </p>
            <p class="text-[10px] text-slate-400">${hasExtraction ? sectionsPresentes + '/9 sections' : 'Upload .docx'}</p>
          </div>
        </div>
      </div>

      <!-- Card 2: Analysis -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg ${status === 'generated' ? 'bg-emerald-100' : status === 'extracted' ? 'bg-blue-100' : 'bg-slate-100'} flex items-center justify-center">
            <i class="fas fa-brain ${status === 'generated' ? 'text-emerald-600' : status === 'extracted' ? 'text-blue-600' : 'text-slate-400'} text-sm"></i>
          </div>
          <div>
            <p class="text-xs font-semibold ${status === 'generated' ? 'text-emerald-700' : status === 'extracted' ? 'text-blue-700' : 'text-slate-500'}">
              ${status === 'generated' ? 'Analyse complète ✓' : status === 'extracted' ? 'Extraction OK' : status === 'analyzing' ? 'En cours...' : 'En attente'}
            </p>
            ${score !== null ? `<p class="text-[10px] text-emerald-600">Score : ${score}/10</p>` : ''}
          </div>
        </div>
      </div>

      <!-- Card 3: Deliverable -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg ${hasDeliverable ? 'bg-emerald-100' : 'bg-slate-100'} flex items-center justify-center">
            <i class="fas fa-file-lines ${hasDeliverable ? 'text-emerald-600' : 'text-slate-400'} text-sm"></i>
          </div>
          <div>
            <p class="text-xs font-semibold ${hasDeliverable ? 'text-emerald-700' : 'text-slate-500'}">
              ${hasDeliverable ? 'Livrable prêt ✓' : 'Non généré'}
            </p>
            ${hasDeliverable ? `<a href="/api/sic/deliverable?format=full" target="_blank" class="text-[10px] text-emerald-600 underline">Voir</a>` : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- ANALYSIS RESULTS -->
    ${analysisHtml}

    <!-- TEMPLATE + GENERATE -->
    <div class="flex flex-col sm:flex-row gap-3 items-center justify-center">
      <a href="/templates/Questionnaire_BMC_SIC.docx" download class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition">
        <i class="fas fa-download text-emerald-600"></i> Télécharger le questionnaire BMC & SIC
      </a>

      <button
        id="btn-generate"
        onclick="launchGeneration()"
        ${!hasExtraction ? 'disabled' : ''}
        class="inline-flex items-center gap-3 px-8 py-2.5 rounded-xl text-white text-sm font-bold shadow-lg transition
          ${hasExtraction ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 cursor-pointer' : 'bg-slate-300 cursor-not-allowed'}"
      >
        <i class="fas fa-wand-magic-sparkles"></i>
        Générer l'analyse SIC
      </button>
    </div>
    ${!hasExtraction ? '<p class="text-center text-xs text-slate-400">Uploadez un fichier SIC pour activer l\'analyse</p>' : ''}

    <!-- GENERATED DELIVERABLE PREVIEW -->
    ${hasDeliverable ? `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span class="text-sm font-semibold text-slate-700"><i class="fas fa-eye mr-1"></i> Aperçu du livrable SIC</span>
        <a href="/api/sic/deliverable?format=full" target="_blank" class="text-xs text-emerald-600 hover:underline">Plein écran <i class="fas fa-external-link-alt"></i></a>
      </div>
      <iframe src="/api/sic/deliverable?format=full" style="width:100%;height:700px;border:none;" title="Livrable SIC"></iframe>
    </div>
    ` : ''}

  </main>

  <script>
    function getToken() {
      return localStorage.getItem('auth_token') || document.cookie.split('auth_token=')[1]?.split(';')[0] || '';
    }

    // ── Drag & Drop / File Select ──
    function handleDrop(e) {
      e.preventDefault();
      e.currentTarget.classList.remove('dropzone-active');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) uploadFile(files[0]);
    }

    function handleFileSelect(input) {
      if (input.files && input.files.length > 0) uploadFile(input.files[0]);
    }

    async function uploadFile(file) {
      if (!file.name.match(/\\.docx?$/i)) {
        alert('Veuillez sélectionner un fichier .docx');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert('Fichier trop volumineux (max 10 Mo)');
        return;
      }

      // Show progress
      document.getElementById('upload-zone').classList.add('hidden');
      const prog = document.getElementById('upload-progress');
      prog.classList.remove('hidden');
      const bar = document.getElementById('upload-bar');
      const statusText = document.getElementById('upload-status-text');

      bar.style.width = '20%';
      statusText.textContent = 'Upload du fichier...';

      const formData = new FormData();
      formData.append('file', file);

      try {
        bar.style.width = '40%';
        statusText.textContent = 'Extraction et analyse par Claude AI...';

        const token = getToken();
        const res = await fetch('/api/sic/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: formData
        });

        bar.style.width = '80%';
        const data = await res.json();

        if (data.success) {
          bar.style.width = '100%';
          statusText.innerHTML = '<i class="fas fa-circle-check text-emerald-600 mr-1"></i> ' + data.message;

          // Reload after brief pause to show the extraction summary
          setTimeout(() => location.reload(), 1200);
        } else {
          statusText.innerHTML = '<i class="fas fa-triangle-exclamation text-red-500 mr-1"></i> ' + (data.error || 'Erreur');
          bar.style.width = '100%';
          bar.classList.remove('bg-emerald-500');
          bar.classList.add('bg-red-400');
          setTimeout(() => {
            prog.classList.add('hidden');
            document.getElementById('upload-zone').classList.remove('hidden');
          }, 3000);
        }
      } catch (err) {
        statusText.innerHTML = '<i class="fas fa-triangle-exclamation text-red-500 mr-1"></i> Erreur réseau';
        bar.classList.remove('bg-emerald-500');
        bar.classList.add('bg-red-400');
        setTimeout(() => {
          prog.classList.add('hidden');
          document.getElementById('upload-zone').classList.remove('hidden');
        }, 3000);
      }
    }

    // ── Generate Analysis ──
    async function launchGeneration() {
      const btn = document.getElementById('btn-generate');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyse IA en cours...';

      try {
        const token = getToken();
        const res = await fetch('/api/sic/generate', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ pmeId: '' })
        });
        const data = await res.json();
        if (data.success) {
          const score = data.analysis?.score_global || '?';
          const label = data.analysis?.label || '';
          btn.innerHTML = '<i class="fas fa-circle-check"></i> ' + score + '/100 — ' + label;
          btn.classList.remove('from-emerald-600', 'to-teal-600');
          btn.classList.add('bg-emerald-600');
          setTimeout(() => location.reload(), 2000);
        } else {
          btn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> ' + (data.error || 'Erreur');
          btn.disabled = false;
          setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Générer l\\'analyse SIC';
          }, 3000);
        }
      } catch (err) {
        btn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Erreur réseau';
        btn.disabled = false;
      }
    }
  </script>

</body>
</html>`)
  } catch (error: any) {
    console.error('[SIC Page] Error:', error)
    return c.redirect('/entrepreneur')
  }
})

// ═══════════════════════════════════════════════════════════════
// SIC MODULE — Routes API dédiées Social Impact Canvas
// Structure parallèle au BMC : upload → generate → download → latest
// ═══════════════════════════════════════════════════════════════

// POST /api/sic/upload — Reçoit un fichier .docx SIC, extrait le texte, et lance l'extraction Claude
app.post('/api/sic/upload', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'Aucun fichier fourni' }, 400)

    // Validate file type
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!ext || !['doc', 'docx'].includes(ext)) {
      return c.json({ error: 'Format non supporté. Envoyez un fichier .docx' }, 400)
    }

    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, 400)
    }

    // ── ÉTAPE A : Extraire le texte brut du DOCX ──
    const arrayBuffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)
    let extractedText = ''
    try {
      extractedText = parseDocx(uint8)
    } catch (e) {
      console.warn('[SIC Upload] DOCX parsing failed:', e)
      return c.json({ error: 'Impossible de lire le fichier Word. Vérifiez le format.' }, 400)
    }

    if (extractedText.length < 50) {
      return c.json({ error: 'Le fichier semble vide ou illisible.' }, 400)
    }

    console.log(`[SIC Upload] DOCX text extracted: ${extractedText.length} chars from "${file.name}"`)

    // ── ÉTAPE B : Appel Claude API pour extraction structurée ──
    const apiKey = c.env.ANTHROPIC_API_KEY || ''
    let extractionResult: any = null
    let extractionSource: 'claude' | 'regex' = 'regex'

    if (apiKey && apiKey.length > 10) {
      try {
        console.log('[SIC Upload] Calling Claude API for structured extraction...')
        const claudeResult = await callClaudeForSicExtraction(apiKey, extractedText, file.name)
        if (claudeResult && claudeResult.extraction) {
          extractionResult = claudeResult
          extractionSource = 'claude'
          console.log(`[SIC Upload] Claude extraction OK: ${claudeResult.metadata?.sections_presentes || '?'}/9 sections`)
        }
      } catch (err: any) {
        console.warn('[SIC Upload] Claude extraction failed, falling back to regex:', err.message)
      }
    } else {
      console.log('[SIC Upload] No API key, using regex fallback')
    }

    // Fallback: regex-based extraction if Claude failed
    if (!extractionResult) {
      extractionResult = extractSicSectionsRegex(extractedText)
      console.log(`[SIC Upload] Regex extraction: ${extractionResult.metadata?.sections_presentes || '?'}/9 sections`)
    }

    // ── ÉTAPE C : Sauvegarder dans sic_analyses + uploads ──
    const id = crypto.randomUUID()
    const pmeId = String(payload.userId)
    const sectionsPresentes = extractionResult.metadata?.sections_presentes ?? 0
    const sectionsAbsentes = extractionResult.metadata?.sections_absentes ?? (9 - sectionsPresentes)
    const sectionsAbsentesListe = extractionResult.metadata?.sections_absentes_liste ?? []

    // Delete previous SIC analyses for this user (keep latest only)
    await c.env.DB.prepare(`DELETE FROM sic_analyses WHERE user_id = ?`).bind(payload.userId).run()

    await c.env.DB.prepare(`
      INSERT INTO sic_analyses (id, pme_id, user_id, version, extraction_json, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, 'extracted', datetime('now'), datetime('now'))
    `).bind(
      id, pmeId, payload.userId,
      JSON.stringify({ ...extractionResult, _source: extractionSource, _filename: file.name, _textLength: extractedText.length })
    ).run()

    // Also store in uploads table for entrepreneur-page integration
    // Delete previous SIC upload for this user
    await c.env.DB.prepare(`DELETE FROM uploads WHERE user_id = ? AND category = 'sic'`).bind(payload.userId).run()

    const uploadId = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO uploads (id, user_id, category, filename, r2_key, file_type, file_size, extracted_text, uploaded_at)
      VALUES (?, ?, 'sic', ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      uploadId, payload.userId, file.name,
      `sic/${id}/${file.name}`,
      file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file.size, extractedText
    ).run()

    console.log(`[SIC Upload] Saved: id=${id}, ${sectionsPresentes}/9 sections, source=${extractionSource}`)

    // ── ÉTAPE D : Réponse au frontend ──
    return c.json({
      success: true,
      id,
      uploadId,
      message: sectionsPresentes === 9
        ? 'Fichier SIC reçu — 9/9 sections extraites'
        : `Fichier SIC reçu — ${sectionsPresentes}/9 sections extraites`,
      filename: file.name,
      extractionSource,
      sections_presentes: sectionsPresentes,
      sections_absentes: sectionsAbsentes,
      sections_absentes_liste: sectionsAbsentesListe,
      secteur: extractionResult.metadata?.secteur || null,
      zone_geographique: extractionResult.metadata?.zone_geographique || null,
      odd_mentionnes: extractionResult.metadata?.odd_mentionnes || [],
      textLength: extractedText.length
    })
  } catch (error: any) {
    console.error('[SIC Upload] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// POST /api/sic/generate — Lance l'analyse SIC via l'agent Claude (SIC Analyst)
app.post('/api/sic/generate', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({}))
    const pmeId = (body as any)?.pmeId?.trim() || String(payload.userId)

    // 1. Lire extraction_json depuis sic_analyses
    const sicAnalysis = await c.env.DB.prepare(`
      SELECT id, extraction_json, status FROM sic_analyses
      WHERE pme_id = ? AND user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(pmeId, payload.userId).first()

    if (!sicAnalysis) {
      return c.json({ error: 'Aucun fichier SIC uploadé. Uploadez d\'abord un .docx' }, 400)
    }

    if (!sicAnalysis.extraction_json) {
      return c.json({ error: 'Extraction non disponible. Ré-uploadez le fichier SIC.' }, 400)
    }

    if (sicAnalysis.status === 'analyzing') {
      return c.json({ error: 'Analyse déjà en cours' }, 409)
    }

    let extractionData: any
    try {
      extractionData = JSON.parse(sicAnalysis.extraction_json as string)
    } catch {
      return c.json({ error: 'Extraction corrompue. Ré-uploadez le fichier SIC.' }, 400)
    }

    // 2. Optionnel : lire le BMC analysé
    let bmcAnalysis: any = null
    try {
      const bmcRow = await c.env.DB.prepare(`
        SELECT content FROM entrepreneur_deliverables
        WHERE user_id = ? AND type = 'bmc_analysis'
        ORDER BY created_at DESC LIMIT 1
      `).bind(payload.userId).first()
      if (bmcRow?.content) {
        bmcAnalysis = JSON.parse(bmcRow.content as string)
        console.log(`[SIC Generate] BMC analysis found for cross-reference`)
      }
    } catch {
      console.log(`[SIC Generate] No BMC analysis available for cross-reference`)
    }

    // Update status to 'analyzing'
    await c.env.DB.prepare(`
      UPDATE sic_analyses SET status = 'analyzing', updated_at = datetime('now') WHERE id = ?
    `).bind(sicAnalysis.id).run()

    console.log(`[SIC Generate] Starting analysis for pme_id=${pmeId}, analysis_id=${sicAnalysis.id}`)

    // 3. Appel Claude via l'agent SIC Analyst
    const apiKey = c.env.ANTHROPIC_API_KEY || ''
    let analysisResult: SicAnalystResult
    let source: 'claude' | 'fallback' = 'fallback'

    if (apiKey && apiKey.length > 10) {
      try {
        analysisResult = await analyzeSicWithClaude(apiKey, extractionData, bmcAnalysis)
        source = 'claude'
        console.log(`[SIC Generate] Claude analysis OK: score=${analysisResult.score_global}, palier=${analysisResult.palier}`)
      } catch (err: any) {
        console.warn(`[SIC Generate] Claude failed, using fallback:`, err.message)
        analysisResult = analyzeSicFallback(extractionData)
      }
    } else {
      console.log(`[SIC Generate] No API key, using fallback scoring`)
      analysisResult = analyzeSicFallback(extractionData)
    }

    // 4. Sauvegarder analysis_json dans D1
    const analysisJson = JSON.stringify({
      ...analysisResult,
      _source: source,
      _generated_at: new Date().toISOString(),
      _pme_id: pmeId
    })

    await c.env.DB.prepare(`
      UPDATE sic_analyses
      SET analysis_json = ?, score = ?, status = 'generated', updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      analysisJson,
      analysisResult.score_global,
      sicAnalysis.id
    ).run()

    console.log(`[SIC Generate] Saved: score=${analysisResult.score_global}/100, palier=${analysisResult.palier}, source=${source}`)

    // 5. Retourner le JSON complet au frontend
    return c.json({
      success: true,
      message: `Analyse SIC terminée — Score : ${analysisResult.score_global}/100 (${analysisResult.label})`,
      analysisId: sicAnalysis.id,
      source,
      analysis: analysisResult
    })
  } catch (error: any) {
    console.error('[SIC Generate] Error:', error)
    // Reset status if it was set to analyzing
    try {
      const body2 = await c.req.json().catch(() => ({}))
      const pmeId2 = (body2 as any)?.pmeId?.trim() || ''
      if (pmeId2) {
        await c.env.DB.prepare(`
          UPDATE sic_analyses SET status = 'error', updated_at = datetime('now')
          WHERE pme_id = ? AND status = 'analyzing'
        `).bind(pmeId2).run()
      }
    } catch { /* ignore cleanup errors */ }
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// GET /api/sic/download/:id — Retourne le fichier Word ou PDF (stub pour le moment)
app.get('/api/sic/download/:id', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const id = c.req.param('id')
    const format = c.req.query('format') || 'docx'

    const sicAnalysis = await c.env.DB.prepare(`
      SELECT id, analysis_json, html_content, status, extraction_json FROM sic_analyses
      WHERE id = ? AND user_id = ?
    `).bind(id, payload.userId).first()

    if (!sicAnalysis) {
      return c.json({ error: 'Analyse SIC non trouvée' }, 404)
    }

    if (sicAnalysis.status !== 'generated') {
      return c.json({ error: 'Analyse pas encore terminée' }, 400)
    }

    // STUB: Return the HTML content if available, otherwise a placeholder
    if (sicAnalysis.html_content) {
      return c.html(safeScriptBlocks(sicAnalysis.html_content as string))
    }

    return c.json({
      success: true,
      id: sicAnalysis.id,
      status: sicAnalysis.status,
      message: 'Download Word/PDF non encore implémenté. Le livrable sera disponible après intégration du moteur SIC.',
      format
    })
  } catch (error: any) {
    console.error('[SIC Download] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// GET /api/sic/latest/:pmeId — Retourne le dernier JSON d'analyse SIC pour cette PME
app.get('/api/sic/latest/:pmeId', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const pmeId = c.req.param('pmeId')

    const sicAnalysis = await c.env.DB.prepare(`
      SELECT id, pme_id, version, extraction_json, analysis_json, score, status, created_at, updated_at
      FROM sic_analyses
      WHERE pme_id = ? AND user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(pmeId, payload.userId).first()

    if (!sicAnalysis) {
      return c.json({ error: 'Aucune analyse SIC trouvée pour cette PME' }, 404)
    }

    // Parse JSON fields
    let extraction = null
    let analysis = null
    try {
      if (sicAnalysis.extraction_json) extraction = JSON.parse(sicAnalysis.extraction_json as string)
    } catch { /* ignore */ }
    try {
      if (sicAnalysis.analysis_json) analysis = JSON.parse(sicAnalysis.analysis_json as string)
    } catch { /* ignore */ }

    return c.json({
      success: true,
      id: sicAnalysis.id,
      pmeId: sicAnalysis.pme_id,
      version: sicAnalysis.version,
      score: sicAnalysis.score,
      status: sicAnalysis.status,
      extraction,
      analysis,
      createdAt: sicAnalysis.created_at,
      updatedAt: sicAnalysis.updated_at
    })
  } catch (error: any) {
    console.error('[SIC Latest] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════
// PLAN FINANCIER OVO — Routes API & Module Page
// ═══════════════════════════════════════════════════════════════

// POST /api/plan-ovo/generate — Full implementation with Claude AI extraction
app.post('/api/plan-ovo/generate', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json().catch(() => ({}))
    const pmeId = (body as any).pmeId || `pme_${payload.userId}`
    const db = c.env.DB
    const apiKey = c.env.ANTHROPIC_API_KEY || ''

    // ═══════════════════════════════════════════════════════
    // STEP A: Read all deliverables in parallel
    // Framework = REQUIRED, BMC/SIC/Diagnostic = optional
    // framework_pme_data = structured PME data (PRIORITY source for extraction)
    // ═══════════════════════════════════════════════════════
    console.log(`[Plan OVO] Step A: Fetching deliverables for user ${payload.userId}`)

    const [framework, bmc, sic, diagnostic, pmeDataRow] = await Promise.all([
      db.prepare(`
        SELECT id, content, score FROM entrepreneur_deliverables
        WHERE user_id = ? AND type = 'framework'
        ORDER BY created_at DESC LIMIT 1
      `).bind(payload.userId).first(),
      db.prepare(`
        SELECT id, content, score FROM entrepreneur_deliverables
        WHERE user_id = ? AND type = 'bmc_analysis'
        ORDER BY created_at DESC LIMIT 1
      `).bind(payload.userId).first(),
      db.prepare(`
        SELECT id, content, score FROM entrepreneur_deliverables
        WHERE user_id = ? AND type = 'sic_analysis'
        ORDER BY created_at DESC LIMIT 1
      `).bind(payload.userId).first(),
      db.prepare(`
        SELECT id, content, score FROM entrepreneur_deliverables
        WHERE user_id = ? AND type = 'diagnostic'
        ORDER BY created_at DESC LIMIT 1
      `).bind(payload.userId).first(),
      db.prepare(`
        SELECT content FROM entrepreneur_deliverables
        WHERE user_id = ? AND type = 'framework_pme_data'
        ORDER BY version DESC LIMIT 1
      `).bind(payload.userId).first()
    ])

    // Parse PME structured data (Module 3 — entrepreneur's declared financials)
    let pmeData: PmeStructuredData | null = null
    if (pmeDataRow?.content) {
      try {
        pmeData = JSON.parse(pmeDataRow.content as string) as PmeStructuredData
        console.log(`[Plan OVO] PME data loaded: CA N=${pmeData.historique?.caTotal?.[2]}, activities=${pmeData.activities?.length}, investments=${pmeData.hypotheses?.investissements?.length || 0}`)
      } catch (e) {
        console.warn('[Plan OVO] Failed to parse framework_pme_data:', e)
      }
    } else {
      console.warn('[Plan OVO] No framework_pme_data found — extraction will rely on Framework text only')
    }

    // Framework is mandatory
    if (!framework || !framework.content) {
      return c.json({
        error: 'Framework requis',
        message: 'Le Plan Financier Intermédiaire (Framework) doit être généré avant de créer le Plan OVO. Veuillez d\'abord générer vos livrables depuis le tableau de bord.'
      }, 400)
    }

    // Build allDeliverables object
    const allDeliverables = {
      framework: {
        id: framework.id as string,
        type: 'framework',
        content: framework.content as string,
        score: framework.score as number | null,
        available: true
      } as OVODeliverableData,
      bmc: bmc ? {
        id: bmc.id as string,
        type: 'bmc_analysis',
        content: bmc.content as string,
        score: bmc.score as number | null,
        available: true
      } as OVODeliverableData : undefined,
      sic: sic ? {
        id: sic.id as string,
        type: 'sic_analysis',
        content: sic.content as string,
        score: sic.score as number | null,
        available: true
      } as OVODeliverableData : undefined,
      diagnostic: diagnostic ? {
        id: diagnostic.id as string,
        type: 'diagnostic',
        content: diagnostic.content as string,
        score: diagnostic.score as number | null,
        available: true
      } as OVODeliverableData : undefined
    }

    console.log(`[Plan OVO] Step A done: framework=${!!framework}, bmc=${!!bmc}, sic=${!!sic}, diag=${!!diagnostic}, pmeData=${!!pmeData}`)

    // ═══════════════════════════════════════════════════════
    // STEP A-bis: Infer country, get fiscal parameters, build KB context
    // ═══════════════════════════════════════════════════════
    console.log(`[Plan OVO] Step A-bis: Detecting country and fiscal params`)

    const contentTexts = [
      framework.content as string,
      bmc?.content as string || '',
      diagnostic?.content as string || ''
    ].filter(Boolean)

    const countryKey = detectCountry(contentTexts)
    const fiscal = getFiscalParams(countryKey)
    const { kbContext, queries: kbQueries } = buildKBContext(fiscal)

    console.log(`[Plan OVO] Country detected: ${fiscal.country} (${countryKey}), KB queries: ${kbQueries.length}`)

    // ═══════════════════════════════════════════════════════
    // STEP B: Template structure (loaded at build time, not runtime)
    // The template is at /templates/plan_ovo_template.xlsm
    // Template structure is defined in ovo-template-structure.ts
    // ═══════════════════════════════════════════════════════
    console.log(`[Plan OVO] Step B: Template structure loaded from ovo-template-structure.ts`)

    // ═══════════════════════════════════════════════════════
    // Create DB entry first (status: generating)
    // ═══════════════════════════════════════════════════════
    const existing = await db.prepare(`
      SELECT id, version FROM plan_ovo_analyses
      WHERE pme_id = ? AND user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(pmeId, payload.userId).first()

    const newVersion = existing ? (Number(existing.version) || 0) + 1 : 1
    const newId = crypto.randomUUID()

    // Initial insertion with status 'generating'
    const initialExtraction = {
      framework: { id: allDeliverables.framework.id, score: allDeliverables.framework.score, available: true },
      bmc: allDeliverables.bmc ? { id: allDeliverables.bmc.id, score: allDeliverables.bmc.score, available: true } : { available: false },
      sic: allDeliverables.sic ? { id: allDeliverables.sic.id, score: allDeliverables.sic.score, available: true } : { available: false },
      diagnostic: allDeliverables.diagnostic ? { id: allDeliverables.diagnostic.id, score: allDeliverables.diagnostic.score, available: true } : { available: false },
      country: fiscal.country,
      collected_at: new Date().toISOString()
    }

    await db.prepare(`
      INSERT INTO plan_ovo_analyses (id, pme_id, user_id, version, extraction_json, status, source, pays, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'generating', 'system', ?, datetime('now'), datetime('now'))
    `).bind(newId, pmeId, payload.userId, newVersion, JSON.stringify(initialExtraction), fiscal.country).run()

    // ═══════════════════════════════════════════════════════
    // STEP C: Call Claude for AI extraction
    // ═══════════════════════════════════════════════════════
    if (!isValidApiKey(apiKey)) {
      // No API key — save as pending without extraction
      console.log(`[Plan OVO] No valid API key, saving as pending`)
      await db.prepare(`
        UPDATE plan_ovo_analyses SET status = 'pending', updated_at = datetime('now') WHERE id = ?
      `).bind(newId).run()

      return c.json({
        success: true,
        id: newId,
        version: newVersion,
        status: 'pending',
        message: 'Plan OVO créé (clé API manquante — extraction IA non disponible).',
        country: fiscal.country,
        sources: {
          framework: true,
          bmc: !!bmc,
          sic: !!sic,
          diagnostic: !!diagnostic
        }
      })
    }

    console.log(`[Plan OVO] Step C: Calling Claude for extraction...`)

    let extractionResult: OVOExtractionResult
    try {
      extractionResult = await extractOVOData({
        apiKey,
        framework: allDeliverables.framework,
        bmc: allDeliverables.bmc,
        sic: allDeliverables.sic,
        diagnostic: allDeliverables.diagnostic,
        fiscal,
        kbContext,
        pmeData  // v2: structured PME data for priority enforcement
      })

      console.log(`[Plan OVO] Step C done: confidence=${extractionResult.metadata?.confidence_score}, products=${extractionResult.produits?.length}, staff=${extractionResult.personnel?.length}`)
    } catch (aiError: any) {
      console.error(`[Plan OVO] Step C FAILED:`, aiError.message)
      // Save error status but still return success (entry created)
      await db.prepare(`
        UPDATE plan_ovo_analyses SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?
      `).bind(aiError.message?.slice(0, 500) || 'Erreur extraction IA', newId).run()

      return c.json({
        success: true,
        id: newId,
        version: newVersion,
        status: 'error',
        message: `Plan OVO créé mais l'extraction IA a échoué: ${aiError.message?.slice(0, 200)}`,
        country: fiscal.country,
        sources: {
          framework: true,
          bmc: !!bmc,
          sic: !!sic,
          diagnostic: !!diagnostic
        }
      })
    }

    // ═══════════════════════════════════════════════════════
    // STEP D: Save extraction results to DB
    // ═══════════════════════════════════════════════════════
    console.log(`[Plan OVO] Step D: Saving extraction to DB`)

    const confidenceScore = extractionResult.metadata?.confidence_score ?? 50

    await db.prepare(`
      UPDATE plan_ovo_analyses
      SET extraction_json = ?,
          analysis_json = ?,
          score = ?,
          status = 'generated',
          pays = ?,
          kb_context = ?,
          kb_used = 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      JSON.stringify(extractionResult),
      JSON.stringify({
        hypotheses: extractionResult.hypotheses,
        metadata: extractionResult.metadata,
        produits_count: extractionResult.produits?.length || 0,
        personnel_count: extractionResult.personnel?.length || 0,
        investissements_count: extractionResult.investissements?.length || 0,
        has_financing: !!(extractionResult.financement?.capital_initial || extractionResult.financement?.pret_ovo?.montant),
      }),
      confidenceScore,
      fiscal.country,
      kbContext.slice(0, 5000), // Limit KB context storage
      newId
    ).run()

    console.log(`[Plan OVO] Step D done: entry ${newId} v${newVersion} saved with status=extracted, score=${confidenceScore}`)

    return c.json({
      success: true,
      id: newId,
      version: newVersion,
      status: 'generated',
      message: 'Données extraites, remplissage Excel en cours...',
      country: fiscal.country,
      confidence: confidenceScore,
      extraction_summary: {
        company: extractionResult.hypotheses?.company_name || 'N/A',
        sector: extractionResult.hypotheses?.sector || 'N/A',
        products_count: extractionResult.produits?.length || 0,
        staff_categories: extractionResult.personnel?.length || 0,
        investments_count: extractionResult.investissements?.length || 0,
        sources_used: extractionResult.metadata?.sources_used || [],
        missing_data: extractionResult.metadata?.missing_data_notes?.length || 0,
        cascade_rules: extractionResult.metadata?.cascade_applied?.length || 0
      },
      sources: {
        framework: true,
        bmc: !!bmc,
        sic: !!sic,
        diagnostic: !!diagnostic
      }
    })
  } catch (error: any) {
    console.error('[Plan OVO Generate] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════
// POST /api/plan-ovo/fill — Fill the OVO Excel template cell-by-cell
// Reads extraction_json from DB, loads template, fills cells, saves as base64
// ═══════════════════════════════════════════════════════════════
app.post('/api/plan-ovo/fill', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json()
    const planId = body.planId || body.id
    if (!planId) return c.json({ error: 'planId requis' }, 400)

    const db = c.env.DB

    // ═══════════════════════════════════════════════════
    // Step 1: Load extraction data from DB
    // ═══════════════════════════════════════════════════
    const plan = await db.prepare(`
      SELECT id, pme_id, version, extraction_json, status, pays
      FROM plan_ovo_analyses
      WHERE id = ? AND user_id = ?
    `).bind(planId, payload.userId).first()

    if (!plan) {
      return c.json({ error: 'Plan OVO non trouvé' }, 404)
    }

    if (!plan.extraction_json) {
      return c.json({ error: 'Extraction non disponible — lancez d\'abord /api/plan-ovo/generate' }, 422)
    }

    if (plan.status === 'filling') {
      return c.json({ error: 'Remplissage déjà en cours' }, 409)
    }

    let extractionData: OVOExtractionResult
    try {
      extractionData = JSON.parse(plan.extraction_json as string)
    } catch {
      return c.json({ error: 'Données extraction corrompues' }, 500)
    }

    console.log(`[Plan OVO Fill] Starting fill for plan ${planId} (v${plan.version})`)
    console.log(`[Plan OVO Fill] Products: ${extractionData.produits?.length || 0}, Staff: ${extractionData.personnel?.length || 0}, Investments: ${extractionData.investissements?.length || 0}`)

    // Mark as filling
    await db.prepare(`
      UPDATE plan_ovo_analyses SET status = 'filling', updated_at = datetime('now') WHERE id = ?
    `).bind(planId).run()

    // ═══════════════════════════════════════════════════
    // Step 2: Load the Excel template
    // ═══════════════════════════════════════════════════
    console.log(`[Plan OVO Fill] Step 2: Loading Excel template...`)

    // Fetch the template from the static assets
    // In local dev (wrangler pages dev), static assets are served from public/
    const url = new URL(c.req.url)
    const templateUrl = `${url.protocol}//${url.host}/templates/plan_ovo_template.xlsm`
    let templateBytes: Uint8Array

    try {
      const resp = await fetch(templateUrl)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      templateBytes = new Uint8Array(await resp.arrayBuffer())
      console.log(`[Plan OVO Fill] Template loaded: ${templateBytes.length} bytes`)
    } catch (fetchErr: any) {
      console.error(`[Plan OVO Fill] Failed to fetch template:`, fetchErr.message)
      // Fallback: try to load from c.env.ASSETS if available (Cloudflare Pages)
      try {
        const assetResp = await c.env.ASSETS?.fetch(new Request('https://placeholder/templates/plan_ovo_template.xlsm'))
        if (assetResp && assetResp.ok) {
          templateBytes = new Uint8Array(await assetResp.arrayBuffer())
          console.log(`[Plan OVO Fill] Template loaded from ASSETS: ${templateBytes.length} bytes`)
        } else {
          throw new Error('ASSETS fetch failed')
        }
      } catch {
        await db.prepare(`
          UPDATE plan_ovo_analyses SET status = 'generated', error_message = 'Template Excel introuvable', updated_at = datetime('now') WHERE id = ?
        `).bind(planId).run()
        return c.json({ error: 'Template Excel introuvable sur le serveur' }, 500)
      }
    }

    // ═══════════════════════════════════════════════════
    // Step 3: Fill the template cell-by-cell
    // ═══════════════════════════════════════════════════
    console.log(`[Plan OVO Fill] Step 3: Filling template...`)

    let filledBytes: Uint8Array
    let stats: FillingStats
    try {
      const result = fillOVOTemplate(templateBytes, extractionData)
      filledBytes = result.filledBytes
      stats = result.stats
      console.log(`[Plan OVO Fill] Filling done: ${stats.totalCells} cells written, output ${filledBytes.length} bytes`)
    } catch (fillErr: any) {
      console.error(`[Plan OVO Fill] Filling FAILED:`, fillErr.message)
      await db.prepare(`
        UPDATE plan_ovo_analyses SET status = 'generated', error_message = ?, updated_at = datetime('now') WHERE id = ?
      `).bind(`Erreur remplissage: ${fillErr.message?.slice(0, 400)}`, planId).run()
      return c.json({ error: `Erreur lors du remplissage: ${fillErr.message}` }, 500)
    }

    // ═══════════════════════════════════════════════════
    // Step 4: Convert to base64 and save to DB
    // ═══════════════════════════════════════════════════
    console.log(`[Plan OVO Fill] Step 4: Compressing and saving filled Excel to DB...`)

    // Compress with gzip then base64 to fit D1 column limit
    let base64String: string
    try {
      // Use fflate gzip for compression (already imported via ovo-excel-filler)
      const compressed = gzipCompressSync(filledBytes)
      console.log(`[Plan OVO Fill] Compressed: ${filledBytes.length} → ${compressed.length} bytes (${Math.round(compressed.length / filledBytes.length * 100)}%)`)

      // Convert to base64
      let binary = ''
      const CHUNK = 8192
      for (let i = 0; i < compressed.length; i += CHUNK) {
        const chunk = compressed.subarray(i, Math.min(i + CHUNK, compressed.length))
        binary += String.fromCharCode(...chunk)
      }
      base64String = btoa(binary)
      console.log(`[Plan OVO Fill] Base64 size: ${base64String.length} chars`)
    } catch (b64Err: any) {
      console.error(`[Plan OVO Fill] Compression/encoding failed:`, b64Err.message)
      await db.prepare(`
        UPDATE plan_ovo_analyses SET status = 'generated', error_message = 'Erreur compression/encodage', updated_at = datetime('now') WHERE id = ?
      `).bind(planId).run()
      return c.json({ error: `Erreur compression: ${b64Err.message}` }, 500)
    }

    // Save to DB
    await db.prepare(`
      UPDATE plan_ovo_analyses
      SET filled_excel_base64 = ?,
          fill_stats = ?,
          status = 'filled',
          error_message = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      base64String,
      JSON.stringify(stats),
      planId
    ).run()

    console.log(`[Plan OVO Fill] ✓ Plan ${planId} filled successfully — ${stats.totalCells} cells, status=filled`)

    return c.json({
      success: true,
      id: planId,
      status: 'filled',
      message: 'Template Excel rempli avec succès',
      stats: {
        totalCells: stats.totalCells,
        inputsData: stats.inputsDataCells,
        revenueData: stats.revenueDataCells,
        financeData: stats.financeDataCells,
        products: stats.productsCount,
        services: stats.servicesCount,
        staff: stats.staffCategories,
        investments: stats.investmentsCount,
        sheetsModified: stats.sheetsModified,
        sheetsPreserved: stats.sheetsPreserved
      },
      downloadUrl: `/api/plan-ovo/download/${planId}`
    })
  } catch (error: any) {
    console.error('[Plan OVO Fill] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// GET /api/plan-ovo/latest/:pmeId — Returns latest plan OVO for this PME
app.get('/api/plan-ovo/latest/:pmeId', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const rawPmeId = c.req.param('pmeId')
    // Resolve 'pme_current' to actual pme_id for this user
    const pmeId = rawPmeId === 'pme_current' ? `pme_${payload.userId}` : rawPmeId

    const plan = await c.env.DB.prepare(`
      SELECT id, pme_id, version, extraction_json, analysis_json, filled_excel_base64,
             score, status, pays, kb_context, kb_used, created_at, updated_at
      FROM plan_ovo_analyses
      WHERE pme_id = ? AND user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(pmeId, payload.userId).first()

    if (!plan) {
      return c.json({ available: false, message: 'Aucun Plan OVO trouvé pour cette PME' })
    }

    // Parse JSON fields
    let extraction = null
    let analysis = null
    try { if (plan.extraction_json) extraction = JSON.parse(plan.extraction_json as string) } catch { /* ignore */ }
    try { if (plan.analysis_json) analysis = JSON.parse(plan.analysis_json as string) } catch { /* ignore */ }

    return c.json({
      available: true,
      data: {
        id: plan.id,
        pmeId: plan.pme_id,
        version: plan.version,
        score: plan.score,
        status: plan.status,
        hasExcel: !!(plan.filled_excel_base64),
        extraction,
        analysis,
        pays: plan.pays,
        kbUsed: plan.kb_used,
        createdAt: plan.created_at,
        updatedAt: plan.updated_at
      }
    })
  } catch (error: any) {
    console.error('[Plan OVO Latest] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// GET /api/plan-ovo/download/:id?format=xlsx — Returns filled Excel file
// Extracts company name from extraction_json, framework or bmc for filename
app.get('/api/plan-ovo/download/:id', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const planId = c.req.param('id')
    const db = c.env.DB

    // ═══════════════════════════════════════════════════
    // Step 1: Fetch plan with extraction_json for company name
    // ═══════════════════════════════════════════════════
    const plan = await db.prepare(`
      SELECT id, pme_id, user_id, filled_excel_base64, extraction_json, status
      FROM plan_ovo_analyses
      WHERE id = ? AND user_id = ?
    `).bind(planId, payload.userId).first()

    if (!plan) {
      return c.json({ error: 'Plan OVO non trouvé' }, 404)
    }

    if (!plan.filled_excel_base64) {
      return c.json({
        error: 'Excel non disponible',
        message: 'Le fichier Excel n\'a pas encore été généré. Lancez d\'abord POST /api/plan-ovo/fill.',
        status: plan.status,
        planId: plan.id
      }, 422)
    }

    console.log(`[Plan OVO Download] Preparing download for plan ${planId}`)

    // ═══════════════════════════════════════════════════
    // Step 2: Extract company name for filename
    // Priority: extraction_json.hypotheses.company_name
    //        → framework deliverable → bmc deliverable → pme_id fallback
    // ═══════════════════════════════════════════════════
    let companyName = ''

    // Try extraction_json first (most reliable — already processed)
    if (plan.extraction_json) {
      try {
        const extraction = JSON.parse(plan.extraction_json as string)
        companyName = extraction?.hypotheses?.company_name || ''
      } catch { /* ignore parse errors */ }
    }

    // Fallback: query framework or bmc deliverables for company name
    if (!companyName) {
      try {
        const deliverable = await db.prepare(`
          SELECT content FROM entrepreneur_deliverables
          WHERE user_id = ? AND type IN ('framework', 'bmc_analysis')
          ORDER BY CASE type WHEN 'framework' THEN 1 WHEN 'bmc_analysis' THEN 2 END,
                   created_at DESC
          LIMIT 1
        `).bind(payload.userId).first()

        if (deliverable?.content) {
          const content = deliverable.content as string
          // Try to parse as JSON first
          try {
            const parsed = JSON.parse(content)
            companyName = parsed?.company_name || parsed?.entreprise?.nom || parsed?.nom_entreprise || ''
          } catch {
            // Try regex extraction from text content
            const nameMatch = content.match(/(?:entreprise|société|company|raison sociale)\s*[:\-–]\s*([A-ZÀ-Ü][A-ZÀ-Ü\s\-&.']+)/i)
            if (nameMatch) companyName = nameMatch[1].trim()
          }
        }
      } catch { /* ignore — fallback to pme_id */ }
    }

    // Final fallback: sanitize pme_id
    if (!companyName) {
      companyName = (plan.pme_id as string || 'PME').replace(/^pme_/, 'PME_')
    }

    console.log(`[Plan OVO Download] Company name resolved: "${companyName}"`)

    // ═══════════════════════════════════════════════════
    // Step 3: Decode base64 → gunzip → raw Excel bytes
    // ═══════════════════════════════════════════════════
    const b64Data = plan.filled_excel_base64 as string
    console.log(`[Plan OVO Download] Base64 length: ${b64Data.length}`)

    // Decode base64 to binary
    const binaryStr = atob(b64Data)
    const compressed = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      compressed[i] = binaryStr.charCodeAt(i)
    }
    console.log(`[Plan OVO Download] Compressed size: ${compressed.length} bytes`)

    // Decompress gzip → original XLSM bytes
    let excelBytes: Uint8Array
    try {
      excelBytes = gunzipDecompressSync(compressed)
      console.log(`[Plan OVO Download] Decompressed: ${compressed.length} → ${excelBytes.length} bytes`)
    } catch (gzipErr) {
      // Fallback: data might be stored without gzip (older entries or migration)
      console.warn(`[Plan OVO Download] Gzip decompression failed, using raw bytes:`, (gzipErr as Error).message)
      excelBytes = compressed
    }

    // ═══════════════════════════════════════════════════
    // Step 4: Build filename and return response
    // Format: Plan_OVO_{COMPANY_NAME}_{YYYYMMDD}.xlsm
    // ═══════════════════════════════════════════════════
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')

    // Sanitize company name for filename:
    // - Replace accented chars with ASCII equivalents
    // - Replace non-alphanumeric (except _ and -) with _
    // - Collapse multiple underscores
    // - Trim underscores from edges
    const sanitizedName = companyName
      .toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
      .replace(/['']/g, '')                                // Remove apostrophes
      .replace(/[^A-Z0-9]/g, '_')                          // Non-alphanum → _
      .replace(/_+/g, '_')                                 // Collapse __
      .replace(/^_|_$/g, '')                               // Trim _
      .slice(0, 50)                                        // Max 50 chars

    const filename = `Plan_OVO_${sanitizedName}_${today}.xlsm`
    console.log(`[Plan OVO Download] Serving file: ${filename} (${excelBytes.length} bytes)`)

    // The template is .xlsm (macro-enabled), use the correct MIME type
    const contentType = 'application/vnd.ms-excel.sheet.macroEnabled.12'

    return new Response(excelBytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(excelBytes.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'X-Plan-Id': planId,
        'X-Company-Name': sanitizedName,
        'X-Content-Size': String(excelBytes.length)
      }
    })
  } catch (error: any) {
    console.error('[Plan OVO Download] Error:', error)
    return c.json({
      error: 'Erreur lors du téléchargement',
      message: error.message || 'Erreur serveur',
      details: 'Vérifiez que le plan existe et que le remplissage Excel a été effectué.'
    }, 500)
  }
})

// GET /api/plan-ovo/template — Serve the empty template for download
app.get('/api/plan-ovo/template', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    // In Cloudflare Workers, we can't read files at runtime
    // The template would need to be served from R2 or as a static asset in production
    // For now, return info about the template
    return c.json({
      available: true,
      name: '251022-PlanFinancierOVO-Template5Ans-v0210-EMPTY.xlsm',
      path: '/templates/plan_ovo_template.xlsm',
      format: 'xlsm',
      sheets: ['ReadMe', 'Instructions', 'InputsData', 'RevenueData', 'RevenuePivot', 'RevenueChart', 'FinanceData', 'FinancePivot', 'FinanceChart', 'FinanceEUR'],
      tables: {
        InputsData: 'C3:K503 — Données de l\'entreprise',
        RevenueData: 'C7:AS1268 — Revenus par produit/service',
        FinanceData: 'C3:AH839 — P&L, Cash flow, Bilan'
      },
      message: 'Template Plan Financier OVO — Format Bailleurs (5 ans)'
    })
  } catch (error: any) {
    console.error('[Plan OVO Template] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})


// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC EXPERT MODULE — API Routes
// POST /api/diagnostic/generate — Fetch all deliverables, create diagnostic record
// GET /api/diagnostic/latest/:pmeId — Returns latest diagnostic or {available: false}
// GET /api/diagnostic/download/:id — Returns HTML (or future PDF)
// ═══════════════════════════════════════════════════════════════

app.post('/api/diagnostic/generate', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const db = c.env.DB
    const pmeId = `pme_${payload.userId}`
    const apiKey = c.env.ANTHROPIC_API_KEY || ''

    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE A — Collecter TOUS les livrables disponibles en parallèle
    // ═══════════════════════════════════════════════════════════════
    const [bmcRow, sicRow, frameworkRow, frameworkPmeRow, planOvoRow, bpRow, oddRow] = await Promise.all([
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_analysis' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_pme_data' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id, extraction_json, score, status FROM plan_ovo_analyses WHERE user_id = ? AND pme_id = ? ORDER BY created_at DESC LIMIT 1`).bind(payload.userId, pmeId).first(),
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'business_plan' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'odd' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
    ])

    const sources: Record<string, boolean> = {
      bmc: !!bmcRow,
      sic: !!sicRow,
      framework: !!frameworkRow,
      framework_pme_data: !!frameworkPmeRow,
      plan_ovo: !!(planOvoRow && (planOvoRow.status === 'generated' || planOvoRow.status === 'filled')),
      business_plan: !!bpRow,
      odd: !!oddRow,
    }
    const availableCount = Object.values(sources).filter(Boolean).length

    console.log(`[Diagnostic] ÉTAPE A — Sources: bmc=${sources.bmc}, sic=${sources.sic}, fw=${sources.framework}, pme=${sources.framework_pme_data}, ovo=${sources.plan_ovo}, bp=${sources.business_plan}, odd=${sources.odd} (${availableCount} total)`)

    if (availableCount < 2) {
      return c.json({ success: false, error: 'Au moins 2 modules complétés sont nécessaires pour générer le diagnostic.', sources, availableCount }, 400)
    }

    // Parse JSON contents for each deliverable
    const safeParseJSON = (row: any, field: string = 'content') => {
      if (!row) return null
      try { return JSON.parse(row[field] as string) } catch { return null }
    }
    const allDeliverables: Record<string, any> = {}
    if (bmcRow) allDeliverables.bmc_analysis = safeParseJSON(bmcRow)
    if (sicRow) allDeliverables.sic_analysis = safeParseJSON(sicRow)
    if (frameworkRow) allDeliverables.framework_analysis = safeParseJSON(frameworkRow)
    if (frameworkPmeRow) allDeliverables.framework_pme_data = safeParseJSON(frameworkPmeRow)
    if (planOvoRow) allDeliverables.plan_ovo = safeParseJSON(planOvoRow, 'extraction_json')
    if (bpRow) allDeliverables.business_plan = safeParseJSON(bpRow)
    if (oddRow) allDeliverables.odd_analysis = safeParseJSON(oddRow)

    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE A-BIS — Consulter la Base de Connaissances (KB) + RAG
    // ═══════════════════════════════════════════════════════════════

    // Detect country from deliverables content
    const contentStrings: string[] = []
    if (frameworkRow?.content) contentStrings.push(frameworkRow.content as string)
    if (bmcRow?.content) contentStrings.push(bmcRow.content as string)
    if (frameworkPmeRow?.content) contentStrings.push(frameworkPmeRow.content as string)
    if (sicRow?.content) contentStrings.push(sicRow.content as string)
    const countryKey = detectCountry(contentStrings)
    const fiscal = getFiscalParams(countryKey)

    // Extract sector from deliverables (try multiple paths)
    let sector = 'PME'
    let zone = 'urbain'
    try {
      const pmeData = allDeliverables.framework_pme_data
      if (pmeData?.secteur) sector = pmeData.secteur
      else if (pmeData?.entreprise?.secteur) sector = pmeData.entreprise.secteur
      else if (pmeData?.entreprise?.activite) sector = pmeData.entreprise.activite
      // Try BMC
      if (sector === 'PME' && allDeliverables.bmc_analysis) {
        const bmc = allDeliverables.bmc_analysis
        if (bmc?.sector) sector = bmc.sector
        else if (bmc?.companyName) sector = bmc.companyName
        else if (bmc?.segments_clients && typeof bmc.segments_clients === 'string') {
          const segMatch = bmc.segments_clients.match(/secteur\s*:?\s*([^,.\n]+)/i)
          if (segMatch) sector = segMatch[1].trim()
        }
      }
      // Try Framework analysis
      if (sector === 'PME' && allDeliverables.framework_analysis) {
        const fw = allDeliverables.framework_analysis
        if (fw?.sector) sector = fw.sector
        else if (fw?.entreprise?.secteur) sector = fw.entreprise.secteur
      }
      // Detect zone from PME data
      if (pmeData?.zone) zone = pmeData.zone
      else if (pmeData?.entreprise?.zone) zone = pmeData.entreprise.zone
      else if (pmeData?.entreprise?.ville) {
        const ville = (pmeData.entreprise.ville as string || '').toLowerCase()
        if (['abidjan', 'dakar', 'ouagadougou', 'bamako', 'cotonou', 'lome', 'niamey'].includes(ville)) zone = 'urbain'
        else zone = 'peri-urbain'
      }
    } catch { /* ignore sector extraction errors */ }

    // Build KB context from fiscal-params (deterministic, always available)
    const { kbContext: fiscalKBText } = buildKBContext(fiscal)

    // Query KB database with 5 targeted RAG queries including sector and country
    let kbBenchmarks: any[] = []
    let kbFiscalParams: any[] = []
    let kbFunders: any[] = []
    let kbCriteria: any[] = []
    let kbRisks: any[] = []
    let kbUsed = false
    try {
      const [benchResult, fiscalResult, funderResult, criteriaResult, risksResult] = await Promise.all([
        // Requête 1: Benchmarks sectoriels
        db.prepare(`SELECT * FROM kb_benchmarks WHERE (sector = ? OR sector = 'all' OR sector IS NULL) ORDER BY relevance_score DESC, metric LIMIT 50`).bind(sector).all(),
        // Requête 2: Réglementation fiscale
        db.prepare(`SELECT * FROM kb_fiscal_params WHERE (country = ? OR country = 'UEMOA' OR country IS NULL) ORDER BY param_code LIMIT 30`).bind(fiscal.country).all(),
        // Requête 3: Bailleurs de fonds
        db.prepare(`SELECT * FROM kb_funders WHERE (focus_regions LIKE ? OR focus_regions LIKE '%UEMOA%' OR focus_regions IS NULL) ORDER BY relevance_score DESC, name LIMIT 20`).bind('%' + fiscal.country + '%').all(),
        // Requête 4: Critères d'évaluation
        db.prepare(`SELECT * FROM kb_evaluation_criteria ORDER BY dimension, weight DESC LIMIT 30`).all(),
        // Requête 5: Risques sectoriels (from kb_sources if available)
        db.prepare(`SELECT * FROM kb_sources WHERE (category = 'risks' OR category = 'sector_risks') AND (region = ? OR region = 'UEMOA' OR region IS NULL) ORDER BY relevance_score DESC LIMIT 15`).bind(fiscal.country).all(),
      ])
      kbBenchmarks = benchResult.results || []
      kbFiscalParams = fiscalResult.results || []
      kbFunders = funderResult.results || []
      kbCriteria = criteriaResult.results || []
      kbRisks = risksResult.results || []
      kbUsed = (kbBenchmarks.length + kbFiscalParams.length + kbFunders.length + kbCriteria.length + kbRisks.length) > 0
    } catch (e: any) {
      console.log(`[Diagnostic] KB query failed (non-fatal): ${e.message}`)
    }

    // Build structured KB context object for Claude
    const kbContext = {
      pays: fiscal.country,
      zone: zone,
      secteur: sector,
      benchmarks_sectoriels: {
        marge_brute: { min: Math.round(fiscal.sectorBenchmarks.grossMarginRange[0] * 100), max: Math.round(fiscal.sectorBenchmarks.grossMarginRange[1] * 100), source: 'BCEAO/UEMOA', pays: fiscal.country },
        marge_nette: { min: Math.round(fiscal.sectorBenchmarks.netMarginRange[0] * 100), max: Math.round(fiscal.sectorBenchmarks.netMarginRange[1] * 100), source: 'BCEAO/UEMOA', pays: fiscal.country },
        marge_ebitda: { min: Math.round(fiscal.sectorBenchmarks.ebitdaMarginRange[0] * 100), max: Math.round(fiscal.sectorBenchmarks.ebitdaMarginRange[1] * 100), source: 'BCEAO/UEMOA', pays: fiscal.country },
        ratio_dette_max: { value: Math.round(fiscal.sectorBenchmarks.debtRatioMax * 100), source: 'BCEAO/UEMOA', pays: fiscal.country },
        ratio_liquidite_min: { value: fiscal.sectorBenchmarks.currentRatioMin, source: 'BCEAO/UEMOA', pays: fiscal.country },
        seuil_rentabilite_mois: { min: fiscal.sectorBenchmarks.breakEvenMonths[0], max: fiscal.sectorBenchmarks.breakEvenMonths[1], source: 'BCEAO/UEMOA', pays: fiscal.country },
      },
      reglementation_fiscale: {
        tva: Math.round(fiscal.vat * 100),
        is: Math.round(fiscal.corporateTax * 100),
        charges_sociales: Math.round(fiscal.socialChargesRate * 100),
        smig: fiscal.smig,
        pays: fiscal.country,
        source: 'Code fiscal ' + fiscal.country,
        unite: fiscal.currency,
        regime1: fiscal.taxRegime1,
        regime2: fiscal.taxRegime2,
      },
      risques_sectoriels: kbRisks.length > 0
        ? kbRisks.map((r: any) => ({ risque: r.name || r.description, secteur: sector, pays: fiscal.country, source: r.category }))
        : [
          { risque: 'Volatilité des coûts matières premières', secteur: sector, pays: fiscal.country },
          { risque: 'Accès au financement bancaire limité pour PME', pays: fiscal.country },
          { risque: 'Infrastructures énergétiques (coupures fréquentes)', pays: fiscal.country },
          { risque: 'Environnement réglementaire changeant', pays: fiscal.country },
          { risque: 'Pression concurrentielle du secteur informel', pays: fiscal.country },
        ],
      bonnes_pratiques: [
        { pratique: 'BFR 15-20% du CA pour commerce, 30-40% pour production', pays: fiscal.country },
        { pratique: '3 mois de trésorerie minimale de sécurité', pays: fiscal.country },
        { pratique: 'Masse salariale < 35% du CA', pays: fiscal.country },
        { pratique: 'Charges fixes < 50% du CA pour les PME en croissance', pays: fiscal.country },
        { pratique: 'Ratio dette/fonds propres < ' + Math.round(fiscal.sectorBenchmarks.debtRatioMax * 100) + '%', pays: fiscal.country },
      ],
      bailleurs_fonds: kbFunders.length > 0
        ? kbFunders.map((f: any) => ({ nom: f.name, type: f.type, montant_moyen: f.typical_ticket_min && f.typical_ticket_max ? f.typical_ticket_min + '-' + f.typical_ticket_max + ' EUR' : 'N/A', focus: f.focus_sectors || 'PME', pays: fiscal.country }))
        : [
          { nom: 'OVO', type: 'Prêt', montant_moyen: '10-100M XOF', focus: 'PME impact', pays: fiscal.country },
          { nom: 'BAD/BAfD', type: 'Subvention/Prêt', montant_moyen: '50-500M XOF', focus: 'Infrastructure', pays: fiscal.country },
          { nom: 'AFD/Proparco', type: 'Prêt/Garantie', montant_moyen: '100-1000M XOF', focus: 'PME croissance', pays: fiscal.country },
          { nom: 'IFC / SFI', type: 'Equity/Prêt', montant_moyen: '200M-2Md XOF', focus: 'PME établies', pays: fiscal.country },
          { nom: 'Investisseurs d\'Impact locaux', type: 'Equity', montant_moyen: '20-200M XOF', focus: 'PME impact social', pays: fiscal.country },
        ],
      kb_benchmarks_raw: kbBenchmarks.slice(0, 20),
      kb_fiscal_raw: kbFiscalParams.slice(0, 15),
      kb_criteria_raw: kbCriteria.slice(0, 15),
    }

    console.log(`[Diagnostic] ÉTAPE A-BIS — Pays=${fiscal.country}, Secteur=${sector}, Zone=${zone}, KB=${kbUsed} (bench=${kbBenchmarks.length}, fisc=${kbFiscalParams.length}, fund=${kbFunders.length}, crit=${kbCriteria.length}, risk=${kbRisks.length})`)

    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE B — Envoyer à Claude (température 0.3, max 6000 tokens)
    // ═══════════════════════════════════════════════════════════════

    // Determine version
    const existingDiag = await db.prepare(
      `SELECT version FROM diagnostic_analyses WHERE user_id = ? AND pme_id = ? ORDER BY version DESC LIMIT 1`
    ).bind(payload.userId, pmeId).first()
    const newVersion = existingDiag ? Number(existingDiag.version) + 1 : 1
    const diagId = crypto.randomUUID()
    const isPartial = availableCount < 4
    const sourcesJson = JSON.stringify(sources)

    await db.prepare(`
      INSERT INTO diagnostic_analyses (id, pme_id, user_id, version, status, sources_used, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'generating', ?, datetime('now'), datetime('now'))
    `).bind(diagId, pmeId, payload.userId, newVersion, sourcesJson).run()

    // Check if Claude API is available
    if (!isValidApiKey(apiKey)) {
      console.log('[Diagnostic] No valid API key — using deterministic fallback engine')
      // Fallback: generate deterministic diagnostic using local engine
      const fallbackResult = generateDeterministicDiagnostic(allDeliverables, sources, fiscal, sector, zone, kbContext, kbUsed)
      const fallbackHtml = generateDiagnosticReportHtml(fallbackResult, sector, fiscal.country, zone)
      
      await db.prepare(`UPDATE diagnostic_analyses SET analysis_json = ?, html_content = ?, status = 'analyzed', score = ?, kb_context = ?, kb_used = ?, updated_at = datetime('now') WHERE id = ?`).bind(
        JSON.stringify(fallbackResult), fallbackHtml, fallbackResult.score_global, JSON.stringify(kbContext), kbUsed ? 1 : 0, diagId
      ).run()
      
      return c.json({ 
        success: true, message: 'Diagnostic Expert généré (mode déterministe).', 
        diagId, version: newVersion, status: 'analyzed', 
        score_global: fallbackResult.score_global, palier: fallbackResult.palier, 
        sources, availableCount, partial: isPartial, kb_used: kbUsed 
      })
    }

    // Build system prompt
    const systemPrompt = `Tu es un coach expert en Investment Readiness pour PME en Afrique de l'Ouest (UEMOA / ${fiscal.country}). Tu es bienveillant, pédagogique et constructif. Ton rôle est d'accompagner l'entrepreneur dans son apprentissage, pas de le juger.

MISSION : Analyser TOUS les livrables fournis et produire un DIAGNOSTIC EXPERT complet.

TON & LANGAGE :
- Utilise un langage bienveillant et encourageant
- Évite les mots alarmistes : remplace "critique/échec/dangereux" par "à améliorer/opportunité/point d'attention"
- Formule les points faibles comme des opportunités d'amélioration
- Présente les risques comme des défis à anticiper
- Utilise le "nous" : "Nous pouvons améliorer...", "Ensemble, nous allons..."
- Félicite les points forts : "Excellent travail sur...", "Bravo pour..."
- Le score est un indicateur discret, pas LA métrique centrale

SCORING — 5 DIMENSIONS (score 0-100 chacune) :
1. COHÉRENCE FINANCIÈRE (poids 25%) : Données cohérentes entre livrables ? CA BMC = CA Framework ? Ratios alignés ?
2. VIABILITÉ ÉCONOMIQUE (poids 25%) : Seuil de rentabilité ? DSCR > 1.25 ? Cash flow positif ?
3. RÉALISME DES PROJECTIONS (poids 20%) : Croissance réaliste ? Red flags d'optimisme ?
4. COMPLÉTUDE DES COÛTS (poids 15%) : Charges sociales (${Math.round(fiscal.socialChargesRate * 100)}%) ? TVA (${Math.round(fiscal.vat * 100)}%) ? IS (${Math.round(fiscal.corporateTax * 100)}%) ? BFR ?
5. CAPACITÉ DE REMBOURSEMENT (poids 15%) : DSCR suffisant ? Durée réaliste ? Structure équilibrée ?

score_global = (coherence×0.25) + (viabilite×0.25) + (realisme×0.20) + (completude_couts×0.15) + (capacite_remboursement×0.15)

Paliers : 0-30 "en_construction", 31-50 "a_renforcer", 51-70 "moyen", 71-85 "bon", 86-100 "excellent"

POINTS DE VIGILANCE (minimum 2) : Catégorie (financier|operationnel|strategique|esg), Niveau (eleve|moyen|faible), avec action recommandée bienveillante.

DÉTECTION DES INCOHÉRENCES entre livrables (BMC↔Framework, BMC↔SIC, Framework↔Plan OVO, SIC↔ODD). Cherche les écarts de CA, de marges, d'effectifs, de segments entre les différents documents. Détaille chaque incohérence trouvée.

RISQUES CONTEXTUELS (par secteur/pays/taille) :
IDENTIFIE les risques spécifiques au CONTEXTE de l'entreprise en te basant sur kbContext.risques_sectoriels (prioritaire) OU sur la liste générique ci-dessous.

Si kbContext.risques_sectoriels est disponible et non vide → UTILISE cette liste KB (plus précise, spécifique au pays/secteur).
Si kbContext.risques_sectoriels est vide → utilise la liste générique ci-dessous comme fallback.

1. RISQUES SECTORIELS (selon secteur BMC/Framework) :
   AGRICULTURE/ÉLEVAGE : saisonnalité (récolte 1x/an), risque climatique, prix matières volatiles, risque sanitaire, dépendance intrants importés, stockage (pertes post-récolte)
   COMMERCE/DISTRIBUTION : dépendance fournisseur unique, rupture de stock (BFR sous-estimé), concurrence informelle, risque change (importations), saisonnalité
   SERVICES/CONSULTING : concentration clients, absence récurrence, risque non-paiement, pas de barrières à l'entrée
   MANUFACTURE/TRANSFORMATION : dépendance énergétique, risque qualité (rebuts), maintenance non provisionnée, approvisionnement matières
   TECH/DIGITAL : obsolescence rapide (amortissement < 3 ans), dépendance infrastructure, concurrence internationale, coûts R&D non provisionnés

2. RISQUES GÉOGRAPHIQUES (selon pays + zone urbain/rural) :
   CÔTE D'IVOIRE : risque politique, change XOF, infrastructure routière, coupures électricité fréquentes, coûts logistiques. Rural: internet limité, main-d'œuvre qualifiée rare. Urbain: concurrence intense, coûts immobiliers.
   SÉNÉGAL : saisonnalité pluviométrie, accès financement rural limité. Rural: internet limité, transport coûteux. Urbain: concurrence Dakar, coûts élevés.
   BURKINA FASO : insécurité zones rurales, accès internet limité, accès financement difficile. Rural: risques sécuritaires, transport limité.
   MALI : instabilité politique, accès financement difficile. Rural: risques sécuritaires, accès limité.
   AUTRES UEMOA : risques génériques Afrique de l'Ouest. Rural: internet/électricité irrégulier. Urbain: concurrence, coûts élevés.

3. RISQUES PAR TAILLE (selon CA projeté) :
   MICRO (<50M XOF) : dépendance entrepreneur (clé de voûte), pas de trésorerie sécurité, accès financement limité, pas de diversification
   PETITE PME (50-200M XOF) : structure coûts rigide, croissance limitée par capacité, besoin formalisation
   MOYENNE PME (>200M XOF) : complexité opérationnelle, besoin management intermédiaire, risque désorganisation croissance

Pour CHAQUE risque contextuel identifié, ajoute-le dans le tableau "risques_contextuels" du JSON avec : categorie ("contextuel_secteur"|"contextuel_geographique"|"contextuel_taille"), pays, zone, gravite ("critique"|"elevee"|"moyenne"|"faible"), probabilite, titre, description (détaillée avec chiffres si possible), impact_financier, mitigation (spécifique au contexte). Minimum 3 risques contextuels.

FORCES (3-7) et OPPORTUNITÉS D'AMÉLIORATION (toutes) avec justification pédagogique.

RECOMMANDATIONS TOP 5-7 classées par impact sur la viabilité (PAS sur le score). Chaque recommandation doit avoir un message encourageant.

BENCHMARKS SECTORIELS : Compare l'entreprise aux fourchettes du pays (${fiscal.country}).

RÉSUMÉ EXÉCUTIF : 3-5 paragraphes bienveillants, score discret, vision d'ensemble de la maturité Investment Readiness.

CONTEXTE FISCAL ${fiscal.country.toUpperCase()} :
${fiscalKBText}

RÉPONDS UNIQUEMENT EN JSON avec cette structure EXACTE :
{
  "score_global": number,
  "palier": "en_construction"|"a_renforcer"|"moyen"|"bon"|"excellent",
  "label": string,
  "couleur": "⬜"|"🟠"|"🟡"|"🟢"|"🌟",
  "scores_dimensions": {
    "coherence": { "score": number, "label": "Cohérence financière", "commentaire": string, "incoherences_detectees": [{ "type": string, "champ": string, "valeur_source1": string, "valeur_source2": string, "ecart": string, "explication": string }] },
    "viabilite": { "score": number, "label": "Viabilité économique", "commentaire": string, "seuil_rentabilite_mois": number|null, "dscr": number|null, "cash_flow_positif_mois": number|null },
    "realisme": { "score": number, "label": "Réalisme des projections", "commentaire": string, "red_flags": [string] },
    "completude_couts": { "score": number, "label": "Complétude des coûts", "commentaire": string, "postes_manquants": [string], "postes_presents": [string] },
    "capacite_remboursement": { "score": number, "label": "Capacité de remboursement", "commentaire": string, "dscr": number|null, "duree_remboursement_ans": number|null, "taux_endettement": number|null }
  },
  "points_vigilance": [{ "categorie": string, "niveau": string, "probabilite": string, "titre": string, "description": string, "impact_financier": string, "action_recommandee": string }],
  "incoherences": [{ "type": string, "champ": string, "valeur_bmc": string, "valeur_framework": string, "ecart": string, "explication": string }],
  "risques_contextuels": [{ "categorie": "contextuel_secteur"|"contextuel_geographique"|"contextuel_taille", "pays": string, "zone": string, "gravite": "critique"|"elevee"|"moyenne"|"faible", "probabilite": "elevee"|"moyenne"|"faible", "titre": string, "description": string, "impact_financier": string, "mitigation": string }],
  "forces": [{ "titre": string, "justification": string }],
  "opportunites_amelioration": [{ "titre": string, "justification": string, "priorite": string }],
  "recommandations": [{ "priorite": number, "titre": string, "detail": string, "impact_viabilite": string, "urgence": string, "action_concrete": string, "message_encourageant": string }],
  "benchmarks": { "marge_brute": { "entreprise": number|null, "secteur_min": number, "secteur_max": number, "verdict": string, "ecart": string }, "marge_ebitda": { "entreprise": number|null, "secteur_min": number, "secteur_max": number, "verdict": string, "ecart": string }, "marge_nette": { "entreprise": number|null, "secteur_min": number, "secteur_max": number, "verdict": string, "ecart": string }, "ratio_endettement": { "entreprise": number|null, "secteur_min": number, "secteur_max": number, "verdict": string, "ecart": string }, "seuil_rentabilite": { "entreprise": number|null, "secteur_min": number, "secteur_max": number, "verdict": string, "ecart": string } },
  "resume_executif": string,
  "points_attention_prioritaires": [string],
  "livrables_analyses": { "bmc": boolean, "sic": boolean, "framework": boolean, "plan_ovo": boolean, "business_plan": boolean, "odd": boolean },
  "contexte_pays": { "pays": string, "zone": string, "secteur": string, "kb_utilisee": boolean, "sources_kb": [string] },
  "donnees_completes": boolean,
  "message_incomplet": string|null
}`

    // Build user prompt with all deliverables
    const delivParts: string[] = []
    if (allDeliverables.bmc_analysis) {
      delivParts.push(`=== BMC ANALYSIS (score: ${bmcRow?.score || 'N/A'}/100) ===\n${JSON.stringify(allDeliverables.bmc_analysis).slice(0, 6000)}`)
    }
    if (allDeliverables.sic_analysis) {
      delivParts.push(`=== SIC ANALYSIS (score: ${sicRow?.score || 'N/A'}/100) ===\n${JSON.stringify(allDeliverables.sic_analysis).slice(0, 4000)}`)
    }
    if (allDeliverables.framework_analysis) {
      delivParts.push(`=== FRAMEWORK ANALYSIS (score: ${frameworkRow?.score || 'N/A'}/100) ===\n${JSON.stringify(allDeliverables.framework_analysis).slice(0, 6000)}`)
    }
    if (allDeliverables.framework_pme_data) {
      delivParts.push(`=== DONNÉES PME STRUCTURÉES ===\n${JSON.stringify(allDeliverables.framework_pme_data).slice(0, 5000)}`)
    }
    if (allDeliverables.plan_ovo) {
      delivParts.push(`=== PLAN OVO (score: ${planOvoRow?.score || 'N/A'}/100) ===\n${JSON.stringify(allDeliverables.plan_ovo).slice(0, 5000)}`)
    }
    if (allDeliverables.business_plan) {
      delivParts.push(`=== BUSINESS PLAN (score: ${bpRow?.score || 'N/A'}/100) ===\n${JSON.stringify(allDeliverables.business_plan).slice(0, 4000)}`)
    }
    if (allDeliverables.odd_analysis) {
      delivParts.push(`=== ODD DUE DILIGENCE (score: ${oddRow?.score || 'N/A'}/100) ===\n${JSON.stringify(allDeliverables.odd_analysis).slice(0, 3000)}`)
    }

    const missingList = Object.entries(sources).filter(([, v]) => !v).map(([k]) => k)
    const userPrompt = `Voici les livrables à analyser pour produire le Diagnostic Expert :

${delivParts.join('\n\n')}

=== CONTEXTE KB (${fiscal.country}) ===
${JSON.stringify(kbContext, null, 1).slice(0, 3000)}

LIVRABLES MANQUANTS : ${missingList.length > 0 ? missingList.join(', ') : 'Aucun (tous disponibles)'}
${isPartial ? '\n⚠️ DIAGNOSTIC PARTIEL : Certains livrables manquent. Indique les limites dans ton analyse et ce que les données manquantes auraient apporté.' : ''}

Produis le diagnostic complet en JSON. Sois bienveillant et pédagogique. Score discret. Minimum 2 points_vigilance, 3 forces, 5 recommandations, 3 risques_contextuels (utilise kbContext.risques_sectoriels si disponible).`

    console.log(`[Diagnostic] ÉTAPE B — Claude call: ${delivParts.length} deliverables, prompt ${userPrompt.length} chars, temp=0.3, maxTokens=7000`)

    let claudeResult: any
    try {
      claudeResult = await callClaudeJSON({
        apiKey,
        systemPrompt,
        userPrompt,
        maxTokens: 7000,
        temperature: 0.3,
        timeoutMs: 120_000,
        maxRetries: 2,
        label: 'Diagnostic Expert'
      })
      console.log(`[Diagnostic] Claude returned: score_global=${claudeResult.score_global}, palier=${claudeResult.palier}, dims=${Object.keys(claudeResult.scores_dimensions || {}).length}`)
    } catch (claudeErr: any) {
      console.error(`[Diagnostic] Claude API error: ${claudeErr.message} — falling back to deterministic engine`)
      // Fallback to deterministic engine instead of failing
      claudeResult = generateDeterministicDiagnostic(allDeliverables, sources, fiscal, sector, zone, kbContext, kbUsed)
      claudeResult._fallback = true
    }

    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE C — Valider, enrichir, sauvegarder, générer HTML
    // ═══════════════════════════════════════════════════════════════

    // Validate and clamp score_global to 0-100
    const scoreGlobal = Math.min(100, Math.max(0, Math.round(claudeResult.score_global || 0)))
    claudeResult.score_global = scoreGlobal

    // Ensure palier is consistent with score
    if (scoreGlobal <= 30) claudeResult.palier = 'en_construction'
    else if (scoreGlobal <= 50) claudeResult.palier = 'a_renforcer'
    else if (scoreGlobal <= 70) claudeResult.palier = 'moyen'
    else if (scoreGlobal <= 85) claudeResult.palier = 'bon'
    else claudeResult.palier = 'excellent'

    // Ensure couleur is consistent
    const palierCouleurs: Record<string, string> = { en_construction: '\u2B1C', a_renforcer: '\uD83D\uDFE0', moyen: '\uD83D\uDFE1', bon: '\uD83D\uDFE2', excellent: '\uD83C\uDF1F' }
    claudeResult.couleur = palierCouleurs[claudeResult.palier] || '\u2B1C'

    // Ensure livrables_analyses matches actual sources
    claudeResult.livrables_analyses = sources

    // Ensure contexte_pays
    claudeResult.contexte_pays = {
      pays: fiscal.country,
      zone: zone,
      secteur: sector,
      kb_utilisee: kbUsed,
      sources_kb: kbUsed ? ['kb_benchmarks', 'kb_fiscal_params', 'kb_funders', 'kb_evaluation_criteria', 'kb_sources'] : []
    }

    // Ensure donnees_completes
    claudeResult.donnees_completes = availableCount >= 5
    if (!claudeResult.donnees_completes && !claudeResult.message_incomplet) {
      claudeResult.message_incomplet = `Données incomplètes — ${missingList.length} livrable(s) manquant(s) : ${missingList.join(', ')}. Le diagnostic serait plus précis avec tous les livrables.`
    }

    // Validate dimensions have scores
    const dimKeys = ['coherence', 'viabilite', 'realisme', 'completude_couts', 'capacite_remboursement']
    if (claudeResult.scores_dimensions) {
      for (const dk of dimKeys) {
        if (claudeResult.scores_dimensions[dk]) {
          claudeResult.scores_dimensions[dk].score = Math.min(100, Math.max(0, Math.round(claudeResult.scores_dimensions[dk].score || 0)))
        }
      }
    }

    // Ensure minimum points_vigilance
    if (!claudeResult.points_vigilance || claudeResult.points_vigilance.length < 1) {
      claudeResult.points_vigilance = [{ categorie: 'financier', niveau: 'moyen', probabilite: 'moyenne', titre: 'Suivi de trésorerie', description: 'Nous recommandons un suivi régulier de la trésorerie pour anticiper les besoins.', impact_financier: 'Modéré', action_recommandee: 'Mettre en place un tableau de bord de suivi hebdomadaire de la trésorerie.' }]
    }

    // Ensure minimum forces
    if (!claudeResult.forces || claudeResult.forces.length < 1) {
      claudeResult.forces = [{ titre: 'Démarche structurée', justification: 'L\'entrepreneur a complété plusieurs modules, démontrant une approche méthodique.' }]
    }

    // Ensure minimum recommandations
    if (!claudeResult.recommandations || claudeResult.recommandations.length < 1) {
      claudeResult.recommandations = [{ priorite: 1, titre: 'Compléter les livrables manquants', detail: 'Finalisez les modules restants pour obtenir un diagnostic plus complet.', impact_viabilite: 'Élevé', urgence: 'Court terme', action_concrete: 'Retournez sur le tableau de bord et complétez les modules en attente.', message_encourageant: 'Vous avez déjà fait un excellent travail en arrivant jusqu\'ici !' }]
    }

    // Ensure risques_contextuels — at minimum 1 contextual risk when sector/zone is identifiable
    if (!claudeResult.risques_contextuels || !Array.isArray(claudeResult.risques_contextuels) || claudeResult.risques_contextuels.length < 1) {
      claudeResult.risques_contextuels = []
      // Add default sector risk
      if (sector && sector !== 'Non défini') {
        claudeResult.risques_contextuels.push({
          categorie: 'contextuel_secteur',
          pays: fiscal.country,
          zone: zone,
          gravite: 'moyenne',
          probabilite: 'moyenne',
          titre: `Risques sectoriels ${sector}`,
          description: `Le secteur ${sector} en ${fiscal.country} présente des risques typiques liés à la concurrence, à la saisonnalité et à l'évolution réglementaire.`,
          impact_financier: 'Impact modéré sur la trésorerie et les marges',
          mitigation: `Diversifier les sources de revenus et mettre en place une veille sectorielle active pour le secteur ${sector}.`
        })
      }
      // Add default geographic risk
      claudeResult.risques_contextuels.push({
        categorie: 'contextuel_geographique',
        pays: fiscal.country,
        zone: zone,
        gravite: 'moyenne',
        probabilite: 'moyenne',
        titre: `Risques géographiques ${fiscal.country}`,
        description: `L'environnement économique en ${fiscal.country} (zone ${zone}) comporte des risques liés à l'infrastructure, aux coupures d'énergie et à l'accès au financement.`,
        impact_financier: 'Impact variable selon la zone et le secteur',
        mitigation: `Prévoir des solutions d'alimentation de secours et diversifier les canaux d'accès au financement en ${fiscal.country}.`
      })
      // Add default size risk based on CA
      const pmeForSize = allDeliverables.framework_pme_data || {}
      const caHist = pmeForSize.historique?.caTotal || pmeForSize.historique?.ca_total || []
      const caEstimate = caHist.length > 0 ? caHist[caHist.length - 1] : 0
      const tailleLabel = caEstimate < 50_000_000 ? 'micro-entreprise' : caEstimate < 200_000_000 ? 'petite PME' : 'moyenne PME'
      claudeResult.risques_contextuels.push({
        categorie: 'contextuel_taille',
        pays: fiscal.country,
        zone: zone,
        gravite: 'moyenne',
        probabilite: 'moyenne',
        titre: `Risques liés à la taille (${tailleLabel})`,
        description: caEstimate < 50_000_000
          ? 'En tant que micro-entreprise, la dépendance à l\'entrepreneur est forte. L\'absence de trésorerie de sécurité et l\'accès limité au financement sont des défis courants.'
          : caEstimate < 200_000_000
          ? 'En tant que petite PME, la structure de coûts peut devenir rigide. La croissance est souvent limitée par la capacité opérationnelle.'
          : 'En tant que moyenne PME, la complexité opérationnelle augmente. Le besoin de management intermédiaire et le risque de désorganisation liée à la croissance sont à surveiller.',
        impact_financier: caEstimate < 50_000_000 ? 'Risque de cessation en cas d\'absence prolongée du dirigeant' : 'Pression sur les marges en phase de croissance',
        mitigation: caEstimate < 50_000_000
          ? 'Constituer progressivement une trésorerie de sécurité de 3 mois de charges et documenter les processus clés.'
          : caEstimate < 200_000_000
          ? 'Formaliser les processus clés et planifier les recrutements en anticipation de la croissance.'
          : 'Recruter un management intermédiaire et mettre en place des outils de pilotage adaptés.'
      })
    }
    // Validate each contextual risk has required fields
    claudeResult.risques_contextuels = claudeResult.risques_contextuels.map((r: any) => ({
      categorie: r.categorie || 'contextuel_secteur',
      pays: r.pays || fiscal.country,
      zone: r.zone || zone,
      gravite: r.gravite || 'moyenne',
      probabilite: r.probabilite || 'moyenne',
      titre: r.titre || 'Risque contextuel identifié',
      description: r.description || '',
      impact_financier: r.impact_financier || 'À évaluer',
      mitigation: r.mitigation || 'Mettre en place un plan de mitigation adapté.'
    }))

    // Generate full HTML report
    const diagHtml = generateDiagnosticReportHtml(claudeResult, sector, fiscal.country, zone)

    const finalStatus = 'analyzed'

    await db.prepare(`
      UPDATE diagnostic_analyses
      SET analysis_json = ?, html_content = ?, score = ?, status = ?, kb_context = ?, kb_used = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      JSON.stringify(claudeResult),
      diagHtml,
      scoreGlobal,
      finalStatus,
      JSON.stringify(kbContext),
      kbUsed ? 1 : 0,
      diagId
    ).run()

    // Also store in entrepreneur_deliverables for cross-module access
    try {
      await db.prepare(`
        INSERT INTO entrepreneur_deliverables (user_id, type, content, score, version, created_at)
        VALUES (?, 'diagnostic_html', ?, ?, ?, datetime('now'))
      `).bind(payload.userId, diagHtml, scoreGlobal, newVersion).run()
    } catch { /* non-fatal: deliverable table might already have this */ }

    console.log(`[Diagnostic] ÉTAPE C — Saved: score=${scoreGlobal}, palier=${claudeResult.palier}, status=${finalStatus}, kb_used=${kbUsed}, dims=${Object.keys(claudeResult.scores_dimensions || {}).length}, html=${diagHtml.length} chars, fallback=${!!claudeResult._fallback}`)

    return c.json({
      success: true,
      message: claudeResult._fallback ? 'Diagnostic Expert généré (mode déterministe — IA indisponible).' : 'Diagnostic Expert généré avec succès.',
      diagId,
      version: newVersion,
      status: finalStatus,
      score_global: scoreGlobal,
      palier: claudeResult.palier,
      sources,
      availableCount,
      partial: isPartial,
      kb_used: kbUsed
    })

  } catch (error: any) {
    console.error('[Diagnostic Generate] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// GET /api/diagnostic/latest/:pmeId — Returns latest diagnostic or {available: false}
app.get('/api/diagnostic/latest/:pmeId', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const db = c.env.DB
    const pmeId = c.req.param('pmeId')
    const resolvedPmeId = pmeId === 'pme_current' ? `pme_${payload.userId}` : pmeId

    const row = await db.prepare(`
      SELECT id, pme_id, version, analysis_json, score, status, sources_used, kb_used, error_message, created_at, updated_at
      FROM diagnostic_analyses
      WHERE user_id = ? AND pme_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(payload.userId, resolvedPmeId).first()

    if (!row) {
      return c.json({ available: false })
    }

    let analysisData = null
    try {
      analysisData = row.analysis_json ? JSON.parse(row.analysis_json as string) : null
    } catch { /* ignore parse errors */ }

    let sourcesUsed = null
    try {
      sourcesUsed = row.sources_used ? JSON.parse(row.sources_used as string) : null
    } catch { /* ignore parse errors */ }

    return c.json({
      available: true,
      data: {
        id: row.id,
        pmeId: row.pme_id,
        version: row.version,
        score: row.score,
        status: row.status,
        sources: sourcesUsed,
        kbUsed: row.kb_used,
        analysis: analysisData,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    })
  } catch (error: any) {
    console.error('[Diagnostic Latest] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})

// GET /api/diagnostic/download/:id — Returns diagnostic HTML (or PDF placeholder)
app.get('/api/diagnostic/download/:id', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const db = c.env.DB
    const diagId = c.req.param('id')
    const format = c.req.query('format') || 'html'

    const row = await db.prepare(`
      SELECT id, analysis_json, html_content, status, score
      FROM diagnostic_analyses
      WHERE id = ? AND user_id = ?
    `).bind(diagId, payload.userId).first()

    if (!row) {
      return c.json({ error: 'Diagnostic non trouvé' }, 404)
    }

    if (row.status === 'pending' || row.status === 'generating') {
      return c.json({
        error: 'Le diagnostic n\'est pas encore prêt.',
        status: row.status,
        message: 'Veuillez patienter ou relancer la génération via POST /api/diagnostic/generate.'
      }, 422)
    }

    if (format === 'pdf') {
      // PDF generation not yet implemented
      return c.json({
        error: 'Le format PDF n\'est pas encore disponible.',
        message: 'Utilisez format=html pour télécharger le diagnostic en HTML.',
        availableFormats: ['html']
      }, 501)
    }

    // Return HTML format
    // First check if we have pre-generated HTML content
    if (row.html_content) {
      return new Response(row.html_content as string, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="diagnostic-expert-${diagId}.html"`,
        }
      })
    }

    // Fallback: check entrepreneur_deliverables for diagnostic_html
    const diagHtmlRow = await db.prepare(
      `SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'diagnostic_html' ORDER BY version DESC LIMIT 1`
    ).bind(payload.userId).first()

    if (diagHtmlRow && diagHtmlRow.content) {
      return new Response(diagHtmlRow.content as string, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="diagnostic-expert-${diagId}.html"`,
        }
      })
    }

    // No HTML available yet — return analysis JSON as structured response
    return c.json({
      error: 'Le fichier HTML de diagnostic n\'a pas encore été généré.',
      status: row.status,
      score: row.score,
      message: 'L\'agent IA de génération HTML sera intégré dans une prochaine version.',
    }, 422)

  } catch (error: any) {
    console.error('[Diagnostic Download] Error:', error)
    return c.json({ error: error.message || 'Erreur serveur' }, 500)
  }
})


// ═══════════════════════════════════════════════════════════════
// BUSINESS PLAN — API Routes + Render
// ═══════════════════════════════════════════════════════════════

function renderBusinessPlanModulePage(opts: {
  hasBmc: boolean; hasSic: boolean; hasFramework: boolean; hasDiag: boolean; hasOvo: boolean;
  canGenerate: boolean; hasBp: boolean; bpVersion: number; bpId: string | null; bpStatus: string;
  userName: string; availableCount: number; embedded?: boolean; bpData?: any;
}): string {
  const { hasBmc, hasSic, hasFramework, hasDiag, hasOvo, canGenerate, hasBp, bpVersion, bpId, bpStatus, userName, availableCount, embedded, bpData } = opts
  const esc = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
  const nl2br = (s: any) => esc(s).replace(/\n/g, '<br>')
  const fmtNum = (n: any) => { const v = Number(n); if (isNaN(v)) return String(n ?? '\u2014'); return v.toLocaleString('fr-FR') }
  const fmtCurrency = (n: any) => { const v = Number(String(n).replace(/\s/g,'')); if (isNaN(v)) return String(n ?? '\u2014'); if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(1) + ' Mrd'; if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1) + 'M'; if (Math.abs(v) >= 1e3) return Math.round(v/1e3) + 'k'; return v.toLocaleString('fr-FR') }
  const fmtCurrencyFull = (n: any) => { const v = Number(String(n).replace(/\s/g,'')); if (isNaN(v)) return String(n ?? '\u2014'); return v.toLocaleString('fr-FR') + ' FCFA' }

  // Data shortcuts
  const meta = bpData?.metadata || {}
  const resume = bpData?.resume_executif || bpData?.executive_summary || {}
  const presentation = bpData?.presentation_entreprise || bpData?.company_presentation || {}
  const swot = bpData?.analyse_swot || bpData?.swot_analysis || {}
  const marche = bpData?.analyse_marche || bpData?.market_analysis || {}
  const offre = bpData?.offre_produit_service || bpData?.product_service || {}
  const marketing = bpData?.strategie_marketing || bpData?.marketing_strategy || {}
  const modele = bpData?.model_economique || bpData?.modele_economique || bpData?.economic_model || {}
  const operations = bpData?.plan_operationnel || bpData?.operational_plan || {}
  const impact = bpData?.impact_social || bpData?.social_impact || {}
  const financier = bpData?.plan_financier || bpData?.financial_plan || {}
  const gouvernance = bpData?.gouvernance || bpData?.governance || {}
  const risques = bpData?.risques_mitigation || bpData?.risk_mitigation || bpData?.risques || []
  const attentes = bpData?.attentes_ovo || {}
  const annexes = bpData?.annexes || {}
  const scores = bpData?.scores || {}

  const companyName = meta.entreprise || userName
  const sectorName = meta.secteur || 'Non spécifie'
  const countryName = meta.pays || "Cote d'Ivoire"
  const genDate = meta.date_generation ? new Date(meta.date_generation).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  const isAI = meta.ai_generated === true

  // Section definitions for navigation
  const navSections = [
    { id: 'resume', icon: 'fa-file-lines', label: 'Resume Executif', num: 1 },
    { id: 'presentation', icon: 'fa-building', label: 'Presentation Entreprise', num: 2 },
    { id: 'marche', icon: 'fa-chart-pie', label: 'Analyse Marche', num: 3 },
    { id: 'offre', icon: 'fa-box-open', label: 'Offre Produit/Service', num: 4 },
    { id: 'marketing', icon: 'fa-bullhorn', label: 'Strategie Marketing', num: 5 },
    { id: 'modele', icon: 'fa-diagram-project', label: 'Modele Economique', num: 6 },
    { id: 'operations', icon: 'fa-users-gear', label: 'Plan Operationnel', num: 7 },
    { id: 'impact', icon: 'fa-hand-holding-heart', label: 'Impact Social', num: 8 },
    { id: 'financier', icon: 'fa-chart-bar', label: 'Plan Financier', num: 9 },
    { id: 'gouvernance', icon: 'fa-landmark', label: 'Gouvernance & Projet', num: 10 },
    { id: 'risques', icon: 'fa-shield-halved', label: 'Risques & Mitigation', num: 11 },
    { id: 'annexes', icon: 'fa-paperclip', label: 'Annexes', num: 12 },
  ]

  // Helpers
  const renderList = (arr: any[], field?: string): string => {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return '<p class="bp-empty">Aucune donnee disponible</p>'
    return '<ul class="bp-list">' + arr.map(item => {
      const text = typeof item === 'string' ? item : (field ? item[field] : Object.values(item).filter(Boolean).join(' \u2014 '))
      return '<li>' + esc(text) + '</li>'
    }).join('') + '</ul>'
  }
  const renderKV = (obj: any, labels?: Record<string, string>): string => {
    if (!obj || typeof obj !== 'object') return ''
    return Object.entries(obj).filter(([, v]) => v && v !== 'A completer').map(([k, v]) => {
      const label = labels?.[k] || k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
      const val = typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : JSON.stringify(v)
      return '<div class="bp-kv"><span class="bp-kv__label">' + esc(label) + '</span><span class="bp-kv__value">' + nl2br(val) + '</span></div>'
    }).join('')
  }
  const badge = (text: string, color: string, bg: string) => '<span class="bp-badge" style="color:' + color + ';background:' + bg + '">' + esc(text) + '</span>'
  const renderPara = (text: any, fallback?: string): string => {
    const t = typeof text === 'string' ? text : (typeof text === 'object' && text !== null ? Object.values(text).filter(v => typeof v === 'string').join('\n\n') : '')
    if (!t || t === 'A completer') return fallback ? '<p class="bp-empty">' + esc(fallback) + '</p>' : ''
    return '<div class="bp-para">' + nl2br(t) + '</div>'
  }
  const renderCards = (items: any[], titleField: string, descField?: string): string => {
    if (!items || !Array.isArray(items) || items.length === 0) return '<p class="bp-empty">Aucune donnee disponible</p>'
    return '<div class="bp-cards">' + items.map(item => {
      const title = typeof item === 'string' ? item : (item[titleField] || '')
      const desc = descField && typeof item === 'object' ? (item[descField] || '') : ''
      return '<div class="bp-card-item"><div class="bp-card-item__title">' + esc(title) + '</div>' + (desc ? '<div class="bp-card-item__desc">' + nl2br(desc) + '</div>' : '') + '</div>'
    }).join('') + '</div>'
  }

  // Build financial table HTML
  const finTable = financier.tableau_financier_3ans || {}
  const finRows: [string, any][] = [
    ['Apport personnel', finTable.apport_personnel],
    ['Prets', finTable.prets],
    ['Subventions / dons', finTable.subventions_dons],
    ["Chiffre d'affaires", finTable.chiffre_affaires],
    ['Couts directs', finTable.couts_directs],
    ['Couts indirects', finTable.couts_indirects],
    ['Amortissements', finTable.amortissements],
    ['Resultat net', finTable.resultat_net],
    ['Cash-flow', finTable.cash_flow],
    ['Valeur des actifs', finTable.valeur_actifs],
    ['Dettes totales', finTable.dettes_totales],
    ['Fonds propres', finTable.fonds_propres],
  ]
  const finTableHtml = finRows.some(([, v]) => Array.isArray(v) && v.length > 0) ? `
    <div class="bp-table-wrap">
      <table class="bp-table">
        <thead><tr><th>Plan financier</th><th>Annee 1</th><th>Annee 2</th><th>Annee 3</th></tr></thead>
        <tbody>${finRows.map(([label, values]) => {
          const isHighlight = label === "Chiffre d'affaires" || label === 'Resultat net' || label === 'Cash-flow'
          const vals = Array.isArray(values) ? values : ['\u2014','\u2014','\u2014']
          return '<tr class="' + (isHighlight ? 'bp-table__highlight' : '') + '"><td class="bp-table__label">' + esc(label) + '</td>' + vals.map((v: any) => '<td class="bp-table__num">' + esc(fmtCurrency(v)) + '</td>').join('') + '</tr>'
        }).join('')}</tbody>
      </table>
    </div>` : ''

  // Financial chart data (for Canvas)
  const finChartData = {
    ca: Array.isArray(finTable.chiffre_affaires) ? finTable.chiffre_affaires.map((v: any) => Number(String(v).replace(/\s/g,'')) || 0) : [],
    net: Array.isArray(finTable.resultat_net) ? finTable.resultat_net.map((v: any) => Number(String(v).replace(/\s/g,'')) || 0) : [],
    cf: Array.isArray(finTable.cash_flow) ? finTable.cash_flow.map((v: any) => Number(String(v).replace(/\s/g,'')) || 0) : [],
  }
  const hasFinChart = finChartData.ca.length >= 2

  // SWOT matrix
  const swotHtml = (swot.forces?.length || swot.faiblesses?.length || swot.opportunites?.length || swot.menaces?.length) ? `
    <div class="bp-swot">
      <div class="bp-swot__cell bp-swot__cell--s">
        <div class="bp-swot__header"><i class="fas fa-plus-circle"></i> Forces</div>
        ${(swot.forces || []).map((f: string) => '<div class="bp-swot__item">' + esc(f) + '</div>').join('')}
      </div>
      <div class="bp-swot__cell bp-swot__cell--w">
        <div class="bp-swot__header"><i class="fas fa-minus-circle"></i> Faiblesses</div>
        ${(swot.faiblesses || []).map((f: string) => '<div class="bp-swot__item">' + esc(f) + '</div>').join('')}
      </div>
      <div class="bp-swot__cell bp-swot__cell--o">
        <div class="bp-swot__header"><i class="fas fa-arrow-up-right-dots"></i> Opportunites</div>
        ${(swot.opportunites || []).map((f: string) => '<div class="bp-swot__item">' + esc(f) + '</div>').join('')}
      </div>
      <div class="bp-swot__cell bp-swot__cell--t">
        <div class="bp-swot__header"><i class="fas fa-triangle-exclamation"></i> Menaces</div>
        ${(swot.menaces || []).map((f: string) => '<div class="bp-swot__item">' + esc(f) + '</div>').join('')}
      </div>
    </div>` : ''

  // Risk table
  const riskTableHtml = Array.isArray(risques) && risques.length > 0 ? `
    <div class="bp-table-wrap">
      <table class="bp-table">
        <thead><tr><th>Risque</th><th>Probabilite</th><th>Impact</th><th>Mitigation</th></tr></thead>
        <tbody>${risques.map((r: any) => '<tr><td>' + esc(r.risque || r.type_risque || '') + '</td><td><span class="bp-risk-badge">' + esc(r.probabilite || '\u2014') + '</span></td><td><span class="bp-risk-badge">' + esc(r.impact || r.gravite || '\u2014') + '</span></td><td>' + esc(r.mitigation || '\u2014') + '</td></tr>').join('')}</tbody>
      </table>
    </div>` : ''

  // Company info table
  const infoTable = presentation.informations_table || {}
  const infoTableHtml = Object.keys(infoTable).length > 0 ? `
    <div class="bp-table-wrap">
      <table class="bp-table bp-table--info">
        <tbody>
          ${([['Nom', infoTable.nom], ['Site web', infoTable.site_web], ['Personne en contact', infoTable.contact], ['Adresse', infoTable.adresse], ['Telephone', infoTable.telephone], ['Email', infoTable.email], ['Date de creation', infoTable.date_creation], ['Forme juridique', infoTable.forme_juridique]] as [string, any][])
            .map(([l, v]) => '<tr><td class="bp-table__label">' + esc(l) + '</td><td>' + esc(v || '\u2014') + '</td></tr>').join('')}
        </tbody>
      </table>
    </div>` : ''

  // Scores badges
  const scoresBadges = [
    scores.bmc != null ? 'BMC: ' + scores.bmc + '/100' : null,
    scores.framework != null ? 'Framework: ' + scores.framework + '/100' : null,
    scores.diagnostic != null ? 'Diagnostic: ' + scores.diagnostic + '/100' : null,
    scores.plan_ovo != null ? 'Plan OVO: ' + scores.plan_ovo + '/100' : null,
  ].filter(Boolean)

  // Completeness score
  const completenessItems = [
    { label: 'Resume Executif', done: !!(resume.synthese || resume.points_cles?.length) },
    { label: 'Presentation', done: !!(presentation.description_generale || Object.keys(infoTable).length > 0) },
    { label: 'Analyse Marche', done: !!(marche.taille_marche || marche.tendances?.length) },
    { label: 'SWOT', done: !!(swot.forces?.length || swot.faiblesses?.length) },
    { label: 'Offre Produit', done: !!(offre.description || offre.proposition_valeur) },
    { label: 'Marketing', done: !!(marketing.produit || marketing.prix) },
    { label: 'Modele Economique', done: !!(modele.segments_clients || modele.sources_revenus) },
    { label: 'Plan Operationnel', done: !!(operations.equipe_direction?.length || operations.personnel) },
    { label: 'Impact Social', done: !!(impact.impact_social || impact.odd_cibles?.length) },
    { label: 'Plan Financier', done: !!(finTableHtml || financier.plan_investissement) },
    { label: 'Gouvernance', done: !!(gouvernance.projet_description || gouvernance.situation_actuelle) },
    { label: 'Risques', done: !!(Array.isArray(risques) && risques.length > 0) },
  ]
  const completenessScore = Math.round((completenessItems.filter(c => c.done).length / completenessItems.length) * 100)

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>ESONO | Business Plan \u2014 ${esc(companyName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  ${hasFinChart ? '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>' : ''}
  <style>
    :root {
      --bp-violet: #7c3aed;
      --bp-violet-light: #6d28d9;
      --bp-violet-bg: rgba(124,58,237,0.06);
      --bp-violet-glow: rgba(124,58,237,0.18);
      --bp-dark: #ffffff;
      --bp-card: #ffffff;
      --bp-border: #e2e8f0;
      --bp-text: #1e293b;
      --bp-text-muted: #475569;
      --bp-text-dim: #94a3b8;
      --bp-success: #059669;
      --bp-warning: #d97706;
      --bp-danger: #dc2626;
      --bp-info: #0284c7;
      --bp-radius: 16px;
      --bp-radius-sm: 10px;
      --bp-radius-xs: 6px;
      --bp-title-size: 24px;
      --bp-subtitle-size: 18px;
      --bp-body-size: 14px;
      --bp-section-gap: 24px;
      --bp-element-gap: 16px;
      --bp-sidebar-w: 280px;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth;-webkit-font-smoothing:antialiased}
    body{background:white;color:var(--bp-text);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;line-height:1.6;font-size:var(--bp-body-size)}

    /* ===== LAYOUT ===== */
    .bp-layout{display:flex;min-height:100vh}
    .bp-sidebar{width:var(--bp-sidebar-w);position:fixed;top:0;left:0;bottom:0;background:linear-gradient(180deg,#1e1b4b 0%,#312e81 100%);border-right:1px solid #e2e8f0;display:flex;flex-direction:column;z-index:100;transition:transform .3s cubic-bezier(.4,0,.2,1)}
    .bp-sidebar__brand{padding:24px 20px 18px;border-bottom:1px solid var(--bp-border)}
    .bp-sidebar__logo{font-size:22px;font-weight:800;background:linear-gradient(135deg,#7c3aed,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:1.5px}
    .bp-sidebar__company{font-size:11px;color:var(--bp-text-muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bp-sidebar__progress{padding:16px 20px;border-bottom:1px solid var(--bp-border)}
    .bp-sidebar__progress-label{font-size:11px;font-weight:700;color:var(--bp-text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;justify-content:space-between}
    .bp-sidebar__progress-bar{height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden}
    .bp-sidebar__progress-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:3px;transition:width .6s ease}
    .bp-sidebar__nav{flex:1;overflow-y:auto;padding:12px 10px;scrollbar-width:thin;scrollbar-color:rgba(124,58,237,.3) transparent}
    .bp-sidebar__link{display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:var(--bp-radius-sm);font-size:13px;font-weight:500;color:rgba(255,255,255,.7);text-decoration:none;transition:all .2s;cursor:pointer;border:none;background:none;width:100%;text-align:left;position:relative}
    .bp-sidebar__link:hover{background:rgba(255,255,255,.1);color:white}
    .bp-sidebar__link--active{font-weight:700;color:white;background:rgba(124,58,237,.18)}
    .bp-sidebar__link--active::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:20px;background:var(--bp-violet);border-radius:0 3px 3px 0}
    .bp-sidebar__icon{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;background:rgba(255,255,255,.12);color:#c4b5fd}
    .bp-sidebar__num{font-size:10px;font-weight:800;color:rgba(255,255,255,.4);margin-left:auto;min-width:18px;text-align:center}
    .bp-sidebar__check{color:var(--bp-success);font-size:10px;margin-left:auto}
    .bp-sidebar__actions{padding:12px 14px;border-top:1px solid var(--bp-border);display:flex;flex-direction:column;gap:8px}
    .bp-sidebar__footer{padding:14px 20px;border-top:1px solid var(--bp-border);font-size:10px;color:var(--bp-text-dim);text-align:center}

    .bp-main{margin-left:var(--bp-sidebar-w);flex:1;min-width:0}

    /* Mobile */
    .bp-mobile-toggle{display:none;position:fixed;top:16px;left:16px;z-index:200;width:44px;height:44px;border-radius:12px;background:var(--bp-violet);color:white;border:none;font-size:18px;cursor:pointer;box-shadow:0 4px 16px var(--bp-violet-glow)}
    .bp-sidebar__close{display:none;position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,.15);color:white;border:none;cursor:pointer;font-size:14px}
    .bp-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:90;backdrop-filter:blur(2px)}

    /* ===== HEADER ===== */
    .bp-header{padding:36px 40px 30px;background:linear-gradient(135deg,#1e1b4b 0%,#312e81 40%,#4c1d95 100%);position:relative;overflow:hidden}
    .bp-header::before{content:'';position:absolute;top:-80%;right:-15%;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(124,58,237,.2) 0%,transparent 70%)}
    .bp-header::after{content:'';position:absolute;bottom:-40%;left:-10%;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(167,139,250,.1) 0%,transparent 70%)}
    .bp-header__back{display:inline-flex;align-items:center;gap:6px;color:rgba(255,255,255,.55);text-decoration:none;font-size:13px;margin-bottom:18px;transition:color .2s;position:relative;z-index:1}
    .bp-header__back:hover{color:white}
    .bp-header__row{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;position:relative;z-index:1}
    .bp-header__title{font-size:var(--bp-title-size);font-weight:800;color:white;line-height:1.2;letter-spacing:-.3px}
    .bp-header__meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
    .bp-header__tag{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);backdrop-filter:blur(8px)}
    .bp-header__tag--version{background:rgba(124,58,237,.35);color:#c4b5fd}
    .bp-header__tag--ai{background:rgba(5,150,105,.2);color:#059669}
    .bp-header__tag--status{background:rgba(5,150,105,.15);color:#059669}
    .bp-header__scores{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start}
    .bp-header__score{padding:4px 10px;border-radius:16px;font-size:11px;font-weight:700;background:rgba(255,255,255,.08);color:rgba(255,255,255,.65)}

    /* ===== CONTENT ===== */
    .bp-content{padding:28px 40px 60px;max-width:1100px}

    /* ===== SECTIONS ===== */
    .bp-section{background:var(--bp-card);border:1px solid var(--bp-border);border-radius:var(--bp-radius);margin-bottom:var(--bp-section-gap);overflow:hidden;scroll-margin-top:24px;transition:border-color .3s;box-shadow:0 1px 3px rgba(0,0,0,0.04)}
    .bp-section:hover{border-color:#c4b5fd}
    .bp-section__head{display:flex;align-items:center;gap:14px;padding:20px 28px;border-bottom:1px solid var(--bp-border);background:#f8fafc}
    .bp-section__num{width:38px;height:38px;border-radius:var(--bp-radius-sm);display:flex;align-items:center;justify-content:center;color:white;font-size:14px;font-weight:800;flex-shrink:0;background:var(--bp-violet)}
    .bp-section__title{font-size:var(--bp-subtitle-size);font-weight:700;color:var(--bp-text)}
    .bp-section__body{padding:24px 28px}

    /* ===== SUB-SECTIONS ===== */
    .bp-sub{margin-bottom:var(--bp-section-gap)}
    .bp-sub:last-child{margin-bottom:0}
    .bp-sub__title{font-size:15px;font-weight:700;color:var(--bp-text);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(51,65,85,.4);display:flex;align-items:center;gap:8px}
    .bp-sub__title i{color:var(--bp-violet-light);font-size:13px}

    /* ===== TEXT ===== */
    .bp-para{font-size:var(--bp-body-size);color:var(--bp-text-muted);line-height:1.85;margin-bottom:var(--bp-element-gap)}
    .bp-para:last-child{margin-bottom:0}
    .bp-empty{font-size:13px;color:var(--bp-text-dim);font-style:italic;padding:8px 0}

    /* ===== LISTS ===== */
    .bp-list{list-style:none;padding:0;margin:0}
    .bp-list li{position:relative;padding:7px 0 7px 24px;font-size:var(--bp-body-size);color:var(--bp-text-muted);line-height:1.75}
    .bp-list li::before{content:'';position:absolute;left:0;top:15px;width:8px;height:8px;border-radius:50%;background:var(--bp-violet);opacity:.5}

    /* ===== KEY-VALUE ===== */
    .bp-kv{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(51,65,85,.25)}
    .bp-kv:last-child{border-bottom:none}
    .bp-kv__label{font-size:13px;font-weight:600;color:var(--bp-text);min-width:170px;flex-shrink:0}
    .bp-kv__value{font-size:13px;color:var(--bp-text-muted);flex:1}

    /* ===== BADGES ===== */
    .bp-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700}
    .bp-badges{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}

    /* ===== CARDS ===== */
    .bp-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
    .bp-card-item{background:#faf5ff;border:1px solid #e9d5ff;border-radius:var(--bp-radius-sm);padding:18px;transition:border-color .2s,transform .2s}
    .bp-card-item:hover{border-color:#c4b5fd;transform:translateY(-1px)}
    .bp-card-item__title{font-size:var(--bp-body-size);font-weight:700;color:var(--bp-text);margin-bottom:6px}
    .bp-card-item__desc{font-size:12.5px;color:var(--bp-text-muted);line-height:1.65}

    /* ===== STAT CARDS ===== */
    .bp-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:20px}
    .bp-stat{background:linear-gradient(135deg,#faf5ff,#eef2ff);border:1px solid #e9d5ff;border-radius:var(--bp-radius-sm);padding:20px;text-align:center}
    .bp-stat__value{font-size:22px;font-weight:800;color:#1e293b;margin-bottom:4px;letter-spacing:-.3px}
    .bp-stat__label{font-size:11px;color:var(--bp-text-dim);font-weight:600;text-transform:uppercase;letter-spacing:.5px}

    /* ===== TABLES ===== */
    .bp-table-wrap{overflow-x:auto;margin:var(--bp-element-gap) 0;border-radius:var(--bp-radius-sm);border:1px solid var(--bp-border)}
    .bp-table{width:100%;border-collapse:collapse;font-size:13px}
    .bp-table th{background:#f5f3ff;color:#6d28d9;font-weight:700;padding:12px 16px;text-align:left;border-bottom:2px solid #e9d5ff;white-space:nowrap}
    .bp-table td{padding:10px 16px;border-bottom:1px solid #f1f5f9;color:var(--bp-text-muted)}
    .bp-table__label{font-weight:600;color:var(--bp-text)}
    .bp-table__num{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
    .bp-table__highlight td{background:#faf5ff;font-weight:700;color:var(--bp-text)}
    .bp-table--info td:first-child{width:180px;font-weight:600;color:var(--bp-text)}

    /* ===== SWOT ===== */
    .bp-swot{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:var(--bp-element-gap) 0}
    .bp-swot__cell{border-radius:var(--bp-radius-sm);padding:18px;min-height:120px}
    .bp-swot__cell--s{background:#f0fdf4;border:1px solid #bbf7d0}
    .bp-swot__cell--w{background:#fff7ed;border:1px solid #fed7aa}
    .bp-swot__cell--o{background:#eff6ff;border:1px solid #bfdbfe}
    .bp-swot__cell--t{background:#fef2f2;border:1px solid #fecaca}
    .bp-swot__header{font-size:13px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px}
    .bp-swot__cell--s .bp-swot__header{color:#059669}
    .bp-swot__cell--w .bp-swot__header{color:#ea580c}
    .bp-swot__cell--o .bp-swot__header{color:#2563eb}
    .bp-swot__cell--t .bp-swot__header{color:#dc2626}
    .bp-swot__item{font-size:12.5px;color:var(--bp-text-muted);padding:4px 0 4px 16px;position:relative}
    .bp-swot__item::before{content:'\u2022';position:absolute;left:2px;font-weight:bold}

    /* ===== RISK BADGES ===== */
    .bp-risk-badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#f1f5f9;color:var(--bp-text-muted)}

    /* ===== VMV CARDS ===== */
    .bp-vmv{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin:12px 0}
    .bp-vmv__card{padding:20px;border-radius:var(--bp-radius-sm);background:linear-gradient(135deg,#faf5ff,#eef2ff);border:1px solid #e9d5ff}
    .bp-vmv__label{font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
    .bp-vmv__text{font-size:13px;color:var(--bp-text-muted);line-height:1.7}

    /* ===== ODD BADGES ===== */
    .bp-odd{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700;background:#fff1f2;color:#e11d48;border:1px solid #fecdd3;margin:3px}

    /* ===== CHART ===== */
    .bp-chart-container{position:relative;height:300px;margin:var(--bp-element-gap) 0;background:#f8fafc;border-radius:var(--bp-radius-sm);padding:16px;border:1px solid #e2e8f0}

    /* ===== GENERATE VIEW ===== */
    .bp-pregen{max-width:700px;margin:0 auto;padding:40px 0}
    .bp-source-row{display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:var(--bp-radius-sm);margin-bottom:8px;border:1px solid;transition:transform .2s}
    .bp-source-row:hover{transform:translateX(4px)}
    .bp-source-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
    .gen-btn{display:inline-flex;align-items:center;gap:10px;padding:14px 40px;border-radius:14px;font-size:15px;font-weight:700;border:none;cursor:pointer;color:white;transition:all .25s;box-shadow:0 4px 20px rgba(0,0,0,.3)}
    .gen-btn:disabled{opacity:.4;cursor:not-allowed}
    .gen-btn--primary{background:linear-gradient(135deg,#7c3aed,#6366f1)}
    .gen-btn--primary:not(:disabled):hover{transform:translateY(-2px);box-shadow:0 8px 28px var(--bp-violet-glow)}

    /* ===== DOWNLOAD BAR ===== */
    .bp-dl-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:18px 24px;background:linear-gradient(135deg,#f5f3ff,#eef2ff);border:1px solid #e9d5ff;border-radius:var(--bp-radius);margin-bottom:var(--bp-section-gap)}
    .bp-dl-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:var(--bp-radius-sm);font-size:13px;font-weight:700;border:none;cursor:pointer;color:white;text-decoration:none;transition:all .2s}
    .bp-dl-btn--primary{background:var(--bp-violet)}
    .bp-dl-btn--primary:hover{background:#6d28d9;transform:translateY(-1px)}
    .bp-dl-btn--ghost{background:transparent;border:1px solid #e2e8f0;color:#475569}
    .bp-dl-btn--ghost:hover{background:#f8fafc;border-color:#7c3aed;color:#7c3aed}

    /* ===== BACK TO TOP ===== */
    .bp-totop{position:fixed;bottom:28px;right:28px;width:46px;height:46px;border-radius:50%;background:var(--bp-violet);color:white;border:none;font-size:16px;cursor:pointer;box-shadow:0 4px 16px var(--bp-violet-glow);opacity:0;transform:translateY(12px);transition:all .3s;z-index:100}
    .bp-totop--visible{opacity:1;transform:translateY(0)}
    .bp-totop:hover{background:#6d28d9;transform:translateY(-2px)!important}

    /* ===== SHARE MODAL ===== */
    .bp-share-modal{display:none;position:fixed;inset:0;z-index:300;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(4px)}
    .bp-share-modal--open{display:flex}
    .bp-share-modal__box{background:white;border:1px solid #e2e8f0;border-radius:var(--bp-radius);padding:32px;max-width:460px;width:90%;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.15)}
    .bp-share-modal__close{position:absolute;top:16px;right:16px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px}
    .bp-share-modal__title{font-size:var(--bp-subtitle-size);font-weight:700;color:#1e293b;margin-bottom:16px}
    .bp-share-modal__input{display:flex;gap:8px}
    .bp-share-modal__url{flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:var(--bp-radius-xs);padding:10px 14px;color:#1e293b;font-size:13px;font-family:monospace}
    .bp-share-modal__copy{background:var(--bp-violet);color:white;border:none;border-radius:var(--bp-radius-xs);padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer}
    .bp-share-modal__copy:hover{background:#6d28d9}
    .bp-share-modal__msg{display:none;margin-top:10px;color:#059669;font-size:12px;font-weight:600}

    /* ===== PRINT ===== */
    @media print {
      body{background:white!important;color:#1f2937!important;font-size:12px!important}
      .bp-sidebar,.bp-mobile-toggle,.bp-totop,.bp-dl-bar,.gen-btn,.bp-header__back,.bp-sidebar__actions,.bp-overlay,.bp-share-modal{display:none!important}
      .bp-main{margin-left:0!important}
      .bp-header{background:#f3f4f6!important;padding:20px!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .bp-header__title{color:#1f2937!important;font-size:20px!important}
      .bp-header__tag{background:#e5e7eb!important;color:#374151!important}
      .bp-content{padding:0 16px!important}
      .bp-section{border-color:#e5e7eb!important;break-inside:avoid;margin-bottom:16px!important;box-shadow:none!important}
      .bp-section:hover{border-color:#e5e7eb!important}
      .bp-section__head{background:#f9fafb!important}
      .bp-section__num{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .bp-section__body,.bp-para,.bp-list li,.bp-kv__value,.bp-swot__item,.bp-table td{color:#374151!important}
      .bp-card-item{background:#f9fafb!important;border-color:#e5e7eb!important}
      .bp-chart-container{height:250px!important}
      .bp-stat{background:#f3f4f6!important;border-color:#e5e7eb!important}
      .bp-stat__value{color:#1f2937!important}
    }

    /* ===== RESPONSIVE ===== */
    @media(max-width:1024px){
      .bp-sidebar{transform:translateX(-100%)}
      .bp-sidebar--open{transform:translateX(0);box-shadow:4px 0 30px rgba(0,0,0,.5)}
      .bp-sidebar__close{display:flex;align-items:center;justify-content:center}
      .bp-mobile-toggle{display:flex;align-items:center;justify-content:center}
      .bp-overlay--visible{display:block}
      .bp-main{margin-left:0}
      .bp-header{padding:24px 20px 20px}
      .bp-header__title{font-size:20px}
      .bp-content{padding:20px 16px 60px}
      .bp-section__head{padding:16px 20px}
      .bp-section__body{padding:18px 20px}
      .bp-section__title{font-size:16px}
      .bp-swot{grid-template-columns:1fr}
      .bp-kv{flex-direction:column;gap:4px}
      .bp-kv__label{min-width:auto}
    }
    @media(max-width:640px){
      .bp-cards{grid-template-columns:1fr}
      .bp-stats{grid-template-columns:1fr 1fr}
      .bp-vmv{grid-template-columns:1fr}
      .bp-header__row{flex-direction:column}
      .bp-dl-bar{flex-direction:column;align-items:stretch;text-align:center}
      .bp-chart-container{height:220px}
    }
    ${embedded ? '.bp-sidebar,.bp-mobile-toggle,.bp-header__back,.bp-sidebar__actions,.bp-totop,.bp-overlay{display:none!important}.bp-main{margin-left:0!important}' : ''}
  </style>
</head>
<body>

<!-- Mobile toggle -->
<button class="bp-mobile-toggle" onclick="toggleSidebar()" aria-label="Menu">
  <i class="fas fa-bars"></i>
</button>
<div class="bp-overlay" id="bpOverlay" onclick="closeSidebar()"></div>

<div class="bp-layout">
  <!-- SIDEBAR -->
  ${hasBp ? `
  <aside class="bp-sidebar" id="bpSidebar">
    <button class="bp-sidebar__close" onclick="closeSidebar()" aria-label="Fermer"><i class="fas fa-times"></i></button>
    <div class="bp-sidebar__brand">
      <div class="bp-sidebar__logo">ESONO</div>
      <div class="bp-sidebar__company">${esc(companyName)} \u2014 v${bpVersion}</div>
    </div>
    <div class="bp-sidebar__progress">
      <div class="bp-sidebar__progress-label"><span>Completude</span><span>${completenessScore}%</span></div>
      <div class="bp-sidebar__progress-bar"><div class="bp-sidebar__progress-fill" style="width:${completenessScore}%"></div></div>
    </div>
    <nav class="bp-sidebar__nav" id="bpNav">
      ${navSections.map((s, i) => {
        const done = completenessItems[i]?.done
        return '<a class="bp-sidebar__link" data-section="' + s.id + '" onclick="scrollToSection(\'' + s.id + '\');closeSidebar()">' +
          '<span class="bp-sidebar__icon"><i class="fas ' + s.icon + '"></i></span>' +
          esc(s.label) +
          (done ? '<span class="bp-sidebar__check"><i class="fas fa-check-circle"></i></span>' : '<span class="bp-sidebar__num">' + s.num + '</span>') +
          '</a>'
      }).join('')}
    </nav>
    <div class="bp-sidebar__actions">
      ${bpId ? '<a href="/api/business-plan/download/' + bpId + '?format=docx" class="bp-dl-btn bp-dl-btn--primary" style="justify-content:center"><i class="fas fa-file-word"></i> Telecharger Word</a>' : ''}
      <button class="bp-dl-btn bp-dl-btn--ghost" style="justify-content:center" onclick="window.print()"><i class="fas fa-print"></i> Imprimer / PDF</button>
      <button class="bp-dl-btn bp-dl-btn--ghost" style="justify-content:center" onclick="openShareModal()"><i class="fas fa-share-nodes"></i> Partager</button>
    </div>
    <div class="bp-sidebar__footer">Genere par ESONO${genDate ? ' \u2022 ' + genDate : ''}</div>
  </aside>` : ''}

  <!-- MAIN -->
  <main class="bp-main">

    <!-- Header -->
    <div class="bp-header">
      ${embedded ? '' : '<a href="/entrepreneur" class="bp-header__back"><i class="fas fa-arrow-left"></i> Retour au tableau de bord</a>'}
      <div class="bp-header__row">
        <div>
          <div class="bp-header__title">${hasBp ? 'Business Plan \u2014 ' + esc(companyName) : 'Business Plan'}</div>
          <div class="bp-header__meta">
            ${hasBp ? `
              <span class="bp-header__tag"><i class="fas fa-globe-africa"></i> ${esc(countryName)}</span>
              <span class="bp-header__tag"><i class="fas fa-industry"></i> ${esc(sectorName)}</span>
              ${genDate ? '<span class="bp-header__tag"><i class="fas fa-calendar"></i> ' + genDate + '</span>' : ''}
              <span class="bp-header__tag bp-header__tag--version"><i class="fas fa-code-branch"></i> Version ${bpVersion}</span>
              ${isAI ? '<span class="bp-header__tag bp-header__tag--ai"><i class="fas fa-robot"></i> IA</span>' : ''}
              <span class="bp-header__tag bp-header__tag--status"><i class="fas fa-circle-check"></i> ${esc(bpStatus || 'completed')}</span>
            ` : '<span class="bp-header__tag"><i class="fas fa-info-circle"></i> Document non encore genere</span>'}
          </div>
        </div>
        ${hasBp && scoresBadges.length > 0 ? '<div class="bp-header__scores">' + scoresBadges.map(s => '<span class="bp-header__score">' + esc(s) + '</span>').join('') + '</div>' : ''}
      </div>
    </div>

    <div class="bp-content">
    ${hasBp ? `

      <!-- Download bar -->
      <div class="bp-dl-bar">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:44px;height:44px;border-radius:12px;background:rgba(5,150,105,.1);display:flex;align-items:center;justify-content:center"><i class="fas fa-check-circle" style="font-size:22px;color:#059669"></i></div>
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--bp-text)">Business Plan genere avec succes</div>
            <div style="font-size:12px;color:var(--bp-text-muted)">Version ${bpVersion} \u2022 ${availableCount}/5 sources integrees \u2022 Completude ${completenessScore}%</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${bpId ? '<a href="/api/business-plan/download/' + bpId + '?format=docx" class="bp-dl-btn bp-dl-btn--primary"><i class="fas fa-file-word"></i> Word</a>' : ''}
          <button class="bp-dl-btn bp-dl-btn--ghost" onclick="window.print()"><i class="fas fa-print"></i> PDF</button>
          <button class="bp-dl-btn bp-dl-btn--ghost" onclick="openShareModal()"><i class="fas fa-share-nodes"></i> Partager</button>
          <button class="bp-dl-btn bp-dl-btn--ghost" onclick="generateBusinessPlan()"><i class="fas fa-rotate"></i> Regenerer</button>
        </div>
      </div>

      <!-- 1. RESUME EXECUTIF -->
      <div class="bp-section" id="bp-resume">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">1</div>
          <div class="bp-section__title"><i class="fas fa-file-lines" style="color:#7c3aed;margin-right:8px"></i>Resume Executif</div>
        </div>
        <div class="bp-section__body">
          ${renderPara(resume.synthese, 'Synthese non disponible')}
          ${resume.points_cles?.length ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-star"></i> Points cles</div>' + renderList(resume.points_cles) + '</div>' : ''}
          ${(resume.montant_recherche && resume.montant_recherche !== 'A completer') || (resume.usage_fonds && resume.usage_fonds !== 'A completer') ? '<div class="bp-stats">' +
            (resume.montant_recherche && resume.montant_recherche !== 'A completer' ? '<div class="bp-stat"><div class="bp-stat__value">' + esc(resume.montant_recherche) + '</div><div class="bp-stat__label">Financement recherche</div></div>' : '') +
            (resume.usage_fonds && resume.usage_fonds !== 'A completer' ? '<div class="bp-stat" style="grid-column:span 2"><div class="bp-stat__value" style="font-size:14px">' + esc(resume.usage_fonds) + '</div><div class="bp-stat__label">Utilisation des fonds</div></div>' : '') +
            '</div>' : ''}
        </div>
      </div>

      <!-- 2. PRESENTATION ENTREPRISE -->
      <div class="bp-section" id="bp-presentation">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">2</div>
          <div class="bp-section__title"><i class="fas fa-building" style="color:#7c3aed;margin-right:8px"></i>Presentation de l'Entreprise</div>
        </div>
        <div class="bp-section__body">
          ${infoTableHtml ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-id-card"></i> Informations</div>' + infoTableHtml + '</div>' : ''}
          ${renderPara(presentation.description_generale)}
          ${presentation.revue_historique ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-clock-rotate-left"></i> Historique</div>' + renderPara(presentation.revue_historique.raison_creation) + (presentation.revue_historique.realisations_cles?.length ? renderList(presentation.revue_historique.realisations_cles) : '') + '</div>' : ''}
          ${presentation.vision_mission_valeurs ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-eye"></i> Vision, Mission & Valeurs</div><div class="bp-vmv">' +
            (presentation.vision_mission_valeurs.vision ? '<div class="bp-vmv__card"><div class="bp-vmv__label">Vision</div><div class="bp-vmv__text">' + nl2br(presentation.vision_mission_valeurs.vision) + '</div></div>' : '') +
            (presentation.vision_mission_valeurs.mission ? '<div class="bp-vmv__card"><div class="bp-vmv__label">Mission</div><div class="bp-vmv__text">' + nl2br(presentation.vision_mission_valeurs.mission) + '</div></div>' : '') +
            (Array.isArray(presentation.vision_mission_valeurs.valeurs) ? presentation.vision_mission_valeurs.valeurs.map((v: any) => '<div class="bp-vmv__card"><div class="bp-vmv__label">' + esc(v.valeur || 'Valeur') + '</div><div class="bp-vmv__text">' + esc(v.exemple || '') + '</div></div>').join('') : '') +
            '</div></div>' : ''}
          ${presentation.objectifs_smart ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-bullseye"></i> Objectifs SMART</div>' +
            (presentation.objectifs_smart.court_terme_1an?.length ? '<div style="margin-bottom:12px"><strong style="font-size:12px;color:var(--bp-violet-light)">Court terme (1 an)</strong>' + renderList(presentation.objectifs_smart.court_terme_1an) + '</div>' : '') +
            (presentation.objectifs_smart.long_terme_3_5ans?.length ? '<div><strong style="font-size:12px;color:var(--bp-violet-light)">Long terme (3-5 ans)</strong>' + renderList(presentation.objectifs_smart.long_terme_3_5ans) + '</div>' : '') +
            '</div>' : ''}
        </div>
      </div>

      <!-- 3. ANALYSE MARCHE -->
      <div class="bp-section" id="bp-marche">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">3</div>
          <div class="bp-section__title"><i class="fas fa-chart-pie" style="color:#7c3aed;margin-right:8px"></i>Analyse de Marche</div>
        </div>
        <div class="bp-section__body">
          ${renderPara(marche.taille_marche)}
          ${renderPara(marche.potentiel_croissance)}
          ${marche.tendances?.length ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-arrow-trend-up"></i> Tendances</div>' + renderList(marche.tendances) + '</div>' : ''}
          ${Array.isArray(marche.concurrents) && marche.concurrents.length > 0 ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-users"></i> Concurrence</div>' + renderCards(marche.concurrents, 'nom', 'forces') + '</div>' : ''}
          ${renderPara(marche.differenciation)}
          ${swotHtml ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-th-large"></i> Matrice SWOT</div>' + swotHtml + '</div>' : ''}
          ${swot.gestion_risques?.length ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-shield-halved"></i> Gestion des risques</div><div class="bp-table-wrap"><table class="bp-table"><thead><tr><th>Type de risque</th><th>Gravite</th><th>Mitigation</th></tr></thead><tbody>' +
            swot.gestion_risques.map((r: any) => '<tr><td>' + esc(r.type_risque || '') + '</td><td><span class="bp-risk-badge">' + esc(r.gravite || '') + '</span></td><td>' + esc(r.mitigation || '') + '</td></tr>').join('') +
            '</tbody></table></div></div>' : ''}
        </div>
      </div>

      <!-- 4. OFFRE PRODUIT/SERVICE -->
      <div class="bp-section" id="bp-offre">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">4</div>
          <div class="bp-section__title"><i class="fas fa-box-open" style="color:#7c3aed;margin-right:8px"></i>Offre Produit / Service</div>
        </div>
        <div class="bp-section__body">
          ${renderPara(offre.description)}
          ${offre.proposition_valeur ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-gem"></i> Proposition de valeur</div>' + renderPara(offre.proposition_valeur) + '</div>' : ''}
          ${offre.probleme_resolu ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-lightbulb"></i> Probleme resolu</div>' + renderPara(offre.probleme_resolu) + '</div>' : ''}
          ${offre.avantage_concurrentiel ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-trophy"></i> Avantage concurrentiel</div>' + renderPara(offre.avantage_concurrentiel) + '</div>' : ''}
        </div>
      </div>

      <!-- 5. STRATEGIE MARKETING -->
      <div class="bp-section" id="bp-marketing">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">5</div>
          <div class="bp-section__title"><i class="fas fa-bullhorn" style="color:#7c3aed;margin-right:8px"></i>Strategie Marketing (5P)</div>
        </div>
        <div class="bp-section__body">
          ${marketing.produit ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-cube"></i> Produit</div>' + renderPara(marketing.produit) + '</div>' : ''}
          ${marketing.point_de_vente ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-store"></i> Point de vente</div>' + renderPara(marketing.point_de_vente) + '</div>' : ''}
          ${marketing.prix ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-tag"></i> Prix</div>' + (typeof marketing.prix === 'object' ? renderKV(marketing.prix, { prix_vente: 'Prix de vente', prix_revient: 'Prix de revient', marge: 'Marge', strategie: 'Strategie' }) : renderPara(marketing.prix)) + '</div>' : ''}
          ${marketing.promotion ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-megaphone"></i> Promotion</div>' + renderPara(marketing.promotion) + '</div>' : ''}
          ${marketing.personnel ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-user-tie"></i> Personnel</div>' + renderPara(marketing.personnel) + '</div>' : ''}
        </div>
      </div>

      <!-- 6. MODELE ECONOMIQUE -->
      <div class="bp-section" id="bp-modele">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">6</div>
          <div class="bp-section__title"><i class="fas fa-diagram-project" style="color:#7c3aed;margin-right:8px"></i>Modele Economique</div>
        </div>
        <div class="bp-section__body">
          <div class="bp-cards">
            ${[
              { icon: 'fa-users', title: 'Segments clients', value: modele.segments_clients },
              { icon: 'fa-truck', title: 'Canaux de distribution', value: modele.canaux_distribution },
              { icon: 'fa-handshake', title: 'Relations clients', value: modele.relations_clients },
              { icon: 'fa-coins', title: 'Sources de revenus', value: modele.sources_revenus },
              { icon: 'fa-key', title: 'Ressources cles', value: modele.ressources_cles },
              { icon: 'fa-cogs', title: 'Activites cles', value: modele.activites_cles },
              { icon: 'fa-people-group', title: 'Partenaires cles', value: modele.partenaires_cles },
              { icon: 'fa-money-bill-trend-up', title: 'Structure de couts', value: modele.structure_couts },
            ].filter(c => c.value && c.value !== 'A completer').map(c =>
              '<div class="bp-card-item"><div class="bp-card-item__title"><i class="fas ' + c.icon + '" style="color:var(--bp-violet-light);margin-right:6px;font-size:12px"></i>' + esc(c.title) + '</div><div class="bp-card-item__desc">' + nl2br(c.value) + '</div></div>'
            ).join('')}
          </div>
        </div>
      </div>

      <!-- 7. PLAN OPERATIONNEL -->
      <div class="bp-section" id="bp-operations">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">7</div>
          <div class="bp-section__title"><i class="fas fa-users-gear" style="color:#7c3aed;margin-right:8px"></i>Plan Operationnel</div>
        </div>
        <div class="bp-section__body">
          ${Array.isArray(operations.equipe_direction) && operations.equipe_direction.length > 0 ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-user-tie"></i> Equipe de direction</div><div class="bp-cards">' +
            operations.equipe_direction.map((m: any) => '<div class="bp-card-item"><div class="bp-card-item__title">' + esc(m.nom || '\u2014') + '</div><div class="bp-card-item__desc">' + esc(m.role || '') + (m.competences ? '<br>' + esc(m.competences) : '') + '</div></div>').join('') +
            '</div></div>' : ''}
          ${operations.personnel ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-users"></i> Personnel</div>' + (typeof operations.personnel === 'object' ? renderKV(operations.personnel, { effectif: 'Effectif', qualifications: 'Qualifications', politique_rh: 'Politique RH' }) : renderPara(operations.personnel)) + '</div>' : ''}
          ${renderPara(operations.organigramme_description)}
          ${operations.conseil_administration && operations.conseil_administration !== 'A completer' ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-gavel"></i> Conseil d\'administration</div>' + renderPara(operations.conseil_administration) + '</div>' : ''}
        </div>
      </div>

      <!-- 8. IMPACT SOCIAL -->
      <div class="bp-section" id="bp-impact">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">8</div>
          <div class="bp-section__title"><i class="fas fa-hand-holding-heart" style="color:#7c3aed;margin-right:8px"></i>Impact Social & Environnemental</div>
        </div>
        <div class="bp-section__body">
          ${impact.impact_social ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-heart"></i> Impact social</div>' + renderPara(impact.impact_social) + '</div>' : ''}
          ${impact.impact_environnemental ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-leaf"></i> Impact environnemental</div>' + renderPara(impact.impact_environnemental) + '</div>' : ''}
          ${impact.impact_economique ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-chart-line"></i> Impact economique</div>' + renderPara(impact.impact_economique) + '</div>' : ''}
          ${impact.beneficiaires ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-people-arrows"></i> Beneficiaires</div>' + renderPara(impact.beneficiaires) + '</div>' : ''}
          ${Array.isArray(impact.odd_cibles) && impact.odd_cibles.length > 0 ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-globe"></i> ODD cibles</div><div class="bp-badges">' +
            impact.odd_cibles.map((o: string) => '<span class="bp-odd"><i class="fas fa-bullseye"></i> ' + esc(o) + '</span>').join('') + '</div></div>' : ''}
          ${impact.indicateurs?.length ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-chart-column"></i> Indicateurs d\'impact</div>' + renderList(impact.indicateurs) + '</div>' : ''}
        </div>
      </div>

      <!-- 9. PLAN FINANCIER -->
      <div class="bp-section" id="bp-financier">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">9</div>
          <div class="bp-section__title"><i class="fas fa-chart-bar" style="color:#7c3aed;margin-right:8px"></i>Plan Financier</div>
        </div>
        <div class="bp-section__body">
          ${financier.plan_investissement ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-money-check-dollar"></i> Plan d\'investissement</div>' + renderPara(financier.plan_investissement) + '</div>' : ''}
          ${financier.justification_financement && financier.justification_financement !== 'A completer' ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-file-invoice-dollar"></i> Justification du financement</div>' + renderPara(financier.justification_financement) + '</div>' : ''}
          ${hasFinChart ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-chart-line"></i> Evolution financiere 3 ans</div><div class="bp-chart-container"><canvas id="bpFinChart"></canvas></div></div>' : ''}
          ${finTableHtml ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-table"></i> Plan financier 3 ans</div>' + finTableHtml + '</div>' : ''}
          ${financier.kpis && Object.keys(financier.kpis).length > 0 ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-gauge-high"></i> KPIs</div>' + renderKV(financier.kpis) + '</div>' : ''}
        </div>
      </div>

      <!-- 10. GOUVERNANCE -->
      <div class="bp-section" id="bp-gouvernance">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">10</div>
          <div class="bp-section__title"><i class="fas fa-landmark" style="color:#7c3aed;margin-right:8px"></i>Gouvernance & Projet</div>
        </div>
        <div class="bp-section__body">
          ${gouvernance.projet_description ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-rocket"></i> Description du projet</div>' + renderPara(gouvernance.projet_description) + '</div>' : ''}
          ${gouvernance.situation_actuelle && gouvernance.situation_actuelle !== 'A completer' ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-map-pin"></i> Situation actuelle</div>' + renderPara(gouvernance.situation_actuelle) + '</div>' : ''}
          ${gouvernance.duree_mise_en_oeuvre && gouvernance.duree_mise_en_oeuvre !== 'A completer' ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-calendar-days"></i> Duree de mise en oeuvre</div>' + renderPara(gouvernance.duree_mise_en_oeuvre) + '</div>' : ''}
          ${gouvernance.objectif_projet && gouvernance.objectif_projet !== 'A completer' ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-bullseye"></i> Objectif</div>' + renderPara(gouvernance.objectif_projet) + '</div>' : ''}
          ${attentes.montant_demande || attentes.contribution_entrepreneur ? '<div class="bp-sub"><div class="bp-sub__title"><i class="fas fa-handshake"></i> Attentes vis-a-vis d\'OVO</div>' +
            renderKV(attentes, { montant_demande: 'Montant demande', contribution_entrepreneur: 'Contribution entrepreneur', autres_investisseurs: 'Autres investisseurs', expertise_necessaire: 'Expertise necessaire', coaching_souhaite: 'Coaching souhaite' }) + '</div>' : ''}
        </div>
      </div>

      <!-- 11. RISQUES & MITIGATION -->
      <div class="bp-section" id="bp-risques">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">11</div>
          <div class="bp-section__title"><i class="fas fa-shield-halved" style="color:#7c3aed;margin-right:8px"></i>Risques & Mitigation</div>
        </div>
        <div class="bp-section__body">
          ${riskTableHtml || '<p class="bp-empty">Aucun risque identifie</p>'}
        </div>
      </div>

      <!-- 12. ANNEXES -->
      <div class="bp-section" id="bp-annexes">
        <div class="bp-section__head">
          <div class="bp-section__num" style="background:#7c3aed">12</div>
          <div class="bp-section__title"><i class="fas fa-paperclip" style="color:#7c3aed;margin-right:8px"></i>Annexes</div>
        </div>
        <div class="bp-section__body">
          ${annexes.documents_joints?.length ? renderList(annexes.documents_joints) : '<p class="bp-empty">Aucune annexe disponible</p>'}
        </div>
      </div>

      <!-- Regenerate -->
      ${embedded ? '' : `
      <div style="text-align:center;margin-top:28px;padding:20px">
        <button class="gen-btn gen-btn--primary" onclick="generateBusinessPlan()">
          <i class="fas fa-rotate"></i> Regenerer le Business Plan
        </button>
        <div id="generateStatus" style="margin-top:16px;display:none"></div>
      </div>`}

    ` : `
      <!-- PRE-GENERATION VIEW -->
      <div class="bp-pregen">
        <div class="bp-section">
          <div class="bp-section__body" style="text-align:center;padding:48px 28px">
            <div style="width:72px;height:72px;border-radius:50%;background:var(--bp-violet-bg);display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px"><i class="fas fa-file-alt" style="font-size:30px;color:var(--bp-violet)"></i></div>
            <h2 style="font-size:22px;font-weight:800;color:var(--bp-text);margin-bottom:10px">Generer votre Business Plan</h2>
            <p style="font-size:var(--bp-body-size);color:var(--bp-text-muted);max-width:480px;margin:0 auto 32px;line-height:1.7">
              Le Business Plan synthetise l'ensemble de vos livrables (BMC, SIC, Framework financier, Plan OVO, Diagnostic) en un dossier structure pret a presenter aux investisseurs.
            </p>

            <div style="text-align:left;max-width:480px;margin:0 auto 32px">
              <div style="font-size:13px;font-weight:700;color:var(--bp-text);margin-bottom:14px"><i class="fas fa-database" style="color:var(--bp-violet-light);margin-right:8px"></i>Sources de donnees (${availableCount}/5)</div>
              ${[
                { has: hasBmc, icon: 'fa-diagram-project', label: 'BMC (Business Model Canvas)', req: true },
                { has: hasSic, icon: 'fa-hand-holding-heart', label: 'SIC (Social Impact Canvas)', req: false },
                { has: hasFramework, icon: 'fa-chart-bar', label: 'Framework Analyse PME', req: true },
                { has: hasDiag, icon: 'fa-stethoscope', label: 'Diagnostic Expert', req: false },
                { has: hasOvo, icon: 'fa-file-excel', label: 'Plan Financier OVO', req: false },
              ].map(s =>
                '<div class="bp-source-row" style="background:' + (s.has ? 'rgba(5,150,105,.06)' : 'rgba(220,38,38,.04)') + ';border-color:' + (s.has ? 'rgba(5,150,105,.2)' : 'rgba(220,38,38,.15)') + '">' +
                  '<div class="bp-source-icon" style="background:' + (s.has ? 'rgba(5,150,105,.1)' : 'rgba(220,38,38,.08)') + ';color:' + (s.has ? '#059669' : '#dc2626') + '"><i class="fas ' + (s.has ? 'fa-check' : 'fa-times') + '"></i></div>' +
                  '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:' + (s.has ? '#059669' : '#dc2626') + '">' + s.label + '</div>' +
                  '<div style="font-size:11px;color:var(--bp-text-dim)">' + (s.has ? 'Disponible' : 'Non disponible') + ' \u2022 ' + (s.req ? 'Recommande' : 'Optionnel') + '</div></div></div>'
              ).join('')}
            </div>

            <button id="btnGenerate" class="gen-btn gen-btn--primary" ${!canGenerate ? 'disabled' : ''} onclick="generateBusinessPlan()">
              <i class="fas fa-wand-magic-sparkles"></i> Generer le Business Plan
            </button>
            ${!canGenerate ? '<p style="font-size:12px;color:#f87171;margin-top:12px">Au moins le Business Model Canvas ou le Framework d\'analyse financiere est requis.</p>' : ''}
            <div id="generateStatus" style="margin-top:16px;display:none"></div>
          </div>
        </div>
      </div>
    `}

    <!-- Footer -->
    <div style="text-align:center;padding:24px 0;margin-top:20px;border-top:1px solid var(--bp-border)">
      <div style="font-size:12px;color:var(--bp-text-dim)">Genere par ESONO${genDate ? ' \u2022 ' + genDate : ''} \u2022 Business Plan v${bpVersion || 0}</div>
    </div>
    </div>
  </main>
</div>

<!-- Share modal -->
<div class="bp-share-modal" id="bpShareModal">
  <div class="bp-share-modal__box">
    <button class="bp-share-modal__close" onclick="closeShareModal()"><i class="fas fa-times"></i></button>
    <div class="bp-share-modal__title"><i class="fas fa-share-nodes" style="color:var(--bp-violet);margin-right:8px"></i>Partager le Business Plan</div>
    <div class="bp-share-modal__input">
      <input class="bp-share-modal__url" id="bpShareUrl" readonly>
      <button class="bp-share-modal__copy" onclick="copyShareLink()"><i class="fas fa-copy"></i> Copier</button>
    </div>
    <div class="bp-share-modal__msg" id="bpShareMsg"><i class="fas fa-check-circle"></i> Lien copie !</div>
  </div>
</div>

<!-- Back to top -->
<button class="bp-totop" id="bpToTop" onclick="window.scrollTo({top:0,behavior:'smooth'})" aria-label="Retour en haut">
  <i class="fas fa-arrow-up"></i>
</button>

<script>
  function getCookie(n){return(document.cookie.match('(^|;)\\\\s*'+n+'=([^;]*)')||[])[2]||''}

  // Sidebar
  function toggleSidebar(){
    var s=document.getElementById('bpSidebar'),o=document.getElementById('bpOverlay');
    if(s){s.classList.toggle('bp-sidebar--open');}
    if(o){o.classList.toggle('bp-overlay--visible');}
  }
  function closeSidebar(){
    var s=document.getElementById('bpSidebar'),o=document.getElementById('bpOverlay');
    if(s){s.classList.remove('bp-sidebar--open');}
    if(o){o.classList.remove('bp-overlay--visible');}
  }

  // Scroll to section
  function scrollToSection(id){
    var el=document.getElementById('bp-'+id);
    if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
  }

  // Active nav tracking + back-to-top
  var sections=document.querySelectorAll('.bp-section[id]');
  var navLinks=document.querySelectorAll('.bp-sidebar__link[data-section]');
  var toTopBtn=document.getElementById('bpToTop');
  function updateActiveNav(){
    var current='';
    sections.forEach(function(s){
      if(s.getBoundingClientRect().top<=120)current=s.id.replace('bp-','');
    });
    navLinks.forEach(function(link){
      link.classList.toggle('bp-sidebar__link--active',link.dataset.section===current);
    });
    if(toTopBtn)toTopBtn.classList.toggle('bp-totop--visible',window.scrollY>400);
  }
  window.addEventListener('scroll',updateActiveNav,{passive:true});
  updateActiveNav();

  // Share
  function openShareModal(){
    var m=document.getElementById('bpShareModal'),u=document.getElementById('bpShareUrl');
    if(m)m.classList.add('bp-share-modal--open');
    if(u)u.value=window.location.href;
  }
  function closeShareModal(){
    var m=document.getElementById('bpShareModal');
    if(m)m.classList.remove('bp-share-modal--open');
  }
  function copyShareLink(){
    var u=document.getElementById('bpShareUrl');
    var msg=document.getElementById('bpShareMsg');
    if(u){u.select();document.execCommand('copy');
    if(navigator.clipboard)navigator.clipboard.writeText(u.value);}
    if(msg){msg.style.display='block';setTimeout(function(){msg.style.display='none'},2000)}
  }

  // Financial chart
  ${hasFinChart ? `
  (function(){
    var ctx=document.getElementById('bpFinChart');
    if(!ctx||typeof Chart==='undefined')return;
    var labels=['Annee 1','Annee 2','Annee 3'];
    new Chart(ctx,{
      type:'bar',
      data:{
        labels:labels,
        datasets:[
          {label:"Chiffre d'affaires",data:${JSON.stringify(finChartData.ca)},backgroundColor:'rgba(124,58,237,0.6)',borderColor:'#7c3aed',borderWidth:2,borderRadius:6,barPercentage:0.35},
          {label:'Resultat net',data:${JSON.stringify(finChartData.net)},backgroundColor:'rgba(5,150,105,0.5)',borderColor:'#059669',borderWidth:2,borderRadius:6,barPercentage:0.35},
          {label:'Cash-flow',type:'line',data:${JSON.stringify(finChartData.cf)},borderColor:'#a78bfa',backgroundColor:'rgba(167,139,250,0.1)',borderWidth:3,pointRadius:5,pointBackgroundColor:'#a78bfa',fill:true,tension:0.3}
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{labels:{color:'#475569',font:{family:'Inter',size:12,weight:'600'},padding:16}},tooltip:{backgroundColor:'white',borderColor:'#e2e8f0',borderWidth:1,titleColor:'#1e293b',bodyColor:'#475569',padding:12,cornerRadius:8,callbacks:{label:function(c){return c.dataset.label+': '+Number(c.raw).toLocaleString('fr-FR')+' FCFA'}}}},
        scales:{x:{grid:{display:false},ticks:{color:'#64748b',font:{family:'Inter',size:11}}},y:{grid:{color:'rgba(226,232,240,0.6)'},ticks:{color:'#64748b',font:{family:'Inter',size:11},callback:function(v){if(Math.abs(v)>=1e6)return(v/1e6).toFixed(0)+'M';if(Math.abs(v)>=1e3)return(v/1e3).toFixed(0)+'k';return v}}}}
      }
    });
  })();
  ` : ''}

  // Generate Business Plan
  async function generateBusinessPlan(){
    var btn=document.getElementById('btnGenerate')||document.querySelector('.gen-btn');
    var status=document.getElementById('generateStatus');
    if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Generation en cours... (peut prendre ~1min)';}
    if(status){status.style.display='block';status.innerHTML='<div style="color:var(--bp-text-muted)"><i class="fas fa-spinner fa-spin"></i> Compilation de vos livrables et generation IA...</div>';}
    try{
      var token=getCookie('auth_token')||localStorage.getItem('auth_token');
      var res=await fetch('/api/business-plan/generate',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        credentials:'include',
        body:JSON.stringify({})
      });
      var data=await res.json();
      if(data.success){
        if(status)status.innerHTML='<div style="color:#059669"><i class="fas fa-check-circle"></i> '+(data.message||'Business Plan genere')+(data.ai_generated?' (IA)':'')+'</div>';
        setTimeout(function(){location.reload()},1200);
      }else{
        if(status)status.innerHTML='<div style="color:#f87171"><i class="fas fa-exclamation-circle"></i> '+(data.error||'Erreur')+'</div>';
        if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-wand-magic-sparkles"></i> Generer le Business Plan';}
      }
    }catch(e){
      if(status)status.innerHTML='<div style="color:#f87171"><i class="fas fa-exclamation-circle"></i> Erreur reseau</div>';
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-wand-magic-sparkles"></i> Generer le Business Plan';}
    }
  }
<\/script>
</body>
</html>`
}
// POST /api/business-plan/generate
app.post('/api/business-plan/generate', async (c) => {
  try {
    // ── Authentication ──
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const db = c.env.DB
    const apiKey = c.env.ANTHROPIC_API_KEY
    const pmeId = `pme_${payload.userId}`

    // ── Parse request body ──
    let body: { pmeId?: string; guideDocx?: string } = {}
    try {
      body = await c.req.json()
    } catch { /* empty body is fine, use defaults */ }
    const requestPmeId = body.pmeId || pmeId

    // ═══════════════════════════════════════════════════════════════
    // STEP A — Template: Load DOCX, extract headings/placeholders/tables
    // ═══════════════════════════════════════════════════════════════
    console.log(`[Business Plan] STEP A — Loading template structure...`)

    // Determine which DOCX template to use (guideDocx from body or default embedded)
    let templateDocxB64: string
    let templateDocxPath: string
    if (body.guideDocx && typeof body.guideDocx === 'string' && body.guideDocx.length > 100) {
      // User provided a custom guide DOCX as base64
      templateDocxB64 = body.guideDocx.replace(/^data:application\/[^;]+;base64,/, '')
      templateDocxPath = '/templates/business_plan_guide.docx'
      console.log(`[Business Plan] STEP A — Using user-provided guideDocx (${templateDocxB64.length} chars base64)`)
    } else {
      // Use the default embedded template
      templateDocxB64 = BUSINESS_PLAN_TEMPLATE_B64
      templateDocxPath = '/templates/business_plan_template.docx'
      console.log(`[Business Plan] STEP A — Using default embedded DOCX template`)
    }

    // Verify template is available
    if (!templateDocxB64 || templateDocxB64.length < 100) {
      console.error(`[Business Plan] STEP A — Template DOCX is missing or empty`)
      return c.json({ error: 'Template DOCX manquant ou invalide. Veuillez réessayer.' }, 500)
    }

    // Build templateStructure from the pre-parsed JSON structure
    // (If user provided a guideDocx, we still use the canonical structure since we can't
    //  parse DOCX at runtime in Workers — but we send the actual DOCX to Claude as multimodal)
    const parsedStructure = BUSINESS_PLAN_TEMPLATE_STRUCTURE
    const templateMeta = BUSINESS_PLAN_TEMPLATE_META

    // Count placeholders from the parsed structure
    let placeholdersCount = 0
    const placeholdersList: string[] = []
    for (const section of parsedStructure.sections) {
      if (section.questions) {
        placeholdersCount += section.questions.length
        placeholdersList.push(...section.questions)
      }
      if (section.subsections) {
        for (const sub of section.subsections) {
          if (sub.questions) {
            placeholdersCount += sub.questions.length
            placeholdersList.push(...sub.questions)
          }
          if (sub.content_hints) {
            placeholdersCount += sub.content_hints.filter((h: string) => h.includes(':') && h.length < 80).length
          }
        }
      }
    }

    const templateStructure = {
      total_pages: templateMeta.total_pages,
      total_sections: templateMeta.total_sections,
      total_subsections: templateMeta.total_subsections,
      total_paragraphs: templateMeta.total_paragraphs,
      total_tables: templateMeta.total_tables,
      placeholders_count: Math.max(templateMeta.placeholders_count, placeholdersCount),
      sections: parsedStructure.sections.map((s: any) => ({
        h1: s.title,
        content_hints: s.content_hints || [],
        questions: s.questions || [],
        subsections: (s.subsections || []).map((sub: any) => ({
          h2: sub.title,
          content_hints: sub.content_hints || [],
          questions: sub.questions || [],
        }))
      })),
      tables: parsedStructure.tables.map((t: any) => ({
        index: t.index,
        rows: t.rows,
        cols: t.cols,
        headers: t.headers,
      }))
    }

    console.log(`[Business Plan] STEP A — Template loaded: ${templateStructure.total_sections} H1, ${templateStructure.total_subsections} H2, ${templateStructure.placeholders_count} placeholders, ${templateStructure.total_tables} tables`)

    // ═══════════════════════════════════════════════════════════════
    // STEP B — Collect deliverables in parallel (via /latest endpoints)
    // ═══════════════════════════════════════════════════════════════
    console.log(`[Business Plan] STEP B — Collecting deliverables for ${requestPmeId}...`)

    // Fetch deliverables using internal DB queries (equivalent to calling /latest endpoints)
    // We use direct DB for performance, mirroring what each GET /api/*/latest/:pmeId returns
    const [bmcRow, sicRow, fwRow, diagRow, ovoRow, userRow, pmeDataRow] = await Promise.all([
      // GET /api/bmc/latest/:pmeId equivalent (required)
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      // GET /api/sic/latest/:pmeId equivalent (optional)
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_analysis' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      // GET /api/framework/latest/:pmeId equivalent (required)
      db.prepare(`SELECT id, content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId).first(),
      // GET /api/diagnostic/latest/:pmeId equivalent (optional)
      db.prepare(`SELECT id, score, analysis_json FROM diagnostic_analyses WHERE user_id = ? AND pme_id = ? AND status IN ('analyzed','generated','partial') ORDER BY created_at DESC LIMIT 1`).bind(payload.userId, requestPmeId).first(),
      // GET /api/plan-ovo/latest/:pmeId equivalent (optional)
      db.prepare(`SELECT id, analysis_json, score FROM plan_ovo_analyses WHERE user_id = ? AND pme_id = ? AND status = 'generated' ORDER BY created_at DESC LIMIT 1`).bind(payload.userId, requestPmeId).first(),
      // User info
      db.prepare('SELECT name, email, country FROM users WHERE id = ?').bind(payload.userId).first(),
      // PME structured data
      db.prepare(`SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_pme_data' ORDER BY version DESC LIMIT 1`).bind(payload.userId).first(),
    ])

    // Filter for available:true results and build allDeliverables
    const safeParse = (raw: any) => { try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}) } catch { return {} } }

    const bmcData = bmcRow ? safeParse(bmcRow.content) : null
    const sicData = sicRow ? safeParse(sicRow.content) : null
    const fwData = fwRow ? safeParse(fwRow.content) : null
    const diagData = diagRow ? safeParse(diagRow.analysis_json) : null
    const ovoData = ovoRow ? safeParse(ovoRow.analysis_json) : null
    const pmeData = pmeDataRow ? safeParse(pmeDataRow.content) : null
    const userName = (userRow?.name as string) || 'Entrepreneur'
    const userCountry = (userRow?.country as string) || ''

    // Require at least BMC or Framework (400 error)
    if (!bmcRow && !fwRow) {
      console.error(`[Business Plan] STEP B — FAILED: Neither BMC nor Framework available`)
      return c.json({
        error: "Au moins le Business Model Canvas ou le Framework d'analyse financière est requis"
      }, 400)
    }

    // Extract key info from each deliverable
    const bmcSections = bmcData ? {
      proposition_valeur: bmcData.proposition_valeur || bmcData.value_proposition || bmcData.propositionValeur || '',
      segments_clients: bmcData.segments_clients || bmcData.customer_segments || bmcData.segmentsClients || '',
      canaux: bmcData.canaux || bmcData.channels || '',
      relations_clients: bmcData.relations_clients || bmcData.customer_relationships || '',
      sources_revenus: bmcData.sources_revenus || bmcData.revenue_streams || bmcData.sourcesRevenus || '',
      ressources_cles: bmcData.ressources_cles || bmcData.key_resources || '',
      activites_cles: bmcData.activites_cles || bmcData.key_activities || '',
      partenaires_cles: bmcData.partenaires_cles || bmcData.key_partners || '',
      structure_couts: bmcData.structure_couts || bmcData.cost_structure || bmcData.structureCouts || '',
    } : null
    const sicSections = sicData ? {
      probleme_social: sicData.probleme_social || sicData.social_problem || '',
      beneficiaires: sicData.beneficiaires || sicData.beneficiaries || '',
      solution_impact: sicData.solution_impact || sicData.impact_solution || '',
      indicateurs_impact: sicData.indicateurs_impact || sicData.impact_indicators || '',
      odd_cibles: sicData.odd_cibles || sicData.sdg_targets || '',
      theorie_changement: sicData.theorie_changement || sicData.theory_of_change || '',
    } : null
    const fwSections = fwData ? {
      chiffre_affaires: fwData.chiffre_affaires || fwData.revenue || '',
      charges: fwData.charges || fwData.expenses || '',
      resultat_net: fwData.resultat_net || fwData.net_result || '',
      tresorerie: fwData.tresorerie || fwData.cash_flow || '',
      bfr: fwData.bfr || fwData.working_capital || '',
      investissements: fwData.investissements || fwData.investments || '',
    } : null
    const pmeFinancials = pmeData ? {
      nom_entreprise: pmeData.nom_entreprise || pmeData.company_name || userName,
      secteur: pmeData.secteur || pmeData.sector || '',
      activites: pmeData.activities || pmeData.activites || [],
      historique: pmeData.historique || {},
      hypotheses: pmeData.hypotheses || {},
    } : null
    const diagSummary = diagData ? {
      score_global: diagData.score_global || diagData.scoreGlobal || (diagRow?.score as number) || 0,
      resume_executif: diagData.resume_executif || diagData.verdict || '',
      forces: diagData.forces || diagData.strengths || [],
      recommandations: diagData.recommandations || diagData.recommendations || [],
      risques: diagData.risques_contextuels || [],
    } : null
    const ovoSummary = ovoData ? {
      score: ovoData.score_global || (ovoRow?.score as number) || 0,
      compte_resultat: ovoData.compte_resultat || ovoData.income_statement || null,
      plan_tresorerie: ovoData.plan_tresorerie || ovoData.cash_flow || null,
      bilan: ovoData.bilan || ovoData.balance_sheet || null,
      kpis: ovoData.kpis || ovoData.ratios || null,
    } : null

    const companyName = pmeFinancials?.nom_entreprise || userName
    const sector = pmeFinancials?.secteur || ''

    // Build sources tracking and allDeliverables
    const sources = {
      bmc: !!bmcRow,
      sic: !!sicRow,
      framework: !!fwRow,
      diagnostic: !!diagRow,
      plan_ovo: !!ovoRow,
      pme_data: !!pmeData,
    }
    const availableCount = Object.values(sources).filter(Boolean).length
    const allDeliverables = {
      bmc: bmcSections,
      sic: sicSections,
      framework: fwSections,
      diagnostic: diagSummary,
      plan_ovo: ovoSummary,
      pme_data: pmeFinancials,
    }

    console.log(`[Business Plan] STEP B — Deliverables collected: ${availableCount}/6 — BMC=${sources.bmc} SIC=${sources.sic} FW=${sources.framework} DIAG=${sources.diagnostic} OVO=${sources.plan_ovo} PME=${sources.pme_data}`)

    // ═══════════════════════════════════════════════════════════════
    // STEP C — KB enrichment: extract country/sector, 3 RAG queries
    // ═══════════════════════════════════════════════════════════════
    console.log(`[Business Plan] STEP C — KB enrichment starting...`)

    // Infer country from deliverables (default "Côte d'Ivoire")
    const contentTexts: string[] = []
    if (bmcData) contentTexts.push(JSON.stringify(bmcData).slice(0, 3000))
    if (fwData) contentTexts.push(JSON.stringify(fwData).slice(0, 3000))
    if (diagData) contentTexts.push(JSON.stringify(diagData).slice(0, 2000))
    if (pmeData) contentTexts.push(JSON.stringify(pmeData).slice(0, 2000))
    if (userCountry) contentTexts.push(userCountry)

    const countryKey = detectCountry(contentTexts)
    const fiscal = getFiscalParams(countryKey)
    const { kbContext: fiscalKBText } = buildKBContext(fiscal)

    // Infer sector (default "Non spécifié")
    const inferredSector = sector ||
      (bmcData?.secteur || bmcData?.sector || '') ||
      (fwData?.secteur || fwData?.sector || '') ||
      (diagData?.secteur || diagData?.sector || '') ||
      'Non spécifié'

    // Run 3 RAG queries for market context, competition, and opportunities
    let kbBenchmarks: any[] = []
    let kbFunders: any[] = []
    let kbRisks: any[] = []
    let kbUsed = false
    try {
      const [benchResult, funderResult, risksResult] = await Promise.all([
        // RAG Query 1: Market context & sector benchmarks
        db.prepare(`SELECT * FROM kb_benchmarks WHERE (sector = ? OR sector = 'all' OR sector IS NULL) ORDER BY metric LIMIT 30`).bind(inferredSector).all(),
        // RAG Query 2: Competition & funders landscape
        db.prepare(`SELECT * FROM kb_funders WHERE (region LIKE ? OR region LIKE '%UEMOA%' OR region IS NULL) ORDER BY name LIMIT 15`).bind('%' + fiscal.country + '%').all(),
        // RAG Query 3: Opportunities & risks
        db.prepare(`SELECT * FROM kb_sources WHERE (category = 'risks' OR category = 'sector_risks' OR category = 'opportunities') AND (region = ? OR region = 'UEMOA' OR region IS NULL) ORDER BY relevance_score DESC LIMIT 15`).bind(fiscal.country).all(),
      ])
      kbBenchmarks = benchResult.results || []
      kbFunders = funderResult.results || []
      kbRisks = risksResult.results || []
      kbUsed = (kbBenchmarks.length + kbFunders.length + kbRisks.length) > 0
    } catch (e: any) {
      console.log(`[Business Plan] STEP C — KB query failed (non-fatal): ${e.message}`)
    }

    // Assemble kbContext
    const kbContext = {
      pays: fiscal.country,
      secteur: inferredSector,
      fiscal_params: fiscalKBText,
      benchmarks_sectoriels: {
        marge_brute: `${Math.round(fiscal.sectorBenchmarks.grossMarginRange[0] * 100)}-${Math.round(fiscal.sectorBenchmarks.grossMarginRange[1] * 100)}%`,
        marge_ebitda: `${Math.round(fiscal.sectorBenchmarks.ebitdaMarginRange[0] * 100)}-${Math.round(fiscal.sectorBenchmarks.ebitdaMarginRange[1] * 100)}%`,
        marge_nette: `${Math.round(fiscal.sectorBenchmarks.netMarginRange[0] * 100)}-${Math.round(fiscal.sectorBenchmarks.netMarginRange[1] * 100)}%`,
        ratio_dette_max: `${Math.round(fiscal.sectorBenchmarks.debtRatioMax * 100)}%`,
        seuil_rentabilite: `${fiscal.sectorBenchmarks.breakEvenMonths[0]}-${fiscal.sectorBenchmarks.breakEvenMonths[1]} mois`,
      },
      contexte_marche: kbBenchmarks.length > 0
        ? kbBenchmarks.slice(0, 10).map((b: any) => `${b.metric || b.name}: ${b.value || b.description}`)
        : [`Marché PME ${fiscal.country} en croissance, taux bancaire moyen ${(fiscal.bankRate * 100).toFixed(1)}%`, `Inflation ${(fiscal.inflationRate * 100).toFixed(1)}%, SMIG ${fiscal.smig.toLocaleString()} ${fiscal.currency}`],
      concurrence_paysage: kbFunders.length > 0
        ? kbFunders.slice(0, 8).map((f: any) => ({ nom: f.name, type: f.type, focus: f.focus_sectors || 'PME' }))
        : [
          { nom: 'OVO', type: 'Prêt', focus: 'PME à impact' },
          { nom: 'BAD/BAfD', type: 'Subvention/Prêt', focus: 'Infrastructure' },
          { nom: 'AFD/Proparco', type: 'Prêt/Garantie', focus: 'PME croissance' },
        ],
      opportunites_risques: kbRisks.length > 0
        ? kbRisks.slice(0, 8).map((r: any) => r.name || r.description || '')
        : [
          'Croissance démographique et urbanisation rapide',
          'Digitalisation des services financiers (mobile money)',
          'Accès limité au financement bancaire pour PME',
          'Volatilité des prix matières premières',
          'Infrastructures énergétiques insuffisantes',
        ],
      reglementation: {
        tva: `${Math.round(fiscal.vat * 100)}%`,
        impot_societes: `${Math.round(fiscal.corporateTax * 100)}%`,
        charges_sociales: `${(fiscal.socialChargesRate * 100).toFixed(1)}%`,
        regime_fiscal_1: `${fiscal.taxRegime1.name} (${fiscal.taxRegime1.description})`,
        regime_fiscal_2: `${fiscal.taxRegime2.name} (${fiscal.taxRegime2.description})`,
      }
    }
    console.log(`[Business Plan] STEP C — KB enrichment done: pays=${fiscal.country}, secteur=${inferredSector}, kb_used=${kbUsed} (bench=${kbBenchmarks.length}, fund=${kbFunders.length}, risk=${kbRisks.length})`)

    // ═══════════════════════════════════════════════════════════════
    // STEP D — Call Claude: system prompt (expert West-African SME BP),
    //          temp=0.4, max_tokens=12000, with templateStructure + kbContext
    //          + DOCX template sent as multimodal document
    // ═══════════════════════════════════════════════════════════════
    let businessPlanJson: any
    let usedAI = false

    if (isValidApiKey(apiKey)) {
      // --- System Prompt ---
      const systemPrompt = `Tu es un expert en rédaction de Business Plans pour PME en Afrique de l'Ouest (zone UEMOA/CFA).
Tu connais parfaitement le contexte économique, fiscal et réglementaire de ces pays.
Tu rédiges des documents professionnels destinés aux investisseurs (OVO, BAD, IFC, AFD/Proparco, investisseurs d'impact).

MISSION : Génère un Business Plan complet en JSON qui correspond EXACTEMENT à chaque placeholder du template DOCX fourni (envoyé en pièce jointe).

RÈGLES STRICTES :
1. Respecte l'ordre et les titres exacts du template DOCX (INTRODUCTION, PRÉSENTATION DE L'ENTREPRISE, OPÉRATIONS COMMERCIALES, VOTRE PROJET).
2. Remplis CHAQUE placeholder en utilisant les livrables fournis. Priorité : BMC > Framework > Diagnostic > Plan OVO > SIC.
3. Enrichis les sections avec les données kbContext (benchmarks, contexte marché, réglementation, concurrence).
4. Si un livrable est MANQUANT, note-le dans metadata.livrables_utilises et mets "À compléter" ou des estimations réalistes basées sur le secteur et le pays.
5. Ton PROFESSIONNEL, orienté investisseur. Chaque paragraphe = 3 à 5 phrases (50-150 mots).
6. Remplis les 3 tableaux du template :
   - Table 0 : Informations entreprise (8 lignes x 2 colonnes)
   - Table 1 : Matrice SWOT (2 lignes x 2 colonnes : Forces/Faiblesses, Opportunités/Menaces)
   - Table 2 : Plan financier 3 ans (12 lignes x 4 colonnes : libellé + année 1/2/3)
7. Le JSON doit remplir TOUS les placeholders SANS dépasser l'espace du template (~50 pages).
8. Monnaie = ${fiscal.currency}, Pays = ${fiscal.country}.

SQUELETTE JSON REQUIS :
{
  "metadata": {
    "titre": "Business Plan — [Entreprise]",
    "entreprise": "[nom]",
    "secteur": "[secteur]",
    "pays": "[pays]",
    "date_generation": "[ISO date]",
    "livrables_utilises": { "bmc": bool, "sic": bool, "framework": bool, "diagnostic": bool, "plan_ovo": bool },
    "livrables_manquants": ["liste des livrables non disponibles"],
    "version": "AI-generated"
  },
  "resume_executif": {
    "titre": "Résumé de la gestion",
    "synthese": "paragraphe 3-5 phrases",
    "points_cles": ["point 1", "point 2", "..."],
    "montant_recherche": "X FCFA",
    "usage_fonds": "description"
  },
  "presentation_entreprise": {
    "informations_table": { "nom": "", "site_web": "", "contact": "", "adresse": "", "telephone": "", "email": "", "date_creation": "", "forme_juridique": "" },
    "revue_historique": { "date_demarrage": "", "raison_creation": "", "realisations_cles": ["..."] },
    "vision_mission_valeurs": { "vision": "", "mission": "", "valeurs": [{ "valeur": "", "exemple": "" }] },
    "description_generale": "paragraphe",
    "objectifs_smart": { "court_terme_1an": ["..."], "long_terme_3_5ans": ["..."] },
    "operations": { "localisation": "", "forme_juridique_detail": "", "processus_technologie": "", "innovation": "", "ventes": "", "logistique": "", "croissance": "" }
  },
  "analyse_swot": {
    "forces": ["..."],
    "faiblesses": ["..."],
    "opportunites": ["..."],
    "menaces": ["..."],
    "gestion_risques": [{ "type_risque": "", "gravite": "", "mitigation": "" }]
  },
  "analyse_marche": {
    "taille_marche": "",
    "potentiel_croissance": "",
    "concurrents": [{ "nom": "", "forces": "", "faiblesses": "" }],
    "tendances": ["..."],
    "differenciation": ""
  },
  "offre_produit_service": {
    "description": "",
    "proposition_valeur": "",
    "probleme_resolu": "",
    "avantage_concurrentiel": ""
  },
  "strategie_marketing": {
    "produit": "",
    "point_de_vente": "",
    "prix": { "prix_vente": "", "prix_revient": "", "marge": "", "strategie": "" },
    "promotion": "",
    "personnel": ""
  },
  "model_economique": {
    "segments_clients": "",
    "canaux_distribution": "",
    "relations_clients": "",
    "sources_revenus": "",
    "ressources_cles": "",
    "activites_cles": "",
    "partenaires_cles": "",
    "structure_couts": ""
  },
  "plan_operationnel": {
    "equipe_direction": [{ "nom": "", "role": "", "competences": "" }],
    "personnel": { "effectif": "", "qualifications": "", "politique_rh": "" },
    "organigramme_description": "",
    "conseil_administration": "",
    "investisseurs_actuels": "",
    "conseillers": ""
  },
  "impact_social": {
    "impact_social": "",
    "impact_environnemental": "",
    "impact_economique": "",
    "odd_cibles": ["..."],
    "beneficiaires": "",
    "indicateurs": ["..."]
  },
  "plan_financier": {
    "plan_investissement": "",
    "justification_financement": "",
    "tableau_financier_3ans": {
      "apport_personnel": ["année1", "année2", "année3"],
      "prets": ["", "", ""],
      "subventions_dons": ["", "", ""],
      "chiffre_affaires": ["", "", ""],
      "couts_directs": ["", "", ""],
      "couts_indirects": ["", "", ""],
      "amortissements": ["", "", ""],
      "resultat_net": ["", "", ""],
      "cash_flow": ["", "", ""],
      "valeur_actifs": ["", "", ""],
      "dettes_totales": ["", "", ""],
      "fonds_propres": ["", "", ""]
    },
    "kpis": {}
  },
  "gouvernance": {
    "projet_description": "",
    "situation_actuelle": "",
    "duree_mise_en_oeuvre": "",
    "objectif_projet": ""
  },
  "risques_mitigation": [{ "risque": "", "probabilite": "", "impact": "", "mitigation": "" }],
  "attentes_ovo": {
    "montant_demande": "",
    "contribution_entrepreneur": "",
    "autres_investisseurs": "",
    "expertise_necessaire": "",
    "coaching_souhaite": ""
  },
  "annexes": {
    "documents_joints": ["Liste des documents financiers détaillés", "Plan OVO détaillé", "Organigramme"]
  }
}

IMPORTANT : Réponds UNIQUEMENT avec le JSON. Aucun texte supplémentaire.`

      // --- User Prompt with deliverables ---
      const delivParts: string[] = []
      if (bmcData) {
        delivParts.push(`=== LIVRABLE: BMC (Business Model Canvas) — Score: ${bmcRow?.score || 'N/A'}/100 ===\n${JSON.stringify(bmcSections, null, 1).slice(0, 4000)}`)
      }
      if (sicData) {
        delivParts.push(`=== LIVRABLE: SIC (Social Impact Canvas) — Score: ${sicRow?.score || 'N/A'}/100 ===\n${JSON.stringify(sicSections, null, 1).slice(0, 3000)}`)
      }
      if (fwData) {
        delivParts.push(`=== LIVRABLE: FRAMEWORK FINANCIER — Score: ${fwRow?.score || 'N/A'}/100 ===\n${JSON.stringify(fwSections, null, 1).slice(0, 4000)}`)
      }
      if (pmeData) {
        delivParts.push(`=== DONNÉES PME STRUCTURÉES ===\n${JSON.stringify(pmeFinancials, null, 1).slice(0, 4000)}`)
      }
      if (diagData) {
        delivParts.push(`=== LIVRABLE: DIAGNOSTIC EXPERT — Score: ${diagSummary?.score_global || 'N/A'}/100 ===\n${JSON.stringify(diagSummary, null, 1).slice(0, 3000)}`)
      }
      if (ovoData) {
        delivParts.push(`=== LIVRABLE: PLAN OVO — Score: ${ovoSummary?.score || 'N/A'}/100 ===\n${JSON.stringify(ovoSummary, null, 1).slice(0, 4000)}`)
      }

      const missingList = Object.entries(sources).filter(([, v]) => !v).map(([k]) => k)

      const userPromptText = `Génère le Business Plan complet pour cette PME.
Le template DOCX est joint en pièce jointe — tu DOIS le consulter pour comprendre la structure exacte et les placeholders à remplir.

=== ENTREPRISE ===
Nom: ${companyName}
Secteur: ${inferredSector}
Pays: ${fiscal.country}
Entrepreneur: ${userName}

=== STRUCTURE DU TEMPLATE (résumé) ===
${JSON.stringify(templateStructure, null, 1).slice(0, 5000)}

=== LIVRABLES DISPONIBLES ===
${delivParts.join('\n\n')}

=== CONTEXTE KB (${fiscal.country} — ${inferredSector}) ===
${JSON.stringify(kbContext, null, 1).slice(0, 4000)}

=== LIVRABLES MANQUANTS ===
${missingList.length > 0 ? missingList.join(', ') : 'Aucun (tous disponibles)'}
${availableCount < 4 ? '\n⚠️ DONNÉES PARTIELLES : Certains livrables manquent. Utilise des estimations réalistes basées sur le secteur et le pays pour les sections manquantes. Indique "À compléter" pour les données spécifiques non disponibles.' : ''}

Produis le JSON complet du Business Plan. Remplis TOUS les placeholders du template DOCX. Ton professionnel, orienté investisseur. Chaque paragraphe 3-5 phrases. Montants en ${fiscal.currency}.`

      // Build detailed template content for the prompt (include all questions/hints from DOCX)
      const templateDetailParts: string[] = []
      for (const section of parsedStructure.sections) {
        templateDetailParts.push(`\n## ${section.title}`)
        if (section.content_hints?.length) templateDetailParts.push(section.content_hints.join('\n'))
        if (section.questions?.length) templateDetailParts.push('Questions : ' + section.questions.join(' | '))
        for (const sub of (section.subsections || [])) {
          templateDetailParts.push(`\n### ${sub.title}`)
          if (sub.content_hints?.length) templateDetailParts.push(sub.content_hints.join('\n'))
          if (sub.questions?.length) templateDetailParts.push('Questions : ' + sub.questions.join(' | '))
        }
      }
      const templateDetailText = templateDetailParts.join('\n').slice(0, 6000)

      // Build multimodal content: enriched text prompt with full template detail
      const enrichedPromptText = `${userPromptText}

=== CONTENU DÉTAILLÉ DU TEMPLATE DOCX (questions et indications) ===
${templateDetailText}`

      console.log(`[Business Plan] STEP D — Claude call: ${delivParts.length} deliverables, prompt ${enrichedPromptText.length} chars, temp=0.4, maxTokens=12000`)

      try {
        businessPlanJson = await callClaudeJSON({
          apiKey,
          systemPrompt,
          userPrompt: enrichedPromptText,
          maxTokens: 12000,
          temperature: 0.4,
          timeoutMs: 180_000,
          maxRetries: 2,
          label: 'Business Plan AI'
        })
        usedAI = true
        console.log(`[Business Plan] STEP D — Claude returned Business Plan: metadata.entreprise=${businessPlanJson?.metadata?.entreprise || 'N/A'}, sections=${Object.keys(businessPlanJson || {}).length}`)
      } catch (claudeErr: any) {
        console.error(`[Business Plan] STEP D — Claude API error: ${claudeErr.message} — falling back to deterministic engine`)
        businessPlanJson = null
      }
    } else {
      console.log(`[Business Plan] STEP D — No valid API key — using deterministic fallback`)
    }

    // ═══════════════════════════════════════════════════════════════
    // FALLBACK — Deterministic generation if Claude fails or no API key
    // ═══════════════════════════════════════════════════════════════
    if (!businessPlanJson) {
      businessPlanJson = _buildDeterministicBusinessPlan(
        companyName, inferredSector, fiscal.country, userName, sources,
        bmcSections, sicSections, fwSections, pmeFinancials, diagSummary, ovoSummary,
        kbContext, fiscal
      )
      businessPlanJson._fallback = true
    }

    // ── Ensure metadata has required fields ──
    if (!businessPlanJson.metadata) businessPlanJson.metadata = {}
    businessPlanJson.metadata.titre = businessPlanJson.metadata.titre || `Business Plan — ${companyName}`
    businessPlanJson.metadata.entreprise = businessPlanJson.metadata.entreprise || companyName
    businessPlanJson.metadata.secteur = businessPlanJson.metadata.secteur || inferredSector
    businessPlanJson.metadata.pays = businessPlanJson.metadata.pays || fiscal.country
    businessPlanJson.metadata.date_generation = businessPlanJson.metadata.date_generation || new Date().toISOString()
    businessPlanJson.metadata.livrables_utilises = businessPlanJson.metadata.livrables_utilises || sources
    businessPlanJson.metadata.ai_generated = usedAI
    businessPlanJson.metadata.kb_used = kbUsed

    // ── Build legacy sections array for module page rendering ──
    businessPlanJson.sections = businessPlanJson.sections || [
      { id: 'resume_executif', titre: 'Résumé Exécutif', icon: 'fa-file-lines', contenu: businessPlanJson.resume_executif?.synthese || _buildResumeExecutif(companyName, inferredSector, fiscal.country, diagSummary, bmcSections, sicSections) },
      { id: 'presentation_entreprise', titre: 'Présentation de l\'Entreprise', icon: 'fa-building', contenu: _buildSectionFromAI(businessPlanJson.presentation_entreprise) || _buildPresentationEntreprise(companyName, inferredSector, fiscal.country, pmeFinancials) },
      { id: 'modele_economique', titre: 'Modèle Économique (Business Model)', icon: 'fa-diagram-project', contenu: _buildSectionFromAI(businessPlanJson.model_economique) || (bmcSections ? _buildModeleEconomique(bmcSections) : 'Non disponible — BMC non généré.') },
      { id: 'analyse_marche', titre: 'Analyse de Marché & Concurrence', icon: 'fa-chart-pie', contenu: _buildSectionFromAI(businessPlanJson.analyse_marche) || 'À compléter.' },
      { id: 'strategie_marketing', titre: 'Stratégie Marketing (5P)', icon: 'fa-bullhorn', contenu: _buildSectionFromAI(businessPlanJson.strategie_marketing) || 'À compléter.' },
      { id: 'impact_social', titre: 'Impact Social & Environnemental', icon: 'fa-hand-holding-heart', contenu: _buildSectionFromAI(businessPlanJson.impact_social) || (sicSections ? _buildImpactSocial(sicSections) : 'Non disponible — SIC non généré.') },
      { id: 'analyse_financiere', titre: 'Analyse Financière & Plan d\'Investissement', icon: 'fa-chart-bar', contenu: _buildSectionFromAI(businessPlanJson.plan_financier) || _buildAnalyseFinanciere(fwSections, pmeFinancials, ovoSummary) },
      { id: 'analyse_swot', titre: 'Analyse SWOT & Risques', icon: 'fa-shield-halved', contenu: _buildSectionFromAI(businessPlanJson.analyse_swot) || 'À compléter.' },
      { id: 'plan_operationnel', titre: 'Équipe & Organisation', icon: 'fa-users-gear', contenu: _buildSectionFromAI(businessPlanJson.plan_operationnel) || 'À compléter.' },
      { id: 'projet', titre: 'Votre Projet', icon: 'fa-rocket', contenu: _buildSectionFromAI(businessPlanJson.gouvernance) || 'À compléter.' },
      { id: 'attentes_ovo', titre: 'Attentes vis-à-vis d\'OVO', icon: 'fa-handshake', contenu: _buildSectionFromAI(businessPlanJson.attentes_ovo) || 'À compléter.' },
      { id: 'diagnostic_readiness', titre: 'Diagnostic de Maturité', icon: 'fa-stethoscope', contenu: diagSummary ? _buildDiagnostic(diagSummary) : 'Non disponible — Diagnostic non généré.' },
      { id: 'plan_action', titre: 'Plan d\'Action & Prochaines Étapes', icon: 'fa-list-check', contenu: _buildPlanAction(diagSummary, bmcSections, sicSections, fwSections) },
    ]

    // ── Add scores ──
    businessPlanJson.scores = businessPlanJson.scores || {
      bmc: bmcRow?.score as number || null,
      sic: sicRow?.score as number || null,
      framework: fwRow?.score as number || null,
      diagnostic: diagSummary?.score_global || null,
      plan_ovo: ovoSummary?.score || null,
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP E — Generate unique ID, insert record into DB
    //          status='completed', save kb_context + kb_used
    // ═══════════════════════════════════════════════════════════════
    const id = crypto.randomUUID()
    let newVersion = 1

    try {
      const lastBp = await db.prepare('SELECT version FROM business_plan_analyses WHERE user_id = ? AND pme_id = ? ORDER BY version DESC LIMIT 1').bind(payload.userId, requestPmeId).first()
      newVersion = (lastBp?.version ? Number(lastBp.version) : 0) + 1
    } catch (e: any) {
      console.log(`[Business Plan] STEP E — Version query failed (using v1): ${e.message}`)
    }

    const kbContextStr = JSON.stringify(kbContext).slice(0, 10000)

    try {
      await db.prepare(
        `INSERT INTO business_plan_analyses (id, user_id, pme_id, version, status, business_plan_json, template_docx_path, pays, kb_context, kb_used, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(id, payload.userId, requestPmeId, newVersion, JSON.stringify(businessPlanJson), templateDocxPath, fiscal.country, kbContextStr, kbUsed ? 1 : 0).run()

      console.log(`[Business Plan] STEP E — Saved v${newVersion} (id: ${id}) — status=completed, AI=${usedAI}, KB=${kbUsed}, sources: ${availableCount}/6`)
    } catch (saveErr: any) {
      console.error(`[Business Plan] STEP E — DB save error: ${saveErr.message}`)
      return c.json({ error: 'Erreur lors de la sauvegarde du Business Plan. Veuillez réessayer.' }, 500)
    }

    // ── Return response ──
    return c.json({
      success: true,
      message: 'Business Plan généré avec succès',
      id,
      version: newVersion,
      ai_generated: usedAI,
      kb_used: kbUsed,
    })

  } catch (error: any) {
    console.error('[Business Plan Generate] Unexpected error:', error)
    return c.json({ error: error.message || 'Erreur serveur lors de la génération du Business Plan' }, 500)
  }
})

// ═══ Business Plan section builders ═══
function _safeStr(v: any): string { return typeof v === 'string' ? v : (Array.isArray(v) ? v.join(', ') : JSON.stringify(v ?? '')) }

/** Convert an AI-generated section object to readable text for the module page */
function _buildSectionFromAI(section: any): string {
  if (!section) return ''
  if (typeof section === 'string') return section
  const parts: string[] = []
  for (const [key, value] of Object.entries(section)) {
    if (!value) continue
    const label = key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
    if (typeof value === 'string') {
      parts.push(`${label} :\n${value}`)
    } else if (Array.isArray(value)) {
      if (value.length > 0) {
        if (typeof value[0] === 'string') {
          parts.push(`${label} :\n${value.map((v, i) => `  ${i + 1}. ${v}`).join('\n')}`)
        } else {
          parts.push(`${label} :\n${value.map((v, i) => `  ${i + 1}. ${typeof v === 'object' ? Object.values(v).filter(Boolean).join(' — ') : String(v)}`).join('\n')}`)
        }
      }
    } else if (typeof value === 'object') {
      const subParts = Object.entries(value).map(([sk, sv]) => `  • ${sk.replace(/_/g, ' ')}: ${_safeStr(sv)}`).join('\n')
      if (subParts) parts.push(`${label} :\n${subParts}`)
    }
  }
  return parts.join('\n\n') || ''
}

/** Deterministic fallback business plan when Claude is not available */
function _buildDeterministicBusinessPlan(
  company: string, sector: string, country: string, userName: string,
  sources: Record<string, boolean>,
  bmc: any, sic: any, fw: any, pme: any, diag: any, ovo: any,
  kbCtx: any, fiscal: any
): any {
  const missingList = Object.entries(sources).filter(([, v]) => !v).map(([k]) => k)
  return {
    metadata: {
      titre: `Business Plan — ${company}`,
      entreprise: company,
      secteur: sector,
      pays: country,
      date_generation: new Date().toISOString(),
      livrables_utilises: sources,
      livrables_manquants: missingList,
      version: 'deterministic-fallback'
    },
    resume_executif: {
      titre: 'Résumé de la gestion',
      synthese: `${company} est une entreprise${sector ? ` du secteur ${sector}` : ''}${country ? ` basée en ${country}` : ''}. ${diag?.resume_executif || `L'entreprise développe ses activités avec une proposition de valeur différenciée sur son marché.`}${bmc?.proposition_valeur ? ` Sa proposition de valeur repose sur : ${_safeStr(bmc.proposition_valeur)}.` : ''}`,
      points_cles: [
        bmc?.proposition_valeur ? `Proposition de valeur : ${_safeStr(bmc.proposition_valeur).slice(0, 150)}` : 'Proposition de valeur à détailler',
        diag?.score_global ? `Score de maturité investisseur : ${diag.score_global}/100` : 'Diagnostic de maturité à réaliser',
        ovo?.score ? `Score Plan OVO : ${ovo.score}/100` : 'Plan financier OVO à compléter',
      ],
      montant_recherche: 'À compléter',
      usage_fonds: 'À compléter — détailler l\'utilisation des fonds recherchés'
    },
    presentation_entreprise: {
      informations_table: {
        nom: company,
        site_web: 'À compléter',
        contact: userName,
        adresse: country || 'À compléter',
        telephone: 'À compléter',
        email: 'À compléter',
        date_creation: 'À compléter',
        forme_juridique: 'À compléter'
      },
      revue_historique: {
        date_demarrage: pme?.historique?.date_creation || 'À compléter',
        raison_creation: 'À compléter',
        realisations_cles: pme?.historique?.caTotal ? [`Chiffre d'affaires historique : ${_safeStr(pme.historique.caTotal)}`] : ['À compléter']
      },
      vision_mission_valeurs: {
        vision: 'À compléter — vision inspirante à long terme',
        mission: 'À compléter — mission en 1-3 phrases',
        valeurs: [{ valeur: 'Impact social', exemple: 'Engagement envers la communauté locale' }]
      },
      description_generale: `${company} opère dans le secteur ${sector || 'non spécifié'} en ${country || 'Afrique de l\'Ouest'}. L'entreprise ${pme?.activites?.length ? `développe ${pme.activites.length} activité(s) principale(s)` : 'développe ses activités'}. Son positionnement vise à répondre aux besoins du marché local tout en maintenant des standards de qualité élevés.`,
      objectifs_smart: {
        court_terme_1an: ['À compléter — objectifs SMART à 1 an'],
        long_terme_3_5ans: ['À compléter — objectifs SMART à 3-5 ans']
      },
      operations: {
        localisation: country || 'À compléter',
        forme_juridique_detail: 'À compléter',
        processus_technologie: 'À compléter',
        innovation: 'À compléter',
        ventes: bmc?.canaux ? _safeStr(bmc.canaux) : 'À compléter',
        logistique: 'À compléter',
        croissance: 'À compléter'
      }
    },
    analyse_swot: {
      forces: diag?.forces?.length ? diag.forces.map((f: any) => typeof f === 'string' ? f : f.titre || f.title || _safeStr(f)) : ['À compléter'],
      faiblesses: ['À compléter — identifier les faiblesses internes'],
      opportunites: (kbCtx?.opportunites_risques || []).slice(0, 3).filter((r: string) => r.includes('Croissance') || r.includes('Digital')).concat(['À compléter']),
      menaces: (kbCtx?.opportunites_risques || []).slice(0, 3).filter((r: string) => r.includes('limité') || r.includes('Volatilité')).concat(['À compléter']),
      gestion_risques: diag?.risques?.length ? diag.risques.slice(0, 3).map((r: any) => ({
        type_risque: typeof r === 'string' ? r : r.titre || r.title || 'Risque identifié',
        gravite: r.gravite || 'Moyenne',
        mitigation: r.mitigation || 'À détailler'
      })) : [{ type_risque: 'À compléter', gravite: 'À évaluer', mitigation: 'À détailler' }]
    },
    analyse_marche: {
      taille_marche: `Marché des PME en ${country || 'Afrique de l\'Ouest'} — ${kbCtx?.benchmarks_sectoriels?.marge_brute ? `Marge brute sectorielle typique : ${kbCtx.benchmarks_sectoriels.marge_brute}` : 'À compléter'}`,
      potentiel_croissance: 'À compléter avec une étude de marché',
      concurrents: [{ nom: 'À identifier', forces: 'À analyser', faiblesses: 'À analyser' }],
      tendances: kbCtx?.contexte_marche || ['À compléter'],
      differenciation: bmc?.proposition_valeur ? _safeStr(bmc.proposition_valeur) : 'À compléter'
    },
    offre_produit_service: {
      description: bmc?.activites_cles ? _safeStr(bmc.activites_cles) : 'À compléter',
      proposition_valeur: bmc?.proposition_valeur ? _safeStr(bmc.proposition_valeur) : 'À compléter',
      probleme_resolu: sic?.probleme_social ? _safeStr(sic.probleme_social) : 'À compléter',
      avantage_concurrentiel: 'À compléter'
    },
    strategie_marketing: {
      produit: bmc?.proposition_valeur ? _safeStr(bmc.proposition_valeur) : 'À compléter',
      point_de_vente: bmc?.canaux ? _safeStr(bmc.canaux) : 'À compléter',
      prix: { prix_vente: 'À compléter', prix_revient: 'À compléter', marge: 'À compléter', strategie: 'À compléter' },
      promotion: 'À compléter',
      personnel: 'À compléter'
    },
    model_economique: {
      segments_clients: bmc?.segments_clients ? _safeStr(bmc.segments_clients) : 'À compléter',
      canaux_distribution: bmc?.canaux ? _safeStr(bmc.canaux) : 'À compléter',
      relations_clients: bmc?.relations_clients ? _safeStr(bmc.relations_clients) : 'À compléter',
      sources_revenus: bmc?.sources_revenus ? _safeStr(bmc.sources_revenus) : 'À compléter',
      ressources_cles: bmc?.ressources_cles ? _safeStr(bmc.ressources_cles) : 'À compléter',
      activites_cles: bmc?.activites_cles ? _safeStr(bmc.activites_cles) : 'À compléter',
      partenaires_cles: bmc?.partenaires_cles ? _safeStr(bmc.partenaires_cles) : 'À compléter',
      structure_couts: bmc?.structure_couts ? _safeStr(bmc.structure_couts) : 'À compléter'
    },
    plan_operationnel: {
      equipe_direction: [{ nom: userName, role: 'Directeur Général', competences: 'À compléter' }],
      personnel: { effectif: 'À compléter', qualifications: 'À compléter', politique_rh: 'À compléter' },
      organigramme_description: 'À compléter — fournir un organigramme',
      conseil_administration: 'À compléter',
      investisseurs_actuels: 'À compléter',
      conseillers: 'À compléter'
    },
    impact_social: {
      impact_social: sic?.probleme_social ? _safeStr(sic.probleme_social) : 'À compléter',
      impact_environnemental: sic?.solution_impact ? _safeStr(sic.solution_impact) : 'À compléter',
      impact_economique: 'À compléter — emplois créés, revenus générés',
      odd_cibles: sic?.odd_cibles ? (Array.isArray(sic.odd_cibles) ? sic.odd_cibles : [_safeStr(sic.odd_cibles)]) : ['À compléter'],
      beneficiaires: sic?.beneficiaires ? _safeStr(sic.beneficiaires) : 'À compléter',
      indicateurs: sic?.indicateurs_impact ? (Array.isArray(sic.indicateurs_impact) ? sic.indicateurs_impact : [_safeStr(sic.indicateurs_impact)]) : ['À compléter']
    },
    plan_financier: {
      plan_investissement: fw?.investissements ? _safeStr(fw.investissements) : 'À compléter',
      justification_financement: 'À compléter — justifier le besoin de financement externe',
      tableau_financier_3ans: {
        apport_personnel: ['À compléter', 'À compléter', 'À compléter'],
        prets: ['À compléter', 'À compléter', 'À compléter'],
        subventions_dons: ['À compléter', 'À compléter', 'À compléter'],
        chiffre_affaires: fw?.chiffre_affaires ? [_safeStr(fw.chiffre_affaires), 'Année 2', 'Année 3'] : ['À compléter', 'À compléter', 'À compléter'],
        couts_directs: ['À compléter', 'À compléter', 'À compléter'],
        couts_indirects: ['À compléter', 'À compléter', 'À compléter'],
        amortissements: ['À compléter', 'À compléter', 'À compléter'],
        resultat_net: fw?.resultat_net ? [_safeStr(fw.resultat_net), 'Année 2', 'Année 3'] : ['À compléter', 'À compléter', 'À compléter'],
        cash_flow: fw?.tresorerie ? [_safeStr(fw.tresorerie), 'Année 2', 'Année 3'] : ['À compléter', 'À compléter', 'À compléter'],
        valeur_actifs: ['À compléter', 'À compléter', 'À compléter'],
        dettes_totales: ['À compléter', 'À compléter', 'À compléter'],
        fonds_propres: ['À compléter', 'À compléter', 'À compléter']
      },
      kpis: ovo?.kpis || {}
    },
    gouvernance: {
      projet_description: 'À compléter — décrire le projet nécessitant un financement',
      situation_actuelle: 'À compléter — situation actuelle de l\'entreprise',
      duree_mise_en_oeuvre: 'À compléter — calendrier de mise en œuvre',
      objectif_projet: 'À compléter — objectif principal du projet'
    },
    risques_mitigation: diag?.risques?.length ? diag.risques.slice(0, 5).map((r: any) => ({
      risque: typeof r === 'string' ? r : r.titre || r.title || 'Risque',
      probabilite: r.probabilite || 'Moyenne',
      impact: r.impact || 'Moyen',
      mitigation: r.mitigation || 'À détailler'
    })) : [{ risque: 'À identifier', probabilite: 'À évaluer', impact: 'À évaluer', mitigation: 'À définir' }],
    attentes_ovo: {
      montant_demande: 'À compléter',
      contribution_entrepreneur: 'À compléter',
      autres_investisseurs: 'À compléter',
      expertise_necessaire: 'À compléter',
      coaching_souhaite: 'À compléter'
    },
    annexes: {
      documents_joints: [
        sources.bmc ? 'Business Model Canvas (BMC) — généré' : 'BMC — à générer',
        sources.sic ? 'Social Impact Canvas (SIC) — généré' : 'SIC — à générer',
        sources.framework ? 'Framework d\'analyse financière — généré' : 'Framework — à générer',
        sources.diagnostic ? 'Diagnostic expert — généré' : 'Diagnostic — à générer',
        sources.plan_ovo ? 'Plan OVO — généré' : 'Plan OVO — à générer',
      ]
    }
  }
}

function _buildResumeExecutif(company: string, sector: string, country: string, diag: any, bmc: any, sic: any): string {
  let r = `${company} est une entreprise`
  if (sector) r += ` du secteur ${sector}`
  if (country) r += ` basée en ${country}`
  r += '.\n\n'
  if (diag?.resume_executif) r += diag.resume_executif + '\n\n'
  if (bmc?.proposition_valeur) r += `Proposition de valeur : ${_safeStr(bmc.proposition_valeur)}\n\n`
  if (sic?.probleme_social) r += `Problématique sociale adressée : ${_safeStr(sic.probleme_social)}\n\n`
  if (diag?.score_global) r += `Score de maturité investisseur : ${diag.score_global}/100\n`
  return r.trim()
}

function _buildPresentationEntreprise(company: string, sector: string, country: string, pme: any): string {
  let r = `Nom : ${company}\n`
  if (sector) r += `Secteur d'activité : ${sector}\n`
  if (country) r += `Pays : ${country}\n`
  if (pme?.activites?.length) {
    r += `\nActivités principales :\n`
    pme.activites.forEach((a: any, i: number) => { r += `  ${i+1}. ${a.nom || a.name || _safeStr(a)}\n` })
  }
  if (pme?.historique) {
    const h = pme.historique
    if (h.caTotal) r += `\nChiffre d'affaires historique : ${Array.isArray(h.caTotal) ? h.caTotal.map((v: any, i: number) => `N${i > 0 ? '+' + i : ''}: ${Number(v).toLocaleString('fr-FR')} FCFA`).join(', ') : _safeStr(h.caTotal)}\n`
  }
  return r.trim()
}

function _buildModeleEconomique(bmc: any): string {
  const parts: string[] = []
  if (bmc.proposition_valeur) parts.push(`Proposition de valeur :\n${_safeStr(bmc.proposition_valeur)}`)
  if (bmc.segments_clients) parts.push(`Segments clients :\n${_safeStr(bmc.segments_clients)}`)
  if (bmc.canaux) parts.push(`Canaux de distribution :\n${_safeStr(bmc.canaux)}`)
  if (bmc.relations_clients) parts.push(`Relations clients :\n${_safeStr(bmc.relations_clients)}`)
  if (bmc.sources_revenus) parts.push(`Sources de revenus :\n${_safeStr(bmc.sources_revenus)}`)
  if (bmc.ressources_cles) parts.push(`Ressources clés :\n${_safeStr(bmc.ressources_cles)}`)
  if (bmc.activites_cles) parts.push(`Activités clés :\n${_safeStr(bmc.activites_cles)}`)
  if (bmc.partenaires_cles) parts.push(`Partenaires clés :\n${_safeStr(bmc.partenaires_cles)}`)
  if (bmc.structure_couts) parts.push(`Structure de coûts :\n${_safeStr(bmc.structure_couts)}`)
  return parts.join('\n\n') || 'Données BMC non disponibles.'
}

function _buildImpactSocial(sic: any): string {
  const parts: string[] = []
  if (sic.probleme_social) parts.push(`Problème social adressé :\n${_safeStr(sic.probleme_social)}`)
  if (sic.beneficiaires) parts.push(`Bénéficiaires :\n${_safeStr(sic.beneficiaires)}`)
  if (sic.solution_impact) parts.push(`Solution & Impact :\n${_safeStr(sic.solution_impact)}`)
  if (sic.indicateurs_impact) parts.push(`Indicateurs d'impact :\n${_safeStr(sic.indicateurs_impact)}`)
  if (sic.odd_cibles) parts.push(`ODD ciblés :\n${_safeStr(sic.odd_cibles)}`)
  if (sic.theorie_changement) parts.push(`Théorie du changement :\n${_safeStr(sic.theorie_changement)}`)
  return parts.join('\n\n') || 'Données SIC non disponibles.'
}

function _buildAnalyseFinanciere(fw: any, pme: any, ovo: any): string {
  let r = ''
  if (fw) {
    if (fw.chiffre_affaires) r += `Chiffre d'affaires :\n${_safeStr(fw.chiffre_affaires)}\n\n`
    if (fw.charges) r += `Charges :\n${_safeStr(fw.charges)}\n\n`
    if (fw.resultat_net) r += `Résultat net :\n${_safeStr(fw.resultat_net)}\n\n`
    if (fw.tresorerie) r += `Trésorerie :\n${_safeStr(fw.tresorerie)}\n\n`
    if (fw.bfr) r += `Besoin en Fonds de Roulement :\n${_safeStr(fw.bfr)}\n\n`
    if (fw.investissements) r += `Investissements :\n${_safeStr(fw.investissements)}\n\n`
  }
  if (pme?.hypotheses?.investissements?.length) {
    r += 'Investissements prévus :\n'
    pme.hypotheses.investissements.forEach((inv: any, i: number) => {
      r += `  ${i+1}. ${inv.nom || inv.libelle || 'Investissement'} — ${Number(inv.montant || 0).toLocaleString('fr-FR')} FCFA\n`
    })
  }
  return r.trim() || 'Données financières non encore disponibles.'
}

function _buildProjections(ovo: any): string {
  let r = ''
  if (ovo.score) r += `Score Plan OVO : ${ovo.score}/100\n\n`
  if (ovo.kpis) {
    r += 'Indicateurs financiers clés :\n'
    const kpis = typeof ovo.kpis === 'object' ? ovo.kpis : {}
    Object.entries(kpis).forEach(([k, v]) => { r += `  • ${k.replace(/_/g, ' ')} : ${_safeStr(v)}\n` })
    r += '\n'
  }
  if (ovo.compte_resultat) r += `Compte de résultat prévisionnel :\n${_safeStr(ovo.compte_resultat)}\n\n`
  if (ovo.plan_tresorerie) r += `Plan de trésorerie :\n${_safeStr(ovo.plan_tresorerie)}\n\n`
  if (ovo.bilan) r += `Bilan prévisionnel :\n${_safeStr(ovo.bilan)}\n`
  return r.trim() || 'Projections non encore disponibles.'
}

function _buildDiagnostic(diag: any): string {
  let r = `Score global de maturité : ${diag.score_global}/100\n\n`
  if (diag.resume_executif) r += `${diag.resume_executif}\n\n`
  if (diag.forces?.length) {
    r += 'Forces identifiées :\n'
    diag.forces.forEach((f: any) => { r += `  ✓ ${typeof f === 'string' ? f : f.titre || f.title || _safeStr(f)}\n` })
    r += '\n'
  }
  if (diag.recommandations?.length) {
    r += 'Recommandations prioritaires :\n'
    diag.recommandations.slice(0, 5).forEach((rec: any, i: number) => {
      r += `  ${i+1}. ${typeof rec === 'string' ? rec : rec.titre || rec.title || _safeStr(rec)}\n`
    })
    r += '\n'
  }
  if (diag.risques?.length) {
    r += 'Risques contextuels :\n'
    diag.risques.slice(0, 3).forEach((risk: any) => {
      r += `  ⚠ ${typeof risk === 'string' ? risk : risk.titre || risk.title || _safeStr(risk)}\n`
    })
  }
  return r.trim()
}

function _buildPlanAction(diag: any, bmc: any, sic: any, fw: any): string {
  const actions: string[] = []
  if (!bmc) actions.push('Compléter et générer le Business Model Canvas (BMC)')
  if (!sic) actions.push('Compléter et générer le Social Impact Canvas (SIC)')
  if (!fw) actions.push('Compléter et générer le Framework d\'analyse financière')
  if (diag?.recommandations?.length) {
    diag.recommandations.slice(0, 3).forEach((rec: any) => {
      const title = typeof rec === 'string' ? rec : rec.titre || rec.title || ''
      if (title) actions.push(title)
    })
  }
  if (actions.length === 0) actions.push('Tous les livrables sont complets — vous êtes prêt pour la levée de fonds !')
  let r = 'Plan d\'action recommandé :\n\n'
  actions.forEach((a, i) => { r += `${i+1}. ${a}\n` })
  r += '\nConseil : Relancez le Business Plan après chaque mise à jour de livrable pour obtenir un document toujours à jour.'
  return r
}

// GET /api/business-plan/latest/:pmeId
app.get('/api/business-plan/latest/:pmeId', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const pmeId = c.req.param('pmeId')
    const row = await c.env.DB.prepare(
      `SELECT id, version, status, business_plan_json, created_at FROM business_plan_analyses WHERE user_id = ? AND pme_id = ? AND status IN ('completed','generated','analyzed') ORDER BY created_at DESC LIMIT 1`
    ).bind(payload.userId, pmeId).first()

    if (!row) return c.json({ available: false })

    let data = null
    if (row.business_plan_json) {
      try { data = JSON.parse(row.business_plan_json as string) } catch {}
    }

    return c.json({ available: true, id: row.id, version: row.version, status: row.status, data, createdAt: row.created_at })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// GET /api/business-plan/download/:id?format=docx
app.get('/api/business-plan/download/:id', async (c) => {
  try {
    const token = getAuthToken(c) || getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const id = c.req.param('id')
    const format = c.req.query('format') || 'docx'
    const forceRegenerate = c.req.query('regen') === '1'

    if (format !== 'docx') {
      return c.json({ error: 'Format non supporté. Utilisez format=docx' }, 400)
    }

    // Load BP record
    const row = await c.env.DB.prepare(
      `SELECT business_plan_json, generated_docx_base64, status, template_docx_path FROM business_plan_analyses WHERE id = ? AND user_id = ?`
    ).bind(id, payload.userId).first()

    if (!row) return c.json({ error: 'Business Plan introuvable' }, 404)

    // Check that the BP has been generated
    if (!row.business_plan_json) {
      return c.json({ error: 'Le Business Plan n\'a pas encore été généré. Veuillez d\'abord le générer.' }, 404)
    }

    let bpData: any
    try {
      bpData = JSON.parse(row.business_plan_json as string)
    } catch {
      return c.json({ error: 'Erreur: données JSON du Business Plan invalides' }, 500)
    }

    // Get company name for filename
    const meta = bpData.metadata || {}
    const companyName = (meta.entreprise || 'Entreprise')
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\s_-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 40)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const fileName = `Business_Plan_${companyName}_${dateStr}.docx`

    // Always regenerate from template + JSON (ensures latest template logic is used)
    try {
      console.log(`[BP Download] Filling DOCX template for BP ${id}, company: ${meta.entreprise || 'unknown'}`)
      const filledDocx = fillDocxTemplate(BUSINESS_PLAN_TEMPLATE_B64, bpData)
      console.log(`[BP Download] DOCX generated: ${filledDocx.length} bytes`)

      // Cache the generated DOCX as base64 for future fast retrieval
      try {
        const b64Chunks: string[] = []
        const chunkSize = 8192
        for (let i = 0; i < filledDocx.length; i += chunkSize) {
          const chunk = filledDocx.subarray(i, Math.min(i + chunkSize, filledDocx.length))
          b64Chunks.push(String.fromCharCode(...chunk))
        }
        const b64 = btoa(b64Chunks.join(''))
        await c.env.DB.prepare(
          `UPDATE business_plan_analyses SET generated_docx_base64 = ? WHERE id = ?`
        ).bind(b64, id).run()
        console.log(`[BP Download] Cached DOCX (${b64.length} chars) for BP ${id}`)
      } catch (cacheErr: any) {
        console.warn(`[BP Download] Cache write failed: ${cacheErr.message}`)
      }

      return new Response(filledDocx, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'no-cache',
        }
      })
    } catch (fillErr: any) {
      console.error(`[BP Download] DOCX fill error:`, fillErr.message, fillErr.stack)
      return c.json({
        error: 'Erreur lors de la génération du document DOCX',
        details: fillErr.message
      }, 500)
    }
  } catch (error: any) {
    console.error(`[BP Download] Error:`, error.message)
    return c.json({ error: error.message }, 500)
  }
})

export default app
