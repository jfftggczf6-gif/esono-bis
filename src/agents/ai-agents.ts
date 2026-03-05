// ═══════════════════════════════════════════════════════════════════
// ESONO AI Agents — Multi-agent Architecture for Investment Readiness
// Agents: BMC, SIC, Finance, ODD, Business Plan, Plan OVO, Diagnostic + Orchestrator
// ═══════════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────────

export type AgentCode = 'bmc_analyst' | 'sic_analyst' | 'finance_analyst' | 'diagnostic_expert' | 'odd_analyst' | 'business_plan_writer' | 'plan_ovo_analyst' | 'orchestrator'

export interface AgentPromptConfig {
  system_prompt: string
  output_schema: string
  temperature: number
  max_tokens: number
}

export interface KBContext {
  benchmarks: any[]
  fiscalParams: any[]
  funders: any[]
  criteria: any[]
  feedbackHistory: any[]
}

export interface AgentInput {
  agentCode: AgentCode
  documentTexts: Record<string, string>  // category -> extracted text
  userName: string
  userCountry?: string
  kbContext: KBContext
  previousAnalyses?: Record<string, any>  // for orchestrator
  customInstructions?: string  // from chat corrections
  timeoutMs?: number  // override default 120s timeout (e.g. 240000 for BP)
}

export interface AgentOutput {
  success: boolean
  data: any
  source: 'claude' | 'fallback'
  agentCode: AgentCode
  tokensUsed?: number
  error?: string
}

export interface OrchestrationResult {
  score_global: number
  scores_dimensions: Record<string, number>
  deliverables: Record<string, any>
  source: 'claude' | 'mixed' | 'fallback'
  agentsUsed: string[]
  errors: string[]
}

// ─── Knowledge Base Loader ──────────────────────────────────────

export async function loadKBContext(db: D1Database, userCountry?: string): Promise<KBContext> {
  const [benchmarksRes, fiscalRes, fundersRes, criteriaRes, feedbackRes] = await Promise.all([
    db.prepare('SELECT * FROM kb_benchmarks ORDER BY sector, metric').all(),
    db.prepare(
      userCountry
        ? `SELECT * FROM kb_fiscal_params WHERE country = ? OR country = 'UEMOA' OR zone = 'UEMOA' ORDER BY param_code`
        : `SELECT * FROM kb_fiscal_params WHERE zone = 'UEMOA' ORDER BY param_code`
    ).bind(...(userCountry ? [userCountry] : [])).all(),
    db.prepare('SELECT * FROM kb_funders ORDER BY name').all(),
    db.prepare('SELECT * FROM kb_evaluation_criteria ORDER BY dimension, weight DESC').all(),
    db.prepare('SELECT * FROM kb_feedback WHERE applied = 0 ORDER BY created_at DESC LIMIT 20').all(),
  ])

  return {
    benchmarks: (benchmarksRes.results || []) as any[],
    fiscalParams: (fiscalRes.results || []) as any[],
    funders: (fundersRes.results || []) as any[],
    criteria: (criteriaRes.results || []) as any[],
    feedbackHistory: (feedbackRes.results || []) as any[],
  }
}

// ─── Prompt Builder ─────────────────────────────────────────────

function formatBenchmarksForPrompt(benchmarks: any[], sector?: string): string {
  const filtered = sector
    ? benchmarks.filter(b => b.sector === sector || b.sector === 'general_pme')
    : benchmarks
  
  if (filtered.length === 0) return 'Aucun benchmark disponible.'
  
  const grouped: Record<string, any[]> = {}
  for (const b of filtered) {
    if (!grouped[b.sector]) grouped[b.sector] = []
    grouped[b.sector].push(b)
  }

  return Object.entries(grouped).map(([sector, items]) =>
    `[${sector}]\n` + items.map(b =>
      `  ${b.metric}: ${b.value_low}–${b.value_median}–${b.value_high} ${b.unit} (${b.region || 'Afrique'})`
    ).join('\n')
  ).join('\n')
}

function formatFiscalParamsForPrompt(params: any[]): string {
  if (params.length === 0) return 'Paramètres fiscaux non disponibles.'
  return params.map(p =>
    `${p.param_label} (${p.country}): ${p.value}${p.unit} — ${p.notes || ''}`
  ).join('\n')
}

