// ═══════════════════════════════════════════════════════════════
// SIC Engine — Social Impact Canvas Analysis & Deliverable
// Module 2 : Scoring, coherence BMC-SIC, SMART check, ODD mapping
// ═══════════════════════════════════════════════════════════════

// ─── Types ───
export type SicSectionKey = 'impact_vise' | 'beneficiaires' | 'mesure_impact' | 'odd_contribution' | 'risques_defis'

export interface SicSectionScore {
  key: SicSectionKey
  label: string
  score: number     // 0-10
  maxScore: number  // always 10
  percentage: number
  feedback: string[]
  warnings: string[]
  strengths: string[]
}

export interface SicOddMapping {
  oddNumber: number
  oddLabel: string
  contributionType: 'direct' | 'indirect' | 'non_identifie'
  evidenceLevel: 'prouve' | 'mesure' | 'intentionnel'
  score: number  // 0-3
  justification: string
}

export interface SicImpactMatrix {
  intentionnel: string[]  // declared intentions
  mesure: string[]        // measured indicators
  prouve: string[]        // proven with evidence
}

export interface SicAnalysisResult {
  sections: SicSectionScore[]
  scoreGlobal: number         // /10
  scoreCoherenceBmc: number   // /10
  impactMatrix: SicImpactMatrix
  oddMappings: SicOddMapping[]
  impactWashingRisk: 'faible' | 'moyen' | 'eleve'
  impactWashingSignals: string[]
  smartCheck: {
    isSpecific: boolean
    isMeasurable: boolean
    isAttainable: boolean
    isRelevant: boolean
    isTimeBound: boolean
    score: number  // /5
    feedback: string
  }
  bmcCoherenceIssues: string[]
  recommendations: string[]
  verdict: string
  timestamp: string
}

// ─── ODD Reference Data ───
export const ODD_LABELS: Record<number, string> = {
  1: 'Pas de pauvrete',
  2: 'Faim zero',
  3: 'Bonne sante et bien-etre',
  4: 'Education de qualite',
  5: 'Egalite entre les sexes',
  6: 'Eau propre et assainissement',
  7: 'Energie propre et abordable',
  8: 'Travail decent et croissance',
  9: 'Industrie, innovation et infrastructure',
  10: 'Inegalites reduites',
  11: 'Villes et communautes durables',
  12: 'Consommation et production responsables',
  13: 'Lutte contre les changements climatiques',
  14: 'Vie aquatique',
  15: 'Vie terrestre',
  16: 'Paix, justice et institutions efficaces',
  17: 'Partenariats pour la realisation des objectifs'
}

export const ODD_ICONS: Record<number, string> = {
  1: '#E5243B', 2: '#DDA63A', 3: '#4C9F38', 4: '#C5192D',
  5: '#FF3A21', 6: '#26BDE2', 7: '#FCC30B', 8: '#A21942',
  9: '#FD6925', 10: '#DD1367', 11: '#FD9D24', 12: '#BF8B2E',
  13: '#3F7E44', 14: '#0A97D9', 15: '#56C02B', 16: '#00689D',
  17: '#19486A'
}

// ─── Section Labels ───
export const SIC_SECTION_LABELS: Record<SicSectionKey, string> = {
  impact_vise: 'Impact Vise',
  beneficiaires: 'Beneficiaires',
  mesure_impact: "Mesure d'Impact",
  odd_contribution: 'ODD & Contribution',
  risques_defis: 'Risques & Defis'
}

// ─── Question-to-Section Mapping ───
// Maps question IDs to SIC sections
export const QUESTION_SECTION_MAP: Record<number, SicSectionKey> = {
  1: 'impact_vise', 2: 'impact_vise', 3: 'impact_vise',
  4: 'beneficiaires', 5: 'beneficiaires', 6: 'beneficiaires',
  7: 'mesure_impact', 8: 'mesure_impact', 9: 'mesure_impact', 10: 'mesure_impact',
  11: 'odd_contribution', 12: 'odd_contribution', 13: 'odd_contribution',
  14: 'risques_defis', 15: 'risques_defis'
}

