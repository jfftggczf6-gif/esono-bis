/**
 * Plan OVO (Plan Financier Final) — Routes & Types
 * 
 * Structure module for the OVO Financial Plan:
 * - POST /api/plan-ovo/generate → Generate plan from available deliverables
 * - GET  /api/plan-ovo/latest/:pmeId → Get latest plan for a PME
 * - GET  /api/plan-ovo/download/:id → Download filled Excel
 * - GET  /module/plan-ovo → Frontend page
 * 
 * Template: 251022-PlanFinancierOVO-Template5Ans-v0210-EMPTY.xlsm
 * 
 * Sheets:
 *   1. ReadMe — Admin info
 *   2. Instructions — How to fill
 *   3. InputsData — Company inputs (TableInputsData C3:K503)
 *   4. RevenueData — Revenue projections (TableRevenueData C7:AS1268)
 *   5. RevenuePivot — Pivot tables for revenue
 *   6. RevenueChart — Revenue charts
 *   7. FinanceData — Financial statements (TableFinanceData C3:AH839)
 *   8. FinancePivot — Pivot tables for finance
 *   9. FinanceChart — Financial charts
 *  10. FinanceEUR — Euro conversion
 */

import { Hono } from 'hono'

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface PlanOvoGenerateRequest {
  pmeId?: string
}

export interface PlanOvoAnalysis {
  id: string
  pme_id: string
  user_id: number
  version: number
  extraction_json: any | null
  analysis_json: any | null
  filled_excel_base64: string | null
  score: number | null
  status: 'pending' | 'generating' | 'generated' | 'error'
  source: string
  pays: string | null
  created_at: string
  updated_at: string
}

/** Template sheet structure — for future Excel filling */
export const PLAN_OVO_TEMPLATE = {
  filename: 'plan_ovo_template.xlsm',
  sheets: {
    ReadMe: { index: 1, table: null },
    Instructions: { index: 2, table: 'TableInstructions' },
    InputsData: { index: 3, table: 'TableInputsData', range: 'C3:K503' },
    RevenueData: { index: 4, table: 'TableRevenueData', range: 'C7:AS1268' },
    RevenuePivot: { index: 5, table: null },
    RevenueChart: { index: 6, table: null },
    FinanceData: { index: 7, table: 'TableFinanceData', range: 'C3:AH839' },
    FinancePivot: { index: 8, table: null },
    FinanceChart: { index: 9, table: null },
    FinanceEUR: { index: 10, table: null },
  },
  inputsDataColumns: ['ITEM', 'SECTION', 'ITEM_EN', 'ITEM_FR', 'ITEM_NL', 'DESCRIPTION1', 'DESCRIPTION2', 'VALUE', 'OTHER'],
  revenueDataColumns: ['SORT', 'FILTER', 'REF', 'REFERENCE YEAR', 'YEAR', 'TYPE PRODUCT / SERVICE', 'REFERENCE PRODUCT / SERVICE', 'PRODUCT / SERVICE', 'ITEM'],
  financeDataSections: [
    'DEPENSES OPERATIONNELLES',
    'SALAIRES DE PERSONNEL',
    'IMPOTS ET TAXES SUR PERSONNEL',
    'COUTS DE L\'OFFICE',
    'AUTRES CHARGES',
    'REVENUS',
    'INVESTISSEMENTS',
    'FINANCEMENT',
  ],
  currencies: ['CFA', 'EUR'],
}

// ═══════════════════════════════════════════
// Route factory
// ═══════════════════════════════════════════

type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY?: string
}