function formatFundersForPrompt(funders: any[]): string {
  if (funders.length === 0) return 'Aucun bailleur enregistré.'
  return funders.map(f =>
    `${f.name} (${f.type}): ticket ${f.typical_ticket_min?.toLocaleString() || '?'}–${f.typical_ticket_max?.toLocaleString() || '?'} EUR | Instruments: ${f.instrument_types || '?'} | Secteurs: ${f.focus_sectors || '?'}`
  ).join('\n')
}

function formatCriteriaForPrompt(criteria: any[], dimension?: string): string {
  const filtered = dimension ? criteria.filter(c => c.dimension === dimension) : criteria
  if (filtered.length === 0) return 'Aucun critère disponible.'
  return filtered.map(c =>
    `[${c.criterion_code}] ${c.criterion_label} (poids: ${c.weight})\n  ${c.description}\n  Guide: ${c.scoring_guide || 'N/A'}`
  ).join('\n\n')
}

async function getAgentPrompt(db: D1Database, agentCode: AgentCode): Promise<AgentPromptConfig | null> {
  const row = await db.prepare(
    'SELECT system_prompt, output_schema, temperature, max_tokens FROM kb_agent_prompts WHERE agent_code = ? AND is_active = 1 ORDER BY version DESC LIMIT 1'
  ).bind(agentCode).first()
  
  if (!row) return null
  return {
    system_prompt: row.system_prompt as string,
    output_schema: row.output_schema as string,
    temperature: row.temperature as number,
    max_tokens: row.max_tokens as number,
  }
}

function buildPrompt(template: string, kbContext: KBContext, extraReplacements?: Record<string, string>): string {
  let prompt = template
    .replace('{{KB_BENCHMARKS}}', formatBenchmarksForPrompt(kbContext.benchmarks))
    .replace('{{KB_FISCAL_PARAMS}}', formatFiscalParamsForPrompt(kbContext.fiscalParams))
    .replace('{{KB_FUNDERS_SUMMARY}}', formatFundersForPrompt(kbContext.funders))
    .replace('{{KB_ALL_CRITERIA}}', formatCriteriaForPrompt(kbContext.criteria))
    .replace('{{KB_CRITERIA_modele_economique}}', formatCriteriaForPrompt(kbContext.criteria, 'modele_economique'))
    .replace('{{KB_CRITERIA_impact_social}}', formatCriteriaForPrompt(kbContext.criteria, 'impact_social'))
    .replace('{{KB_CRITERIA_viabilite_financiere}}', formatCriteriaForPrompt(kbContext.criteria, 'viabilite_financiere'))

  if (extraReplacements) {
    for (const [key, value] of Object.entries(extraReplacements)) {
      prompt = prompt.replace(`{{${key}}}`, value)
    }
  }

  return prompt
}

// ─── Claude API Caller ──────────────────────────────────────────

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}
): Promise<{ success: boolean; data?: any; text?: string; error?: string; tokensUsed?: number }> {
  const { temperature = 0.3, maxTokens = 4096, timeoutMs = 120000 } = options

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      const statusCode = response.status
      if (statusCode === 429 || statusCode === 529) {
        return { success: false, error: `Rate limit / overloaded (${statusCode})` }
      }
      if (statusCode === 401 || statusCode === 403) {
        return { success: false, error: `Authentication error (${statusCode}): ${errBody.slice(0, 200)}` }
      }
      return { success: false, error: `API error ${statusCode}: ${errBody.slice(0, 200)}` }
    }

    const responseData = await response.json() as any
    const text = responseData?.content?.[0]?.text || ''
    const tokensUsed = (responseData?.usage?.input_tokens || 0) + (responseData?.usage?.output_tokens || 0)

    // Extract JSON from response — try multiple strategies
    let data: any = null
    let parseError = ''
    
    // Strategy 1: Direct parse
    try {
      data = JSON.parse(text)
    } catch {
      // Strategy 2: Find outermost JSON object
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          data = JSON.parse(jsonMatch[0])
        } catch (e2: any) {
          // Strategy 3: Clean markdown code blocks
          const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
          try {
            data = JSON.parse(cleaned)
          } catch (e3: any) {
            parseError = `JSON parse failed after 3 strategies. Text length: ${text.length}. First 200 chars: ${text.slice(0, 200)}. Last 200 chars: ${text.slice(-200)}`
            console.error('callClaude JSON parse error:', parseError)
          }
        }
      } else {
        parseError = `No JSON object found in response. Text length: ${text.length}. First 300 chars: ${text.slice(0, 300)}`
        console.error('callClaude no JSON:', parseError)
      }
    }
    
    if (data) {
      return { success: true, data, text, tokensUsed }
    }
    // Return with text so runAgent can handle it
    return { success: true, text, tokensUsed, error: parseError || 'JSON parse failed' }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Timeout after ' + (options.timeoutMs || 120000) + 'ms' }
    }
    return { success: false, error: err.message || 'Unknown error' }
  }
}