// ─── Helper: text quality score ───
function textQualityScore(text: string | null | undefined): number {
  if (!text || text.trim().length === 0) return 0
  const t = text.trim()
  let score = 0

  // Length scoring
  if (t.length > 20) score += 1
  if (t.length > 80) score += 1
  if (t.length > 200) score += 1
  if (t.length > 400) score += 1

  // Quantitative indicators
  const hasNumbers = /\d/.test(t)
  if (hasNumbers) score += 1.5

  // Percentage or XOF amounts
  if (/\d+\s*%/.test(t) || /XOF|FCFA|CFA/i.test(t)) score += 0.5

  // Structure indicators (multiple points)
  const hasBullets = /[•\-–]\s|^\d+[\.\)]/m.test(t)
  if (hasBullets) score += 0.5

  // Specificity bonus
  const hasSpecificTerms = /beneficiai|indicat|mesur|ODD|cible|risqu|attenu|baseline|enquete|audit/i.test(t)
  if (hasSpecificTerms) score += 0.5

  return Math.min(score, 10)
}

// ─── Analyze a single SIC section ───
function analyzeSection(
  sectionKey: SicSectionKey,
  answers: Map<number, string>,
  bmcAnswers?: Map<number, string>
): SicSectionScore {
  const label = SIC_SECTION_LABELS[sectionKey]
  const questionIds = Object.entries(QUESTION_SECTION_MAP)
    .filter(([, section]) => section === sectionKey)
    .map(([id]) => Number(id))

  const sectionAnswers = questionIds.map(id => ({
    id,
    answer: answers.get(id) ?? ''
  }))

  const feedback: string[] = []
  const warnings: string[] = []
  const strengths: string[] = []
  let rawScore = 0
  let maxRaw = 0

  for (const qa of sectionAnswers) {
    const quality = textQualityScore(qa.answer)
    rawScore += quality
    maxRaw += 10

    if (!qa.answer || qa.answer.trim().length === 0) {
      feedback.push(`Question ${qa.id} non remplie.`)
      warnings.push(`Bloc manquant dans la section "${label}".`)
    } else if (quality < 3) {
      feedback.push(`Question ${qa.id}: reponse trop courte ou vague. Ajoutez des details quantitatifs.`)
    } else if (quality >= 7) {
      strengths.push(`Question ${qa.id}: reponse bien detaillee et quantifiee.`)
    }
  }

  // Section-specific checks
  if (sectionKey === 'impact_vise') {
    const allText = sectionAnswers.map(a => a.answer).join(' ')
    if (!/\d/.test(allText)) {
      warnings.push('Aucun chiffre dans la section Impact Vise. Les investisseurs attendent des donnees quantitatives.')
    }
    // BMC coherence check
    if (bmcAnswers) {
      const bmcProposition = bmcAnswers.get(4) ?? '' // Proposition de valeur from BMC
      if (bmcProposition && sectionAnswers[0]?.answer) {
        // Check if there's thematic overlap
        const sicWords = new Set(sectionAnswers[0].answer.toLowerCase().split(/\s+/).filter(w => w.length > 4))
        const bmcWords = new Set(bmcProposition.toLowerCase().split(/\s+/).filter(w => w.length > 4))
        const overlap = [...sicWords].filter(w => bmcWords.has(w))
        if (overlap.length === 0 && bmcProposition.length > 20 && sectionAnswers[0].answer.length > 20) {
          warnings.push('Peu de coherence detectee entre la proposition de valeur BMC et l\'impact vise SIC.')
        }
      }
    }
  }

  if (sectionKey === 'beneficiaires') {
    const countText = sectionAnswers.find(a => a.id === 5)?.answer ?? ''
    if (countText && !/\d/.test(countText)) {
      warnings.push('Aucun chiffre de beneficiaires. Donnez des nombres precis (directs et indirects).')
    }
  }

  if (sectionKey === 'mesure_impact') {
    const kpiText = sectionAnswers.find(a => a.id === 7)?.answer ?? ''
    const baselineText = sectionAnswers.find(a => a.id === 8)?.answer ?? ''
    if (kpiText && !baselineText) {
      warnings.push('KPI defini mais pas de baseline. Impossible de mesurer le progres sans point de depart.')
    }
  }

  if (sectionKey === 'odd_contribution') {
    const oddText = sectionAnswers.find(a => a.id === 11)?.answer ?? ''
    const oddNumbers = oddText.match(/ODD\s*(\d{1,2})/gi)?.length ?? 0
    if (oddNumbers > 5) {
      warnings.push(`${oddNumbers} ODD mentionnes. Concentrez-vous sur 2-3 ODD bien documentes.`)
    }
  }

  const score = maxRaw > 0 ? Math.round((rawScore / maxRaw) * 10 * 10) / 10 : 0

  return {
    key: sectionKey,
    label,
    score,
    maxScore: 10,
    percentage: Math.round(score * 10),
    feedback,
    warnings,
    strengths
  }
}

