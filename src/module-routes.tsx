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
import { generateFullSicDeliverable, type SicDeliverableData } from './sic-deliverable-engine'
import { generateFullBmcDeliverable, generateBmcDiagnosticHtml, type BmcDeliverableData } from './bmc-deliverable-engine'
import { analyzePme, generatePmeExcelXml, generatePmePreviewHtml, type PmeInputData } from './framework-pme-engine'
import {
  analyzeInputs, generateInputsDiagnosticHtml, getInputsReadinessLabel,
  INPUT_TAB_ORDER, INPUT_TAB_LABELS, TAB_COACHING, TAB_FIELDS, scoreTab,
  type InputTabKey, type InputsAnalysisResult, type TabScore
} from './inputs-engine'


type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY?: string
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

// Old sidebar nav items removed — top bar only now

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


// Old form section configs removed — data entry via uploaded documents only


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

  return (
    <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{pageTitle} &bull; ESONO</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" />
        <link rel="stylesheet" href="/static/esono.css" />
        <style dangerouslySetInnerHTML={{ __html: `
          .esono-topbar { background: #111827; color: white; padding: 0 24px; height: 56px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
          .esono-topbar__brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: white; }
          .esono-topbar__logo { font-weight: 800; font-size: 1.25em; letter-spacing: -0.02em; }
          .esono-topbar__sep { width: 1px; height: 24px; background: rgba(255,255,255,0.2); }
          .esono-topbar__subtitle { font-size: 0.8em; color: rgba(255,255,255,0.6); }
          .esono-topbar__nav { display: flex; align-items: center; gap: 8px; }
          .esono-topbar__link { color: rgba(255,255,255,0.7); text-decoration: none; font-size: 0.85em; padding: 6px 14px; border-radius: 8px; display: flex; align-items: center; gap: 6px; transition: all 0.15s; }
          .esono-topbar__link:hover { background: rgba(255,255,255,0.1); color: white; }
          .esono-topbar__link--active { background: rgba(255,255,255,0.12); color: white; font-weight: 600; }
          .esono-layout-main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
          @media (max-width: 768px) {
            .esono-topbar { padding: 0 12px; height: 48px; }
            .esono-topbar__subtitle { display: none; }
            .esono-layout-main { padding: 16px 12px 48px; }
          }
        ` }} />
        {headItems}
      </head>
      <body class={bodyClass ?? ''} style="margin: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <nav class="esono-topbar">
          <a href="/entrepreneur" class="esono-topbar__brand">
            <span class="esono-topbar__logo">ESONO</span>
            <span class="esono-topbar__sep"></span>
            <span class="esono-topbar__subtitle">Investment Readiness</span>
          </a>
          <div class="esono-topbar__nav">
            <a href="/formations" class="esono-topbar__link" title="Micro-learning &amp; formations">
              <i class="fas fa-book-open"></i>
              <span>Formations</span>
            </a>
            <a href="/entrepreneur" class="esono-topbar__link">
              <i class="fas fa-home"></i>
              <span>Accueil</span>
            </a>
          </div>
        </nav>

        <main class="esono-layout-main">
          {breadcrumb && breadcrumb.length > 0 && (
            <div style="font-size: 0.85em; color: #64748b; margin-bottom: 16px;">
              {breadcrumb.map((item, index) => (
                <span key={`breadcrumb-${index}`}>
                  {item.href ? (
                    <a href={item.href} style="color: #64748b; text-decoration: none;">
                      {item.label}
                    </a>
                  ) : (
                    <span>{item.label}</span>
                  )}
                  {index < breadcrumb.length - 1 && <span style="margin: 0 6px; color: #94a3b8;">/</span>}
                </span>
              ))}
            </div>
          )}

          {headerActions && (
            <div style="margin-bottom: 16px;">{headerActions}</div>
          )}

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

// ═══════════════════════════════════════════════════════════════════
// LEGACY ROUTES — All old sequential module routes redirect to deliverable page
// Old flow: video → quiz → inputs → questions → analysis → improve → validate → download
// New flow: Upload → Generate → Deliverable view only
// ═══════════════════════════════════════════════════════════════════

// B1 - Video → Redirect to deliverable
moduleRoutes.get('/module/:code/video', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

// B2 - Quiz → Redirect to deliverable
moduleRoutes.get('/module/:code/quiz', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

// B3 - Inputs form → Redirect to deliverable
moduleRoutes.get('/module/:code/inputs', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

// B3b - Questions → Redirect to deliverable
moduleRoutes.get('/module/:code/questions', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

// B4 - Analysis → Redirect to deliverable
moduleRoutes.get('/module/:code/analysis', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

// B5 - Improve/Iterate → Redirect to deliverable
moduleRoutes.get('/module/:code/improve', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

// B6 - Validate → Redirect to deliverable (coach validation happens differently now)
moduleRoutes.get('/module/:code/validate', (c) => c.redirect(`/module/${c.req.param('code')}/download`))

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

    let progress = await c.env.DB.prepare(`
      SELECT id, status, ai_score, ai_last_analysis, validated_at, project_id
      FROM progress
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    // Auto-create progress if user has none for this module (allows access from entrepreneur cards)
    if (!progress) {
      await c.env.DB.prepare(`
        INSERT INTO progress (user_id, module_id, status, created_at, updated_at)
        VALUES (?, ?, 'in_progress', datetime('now'), datetime('now'))
      `).bind(payload.userId, module.id).run()
      progress = await c.env.DB.prepare(`
        SELECT id, status, ai_score, ai_last_analysis, validated_at, project_id
        FROM progress
        WHERE user_id = ? AND module_id = ?
      `).bind(payload.userId, module.id).first()
      if (!progress) return c.redirect('/dashboard')
    }

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

    // ═══ BMC Module: dedicated download page ═══
    if (moduleCode === 'mod1_bmc') {
      // Fetch BMC answers
      const bmcAnswersRes = await c.env.DB.prepare(`
        SELECT question_number, user_response FROM questions WHERE progress_id = ? ORDER BY question_number
      `).bind(progress.id).all()
      const bmcAnswers = new Map<number, string>()
      for (const row of (bmcAnswersRes.results ?? []) as any[]) {
        const r = (row.user_response ?? '').trim()
        if (r) bmcAnswers.set(Number(row.question_number), r)
      }

      // Get user & project info
      const userRow = await c.env.DB.prepare(`SELECT name FROM users WHERE id = ?`).bind(payload.userId).first()
      const userName = (userRow?.name as string) ?? 'Entrepreneur'
      let projectName = 'Business Model Canvas'

      // Get project details
      let projectSector = ''
      let projectLocation = ''
      let projectCountry = 'Côte d\'Ivoire'
      let brandName = ''
      if (progress.project_id) {
        try {
          const proj = await c.env.DB.prepare(`SELECT name, description FROM projects WHERE id = ?`).bind(progress.project_id).first()
          if (proj?.name && (proj.name as string) !== 'null') {
            projectName = proj.name as string
          }
        } catch {}
      }

      // Extract brand name and financial data from answers
      const revenueAnswer = bmcAnswers.get(5) ?? ''
      const propValeur = bmcAnswers.get(2) ?? ''
      const brandMatch = (bmcAnswers.get(6) ?? '').match(/marque\s+([A-Z][A-Z\s]+)/i) ?? (propValeur).match(/marque\s+([A-Z][A-Z\s]+)/i)
      if (brandMatch) brandName = brandMatch[1].trim()

      // Compute BMC score from AI analysis or answers
      const aiScore = progress.ai_score ? Number(progress.ai_score) : (bmcAnswers.size > 0 ? Math.min(Math.round(bmcAnswers.size / 9 * 80), 95) : 0)

      const bmcDeliverableData: BmcDeliverableData = {
        companyName: projectName,
        entrepreneurName: userName,
        sector: projectSector,
        location: projectLocation,
        country: projectCountry,
        brandName,
        tagline: '',
        analysisDate: new Date().toISOString(),
        answers: bmcAnswers
      }

      // Score label
      const bmcScoreLabel = aiScore >= 80 ? { label: 'Excellent', color: 'green' } : aiScore >= 60 ? { label: 'Bon', color: 'blue' } : aiScore >= 40 ? { label: 'À améliorer', color: 'yellow' } : { label: 'Insuffisant', color: 'red' }

      // Render BMC download page
      return c.html(
        <html lang="fr">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Livrable BMC - {projectName}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          </head>
          <body class="bg-slate-50">
            <nav class="bg-white shadow-sm border-b border-slate-200">
              <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                <a href="/entrepreneur" class="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 font-medium">
                  <i class="fas fa-arrow-left"></i>
                  <span>Retour à la page principale</span>
                </a>
                <span class="text-xs text-slate-500 flex items-center gap-2">
                  <i class="fas fa-flag-checkered"></i>
                  Module 1 · BMC
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
                      <p class="text-sm">Re-uploadez un fichier corrigé ou utilisez le chat IA pour mettre à jour.</p>
                    </div>
                  </div>
                  <a href="/entrepreneur" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
                    <i class="fas fa-sync-alt"></i>
                    Mettre à jour les données
                  </a>
                </section>
              )}

              <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-wider text-slate-500">{isValidated ? 'Livrable final' : 'Livrable brouillon'}</p>
                  <h1 class="text-3xl font-bold text-slate-900">Business Model Canvas</h1>
                  <p class="mt-2 text-slate-600">Diagnostic expert de votre modèle économique avec scoring, forces, vigilances et recommandations.</p>
                </div>
                <div class="flex items-center gap-3 flex-wrap">
                  <span class={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${bmcScoreLabel.color === 'green' ? 'bg-emerald-100 text-emerald-700' : bmcScoreLabel.color === 'blue' ? 'bg-blue-100 text-blue-700' : bmcScoreLabel.color === 'yellow' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    <i class="fas fa-chart-line"></i>
                    {aiScore}% — {bmcScoreLabel.label}
                  </span>
                  <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-700">
                    <i class="fas fa-th-large"></i>
                    {bmcAnswers.size}/9 blocs
                  </span>
                </div>
              </header>

              <section class="grid gap-4 md:grid-cols-2">
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <i class="fas fa-download text-emerald-500"></i>
                    Livrables disponibles
                  </h2>
                  <div class="space-y-3">
                    <a href="/api/bmc/deliverable?format=full" target="_blank"
                      class="flex items-center gap-3 p-3 rounded-xl border border-green-300 bg-green-50 hover:bg-green-100 transition ring-2 ring-green-200">
                      <div class="w-10 h-10 rounded-lg bg-green-600 text-white flex items-center justify-center">
                        <i class="fas fa-file-lines"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-green-900 text-sm">Livrable BMC Complet</p>
                        <p class="text-xs text-green-700">Canvas, Diagnostic, SWOT, Forces, Vigilances, Recommandations</p>
                        <span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
                          <i class="fas fa-star text-[8px]"></i> RECOMMANDÉ
                        </span>
                      </div>
                    </a>
                    <a href="/api/bmc/deliverable?format=diagnostic" target="_blank"
                      class="flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition">
                      <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-file-code"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-emerald-900 text-sm">Diagnostic Résumé</p>
                        <p class="text-xs text-emerald-700">Rapport synthétique avec scores par bloc et alertes</p>
                      </div>
                    </a>
                    <div class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <div class="w-10 h-10 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center">
                        <i class="fas fa-file-excel"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-600 text-sm">Excel BMC (9 blocs)</p>
                        <p class="text-xs text-slate-500">Prochainement disponible</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <i class="fas fa-chart-bar text-emerald-500"></i>
                    Blocs BMC renseignés
                  </h2>
                  <div class="space-y-3">
                    {[
                      { id: 1, label: 'Segments Clients', icon: '👥' },
                      { id: 2, label: 'Proposition de Valeur', icon: '💎' },
                      { id: 3, label: 'Canaux', icon: '📦' },
                      { id: 4, label: 'Relations Clients', icon: '🤝' },
                      { id: 5, label: 'Flux de Revenus', icon: '💰' },
                      { id: 6, label: 'Ressources Clés', icon: '🔧' },
                      { id: 7, label: 'Activités Clés', icon: '⚙️' },
                      { id: 8, label: 'Partenaires Clés', icon: '🤲' },
                      { id: 9, label: 'Structure de Coûts', icon: '📊' }
                    ].map((bloc) => {
                      const hasAnswer = bmcAnswers.has(bloc.id)
                      const answerLen = (bmcAnswers.get(bloc.id) ?? '').length
                      const quality = answerLen > 200 ? 100 : answerLen > 100 ? 75 : answerLen > 30 ? 50 : answerLen > 0 ? 25 : 0
                      const barColor = quality >= 75 ? '#059669' : quality >= 50 ? '#0284c7' : quality > 0 ? '#d97706' : '#e5e7eb'
                      return (
                        <div class="space-y-1" key={`bloc-${bloc.id}`}>
                          <div class="flex justify-between text-sm">
                            <span class="font-medium text-slate-700">{bloc.icon} {bloc.label}</span>
                            <span class="font-bold" style={`color:${barColor}`}>{hasAnswer ? `${quality}%` : '—'}</span>
                          </div>
                          <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full rounded-full" style={`width:${quality}%;background:${barColor}`}></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>

              {/* Full BMC Deliverable Preview */}
              <section class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="p-4 border-b border-slate-200 flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-green-600 text-white flex items-center justify-center text-sm">
                      <i class="fas fa-file-lines"></i>
                    </div>
                    <div>
                      <h2 class="text-base font-semibold text-slate-900">Aperçu du Livrable BMC Complet</h2>
                      <p class="text-xs text-slate-500">Canvas, Diagnostic Expert, SWOT, Forces, Vigilances, Plan d'action</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <a href="/api/bmc/deliverable?format=full" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition">
                      <i class="fas fa-external-link-alt"></i>
                      Ouvrir
                    </a>
                    <button onClick="window.frames['bmcFullPreview'].contentWindow.print()" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition">
                      <i class="fas fa-print"></i>
                      Imprimer / PDF
                    </button>
                  </div>
                </div>
                <iframe name="bmcFullPreview" src="/api/bmc/deliverable?format=full" style="width:100%;height:800px;border:none;" title="Livrable BMC Complet"></iframe>
              </section>

              <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                  <i class="fas fa-arrows-rotate text-indigo-500"></i>
                  Actions
                </h2>
                <div class="grid gap-4 md:grid-cols-2">
                  <a href="/entrepreneur" class="block rounded-2xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                        <i class="fas fa-sync-alt"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Mettre à jour → Page principale</p>
                        <p class="text-sm text-slate-600">Re-uploadez un fichier corrigé pour regénérer ce livrable.</p>
                      </div>
                    </div>
                  </a>
                  <a href="/entrepreneur#chat" class="block rounded-2xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-comments"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Corriger via le chat IA</p>
                        <p class="text-sm text-slate-600">Envoyez une correction et l'IA regénère automatiquement.</p>
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
    // ═══ End BMC dedicated download ═══

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
                <a href="/entrepreneur" class="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 font-medium">
                  <i class="fas fa-arrow-left"></i>
                  <span>Retour à la page principale</span>
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
                      <p class="text-sm">Re-uploadez un fichier corrigé ou utilisez le chat IA pour mettre à jour.</p>
                    </div>
                  </div>
                  <a href="/entrepreneur" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
                    <i class="fas fa-sync-alt"></i>
                    Mettre à jour les données
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
                    <a href={`/api/sic/deliverable?format=full`} target="_blank"
                      class="flex items-center gap-3 p-3 rounded-xl border border-green-300 bg-green-50 hover:bg-green-100 transition ring-2 ring-green-200">
                      <div class="w-10 h-10 rounded-lg bg-green-600 text-white flex items-center justify-center">
                        <i class="fas fa-file-lines"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-green-900 text-sm">Livrable SIC Complet</p>
                        <p class="text-xs text-green-700">SWOT, ODD, Théorie du Changement, Recommandations...</p>
                        <span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
                          <i class="fas fa-star text-[8px]"></i> RECOMMANDÉ
                        </span>
                      </div>
                    </a>
                    <a href={`/api/sic/deliverable`} target="_blank"
                      class="flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition">
                      <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-file-code"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-emerald-900 text-sm">Diagnostic Résumé</p>
                        <p class="text-xs text-emerald-700">Rapport synthétique avec scores et alertes</p>
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

              {/* Full SIC Deliverable Preview */}
              <section class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="p-4 border-b border-slate-200 flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-green-600 text-white flex items-center justify-center text-sm">
                      <i class="fas fa-file-lines"></i>
                    </div>
                    <div>
                      <h2 class="text-base font-semibold text-slate-900">Aperçu du Livrable SIC Complet</h2>
                      <p class="text-xs text-slate-500">SWOT, ODD détaillés, Théorie du Changement, Recommandations, Maturité</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <a href={`/api/sic/deliverable?format=full`} target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition">
                      <i class="fas fa-external-link-alt"></i>
                      Ouvrir
                    </a>
                    <button onClick="window.frames['sicFullPreview'].contentWindow.print()" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition">
                      <i class="fas fa-print"></i>
                      Imprimer / PDF
                    </button>
                  </div>
                </div>
                <iframe name="sicFullPreview" src={`/api/sic/deliverable?format=full`} style="width:100%;height:800px;border:none;" title="Livrable SIC Complet"></iframe>
              </section>

              <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                  <i class="fas fa-arrows-rotate text-indigo-500"></i>
                  Actions
                </h2>
                <div class="grid gap-4 md:grid-cols-2">
                  <a href="/entrepreneur" class="block rounded-2xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                        <i class="fas fa-sync-alt"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Mettre à jour → Page principale</p>
                        <p class="text-sm text-slate-600">Re-uploadez un fichier corrigé pour regénérer ce livrable.</p>
                      </div>
                    </div>
                  </a>
                  <a href="/entrepreneur#chat" class="block rounded-2xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-comments"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Corriger via le chat IA</p>
                        <p class="text-sm text-slate-600">Envoyez une correction et l'IA regénère automatiquement.</p>
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
        .bind(payload.userId, module.id).first() as any

      // Parse each financial input tab to check completion
      const inputTabs = [
        { key: 'infos_generales_json', label: 'Informations Générales', icon: '🏢' },
        { key: 'donnees_historiques_json', label: 'Données Historiques', icon: '📜' },
        { key: 'produits_services_json', label: 'Produits & Services', icon: '📦' },
        { key: 'ressources_humaines_json', label: 'Ressources Humaines', icon: '👥' },
        { key: 'hypotheses_croissance_json', label: 'Hypothèses de Croissance', icon: '📈' },
        { key: 'couts_fixes_variables_json', label: 'Coûts Fixes & Variables', icon: '💰' },
        { key: 'bfr_tresorerie_json', label: 'BFR & Trésorerie', icon: '📊' },
        { key: 'investissements_json', label: 'Investissements (CAPEX)', icon: '🏗️' },
        { key: 'financement_json', label: 'Financement & Endettement', icon: '💳' },
      ]

      let filledCount = 0
      const tabStatus: { label: string, icon: string, filled: boolean }[] = []
      for (const tab of inputTabs) {
        let filled = false
        if (fiRow && fiRow[tab.key]) {
          try {
            const parsed = JSON.parse(fiRow[tab.key])
            filled = Object.keys(parsed).length > 0
          } catch {}
        }
        if (filled) filledCount++
        tabStatus.push({ label: tab.label, icon: tab.icon, filled })
      }

      // Compute score
      let inputsAnalysis: InputsAnalysisResult | null = null
      if (fiRow && (fiRow as any).analysis_json) {
        try { inputsAnalysis = JSON.parse((fiRow as any).analysis_json) } catch {}
      }
      if (!inputsAnalysis && fiRow) {
        const FI_COLS2: Record<InputTabKey, string> = {
          infos_generales: 'infos_generales_json', donnees_historiques: 'donnees_historiques_json',
          produits_services: 'produits_services_json', ressources_humaines: 'ressources_humaines_json',
          hypotheses_croissance: 'hypotheses_croissance_json', couts_fixes_variables: 'couts_fixes_variables_json',
          bfr_tresorerie: 'bfr_tresorerie_json', investissements: 'investissements_json', financement: 'financement_json'
        }
        const allData2: Record<InputTabKey, Record<string, any>> = {} as any
        for (const tabKey of INPUT_TAB_ORDER) {
          const raw = (fiRow as any)?.[FI_COLS2[tabKey]]
          allData2[tabKey] = raw ? JSON.parse(raw) : {}
        }
        inputsAnalysis = analyzeInputs(allData2)
      }

      const readiness = inputsAnalysis?.readinessScore ?? 0
      const readinessLbl = getInputsReadinessLabel(readiness)
      const aiScore = readiness
      const inputsScoreLabel = aiScore >= 80 ? { label: 'Excellent', color: 'green' } : aiScore >= 60 ? { label: 'Bon', color: 'blue' } : aiScore >= 40 ? { label: 'À améliorer', color: 'yellow' } : { label: 'Insuffisant', color: 'red' }

      return c.html(
        <html lang="fr">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Livrable Inputs Financiers - ESONO</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          </head>
          <body class="bg-slate-50">
            <nav class="bg-white shadow-sm border-b border-slate-200">
              <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                <a href="/entrepreneur" class="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 font-medium">
                  <i class="fas fa-arrow-left"></i>
                  <span>Retour à la page principale</span>
                </a>
                <span class="text-xs text-slate-500 flex items-center gap-2">
                  <i class="fas fa-chart-bar"></i>
                  Module 3 · Inputs Financiers
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
                      <p class="text-sm">Re-uploadez un fichier corrigé ou utilisez le chat IA pour mettre à jour.</p>
                    </div>
                  </div>
                  <a href="/entrepreneur" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
                    <i class="fas fa-sync-alt"></i>
                    Mettre à jour les données
                  </a>
                </section>
              )}

              <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-wider text-slate-500">{isValidated ? 'Livrable final' : 'Livrable brouillon'}</p>
                  <h1 class="text-3xl font-bold text-slate-900">Inputs Financiers</h1>
                  <p class="mt-2 text-slate-600">Données financières validées avec alertes de cohérence et scoring de complétude.</p>
                </div>
                <div class="flex items-center gap-3 flex-wrap">
                  <span class={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${inputsScoreLabel.color === 'green' ? 'bg-emerald-100 text-emerald-700' : inputsScoreLabel.color === 'blue' ? 'bg-blue-100 text-blue-700' : inputsScoreLabel.color === 'yellow' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    <i class="fas fa-chart-line"></i>
                    {aiScore}% — {inputsScoreLabel.label}
                  </span>
                  <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-700">
                    <i class="fas fa-th-large"></i>
                    {filledCount}/9 blocs
                  </span>
                </div>
              </header>

              <section class="grid gap-4 md:grid-cols-2">
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <i class="fas fa-download text-emerald-500"></i>
                    Livrables disponibles
                  </h2>
                  <div class="space-y-3">
                    <a href="/api/inputs/diagnostic?module=mod3_inputs" target="_blank"
                      class="flex items-center gap-3 p-3 rounded-xl border border-green-300 bg-green-50 hover:bg-green-100 transition ring-2 ring-green-200">
                      <div class="w-10 h-10 rounded-lg bg-green-600 text-white flex items-center justify-center">
                        <i class="fas fa-file-lines"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-green-900 text-sm">Livrable Inputs Complet</p>
                        <p class="text-xs text-green-700">Diagnostic financier, alertes de cohérence, recommandations</p>
                        <span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
                          <i class="fas fa-star text-[8px]"></i> RECOMMANDÉ
                        </span>
                      </div>
                    </a>
                    <a href="/module/mod3_inputs/analysis" class="flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition">
                      <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-file-code"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-emerald-900 text-sm">Diagnostic Résumé</p>
                        <p class="text-xs text-emerald-700">Rapport synthétique avec scores par section et alertes</p>
                      </div>
                    </a>
                    <div class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <div class="w-10 h-10 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center">
                        <i class="fas fa-file-excel"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-600 text-sm">Excel Inputs (9 onglets)</p>
                        <p class="text-xs text-slate-500">Prochainement disponible</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <i class="fas fa-chart-bar text-emerald-500"></i>
                    Blocs Inputs renseignés
                  </h2>
                  <div class="space-y-3">
                    {tabStatus.map((tab, idx) => {
                      const quality = tab.filled ? 100 : 0
                      const barColor = tab.filled ? '#059669' : '#e5e7eb'
                      return (
                        <div class="space-y-1" key={`inp-${idx}`}>
                          <div class="flex justify-between text-sm">
                            <span class="font-medium text-slate-700">{tab.icon} {tab.label}</span>
                            <span class="font-bold" style={`color:${barColor}`}>{tab.filled ? '✓' : '—'}</span>
                          </div>
                          <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full rounded-full" style={`width:${quality}%;background:${barColor}`}></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>

              <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                  <i class="fas fa-arrows-rotate text-indigo-500"></i>
                  Actions
                </h2>
                <div class="grid gap-4 md:grid-cols-2">
                  <a href="/entrepreneur" class="block rounded-2xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                        <i class="fas fa-sync-alt"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Mettre à jour → Page principale</p>
                        <p class="text-sm text-slate-600">Re-uploadez un fichier corrigé pour regénérer ce livrable.</p>
                      </div>
                    </div>
                  </a>
                  <a href="/entrepreneur#chat" class="block rounded-2xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-comments"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Corriger via le chat IA</p>
                        <p class="text-sm text-slate-600">Envoyez une correction et l'IA regénère automatiquement.</p>
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
    // ═══ End Inputs Financiers dedicated download ═══

    // ═══ Module 4 Framework Analyse PME: dedicated download page (BMC-style layout) ═══
    if (moduleCode === 'mod4_framework') {
      // Get Module 3 inputs data
      const mod3 = await c.env.DB.prepare('SELECT id FROM modules WHERE module_code = ?')
        .bind('mod3_inputs').first<any>()

      let hasInputsData = false
      let pmeAnalysis: any = null
      let pmeInput: any = null
      let companyName = 'Mon Entreprise'

      if (mod3) {
        const inputsRow = await c.env.DB.prepare(
          'SELECT * FROM financial_inputs WHERE user_id = ? AND module_id = ?'
        ).bind(payload.userId, mod3.id).first<any>()

        if (inputsRow) {
          hasInputsData = true
          try {
            const infos = inputsRow.infos_generales_json ? JSON.parse(inputsRow.infos_generales_json) : {}
            const historiques = inputsRow.donnees_historiques_json ? JSON.parse(inputsRow.donnees_historiques_json) : {}
            const produits = inputsRow.produits_services_json ? JSON.parse(inputsRow.produits_services_json) : {}
            const rh = inputsRow.ressources_humaines_json ? JSON.parse(inputsRow.ressources_humaines_json) : {}
            const hypotheses = inputsRow.hypotheses_croissance_json ? JSON.parse(inputsRow.hypotheses_croissance_json) : {}
            const coutsData = inputsRow.couts_fixes_variables_json ? JSON.parse(inputsRow.couts_fixes_variables_json) : {}
            const bfrData = inputsRow.bfr_tresorerie_json ? JSON.parse(inputsRow.bfr_tresorerie_json) : {}
            const invData = inputsRow.investissements_json ? JSON.parse(inputsRow.investissements_json) : {}
            const finData = inputsRow.financement_json ? JSON.parse(inputsRow.financement_json) : {}

            if (progress.project_id) {
              const proj = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(progress.project_id).first<any>()
              if (proj?.name) companyName = proj.name
            }

            const acts = produits?.produits ?? produits?.activites ?? []
            const activities = Array.isArray(acts) && acts.length > 0
              ? acts.map((a: any) => ({ name: a.nom || a.name || 'Activité', isStrategic: a.strategique !== false }))
              : [{ name: 'Activité principale', isStrategic: true }]

            const parseArr3 = (key: string, fallback = [0, 0, 0]): [number, number, number] => {
              const v = (historiques as any)[key]
              if (Array.isArray(v) && v.length >= 3) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
              if (typeof v === 'number') return [0, 0, v]
              return fallback as [number, number, number]
            }
            const caByActivity: [number, number, number][] = activities.map((_: any, i: number) => parseArr3(`ca_activite_${i + 1}`, [0, 0, 0]))
            const parseArr5 = (key: string, def: number): [number, number, number, number, number] => {
              const v = (hypotheses as any)[key]
              if (Array.isArray(v) && v.length >= 5) return [Number(v[0]) || def, Number(v[1]) || def, Number(v[2]) || def, Number(v[3]) || def, Number(v[4]) || def]
              const single = Number(v) || def
              return [single, single, single, single, single]
            }
            const capexArr = parseArr5('capex', 0)

            pmeInput = {
              companyName: infos?.nom_entreprise || companyName,
              sector: infos?.secteur || infos?.secteur_activite || '',
              analysisDate: new Date().toISOString().split('T')[0],
              consultant: 'ESONO Investment Readiness',
              location: infos?.localisation || infos?.ville || '',
              country: infos?.pays || 'Côte d\'Ivoire',
              activities,
              historique: {
                caTotal: parseArr3('ca_total'), caByActivity,
                achatsMP: parseArr3('achats_mp'), sousTraitance: parseArr3('sous_traitance'),
                coutsProduction: parseArr3('couts_production'), salaires: parseArr3('salaires'),
                loyers: parseArr3('loyers'), assurances: parseArr3('assurances'),
                fraisGeneraux: parseArr3('frais_generaux'), marketing: parseArr3('marketing'),
                fraisBancaires: parseArr3('frais_bancaires'), resultatNet: parseArr3('resultat_net'),
                tresoDebut: parseArr3('treso_debut'), tresoFin: parseArr3('treso_fin'),
                dso: parseArr3('dso', [30, 30, 30]), dpo: parseArr3('dpo', [30, 30, 30]),
                stockJours: parseArr3('stock_jours', [15, 15, 15]),
                detteCT: parseArr3('dette_ct'), detteLT: parseArr3('dette_lt'),
                serviceDette: parseArr3('service_dette'), amortissements: parseArr3('amortissements'),
              },
              hypotheses: {
                croissanceCA: parseArr5('croissance_ca', 15),
                evolutionPrix: parseArr5('evolution_prix', 3),
                evolutionCoutsDirects: parseArr5('evolution_couts_directs', 3),
                inflationChargesFixes: parseArr5('inflation_charges_fixes', 3),
                evolutionMasseSalariale: parseArr5('evolution_masse_salariale', 5),
                capex: capexArr,
                amortissement: Number(invData?.duree_amortissement) || 5,
              }
            } as PmeInputData

            pmeAnalysis = analyzePme(pmeInput)
          } catch (e: any) {
            console.error('PME analysis error on download page:', e?.message || e)
          }
        }
      }

      const fwAiScore = pmeAnalysis ? Math.round(
        (pmeAnalysis.historique.margeEbitdaPct[2] > 0 ? 30 : 0) +
        (pmeAnalysis.historique.margeBrutePct[2] >= 25 ? 20 : 10) +
        (pmeAnalysis.alertes.filter((a: any) => a.type === 'danger').length === 0 ? 20 : 0) +
        (pmeAnalysis.projection.tresoCumulee[4] > 0 ? 20 : 10) +
        (pmeAnalysis.forces.length >= 3 ? 10 : 5)
      ) : 0

      const fwScoreLabel = fwAiScore >= 80 ? { label: 'Excellent', color: 'green' } : fwAiScore >= 60 ? { label: 'Bon', color: 'blue' } : fwAiScore >= 40 ? { label: 'À améliorer', color: 'yellow' } : { label: 'Insuffisant', color: 'red' }

      // Framework analysis blocks
      const fwBlocks = [
        { key: 'ratios', label: 'Ratios Clés', icon: '📊', filled: hasInputsData && pmeAnalysis?.historique?.margeBrutePct?.[2] !== undefined },
        { key: 'benchmarks', label: 'Benchmarks Sectoriels', icon: '🏢', filled: hasInputsData && pmeAnalysis?.historique?.margeEbitdaPct?.[2] !== undefined },
        { key: 'scenarios', label: 'Scénarios (Prudent/Central/Ambitieux)', icon: '📈', filled: hasInputsData && pmeAnalysis?.projection?.caProjection?.length > 0 },
        { key: 'sensibilite', label: 'Analyse de Sensibilité', icon: '🎯', filled: hasInputsData && pmeAnalysis?.alertes?.length >= 0 },
        { key: 'remboursement', label: 'Capacité de Remboursement', icon: '💳', filled: hasInputsData && pmeAnalysis?.tresorerie?.dscr?.[2] !== undefined },
        { key: 'scoring', label: 'Scoring Investment Readiness', icon: '🏆', filled: hasInputsData && fwAiScore > 0 },
        { key: 'recommandations', label: 'Recommandations', icon: '💡', filled: hasInputsData && (pmeAnalysis?.forces?.length > 0 || pmeAnalysis?.faiblesses?.length > 0) },
      ]
      const fwFilledCount = fwBlocks.filter(b => b.filled).length

      return c.html(
        <html lang="fr">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Livrable Framework Analyse - ESONO</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          </head>
          <body class="bg-slate-50">
            <nav class="bg-white shadow-sm border-b border-slate-200">
              <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                <a href="/entrepreneur" class="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 font-medium">
                  <i class="fas fa-arrow-left"></i>
                  <span>Retour à la page principale</span>
                </a>
                <span class="text-xs text-slate-500 flex items-center gap-2">
                  <i class="fas fa-chart-line"></i>
                  Module 4 · Framework d'Analyse
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
                      <p class="text-sm">Re-uploadez un fichier corrigé ou utilisez le chat IA pour mettre à jour.</p>
                    </div>
                  </div>
                  <a href="/entrepreneur" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
                    <i class="fas fa-sync-alt"></i>
                    Mettre à jour les données
                  </a>
                </section>
              )}

              <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-wider text-slate-500">{isValidated ? 'Livrable final' : 'Livrable brouillon'}</p>
                  <h1 class="text-3xl font-bold text-slate-900">Framework d'Analyse PME</h1>
                  <p class="mt-2 text-slate-600">Analyse financière complète : ratios, benchmarks, scénarios et scoring Investment Readiness.</p>
                </div>
                <div class="flex items-center gap-3 flex-wrap">
                  <span class={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${fwScoreLabel.color === 'green' ? 'bg-emerald-100 text-emerald-700' : fwScoreLabel.color === 'blue' ? 'bg-blue-100 text-blue-700' : fwScoreLabel.color === 'yellow' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    <i class="fas fa-chart-line"></i>
                    {fwAiScore}% — {fwScoreLabel.label}
                  </span>
                  <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-700">
                    <i class="fas fa-th-large"></i>
                    {fwFilledCount}/7 blocs
                  </span>
                </div>
              </header>

              <section class="grid gap-4 md:grid-cols-2">
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <i class="fas fa-download text-emerald-500"></i>
                    Livrables disponibles
                  </h2>
                  <div class="space-y-3">
                    <a href="/api/pme/framework?format=excel" target="_blank"
                      class="flex items-center gap-3 p-3 rounded-xl border border-green-300 bg-green-50 hover:bg-green-100 transition ring-2 ring-green-200">
                      <div class="w-10 h-10 rounded-lg bg-green-600 text-white flex items-center justify-center">
                        <i class="fas fa-file-excel"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-green-900 text-sm">Framework Excel Complet (8 feuilles)</p>
                        <p class="text-xs text-green-700">Historique, Marges, Coûts, Trésorerie, Projections, Scénarios, Synthèse</p>
                        <span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
                          <i class="fas fa-star text-[8px]"></i> RECOMMANDÉ
                        </span>
                      </div>
                    </a>
                    <a href="/api/pme/framework?format=html" target="_blank"
                      class="flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition">
                      <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-chart-line"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-emerald-900 text-sm">Synthèse HTML</p>
                        <p class="text-xs text-emerald-700">Aperçu visuel imprimable avec graphiques</p>
                      </div>
                    </a>
                    <div class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <div class="w-10 h-10 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center">
                        <i class="fas fa-file-pdf"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-600 text-sm">PDF Framework Complet</p>
                        <p class="text-xs text-slate-500">Prochainement disponible</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <i class="fas fa-chart-bar text-emerald-500"></i>
                    Blocs Framework renseignés
                  </h2>
                  <div class="space-y-3">
                    {fwBlocks.map((bloc, idx) => {
                      const quality = bloc.filled ? 100 : 0
                      const barColor = bloc.filled ? '#059669' : '#e5e7eb'
                      return (
                        <div class="space-y-1" key={`fw-${idx}`}>
                          <div class="flex justify-between text-sm">
                            <span class="font-medium text-slate-700">{bloc.icon} {bloc.label}</span>
                            <span class="font-bold" style={`color:${barColor}`}>{bloc.filled ? '✓' : '—'}</span>
                          </div>
                          <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full rounded-full" style={`width:${quality}%;background:${barColor}`}></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>

              {/* Framework PME Preview */}
              {hasInputsData && (
                <section class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div class="p-4 border-b border-slate-200 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded-lg bg-green-600 text-white flex items-center justify-center text-sm">
                        <i class="fas fa-chart-line"></i>
                      </div>
                      <div>
                        <h2 class="text-base font-semibold text-slate-900">Aperçu du Framework Analyse PME</h2>
                        <p class="text-xs text-slate-500">Historique, Ratios, Projections 5 ans, Scénarios, Synthèse</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <a href="/api/pme/framework?format=html" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition">
                        <i class="fas fa-external-link-alt"></i>
                        Ouvrir
                      </a>
                      <button onClick="window.frames['fwPreview'].contentWindow.print()" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition">
                        <i class="fas fa-print"></i>
                        Imprimer / PDF
                      </button>
                    </div>
                  </div>
                  <iframe name="fwPreview" src="/api/pme/framework?format=html" style="width:100%;height:800px;border:none;" title="Framework Analyse PME"></iframe>
                </section>
              )}

              <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                  <i class="fas fa-arrows-rotate text-indigo-500"></i>
                  Actions
                </h2>
                <div class="grid gap-4 md:grid-cols-2">
                  <a href="/entrepreneur" class="block rounded-2xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                        <i class="fas fa-sync-alt"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Mettre à jour → Page principale</p>
                        <p class="text-sm text-slate-600">Re-uploadez un fichier corrigé pour regénérer ce livrable.</p>
                      </div>
                    </div>
                  </a>
                  <a href="/entrepreneur#chat" class="block rounded-2xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition p-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <i class="fas fa-comments"></i>
                      </div>
                      <div>
                        <p class="font-semibold text-slate-900">Corriger via le chat IA</p>
                        <p class="text-sm text-slate-600">Envoyez une correction et l'IA regénère automatiquement.</p>
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
    // ═══ End Module 4 Framework Analyse PME ═══

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
        : 'Livrable brouillon — re-uploadez vos documents ou utilisez le chat IA pour améliorer.'
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
              <a href="/entrepreneur" class="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 font-medium">
                <i class="fas fa-arrow-left"></i>
                <span>Retour à la page principale</span>
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
                    <p class="text-sm">Re-uploadez un fichier corrigé ou utilisez le chat IA pour mettre à jour.</p>
                  </div>
                </div>
                <a
                  href="/entrepreneur"
                  class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
                >
                  <i class="fas fa-sync-alt"></i>
                  Mettre à jour les données
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
                <i class="fas fa-arrows-rotate text-indigo-500"></i>
                Actions
              </h3>
              <div class="grid gap-4 md:grid-cols-2">
                <a href="/entrepreneur" class="block rounded-2xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition p-4">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                      <i class="fas fa-sync-alt"></i>
                    </div>
                    <div>
                      <p class="font-semibold text-slate-900">Mettre à jour → Page principale</p>
                      <p class="text-sm text-slate-600">Re-uploadez un fichier corrigé pour regénérer ce livrable.</p>
                    </div>
                  </div>
                </a>
                <a href="/entrepreneur#chat" class="block rounded-2xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition p-4">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                      <i class="fas fa-comments"></i>
                    </div>
                    <div>
                      <p class="font-semibold text-slate-900">Corriger via le chat IA</p>
                      <p class="text-sm text-slate-600">Envoyez une correction et l'IA regénère automatiquement.</p>
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
