// ═══════════════════════════════════════════════════════════════
// SIC Deliverable Engine — Claude AI + Fallback Rule Engine
// Réplique du format SIC_GOTCHE_FINAL.pdf
// Claude AI génère l'analyse complète quand disponible,
// sinon fallback vers le moteur de règles existant.
// ═══════════════════════════════════════════════════════════════

import type { SicAnalysisResult, SicOddMapping } from './sic-engine'
import { ODD_LABELS, ODD_ICONS, SIC_SECTION_LABELS } from './sic-engine'
import { callClaudeJSON, isValidApiKey, type KBContext } from './claude-api'
import type { SicAnalystResult } from './sic-analyst'

// ─── Types ───
export interface SicDeliverableData {
  companyName: string
  entrepreneurName: string
  sector: string
  location: string
  country: string
  analysis: SicAnalysisResult
  answers: Map<number, string>
  bmcAnswers?: Map<number, string>
  apiKey?: string
  kbContext?: KBContext
}

interface TheoryOfChange {
  probleme: string
  activites: string
  outputs: string
  outcomes: string
  impact: string
}

interface OutcomeRow {
  horizon: string
  horizonLabel: string
  changement: string
  indicateur: string
}

interface StakeholderRow {
  nom: string
  role: string
  niveau: 'Élevé' | 'Moyen' | 'Faible'
}

interface SwotData {
  forces: string[]
  faiblesses: string[]
  opportunites: string[]
  menaces: string[]
}

interface EvolutionScore {
  critere: string
  scoreActuel: number
  scoreApres: number
  actionCle: string
}

// ─── Color Palette (from PDF analysis) ───
const COLORS = {
  primary: '#1b5e20',        // Dark green
  primaryLight: '#2e7d32',   // Medium green
  primaryBg: '#e8f5e9',      // Light green bg
  accent: '#1565c0',         // Blue
  accentLight: '#e3f2fd',
  orange: '#f57f17',
  orangeLight: '#fff8e1',
  red: '#d84315',
  redLight: '#fbe9e7',
  textDark: '#2d3748',
  textMedium: '#555555',
  textLight: '#888888',
  textMuted: '#999999',
  bgCard: '#ffffff',
  bgPage: '#f8fafb',
  border: 'rgba(0,0,0,0.08)',
  highlight: '#a5d6a7',
}

// ─── Helper: Extract structured data from SIC answers ───
function extractSicData(answers: Map<number, string>) {
  return {
    problemeSocial: answers.get(1) ?? '',
    transformationVisee: answers.get(2) ?? '',
    impactVise: answers.get(3) ?? '',
    beneficiaires: answers.get(4) ?? '',
    nombreBeneficiaires: answers.get(5) ?? '',
    profilBeneficiaires: answers.get(6) ?? '',
    kpiImpact: answers.get(7) ?? '',
    baselineImpact: answers.get(8) ?? '',
    methodeMesure: answers.get(9) ?? '',
    frequenceMesure: answers.get(10) ?? '',
    oddCibles: answers.get(11) ?? '',
    contributionOdd: answers.get(12) ?? '',
    evidenceOdd: answers.get(13) ?? '',
    risques: answers.get(14) ?? '',
    attenuation: answers.get(15) ?? '',
  }
}

// ─── Helper: Parse beneficiary numbers ───
function parseBeneficiaryNumbers(text: string): { directs: number, indirects: number, total: number } {
  const numbers = text.match(/(\d[\d\s,.]*)/g)?.map(n => parseInt(n.replace(/[\s,.]/g, ''))) ?? []
  const sorted = numbers.filter(n => n > 0).sort((a, b) => b - a)
  if (sorted.length >= 2) {
    return { directs: sorted[1], indirects: sorted[0] - sorted[1], total: sorted[0] }
  } else if (sorted.length === 1) {
    return { directs: sorted[0], indirects: Math.round(sorted[0] * 3), total: sorted[0] * 4 }
  }
  return { directs: 0, indirects: 0, total: 0 }
}

// ─── Helper: Format number with spaces ───
function formatNumber(n: number): string {
  if (n === 0) return '—'
  return n.toLocaleString('fr-FR')
}

// ─── Helper: Extract bullet points from text ───
function extractBullets(text: string): string[] {
  if (!text) return []
  const lines = text.split(/[\n\r]+|[•\-–]\s*|\d+[\.\)]\s*/).map(l => l.trim()).filter(l => l.length > 5)
  if (lines.length <= 1 && text.length > 50) {
    // Split by sentences
    return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10).slice(0, 6)
  }
  return lines.slice(0, 8)
}

// ─── Helper: Build Theory of Change ───
function buildTheoryOfChange(data: ReturnType<typeof extractSicData>): TheoryOfChange {
  const probleme = data.problemeSocial ? extractBullets(data.problemeSocial)[0] ?? 'Problème social identifié' : 'Problème social identifié'
  const activites = data.transformationVisee ? extractBullets(data.transformationVisee)[0] ?? 'Activités à impact' : 'Activités à impact'
  
  // Extract outputs from KPI or transformation
  const outputs = data.kpiImpact 
    ? extractBullets(data.kpiImpact)[0] ?? 'Outputs mesurables'
    : 'Outputs à définir'
  
  const outcomes = data.baselineImpact
    ? extractBullets(data.baselineImpact)[0] ?? 'Résultats attendus'
    : 'Résultats à mesurer'
  
  const impact = data.impactVise
    ? extractBullets(data.impactVise)[0] ?? 'Impact social visé'
    : 'Impact social visé'
  
  return { probleme, activites, outputs, outcomes, impact }
}

// ─── Helper: Build Outcomes table ───
function buildOutcomes(data: ReturnType<typeof extractSicData>): OutcomeRow[] {
  const outcomes: OutcomeRow[] = []
  const kpiBullets = extractBullets(data.kpiImpact)
  const baselineBullets = extractBullets(data.baselineImpact)
  
  outcomes.push({
    horizon: '0-12 mois',
    horizonLabel: 'Court terme',
    changement: kpiBullets[0] ?? 'Premier résultat mesurable à définir',
    indicateur: baselineBullets[0] ?? 'Indicateur à définir'
  })
  
  outcomes.push({
    horizon: '1-3 ans',
    horizonLabel: 'Moyen terme',
    changement: kpiBullets[1] ?? 'Extension de la couverture et consolidation',
    indicateur: baselineBullets[1] ?? 'Taux de couverture (%)'
  })
  
  outcomes.push({
    horizon: '3-5 ans',
    horizonLabel: 'Long terme',
    changement: data.impactVise ? extractBullets(data.impactVise)[0] ?? 'Impact systémique à long terme' : 'Impact systémique à long terme',
    indicateur: 'Enquêtes terrain / données sectorielles'
  })
  
  return outcomes
}

// ─── Helper: Build Stakeholders ───
function buildStakeholders(data: ReturnType<typeof extractSicData>): StakeholderRow[] {
  const stakeholders: StakeholderRow[] = []
  
  stakeholders.push({
    nom: '👥 Bénéficiaires',
    role: 'Satisfont leurs besoins d\'accès aux produits/services à impact',
    niveau: 'Élevé'
  })
  
  stakeholders.push({
    nom: '🏛️ Collectivités / Autorités',
    role: 'Soutien institutionnel, autorisations, intégration dans les politiques locales',
    niveau: 'Moyen'
  })
  
  stakeholders.push({
    nom: '🤝 Partenaires privés',
    role: 'Expertise technique et accompagnement pour la réussite du projet',
    niveau: 'Élevé'
  })
  
  stakeholders.push({
    nom: '💰 Financeurs / Bailleurs',
    role: 'Financent les infrastructures à fort impact, assurent durabilité',
    niveau: 'Élevé'
  })
  
  if (data.profilBeneficiaires) {
    const benefBullets = extractBullets(data.profilBeneficiaires)
    if (benefBullets.length > 1) {
      stakeholders.push({
        nom: '🌾 Partenaires locaux',
        role: benefBullets[1] ?? 'Fournisseurs et acteurs de la chaîne locale',
        niveau: 'Élevé'
      })
    }
  }
  
  return stakeholders
}

// ─── Helper: Build SWOT ───
function buildSwot(analysis: SicAnalysisResult, data: ReturnType<typeof extractSicData>): SwotData {
  const forces: string[] = []
  const faiblesses: string[] = []
  const opportunites: string[] = []
  const menaces: string[] = []
  
  // Forces from strengths
  for (const section of analysis.sections) {
    if (section.score >= 7) {
      forces.push(`Section "${section.label}" bien documentée (${section.score}/10)`)
    }
    for (const s of section.strengths) {
      forces.push(s)
    }
  }
  if (analysis.oddMappings.length >= 3) {
    forces.push(`${analysis.oddMappings.length} ODD adressés de manière cohérente`)
  }
  if (analysis.smartCheck.score >= 4) {
    forces.push('Indicateurs SMART bien définis')
  }
  if (analysis.impactWashingRisk === 'faible') {
    forces.push('Faible risque d\'impact washing — crédibilité solide')
  }
  if (data.problemeSocial.length > 100) {
    forces.push('Problème social clair et bien identifié')
  }
  
  // Faiblesses from warnings
  for (const section of analysis.sections) {
    if (section.score < 5) {
      faiblesses.push(`Section "${section.label}" insuffisante (${section.score}/10)`)
    }
    for (const w of section.warnings) {
      faiblesses.push(w)
    }
  }
  if (analysis.smartCheck.score < 3) {
    faiblesses.push('Indicateurs de mesure non SMART')
  }
  if (analysis.impactMatrix.prouve.length === 0) {
    faiblesses.push('Aucun impact prouvé par des données externes')
  }
  if (!data.baselineImpact || data.baselineImpact.length < 30) {
    faiblesses.push('Pas de données de référence (baseline) avant intervention')
  }
  
  // Opportunités
  opportunites.push('Forte demande en impact social en Afrique de l\'Ouest')
  opportunites.push('Alignement avec les priorités gouvernementales (souveraineté)')
  opportunites.push('Potentiel de réplication dans d\'autres régions / pays')
  if (analysis.oddMappings.length > 0) {
    opportunites.push('Éligibilité aux fonds d\'impact investing (ODD ciblés)')
  }
  opportunites.push('Partenariats possibles avec ONG et organisations internationales')
  opportunites.push('Labellisation impact (B Corp, ESG) pour renforcer la crédibilité')
  
  // Menaces
  const riskBullets = extractBullets(data.risques)
  menaces.push(...riskBullets.slice(0, 3))
  if (menaces.length < 3) {
    menaces.push('Capacité de financement pour les infrastructures')
    menaces.push('Changement climatique et facteurs externes')
  }
  menaces.push('Concurrence et pressions du marché')
  
  return {
    forces: forces.slice(0, 6),
    faiblesses: faiblesses.slice(0, 6),
    opportunites: opportunites.slice(0, 6),
    menaces: menaces.slice(0, 6)
  }
}

// ─── Helper: Build Evolution Scores ───
function buildEvolutionScores(analysis: SicAnalysisResult): EvolutionScore[] {
  return analysis.sections.map(sec => {
    const afterScore = Math.min(10, Math.round((sec.score + (10 - sec.score) * 0.5) * 10) / 10)
    let actionCle = ''
    switch (sec.key) {
      case 'impact_vise':
        actionCle = 'Ajouter données chiffrées et preuves quantitatives'
        break
      case 'beneficiaires':
        actionCle = 'Affiner les chiffres avec données terrain réelles'
        break
      case 'mesure_impact':
        actionCle = 'Baseline + KPIs chiffrés + méthodologie M&E'
        break
      case 'odd_contribution':
        actionCle = 'Documenter contribution avec chiffres par ODD'
        break
      case 'risques_defis':
        actionCle = 'Plan de contingence formalisé + budget dédié'
        break
    }
    return {
      critere: sec.label,
      scoreActuel: Math.round(sec.score * 10),
      scoreApres: Math.round(afterScore * 10),
      actionCle
    }
  })
}