// ─── SMART Check ───
function checkSMART(answers: Map<number, string>): SicAnalysisResult['smartCheck'] {
  const kpi = answers.get(7) ?? ''
  const baseline = answers.get(8) ?? ''
  const method = answers.get(9) ?? ''
  const frequency = answers.get(10) ?? ''

  const isSpecific = kpi.length > 20 && /specifiq|precis|indicat|revenu|taux|nombre/i.test(kpi)
  const isMeasurable = /mesur|enquete|donnees|collecte|audit|chiffr/i.test(method) || /\d/.test(baseline)
  const isAttainable = /\d+\s*%|realistic|progressi|etap/i.test(baseline) || baseline.length > 30
  const isRelevant = kpi.length > 10 && /impact|beneficiai|social|environnement/i.test(kpi + baseline)
  const isTimeBound = /\d+\s*an|trimest|semest|mensuel|annuel|mois/i.test(baseline + frequency)

  const checks = [isSpecific, isMeasurable, isAttainable, isRelevant, isTimeBound]
  const score = checks.filter(Boolean).length

  const missing: string[] = []
  if (!isSpecific) missing.push('Specifique')
  if (!isMeasurable) missing.push('Mesurable')
  if (!isAttainable) missing.push('Atteignable')
  if (!isRelevant) missing.push('Relevant')
  if (!isTimeBound) missing.push('Temporel')

  const feedbackStr = score === 5
    ? 'Indicateur SMART complet. Excellent.'
    : `Indicateur partiellement SMART (${score}/5). Manque: ${missing.join(', ')}.`

  return { isSpecific, isMeasurable, isAttainable, isRelevant, isTimeBound, score, feedback: feedbackStr }
}

