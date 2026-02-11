import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken } from './auth'
import {
  businessModelCanvasContent,
  financialAnalysisContent,
  getGuidedQuestionsForModule,
  getLearningModuleDefinition,
  getLearningStageKeysForModule,
  getModuleContentByCode,
  getModuleVariant,
  getStageRouteForModule,
  LEARNING_STAGE_SEQUENCE,
  LearningStageKey,
  ModuleContent,
  ModuleVariant
} from './module-content'
import { generateMockFeedback, calculateOverallScore, getScoreLabel, getSectionName } from './ai-feedback'
import { analyzeSIC, generateSicDiagnosticHtml, getSicScoreLabel, SIC_SECTION_LABELS, QUESTION_SECTION_MAP as SIC_QUESTION_MAP, type SicAnalysisResult, type SicSectionScore, ODD_ICONS, ODD_LABELS } from './sic-engine'
import {
  analyzeInputs, generateInputsDiagnosticHtml, getInputsReadinessLabel,
  INPUT_TAB_ORDER, INPUT_TAB_LABELS, TAB_COACHING, TAB_FIELDS, scoreTab,
  type InputTabKey, type InputsAnalysisResult, type TabScore
} from './inputs-engine'


type Bindings = {
  DB: D1Database
}

export const moduleRoutes = new Hono<{ Bindings: Bindings }>()

const MIN_VALIDATION_SCORE = 60

const MODULE_CONTENT_FALLBACK: Record<ModuleVariant, ModuleContent> = {
  canvas: businessModelCanvasContent,
  finance: financialAnalysisContent
}

const getModuleContent = (moduleCode: string): ModuleContent | null => {
  const directContent = getModuleContentByCode(moduleCode)
  if (directContent) {
    return directContent
  }

  const variant = getModuleVariant(moduleCode)
  return MODULE_CONTENT_FALLBACK[variant] ?? null
}

const ANALYSIS_PALETTES = {
  green: {
    gradient: 'from-green-500 to-green-600',
    badge: 'bg-green-100',
    badgeText: 'text-green-800',
    text: 'text-green-600',
    progress: 'bg-green-500',
    border: 'border-green-200',
    background: 'bg-green-50',
    icon: 'text-green-500'
  },
  blue: {
    gradient: 'from-blue-500 to-blue-600',
    badge: 'bg-blue-100',
    badgeText: 'text-blue-800',
    text: 'text-blue-600',
    progress: 'bg-blue-500',
    border: 'border-blue-200',
    background: 'bg-blue-50',
    icon: 'text-blue-500'
  },
  yellow: {
    gradient: 'from-yellow-400 to-yellow-500',
    badge: 'bg-yellow-100',
    badgeText: 'text-yellow-800',
    text: 'text-yellow-600',
    progress: 'bg-yellow-400',
    border: 'border-yellow-200',
    background: 'bg-yellow-50',
    icon: 'text-yellow-500'
  },
  red: {
    gradient: 'from-red-500 to-red-600',
    badge: 'bg-red-100',
    badgeText: 'text-red-800',
    text: 'text-red-600',
    progress: 'bg-red-500',
    border: 'border-red-200',
    background: 'bg-red-50',
    icon: 'text-red-500'
  }
} as const

export type AnalysisPaletteKey = keyof typeof ANALYSIS_PALETTES

export const getAnalysisPalette = (paletteKey: string) =>
  ANALYSIS_PALETTES[(paletteKey as AnalysisPaletteKey)] ?? ANALYSIS_PALETTES.blue

const parseDateValue = (value?: string | null) => {
  if (!value) return null
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const withTimezone = normalized.endsWith('Z') ? normalized : `${normalized}Z`
  const date = new Date(withTimezone)
  return Number.isNaN(date.getTime()) ? null : date
}

const formatDateValue = (value?: string | null, fallback = 'Non disponible') => {
  const date = parseDateValue(value)
  return date
    ? date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : fallback
}

const getGuidedQuestions = (moduleCode: string) => {
  return getGuidedQuestionsForModule(moduleCode)
}

type CanvasSection = {
  order: number
  questionId: number
  section: string
  question: string
  answer: string
  score: number | null
  scoreLabel: string
  suggestions: string[]
  questions: string[]
}

const SCORE_BADGE_STYLES = {
  Excellent: { badge: 'bg-green-100 text-green-700', icon: 'fas fa-star' },
  Bien: { badge: 'bg-blue-100 text-blue-700', icon: 'fas fa-thumbs-up' },
  "À améliorer": { badge: 'bg-yellow-100 text-yellow-700', icon: 'fas fa-lightbulb' },
  Insuffisant: { badge: 'bg-red-100 text-red-700', icon: 'fas fa-triangle-exclamation' },
  default: { badge: 'bg-gray-100 text-gray-700', icon: 'fas fa-circle-info' }
} as const

const SCORE_TONES = {
  Excellent: {
    barColor: 'var(--esono-success)',
    badgeBackground: 'var(--esono-success-light)',
    badgeColor: 'var(--esono-success)',
    borderColor: 'rgba(5, 150, 105, 0.3)',
    backgroundColor: 'rgba(5, 150, 105, 0.08)',
    iconColor: 'var(--esono-success)'
  },
  Bien: {
    barColor: 'var(--esono-info)',
    badgeBackground: 'var(--esono-info-light)',
    badgeColor: 'var(--esono-info)',
    borderColor: 'rgba(2, 132, 199, 0.3)',
    backgroundColor: 'rgba(2, 132, 199, 0.08)',
    iconColor: 'var(--esono-info)'
  },
  "À améliorer": {
    barColor: 'var(--esono-warning)',
    badgeBackground: 'var(--esono-warning-light)',
    badgeColor: 'var(--esono-warning)',
    borderColor: 'rgba(217, 119, 6, 0.3)',
    backgroundColor: 'rgba(217, 119, 6, 0.08)',
    iconColor: 'var(--esono-warning)'
  },
  Insuffisant: {
    barColor: 'var(--esono-danger)',
    badgeBackground: 'var(--esono-danger-light)',
    badgeColor: 'var(--esono-danger)',
    borderColor: 'rgba(220, 38, 38, 0.3)',
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    iconColor: 'var(--esono-danger)'
  },
  default: {
    barColor: 'var(--esono-secondary)',
    badgeBackground: 'var(--esono-gray-100)',
    badgeColor: 'var(--esono-secondary)',
    borderColor: 'rgba(58, 95, 149, 0.3)',
    backgroundColor: 'rgba(58, 95, 149, 0.08)',
    iconColor: 'var(--esono-secondary)'
  }
} as const

type ScoreToneKey = keyof typeof SCORE_TONES

const getScoreToneStyles = (label: string) =>
  SCORE_TONES[(label as ScoreToneKey)] ?? SCORE_TONES.default

type NavItem = {
  id: string
  label: string
  icon: string
  href: string
}

type BreadcrumbItem = {
  label: string
  href?: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: 'fas fa-chart-line', href: '/dashboard' },
  { id: 'mod1_bmc', label: '1. BMC', icon: 'fas fa-diagram-project', href: '/module/mod1_bmc' },
  { id: 'mod2_sic', label: '2. Impact Social', icon: 'fas fa-hand-holding-heart', href: '/module/mod2_sic' },
  { id: 'mod3_inputs', label: '3. Inputs Financiers', icon: 'fas fa-calculator', href: '/module/mod3_inputs' },
  { id: 'mod4_framework', label: '4. Framework', icon: 'fas fa-chart-bar', href: '/module/mod4_framework' },
  { id: 'mod5_diagnostic', label: '5. Diagnostic', icon: 'fas fa-stethoscope', href: '/module/mod5_diagnostic' },
  { id: 'mod6_ovo', label: '6. Plan OVO', icon: 'fas fa-file-excel', href: '/module/mod6_ovo' },
  { id: 'mod7_business_plan', label: '7. Business Plan', icon: 'fas fa-file-word', href: '/module/mod7_business_plan' },
  { id: 'mod8_odd', label: '8. ODD', icon: 'fas fa-globe-africa', href: '/module/mod8_odd' },
  { id: 'livrables', label: 'Livrables', icon: 'fas fa-download', href: '/livrables' }
]

const FINANCE_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: 'fas fa-chart-line', href: '/dashboard' },
  { id: 'mod3_inputs', label: '3. Inputs Financiers', icon: 'fas fa-calculator', href: '/module/mod3_inputs' },
  { id: 'module_finance_inputs', label: 'Saisie données', icon: 'fas fa-keyboard', href: '/module/mod3_inputs/inputs' },
  { id: 'module_finance_analysis', label: 'Analyse IA', icon: 'fas fa-robot', href: '/module/mod3_inputs/analysis' },
  { id: 'module_finance_validation', label: 'Validation', icon: 'fas fa-badge-check', href: '/module/mod3_inputs/validate' },
  { id: 'module_finance_deliverable', label: 'Livrable', icon: 'fas fa-file-signature', href: '/module/mod3_inputs/download' },
  { id: 'livrables', label: 'Livrables', icon: 'fas fa-download', href: '/livrables' }
]

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

const getFinancialInputsRow = async (db: D1Database, userId: number, moduleId: number) => {
  const row = await db.prepare(`
    SELECT *
    FROM financial_inputs
    WHERE user_id = ? AND module_id = ?
    LIMIT 1
  `).bind(userId, moduleId).first()

  return row ? (row as Record<string, unknown>) : null
}

type FinancialFieldType = 'currency' | 'percent' | 'number' | 'text' | 'textarea'

type FinancialFieldConfig = {
  key: string
  label: string
  type: FinancialFieldType
  placeholder?: string
  hint?: string
}

type FinancialSectionConfig = {
  id: string
  title: string
  icon: string
  description: string
  fields: FinancialFieldConfig[]
}

const FINANCIAL_SECTIONS: FinancialSectionConfig[] = [
  {
    id: 'revenues',
    title: "Chiffre d'affaires & marges",
    icon: 'fas fa-chart-line',
    description: 'Structurez vos revenus et calculs de marge brute.',
    fields: [
      { key: 'period_label', label: 'Période analysée', type: 'text', placeholder: 'Ex : Janvier - Décembre 2025' },
      { key: 'currency', label: 'Devise principale', type: 'text', placeholder: 'Ex : XOF, EUR, USD', hint: 'Code ISO sur 3 lettres.' },
      { key: 'revenue_total', label: "Chiffre d'affaires total", type: 'currency', placeholder: 'Ex : 18500000' },
      { key: 'revenue_recurring', label: 'Revenus récurrents', type: 'currency', placeholder: 'Ex : 12500000' },
      { key: 'revenue_one_time', label: 'Revenus ponctuels', type: 'currency', placeholder: 'Ex : 6000000' },
      { key: 'cogs_total', label: 'Coûts variables (COGS)', type: 'currency', placeholder: 'Ex : 7200000' },
      { key: 'gross_margin_pct', label: 'Marge brute (%)', type: 'percent', placeholder: 'Ex : 58' }
    ]
  },
  {
    id: 'costs',
    title: 'Structure de coûts & dépenses',
    icon: 'fas fa-wallet',
    description: 'Précisez vos principaux postes de dépenses fixes et variables.',
    fields: [
      { key: 'operating_expenses', label: 'Charges opérationnelles', type: 'currency', placeholder: 'Ex : 4500000' },
      { key: 'payroll_expenses', label: 'Masse salariale', type: 'currency', placeholder: 'Ex : 3200000' },
      { key: 'marketing_expenses', label: 'Marketing & acquisition', type: 'currency', placeholder: 'Ex : 2100000' },
      { key: 'other_expenses', label: 'Autres charges', type: 'currency', placeholder: 'Ex : 900000' }
    ]
  },
  {
    id: 'profitability',
    title: 'Rentabilité & performance',
    icon: 'fas fa-chart-pie',
    description: 'Mesurez la profitabilité opérationnelle de votre activité.',
    fields: [
      { key: 'ebitda', label: 'EBITDA', type: 'currency', placeholder: 'Ex : 2100000' },
      { key: 'net_income', label: 'Résultat net', type: 'currency', placeholder: 'Ex : 1250000' }
    ]
  },
  {
    id: 'cash',
    title: 'Trésorerie & dette',
    icon: 'fas fa-piggy-bank',
    description: 'Évaluez votre trésorerie disponible et la pression liée à la dette.',
    fields: [
      { key: 'cash_on_hand', label: 'Trésorerie disponible', type: 'currency', placeholder: 'Ex : 9500000' },
      { key: 'runway_months', label: 'Runway (mois)', type: 'number', placeholder: 'Ex : 7.5' },
      { key: 'debt_total', label: 'Dette totale', type: 'currency', placeholder: 'Ex : 6000000' },
      { key: 'debt_service', label: 'Service de la dette (mensuel)', type: 'currency', placeholder: 'Ex : 350000' }
    ]
  },
  {
    id: 'unit',
    title: 'Unit Economics & notes',
    icon: 'fas fa-gauge-high',
    description: 'Suivez vos indicateurs CAC, LTV et hypothèses clés.',
    fields: [
      { key: 'ltv', label: 'LTV (valeur vie client)', type: 'currency', placeholder: 'Ex : 168000' },
      { key: 'cac', label: "CAC (coût d'acquisition)", type: 'currency', placeholder: 'Ex : 42000' },
      { key: 'arpu', label: 'ARPU / panier moyen', type: 'currency', placeholder: 'Ex : 52000' },
      { key: 'notes', label: 'Notes et hypothèses', type: 'textarea', placeholder: 'Hypothèses clés, saisonnalité, éléments à investiguer.' }
    ]
  }
]

const STAGE_LABEL_FALLBACKS: Record<LearningStageKey, string> = {
  microLearning: 'Micro-learning',
  quiz: 'Quiz',
  inputs: 'Inputs',
  analysis: 'Analyse IA',
  iteration: 'Itération',
  validation: 'Validation',
  deliverable: 'Livrable'
}

const STAGE_ICON_MAP: Record<LearningStageKey, string> = {
  microLearning: 'fas fa-circle-play',
  quiz: 'fas fa-clipboard-check',
  inputs: 'fas fa-pen-to-square',
  analysis: 'fas fa-robot',
  iteration: 'fas fa-repeat',
  validation: 'fas fa-badge-check',
  deliverable: 'fas fa-file-signature'
}

const getStageNavId = (moduleCode: string, stage: LearningStageKey) => `module_${moduleCode}_${stage}`

const buildNavItemsForModule = (moduleCode: string): NavItem[] | null => {
  const definition = getLearningModuleDefinition(moduleCode)
  const stageKeys = getLearningStageKeysForModule(moduleCode)

  if (!definition || stageKeys.length === 0) {
    return null
  }

  const stageNavItems = stageKeys.map((stage) => {
    const stageDefinition = definition.flow?.[stage]
    return {
      id: getStageNavId(moduleCode, stage),
      label: stageDefinition?.label ?? STAGE_LABEL_FALLBACKS[stage],
      icon: STAGE_ICON_MAP[stage] ?? 'fas fa-circle',
      href: getStageRouteForModule(moduleCode, stage)
    }
  })

  return [
    { id: 'dashboard', label: 'Tableau de bord', icon: 'fas fa-chart-line', href: '/dashboard' },
    ...stageNavItems
  ]
}

const resolveNavigationForStage = (moduleCode: string, stage?: LearningStageKey) => {
  const navItems = buildNavItemsForModule(moduleCode)

  if (!navItems) {
    const variant = getModuleVariant(moduleCode)

    const legacyStageMapping: Partial<Record<LearningStageKey, string>> = variant === 'finance'
      ? {
          microLearning: 'module_finance_overview',
          quiz: 'module_finance_overview',
          inputs: 'module_finance_inputs',
          analysis: 'module_finance_analysis',
          iteration: 'module_finance_analysis',
          validation: 'module_finance_validation',
          deliverable: 'module_finance_deliverable'
        }
      : {
          microLearning: 'module_overview',
          quiz: 'module_overview',
          inputs: 'module_overview',
          analysis: 'module_analysis',
          iteration: 'module_analysis',
          validation: 'module_validation',
          deliverable: 'module_deliverable'
        }

    return {
      navItems: variant === 'finance' ? FINANCE_NAV_ITEMS : undefined,
      activeNav: stage ? legacyStageMapping[stage] ?? (variant === 'finance' ? 'module_finance_overview' : 'module_overview') : (variant === 'finance' ? 'module_finance_overview' : 'module_overview')
    }
  }

  const availableStages = getLearningStageKeysForModule(moduleCode)
  const resolvedStage = stage && availableStages.includes(stage)
    ? stage
    : availableStages[0] ?? 'microLearning'

  return {
    navItems,
    activeNav: getStageNavId(moduleCode, resolvedStage)
  }
}

type ActivityFieldConfig = {
  key: string
  label: string
  placeholder?: string
  hint?: string
  rows?: number
}

type ActivitySectionConfig = {
  id: string
  title: string
  icon: string
  description: string
  fields: ActivityFieldConfig[]
}

const ACTIVITY_INPUT_SECTIONS: ActivitySectionConfig[] = [
  {
    id: 'vision-mission',
    title: 'Vision & mission',
    icon: 'fas fa-bullseye',
    description: 'Clarifiez votre ambition et ce que vous réalisez au quotidien.',
    fields: [
      {
        key: 'vision',
        label: 'Vision',
        placeholder: 'Vision : Offrir un accès universel à l’énergie solaire hors réseau en Afrique de l’Ouest.',
        hint: 'Décrivez l’impact à 5-10 ans que vous visez.'
      },
      {
        key: 'mission',
        label: 'Mission',
        placeholder: 'Mission : Concevoir et distribuer des kits solaires abordables via un réseau de revendeurs ruraux.',
        hint: 'Explique ce que vous faites chaque jour pour atteindre votre vision.'
      }
    ]
  },
  {
    id: 'problem-solution',
    title: 'Problème client & solution',
    icon: 'fas fa-lightbulb',
    description: 'Présentez le problème critique et votre réponse unique.',
    fields: [
      {
        key: 'problem_statement',
        label: 'Problème client',
        placeholder: '60 % des agriculteurs perdent 25 % de leur récolte faute de chaîne du froid...'
      },
      {
        key: 'solution',
        label: 'Solution proposée',
        placeholder: 'Plateforme SaaS multi-canal qui automatise la collecte de données et envoie des recommandations...'
      },
      {
        key: 'differentiation',
        label: 'Différenciation',
        placeholder: 'Comparatif : Nous – abonnement 15 €/mois, déploiement en 48h. Concurrence A – frais initiaux 200 €...'
      }
    ]
  },
  {
    id: 'market',
    title: 'Marché & clients',
    icon: 'fas fa-chart-area',
    description: 'Identifiez précisément vos segments et la taille de marché.',
    fields: [
      {
        key: 'customer_segments',
        label: 'Segments clients',
        placeholder: '100 000 PME agro en Côte d’Ivoire. Cible initiale : coopératives de 50-200 membres dans 3 régions.'
      },
      {
        key: 'market_size',
        label: 'Taille de marché (TAM/SAM/SOM)',
        placeholder: 'TAM 450 M€ ; SAM 22 M€ ; SOM ciblé 4,5 M€ sur 24 mois.'
      },
      {
        key: 'market_trends',
        label: 'Tendances & dynamiques',
        placeholder: 'Digitalisation rapide du secteur, politiques publiques favorables, hausse des prix énergétiques.'
      }
    ]
  },
  {
    id: 'competition-traction',
    title: 'Concurrence, traction & preuves',
    icon: 'fas fa-trophy',
    description: 'Montrez votre avantage compétitif et vos preuves terrain.',
    fields: [
      {
        key: 'competition',
        label: 'Concurrence & alternatives',
        placeholder: 'Comparatif sur prix/déploiement/expérience. Aucun acteur ne propose de support en langues locales.'
      },
      {
        key: 'traction',
        label: 'Traction',
        placeholder: '1 200 utilisateurs actifs/mois, churn 3 %, 4 contrats cadres avec ONG, 92 % de satisfaction.'
      },
      {
        key: 'proof_points',
        label: 'Preuves & indicateurs',
        placeholder: 'Prix d’innovation 2024, 3 études d’impact, certifications qualité ISO 9001.'
      }
    ]
  },
  {
    id: 'business-model',
    title: "Modèle économique & go-to-market",
    icon: 'fas fa-diagram-project',
    description: 'Expliquez comment vous gagnez de l’argent et atteignez vos clients.',
    fields: [
      {
        key: 'business_model',
        label: "Modèle d'affaires",
        placeholder: 'Abonnement SaaS + commissions marketplace + services premium.'
      },
      {
        key: 'revenue_streams',
        label: 'Sources de revenus',
        placeholder: 'Abonnement 49 €/mois, commission 3 %, services de formation 500 €/session.'
      },
      {
        key: 'pricing_strategy',
        label: 'Stratégie de prix',
        placeholder: 'Tarification dégressive selon volume, bundle annuel avec remise 15 %.'
      },
      {
        key: 'go_to_market',
        label: 'Go-to-market',
        placeholder: '60 % inbound contenu, 40 % intégrateurs ; cycle de vente moyen 21 jours.'
      }
    ]
  },
  {
    id: 'team',
    title: 'Équipe & gouvernance',
    icon: 'fas fa-users',
    description: 'Montrez l’adéquation équipe / ambition et les besoins clés.',
    fields: [
      {
        key: 'team_summary',
        label: 'Équipe clé',
        placeholder: 'CEO ex-ONG microfinance (10 ans), CTO ex-Google (8 ans), advisory board de 3 experts.'
      },
      {
        key: 'team_gaps',
        label: 'Compétences à renforcer',
        placeholder: 'Besoin d’un directeur financier et d’un responsable ventes grands comptes.'
      }
    ]
  },
  {
    id: 'funding',
    title: 'Besoins financiers',
    icon: 'fas fa-seedling',
    description: 'Précisez les montants recherchés et l’usage des fonds.',
    fields: [
      {
        key: 'financial_needs',
        label: 'Montant recherché',
        placeholder: 'Levée 400 K€ pour 18 mois de runway.'
      },
      {
        key: 'fund_usage',
        label: 'Allocation des fonds',
        placeholder: '45 % produit, 30 % go-to-market, 15 % capital de travail, 10 % gouvernance/compliance.'
      }
    ]
  },
  {
    id: 'risks',
    title: 'Risques & notes',
    icon: 'fas fa-triangle-exclamation',
    description: 'Anticipez les risques et ajoutez des notes utiles.',
    fields: [
      {
        key: 'risks',
        label: 'Risques et plans de mitigation',
        placeholder: 'Risque réglementaire : suivi via cabinet local. Risque change : couverture 50 % des flux.'
      },
      {
        key: 'notes',
        label: 'Notes supplémentaires',
        placeholder: 'Informations complémentaires à partager avec le coach ou le comité.',
        rows: 3
      }
    ]
  }
]

const ACTIVITY_INPUT_FIELD_KEYS = ACTIVITY_INPUT_SECTIONS.flatMap((section) => section.fields.map((field) => field.key))

const getActivityReportInputsRow = async (db: D1Database, userId: number, moduleId: number) => {
  const row = await db.prepare(`
    SELECT *
    FROM activity_report_inputs
    WHERE user_id = ? AND module_id = ?
    LIMIT 1
  `).bind(userId, moduleId).first()

  return row ? (row as Record<string, unknown>) : null
}

type RenderLayoutOptions = {
  pageTitle: string
  pageDescription?: string
  breadcrumb?: BreadcrumbItem[]
  activeNav?: string
  content: JSX.Element
  headerActions?: JSX.Element
  extraHead?: JSX.Element | JSX.Element[]
  extraScripts?: string
  bodyClass?: string
  navItems?: NavItem[]
}

export const renderEsanoLayout = ({
  pageTitle,
  pageDescription,
  breadcrumb,
  activeNav = 'dashboard',
  content,
  headerActions,
  extraHead,
  extraScripts,
  bodyClass,
  navItems
}: RenderLayoutOptions) => {
  const headItems = Array.isArray(extraHead) ? extraHead : extraHead ? [extraHead] : []
  const sidebarItems = navItems ?? NAV_ITEMS
  const showDefaultDeliverableLink = false // Livrables maintenant inclus dans NAV_ITEMS

  return (
    <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{pageTitle} • ESONO</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" />
        <link rel="stylesheet" href="/static/esono.css" />
        {headItems}
      </head>
      <body class={bodyClass ?? ''}>
        <header class="esono-header">
          <div class="esono-header__brand">
            <span class="esono-header__logo">ESONO</span>
            <span class="esono-header__subtitle">Investment Readiness</span>
          </div>
          <div class="esono-header__actions">
            <button class="esono-header__icon-btn" title="Centre d’aide">
              <i class="fas fa-circle-question"></i>
            </button>
            <button class="esono-header__icon-btn" title="Notifications">
              <i class="fas fa-bell"></i>
            </button>
          </div>
        </header>

        <aside class="esono-sidebar">
          <nav class="esono-nav">
            {sidebarItems.map((item) => (
              <a
                key={item.id}
                href={item.href}
                class={`esono-nav__item ${item.id === activeNav ? 'active' : ''}`}
              >
                <span class="esono-nav__icon">
                  <i class={item.icon}></i>
                </span>
                <span>{item.label}</span>
              </a>
            ))}

            {showDefaultDeliverableLink && (
              <>
                <div class="esono-nav__divider"></div>

                <a href="/livrables" class="esono-nav__item">
                  <span class="esono-nav__icon">
                    <i class="fas fa-file-pdf"></i>
                  </span>
                  <span>Livrables</span>
                </a>
              </>
            )}
          </nav>
        </aside>

        <main class="esono-main">
          {breadcrumb && breadcrumb.length > 0 && (
            <div class="esono-text-sm esono-text-muted esono-mb-lg">
              {breadcrumb.map((item, index) => (
                <span key={`breadcrumb-${index}`}>
                  {item.href ? (
                    <a href={item.href} class="esono-text-muted">
                      {item.label}
                    </a>
                  ) : (
                    <span>{item.label}</span>
                  )}
                  {index < breadcrumb.length - 1 && <span class="esono-text-muted"> &rsaquo; </span>}
                </span>
              ))}
            </div>
          )}

          <div class="esono-page-header">
            <div class="esono-page-header__main">
              <h1 class="esono-page-title">{pageTitle}</h1>
              {pageDescription && (
                <p class="esono-page-description">{pageDescription}</p>
              )}
            </div>
            {headerActions && (
              <div class="esono-page-header__actions">{headerActions}</div>
            )}
          </div>

          {content}
        </main>

        {extraScripts && (
          <script dangerouslySetInnerHTML={{ __html: extraScripts }} />
        )}
      </body>
    </html>
  )
}