// ─── Maturity Level ───
function getMaturityLevel(score: number): { level: string, index: number, phases: string[] } {
  const phases = ['Idée', 'Test/Pilote', 'Déployé', 'Mesuré', 'Scalé']
  let index = 0
  if (score >= 8) index = 4
  else if (score >= 6.5) index = 3
  else if (score >= 5) index = 2
  else if (score >= 3) index = 1
  return { level: phases[index], index, phases }
}

// ─── Score Status Label ───
function getScoreStatusLabel(score: number): { label: string, description: string } {
  if (score >= 8) return { label: 'Impact Solide', description: 'Impact social bien structuré, mesurable et crédible. Prêt pour un comité d\'investissement.' }
  if (score >= 6) return { label: 'Impact Prometteur', description: 'Impact social correctement formalisé. Quelques améliorations recommandées avant présentation.' }
  if (score >= 4) return { label: 'En Construction', description: 'Le projet porte un impact social réel et prometteur, mais la mesure et la structuration doivent être renforcées pour convaincre des bailleurs.' }
  return { label: 'Fondations', description: 'Impact social insuffisamment documenté. Travaillez les fondamentaux : problème, bénéficiaires et mesure.' }
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE AI — System prompt for SIC analysis
// ═══════════════════════════════════════════════════════════════

function buildSicSystemPrompt(kbContext?: KBContext): string {
  const kbBenchmarks = kbContext?.benchmarks || 'Aucun benchmark disponible.'
  const kbFiscal = kbContext?.fiscalParams || 'Pas de données fiscales disponibles.'
  const kbFunders = kbContext?.funders || 'Aucun bailleur enregistré.'
  const kbCriteria = kbContext?.criteria || 'Aucun critère disponible.'

  return `Tu es un expert senior en impact social et mesure d'impact pour les PME africaines (focus Côte d'Ivoire / Afrique de l'Ouest). Tu génères un diagnostic COMPLET du Social Impact Canvas à partir des 15 sections remplies par un entrepreneur.

TON OBJECTIF : Générer un JSON structuré qui alimente un livrable professionnel "Social Impact Assessment". Le résultat doit être riche, personnalisé, spécifique au secteur et adapté au contexte africain.

══════════════════════════════════════════════════════
BASE DE CONNAISSANCES — BENCHMARKS SECTORIELS :
══════════════════════════════════════════════════════
${kbBenchmarks}

══════════════════════════════════════════════════════
PARAMÈTRES FISCAUX & ÉCONOMIQUES :
══════════════════════════════════════════════════════
${kbFiscal}

══════════════════════════════════════════════════════
BAILLEURS DE FONDS & PROGRAMMES :
══════════════════════════════════════════════════════
${kbFunders}

══════════════════════════════════════════════════════
CRITÈRES D'ÉVALUATION :
══════════════════════════════════════════════════════
${kbCriteria}

SCORING PAR SECTION (0-10) :
- Clarté de l'impact visé (20%)
- Pertinence des bénéficiaires et quantification (20%)
- Qualité de la mesure d'impact (KPIs, baseline, méthode) (25%)
- Alignement ODD avec preuves (15%)
- Gestion des risques sociaux (20%)

RÈGLES :
1. Sois spécifique au contexte PME Afrique.
2. Cite les ODD pertinents avec numéros.
3. Les recommandations doivent être actionnables.
4. Extrais les données quantitatives mentionnées.
5. Compare avec les benchmarks sectoriels.
6. Cite les bailleurs pertinents.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "scoreGlobal": <number 0-10>,
  "syntheseGlobale": "<synthèse 3-4 phrases>",
  "sections": [
    { "key": "impact_vise", "score": <0-10>, "comment": "<analyse spécifique>" },
    { "key": "beneficiaires", "score": <0-10>, "comment": "<analyse>" },
    { "key": "mesure_impact", "score": <0-10>, "comment": "<analyse>" },
    { "key": "odd_contribution", "score": <0-10>, "comment": "<analyse>" },
    { "key": "risques_defis", "score": <0-10>, "comment": "<analyse>" }
  ],
  "strengths": ["<force 1>", "<force 2>", "<force 3>"],
  "weaknesses": ["<faiblesse 1>", "<faiblesse 2>"],
  "recommendations": ["<reco 1>", "<reco 2>", "<reco 3>", "<reco 4>", "<reco 5>"],
  "oddAlignments": [{ "odd": <number 1-17>, "description": "<contribution>" }],
  "theoryOfChange": {
    "probleme": "<problème social identifié>",
    "activites": "<activités de l'entreprise>",
    "outputs": "<résultats directs>",
    "outcomes": "<changements à moyen terme>",
    "impact": "<impact long terme>"
  },
  "stakeholders": [{ "nom": "<partie prenante>", "role": "<rôle>", "niveau": "Élevé|Moyen|Faible" }],
  "swot": {
    "forces": ["..."], "faiblesses": ["..."], "opportunites": ["..."], "menaces": ["..."]
  }
}`
}

function buildSicUserPrompt(answers: Map<number, string>, companyName: string, sector: string): string {
  const sections = [
    [1, 'Problème social adressé'],
    [2, 'Transformation visée'],
    [3, 'Impact visé'],
    [4, 'Bénéficiaires cibles'],
    [5, 'Nombre de bénéficiaires'],
    [6, 'Profil des bénéficiaires'],
    [7, 'KPIs d\'impact'],
    [8, 'Baseline d\'impact'],
    [9, 'Méthode de mesure'],
    [10, 'Fréquence de mesure'],
    [11, 'ODD cibles'],
    [12, 'Contribution ODD'],
    [13, 'Évidence ODD'],
    [14, 'Risques sociaux'],
    [15, 'Mesures d\'atténuation'],
  ] as const

  const parts = sections.map(([qId, label]) => {
    const answer = answers.get(qId)?.trim() || '(non renseigné)'
    return `SECTION ${qId} — ${label} :\n${answer}`
  })

  return `Entreprise : ${companyName || 'Non précisé'}\nSecteur : ${sector || 'Non précisé'}\n\nVoici les 15 sections du Social Impact Canvas :\n\n${parts.join('\n\n')}\n\nAnalyse ce SIC et génère le livrable JSON.`
}

async function analyzeSicWithAI(
  answers: Map<number, string>,
  companyName: string,
  sector: string,
  analysis: SicAnalysisResult,
  apiKey?: string,
  kbContext?: KBContext
): Promise<{ aiData: any | null, source: 'claude' | 'fallback' }> {
  if (!isValidApiKey(apiKey)) {
    console.log('[SIC Deliverable] No API key → using rule-based fallback')
    return { aiData: null, source: 'fallback' }
  }

  try {
    console.log('[SIC Deliverable] Calling Claude AI (with KB:', kbContext ? 'YES' : 'NO', ')...')
    const aiData = await callClaudeJSON({
      apiKey: apiKey!,
      systemPrompt: buildSicSystemPrompt(kbContext),
      userPrompt: buildSicUserPrompt(answers, companyName, sector),
      maxTokens: 6144,
      timeoutMs: 90_000,
      maxRetries: 2,
      label: 'SIC Deliverable'
    })
    console.log(`[SIC Deliverable] Claude AI success — Score: ${aiData.scoreGlobal}/10`)
    return { aiData, source: 'claude' }
  } catch (err: any) {
    console.error('[SIC Deliverable] Claude AI failed, using fallback:', err.message)
    return { aiData: null, source: 'fallback' }
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Generate Full SIC Deliverable HTML (async — Claude AI)
// ═══════════════════════════════════════════════════════════════
export async function generateFullSicDeliverable(data: SicDeliverableData): Promise<string> {
  // Try Claude AI first
  const { aiData, source } = await analyzeSicWithAI(
    data.answers, data.companyName, data.sector, data.analysis, data.apiKey, data.kbContext
  )

  // If Claude succeeded, enrich the analysis with AI data
  if (aiData && source === 'claude') {
    // Override analysis scores with AI scores
    if (typeof aiData.scoreGlobal === 'number') {
      data.analysis.scoreGlobal = aiData.scoreGlobal
    }
    if (Array.isArray(aiData.sections)) {
      for (const s of aiData.sections) {
        const section = data.analysis.sections?.find((sec: any) => sec.key === s.key)
        if (section) {
          section.score = s.score ?? section.score
          section.comment = s.comment || section.comment
        }
      }
    }
    if (Array.isArray(aiData.recommendations)) {
      data.analysis.recommendations = aiData.recommendations
    }
    if (Array.isArray(aiData.oddAlignments)) {
      data.analysis.oddMappings = aiData.oddAlignments.map((o: any) => ({
        odd_number: o.odd,
        description: o.description,
        contribution_level: 'direct' as const
      }))
    }
  }

  return _renderSicDeliverable(data, source)
}

// Synchronous fallback (no Claude AI)
export function generateFullSicDeliverableFallback(data: SicDeliverableData): string {
  return _renderSicDeliverable(data, 'fallback')
}

function _renderSicDeliverable(data: SicDeliverableData, source: 'claude' | 'fallback'): string {
  const { companyName, entrepreneurName, sector, location, country, analysis, answers } = data
  
  // Defensive: ensure impactMatrix has required arrays
  if (!analysis.impactMatrix || !Array.isArray(analysis.impactMatrix.intentionnel)) {
    analysis.impactMatrix = { intentionnel: [], mesure: [], prouve: [] }
  }
  if (!Array.isArray(analysis.impactMatrix.mesure)) analysis.impactMatrix.mesure = []
  if (!Array.isArray(analysis.impactMatrix.prouve)) analysis.impactMatrix.prouve = []
  if (!Array.isArray(analysis.sections)) analysis.sections = []
  if (!Array.isArray(analysis.oddMappings)) analysis.oddMappings = []
  if (!Array.isArray(analysis.impactWashingSignals)) analysis.impactWashingSignals = []
  if (!Array.isArray(analysis.bmcCoherenceIssues)) analysis.bmcCoherenceIssues = []
  if (!Array.isArray(analysis.recommendations)) analysis.recommendations = []
  
  const sicData = extractSicData(answers)
  const benefNumbers = parseBeneficiaryNumbers(sicData.nombreBeneficiaires)
  const theoryOfChange = buildTheoryOfChange(sicData)
  const outcomes = buildOutcomes(sicData)
  const stakeholders = buildStakeholders(sicData)
  const swot = buildSwot(analysis, sicData)
  const evolutionScores = buildEvolutionScores(analysis)
  const maturity = getMaturityLevel(analysis.scoreGlobal)
  const statusLabel = getScoreStatusLabel(analysis.scoreGlobal)
  
  const scorePercent = Math.round(analysis.scoreGlobal * 10)
  const scoreColor = analysis.scoreGlobal >= 8 ? COLORS.primaryLight : analysis.scoreGlobal >= 6 ? COLORS.accent : analysis.scoreGlobal >= 4 ? COLORS.orange : COLORS.red

  const totalAfter = evolutionScores.reduce((s, e) => s + e.scoreApres, 0) / evolutionScores.length
  const totalBefore = evolutionScores.reduce((s, e) => s + e.scoreActuel, 0) / evolutionScores.length
  const statusAfter = totalAfter >= 80 ? 'Solide' : totalAfter >= 60 ? 'Prometteur' : 'En construction'

  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const monthYear = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const locationStr = [location, country].filter(Boolean).join(' — ')
  const sectorStr = sector || 'Secteur non précisé'

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Social Impact Canvas — ${companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: ${COLORS.primary};
      --primary-light: ${COLORS.primaryLight};
      --primary-bg: ${COLORS.primaryBg};
      --accent: ${COLORS.accent};
      --accent-light: ${COLORS.accentLight};
      --orange: ${COLORS.orange};
      --orange-light: ${COLORS.orangeLight};
      --red: ${COLORS.red};
      --red-light: ${COLORS.redLight};
      --text-dark: ${COLORS.textDark};
      --text-medium: ${COLORS.textMedium};
      --text-light: ${COLORS.textLight};
      --text-muted: ${COLORS.textMuted};
      --bg-card: ${COLORS.bgCard};
      --bg-page: ${COLORS.bgPage};
      --border: ${COLORS.border};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: var(--bg-page); color: var(--text-dark); line-height: 1.6; }
    
    .sic-container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    
    /* ─── HEADER BANNER ─── */
    .sic-header {
      background: linear-gradient(135deg, #1a3a2a 0%, #1b5e20 40%, #2e7d32 100%);
      padding: 48px 0 56px;
      color: white;
      position: relative;
      overflow: hidden;
    }
    .sic-header::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -10%;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      background: rgba(255,255,255,0.04);
    }
    .sic-header::after {
      content: '';
      position: absolute;
      bottom: -30%;
      left: 20%;
      width: 300px;
      height: 300px;
      border-radius: 50%;
      background: rgba(255,255,255,0.03);
    }
    .sic-header__inner { position: relative; z-index: 1; }
    .sic-header__icon {
      width: 56px; height: 56px;
      background: rgba(255,255,255,0.15);
      border-radius: 16px;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px;
      margin-bottom: 16px;
      backdrop-filter: blur(8px);
    }
    .sic-header__title { font-size: 36px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
    .sic-header__subtitle { font-size: 17px; font-weight: 300; opacity: 0.9; margin-bottom: 6px; }
    .sic-header__meta { font-size: 15px; font-weight: 500; opacity: 0.85; }
    .sic-header__footer {
      margin-top: 24px;
      font-size: 12px;
      opacity: 0.6;
      display: flex; align-items: center; gap: 12px;
    }
    
    /* ─── SCORE HERO ─── */
    .sic-score-hero {
      background: var(--bg-card);
      border-radius: 20px;
      margin: -36px 24px 0;
      position: relative;
      z-index: 10;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
      padding: 36px 40px;
    }
    .sic-score-hero__grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 32px;
      align-items: center;
    }
    .sic-score-circle {
      width: 140px; height: 140px;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: white;
      position: relative;
    }
    .sic-score-circle__value { font-size: 42px; font-weight: 800; line-height: 1; }
    .sic-score-circle__unit { font-size: 14px; font-weight: 400; opacity: 0.85; margin-top: 2px; }
    .sic-score-status { font-size: 24px; font-weight: 700; color: var(--primary); margin-bottom: 8px; }
    .sic-score-desc { font-size: 15px; color: var(--text-medium); line-height: 1.6; margin-bottom: 16px; }
    .sic-score-bars { display: flex; gap: 16px; flex-wrap: wrap; }
    .sic-score-bar { flex: 1; min-width: 140px; }
    .sic-score-bar__label { font-size: 13px; color: var(--text-light); margin-bottom: 4px; display: flex; justify-content: space-between; }
    .sic-score-bar__track { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; }
    .sic-score-bar__fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
    
    /* ─── SYNTHESIS ─── */
    .sic-synthesis {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-section-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .sic-synthesis__text { font-size: 15px; color: var(--text-dark); line-height: 1.7; }
    .sic-synthesis__text strong { color: var(--text-dark); font-weight: 700; }
    
    /* ─── KPI Cards ─── */
    .sic-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-top: 24px;
    }
    .sic-kpi-card {
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .sic-kpi-card__value { font-size: 32px; font-weight: 800; line-height: 1; margin-bottom: 6px; }
    .sic-kpi-card__label { font-size: 13px; color: var(--text-light); }
    
    /* ─── CANVAS GRID ─── */
    .sic-canvas {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-canvas-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
    }
    .sic-canvas-cell {
      padding: 20px;
      border: 1px solid #e2e8f0;
      min-height: 160px;
    }
    .sic-canvas-cell__header {
      font-size: 13px;
      font-weight: 700;
      color: white;
      padding: 6px 12px;
      border-radius: 6px;
      margin-bottom: 12px;
      display: inline-block;
    }
    .sic-canvas-cell__bullet { font-size: 13px; color: var(--text-dark); margin-bottom: 6px; line-height: 1.5; }
    .sic-canvas-cell__bullet::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: var(--text-light); margin-right: 8px; vertical-align: middle; }
    
    /* ─── INDICATORS ─── */
    .sic-indicators {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-indicators-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .sic-indicator-card {
      border-radius: 12px;
      padding: 20px;
      border: 1px solid var(--border);
      background: #fafbfc;
    }
    .sic-indicator-card__title { font-size: 14px; font-weight: 700; color: var(--text-dark); margin-bottom: 8px; }
    .sic-indicator-card__text { font-size: 13px; color: var(--text-medium); line-height: 1.6; }
    
    /* ─── RISKS ─── */
    .sic-risks {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-risks-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    .sic-risk-col__title { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
    .sic-risk-item { font-size: 13px; color: var(--text-dark); margin-bottom: 8px; padding-left: 20px; position: relative; line-height: 1.5; }
    .sic-risk-item::before { content: ''; position: absolute; left: 0; top: 8px; width: 8px; height: 8px; border-radius: 50%; }
    .sic-risk-item--risk::before { background: var(--red); }
    .sic-risk-item--mitigation::before { background: var(--primary-light); }
    
    /* ─── THEORY OF CHANGE ─── */
    .sic-toc {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-toc-flow {
      display: flex;
      align-items: stretch;
      gap: 0;
      margin-top: 16px;
    }
    .sic-toc-step {
      flex: 1;
      text-align: center;
      padding: 20px 12px;
      border-radius: 12px;
      position: relative;
    }
    .sic-toc-step__label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .sic-toc-step__text { font-size: 13px; line-height: 1.5; }
    .sic-toc-arrow {
      display: flex;
      align-items: center;
      font-size: 24px;
      color: var(--text-muted);
      padding: 0 4px;
    }
    
    /* ─── OUTCOMES TABLE ─── */
    .sic-outcomes {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-table { width: 100%; border-collapse: collapse; }
    .sic-table th {
      background: var(--primary);
      color: white;
      padding: 12px 16px;
      text-align: left;
      font-size: 13px;
      font-weight: 600;
    }
    .sic-table th:first-child { border-radius: 8px 0 0 0; }
    .sic-table th:last-child { border-radius: 0 8px 0 0; }
    .sic-table td {
      padding: 14px 16px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 13px;
      color: var(--text-dark);
      vertical-align: top;
    }
    .sic-table tr:last-child td { border-bottom: none; }
    .sic-table tr:nth-child(even) td { background: #fafbfc; }
    
    /* ─── ODD DETAIL ─── */
    .sic-odd {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-odd-table { width: 100%; border-collapse: collapse; }
    .sic-odd-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      color: white;
      font-weight: 700;
      font-size: 14px;
    }
    .sic-odd-stars { display: flex; gap: 2px; }
    .sic-odd-star { width: 16px; height: 16px; border-radius: 50%; }
    .sic-odd-star--filled { background: var(--primary-light); }
    .sic-odd-star--empty { background: #e0e0e0; }
    
    /* ─── STAKEHOLDERS ─── */
    .sic-stakeholders {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-stake-level {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    
    /* ─── ALIGNMENT ─── */
    .sic-alignment {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-alignment__bullet { font-size: 14px; color: var(--text-dark); line-height: 1.7; margin-bottom: 8px; }
    .sic-alignment__bullet strong { color: var(--primary); }
    
    /* ─── SWOT ─── */
    .sic-swot {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-swot-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .sic-swot-cell {
      border-radius: 12px;
      padding: 20px;
      min-height: 180px;
    }
    .sic-swot-cell__title { font-size: 14px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .sic-swot-cell__item {
      font-size: 13px;
      margin-bottom: 6px;
      padding-left: 16px;
      position: relative;
      line-height: 1.5;
    }
    .sic-swot-cell__item::before {
      content: '→';
      position: absolute;
      left: 0;
      font-weight: 700;
    }
    
    /* ─── RECOMMENDATIONS ─── */
    .sic-recos {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-reco-card {
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      border-left: 4px solid;
    }
    .sic-reco-card__priority { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .sic-reco-card__title { font-size: 15px; font-weight: 700; color: var(--text-dark); margin-bottom: 8px; }
    .sic-reco-card__text { font-size: 13px; color: var(--text-medium); line-height: 1.6; }
    
    /* ─── EVOLUTION TABLE ─── */
    .sic-evolution {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    
    /* ─── MATURITY ─── */
    .sic-maturity {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 32px;
      margin: 24px 0;
      border: 1px solid var(--border);
    }
    .sic-maturity-track {
      display: flex;
      align-items: center;
      gap: 0;
      margin: 24px 0;
      position: relative;
    }
    .sic-maturity-step {
      flex: 1;
      text-align: center;
      padding: 16px 8px;
      position: relative;
      z-index: 1;
    }
    .sic-maturity-dot {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      margin: 0 auto 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
    }
    .sic-maturity-dot--active { background: var(--primary-light); color: white; transform: scale(1.3); }
    .sic-maturity-dot--done { background: var(--primary-bg); color: var(--primary-light); }
    .sic-maturity-dot--future { background: #e5e7eb; color: var(--text-muted); }
    .sic-maturity-label { font-size: 12px; font-weight: 600; }
    .sic-maturity-line {
      position: absolute;
      top: 50%;
      left: 10%;
      right: 10%;
      height: 3px;
      background: #e5e7eb;
      z-index: 0;
    }
    
    /* ─── RECAP FOOTER ─── */
    .sic-recap {
      background: linear-gradient(135deg, #1a3a2a 0%, #1b5e20 40%, #2e7d32 100%);
      border-radius: 16px;
      padding: 40px;
      margin: 24px 0 48px;
      color: white;
      text-align: center;
    }
    .sic-recap__title { font-size: 28px; font-weight: 800; margin-bottom: 6px; }
    .sic-recap__subtitle { font-size: 16px; font-weight: 500; opacity: 0.9; margin-bottom: 4px; }
    .sic-recap__meta { font-size: 13px; opacity: 0.7; margin-bottom: 4px; }
    .sic-recap__footer { font-size: 12px; opacity: 0.5; margin-top: 12px; }
    
    /* ─── Print ─── */
    @media print {
      body { background: white; }
      .sic-header { page-break-after: avoid; }
      .sic-score-hero { box-shadow: none; border: 1px solid #e5e7eb; }
      .sic-container > * { page-break-inside: avoid; }
      .no-print { display: none !important; }
    }
    
    /* ─── Responsive ─── */
    @media (max-width: 768px) {
      .sic-score-hero__grid { grid-template-columns: 1fr; text-align: center; }
      .sic-kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .sic-canvas-grid { grid-template-columns: 1fr 1fr; }
      .sic-indicators-grid { grid-template-columns: 1fr; }
      .sic-risks-grid { grid-template-columns: 1fr; }
      .sic-toc-flow { flex-direction: column; }
      .sic-toc-arrow { transform: rotate(90deg); justify-content: center; }
      .sic-swot-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <!-- ═══ 1. HEADER BANNER ═══ -->
  <div class="sic-header">
    <div class="sic-container sic-header__inner">
      <div class="sic-header__icon">🌍</div>
      <div class="sic-header__title">Social Impact Canvas</div>
      <div class="sic-header__subtitle">Analyse d'impact social & environnemental complète</div>
      <div class="sic-header__meta">${companyName} — ${sectorStr} — ${country || 'Côte d\'Ivoire'}</div>
      <div class="sic-header__footer">
        <span>${source === 'claude' ? '🤖 Analyse propulsée par Claude AI' : '⚙️ Analyse automatique (règles)'} • ${monthYear}</span>
        <span>•</span>
        <span>${sectorStr} — ${locationStr || country || 'Côte d\'Ivoire'}</span>
      </div>
    </div>
  </div>

  <div class="sic-container">
    <!-- ═══ 2. SCORE HERO ═══ -->
    <div class="sic-score-hero">
      <div class="sic-score-hero__grid">
        <div class="sic-score-circle" style="background: ${scoreColor};">
          <span class="sic-score-circle__value">${scorePercent}</span>
          <span class="sic-score-circle__unit">/100</span>
        </div>
        <div>
          <div class="sic-score-status" style="color: ${scoreColor};">Impact Social : ${statusLabel.label}</div>
          <div class="sic-score-desc">${statusLabel.description}</div>
          <div class="sic-score-bars">
            ${analysis.sections.map(sec => {
              const barColor = sec.score >= 7 ? COLORS.primaryLight : sec.score >= 5 ? COLORS.accent : sec.score >= 3 ? COLORS.orange : COLORS.red
              return `<div class="sic-score-bar">
                <div class="sic-score-bar__label">
                  <span>${sec.label}</span>
                  <span style="font-weight:600;color:${barColor}">${sec.percentage}%</span>
                </div>
                <div class="sic-score-bar__track">
                  <div class="sic-score-bar__fill" style="width:${sec.percentage}%;background:${barColor}"></div>
                </div>
              </div>`
            }).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ 3. SYNTHÈSE D'IMPACT ═══ -->
    <div class="sic-synthesis">
      <div class="sic-section-title">📊 Synthèse d'Impact</div>
      <div class="sic-synthesis__text">
        <strong>${companyName}</strong> ${sicData.transformationVisee ? 
          `vise à <strong>${extractBullets(sicData.transformationVisee)[0]?.toLowerCase() ?? 'transformer son secteur'}</strong>` : 
          'porte un impact social identifié'}${sicData.beneficiaires ? 
          `, ciblant <strong>${extractBullets(sicData.beneficiaires)[0] ?? 'les bénéficiaires identifiés'}</strong>` : ''}${sicData.kpiImpact ? 
          `, mesurant <strong>${extractBullets(sicData.kpiImpact)[0]?.toLowerCase() ?? 'des indicateurs clés'}</strong>` : ''}${locationStr ? 
          ` dans la région de ${locationStr}` : ''}.
      </div>
      
      <div class="sic-kpi-grid">
        <div class="sic-kpi-card" style="background: ${COLORS.primaryBg};">
          <div class="sic-kpi-card__value" style="color: ${COLORS.primaryLight};">${benefNumbers.directs > 0 ? formatNumber(benefNumbers.directs) : '—'}</div>
          <div class="sic-kpi-card__label">Bénéficiaires directs (3 ans)</div>
        </div>
        <div class="sic-kpi-card" style="background: ${COLORS.accentLight};">
          <div class="sic-kpi-card__value" style="color: ${COLORS.accent};">${benefNumbers.indirects > 0 ? formatNumber(benefNumbers.indirects) : '—'}</div>
          <div class="sic-kpi-card__label">Bénéficiaires indirects</div>
        </div>
        <div class="sic-kpi-card" style="background: ${COLORS.orangeLight};">
          <div class="sic-kpi-card__value" style="color: ${COLORS.orange};">${benefNumbers.total > 0 ? formatNumber(benefNumbers.total) : '—'}</div>
          <div class="sic-kpi-card__label">Impact total projeté</div>
        </div>
        <div class="sic-kpi-card" style="background: ${COLORS.primaryBg};">
          <div class="sic-kpi-card__value" style="color: ${COLORS.primaryLight};">${analysis.oddMappings.length}</div>
          <div class="sic-kpi-card__label">ODD adressés</div>
        </div>
      </div>
    </div>

    <!-- ═══ 4. SOCIAL IMPACT CANVAS — VUE SYNTHÉTIQUE ═══ -->
    <div class="sic-canvas">
      <div class="sic-section-title">🌱 Social Impact Canvas — Vue Synthétique</div>
      <div class="sic-canvas-grid">
        <!-- Problème Social -->
        <div class="sic-canvas-cell">
          <div class="sic-canvas-cell__header" style="background: ${COLORS.red};">🔴 PROBLÈME SOCIAL</div>
          ${extractBullets(sicData.problemeSocial).slice(0, 4).map(b => 
            `<div class="sic-canvas-cell__bullet">${b}</div>`
          ).join('') || '<div class="sic-canvas-cell__bullet" style="color:#999;">Non renseigné</div>'}
        </div>
        <!-- Transformation Visée -->
        <div class="sic-canvas-cell">
          <div class="sic-canvas-cell__header" style="background: ${COLORS.primaryLight};">🎯 TRANSFORMATION VISÉE</div>
          ${extractBullets(sicData.transformationVisee).slice(0, 4).map(b => 
            `<div class="sic-canvas-cell__bullet">${b}</div>`
          ).join('') || '<div class="sic-canvas-cell__bullet" style="color:#999;">Non renseigné</div>'}
        </div>
        <!-- Bénéficiaires -->
        <div class="sic-canvas-cell">
          <div class="sic-canvas-cell__header" style="background: ${COLORS.accent};">👥 BÉNÉFICIAIRES</div>
          ${extractBullets(sicData.beneficiaires + '\n' + sicData.profilBeneficiaires).slice(0, 4).map(b => 
            `<div class="sic-canvas-cell__bullet">${b}</div>`
          ).join('') || '<div class="sic-canvas-cell__bullet" style="color:#999;">Non renseigné</div>'}
        </div>
        <!-- ODD Ciblés -->
        <div class="sic-canvas-cell">
          <div class="sic-canvas-cell__header" style="background: ${COLORS.primary};">🌍 ODD CIBLÉS</div>
          ${analysis.oddMappings.length > 0 ? 
            `<div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${analysis.oddMappings.map(odd => {
                const color = ODD_ICONS[odd.oddNumber] ?? '#666'
                return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;background:${color};color:white;font-size:12px;font-weight:600;">ODD ${odd.oddNumber}</span>`
              }).join('')}
            </div>
            <div style="margin-top:10px;">
              ${analysis.oddMappings.slice(0, 4).map(odd => 
                `<div class="sic-canvas-cell__bullet" style="font-size:12px;">${ODD_LABELS[odd.oddNumber] ?? 'ODD ' + odd.oddNumber}</div>`
              ).join('')}
            </div>` :
            '<div class="sic-canvas-cell__bullet" style="color:#999;">Aucun ODD identifié</div>'}
        </div>
      </div>
    </div>

    <!-- ═══ 5. INDICATEURS & MESURE ═══ -->
    <div class="sic-indicators">
      <div class="sic-section-title">📏 Indicateurs & Mesure</div>
      <div class="sic-indicators-grid">
        <div class="sic-indicator-card">
          <div class="sic-indicator-card__title">📊 KPI d'Impact</div>
          <div class="sic-indicator-card__text">${sicData.kpiImpact || 'Non défini — définissez vos indicateurs clés de performance sociale.'}</div>
        </div>
        <div class="sic-indicator-card">
          <div class="sic-indicator-card__title">📐 Baseline (point de départ)</div>
          <div class="sic-indicator-card__text">${sicData.baselineImpact || 'Non défini — établissez une mesure de référence avant intervention.'}</div>
        </div>
        <div class="sic-indicator-card">
          <div class="sic-indicator-card__title">🔬 Méthode de mesure</div>
          <div class="sic-indicator-card__text">${sicData.methodeMesure || 'Non défini — précisez enquêtes, audits ou collectes de données.'}</div>
        </div>
        <div class="sic-indicator-card">
          <div class="sic-indicator-card__title">📅 Fréquence</div>
          <div class="sic-indicator-card__text">${sicData.frequenceMesure || 'Non défini — recommandé : trimestrielle.'}</div>
        </div>
      </div>
      
      <!-- SMART Check -->
      <div style="margin-top:20px;padding:20px;border-radius:12px;background:${analysis.smartCheck.score >= 4 ? COLORS.primaryBg : COLORS.orangeLight};border:1px solid ${analysis.smartCheck.score >= 4 ? COLORS.primaryLight + '30' : COLORS.orange + '30'};">
        <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:${analysis.smartCheck.score >= 4 ? COLORS.primary : COLORS.orange};">
          Vérification SMART — ${analysis.smartCheck.score}/5
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${[
            { label: 'Spécifique', ok: analysis.smartCheck.isSpecific },
            { label: 'Mesurable', ok: analysis.smartCheck.isMeasurable },
            { label: 'Atteignable', ok: analysis.smartCheck.isAttainable },
            { label: 'Pertinent', ok: analysis.smartCheck.isRelevant },
            { label: 'Temporel', ok: analysis.smartCheck.isTimeBound }
          ].map(item => 
            `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${item.ok ? '#dcfce7' : '#fee2e2'};color:${item.ok ? '#166534' : '#991b1b'};">${item.ok ? '✓' : '✗'} ${item.label}</span>`
          ).join('')}
        </div>
      </div>
    </div>

    <!-- ═══ 6. SOLUTION & ACTIVITÉS À IMPACT ═══ -->
    <div class="sic-indicators">
      <div class="sic-section-title">💡 Solution & Activités à Impact</div>
      <div style="display:grid;gap:10px;">
        ${extractBullets(sicData.transformationVisee + '\n' + sicData.impactVise).slice(0, 5).map(b =>
          `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px;border-radius:8px;background:#fafbfc;border:1px solid var(--border);">
            <span style="color:${COLORS.primaryLight};font-size:16px;margin-top:1px;">●</span>
            <span style="font-size:13px;color:var(--text-dark);line-height:1.5;">${b}</span>
          </div>`
        ).join('') || '<div style="color:#999;font-size:13px;">Aucune activité à impact renseignée.</div>'}
      </div>
    </div>

    <!-- ═══ 7. RISQUES & ATTÉNUATION ═══ -->
    <div class="sic-risks">
      <div class="sic-section-title">⚠️ Risques & Atténuation</div>
      <div class="sic-risks-grid">
        <div>
          <div class="sic-risk-col__title" style="color: ${COLORS.red};">Risques identifiés :</div>
          ${extractBullets(sicData.risques).slice(0, 5).map(r =>
            `<div class="sic-risk-item sic-risk-item--risk">${r}</div>`
          ).join('') || '<div style="color:#999;font-size:13px;padding-left:20px;">Aucun risque renseigné.</div>'}
        </div>
        <div>
          <div class="sic-risk-col__title" style="color: ${COLORS.primaryLight};">Mesures d'atténuation :</div>
          ${extractBullets(sicData.attenuation).slice(0, 5).map(m =>
            `<div class="sic-risk-item sic-risk-item--mitigation">${m}</div>`
          ).join('') || '<div style="color:#999;font-size:13px;padding-left:20px;">Aucune mesure renseignée.</div>'}
        </div>
      </div>
    </div>

    <!-- ═══ 8. THÉORIE DU CHANGEMENT ═══ -->
    <div class="sic-toc">
      <div class="sic-section-title">🔄 Théorie du Changement</div>
      <div class="sic-toc-flow">
        <div class="sic-toc-step" style="background:${COLORS.redLight};">
          <div class="sic-toc-step__label" style="color:${COLORS.red};">PROBLÈME</div>
          <div class="sic-toc-step__text">${theoryOfChange.probleme}</div>
        </div>
        <div class="sic-toc-arrow">→</div>
        <div class="sic-toc-step" style="background:${COLORS.accentLight};">
          <div class="sic-toc-step__label" style="color:${COLORS.accent};">ACTIVITÉS</div>
          <div class="sic-toc-step__text">${theoryOfChange.activites}</div>
        </div>
        <div class="sic-toc-arrow">→</div>
        <div class="sic-toc-step" style="background:${COLORS.orangeLight};">
          <div class="sic-toc-step__label" style="color:${COLORS.orange};">OUTPUTS</div>
          <div class="sic-toc-step__text">${theoryOfChange.outputs}</div>
        </div>
        <div class="sic-toc-arrow">→</div>
        <div class="sic-toc-step" style="background:${COLORS.accentLight};">
          <div class="sic-toc-step__label" style="color:${COLORS.accent};">OUTCOMES</div>
          <div class="sic-toc-step__text">${theoryOfChange.outcomes}</div>
        </div>
        <div class="sic-toc-arrow">→</div>
        <div class="sic-toc-step" style="background:${COLORS.primaryBg};">
          <div class="sic-toc-step__label" style="color:${COLORS.primary};">IMPACT</div>
          <div class="sic-toc-step__text">${theoryOfChange.impact}${benefNumbers.total > 0 ? `<br/><strong>${formatNumber(benefNumbers.total)} bénéficiaires</strong>` : ''}</div>
        </div>
      </div>
    </div>

    <!-- ═══ 9. CHANGEMENTS ATTENDUS (OUTCOMES) ═══ -->
    <div class="sic-outcomes">
      <div class="sic-section-title">📈 Changements Attendus (Outcomes)</div>
      <table class="sic-table">
        <thead>
          <tr>
            <th style="width:120px;">Horizon</th>
            <th>Changement attendu</th>
            <th style="width:240px;">Indicateur de suivi</th>
          </tr>
        </thead>
        <tbody>
          ${outcomes.map(o => `
            <tr>
              <td><strong>${o.horizonLabel}</strong><br/><span style="font-size:11px;color:var(--text-muted);">(${o.horizon})</span></td>
              <td>${o.changement}</td>
              <td>${o.indicateur}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- ═══ 10. CONTRIBUTION AUX ODD — DÉTAIL ═══ -->
    <div class="sic-odd">
      <div class="sic-section-title">🌍 Contribution aux ODD — Détail</div>
      ${analysis.oddMappings.length > 0 ? `
        <table class="sic-table">
          <thead>
            <tr>
              <th style="width:60px;">ODD</th>
              <th style="width:160px;">Intitulé</th>
              <th>Contribution concrète de ${companyName}</th>
              <th style="width:80px;">Score</th>
            </tr>
          </thead>
          <tbody>
            ${analysis.oddMappings.map(odd => {
              const color = ODD_ICONS[odd.oddNumber] ?? '#666'
              const stars = Array.from({length: 3}, (_, i) => 
                `<div class="sic-odd-star ${i < odd.score ? 'sic-odd-star--filled' : 'sic-odd-star--empty'}" style="${i < odd.score ? `background:${color}` : ''}"></div>`
              ).join('')
              return `<tr>
                <td><span class="sic-odd-badge" style="background:${color};">${odd.oddNumber}</span></td>
                <td style="font-weight:600;">${odd.oddLabel}</td>
                <td>${odd.justification}${odd.contributionType === 'direct' ? ' <em style="color:' + COLORS.primaryLight + ';">(direct)</em>' : ' <em style="color:' + COLORS.textMuted + ';">(indirect)</em>'}</td>
                <td><div class="sic-odd-stars">${stars}</div></td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      ` : '<div style="text-align:center;color:#999;padding:24px;">Aucun ODD identifié. Complétez la section ODD & Contribution dans vos réponses SIC.</div>'}
    </div>

    <!-- ═══ 11. PARTIES PRENANTES CLÉS ═══ -->
    <div class="sic-stakeholders">
      <div class="sic-section-title">🤝 Parties Prenantes Clés</div>
      <table class="sic-table">
        <thead>
          <tr>
            <th style="width:200px;">Partie prenante</th>
            <th>Rôle dans le projet</th>
            <th style="width:120px;">Niveau d'implication</th>
          </tr>
        </thead>
        <tbody>
          ${stakeholders.map(s => {
            const levelColor = s.niveau === 'Élevé' ? COLORS.primaryLight : s.niveau === 'Moyen' ? COLORS.orange : COLORS.textMuted
            const levelBg = s.niveau === 'Élevé' ? COLORS.primaryBg : s.niveau === 'Moyen' ? COLORS.orangeLight : '#f5f5f5'
            return `<tr>
              <td style="font-weight:600;">${s.nom}</td>
              <td>${s.role}</td>
              <td><span class="sic-stake-level" style="background:${levelBg};color:${levelColor};">${s.niveau}</span></td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- ═══ 12. ALIGNEMENT MODÈLE ÉCONOMIQUE / IMPACT ═══ -->
    <div class="sic-alignment">
      <div class="sic-section-title">💼 Alignement Modèle Économique / Impact</div>
      <div style="padding:16px;border-radius:12px;background:${COLORS.primaryBg};border:1px solid ${COLORS.primaryLight}30;margin-bottom:16px;">
        <div style="font-size:16px;font-weight:700;color:${COLORS.primary};margin-bottom:8px;">
          ${analysis.scoreCoherenceBmc >= 7 ? '✅ L\'impact est au CŒUR du modèle économique' : '⚠️ Alignement à renforcer entre impact et modèle économique'}
        </div>
      </div>
      ${analysis.bmcCoherenceIssues.length > 0 ? `
        <div style="margin-top:12px;">
          ${analysis.bmcCoherenceIssues.map(issue => 
            `<div class="sic-alignment__bullet">⚠️ ${issue}</div>`
          ).join('')}
        </div>
      ` : `
        <div class="sic-alignment__bullet"><strong>Cohérence BMC-SIC :</strong> Score ${analysis.scoreCoherenceBmc.toFixed(1)}/10 — Les objectifs d'impact sont alignés avec le modèle économique.</div>
      `}
      <div class="sic-alignment__bullet">Plus <strong>${companyName}</strong> grandit, plus l'impact augmente — la croissance = plus de personnes touchées.</div>
    </div>

    <!-- ═══ 13. DIAGNOSTIC SWOT — IMPACT SOCIAL ═══ -->
    <div class="sic-swot">
      <div class="sic-section-title">📋 Diagnostic SWOT — Impact Social</div>
      <div class="sic-swot-grid">
        <div class="sic-swot-cell" style="background: #dcfce7; border: 1px solid #86efac;">
          <div class="sic-swot-cell__title" style="color: #166534;">💪 FORCES</div>
          ${swot.forces.map(f => `<div class="sic-swot-cell__item" style="color:#14532d;">${f}</div>`).join('') || '<div style="color:#999;">—</div>'}
        </div>
        <div class="sic-swot-cell" style="background: #fee2e2; border: 1px solid #fca5a5;">
          <div class="sic-swot-cell__title" style="color: #991b1b;">⚡ FAIBLESSES</div>
          ${swot.faiblesses.map(f => `<div class="sic-swot-cell__item" style="color:#7f1d1d;">${f}</div>`).join('') || '<div style="color:#999;">—</div>'}
        </div>
        <div class="sic-swot-cell" style="background: #dbeafe; border: 1px solid #93c5fd;">
          <div class="sic-swot-cell__title" style="color: #1e40af;">🚀 OPPORTUNITÉS</div>
          ${swot.opportunites.map(f => `<div class="sic-swot-cell__item" style="color:#1e3a5f;">${f}</div>`).join('') || '<div style="color:#999;">—</div>'}
        </div>
        <div class="sic-swot-cell" style="background: #fff7ed; border: 1px solid #fdba74;">
          <div class="sic-swot-cell__title" style="color: #9a3412;">⛔ MENACES</div>
          ${swot.menaces.map(f => `<div class="sic-swot-cell__item" style="color:#7c2d12;">${f}</div>`).join('') || '<div style="color:#999;">—</div>'}
        </div>
      </div>
    </div>

    <!-- ═══ 14. RECOMMANDATIONS ═══ -->
    <div class="sic-recos">
      <div class="sic-section-title">💡 Recommandations pour Renforcer l'Impact</div>
      ${buildRecommendationCards(analysis)}
    </div>

    <!-- ═══ 15. ÉVOLUTION POTENTIELLE DU SCORE ═══ -->
    <div class="sic-evolution">
      <div class="sic-section-title">📊 Évolution Potentielle du Score</div>
      <table class="sic-table">
        <thead>
          <tr>
            <th>Critère</th>
            <th style="width:120px;">Score actuel</th>
            <th style="width:120px;">Score après améliorations</th>
            <th>Action clé</th>
          </tr>
        </thead>
        <tbody>
          ${evolutionScores.map(e => {
            const colorBefore = e.scoreActuel >= 70 ? COLORS.primaryLight : e.scoreActuel >= 50 ? COLORS.accent : e.scoreActuel >= 30 ? COLORS.orange : COLORS.red
            const colorAfter = e.scoreApres >= 70 ? COLORS.primaryLight : e.scoreApres >= 50 ? COLORS.accent : e.scoreApres >= 30 ? COLORS.orange : COLORS.red
            return `<tr>
              <td style="font-weight:600;">${e.critere}</td>
              <td style="text-align:center;font-weight:700;color:${colorBefore};">${e.scoreActuel}/100</td>
              <td style="text-align:center;font-weight:700;color:${colorAfter};">${e.scoreApres}/100</td>
              <td>${e.actionCle}</td>
            </tr>`
          }).join('')}
          <tr style="font-weight:700;background:#f0fdf4;">
            <td style="font-weight:800;">TOTAL</td>
            <td style="text-align:center;font-weight:800;color:${scoreColor};">${Math.round(totalBefore)}/100</td>
            <td style="text-align:center;font-weight:800;color:${COLORS.primaryLight};">${Math.round(totalAfter)}/100</td>
            <td style="font-weight:700;color:${COLORS.primary};">De "${statusLabel.label}" à "${statusAfter}"</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ═══ 16. MATURITÉ DE L'IMPACT ═══ -->
    <div class="sic-maturity">
      <div class="sic-section-title">🎯 Niveau de Maturité de l'Impact</div>
      <div style="text-align:center;margin-bottom:8px;">
        <span style="font-size:14px;color:var(--text-medium);">Phase actuelle : </span>
        <span style="font-size:16px;font-weight:700;color:${COLORS.primaryLight};">${maturity.level}</span>
      </div>
      <div class="sic-maturity-track">
        <div class="sic-maturity-line"></div>
        ${maturity.phases.map((phase, idx) => {
          const dotClass = idx === maturity.index ? 'sic-maturity-dot--active' : idx < maturity.index ? 'sic-maturity-dot--done' : 'sic-maturity-dot--future'
          return `<div class="sic-maturity-step">
            <div class="sic-maturity-dot ${dotClass}">${idx < maturity.index ? '✓' : idx === maturity.index ? '●' : ''}</div>
            <div class="sic-maturity-label" style="color:${idx === maturity.index ? COLORS.primaryLight : idx < maturity.index ? COLORS.textMedium : COLORS.textMuted};">
              ${phase}
              ${idx === maturity.index ? '<br/><span style="font-size:10px;">← VOUS ÊTES ICI</span>' : ''}
            </div>
          </div>`
        }).join('')}
      </div>
      <div style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-medium);max-width:600px;margin-left:auto;margin-right:auto;">
        ${companyName} est en phase de <strong>${maturity.level.toLowerCase()}</strong>. L'impact social est ${maturity.index <= 1 ? 'réel dans l\'intention mais doit encore être mesuré et documenté' : maturity.index <= 2 ? 'déployé et commence à être mesuré' : 'mesuré et documenté'} pour passer aux phases suivantes.
      </div>
    </div>

    <!-- ═══ 17. IMPACT WASHING ═══ -->
    ${analysis.impactWashingSignals.length > 0 ? `
    <div class="sic-risks">
      <div class="sic-section-title" style="color: ${analysis.impactWashingRisk === 'eleve' ? COLORS.red : COLORS.orange};">
        🛡️ Signaux d'Impact Washing — Risque : ${analysis.impactWashingRisk.charAt(0).toUpperCase() + analysis.impactWashingRisk.slice(1)}
      </div>
      <div style="display:grid;gap:8px;">
        ${analysis.impactWashingSignals.map(s => 
          `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px;border-radius:8px;background:${analysis.impactWashingRisk === 'eleve' ? COLORS.redLight : COLORS.orangeLight};border:1px solid ${analysis.impactWashingRisk === 'eleve' ? COLORS.red + '30' : COLORS.orange + '30'};">
            <span style="color:${analysis.impactWashingRisk === 'eleve' ? COLORS.red : COLORS.orange};">⚠️</span>
            <span style="font-size:13px;color:var(--text-dark);">${s}</span>
          </div>`
        ).join('')}
      </div>
    </div>
    ` : ''}

    <!-- ═══ 18. MATRICE D'IMPACT ═══ -->
    <div class="sic-indicators">
      <div class="sic-section-title">🎯 Matrice d'Impact — Niveau de Preuve</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div style="padding:20px;border-radius:12px;background:#fef9c3;border:1px solid #fde047;">
          <div style="font-weight:700;font-size:14px;color:#854d0e;margin-bottom:10px;">🟡 Intentionnel</div>
          ${analysis.impactMatrix.intentionnel.map(i => `<div style="font-size:12px;color:#713f12;margin-bottom:6px;line-height:1.5;">— ${i}</div>`).join('') || '<div style="font-size:12px;color:#999;">Aucun élément</div>'}
        </div>
        <div style="padding:20px;border-radius:12px;background:#dbeafe;border:1px solid #93c5fd;">
          <div style="font-weight:700;font-size:14px;color:#1e40af;margin-bottom:10px;">🔵 Mesuré</div>
          ${analysis.impactMatrix.mesure.map(i => `<div style="font-size:12px;color:#1e3a5f;margin-bottom:6px;line-height:1.5;">— ${i}</div>`).join('') || '<div style="font-size:12px;color:#999;">Aucun élément</div>'}
        </div>
        <div style="padding:20px;border-radius:12px;background:#dcfce7;border:1px solid #86efac;">
          <div style="font-weight:700;font-size:14px;color:#166534;margin-bottom:10px;">🟢 Prouvé</div>
          ${analysis.impactMatrix.prouve.map(i => `<div style="font-size:12px;color:#14532d;margin-bottom:6px;line-height:1.5;">— ${i}</div>`).join('') || '<div style="font-size:12px;color:#999;">Aucun élément</div>'}
        </div>
      </div>
    </div>

    <!-- ═══ RECAP FOOTER ═══ -->
    <div class="sic-recap">
      <div class="sic-recap__title">Social Impact Canvas</div>
      <div class="sic-recap__subtitle">${companyName} — ${sectorStr} — ${country || 'Côte d\'Ivoire'}</div>
      <div class="sic-recap__meta">Analyse d'impact social & environnemental complète</div>
      <div class="sic-recap__footer">Document généré le ${dateStr} • ${source === 'claude' ? 'Analyse propulsée par Claude AI' : 'Analyse automatique (règles)'}</div>
      <div style="font-size:11px;opacity:0.4;margin-top:4px;">${sectorStr} — ${locationStr || country || 'Côte d\'Ivoire'}</div>
    </div>
  </div>

  <div style="text-align:center;padding:16px;color:#94a3b8;font-size:11px;">
    Généré par ESONO Investment Readiness · Module 2 SIC · ${dateStr}
  </div>
</body>
</html>`
}

// ─── Helper: Build Recommendation Cards ───
function buildRecommendationCards(analysis: SicAnalysisResult): string {
  const recos: { title: string, text: string, priority: 'HAUTE' | 'MOYENNE' | 'BASSE' }[] = []
  
  // High priority: weak sections
  for (const sec of analysis.sections) {
    if (sec.score < 5) {
      recos.push({
        title: `Renforcer : ${sec.label}`,
        text: sec.warnings.join(' ') || `Section insuffisante (${sec.score}/10). Ajoutez des détails quantitatifs et des preuves concrètes.`,
        priority: 'HAUTE'
      })
    }
  }
  
  // SMART improvement
  if (analysis.smartCheck.score < 4) {
    recos.push({
      title: 'Structurer la mesure d\'impact (SMART)',
      text: `${analysis.smartCheck.feedback} Mettre en place une baseline et adopter une méthodologie formelle (SROI ou Théorie du Changement documentée).`,
      priority: 'HAUTE'
    })
  }
  
  // Medium priority
  if (analysis.impactMatrix.prouve.length === 0) {
    recos.push({
      title: 'Formaliser les partenariats & preuves',
      text: 'Engager des partenariats formels avec des ONG ou organisations pour co-mesurer l\'impact. Explorer les certifications (B Corp, ESG) pour valoriser l\'engagement.',
      priority: 'MOYENNE'
    })
  }
  
  // Impact washing
  if (analysis.impactWashingRisk !== 'faible') {
    recos.push({
      title: 'Réduire le risque d\'impact washing',
      text: analysis.impactWashingSignals.slice(0, 2).join(' ') + ' Ajoutez des preuves concrètes et des données quantitatives.',
      priority: analysis.impactWashingRisk === 'eleve' ? 'HAUTE' : 'MOYENNE'
    })
  }
  
  // Low priority
  if (analysis.oddMappings.length > 0 && analysis.oddMappings.every(o => o.evidenceLevel === 'intentionnel')) {
    recos.push({
      title: 'Documenter la contribution ODD avec chiffres',
      text: 'Toutes les contributions ODD sont déclarées mais non mesurées. Documentez chaque contribution avec des chiffres concrets.',
      priority: 'BASSE'
    })
  }
  
  // Add general recommendations from analysis
  for (const rec of analysis.recommendations.slice(0, 3)) {
    if (!recos.some(r => r.text.includes(rec.substring(0, 30)))) {
      recos.push({
        title: rec.substring(0, 60),
        text: rec,
        priority: recos.length < 3 ? 'HAUTE' : recos.length < 5 ? 'MOYENNE' : 'BASSE'
      })
    }
  }
  
  return recos.slice(0, 5).map((r, idx) => {
    const priorityColor = r.priority === 'HAUTE' ? COLORS.red : r.priority === 'MOYENNE' ? COLORS.orange : COLORS.accent
    const priorityBg = r.priority === 'HAUTE' ? COLORS.redLight : r.priority === 'MOYENNE' ? COLORS.orangeLight : COLORS.accentLight
    return `<div class="sic-reco-card" style="border-color:${priorityColor};background:${priorityBg};">
      <div class="sic-reco-card__priority" style="color:${priorityColor};">PRIORITÉ ${r.priority}</div>
      <div class="sic-reco-card__title">${idx + 1}. ${r.title}</div>
      <div class="sic-reco-card__text">${r.text}</div>
    </div>`
  }).join('')
}

// ═══════════════════════════════════════════════════════════════
// NEW: Render SIC deliverable from SicAnalystResult (new flow)
// Uses the same professional CSS but consumes the SIC Analyst format
// ═══════════════════════════════════════════════════════════════

export interface SicAnalystDeliverableInput {
  companyName: string
  entrepreneurName: string
  sector: string
  location: string
  country: string
  analysis: SicAnalystResult
  extractionJson?: any
}

export function renderSicDeliverableFromAnalyst(input: SicAnalystDeliverableInput): string {
  const { companyName, entrepreneurName, sector, location, country, analysis } = input
  const ext = input.extractionJson?.extraction || {}
  
  const scoreGlobal = analysis.score_global ?? 0
  const scoreColor = scoreGlobal >= 71 ? COLORS.primaryLight : scoreGlobal >= 51 ? COLORS.accent : scoreGlobal >= 31 ? COLORS.orange : COLORS.red
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const monthYear = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const locationStr = [location, country].filter(Boolean).join(' — ')
  const sectorStr = sector || 'Secteur non précisé'

  // ── Dimensions bars ──
  const dimOrder = [
    { key: 'probleme_vision', weight: '25%' },
    { key: 'beneficiaires', weight: '20%' },
    { key: 'mesure_impact', weight: '20%' },
    { key: 'alignement_odd', weight: '20%' },
    { key: 'gestion_risques', weight: '15%' }
  ]
  const dimBarsHtml = dimOrder.map(({ key, weight }) => {
    const d = (analysis.dimensions as any)?.[key]
    if (!d) return ''
    const barColor = d.score >= 70 ? COLORS.primaryLight : d.score >= 50 ? COLORS.accent : d.score >= 30 ? COLORS.orange : COLORS.red
    return `<div class="sic-score-bar">
      <div class="sic-score-bar__label">
        <span>${d.label} (${weight})</span>
        <span style="font-weight:600;color:${barColor}">${d.score}%</span>
      </div>
      <div class="sic-score-bar__track">
        <div class="sic-score-bar__fill" style="width:${d.score}%;background:${barColor}"></div>
      </div>
    </div>`
  }).join('')

  // ── KPI cards ──
  const ck = analysis.chiffres_cles || {} as any
  const fmtNum = (n: number) => n > 0 ? n.toLocaleString('fr-FR') : '—'

  // ── Canvas blocs ──
  const cb = analysis.canvas_blocs || {} as any
  const canvasCells = [
    { title: 'PROBLÈME SOCIAL', bg: COLORS.red, data: cb.probleme_social },
    { title: 'TRANSFORMATION VISÉE', bg: COLORS.primaryLight, data: cb.transformation_visee },
    { title: 'BÉNÉFICIAIRES', bg: COLORS.accent, data: cb.beneficiaires },
    { title: 'SOLUTION & ACTIVITÉS', bg: COLORS.orange, data: cb.solution_activites },
  ]
  const canvasHtml = canvasCells.map(cell => {
    const points = cell.data?.points || []
    return `<div class="sic-canvas-cell">
      <div class="sic-canvas-cell__header" style="background:${cell.bg}">${cell.title}</div>
      ${points.map((p: string) => `<div class="sic-canvas-cell__bullet">${p}</div>`).join('')}
    </div>`
  }).join('')

  // ── Indicators ──
  const indMes = cb.indicateurs_mesure || {}
  const indicateursHtml = (indMes.indicateurs || []).map((ind: any) => {
    const typeColor = ind.type === 'impact' ? COLORS.primaryLight : ind.type === 'outcome' ? COLORS.accent : COLORS.orange
    const typeLabel = ind.type === 'impact' ? 'IMPACT' : ind.type === 'outcome' ? 'OUTCOME' : 'OUTPUT'
    return `<div class="sic-indicator-card">
      <div class="sic-indicator-card__title">
        <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;color:white;background:${typeColor};margin-right:8px;">${typeLabel}</span>
        ${ind.nom}
      </div>
    </div>`
  }).join('')

  // ── ODD table ──
  const odds = cb.odd_cibles?.odds || []
  const oddRowsHtml = odds.map((o: any) => {
    const stars = o.alignement === 'fort' ? 3 : o.alignement === 'moyen' ? 2 : 1
    return `<tr>
      <td><div class="sic-odd-badge" style="background:${o.couleur || '#666'}">${o.numero}</div></td>
      <td style="font-weight:600">${o.nom || ''}</td>
      <td>
        <div class="sic-odd-stars">
          ${Array.from({length: 3}, (_, i) => 
            `<div class="sic-odd-star ${i < stars ? 'sic-odd-star--filled' : 'sic-odd-star--empty'}"></div>`
          ).join('')}
        </div>
      </td>
      <td style="font-size:13px;color:${COLORS.textMedium}">${o.justification || ''}</td>
    </tr>`
  }).join('')

  // ── Theory of Change ──
  const tdc = analysis.theorie_du_changement || {} as any
  const tdcSteps = [
    { label: 'PROBLÈME', text: tdc.probleme, bg: '#fbe9e7', color: COLORS.red },
    { label: 'ACTIVITÉS', text: tdc.activites, bg: COLORS.orangeLight, color: COLORS.orange },
    { label: 'OUTPUTS', text: tdc.outputs, bg: COLORS.accentLight, color: COLORS.accent },
    { label: 'OUTCOMES', text: tdc.outcomes, bg: COLORS.primaryBg, color: COLORS.primaryLight },
    { label: 'IMPACT', text: tdc.impact, bg: '#c8e6c9', color: COLORS.primary },
  ]
  const tdcHtml = tdcSteps.map((step, i) => {
    const arrow = i < tdcSteps.length - 1 ? '<div class="sic-toc-arrow">→</div>' : ''
    return `<div class="sic-toc-step" style="background:${step.bg}">
      <div class="sic-toc-step__label" style="color:${step.color}">${step.label}</div>
      <div class="sic-toc-step__text">${step.text || '—'}</div>
    </div>${arrow}`
  }).join('')

  // ── Risks ──
  const risques = analysis.risques_attenuation?.risques || []
  const risksHtml = risques.length > 0 ? `
    <div class="sic-risks-grid">
      <div>
        <div class="sic-risk-col__title" style="color:${COLORS.red}">⚠️ Risques identifiés</div>
        ${risques.map((r: any) => `<div class="sic-risk-item sic-risk-item--risk">${r.risque}</div>`).join('')}
      </div>
      <div>
        <div class="sic-risk-col__title" style="color:${COLORS.primaryLight}">✅ Mesures d'atténuation</div>
        ${risques.map((r: any) => `<div class="sic-risk-item sic-risk-item--mitigation">${r.mitigation}</div>`).join('')}
      </div>
    </div>` : '<p style="color:#999">Aucun risque documenté</p>'

  // ── Dimension details (feedback) ──
  const dimDetailsHtml = dimOrder.map(({ key }) => {
    const d = (analysis.dimensions as any)?.[key]
    if (!d) return ''
    const barColor = d.score >= 70 ? COLORS.primaryLight : d.score >= 50 ? COLORS.accent : d.score >= 30 ? COLORS.orange : COLORS.red
    return `<div style="background:#fafbfc;border-radius:12px;padding:20px;margin-bottom:12px;border:1px solid ${COLORS.border}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-weight:700;font-size:15px;color:${COLORS.textDark}">${d.label}</span>
        <span style="font-weight:800;font-size:18px;color:${barColor}">${d.score}/100</span>
      </div>
      <div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:10px;">
        <div style="height:100%;width:${d.score}%;background:${barColor};border-radius:3px;"></div>
      </div>
      <p style="font-size:13px;color:${COLORS.textMedium};line-height:1.6;">${d.commentaire || ''}</p>
    </div>`
  }).join('')

  // ── Recommendations ──
  const recos = analysis.recommandations || []
  const recosHtml = recos.map((r: any, idx: number) => {
    const priorityColor = r.priorite <= 1 ? COLORS.red : r.priorite <= 2 ? COLORS.orange : COLORS.accent
    const priorityBg = r.priorite <= 1 ? COLORS.redLight : r.priorite <= 2 ? COLORS.orangeLight : COLORS.accentLight
    const priorityLabel = r.priorite <= 1 ? 'HAUTE' : r.priorite <= 2 ? 'MOYENNE' : 'BASSE'
    return `<div class="sic-reco-card" style="border-color:${priorityColor};background:${priorityBg};">
      <div class="sic-reco-card__priority" style="color:${priorityColor};">PRIORITÉ ${priorityLabel}</div>
      <div class="sic-reco-card__title">${r.priorite}. ${r.titre}</div>
      <div class="sic-reco-card__text">${r.detail}</div>
      <div style="margin-top:8px;font-size:12px;font-weight:600;color:${priorityColor};">📈 ${r.impact_score}</div>
    </div>`
  }).join('')

  // ── BMC Cross-check ──
  const crBmc = analysis.croisement_bmc || {} as any
  const bmcHtml = crBmc.disponible ? `
    <div class="sic-alignment" style="margin:24px 0;">
      <div class="sic-section-title">🔗 Croisement BMC ↔ SIC</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px;">
        <div>
          <h4 style="font-size:14px;font-weight:700;color:${COLORS.primaryLight};margin-bottom:12px;">✅ Cohérences</h4>
          ${(crBmc.coherences || []).map((c: string) => `<div class="sic-alignment__bullet">✓ ${c}</div>`).join('')}
        </div>
        <div>
          <h4 style="font-size:14px;font-weight:700;color:${COLORS.red};margin-bottom:12px;">⚠️ Incohérences</h4>
          ${(crBmc.incoherences || []).map((c: string) => `<div class="sic-alignment__bullet">✗ ${c}</div>`).join('')}
        </div>
      </div>
    </div>` : ''

  // ── Alignment model ──
  const am = analysis.alignement_modele || {} as any
  const alignHtml = am.commentaire ? `
    <div class="sic-alignment" style="margin:24px 0;">
      <div class="sic-section-title">🏛️ Alignement Modèle Économique / Impact</div>
      <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div style="background:#fafbfc;padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:12px;color:${COLORS.textLight};margin-bottom:6px;">Position de l'impact</div>
          <div style="font-size:14px;font-weight:700;color:${COLORS.primaryLight};">${
            am.impact_position === 'coeur_du_modele' ? '💚 Cœur du modèle' :
            am.impact_position === 'effet_secondaire' ? '🟡 Effet secondaire' : '⚪ Activité annexe'
          }</div>
        </div>
        <div style="background:#fafbfc;padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:12px;color:${COLORS.textLight};margin-bottom:6px;">Corrélation croissance</div>
          <div style="font-size:14px;font-weight:700;color:${
            am.correlation_croissance === 'augmente' ? COLORS.primaryLight : am.correlation_croissance === 'stagne' ? COLORS.orange : COLORS.red
          };">${am.correlation_croissance === 'augmente' ? '📈 Augmente' : am.correlation_croissance === 'stagne' ? '📊 Stagne' : '📉 Diminue'}</div>
        </div>
        <div style="background:#fafbfc;padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:12px;color:${COLORS.textLight};margin-bottom:6px;">Conflit rentabilité</div>
          <div style="font-size:14px;font-weight:700;color:${
            am.conflit_rentabilite === 'faible' ? COLORS.primaryLight : am.conflit_rentabilite === 'moyen' ? COLORS.orange : COLORS.red
          };">${am.conflit_rentabilite === 'faible' ? '✅ Faible' : am.conflit_rentabilite === 'moyen' ? '⚠️ Moyen' : '🔴 Fort'}</div>
        </div>
      </div>
      <p style="margin-top:16px;font-size:14px;color:${COLORS.textMedium};line-height:1.7;">${am.commentaire}</p>
    </div>` : ''

  // ── Maturity level ──
  const maturityLevels = ['idee', 'test_pilote', 'deploye', 'mesure', 'scale']
  const maturityLabels: Record<string, string> = {
    'idee': 'Idée', 'test_pilote': 'Pilote', 'deploye': 'Déployé', 'mesure': 'Mesuré', 'scale': 'Scalé'
  }
  const currentMaturity = maturityLevels.indexOf(analysis.niveau_maturite || 'idee')
  const maturityHtml = maturityLevels.map((level, i) => {
    const cls = i === currentMaturity ? 'sic-maturity-dot--active' : i < currentMaturity ? 'sic-maturity-dot--done' : 'sic-maturity-dot--future'
    return `<div class="sic-maturity-step">
      <div class="sic-maturity-dot ${cls}">${i + 1}</div>
      <div class="sic-maturity-label">${maturityLabels[level] || level}</div>
    </div>`
  }).join('')

  // ── Changements ──
  const chg = analysis.changements || {} as any
  const changementsHtml = (chg.court_terme || chg.moyen_terme || chg.long_terme) ? `
    <div class="sic-outcomes" style="margin:24px 0;">
      <div class="sic-section-title">🔄 Changements attendus</div>
      <table class="sic-table" style="margin-top:16px;">
        <thead><tr>
          <th>Horizon</th>
          <th>Changement attendu</th>
        </tr></thead>
        <tbody>
          ${chg.court_terme ? `<tr><td><strong>Court terme</strong></td><td>${chg.court_terme}</td></tr>` : ''}
          ${chg.moyen_terme ? `<tr><td><strong>Moyen terme</strong></td><td>${chg.moyen_terme}</td></tr>` : ''}
          ${chg.long_terme ? `<tr><td><strong>Long terme</strong></td><td>${chg.long_terme}</td></tr>` : ''}
        </tbody>
      </table>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Social Impact Canvas — ${companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: ${COLORS.primary};
      --primary-light: ${COLORS.primaryLight};
      --primary-bg: ${COLORS.primaryBg};
      --accent: ${COLORS.accent};
      --accent-light: ${COLORS.accentLight};
      --orange: ${COLORS.orange};
      --orange-light: ${COLORS.orangeLight};
      --red: ${COLORS.red};
      --red-light: ${COLORS.redLight};
      --text-dark: ${COLORS.textDark};
      --text-medium: ${COLORS.textMedium};
      --text-light: ${COLORS.textLight};
      --text-muted: ${COLORS.textMuted};
      --bg-card: ${COLORS.bgCard};
      --bg-page: ${COLORS.bgPage};
      --border: ${COLORS.border};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: var(--bg-page); color: var(--text-dark); line-height: 1.6; }
    .sic-container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    .sic-header { background: linear-gradient(135deg, #1a3a2a 0%, #1b5e20 40%, #2e7d32 100%); padding: 48px 0 56px; color: white; position: relative; overflow: hidden; }
    .sic-header::before { content: ''; position: absolute; top: -50%; right: -10%; width: 400px; height: 400px; border-radius: 50%; background: rgba(255,255,255,0.04); }
    .sic-header__inner { position: relative; z-index: 1; }
    .sic-header__icon { width: 56px; height: 56px; background: rgba(255,255,255,0.15); border-radius: 16px; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px; backdrop-filter: blur(8px); }
    .sic-header__title { font-size: 36px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
    .sic-header__subtitle { font-size: 17px; font-weight: 300; opacity: 0.9; margin-bottom: 6px; }
    .sic-header__meta { font-size: 15px; font-weight: 500; opacity: 0.85; }
    .sic-header__footer { margin-top: 24px; font-size: 12px; opacity: 0.6; display: flex; align-items: center; gap: 12px; }
    .sic-score-hero { background: var(--bg-card); border-radius: 20px; margin: -36px 24px 0; position: relative; z-index: 10; box-shadow: 0 8px 32px rgba(0,0,0,0.1); padding: 36px 40px; }
    .sic-score-hero__grid { display: grid; grid-template-columns: auto 1fr; gap: 32px; align-items: center; }
    .sic-score-circle { width: 140px; height: 140px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; }
    .sic-score-circle__value { font-size: 42px; font-weight: 800; line-height: 1; }
    .sic-score-circle__unit { font-size: 14px; font-weight: 400; opacity: 0.85; margin-top: 2px; }
    .sic-score-status { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .sic-score-desc { font-size: 15px; color: var(--text-medium); line-height: 1.6; margin-bottom: 16px; }
    .sic-score-bars { display: flex; gap: 16px; flex-wrap: wrap; }
    .sic-score-bar { flex: 1; min-width: 140px; }
    .sic-score-bar__label { font-size: 13px; color: var(--text-light); margin-bottom: 4px; display: flex; justify-content: space-between; }
    .sic-score-bar__track { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; }
    .sic-score-bar__fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
    .sic-synthesis { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-synthesis__text { font-size: 15px; color: var(--text-medium); line-height: 1.8; margin-top: 16px; }
    .sic-section-title { font-size: 20px; font-weight: 700; color: var(--text-dark); padding-bottom: 12px; border-bottom: 2px solid var(--primary-bg); margin-bottom: 16px; }
    .sic-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 24px; }
    .sic-kpi-card { border-radius: 12px; padding: 20px; text-align: center; }
    .sic-kpi-card__value { font-size: 32px; font-weight: 800; line-height: 1; margin-bottom: 6px; }
    .sic-kpi-card__label { font-size: 13px; color: var(--text-light); }
    .sic-canvas { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-canvas-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; }
    .sic-canvas-cell { padding: 20px; border: 1px solid #e2e8f0; min-height: 160px; }
    .sic-canvas-cell__header { font-size: 13px; font-weight: 700; color: white; padding: 6px 12px; border-radius: 6px; margin-bottom: 12px; display: inline-block; }
    .sic-canvas-cell__bullet { font-size: 13px; color: var(--text-dark); margin-bottom: 6px; line-height: 1.5; }
    .sic-canvas-cell__bullet::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: var(--text-light); margin-right: 8px; vertical-align: middle; }
    .sic-indicators { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-indicators-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .sic-indicator-card { border-radius: 12px; padding: 20px; border: 1px solid var(--border); background: #fafbfc; }
    .sic-indicator-card__title { font-size: 14px; font-weight: 700; color: var(--text-dark); margin-bottom: 8px; }
    .sic-risks { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-risks-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .sic-risk-col__title { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
    .sic-risk-item { font-size: 13px; color: var(--text-dark); margin-bottom: 8px; padding-left: 20px; position: relative; line-height: 1.5; }
    .sic-risk-item::before { content: ''; position: absolute; left: 0; top: 8px; width: 8px; height: 8px; border-radius: 50%; }
    .sic-risk-item--risk::before { background: var(--red); }
    .sic-risk-item--mitigation::before { background: var(--primary-light); }
    .sic-toc { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-toc-flow { display: flex; align-items: stretch; gap: 0; margin-top: 16px; }
    .sic-toc-step { flex: 1; text-align: center; padding: 20px 12px; border-radius: 12px; }
    .sic-toc-step__label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .sic-toc-step__text { font-size: 13px; line-height: 1.5; }
    .sic-toc-arrow { display: flex; align-items: center; font-size: 24px; color: var(--text-muted); padding: 0 4px; }
    .sic-odd { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-odd-table { width: 100%; border-collapse: collapse; }
    .sic-odd-badge { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 8px; color: white; font-weight: 700; font-size: 14px; }
    .sic-odd-stars { display: flex; gap: 2px; }
    .sic-odd-star { width: 16px; height: 16px; border-radius: 50%; }
    .sic-odd-star--filled { background: var(--primary-light); }
    .sic-odd-star--empty { background: #e0e0e0; }
    .sic-alignment { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-alignment__bullet { font-size: 14px; color: var(--text-dark); line-height: 1.7; margin-bottom: 8px; }
    .sic-recos { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-reco-card { border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 4px solid; }
    .sic-reco-card__priority { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .sic-reco-card__title { font-size: 15px; font-weight: 700; color: var(--text-dark); margin-bottom: 8px; }
    .sic-reco-card__text { font-size: 13px; color: var(--text-medium); line-height: 1.6; }
    .sic-outcomes { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-table { width: 100%; border-collapse: collapse; }
    .sic-table th { background: var(--primary); color: white; padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; }
    .sic-table th:first-child { border-radius: 8px 0 0 0; }
    .sic-table th:last-child { border-radius: 0 8px 0 0; }
    .sic-table td { padding: 14px 16px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: var(--text-dark); vertical-align: top; }
    .sic-maturity { background: var(--bg-card); border-radius: 16px; padding: 32px; margin: 24px 0; border: 1px solid var(--border); }
    .sic-maturity-track { display: flex; align-items: center; gap: 0; margin: 24px 0; position: relative; }
    .sic-maturity-step { flex: 1; text-align: center; padding: 16px 8px; position: relative; z-index: 1; }
    .sic-maturity-dot { width: 32px; height: 32px; border-radius: 50%; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
    .sic-maturity-dot--active { background: var(--primary-light); color: white; transform: scale(1.3); }
    .sic-maturity-dot--done { background: var(--primary-bg); color: var(--primary-light); }
    .sic-maturity-dot--future { background: #e5e7eb; color: var(--text-muted); }
    .sic-maturity-label { font-size: 12px; font-weight: 600; }
    .sic-maturity-line { position: absolute; top: 50%; left: 10%; right: 10%; height: 3px; background: #e5e7eb; z-index: 0; }
    .sic-recap { background: linear-gradient(135deg, #1a3a2a 0%, #1b5e20 40%, #2e7d32 100%); border-radius: 16px; padding: 40px; margin: 24px 0 48px; color: white; text-align: center; }
    .sic-recap__title { font-size: 28px; font-weight: 800; margin-bottom: 6px; }
    .sic-recap__subtitle { font-size: 16px; font-weight: 500; opacity: 0.9; margin-bottom: 4px; }
    .sic-recap__meta { font-size: 13px; opacity: 0.7; margin-bottom: 4px; }
    .sic-recap__footer { font-size: 12px; opacity: 0.5; margin-top: 12px; }
    @media print { body { background: white; } .sic-header { page-break-after: avoid; } .sic-score-hero { box-shadow: none; border: 1px solid #e5e7eb; } .sic-container > * { page-break-inside: avoid; } .no-print { display: none !important; } }
    @media (max-width: 768px) { .sic-score-hero__grid { grid-template-columns: 1fr; text-align: center; } .sic-kpi-grid { grid-template-columns: repeat(2, 1fr); } .sic-canvas-grid { grid-template-columns: 1fr 1fr; } .sic-indicators-grid { grid-template-columns: 1fr; } .sic-risks-grid { grid-template-columns: 1fr; } .sic-toc-flow { flex-direction: column; } .sic-toc-arrow { transform: rotate(90deg); justify-content: center; } }
  </style>
</head>
<body>
  <!-- ═══ HEADER ═══ -->
  <div class="sic-header">
    <div class="sic-container sic-header__inner">
      <div class="sic-header__icon">🌍</div>
      <div class="sic-header__title">Social Impact Canvas</div>
      <div class="sic-header__subtitle">Analyse d'impact social & environnemental complète</div>
      <div class="sic-header__meta">${companyName} — ${sectorStr} — ${country || "Côte d'Ivoire"}</div>
      <div class="sic-header__footer">
        <span>🤖 Analyse propulsée par Claude AI • ${monthYear}</span>
        <span>•</span>
        <span>${sectorStr} — ${locationStr || country || "Côte d'Ivoire"}</span>
      </div>
    </div>
  </div>

  <div class="sic-container">
    <!-- ═══ SCORE HERO ═══ -->
    <div class="sic-score-hero">
      <div class="sic-score-hero__grid">
        <div class="sic-score-circle" style="background: ${scoreColor};">
          <span class="sic-score-circle__value">${scoreGlobal}</span>
          <span class="sic-score-circle__unit">/100</span>
        </div>
        <div>
          <div class="sic-score-status" style="color: ${scoreColor};">Impact Social : ${analysis.label || ''}</div>
          <div class="sic-score-desc">${analysis.synthese_impact || ''}</div>
          <div class="sic-score-bars">${dimBarsHtml}</div>
        </div>
      </div>
    </div>

    <!-- ═══ SYNTHÈSE ═══ -->
    <div class="sic-synthesis">
      <div class="sic-section-title">📊 Synthèse d'Impact</div>
      <div class="sic-synthesis__text">${analysis.synthese_impact || 'Synthèse non disponible.'}</div>
      <div class="sic-kpi-grid">
        <div class="sic-kpi-card" style="background: ${COLORS.primaryBg};">
          <div class="sic-kpi-card__value" style="color: ${COLORS.primaryLight};">${fmtNum(ck.beneficiaires_directs?.nombre || 0)}</div>
          <div class="sic-kpi-card__label">Bénéficiaires directs (${ck.beneficiaires_directs?.horizon || '3 ans'})</div>
        </div>
        <div class="sic-kpi-card" style="background: ${COLORS.accentLight};">
          <div class="sic-kpi-card__value" style="color: ${COLORS.accent};">${fmtNum(ck.beneficiaires_indirects?.nombre || 0)}</div>
          <div class="sic-kpi-card__label">Bénéficiaires indirects</div>
        </div>
        <div class="sic-kpi-card" style="background: ${COLORS.orangeLight};">
          <div class="sic-kpi-card__value" style="color: ${COLORS.orange};">${fmtNum(ck.impact_total_projete?.nombre || 0)}</div>
          <div class="sic-kpi-card__label">Impact total projeté</div>
        </div>
        <div class="sic-kpi-card" style="background: ${COLORS.primaryBg};">
          <div class="sic-kpi-card__value" style="color: ${COLORS.primary};">${ck.odd_adresses?.nombre || odds.length}</div>
          <div class="sic-kpi-card__label">ODD adressés</div>
        </div>
      </div>
    </div>

    <!-- ═══ DIMENSION DETAIL ═══ -->
    <div class="sic-synthesis" style="margin:24px 0;">
      <div class="sic-section-title">📈 Scoring détaillé par dimension</div>
      ${dimDetailsHtml}
    </div>

    <!-- ═══ CANVAS VISUEL ═══ -->
    <div class="sic-canvas">
      <div class="sic-section-title">🗺️ Canvas d'Impact Social</div>
      <div class="sic-canvas-grid">${canvasHtml}</div>
    </div>

    <!-- ═══ INDICATEURS ═══ -->
    ${(indMes.indicateurs || []).length > 0 ? `
    <div class="sic-indicators">
      <div class="sic-section-title">📏 Indicateurs & Mesure d'Impact</div>
      <div class="sic-indicators-grid">${indicateursHtml}</div>
      ${indMes.methode ? `<div style="margin-top:16px;font-size:13px;color:${COLORS.textMedium};"><strong>Méthode :</strong> ${indMes.methode} — <strong>Fréquence :</strong> ${indMes.frequence || 'Non précisée'} — <strong>Cible 1 an :</strong> ${indMes.cible_1_an || 'Non précisée'}</div>` : ''}
    </div>` : ''}

    <!-- ═══ ODD ═══ -->
    ${odds.length > 0 ? `
    <div class="sic-odd">
      <div class="sic-section-title">🎯 Objectifs de Développement Durable (${odds.length} ODD)</div>
      <table class="sic-odd-table" style="margin-top:16px;">
        <thead><tr>
          <th style="background:${COLORS.primary};color:white;padding:12px;border-radius:8px 0 0 0;">ODD</th>
          <th style="background:${COLORS.primary};color:white;padding:12px;">Nom</th>
          <th style="background:${COLORS.primary};color:white;padding:12px;">Alignement</th>
          <th style="background:${COLORS.primary};color:white;padding:12px;border-radius:0 8px 0 0;">Justification</th>
        </tr></thead>
        <tbody>${oddRowsHtml}</tbody>
      </table>
    </div>` : ''}

    <!-- ═══ THÉORIE DU CHANGEMENT ═══ -->
    <div class="sic-toc">
      <div class="sic-section-title">🔄 Théorie du Changement</div>
      <div class="sic-toc-flow">${tdcHtml}</div>
    </div>

    <!-- ═══ CHANGEMENTS ═══ -->
    ${changementsHtml}

    <!-- ═══ RISQUES ═══ -->
    <div class="sic-risks">
      <div class="sic-section-title">⚠️ Risques & Atténuation</div>
      ${risksHtml}
    </div>

    <!-- ═══ BMC CROSS-CHECK ═══ -->
    ${bmcHtml}

    <!-- ═══ ALIGNEMENT MODÈLE ═══ -->
    ${alignHtml}

    <!-- ═══ RECOMMANDATIONS ═══ -->
    ${recos.length > 0 ? `
    <div class="sic-recos">
      <div class="sic-section-title">💡 Top ${recos.length} Recommandations</div>
      ${recosHtml}
    </div>` : ''}

    <!-- ═══ MATURITÉ ═══ -->
    <div class="sic-maturity">
      <div class="sic-section-title">🎯 Niveau de Maturité d'Impact</div>
      <div class="sic-maturity-track">
        <div class="sic-maturity-line"></div>
        ${maturityHtml}
      </div>
    </div>

    <!-- ═══ RECAP FOOTER ═══ -->
    <div class="sic-recap">
      <div class="sic-recap__title">${companyName}</div>
      <div class="sic-recap__subtitle">${analysis.label || ''} — Score ${scoreGlobal}/100</div>
      <div class="sic-recap__meta">${sectorStr} • ${locationStr || country || "Côte d'Ivoire"}</div>
      <div class="sic-recap__meta">${entrepreneurName} • ${dateStr}</div>
      <div class="sic-recap__footer">Social Impact Canvas — Analyse propulsée par Claude AI — e-SONO</div>
    </div>
  </div>
</body>
</html>`
}
