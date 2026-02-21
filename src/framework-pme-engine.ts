// ═══════════════════════════════════════════════════════════════
// MODULE 4 — FRAMEWORK ANALYSE PME (Cœur du moteur financier)
// Génère un livrable Excel 8 feuilles conforme au template
// Framework_Analyse_PME_Cote_Ivoire.xlsx
// Upgraded: Claude AI enrichment for expert commentary
// ═══════════════════════════════════════════════════════════════

import { callClaudeJSON, isValidApiKey, KBContext } from './claude-api'
import type { CrossAnalysisResult } from './pme-cross-analyzer'
import type { EstimationMeta } from './pme-ai-extractor'

// ─── INPUT TYPES ───

export interface PmeInputData {
  // Infos entreprise
  companyName: string
  sector: string
  analysisDate: string
  consultant: string
  location: string
  country: string

  // Activités (up to 3 + autres)
  activities: { name: string; isStrategic: boolean }[]

  // Historique (N-2, N-1, N) — all in FCFA
  historique: {
    // CA
    caTotal: [number, number, number]
    caByActivity: [number, number, number][] // per activity
    // Coûts directs
    achatsMP: [number, number, number]
    sousTraitance: [number, number, number]
    coutsProduction: [number, number, number]
    // Charges fixes
    salaires: [number, number, number]
    loyers: [number, number, number]
    assurances: [number, number, number]
    fraisGeneraux: [number, number, number]
    marketing: [number, number, number]
    fraisBancaires: [number, number, number]
    // Résultat
    resultatNet: [number, number, number]
    // Trésorerie
    tresoDebut: [number, number, number]
    tresoFin: [number, number, number]
    // BFR
    dso: [number, number, number] // jours
    dpo: [number, number, number] // jours
    stockJours: [number, number, number] // jours
    // Dettes
    detteCT: [number, number, number]
    detteLT: [number, number, number]
    serviceDette: [number, number, number] // remboursement annuel
    amortissements: [number, number, number]
  }

  // Hypothèses de projection (5 ans)
  hypotheses: {
    croissanceCA: [number, number, number, number, number] // %
    caObjectifs?: [number, number, number, number, number] // Absolute CA targets (FCFA) — overrides croissanceCA if provided
    croissanceParActivite?: [number, number, number, number, number][]
    evolutionPrix: [number, number, number, number, number] // %
    evolutionCoutsDirects: [number, number, number, number, number] // %
    inflationChargesFixes: [number, number, number, number, number] // %
    evolutionMasseSalariale: [number, number, number, number, number] // %
    capex: [number, number, number, number, number] // FCFA
    amortissement: number // durée en années
    nouveauxClients?: [number, number, number, number, number]
    // Plan d'embauche
    embauches?: { poste: string; annee: number; salaireMensuel: number }[]
    // Investissements détaillés
    investissements?: { description: string; montants: [number, number, number, number, number] }[]
  }
}

// ─── COMPUTED TYPES ───

interface HistoriqueComputed {
  // Computed from inputs
  totalCoutsDirects: [number, number, number]
  margeBrute: [number, number, number]
  margeBrutePct: [number, number, number]
  totalChargesFixes: [number, number, number]
  ebitda: [number, number, number]
  margeEbitdaPct: [number, number, number]
  margeNettePct: [number, number, number]
  variationTreso: [number, number, number]
  // Ratios
  chargesFixesSurCA: [number, number, number]
  masseSalarialeSurCA: [number, number, number]
  cashFlowOp: [number, number, number]
  caf: [number, number, number]
  dscr: [number, number, number]
  bfr: [number, number, number]
  bfrSurCA: [number, number, number]
  totalDettes: [number, number, number]
  detteSurEbitda: [number, number, number]
  // Evolution
  cagrCA: number
  tendances: Record<string, string>
}

interface MargeParActivite {
  name: string
  ca: number
  coutsDirects: number
  margeBrute: number
  margePct: number
  classification: 'renforcer' | 'optimiser' | 'arbitrer' | 'arreter'
  isStrategic: boolean
}

interface Projection5Ans {
  annees: number[] // 1-5
  caTotal: number[]
  caByActivity: number[][]
  coutsDirects: number[]
  margeBrute: number[]
  margeBrutePct: number[]
  chargesFixes: number[]
  salaires: number[]
  loyers: number[]
  autresCharges: number[]
  ebitda: number[]
  margeEbitdaPct: number[]
  amortissements: number[]
  fraisFinanciers: number[]
  resultatAvantImpot: number[]
  impot: number[]
  resultatNet: number[]
  margeNettePct: number[]
  // Cash-flow
  cashFlowOp: number[]
  capex: number[]
  variationBFR: number[]
  remboursementDettes: number[]
  cashFlowNet: number[]
  tresoCumulee: number[]
  // Point mort
  chargesFixesAnnuelles: number[]
  margeSurCoutsVariablesPct: number[]
  caPointMort: number[]
  moisPointMort: number[]
  cagrCA: number
}

interface Scenario {
  nom: string
  croissanceCAGR: number
  margeBrutePct: number
  chargesFixesSurCA: number
  investissements: string
  // Résultats An 5
  caAn5: number
  ebitdaAn5: number
  margeEbitdaAn5: number
  resultatNetAn5: number
  tresoCumulee: number
  roi: number
}

interface Sensibilite {
  label: string
  impactEbitda: number
  impactResultatNet: number
  impactTreso: number
}

export interface PmeAnalysisResult {
  companyName: string
  sector: string
  analysisDate: string
  consultant: string
  historique: HistoriqueComputed
  margesParActivite: MargeParActivite[]
  projection: Projection5Ans
  scenarios: Scenario[]
  sensibilites: Sensibilite[]
  alertes: { type: 'danger' | 'warning' | 'info'; message: string }[]
  forces: string[]
  faiblesses: string[]
  recommandations: string[]
  phraseCleDirigeant: string
  aiSource?: 'claude' | 'fallback'
  aiExpertCommentary?: PmeAIExpertCommentary
  // CORRECTION 3+4: enrichment context
  enrichmentContext?: PmeEnrichmentContext
}

/** AI-enriched expert commentary from Claude */
export interface PmeAIExpertCommentary {
  syntheseExecutive: string
  forcesExpert: string[]
  faiblessesExpert: string[]
  recommandationsStrategiques: Array<{ action: string; horizon: 'court' | 'moyen' | 'long'; impact: string; chiffrage?: string }>
  analyseScenariosComment: string
  alertesSectorielles: string[]
  bailleursPotentiels: Array<{ nom: string; raison: string; ticket: string; instrument: string }>
  risquesCles: Array<{ risque: string; probabilite: 'haute' | 'moyenne' | 'basse'; mitigation: string }>
  phraseCleDirigeant: string
  scoreInvestissabilite: number // 0-100
  commentaireInvestisseur: string
  // CORRECTION 4: Commentaires experts par feuille Excel
  commentaires_par_feuille?: SheetComments
}

/** CORRECTION 4: Expert comments for each Excel sheet */
export interface SheetComment {
  verdict: string
  alertes: string[]
  phrase_cle: string
}

export interface SheetComments {
  donnees_historiques?: SheetComment
  analyse_marges?: SheetComment
  structure_couts?: SheetComment
  tresorerie_bfr?: SheetComment
  hypotheses?: SheetComment
  projections_5ans?: SheetComment
  scenarios?: SheetComment
}

/** Cross-analysis results (CORRECTION 3) stored on the analysis */
export interface PmeEnrichmentContext {
  crossAnalysis?: CrossAnalysisResult
  estimations?: EstimationMeta[]
  extractionSource?: 'claude' | 'regex' | 'hybride'
}

// ─── HELPER FUNCTIONS ───

function pct(num: number, den: number): number {
  if (den === 0) return 0
  return Math.round((num / den) * 10000) / 100
}

function fmt(n: number): string {
  if (n === 0) return '0'
  const rounded = Math.round(n)
  const isNeg = rounded < 0
  const abs = Math.abs(rounded).toString()
  // Manual thousands separator (space for FR format)
  let result = ''
  for (let i = 0; i < abs.length; i++) {
    if (i > 0 && (abs.length - i) % 3 === 0) result += ' '
    result += abs[i]
  }
  return isNeg ? '-' + result : result
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%'
}

function cagr(start: number, end: number, years: number): number {
  if (start <= 0 || end <= 0 || years <= 0) return 0
  return Math.round((Math.pow(end / start, 1 / years) - 1) * 10000) / 100
}

function evolution3(arr: [number, number, number]): string {
  if (arr[0] === 0) return 'N/A'
  const evo = pct(arr[2] - arr[0], arr[0])
  return (evo >= 0 ? '+' : '') + fmtPct(evo)
}

function sum3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

// ─── MAIN ANALYSIS FUNCTION ───

