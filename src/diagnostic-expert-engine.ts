// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC EXPERT ENGINE — Module 5
// Croise BMC + SIC + Framework PME + Inputs pour produire
// un diagnostic d'investissabilité complet :
//   Score global /100, 5 dimensions, forces, faiblesses,
//   risques critiques, plan d'action, bailleurs recommandés,
//   scoring radar, verdicts par dimension
// AI: Claude enrichit le diagnostic contextuel
// Fallback: moteur déterministe si Claude indisponible
// ═══════════════════════════════════════════════════════════════

// ─── Types ───

export interface DiagnosticInputData {
  companyName: string
  entrepreneurName: string
  country: string
  sector: string
  analysisDate: string
  // Sources from other modules
  bmcAnalysis?: any      // JSON from bmc_analysis deliverable
  sicAnalysis?: any      // JSON from sic_analysis deliverable
  frameworkPmeData?: any // JSON from framework_pme_data deliverable
  frameworkHtml?: string // Raw HTML from framework_html deliverable
  frameworkAnalysis?: any // JSON from framework deliverable
  inputsData?: any       // Raw inputs data
  // API key for Claude
  apiKey?: string
  // Knowledge base
  kbContext?: {
    benchmarks: string
    fiscalParams: string
    funders: string
    criteria: string
    feedback: string
  }
}

interface DimensionScore {
  name: string
  code: string
  score: number
  verdict: string
  color: string
  strengths: string[]
  weaknesses: string[]
  recommendations: string[]
  analysis: string
}

interface RiskItem {
  level: 'critique' | 'haute' | 'moyenne' | 'faible'
  title: string
  description: string
  impact: string
  mitigation: string
  probability: string
}

interface FunderRecommendation {
  name: string
  type: string
  range: string
  conditions: string
  adequation: string
  score: number
}

interface ActionItem {
  priority: number
  horizon: string
  title: string
  description: string
  impact: string
  cost: string
  kpi: string
}

export interface DiagnosticResult {
  scoreGlobal: number
  verdict: string
  verdictColor: string
  dimensions: DimensionScore[]
  strengths: string[]
  weaknesses: string[]
  risks: RiskItem[]
  actionPlan: ActionItem[]
  funders: FunderRecommendation[]
  executiveSummary: string
  financialSnapshot: {
    ca: string
    margebrute: string
    ebitda: string
    ebitdaMargin: string
    bfr: string
    tresorerie: string
    capexNeeded: string
  }
  coherenceScore: number
  coherenceIssues: string[]
  alerts: string[]
  aiSource: string
}

// ─── Helpers ───

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmt(n: number): string {
  if (isNaN(n) || n === 0) return '—'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + ' Md'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + ' M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + ' k'
  return n.toFixed(0)
}

function getScoreColor(score: number): string {
  if (score >= 75) return '#059669'
  if (score >= 60) return '#2563eb'
  if (score >= 40) return '#d97706'
  return '#dc2626'
}

function getScoreLabel(score: number): string {
  if (score >= 75) return 'EXCELLENT'
  if (score >= 60) return 'BON'
  if (score >= 40) return 'À AMÉLIORER'
  return 'INSUFFISANT'
}

function getLevelColor(level: string): string {
  switch (level) {
    case 'critique': return '#dc2626'
    case 'haute': return '#ea580c'
    case 'moyenne': return '#d97706'
    case 'faible': return '#059669'
    default: return '#6b7280'
  }
}

// ═══════════════════════════════════════════════════════════════
// 1) DETERMINISTIC ANALYSIS — No AI required
// ═══════════════════════════════════════════════════════════════