// ─── Impact Washing Detection ───
function detectImpactWashing(answers: Map<number, string>): { risk: 'faible' | 'moyen' | 'eleve', signals: string[] } {
  const signals: string[] = []

  // Check for vague language
  const allText = Array.from(answers.values()).join(' ').toLowerCase()
  if (/nous changeons le monde|revolutionn|transform.*tout/i.test(allText)) {
    signals.push('Langage grandiose sans preuves specifiques.')
  }

  // No numbers in impact section
  const impactText = [answers.get(1), answers.get(2), answers.get(3)].join(' ')
  if (impactText.length > 50 && !/\d/.test(impactText)) {
    signals.push('Section Impact Vise sans donnees quantitatives.')
  }

  // Too many ODD
  const oddText = answers.get(11) ?? ''
  const oddCount = oddText.match(/ODD\s*\d/gi)?.length ?? 0
  if (oddCount > 5) {
    signals.push(`${oddCount} ODD revendiques : risque de sur-declaration.`)
  }

  // No measurement method
  const method = answers.get(9) ?? ''
  if (method.length < 30) {
    signals.push('Methode de mesure insuffisamment detaillee.')
  }

  // No baseline
  const baseline = answers.get(8) ?? ''
  if (baseline.length < 20 || !/\d/.test(baseline)) {
    signals.push('Pas de baseline chiffree : impossible de prouver le progres.')
  }

  // Inflated beneficiary numbers
  const benefText = answers.get(5) ?? ''
  const numbers = benefText.match(/\d[\d\s]*/g)?.map(n => parseInt(n.replace(/\s/g, ''))) ?? []
  if (numbers.length >= 2) {
    const sorted = numbers.sort((a, b) => b - a)
    if (sorted[0] > sorted[1] * 15) {
      signals.push('Ratio beneficiaires indirects/directs tres eleve (> 15:1).')
    }
  }

  // No risks identified
  const risks = answers.get(14) ?? ''
  if (risks.length < 30) {
    signals.push('Risques insuffisamment identifies : manque de lucidite.')
  }

  const risk = signals.length >= 4 ? 'eleve' : signals.length >= 2 ? 'moyen' : 'faible'
  return { risk, signals }
}

// ─── ODD Mapping from answers ───
function mapODD(answers: Map<number, string>): SicOddMapping[] {
  const oddText = answers.get(11) ?? ''
  const contributionText = answers.get(12) ?? ''
  const evidenceText = answers.get(13) ?? ''
  const mappings: SicOddMapping[] = []

  // Extract ODD numbers from text
  const oddMatches = oddText.match(/ODD\s*(\d{1,2})/gi) ?? []
  const oddNumbers = [...new Set(oddMatches.map(m => parseInt(m.replace(/ODD\s*/i, ''))))]
    .filter(n => n >= 1 && n <= 17)
    .slice(0, 5) // Max 5

  for (const num of oddNumbers) {
    const label = ODD_LABELS[num] ?? `ODD ${num}`
    const isDirectMentioned = new RegExp(`ODD\\s*${num}.*direct`, 'i').test(contributionText)
    const contributionType = isDirectMentioned ? 'direct' as const : 'indirect' as const

    // Evidence level
    let evidenceLevel: 'prouve' | 'mesure' | 'intentionnel' = 'intentionnel'
    const oddEvidence = evidenceText.toLowerCase()
    if (/audit|certifi|rapport.*audit|preuve|verifi/i.test(oddEvidence)) {
      evidenceLevel = 'prouve'
    } else if (/mesur|enquete|donn|indicat|suivi/i.test(oddEvidence)) {
      evidenceLevel = 'mesure'
    }

    // Score: 0-3
    let score = 1 // Base: declared
    if (contributionType === 'direct') score += 1
    if (evidenceLevel === 'mesure') score += 0.5
    if (evidenceLevel === 'prouve') score += 1

    const justification = contributionType === 'direct'
      ? `Contribution directe declaree a l'ODD ${num}.`
      : `Contribution indirecte a l'ODD ${num}.`

    mappings.push({
      oddNumber: num,
      oddLabel: label,
      contributionType,
      evidenceLevel,
      score: Math.min(score, 3),
      justification
    })
  }

  return mappings
}

