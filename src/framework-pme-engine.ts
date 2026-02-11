// ═══════════════════════════════════════════════════════════════
// MODULE 4 — FRAMEWORK ANALYSE PME (Cœur du moteur financier)
// Génère un livrable Excel 8 feuilles conforme au template
// Framework_Analyse_PME_Cote_Ivoire.xlsx
// ═══════════════════════════════════════════════════════════════

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
  let prevChargesFixes = totalChargesFixes[2]
  let prevSalaires = h.salaires[2]
  let prevLoyers = h.loyers[2]
  let prevBFR = bfr[2]
  let cumAmort = 0
  let tresoCum = h.tresoFin[2]
  const IS_RATE = 0.25 // Taux IS Côte d'Ivoire

  for (let y = 0; y < 5; y++) {
    // CA
    const growthCA = hyp.croissanceCA[y] / 100
    const ca = Math.round(prevCA * (1 + growthCA))
    projection.caTotal.push(ca)

    // CA par activité
    for (let a = 0; a < data.activities.length; a++) {
      const actGrowth = hyp.croissanceParActivite?.[a]?.[y] ?? hyp.croissanceCA[y]
      const prevActCA = y === 0 ? (h.caByActivity[a]?.[2] ?? 0) : projection.caByActivity[a][y - 1]
      projection.caByActivity[a].push(Math.round(prevActCA * (1 + actGrowth / 100)))
    }

    // Coûts directs
    const growthCD = hyp.evolutionCoutsDirects[y] / 100
    const cd = Math.round(prevCoutsDirects * (1 + growthCA) * (1 + growthCD))
    projection.coutsDirects.push(cd)

    // Marge brute
    const mb = ca - cd
    projection.margeBrute.push(mb)
    projection.margeBrutePct.push(pct(mb, ca))

    // Charges fixes
    const infCF = hyp.inflationChargesFixes[y] / 100
    const growthMS = hyp.evolutionMasseSalariale[y] / 100
    const sal = Math.round(prevSalaires * (1 + growthMS))
    const loy = Math.round(prevLoyers * (1 + infCF))
    const autresFixed = Math.round((prevChargesFixes - prevSalaires - prevLoyers) * (1 + infCF))

    // Ajout embauches
    let embauchesCout = 0
    for (const emb of hyp.embauches ?? []) {
      if (emb.annee === y + 1) embauchesCout += emb.salaireMensuel * 12
    }

    const totalCF = sal + loy + autresFixed + embauchesCout
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
    buildScenario('Prudent', 10, Math.min(margeBrutePct[2] - 5, 50), Math.max(chargesFixesSurCA[2] + 5, 55), 'Faible'),
    buildScenario('Central', 25, margeBrutePct[2], chargesFixesSurCA[2], 'Moyen'),
    buildScenario('Ambitieux', 40, Math.min(margeBrutePct[2] + 10, 70), Math.max(chargesFixesSurCA[2] - 10, 35), 'Élevé')
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
  </Styles>`

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
    row([cellStr('Variation trésorerie'), cellFcfa(hc.variationTreso[0], hc.variationTreso[0] >= 0 ? 'Green' : 'Red'), cellFcfa(hc.variationTreso[1], hc.variationTreso[1] >= 0 ? 'Green' : 'Red'), cellFcfa(hc.variationTreso[2], hc.variationTreso[2] >= 0 ? 'Green' : 'Red'), cellStr(''), cellStr('')])
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
    row([cellStr('Activités à arrêter :', 'Bold'), cellStr(analysis.margesParActivite.filter(m => m.classification === 'arreter').map(m => m.name).join(', ') || '—')])
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
    row([cellStr('Actions recommandées :', 'Bold'), cellStr(analysis.recommandations.slice(0, 2).join(' · '))])
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
    row([cellStr('Dette / EBITDA', 'Bold'), cellStr(hc.detteSurEbitda[0] >= 99 ? 'N/A' : hc.detteSurEbitda[0].toFixed(1) + 'x'), cellStr(hc.detteSurEbitda[1] >= 99 ? 'N/A' : hc.detteSurEbitda[1].toFixed(1) + 'x'), cellStr(hc.detteSurEbitda[2] >= 99 ? 'N/A' : hc.detteSurEbitda[2].toFixed(1) + 'x', hc.detteSurEbitda[2] <= 3 ? 'Green' : 'Red'), cellStr(''), cellStr('< 3x')])
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
    emptyRow(), emptyRow(),
    row([cellStr('HYPOTHÈSES COÛTS', 'SectionHeader')]),
    row([cellStr('Évolution coûts directs (%)', 'Bold'), ...hyp.evolutionCoutsDirects.map(v => cellPct(v)), cellStr('')]),
    row([cellStr('Inflation charges fixes (%)', 'Bold'), ...hyp.inflationChargesFixes.map(v => cellPct(v)), cellStr('CI : ~3%')]),
    row([cellStr('Évolution masse salariale (%)', 'Bold'), ...hyp.evolutionMasseSalariale.map(v => cellPct(v)), cellStr('')]),
    emptyRow(), emptyRow(),
    row([cellStr('INVESTISSEMENTS (CAPEX)', 'SectionHeader')]),
    row([cellStr('Description', 'RowHeader'), cellStr('An 1', 'ColHeader'), cellStr('An 2', 'ColHeader'), cellStr('An 3', 'ColHeader'), cellStr('An 4', 'ColHeader'), cellStr('An 5', 'ColHeader'), cellStr('Total', 'ColHeader')]),
    ...(hyp.investissements ?? [{ description: 'CAPEX Global', montants: hyp.capex }]).map(inv =>
      row([cellStr(inv.description), ...inv.montants.map(v => cellFcfa(v, 'Num')), cellFcfa(inv.montants.reduce((s, v) => s + v, 0), 'BoldNum')])
    ),
    row([cellStr('Total CAPEX', 'Bold'), ...hyp.capex.map(v => cellFcfa(v, 'BoldNum')), cellFcfa(hyp.capex.reduce((s, v) => s + v, 0), 'BoldNum')])
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
    ...analysis.alertes.map(a => row([cellStr(`${a.type === 'danger' ? '🔴' : a.type === 'warning' ? '🟠' : '🔵'} ${a.message}`, a.type === 'danger' ? 'AlertDanger' : a.type === 'warning' ? 'AlertWarning' : 'AlertInfo')]))
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
    row([cellStr('Justification :', 'Bold'), cellStr('Équilibre entre ambition et réalisme. Hypothèses testées sur les benchmarks sectoriels.')])
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
          <span style="font-size:11px;opacity:0.8;">Marge EBITDA</span>
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
      <div class="grid-3">
        <div class="kpi"><div class="kpi-value">${fmtPct(hc.margeBrutePct[2])}</div><div class="kpi-label">Marge Brute</div></div>
        <div class="kpi"><div class="kpi-value">${fmtPct(hc.chargesFixesSurCA[2])}</div><div class="kpi-label">Charges Fixes/CA</div></div>
        <div class="kpi"><div class="kpi-value">${fmtPct(hc.masseSalarialeSurCA[2])}</div><div class="kpi-label">Masse Salariale/CA</div></div>
        <div class="kpi"><div class="kpi-value">${hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toString()}</div><div class="kpi-label">DSCR</div></div>
        <div class="kpi"><div class="kpi-value">${data.historique.dso[2]}j</div><div class="kpi-label">DSO</div></div>
        <div class="kpi"><div class="kpi-value">${fmtPct(hc.bfrSurCA[2])}</div><div class="kpi-label">BFR / CA</div></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>💪 Forces</h2>
        ${analysis.forces.map(f => `<div style="padding:6px 0;font-size:13px;">✅ ${f}</div>`).join('')}
      </div>
      <div class="card">
        <h2>⚠️ Faiblesses</h2>
        ${analysis.faiblesses.map(f => `<div style="padding:6px 0;font-size:13px;">⚠️ ${f}</div>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2>📈 Projection 5 ans — Scénarios</h2>
      <table>
        <tr><th>Indicateur</th><th>Prudent</th><th>Central</th><th>Ambitieux</th></tr>
        <tr><td><strong>CA An 5</strong></td>${analysis.scenarios.map(s => `<td>${fmt(s.caAn5)} FCFA</td>`).join('')}</tr>
        <tr><td><strong>EBITDA An 5</strong></td>${analysis.scenarios.map(s => `<td style="color:${s.ebitdaAn5 >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(s.ebitdaAn5)} FCFA</td>`).join('')}</tr>
        <tr><td><strong>Marge EBITDA</strong></td>${analysis.scenarios.map(s => `<td>${fmtPct(s.margeEbitdaAn5)}</td>`).join('')}</tr>
        <tr><td><strong>Trésorerie</strong></td>${analysis.scenarios.map(s => `<td style="color:${s.tresoCumulee >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(s.tresoCumulee)} FCFA</td>`).join('')}</tr>
        <tr><td><strong>ROI</strong></td>${analysis.scenarios.map(s => `<td>${fmtPct(s.roi)}</td>`).join('')}</tr>
      </table>
    </div>

    <div class="card">
      <h2>🎯 Recommandations</h2>
      ${analysis.recommandations.map((r, i) => `<div style="padding:8px 0;font-size:13px;border-bottom:1px solid #f1f5f9;"><strong style="color:var(--primary);">${i + 1}.</strong> ${r}</div>`).join('')}
    </div>

    <div class="footer">
      <div style="font-size:22px;font-weight:800;">FRAMEWORK ANALYSE PME</div>
      <div style="font-size:16px;opacity:0.9;">${analysis.companyName}</div>
      <div style="font-size:12px;opacity:0.6;margin-top:8px;">Généré le ${dateStr} · 8 feuilles Excel · Analyse complète</div>
      <div style="font-style:italic;font-size:13px;opacity:0.7;margin-top:16px;">"Les chiffres ne servent pas à juger le passé, mais à décider le futur."</div>
    </div>
  </div>
</body>
</html>`
}