const extractAiFeedbackPayload = (raw: unknown) => {
  if (!raw) {
    return {
      suggestions: [] as string[],
      questions: [] as string[],
      percentage: null as number | null,
      scoreLabel: null as string | null
    }
  }

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.map((entry: any) => {
          if (!entry) return ''
          if (typeof entry === 'string') return entry
          if (typeof entry?.message === 'string') return entry.message
          return String(entry)
        }).filter((item: string) => item.length > 0)
      : []

    const questions = Array.isArray(parsed?.questions)
      ? parsed.questions.map((entry: any) => {
          if (!entry) return ''
          if (typeof entry === 'string') return entry
          if (typeof entry?.message === 'string') return entry.message
          return String(entry)
        }).filter((item: string) => item.length > 0)
      : []

    const percentage = typeof parsed?.percentage === 'number' ? Math.round(parsed.percentage) : null
    const scoreLabel = typeof parsed?.scoreLabel === 'string' ? parsed.scoreLabel : null

    return { suggestions, questions, percentage, scoreLabel }
  } catch (error) {
    console.warn('extractAiFeedbackPayload error', error)
    return {
      suggestions: [] as string[],
      questions: [] as string[],
      percentage: null as number | null,
      scoreLabel: null as string | null
    }
  }
}

const buildCanvasSectionsFromQuestions = (moduleCode: string, questionRows: any[]): CanvasSection[] => {
  const guided = getGuidedQuestions(moduleCode)
  const rowsByNumber = new Map<number, any>()

  questionRows.forEach((row) => {
    const id = Number(row.question_number)
    if (!Number.isNaN(id)) {
      rowsByNumber.set(id, row)
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

  return baseQuestions.map((info, index) => {
    const row = rowsByNumber.get(info.id)
    const answer = (row?.user_response as string | null)?.trim() ?? ''
    const feedback = extractAiFeedbackPayload(row?.ai_feedback)
    const qualityScore = typeof row?.quality_score === 'number' ? Number(row.quality_score) : null
    const score = qualityScore ?? feedback.percentage
    const scoreLabel = score !== null
      ? getScoreLabel(score).label
      : feedback.scoreLabel ?? 'Analyse IA à générer'

    return {
      order: index + 1,
      questionId: info.id,
      section: info.section,
      question: info.question,
      answer,
      score,
      scoreLabel,
      suggestions: feedback.suggestions,
      questions: feedback.questions
    }
  })
}

// B1 - Écran vidéo pédagogique
moduleRoutes.get('/module/:code/video', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    const variant = getModuleVariant(moduleCode)

    // Get or create progress
    const progress = await c.env.DB.prepare(`
      SELECT * FROM progress 
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) {
      await c.env.DB.prepare(`
        INSERT INTO progress (user_id, module_id, status, started_at)
        VALUES (?, ?, 'in_progress', datetime('now'))
      `).bind(payload.userId, module.id).run()
    }

    const content = getModuleContent(moduleCode)
    if (!content || !content.video_url) {
      return c.redirect(`/module/${moduleCode}`)
    }

    const moduleTitle = module.title as string
    const moduleDescription = (module.description as string | null) ?? ''
    const progressPercentage = Math.round((1 / 7) * 100)
    const videoDurationMinutes = Math.max(1, Math.round((content.video_duration ?? 480) / 60))
    const heroDescription = moduleDescription.length > 0
      ? moduleDescription
      : variant === 'finance'
        ? 'Prenez quelques minutes pour revoir les fondamentaux financiers avant de renseigner vos chiffres et ratios clés.'
        : 'Prenez quelques minutes pour comprendre la logique du Business Model Canvas avant de formaliser vos réponses.'

    const objectives = variant === 'finance'
      ? [
          'Comprendre les états financiers clés (compte de résultat, trésorerie, bilan).',
          'Identifier les ratios indispensables pour convaincre bailleurs et investisseurs.',
          'Préparer la collecte de vos données financières pour l’analyse automatique.'
        ]
      : [
          'Comprendre la structure des 9 blocs du Business Model Canvas.',
          'Visualiser les interactions entre vos segments et votre proposition de valeur.',
          'Préparer la collecte d’informations pour les étapes B2 à B5.'
        ]

    const coachTips = variant === 'finance'
      ? [
          'Rassemblez vos chiffres récents (12 derniers mois lorsque c’est possible).',
          'Repérez d’avance les points de vigilance sur vos marges, cashflow et dettes.',
          'Notez les hypothèses à challenger avant de lancer l’analyse IA.'
        ]
      : [
          'Notez vos idées clés pendant la vidéo.',
          'Identifiez les preuves et données que vous pourrez partager avec les bailleurs.',
          'Repérez les points qui nécessiteront des validations chiffrées.'
        ]

    const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'microLearning')

    const pageContent = (
      <div class="esono-grid">
        <section class="esono-hero esono-hero--vision">
          <div class="esono-hero__header">
            <div>
              <h2 class="esono-hero__title">{moduleTitle}</h2>
              <p class="esono-hero__description">
                {heroDescription}
              </p>
            </div>
            <span class="esono-hero__badge">
              <i class="fas fa-circle-play"></i>
              Étape 1 / 7
            </span>
          </div>
          <div class="esono-hero__metrics">
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{progressPercentage}%</p>
              <p class="esono-hero__metric-label">Progression</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{videoDurationMinutes} min</p>
              <p class="esono-hero__metric-label">Durée vidéo</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">B1</p>
              <p class="esono-hero__metric-label">Module</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">Coach &amp; IA</p>
              <p class="esono-hero__metric-label">Validation</p>
            </div>
          </div>
        </section>

        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-play esono-card__title-icon"></i>
              Vidéo pédagogique
            </h2>
            <span class="esono-badge esono-badge--info">
              <i class="fas fa-graduation-cap"></i>
              Indispensable
            </span>
          </div>
          <div class="esono-card__body">
            <div class="esono-progress esono-mb-lg">
              <div class="esono-progress__bar" style={`width: ${progressPercentage}%`}></div>
            </div>

            <div style="position: relative; padding-top: 56.25%; border-radius: var(--border-radius-lg); overflow: hidden; box-shadow: var(--shadow-md); margin-bottom: var(--spacing-lg);">
              <iframe
                src={content.video_url}
                title="Vidéo pédagogique"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
                style="position: absolute; inset: 0; width: 100%; height: 100%; border: 0;"
              ></iframe>
            </div>

            <div class="esono-grid esono-grid--2">
              <div class="esono-synthesis">
                <div class="esono-synthesis__header">
                  <span class="esono-synthesis__title">
                    <i class="fas fa-lightbulb esono-synthesis__icon--ai"></i>
                    Objectifs pédagogiques
                  </span>
                </div>
                <ul class="esono-synthesis__list">
                  {objectives.map((item) => (
                    <li>{item}</li>
                  ))}
                </ul>
              </div>

              <div class="esono-synthesis">
                <div class="esono-synthesis__header">
                  <span class="esono-synthesis__title">
                    <i class="fas fa-compass esono-synthesis__icon--coach"></i>
                    Conseils du coach
                  </span>
                </div>
                <ul class="esono-synthesis__list">
                  {coachTips.map((item) => (
                    <li>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div class="esono-card__footer">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-md); flex-wrap: wrap;">
              <span class="esono-text-sm esono-text-muted">
                <i class="fas fa-clock"></i>
                Durée estimée : {videoDurationMinutes} min
              </span>
              <a href={`/module/${moduleCode}/quiz`} class="esono-btn esono-btn--primary">
                Passer au quiz
                <i class="fas fa-arrow-right"></i>
              </a>
            </div>
          </div>
        </section>
      </div>
    )

    return c.html(
      renderEsanoLayout({
        pageTitle: moduleTitle,
        pageDescription: 'Étape 1 — Vidéo pédagogique',
        breadcrumb: [
          { label: 'Tableau de bord', href: '/dashboard' },
          { label: moduleTitle, href: `/module/${moduleCode}` },
          { label: 'Vidéo' }
        ],
        activeNav,
        navItems: resolvedNavItems,
        content: pageContent
      })
    )
  } catch (error) {
    console.error('Video error:', error)
    return c.redirect('/dashboard')
  }
})

// B2 - Quiz de validation
moduleRoutes.get('/module/:code/quiz', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    const variant = getModuleVariant(moduleCode)
    const content = getModuleContent(moduleCode)
    if (!content || !content.quiz_questions) {
      return c.redirect(`/module/${moduleCode}`)
    }

    const moduleTitle = module.title as string
    const quizQuestions = content.quiz_questions
    const questionCount = quizQuestions.length
    const progressPercentage = Math.round((2 / 7) * 100)
    const heroDescription = variant === 'finance'
      ? 'Validez votre compréhension des notions financières essentielles avant de renseigner vos chiffres. Un score minimal de 80 % est requis pour poursuivre.'
      : 'Validez les fondamentaux avant de passer aux questions guidées. Un score minimal de 80 % est requis pour poursuivre.'
    const useInputsRoute = variant === 'finance' || moduleCode === 'step1_activity_report' || moduleCode === 'mod3_inputs'
    const nextStepPath = useInputsRoute
      ? `/module/${moduleCode}/inputs`
      : `/module/${moduleCode}/questions`
    const nextStepLabel = variant === 'finance'
      ? 'Continuer vers les inputs financiers'
      : useInputsRoute
        ? 'Continuer vers les inputs narratifs'
        : 'Continuer vers les questions guidées'
    const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'quiz')

    const pageContent = (
      <div class="esono-grid">
        <section class="esono-hero">
          <div class="esono-hero__header">
            <div>
              <h2 class="esono-hero__title">Quiz de validation</h2>
              <p class="esono-hero__description">
                {heroDescription}
              </p>
            </div>
            <span class="esono-hero__badge">
              <i class="fas fa-list-check"></i>
              Étape 2 / 7
            </span>
          </div>
          <div class="esono-hero__metrics">
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{progressPercentage}%</p>
              <p class="esono-hero__metric-label">Progression</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">80%</p>
              <p class="esono-hero__metric-label">Score minimum</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{questionCount}</p>
              <p class="esono-hero__metric-label">Questions</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">B2</p>
              <p class="esono-hero__metric-label">Module</p>
            </div>
          </div>
        </section>

        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-clipboard-check esono-card__title-icon"></i>
              Quiz de validation
            </h2>
            <span class="esono-note esono-note--info">
              <i class="fas fa-clock"></i>
              ~5 minutes
            </span>
          </div>
          <div class="esono-card__body">
            <div class="esono-form__meta esono-mb-lg">
              <span>
                <i class="fas fa-bullseye"></i>
                Objectif : atteindre 80% ou plus
              </span>
              <span>
                <i class="fas fa-robot"></i>
                L’IA analysera vos réponses pour la suite
              </span>
            </div>

            <div class="esono-progress esono-mb-lg">
              <div class="esono-progress__bar" style={`width: ${progressPercentage}%`}></div>
            </div>

            <form id="quizForm" class="esono-quiz">
              {quizQuestions.map((q, index) => (
                <div class="esono-quiz-question">
                  <div class="esono-quiz-question__header">
                    <span class="esono-quiz-question__number">{index + 1}</span>
                    <div>
                      <h3 class="esono-quiz-question__title">{q.question}</h3>
                    </div>
                  </div>
                  <div class="esono-quiz-options">
                    {q.options.map((option, optIndex) => (
                      <label class="esono-radio-option">
                        <input
                          type="radio"
                          name={`question_${q.id}`}
                          value={optIndex}
                          required
                        />
                        <span class="esono-radio-option__label">{option}</span>
                      </label>
                    ))}
                  </div>
                  <div
                    id={`explanation_${q.id}`}
                    class="esono-quiz-explanation"
                    style="display: none;"
                  >
                    {q.explanation ?? 'Consultez les notes du coach pour approfondir cette notion.'}
                  </div>
                </div>
              ))}

              <div id="quizResults" class="esono-quiz-results" style="display: none;">
                <div id="successMessage" class="esono-alert esono-alert--success" style="display: none;">
                  <span class="esono-alert__icon">
                    <i class="fas fa-check-circle"></i>
                  </span>
                  <div class="esono-alert__content">
                    <h3 class="esono-alert__title">Félicitations !</h3>
                    <p class="esono-alert__text">
                      Score obtenu&nbsp;: <strong data-score>0</strong>%. Vous pouvez passer à la structuration de votre livrable.
                    </p>
                    <div class="esono-alert__actions">
                      <a
                        href={nextStepPath}
                        class="esono-btn esono-btn--primary esono-btn--sm"
                      >
                        {nextStepLabel}
                        <i class="fas fa-arrow-right"></i>
                      </a>
                    </div>
                  </div>
                </div>

                <div id="failMessage" class="esono-alert esono-alert--danger" style="display: none;">
                  <span class="esono-alert__icon">
                    <i class="fas fa-triangle-exclamation"></i>
                  </span>
                  <div class="esono-alert__content">
                    <h3 class="esono-alert__title">Pas encore validé</h3>
                    <p class="esono-alert__text">
                      Score obtenu&nbsp;: <strong data-score>0</strong>%. Revoyez la vidéo ou vos notes puis relancez le quiz.
                    </p>
                    <div class="esono-alert__actions">
                      <a href={`/module/${moduleCode}/video`} class="esono-btn esono-btn--ghost esono-btn--sm">
                        <i class="fas fa-play-circle"></i>
                        Revoir la vidéo
                      </a>
                      <button type="button" class="esono-btn esono-btn--secondary esono-btn--sm" onclick="window.location.reload()">
                        <i class="fas fa-rotate-right"></i>
                        Recommencer
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div id="submitSection" class="esono-form__actions">
                <button type="submit" class="esono-btn esono-btn--primary">
                  Valider mes réponses
                  <i class="fas fa-check"></i>
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    )

    const extraScripts = `
(() => {
  const quizData = ${JSON.stringify(quizQuestions)};
  const moduleCode = ${JSON.stringify(moduleCode)};
  const form = document.getElementById('quizForm');
  if (!form) {
    return;
  }
  const resultWrapper = document.getElementById('quizResults');
  const successMessage = document.getElementById('successMessage');
  const failMessage = document.getElementById('failMessage');
  const submitSection = document.getElementById('submitSection');

  const registerSelection = (input) => {
    const groupName = input.name;
    document.querySelectorAll('input[name="' + groupName + '"]').forEach((radio) => {
      const container = radio.closest('.esono-radio-option');
      if (container) {
        container.classList.remove('is-selected');
      }
    });
    const container = input.closest('.esono-radio-option');
    if (container) {
      container.classList.add('is-selected');
    }
  };

  document.querySelectorAll('.esono-radio-option input[type="radio"]').forEach((input) => {
    input.addEventListener('change', () => registerSelection(input));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (successMessage) {
      successMessage.style.display = 'none';
    }
    if (failMessage) {
      failMessage.style.display = 'none';
    }

    let correct = 0;
    const answers = [];

    quizData.forEach((question) => {
      const radios = document.querySelectorAll('input[name="question_' + question.id + '"]');
      let selectedIndex = null;

      radios.forEach((radio, index) => {
        const container = radio.closest('.esono-radio-option');
        if (container) {
          container.classList.remove('is-correct', 'is-incorrect');
        }
        if (radio.checked) {
          selectedIndex = index;
        }
      });

      const explanation = document.getElementById('explanation_' + question.id);
      if (explanation) {
        explanation.style.display = 'block';
      }

      radios.forEach((radio, index) => {
        const container = radio.closest('.esono-radio-option');
        if (!container) {
          return;
        }
        if (index === question.correct_answer) {
          container.classList.add('is-correct');
        } else if (radio.checked) {
          container.classList.add('is-incorrect');
        }
      });

      if (selectedIndex !== null) {
        answers.push(selectedIndex);
        if (selectedIndex === question.correct_answer) {
          correct += 1;
        }
      } else {
        answers.push(null);
      }
    });

    const score = Math.round((correct / quizData.length) * 100);

    try {
      await fetch('/api/module/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_code: moduleCode,
          score,
          passed: score >= 80,
          answers
        })
      });
    } catch (error) {
      console.error('Error saving quiz:', error);
    }

    if (resultWrapper) {
      resultWrapper.style.display = 'flex';
      resultWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (submitSection) {
      submitSection.style.display = 'none';
    }

    if (score >= 80) {
      if (successMessage) {
        successMessage.style.display = 'flex';
        const holder = successMessage.querySelector('[data-score]');
        if (holder) {
          holder.textContent = String(score);
        }
      }
    } else if (failMessage) {
      failMessage.style.display = 'flex';
      const holder = failMessage.querySelector('[data-score]');
      if (holder) {
        holder.textContent = String(score);
      }
    }
  });
})();
`

    return c.html(
      renderEsanoLayout({
        pageTitle: moduleTitle,
        pageDescription: 'Étape 2 — Quiz de validation',
        breadcrumb: [
          { label: 'Tableau de bord', href: '/dashboard' },
          { label: moduleTitle, href: `/module/${moduleCode}` },
          { label: 'Quiz' }
        ],
        activeNav,
        navItems: resolvedNavItems,
        content: pageContent,
        headerActions: (
          <a href={`/module/${moduleCode}/video`} class="esono-btn esono-btn--ghost">
            <i class="fas fa-circle-play"></i>
            Revoir la vidéo
          </a>
        ),
        extraScripts
      })
    )
  } catch (error) {
    console.error('Quiz error:', error)
    return c.redirect('/dashboard')
  }
})

moduleRoutes.get('/module/:code/inputs', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    const variant = getModuleVariant(moduleCode)

    const module = await c.env.DB.prepare(`
      SELECT *
      FROM modules
      WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) {
      return c.redirect('/dashboard')
    }

    const moduleId = Number(module.id)
    if (Number.isNaN(moduleId)) {
      return c.redirect('/dashboard')
    }

    // ═══ Module 3 Inputs Financiers — 9 onglets dédiés ═══
    if (moduleCode === 'mod3_inputs') {
      const progress = await ensureProgressRecord(c.env.DB, payload.userId, moduleId)
      
      // Load existing data from financial_inputs (9-tab JSON columns)
      const INPUT_TAB_COLS: Record<InputTabKey, string> = {
        infos_generales: 'infos_generales_json', donnees_historiques: 'donnees_historiques_json',
        produits_services: 'produits_services_json', ressources_humaines: 'ressources_humaines_json',
        hypotheses_croissance: 'hypotheses_croissance_json', couts_fixes_variables: 'couts_fixes_variables_json',
        bfr_tresorerie: 'bfr_tresorerie_json', investissements: 'investissements_json', financement: 'financement_json'
      }
      const fiRow = await c.env.DB.prepare('SELECT * FROM financial_inputs WHERE user_id = ? AND module_id = ? LIMIT 1')
        .bind(payload.userId, moduleId).first()
      
      const tabsData: Record<InputTabKey, Record<string, any>> = {} as any
      for (const tabKey of INPUT_TAB_ORDER) {
        const col = INPUT_TAB_COLS[tabKey]
        const raw = fiRow ? (fiRow as any)[col] : null
        tabsData[tabKey] = raw ? JSON.parse(raw) : {}
      }

      // Score each tab for display
      const tabScores = INPUT_TAB_ORDER.map(k => scoreTab(k, tabsData[k]))
      const overallCompleteness = Math.round(tabScores.reduce((s, t) => s + t.completeness, 0) / tabScores.length)
      const readiness = fiRow ? Number((fiRow as any).readiness_score ?? 0) : 0
      const lastUpdated = fiRow && (fiRow as any).updated_at ? new Date((fiRow as any).updated_at as string).toLocaleDateString('fr-FR') : 'Jamais'

      const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'inputs')

      const pageContent = (
        <div class="esono-grid">
          {/* Hero */}
          <section class="esono-hero esono-hero--vision">
            <div class="esono-hero__header">
              <div>
                <h2 class="esono-hero__title"><i class="fas fa-calculator" style="margin-right:8px;"></i>Inputs Financiers</h2>
                <p class="esono-hero__description">Saisissez vos données financières dans les 9 onglets. L'IA vérifie la cohérence en temps réel.</p>
              </div>
              <span class="esono-hero__badge"><i class="fas fa-pen-to-square"></i> Étape 3 / 7</span>
            </div>
            <div class="esono-hero__metrics">
              <div class="esono-hero__metric"><p class="esono-hero__metric-value" id="globalCompleteness">{overallCompleteness}%</p><p class="esono-hero__metric-label">Complétude</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value" id="globalReadiness">{readiness}%</p><p class="esono-hero__metric-label">Readiness</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value">{lastUpdated}</p><p class="esono-hero__metric-label">Dernière MàJ</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value">{progress.status === 'validated' ? 'Validé' : progress.status === 'not_started' ? 'À démarrer' : 'En cours'}</p><p class="esono-hero__metric-label">Statut</p></div>
            </div>
          </section>

          {/* Tab Navigation */}
          <section class="esono-card">
            <div class="esono-card__body" style="padding:0;">
              <div id="inputTabNav" style="display:flex;flex-wrap:wrap;gap:4px;padding:12px;">
                {INPUT_TAB_ORDER.map((tabKey, idx) => {
                  const info = INPUT_TAB_LABELS[tabKey]
                  const ts = tabScores[idx]
                  const badgeColor = ts.completeness >= 80 ? '#059669' : ts.completeness >= 50 ? '#d97706' : '#94a3b8'
                  return (
                    <button
                      type="button"
                      class={`esono-btn ${idx === 0 ? 'esono-btn--primary' : 'esono-btn--ghost'}`}
                      data-tab-btn={tabKey}
                      onclick={`switchTab('${tabKey}')`}
                      style="font-size:12px;padding:6px 10px;position:relative;"
                    >
                      <i class={`fas ${info.icon}`} style="margin-right:4px;"></i>
                      {info.shortLabel}
                      <span style={`position:absolute;top:-6px;right:-6px;background:${badgeColor};color:white;font-size:9px;padding:1px 5px;border-radius:10px;font-weight:700;`}>{ts.completeness}%</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Tab Panels */}
          {INPUT_TAB_ORDER.map((tabKey, idx) => {
            const info = INPUT_TAB_LABELS[tabKey]
            const coaching = TAB_COACHING[tabKey]
            const fields = TAB_FIELDS[tabKey]
            const ts = tabScores[idx]
            const currentData = tabsData[tabKey]

            return (
              <div id={`tab-panel-${tabKey}`} class="input-tab-panel" style={idx === 0 ? '' : 'display:none;'}>
                {/* Coaching Sidebar */}
                <section class="esono-card" style="border-left:4px solid #3b82f6;">
                  <div class="esono-card__header">
                    <h3 class="esono-card__title" style="font-size:14px;">
                      <i class="fas fa-graduation-cap" style="color:#3b82f6;margin-right:6px;"></i>
                      Coaching — {info.label}
                    </h3>
                  </div>
                  <div class="esono-card__body" style="display:flex;flex-direction:column;gap:8px;">
                    <div style="background:#dcfce7;padding:10px;border-radius:8px;font-size:13px;">
                      <strong style="color:#059669;">🟢 Conseil :</strong> {coaching.conseil}
                    </div>
                    <div style="background:#dbeafe;padding:10px;border-radius:8px;font-size:13px;">
                      <strong style="color:#2563eb;">🟢 Exemple :</strong> {coaching.exemple}
                    </div>
                    <div style="background:#fee2e2;padding:10px;border-radius:8px;font-size:13px;">
                      <strong style="color:#dc2626;">🔴 À éviter :</strong> {coaching.aEviter}
                    </div>
                  </div>
                </section>

                {/* Form Fields */}
                <section class="esono-card">
                  <div class="esono-card__header">
                    <h2 class="esono-card__title">
                      <i class={`fas ${info.icon} esono-card__title-icon`}></i>
                      {info.label}
                    </h2>
                    <span class="esono-note esono-note--info" id={`tab-completeness-${tabKey}`}>{ts.completeness}% complété · {ts.filledFields}/{ts.totalFields} champs</span>
                  </div>
                  <div class="esono-card__body">
                    <div class="esono-form__grid esono-form__grid--2">
                      {fields.map(field => {
                        const val = currentData[field.key] ?? field.defaultValue ?? ''
                        const fieldId = `input-${tabKey}-${field.key}`
                        
                        if (field.type === 'select' && field.options) {
                          return (
                            <label class="esono-form__field" htmlFor={fieldId}>
                              <span class="esono-form__label">{field.label} {field.required ? <span style="color:#dc2626;">*</span> : ''}</span>
                              <select id={fieldId} name={field.key} class="esono-textarea" data-tab={tabKey} data-field-input style="height:42px;padding:8px;">
                                <option value="">— Sélectionnez —</option>
                                {field.options.map(opt => <option value={opt} selected={String(val) === opt}>{opt}</option>)}
                              </select>
                              {field.unit && <span class="esono-form__hint">{field.unit}</span>}
                            </label>
                          )
                        }
                        
                        if (field.type === 'textarea') {
                          return (
                            <label class="esono-form__field esono-form__field--full" htmlFor={fieldId}>
                              <span class="esono-form__label">{field.label} {field.required ? <span style="color:#dc2626;">*</span> : ''}</span>
                              <textarea id={fieldId} name={field.key} rows={4} placeholder={field.placeholder ?? ''} data-tab={tabKey} data-field-input class="esono-textarea">{String(val)}</textarea>
                            </label>
                          )
                        }

                        return (
                          <label class="esono-form__field" htmlFor={fieldId}>
                            <span class="esono-form__label">{field.label} {field.required ? <span style="color:#dc2626;">*</span> : ''}</span>
                            <input type={field.type === 'currency' ? 'number' : field.type} id={fieldId} name={field.key} value={String(val)} placeholder={field.placeholder ?? ''} data-tab={tabKey} data-field-input class="esono-textarea" style="height:42px;padding:8px;" />
                            {field.unit && <span class="esono-form__hint">{field.unit}</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </section>

                {/* Alerts for this tab */}
                <div id={`tab-alerts-${tabKey}`} class="esono-card" style={ts.alerts.length === 0 ? 'display:none;' : ''}>
                  <div class="esono-card__header">
                    <h3 class="esono-card__title" style="font-size:14px;color:#d97706;">
                      <i class="fas fa-triangle-exclamation" style="margin-right:6px;"></i>
                      Alertes IA ({ts.alerts.length})
                    </h3>
                  </div>
                  <div class="esono-card__body" style="display:flex;flex-direction:column;gap:6px;">
                    {ts.alerts.map(alert => (
                      <div style={`padding:8px 12px;border-radius:6px;font-size:13px;border-left:3px solid ${alert.level === 'error' ? '#dc2626' : alert.level === 'warning' ? '#d97706' : '#3b82f6'};background:${alert.level === 'error' ? '#fee2e2' : alert.level === 'warning' ? '#fef3c7' : '#dbeafe'};`}>
                        <i class={`fas ${alert.level === 'error' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}`} style={`margin-right:4px;color:${alert.level === 'error' ? '#dc2626' : '#d97706'};`}></i>
                        {alert.message}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Save Status */}
          <div id="inputSaveStatus" class="esono-alert" style="display:none;"></div>

          {/* Action Buttons */}
          <div class="esono-form__actions">
            <button type="button" id="saveCurrentTabBtn" class="esono-btn esono-btn--primary" onclick="saveCurrentTab()">
              <i class="fas fa-save"></i> Enregistrer cet onglet
            </button>
            <button type="button" id="saveAllTabsBtn" class="esono-btn esono-btn--secondary" onclick="saveAllTabs()">
              <i class="fas fa-floppy-disk"></i> Tout enregistrer
            </button>
            <a href="/module/mod3_inputs/analysis" class="esono-btn esono-btn--accent">
              <i class="fas fa-robot"></i> Lancer l'analyse IA
            </a>
          </div>
        </div>
      )

      const extraScripts = `
(() => {
  let currentTab = '${INPUT_TAB_ORDER[0]}';
  const allTabs = ${JSON.stringify(INPUT_TAB_ORDER)};

  window.switchTab = function(tabKey) {
    currentTab = tabKey;
    allTabs.forEach(t => {
      const panel = document.getElementById('tab-panel-' + t);
      if (panel) panel.style.display = t === tabKey ? '' : 'none';
    });
    document.querySelectorAll('[data-tab-btn]').forEach(btn => {
      if (btn.dataset.tabBtn === tabKey) {
        btn.classList.remove('esono-btn--ghost');
        btn.classList.add('esono-btn--primary');
      } else {
        btn.classList.remove('esono-btn--primary');
        btn.classList.add('esono-btn--ghost');
      }
    });
  };

  function collectTabData(tabKey) {
    const data = {};
    document.querySelectorAll('[data-tab="' + tabKey + '"][data-field-input]').forEach(el => {
      const name = el.name || el.id.split('-').slice(2).join('-');
      data[name] = el.value || '';
    });
    return data;
  }

  function showStatus(msg, ok) {
    const el = document.getElementById('inputSaveStatus');
    if (!el) return;
    el.style.display = 'block';
    el.className = 'esono-alert ' + (ok ? 'esono-alert--success' : 'esono-alert--error');
    el.innerHTML = '<i class="fas ' + (ok ? 'fa-check-circle' : 'fa-exclamation-triangle') + '"></i> ' + msg;
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  window.saveCurrentTab = async function() {
    const btn = document.getElementById('saveCurrentTabBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...'; }
    try {
      const data = collectTabData(currentTab);
      const res = await fetch('/api/inputs/save-tab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleCode: 'mod3_inputs', tab: currentTab, data })
      });
      const json = await res.json();
      if (json.success) {
        showStatus('Onglet "' + currentTab + '" enregistré avec succès.', true);
        if (json.score) {
          const compEl = document.getElementById('tab-completeness-' + currentTab);
          if (compEl) compEl.textContent = json.score.completeness + '% complété · ' + json.score.filledFields + '/' + json.score.totalFields + ' champs';
        }
      } else {
        showStatus(json.error || 'Erreur lors de l\\'enregistrement.', false);
      }
    } catch(e) {
      showStatus('Erreur réseau.', false);
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Enregistrer cet onglet'; }
  };

  window.saveAllTabs = async function() {
    const btn = document.getElementById('saveAllTabsBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sauvegarde...'; }
    let savedCount = 0;
    for (const tabKey of allTabs) {
      try {
        const data = collectTabData(tabKey);
        const res = await fetch('/api/inputs/save-tab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleCode: 'mod3_inputs', tab: tabKey, data })
        });
        const json = await res.json();
        if (json.success) savedCount++;
      } catch(e) {}
    }
    showStatus(savedCount + '/' + allTabs.length + ' onglets enregistrés.', savedCount === allTabs.length);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Tout enregistrer'; }
  };
})();
`

      return c.html(renderEsanoLayout({
        pageTitle: 'Inputs Financiers — Module 3',
        navItems: resolvedNavItems,
        activeNav,
        content: pageContent,
        extraScripts
      }))
    }

    // ═══ Activity Report inputs (step1_activity_report) ═══
    if (moduleCode === 'step1_activity_report') {
      const progress = await ensureProgressRecord(c.env.DB, payload.userId, moduleId)
      const inputsRecord = (await getActivityReportInputsRow(c.env.DB, payload.userId, moduleId)) ?? {}

      const getFieldValue = (key: string) => {
        const raw = (inputsRecord as Record<string, unknown>)[key]
        if (raw === null || raw === undefined) {
          return ''
        }
        return typeof raw === 'string' ? raw : String(raw)
      }

      const totalFields = ACTIVITY_INPUT_FIELD_KEYS.length
      const filledFieldCount = ACTIVITY_INPUT_FIELD_KEYS.reduce((count, key) => {
        const value = getFieldValue(key).trim()
        return count + (value.length > 0 ? 1 : 0)
      }, 0)

      const completionRate = totalFields > 0 ? Math.round((filledFieldCount / totalFields) * 100) : 0
      const progressPercentage = Math.round((3 / 7) * 100)
      const lastUpdatedRaw = typeof (inputsRecord as Record<string, unknown>).updated_at === 'string'
        ? (inputsRecord as Record<string, unknown>).updated_at as string
        : null
      const lastUpdatedDisplay = lastUpdatedRaw ? formatDateValue(lastUpdatedRaw, 'Jamais renseigné') : 'Jamais renseigné'
      const statusLabel = progress.status === 'validated'
        ? 'Validé'
        : progress.status === 'not_started'
          ? 'À démarrer'
          : 'En cours'
      const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'inputs')

      const instructions = [
        'Rédigez un argumentaire clair et chiffré pour chaque bloc.',
        'Appuyez-vous sur des preuves (clients, chiffres, récompenses) pour gagner en crédibilité.',
        "Préparez-vous à lancer l’analyse IA (B4) une fois les blocs complétés."
      ]

      const pageContent = (
        <div class="esono-grid">
          <section class="esono-hero esono-hero--vision">
            <div class="esono-hero__header">
              <div>
                <h2 class="esono-hero__title">Inputs narratifs</h2>
                <p class="esono-hero__description">
                  Structurez votre rapport d’activité pour convaincre les bailleurs et investisseurs.
                </p>
              </div>
              <span class="esono-hero__badge">
                <i class="fas fa-pen-to-square"></i>
                Étape 3 / 7
              </span>
            </div>
            <div class="esono-hero__metrics">
              <div class="esono-hero__metric">
                <p class="esono-hero__metric-value">{progressPercentage}%</p>
                <p class="esono-hero__metric-label">Progression</p>
              </div>
              <div class="esono-hero__metric">
                <p class="esono-hero__metric-value" id="activityCompletionValue">{completionRate}%</p>
                <p class="esono-hero__metric-label">Champs complétés</p>
              </div>
              <div class="esono-hero__metric">
                <p class="esono-hero__metric-value" id="activityLastUpdated">{lastUpdatedDisplay}</p>
                <p class="esono-hero__metric-label">Dernière mise à jour</p>
              </div>
              <div class="esono-hero__metric">
                <p class="esono-hero__metric-value">{statusLabel}</p>
                <p class="esono-hero__metric-label">Statut</p>
              </div>
            </div>
          </section>

          <section class="esono-card esono-card--info">
            <div class="esono-card__header">
              <h2 class="esono-card__title">
                <i class="fas fa-info-circle esono-card__title-icon"></i>
                Comment compléter votre rapport
              </h2>
            </div>
            <div class="esono-card__body">
              <ul class="esono-list">
                {instructions.map((item) => (
                  <li class="esono-list__item">
                    <i class="fas fa-check esono-list__icon"></i>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <form id="activityInputsForm" class="esono-form" data-module={moduleCode}>
            {ACTIVITY_INPUT_SECTIONS.map((section) => (
              <section class="esono-card" id={`section-${section.id}`}>
                <div class="esono-card__header">
                  <h2 class="esono-card__title">
                    <i class={`${section.icon} esono-card__title-icon`}></i>
                    {section.title}
                  </h2>
                  <span class="esono-note esono-note--info">{section.description}</span>
                </div>
                <div class="esono-card__body">
                  <div class="esono-form__grid esono-form__grid--2">
                    {section.fields.map((field) => {
                      const fieldId = `activity-${field.key}`
                      const value = getFieldValue(field.key)
                      const rows = field.rows ?? 5

                      return (
                        <label class={`esono-form__field ${rows >= 6 ? 'esono-form__field--full' : ''}`} htmlFor={fieldId}>
                          <span class="esono-form__label">{field.label}</span>
                          <textarea
                            id={fieldId}
                            name={field.key}
                            rows={rows}
                            placeholder={field.placeholder ?? ''}
                            data-field-input
                            class="esono-textarea"
                          >{value}</textarea>
                          {field.hint && <span class="esono-form__hint">{field.hint}</span>}
                        </label>
                      )
                    })}
                  </div>
                </div>
              </section>
            ))}

            <div id="activitySaveStatus" class="esono-alert" style="display: none;"></div>

            <div class="esono-form__actions">
              <button type="submit" class="esono-btn esono-btn--primary">
                <i class="fas fa-save"></i>
                Enregistrer mes réponses
              </button>
              <a href={`/module/${moduleCode}/analysis`} class="esono-btn esono-btn--secondary">
                <i class="fas fa-robot"></i>
                Lancer l’analyse IA
              </a>
            </div>
          </form>
        </div>
      )

      const extraScripts = `
(() => {
  const form = document.getElementById('activityInputsForm');
  if (!form) {
    return;
  }
  const moduleCode = form.dataset.module;
  const statusEl = document.getElementById('activitySaveStatus');
  const completionEl = document.getElementById('activityCompletionValue');
  const lastUpdatedEl = document.getElementById('activityLastUpdated');
  const submitBtn = form.querySelector('button[type="submit"]');
  const totalFields = ${ACTIVITY_INPUT_FIELD_KEYS.length};

  const computeCompletion = () => {
    let filled = 0;
    form.querySelectorAll('[data-field-input]').forEach((element) => {
      const value = element.value ?? '';
      if (typeof value === 'string' && value.trim().length) {
        filled += 1;
      }
    });
    return totalFields > 0 ? Math.round((filled / totalFields) * 100) : 0;
  };

  const updateCompletion = () => {
    if (completionEl) {
      completionEl.textContent = computeCompletion() + '%';
    }
  };

  form.addEventListener('input', updateCompletion);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!moduleCode) {
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('is-loading');
    }

    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.classList.remove('esono-alert--success', 'esono-alert--danger');
      statusEl.textContent = '';
      statusEl.classList.add('esono-alert');
    }

    const formData = new FormData(form);
    const payload = {};
    formData.forEach((value, key) => {
      payload[key] = typeof value === 'string' ? value : '';
    });

    try {
      const response = await fetch('/api/activity-report/inputs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleCode, payload })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Sauvegarde impossible');
      }

      if (statusEl) {
        statusEl.textContent = 'Narratif enregistré.';
        statusEl.classList.add('esono-alert--success');
        statusEl.style.display = 'flex';
      }

      const updated = data?.inputs;
      if (updated && lastUpdatedEl && updated.updated_at) {
        try {
          const date = new Date(updated.updated_at);
          lastUpdatedEl.textContent = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch (err) {
          console.warn('Impossible de formater la date', err);
        }
      }

      updateCompletion();
    } catch (error) {
      console.error('Activity inputs save error:', error);
      if (statusEl) {
        statusEl.textContent = error instanceof Error ? error.message : 'Erreur lors de la sauvegarde.';
        statusEl.classList.add('esono-alert--danger');
        statusEl.style.display = 'flex';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
      }
    }
  });
})();
`.replace(/</g, '\\u003c')

      return c.html(
        renderEsanoLayout({
          pageTitle: module.title as string,
          pageDescription: 'Étape 3 — Inputs narratifs',
          breadcrumb: [
            { label: 'Tableau de bord', href: '/dashboard' },
            { label: module.title as string, href: `/module/${moduleCode}` },
            { label: 'Inputs narratifs' }
          ],
          activeNav,
          navItems: resolvedNavItems,
          content: pageContent,
          extraScripts
        })
      )
    }

    if (variant !== 'finance') {
      return c.redirect(`/module/${moduleCode}/questions`)
    }

    await ensureProgressRecord(c.env.DB, payload.userId, moduleId)
    const inputsRaw = await getFinancialInputsRow(c.env.DB, payload.userId, moduleId)
    const inputsRecord = (inputsRaw ?? {}) as Record<string, unknown>

    const getFieldValue = (key: string) => {
      const raw = inputsRecord[key]
      if (raw === null || raw === undefined) {
        return ''
      }
      return typeof raw === 'number' ? String(raw) : String(raw)
    }

    const totalFieldCount = FINANCIAL_SECTIONS.reduce((sum, section) => sum + section.fields.length, 0)
    const filledFieldCount = FINANCIAL_SECTIONS.reduce((sum, section) => (
      sum + section.fields.reduce((inner, field) => {
        const raw = inputsRecord[field.key]
        return inner + (raw !== null && raw !== undefined && String(raw).trim().length > 0 ? 1 : 0)
      }, 0)
    ), 0)

    const completionRate = totalFieldCount > 0 ? Math.round((filledFieldCount / totalFieldCount) * 100) : 0
    const progressPercentage = Math.round((3 / 7) * 100)

    const lastUpdatedRaw = typeof inputsRecord.updated_at === 'string' ? inputsRecord.updated_at : null
    const lastUpdatedDisplay = lastUpdatedRaw ? formatDateValue(lastUpdatedRaw, 'Jamais renseigné') : 'Jamais renseigné'
    const currencyDisplay = typeof inputsRecord.currency === 'string' && (inputsRecord.currency as string).trim().length
      ? String(inputsRecord.currency).toUpperCase()
      : 'XOF'

    const moduleTitle = (module.title as string) ?? 'Analyse financière'

    const instructions = [
      'Renseignez vos données réelles sur les 6 à 12 derniers mois.',
      "Laissez vide ce qui n’est pas applicable ; vous pourrez compléter plus tard.",
      'Sauvegardez régulièrement avant de lancer une nouvelle analyse IA.'
    ]

    const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'inputs')

    const pageContent = (
      <div class="esono-grid">
        <section class="esono-hero esono-hero--vision">
          <div class="esono-hero__header">
            <div>
              <h2 class="esono-hero__title">Inputs financiers</h2>
              <p class="esono-hero__description">
                Collectez vos indicateurs financiers clés pour générer un diagnostic crédible auprès des bailleurs et investisseurs.
              </p>
            </div>
            <span class="esono-hero__badge">
              <i class="fas fa-file-invoice-dollar"></i>
              Étape 3 / 7
            </span>
          </div>
          <div class="esono-hero__metrics">
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{progressPercentage}%</p>
              <p class="esono-hero__metric-label">Progression</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value" id="financeCompletionValue">{completionRate}%</p>
              <p class="esono-hero__metric-label">Champs complétés</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value" id="financeLastUpdated">{lastUpdatedDisplay}</p>
              <p class="esono-hero__metric-label">Dernière mise à jour</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value" id="financeCurrencyValue">{currencyDisplay}</p>
              <p class="esono-hero__metric-label">Devise</p>
            </div>
          </div>
        </section>

        <section class="esono-card esono-card--info">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-info-circle esono-card__title-icon"></i>
              Comment remplir vos chiffres
            </h2>
          </div>
          <div class="esono-card__body">
            <ul class="esono-list">
              {instructions.map((item) => (
                <li class="esono-list__item">
                  <i class="fas fa-check esono-list__icon"></i>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <form id="financeInputsForm" class="esono-form" data-module={moduleCode}>
          {FINANCIAL_SECTIONS.map((section) => (
            <section class="esono-card" id={`section-${section.id}`}>
              <div class="esono-card__header">
                <h2 class="esono-card__title">
                  <i class={`${section.icon} esono-card__title-icon`}></i>
                  {section.title}
                </h2>
                <span class="esono-note esono-note--info">{section.description}</span>
              </div>
              <div class="esono-card__body">
                <div class="esono-form__grid esono-form__grid--2">
                  {section.fields.map((field) => {
                    const fieldId = `finance-${field.key}`
                    const value = getFieldValue(field.key)

                    if (field.type === 'textarea') {
                      return (
                        <label class="esono-form__field esono-form__field--full" htmlFor={fieldId}>
                          <span class="esono-form__label">{field.label}</span>
                          <textarea
                            id={fieldId}
                            name={field.key}
                            rows={4}
                            placeholder={field.placeholder ?? ''}
                            data-field-input
                            class="esono-textarea"
                          >{value}</textarea>
                          {field.hint && <span class="esono-form__hint">{field.hint}</span>}
                        </label>
                      )
                    }

                    const inputType = field.type === 'text' ? 'text' : 'number'
                    const stepValue = field.type === 'percent' ? '0.1' : field.type === 'number' ? '0.1' : '0.01'

                    return (
                      <label class={`esono-form__field ${field.type === 'percent' ? 'esono-form__field--compact' : ''}`} htmlFor={fieldId}>
                        <span class="esono-form__label">{field.label}</span>
                        <div class="esono-input-group">
                          {field.type === 'currency' && (
                            <span class="esono-input-group__prefix">
                              <i class="fas fa-coins"></i>
                            </span>
                          )}
                          <input
                            id={fieldId}
                            name={field.key}
                            type={inputType}
                            value={value}
                            step={inputType === 'number' ? stepValue : undefined}
                            inputmode={inputType === 'number' ? 'decimal' : undefined}
                            placeholder={field.placeholder ?? ''}
                            class="esono-input"
                            data-field-input
                          />
                          {field.type === 'percent' && (
                            <span class="esono-input-group__suffix">%</span>
                          )}
                        </div>
                        {field.hint && <span class="esono-form__hint">{field.hint}</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            </section>
          ))}

          <div id="saveStatus" class="esono-alert" style="display: none;"></div>

          <div class="esono-form__actions">
            <button type="submit" class="esono-btn esono-btn--primary">
              <i class="fas fa-save"></i>
              Enregistrer mes données
            </button>
            <a href={`/module/${moduleCode}/analysis`} class="esono-btn esono-btn--secondary">
              <i class="fas fa-robot"></i>
              Lancer l’analyse IA
            </a>
          </div>
        </form>
      </div>
    )

    const extraScripts = `
(() => {
  const form = document.getElementById('financeInputsForm');
  if (!form) {
    return;
  }
  const moduleCode = form.dataset.module;
  const statusEl = document.getElementById('saveStatus');
  const lastUpdatedEl = document.getElementById('financeLastUpdated');
  const completionEl = document.getElementById('financeCompletionValue');
  const currencyEl = document.getElementById('financeCurrencyValue');
  const submitBtn = form.querySelector('button[type="submit"]');
  const totalFields = ${totalFieldCount};

  const computeCompletion = () => {
    if (!form) return 0;
    let filled = 0;
    form.querySelectorAll('[data-field-input]').forEach((element) => {
      const value = element.value ?? '';
      if (typeof value === 'string' && value.trim().length) {
        filled += 1;
      }
    });
    return totalFields > 0 ? Math.round((filled / totalFields) * 100) : 0;
  };

  const updateCompletion = () => {
    if (completionEl) {
      completionEl.textContent = computeCompletion() + '%';
    }
  };

  form.addEventListener('input', updateCompletion);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!moduleCode) {
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('is-loading');
    }

    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.classList.remove('esono-alert--success', 'esono-alert--danger');
      statusEl.textContent = '';
      statusEl.classList.add('esono-alert');
    }

    const formData = new FormData(form);
    const payload = {};
    formData.forEach((value, key) => {
      payload[key] = typeof value === 'string' ? value : '';
    });

    try {
      const response = await fetch('/api/finance/inputs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleCode, payload })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Sauvegarde impossible');
      }

      if (statusEl) {
        statusEl.textContent = 'Données financières enregistrées.';
        statusEl.classList.add('esono-alert--success');
        statusEl.style.display = 'flex';
      }

      const updated = data?.inputs;
      if (updated) {
        if (lastUpdatedEl && updated.updated_at) {
          try {
            const date = new Date(updated.updated_at);
            lastUpdatedEl.textContent = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
          } catch (err) {
            console.warn('Impossible de formater la date', err);
          }
        }
        if (currencyEl && updated.currency) {
          currencyEl.textContent = String(updated.currency).toUpperCase();
        }
      }

      updateCompletion();
    } catch (error) {
      console.error('Finance inputs save error:', error);
      if (statusEl) {
        statusEl.textContent = error instanceof Error ? error.message : 'Erreur lors de la sauvegarde.';
        statusEl.classList.add('esono-alert--danger');
        statusEl.style.display = 'flex';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
      }
    }
  });
})();
`.replace(/</g, '\\u003c')

    return c.html(
      renderEsanoLayout({
        pageTitle: moduleTitle,
        pageDescription: 'Étape 3 — Inputs financiers',
        breadcrumb: [
          { label: 'Tableau de bord', href: '/dashboard' },
          { label: moduleTitle, href: `/module/${moduleCode}` },
          { label: 'Inputs financiers' }
        ],
        activeNav,
        navItems: resolvedNavItems,
        content: pageContent,
        extraScripts
      })
    )
  } catch (error) {
    console.error('Finance inputs page error:', error)
    return c.redirect('/dashboard')
  }
})

// B3 - Questions guidées (Input structurant)
moduleRoutes.get('/module/:code/questions', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    // Get progress
    const progress = await c.env.DB.prepare(`
      SELECT * FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    // Get existing answers
    const existingAnswers = await c.env.DB.prepare(`
      SELECT question_number, user_response FROM questions WHERE progress_id = ?
    `).bind(progress?.id || 0).all()

    const answersMap = new Map()
    existingAnswers.results.forEach((a: any) => {
      answersMap.set(a.question_number, a.user_response)
    })

    const content = getModuleContent(moduleCode)
    if (!content || !content.guided_questions) {
      return c.redirect(`/module/${moduleCode}`)
    }

    const moduleTitle = module.title as string
    const guidedQuestions = content.guided_questions!
    const progressPercentage = Math.round((3 / 7) * 100)
    const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'inputs')

    const pageContent = (
      <div class="esono-grid">
        <section class="esono-hero">
          <div class="esono-hero__header">
            <div>
              <h2 class="esono-hero__title">Questions guidées</h2>
              <p class="esono-hero__description">
                Formalisez chaque bloc du Business Model Canvas avec des réponses précises et actionnables.
              </p>
            </div>
            <span class="esono-hero__badge">
              <i class="fas fa-pen-to-square"></i>
              Étape 3 / 7
            </span>
          </div>
          <div class="esono-hero__metrics">
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{progressPercentage}%</p>
              <p class="esono-hero__metric-label">Progression</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">{guidedQuestions.length}</p>
              <p class="esono-hero__metric-label">Blocs à compléter</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">Auto-save</p>
              <p class="esono-hero__metric-label">Sécurisé</p>
            </div>
            <div class="esono-hero__metric">
              <p class="esono-hero__metric-value">B3</p>
              <p class="esono-hero__metric-label">Module</p>
            </div>
          </div>
        </section>

        <section class="esono-card">
          <div class="esono-card__header">
            <h2 class="esono-card__title">
              <i class="fas fa-diagram-project esono-card__title-icon"></i>
              Business Model Canvas – 9 blocs
            </h2>
            <span class="esono-note esono-note--info">
              <i class="fas fa-shield-check"></i>
              Sauvegarde automatique à la demande
            </span>
          </div>
          <div class="esono-card__body">
            <div class="esono-form__meta esono-mb-lg">
              <span>
                <i class="fas fa-circle-info"></i>
                Détaillez des éléments concrets pour préparer l’analyse IA
              </span>
              <span>
                <i class="fas fa-stopwatch"></i>
                Temps estimé : 30 — 45 min
              </span>
            </div>

            <div id="saveStatus" class="esono-alert esono-alert--success" style="display: none;">
              <span class="esono-alert__icon">
                <i class="fas fa-circle-check"></i>
              </span>
              <div class="esono-alert__content">
                <h3 class="esono-alert__title" id="saveStatusTitle">Réponse sauvegardée</h3>
                <p class="esono-alert__text" id="saveStatusText">
                  Votre réponse est enregistrée et prête pour l’analyse.
                </p>
              </div>
            </div>

            <div class="esono-progress esono-mb-lg">
              <div class="esono-progress__bar esono-progress__bar--accent" style={`width: ${progressPercentage}%`}></div>
            </div>

            <form id="canvasForm" class="esono-form">
              {guidedQuestions.map((q, index) => (
                <div class="esono-card esono-mb-lg">
                  <div class="esono-card__body">
                    <div class="esono-split esono-split--2-1">
                      <div>
                        <div class="esono-form__group">
                          <span class="esono-badge esono-badge--accent">
                            Bloc {index + 1}
                          </span>
                          <h3 class="esono-page-title" style="font-size: 1.125rem; margin-top: var(--spacing-sm);">
                            {q.section}
                          </h3>
                          <p class="esono-text-muted" style="margin: 0;">
                            {q.question}
                          </p>
                        </div>

                        <div class="esono-form__group esono-mt-lg">
                          <label class="esono-form__label" for={`question_${q.id}`}>
                            <i class="fas fa-pen"></i>
                            Votre réponse
                          </label>
                          <textarea
                            id={`question_${q.id}`}
                            name={`question_${q.id}`}
                            class="esono-textarea js-question-textarea"
                            data-question-id={q.id}
                            rows={6}
                            required
                            placeholder={q.placeholder}
                          >{(answersMap.get(q.id) as string | undefined) ?? ''}</textarea>
                          <div class="esono-form__meta">
                            <span>
                              <i class="far fa-keyboard"></i>
                              <span data-char-counter={q.id}>0</span> caractères
                            </span>
                            <button
                              type="button"
                              class="esono-btn esono-btn--secondary esono-btn--sm js-save-answer"
                              data-question-id={q.id}
                            >
                              <i class="fas fa-cloud-arrow-up"></i>
                              Sauvegarder ce bloc
                            </button>
                          </div>
                        </div>
                      </div>

                      <div style="display: flex; flex-direction: column; gap: var(--spacing-md);">
                        <div class="esono-note esono-note--info">
                          <strong style="display: block; margin-bottom: 4px;">Conseil du coach</strong>
                          <span>{q.help_text}</span>
                        </div>
                        <div class="esono-note esono-note--success">
                          <strong style="display: block; margin-bottom: 4px;">Exemple inspirant</strong>
                          <span>{q.example}</span>
                        </div>
                        <div class="esono-note esono-note--danger">
                          <strong style="display: block; margin-bottom: 4px;">À éviter</strong>
                          <span>{q.common_mistake}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div class="esono-form__actions">
                <button type="submit" class="esono-btn esono-btn--primary">
                  Soumettre pour analyse IA
                  <i class="fas fa-arrow-right"></i>
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    )

    const extraScripts = `
(() => {
  const moduleCode = ${JSON.stringify(moduleCode)};
  const saveStatus = document.getElementById('saveStatus');
  const saveStatusTitle = document.getElementById('saveStatusTitle');
  const saveStatusText = document.getElementById('saveStatusText');
  const form = document.getElementById('canvasForm');
  if (!form) {
    return;
  }

  const textareas = Array.from(document.querySelectorAll('.js-question-textarea'));
  let statusTimeout = null;

  const setStatus = (type, title, message) => {
    if (!saveStatus) {
      return;
    }

    saveStatus.style.display = 'flex';
    saveStatus.classList.remove('esono-alert--success', 'esono-alert--danger', 'esono-alert--info');

    let targetClass = 'esono-alert--success';
    if (type === 'error') {
      targetClass = 'esono-alert--danger';
    } else if (type === 'info') {
      targetClass = 'esono-alert--info';
    }
    saveStatus.classList.add(targetClass);

    if (saveStatusTitle) {
      saveStatusTitle.textContent = title;
    }
    if (saveStatusText) {
      saveStatusText.textContent = message;
    }

    if (statusTimeout) {
      window.clearTimeout(statusTimeout);
    }
    statusTimeout = window.setTimeout(() => {
      saveStatus.style.display = 'none';
    }, 4000);
  };

  const updateCounter = (textarea) => {
    const questionId = textarea.dataset.questionId;
    if (!questionId) {
      return;
    }
    const counter = document.querySelector('[data-char-counter="' + questionId + '"]');
    if (counter) {
      counter.textContent = textarea.value.length;
    }
  };

  textareas.forEach((textarea) => {
    updateCounter(textarea);
    textarea.addEventListener('input', () => {
      textarea.classList.remove('is-error');
      updateCounter(textarea);
    });
  });

  async function saveAnswer(questionId) {
    const textarea = document.querySelector('.js-question-textarea[data-question-id="' + questionId + '"]');
    if (!textarea) {
      return;
    }

    const value = textarea.value.trim();
    if (!value) {
      textarea.classList.add('is-error');
      setStatus('error', 'Réponse requise', 'Veuillez renseigner ce bloc avant de sauvegarder.');
      return;
    }

    try {
      const response = await fetch('/api/module/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_code: moduleCode,
          question_number: Number(questionId),
          answer: value
        })
      });

      if (!response.ok) {
        throw new Error('request_failed');
      }

      textarea.classList.remove('is-error');
      textarea.classList.add('is-success');
      setStatus('success', 'Réponse sauvegardée', 'Votre bloc est bien enregistré.');
      window.setTimeout(() => {
        textarea.classList.remove('is-success');
      }, 2000);
    } catch (error) {
      console.error('Save error:', error);
      setStatus('error', 'Erreur de sauvegarde', 'Impossible de sauvegarder pour le moment. Réessayez plus tard.');
    }
  }

  document.querySelectorAll('.js-save-answer').forEach((button) => {
    button.addEventListener('click', () => {
      const questionId = button.getAttribute('data-question-id');
      if (questionId) {
        saveAnswer(questionId);
      }
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    let allAnswered = true;
    const answers = [];

    textareas.forEach((textarea) => {
      const questionId = Number(textarea.dataset.questionId);
      const value = textarea.value.trim();
      if (!value) {
        allAnswered = false;
        textarea.classList.add('is-error');
      } else {
        answers.push({
          question_number: questionId,
          answer: value
        });
      }
    });

    if (!allAnswered) {
      setStatus('error', 'Champs manquants', 'Complétez tous les blocs avant de soumettre pour analyse.');
      return;
    }

    try {
      setStatus('info', 'Analyse IA en cours', 'Nous envoyons vos réponses à l’IA pour analyse.');
      const response = await fetch('/api/module/submit-answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_code: moduleCode,
          answers
        })
      });

      if (!response.ok) {
        throw new Error('submit_failed');
      }

      window.location.href = '/module/' + moduleCode + '/analysis';
    } catch (error) {
      console.error('Submit error:', error);
      setStatus('error', 'Soumission impossible', 'Une erreur est survenue lors de l’envoi. Veuillez réessayer.');
    }
  });
})();
`

    return c.html(
      renderEsanoLayout({
        pageTitle: moduleTitle,
        pageDescription: 'Étape 3 — Questions guidées',
        breadcrumb: [
          { label: 'Tableau de bord', href: '/dashboard' },
          { label: moduleTitle, href: `/module/${moduleCode}` },
          { label: 'Questions guidées' }
        ],
        activeNav,
        navItems: resolvedNavItems,
        content: pageContent,
        headerActions: (
          <div class="esono-form__actions">
            <a href={`/module/${moduleCode}/quiz`} class="esono-btn esono-btn--ghost">
              <i class="fas fa-circle-arrow-left"></i>
              Revoir le quiz
            </a>
            <a href={`/module/${moduleCode}/analysis`} class="esono-btn esono-btn--primary">
              Prévisualiser l’analyse IA
              <i class="fas fa-arrow-right"></i>
            </a>
          </div>
        ),
        extraScripts
      })
    )
  } catch (error) {
    console.error('Questions error:', error)
    return c.redirect('/dashboard')
  }
})

// B4 - Analyse IA / Challenge
moduleRoutes.get('/module/:code/analysis', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    const variant = getModuleVariant(moduleCode)

    if (variant === 'finance' && moduleCode !== 'mod3_inputs') {
      return c.redirect(`/module/${moduleCode}/inputs`)
    }
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    const progress = await c.env.DB.prepare(`
      SELECT * FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) {
      return c.redirect(`/module/${moduleCode}/questions`)
    }

    const answers = await c.env.DB.prepare(`
      SELECT question_number, user_response
      FROM questions
      WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress.id).all()

    if (moduleCode !== 'mod3_inputs' && (!answers.results.length || answers.results.every((a: any) => !a.user_response || !a.user_response.trim()))) {
      return c.redirect(`/module/${moduleCode}/questions`)
    }

    const content = getModuleContent(moduleCode)
    const sectionDetailsMap = new Map<number, { section: string, question: string }>()
    content?.guided_questions?.forEach((q) => {
      sectionDetailsMap.set(q.id, { section: q.section, question: q.question })
    })

    const answersMap = new Map<number, string>()
    answers.results.forEach((a: any) => {
      if (a.user_response && a.user_response.trim()) {
        answersMap.set(a.question_number, a.user_response)
      }
    })

    if (!answersMap.size && moduleCode !== 'mod3_inputs') {
      return c.redirect(`/module/${moduleCode}/questions`)
    }

    // ═══ Module 3 Inputs Financiers — dedicated analysis page ═══
    if (moduleCode === 'mod3_inputs') {
      const fiRow = await c.env.DB.prepare('SELECT * FROM financial_inputs WHERE user_id = ? AND module_id = ? LIMIT 1')
        .bind(payload.userId, module.id).first()

      if (!fiRow) {
        return c.redirect('/module/mod3_inputs/inputs')
      }

      const FI_COLS: Record<InputTabKey, string> = {
        infos_generales: 'infos_generales_json', donnees_historiques: 'donnees_historiques_json',
        produits_services: 'produits_services_json', ressources_humaines: 'ressources_humaines_json',
        hypotheses_croissance: 'hypotheses_croissance_json', couts_fixes_variables: 'couts_fixes_variables_json',
        bfr_tresorerie: 'bfr_tresorerie_json', investissements: 'investissements_json', financement: 'financement_json'
      }
      const allData: Record<InputTabKey, Record<string, any>> = {} as any
      for (const tabKey of INPUT_TAB_ORDER) {
        const raw = (fiRow as any)[FI_COLS[tabKey]]
        allData[tabKey] = raw ? JSON.parse(raw) : {}
      }

      const inputsAnalysis = analyzeInputs(allData)

      // Persist analysis
      await c.env.DB.prepare(`
        UPDATE financial_inputs SET completeness_pct = ?, readiness_score = ?, analysis_json = ?, analysis_timestamp = datetime('now'),
          marge_brute_pct = ?, marge_op_pct = ?, marge_nette_pct = ?, updated_at = datetime('now')
        WHERE user_id = ? AND module_id = ?
      `).bind(
        inputsAnalysis.overallCompleteness, inputsAnalysis.readinessScore, JSON.stringify(inputsAnalysis),
        inputsAnalysis.financialRatios.margeBrute, inputsAnalysis.financialRatios.margeOperationnelle, inputsAnalysis.financialRatios.margeNette,
        payload.userId, module.id
      ).run()

      await c.env.DB.prepare(`UPDATE progress SET ai_score = ?, ai_feedback_json = ?, ai_last_analysis = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .bind(inputsAnalysis.readinessScore, JSON.stringify(inputsAnalysis), progress.id).run()

      const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'analysis')
      const readinessInfo = getInputsReadinessLabel(inputsAnalysis.readinessScore)
      const scoreColor = readinessInfo.color === 'green' ? '#059669' : readinessInfo.color === 'blue' ? '#0284c7' : readinessInfo.color === 'yellow' ? '#d97706' : '#dc2626'
      const errCount = inputsAnalysis.alerts.filter(a => a.level === 'error').length
      const warnCount = inputsAnalysis.alerts.filter(a => a.level === 'warning').length

      const pageContent = (
        <div class="esono-grid">
          {/* Hero Score */}
          <section class="esono-hero" style={`background:linear-gradient(135deg, ${scoreColor}15 0%, ${scoreColor}05 100%);border:1px solid ${scoreColor}30;`}>
            <div class="esono-hero__header">
              <div style="display:flex;align-items:center;gap:20px;">
                <div style={`width:90px;height:90px;border-radius:50%;background:${scoreColor};display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-size:24px;font-weight:800;`}>
                  {inputsAnalysis.readinessScore}%
                  <span style="font-size:10px;font-weight:400;opacity:0.9;">Readiness</span>
                </div>
                <div>
                  <h2 class="esono-hero__title" style="margin-bottom:4px;">Analyse Inputs Financiers</h2>
                  <span style={`display:inline-block;padding:4px 12px;border-radius:20px;background:${scoreColor}20;color:${scoreColor};font-weight:700;font-size:13px;margin-bottom:8px;`}>
                    {readinessInfo.label}
                  </span>
                  <p style="font-size:14px;color:#475569;max-width:500px;">{inputsAnalysis.verdict}</p>
                </div>
              </div>
            </div>
            <div class="esono-hero__metrics">
              <div class="esono-hero__metric"><p class="esono-hero__metric-value">{inputsAnalysis.overallCompleteness}%</p><p class="esono-hero__metric-label">Complétude</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value" style={errCount > 0 ? 'color:#dc2626;' : ''}>{errCount}</p><p class="esono-hero__metric-label">Erreurs</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value" style={warnCount > 0 ? 'color:#d97706;' : ''}>{warnCount}</p><p class="esono-hero__metric-label">Alertes</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value">{inputsAnalysis.tabs.filter(t => t.completeness >= 80).length}/9</p><p class="esono-hero__metric-label">Onglets OK</p></div>
            </div>
          </section>

          {/* Tab-by-tab completeness */}
          <section class="esono-card">
            <div class="esono-card__header">
              <h2 class="esono-card__title"><i class="fas fa-chart-bar esono-card__title-icon"></i>Complétude par onglet</h2>
            </div>
            <div class="esono-card__body" style="display:flex;flex-direction:column;gap:8px;">
              {inputsAnalysis.tabs.map(tab => {
                const barColor = tab.completeness >= 80 ? '#059669' : tab.completeness >= 50 ? '#d97706' : '#dc2626'
                const tabAlertCount = tab.alerts.filter(a => a.level === 'error').length
                return (
                  <div style="padding:10px;border:1px solid #e5e7eb;border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                      <span style="font-weight:600;font-size:13px;">{tab.label}</span>
                      <div style="display:flex;align-items:center;gap:8px;">
                        {tabAlertCount > 0 && <span style="background:#fee2e2;color:#991b1b;font-size:11px;padding:2px 8px;border-radius:12px;font-weight:600;">{tabAlertCount} err.</span>}
                        <span style={`font-weight:700;color:${barColor};`}>{tab.completeness}%</span>
                      </div>
                    </div>
                    <div style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;">
                      <div style={`height:100%;width:${tab.completeness}%;background:${barColor};border-radius:3px;`}></div>
                    </div>
                    {tab.strengths.length > 0 && (
                      <div style="margin-top:6px;">{tab.strengths.map(s => <div style="font-size:12px;color:#059669;">✓ {s}</div>)}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Financial Ratios */}
          <section class="esono-card">
            <div class="esono-card__header">
              <h2 class="esono-card__title"><i class="fas fa-chart-pie esono-card__title-icon"></i>Ratios Financiers Clés</h2>
            </div>
            <div class="esono-card__body">
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                {[
                  { label: 'Marge brute', val: inputsAnalysis.financialRatios.margeBrute, bench: '>30%', unit: '%' },
                  { label: 'Marge opér.', val: inputsAnalysis.financialRatios.margeOperationnelle, bench: '>15%', unit: '%' },
                  { label: 'Marge nette', val: inputsAnalysis.financialRatios.margeNette, bench: '>10%', unit: '%' },
                  { label: 'DSO', val: inputsAnalysis.financialRatios.dso, bench: '<45j', unit: 'j' },
                  { label: 'CAGR 5 ans', val: inputsAnalysis.financialRatios.cagr5Ans, bench: '15-30%', unit: '%' },
                  { label: 'Ch. fixes/CA', val: inputsAnalysis.financialRatios.chargesFixesSurCA, bench: '<50%', unit: '%' }
                ].map(r => (
                  <div style="background:#f8fafc;padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:11px;color:#64748b;margin-bottom:4px;">{r.label}</div>
                    <div style="font-size:22px;font-weight:700;color:#1e293b;">{r.val !== null ? `${r.val}${r.unit}` : '—'}</div>
                    <div style="font-size:10px;color:#94a3b8;">Bench: {r.bench}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Alerts */}
          {inputsAnalysis.alerts.length > 0 && (
            <section class="esono-card">
              <div class="esono-card__header">
                <h2 class="esono-card__title" style="color:#d97706;"><i class="fas fa-triangle-exclamation esono-card__title-icon"></i>Alertes IA ({inputsAnalysis.alerts.length})</h2>
              </div>
              <div class="esono-card__body" style="display:flex;flex-direction:column;gap:6px;">
                {inputsAnalysis.alerts.slice(0, 15).map(alert => (
                  <div style={`padding:8px 12px;border-radius:6px;font-size:13px;border-left:3px solid ${alert.level === 'error' ? '#dc2626' : alert.level === 'warning' ? '#d97706' : '#3b82f6'};background:${alert.level === 'error' ? '#fee2e2' : alert.level === 'warning' ? '#fef3c7' : '#dbeafe'};`}>
                    <strong style="font-size:11px;color:#64748b;">[{INPUT_TAB_LABELS[alert.tab]?.shortLabel}]</strong>{' '}
                    {alert.message}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recommendations */}
          <section class="esono-card">
            <div class="esono-card__header">
              <h2 class="esono-card__title"><i class="fas fa-lightbulb esono-card__title-icon" style="color:#d97706;"></i>Recommandations</h2>
            </div>
            <div class="esono-card__body">
              <ol style="padding-left:20px;">
                {inputsAnalysis.recommendations.map(r => <li style="margin-bottom:6px;font-size:14px;">{r}</li>)}
              </ol>
            </div>
          </section>

          {/* Actions */}
          <div class="esono-form__actions">
            <a href="/module/mod3_inputs/inputs" class="esono-btn esono-btn--secondary">
              <i class="fas fa-pen-to-square"></i> Modifier mes données
            </a>
            <a href="/module/mod3_inputs/validate" class="esono-btn esono-btn--primary">
              <i class="fas fa-check-circle"></i> Valider le module
            </a>
            <a href="/module/mod3_inputs/download" class="esono-btn esono-btn--accent">
              <i class="fas fa-file-arrow-down"></i> Voir le livrable
            </a>
          </div>
        </div>
      )

      return c.html(renderEsanoLayout({
        pageTitle: 'Analyse Inputs Financiers — Module 3',
        navItems: resolvedNavItems,
        activeNav,
        content: pageContent
      }))
    }

    // ─── SIC-specific analysis or generic mock feedback ───
    const isSicModule = moduleCode === 'mod2_sic'
    let sicAnalysis: SicAnalysisResult | null = null
    let overallScore: number
    let scoreInfo: { label: string, color: string }
    let sectionSummaries: Array<{
      questionId: number
      sectionName: string
      questionText?: string
      answer: string
      strengths: Array<{ message: string, score: number }>
      suggestions: Array<{ message: string, score: number }>
      questions: Array<{ message: string, score: number }>
      percentage: number
      scoreInfo: { label: string, color: string }
      palette: ReturnType<typeof getAnalysisPalette>
    }>
    let strengthsCount: number
    let suggestionsCount: number
    let questionsCount: number
    let sectionsNeedingWork: number
    let topSuggestions: Array<{ section: string, questionId: number, message: string, score: number }>

    if (isSicModule) {
      // ─── Fetch BMC answers for coherence check ───
      const bmcModule = await c.env.DB.prepare(`SELECT id FROM modules WHERE module_code = 'mod1_bmc'`).first()
      let bmcAnswers: Map<number, string> | undefined
      if (bmcModule) {
        const bmcProgress = await c.env.DB.prepare(`
          SELECT id FROM progress WHERE user_id = ? AND module_id = ?
        `).bind(payload.userId, bmcModule.id).first()
        if (bmcProgress) {
          const bmcResult = await c.env.DB.prepare(`
            SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
          `).bind(bmcProgress.id).all()
          bmcAnswers = new Map<number, string>()
          for (const row of (bmcResult.results ?? [])) {
            const qn = Number((row as any).question_number)
            const r = ((row as any).user_response as string ?? '').trim()
            if (r) bmcAnswers.set(qn, r)
          }
        }
      }

      // Run SIC analysis engine
      sicAnalysis = analyzeSIC(answersMap, bmcAnswers)
      overallScore = Math.round(sicAnalysis.scoreGlobal * 10) // /10 → %
      scoreInfo = getScoreLabel(overallScore)

      // Convert SIC sections to unified format
      sectionSummaries = sicAnalysis.sections.map((sec) => {
        const sectionScoreInfo = getScoreLabel(sec.percentage)
        return {
          questionId: Object.entries(SIC_QUESTION_MAP)
            .filter(([, s]) => s === sec.key).map(([id]) => Number(id))[0] ?? 0,
          sectionName: sec.label,
          questionText: undefined,
          answer: '',
          strengths: sec.strengths.map(s => ({ message: s, score: Math.round(sec.score / 2) })),
          suggestions: sec.feedback.map(f => ({ message: f, score: Math.round((10 - sec.score) / 2) })),
          questions: sec.warnings.map(w => ({ message: w, score: 1 })),
          percentage: sec.percentage,
          scoreInfo: sectionScoreInfo,
          palette: getAnalysisPalette(sectionScoreInfo.color)
        }
      })

      strengthsCount = sectionSummaries.reduce((s, sec) => s + sec.strengths.length, 0)
      suggestionsCount = sectionSummaries.reduce((s, sec) => s + sec.suggestions.length, 0)
      questionsCount = sectionSummaries.reduce((s, sec) => s + sec.questions.length, 0)
      sectionsNeedingWork = sectionSummaries.filter(sec => sec.suggestions.length || sec.questions.length).length

      topSuggestions = sicAnalysis.recommendations.slice(0, 3).map((msg, i) => ({
        section: 'Recommandation',
        questionId: i + 1,
        message: msg,
        score: 1
      }))

      // Persist to DB
      await c.env.DB.prepare(`
        UPDATE progress
        SET ai_score = ?,
            ai_feedback_json = ?,
            ai_last_analysis = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(overallScore, JSON.stringify(sicAnalysis), progress.id).run()

      // Update per-question feedback
      for (const sec of sicAnalysis.sections) {
        const qIds = Object.entries(SIC_QUESTION_MAP).filter(([, s]) => s === sec.key).map(([id]) => Number(id))
        for (const qId of qIds) {
          const feedbackPayload = JSON.stringify({
            suggestions: sec.feedback,
            questions: sec.warnings,
            percentage: sec.percentage,
            scoreLabel: sec.score >= 7 ? 'Excellent' : sec.score >= 5 ? 'Bien' : sec.score >= 3 ? 'A ameliorer' : 'Insuffisant'
          })
          await c.env.DB.prepare(`
            UPDATE questions SET ai_feedback = ?, quality_score = ?, feedback_updated_at = datetime('now')
            WHERE progress_id = ? AND question_number = ?
          `).bind(feedbackPayload, Math.round(sec.score * 10), progress.id, qId).run()
        }
      }
    } else {
      // ─── Generic mock feedback for other modules ───
      const feedback = generateMockFeedback(answersMap)
      overallScore = calculateOverallScore(feedback)
      scoreInfo = getScoreLabel(overallScore)

      sectionSummaries = answers.results
        .filter((a: any) => a.user_response && a.user_response.trim())
        .map((a: any) => {
          const sectionName = getSectionName(a.question_number)
          const details = sectionDetailsMap.get(a.question_number)
          const sectionFeedbackItems = feedback.filter((item) => item.section === sectionName)
          const strengths = sectionFeedbackItems.filter((item) => item.type === 'strength')
          const suggestions = sectionFeedbackItems.filter((item) => item.type === 'suggestion')
          const questionsItems = sectionFeedbackItems.filter((item) => item.type === 'question')
          const averageScore = sectionFeedbackItems.length
            ? Math.round(sectionFeedbackItems.reduce((sum, item) => sum + item.score, 0) / sectionFeedbackItems.length)
            : 0
          const percentage = Math.round((averageScore / 5) * 100)
          const sectionScoreInfo = getScoreLabel(percentage)
          return {
            questionId: a.question_number,
            sectionName,
            questionText: details?.question,
            answer: a.user_response,
            strengths,
            suggestions,
            questions: questionsItems,
            percentage,
            scoreInfo: sectionScoreInfo,
            palette: getAnalysisPalette(sectionScoreInfo.color)
          }
        })

      strengthsCount = feedback.filter((item) => item.type === 'strength').length
      suggestionsCount = feedback.filter((item) => item.type === 'suggestion').length
      questionsCount = feedback.filter((item) => item.type === 'question').length
      sectionsNeedingWork = sectionSummaries.filter((section) => section.suggestions.length || section.questions.length).length

      topSuggestions = sectionSummaries
        .flatMap((section) => section.suggestions.map((item) => ({
          section: section.sectionName,
          questionId: section.questionId,
          message: item.message,
          score: item.score
        })))
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)

      const summaryPayload = {
        overallScore,
        overallLabel: scoreInfo.label,
        palette: scoreInfo.color,
        strengthsCount,
        suggestionsCount,
        questionsCount,
        sectionsNeedingWork,
        topSuggestions
      }

      const sanitizeItems = (items: any[]) =>
        items.map((item) => ({ message: item.message, score: item.score }))

      for (const section of sectionSummaries) {
        const pl = {
          sectionName: section.sectionName,
          questionId: section.questionId,
          questionText: section.questionText,
          percentage: section.percentage,
          scoreLabel: section.scoreInfo.label,
          strengths: sanitizeItems(section.strengths),
          suggestions: sanitizeItems(section.suggestions),
          questions: sanitizeItems(section.questions)
        }
        await c.env.DB.prepare(`
          UPDATE questions SET ai_feedback = ?, quality_score = ?, feedback_updated_at = datetime('now')
          WHERE progress_id = ? AND question_number = ?
        `).bind(JSON.stringify(pl), section.percentage, progress.id, section.questionId).run()
      }

      await c.env.DB.prepare(`
        UPDATE progress
        SET ai_score = ?,
            ai_feedback_json = ?,
            ai_last_analysis = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(overallScore, JSON.stringify(summaryPayload), progress.id).run()
    }

    const moduleTitle = module.title as string
    const scoreIcon = (SCORE_BADGE_STYLES[scoreInfo.label as keyof typeof SCORE_BADGE_STYLES] ?? SCORE_BADGE_STYLES.default).icon
    const overallTone = getScoreToneStyles(scoreInfo.label)
    const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'analysis')

    const pageContent = (
      <div class="esono-grid">
        <section class="esono-hero">
          <div class="esono-hero__header">
            <div>
              <h2 class="esono-hero__title">{isSicModule ? "Analyse IA — Social Impact Canvas" : "Analyse IA du Canvas"}</h2>
              <p class="esono-hero__description">
                L’IA a passé en revue vos réponses et met en évidence vos forces ainsi que les axes à renforcer avant validation.
              </p>
            </div>
            <span class="esono-hero__badge">
              <i class="fas fa-robot"></i>
              Étape 4 / 7
            </span>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: var(--spacing-xl); align-items: center;">
            <div class="esono-hero__score-central" style={`background: ${overallTone.barColor};`}>
              <i class={scoreIcon} style="display: block; color: rgba(255, 255, 255, 0.85); font-size: 1.25rem; margin-bottom: var(--spacing-sm);"></i>
              <div class="esono-hero__score-value">{overallScore}%</div>
              <div class="esono-hero__score-label">{scoreInfo.label}</div>
            </div>
            <div class="esono-hero__metrics" style="flex: 1; min-width: 260px;">
              <div class="esono-hero__metric esono-hero__metric--success">
                <p class="esono-hero__metric-value">{strengthsCount}</p>
                <p class="esono-hero__metric-label">Forces détectées</p>
              </div>
              <div class="esono-hero__metric esono-hero__metric--warning">
                <p class="esono-hero__metric-value">{suggestionsCount}</p>
                <p class="esono-hero__metric-label">Axes d’amélioration</p>
              </div>
              <div class="esono-hero__metric esono-hero__metric--info">
                <p class="esono-hero__metric-value">{questionsCount}</p>
                <p class="esono-hero__metric-label">Questions ouvertes</p>
              </div>
              <div class="esono-hero__metric">
                <p class="esono-hero__metric-value">{sectionsNeedingWork}</p>
                <p class="esono-hero__metric-label">Blocs à consolider</p>
              </div>
              {isSicModule && sicAnalysis && (
                <>
                  <div class="esono-hero__metric esono-hero__metric--info">
                    <p class="esono-hero__metric-value">{sicAnalysis.smartCheck.score}/5</p>
                    <p class="esono-hero__metric-label">SMART Score</p>
                  </div>
                  <div class="esono-hero__metric">
                    <p class="esono-hero__metric-value">{sicAnalysis.oddMappings.length}</p>
                    <p class="esono-hero__metric-label">ODD cibles</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section class="esono-card">
          <div class="esono-card__body">
            <div class="esono-grid esono-grid--3 esono-mb-lg">
              <div class="esono-kpi-card">
                <div class="esono-kpi-card__header">
                  <span class="esono-kpi-card__label">Forces principales</span>
                  <span class="esono-kpi-card__icon esono-kpi-card__icon--success">
                    <i class="fas fa-arrow-trend-up"></i>
                  </span>
                </div>
                <div class="esono-kpi-card__value">{strengthsCount}</div>
                <div class="esono-kpi-card__footer">
                  Observations positives relevées par l’IA.
                </div>
              </div>
              <div class="esono-kpi-card">
                <div class="esono-kpi-card__header">
                  <span class="esono-kpi-card__label">Axes à renforcer</span>
                  <span class="esono-kpi-card__icon esono-kpi-card__icon--warning">
                    <i class="fas fa-lightbulb"></i>
                  </span>
                </div>
                <div class="esono-kpi-card__value">{suggestionsCount}</div>
                <div class="esono-kpi-card__footer">
                  Recommandations IA pour clarifier ou chiffrer vos blocs.
                </div>
              </div>
              <div class="esono-kpi-card">
                <div class="esono-kpi-card__header">
                  <span class="esono-kpi-card__label">Questions de suivi</span>
                  <span class="esono-kpi-card__icon esono-kpi-card__icon--primary">
                    <i class="fas fa-question-circle"></i>
                  </span>
                </div>
                <div class="esono-kpi-card__value">{questionsCount}</div>
                <div class="esono-kpi-card__footer">
                  Points à détailler auprès du coach ou des bailleurs.
                </div>
              </div>
            </div>

            <div class="esono-split esono-split--3-2">
              <div style="display: flex; flex-direction: column; gap: var(--spacing-lg);">
                {sectionSummaries.map((section) => {
                  const tone = getScoreToneStyles(section.scoreInfo.label)
                  const sectionIcon = (SCORE_BADGE_STYLES[section.scoreInfo.label as keyof typeof SCORE_BADGE_STYLES] ?? SCORE_BADGE_STYLES.default).icon
                  return (
                    <div
                      class="esono-card"
                      key={`section-${section.questionId}`}
                      style={`border-color: ${tone.borderColor}; box-shadow: var(--shadow-sm);`}
                    >
                      <div
                        class="esono-card__header"
                        style={`background: ${tone.backgroundColor}; border-bottom: 1px solid ${tone.borderColor};`}
                      >
                        <div>
                          <h3 class="esono-card__title" style={`color: ${tone.badgeColor};`}>
                            <i class={sectionIcon} style={`color: ${tone.badgeColor};`}></i>
                            {section.sectionName}
                          </h3>
                          {section.questionText && (
                            <p class="esono-text-sm esono-text-muted" style="margin-top: 4px;">
                              {section.questionText}
                            </p>
                          )}
                        </div>
                        <div style="text-align: right;">
                          <span
                            class="esono-badge"
                            style={`background: ${tone.badgeBackground}; color: ${tone.badgeColor};`}
                          >
                            {section.percentage}% · {section.scoreInfo.label}
                          </span>
                          <div class="esono-progress esono-mt-lg" style="width: 220px;">
                            <div
                              class="esono-progress__bar"
                              style={`width: ${section.percentage}%; background: ${tone.barColor};`}
                            ></div>
                          </div>
                        </div>
                      </div>

                      <div class="esono-card__body" style="display: flex; flex-direction: column; gap: var(--spacing-md);">
                        <div class="esono-note">
                          <strong style="display: block; margin-bottom: 4px;">Réponse actuelle</strong>
                          <span style="white-space: pre-line;">{section.answer}</span>
                        </div>

                        <div style="display: grid; gap: var(--spacing-md); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
                          {section.strengths.length > 0 && (
                            <div class="esono-note esono-note--success">
                              <strong style="display: block; margin-bottom: 4px;">Forces détectées</strong>
                              <ul style="margin: 0; padding-left: var(--spacing-md);">
                                {section.strengths.map((item, idx) => (
                                  <li key={`strength-${section.questionId}-${idx}`} class="esono-text-sm">
                                    {item.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {section.suggestions.length > 0 && (
                            <div class="esono-note esono-note--warning">
                              <strong style="display: block; margin-bottom: 4px;">Axes d’amélioration</strong>
                              <ul style="margin: 0; padding-left: var(--spacing-md);">
                                {section.suggestions.map((item, idx) => (
                                  <li key={`suggestion-${section.questionId}-${idx}`} class="esono-text-sm">
                                    {item.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {section.questions.length > 0 && (
                            <div class="esono-note esono-note--info">
                              <strong style="display: block; margin-bottom: 4px;">Points à clarifier</strong>
                              <ul style="margin: 0; padding-left: var(--spacing-md);">
                                {section.questions.map((item, idx) => (
                                  <li key={`question-${section.questionId}-${idx}`} class="esono-text-sm">
                                    {item.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <aside style="display: flex; flex-direction: column; gap: var(--spacing-lg);">
                <div class="esono-card">
                  <div class="esono-card__header">
                    <h3 class="esono-card__title">
                      <i class="fas fa-list-check esono-card__title-icon"></i>
                      Priorités d’amélioration
                    </h3>
                  </div>
                  <div class="esono-card__body">
                    {topSuggestions.length ? (
                      <ol
                        style="margin: 0; padding-left: var(--spacing-lg); display: flex; flex-direction: column; gap: var(--spacing-sm);"
                        class="esono-text-sm"
                      >
                        {topSuggestions.map((item, idx) => (
                          <li key={`top-suggestion-${idx}`}>
                            <strong>{item.section}</strong>
                            <span style="display: block; margin-top: 2px;">{item.message}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p class="esono-text-sm esono-text-muted">
                        Aucune priorité critique détectée. Vous pouvez avancer vers l’amélioration ou la validation.
                      </p>
                    )}
                  </div>
                </div>

                <div class="esono-card esono-card--ai">
                  <div class="esono-card__header">
                    <h3 class="esono-card__title">
                      <i class="fas fa-sparkles esono-card__title-icon"></i>
                      Conseils IA
                    </h3>
                  </div>
                  <div class="esono-card__body">
                    <ul
                      class="esono-text-sm"
                      style="margin: 0; padding-left: var(--spacing-md); list-style: disc; color: var(--esono-info);"
                    >
                      <li>Quantifiez vos éléments clés (marché, revenus, coûts) dès que possible.</li>
                      <li>Illustrez vos réponses par des preuves terrain adaptées à votre contexte.</li>
                      <li>Vérifiez la cohérence entre segments clients, proposition de valeur et canaux.</li>
                      <li>Mettez en avant votre différenciation face aux concurrents.</li>
                    </ul>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* ─── SIC-specific analysis sections ─── */}
        {isSicModule && sicAnalysis && (
          <>
            {/* SMART Check */}
            <section class="esono-card">
              <div class="esono-card__header">
                <h3 class="esono-card__title">
                  <i class="fas fa-bullseye esono-card__title-icon"></i>
                  Vérification SMART de l'indicateur
                </h3>
                <span class="esono-badge" style={`background: ${sicAnalysis.smartCheck.score >= 4 ? 'var(--esono-success-light)' : 'var(--esono-warning-light)'}; color: ${sicAnalysis.smartCheck.score >= 4 ? 'var(--esono-success)' : 'var(--esono-warning)'};`}>
                  {sicAnalysis.smartCheck.score}/5
                </span>
              </div>
              <div class="esono-card__body">
                <p class="esono-text-sm esono-text-muted" style="margin-bottom: var(--spacing-md);">{sicAnalysis.smartCheck.feedback}</p>
                <div style="display: flex; gap: var(--spacing-sm); flex-wrap: wrap;">
                  {[
                    { label: 'Spécifique', ok: sicAnalysis.smartCheck.isSpecific },
                    { label: 'Mesurable', ok: sicAnalysis.smartCheck.isMeasurable },
                    { label: 'Atteignable', ok: sicAnalysis.smartCheck.isAttainable },
                    { label: 'Pertinent', ok: sicAnalysis.smartCheck.isRelevant },
                    { label: 'Temporel', ok: sicAnalysis.smartCheck.isTimeBound }
                  ].map((item, idx) => (
                    <span
                      key={`smart-${idx}`}
                      class="esono-badge"
                      style={`background: ${item.ok ? 'var(--esono-success-light)' : 'var(--esono-danger-light)'}; color: ${item.ok ? 'var(--esono-success)' : 'var(--esono-danger)'};`}
                    >
                      <i class={item.ok ? 'fas fa-check' : 'fas fa-times'}></i>
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            {/* ODD Alignment */}
            <section class="esono-card">
              <div class="esono-card__header">
                <h3 class="esono-card__title">
                  <i class="fas fa-globe-africa esono-card__title-icon"></i>
                  Alignement ODD ({sicAnalysis.oddMappings.length} cible{sicAnalysis.oddMappings.length > 1 ? 's' : ''})
                </h3>
              </div>
              <div class="esono-card__body">
                {sicAnalysis.oddMappings.length > 0 ? (
                  <div style="display: grid; gap: var(--spacing-sm);">
                    {sicAnalysis.oddMappings.map((odd, idx) => {
                      const oddColor = ODD_ICONS[odd.oddNumber] ?? '#666'
                      const evLabel = odd.evidenceLevel === 'prouve' ? 'Prouvé' : odd.evidenceLevel === 'mesure' ? 'Mesuré' : 'Déclaré'
                      return (
                        <div key={`odd-${idx}`} style={`display: flex; align-items: center; gap: var(--spacing-md); padding: var(--spacing-sm) var(--spacing-md); border-radius: var(--radius-md); border: 1px solid ${oddColor}33; background: ${oddColor}08;`}>
                          <div style={`width: 40px; height: 40px; border-radius: var(--radius-sm); background: ${oddColor}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0;`}>
                            {odd.oddNumber}
                          </div>
                          <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 13px;">{odd.oddLabel}</div>
                            <div class="esono-text-sm esono-text-muted" style="margin-top: 2px;">
                              {odd.contributionType === 'direct' ? 'Direct' : 'Indirect'} · {evLabel} · Score: {odd.score}/3
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p class="esono-text-sm esono-text-muted">Aucun ODD identifié. Complétez la section ODD & Contribution.</p>
                )}
              </div>
            </section>

            {/* Impact Matrix */}
            <section class="esono-card">
              <div class="esono-card__header">
                <h3 class="esono-card__title">
                  <i class="fas fa-layer-group esono-card__title-icon"></i>
                  Matrice d'Impact
                </h3>
              </div>
              <div class="esono-card__body">
                <p class="esono-text-sm esono-text-muted" style="margin-bottom: var(--spacing-md);">
                  Niveau de maturité de votre impact : de l'intention à la preuve.
                </p>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--spacing-md);">
                  <div class="esono-note esono-note--warning">
                    <strong style="display: block; margin-bottom: 4px;">
                      <i class="fas fa-circle"></i> Intentionnel
                    </strong>
                    {sicAnalysis.impactMatrix.intentionnel.length > 0 ? (
                      <ul style="margin: 0; padding-left: var(--spacing-md); font-size: 12px;">
                        {sicAnalysis.impactMatrix.intentionnel.map((item, idx) => (
                          <li key={`int-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    ) : <span class="esono-text-sm esono-text-muted">Aucun</span>}
                  </div>
                  <div class="esono-note esono-note--info">
                    <strong style="display: block; margin-bottom: 4px;">
                      <i class="fas fa-chart-line"></i> Mesuré
                    </strong>
                    {sicAnalysis.impactMatrix.mesure.length > 0 ? (
                      <ul style="margin: 0; padding-left: var(--spacing-md); font-size: 12px;">
                        {sicAnalysis.impactMatrix.mesure.map((item, idx) => (
                          <li key={`mes-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    ) : <span class="esono-text-sm esono-text-muted">Aucun</span>}
                  </div>
                  <div class="esono-note esono-note--success">
                    <strong style="display: block; margin-bottom: 4px;">
                      <i class="fas fa-check-circle"></i> Prouvé
                    </strong>
                    {sicAnalysis.impactMatrix.prouve.length > 0 ? (
                      <ul style="margin: 0; padding-left: var(--spacing-md); font-size: 12px;">
                        {sicAnalysis.impactMatrix.prouve.map((item, idx) => (
                          <li key={`prv-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    ) : <span class="esono-text-sm esono-text-muted">Aucun</span>}
                  </div>
                </div>
              </div>
            </section>

            {/* Impact Washing */}
            {sicAnalysis.impactWashingSignals.length > 0 && (
              <section class="esono-card">
                <div class="esono-card__header">
                  <h3 class="esono-card__title" style={`color: ${sicAnalysis.impactWashingRisk === 'eleve' ? 'var(--esono-danger)' : 'var(--esono-warning)'};`}>
                    <i class="fas fa-exclamation-triangle esono-card__title-icon"></i>
                    Signaux d'Impact Washing
                  </h3>
                  <span class="esono-badge" style={`background: ${sicAnalysis.impactWashingRisk === 'eleve' ? 'var(--esono-danger-light)' : 'var(--esono-warning-light)'}; color: ${sicAnalysis.impactWashingRisk === 'eleve' ? 'var(--esono-danger)' : 'var(--esono-warning)'};`}>
                    Risque: {sicAnalysis.impactWashingRisk}
                  </span>
                </div>
                <div class="esono-card__body">
                  <ul style="margin: 0; padding-left: var(--spacing-md);">
                    {sicAnalysis.impactWashingSignals.map((signal, idx) => (
                      <li key={`wash-${idx}`} class="esono-text-sm" style={`color: ${sicAnalysis!.impactWashingRisk === 'eleve' ? 'var(--esono-danger)' : 'var(--esono-warning)'}; margin-bottom: 4px;`}>
                        {signal}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* BMC Coherence */}
            {sicAnalysis.bmcCoherenceIssues.length > 0 && (
              <section class="esono-card">
                <div class="esono-card__header">
                  <h3 class="esono-card__title">
                    <i class="fas fa-link esono-card__title-icon"></i>
                    Cohérence BMC ↔ SIC
                  </h3>
                  <span class="esono-badge" style={`background: var(--esono-warning-light); color: var(--esono-warning);`}>
                    {sicAnalysis.scoreCoherenceBmc.toFixed(1)}/10
                  </span>
                </div>
                <div class="esono-card__body">
                  <ul style="margin: 0; padding-left: var(--spacing-md);">
                    {sicAnalysis.bmcCoherenceIssues.map((issue, idx) => (
                      <li key={`bmc-${idx}`} class="esono-text-sm" style="color: var(--esono-warning); margin-bottom: 4px;">
                        <i class="fas fa-exclamation-circle"></i> {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </>
        )}

        <section class="esono-grid esono-grid--2">
          <div class="esono-card">
            <div class="esono-card__body" style="display: flex; gap: var(--spacing-md); align-items: flex-start;">
              <span
                class="esono-btn esono-btn--icon"
                style={`background: ${overallTone.badgeBackground}; color: ${overallTone.badgeColor};`}
                aria-hidden="true"
              >
                <i class="fas fa-pen"></i>
              </span>
              <div style="display: flex; flex-direction: column; gap: var(--spacing-sm);">
                <h3 class="esono-page-title" style="font-size: 1rem;">Améliorer mes réponses</h3>
                <p class="esono-text-sm esono-text-muted">
                  Intégrez les recommandations IA bloc par bloc pour faire progresser votre score global.
                </p>
                <a href={`/module/${moduleCode}/improve`} class="esono-btn esono-btn--secondary esono-btn--sm">
                  Commencer les améliorations
                  <i class="fas fa-arrow-right"></i>
                </a>
              </div>
            </div>
          </div>

          <div class="esono-card">
            <div class="esono-card__body" style="display: flex; gap: var(--spacing-md); align-items: flex-start;">
              <span
                class="esono-btn esono-btn--icon"
                style="background: var(--esono-success-light); color: var(--esono-success);"
                aria-hidden="true"
              >
                <i class="fas fa-check-double"></i>
              </span>
              <div style="display: flex; flex-direction: column; gap: var(--spacing-sm);">
                <h3 class="esono-page-title" style="font-size: 1rem;">Passer à la validation</h3>
                <p class="esono-text-sm esono-text-muted">
                  Si vos réponses sont satisfaisantes, lancez la validation coach / IA pour accéder au livrable.
                </p>
                <a href={`/module/${moduleCode}/validate`} class="esono-btn esono-btn--primary esono-btn--sm">
                  Valider mon Canvas
                  <i class="fas fa-arrow-right"></i>
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    )

    return c.html(
      renderEsanoLayout({
        pageTitle: moduleTitle,
        pageDescription: 'Étape 4 — Analyse IA',
        breadcrumb: [
          { label: 'Tableau de bord', href: '/dashboard' },
          { label: moduleTitle, href: `/module/${moduleCode}` },
          { label: 'Analyse IA' }
        ],
        activeNav,
        navItems: resolvedNavItems,
        content: pageContent,
        headerActions: (
          <div class="esono-form__actions">
            <a href={`/module/${moduleCode}/questions`} class="esono-btn esono-btn--ghost">
              <i class="fas fa-circle-arrow-left"></i>
              Revoir les blocs
            </a>
            <a href={`/module/${moduleCode}/improve`} class="esono-btn esono-btn--primary">
              Passer aux améliorations
              <i class="fas fa-arrow-right"></i>
            </a>
          </div>
        )
      })
    )
  } catch (error) {
    console.error('Analysis error:', error)
    return c.redirect('/dashboard')
  }
})

// B5 - Réécriture / Itération
moduleRoutes.get('/module/:code/improve', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')

    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    const moduleTitle = (module.title as string) ?? 'Business Model Canvas'

    const progress = await c.env.DB.prepare(`
      SELECT * FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) {
      return c.redirect(`/module/${moduleCode}/questions`)
    }

    if (!progress.ai_feedback_json) {
      return c.redirect(`/module/${moduleCode}/analysis`)
    }

    let aiSummary: any = {}
    try {
      aiSummary = progress.ai_feedback_json ? JSON.parse(progress.ai_feedback_json as string) : {}
    } catch (err) {
      console.warn('Impossible de parser la synthèse IA du module', moduleCode, err)
      aiSummary = {}
    }

    const overallScore = aiSummary?.overallScore ?? 0
    const overallLabel = aiSummary?.overallLabel ?? 'Analyse IA à rafraîchir'
    const overallTone = getScoreToneStyles(overallLabel)

    const answers = await c.env.DB.prepare(`
      SELECT id, question_number, question_text, user_response, iteration_count, quality_score, ai_feedback, feedback_updated_at
      FROM questions
      WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress.id).all()

    const historyRows = await c.env.DB.prepare(`
      SELECT q.question_number, h.previous_response, h.created_at
      FROM question_history h
      INNER JOIN questions q ON q.id = h.question_id
      WHERE q.progress_id = ?
      ORDER BY h.created_at DESC
    `).bind(progress.id).all()

    const historyMap = new Map<number, Array<{ response: string; createdAt: string }>>()
    let latestHistoryTimestamp: number | null = null

    historyRows.results.forEach((row: any) => {
      if (!historyMap.has(row.question_number)) {
        historyMap.set(row.question_number, [])
      }
      historyMap.get(row.question_number)!.push({ response: row.previous_response, createdAt: row.created_at })
      if (row.created_at) {
        const tsDate = parseDateValue(row.created_at)
        if (tsDate) {
          const ts = tsDate.getTime()
          if (!latestHistoryTimestamp || ts > latestHistoryTimestamp) {
            latestHistoryTimestamp = ts
          }
        }
      }
    })

    const answersMap = new Map<number, {
      response: string
      iterations: number
      qualityScore: number | null
      feedback: {
        sectionName: string
        questionText?: string
        strengths: Array<{ message: string; score?: number }>
        suggestions: Array<{ message: string; score?: number }>
        questions: Array<{ message: string; score?: number }>
        percentage: number | null
        scoreLabel: string
      }
      feedbackUpdatedAt?: string | null
    }>()

    const normalizeFeedbackEntries = (entries: unknown) => {
      if (!Array.isArray(entries)) return []
      return (entries as any[])
        .map((entry) => {
          if (!entry) return null
          if (typeof entry === 'string') {
            const message = entry.trim()
            return message.length > 0 ? { message, score: undefined as number | undefined } : null
          }
          const rawMessage = typeof entry.message === 'string' ? entry.message : String(entry)
          const message = rawMessage.trim()
          if (message.length === 0) return null
          const score = typeof entry.score === 'number' ? entry.score : undefined
          return { message, score }
        })
        .filter((entry): entry is { message: string; score?: number } => !!entry)
    }

    const content = getModuleContent(moduleCode)
    if (!content) return c.redirect(`/module/${moduleCode}`)

    const sectionDetailsMap = new Map<number, { section: string; question: string }>()
    content.guided_questions?.forEach((q) => {
      sectionDetailsMap.set(q.id, { section: q.section, question: q.question })
    })

    answers.results.forEach((row: any) => {
      const details = sectionDetailsMap.get(row.question_number)
      let parsedFeedback: {
        sectionName: string
        questionText?: string
        strengths: Array<{ message: string; score?: number }>
        suggestions: Array<{ message: string; score?: number }>
        questions: Array<{ message: string; score?: number }>
        percentage: number | null
        scoreLabel: string
      }

      try {
        const feedbackPayload = row.ai_feedback ? JSON.parse(row.ai_feedback) : null
        const strengths = normalizeFeedbackEntries(feedbackPayload?.strengths)
        const suggestions = normalizeFeedbackEntries(feedbackPayload?.suggestions)
        const questionsList = normalizeFeedbackEntries(feedbackPayload?.questions)

        parsedFeedback = {
          sectionName: feedbackPayload?.sectionName || (details?.section ?? getSectionName(row.question_number)),
          questionText: feedbackPayload?.questionText || details?.question,
          strengths,
          suggestions,
          questions: questionsList,
          percentage: typeof feedbackPayload?.percentage === 'number' ? feedbackPayload.percentage : null,
          scoreLabel: feedbackPayload?.scoreLabel || 'Analyse à compléter'
        }
      } catch (err) {
        console.warn('Unable to parse AI feedback for question', row.question_number, err)
        parsedFeedback = {
          sectionName: details?.section ?? getSectionName(row.question_number),
          questionText: details?.question,
          strengths: [],
          suggestions: [],
          questions: [],
          percentage: null,
          scoreLabel: 'Analyse à compléter'
        }
      }

      answersMap.set(row.question_number, {
        response: row.user_response ?? '',
        iterations: row.iteration_count ?? 0,
        qualityScore: row.quality_score ?? null,
        feedback: parsedFeedback,
        feedbackUpdatedAt: row.feedback_updated_at ?? null
      })
    })

    const cards = content.guided_questions!.map((question, index) => {
      const data = answersMap.get(question.id)
      const feedback = data?.feedback ?? {
        sectionName: question.section,
        questionText: question.question,
        strengths: [],
        suggestions: [],
        questions: [],
        percentage: null,
        scoreLabel: 'Analyse à compléter'
      }

      const history = historyMap.get(question.id) ?? []

      return {
        order: index + 1,
        questionId: question.id,
        section: question.section,
        questionText: question.question,
        currentAnswer: data?.response ?? '',
        iterations: data?.iterations ?? 0,
        qualityScore: data?.qualityScore ?? null,
        feedback,
        history,
        needsWork: (feedback.suggestions?.length ?? 0) > 0 || (feedback.questions?.length ?? 0) > 0,
        feedbackUpdatedAt: data?.feedbackUpdatedAt
      }
    })

    const totalIterations = cards.reduce((sum, card) => sum + card.iterations, 0)
    const completedBlocks = cards.filter((card) => (card.qualityScore ?? 0) >= 60).length
    const blocksNeedingWork = cards.filter((card) => card.needsWork).length

    const summaryTopSuggestions = Array.isArray(aiSummary?.topSuggestions) && aiSummary.topSuggestions.length
      ? aiSummary.topSuggestions
      : cards.flatMap((card) =>
          (card.feedback.suggestions || []).map((item) => ({
            section: card.feedback.sectionName,
            questionId: card.questionId,
            message: item.message,
            score: item.score ?? 3
          }))
        ).sort((a, b) => (a.score ?? 5) - (b.score ?? 5)).slice(0, 3)

    const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'iteration')

    const lastAnalysisDate = parseDateValue(progress.ai_last_analysis as string | null)
    const needsRefresh = !!(lastAnalysisDate && latestHistoryTimestamp && latestHistoryTimestamp > lastAnalysisDate.getTime())

    const heroSection = (
      <section class="esono-hero">
        <div class="esono-hero__header">
          <div>
            <h2 class="esono-hero__title">Amélioration du Business Model Canvas</h2>
            <p class="esono-hero__subtitle">
              Étape 5/7 — renforcez vos réponses avant la validation coach.
            </p>
          </div>
          <div class="esono-stack esono-stack--sm" style="align-items: flex-end;">
            <span class="esono-hero__badge">
              <i class="fas fa-robot"></i>
              Analyse du {formatDateValue(progress.ai_last_analysis as string | null, 'à lancer')}
            </span>
            <span class="esono-text-sm esono-text-muted">
              {totalIterations} itération{totalIterations > 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div class="esono-hero__metrics">
          <div
            class="esono-hero__metric"
            style={`background: ${overallTone.backgroundColor}; border: 1px solid ${overallTone.borderColor};`}
          >
            <div class="esono-hero__metric-value">{overallScore}%</div>
            <div class="esono-hero__metric-label">Score global</div>
            <span
              class="esono-badge"
              style={`background: ${overallTone.badgeBackground}; color: ${overallTone.badgeColor};`}
            >
              {overallLabel}
            </span>
          </div>
          <div class="esono-hero__metric esono-hero__metric--success">
            <div class="esono-hero__metric-value">{completedBlocks}</div>
            <div class="esono-hero__metric-label">Blocs solides</div>
          </div>
          <div class="esono-hero__metric esono-hero__metric--warning">
            <div class="esono-hero__metric-value">{blocksNeedingWork}</div>
            <div class="esono-hero__metric-label">Blocs à renforcer</div>
          </div>
          <div class="esono-hero__metric esono-hero__metric--info">
            <div class="esono-hero__metric-value">{cards.length}</div>
            <div class="esono-hero__metric-label">Blocs analysés</div>
          </div>
        </div>
      </section>
    )

    const improvementCards = cards.map((card) => {
      const tone = getScoreToneStyles(card.feedback.scoreLabel)
      const statusBadge = card.needsWork
        ? { className: 'esono-badge esono-badge--warning', icon: 'fas fa-exclamation-circle', label: 'Travail recommandé' }
        : { className: 'esono-badge esono-badge--success', icon: 'fas fa-check-circle', label: 'Bloc satisfaisant' }

      return (
        <article class="esono-card" id={`card_${card.questionId}`} key={`improve-card-${card.questionId}`}>
          <div
            class="esono-card__header"
            style={`background: ${tone.backgroundColor}; border-bottom: 1px solid ${tone.borderColor};`}
          >
            <div class="esono-stack esono-stack--sm">
              <span class="esono-badge esono-badge--accent">
                Bloc {card.order}
              </span>
              <h3 class="esono-card__title">
                <i class="fas fa-layer-group esono-card__title-icon" style={`color: ${tone.badgeColor};`}></i>
                {card.section}
              </h3>
              <p class="esono-text-sm esono-text-muted">{card.questionText}</p>
            </div>
            <div class="esono-stack esono-stack--sm" style="align-items: flex-end;">
              <span
                class="esono-badge"
                style={`background: ${tone.badgeBackground}; color: ${tone.badgeColor};`}
              >
                <i class="fas fa-gauge"></i>
                {card.feedback.scoreLabel}
                {typeof card.feedback.percentage === 'number' ? ` · ${card.feedback.percentage}%` : ''}
              </span>
              {card.iterations > 0 && (
                <span class="esono-badge esono-badge--info">
                  <i class="fas fa-history"></i>
                  V{card.iterations + 1}
                </span>
              )}
              <span class={statusBadge.className}>
                <i class={statusBadge.icon}></i>
                {statusBadge.label}
              </span>
            </div>
          </div>
          <div class="esono-card__body">
            <div class="esono-card__split">
              <div class="esono-card__split-main">
                <div class="esono-stack esono-stack--md">
                  <div>
                    <p class="esono-text-sm esono-font-semibold esono-text-muted">Réponse actuelle</p>
                    <div class="esono-note">
                      {card.currentAnswer || 'Pas encore de réponse sauvegardée.'}
                    </div>
                  </div>
                  <div>
                    <p class="esono-text-sm esono-font-semibold">Version améliorée</p>
                    <textarea
                      id={`improved_${card.questionId}`}
                      name={`improved_${card.questionId}`}
                      class="esono-textarea"
                      rows={8}
                      placeholder="Écrivez votre version améliorée en intégrant les retours IA..."
                    >{card.currentAnswer}</textarea>
                  </div>
                  <div class="esono-form__meta">
                    <span>
                      Dernière analyse : {card.feedbackUpdatedAt ? formatDateValue(card.feedbackUpdatedAt) : 'à générer'}
                    </span>
                    <span id={`status_${card.questionId}`} class="esono-text-sm esono-text-muted"></span>
                  </div>
                  <div class="esono-form__actions" style="justify-content: flex-start;">
                    <button
                      type="button"
                      class="esono-btn esono-btn--primary"
                      onclick={`saveImprovement(${card.questionId})`}
                    >
                      <i class="fas fa-floppy-disk"></i>
                      Sauvegarder cette amélioration
                    </button>
                  </div>
                </div>
              </div>
              <aside class="esono-card__split-aside">
                {card.feedback.strengths.length > 0 && (
                  <div class="esono-note esono-note--success">
                    <strong>Forces détectées</strong>
                    <ul style="margin: var(--spacing-sm) 0 0 var(--spacing-md); padding: 0; list-style: disc;">
                      {card.feedback.strengths.map((item, idx) => (
                        <li key={`strength-${card.questionId}-${idx}`} class="esono-text-sm">
                          {item.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {card.feedback.suggestions.length > 0 && (
                  <div class="esono-note esono-note--warning">
                    <strong>Axes d'amélioration</strong>
                    <ul style="margin: var(--spacing-sm) 0 0 var(--spacing-md); padding: 0; list-style: disc;">
                      {card.feedback.suggestions.map((item, idx) => (
                        <li key={`suggestion-${card.questionId}-${idx}`} class="esono-text-sm" style="display: flex; gap: var(--spacing-sm); align-items: center;">
                          <span style="flex: 1;">{item.message}</span>
                          <button
                            type="button"
                            class="esono-btn esono-btn--ghost esono-btn--sm"
                            onclick={`useSuggestion(${card.questionId}, ${JSON.stringify(item.message)})`}
                          >
                            <i class="fas fa-plus-circle"></i>
                            Insérer
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {card.feedback.questions.length > 0 && (
                  <div class="esono-note esono-note--info">
                    <strong>Points à clarifier</strong>
                    <ul style="margin: var(--spacing-sm) 0 0 var(--spacing-md); padding: 0; list-style: disc;">
                      {card.feedback.questions.map((item, idx) => (
                        <li key={`question-${card.questionId}-${idx}`} class="esono-text-sm">
                          {item.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div class="esono-note">
                  <strong>Historique</strong>
                  {card.history.length > 0 ? (
                    <ul style="margin: var(--spacing-sm) 0 0; padding-left: var(--spacing-md); list-style: disc; max-height: 220px; overflow: auto;">
                      {card.history.map((entry, idx) => (
                        <li key={`history-${card.questionId}-${idx}`} class="esono-text-sm">
                          <span class="esono-font-semibold">{formatDateValue(entry.createdAt)}</span>
                          <br />
                          <span>{entry.response}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p class="esono-text-sm esono-text-muted">Aucune version précédente enregistrée.</p>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </article>
      )
    })

    const pageContent = (
      <div class="esono-stack esono-stack--xl">
        {heroSection}
        {needsRefresh && (
          <div class="esono-banner esono-banner--warning">
            <div class="esono-banner__icon">
              <i class="fas fa-rotate"></i>
            </div>
            <div class="esono-banner__content">
              <h3>Mise à jour recommandée</h3>
              <p>Vous avez modifié certaines réponses après la dernière analyse IA. Relancez l’étape B4 afin de recalculer les scores.</p>
            </div>
            <div class="esono-banner__actions">
              <a href={`/module/${moduleCode}/analysis`} class="esono-btn esono-btn--ghost">
                <i class="fas fa-robot"></i>
                Relancer l’analyse
              </a>
            </div>
          </div>
        )}
        <section class="esono-split esono-split--3-2">
          <div class="esono-card-list">
            {cards.length > 0 ? improvementCards : (
              <div class="esono-card">
                <div class="esono-card__body">
                  <p class="esono-text-sm esono-text-muted">
                    Aucune question guidée n’a encore été générée. Complétez d’abord l’analyse IA.
                  </p>
                </div>
              </div>
            )}
          </div>
          <aside class="esono-stack esono-stack--lg">
            <div class="esono-card">
              <div class="esono-card__header">
                <h3 class="esono-card__title">
                  <i class="fas fa-list-check esono-card__title-icon"></i>
                  Priorités d’amélioration
                </h3>
              </div>
              <div class="esono-card__body">
                {summaryTopSuggestions.length > 0 ? (
                  <ol class="esono-stack esono-stack--sm" style="list-style: decimal; margin: 0; padding-left: var(--spacing-lg);">
                    {summaryTopSuggestions.map((item, idx) => (
                      <li key={`top-suggestion-${idx}`} class="esono-text-sm">
                        <strong>{item.section}</strong>
                        <br />
                        <span>{item.message}</span>
                        <div style="margin-top: var(--spacing-xs);">
                          <button
                            type="button"
                            class="esono-btn esono-btn--ghost esono-btn--sm"
                            onclick={`scrollToCard(${item.questionId})`}
                          >
                            <i class="fas fa-location-arrow"></i>
                            Aller au bloc
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p class="esono-text-sm esono-text-muted">
                    Aucune priorité critique détectée. Vous pouvez passer à la validation.
                  </p>
                )}
              </div>
            </div>

            <div class="esono-card esono-card--ai">
              <div class="esono-card__header esono-card__header--ai">
                <h3 class="esono-card__title">
                  <i class="fas fa-sparkles esono-card__title-icon"></i>
                  Conseils IA pour itérer
                </h3>
              </div>
              <div class="esono-card__body">
                <ul class="esono-stack esono-stack--sm" style="list-style: disc; margin: 0; padding-left: var(--spacing-lg);">
                  <li class="esono-text-sm">Rédigez des phrases courtes et structurées pour clarifier vos messages clés.</li>
                  <li class="esono-text-sm">Ajoutez au moins un indicateur chiffré par bloc (revenus, volumes, coûts).</li>
                  <li class="esono-text-sm">Documentez les preuves terrain ou retours clients qui valident vos hypothèses.</li>
                  <li class="esono-text-sm">Vérifiez la cohérence entre segments clients, proposition de valeur, canaux et revenus.</li>
                </ul>
              </div>
            </div>

            <div class="esono-card">
              <div class="esono-card__header">
                <h3 class="esono-card__title">
                  <i class="fas fa-flag-checkered esono-card__title-icon"></i>
                  Étapes suivantes
                </h3>
              </div>
              <div class="esono-card__body">
                <ul class="esono-stack esono-stack--md" style="list-style: none; margin: 0; padding: 0;">
                  <li class="esono-text-sm">
                    <strong>Sauvegardez chaque bloc amélioré</strong>
                    <br />
                    <span class="esono-text-muted">Les coachs voient vos itérations dans l’historique détaillé.</span>
                  </li>
                  <li class="esono-text-sm">
                    <strong>Relancez l’analyse IA</strong>
                    <br />
                    <span class="esono-text-muted">Comparez l’évolution de votre score global après vos améliorations.</span>
                  </li>
                  <li class="esono-text-sm">
                    <strong>Préparez la validation coach</strong>
                    <br />
                    <span class="esono-text-muted">Assurez-vous que chaque bloc est argumenté, chiffré et cohérent.</span>
                  </li>
                </ul>
                <div class="esono-form__actions" style="justify-content: flex-start; margin-top: var(--spacing-md);">
                  <a href={`/module/${moduleCode}/validate`} class="esono-btn esono-btn--primary">
                    Passer à la validation
                    <i class="fas fa-arrow-right"></i>
                  </a>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    )

    const extraScripts = `
(function() {
  const MODULE_CODE = ${JSON.stringify(moduleCode)};

  function scrollToCard(questionId) {
    const container = document.getElementById('card_' + questionId);
    if (container) {
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      container.classList.add('esono-focus-glow');
      setTimeout(() => container.classList.remove('esono-focus-glow'), 1600);
    }
    const textarea = document.getElementById('improved_' + questionId);
    if (textarea) {
      textarea.focus();
    }
  }

  async function saveImprovement(questionId) {
    const textarea = document.getElementById('improved_' + questionId);
    const status = document.getElementById('status_' + questionId);
    const container = document.getElementById('card_' + questionId);
    if (!textarea || !status) {
      return;
    }

    const answer = textarea.value.trim();
    textarea.classList.remove('is-success', 'is-error');

    if (!answer) {
      status.textContent = 'Veuillez écrire une amélioration';
      status.className = 'esono-text-sm esono-text-danger';
      textarea.classList.add('is-error');
      return;
    }

    status.textContent = 'Sauvegarde en cours...';
    status.className = 'esono-text-sm esono-text-info';

    try {
      const response = await fetch('/api/module/improve-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_code: MODULE_CODE,
          question_number: questionId,
          improved_answer: answer
        })
      });

      if (!response.ok) {
        throw new Error('Erreur de sauvegarde');
      }

      status.textContent = '✓ Sauvegardé';
      status.className = 'esono-text-sm esono-text-success';
      textarea.classList.add('is-success');
      if (container) {
        container.classList.add('esono-focus-glow');
        setTimeout(() => container.classList.remove('esono-focus-glow'), 1500);
      }
      setTimeout(() => {
        status.textContent = '';
        textarea.classList.remove('is-success');
      }, 2000);
    } catch (error) {
      console.error('Save error:', error);
      status.textContent = '✗ Erreur de sauvegarde';
      status.className = 'esono-text-sm esono-text-danger';
      textarea.classList.add('is-error');
    }
  }

  function useSuggestion(questionId, suggestion) {
    const textarea = document.getElementById('improved_' + questionId);
    if (!textarea) {
      return;
    }
    const currentValue = textarea.value.trim();
    const bullet = suggestion.startsWith('-') || suggestion.startsWith('•') ? suggestion : '• ' + suggestion;
    textarea.value = currentValue ? currentValue + '\\n' + bullet : bullet;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
  }

  window.scrollToCard = scrollToCard;
  window.saveImprovement = saveImprovement;
  window.useSuggestion = useSuggestion;
})();
    `.replace(/</g, '\\u003c')

    return c.html(
      renderEsanoLayout({
        pageTitle: moduleTitle,
        pageDescription: 'Étape 5 — Amélioration continue',
        breadcrumb: [
          { label: 'Tableau de bord', href: '/dashboard' },
          { label: moduleTitle, href: `/module/${moduleCode}` },
          { label: 'Amélioration' }
        ],
        activeNav,
        navItems: resolvedNavItems,
        content: pageContent,
        headerActions: (
          <div class="esono-form__actions">
            <a href={`/module/${moduleCode}/analysis`} class="esono-btn esono-btn--ghost">
              <i class="fas fa-circle-arrow-left"></i>
              Retour à l’analyse
            </a>
            <a href={`/module/${moduleCode}/validate`} class="esono-btn esono-btn--primary">
              Passer à la validation
              <i class="fas fa-arrow-right"></i>
            </a>
          </div>
        ),
        extraScripts
      })
    )

  } catch (error) {
    console.error('Improve error:', error)
    return c.redirect('/dashboard')
  }
})

// B6 - Validation Coach/IA
moduleRoutes.get('/module/:code/validate', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    const moduleTitle = (module.title as string) ?? 'Module'
    const content = getModuleContent(moduleCode)
    if (!content) return c.redirect(`/module/${moduleCode}`)

    const progress = await c.env.DB.prepare(`
      SELECT *
      FROM progress
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) {
      return c.redirect(`/module/${moduleCode}/questions`)
    }

    const questions = await c.env.DB.prepare(`
      SELECT id, question_number, question_text, user_response, iteration_count, quality_score, ai_feedback, feedback_updated_at, updated_at
      FROM questions
      WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress.id).all()

    const guidedQuestions = content.guided_questions ?? []
    const questionRows = Array.isArray(questions.results) ? questions.results as any[] : []

    let latestAnswerTimestamp: number | null = null

    const cards = guidedQuestions.map((question, index) => {
      const row = questionRows.find((r) => r.question_number === question.id)
      const rawAnswer = (row?.user_response as string | null) ?? ''
      const currentAnswer = rawAnswer.trim()
      const iterations = Number(row?.iteration_count ?? 0)
      const qualityScore = typeof row?.quality_score === 'number' ? Number(row.quality_score) : null
      const updatedAt = row?.updated_at as string | null

      if (updatedAt) {
        const ts = parseDateValue(updatedAt)?.getTime()
        if (ts && (!latestAnswerTimestamp || ts > latestAnswerTimestamp)) {
          latestAnswerTimestamp = ts
        }
      }

      let suggestionsCount = 0
      let questionsCount = 0
      let percentage: number | null = null
      let scoreLabel = qualityScore !== null ? getScoreLabel(qualityScore).label : 'Analyse IA à générer'

      try {
        const payload = row?.ai_feedback ? JSON.parse(row.ai_feedback as string) : null
        if (payload) {
          suggestionsCount = Array.isArray(payload.suggestions) ? payload.suggestions.length : 0
          questionsCount = Array.isArray(payload.questions) ? payload.questions.length : 0
          percentage = typeof payload.percentage === 'number' ? payload.percentage : null
          scoreLabel = payload.scoreLabel ?? scoreLabel
        }
      } catch (err) {
        console.warn('Impossible de parser le feedback IA pour la question', question.id, err)
      }

      return {
        order: index + 1,
        questionId: question.id,
        section: question.section,
        questionText: question.question,
        currentAnswer,
        iterations,
        qualityScore,
        percentage,
        scoreLabel,
        suggestionsCount,
        questionsCount,
        hasAnswer: currentAnswer.length > 0
      }
    })

    const totalQuestions = guidedQuestions.length
    const answeredBlocks = cards.filter((card) => card.hasAnswer).length
    const missingBlocks = cards.filter((card) => !card.hasAnswer)
    const clarificationBlocks = cards.filter((card) => card.questionsCount > 0)
    const qualityMissing = cards.filter((card) => card.qualityScore === null).length

    const score = typeof progress.ai_score === 'number' ? Number(progress.ai_score) : 0
    const scoreInfo = getScoreLabel(score)
    const scoreTone = getScoreToneStyles(scoreInfo.label)
    const scorePalette = getAnalysisPalette(scoreInfo.color)

    const lastAnalysisDate = parseDateValue(progress.ai_last_analysis as string | null)
    const latestActivity = latestAnswerTimestamp ?? 0
    const needsRefresh = !!(lastAnalysisDate && latestActivity && latestActivity > lastAnalysisDate.getTime())

    const quizPassed = Number(progress.quiz_passed ?? 0) === 1
    const quizScore = typeof progress.quiz_score === 'number' ? Number(progress.quiz_score) : null

    const blockingReasons: string[] = []

    if (!quizPassed) {
      blockingReasons.push('Le quiz de validation (B2) doit être réussi avec un score d’au moins 80 %.')
    }

    if (!lastAnalysisDate) {
      blockingReasons.push('L’analyse IA (B4) doit être lancée avant la validation.')
    }

    if (qualityMissing > 0) {
      blockingReasons.push('Relancez l’analyse IA après vos améliorations pour obtenir un score sur chaque bloc.')
    }

    if (needsRefresh) {
      blockingReasons.push('Certaines réponses ont été modifiées après la dernière analyse IA. Relancez l’étape B4 pour actualiser le score.')
    }

    if (missingBlocks.length > 0) {
      blockingReasons.push(`${missingBlocks.length} bloc${missingBlocks.length > 1 ? 's' : ''} du Canvas n’est pas encore complété.`)
    }

    if (clarificationBlocks.length > 0) {
      blockingReasons.push(`L’IA attend encore des précisions sur ${clarificationBlocks.length} bloc${clarificationBlocks.length > 1 ? 's' : ''}.`)
    }

    if (score < MIN_VALIDATION_SCORE) {
      blockingReasons.push(`Le score IA doit atteindre au moins ${MIN_VALIDATION_SCORE} % (score actuel : ${score} %).`)
    }

    const readyForValidation = blockingReasons.length === 0

    const status = progress.status as string | null
    const isValidated = status === 'validated'
    const validatedAt = progress.validated_at ? formatDateValue(progress.validated_at as string | null) : null
    const deliverableUrl = `/module/${moduleCode}/download`

    const requirements = [
      {
        key: 'quiz',
        label: 'Quiz B2 réussi',
        satisfied: quizPassed,
        detail: quizPassed ? `Score obtenu : ${quizScore}%` : 'Un score d’au moins 80 % est requis.'
      },
      {
        key: 'answers',
        label: `${totalQuestions} blocs complétés`,
        satisfied: missingBlocks.length === 0 && totalQuestions > 0,
        detail: missingBlocks.length === 0
          ? 'Toutes les réponses sont renseignées.'
          : `${missingBlocks.length} bloc${missingBlocks.length > 1 ? 's' : ''} restent à compléter.`
      },
      {
        key: 'analysis',
        label: 'Analyse IA à jour',
        satisfied: !!lastAnalysisDate && !needsRefresh && qualityMissing === 0,
        detail: !lastAnalysisDate
          ? 'Lancez l’analyse IA (B4) pour obtenir le score global.'
          : needsRefresh
            ? 'Relancez l’analyse après vos dernières modifications.'
            : 'Dernière analyse réalisée le ' + formatDateValue(progress.ai_last_analysis as string | null)
      },
      {
        key: 'score',
        label: `Score IA ≥ ${MIN_VALIDATION_SCORE} %`,
        satisfied: score >= MIN_VALIDATION_SCORE,
        detail: `Score actuel : ${score}% (${scoreInfo.label}).`
      }
    ]

    const validationContext = {
      moduleCode,
      readyForValidation,
      blockingReasons,
      deliverableUrl
    }

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Validation - {module.title}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          <link href="/static/style.css" rel="stylesheet" />
        </head>
        <body class="bg-gray-50">
          <nav class="bg-white shadow-sm border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
              <a href="/dashboard" class="text-blue-600 hover:text-blue-700 flex items-center gap-2">
                <i class="fas fa-arrow-left"></i>
                <span>Retour au dashboard</span>
              </a>
              <span class="text-sm text-gray-500 flex items-center gap-2">
                <i class="fas fa-badge-check"></i>
                Étape 6/7 - Validation
              </span>
            </div>
          </nav>

          <div class="max-w-6xl mx-auto px-4 py-8 space-y-8">
            <div class={`rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${isValidated ? 'ring-2 ring-green-200' : ''}`}>
              <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div>
                  <h1 class="text-2xl font-bold text-gray-900">Validation du Business Model Canvas</h1>
                  <p class="text-gray-600 mt-2">
                    {isValidated
                      ? 'Votre livrable est validé et prêt à être partagé.'
                      : 'Vérifiez les critères ci-dessous avant de soumettre le module à la validation coach/IA.'}
                  </p>
                  <div class="text-sm text-gray-500 mt-3 flex flex-wrap items-center gap-3">
                    <span class="inline-flex items-center gap-2">
                      <i class="fas fa-robot"></i>
                      Analyse IA : {formatDateValue(progress.ai_last_analysis as string | null, 'à lancer')}
                    </span>
                    <span class="inline-flex items-center gap-2">
                      <i class="fas fa-book"></i>
                      Quiz : {quizPassed ? `${quizScore}%` : 'non validé'}
                    </span>
                    <span class="inline-flex items-center gap-2">
                      <i class="fas fa-rotate"></i>
                      Itérations totales : {cards.reduce((sum, card) => sum + card.iterations, 0)}
                    </span>
                  </div>
                </div>
                <div class={`rounded-2xl px-6 py-4 text-center text-white ${scorePalette.gradient}`}>
                  <p class="text-xs uppercase tracking-wide text-white/80">Score IA</p>
                  <p class="text-4xl font-extrabold">{score}%</p>
                  <p class="text-sm font-medium text-white/90 mt-1">{scoreInfo.label}</p>
                </div>
              </div>
            </div>

            {isValidated ? (
              <div class="space-y-6">
                <div class="rounded-2xl border border-green-200 bg-green-50 p-6">
                  <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <h2 class="text-xl font-semibold text-green-900">🎉 Module validé</h2>
                      <p class="text-green-800 text-sm mt-2">Validé le {validatedAt ?? 'aujourd’hui'}. Vous pouvez télécharger le livrable ou continuer à itérer.</p>
                    </div>
                    <div class="flex flex-wrap gap-3">
                      <a href={deliverableUrl} class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium">
                        <i class="fas fa-download"></i>
                        Télécharger le PDF
                      </a>
                      <a href={`/module/${moduleCode}/improve`} class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-green-300 bg-white text-green-700 hover:bg-green-100 font-medium">
                        <i class="fas fa-pen"></i>
                        Améliorer à nouveau
                      </a>
                    </div>
                  </div>
                </div>

                <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h3 class="text-lg font-semibold text-gray-900 mb-4">Résumé des blocs</h3>
                  <div class="grid gap-4 md:grid-cols-2">
                    {cards.map((card) => (
                      <div class="border border-gray-100 rounded-xl p-4" key={`validated-card-${card.questionId}`}>
                        <div class="flex items-start justify-between gap-4 mb-3">
                          <div>
                            <p class="text-xs uppercase tracking-wide text-gray-500">Bloc #{card.order}</p>
                            <p class="text-sm font-semibold text-gray-900">{card.section}</p>
                          </div>
                          <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                            <i class="fas fa-check-circle"></i>
                            Validé
                          </span>
                        </div>
                        <p class="text-sm text-gray-600 whitespace-pre-line line-clamp-4">
                          {card.currentAnswer || '—'}
                        </p>
                        <div class="mt-3 text-xs text-gray-500 flex flex-wrap gap-2">
                          <span>Itérations : {card.iterations}</span>
                          {card.percentage !== null && <span>Score bloc : {card.percentage}%</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div class="space-y-6">
                <div class="grid gap-4 md:grid-cols-2">
                  {requirements.map((req) => (
                    <div
                      key={req.key}
                      class={`rounded-2xl border p-4 shadow-sm ${req.satisfied ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
                    >
                      <div class="flex items-center justify-between">
                        <h3 class="text-sm font-semibold text-gray-900">{req.label}</h3>
                        <span class={`inline-flex items-center justify-center w-8 h-8 rounded-full text-white ${req.satisfied ? 'bg-green-500' : 'bg-red-500'}`}>
                          <i class={req.satisfied ? 'fas fa-check' : 'fas fa-exclamation'}></i>
                        </span>
                      </div>
                      <p class="text-sm text-gray-600 mt-3">
                        {req.detail}
                      </p>
                    </div>
                  ))}
                </div>

                {blockingReasons.length > 0 && (
                  <div id="blocking-alert" class="rounded-2xl border border-red-200 bg-red-50 p-6 space-y-3">
                    <h3 class="text-lg font-semibold text-red-900 flex items-center gap-2">
                      <i class="fas fa-triangle-exclamation"></i>
                      Points à corriger avant validation
                    </h3>
                    <ul class="list-disc list-inside text-sm text-red-800 space-y-2">
                      {blockingReasons.map((reason, idx) => (
                        <li key={`blocker-${idx}`}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div class="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 class="text-lg font-semibold text-gray-900">Vue d’ensemble des blocs</h3>
                      <p class="text-sm text-gray-600">Assurez-vous que chaque bloc est complet et crédible avant de soumettre le module.</p>
                    </div>
                    <a href={`/module/${moduleCode}/improve`} class="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium">
                      <i class="fas fa-pen"></i>
                      Retour aux améliorations
                    </a>
                  </div>

                  <div class="grid gap-4 md:grid-cols-2">
                    {cards.map((card) => {
                      const status = !card.hasAnswer
                        ? { label: 'Bloc incomplet', className: 'bg-red-100 text-red-700', icon: 'fas fa-circle-xmark' }
                        : card.questionsCount > 0
                          ? { label: 'Précisions requises', className: 'bg-red-100 text-red-700', icon: 'fas fa-circle-question' }
                          : card.suggestionsCount > 0
                            ? { label: 'Peut être renforcé', className: 'bg-yellow-100 text-yellow-700', icon: 'fas fa-lightbulb' }
                            : { label: 'Bloc prêt', className: 'bg-green-100 text-green-700', icon: 'fas fa-circle-check' }

                      return (
                        <div class="border border-gray-100 rounded-xl p-4" key={`pending-card-${card.questionId}`}>
                          <div class="flex items-start justify-between gap-4 mb-3">
                            <div>
                              <p class="text-xs uppercase tracking-wide text-gray-500">Bloc #{card.order}</p>
                              <p class="text-sm font-semibold text-gray-900">{card.section}</p>
                            </div>
                            <span class={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${status.className}`}>
                              <i class={status.icon}></i>
                              {status.label}
                            </span>
                          </div>
                          <p class="text-sm text-gray-600 whitespace-pre-line line-clamp-4">
                            {card.currentAnswer || 'Aucune réponse enregistrée.'}
                          </p>
                          <div class="mt-3 text-xs text-gray-500 flex flex-wrap gap-2">
                            <span>Itérations : {card.iterations}</span>
                            {card.percentage !== null && <span>Score bloc : {card.percentage}%</span>}
                            {card.suggestionsCount > 0 && <span>{card.suggestionsCount} suggestion{card.suggestionsCount > 1 ? 's' : ''}</span>}
                            {card.questionsCount > 0 && <span>{card.questionsCount} clarification{card.questionsCount > 1 ? 's' : ''}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div id="validationStatus"></div>

                <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                  <div>
                    <h3 class="text-lg font-semibold text-gray-900">Soumettre à la validation Coach / IA</h3>
                    <p class="text-sm text-gray-600">Ajoutez un message facultatif pour le coach puis lancez la validation. Toute modification ultérieure renverra le module en amélioration.</p>
                  </div>
                  <div>
                    <label for="validationNote" class="text-sm font-medium text-gray-700">Note (optionnelle)</label>
                    <textarea
                      id="validationNote"
                      rows={4}
                      class="mt-2 w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                      placeholder="Partagez une précision ou un point d’attention pour le coach..."
                    ></textarea>
                  </div>
                  <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <button
                      type="button"
                      id="submitValidationButton"
                      data-ready={readyForValidation ? 'true' : 'false'}
                      onclick="submitForValidation(event)"
                      class={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-white font-semibold transition ${
                        readyForValidation ? 'bg-green-600 hover:bg-green-700 shadow' : 'bg-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <i class="fas fa-check-circle"></i>
                      Soumettre pour validation
                    </button>
                    <p class="text-sm text-gray-500">
                      Après validation, le livrable PDF sera généré automatiquement (étape B7).
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <script dangerouslySetInnerHTML={{__html: `
            (function() {
              window.VALIDATION_CONTEXT = ${JSON.stringify(validationContext).replace(/</g, '\\u003c')};
              const deliverableUrl = '${deliverableUrl}';

              function submitForValidation(event) {
                event.preventDefault();
                const ctx = window.VALIDATION_CONTEXT || {};
                const button = event.currentTarget;

                if (ctx.readyForValidation !== true) {
                  const alertBox = document.getElementById('blocking-alert');
                  if (alertBox) {
                    alertBox.classList.add('ring-2', 'ring-red-300');
                    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => alertBox.classList.remove('ring-2', 'ring-red-300'), 800);
                  }
                  button.classList.add('ring-2', 'ring-red-300', 'ring-offset-2');
                  setTimeout(() => button.classList.remove('ring-2', 'ring-red-300', 'ring-offset-2'), 700);
                  return;
                }

                if (button.dataset.loading === 'true') {
                  return;
                }

                button.dataset.loading = 'true';
                const originalHTML = button.innerHTML;
                button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Soumission en cours...';

                const textarea = document.getElementById('validationNote');
                const comment = textarea ? textarea.value.trim() : '';

                fetch('/api/module/validate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    moduleCode: ctx.moduleCode,
                    comment
                  })
                })
                  .then(async (res) => {
                    const payload = await res.clone().json().catch(() => ({}));
                    if (!res.ok || !payload.success) {
                      throw payload;
                    }

                    const statusBox = document.getElementById('validationStatus');
                    if (statusBox) {
                      statusBox.className = 'rounded-2xl border border-green-200 bg-green-50 p-6 mb-6';
                      statusBox.innerHTML = ''
                        + '<div class="flex items-start gap-3">'
                        +   '<div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">'
                        +     '<i class="fas fa-trophy text-green-600"></i>'
                        +   '</div>'
                        +   '<div>'
                        +     '<h3 class="text-lg font-semibold text-green-900 mb-1">Validation réussie !</h3>'
                        +     '<p class="text-sm text-green-800 mb-4">Votre livrable est prêt. Vous allez être redirigé vers la version mise à jour.</p>'
                        +     '<div class="flex flex-wrap gap-3">'
                        +       '<a href="' + deliverableUrl + '" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white">'
                        +         '<i class="fas fa-download"></i>'
                        +         '<span>Télécharger le PDF</span>'
                        +       '</a>'
                        +       '<a href="/dashboard" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-green-300 bg-white text-green-700 hover:bg-green-100">'
                        +         '<i class="fas fa-home"></i>'
                        +         '<span>Dashboard</span>'
                        +       '</a>'
                        +     '</div>'
                        +   '</div>'
                        + '</div>';
                    }

                    setTimeout(() => window.location.reload(), 1200);
                  })
                  .catch((err) => {
                    console.error('Validation error', err);
                    const statusBox = document.getElementById('validationStatus');
                    if (statusBox) {
                      const reasons = Array.isArray(err?.blockingReasons) ? err.blockingReasons : [];
                      statusBox.className = 'rounded-2xl border border-red-200 bg-red-50 p-6 mb-6';
                      statusBox.innerHTML = ''
                        + '<h3 class="text-lg font-semibold text-red-900 mb-2">Validation impossible</h3>'
                        + '<p class="text-sm text-red-800 mb-3">' + (err?.error || 'Merci de corriger les points en attente avant de soumettre.') + '</p>'
                        + (reasons.length ? '<ul class="list-disc list-inside text-sm text-red-700 space-y-1">' + reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' : '');
                    }
                  })
                  .finally(() => {
                    button.dataset.loading = 'false';
                    button.innerHTML = originalHTML;
                  });
              }

              window.submitForValidation = submitForValidation;
            })();
          `}} />
        </body>
      </html>
    )
  } catch (error: any) {
    console.error('Validation page error:', error?.message, error?.stack)
    return c.redirect('/dashboard')
  }
})
// B7 - Téléchargement du Livrable PDF

moduleRoutes.get('/module/:code/download', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    const module = await c.env.DB.prepare(`
      SELECT id, title, module_code FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    const progress = await c.env.DB.prepare(`
      SELECT id, status, ai_score, ai_last_analysis, validated_at
      FROM progress
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.redirect('/dashboard')

    const isValidated = (progress.status as string) === 'validated'

    const deliverable = await c.env.DB.prepare(`
      SELECT id, content_json, summary, ai_score, coach_comment, validated_at, status, created_at
      FROM deliverables
      WHERE user_id = ? AND module_id = ?
      ORDER BY validated_at DESC, created_at DESC
      LIMIT 1
    `).bind(payload.userId, module.id).first()

    if (!deliverable && isValidated) {
      console.warn('Livrable manquant pour un module validé', moduleCode, 'user', payload.userId)
    }

    let deliverableContent: any = null
    if (deliverable?.content_json) {
      try {
        deliverableContent = JSON.parse(deliverable.content_json as string)
      } catch (error) {
        console.warn('Impossible de parser le content_json du livrable', error)
      }
    }

    // ═══ SIC Module: dedicated download page ═══
    if (moduleCode === 'mod2_sic') {
      // Fetch SIC answers
      const answersRes = await c.env.DB.prepare(`
        SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
      `).bind(progress.id).all()
      const sicAnswers = new Map<number, string>()
      for (const row of (answersRes.results ?? []) as any[]) {
        const r = (row.user_response ?? '').trim()
        if (r) sicAnswers.set(Number(row.question_number), r)
      }

      // Fetch BMC answers for coherence check
      let bmcAnswersMap: Map<number, string> | undefined
      const bmcModule = await c.env.DB.prepare(`SELECT id FROM modules WHERE module_code = 'mod1_bmc'`).first()
      if (bmcModule) {
        const bmcProgress = await c.env.DB.prepare(`SELECT id FROM progress WHERE user_id = ? AND module_id = ?`).bind(payload.userId, bmcModule.id).first()
        if (bmcProgress) {
          const bmcRes = await c.env.DB.prepare(`SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number`).bind(bmcProgress.id).all()
          bmcAnswersMap = new Map<number, string>()
          for (const row of (bmcRes.results ?? []) as any[]) {
            const r = (row.user_response ?? '').trim()
            if (r) bmcAnswersMap.set(Number(row.question_number), r)
          }
        }
      }

      // Run or retrieve analysis
      let sicAnalysis: SicAnalysisResult
      if (deliverableContent?.scoreGlobal !== undefined) {
        sicAnalysis = deliverableContent as SicAnalysisResult
      } else if (progress.ai_feedback_json) {
        try {
          sicAnalysis = JSON.parse(progress.ai_feedback_json as string) as SicAnalysisResult
        } catch {
          sicAnalysis = analyzeSIC(sicAnswers, bmcAnswersMap)
        }
      } else {
        sicAnalysis = analyzeSIC(sicAnswers, bmcAnswersMap)
      }

      // Get user info
      const user = await c.env.DB.prepare(`SELECT name FROM users WHERE id = ?`).bind(payload.userId).first()
      const userName = (user?.name as string) ?? 'Entrepreneur'
      const projectName = (module.title as string) ?? 'Social Impact Canvas'

      const diagnosticHtml = generateSicDiagnosticHtml(sicAnalysis, projectName, userName)
      const scoreLabel = getSicScoreLabel(sicAnalysis.scoreGlobal)
      const aiScorePercent = Math.round(sicAnalysis.scoreGlobal * 10)

      // Render SIC download page with embedded diagnostic
      return c.html(
        <html lang="fr">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Livrable SIC - {projectName}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          </head>
          <body class="bg-slate-50">
            <nav class="bg-white shadow-sm border-b border-slate-200">
              <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                <a href="/dashboard" class="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 font-medium">
                  <i class="fas fa-arrow-left"></i>
                  <span>Retour au dashboard</span>
                </a>
                <span class="text-xs text-slate-500 flex items-center gap-2">
                  <i class="fas fa-flag-checkered"></i>
                  Module 2 · SIC
                </span>
              </div>
            </nav>

            <main class="max-w-6xl mx-auto px-4 py-8 space-y-8">
              {!isValidated && (
                <section class="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-amber-800">
                  <div class="flex items-start gap-3">
                    <span class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 text-amber-600">
                      <i class="fas fa-triangle-exclamation"></i>
                    </span>
                    <div>
                      <h2 class="text-sm font-semibold">Livrable en mode brouillon</h2>
                      <p class="text-sm">Validez le module pour générer la version officielle du diagnostic SIC.</p>
                    </div>
                  </div>
                  <a href={`/module/${moduleCode}/validate`} class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold">
                    <i class="fas fa-check-double"></i>
                    Passer à la validation
                  </a>
                </section>
              )}

              <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-wider text-slate-500">{isValidated ? 'Livrable final' : 'Livrable brouillon'}</p>
                  <h1 class="text-3xl font-bold text-slate-900">Social Impact Canvas</h1>
                  <p class="mt-2 text-slate-600">Diagnostic d'impact social avec scoring, alignement ODD et vérification SMART.</p>
                </div>
                <div class="flex items-center gap-3 flex-wrap">
                  <span class={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${scoreLabel.color === 'green' ? 'bg-emerald-100 text-emerald-700' : scoreLabel.color === 'blue' ? 'bg-blue-100 text-blue-700' : scoreLabel.color === 'yellow' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    <i class="fas fa-chart-line"></i>
                    {sicAnalysis.scoreGlobal}/10 — {scoreLabel.label}
                  </span>
                  <span class={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${sicAnalysis.impactWashingRisk === 'faible' ? 'bg-emerald-100 text-emerald-700' : sicAnalysis.impactWashingRisk === 'moyen' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    <i class="fas fa-shield-halved"></i>
                    Impact washing: {sicAnalysis.impactWashingRisk}
                  </span>
                  <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-purple-100 text-purple-700">
                    <i class="fas fa-bullseye"></i>
                    {sicAnalysis.oddMappings.length} ODD
                  </span>
                  <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-sky-100 text-sky-700">
                    <i class="fas fa-check-circle"></i>
                    SMART: {sicAnalysis.smartCheck.score}/5
                  </span>
                </div>
              </header>

              <section class="grid gap-4 md:grid-cols-2">
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <i class="fas fa-download text-indigo-500"></i>
                    Livrables disponibles
                  </h2>
                  <div class="space-y-3">
                    <a href={`/api/sic/deliverable`} target="_blank"
                      class="flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition">
                      <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-file-code"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-emerald-900 text-sm">Diagnostic HTML</p>
                        <p class="text-xs text-emerald-700">Rapport interactif avec visualisations ODD</p>
                      </div>
                    </a>
                    <div class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <div class="w-10 h-10 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center">
                        <i class="fas fa-file-excel"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-600 text-sm">Excel SIC (6 feuilles)</p>
                        <p class="text-xs text-slate-500">Prochainement disponible</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <i class="fas fa-chart-bar text-indigo-500"></i>
                    Scores par section
                  </h2>
                  <div class="space-y-3">
                    {sicAnalysis.sections.map((sec) => {
                      const barColor = sec.score >= 7 ? '#059669' : sec.score >= 5 ? '#0284c7' : sec.score >= 3 ? '#d97706' : '#dc2626'
                      return (
                        <div class="space-y-1" key={`sec-${sec.key}`}>
                          <div class="flex justify-between text-sm">
                            <span class="font-medium text-slate-700">{sec.label}</span>
                            <span class="font-bold" style={`color:${barColor}`}>{sec.score}/10</span>
                          </div>
                          <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full rounded-full" style={`width:${sec.percentage}%;background:${barColor}`}></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>

              {sicAnalysis.oddMappings.length > 0 && (
                <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                    <i class="fas fa-globe text-indigo-500"></i>
                    Alignement ODD
                  </h2>
                  <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {sicAnalysis.oddMappings.map((odd) => {
                      const color = ODD_ICONS[odd.oddNumber] ?? '#666'
                      return (
                        <div class="flex items-center gap-3 p-3 rounded-xl border" style={`border-color:${color}30;background:${color}08`} key={`odd-${odd.oddNumber}`}>
                          <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={`background:${color}`}>
                            {odd.oddNumber}
                          </div>
                          <div>
                            <p class="font-semibold text-sm text-slate-900">{odd.oddLabel}</p>
                            <p class="text-xs text-slate-600">
                              {odd.contributionType === 'direct' ? 'Direct' : 'Indirect'} · {odd.evidenceLevel === 'prouve' ? 'Prouvé' : odd.evidenceLevel === 'mesure' ? 'Mesuré' : 'Déclaré'} · {odd.score}/3
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {sicAnalysis.recommendations.length > 0 && (
                <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                    <i class="fas fa-lightbulb text-amber-500"></i>
                    Recommandations
                  </h2>
                  <ul class="space-y-2">
                    {sicAnalysis.recommendations.map((rec, idx) => (
                      <li class="flex items-start gap-2 text-sm text-slate-700" key={`rec-${idx}`}>
                        <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex-shrink-0 mt-0.5">{idx + 1}</span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                  <i class="fas fa-rocket text-indigo-500"></i>
                  Prochaines étapes
                </h2>
                <div class="grid gap-4 md:grid-cols-2">
                  <a href="/module/mod3_inputs/video" class="block rounded-2xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                        <i class="fas fa-keyboard"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Module 3 · Inputs Entrepreneur</p>
                        <p class="text-sm text-slate-600">Renseignez vos données financières historiques.</p>
                      </div>
                    </div>
                  </a>
                  <a href="/dashboard" class="block rounded-2xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-home"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Tableau de bord</p>
                        <p class="text-sm text-slate-600">Revenez au parcours Investment Readiness.</p>
                      </div>
                    </div>
                  </a>
                </div>
              </section>
            </main>
          </body>
        </html>
      )
    }
    // ═══ End SIC dedicated download ═══

    // ═══ Module 3 Inputs Financiers: dedicated download page ═══
    if (moduleCode === 'mod3_inputs') {
      const fiRow = await c.env.DB.prepare('SELECT * FROM financial_inputs WHERE user_id = ? AND module_id = ? LIMIT 1')
        .bind(payload.userId, module.id).first()

      let inputsAnalysis: InputsAnalysisResult | null = null
      if (fiRow && (fiRow as any).analysis_json) {
        try { inputsAnalysis = JSON.parse((fiRow as any).analysis_json) } catch {}
      }

      // If no analysis, run one
      if (!inputsAnalysis && fiRow) {
        const FI_COLS2: Record<InputTabKey, string> = {
          infos_generales: 'infos_generales_json', donnees_historiques: 'donnees_historiques_json',
          produits_services: 'produits_services_json', ressources_humaines: 'ressources_humaines_json',
          hypotheses_croissance: 'hypotheses_croissance_json', couts_fixes_variables: 'couts_fixes_variables_json',
          bfr_tresorerie: 'bfr_tresorerie_json', investissements: 'investissements_json', financement: 'financement_json'
        }
        const allData2: Record<InputTabKey, Record<string, any>> = {} as any
        for (const tabKey of INPUT_TAB_ORDER) {
          const raw = (fiRow as any)[FI_COLS2[tabKey]]
          allData2[tabKey] = raw ? JSON.parse(raw) : {}
        }
        inputsAnalysis = analyzeInputs(allData2)
      }

      const readiness = inputsAnalysis?.readinessScore ?? 0
      const readinessLbl = getInputsReadinessLabel(readiness)
      const sColor = readinessLbl.color === 'green' ? '#059669' : readinessLbl.color === 'blue' ? '#0284c7' : readinessLbl.color === 'yellow' ? '#d97706' : '#dc2626'

      // Company name
      let companyName = 'Mon Entreprise'
      let entrepreneurName = 'Entrepreneur'
      if (fiRow && (fiRow as any).infos_generales_json) {
        try {
          const infos = JSON.parse((fiRow as any).infos_generales_json)
          companyName = infos.nom_entreprise || companyName
          entrepreneurName = infos.dirigeant_nom || entrepreneurName
        } catch {}
      }
      const userRow = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(payload.userId).first()
      if (userRow && (userRow as any).name) entrepreneurName = (userRow as any).name

      const { navItems: resolvedNavItems, activeNav } = resolveNavigationForStage(moduleCode, 'download')
      const validatedDate = progress.validated_at ? new Date(progress.validated_at as string).toLocaleDateString('fr-FR') : null

      const diagnosticHtml = inputsAnalysis ? generateInputsDiagnosticHtml(inputsAnalysis, companyName, entrepreneurName) : null

      const pageContent = (
        <div class="esono-grid">
          <section class="esono-hero" style={`background:linear-gradient(135deg, ${sColor}15 0%, ${sColor}05 100%);border:1px solid ${sColor}30;`}>
            <div class="esono-hero__header">
              <div>
                <h2 class="esono-hero__title"><i class="fas fa-file-invoice-dollar" style="margin-right:8px;"></i>Livrable — Inputs Financiers</h2>
                <p class="esono-hero__description">{companyName} — Score Readiness: <strong style={`color:${sColor};`}>{readiness}%</strong> ({readinessLbl.label})</p>
              </div>
              <span class={`esono-hero__badge`} style={`background:${isValidated ? '#dcfce7' : '#fef3c7'};color:${isValidated ? '#166534' : '#92400e'};`}>
                <i class={`fas ${isValidated ? 'fa-check-circle' : 'fa-clock'}`}></i>
                {isValidated ? `Validé le ${validatedDate}` : 'Brouillon'}
              </span>
            </div>
            <div class="esono-hero__metrics">
              <div class="esono-hero__metric"><p class="esono-hero__metric-value" style={`color:${sColor};`}>{readiness}%</p><p class="esono-hero__metric-label">Readiness</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value">{inputsAnalysis?.overallCompleteness ?? 0}%</p><p class="esono-hero__metric-label">Complétude</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value">{inputsAnalysis?.alerts.filter(a => a.level === 'error').length ?? 0}</p><p class="esono-hero__metric-label">Erreurs</p></div>
              <div class="esono-hero__metric"><p class="esono-hero__metric-value">{inputsAnalysis?.recommendations.length ?? 0}</p><p class="esono-hero__metric-label">Recommandations</p></div>
            </div>
          </section>

          {/* Diagnostic HTML iframe */}
          {diagnosticHtml && (
            <section class="esono-card">
              <div class="esono-card__header">
                <h2 class="esono-card__title"><i class="fas fa-stethoscope esono-card__title-icon"></i>Diagnostic Inputs Financiers</h2>
              </div>
              <div class="esono-card__body" style="padding:0;">
                <iframe
                  id="diagnosticFrame"
                  srcdoc={diagnosticHtml}
                  style="width:100%;min-height:800px;border:none;border-radius:0 0 12px 12px;"
                  title="Diagnostic Inputs Financiers"
                ></iframe>
              </div>
            </section>
          )}

          {/* Download actions */}
          <div class="esono-form__actions">
            <a href="/module/mod3_inputs/inputs" class="esono-btn esono-btn--secondary">
              <i class="fas fa-pen-to-square"></i> Modifier les inputs
            </a>
            <a href="/module/mod3_inputs/analysis" class="esono-btn esono-btn--secondary">
              <i class="fas fa-robot"></i> Relancer l'analyse
            </a>
            <button type="button" class="esono-btn esono-btn--primary" onclick="printDiagnostic()">
              <i class="fas fa-print"></i> Imprimer / PDF
            </button>
            <a href="/api/inputs/diagnostic?module=mod3_inputs" target="_blank" class="esono-btn esono-btn--accent">
              <i class="fas fa-external-link-alt"></i> Diagnostic HTML
            </a>
            <a href="/dashboard" class="esono-btn esono-btn--ghost">
              <i class="fas fa-arrow-left"></i> Dashboard
            </a>
          </div>
        </div>
      )

      const extraScripts = `
        function printDiagnostic() {
          const frame = document.getElementById('diagnosticFrame');
          if (frame && frame.contentWindow) { frame.contentWindow.print(); }
        }
      `

      return c.html(renderEsanoLayout({
        pageTitle: 'Livrable Inputs Financiers — Module 3',
        navItems: resolvedNavItems,
        activeNav,
        content: pageContent,
        extraScripts
      }))
    }
    // ═══ End Inputs Financiers dedicated download ═══

    let sections: CanvasSection[] | null = null

    if (Array.isArray(deliverableContent?.sections) && deliverableContent.sections.length > 0) {
      sections = deliverableContent.sections.map((section: any, index: number) => {
        const questionId = Number(section.questionId ?? section.question_id ?? section.id ?? index + 1)
        const sectionName = typeof section.section === 'string' ? section.section : getSectionName(questionId)
        const questionText = typeof section.question === 'string' ? section.question : section.questionText ?? `Question ${questionId}`
        const answer = typeof section.answer === 'string' ? section.answer : section.answer?.toString?.() ?? ''
        const scoreValue = typeof section.score === 'number' ? Math.round(section.score) : null
        const label = typeof section.scoreLabel === 'string'
          ? section.scoreLabel
          : scoreValue !== null ? getScoreLabel(scoreValue).label : 'Analyse IA à générer'
        const suggestions = Array.isArray(section.suggestions) ? section.suggestions : []
        const questions = Array.isArray(section.questions) ? section.questions : []

        return {
          order: index + 1,
          questionId,
          section: sectionName,
          question: questionText,
          answer,
          score: scoreValue,
          scoreLabel: label,
          suggestions,
          questions
        }
      })
    }

    if (!sections || sections.length === 0) {
      const questionsRes = await c.env.DB.prepare(`
        SELECT question_number, question_text, user_response, ai_feedback, quality_score
        FROM questions
        WHERE progress_id = ?
        ORDER BY question_number
      `).bind(progress.id).all()

      const questionRows = Array.isArray(questionsRes.results) ? questionsRes.results as any[] : []
      sections = buildCanvasSectionsFromQuestions(module.module_code as string, questionRows)
    }

    const gridSections = sections.map((section, index) => ({
      ...section,
      row: Math.floor(index / 3) + 1,
      col: (index % 3) + 1
    }))

    const deliverableAiScore = (deliverable && typeof deliverable.ai_score === 'number')
      ? Number(deliverable.ai_score)
      : null

    const aiScoreRaw = deliverableAiScore !== null
      ? deliverableAiScore
      : typeof progress.ai_score === 'number'
        ? Number(progress.ai_score)
        : null

    const globalLabel = aiScoreRaw !== null ? getScoreLabel(aiScoreRaw).label : 'Analyse IA à générer'
    const globalBadge = (SCORE_BADGE_STYLES as Record<string, { badge: string; icon: string }>)[globalLabel] ?? SCORE_BADGE_STYLES.default

    const validatedTimestamp = (deliverableContent?.validatedAt as string | null)
      ?? (deliverable?.validated_at as string | null)
      ?? (progress.validated_at as string | null)

    const refreshedTimestamp = (deliverableContent?.refreshedAt as string | null) ?? null

    const validatedAtDisplay = isValidated
      ? formatDateValue(validatedTimestamp, 'Non généré')
      : 'Module non validé'

    const refreshedAtDisplay = refreshedTimestamp
      ? formatDateValue(refreshedTimestamp)
      : (isValidated ? formatDateValue(validatedTimestamp, 'Non généré') : null)

    const analysisDateDisplay = formatDateValue(progress.ai_last_analysis as string | null, 'Analyse IA à relancer')
    const coachComment = deliverable?.coach_comment ? String(deliverable.coach_comment).trim() : ''
    const summary = typeof deliverable?.summary === 'string'
      ? deliverable.summary as string
      : typeof deliverableContent?.summary === 'string'
        ? deliverableContent.summary as string
        : ''
    const moduleTitle = module.title ?? 'Business Model Canvas'

    const canvasExportData = {
      moduleTitle,
      moduleCode,
      validatedAt: validatedTimestamp ?? null,
      refreshedAt: refreshedTimestamp,
      summary: summary || (isValidated
        ? 'Canvas validé et prêt à être partagé.'
        : 'Livrable brouillon — validez le module pour finaliser.'),
      aiScore: aiScoreRaw,
      scoreLabel: globalLabel,
      status: isValidated ? 'validated' : 'draft',
      isValidated,
      sections: gridSections.map((section) => ({
        questionId: section.questionId,
        section: section.section,
        question: section.question,
        answer: section.answer,
        score: section.score,
        scoreLabel: section.scoreLabel,
        suggestions: section.suggestions,
        questions: section.questions,
        row: section.row,
        col: section.col
      }))
    }

    const canvasExportJson = JSON.stringify(canvasExportData).replace(/</g, '\\u003c')

    const displaySections = gridSections.map((section) => {
      const style = (SCORE_BADGE_STYLES as Record<string, { badge: string; icon: string }>)[section.scoreLabel] ?? SCORE_BADGE_STYLES.default
      const suggestions = Array.isArray(section.suggestions)
        ? section.suggestions.map((entry: any) => {
            if (!entry) return ''
            if (typeof entry === 'string') return entry
            if (typeof entry?.message === 'string') return entry.message
            return String(entry)
          }).filter((item: string) => item.length > 0)
        : []
      const clarifications = Array.isArray(section.questions)
        ? section.questions.map((entry: any) => {
            if (!entry) return ''
            if (typeof entry === 'string') return entry
            if (typeof entry?.message === 'string') return entry.message
            return String(entry)
          }).filter((item: string) => item.length > 0)
        : []

      return {
        ...section,
        suggestions,
        questions: clarifications,
        badgeClass: style.badge,
        badgeIcon: style.icon
      }
    })

    const aiScoreDisplay = aiScoreRaw !== null ? `${aiScoreRaw}%` : 'À calculer'
    const deliverableStatusRaw = String((deliverable?.status as string | null) ?? (isValidated ? 'ready' : 'draft'))

    let deliverableStatusLabel: string
    if (!isValidated) {
      deliverableStatusLabel = 'Brouillon (module non validé)'
    } else if (deliverableStatusRaw === 'ready') {
      deliverableStatusLabel = 'Prêt à partager'
    } else if (deliverableStatusRaw === 'draft') {
      deliverableStatusLabel = 'Brouillon'
    } else if (deliverableStatusRaw === 'archived') {
      deliverableStatusLabel = 'Archivé'
    } else {
      deliverableStatusLabel = deliverableStatusRaw
    }

    const metaEntries = [
      { label: 'Validé le', value: validatedAtDisplay },
      { label: 'Dernière régénération', value: refreshedAtDisplay ?? (isValidated ? validatedAtDisplay : 'En attente de validation') },
      { label: 'Analyse IA', value: analysisDateDisplay },
      { label: 'Statut du livrable', value: deliverableStatusLabel }
    ]

    const hasCoachComment = coachComment.length > 0 && isValidated
    const displaySummary = summary.length > 0
      ? summary
      : isValidated
        ? 'Canvas validé et prêt à être partagé.'
        : 'Livrable brouillon — validez le module pour verrouiller la version investisseur.'
    const globalBadgeClass = globalBadge.badge
    const globalBadgeIcon = globalBadge.icon

    const headerTitle = isValidated ? 'Livrable final' : 'Livrable brouillon'
    const headerSubtitle = isValidated
      ? 'Votre livrable est prêt à être exporté, partagé et présenté à vos partenaires financiers.'
      : 'Prévisualisez votre Business Model Canvas actuel. Validez le module pour produire la version officielle investisseur.'
    const headerBadge = isValidated
      ? { className: 'inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 font-semibold', icon: 'fas fa-circle-check', label: 'Validation complétée' }
      : { className: 'inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 font-semibold', icon: 'fas fa-hourglass-half', label: 'Validation en attente' }

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Livrable - {moduleTitle}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
        </head>
        <body class="bg-slate-50">
          <nav class="bg-white shadow-sm border-b border-slate-200">
            <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
              <a href="/dashboard" class="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 font-medium">
                <i class="fas fa-arrow-left"></i>
                <span>Retour au dashboard</span>
              </a>
              <span class="text-xs text-slate-500 flex items-center gap-2">
                <i class="fas fa-flag-checkered"></i>
                Étape 1 · B7
              </span>
            </div>
          </nav>

          <main class="max-w-5xl mx-auto px-4 py-8 space-y-8">
            {!isValidated && (
              <section class="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-amber-800">
                <div class="flex items-start gap-3">
                  <span class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 text-amber-600">
                    <i class="fas fa-triangle-exclamation"></i>
                  </span>
                  <div>
                    <h2 class="text-sm font-semibold">Livrable en mode brouillon</h2>
                    <p class="text-sm">Complétez l’analyse IA (B4) puis validez le module (B6) pour générer la version officielle.</p>
                  </div>
                </div>
                <a
                  href={`/module/${moduleCode}/validate`}
                  class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
                >
                  <i class="fas fa-check-double"></i>
                  Passer à la validation
                </a>
              </section>
            )}

            <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p class="text-xs uppercase tracking-wider text-slate-500">{headerTitle}</p>
                <h1 class="text-3xl font-bold text-slate-900">{moduleTitle}</h1>
                <p class="mt-2 text-slate-600">{headerSubtitle}</p>
              </div>
              <div class={headerBadge.className}>
                <i class={headerBadge.icon}></i>
                <span>{headerBadge.label}</span>
              </div>
            </header>

            <section class="grid gap-6 md:grid-cols-2">
              <article class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                <div class="flex items-center gap-3">
                  <div class="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                    <i class="fas fa-file-signature text-xl"></i>
                  </div>
                  <div>
                    <h2 class="text-lg font-semibold text-slate-900">{moduleTitle}</h2>
                    <p class="text-sm text-slate-600">Livrable Business Model Canvas</p>
                  </div>
                </div>
                <p class="text-sm text-slate-600">{isValidated ? 'Récapitulatif des informations clés enregistrées lors de la validation de votre module.' : 'Synthèse des éléments renseignés à ce stade. Finalisez la validation pour figer le livrable.'}</p>
                <dl class="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {metaEntries.map((item, idx) => (
                    <div class="flex items-center justify-between gap-3 px-4 py-3 bg-white odd:bg-slate-50" key={`meta-${idx}`}>
                      <dt class="text-xs uppercase tracking-wide text-slate-500">{item.label}</dt>
                      <dd class="text-sm font-semibold text-slate-900 text-right">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>

              <article class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <div class="flex items-center justify-between">
                  <span class={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${globalBadgeClass}`}>
                    <i class={globalBadgeIcon}></i>
                    {globalLabel}
                  </span>
                  <span class="text-xs text-slate-500">{validatedAtDisplay}</span>
                </div>
                <div class="mt-6 text-center space-y-2">
                  <p class="text-xs uppercase tracking-wide text-slate-500">Score IA global</p>
                  <p class="text-5xl font-extrabold text-slate-900">{aiScoreDisplay}</p>
                  <p class="text-sm text-slate-500">{displaySummary}</p>
                </div>
                <div class="mt-6 grid grid-cols-2 gap-3 text-xs text-slate-600">
                  <div class="flex items-center gap-2">
                    <i class="fas fa-robot text-slate-400"></i>
                    <span>Analyse IA : {analysisDateDisplay}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <i class="fas fa-arrows-rotate text-slate-400"></i>
                    <span>Régénération : {refreshedAtDisplay ?? validatedAtDisplay}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <i class="fas fa-bolt text-slate-400"></i>
                    <span>Statut : {deliverableStatusLabel}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <i class="fas fa-layer-group text-slate-400"></i>
                    <span>{displaySections.length} blocs structurés</span>
                  </div>
                </div>
              </article>
            </section>

            {hasCoachComment && (
              <section class="bg-white rounded-2xl border border-amber-200 shadow-sm p-6">
                <h2 class="text-lg font-semibold text-amber-900 flex items-center gap-2">
                  <i class="fas fa-user-check"></i>
                  Commentaire du coach
                </h2>
                <p class="mt-3 text-sm text-amber-800 whitespace-pre-line">{coachComment}</p>
              </section>
            )}

            <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
              <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h2 class="text-xl font-semibold text-slate-900">Exporter et partager votre livrable</h2>
                  <p class="text-sm text-slate-600">{isValidated ? 'Téléchargez le PDF, régénérez le contenu après de nouvelles itérations ou partagez le lien avec vos parties prenantes.' : 'Exportez un PDF brouillon ou finalisez le module pour activer la version investisseur.'}</p>
                </div>
                <a href="/dashboard" class="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-semibold">
                  <i class="fas fa-arrow-left"></i>
                  Retour au dashboard
                </a>
              </div>

              <div class="grid gap-4 md:grid-cols-3">
                <button
                  onclick="downloadPDF(event)"
                  class="flex items-center justify-center gap-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 text-sm transition"
                >
                  <i class="fas fa-file-arrow-down text-lg"></i>
                  <span>Télécharger le PDF</span>
                </button>
                <button
                  onclick="refreshDeliverable(event)"
                  class="flex items-center justify-center gap-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 px-4 text-sm transition"
                  data-loading="false"
                >
                  <i class="fas fa-arrows-rotate text-lg"></i>
                  <span>Régénérer le livrable</span>
                </button>
                <button
                  onclick="shareDocument()"
                  class="flex items-center justify-center gap-3 rounded-xl border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 font-semibold py-3 px-4 text-sm transition"
                >
                  <i class="fas fa-share-nodes text-lg"></i>
                  <span>Partager</span>
                </button>
              </div>

              <div id="liveStatus" class="hidden"></div>
            </section>

            <section class="space-y-5">
              <div class="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 class="text-xl font-semibold text-slate-900">Aperçu du Business Model Canvas</h2>
                  <p class="text-sm text-slate-600">Visualisez vos réponses consolidées bloc par bloc avant export.</p>
                </div>
                <span class="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <i class="fas fa-border-all"></i>
                  {displaySections.length} bloc{displaySections.length > 1 ? 's' : ''} structurés
                </span>
              </div>

              <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {displaySections.map((section) => (
                  <article class="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4" key={`section-${section.questionId}`}>
                    <div class="flex items-start justify-between gap-4">
                      <div>
                        <p class="text-xs uppercase tracking-wide text-slate-500">Bloc #{section.order}</p>
                        <h3 class="text-sm font-semibold text-slate-900">{section.section}</h3>
                        <p class="text-xs text-slate-500 mt-1">{section.question}</p>
                      </div>
                      <span class={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${section.badgeClass}`}>
                        <i class={section.badgeIcon}></i>
                        {section.score !== null ? `${section.score}%` : section.scoreLabel}
                      </span>
                    </div>
                    <div class="bg-slate-50 border border-slate-100 rounded-xl p-4">
                      <p class="text-sm text-slate-700 whitespace-pre-line">
                        {section.answer && section.answer.length > 0 ? section.answer : '—'}
                      </p>
                    </div>
                    {section.suggestions.length > 0 && (
                      <div class="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700 space-y-2">
                        <p class="font-semibold flex items-center gap-2 text-amber-800">
                          <i class="fas fa-lightbulb"></i>
                          Axes d'amélioration suggérés
                        </p>
                        <ul class="space-y-1">
                          {section.suggestions.slice(0, 2).map((suggestion, idx) => (
                            <li key={`suggestion-${section.questionId}-${idx}`}>• {suggestion}</li>
                          ))}
                        </ul>
                        {section.suggestions.length > 2 && (
                          <p class="italic">+ {section.suggestions.length - 2} suggestion(s) supplémentaires</p>
                        )}
                      </div>
                    )}
                    {section.questions.length > 0 && (
                      <div class="rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs text-sky-700 space-y-2">
                        <p class="font-semibold flex items-center gap-2 text-sky-800">
                          <i class="fas fa-circle-question"></i>
                          Points à clarifier
                        </p>
                        <ul class="space-y-1">
                          {section.questions.slice(0, 2).map((question, idx) => (
                            <li key={`clarification-${section.questionId}-${idx}`}>• {question}</li>
                          ))}
                        </ul>
                        {section.questions.length > 2 && (
                          <p class="italic">+ {section.questions.length - 2} demande(s) supplémentaires</p>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
              <h3 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <i class="fas fa-rocket text-indigo-500"></i>
                Prochaines étapes recommandées
              </h3>
              <div class="grid gap-4 md:grid-cols-2">
                <a href="/dashboard" class="block rounded-2xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition p-4">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                      <i class="fas fa-calculator"></i>
                    </div>
                    <div>
                      <p class="font-semibold text-slate-900">Étape 2 · Analyse financière</p>
                      <p class="text-sm text-slate-600">Préparez vos indicateurs financiers clés.</p>
                    </div>
                  </div>
                </a>
                <a href="/dashboard" class="block rounded-2xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition p-4">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                      <i class="fas fa-chart-line"></i>
                    </div>
                    <div>
                      <p class="font-semibold text-slate-900">Étape 3 · Projections</p>
                      <p class="text-sm text-slate-600">Construisez des scénarios solides pour vos investisseurs.</p>
                    </div>
                  </div>
                </a>
              </div>
            </section>
          </main>

          <script dangerouslySetInnerHTML={{__html: `
            const canvasData = ${canvasExportJson};
            const refreshUrl = "/api/module/${moduleCode}/deliverable/refresh";

            function showStatus(type, message) {
              const box = document.getElementById('liveStatus');
              if (!box) return;
              const base = 'mt-3 rounded-2xl border p-4 text-sm flex items-start gap-3';
              let classes = '';
              let icon = '';
              if (type === 'success') {
                classes = base + ' border-emerald-200 bg-emerald-50 text-emerald-800';
                icon = '<i class="fas fa-circle-check text-emerald-500 mt-0.5"></i>';
              } else if (type === 'error') {
                classes = base + ' border-rose-200 bg-rose-50 text-rose-800';
                icon = '<i class="fas fa-triangle-exclamation text-rose-500 mt-0.5"></i>';
              } else {
                classes = base + ' border-sky-200 bg-sky-50 text-sky-800';
                icon = '<i class="fas fa-circle-info text-sky-500 mt-0.5"></i>';
              }
              box.className = classes;
              box.innerHTML = icon + '<div>' + message + '</div>';
              box.classList.remove('hidden');
            }

            async function refreshDeliverable(event) {
              const button = event?.currentTarget;
              if (!button || button.dataset.loading === 'true') return;
              if (!canvasData.isValidated) {
                showStatus('info', 'Validez le module avant de régénérer le livrable.');
                return;
              }
              button.dataset.loading = 'true';
              const original = button.innerHTML;
              button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span> Régénération...</span>';
              try {
                const response = await fetch(refreshUrl, { method: 'POST' });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                  throw payload;
                }
                const refreshedAt = payload?.refreshedAt ? new Date(payload.refreshedAt).toLocaleString('fr-FR') : 'immédiatement';
                showStatus('success', 'Livrable régénéré avec succès (' + refreshedAt + ').');
                setTimeout(() => window.location.reload(), 1200);
              } catch (error) {
                console.error('Deliverable refresh error', error);
                const message = error?.error || 'Impossible de régénérer le livrable. Réessayez dans un instant.';
                showStatus('error', message);
              } finally {
                button.dataset.loading = 'false';
                button.innerHTML = original;
              }
            }

            function shareDocument() {
              if (navigator.share) {
                navigator.share({
                  title: canvasData.moduleTitle || "Business Model Canvas",
                  text: canvasData.isValidated
                    ? (canvasData.summary || "Découvrez mon Business Model Canvas validé.")
                    : "Brouillon du Business Model Canvas – validation en attente.",
                  url: window.location.href
                }).catch(() => {});
              } else {
                showStatus('info', "Le partage natif n’est pas disponible sur ce navigateur.");
              }
            }

            function downloadPDF(event) {
              const { jsPDF } = window.jspdf || {};
              if (!jsPDF) {
                showStatus('error', 'Bibliothèque jsPDF indisponible. Rechargez la page.');
                return;
              }
              const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
              if (!canvasData.isValidated) {
                showStatus('info', 'Export PDF brouillon généré. Validez le module pour obtenir la version investisseur.');
              }
              const pageWidth = doc.internal.pageSize.getWidth();
              const pageHeight = doc.internal.pageSize.getHeight();
              const margin = 12;
              const headerHeight = 32;

              doc.setFillColor(37, 99, 235);
              doc.rect(0, 0, pageWidth, headerHeight, 'F');
              doc.setTextColor(255, 255, 255);
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(16);
              doc.text(canvasData.moduleTitle || 'Business Model Canvas', margin, 16);
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(10);
              const summaryLine = canvasData.summary || (canvasData.isValidated
                ? 'Livrable validé et prêt à être partagé.'
                : 'Brouillon en attente de validation — export informatif.');
              doc.text(summaryLine, margin, 24);
              const scoreText = typeof canvasData.aiScore === 'number'
                ? 'Score IA : ' + canvasData.aiScore + '% ' + (canvasData.scoreLabel ? '(' + canvasData.scoreLabel + ')' : '')
                : 'Score IA en attente';
              doc.text(scoreText, pageWidth - margin, 16, { align: 'right' });
              if (canvasData.validatedAt) {
                doc.text('Validé le ' + new Date(canvasData.validatedAt).toLocaleDateString('fr-FR'), pageWidth - margin, 24, { align: 'right' });
              }

              if (!canvasData.isValidated) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(217, 119, 6);
                doc.text('MODE BROUILLON - VALIDATION EN ATTENTE', margin, headerHeight + 10);
              }

              doc.setTextColor(15, 23, 42);
              const gridTop = headerHeight + 6;
              const cellWidth = (pageWidth - 2 * margin) / 3;
              const cellHeight = (pageHeight - gridTop - margin) / 3;
              const sections = Array.isArray(canvasData.sections) ? canvasData.sections : [];

              sections.forEach((section) => {
                const col = Math.min(3, Math.max(1, section.col || 1));
                const row = Math.min(3, Math.max(1, section.row || 1));
                const x = margin + (col - 1) * cellWidth;
                const y = gridTop + (row - 1) * cellHeight;

                doc.setDrawColor(209, 213, 219);
                doc.setFillColor(248, 250, 252);
                doc.rect(x, y, cellWidth, cellHeight, 'FD');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(30, 64, 175);
                const title = section.section || ('Bloc ' + section.questionId);
                doc.text(title, x + 4, y + 6);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(51, 65, 85);
                if (typeof section.score === 'number') {
                  const meta = 'Score : ' + section.score + '% ' + (section.scoreLabel ? '(' + section.scoreLabel + ')' : '');
                  doc.text(meta, x + 4, y + 12);
                } else if (section.scoreLabel) {
                  doc.text(section.scoreLabel, x + 4, y + 12);
                }

                const answer = section.answer && section.answer.trim().length
                  ? section.answer.trim()
                  : 'Non renseigné';
                const availableWidth = cellWidth - 8;
                const textY = y + 18;
                const lines = doc.splitTextToSize(answer, availableWidth);
                let currentY = textY;
                const lineHeight = 4;
                for (let idx = 0; idx < lines.length; idx++) {
                  if (currentY > y + cellHeight - 6) {
                    doc.text('…', x + 4, y + cellHeight - 5);
                    break;
                  }
                  doc.text(lines[idx], x + 4, currentY);
                  currentY += lineHeight;
                }
              });

              doc.setFontSize(8);
              doc.setTextColor(100, 116, 139);
              doc.text('Généré le ' + new Date().toLocaleDateString('fr-FR'), margin, pageHeight - 6);
              doc.text('Entrepreneurs Afrique · Plateforme EdTech', pageWidth - margin, pageHeight - 6, { align: 'right' });

              const filename = 'Business-Model-Canvas-' + (canvasData.moduleCode || 'livrable') + '.pdf';
              doc.save(filename);

              if (event && event.currentTarget) {
                const button = event.currentTarget;
                const original = button.innerHTML;
                button.innerHTML = '<i class="fas fa-check"></i><span>Téléchargé</span>';
                button.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
                button.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
                setTimeout(() => {
                  button.innerHTML = original;
                  button.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
                  button.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
                }, 2500);
              }

              showStatus('success', 'PDF généré et téléchargé.');
            }

            window.downloadPDF = downloadPDF;
            window.shareDocument = shareDocument;
            window.refreshDeliverable = refreshDeliverable;
          `}} />
        </body>
      </html>
    )
  } catch (error) {
    console.error('Download page error:', error)
    return c.redirect('/dashboard')
  }
})