function analyzeDeterministic(data: DiagnosticInputData): DiagnosticResult {
  const bmc = data.bmcAnalysis || {}
  const sic = data.sicAnalysis || {}
  const fw = data.frameworkAnalysis || {}
  const pme = data.frameworkPmeData || {}

  // ── Extract key metrics from framework_pme_data ──
  const hist = pme.historique || {}
  const caArray = hist.caTotal || []
  const currentCA = caArray[caArray.length - 1] || 0
  const charges = pme.charges || {}
  const chargesFixes = charges.totalChargesFixes || 0
  const masseSalariale = charges.masseSalariale || 0
  const hyp = pme.hypotheses || {}
  const croissance = hyp.croissanceCA || []

  // Compute margins from pme data
  const coutDirects = (hist.coutMatieres || [])[caArray.length - 1] || 0
  const margebrute = currentCA > 0 ? ((currentCA - coutDirects) / currentCA * 100) : 0
  const ebitda = currentCA - coutDirects - chargesFixes
  const ebitdaMargin = currentCA > 0 ? (ebitda / currentCA * 100) : 0
  const fixedCostRatio = currentCA > 0 ? (chargesFixes / currentCA * 100) : 0
  const salaryRatio = currentCA > 0 ? (masseSalariale / currentCA * 100) : 0
  const bfrRatio = pme.bfr?.bfrJoursCA || 0

  // ── Dimension 1: Modèle Économique (from BMC) ──
  const bmcScore = bmc.score || 0
  const bmcBlocks = bmc.blocks || []
  const hasBmc = bmcBlocks.length > 0

  let dimModele: DimensionScore = {
    name: 'Modèle Économique',
    code: 'modele_economique',
    score: hasBmc ? bmcScore : 15,
    verdict: '',
    color: '',
    strengths: [],
    weaknesses: [],
    recommendations: [],
    analysis: ''
  }

  if (hasBmc) {
    const strongBlocks = bmcBlocks.filter((b: any) => (b.score || 0) >= 60)
    const weakBlocks = bmcBlocks.filter((b: any) => (b.score || 0) < 40)
    dimModele.strengths = strongBlocks.slice(0, 3).map((b: any) => `${b.name}: ${b.score}/100 — solide`)
    dimModele.weaknesses = weakBlocks.slice(0, 3).map((b: any) => `${b.name}: ${b.score}/100 — à renforcer`)
    dimModele.analysis = `BMC évalué à ${bmcScore}/100. ${strongBlocks.length} blocs solides (≥60), ${weakBlocks.length} blocs faibles (<40). ${bmcBlocks.length} blocs remplis sur 9.`
    dimModele.recommendations = weakBlocks.length > 0
      ? [`Renforcer les blocs faibles : ${weakBlocks.map((b: any) => b.name).join(', ')}`]
      : ['Affiner la quantification des segments clients et canaux de distribution']
  } else {
    dimModele.analysis = 'BMC non fourni. Le modèle économique ne peut pas être évalué. Document fondamental requis.'
    dimModele.weaknesses = ['BMC non fourni — modèle économique non évaluable']
    dimModele.recommendations = ['Fournir le Business Model Canvas avec les 9 blocs complétés']
  }
  dimModele.verdict = getScoreLabel(dimModele.score)
  dimModele.color = getScoreColor(dimModele.score)

  // ── Dimension 2: Impact Social (from SIC) ──
  const sicScore = sic.score || 0
  const hasSic = !!sic.score
  const sicSections = sic.sections || sic.blocks || []

  let dimImpact: DimensionScore = {
    name: 'Impact Social & ODD',
    code: 'impact_social',
    score: hasSic ? sicScore : 10,
    verdict: '',
    color: '',
    strengths: [],
    weaknesses: [],
    recommendations: [],
    analysis: ''
  }

  if (hasSic) {
    dimImpact.analysis = `SIC évalué à ${sicScore}/100. ${sicSections.length} sections analysées. Alignement ODD identifié.`
    dimImpact.strengths = sicScore >= 50 ? ['Stratégie d\'impact social formalisée', 'Alignement ODD documenté'] : ['Conscience d\'impact social présente']
    dimImpact.weaknesses = sicScore < 60 ? ['Indicateurs d\'impact quantitatifs insuffisants', 'Théorie du changement à formaliser'] : []
    dimImpact.recommendations = ['Quantifier les indicateurs d\'impact avec des cibles annuelles']
  } else {
    dimImpact.analysis = 'SIC non fourni. Impact social non mesurable. Les investisseurs à impact requièrent ces données.'
    dimImpact.weaknesses = ['SIC absent — impact social non mesurable']
    dimImpact.recommendations = ['Remplir le Social Impact Canvas avec les 15 sections']
  }
  dimImpact.verdict = getScoreLabel(dimImpact.score)
  dimImpact.color = getScoreColor(dimImpact.score)

  // ── Dimension 3: Viabilité Financière (from Framework) ──
  const hasFinance = currentCA > 0
  let finScore = 15
  if (hasFinance) {
    let s = 30
    if (margebrute >= 40) s += 15; else if (margebrute >= 25) s += 8
    if (ebitdaMargin > 0) s += 15; else if (ebitdaMargin > -15) s += 5
    if (fixedCostRatio < 60) s += 10; else if (fixedCostRatio < 80) s += 5
    if (salaryRatio < 40) s += 10; else if (salaryRatio < 55) s += 5
    if (bfrRatio < 30) s += 5
    finScore = Math.min(s, 95)
  }

  let dimFinance: DimensionScore = {
    name: 'Viabilité Financière',
    code: 'viabilite_financiere',
    score: finScore,
    verdict: '',
    color: '',
    strengths: [],
    weaknesses: [],
    recommendations: [],
    analysis: ''
  }

  if (hasFinance) {
    dimFinance.analysis = `CA: ${fmt(currentCA)} FCFA. Marge brute: ${margebrute.toFixed(1)}%. EBITDA: ${fmt(ebitda)} FCFA (${ebitdaMargin.toFixed(1)}%). Charges fixes/CA: ${fixedCostRatio.toFixed(1)}%. Masse salariale/CA: ${salaryRatio.toFixed(1)}%.`
    if (margebrute >= 40) dimFinance.strengths.push(`Marge brute solide: ${margebrute.toFixed(1)}%`)
    if (ebitdaMargin > 10) dimFinance.strengths.push(`EBITDA positif: ${ebitdaMargin.toFixed(1)}%`)
    if (ebitdaMargin <= 0) dimFinance.weaknesses.push(`EBITDA négatif: ${ebitdaMargin.toFixed(1)}% — l'entreprise perd de l'argent`)
    if (fixedCostRatio > 60) dimFinance.weaknesses.push(`Charges fixes excessives: ${fixedCostRatio.toFixed(1)}% du CA (benchmark <60%)`)
    if (salaryRatio > 40) dimFinance.weaknesses.push(`Masse salariale trop élevée: ${salaryRatio.toFixed(1)}% du CA (benchmark 30-40%)`)
    if (ebitdaMargin <= 0) dimFinance.recommendations.push('Restructurer les charges fixes pour atteindre un EBITDA positif')
    if (salaryRatio > 40) dimFinance.recommendations.push(`Optimiser la masse salariale de ${fmt(masseSalariale)} à ${fmt(currentCA * 0.35)} FCFA`)
  } else {
    dimFinance.analysis = 'Données financières absentes. Impossible de construire les projections.'
    dimFinance.weaknesses = ['Données financières manquantes — viabilité non évaluable']
    dimFinance.recommendations = ['Fournir les données historiques (CA, charges, RH) sur 3 ans']
  }
  dimFinance.verdict = getScoreLabel(dimFinance.score)
  dimFinance.color = getScoreColor(dimFinance.score)

  // ── Dimension 4: Équipe & Gouvernance ──
  // Inferred from HR data in inputs and BMC
  const hr = pme.rh || {}
  const effectif = hr.effectif || 0
  let govScore = 25
  if (effectif > 0) govScore += 10
  if (hasBmc) govScore += 10
  if (salaryRatio > 0 && salaryRatio < 50) govScore += 10
  if (hasSic) govScore += 5
  govScore = Math.min(govScore, 80)

  let dimGouvernance: DimensionScore = {
    name: 'Équipe & Gouvernance',
    code: 'equipe_gouvernance',
    score: govScore,
    verdict: '',
    color: '',
    strengths: [],
    weaknesses: [],
    recommendations: [],
    analysis: `Effectif: ${effectif || 'non renseigné'}. Masse salariale: ${fmt(masseSalariale)} FCFA. ${effectif > 0 ? `Coût moyen/employé: ${fmt(effectif > 0 ? masseSalariale / effectif : 0)} FCFA/an.` : ''}`
  }

  if (effectif > 0) dimGouvernance.strengths.push(`Équipe de ${effectif} personnes en place`)
  if (salaryRatio > 50) dimGouvernance.weaknesses.push('Masse salariale disproportionnée — sureffectif probable')
  dimGouvernance.weaknesses.push('Organigramme et CV des dirigeants non fournis')
  dimGouvernance.recommendations.push('Fournir l\'organigramme et les CV des dirigeants clés')
  dimGouvernance.recommendations.push('Documenter la composition du conseil d\'administration ou comité consultatif')
  dimGouvernance.verdict = getScoreLabel(dimGouvernance.score)
  dimGouvernance.color = getScoreColor(dimGouvernance.score)

  // ── Dimension 5: Maturité Opérationnelle ──
  let matScore = 20
  if (currentCA > 0) matScore += 10
  if (hasBmc) matScore += 10
  if (hasSic) matScore += 5
  if (croissance.length > 0) matScore += 10
  if (pme.investissements) matScore += 5
  matScore = Math.min(matScore, 75)

  let dimMaturite: DimensionScore = {
    name: 'Maturité Opérationnelle',
    code: 'maturite_operationnelle',
    score: matScore,
    verdict: '',
    color: '',
    strengths: [],
    weaknesses: [],
    recommendations: [],
    analysis: `${currentCA > 0 ? 'Entreprise en activité avec revenus.' : 'Stade pré-revenus.'} ${croissance.length > 0 ? `Hypothèses de croissance sur ${croissance.length} ans.` : 'Pas d\'hypothèses de croissance formalisées.'} ${pme.activities?.length > 0 ? `${pme.activities.length} activités identifiées.` : ''}`
  }

  if (currentCA > 0) dimMaturite.strengths.push('Entreprise en activité avec chiffre d\'affaires réel')
  if (pme.activities?.length > 1) dimMaturite.weaknesses.push(`Multi-activités (${pme.activities.length}) — complexité opérationnelle élevée`)
  dimMaturite.weaknesses.push('Processus internes et conformité non documentés')
  dimMaturite.recommendations.push('Documenter les processus opérationnels clés')
  dimMaturite.recommendations.push('Formaliser la conformité réglementaire')
  dimMaturite.verdict = getScoreLabel(dimMaturite.score)
  dimMaturite.color = getScoreColor(dimMaturite.score)

  // ── Aggregate ──
  const dimensions = [dimModele, dimImpact, dimFinance, dimGouvernance, dimMaturite]
  const scoreGlobal = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length)

  // ── Coherence check ──
  const coherenceIssues: string[] = []
  if (hasBmc && hasFinance) {
    if (pme.activities?.length > 1 && bmcBlocks.length > 0) {
      coherenceIssues.push(`Multi-activités (${pme.activities.map((a: any) => a.name).join(', ')}) mais le BMC ne couvre pas toutes les activités`)
    }
    if (salaryRatio > 50) {
      coherenceIssues.push(`Masse salariale ${salaryRatio.toFixed(0)}% du CA — incohérent avec la taille déclarée de l'équipe`)
    }
  }
  if (hasBmc && !hasFinance) {
    coherenceIssues.push('BMC fourni mais données financières absentes — impossible de valider le modèle de revenus')
  }
  if (hasFinance && !hasBmc) {
    coherenceIssues.push('Données financières fournies mais BMC absent — impossible de comprendre le modèle économique')
  }
  const coherenceScore = Math.max(0, 100 - coherenceIssues.length * 20)

  // ── Risks ──
  const risks: RiskItem[] = []
  if (ebitdaMargin < 0) risks.push({ level: 'critique', title: 'EBITDA négatif', description: `L'entreprise génère un EBITDA de ${fmt(ebitda)} FCFA (${ebitdaMargin.toFixed(1)}%)`, impact: 'Destruction de valeur continue', mitigation: 'Restructuration des charges fixes', probability: 'Certaine (actuel)' })
  if (fixedCostRatio > 80) risks.push({ level: 'critique', title: 'Structure de coûts insoutenable', description: `Charges fixes = ${fixedCostRatio.toFixed(0)}% du CA`, impact: 'Impossibilité d\'atteindre le seuil de rentabilité', mitigation: 'Réduire les charges fixes à <60% du CA', probability: 'Élevée' })
  if (salaryRatio > 50) risks.push({ level: 'haute', title: 'Sureffectif', description: `Masse salariale = ${salaryRatio.toFixed(0)}% du CA (benchmark: 30-40%)`, impact: `Surcoût de ${fmt(masseSalariale - currentCA * 0.35)} FCFA/an`, mitigation: 'Restructuration RH et redéploiement', probability: 'Certaine' })
  if (!hasBmc) risks.push({ level: 'haute', title: 'Modèle économique non documenté', description: 'BMC absent', impact: 'Investisseurs ne peuvent pas évaluer le potentiel', mitigation: 'Remplir le BMC complet', probability: 'Élevée' })
  if (!hasSic) risks.push({ level: 'moyenne', title: 'Impact social non mesuré', description: 'SIC absent', impact: 'Exclusion des fonds à impact', mitigation: 'Remplir le Social Impact Canvas', probability: 'Moyenne' })
  if (pme.activities?.length > 2) risks.push({ level: 'moyenne', title: 'Dispersion multi-activités', description: `${pme.activities.length} activités — risque de dilution`, impact: 'Complexité opérationnelle et perte de focus', mitigation: 'Recentrage sur l\'activité principale', probability: 'Élevée' })

  // ── Strengths & Weaknesses ──
  const allStrengths: string[] = []
  const allWeaknesses: string[] = []
  for (const d of dimensions) {
    allStrengths.push(...d.strengths)
    allWeaknesses.push(...d.weaknesses)
  }

  // ── Action plan ──
  const actionPlan: ActionItem[] = []
  let prio = 1
  if (ebitdaMargin < 0) actionPlan.push({ priority: prio++, horizon: '0-3 mois', title: 'Restructurer les charges fixes', description: `Réduire de ${fmt(chargesFixes)} à ${fmt(currentCA * 0.55)} FCFA`, impact: `+${fmt(chargesFixes - currentCA * 0.55)} FCFA d'EBITDA`, cost: 'Restructuration interne', kpi: 'Charges fixes / CA < 60%' })
  if (salaryRatio > 40) actionPlan.push({ priority: prio++, horizon: '0-3 mois', title: 'Optimiser la masse salariale', description: `Passer de ${salaryRatio.toFixed(0)}% à 35% du CA`, impact: `Économie de ${fmt(masseSalariale - currentCA * 0.35)} FCFA/an`, cost: 'Restructuration RH', kpi: 'Masse salariale / CA < 40%' })
  if (!hasBmc) actionPlan.push({ priority: prio++, horizon: '0-1 mois', title: 'Compléter le BMC', description: 'Remplir les 9 blocs du Business Model Canvas', impact: 'Modèle économique documenté pour les investisseurs', cost: '0 FCFA', kpi: '9/9 blocs complétés' })
  if (!hasSic) actionPlan.push({ priority: prio++, horizon: '1-3 mois', title: 'Remplir le SIC', description: 'Compléter le Social Impact Canvas avec indicateurs quantitatifs', impact: 'Accès aux fonds à impact', cost: '0 FCFA', kpi: 'SIC score > 60' })
  actionPlan.push({ priority: prio++, horizon: '3-6 mois', title: 'Mettre en place le contrôle de gestion', description: 'Dashboard mensuel, suivi KPIs, reporting financier', impact: 'Pilotage en temps réel', cost: '500 000 FCFA (formation)', kpi: 'Reporting mensuel opérationnel' })
  actionPlan.push({ priority: prio++, horizon: '6-12 mois', title: 'Formaliser la gouvernance', description: 'Organigramme, CV dirigeants, comité consultatif', impact: 'Crédibilité investisseurs renforcée', cost: 'Interne', kpi: 'Documents de gouvernance à jour' })

  // ── Funders ──
  const funders: FunderRecommendation[] = [
    { name: 'I&P (Investisseurs & Partenaires)', type: 'Equity / Quasi-equity', range: '50 M - 3 Md FCFA', conditions: 'PME structurées, gouvernance solide, impact social', adequation: scoreGlobal >= 50 ? 'Bonne' : 'Faible', score: scoreGlobal >= 50 ? 70 : 30 },
    { name: 'AFD / Digital Africa', type: 'Prêt subventionné', range: '25 M - 5 Md FCFA', conditions: 'Taux 3-5%, impact développement', adequation: hasSic ? 'Bonne' : 'Moyenne', score: hasSic ? 65 : 40 },
    { name: 'BOAD Ligne PME', type: 'Prêt bancaire', range: '500 K - 50 M FCFA', conditions: 'Taux 7-9%, garanties requises', adequation: 'Bonne', score: 55 },
  ]

  // ── Executive Summary ──
  const executiveSummary = `${data.companyName} est ${currentCA > 0 ? `une entreprise en activité avec un CA de ${fmt(currentCA)} FCFA` : 'au stade de projet'}. ${hasFinance ? `La marge brute est de ${margebrute.toFixed(1)}% ${margebrute >= 40 ? '(solide)' : '(faible)'}. L'EBITDA est de ${fmt(ebitda)} FCFA (${ebitdaMargin.toFixed(1)}%).` : ''} Score d'investissabilité : ${scoreGlobal}/100 (${getScoreLabel(scoreGlobal)}). ${risks.filter(r => r.level === 'critique').length} risque(s) critique(s) identifié(s). ${actionPlan.length} actions recommandées.`

  // ── Alerts ──
  const alerts: string[] = []
  if (ebitdaMargin < 0) alerts.push(`🔴 EBITDA négatif: ${ebitdaMargin.toFixed(1)}% — destruction de valeur`)
  if (fixedCostRatio > 80) alerts.push(`🔴 Charges fixes = ${fixedCostRatio.toFixed(0)}% du CA (critique)`)
  if (salaryRatio > 50) alerts.push(`🟠 Masse salariale = ${salaryRatio.toFixed(0)}% du CA (sureffectif)`)
  if (!hasBmc) alerts.push('⚠️ BMC manquant — modèle économique non évaluable')
  if (!hasSic) alerts.push('⚠️ SIC manquant — impact social non mesurable')

  return {
    scoreGlobal,
    verdict: getScoreLabel(scoreGlobal),
    verdictColor: getScoreColor(scoreGlobal),
    dimensions,
    strengths: allStrengths.slice(0, 8),
    weaknesses: allWeaknesses.slice(0, 8),
    risks,
    actionPlan,
    funders,
    executiveSummary,
    financialSnapshot: {
      ca: currentCA > 0 ? `${fmt(currentCA)} FCFA` : '—',
      margebrute: margebrute > 0 ? `${margebrute.toFixed(1)}%` : '—',
      ebitda: currentCA > 0 ? `${fmt(ebitda)} FCFA` : '—',
      ebitdaMargin: currentCA > 0 ? `${ebitdaMargin.toFixed(1)}%` : '—',
      bfr: bfrRatio > 0 ? `${bfrRatio} jours CA` : '—',
      tresorerie: pme.tresorerie?.tresorerieInitiale ? `${fmt(pme.tresorerie.tresorerieInitiale)} FCFA` : '—',
      capexNeeded: pme.investissements?.totalCapex ? `${fmt(pme.investissements.totalCapex)} FCFA` : '—',
    },
    coherenceScore,
    coherenceIssues,
    alerts,
    aiSource: 'deterministic'
  }
}

// ═══════════════════════════════════════════════════════════════
// 2) AI ENRICHMENT — Claude enhances the diagnostic
// ═══════════════════════════════════════════════════════════════

async function enrichWithAI(base: DiagnosticResult, data: DiagnosticInputData): Promise<DiagnosticResult> {
  if (!data.apiKey) return base

  const prompt = buildAIPrompt(base, data)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': data.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      console.warn(`[DiagExpert] Claude API ${response.status}: ${response.statusText}`)
      return base
    }

    const result = await response.json() as any
    const text = result.content?.[0]?.text || ''

    // Extract JSON from Claude's response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[DiagExpert] No JSON found in Claude response')
      return base
    }

    const aiData = JSON.parse(jsonMatch[0])
    
    // Merge AI enrichments with deterministic base
    return mergeAIEnrichment(base, aiData)
  } catch (err: any) {
    console.error(`[DiagExpert] AI enrichment failed: ${err.message}`)
    return base
  }
}

function buildAIPrompt(base: DiagnosticResult, data: DiagnosticInputData): string {
  const bmcSummary = data.bmcAnalysis
    ? `BMC Score: ${data.bmcAnalysis.score}/100. Blocs: ${(data.bmcAnalysis.blocks || []).map((b: any) => `${b.name}:${b.score}`).join(', ')}`
    : 'BMC non fourni'

  const sicSummary = data.sicAnalysis
    ? `SIC Score: ${data.sicAnalysis.score}/100`
    : 'SIC non fourni'

  const finSummary = base.financialSnapshot
    ? `CA: ${base.financialSnapshot.ca}, Marge brute: ${base.financialSnapshot.margebrute}, EBITDA: ${base.financialSnapshot.ebitda} (${base.financialSnapshot.ebitdaMargin}), Trésorerie: ${base.financialSnapshot.tresorerie}, CAPEX nécessaire: ${base.financialSnapshot.capexNeeded}`
    : 'Données financières non disponibles'

  const kbSection = data.kbContext
    ? `\n\nBENCHMARKS SECTORIELS:\n${data.kbContext.benchmarks}\n\nPARAMÈTRES FISCAUX:\n${data.kbContext.fiscalParams}\n\nBAILLEURS DISPONIBLES:\n${data.kbContext.funders}\n\nCRITÈRES D'ÉVALUATION:\n${data.kbContext.criteria}`
    : ''

  return `Tu es un analyste senior en investissement spécialisé dans les PME africaines (focus Afrique de l'Ouest / UEMOA).

ENTREPRISE: ${data.companyName}
PAYS: ${data.country}
SECTEUR: ${data.sector}
DATE: ${data.analysisDate}

DONNÉES SOURCES:
1. ${bmcSummary}
2. ${sicSummary}
3. FINANCIER: ${finSummary}
4. SCORE DÉTERMINISTE: ${base.scoreGlobal}/100 (${base.verdict})

DIMENSIONS CALCULÉES:
${base.dimensions.map(d => `- ${d.name}: ${d.score}/100 — ${d.analysis}`).join('\n')}

RISQUES IDENTIFIÉS:
${base.risks.map(r => `- [${r.level.toUpperCase()}] ${r.title}: ${r.description}`).join('\n')}

COHÉRENCE BMC ↔ FINANCE:
Score: ${base.coherenceScore}/100
${base.coherenceIssues.map(i => `- ${i}`).join('\n')}
${kbSection}

CONSIGNES:
1. JAMAIS modifier les chiffres financiers — ils sont calculés, pas estimés
2. Enrichir l'analyse contextuelle : ajouter des insights sectoriels, benchmarks régionaux, recommandations spécifiques
3. Affiner les verdicts par dimension avec un diagnostic narratif expert
4. Compléter les recommandations avec des actions concrètes (montants, délais, KPIs)
5. Ajuster le score global si le déterministe est trop optimiste ou pessimiste (justifier)
6. Proposer 3-5 bailleurs pertinents avec critères d'adéquation

Retourne UNIQUEMENT le JSON suivant (pas de texte autour) :
{
  "scoreGlobalAdjusted": <number 0-100>,
  "scoreJustification": "<string>",
  "executiveSummary": "<string 200-400 mots, professionnel>",
  "dimensionEnrichments": [
    { "code": "<code dimension>", "analysisEnriched": "<string>", "scoreAdjusted": <number|null> }
  ],
  "additionalStrengths": ["<string>"],
  "additionalWeaknesses": ["<string>"],
  "additionalRisks": [
    { "level": "critique|haute|moyenne|faible", "title": "<string>", "description": "<string>", "impact": "<string>", "mitigation": "<string>", "probability": "<string>" }
  ],
  "enrichedActionPlan": [
    { "priority": <number>, "horizon": "<string>", "title": "<string>", "description": "<string>", "impact": "<string>", "cost": "<string>", "kpi": "<string>" }
  ],
  "enrichedFunders": [
    { "name": "<string>", "type": "<string>", "range": "<string>", "conditions": "<string>", "adequation": "<string>", "score": <number> }
  ],
  "sectorInsights": "<string>",
  "investorReadinessNarrative": "<string 100-200 mots>"
}`
}