// ─── Build Impact Matrix ───
function buildImpactMatrix(answers: Map<number, string>, oddMappings: SicOddMapping[]): SicImpactMatrix {
  const intentionnel: string[] = []
  const mesure: string[] = []
  const prouve: string[] = []

  // Impact intentions
  const impact = answers.get(2) ?? ''
  if (impact) intentionnel.push(`Transformation visee: ${impact.substring(0, 120)}...`)

  const kpi = answers.get(7) ?? ''
  if (kpi) intentionnel.push(`KPI: ${kpi.substring(0, 100)}`)

  // Measured elements
  const baseline = answers.get(8) ?? ''
  if (/\d/.test(baseline)) mesure.push(`Baseline definie: ${baseline.substring(0, 100)}`)

  const method = answers.get(9) ?? ''
  if (method.length > 30) mesure.push(`Methode de mesure: ${method.substring(0, 100)}`)

  // ODD with evidence
  for (const odd of oddMappings) {
    if (odd.evidenceLevel === 'prouve') {
      prouve.push(`ODD ${odd.oddNumber} (${odd.oddLabel}): contribution prouvee`)
    } else if (odd.evidenceLevel === 'mesure') {
      mesure.push(`ODD ${odd.oddNumber} (${odd.oddLabel}): contribution mesuree`)
    } else {
      intentionnel.push(`ODD ${odd.oddNumber} (${odd.oddLabel}): contribution declaree`)
    }
  }

  const evidence = answers.get(13) ?? ''
  if (/audit|certif|rapport/i.test(evidence)) {
    prouve.push(`Preuves externes mentionnees: ${evidence.substring(0, 100)}`)
  }

  return { intentionnel, mesure, prouve }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ANALYSIS FUNCTION
// ═══════════════════════════════════════════════════════════════
export function analyzeSIC(
  answers: Map<number, string>,
  bmcAnswers?: Map<number, string>
): SicAnalysisResult {
  // Analyze each section
  const sectionKeys: SicSectionKey[] = ['impact_vise', 'beneficiaires', 'mesure_impact', 'odd_contribution', 'risques_defis']
  const sections = sectionKeys.map(key => analyzeSection(key, answers, bmcAnswers))

  // Global score (weighted average)
  const weights = { impact_vise: 2.5, beneficiaires: 2, mesure_impact: 2.5, odd_contribution: 1.5, risques_defis: 1.5 }
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0)
  const weightedSum = sections.reduce((sum, section) => {
    return sum + section.score * (weights[section.key] ?? 1)
  }, 0)
  const scoreGlobal = Math.round((weightedSum / totalWeight) * 10) / 10

  // SMART check
  const smartCheck = checkSMART(answers)

  // Impact washing detection
  const washing = detectImpactWashing(answers)

  // ODD mapping
  const oddMappings = mapODD(answers)

  // Impact matrix
  const impactMatrix = buildImpactMatrix(answers, oddMappings)

  // BMC coherence
  const bmcCoherenceIssues: string[] = []
  if (bmcAnswers) {
    const bmcProposition = bmcAnswers.get(4) ?? ''
    const sicImpact = answers.get(1) ?? ''
    if (bmcProposition && sicImpact) {
      const bmcKeywords = bmcProposition.toLowerCase().split(/\s+/).filter(w => w.length > 5)
      const sicKeywords = sicImpact.toLowerCase().split(/\s+/).filter(w => w.length > 5)
      const overlap = bmcKeywords.filter(w => sicKeywords.some(sw => sw.includes(w) || w.includes(sw)))
      if (overlap.length === 0 && bmcProposition.length > 30 && sicImpact.length > 30) {
        bmcCoherenceIssues.push('La proposition de valeur BMC et le probleme social SIC semblent deconnectes. Verifiez l\'alignement.')
      }
    }

    const bmcSegments = bmcAnswers.get(7) ?? ''
    const sicBeneficiaries = answers.get(4) ?? ''
    if (bmcSegments && sicBeneficiaries) {
      const segWords = bmcSegments.toLowerCase().split(/\s+/).filter(w => w.length > 5)
      const benWords = sicBeneficiaries.toLowerCase().split(/\s+/).filter(w => w.length > 5)
      const overlapBen = segWords.filter(w => benWords.some(sw => sw.includes(w) || w.includes(sw)))
      if (overlapBen.length === 0 && bmcSegments.length > 30 && sicBeneficiaries.length > 30) {
        bmcCoherenceIssues.push('Les segments clients BMC et les beneficiaires SIC semblent differents. Est-ce voulu ?')
      }
    }
  }

  const scoreCoherenceBmc = bmcCoherenceIssues.length === 0 ? 8.0 : Math.max(4.0, 8.0 - bmcCoherenceIssues.length * 2)

  // Recommendations
  const recommendations: string[] = []
  for (const section of sections) {
    if (section.score < 5) {
      recommendations.push(`Ameliorez la section "${section.label}" (score: ${section.score}/10).`)
    }
    recommendations.push(...section.warnings)
  }
  if (smartCheck.score < 4) {
    recommendations.push(`Indicateur non SMART (${smartCheck.score}/5). ${smartCheck.feedback}`)
  }
  if (washing.risk !== 'faible') {
    recommendations.push(`Risque d'impact washing ${washing.risk}. Ajoutez des preuves concretes.`)
  }
  if (oddMappings.length === 0) {
    recommendations.push('Aucun ODD identifie. Selectionnez 2-3 ODD pertinents.')
  }
  if (impactMatrix.prouve.length === 0) {
    recommendations.push('Aucun impact prouve. Prevoyez un audit externe ou des certifications.')
  }

  // Verdict
  let verdict: string
  if (scoreGlobal >= 8) {
    verdict = 'Excellent : Impact social bien structure, mesurable et credible. Pret pour un comite d\'investissement.'
  } else if (scoreGlobal >= 6) {
    verdict = 'Bien : Impact social correctement formalise. Quelques ameliorations recommandees avant presentation.'
  } else if (scoreGlobal >= 4) {
    verdict = 'A ameliorer : Impact social insuffisamment documente. Travaillez les indicateurs et les preuves.'
  } else {
    verdict = 'Insuffisant : Impact social peu credible en l\'etat. Reprenez les fondamentaux (probleme, beneficiaires, mesure).'
  }

  return {
    sections,
    scoreGlobal,
    scoreCoherenceBmc,
    impactMatrix,
    oddMappings,
    impactWashingRisk: washing.risk,
    impactWashingSignals: washing.signals,
    smartCheck,
    bmcCoherenceIssues,
    recommendations,
    verdict,
    timestamp: new Date().toISOString()
  }
}