export function analyzePme(data: PmeInputData): PmeAnalysisResult {
  const h = data.historique
  const hyp = data.hypotheses
  const alertes: PmeAnalysisResult['alertes'] = []

  // ═══ 1. COMPUTE HISTORIQUE ═══
  const totalCoutsDirects: [number, number, number] = [
    h.achatsMP[0] + h.sousTraitance[0] + h.coutsProduction[0],
    h.achatsMP[1] + h.sousTraitance[1] + h.coutsProduction[1],
    h.achatsMP[2] + h.sousTraitance[2] + h.coutsProduction[2]
  ]

  const margeBrute: [number, number, number] = [
    h.caTotal[0] - totalCoutsDirects[0],
    h.caTotal[1] - totalCoutsDirects[1],
    h.caTotal[2] - totalCoutsDirects[2]
  ]

  const margeBrutePct: [number, number, number] = [
    pct(margeBrute[0], h.caTotal[0]),
    pct(margeBrute[1], h.caTotal[1]),
    pct(margeBrute[2], h.caTotal[2])
  ]

  const totalChargesFixes: [number, number, number] = [
    h.salaires[0] + h.loyers[0] + h.assurances[0] + h.fraisGeneraux[0] + h.marketing[0] + h.fraisBancaires[0],
    h.salaires[1] + h.loyers[1] + h.assurances[1] + h.fraisGeneraux[1] + h.marketing[1] + h.fraisBancaires[1],
    h.salaires[2] + h.loyers[2] + h.assurances[2] + h.fraisGeneraux[2] + h.marketing[2] + h.fraisBancaires[2]
  ]

  const ebitda: [number, number, number] = [
    margeBrute[0] - totalChargesFixes[0],
    margeBrute[1] - totalChargesFixes[1],
    margeBrute[2] - totalChargesFixes[2]
  ]

  const margeEbitdaPct: [number, number, number] = [
    pct(ebitda[0], h.caTotal[0]),
    pct(ebitda[1], h.caTotal[1]),
    pct(ebitda[2], h.caTotal[2])
  ]

  const margeNettePct: [number, number, number] = [
    pct(h.resultatNet[0], h.caTotal[0]),
    pct(h.resultatNet[1], h.caTotal[1]),
    pct(h.resultatNet[2], h.caTotal[2])
  ]

  const variationTreso: [number, number, number] = [
    h.tresoFin[0] - h.tresoDebut[0],
    h.tresoFin[1] - h.tresoDebut[1],
    h.tresoFin[2] - h.tresoDebut[2]
  ]

  const chargesFixesSurCA: [number, number, number] = [
    pct(totalChargesFixes[0], h.caTotal[0]),
    pct(totalChargesFixes[1], h.caTotal[1]),
    pct(totalChargesFixes[2], h.caTotal[2])
  ]

  const masseSalarialeSurCA: [number, number, number] = [
    pct(h.salaires[0], h.caTotal[0]),
    pct(h.salaires[1], h.caTotal[1]),
    pct(h.salaires[2], h.caTotal[2])
  ]

  // CAF = Résultat net + Amortissements
  const caf: [number, number, number] = [
    h.resultatNet[0] + h.amortissements[0],
    h.resultatNet[1] + h.amortissements[1],
    h.resultatNet[2] + h.amortissements[2]
  ]

  // Cash-flow opérationnel = EBITDA (approximation)
  const cashFlowOp: [number, number, number] = [ebitda[0], ebitda[1], ebitda[2]]

  // DSCR = CAF / Service dette
  const dscr: [number, number, number] = [
    h.serviceDette[0] > 0 ? Math.round((caf[0] / h.serviceDette[0]) * 100) / 100 : 99,
    h.serviceDette[1] > 0 ? Math.round((caf[1] / h.serviceDette[1]) * 100) / 100 : 99,
    h.serviceDette[2] > 0 ? Math.round((caf[2] / h.serviceDette[2]) * 100) / 100 : 99
  ]

  // BFR approximation = (DSO * CA/365) - (DPO * Achats/365) + (Stock jours * Achats/365)
  const bfr: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const creancesClients = h.dso[i] * h.caTotal[i] / 365
    const dettesFournisseurs = h.dpo[i] * totalCoutsDirects[i] / 365
    const stocks = h.stockJours[i] * totalCoutsDirects[i] / 365
    bfr[i] = Math.round(creancesClients + stocks - dettesFournisseurs)
  }

  const bfrSurCA: [number, number, number] = [
    pct(bfr[0], h.caTotal[0]),
    pct(bfr[1], h.caTotal[1]),
    pct(bfr[2], h.caTotal[2])
  ]

  const totalDettes: [number, number, number] = [
    h.detteCT[0] + h.detteLT[0],
    h.detteCT[1] + h.detteLT[1],
    h.detteCT[2] + h.detteLT[2]
  ]

  const detteSurEbitda: [number, number, number] = [
    ebitda[0] > 0 ? Math.round((totalDettes[0] / ebitda[0]) * 100) / 100 : 99,
    ebitda[1] > 0 ? Math.round((totalDettes[1] / ebitda[1]) * 100) / 100 : 99,
    ebitda[2] > 0 ? Math.round((totalDettes[2] / ebitda[2]) * 100) / 100 : 99
  ]

  const cagrCA = cagr(h.caTotal[0], h.caTotal[2], 2)

  // Tendances
  const tendances: Record<string, string> = {
    ca: evolution3(h.caTotal),
    margeBrute: evolution3(margeBrute),
    ebitda: evolution3(ebitda),
    chargesFixes: evolution3(totalChargesFixes),
    tresorerie: evolution3(h.tresoFin)
  }

  const historiqueComputed: HistoriqueComputed = {
    totalCoutsDirects, margeBrute, margeBrutePct, totalChargesFixes,
    ebitda, margeEbitdaPct, margeNettePct, variationTreso,
    chargesFixesSurCA, masseSalarialeSurCA, cashFlowOp, caf, dscr,
    bfr, bfrSurCA, totalDettes, detteSurEbitda, cagrCA, tendances
  }

  // ═══ ALERTES AUTOMATIQUES ═══
  // Marge brute
  if (margeBrutePct[2] < 20) alertes.push({ type: 'danger', message: `Marge brute ${fmtPct(margeBrutePct[2])} < 20% — Signal d'alerte critique en Afrique de l'Ouest` })
  else if (margeBrutePct[2] < 35) alertes.push({ type: 'warning', message: `Marge brute ${fmtPct(margeBrutePct[2])} en dessous du benchmark sectoriel (25-40%)` })
  if (margeBrutePct[2] > 70) alertes.push({ type: 'warning', message: `Marge brute ${fmtPct(margeBrutePct[2])} > 70% — Vérifier si des coûts n'ont pas été oubliés` })

  // Assurance
  if (h.assurances[2] === 0) alertes.push({ type: 'warning', message: `Assurance = 0 FCFA — Estimation recommandée : 1-3% du CA (${fmt(h.caTotal[2] * 0.02)} FCFA)` })

  // DSO
  if (h.dso[2] > 60) alertes.push({ type: 'danger', message: `DSO = ${h.dso[2]} jours > 60 jours — Risque majeur de trésorerie` })
  else if (h.dso[2] > 45) alertes.push({ type: 'warning', message: `DSO = ${h.dso[2]} jours — Au-dessus du benchmark (30-45j)` })

  // DSCR
  if (dscr[2] < 1.2 && h.serviceDette[2] > 0) alertes.push({ type: 'danger', message: `DSCR = ${dscr[2]} < 1.2 — Incapacité à couvrir le service de la dette` })

  // Croissance An1 excessive
  if (hyp.croissanceCA[0] > 50) alertes.push({ type: 'warning', message: `Croissance An 1 (${hyp.croissanceCA[0]}%) > 50% — Optimiste sauf contrats signés` })

  // Charges fixes / CA
  if (chargesFixesSurCA[2] > 60) alertes.push({ type: 'warning', message: `Charges fixes / CA = ${fmtPct(chargesFixesSurCA[2])} > 60% — Poids excessif` })

  // EBITDA négatif
  if (ebitda[2] < 0) alertes.push({ type: 'danger', message: `EBITDA négatif (${fmt(ebitda[2])} FCFA) — L'exploitation ne génère pas de cash` })

  // Vérification cohérence CA = somme activités
  const sumActivites2 = h.caByActivity.reduce((s, a) => s + a[2], 0)
  if (Math.abs(sumActivites2 - h.caTotal[2]) > h.caTotal[2] * 0.01 && sumActivites2 > 0) {
    alertes.push({ type: 'warning', message: `CA total (${fmt(h.caTotal[2])}) ≠ somme activités (${fmt(sumActivites2)}) — Écart de ${fmt(Math.abs(h.caTotal[2] - sumActivites2))} FCFA` })
  }

  // BFR
  if (bfrSurCA[2] > 20) alertes.push({ type: 'warning', message: `BFR / CA = ${fmtPct(bfrSurCA[2])} > 20% — BFR excessif` })

  // ═══ 2. MARGES PAR ACTIVITÉ ═══
  const margesParActivite: MargeParActivite[] = data.activities.map((act, idx) => {
    const caAct = h.caByActivity[idx]?.[2] ?? 0
    const coSharePct = h.caTotal[2] > 0 ? caAct / h.caTotal[2] : 0
    const coutsAct = Math.round(totalCoutsDirects[2] * coSharePct)
    const margeBruteAct = caAct - coutsAct
    const margePctAct = pct(margeBruteAct, caAct)
    const isRentable = margePctAct >= 25

    let classification: MargeParActivite['classification']
    if (act.isStrategic && isRentable) classification = 'renforcer'
    else if (act.isStrategic && !isRentable) classification = 'optimiser'
    else if (!act.isStrategic && isRentable) classification = 'arbitrer'
    else classification = 'arreter'

    return {
      name: act.name,
      ca: caAct,
      coutsDirects: coutsAct,
      margeBrute: margeBruteAct,
      margePct: margePctAct,
      classification,
      isStrategic: act.isStrategic
    }
  })

  // ═══ 3. PROJECTION 5 ANS ═══
  const projection: Projection5Ans = {
    annees: [1, 2, 3, 4, 5],
    caTotal: [],
    caByActivity: data.activities.map(() => []),
    coutsDirects: [],
    margeBrute: [],
    margeBrutePct: [],
    chargesFixes: [],
    salaires: [],
    loyers: [],
    autresCharges: [],
    ebitda: [],
    margeEbitdaPct: [],
    amortissements: [],
    fraisFinanciers: [],
    resultatAvantImpot: [],
    impot: [],
    resultatNet: [],
    margeNettePct: [],
    cashFlowOp: [],
    capex: [],
    variationBFR: [],
    remboursementDettes: [],
    cashFlowNet: [],
    tresoCumulee: [],
    chargesFixesAnnuelles: [],
    margeSurCoutsVariablesPct: [],
    caPointMort: [],
    moisPointMort: [],
    cagrCA: 0
  }

  let prevCA = h.caTotal[2]
  let prevCoutsDirects = totalCoutsDirects[2]
  const ratioCDBase = h.caTotal[2] > 0 ? totalCoutsDirects[2] / h.caTotal[2] : 0.45 // ratio CD/CA figé de l'année N
  let prevChargesFixes = totalChargesFixes[2]
  let prevSalaires = h.salaires[2]
  let prevLoyers = h.loyers[2]
  let prevBFR = bfr[2]
  let cumAmort = 0
  let tresoCum = h.tresoFin[2]
  const IS_RATE = 0.25 // Taux IS Côte d'Ivoire

  // PRE-VALIDATION: Sanitize hypothesis ranges to prevent unrealistic projections
  // These guards ensure ANY company's data produces coherent results
  // ONLY apply when no absolute CA objectives are provided
  const hasAbsoluteCA = hyp.caObjectifs && hyp.caObjectifs.some(v => v > 0)
  const cfSurCA_N = totalChargesFixes[2] / h.caTotal[2]
  if (!hasAbsoluteCA) {
    for (let i = 0; i < 5; i++) {
      // Cap revenue growth at 50% per year (already generous for PME)
      if (hyp.croissanceCA[i] > 50) hyp.croissanceCA[i] = 50
      if (hyp.croissanceCA[i] < -30) hyp.croissanceCA[i] = -30
    }
  }
  for (let i = 0; i < 5; i++) {
    // Cap cost evolution at reasonable level
    if (hyp.evolutionCoutsDirects[i] > 5) hyp.evolutionCoutsDirects[i] = 5
    // Salary growth: NEVER exceed CA growth. If CF/CA is already high, reduce even more
    const effectiveCAGrowth = hasAbsoluteCA ? 30 : hyp.croissanceCA[i] // Use 30% as max ref for absolute CA
    const maxSalGrowth = cfSurCA_N > 0.5 
      ? Math.min(effectiveCAGrowth, 5) // If CF>50% CA, salaries grow max 5% or CA growth
      : Math.min(effectiveCAGrowth + 3, 10) // Otherwise max CA+3% or 10%
    if (hyp.evolutionMasseSalariale[i] > maxSalGrowth) {
      hyp.evolutionMasseSalariale[i] = maxSalGrowth
    }
    // Cap fixed charge inflation at 5%
    if (hyp.inflationChargesFixes[i] > 5) hyp.inflationChargesFixes[i] = 5
  }

  // PRE-VALIDATION: Cap total hiring costs to max 10% of current CA per year
  const maxEmbauchesCostPerYear = h.caTotal[2] * 0.10
  if (hyp.embauches?.length) {
    const costByYear: Record<number, number> = {}
    for (const emb of hyp.embauches) {
      const yr = emb.annee || 1
      costByYear[yr] = (costByYear[yr] || 0) + emb.salaireMensuel * 12
    }
    for (const [yr, cost] of Object.entries(costByYear)) {
      if (cost > maxEmbauchesCostPerYear) {
        // Scale down all salaries in this year proportionally
        const scale = maxEmbauchesCostPerYear / cost
        for (const emb of hyp.embauches) {
          if (emb.annee === Number(yr)) {
            emb.salaireMensuel = Math.round(emb.salaireMensuel * scale)
          }
        }
        console.log(`[PME Engine] Embauches Y${yr} capped: ${Math.round(cost/1e6)}M → ${Math.round(maxEmbauchesCostPerYear/1e6)}M FCFA`)
      }
    }
  }

  for (let y = 0; y < 5; y++) {
    // CA — Use absolute objectives if provided, otherwise use growth rates
    const growthCA = hyp.croissanceCA[y] / 100
    let ca: number
    if (hasAbsoluteCA && hyp.caObjectifs![y] > 0) {
      ca = hyp.caObjectifs![y]
    } else {
      ca = Math.round(prevCA * (1 + growthCA))
    }
    projection.caTotal.push(ca)

    // CA par activité
    for (let a = 0; a < data.activities.length; a++) {
      if (hasAbsoluteCA && hyp.caObjectifs![y] > 0) {
        // Distribute absolute CA proportionally across activities based on year N ratio
        const totalCAN = h.caByActivity.reduce((s, act) => s + (act[2] || 0), 0)
        const actRatio = totalCAN > 0 ? (h.caByActivity[a]?.[2] ?? 0) / totalCAN : (1 / data.activities.length)
        projection.caByActivity[a].push(Math.round(ca * actRatio))
      } else {
        const actGrowth = hyp.croissanceParActivite?.[a]?.[y] ?? hyp.croissanceCA[y]
        const prevActCA = y === 0 ? (h.caByActivity[a]?.[2] ?? 0) : projection.caByActivity[a][y - 1]
        projection.caByActivity[a].push(Math.round(prevActCA * (1 + actGrowth / 100)))
      }
    }

    // Coûts directs — MAINTENIR le ratio coûts/CA de l'année N stable
    // Seule l'inflation unitaire des coûts s'applique (pas de double-croissance)
    const growthCD = hyp.evolutionCoutsDirects[y] / 100
    const cd = Math.round(ca * ratioCDBase * (1 + growthCD * (y + 1))) // inflation linéaire sur le ratio de base
    projection.coutsDirects.push(cd)

    // Marge brute
    const mb = ca - cd
    projection.margeBrute.push(mb)
    projection.margeBrutePct.push(pct(mb, ca))

    // Charges fixes — Les salaires ne doivent PAS croître plus vite que le CA
    const infCF = hyp.inflationChargesFixes[y] / 100
    const growthMS = hyp.evolutionMasseSalariale[y] / 100
    // GUARD: la masse salariale ne peut pas croître plus vite que le CA (+5% marge)
    const maxSalGrowth = growthCA + 0.05
    const effectiveSalGrowth = Math.min(growthMS, maxSalGrowth)
    const sal = Math.round(prevSalaires * (1 + effectiveSalGrowth))
    const loy = Math.round(prevLoyers * (1 + infCF))
    const autresFixed = Math.round((prevChargesFixes - prevSalaires - prevLoyers) * (1 + infCF))

    // Ajout embauches
    let embauchesCout = 0
    for (const emb of hyp.embauches ?? []) {
      if (emb.annee === y + 1) embauchesCout += emb.salaireMensuel * 12
    }

    let totalCF = sal + loy + autresFixed + embauchesCout
    
    // GUARD: Si les charges fixes dépassent 95% de la marge brute, cap les embauches
    // Une entreprise réelle ne s'autodétruirait pas en embauchant au-delà de ses moyens
    if (totalCF > mb * 0.95 && embauchesCout > 0) {
      const maxEmbCost = Math.max(0, mb * 0.90 - (sal + loy + autresFixed))
      embauchesCout = Math.min(embauchesCout, Math.max(0, maxEmbCost))
      totalCF = sal + loy + autresFixed + embauchesCout
    }
    projection.salaires.push(sal + embauchesCout)
    projection.loyers.push(loy)
    projection.autresCharges.push(autresFixed)
    projection.chargesFixes.push(totalCF)

    // EBITDA
    const ebitdaY = mb - totalCF
    projection.ebitda.push(ebitdaY)
    projection.margeEbitdaPct.push(pct(ebitdaY, ca))

    // Amortissements
    const capexY = hyp.capex[y]
    const amortDuree = hyp.amortissement || 5
    cumAmort += capexY / amortDuree
    const amortY = Math.round(cumAmort + h.amortissements[2])
    projection.amortissements.push(amortY)

    // Résultat
    const fraisFin = Math.round(h.fraisBancaires[2] * Math.pow(0.95, y)) // décroissant
    projection.fraisFinanciers.push(fraisFin)
    const rai = ebitdaY - amortY - fraisFin
    projection.resultatAvantImpot.push(rai)
    const impot = rai > 0 ? Math.round(rai * IS_RATE) : 0
    projection.impot.push(impot)
    const rn = rai - impot
    projection.resultatNet.push(rn)
    projection.margeNettePct.push(pct(rn, ca))

    // Cash-flow
    const cfo = ebitdaY
    projection.cashFlowOp.push(cfo)
    projection.capex.push(capexY)

    // Variation BFR (proportionnelle au CA)
    const newBFR = Math.round(bfr[2] * ca / h.caTotal[2])
    const varBFR = newBFR - prevBFR
    projection.variationBFR.push(varBFR)

    // Service dette (décroissant progressivement)
    const remb = Math.round(h.serviceDette[2] * Math.max(0, 1 - y * 0.15))
    projection.remboursementDettes.push(remb)

    // Cash-flow net
    const cfn = cfo - capexY - varBFR - remb
    projection.cashFlowNet.push(cfn)
    tresoCum += cfn
    projection.tresoCumulee.push(tresoCum)

    // Point mort
    projection.chargesFixesAnnuelles.push(totalCF)
    const mcvPct = pct(mb, ca)
    projection.margeSurCoutsVariablesPct.push(mcvPct)
    const capm = mcvPct > 0 ? Math.round(totalCF / (mcvPct / 100)) : 0
    projection.caPointMort.push(capm)
    projection.moisPointMort.push(ca > 0 ? Math.round(capm / (ca / 12) * 10) / 10 : 99)

    // Next year base
    prevCA = ca
    prevCoutsDirects = cd
    prevChargesFixes = totalCF
    prevSalaires = sal + embauchesCout
    prevLoyers = loy
    prevBFR = newBFR
  }

  projection.cagrCA = cagr(h.caTotal[2], projection.caTotal[4], 5)

  // POST-VALIDATION: Si EBITDA négatif en Y5 alors que marge brute > 0,
  // c'est un signe que les charges fixes croissent trop vite → alerte
  if (projection.ebitda[4] < 0 && projection.margeBrute[4] > 0) {
    const cfSurCA_Y5 = projection.chargesFixes[4] / projection.caTotal[4] * 100
    alertes.push({ 
      type: 'danger', 
      message: `EBITDA négatif en Y5 (${Math.round(projection.ebitda[4]/1000000)}M FCFA). Charges fixes = ${cfSurCA_Y5.toFixed(0)}% du CA. Réduction structurelle nécessaire.` 
    })
  }

  // ═══ 4. SCÉNARIOS ═══
  const buildScenario = (nom: string, cagrPct: number, mbPct: number, cfSurCAPct: number, investLabel: string): Scenario => {
    const caAn5 = Math.round(h.caTotal[2] * Math.pow(1 + cagrPct / 100, 5))
    const mbAn5 = Math.round(caAn5 * mbPct / 100)
    const cfAn5 = Math.round(caAn5 * cfSurCAPct / 100)
    const ebitdaAn5 = mbAn5 - cfAn5
    const margeAn5 = pct(ebitdaAn5, caAn5)
    const rnAn5 = Math.round(ebitdaAn5 * 0.65) // after tax estimate
    const totalInvest = hyp.capex.reduce((s, c) => s + c, 0)
    const tresoEst = h.tresoFin[2] + ebitdaAn5 * 3 - totalInvest // rough estimate
    const roi = totalInvest > 0 ? pct(ebitdaAn5 * 5, totalInvest) : 0

    return { nom, croissanceCAGR: cagrPct, margeBrutePct: mbPct, chargesFixesSurCA: cfSurCAPct, investissements: investLabel, caAn5, ebitdaAn5, margeEbitdaAn5: margeAn5, resultatNetAn5: rnAn5, tresoCumulee: tresoEst, roi }
  }

  const scenarios: Scenario[] = [
    // FIXED: When chargesFixesSurCA is very high (>70%), projections should show improvement
    // through economies of scale, not perpetuate the current unsustainable ratio
    buildScenario('Prudent', 10, 
      Math.max(margeBrutePct[2], 40),  // At least 40% margin target
      Math.min(chargesFixesSurCA[2], 55),  // Cap at 55% (economies of scale expected)
      'Faible'),
    buildScenario('Central', 25, 
      Math.max(margeBrutePct[2] + 5, 50),  // Improving margin
      Math.min(chargesFixesSurCA[2] - 10, 45),  // Improvement target 
      'Moyen'),
    buildScenario('Ambitieux', 40, 
      Math.min(Math.max(margeBrutePct[2] + 15, 60), 75),  // Strong margin improvement
      Math.min(Math.max(chargesFixesSurCA[2] - 25, 30), 40),  // Significant optimization
      'Élevé')
  ]

  // ═══ 5. SENSIBILITÉS ═══
  const centralEbitda5 = projection.ebitda[4] || 1
  const sensibilites: Sensibilite[] = [
    {
      label: 'CA +10%',
      impactEbitda: Math.round(projection.caTotal[4] * 0.1 * (projection.margeBrutePct[4] / 100)),
      impactResultatNet: Math.round(projection.caTotal[4] * 0.1 * (projection.margeNettePct[4] / 100)),
      impactTreso: Math.round(projection.caTotal[4] * 0.1 * (projection.margeBrutePct[4] / 100) * 0.8)
    },
    {
      label: 'Marge brute -10%',
      impactEbitda: Math.round(-projection.caTotal[4] * 0.1),
      impactResultatNet: Math.round(-projection.caTotal[4] * 0.1 * 0.75),
      impactTreso: Math.round(-projection.caTotal[4] * 0.1 * 0.8)
    },
    {
      label: 'Charges fixes +10%',
      impactEbitda: Math.round(-projection.chargesFixes[4] * 0.1),
      impactResultatNet: Math.round(-projection.chargesFixes[4] * 0.1 * 0.75),
      impactTreso: Math.round(-projection.chargesFixes[4] * 0.1)
    }
  ]

  // ═══ 6. FORCES / FAIBLESSES / RECOMMANDATIONS ═══
  const forces: string[] = []
  const faiblesses: string[] = []
  const recommandations: string[] = []

  if (cagrCA > 10) forces.push(`Croissance soutenue du CA (CAGR ${fmtPct(cagrCA)} sur 2 ans)`)
  if (margeBrutePct[2] >= 30) forces.push(`Marge brute solide (${fmtPct(margeBrutePct[2])})`)
  if (ebitda[2] > 0) forces.push(`EBITDA positif (${fmt(ebitda[2])} FCFA)`)
  if (h.tresoFin[2] > 0) forces.push(`Trésorerie positive (${fmt(h.tresoFin[2])} FCFA)`)
  if (dscr[2] >= 1.5) forces.push(`Capacité de remboursement confortable (DSCR = ${dscr[2]})`)

  if (margeBrutePct[2] < 25) faiblesses.push(`Marge brute faible (${fmtPct(margeBrutePct[2])}) — en dessous du benchmark`)
  if (chargesFixesSurCA[2] > 55) faiblesses.push(`Charges fixes élevées (${fmtPct(chargesFixesSurCA[2])} du CA)`)
  if (h.dso[2] > 45) faiblesses.push(`Délai client élevé (${h.dso[2]} jours DSO)`)
  if (ebitda[2] <= 0) faiblesses.push(`EBITDA négatif — l'exploitation détruit de la valeur`)
  if (h.assurances[2] === 0) faiblesses.push(`Aucune charge d'assurance déclarée`)
  if (masseSalarialeSurCA[2] > 40) faiblesses.push(`Masse salariale lourde (${fmtPct(masseSalarialeSurCA[2])} du CA)`)

  // Recommandations
  if (chargesFixesSurCA[2] > 50) recommandations.push('Optimiser la structure de coûts fixes — objectif < 50% du CA')
  if (h.dso[2] > 30) recommandations.push(`Réduire le DSO de ${h.dso[2]}j à 30j via facturation rapide et relances`)
  if (h.assurances[2] === 0) recommandations.push('Souscrire une assurance (1-3% du CA) pour sécuriser les actifs')
  if (margeBrutePct[2] < 35) recommandations.push('Renégocier les coûts d\'approvisionnement ou réviser les prix de vente')
  recommandations.push('Diversifier les sources de revenus pour réduire la concentration mono-produit')
  recommandations.push('Formaliser un reporting financier mensuel pour suivre les indicateurs clés')
  if (h.marketing[2] < h.caTotal[2] * 0.03) recommandations.push('Augmenter le budget marketing (objectif 3-5% du CA) pour soutenir la croissance')

  const phraseCleDirigeant = ebitda[2] > 0
    ? `Votre entreprise génère de la valeur (EBITDA ${fmt(ebitda[2])} FCFA). L'enjeu est d'optimiser la structure pour atteindre ${fmt(projection.caTotal[4])} FCFA de CA à 5 ans.`
    : `Votre exploitation consomme plus qu'elle ne produit. Priorité absolue : retrouver l'équilibre d'exploitation avant d'investir.`

  return {
    companyName: data.companyName,
    sector: data.sector,
    analysisDate: data.analysisDate,
    consultant: data.consultant,
    historique: historiqueComputed,
    margesParActivite,
    projection,
    scenarios,
    sensibilites,
    alertes,
    forces,
    faiblesses,
    recommandations,
    phraseCleDirigeant
  }
}

