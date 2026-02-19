// ═══════════════════════════════════════════════════════════════════
// Knowledge Base API Routes — CRUD for enriching the KB
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken } from '../auth'

type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY?: string
}

export const kbRoutes = new Hono<{ Bindings: Bindings }>()

// ─── Auth middleware ─────────────────────────────────────────────
const requireAuth = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.json({ error: 'Non authentifié' }, 401)
  const payload = await verifyToken(token)
  if (!payload) return c.json({ error: 'Token invalide' }, 401)
  c.set('userId', payload.userId)
  c.set('userType', payload.userType)
  await next()
}

kbRoutes.use('/api/kb/*', requireAuth)

// ═══════════════════════════════════════════════════════════════════
// SOURCES
// ═══════════════════════════════════════════════════════════════════

kbRoutes.get('/api/kb/sources', async (c) => {
  const category = c.req.query('category')
  const region = c.req.query('region')
  
  let query = 'SELECT * FROM kb_sources WHERE 1=1'
  const bindings: any[] = []

  if (category) { query += ' AND category = ?'; bindings.push(category) }
  if (region) { query += ' AND region = ?'; bindings.push(region) }
  query += ' ORDER BY relevance_score DESC, name'

  const result = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json({ sources: result.results || [] })
})

kbRoutes.post('/api/kb/sources', async (c) => {
  const body = await c.req.json()
  const { category, name, description, url, data_json, region, relevance_score } = body

  if (!category || !name) return c.json({ error: 'category et name requis' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO kb_sources (category, name, description, url, data_json, region, relevance_score, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(category, name, description || null, url || null, data_json ? JSON.stringify(data_json) : null, region || null, relevance_score || 50).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

kbRoutes.put('/api/kb/sources/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const fields: string[] = []
  const values: any[] = []

  for (const [key, value] of Object.entries(body)) {
    if (['category', 'name', 'description', 'url', 'data_json', 'region', 'relevance_score'].includes(key)) {
      fields.push(`${key} = ?`)
      values.push(key === 'data_json' && value ? JSON.stringify(value) : value)
    }
  }

  if (fields.length === 0) return c.json({ error: 'Aucun champ à mettre à jour' }, 400)

  fields.push("updated_at = datetime('now')")
  values.push(id)

  await c.env.DB.prepare(`UPDATE kb_sources SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

kbRoutes.delete('/api/kb/sources/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM kb_sources WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ═══════════════════════════════════════════════════════════════════
// FUNDERS
// ═══════════════════════════════════════════════════════════════════

kbRoutes.get('/api/kb/funders', async (c) => {
  const type = c.req.query('type')
  const region = c.req.query('region')

  let query = 'SELECT * FROM kb_funders WHERE 1=1'
  const bindings: any[] = []

  if (type) { query += ' AND type = ?'; bindings.push(type) }
  if (region) { query += ' AND region = ?'; bindings.push(region) }
  query += ' ORDER BY name'

  const result = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json({ funders: result.results || [] })
})

kbRoutes.post('/api/kb/funders', async (c) => {
  const body = await c.req.json()
  const { code, name, full_name, type, country, region, website, annual_report_url,
    focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max,
    instrument_types, success_rate, avg_processing_months, notes } = body

  if (!code || !name) return c.json({ error: 'code et name requis' }, 400)

  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO kb_funders (code, name, full_name, type, country, region, website, annual_report_url,
      focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max,
      instrument_types, success_rate, avg_processing_months, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    code, name, full_name || null, type || null, country || null, region || null,
    website || null, annual_report_url || null,
    focus_sectors ? JSON.stringify(focus_sectors) : null,
    eligibility_criteria ? JSON.stringify(eligibility_criteria) : null,
    typical_ticket_min || null, typical_ticket_max || null,
    instrument_types ? JSON.stringify(instrument_types) : null,
    success_rate || null, avg_processing_months || null, notes || null
  ).run()

  return c.json({ success: true })
})

// ═══════════════════════════════════════════════════════════════════
// BENCHMARKS
// ═══════════════════════════════════════════════════════════════════

kbRoutes.get('/api/kb/benchmarks', async (c) => {
  const sector = c.req.query('sector')
  const metric = c.req.query('metric')

  let query = 'SELECT * FROM kb_benchmarks WHERE 1=1'
  const bindings: any[] = []

  if (sector) { query += ' AND sector = ?'; bindings.push(sector) }
  if (metric) { query += ' AND metric = ?'; bindings.push(metric) }
  query += ' ORDER BY sector, metric'

  const result = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json({ benchmarks: result.results || [] })
})

kbRoutes.post('/api/kb/benchmarks', async (c) => {
  const body = await c.req.json()
  const { sector, metric, region, value_low, value_median, value_high, unit, year, notes } = body

  if (!sector || !metric) return c.json({ error: 'sector et metric requis' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(sector, metric, region || null, value_low || null, value_median || null, value_high || null, unit || null, year || null, notes || null).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// ═══════════════════════════════════════════════════════════════════
// FISCAL PARAMS
// ═══════════════════════════════════════════════════════════════════

kbRoutes.get('/api/kb/fiscal-params', async (c) => {
  const country = c.req.query('country')
  const zone = c.req.query('zone')

  let query = 'SELECT * FROM kb_fiscal_params WHERE 1=1'
  const bindings: any[] = []

  if (country) { query += ' AND country = ?'; bindings.push(country) }
  if (zone) { query += ' AND zone = ?'; bindings.push(zone) }
  query += ' ORDER BY country, param_code'

  const result = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json({ fiscalParams: result.results || [] })
})

kbRoutes.post('/api/kb/fiscal-params', async (c) => {
  const body = await c.req.json()
  const { country, zone, param_code, param_label, value, unit, effective_date, notes } = body

  if (!country || !param_code || !param_label || value === undefined) {
    return c.json({ error: 'country, param_code, param_label et value requis' }, 400)
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(country, zone || null, param_code, param_label, value, unit || null, effective_date || null, notes || null).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// ═══════════════════════════════════════════════════════════════════
// EVALUATION CRITERIA
// ═══════════════════════════════════════════════════════════════════

kbRoutes.get('/api/kb/criteria', async (c) => {
  const dimension = c.req.query('dimension')

  let query = 'SELECT * FROM kb_evaluation_criteria WHERE 1=1'
  const bindings: any[] = []

  if (dimension) { query += ' AND dimension = ?'; bindings.push(dimension) }
  query += ' ORDER BY dimension, weight DESC'

  const result = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json({ criteria: result.results || [] })
})

kbRoutes.post('/api/kb/criteria', async (c) => {
  const body = await c.req.json()
  const { dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents } = body

  if (!dimension || !criterion_code || !criterion_label) {
    return c.json({ error: 'dimension, criterion_code et criterion_label requis' }, 400)
  }

  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    dimension, criterion_code, criterion_label, description || null,
    weight || 1.0,
    scoring_guide ? JSON.stringify(scoring_guide) : null,
    required_documents ? JSON.stringify(required_documents) : null
  ).run()

  return c.json({ success: true })
})

// ═══════════════════════════════════════════════════════════════════
// AGENT PROMPTS (versioned)
// ═══════════════════════════════════════════════════════════════════

kbRoutes.get('/api/kb/agent-prompts', async (c) => {
  const agentCode = c.req.query('agent_code')
  const activeOnly = c.req.query('active_only') !== 'false'

  let query = 'SELECT * FROM kb_agent_prompts WHERE 1=1'
  const bindings: any[] = []

  if (agentCode) { query += ' AND agent_code = ?'; bindings.push(agentCode) }
  if (activeOnly) { query += ' AND is_active = 1' }
  query += ' ORDER BY agent_code, version DESC'

  const result = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json({ prompts: result.results || [] })
})

kbRoutes.post('/api/kb/agent-prompts', async (c) => {
  const body = await c.req.json()
  const { agent_code, system_prompt, output_schema, temperature, max_tokens, performance_notes } = body

  if (!agent_code || !system_prompt) return c.json({ error: 'agent_code et system_prompt requis' }, 400)

  // Get next version
  const lastVersion = await c.env.DB.prepare(
    'SELECT MAX(version) as maxV FROM kb_agent_prompts WHERE agent_code = ?'
  ).bind(agent_code).first()
  const newVersion = ((lastVersion?.maxV as number) || 0) + 1

  // Deactivate previous versions
  await c.env.DB.prepare(
    'UPDATE kb_agent_prompts SET is_active = 0 WHERE agent_code = ?'
  ).bind(agent_code).run()

  // Insert new version
  const result = await c.env.DB.prepare(`
    INSERT INTO kb_agent_prompts (agent_code, version, system_prompt, output_schema, temperature, max_tokens, is_active, performance_notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
  `).bind(
    agent_code, newVersion, system_prompt,
    output_schema ? JSON.stringify(output_schema) : null,
    temperature || 0.3, max_tokens || 4096, performance_notes || null
  ).run()

  return c.json({ success: true, version: newVersion, id: result.meta.last_row_id })
})

// ═══════════════════════════════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════════════════════════════

kbRoutes.get('/api/kb/feedback', async (c) => {
  const deliverableType = c.req.query('deliverable_type')
  const applied = c.req.query('applied')

  let query = 'SELECT * FROM kb_feedback WHERE 1=1'
  const bindings: any[] = []

  if (deliverableType) { query += ' AND deliverable_type = ?'; bindings.push(deliverableType) }
  if (applied !== undefined) { query += ' AND applied = ?'; bindings.push(applied === 'true' ? 1 : 0) }
  query += ' ORDER BY created_at DESC LIMIT 50'

  const result = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json({ feedback: result.results || [] })
})

kbRoutes.post('/api/kb/feedback', async (c) => {
  const userId = c.get('userId') as number
  const body = await c.req.json()
  const { deliverable_id, deliverable_type, dimension, original_score, corrected_score, expert_comment, correction_type } = body

  if (!deliverable_type || !expert_comment) {
    return c.json({ error: 'deliverable_type et expert_comment requis' }, 400)
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO kb_feedback (user_id, deliverable_id, deliverable_type, dimension, original_score, corrected_score, expert_comment, correction_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    userId, deliverable_id || null, deliverable_type, dimension || null,
    original_score || null, corrected_score || null, expert_comment,
    correction_type || 'content_improvement'
  ).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// ═══════════════════════════════════════════════════════════════════
// KB SUMMARY (overview for admin dashboard)
// ═══════════════════════════════════════════════════════════════════

kbRoutes.get('/api/kb/summary', async (c) => {
  const [sources, funders, benchmarks, criteria, params, prompts, feedback] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM kb_sources').first(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM kb_funders').first(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM kb_benchmarks').first(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM kb_evaluation_criteria').first(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM kb_fiscal_params').first(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM kb_agent_prompts WHERE is_active = 1').first(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM kb_feedback WHERE applied = 0').first(),
  ])

  return c.json({
    knowledge_base: {
      sources: (sources?.cnt as number) || 0,
      funders: (funders?.cnt as number) || 0,
      benchmarks: (benchmarks?.cnt as number) || 0,
      criteria: (criteria?.cnt as number) || 0,
      fiscal_params: (params?.cnt as number) || 0,
      active_agent_prompts: (prompts?.cnt as number) || 0,
      pending_feedback: (feedback?.cnt as number) || 0,
    }
  })
})