export function createPlanOvoRoutes(verifyToken: (token: string) => Promise<any>, getAuthToken: (c: any) => string | null) {
  const planOvo = new Hono<{ Bindings: Bindings }>()

  // ─── POST /api/plan-ovo/generate ───
  planOvo.post('/api/plan-ovo/generate', async (c) => {
    try {
      const token = getAuthToken(c)
      if (!token) return c.json({ error: 'Non authentifié' }, 401)
      const payload = await verifyToken(token)
      if (!payload) return c.json({ error: 'Token invalide' }, 401)

      const db = c.env.DB
      const userId = payload.userId
      const pmeId = String(userId) // PME = user in our system

      // 1. Check if Framework is available (OBLIGATOIRE)
      const framework = await db.prepare(`
        SELECT id, content, score FROM entrepreneur_deliverables
        WHERE user_id = ? AND type = 'framework'
        ORDER BY version DESC LIMIT 1
      `).bind(userId).first() as any

      if (!framework) {
        return c.json({
          success: false,
          error: 'Le Framework d\'analyse financière est requis pour générer le Plan OVO.',
          missing: ['framework'],
          message: 'Veuillez d\'abord générer le Framework d\'analyse PME.'
        }, 400)
      }

      // 2. Gather all available deliverables
      const [bmcRow, sicRow, diagRow] = await Promise.all([
        db.prepare("SELECT content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY version DESC LIMIT 1").bind(userId).first(),
        db.prepare("SELECT analysis_json, score FROM sic_analyses WHERE user_id = ? AND analysis_json IS NOT NULL ORDER BY created_at DESC LIMIT 1").bind(userId).first(),
        db.prepare("SELECT content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'diagnostic' ORDER BY version DESC LIMIT 1").bind(userId).first(),
      ]) as any[]

      // Parse deliverables
      let frameworkData: any = {}
      let bmcData: any = null
      let sicData: any = null
      let diagData: any = null

      try { frameworkData = JSON.parse(framework.content || '{}') } catch { /* ignore */ }
      if (bmcRow?.content) try { bmcData = JSON.parse(bmcRow.content) } catch { /* ignore */ }
      if (sicRow?.analysis_json) try { sicData = JSON.parse(sicRow.analysis_json) } catch { /* ignore */ }
      if (diagRow?.content) try { diagData = JSON.parse(diagRow.content) } catch { /* ignore */ }

      // 3. Create plan_ovo_analyses record with status=pending
      const planId = crypto.randomUUID()
      const extractionJson = JSON.stringify({
        framework: { available: true, score: framework.score, data: frameworkData },
        bmc: { available: !!bmcData, score: bmcRow?.score || null, data: bmcData },
        sic: { available: !!sicData, score: sicRow?.score || null, data: sicData },
        diagnostic: { available: !!diagData, score: diagRow?.score || null, data: diagData },
        collected_at: new Date().toISOString(),
      })

      // Get country from user/project
      const project = await db.prepare(
        'SELECT name FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
      ).bind(userId).first() as any

      await db.prepare(`
        INSERT INTO plan_ovo_analyses (id, pme_id, user_id, version, extraction_json, status, pays, source, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, 'pending', ?, 'system', datetime('now'), datetime('now'))
      `).bind(planId, pmeId, userId, extractionJson, "Côte d'Ivoire").run()

      console.log(`[Plan OVO] Created plan ${planId} for user ${userId}, framework=${!!frameworkData}, bmc=${!!bmcData}, sic=${!!sicData}, diag=${!!diagData}`)

      return c.json({
        success: true,
        message: 'Plan OVO créé. L\'agent IA de remplissage sera implémenté prochainement.',
        planId,
        status: 'pending',
        sources: {
          framework: true,
          bmc: !!bmcData,
          sic: !!sicData,
          diagnostic: !!diagData,
        },
        projectName: project?.name || null,
      })

    } catch (error: any) {
      console.error('[Plan OVO] Generate error:', error)
      return c.json({ error: 'Erreur serveur', details: error.message }, 500)
    }
  })

  // ─── GET /api/plan-ovo/latest/:pmeId ───
  planOvo.get('/api/plan-ovo/latest/:pmeId', async (c) => {
    try {
      const token = getAuthToken(c)
      if (!token) return c.json({ error: 'Non authentifié' }, 401)
      const payload = await verifyToken(token)
      if (!payload) return c.json({ error: 'Token invalide' }, 401)

      const pmeId = c.req.param('pmeId')
      const db = c.env.DB

      const plan = await db.prepare(`
        SELECT id, pme_id, version, extraction_json, analysis_json, score, status, source, pays, created_at, updated_at
        FROM plan_ovo_analyses
        WHERE pme_id = ? AND user_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).bind(pmeId, payload.userId).first() as any

      if (!plan) {
        return c.json({ available: false, message: 'Aucun Plan OVO trouvé pour cette PME' })
      }

      let extractionData: any = null
      let analysisData: any = null
      try { if (plan.extraction_json) extractionData = JSON.parse(plan.extraction_json) } catch { /* ignore */ }
      try { if (plan.analysis_json) analysisData = JSON.parse(plan.analysis_json) } catch { /* ignore */ }

      return c.json({
        available: true,
        data: {
          id: plan.id,
          pme_id: plan.pme_id,
          version: plan.version,
          score: plan.score,
          status: plan.status,
          source: plan.source,
          pays: plan.pays,
          extraction: extractionData,
          analysis: analysisData,
          has_excel: !!plan.filled_excel_base64,
          created_at: plan.created_at,
          updated_at: plan.updated_at,
        }
      })

    } catch (error: any) {
      console.error('[Plan OVO] Latest error:', error)
      return c.json({ error: 'Erreur serveur' }, 500)
    }
  })

  // ─── GET /api/plan-ovo/download/:id ───
  planOvo.get('/api/plan-ovo/download/:id', async (c) => {
    try {
      const token = getAuthToken(c)
      if (!token) return c.json({ error: 'Non authentifié' }, 401)
      const payload = await verifyToken(token)
      if (!payload) return c.json({ error: 'Token invalide' }, 401)

      const planId = c.req.param('id')
      const format = c.req.query('format') || 'xlsx'
      const db = c.env.DB

      const plan = await db.prepare(`
        SELECT id, filled_excel_base64, status, pme_id
        FROM plan_ovo_analyses
        WHERE id = ? AND user_id = ?
      `).bind(planId, payload.userId).first() as any

      if (!plan) {
        return c.json({ error: 'Plan OVO non trouvé' }, 404)
      }

      if (!plan.filled_excel_base64) {
        return c.json({
          error: 'Le fichier Excel n\'est pas encore disponible.',
          message: 'L\'agent IA de remplissage sera implémenté prochainement. Le template vide peut être téléchargé depuis /templates/plan_ovo_template.xlsm',
          status: plan.status
        }, 404)
      }

      // Decode base64 and return as file
      const bytes = Uint8Array.from(atob(plan.filled_excel_base64), ch => ch.charCodeAt(0))
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const fileName = `Plan_OVO_PME${plan.pme_id}_${date}.xlsx`

      return new Response(bytes, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': String(bytes.length),
        }
      })

    } catch (error: any) {
      console.error('[Plan OVO] Download error:', error)
      return c.json({ error: 'Erreur serveur' }, 500)
    }
  })

  // ─── GET /api/plan-ovo/template ─── (serve the empty template)
  planOvo.get('/api/plan-ovo/template', async (c) => {
    return c.json({
      message: 'Le template Plan OVO est disponible.',
      filename: PLAN_OVO_TEMPLATE.filename,
      sheets: Object.keys(PLAN_OVO_TEMPLATE.sheets),
      note: 'Le téléchargement du template brut nécessite un accès fichier. Utilisez le endpoint /api/plan-ovo/download/:id après génération.'
    })
  })

  return planOvo
}