// ═══════════════════════════════════════════════════════════════
// EXCEL GENERATION (SpreadsheetML XML — compatible Excel/LibreOffice)
// ═══════════════════════════════════════════════════════════════

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function cellNum(val: number, style?: string): string {
  return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="Number">${val}</Data></Cell>`
}

function cellStr(val: string, style?: string): string {
  return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${xmlEscape(val)}</Data></Cell>`
}

function cellPct(val: number, style?: string): string {
  return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${fmtPct(val)}</Data></Cell>`
}

function cellFcfa(val: number, style?: string): string {
  return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="Number">${Math.round(val)}</Data></Cell>`
}

function emptyCell(style?: string): string {
  return `<Cell${style ? ` ss:StyleID="${style}"` : ''}/>`
}

function row(cells: string[]): string {
  return `<Row>${cells.join('')}</Row>`
}

function emptyRow(): string {
  return '<Row/>'
}

export function generatePmeExcelXml(data: PmeInputData, analysis: PmeAnalysisResult): string {
  const h = data.historique
  const hyp = data.hypotheses
  const hc = analysis.historique
  const p = analysis.projection

  const styles = `
  <Styles>
    <Style ss:ID="Default"><Font ss:FontName="Calibri" ss:Size="11"/></Style>
    <Style ss:ID="Title"><Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2E5090" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
    <Style ss:ID="SubTitle"><Font ss:FontName="Calibri" ss:Size="11" ss:Italic="1" ss:Color="#555555"/></Style>
    <Style ss:ID="SectionHeader"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#1F4E78"/><Interior ss:Color="#D9E2F3" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
    <Style ss:ID="ColHeader"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#4472C4" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
    <Style ss:ID="RowHeader"><Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1F4E78" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
    <Style ss:ID="Bold"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/></Style>
    <Style ss:ID="BoldNum"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/><NumberFormat ss:Format="#,##0"/></Style>
    <Style ss:ID="Num"><NumberFormat ss:Format="#,##0"/></Style>
    <Style ss:ID="Pct"><NumberFormat ss:Format="0.0%"/></Style>
    <Style ss:ID="PctBold"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/><NumberFormat ss:Format="0.0%"/></Style>
    <Style ss:ID="Green"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#006100"/><Interior ss:Color="#C6EFCE" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Orange"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#9C5700"/><Interior ss:Color="#FFEB9C" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Red"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#9C0006"/><Interior ss:Color="#FFC7CE" ss:Pattern="Solid"/></Style>
    <Style ss:ID="GrayBg"><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/></Style>
    <Style ss:ID="Italic"><Font ss:FontName="Calibri" ss:Size="10" ss:Italic="1" ss:Color="#666666"/></Style>
    <Style ss:ID="AlertDanger"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#CC0000"/></Style>
    <Style ss:ID="AlertWarning"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#CC6600"/></Style>
    <Style ss:ID="AlertInfo"><Font ss:FontName="Calibri" ss:Size="10" ss:Color="#0066CC"/></Style>
    <Style ss:ID="SWOTGreen"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#006100"/><Interior ss:Color="#E2EFDA" ss:Pattern="Solid"/></Style>
    <Style ss:ID="SWOTRed"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#9C0006"/><Interior ss:Color="#FCE4EC" ss:Pattern="Solid"/></Style>
    <Style ss:ID="SWOTBlue"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#1565C0"/><Interior ss:Color="#E3F2FD" ss:Pattern="Solid"/></Style>
    <Style ss:ID="VerdictAnalyste"><Font ss:FontName="Calibri" ss:Size="11" ss:Italic="1" ss:Color="#6B4C00"/><Interior ss:Color="#FFF9E6" ss:Pattern="Solid"/></Style>
    <Style ss:ID="VerdictAlerte"><Font ss:FontName="Calibri" ss:Size="11" ss:Italic="1" ss:Color="#9A3412"/><Interior ss:Color="#FEF5E7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="EstimatedData"><Font ss:FontName="Calibri" ss:Size="11" ss:Italic="1" ss:Color="#6B21A8"/><Interior ss:Color="#F3E8FF" ss:Pattern="Solid"/></Style>
  </Styles>`

  // CORRECTION 4: Helper to build verdict rows for each sheet
  const sheetComments = analysis.aiExpertCommentary?.commentaires_par_feuille
  
  function buildVerdictRows(sheetKey: keyof NonNullable<typeof sheetComments>): string[] {
    const comment = sheetComments?.[sheetKey]
    if (!comment) return []
    const rows: string[] = [emptyRow(), emptyRow()]
    rows.push(row([cellStr('VERDICT ANALYSTE', 'SectionHeader')]))
    if (comment.verdict) {
      rows.push(row([cellStr(comment.verdict, 'VerdictAnalyste')]))
    }
    if (comment.alertes && comment.alertes.length > 0) {
      for (const alerte of comment.alertes) {
        rows.push(row([cellStr(`\u26A0\uFE0F ${alerte}`, 'VerdictAlerte')]))
      }
    }
    if (comment.phrase_cle) {
      rows.push(row([cellStr(`\uD83D\uDCA1 ${comment.phrase_cle}`, 'VerdictAnalyste')]))
    }
    return rows
  }

  // ═══ FEUILLE 1: DONNÉES HISTORIQUES ═══
  const sheet1Rows = [
    row([cellStr('FRAMEWORK D\'ANALYSE FINANCIÈRE PME — CÔTE D\'IVOIRE', 'Title')]),
    row([cellStr('Onglet 1 : Données Historiques (3 dernières années)', 'SubTitle')]),
    emptyRow(),
    row([cellStr('INFORMATIONS ENTREPRISE', 'SectionHeader')]),
    row([cellStr('Nom de l\'entreprise:', 'Bold'), cellStr(data.companyName)]),
    row([cellStr('Secteur d\'activité:', 'Bold'), cellStr(data.sector)]),
    row([cellStr('Date d\'analyse:', 'Bold'), cellStr(data.analysisDate)]),
    row([cellStr('Consultant:', 'Bold'), cellStr(data.consultant)]),
    emptyRow(),
    row([cellStr('INDICATEURS', 'RowHeader'), cellStr('Année N-2', 'ColHeader'), cellStr('Année N-1', 'ColHeader'), cellStr('Année N', 'ColHeader'), cellStr('Évolution', 'ColHeader'), cellStr('Notes', 'ColHeader')]),
    row([cellStr('CHIFFRE D\'AFFAIRES', 'SectionHeader')]),
    row([cellStr('CA Total (FCFA)', 'Bold'), cellFcfa(h.caTotal[0], 'BoldNum'), cellFcfa(h.caTotal[1], 'BoldNum'), cellFcfa(h.caTotal[2], 'BoldNum'), cellStr(hc.tendances.ca), cellStr('')]),
    ...data.activities.map((act, i) =>
      row([cellStr(`  CA ${act.name}`), cellFcfa(h.caByActivity[i]?.[0] ?? 0, 'Num'), cellFcfa(h.caByActivity[i]?.[1] ?? 0, 'Num'), cellFcfa(h.caByActivity[i]?.[2] ?? 0, 'Num'), cellStr(h.caByActivity[i] ? evolution3(h.caByActivity[i] as [number, number, number]) : 'N/A'), cellStr('')])
    ),
    emptyRow(),
    row([cellStr('COÛTS DIRECTS', 'SectionHeader')]),
    row([cellStr('Achats matières / marchandises'), cellFcfa(h.achatsMP[0], 'Num'), cellFcfa(h.achatsMP[1], 'Num'), cellFcfa(h.achatsMP[2], 'Num'), cellStr(evolution3(h.achatsMP)), cellStr('')]),
    row([cellStr('Sous-traitance'), cellFcfa(h.sousTraitance[0], 'Num'), cellFcfa(h.sousTraitance[1], 'Num'), cellFcfa(h.sousTraitance[2], 'Num'), cellStr(evolution3(h.sousTraitance)), cellStr('')]),
    row([cellStr('Coûts de production directs'), cellFcfa(h.coutsProduction[0], 'Num'), cellFcfa(h.coutsProduction[1], 'Num'), cellFcfa(h.coutsProduction[2], 'Num'), cellStr(evolution3(h.coutsProduction)), cellStr('')]),
    row([cellStr('Total Coûts Directs', 'Bold'), cellFcfa(hc.totalCoutsDirects[0], 'BoldNum'), cellFcfa(hc.totalCoutsDirects[1], 'BoldNum'), cellFcfa(hc.totalCoutsDirects[2], 'BoldNum'), cellStr(evolution3(hc.totalCoutsDirects)), cellStr('')]),
    emptyRow(),
    row([cellStr('MARGE BRUTE', 'SectionHeader')]),
    row([cellStr('Marge Brute (FCFA)', 'Bold'), cellFcfa(hc.margeBrute[0], 'BoldNum'), cellFcfa(hc.margeBrute[1], 'BoldNum'), cellFcfa(hc.margeBrute[2], 'BoldNum'), cellStr(hc.tendances.margeBrute), cellStr('')]),
    row([cellStr('Marge Brute (%)', 'Bold'), cellPct(hc.margeBrutePct[0]), cellPct(hc.margeBrutePct[1]), cellPct(hc.margeBrutePct[2]), cellStr(''), cellStr(hc.margeBrutePct[2] >= 25 ? '✅ Benchmark OK' : '⚠️ < benchmark 25-40%')]),
    emptyRow(),
    row([cellStr('CHARGES FIXES', 'SectionHeader')]),
    row([cellStr('Salaires & charges sociales'), cellFcfa(h.salaires[0], 'Num'), cellFcfa(h.salaires[1], 'Num'), cellFcfa(h.salaires[2], 'Num'), cellStr(evolution3(h.salaires)), cellStr('')]),
    row([cellStr('Loyers'), cellFcfa(h.loyers[0], 'Num'), cellFcfa(h.loyers[1], 'Num'), cellFcfa(h.loyers[2], 'Num'), cellStr(evolution3(h.loyers)), cellStr('')]),
    row([cellStr('Assurances'), cellFcfa(h.assurances[0], 'Num'), cellFcfa(h.assurances[1], 'Num'), cellFcfa(h.assurances[2], 'Num'), cellStr(evolution3(h.assurances)), cellStr(h.assurances[2] === 0 ? '⚠️ Aucune assurance' : '')]),
    row([cellStr('Frais généraux'), cellFcfa(h.fraisGeneraux[0], 'Num'), cellFcfa(h.fraisGeneraux[1], 'Num'), cellFcfa(h.fraisGeneraux[2], 'Num'), cellStr(evolution3(h.fraisGeneraux)), cellStr('')]),
    row([cellStr('Marketing & communication'), cellFcfa(h.marketing[0], 'Num'), cellFcfa(h.marketing[1], 'Num'), cellFcfa(h.marketing[2], 'Num'), cellStr(evolution3(h.marketing)), cellStr('')]),
    row([cellStr('Frais bancaires'), cellFcfa(h.fraisBancaires[0], 'Num'), cellFcfa(h.fraisBancaires[1], 'Num'), cellFcfa(h.fraisBancaires[2], 'Num'), cellStr(evolution3(h.fraisBancaires)), cellStr('')]),
    row([cellStr('Total Charges Fixes', 'Bold'), cellFcfa(hc.totalChargesFixes[0], 'BoldNum'), cellFcfa(hc.totalChargesFixes[1], 'BoldNum'), cellFcfa(hc.totalChargesFixes[2], 'BoldNum'), cellStr(hc.tendances.chargesFixes), cellStr('')]),
    emptyRow(),
    row([cellStr('RÉSULTAT', 'SectionHeader')]),
    row([cellStr('EBITDA (Résultat d\'exploitation)'), cellFcfa(hc.ebitda[0], hc.ebitda[0] >= 0 ? 'Green' : 'Red'), cellFcfa(hc.ebitda[1], hc.ebitda[1] >= 0 ? 'Green' : 'Red'), cellFcfa(hc.ebitda[2], hc.ebitda[2] >= 0 ? 'Green' : 'Red'), cellStr(hc.tendances.ebitda), cellStr('')]),
    row([cellStr('Marge EBITDA (%)', 'Bold'), cellPct(hc.margeEbitdaPct[0]), cellPct(hc.margeEbitdaPct[1]), cellPct(hc.margeEbitdaPct[2]), cellStr(''), cellStr(hc.margeEbitdaPct[2] >= 15 ? '✅ > 15%' : '⚠️ < benchmark 15%')]),
    row([cellStr('Résultat net'), cellFcfa(h.resultatNet[0], h.resultatNet[0] >= 0 ? 'Green' : 'Red'), cellFcfa(h.resultatNet[1], h.resultatNet[1] >= 0 ? 'Green' : 'Red'), cellFcfa(h.resultatNet[2], h.resultatNet[2] >= 0 ? 'Green' : 'Red'), cellStr(''), cellStr('')]),
    row([cellStr('Marge nette (%)', 'Bold'), cellPct(hc.margeNettePct[0]), cellPct(hc.margeNettePct[1]), cellPct(hc.margeNettePct[2]), cellStr(''), cellStr('')]),
    emptyRow(),
    row([cellStr('TRÉSORERIE', 'SectionHeader')]),
    row([cellStr('Trésorerie début période'), cellFcfa(h.tresoDebut[0], 'Num'), cellFcfa(h.tresoDebut[1], 'Num'), cellFcfa(h.tresoDebut[2], 'Num'), cellStr(''), cellStr('')]),
    row([cellStr('Trésorerie fin période'), cellFcfa(h.tresoFin[0], 'Num'), cellFcfa(h.tresoFin[1], 'Num'), cellFcfa(h.tresoFin[2], 'Num'), cellStr(hc.tendances.tresorerie), cellStr('')]),
    row([cellStr('Variation trésorerie'), cellFcfa(hc.variationTreso[0], hc.variationTreso[0] >= 0 ? 'Green' : 'Red'), cellFcfa(hc.variationTreso[1], hc.variationTreso[1] >= 0 ? 'Green' : 'Red'), cellFcfa(hc.variationTreso[2], hc.variationTreso[2] >= 0 ? 'Green' : 'Red'), cellStr(''), cellStr('')]),
    // CORRECTION 4: AI verdict for this sheet
    ...buildVerdictRows('donnees_historiques')
  ]

  // ═══ FEUILLE 2: ANALYSE MARGES ═══
  const sheet2Rows = [
    row([cellStr('Onglet 2 : Analyse des Marges par Activité', 'Title')]),
    row([cellStr('Objectif : Identifier où se crée (ou se détruit) la valeur', 'SubTitle')]),
    emptyRow(),
    row([cellStr('MARGE BRUTE PAR ACTIVITÉ', 'SectionHeader')]),
    row([cellStr('Activité', 'RowHeader'), cellStr('CA (FCFA)', 'RowHeader'), cellStr('Coûts Directs', 'RowHeader'), cellStr('Marge Brute', 'RowHeader'), cellStr('Marge (%)', 'RowHeader'), cellStr('Classification', 'RowHeader')]),
    ...analysis.margesParActivite.map(m => {
      const classStyle = m.classification === 'renforcer' ? 'Green' : m.classification === 'optimiser' ? 'Orange' : m.classification === 'arbitrer' ? 'Orange' : 'Red'
      const classLabel = m.classification === 'renforcer' ? '🔥 À RENFORCER' : m.classification === 'optimiser' ? '⚠️ À OPTIMISER' : m.classification === 'arbitrer' ? '🧠 À ARBITRER' : '❌ À ARRÊTER'
      return row([cellStr(m.name), cellFcfa(m.ca, 'Num'), cellFcfa(m.coutsDirects, 'Num'), cellFcfa(m.margeBrute, m.margeBrute >= 0 ? 'Green' : 'Red'), cellPct(m.margePct), cellStr(classLabel, classStyle)])
    }),
    row([cellStr('TOTAL', 'Bold'), cellFcfa(hc.margeBrute[2] + hc.totalCoutsDirects[2], 'BoldNum'), cellFcfa(hc.totalCoutsDirects[2], 'BoldNum'), cellFcfa(hc.margeBrute[2], 'BoldNum'), cellPct(hc.margeBrutePct[2]), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('MATRICE STRATÉGIQUE 2×2', 'SectionHeader')]),
    row([cellStr(''), cellStr('RENTABLE', 'Green'), cellStr('PEU RENTABLE', 'Orange')]),
    row([cellStr('STRATÉGIQUE', 'Bold'), cellStr('🔥 À RENFORCER', 'Green'), cellStr('⚠️ À OPTIMISER', 'Orange')]),
    row([cellStr('NON STRATÉGIQUE', 'Bold'), cellStr('🧠 À ARBITRER'), cellStr('❌ À ARRÊTER', 'Red')]),
    emptyRow(),
    row([cellStr('RECOMMANDATIONS STRATÉGIQUES', 'SectionHeader')]),
    row([cellStr('Activités à renforcer :', 'Bold'), cellStr(analysis.margesParActivite.filter(m => m.classification === 'renforcer').map(m => m.name).join(', ') || '—')]),
    row([cellStr('Activités à optimiser :', 'Bold'), cellStr(analysis.margesParActivite.filter(m => m.classification === 'optimiser').map(m => m.name).join(', ') || '—')]),
    row([cellStr('Activités à arbitrer :', 'Bold'), cellStr(analysis.margesParActivite.filter(m => m.classification === 'arbitrer').map(m => m.name).join(', ') || '—')]),
    row([cellStr('Activités à arrêter :', 'Bold'), cellStr(analysis.margesParActivite.filter(m => m.classification === 'arreter').map(m => m.name).join(', ') || '—')]),
    // CORRECTION 4: AI verdict for this sheet
    ...buildVerdictRows('analyse_marges')
  ]

  // ═══ FEUILLE 3: STRUCTURE COÛTS ═══
  const sheet3Rows = [
    row([cellStr('Onglet 3 : Structure de Coûts & Efficacité Opérationnelle', 'Title')]),
    row([cellStr('Objectif : Comprendre ce qui pèse sur la rentabilité', 'SubTitle')]),
    emptyRow(),
    row([cellStr('RATIOS CLÉS D\'EFFICACITÉ', 'SectionHeader')]),
    row([cellStr('Ratio', 'RowHeader'), cellStr('Année N-2', 'RowHeader'), cellStr('Année N-1', 'RowHeader'), cellStr('Année N', 'RowHeader'), cellStr('Tendance', 'RowHeader'), cellStr('Benchmark', 'RowHeader')]),
    row([cellStr('Charges Fixes / CA', 'Bold'), cellPct(hc.chargesFixesSurCA[0]), cellPct(hc.chargesFixesSurCA[1]), cellPct(hc.chargesFixesSurCA[2], hc.chargesFixesSurCA[2] <= 55 ? 'Green' : 'Orange'), cellStr(evolution3(hc.chargesFixesSurCA)), cellStr('50-60%')]),
    row([cellStr('Masse Salariale / CA', 'Bold'), cellPct(hc.masseSalarialeSurCA[0]), cellPct(hc.masseSalarialeSurCA[1]), cellPct(hc.masseSalarialeSurCA[2], hc.masseSalarialeSurCA[2] <= 40 ? 'Green' : 'Orange'), cellStr(evolution3(hc.masseSalarialeSurCA)), cellStr('30-40%')]),
    row([cellStr('Marge Brute (%)', 'Bold'), cellPct(hc.margeBrutePct[0]), cellPct(hc.margeBrutePct[1]), cellPct(hc.margeBrutePct[2], hc.margeBrutePct[2] >= 30 ? 'Green' : 'Orange'), cellStr(''), cellStr('>60%')]),
    row([cellStr('Marge EBITDA (%)', 'Bold'), cellPct(hc.margeEbitdaPct[0]), cellPct(hc.margeEbitdaPct[1]), cellPct(hc.margeEbitdaPct[2], hc.margeEbitdaPct[2] >= 15 ? 'Green' : 'Orange'), cellStr(''), cellStr('>15%')]),
    row([cellStr('Marge Nette (%)', 'Bold'), cellPct(hc.margeNettePct[0]), cellPct(hc.margeNettePct[1]), cellPct(hc.margeNettePct[2], hc.margeNettePct[2] >= 10 ? 'Green' : 'Orange'), cellStr(''), cellStr('>10%')]),
    emptyRow(), emptyRow(),
    row([cellStr('ÉVOLUTION DES CHARGES (3 ANS)', 'SectionHeader')]),
    row([cellStr('Type de Charge', 'RowHeader'), cellStr('Année N-2', 'RowHeader'), cellStr('Année N-1', 'RowHeader'), cellStr('Année N', 'RowHeader'), cellStr('Évolution (%)', 'RowHeader'), cellStr('Notes', 'RowHeader')]),
    row([cellStr('Salaires & charges sociales'), cellFcfa(h.salaires[0], 'Num'), cellFcfa(h.salaires[1], 'Num'), cellFcfa(h.salaires[2], 'Num'), cellStr(evolution3(h.salaires)), cellStr('')]),
    row([cellStr('Loyers'), cellFcfa(h.loyers[0], 'Num'), cellFcfa(h.loyers[1], 'Num'), cellFcfa(h.loyers[2], 'Num'), cellStr(evolution3(h.loyers)), cellStr('')]),
    row([cellStr('Assurances'), cellFcfa(h.assurances[0], 'Num'), cellFcfa(h.assurances[1], 'Num'), cellFcfa(h.assurances[2], 'Num'), cellStr(evolution3(h.assurances)), cellStr(h.assurances[2] === 0 ? '⚠️ À ajouter (1-3% CA)' : '')]),
    row([cellStr('Frais généraux'), cellFcfa(h.fraisGeneraux[0], 'Num'), cellFcfa(h.fraisGeneraux[1], 'Num'), cellFcfa(h.fraisGeneraux[2], 'Num'), cellStr(evolution3(h.fraisGeneraux)), cellStr('')]),
    row([cellStr('Marketing'), cellFcfa(h.marketing[0], 'Num'), cellFcfa(h.marketing[1], 'Num'), cellFcfa(h.marketing[2], 'Num'), cellStr(evolution3(h.marketing)), cellStr('')]),
    row([cellStr('Frais bancaires'), cellFcfa(h.fraisBancaires[0], 'Num'), cellFcfa(h.fraisBancaires[1], 'Num'), cellFcfa(h.fraisBancaires[2], 'Num'), cellStr(evolution3(h.fraisBancaires)), cellStr('')]),
    row([cellStr('TOTAL CHARGES FIXES', 'Bold'), cellFcfa(hc.totalChargesFixes[0], 'BoldNum'), cellFcfa(hc.totalChargesFixes[1], 'BoldNum'), cellFcfa(hc.totalChargesFixes[2], 'BoldNum'), cellStr(hc.tendances.chargesFixes), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('DIAGNOSTIC COÛTS', 'SectionHeader')]),
    row([cellStr('Points forts :', 'Bold'), cellStr(analysis.forces.slice(0, 2).join(' · '))]),
    row([cellStr('Points faibles :', 'Bold'), cellStr(analysis.faiblesses.slice(0, 2).join(' · '))]),
    row([cellStr('Actions recommandées :', 'Bold'), cellStr(analysis.recommandations.slice(0, 2).join(' · '))]),
    // CORRECTION 4: AI verdict for this sheet
    ...buildVerdictRows('structure_couts')
  ]

  // ═══ FEUILLE 4: TRÉSORERIE & BFR ═══
  const sheet4Rows = [
    row([cellStr('Onglet 4 : Trésorerie & Besoin en Fonds de Roulement', 'Title')]),
    row([cellStr('Objectif : Évaluer la santé financière réelle', 'SubTitle')]),
    emptyRow(),
    row([cellStr('ANALYSE TRÉSORERIE', 'SectionHeader')]),
    row([cellStr('Indicateur', 'RowHeader'), cellStr('Année N-2', 'RowHeader'), cellStr('Année N-1', 'RowHeader'), cellStr('Année N', 'RowHeader'), cellStr('Évolution', 'RowHeader'), cellStr('Notes', 'RowHeader')]),
    row([cellStr('Trésorerie nette', 'Bold'), cellFcfa(h.tresoFin[0], 'Num'), cellFcfa(h.tresoFin[1], 'Num'), cellFcfa(h.tresoFin[2], h.tresoFin[2] >= 0 ? 'Green' : 'Red'), cellStr(hc.tendances.tresorerie), cellStr('')]),
    row([cellStr('Cash-flow opérationnel', 'Bold'), cellFcfa(hc.cashFlowOp[0], 'Num'), cellFcfa(hc.cashFlowOp[1], 'Num'), cellFcfa(hc.cashFlowOp[2], hc.cashFlowOp[2] >= 0 ? 'Green' : 'Red'), cellStr(''), cellStr('')]),
    row([cellStr('CAF (Capacité d\'autofinancement)', 'Bold'), cellFcfa(hc.caf[0], 'Num'), cellFcfa(hc.caf[1], 'Num'), cellFcfa(hc.caf[2], hc.caf[2] >= 0 ? 'Green' : 'Red'), cellStr(''), cellStr('')]),
    row([cellStr('DSCR (Debt Service Coverage Ratio)', 'Bold'), cellStr(hc.dscr[0] >= 99 ? 'N/A' : hc.dscr[0].toString()), cellStr(hc.dscr[1] >= 99 ? 'N/A' : hc.dscr[1].toString()), cellStr(hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toString(), hc.dscr[2] >= 1.5 ? 'Green' : hc.dscr[2] >= 1.2 ? 'Orange' : 'Red'), cellStr(''), cellStr('> 1.2 requis')]),
    emptyRow(), emptyRow(),
    row([cellStr('BESOIN EN FONDS DE ROULEMENT (BFR)', 'SectionHeader')]),
    row([cellStr('Composante', 'RowHeader'), cellStr('Année N-2', 'RowHeader'), cellStr('Année N-1', 'RowHeader'), cellStr('Année N', 'RowHeader'), cellStr('Tendance', 'RowHeader'), cellStr('Benchmark', 'RowHeader')]),
    row([cellStr('Délai paiement clients (DSO)', 'Bold'), cellStr(h.dso[0] + 'j'), cellStr(h.dso[1] + 'j'), cellStr(h.dso[2] + 'j', h.dso[2] <= 45 ? 'Green' : 'Orange'), cellStr(''), cellStr('30-45 jours')]),
    row([cellStr('Délai paiement fournisseurs (DPO)', 'Bold'), cellStr(h.dpo[0] + 'j'), cellStr(h.dpo[1] + 'j'), cellStr(h.dpo[2] + 'j'), cellStr(''), cellStr('30-60 jours')]),
    row([cellStr('Rotation stock (jours)', 'Bold'), cellStr(h.stockJours[0] + 'j'), cellStr(h.stockJours[1] + 'j'), cellStr(h.stockJours[2] + 'j', h.stockJours[2] <= 30 ? 'Green' : 'Orange'), cellStr(''), cellStr('<30 jours')]),
    row([cellStr('BFR total (FCFA)', 'Bold'), cellFcfa(hc.bfr[0], 'Num'), cellFcfa(hc.bfr[1], 'Num'), cellFcfa(hc.bfr[2], 'Num'), cellStr(''), cellStr('< 20% CA')]),
    row([cellStr('BFR / CA (%)', 'Bold'), cellPct(hc.bfrSurCA[0]), cellPct(hc.bfrSurCA[1]), cellPct(hc.bfrSurCA[2], hc.bfrSurCA[2] <= 20 ? 'Green' : 'Orange'), cellStr(''), cellStr('<20%')]),
    emptyRow(), emptyRow(),
    row([cellStr('STRUCTURE ENDETTEMENT', 'SectionHeader')]),
    row([cellStr('Dette court terme', 'Bold'), cellFcfa(h.detteCT[0], 'Num'), cellFcfa(h.detteCT[1], 'Num'), cellFcfa(h.detteCT[2], 'Num'), cellStr(''), cellStr('')]),
    row([cellStr('Dette long terme', 'Bold'), cellFcfa(h.detteLT[0], 'Num'), cellFcfa(h.detteLT[1], 'Num'), cellFcfa(h.detteLT[2], 'Num'), cellStr(''), cellStr('')]),
    row([cellStr('Total dettes', 'Bold'), cellFcfa(hc.totalDettes[0], 'BoldNum'), cellFcfa(hc.totalDettes[1], 'BoldNum'), cellFcfa(hc.totalDettes[2], 'BoldNum'), cellStr(''), cellStr('')]),
    row([cellStr('Dette / EBITDA', 'Bold'), cellStr(hc.detteSurEbitda[0] >= 99 ? 'N/A' : hc.detteSurEbitda[0].toFixed(1) + 'x'), cellStr(hc.detteSurEbitda[1] >= 99 ? 'N/A' : hc.detteSurEbitda[1].toFixed(1) + 'x'), cellStr(hc.detteSurEbitda[2] >= 99 ? 'N/A' : hc.detteSurEbitda[2].toFixed(1) + 'x', hc.detteSurEbitda[2] <= 3 ? 'Green' : 'Red'), cellStr(''), cellStr('< 3x')]),
    // CORRECTION 4: AI verdict for this sheet
    ...buildVerdictRows('tresorerie_bfr')
  ]

  // ═══ FEUILLE 5: HYPOTHÈSES PROJECTION ═══
  const sheet5Rows = [
    row([cellStr('Onglet 5 : Hypothèses de Projection (5 ans)', 'Title')]),
    row([cellStr('⚠️ Important : Toutes les hypothèses doivent être justifiées, pas optimistes', 'SubTitle')]),
    emptyRow(),
    row([cellStr('HYPOTHÈSES CHIFFRE D\'AFFAIRES', 'SectionHeader')]),
    row([cellStr('Paramètre', 'RowHeader'), cellStr('An 1', 'ColHeader'), cellStr('An 2', 'ColHeader'), cellStr('An 3', 'ColHeader'), cellStr('An 4', 'ColHeader'), cellStr('An 5', 'ColHeader'), cellStr('Justification', 'ColHeader')]),
    row([cellStr('Croissance CA globale (%)', 'Bold'), ...hyp.croissanceCA.map(v => cellPct(v)), cellStr(hyp.croissanceCA[0] > 30 ? '⚠️ Optimiste' : 'OK')]),
    ...data.activities.map((act, i) =>
      row([cellStr(`Croissance ${act.name} (%)`, 'Bold'), ...(hyp.croissanceParActivite?.[i] ?? hyp.croissanceCA).map(v => cellPct(v)), cellStr('')])
    ),
    row([cellStr('Évolution prix moyen (%)', 'Bold'), ...hyp.evolutionPrix.map(v => cellPct(v)), cellStr('')]),
    row([cellStr('Nouveaux clients (nombre)', 'Bold'), ...(hyp.nouveauxClients ?? [0,0,0,0,0]).map(v => cellNum(v)), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('HYPOTHÈSES COÛTS', 'SectionHeader')]),
    row([cellStr('Évolution coûts directs (%)', 'Bold'), ...hyp.evolutionCoutsDirects.map(v => cellPct(v)), cellStr('')]),
    row([cellStr('Inflation charges fixes (%)', 'Bold'), ...hyp.inflationChargesFixes.map(v => cellPct(v)), cellStr('CI : ~3%')]),
    row([cellStr('Évolution masse salariale (%)', 'Bold'), ...hyp.evolutionMasseSalariale.map(v => cellPct(v)), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('PLAN D\'EMBAUCHE', 'SectionHeader')]),
    row([cellStr('Poste', 'RowHeader'), cellStr('An 1', 'ColHeader'), cellStr('An 2', 'ColHeader'), cellStr('An 3', 'ColHeader'), cellStr('An 4', 'ColHeader'), cellStr('An 5', 'ColHeader'), cellStr('Salaire mensuel', 'ColHeader')]),
    ...((hyp.embauches && hyp.embauches.length > 0) ? hyp.embauches.map(emb => {
      const annees = [0,0,0,0,0]
      annees[emb.annee - 1] = 1
      return row([cellStr(emb.poste), ...annees.map(v => cellNum(v)), cellFcfa(emb.salaireMensuel, 'Num')])
    }) : [row([cellStr('Aucune embauche prévue', 'Italic')])]),
    emptyRow(), emptyRow(),
    row([cellStr('INVESTISSEMENTS (CAPEX)', 'SectionHeader')]),
    row([cellStr('Description', 'RowHeader'), cellStr('An 1', 'ColHeader'), cellStr('An 2', 'ColHeader'), cellStr('An 3', 'ColHeader'), cellStr('An 4', 'ColHeader'), cellStr('An 5', 'ColHeader'), cellStr('Total', 'ColHeader')]),
    ...(hyp.investissements ?? [{ description: 'CAPEX Global', montants: hyp.capex }]).map(inv =>
      row([cellStr(inv.description), ...inv.montants.map(v => cellFcfa(v, 'Num')), cellFcfa(inv.montants.reduce((s, v) => s + v, 0), 'BoldNum')])
    ),
    row([cellStr('Total CAPEX', 'Bold'), ...hyp.capex.map(v => cellFcfa(v, 'BoldNum')), cellFcfa(hyp.capex.reduce((s, v) => s + v, 0), 'BoldNum')]),
    // CORRECTION 4: AI verdict for this sheet
    ...buildVerdictRows('hypotheses')
  ]

  // ═══ FEUILLE 6: PROJECTION 5 ANS ═══
  const projHeaders = [cellStr('Poste', 'RowHeader'), cellStr('Année 1', 'ColHeader'), cellStr('Année 2', 'ColHeader'), cellStr('Année 3', 'ColHeader'), cellStr('Année 4', 'ColHeader'), cellStr('Année 5', 'ColHeader'), cellStr('CAGR', 'ColHeader')]
  const cagrStr = (arr: number[]) => arr.length >= 2 ? fmtPct(cagr(arr[0], arr[arr.length - 1], arr.length - 1)) : 'N/A'

  const sheet6Rows = [
    row([cellStr('Onglet 6 : Projection Financière 5 Ans', 'Title')]),
    row([cellStr('Compte de résultat prévisionnel + Cash-flow + Point mort', 'SubTitle')]),
    emptyRow(),
    row([cellStr('COMPTE DE RÉSULTAT PRÉVISIONNEL', 'SectionHeader')]),
    row(projHeaders),
    row([cellStr('CA TOTAL', 'GrayBg'), ...p.caTotal.map(v => cellFcfa(v, 'BoldNum')), cellStr(cagrStr(p.caTotal))]),
    ...data.activities.map((act, i) =>
      row([cellStr(`  CA ${act.name}`), ...p.caByActivity[i].map(v => cellFcfa(v, 'Num')), cellStr('')])
    ),
    emptyRow(),
    row([cellStr('Coûts directs'), ...p.coutsDirects.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    row([cellStr('MARGE BRUTE', 'GrayBg'), ...p.margeBrute.map(v => cellFcfa(v, 'BoldNum')), cellStr(cagrStr(p.margeBrute))]),
    row([cellStr('Marge brute (%)'), ...p.margeBrutePct.map(v => cellPct(v)), cellStr('')]),
    emptyRow(),
    row([cellStr('Charges fixes'), ...p.chargesFixes.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    row([cellStr('  Salaires'), ...p.salaires.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    row([cellStr('  Loyers'), ...p.loyers.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    row([cellStr('  Autres charges'), ...p.autresCharges.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    emptyRow(),
    row([cellStr('EBITDA', 'GrayBg'), ...p.ebitda.map(v => cellFcfa(v, v >= 0 ? 'Green' : 'Red')), cellStr(cagrStr(p.ebitda))]),
    row([cellStr('Marge EBITDA (%)'), ...p.margeEbitdaPct.map(v => cellPct(v)), cellStr('')]),
    emptyRow(),
    row([cellStr('Résultat net', 'GrayBg'), ...p.resultatNet.map(v => cellFcfa(v, v >= 0 ? 'Green' : 'Red')), cellStr(cagrStr(p.resultatNet))]),
    row([cellStr('Marge nette (%)'), ...p.margeNettePct.map(v => cellPct(v)), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('CASH-FLOW ANNUEL', 'SectionHeader')]),
    row([cellStr('Cash-flow opérationnel', 'GrayBg'), ...p.cashFlowOp.map(v => cellFcfa(v, v >= 0 ? 'Green' : 'Red')), cellStr('')]),
    row([cellStr('Investissements (CAPEX)'), ...p.capex.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    row([cellStr('Variation BFR'), ...p.variationBFR.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    row([cellStr('Remboursement dettes'), ...p.remboursementDettes.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    row([cellStr('CASH-FLOW NET', 'GrayBg'), ...p.cashFlowNet.map(v => cellFcfa(v, v >= 0 ? 'Green' : 'Red')), cellStr('')]),
    row([cellStr('Trésorerie cumulée', 'GrayBg'), ...p.tresoCumulee.map(v => cellFcfa(v, v >= 0 ? 'Green' : 'Red')), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('POINT MORT / SEUIL DE RENTABILITÉ', 'SectionHeader')]),
    row([cellStr('Charges fixes annuelles', 'Bold'), ...p.chargesFixesAnnuelles.map(v => cellFcfa(v, 'Num')), cellStr('')]),
    row([cellStr('Marge sur coûts variables (%)', 'Bold'), ...p.margeSurCoutsVariablesPct.map(v => cellPct(v)), cellStr('')]),
    row([cellStr('CA au point mort (FCFA)', 'Bold'), ...p.caPointMort.map(v => cellFcfa(v, 'BoldNum')), cellStr('')]),
    row([cellStr('Mois pour atteindre point mort', 'Bold'), ...p.moisPointMort.map(v => cellStr(v.toFixed(1))), cellStr('')]),
    emptyRow(),
    row([cellStr('ANNOTATIONS ANALYSTE', 'SectionHeader')]),
    ...analysis.alertes.map(a => row([cellStr(`${a.type === 'danger' ? '🔴' : a.type === 'warning' ? '🟠' : '🔵'} ${a.message}`, a.type === 'danger' ? 'AlertDanger' : a.type === 'warning' ? 'AlertWarning' : 'AlertInfo')])),
    // CORRECTION 4: AI verdict for this sheet
    ...buildVerdictRows('projections_5ans')
  ]

  // ═══ FEUILLE 7: SCÉNARIOS ═══
  const sheet7Rows = [
    row([cellStr('Onglet 7 : Analyse par Scénarios', 'Title')]),
    row([cellStr('Comparaison : Prudent vs Central vs Ambitieux', 'SubTitle')]),
    emptyRow(),
    row([cellStr('HYPOTHÈSES PAR SCÉNARIO (Année 5)', 'SectionHeader')]),
    row([cellStr('Hypothèse', 'RowHeader'), cellStr('Prudent', 'RowHeader'), cellStr('Central', 'RowHeader'), cellStr('Ambitieux', 'RowHeader'), cellStr('Écart', 'RowHeader')]),
    row([cellStr('Croissance CA (CAGR)', 'Bold'), cellStr('10%'), cellStr('25%'), cellStr('40%'), cellStr('')]),
    row([cellStr('Marge brute (%)', 'Bold'), cellPct(analysis.scenarios[0].margeBrutePct), cellPct(analysis.scenarios[1].margeBrutePct), cellPct(analysis.scenarios[2].margeBrutePct), cellStr('')]),
    row([cellStr('Charges fixes / CA', 'Bold'), cellPct(analysis.scenarios[0].chargesFixesSurCA), cellPct(analysis.scenarios[1].chargesFixesSurCA), cellPct(analysis.scenarios[2].chargesFixesSurCA), cellStr('')]),
    row([cellStr('Investissements totaux', 'Bold'), cellStr(analysis.scenarios[0].investissements), cellStr(analysis.scenarios[1].investissements), cellStr(analysis.scenarios[2].investissements), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('RÉSULTATS COMPARÉS (Année 5)', 'SectionHeader')]),
    row([cellStr('CA Année 5 (FCFA)', 'Bold'), ...analysis.scenarios.map(s => cellFcfa(s.caAn5, 'BoldNum')), cellStr('')]),
    row([cellStr('EBITDA (FCFA)', 'Bold'), ...analysis.scenarios.map(s => cellFcfa(s.ebitdaAn5, s.ebitdaAn5 >= 0 ? 'Green' : 'Red')), cellStr('')]),
    row([cellStr('Marge EBITDA (%)', 'Bold'), ...analysis.scenarios.map(s => cellPct(s.margeEbitdaAn5)), cellStr('')]),
    row([cellStr('Résultat net (FCFA)', 'Bold'), ...analysis.scenarios.map(s => cellFcfa(s.resultatNetAn5, s.resultatNetAn5 >= 0 ? 'Green' : 'Red')), cellStr('')]),
    row([cellStr('Trésorerie cumulée', 'Bold'), ...analysis.scenarios.map(s => cellFcfa(s.tresoCumulee, s.tresoCumulee >= 0 ? 'Green' : 'Red')), cellStr('')]),
    row([cellStr('ROI (%)', 'Bold'), ...analysis.scenarios.map(s => cellPct(s.roi)), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('ANALYSE DE SENSIBILITÉ', 'SectionHeader')]),
    row([cellStr('Impact d\'une variation sur les principaux drivers :', 'Italic')]),
    ...analysis.sensibilites.map(s =>
      row([cellStr(s.label, 'Bold'), cellStr(`EBITDA: ${s.impactEbitda >= 0 ? '+' : ''}${fmt(s.impactEbitda)}`), cellStr(`Résultat: ${s.impactResultatNet >= 0 ? '+' : ''}${fmt(s.impactResultatNet)}`), cellStr(`Tréso: ${s.impactTreso >= 0 ? '+' : ''}${fmt(s.impactTreso)}`)])
    ),
    emptyRow(), emptyRow(),
    row([cellStr('RECOMMANDATION', 'SectionHeader')]),
    row([cellStr('Scénario recommandé :', 'Bold'), cellStr('Central — approche réaliste et prudente')]),
    row([cellStr('Justification :', 'Bold'), cellStr('Équilibre entre ambition et réalisme. Hypothèses testées sur les benchmarks sectoriels.')]),
    // CORRECTION 4: AI verdict for this sheet
    ...buildVerdictRows('scenarios')
  ]

  // ═══ FEUILLE 8: SYNTHÈSE EXÉCUTIVE ═══
  const sheet8Rows = [
    row([cellStr('SYNTHÈSE EXÉCUTIVE', 'Title')]),
    row([cellStr('Format Cabinet - 3 Slides Maximum', 'SubTitle')]),
    emptyRow(),
    row([cellStr('🟢 SLIDE 1 — ÉTAT DE SANTÉ FINANCIÈRE', 'SectionHeader')]),
    emptyRow(),
    row([cellStr('Ce que montrent les chiffres', 'Bold')]),
    row([cellStr(`CA : ${fmt(h.caTotal[2])} FCFA (CAGR ${fmtPct(hc.cagrCA)}) | Marge brute : ${fmtPct(hc.margeBrutePct[2])} | EBITDA : ${fmt(hc.ebitda[2])} FCFA (${fmtPct(hc.margeEbitdaPct[2])})`)]),
    row([cellStr(`Trésorerie : ${fmt(h.tresoFin[2])} FCFA | DSCR : ${hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toString()} | BFR/CA : ${fmtPct(hc.bfrSurCA[2])}`)]),
    emptyRow(),
    row([cellStr('Forces (2-3 points)', 'SWOTGreen')]),
    ...analysis.forces.slice(0, 3).map(f => row([cellStr(`  ✅ ${f}`)])),
    emptyRow(),
    row([cellStr('Faiblesses (2-3 points)', 'SWOTRed')]),
    ...analysis.faiblesses.slice(0, 3).map(f => row([cellStr(`  ⚠️ ${f}`)])),
    emptyRow(), emptyRow(),
    row([cellStr('🟡 SLIDE 2 — OÙ SE CRÉE LA MARGE', 'SectionHeader')]),
    emptyRow(),
    row([cellStr('Activités à fort potentiel', 'SWOTGreen')]),
    ...analysis.margesParActivite.filter(m => m.classification === 'renforcer').map(m => row([cellStr(`  🔥 ${m.name} — Marge ${fmtPct(m.margePct)}, CA ${fmt(m.ca)} FCFA`)])),
    emptyRow(),
    row([cellStr('Activités à problème', 'SWOTRed')]),
    ...analysis.margesParActivite.filter(m => m.classification === 'optimiser' || m.classification === 'arreter').map(m => row([cellStr(`  ⚠️ ${m.name} — Marge ${fmtPct(m.margePct)}`)])),
    emptyRow(),
    row([cellStr('👉 Message clé : Toutes les activités ne se valent pas', 'Bold')]),
    emptyRow(), emptyRow(),
    row([cellStr('🔵 SLIDE 3 — PLAN D\'ACTION & TRAJECTOIRE 5 ANS', 'SectionHeader')]),
    emptyRow(),
    row([cellStr('Décisions recommandées', 'SWOTBlue')]),
    ...analysis.recommandations.slice(0, 4).map((r, i) => row([cellStr(`  ${i + 1}. ${r}`)])),
    emptyRow(),
    row([cellStr('Impact attendu (CA, Marge, Trésorerie)', 'Bold')]),
    row([cellStr(`  CA An 5 (central) : ${fmt(analysis.scenarios[1].caAn5)} FCFA | EBITDA An 5 : ${fmt(analysis.scenarios[1].ebitdaAn5)} FCFA | Marge EBITDA : ${fmtPct(analysis.scenarios[1].margeEbitdaAn5)}`)]),
    emptyRow(),
    row([cellStr('Besoins financiers', 'Bold')]),
    row([cellStr(`  CAPEX total (5 ans) : ${fmt(hyp.capex.reduce((s, v) => s + v, 0))} FCFA | Timing : An 1-2 prioritaire`)]),
    emptyRow(), emptyRow(),
    row([cellStr('💡 PHRASE CLÉ POUR LE DIRIGEANT', 'SectionHeader')]),
    row([cellStr(analysis.phraseCleDirigeant, 'Italic')]),
    row([cellStr('"Les chiffres ne servent pas à juger le passé, mais à décider le futur."', 'Italic')])
  ]

  // CORRECTION 3+4: Add cross-analysis section to sheet 8 if available
  const crossCtx = analysis.enrichmentContext
  if (crossCtx?.crossAnalysis && crossCtx.crossAnalysis.score_coherence >= 0) {
    const ca = crossCtx.crossAnalysis
    sheet8Rows.push(emptyRow(), emptyRow())
    sheet8Rows.push(row([cellStr('🔗 CROISEMENT BMC ↔ FINANCIERS', 'SectionHeader')]))
    sheet8Rows.push(row([cellStr(`Score de cohérence : ${ca.score_coherence}/100`, ca.score_coherence >= 70 ? 'Green' : ca.score_coherence >= 50 ? 'Orange' : 'Red')]))
    if (ca.resume) sheet8Rows.push(row([cellStr(ca.resume, 'Italic')]))
    if (ca.incoherences?.length > 0) {
      sheet8Rows.push(row([cellStr('Incohérences détectées :', 'Bold')]))
      for (const inc of ca.incoherences) {
        const sev = inc.severite === 'critique' ? '🔴' : inc.severite === 'haute' ? '🟠' : '🟡'
        sheet8Rows.push(row([cellStr(`${sev} [${inc.severite}] ${inc.element_bmc} ↔ ${inc.element_financier} — ${inc.recommandation}`, inc.severite === 'critique' ? 'AlertDanger' : 'AlertWarning')]))
      }
    }
    if (ca.donnees_manquantes_detectees?.length > 0) {
      sheet8Rows.push(row([cellStr('Données manquantes détectées :', 'Bold')]))
      for (const d of ca.donnees_manquantes_detectees) {
        sheet8Rows.push(row([cellStr(`  ℹ️ ${d}`, 'AlertInfo')]))
      }
    }
  }

  // CORRECTION 2: Add estimation markers if available
  if (crossCtx?.estimations && crossCtx.estimations.length > 0) {
    sheet8Rows.push(emptyRow(), emptyRow())
    sheet8Rows.push(row([cellStr('📊 DONNÉES ESTIMÉES (benchmarks sectoriels)', 'SectionHeader')]))
    sheet8Rows.push(row([cellStr('Les valeurs suivantes ont été estimées par IA faute de données dans le document source :', 'Italic')]))
    for (const est of crossCtx.estimations.slice(0, 10)) {
      const conf = est.confiance === 'haute' ? '🟢' : est.confiance === 'moyenne' ? '🟡' : '🔴'
      sheet8Rows.push(row([cellStr(`${conf} ${est.champ}: ${fmt(est.valeur)} FCFA — ${est.raisonnement}`, 'EstimatedData')]))
    }
  }

  // ═══ ASSEMBLE XML ═══
  const buildSheet = (name: string, rows: string[], colWidths: number[]) => {
    const cols = colWidths.map(w => `<Column ss:Width="${w}"/>`).join('')
    return `
    <Worksheet ss:Name="${xmlEscape(name)}">
      <Table>${cols}
        ${rows.join('\n        ')}
      </Table>
    </Worksheet>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${styles}
  ${buildSheet('1 Donnees Historiques', sheet1Rows, [250, 130, 130, 130, 100, 150])}
  ${buildSheet('2 Analyse Marges', sheet2Rows, [180, 130, 130, 130, 100, 150])}
  ${buildSheet('3 Structure Couts', sheet3Rows, [220, 130, 130, 130, 100, 150])}
  ${buildSheet('4 Tresorerie BFR', sheet4Rows, [250, 130, 130, 130, 100, 150])}
  ${buildSheet('5 Hypotheses Projection', sheet5Rows, [220, 100, 100, 100, 100, 100, 200])}
  ${buildSheet('6 Projection 5 Ans', sheet6Rows, [220, 120, 120, 120, 120, 120, 80])}
  ${buildSheet('7 Scenarios', sheet7Rows, [220, 130, 130, 130, 100])}
  ${buildSheet('8 Synthese Executive', sheet8Rows, [500, 500])}
</Workbook>`
}

// ═══════════════════════════════════════════════════════════════
// HTML PREVIEW (Summary for download page)
// ═══════════════════════════════════════════════════════════════

export function generatePmePreviewHtml(analysis: PmeAnalysisResult, data: PmeInputData): string {
  const hc = analysis.historique
  const p = analysis.projection
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const scoreColor = hc.margeEbitdaPct[2] >= 15 ? '#059669' : hc.margeEbitdaPct[2] >= 5 ? '#0284c7' : hc.margeEbitdaPct[2] >= 0 ? '#d97706' : '#dc2626'
  const scoreLabel = hc.margeEbitdaPct[2] >= 15 ? 'Sain' : hc.margeEbitdaPct[2] >= 5 ? 'Correct' : hc.margeEbitdaPct[2] >= 0 ? 'Fragile' : 'Critique'

  // Helper: render per-sheet AI verdict in HTML preview
  const sheetCommentsPrev = analysis.aiExpertCommentary?.commentaires_par_feuille
  function renderSheetVerdict(sheetKey: keyof NonNullable<typeof sheetCommentsPrev>): string {
    const comment = sheetCommentsPrev?.[sheetKey]
    if (!comment) return ''
    let verdictHtml = `<div style="margin-top:16px;padding:16px;background:#FFFDE7;border-left:4px solid #F9A825;border-radius:0 12px 12px 0;">`
    verdictHtml += `<div style="font-size:13px;font-weight:700;color:#6B4C00;margin-bottom:6px;">📊 VERDICT ANALYSTE :</div>`
    if (comment.verdict) {
      verdictHtml += `<div style="font-size:13px;font-style:italic;color:#4A3800;line-height:1.6;margin-bottom:8px;">${comment.verdict}</div>`
    }
    if (comment.alertes && comment.alertes.length > 0) {
      for (const alerte of comment.alertes) {
        verdictHtml += `<div style="font-size:12px;color:#9A3412;padding:4px 0;">⚠️ ${alerte}</div>`
      }
    }
    if (comment.phrase_cle) {
      verdictHtml += `<div style="font-size:12px;font-weight:600;color:#1565C0;margin-top:6px;">💡 ${comment.phrase_cle}</div>`
    }
    verdictHtml += `</div>`
    return verdictHtml
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Framework Analyse PME — ${analysis.companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --primary:#2E5090; --primary-light:#D9E2F3; --accent:#4472C4; --green:#059669; --orange:#d97706; --red:#dc2626; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',system-ui,sans-serif; background:#f8fafb; color:#1a2332; line-height:1.6; }
    .container { max-width:1200px; margin:0 auto; padding:0 24px; }
    .header { background:linear-gradient(135deg,#1a2e50 0%,#2E5090 40%,#4472C4 100%); padding:48px 0 56px; color:white; }
    .header h1 { font-size:32px; font-weight:800; }
    .header p { font-size:14px; opacity:0.8; }
    .score-hero { background:white; border-radius:20px; margin:-36px 24px 0; position:relative; z-index:10; box-shadow:0 8px 32px rgba(0,0,0,0.1); padding:32px; display:grid; grid-template-columns:auto 1fr 1fr 1fr; gap:24px; align-items:center; }
    .score-circle { width:120px; height:120px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; }
    .card { background:white; border-radius:16px; padding:28px; margin:24px 0; border:1px solid rgba(0,0,0,0.08); }
    .card h2 { font-size:18px; font-weight:700; color:var(--primary); margin-bottom:16px; }
    .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
    .alert { padding:12px 16px; border-radius:10px; margin-bottom:8px; font-size:13px; }
    .alert-danger { background:#fee2e2; color:#991b1b; border-left:4px solid #dc2626; }
    .alert-warning { background:#fff7ed; color:#9a3412; border-left:4px solid #d97706; }
    .alert-info { background:#eff6ff; color:#1e40af; border-left:4px solid #2563eb; }
    .kpi { text-align:center; padding:16px; border-radius:12px; background:#f8fafc; }
    .kpi-value { font-size:24px; font-weight:800; }
    .kpi-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th { background:var(--primary); color:white; padding:10px 12px; text-align:left; font-weight:600; }
    td { padding:8px 12px; border-bottom:1px solid #e5e7eb; }
    tr:nth-child(even) { background:#f8fafc; }
    .footer { background:linear-gradient(135deg,#1a2e50,#2E5090,#4472C4); border-radius:16px; padding:40px; margin:24px 0 48px; color:white; text-align:center; }
    @media print { body { background:white; } .card { page-break-inside:avoid; } }
    @media (max-width:768px) { .score-hero { grid-template-columns:1fr; text-align:center; } .grid-2,.grid-3 { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="container">
      <div style="font-size:24px;margin-bottom:8px;">📊</div>
      <h1>FRAMEWORK D'ANALYSE FINANCIÈRE PME</h1>
      <p>${analysis.companyName} — ${analysis.sector} — ${data.location || ''} ${data.country}</p>
      <p style="margin-top:8px;font-size:12px;opacity:0.6;">Analyse : ${dateStr} · Consultant : ${analysis.consultant}</p>
    </div>
  </div>

  <div class="container">
    <div class="score-hero">
      <div>
        <div class="score-circle" style="background:${scoreColor};">
          <span style="font-size:28px;font-weight:800;">${fmtPct(hc.margeEbitdaPct[2])}</span>
          <span style="font-size:10px;opacity:0.8;">Marge EBITDA</span>
          <span style="font-size:11px;font-weight:600;margin-top:2px;">${scoreLabel}</span>
        </div>
      </div>
      <div class="kpi">
        <div class="kpi-value" style="color:var(--primary);">${fmt(data.historique.caTotal[2])}</div>
        <div class="kpi-label">CA Année N (FCFA)</div>
      </div>
      <div class="kpi">
        <div class="kpi-value" style="color:${hc.ebitda[2] >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(hc.ebitda[2])}</div>
        <div class="kpi-label">EBITDA (FCFA)</div>
      </div>
      <div class="kpi">
        <div class="kpi-value" style="color:var(--primary);">${fmt(p.caTotal[4])}</div>
        <div class="kpi-label">CA An 5 projeté (FCFA)</div>
      </div>
    </div>

    ${analysis.alertes.length > 0 ? `
    <div class="card">
      <h2>⚠️ Alertes & Points de vigilance</h2>
      ${analysis.alertes.map(a => `<div class="alert alert-${a.type}">${a.type === 'danger' ? '🔴' : a.type === 'warning' ? '🟠' : '🔵'} ${a.message}</div>`).join('')}
    </div>` : ''}

    <div class="card">
      <h2>📊 Indicateurs Clés</h2>
      ${renderSheetVerdict('donnees_historiques')}
      <div class="grid-3">
        <div class="kpi"><div class="kpi-value">${fmtPct(hc.margeBrutePct[2])}</div><div class="kpi-label">Marge Brute</div></div>
        <div class="kpi"><div class="kpi-value">${fmtPct(hc.chargesFixesSurCA[2])}</div><div class="kpi-label">Charges Fixes/CA</div></div>
        <div class="kpi"><div class="kpi-value">${fmtPct(hc.masseSalarialeSurCA[2])}</div><div class="kpi-label">Masse Salariale/CA</div></div>
        <div class="kpi"><div class="kpi-value">${hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toString()}</div><div class="kpi-label">DSCR</div></div>
        <div class="kpi"><div class="kpi-value">${data.historique.dso[2]}j</div><div class="kpi-label">DSO</div></div>
        <div class="kpi"><div class="kpi-value">${fmtPct(hc.bfrSurCA[2])}</div><div class="kpi-label">BFR / CA</div></div>
      </div>
    </div>

    <div class="card">
      <h2>📊 Ratios Clés d'Efficacité (Feuille 3)</h2>
      ${renderSheetVerdict('structure_couts')}
      <table>
        <tr><th>Ratio</th><th>Année N-2</th><th>Année N-1</th><th>Année N</th><th>Benchmark</th></tr>
        <tr><td>Charges Fixes / CA</td><td>${fmtPct(hc.chargesFixesSurCA[0])}</td><td>${fmtPct(hc.chargesFixesSurCA[1])}</td><td style="font-weight:600;color:${hc.chargesFixesSurCA[2] <= 55 ? 'var(--green)' : 'var(--orange)'};">${fmtPct(hc.chargesFixesSurCA[2])}</td><td>50-60%</td></tr>
        <tr><td>Masse Salariale / CA</td><td>${fmtPct(hc.masseSalarialeSurCA[0])}</td><td>${fmtPct(hc.masseSalarialeSurCA[1])}</td><td style="font-weight:600;color:${hc.masseSalarialeSurCA[2] <= 40 ? 'var(--green)' : 'var(--orange)'};">${fmtPct(hc.masseSalarialeSurCA[2])}</td><td>30-40%</td></tr>
        <tr><td>Marge Brute (%)</td><td>${fmtPct(hc.margeBrutePct[0])}</td><td>${fmtPct(hc.margeBrutePct[1])}</td><td style="font-weight:600;color:${hc.margeBrutePct[2] >= 30 ? 'var(--green)' : 'var(--orange)'};">${fmtPct(hc.margeBrutePct[2])}</td><td>&gt;60%</td></tr>
        <tr><td>Marge EBITDA (%)</td><td>${fmtPct(hc.margeEbitdaPct[0])}</td><td>${fmtPct(hc.margeEbitdaPct[1])}</td><td style="font-weight:600;color:${hc.margeEbitdaPct[2] >= 15 ? 'var(--green)' : 'var(--orange)'};">${fmtPct(hc.margeEbitdaPct[2])}</td><td>&gt;15%</td></tr>
        <tr><td>Marge Nette (%)</td><td>${fmtPct(hc.margeNettePct[0])}</td><td>${fmtPct(hc.margeNettePct[1])}</td><td style="font-weight:600;color:${hc.margeNettePct[2] >= 10 ? 'var(--green)' : 'var(--orange)'};">${fmtPct(hc.margeNettePct[2])}</td><td>&gt;10%</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>💰 Trésorerie & BFR (Feuille 4)</h2>
      ${renderSheetVerdict('tresorerie_bfr')}
      <div class="grid-2" style="margin-bottom:16px;">
        <div>
          <h3 style="font-size:14px;color:var(--primary);margin-bottom:8px;">Analyse Trésorerie</h3>
          <table>
            <tr><th>Indicateur</th><th>N-2</th><th>N-1</th><th>N</th></tr>
            <tr><td>Trésorerie nette</td><td>${fmt(data.historique.tresoFin[0])}</td><td>${fmt(data.historique.tresoFin[1])}</td><td style="color:${data.historique.tresoFin[2] >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(data.historique.tresoFin[2])}</td></tr>
            <tr><td>Cash-flow opérationnel</td><td>${fmt(hc.cashFlowOp[0])}</td><td>${fmt(hc.cashFlowOp[1])}</td><td style="color:${hc.cashFlowOp[2] >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(hc.cashFlowOp[2])}</td></tr>
            <tr><td>CAF</td><td>${fmt(hc.caf[0])}</td><td>${fmt(hc.caf[1])}</td><td style="color:${hc.caf[2] >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(hc.caf[2])}</td></tr>
            <tr><td>DSCR</td><td>${hc.dscr[0] >= 99 ? 'N/A' : hc.dscr[0].toString()}</td><td>${hc.dscr[1] >= 99 ? 'N/A' : hc.dscr[1].toString()}</td><td style="font-weight:600;color:${hc.dscr[2] >= 1.5 ? 'var(--green)' : hc.dscr[2] >= 1.2 ? 'var(--orange)' : 'var(--red)'};">${hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toString()}</td></tr>
          </table>
        </div>
        <div>
          <h3 style="font-size:14px;color:var(--primary);margin-bottom:8px;">BFR & Endettement</h3>
          <table>
            <tr><th>Composante</th><th>N</th><th>Benchmark</th></tr>
            <tr><td>DSO (clients)</td><td>${data.historique.dso[2]}j</td><td style="color:#64748b;">30-45j</td></tr>
            <tr><td>DPO (fournisseurs)</td><td>${data.historique.dpo[2]}j</td><td style="color:#64748b;">30-60j</td></tr>
            <tr><td>Stock (jours)</td><td>${data.historique.stockJours[2]}j</td><td style="color:#64748b;">&lt;30j</td></tr>
            <tr><td>BFR / CA</td><td style="color:${hc.bfrSurCA[2] <= 20 ? 'var(--green)' : 'var(--orange)'};">${fmtPct(hc.bfrSurCA[2])}</td><td style="color:#64748b;">&lt;20%</td></tr>
            <tr><td>Dette / EBITDA</td><td style="color:${hc.detteSurEbitda[2] <= 3 ? 'var(--green)' : 'var(--red)'};">${hc.detteSurEbitda[2] >= 99 ? 'N/A' : hc.detteSurEbitda[2].toFixed(1) + 'x'}</td><td style="color:#64748b;">&lt;3x</td></tr>
          </table>
        </div>
      </div>
    </div>

    <!-- SLIDE 1 — ÉTAT DE SANTÉ FINANCIÈRE (Feuille 8) -->
    <div class="card" style="border-left:4px solid #059669;">
      <h2>🟢 SLIDE 1 — ÉTAT DE SANTÉ FINANCIÈRE</h2>
      <div style="font-size:14px;color:#334155;margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:10px;">
        <strong>Ce que montrent les chiffres :</strong><br>
        CA : ${fmt(data.historique.caTotal[2])} FCFA (CAGR ${fmtPct(hc.cagrCA)}) · Marge brute : ${fmtPct(hc.margeBrutePct[2])} · EBITDA : ${fmt(hc.ebitda[2])} FCFA (${fmtPct(hc.margeEbitdaPct[2])})<br>
        Trésorerie : ${fmt(data.historique.tresoFin[2])} FCFA · DSCR : ${hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toString()} · BFR/CA : ${fmtPct(hc.bfrSurCA[2])}
      </div>
      <div class="grid-2">
        <div>
          <h3 style="font-size:14px;color:#059669;margin-bottom:8px;">💪 Forces (2-3 points)</h3>
          ${analysis.forces.slice(0, 3).map(f => `<div style="padding:6px 0;font-size:13px;">✅ ${f}</div>`).join('')}
        </div>
        <div>
          <h3 style="font-size:14px;color:#dc2626;margin-bottom:8px;">⚠️ Faiblesses (2-3 points)</h3>
          ${analysis.faiblesses.slice(0, 3).map(f => `<div style="padding:6px 0;font-size:13px;">⚠️ ${f}</div>`).join('')}
        </div>
      </div>
    </div>

    <!-- SLIDE 2 — OÙ SE CRÉE LA MARGE (Feuilles 2+3) -->
    <div class="card" style="border-left:4px solid #d97706;">
      <h2>🟡 SLIDE 2 — OÙ SE CRÉE LA MARGE</h2>
      ${renderSheetVerdict('analyse_marges')}
      <table style="margin-bottom:16px;">
        <tr><th>Activité</th><th>CA (FCFA)</th><th>Marge Brute</th><th>Marge %</th><th>Classification</th></tr>
        ${analysis.margesParActivite.map(m => {
          const badge = m.classification === 'renforcer' ? '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">🔥 RENFORCER</span>'
            : m.classification === 'optimiser' ? '<span style="background:#fff7ed;color:#9a3412;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">⚠️ OPTIMISER</span>'
            : m.classification === 'arbitrer' ? '<span style="background:#eff6ff;color:#1e40af;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">🧠 ARBITRER</span>'
            : '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">❌ ARRÊTER</span>'
          return `<tr><td><strong>${m.name}</strong></td><td>${fmt(m.ca)}</td><td style="color:${m.margeBrute >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(m.margeBrute)}</td><td>${fmtPct(m.margePct)}</td><td>${badge}</td></tr>`
        }).join('')}
      </table>
      <div style="padding:12px;background:#fff7ed;border-radius:10px;font-size:13px;color:#92400e;">
        <strong>👉 Message clé :</strong> Toutes les activités ne se valent pas. ${analysis.margesParActivite.filter(m => m.classification === 'renforcer').length > 0 ? `Priorité aux activités à renforcer : ${analysis.margesParActivite.filter(m => m.classification === 'renforcer').map(m => m.name).join(', ')}.` : 'Aucune activité ne cumule rentabilité et positionnement stratégique.'}
      </div>
    </div>

    <!-- Projection 5 ans détaillée (Feuille 6) -->
    <div class="card">
      <h2>📈 Projection Financière 5 Ans</h2>
      ${renderSheetVerdict('projections_5ans')}
      <table>
        <tr><th>Poste</th>${[1,2,3,4,5].map(y => `<th>Année ${y}</th>`).join('')}<th>CAGR</th></tr>
        <tr><td><strong>CA Total</strong></td>${p.caTotal.map(v => `<td><strong>${fmt(v)}</strong></td>`).join('')}<td>${fmtPct(p.cagrCA)}</td></tr>
        <tr><td>Marge Brute</td>${p.margeBrute.map(v => `<td>${fmt(v)}</td>`).join('')}<td></td></tr>
        <tr><td>Marge Brute (%)</td>${p.margeBrutePct.map(v => `<td>${fmtPct(v)}</td>`).join('')}<td></td></tr>
        <tr style="background:#f0fdf4;"><td><strong>EBITDA</strong></td>${p.ebitda.map(v => `<td style="color:${v >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600;">${fmt(v)}</td>`).join('')}<td></td></tr>
        <tr><td>Marge EBITDA (%)</td>${p.margeEbitdaPct.map(v => `<td>${fmtPct(v)}</td>`).join('')}<td></td></tr>
        <tr style="background:#f0fdf4;"><td><strong>Résultat Net</strong></td>${p.resultatNet.map(v => `<td style="color:${v >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600;">${fmt(v)}</td>`).join('')}<td></td></tr>
        <tr><td><strong>Cash-Flow Net</strong></td>${p.cashFlowNet.map(v => `<td style="color:${v >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(v)}</td>`).join('')}<td></td></tr>
        <tr style="background:#eff6ff;"><td><strong>Trésorerie Cumulée</strong></td>${p.tresoCumulee.map(v => `<td style="font-weight:700;color:${v >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(v)}</td>`).join('')}<td></td></tr>
      </table>
      <div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:10px;">
        <strong style="font-size:13px;">📊 Seuil de Rentabilité (Année 1) :</strong>
        <span style="font-size:13px;"> CA au point mort = ${fmt(p.caPointMort[0])} FCFA · Atteint en ${p.moisPointMort[0]} mois</span>
      </div>
      ${renderSheetVerdict('hypotheses')}
    </div>

    <!-- Scénarios (Feuille 7) -->
    <div class="card">
      <h2>📊 Analyse par Scénarios (Année 5)</h2>
      ${renderSheetVerdict('scenarios')}
      <table>
        <tr><th>Indicateur</th><th>🔵 Prudent</th><th>🟢 Central</th><th>🔴 Ambitieux</th></tr>
        <tr><td>Croissance CA (CAGR)</td>${analysis.scenarios.map(s => `<td>${fmtPct(s.croissanceCAGR)}</td>`).join('')}</tr>
        <tr><td><strong>CA An 5</strong></td>${analysis.scenarios.map(s => `<td><strong>${fmt(s.caAn5)} FCFA</strong></td>`).join('')}</tr>
        <tr><td><strong>EBITDA An 5</strong></td>${analysis.scenarios.map(s => `<td style="color:${s.ebitdaAn5 >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(s.ebitdaAn5)} FCFA</td>`).join('')}</tr>
        <tr><td>Marge EBITDA</td>${analysis.scenarios.map(s => `<td>${fmtPct(s.margeEbitdaAn5)}</td>`).join('')}</tr>
        <tr><td>Résultat Net</td>${analysis.scenarios.map(s => `<td style="color:${s.resultatNetAn5 >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(s.resultatNetAn5)} FCFA</td>`).join('')}</tr>
        <tr><td><strong>Trésorerie</strong></td>${analysis.scenarios.map(s => `<td style="color:${s.tresoCumulee >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(s.tresoCumulee)} FCFA</td>`).join('')}</tr>
        <tr><td><strong>ROI</strong></td>${analysis.scenarios.map(s => `<td>${fmtPct(s.roi)}</td>`).join('')}</tr>
      </table>
      <div style="margin-top:16px;">
        <strong style="font-size:13px;">🔍 Analyse de Sensibilité (±10%) :</strong>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px;">
          ${analysis.sensibilites.map(s => `<div style="padding:10px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;">
            <div style="font-weight:600;font-size:12px;color:var(--primary);">${s.label}</div>
            <div style="font-size:11px;color:#64748b;">EBITDA: ${s.impactEbitda >= 0 ? '+' : ''}${fmt(s.impactEbitda)}</div>
            <div style="font-size:11px;color:#64748b;">Tréso: ${s.impactTreso >= 0 ? '+' : ''}${fmt(s.impactTreso)}</div>
          </div>`).join('')}
        </div>
      </div>
      <div style="margin-top:16px;padding:12px;background:#eff6ff;border-radius:10px;font-size:13px;color:#1e40af;">
        <strong>📌 Recommandation :</strong> Scénario Central — approche réaliste et prudente. Hypothèses testées sur les benchmarks sectoriels.
      </div>
    </div>

    <!-- SLIDE 3 — PLAN D'ACTION (Feuille 8) -->
    <div class="card" style="border-left:4px solid #2563eb;">
      <h2>🔵 SLIDE 3 — PLAN D'ACTION & TRAJECTOIRE 5 ANS</h2>
      <div style="margin-bottom:16px;">
        <h3 style="font-size:14px;color:var(--primary);margin-bottom:8px;">Décisions recommandées</h3>
        ${analysis.recommandations.map((r, i) => `<div style="padding:8px 0;font-size:13px;border-bottom:1px solid #f1f5f9;"><strong style="color:var(--primary);">${i + 1}.</strong> ${r}</div>`).join('')}
      </div>
      <div class="grid-2">
        <div style="padding:12px;background:#f0fdf4;border-radius:10px;">
          <strong style="font-size:13px;color:#166534;">Impact attendu (CA, Marge, Trésorerie)</strong>
          <div style="font-size:12px;color:#334155;margin-top:6px;">
            CA An 5 : ${fmt(analysis.scenarios[1].caAn5)} FCFA<br>
            EBITDA An 5 : ${fmt(analysis.scenarios[1].ebitdaAn5)} FCFA<br>
            Marge EBITDA : ${fmtPct(analysis.scenarios[1].margeEbitdaAn5)}
          </div>
        </div>
        <div style="padding:12px;background:#eff6ff;border-radius:10px;">
          <strong style="font-size:13px;color:#1e40af;">Besoins financiers</strong>
          <div style="font-size:12px;color:#334155;margin-top:6px;">
            CAPEX total (5 ans) : ${fmt(data.hypotheses.capex.reduce((s: number, v: number) => s + v, 0))} FCFA<br>
            Timing : An 1-2 prioritaire
          </div>
        </div>
      </div>
    </div>

    ${_renderPmeAISections(analysis)}

    <div class="footer">
      <div style="font-size:22px;font-weight:800;">FRAMEWORK ANALYSE PME</div>
      <div style="font-size:16px;opacity:0.9;">${analysis.companyName}</div>
      <div style="font-size:12px;opacity:0.6;margin-top:8px;">
        ${analysis.aiSource === 'claude' ? '&#129302; Analyse propuls\u00e9e par Claude AI' : '&#9881; Analyse automatique (r\u00e8gles)'}
        &middot; G\u00e9n\u00e9r\u00e9 le ${dateStr} &middot; 8 feuilles Excel
      </div>
      <div style="font-style:italic;font-size:13px;opacity:0.7;margin-top:16px;">"Les chiffres ne servent pas \u00e0 juger le pass\u00e9, mais \u00e0 d\u00e9cider le futur."</div>
    </div>
  </div>
</body>
</html>`
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// CLAUDE AI ENRICHMENT FOR FRAMEWORK PME
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

function buildPmeSystemPrompt(kbContext?: KBContext): string {
  let kb = ''
  if (kbContext) {
    if (kbContext.benchmarks) kb += `\n\n## BENCHMARKS SECTORIELS\n${kbContext.benchmarks}`
    if (kbContext.fiscalParams) kb += `\n\n## PARAMETRES FISCAUX\n${kbContext.fiscalParams}`
    if (kbContext.funders) kb += `\n\n## BAILLEURS DE FONDS\n${kbContext.funders}`
    if (kbContext.criteria) kb += `\n\n## CRITERES D'EVALUATION\n${kbContext.criteria}`
  }

  return `Tu es un expert-analyste financier senior sp\u00e9cialis\u00e9 en PME d'Afrique de l'Ouest (UEMOA/CEMAC).
Tu analyses un Framework Financier PME complet (historique 3 ans + projections 5 ans + sc\u00e9narios).

## TON ROLE
- Synth\u00e9tiser l'\u00e9tat de sant\u00e9 financi\u00e8re en langage dirigeant (pas jargon)
- Identifier les forces et faiblesses CL\u00c9S (pas tout lister, prioriser)
- Proposer des recommandations ACTIONNABLES avec chiffrage FCFA
- Comparer aux benchmarks sectoriels si disponibles
- Identifier les bailleurs potentiels avec instruments sp\u00e9cifiques
- \u00c9valuer les risques avec probabilit\u00e9 et mitigation
- Donner une phrase cl\u00e9 pour le dirigeant (motivante et r\u00e9aliste)
${kb}

## REGLES ABSOLUES
- R\u00e9ponds UNIQUEMENT en JSON valide
- Tous les commentaires en FRANCAIS
- Cite des montants en FCFA
- R\u00e9f\u00e8re-toi aux benchmarks sectoriels
- Sois SP\u00c9CIFIQUE : cite des chiffres, pas de g\u00e9n\u00e9ralit\u00e9s
- Maximum 5 forces, 5 faiblesses, 6 recommandations, 4 risques, 3 bailleurs

## FORMAT JSON ATTENDU
{
  "syntheseExecutive": "<synth\u00e8se en 3-4 phrases pour un dirigeant>",
  "forcesExpert": ["<force 1 avec chiffre>", ...],
  "faiblessesExpert": ["<faiblesse 1 avec chiffre>", ...],
  "recommandationsStrategiques": [
    { "action": "<action concr\u00e8te>", "horizon": "court|moyen|long", "impact": "<impact attendu>", "chiffrage": "<montant FCFA si applicable>" }
  ],
  "analyseScenariosComment": "<commentaire sur les 3 sc\u00e9narios : lequel est le plus cr\u00e9dible et pourquoi>",
  "alertesSectorielles": ["<alerte 1 li\u00e9e au secteur>", ...],
  "bailleursPotentiels": [
    { "nom": "<nom>", "raison": "<pourquoi>", "ticket": "<montant>", "instrument": "<type: subvention|pr\u00eat|equity|garantie>" }
  ],
  "risquesCles": [
    { "risque": "<description>", "probabilite": "haute|moyenne|basse", "mitigation": "<action>" }
  ],
  "phraseCleDirigeant": "<phrase motivante et r\u00e9aliste pour le dirigeant>",
  "scoreInvestissabilite": <0-100>,
  "commentaireInvestisseur": "<ce qu'un investisseur penserait>",
  "commentaires_par_feuille": {
    "donnees_historiques": {
      "verdict": "<verdict sur evolution CA 3 ans, structure couts, anomalies sectorielles>",
      "alertes": ["<alerte specifique a cette feuille>"],
      "phrase_cle": "<1 phrase de synthese pour un dirigeant>"
    },
    "analyse_marges": {
      "verdict": "<verdict sur chaque activite, diversification, mix produit>",
      "alertes": ["<ex: dependance excessive sur 1 activite>"],
      "phrase_cle": "<1 phrase>"
    },
    "structure_couts": {
      "verdict": "<comparaison chaque ratio avec benchmark sectoriel, postes sous-estimes>",
      "alertes": ["<ex: masse salariale anormalement basse pour le secteur>"],
      "phrase_cle": "<1 phrase>"
    },
    "tresorerie_bfr": {
      "verdict": "<commentaire DSCR, BFR, sante tresorerie>",
      "alertes": ["<ex: DSO incoherent avec vente directe B2C>"],
      "phrase_cle": "<1 phrase>"
    },
    "hypotheses": {
      "verdict": "<realisme de chaque hypothese de croissance vs moyennes sectorielles>",
      "alertes": ["<ex: croissance 177% An1 ambitieuse sauf contrats signes>"],
      "phrase_cle": "<1 phrase>"
    },
    "projections_5ans": {
      "verdict": "<trajectoire, seuil rentabilite, viabilite 5 ans>",
      "alertes": ["<ex: tresorerie negative en An2>"],
      "phrase_cle": "<1 phrase>"
    },
    "scenarios": {
      "verdict": "<quel scenario le plus probable et pourquoi>",
      "alertes": ["<ex: scenario ambitieux depend de l'obtention du marche X>"],
      "phrase_cle": "<1 phrase>"
    }
  }
}`
}

function buildPmeUserPrompt(analysis: PmeAnalysisResult, data: PmeInputData): string {
  const hc = analysis.historique
  const p = analysis.projection
  const h = data.historique

  let prompt = `# FRAMEWORK ANALYSE PME\n\n`
  prompt += `## ENTREPRISE\n- Nom: ${analysis.companyName}\n- Secteur: ${analysis.sector}\n- Pays: ${data.country}\n- Localisation: ${data.location}\n\n`

  // Historique
  prompt += `## HISTORIQUE (3 ans)\n`
  prompt += `- CA: N-2=${fmt(h.caTotal[0])}, N-1=${fmt(h.caTotal[1])}, N=${fmt(h.caTotal[2])} FCFA\n`
  prompt += `- CAGR CA: ${fmtPct(hc.cagrCA)}\n`
  prompt += `- Marge brute: N-2=${fmtPct(hc.margeBrutePct[0])}, N-1=${fmtPct(hc.margeBrutePct[1])}, N=${fmtPct(hc.margeBrutePct[2])}\n`
  prompt += `- EBITDA: N-2=${fmt(hc.ebitda[0])}, N-1=${fmt(hc.ebitda[1])}, N=${fmt(hc.ebitda[2])} FCFA\n`
  prompt += `- Marge EBITDA: N=${fmtPct(hc.margeEbitdaPct[2])}\n`
  prompt += `- R\u00e9sultat net: N=${fmt(h.resultatNet[2])} FCFA (marge nette ${fmtPct(hc.margeNettePct[2])})\n`
  prompt += `- Tr\u00e9sorerie fin N: ${fmt(h.tresoFin[2])} FCFA\n`
  prompt += `- DSO: ${h.dso[2]}j | DPO: ${h.dpo[2]}j | Stock: ${h.stockJours[2]}j\n`
  prompt += `- BFR/CA: ${fmtPct(hc.bfrSurCA[2])}\n`
  prompt += `- DSCR: ${hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toString()}\n`
  prompt += `- Dette/EBITDA: ${hc.detteSurEbitda[2] >= 99 ? 'N/A' : hc.detteSurEbitda[2].toFixed(1) + 'x'}\n\n`

  // Activit\u00e9s
  prompt += `## ACTIVITES (${data.activities.length})\n`
  for (const m of analysis.margesParActivite) {
    prompt += `- ${m.name}: CA ${fmt(m.ca)} FCFA, marge ${fmtPct(m.margePct)}, class\u00e9 "${m.classification}"\n`
  }

  // Projections
  prompt += `\n## PROJECTIONS 5 ANS\n`
  prompt += `- CA: An1=${fmt(p.caTotal[0])}, An3=${fmt(p.caTotal[2])}, An5=${fmt(p.caTotal[4])} FCFA\n`
  prompt += `- EBITDA An5: ${fmt(p.ebitda[4])} FCFA (marge ${fmtPct(p.margeEbitdaPct[4])})\n`
  prompt += `- R\u00e9sultat net An5: ${fmt(p.resultatNet[4])} FCFA\n`
  prompt += `- Tr\u00e9sorerie cumul\u00e9e An5: ${fmt(p.tresoCumulee[4])} FCFA\n`
  prompt += `- CAGR CA projet\u00e9: ${fmtPct(p.cagrCA)}\n`
  prompt += `- Point mort An1: ${fmt(p.caPointMort[0])} FCFA (${p.moisPointMort[0]} mois)\n\n`

  // Sc\u00e9narios
  prompt += `## SCENARIOS\n`
  for (const s of analysis.scenarios) {
    prompt += `- ${s.nom}: CA An5=${fmt(s.caAn5)}, EBITDA=${fmt(s.ebitdaAn5)}, marge ${fmtPct(s.margeEbitdaAn5)}, ROI=${fmtPct(s.roi)}\n`
  }

  // Alertes
  if (analysis.alertes.length > 0) {
    prompt += `\n## ALERTES DETECTEES\n`
    for (const a of analysis.alertes) {
      prompt += `- [${a.type.toUpperCase()}] ${a.message}\n`
    }
  }

  // Forces/Faiblesses actuelles
  prompt += `\n## FORCES IDENTIFIEES\n`
  for (const f of analysis.forces) prompt += `- ${f}\n`
  prompt += `\n## FAIBLESSES IDENTIFIEES\n`
  for (const f of analysis.faiblesses) prompt += `- ${f}\n`

  prompt += `\n\nAnalyse ce framework financier et produis le diagnostic JSON expert.
IMPORTANT: Fournis des commentaires EXPERTS pour CHAQUE feuille (champ "commentaires_par_feuille").
Chaque commentaire doit etre SPECIFIQUE avec des CHIFFRES, pas de generalites.`
  return prompt
}

/**
 * Enrich PME analysis with Claude AI expert commentary.
 * Always runs rule-based first, then overlays AI insights.
 * CORRECTION 3+4: Accepts cross-analysis results and returns enriched per-sheet comments
 */
export async function analyzePmeWithAI(
  data: PmeInputData,
  apiKey?: string,
  kbContext?: KBContext,
  crossAnalysis?: CrossAnalysisResult,
  estimations?: EstimationMeta[]
): Promise<PmeAnalysisResult> {
  // Always run rule-based analysis first
  const baseAnalysis = analyzePme(data)

  // CORRECTION 3: Inject cross-analysis incoherences as alerts
  if (crossAnalysis && crossAnalysis.score_coherence >= 0) {
    baseAnalysis.enrichmentContext = {
      crossAnalysis,
      estimations,
    }
    // Add cross-analysis incoherences as alerts
    for (const inc of crossAnalysis.incoherences || []) {
      const type = inc.severite === 'critique' || inc.severite === 'haute' ? 'danger' as const : 'warning' as const
      baseAnalysis.alertes.push({
        type,
        message: `[BMC\u2194Fin] ${inc.element_bmc} \u2014 ${inc.recommandation}`
      })
    }
    // Add missing data alerts
    for (const missing of crossAnalysis.donnees_manquantes_detectees || []) {
      baseAnalysis.alertes.push({ type: 'info' as const, message: `[BMC\u2194Fin] ${missing}` })
    }
    console.log(`[Framework PME] Cross-analysis: coherence=${crossAnalysis.score_coherence}, incoherences=${crossAnalysis.incoherences?.length || 0}`)
  }

  if (!isValidApiKey(apiKey)) {
    console.log('[Framework PME] No valid API key, using rule-based analysis only')
    baseAnalysis.aiSource = 'fallback'
    return baseAnalysis
  }

  try {
    const systemPrompt = buildPmeSystemPrompt(kbContext)
    let userPrompt = buildPmeUserPrompt(baseAnalysis, data)

    // CORRECTION 3: Add cross-analysis context to the prompt
    if (crossAnalysis && crossAnalysis.score_coherence >= 0) {
      userPrompt += `\n\n## CROISEMENT BMC <-> FINANCIERS (score coherence: ${crossAnalysis.score_coherence}/100)\n`
      userPrompt += `Resume: ${crossAnalysis.resume}\n`
      if (crossAnalysis.incoherences?.length) {
        userPrompt += `Incoherences detectees:\n`
        for (const inc of crossAnalysis.incoherences) {
          userPrompt += `- [${inc.severite}] ${inc.element_bmc} vs ${inc.element_financier}: ${inc.recommandation}\n`
        }
      }
      if (crossAnalysis.donnees_manquantes_detectees?.length) {
        userPrompt += `Donnees manquantes:\n`
        for (const d of crossAnalysis.donnees_manquantes_detectees) {
          userPrompt += `- ${d}\n`
        }
      }
    }

    // CORRECTION 4: Request more tokens for per-sheet comments
    const aiData = await callClaudeJSON<PmeAIExpertCommentary>({
      apiKey: apiKey!,
      systemPrompt,
      userPrompt,
      maxTokens: 8192,  // Increased from 6144 for per-sheet comments
      timeoutMs: 90_000, // Increased from 75s
      maxRetries: 2,
      label: 'Framework PME'
    })

    console.log(`[Framework PME] Claude AI enrichment succeeded \u2014 investissabilit\u00e9: ${aiData.scoreInvestissabilite}`)

    // Merge AI forces/faiblesses with rule-based (AI first, then rule-based deduped)
    if (aiData.forcesExpert && aiData.forcesExpert.length > 0) {
      baseAnalysis.forces = [...aiData.forcesExpert, ...baseAnalysis.forces.slice(0, 2)]
    }
    if (aiData.faiblessesExpert && aiData.faiblessesExpert.length > 0) {
      baseAnalysis.faiblesses = [...aiData.faiblessesExpert, ...baseAnalysis.faiblesses.slice(0, 2)]
    }

    // Merge AI recommendations
    if (aiData.recommandationsStrategiques && aiData.recommandationsStrategiques.length > 0) {
      const aiRecos = aiData.recommandationsStrategiques.map(r =>
        `[${r.horizon.toUpperCase()}] ${r.action}${r.chiffrage ? ` (${r.chiffrage})` : ''} \u2192 ${r.impact}`
      )
      baseAnalysis.recommandations = [...aiRecos, ...baseAnalysis.recommandations.slice(0, 3)]
    }

    // Override phrase cl\u00e9 dirigeant with AI version
    if (aiData.phraseCleDirigeant) {
      baseAnalysis.phraseCleDirigeant = aiData.phraseCleDirigeant
    }

    // Add AI alertes sectorielles
    if (aiData.alertesSectorielles && aiData.alertesSectorielles.length > 0) {
      for (const alerte of aiData.alertesSectorielles) {
        baseAnalysis.alertes.push({ type: 'info', message: `[\ud83e\udd16 IA] ${alerte}` })
      }
    }

    baseAnalysis.aiSource = 'claude'
    baseAnalysis.aiExpertCommentary = aiData
    return baseAnalysis

  } catch (err: any) {
    console.error(`[Framework PME] Claude AI failed, using rule-based: ${err.message}`)
    baseAnalysis.aiSource = 'fallback'
    return baseAnalysis
  }
}

/**
 * Generate full HTML preview with AI enrichment.
 */
export async function generatePmePreviewHtmlWithAI(
  data: PmeInputData,
  apiKey?: string,
  kbContext?: KBContext
): Promise<{ html: string; analysis: PmeAnalysisResult }> {
  const analysis = await analyzePmeWithAI(data, apiKey, kbContext)
  const html = generatePmePreviewHtml(analysis, data)
  return { html, analysis }
}

/** Render AI-enriched sections for PME preview HTML */
function _renderPmeAISections(analysis: PmeAnalysisResult): string {
  const ai = analysis.aiExpertCommentary
  if (!ai || analysis.aiSource !== 'claude') return ''

  let html = ''

  // Synth\u00e8se ex\u00e9cutive IA
  if (ai.syntheseExecutive) {
    html += `<div class="card" style="border-left:4px solid #7c3aed;">
      <h2>&#129302; Synth\u00e8se Expert (Claude AI)</h2>
      <div style="font-size:14px;line-height:1.7;color:#334155;">${ai.syntheseExecutive}</div>
    </div>`
  }

  // Score investissabilit\u00e9
  if (ai.scoreInvestissabilite >= 0) {
    const sColor = ai.scoreInvestissabilite >= 70 ? '#059669' : ai.scoreInvestissabilite >= 50 ? '#d97706' : '#dc2626'
    html += `<div class="card">
      <h2>&#128176; Score d'Investissabilit\u00e9 (IA)</h2>
      <div style="display:flex;align-items:center;gap:20px;">
        <div style="width:100px;height:100px;border-radius:50%;background:${sColor};display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;">
          <span style="font-size:26px;font-weight:800;">${ai.scoreInvestissabilite}</span>
          <span style="font-size:10px;opacity:0.8;">/100</span>
        </div>
        <div style="flex:1;font-size:14px;color:#334155;line-height:1.5;">${ai.commentaireInvestisseur || ''}</div>
      </div>
    </div>`
  }

  // Analyse des sc\u00e9narios
  if (ai.analyseScenariosComment) {
    html += `<div class="card">
      <h2>&#128200; Analyse des Sc\u00e9narios (IA)</h2>
      <div style="font-size:13px;line-height:1.6;color:#334155;">${ai.analyseScenariosComment}</div>
    </div>`
  }

  // Risques cl\u00e9s
  if (ai.risquesCles && ai.risquesCles.length > 0) {
    html += `<div class="card">
      <h2>&#9888;&#65039; Risques Cl\u00e9s (IA)</h2>
      ${ai.risquesCles.map(r => {
        const pColor = r.probabilite === 'haute' ? '#dc2626' : r.probabilite === 'moyenne' ? '#d97706' : '#059669'
        const pLabel = r.probabilite === 'haute' ? '\ud83d\udd34' : r.probabilite === 'moyenne' ? '\ud83d\udfe0' : '\ud83d\udfe2'
        return `<div style="padding:10px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;font-size:13px;">${pLabel} ${r.risque}</span>
            <span style="font-size:11px;color:${pColor};font-weight:600;text-transform:uppercase;">${r.probabilite}</span>
          </div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">\u2192 Mitigation: ${r.mitigation}</div>
        </div>`
      }).join('')}
    </div>`
  }

  // Bailleurs potentiels
  if (ai.bailleursPotentiels && ai.bailleursPotentiels.length > 0) {
    html += `<div class="card">
      <h2>&#127974; Bailleurs Potentiels (IA)</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      ${ai.bailleursPotentiels.map(b => `<div style="padding:12px;border-radius:10px;border:1px solid #e5e7eb;background:#f8fafc;">
        <div style="font-weight:700;font-size:14px;color:#1e3a5f;">${b.nom}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${b.raison}</div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <span style="font-size:11px;color:#059669;font-weight:600;background:#dcfce7;padding:2px 8px;border-radius:12px;">${b.ticket}</span>
          <span style="font-size:11px;color:#7c3aed;font-weight:600;background:#f3e8ff;padding:2px 8px;border-radius:12px;">${b.instrument}</span>
        </div>
      </div>`).join('')}
      </div>
    </div>`
  }

  // CORRECTION 3: Cross-analysis BMC ↔ Financial
  const crossCtx = analysis.enrichmentContext
  if (crossCtx?.crossAnalysis && crossCtx.crossAnalysis.score_coherence >= 0) {
    const ca = crossCtx.crossAnalysis
    const csColor = ca.score_coherence >= 70 ? '#059669' : ca.score_coherence >= 50 ? '#d97706' : '#dc2626'
    html += `<div class="card" style="border-left:4px solid ${csColor};">
      <h2>\ud83d\udd17 Croisement BMC \u2194 Financiers</h2>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        <div style="width:80px;height:80px;border-radius:50%;background:${csColor};display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;">
          <span style="font-size:22px;font-weight:800;">${ca.score_coherence}</span>
          <span style="font-size:9px;opacity:0.8;">coh\u00e9rence</span>
        </div>
        <div style="flex:1;font-size:13px;color:#334155;">${ca.resume || ''}</div>
      </div>
      ${ca.incoherences?.length > 0 ? `<div style="margin-bottom:12px;">
        <strong style="font-size:13px;color:#dc2626;">Incoh\u00e9rences d\u00e9tect\u00e9es (${ca.incoherences.length})</strong>
        ${ca.incoherences.map(inc => {
          const sevColor = inc.severite === 'critique' ? '#dc2626' : inc.severite === 'haute' ? '#d97706' : '#6b7280'
          return `<div style="padding:8px 12px;border-left:3px solid ${sevColor};margin:6px 0;background:#f8fafc;border-radius:0 8px 8px 0;">
            <span style="font-size:11px;font-weight:600;color:${sevColor};text-transform:uppercase;">${inc.severite}</span>
            <span style="font-size:12px;color:#334155;"> ${inc.element_bmc} \u2194 ${inc.element_financier}</span>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">\u2192 ${inc.recommandation}</div>
          </div>`
        }).join('')}
      </div>` : ''}
      ${ca.donnees_manquantes_detectees?.length > 0 ? `<div>
        <strong style="font-size:13px;color:#0284c7;">Donn\u00e9es manquantes d\u00e9tect\u00e9es</strong>
        ${ca.donnees_manquantes_detectees.map(d => `<div style="font-size:12px;color:#64748b;padding:4px 0;">\u2022 ${d}</div>`).join('')}
      </div>` : ''}
    </div>`
  }

  // CORRECTION 2: Estimated data markers
  if (crossCtx?.estimations && crossCtx.estimations.length > 0) {
    html += `<div class="card" style="border-left:4px solid #7c3aed;">
      <h2>\ud83d\udcca Donn\u00e9es Estim\u00e9es (Benchmarks sectoriels)</h2>
      <div style="font-size:12px;color:#64748b;margin-bottom:12px;">Les valeurs suivantes ont \u00e9t\u00e9 estim\u00e9es par IA faute de donn\u00e9es dans le fichier source.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      ${crossCtx.estimations.slice(0, 8).map(est => {
        const confColor = est.confiance === 'haute' ? '#059669' : est.confiance === 'moyenne' ? '#d97706' : '#dc2626'
        return `<div style="padding:8px 12px;border-radius:8px;background:#faf5ff;border:1px solid #e9d5ff;">
          <div style="font-size:12px;font-weight:600;color:#6b21a8;">${est.champ}</div>
          <div style="font-size:13px;font-weight:700;">${fmt(est.valeur)} FCFA</div>
          <div style="font-size:10px;color:${confColor};">\u25cf ${est.confiance} \u2014 ${est.raisonnement?.slice(0, 80) || ''}</div>
        </div>`
      }).join('')}
      </div>
    </div>`
  }

  return html
}