// ═══════════════════════════════════════════════════════════════
// HTML Diagnostic Generator
// ═══════════════════════════════════════════════════════════════
export function generateSicDiagnosticHtml(
  analysis: SicAnalysisResult,
  projectName: string,
  entrepreneurName: string
): string {
  const { sections, scoreGlobal, impactMatrix, oddMappings, smartCheck, impactWashingRisk, impactWashingSignals, bmcCoherenceIssues, recommendations, verdict } = analysis

  const scoreColor = scoreGlobal >= 8 ? '#059669' : scoreGlobal >= 6 ? '#0284c7' : scoreGlobal >= 4 ? '#d97706' : '#dc2626'
  const riskColor = impactWashingRisk === 'faible' ? '#059669' : impactWashingRisk === 'moyen' ? '#d97706' : '#dc2626'

  const oddBadges = oddMappings.map(odd => {
    const color = ODD_ICONS[odd.oddNumber] ?? '#666'
    const evBadge = odd.evidenceLevel === 'prouve' ? '&#10003; Prouve' : odd.evidenceLevel === 'mesure' ? '&#9672; Mesure' : '&#9679; Declare'
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;border:1px solid ${color}20;background:${color}08;">
      <div style="width:40px;height:40px;border-radius:8px;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;">${odd.oddNumber}</div>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${odd.oddLabel}</div>
        <div style="font-size:11px;color:#666;margin-top:2px;">
          ${odd.contributionType === 'direct' ? 'Direct' : 'Indirect'} &middot; ${evBadge} &middot; Score: ${odd.score}/3
        </div>
      </div>
    </div>`
  }).join('')

  const sectionRows = sections.map(s => {
    const barColor = s.score >= 7 ? '#059669' : s.score >= 5 ? '#0284c7' : s.score >= 3 ? '#d97706' : '#dc2626'
    const feedbackHtml = [...s.strengths.map(f => `<div style="color:#059669;font-size:12px;">&#10003; ${f}</div>`),
      ...s.warnings.map(f => `<div style="color:#d97706;font-size:12px;">&#9888; ${f}</div>`),
      ...s.feedback.map(f => `<div style="color:#666;font-size:12px;">&#8226; ${f}</div>`)].join('')
    return `<div style="padding:12px;border-radius:8px;border:1px solid rgba(0,0,0,0.08);margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-weight:600;font-size:14px;">${s.label}</span>
        <span style="font-weight:700;color:${barColor};">${s.score}/10</span>
      </div>
      <div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:8px;">
        <div style="height:100%;width:${s.percentage}%;background:${barColor};border-radius:3px;"></div>
      </div>
      ${feedbackHtml}
    </div>`
  }).join('')

  const smartItems = [
    { label: 'Specifique', ok: smartCheck.isSpecific },
    { label: 'Mesurable', ok: smartCheck.isMeasurable },
    { label: 'Atteignable', ok: smartCheck.isAttainable },
    { label: 'Relevant', ok: smartCheck.isRelevant },
    { label: 'Temporel', ok: smartCheck.isTimeBound }
  ].map(item => `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${item.ok ? '#dcfce7' : '#fee2e2'};color:${item.ok ? '#166534' : '#991b1b'};">${item.ok ? '&#10003;' : '&#10007;'} ${item.label}</span>`).join(' ')

  const matrixHtml = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
    <div style="padding:12px;border-radius:8px;background:#fef9c3;border:1px solid #fde047;">
      <div style="font-weight:700;font-size:13px;color:#854d0e;margin-bottom:6px;">&#9679; Intentionnel</div>
      ${impactMatrix.intentionnel.map(i => `<div style="font-size:11px;color:#713f12;margin-bottom:4px;">- ${i}</div>`).join('') || '<div style="font-size:11px;color:#999;">Aucun element</div>'}
    </div>
    <div style="padding:12px;border-radius:8px;background:#dbeafe;border:1px solid #93c5fd;">
      <div style="font-weight:700;font-size:13px;color:#1e40af;margin-bottom:6px;">&#9672; Mesure</div>
      ${impactMatrix.mesure.map(i => `<div style="font-size:11px;color:#1e3a5f;margin-bottom:4px;">- ${i}</div>`).join('') || '<div style="font-size:11px;color:#999;">Aucun element</div>'}
    </div>
    <div style="padding:12px;border-radius:8px;background:#dcfce7;border:1px solid #86efac;">
      <div style="font-weight:700;font-size:13px;color:#166534;margin-bottom:6px;">&#10003; Prouve</div>
      ${impactMatrix.prouve.map(i => `<div style="font-size:11px;color:#14532d;margin-bottom:4px;">- ${i}</div>`).join('') || '<div style="font-size:11px;color:#999;">Aucun element</div>'}
    </div>
  </div>`

  const recoHtml = recommendations.slice(0, 8).map(r => `<li style="margin-bottom:6px;font-size:13px;">${r}</li>`).join('')

  const washingSignals = impactWashingSignals.map(s => `<div style="font-size:12px;color:${riskColor};margin-bottom:4px;">&#9888; ${s}</div>`).join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagnostic SIC - ${projectName}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter','IBM Plex Sans',system-ui,sans-serif; background:#f8fafc; color:#1e293b; line-height:1.6; }
    .container { max-width:900px; margin:0 auto; padding:32px 24px; }
    .header { text-align:center; margin-bottom:32px; }
    .header h1 { font-size:28px; color:#1e3a5f; margin-bottom:8px; }
    .header p { color:#64748b; font-size:14px; }
    .card { background:white; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
    .card h2 { font-size:18px; color:#1e3a5f; margin-bottom:16px; display:flex; align-items:center; gap:8px; }
    .score-hero { display:flex; align-items:center; gap:24px; }
    .score-circle { width:120px; height:120px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-size:32px; font-weight:800; }
    .score-circle small { font-size:12px; font-weight:400; opacity:0.9; }
    .verdict-box { padding:16px; border-radius:8px; margin-top:16px; font-size:14px; }
    @media print { body { background:white; } .container { padding:16px; } .card { box-shadow:none; border:1px solid #e5e7eb; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>&#127758; Diagnostic Social Impact Canvas</h1>
      <p>${entrepreneurName} &middot; ${projectName} &middot; ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>

    <div class="card">
      <div class="score-hero">
        <div class="score-circle" style="background:${scoreColor};">
          ${scoreGlobal}
          <small>/10</small>
        </div>
        <div style="flex:1;">
          <h2 style="margin-bottom:8px;">Score d'Impact Global</h2>
          <div class="verdict-box" style="background:${scoreColor}10;border-left:4px solid ${scoreColor};color:${scoreColor};">
            ${verdict}
          </div>
          <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;">
            <span style="font-size:12px;padding:4px 10px;border-radius:20px;background:${riskColor}15;color:${riskColor};font-weight:600;">Impact washing: ${impactWashingRisk}</span>
            <span style="font-size:12px;padding:4px 10px;border-radius:20px;background:#0284c715;color:#0284c7;font-weight:600;">SMART: ${smartCheck.score}/5</span>
            <span style="font-size:12px;padding:4px 10px;border-radius:20px;background:#7c3aed15;color:#7c3aed;font-weight:600;">ODD: ${oddMappings.length} cibles</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>&#128202; Scores par Section</h2>
      ${sectionRows}
    </div>

    <div class="card">
      <h2>&#127919; Matrice d'Impact</h2>
      <p style="font-size:13px;color:#64748b;margin-bottom:12px;">Niveau de maturite de votre impact : de l'intention a la preuve.</p>
      ${matrixHtml}
    </div>

    <div class="card">
      <h2>&#127760; Alignement ODD</h2>
      <p style="font-size:13px;color:#64748b;margin-bottom:12px;">${oddMappings.length} ODD identifies avec niveau de contribution.</p>
      <div style="display:grid;gap:8px;">
        ${oddBadges || '<p style="color:#999;">Aucun ODD identifie. Completez la section ODD & Contribution.</p>'}
      </div>
    </div>

    <div class="card">
      <h2>&#128269; Verification SMART</h2>
      <p style="font-size:13px;color:#64748b;margin-bottom:12px;">${smartCheck.feedback}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${smartItems}
      </div>
    </div>

    ${impactWashingSignals.length > 0 ? `<div class="card">
      <h2 style="color:${riskColor};">&#9888; Signaux d'Impact Washing</h2>
      <p style="font-size:13px;color:#64748b;margin-bottom:12px;">Risque: <strong style="color:${riskColor};">${impactWashingRisk}</strong></p>
      ${washingSignals}
    </div>` : ''}

    ${bmcCoherenceIssues.length > 0 ? `<div class="card">
      <h2>&#128279; Coherence BMC ↔ SIC</h2>
      ${bmcCoherenceIssues.map(i => `<div style="font-size:13px;color:#d97706;margin-bottom:6px;">&#9888; ${i}</div>`).join('')}
    </div>` : ''}

    <div class="card">
      <h2>&#128161; Recommandations</h2>
      <ol style="padding-left:20px;">
        ${recoHtml}
      </ol>
    </div>

    <div style="text-align:center;padding:24px;color:#94a3b8;font-size:12px;">
      Genere par ESONO Investment Readiness &middot; Module 2 SIC &middot; ${new Date().toISOString().slice(0, 10)}
    </div>
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════
// Score label helper
// ═══════════════════════════════════════════════════════════════
export function getSicScoreLabel(score: number): { label: string, color: string } {
  if (score >= 8) return { label: 'Excellent', color: 'green' }
  if (score >= 6) return { label: 'Bien', color: 'blue' }
  if (score >= 4) return { label: 'A ameliorer', color: 'yellow' }
  return { label: 'Insuffisant', color: 'red' }
}