function mergeAIEnrichment(base: DiagnosticResult, ai: any): DiagnosticResult {
  const merged = { ...base, aiSource: 'claude' }

  // Adjust global score if justified
  if (typeof ai.scoreGlobalAdjusted === 'number' && ai.scoreGlobalAdjusted >= 0 && ai.scoreGlobalAdjusted <= 100) {
    merged.scoreGlobal = ai.scoreGlobalAdjusted
    merged.verdict = getScoreLabel(merged.scoreGlobal)
    merged.verdictColor = getScoreColor(merged.scoreGlobal)
  }

  // Enrich executive summary
  if (ai.executiveSummary) {
    merged.executiveSummary = ai.executiveSummary
  }

  // Enrich dimensions
  if (Array.isArray(ai.dimensionEnrichments)) {
    for (const enrichment of ai.dimensionEnrichments) {
      const dim = merged.dimensions.find(d => d.code === enrichment.code)
      if (dim) {
        if (enrichment.analysisEnriched) dim.analysis = enrichment.analysisEnriched
        if (typeof enrichment.scoreAdjusted === 'number') {
          dim.score = enrichment.scoreAdjusted
          dim.verdict = getScoreLabel(dim.score)
          dim.color = getScoreColor(dim.score)
        }
      }
    }
  }

  // Add AI strengths/weaknesses
  if (Array.isArray(ai.additionalStrengths)) {
    merged.strengths = [...merged.strengths, ...ai.additionalStrengths].slice(0, 10)
  }
  if (Array.isArray(ai.additionalWeaknesses)) {
    merged.weaknesses = [...merged.weaknesses, ...ai.additionalWeaknesses].slice(0, 10)
  }

  // Add AI risks
  if (Array.isArray(ai.additionalRisks)) {
    merged.risks = [...merged.risks, ...ai.additionalRisks]
  }

  // Replace action plan if AI provides better one
  if (Array.isArray(ai.enrichedActionPlan) && ai.enrichedActionPlan.length >= 3) {
    merged.actionPlan = ai.enrichedActionPlan
  }

  // Replace funders if AI provides
  if (Array.isArray(ai.enrichedFunders) && ai.enrichedFunders.length >= 2) {
    merged.funders = ai.enrichedFunders
  }

  return merged
}