// ─── Individual Agent Runners ───────────────────────────────────

export async function runAgent(
  db: D1Database,
  apiKey: string | undefined,
  input: AgentInput
): Promise<AgentOutput> {
  const { agentCode, documentTexts, userName, kbContext, previousAnalyses, customInstructions } = input

  // Load agent prompt from KB (versioned, can be updated without code changes)
  const promptConfig = await getAgentPrompt(db, agentCode)
  
  if (!promptConfig) {
    return {
      success: false,
      data: null,
      source: 'fallback',
      agentCode,
      error: `No prompt found for agent ${agentCode}`,
    }
  }

  // Build the context-enriched system prompt
  const extraReplacements: Record<string, string> = {}
  // Reduce analysis size for BP writer since it already has a large system prompt (~9KB)
  const analysisLimit = (agentCode === 'business_plan_writer') ? 2000 : 3000
  
  if (previousAnalyses) {
    if (previousAnalyses.bmc_analysis) extraReplacements['BMC_ANALYSIS'] = JSON.stringify(previousAnalyses.bmc_analysis).slice(0, analysisLimit)
    if (previousAnalyses.sic_analysis) extraReplacements['SIC_ANALYSIS'] = JSON.stringify(previousAnalyses.sic_analysis).slice(0, analysisLimit)
    if (previousAnalyses.finance_analysis) extraReplacements['FINANCE_ANALYSIS'] = JSON.stringify(previousAnalyses.finance_analysis).slice(0, analysisLimit)
    if (previousAnalyses.diagnostic) extraReplacements['DIAGNOSTIC'] = JSON.stringify(previousAnalyses.diagnostic).slice(0, analysisLimit)
    if (previousAnalyses.odd) extraReplacements['ODD_ANALYSIS'] = JSON.stringify(previousAnalyses.odd).slice(0, analysisLimit)
  }

  const systemPrompt = buildPrompt(promptConfig.system_prompt, kbContext, extraReplacements)

  // Build user message with document content
  const docParts = Object.entries(documentTexts).map(([category, text]) => {
    const preview = text.startsWith('base64:') ? `[Fichier binaire: ${category}]` : text.slice(0, 4000)
    return `=== ${category.toUpperCase()} ===\n${preview}`
  }).join('\n\n')

  let userMessage = `Entrepreneur: ${userName}${input.userCountry ? ` (${input.userCountry})` : ''}\n\nDocuments fournis:\n${docParts}`
  
  // Log prompt sizes for debugging
  console.log(`[runAgent ${agentCode}] System prompt: ${systemPrompt.length} chars, User message: ${userMessage.length} chars, Max tokens: ${promptConfig.max_tokens}, Timeout: ${input.timeoutMs || 120000}ms`)
  
  if (customInstructions) {
    userMessage += `\n\nInstructions spécifiques de l'entrepreneur:\n${customInstructions}`
  }

  userMessage += `\n\nAnalyse ces documents et génère le livrable au format JSON selon la structure définie dans les instructions système. Réponds UNIQUEMENT avec le JSON, sans texte avant ou après.`

  // Try Claude with retry for critical agents (business_plan_writer)
  if (apiKey && apiKey !== 'sk-ant-PLACEHOLDER') {
    const maxAttempts = (agentCode === 'business_plan_writer' || agentCode === 'plan_ovo_analyst') ? 2 : 1
    let lastError = ''
    let lastText = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        const delay = 5000 * attempt  // 10s backoff on retry
        console.log(`Agent ${agentCode}: Retry ${attempt}/${maxAttempts} after ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
      }

      const result = await callClaude(apiKey, systemPrompt, userMessage, {
        temperature: promptConfig.temperature,
        maxTokens: promptConfig.max_tokens,
        timeoutMs: input.timeoutMs || 120000,
      })

      if (result.success && result.data) {
        if (attempt > 1) console.log(`Agent ${agentCode}: Success on attempt ${attempt}!`)
        return {
          success: true,
          data: result.data,
          source: 'claude',
          agentCode,
          tokensUsed: result.tokensUsed,
        }
      }

      // If Claude responded but JSON parse failed, try to salvage the text
      if (result.success && result.text && !result.data) {
        console.warn(`Agent ${agentCode} attempt ${attempt}: Claude responded (${result.text.length} chars) but JSON parse failed. Error: ${result.error}`)
        lastText = result.text
        // Try one more time with aggressive cleanup
        try {
          const aggressive = result.text
            .replace(/^[\s\S]*?(?=\{)/, '')  // Remove everything before first {
            .replace(/\}[^}]*$/, '}')        // Keep up to last }
          const salvaged = JSON.parse(aggressive)
          console.log(`Agent ${agentCode}: Salvaged JSON from text on attempt ${attempt}!`)
          return { success: true, data: salvaged, source: 'claude', agentCode, tokensUsed: result.tokensUsed }
        } catch {
          console.error(`Agent ${agentCode}: Could not salvage JSON. First 500 chars:`, result.text.slice(0, 500))
        }
      }

      lastError = result.error || 'unknown'
      // Only retry on transient errors (timeout, rate limit, overload)
      const isTransient = lastError.includes('Timeout') || lastError.includes('429') || lastError.includes('529') || lastError.includes('overloaded')
      if (!isTransient && attempt < maxAttempts) {
        console.warn(`Agent ${agentCode}: Non-transient error "${lastError}", skipping retry`)
        break
      }
      console.error(`Agent ${agentCode} attempt ${attempt} error: ${lastError}`)
    }

    // After all retries failed, if we have raw text, wrap it as fallback
    if (lastText.length > 100) {
      console.warn(`Agent ${agentCode}: All attempts failed but have text (${lastText.length} chars). Using as raw fallback.`)
      return {
        success: true,
        data: { content: lastText, _raw_text_fallback: true, score: 40 },
        source: 'claude',
        agentCode,
      }
    }

    console.error(`Agent ${agentCode} Claude final error: ${lastError}`)
  }

  // Fallback: return null data, orchestrator will use buildFallbackResult
  return {
    success: false,
    data: null,
    source: 'fallback',
    agentCode,
    error: apiKey ? `Claude call failed: ${agentCode}` : 'No API key configured',
  }
}

// ─── Orchestrator — Run all agents ──────────────────────────────

export async function orchestrateGeneration(
  db: D1Database,
  apiKey: string | undefined,
  userId: number,
  userName: string,
  userCountry: string | undefined,
  documentTexts: Record<string, string>,
  uploadedCategories: Set<string>,
  customInstructions?: string
): Promise<OrchestrationResult> {
  const errors: string[] = []
  const agentsUsed: string[] = []

  // 1. Load Knowledge Base context
  let kbContext: KBContext
  try {
    kbContext = await loadKBContext(db, userCountry)
  } catch (err: any) {
    console.error('KB load error:', err.message)
    kbContext = { benchmarks: [], fiscalParams: [], funders: [], criteria: [], feedbackHistory: [] }
    errors.push('Knowledge Base unavailable, using defaults')
  }

  const hasBmc = uploadedCategories.has('bmc')
  const hasSic = uploadedCategories.has('sic')
  const hasInputs = uploadedCategories.has('inputs')

  // 2. Run specialized agents SEQUENTIALLY to avoid Claude rate limits and timeouts
  // (parallel execution caused cascading 429/timeout errors on the Anthropic API)
  type AgentThunk = () => Promise<AgentOutput>
  const agentThunks: AgentThunk[] = []
  const agentMap: string[] = []

  if (hasBmc) {
    agentThunks.push(() => runAgent(db, apiKey, {
      agentCode: 'bmc_analyst', documentTexts, userName, userCountry, kbContext, customInstructions,
    }))
    agentMap.push('bmc_analyst')
  }

  if (hasSic) {
    agentThunks.push(() => runAgent(db, apiKey, {
      agentCode: 'sic_analyst', documentTexts, userName, userCountry, kbContext, customInstructions,
    }))
    agentMap.push('sic_analyst')
  }

  if (hasInputs) {
    agentThunks.push(() => runAgent(db, apiKey, {
      agentCode: 'finance_analyst', documentTexts, userName, userCountry, kbContext, customInstructions,
    }))
    agentMap.push('finance_analyst')
  }

  // Always run ODD analyst if any docs
  if (hasBmc || hasSic || hasInputs) {
    agentThunks.push(() => runAgent(db, apiKey, {
      agentCode: 'odd_analyst', documentTexts, userName, userCountry, kbContext, customInstructions,
    }))
    agentMap.push('odd_analyst')
  }

  // Execute agents one-by-one (sequential) to prevent Claude API overload
  const agentResults: AgentOutput[] = []
  for (let i = 0; i < agentThunks.length; i++) {
    try {
      console.log(`[Orchestrator] Running agent ${agentMap[i]} (${i + 1}/${agentThunks.length})...`)
      const result = await agentThunks[i]()
      agentResults.push(result)
      console.log(`[Orchestrator] Agent ${agentMap[i]} completed (${result.source})`)
    } catch (err: any) {
      console.error(`[Orchestrator] Agent ${agentMap[i]} crashed:`, err.message)
      agentResults.push({ success: false, data: null, source: 'fallback', agentCode: agentMap[i] as AgentCode, error: err.message })
    }
  }

  // Collect results
  const analysisResults: Record<string, any> = {}
  let anyClaudeSuccess = false

  for (let i = 0; i < agentResults.length; i++) {
    const result = agentResults[i]
    const agentCode = agentMap[i]
    
    if (result.success && result.data) {
      analysisResults[agentCode] = result.data
      agentsUsed.push(`${agentCode}:${result.source}`)
      if (result.source === 'claude') anyClaudeSuccess = true
    } else {
      errors.push(`${agentCode}: ${result.error || 'failed'}`)
      agentsUsed.push(`${agentCode}:failed`)
    }
  }

  // 3. Run diagnostic expert with previous analyses
  let diagnosticResult: AgentOutput | null = null
  if (anyClaudeSuccess) {
    diagnosticResult = await runAgent(db, apiKey, {
      agentCode: 'diagnostic_expert',
      documentTexts,
      userName,
      userCountry,
      kbContext,
      previousAnalyses: {
        bmc_analysis: analysisResults['bmc_analyst'],
        sic_analysis: analysisResults['sic_analyst'],
        finance_analysis: analysisResults['finance_analyst'],
        odd: analysisResults['odd_analyst'],
      },
      customInstructions,
    })

    if (diagnosticResult.success && diagnosticResult.data) {
      analysisResults['diagnostic_expert'] = diagnosticResult.data
      agentsUsed.push(`diagnostic_expert:${diagnosticResult.source}`)
      if (diagnosticResult.source === 'claude') anyClaudeSuccess = true
    } else {
      errors.push(`diagnostic_expert: ${diagnosticResult.error || 'failed'}`)
    }
  }

  // 4. Run orchestrator for Business Plan (if we have Claude results)
  let businessPlanResult: AgentOutput | null = null
  if (anyClaudeSuccess && hasBmc && hasSic && hasInputs) {
    businessPlanResult = await runAgent(db, apiKey, {
      agentCode: 'orchestrator',
      documentTexts,
      userName,
      userCountry,
      kbContext,
      previousAnalyses: {
        bmc_analysis: analysisResults['bmc_analyst'],
        sic_analysis: analysisResults['sic_analyst'],
        finance_analysis: analysisResults['finance_analyst'],
        diagnostic: analysisResults['diagnostic_expert'],
        odd: analysisResults['odd_analyst'],
      },
      customInstructions,
    })

    if (businessPlanResult?.success && businessPlanResult.data) {
      analysisResults['orchestrator'] = businessPlanResult.data
      agentsUsed.push(`orchestrator:${businessPlanResult.source}`)
    } else {
      errors.push(`orchestrator: ${businessPlanResult?.error || 'failed'}`)
    }
  }

  // 5. Map agent results to deliverable types
  const deliverables: Record<string, any> = {}
  
  // Diagnostic
  if (analysisResults['diagnostic_expert']) {
    deliverables.diagnostic = analysisResults['diagnostic_expert']
  }
  
  // Framework (from finance analyst)
  if (analysisResults['finance_analyst']) {
    const fa = analysisResults['finance_analyst']
    deliverables.framework = {
      score: fa.score || 0,
      sections: [
        { title: 'Synthèse Exécutive', content: fa.analysis || '', score: fa.score || 0 },
        { title: 'Ratios Financiers Clés', content: JSON.stringify(fa.key_metrics || {}), score: fa.score || 0 },
        { title: 'Projections 5 ans', content: JSON.stringify(fa.projections || {}), score: fa.score || 0 },
        { title: 'Hypothèses', content: (fa.assumptions || []).join('; '), score: fa.score || 0 },
        ...(fa.financing_recommendations ? [{ title: 'Recommandations de Financement', content: fa.financing_recommendations.join('; '), score: fa.score || 0 }] : []),
      ],
    }
    deliverables.plan_ovo = {
      score: fa.score || 0,
      projections: fa.projections || {},
      key_metrics: fa.key_metrics || {},
      analysis: fa.analysis || '',
      assumptions: fa.assumptions || [],
    }
  }

  // BMC Analysis
  if (analysisResults['bmc_analyst']) {
    deliverables.bmc_analysis = analysisResults['bmc_analyst']
  }

  // SIC Analysis
  if (analysisResults['sic_analyst']) {
    deliverables.sic_analysis = analysisResults['sic_analyst']
  }

  // Business Plan (from orchestrator)
  if (analysisResults['orchestrator']) {
    deliverables.business_plan = analysisResults['orchestrator']
  }

  // ODD
  if (analysisResults['odd_analyst']) {
    deliverables.odd = analysisResults['odd_analyst']
  }

  // 6. Calculate global score
  let scoreGlobal = 0
  const scoresDimensions: Record<string, number> = {
    modele_economique: 0,
    impact_social: 0,
    viabilite_financiere: 0,
    equipe_gouvernance: 0,
    maturite_operationnelle: 0,
  }

  if (analysisResults['diagnostic_expert']) {
    const diag = analysisResults['diagnostic_expert']
    scoreGlobal = diag.score || 0
    if (diag.dimensions && Array.isArray(diag.dimensions)) {
      for (const dim of diag.dimensions) {
        const dimName = dim.name?.toLowerCase()
        if (dimName?.includes('modèle') || dimName?.includes('economique')) scoresDimensions.modele_economique = dim.score || 0
        else if (dimName?.includes('impact') || dimName?.includes('social')) scoresDimensions.impact_social = dim.score || 0
        else if (dimName?.includes('viabilit') || dimName?.includes('financ')) scoresDimensions.viabilite_financiere = dim.score || 0
        else if (dimName?.includes('équipe') || dimName?.includes('gouvern')) scoresDimensions.equipe_gouvernance = dim.score || 0
        else if (dimName?.includes('maturit') || dimName?.includes('opérat')) scoresDimensions.maturite_operationnelle = dim.score || 0
      }
    }
  } else {
    // Calculate from individual agent scores
    if (deliverables.bmc_analysis?.score) scoresDimensions.modele_economique = deliverables.bmc_analysis.score
    if (deliverables.sic_analysis?.score) scoresDimensions.impact_social = deliverables.sic_analysis.score
    if (deliverables.framework?.score) scoresDimensions.viabilite_financiere = deliverables.framework.score
    const scores = Object.values(scoresDimensions).filter(s => s > 0)
    scoreGlobal = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  }

  const source = anyClaudeSuccess ? (errors.length > 0 ? 'mixed' : 'claude') : 'fallback'

  return {
    score_global: scoreGlobal,
    scores_dimensions: scoresDimensions,
    deliverables,
    source,
    agentsUsed,
    errors,
  }
}

// ─── Save Feedback (for learning loop) ──────────────────────────

export async function saveFeedback(
  db: D1Database,
  userId: number,
  deliverableId: string,
  deliverableType: string,
  dimension: string,
  originalScore: number,
  correctedScore: number,
  expertComment: string,
  correctionType: 'score_adjustment' | 'content_improvement' | 'missing_info' | 'methodology' = 'score_adjustment'
): Promise<void> {
  await db.prepare(`
    INSERT INTO kb_feedback (user_id, deliverable_id, deliverable_type, dimension, original_score, corrected_score, expert_comment, correction_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(userId, deliverableId, deliverableType, dimension, originalScore, correctedScore, expertComment, correctionType).run()
}