// ═══════════════════════════════════════════════════════════════
// 3) HTML GENERATION — Full standalone diagnostic HTML
// ═══════════════════════════════════════════════════════════════

export function generateDiagnosticHtml(result: DiagnosticResult, data: DiagnosticInputData): string {
  const { scoreGlobal, verdict, verdictColor, dimensions, strengths, weaknesses, risks, actionPlan, funders, executiveSummary, financialSnapshot, coherenceScore, coherenceIssues, alerts } = result

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagnostic Expert — ${escHtml(data.companyName)}</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; }
    .diag { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }

    /* Header */
    .diag-header { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #1e40af 100%); border-radius: 20px; padding: 36px 32px; color: white; margin-bottom: 24px; position: relative; overflow: hidden; }
    .diag-header::before { content: ''; position: absolute; top: -50%; right: -10%; width: 400px; height: 400px; background: radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%); border-radius: 50%; }
    .diag-header__badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; background: rgba(255,255,255,0.12); font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; }
    .diag-header__company { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
    .diag-header__meta { font-size: 13px; color: #94a3b8; display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }

    /* Score card */
    .diag-score { display: flex; align-items: center; gap: 24px; background: rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; border: 1px solid rgba(255,255,255,0.1); }
    .diag-score__number { font-size: 64px; font-weight: 900; line-height: 1; }
    .diag-score__max { font-size: 24px; font-weight: 400; color: #94a3b8; }
    .diag-score__verdict { font-size: 16px; font-weight: 700; letter-spacing: 1px; }
    .diag-score__bar { height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; margin-top: 8px; width: 200px; }
    .diag-score__bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }

    /* Alerts banner */
    .diag-alerts { background: #fef2f2; border: 1px solid #fecaca; border-radius: 16px; padding: 20px 24px; margin-bottom: 24px; }
    .diag-alerts__title { font-size: 14px; font-weight: 700; color: #991b1b; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .diag-alerts__list { list-style: none; }
    .diag-alerts__list li { font-size: 13px; color: #7f1d1d; padding: 6px 0; border-bottom: 1px solid #fecaca; display: flex; align-items: flex-start; gap: 8px; }
    .diag-alerts__list li:last-child { border-bottom: none; }

    /* Section */
    .diag-section { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .diag-section__title { font-size: 16px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #f1f5f9; }
    .diag-section__title i { font-size: 18px; }

    /* Executive summary */
    .diag-exec { background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 1px solid #bae6fd; }
    .diag-exec p { font-size: 14px; line-height: 1.8; color: #0c4a6e; }

    /* Dimensions grid */
    .diag-dims { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .diag-dim { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; transition: transform 0.2s, box-shadow 0.2s; }
    .diag-dim:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .diag-dim__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .diag-dim__name { font-size: 14px; font-weight: 700; color: #0f172a; }
    .diag-dim__score { font-size: 20px; font-weight: 800; }
    .diag-dim__bar { height: 6px; background: #e2e8f0; border-radius: 3px; margin-bottom: 10px; }
    .diag-dim__bar-fill { height: 100%; border-radius: 3px; }
    .diag-dim__verdict { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-bottom: 8px; }
    .diag-dim__analysis { font-size: 12px; color: #475569; line-height: 1.6; margin-bottom: 10px; }
    .diag-dim__list { list-style: none; font-size: 11px; }
    .diag-dim__list li { padding: 3px 0; display: flex; align-items: flex-start; gap: 6px; }

    /* Financial snapshot */
    .diag-fin-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .diag-fin-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; text-align: center; }
    .diag-fin-card__label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 4px; }
    .diag-fin-card__value { font-size: 18px; font-weight: 800; color: #0f172a; }

    /* Strengths / Weaknesses */
    .diag-sw { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 768px) { .diag-sw { grid-template-columns: 1fr; } }
    .diag-sw__col { border-radius: 14px; padding: 20px; }
    .diag-sw__col--s { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .diag-sw__col--w { background: #fef2f2; border: 1px solid #fecaca; }
    .diag-sw__title { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .diag-sw__list { list-style: none; }
    .diag-sw__list li { font-size: 13px; padding: 6px 0; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; align-items: flex-start; gap: 8px; }
    .diag-sw__list li:last-child { border-bottom: none; }

    /* Risk matrix */
    .diag-risk { border-left: 4px solid; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; background: white; }
    .diag-risk__header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .diag-risk__level { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 2px 8px; border-radius: 4px; color: white; }
    .diag-risk__title { font-size: 14px; font-weight: 700; color: #0f172a; }
    .diag-risk__grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px; }
    .diag-risk__grid-label { font-weight: 600; color: #64748b; font-size: 10px; text-transform: uppercase; }

    /* Action plan */
    .diag-action { display: flex; gap: 16px; align-items: flex-start; padding: 16px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; margin-bottom: 12px; }
    .diag-action__num { width: 32px; height: 32px; border-radius: 50%; background: #d97706; color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; flex-shrink: 0; }
    .diag-action__title { font-size: 14px; font-weight: 700; color: #92400e; margin-bottom: 4px; }
    .diag-action__desc { font-size: 12px; color: #78350f; margin-bottom: 6px; }
    .diag-action__meta { display: flex; gap: 12px; flex-wrap: wrap; }
    .diag-action__tag { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: rgba(217,119,6,0.1); color: #92400e; }

    /* Funders */
    .diag-funder { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
    .diag-funder__card { background: #f5f3ff; border: 1px solid #ede9fe; border-radius: 14px; padding: 18px; }
    .diag-funder__name { font-size: 14px; font-weight: 700; color: #5b21b6; margin-bottom: 4px; }
    .diag-funder__type { font-size: 11px; color: #7c3aed; font-weight: 600; margin-bottom: 8px; }
    .diag-funder__detail { font-size: 12px; color: #6b7280; margin-bottom: 3px; }
    .diag-funder__score { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; margin-top: 6px; }

    /* Coherence */
    .diag-coherence { background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%); border: 1px solid #fde68a; }
    .diag-coherence__score { font-size: 36px; font-weight: 900; }
    .diag-coherence__list { list-style: none; }
    .diag-coherence__list li { font-size: 13px; color: #78350f; padding: 6px 0; display: flex; gap: 8px; }

    /* Footer */
    .diag-footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 11px; }

    /* Print */
    @media print {
      body { background: white; }
      .diag { padding: 0; }
      .diag-section { break-inside: avoid; box-shadow: none; }
      .diag-header { break-after: avoid; }
      .no-print { display: none !important; }
    }

    /* Radar placeholder (CSS-only) */
    .diag-radar { display: flex; justify-content: center; padding: 20px; }
    .diag-radar__chart { width: 280px; height: 280px; position: relative; }
    .diag-radar__label { position: absolute; font-size: 10px; font-weight: 700; color: #475569; text-align: center; width: 100px; }
  </style>
</head>
<body>
  <div class="diag">
    <!-- ═══ HEADER ═══ -->
    <div class="diag-header">
      <div class="diag-header__badge"><i class="fas fa-stethoscope"></i> DIAGNOSTIC EXPERT — MODULE 5</div>
      <div class="diag-header__company">${escHtml(data.companyName)}</div>
      <div class="diag-header__meta">
        <span><i class="fas fa-map-marker-alt"></i> ${escHtml(data.country)}</span>
        <span><i class="fas fa-industry"></i> ${escHtml(data.sector || 'Non précisé')}</span>
        <span><i class="fas fa-calendar"></i> ${escHtml(data.analysisDate)}</span>
        <span><i class="fas fa-robot"></i> Source: ${escHtml(result.aiSource)}</span>
      </div>
      <div class="diag-score">
        <div>
          <div class="diag-score__number" style="color:${verdictColor}">${scoreGlobal}<span class="diag-score__max">/100</span></div>
          <div class="diag-score__verdict" style="color:${verdictColor}">${escHtml(verdict)}</div>
          <div class="diag-score__bar"><div class="diag-score__bar-fill" style="width:${scoreGlobal}%;background:${verdictColor}"></div></div>
        </div>
        <div style="flex:1">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
            ${dimensions.map(d => `
              <div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:10px;border:1px solid rgba(255,255,255,0.08)">
                <div style="font-size:20px;font-weight:800;color:${d.color}">${d.score}</div>
                <div style="font-size:10px;color:#94a3b8;margin-top:2px">${escHtml(d.name)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ ALERTS ═══ -->
    ${alerts.length > 0 ? `
    <div class="diag-alerts">
      <div class="diag-alerts__title"><i class="fas fa-exclamation-triangle"></i> Alertes critiques (${alerts.length})</div>
      <ul class="diag-alerts__list">
        ${alerts.map(a => `<li>${escHtml(a)}</li>`).join('')}
      </ul>
    </div>` : ''}

    <!-- ═══ EXECUTIVE SUMMARY ═══ -->
    <div class="diag-section diag-exec">
      <div class="diag-section__title"><i class="fas fa-file-alt" style="color:#0284c7"></i> Synthèse Exécutive</div>
      <p>${escHtml(executiveSummary)}</p>
    </div>

    <!-- ═══ FINANCIAL SNAPSHOT ═══ -->
    <div class="diag-section">
      <div class="diag-section__title"><i class="fas fa-chart-bar" style="color:#059669"></i> Snapshot Financier</div>
      <div class="diag-fin-grid">
        <div class="diag-fin-card">
          <div class="diag-fin-card__label">Chiffre d'Affaires</div>
          <div class="diag-fin-card__value">${escHtml(financialSnapshot.ca)}</div>
        </div>
        <div class="diag-fin-card">
          <div class="diag-fin-card__label">Marge Brute</div>
          <div class="diag-fin-card__value">${escHtml(financialSnapshot.margebrute)}</div>
        </div>
        <div class="diag-fin-card">
          <div class="diag-fin-card__label">EBITDA</div>
          <div class="diag-fin-card__value" style="color:${financialSnapshot.ebitda.includes('-') ? '#dc2626' : '#059669'}">${escHtml(financialSnapshot.ebitda)}</div>
        </div>
        <div class="diag-fin-card">
          <div class="diag-fin-card__label">Marge EBITDA</div>
          <div class="diag-fin-card__value" style="color:${financialSnapshot.ebitdaMargin.includes('-') ? '#dc2626' : '#059669'}">${escHtml(financialSnapshot.ebitdaMargin)}</div>
        </div>
        <div class="diag-fin-card">
          <div class="diag-fin-card__label">BFR</div>
          <div class="diag-fin-card__value">${escHtml(financialSnapshot.bfr)}</div>
        </div>
        <div class="diag-fin-card">
          <div class="diag-fin-card__label">Trésorerie</div>
          <div class="diag-fin-card__value">${escHtml(financialSnapshot.tresorerie)}</div>
        </div>
        <div class="diag-fin-card">
          <div class="diag-fin-card__label">CAPEX Nécessaire</div>
          <div class="diag-fin-card__value">${escHtml(financialSnapshot.capexNeeded)}</div>
        </div>
      </div>
    </div>

    <!-- ═══ 5 DIMENSIONS ═══ -->
    <div class="diag-section">
      <div class="diag-section__title"><i class="fas fa-radar" style="color:#6366f1"></i> Évaluation par Dimension (5 axes)</div>
      <div class="diag-dims">
        ${dimensions.map(d => `
        <div class="diag-dim">
          <div class="diag-dim__header">
            <span class="diag-dim__name">${escHtml(d.name)}</span>
            <span class="diag-dim__score" style="color:${d.color}">${d.score}/100</span>
          </div>
          <div class="diag-dim__bar"><div class="diag-dim__bar-fill" style="width:${d.score}%;background:${d.color}"></div></div>
          <span class="diag-dim__verdict" style="background:${d.color}20;color:${d.color}">${escHtml(d.verdict)}</span>
          <p class="diag-dim__analysis">${escHtml(d.analysis)}</p>
          ${d.strengths.length > 0 ? `<ul class="diag-dim__list">${d.strengths.map(s => `<li><i class="fas fa-check-circle" style="color:#059669;font-size:10px;margin-top:2px"></i> ${escHtml(s)}</li>`).join('')}</ul>` : ''}
          ${d.weaknesses.length > 0 ? `<ul class="diag-dim__list" style="margin-top:4px">${d.weaknesses.map(w => `<li><i class="fas fa-times-circle" style="color:#dc2626;font-size:10px;margin-top:2px"></i> ${escHtml(w)}</li>`).join('')}</ul>` : ''}
        </div>
        `).join('')}
      </div>
    </div>

    <!-- ═══ FORCES / FAIBLESSES ═══ -->
    <div class="diag-sw">
      <div class="diag-sw__col diag-sw__col--s">
        <div class="diag-sw__title" style="color:#166534"><i class="fas fa-shield-halved" style="color:#059669"></i> Forces (${strengths.length})</div>
        <ul class="diag-sw__list">
          ${strengths.map(s => `<li><i class="fas fa-check-circle" style="color:#059669;margin-top:3px"></i> ${escHtml(s)}</li>`).join('')}
        </ul>
      </div>
      <div class="diag-sw__col diag-sw__col--w">
        <div class="diag-sw__title" style="color:#991b1b"><i class="fas fa-triangle-exclamation" style="color:#dc2626"></i> Faiblesses (${weaknesses.length})</div>
        <ul class="diag-sw__list">
          ${weaknesses.map(w => `<li><i class="fas fa-xmark" style="color:#dc2626;margin-top:3px"></i> ${escHtml(w)}</li>`).join('')}
        </ul>
      </div>
    </div>

    <!-- ═══ MATRICE DES RISQUES ═══ -->
    <div class="diag-section">
      <div class="diag-section__title"><i class="fas fa-shield-exclamation" style="color:#dc2626"></i> Matrice des Risques (${risks.length})</div>
      ${risks.map(r => `
      <div class="diag-risk" style="border-color:${getLevelColor(r.level)}">
        <div class="diag-risk__header">
          <span class="diag-risk__level" style="background:${getLevelColor(r.level)}">${escHtml(r.level)}</span>
          <span class="diag-risk__title">${escHtml(r.title)}</span>
        </div>
        <p style="font-size:13px;color:#475569;margin-bottom:8px">${escHtml(r.description)}</p>
        <div class="diag-risk__grid">
          <div><div class="diag-risk__grid-label">Impact</div><div>${escHtml(r.impact)}</div></div>
          <div><div class="diag-risk__grid-label">Mitigation</div><div>${escHtml(r.mitigation)}</div></div>
          <div><div class="diag-risk__grid-label">Probabilité</div><div>${escHtml(r.probability)}</div></div>
        </div>
      </div>
      `).join('')}
    </div>

    <!-- ═══ PLAN D'ACTION ═══ -->
    <div class="diag-section">
      <div class="diag-section__title"><i class="fas fa-list-check" style="color:#d97706"></i> Plan d'Action Prioritaire (${actionPlan.length} actions)</div>
      ${actionPlan.map(a => `
      <div class="diag-action">
        <div class="diag-action__num">${a.priority}</div>
        <div style="flex:1">
          <div class="diag-action__title">${escHtml(a.title)}</div>
          <div class="diag-action__desc">${escHtml(a.description)}</div>
          <div class="diag-action__meta">
            <span class="diag-action__tag"><i class="fas fa-clock"></i> ${escHtml(a.horizon)}</span>
            <span class="diag-action__tag"><i class="fas fa-chart-line"></i> ${escHtml(a.impact)}</span>
            <span class="diag-action__tag"><i class="fas fa-coins"></i> ${escHtml(a.cost)}</span>
            <span class="diag-action__tag"><i class="fas fa-bullseye"></i> ${escHtml(a.kpi)}</span>
          </div>
        </div>
      </div>
      `).join('')}
    </div>

    <!-- ═══ BAILLEURS RECOMMANDÉS ═══ -->
    <div class="diag-section">
      <div class="diag-section__title"><i class="fas fa-hand-holding-dollar" style="color:#7c3aed"></i> Bailleurs & Partenaires Recommandés</div>
      <div class="diag-funder">
        ${funders.map(f => `
        <div class="diag-funder__card">
          <div class="diag-funder__name">${escHtml(f.name)}</div>
          <div class="diag-funder__type">${escHtml(f.type)}</div>
          <div class="diag-funder__detail"><strong>Montant:</strong> ${escHtml(f.range)}</div>
          <div class="diag-funder__detail"><strong>Conditions:</strong> ${escHtml(f.conditions)}</div>
          <div class="diag-funder__detail"><strong>Adéquation:</strong> ${escHtml(f.adequation)}</div>
          <span class="diag-funder__score" style="background:${getScoreColor(f.score)}20;color:${getScoreColor(f.score)}">${f.score}/100</span>
        </div>
        `).join('')}
      </div>
    </div>

    <!-- ═══ COHÉRENCE BMC ↔ FINANCE ═══ -->
    ${coherenceIssues.length > 0 ? `
    <div class="diag-section diag-coherence">
      <div class="diag-section__title"><i class="fas fa-arrows-rotate" style="color:#d97706"></i> Cohérence BMC ↔ Finance</div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
        <div class="diag-coherence__score" style="color:${getScoreColor(coherenceScore)}">${coherenceScore}<span style="font-size:16px;color:#92400e">/100</span></div>
        <div style="font-size:13px;color:#78350f">${coherenceIssues.length} incohérence(s) détectée(s)</div>
      </div>
      <ul class="diag-coherence__list">
        ${coherenceIssues.map(i => `<li><i class="fas fa-link-slash" style="color:#d97706"></i> ${escHtml(i)}</li>`).join('')}
      </ul>
    </div>` : ''}

    <!-- ═══ FOOTER ═══ -->
    <div class="diag-footer">
      <p>Diagnostic généré par <strong>ESONO AI</strong> — Plateforme Investment Readiness</p>
      <p>${escHtml(data.analysisDate)} | ${escHtml(data.companyName)} | Score: ${scoreGlobal}/100</p>
      <p style="margin-top:8px">
        <button onclick="window.print()" class="no-print" style="padding:8px 20px;border-radius:8px;background:#1e3a5f;color:white;border:none;font-size:12px;font-weight:600;cursor:pointer">
          <i class="fas fa-print"></i> Imprimer / PDF
        </button>
      </p>
    </div>
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════
// 4) MAIN EXPORT — Generate full diagnostic
// ═══════════════════════════════════════════════════════════════

export async function generateDiagnosticExpert(data: DiagnosticInputData): Promise<{ result: DiagnosticResult; html: string }> {
  console.log(`[DiagExpert] Generating diagnostic for ${data.companyName}...`)

  // Step 1: Deterministic analysis
  const baseResult = analyzeDeterministic(data)
  console.log(`[DiagExpert] Deterministic score: ${baseResult.scoreGlobal}/100, ${baseResult.dimensions.length} dims, ${baseResult.risks.length} risks`)

  // Step 2: AI enrichment (if API key available)
  let enrichedResult = baseResult
  if (data.apiKey) {
    console.log('[DiagExpert] Enriching with Claude AI...')
    enrichedResult = await enrichWithAI(baseResult, data)
    console.log(`[DiagExpert] AI enriched: score=${enrichedResult.scoreGlobal}/100, source=${enrichedResult.aiSource}`)
  }

  // Step 3: Generate HTML
  const html = generateDiagnosticHtml(enrichedResult, data)
  console.log(`[DiagExpert] HTML generated: ${html.length} chars`)

  return { result: enrichedResult, html }
}

// Fallback export for non-async usage
export function generateDiagnosticExpertFallback(data: DiagnosticInputData): { result: DiagnosticResult; html: string } {
  const result = analyzeDeterministic(data)
  const html = generateDiagnosticHtml(result, data)
  return { result, html }
}
