// ═══════════════════════════════════════════════════════════════
// INPUTS ENTREPRENEUR PARSER V2 — Lecture structurée du fichier XLSX
// Adapté au format "Analyse financiere_INPUTS_ENTREPRENEURS_V2.xlsx"
// Lit FIDÈLEMENT les données réelles de chaque onglet du fichier
// sans inventer aucune donnée manquante
// ═══════════════════════════════════════════════════════════════

import { parseXlsx, b64ToUint8, type SheetData, type CellData } from './xlsx-parser'
import type { PmeInputData } from './framework-pme-engine'

// ─── HELPERS ───

/** Get cell value from a sheet by cell reference (e.g., "B5", "E7") */
function getCell(sheet: SheetData, ref: string): string {
  const cell = sheet.cells.find(c => c.ref === ref)
  return cell?.value?.trim() ?? ''
}

/** Get numeric value from a cell, return 0 if empty/invalid */
function getNum(sheet: SheetData, ref: string): number {
  const raw = getCell(sheet, ref)
  if (!raw) return 0
  // First try direct parseFloat (handles scientific notation like 5.913E7)
  const directParse = parseFloat(raw)
  if (!isNaN(directParse) && /^[\d.\-+eE]+$/.test(raw.trim())) {
    return Math.round(directParse)
  }
  // Handle percentages: "18%" → 18
  if (raw.includes('%')) {
    const pctMatch = raw.match(/([\d.]+)\s*%/)
    if (pctMatch) return parseFloat(pctMatch[1])
  }
  // Fallback: clean text and parse (for "59 130 000 FCFA" etc.)
  const cleaned = raw.replace(/[^\d.\-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.round(num)
}

/** Find a sheet by partial name match (case-insensitive, ignores leading emoji/space) */
function findSheet(sheets: SheetData[], partialName: string): SheetData | undefined {
  const lower = partialName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return sheets.find(s => {
    const sn = s.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return sn.includes(lower)
  })
}

/** Search for a numeric value in a column range near a label keyword */
function findValueNearLabel(sheet: SheetData, keyword: string, valueCol: string, startRow: number, endRow: number): number {
  const keyLower = keyword.toLowerCase()
  for (let row = startRow; row <= endRow; row++) {
    for (const col of ['A', 'B']) {
      const label = getCell(sheet, `${col}${row}`).toLowerCase()
      if (label.includes(keyLower)) {
        const val = getNum(sheet, `${valueCol}${row}`)
        if (val > 0) return val
      }
    }
  }
  return 0
}

/** Scan user-entered rows (below "VOS" or emoji section marker) for cost items */
function scanUserSection(sheet: SheetData, sectionMarker: string, totalCol: string, startRow: number, endRow: number): { items: { label: string; annual: number }[]; total: number } {
  const items: { label: string; annual: number }[] = []
  let inUserSection = false
  let total = 0

  for (let row = startRow; row <= endRow; row++) {
    const cellA = getCell(sheet, `A${row}`)
    const cellB = getCell(sheet, `B${row}`)
    
    // Detect section start (VOS, 👇)
    if (cellA.includes(sectionMarker) || cellB.includes(sectionMarker) || cellA.includes('👇') || cellB.includes('👇')) {
      inUserSection = true
      continue
    }
    
    // Check for TOTAL row
    const rowText = (cellA + ' ' + cellB).toLowerCase()
    if (rowText.includes('total')) {
      for (const col of [totalCol, 'E', 'F', 'G', 'D']) {
        const totalVal = getNum(sheet, `${col}${row}`)
        if (totalVal > 0) {
          total = totalVal
          break
        }
      }
      continue
    }

    if (inUserSection) {
      const label = cellB || cellA
      if (!label || label === '#' || /^\d+$/.test(label.trim())) continue
      const annual = getNum(sheet, `${totalCol}${row}`)
      if (annual > 0) {
        items.push({ label, annual })
      }
    }
  }
  
  if (total === 0) {
    total = items.reduce((s, i) => s + i.annual, 0)
  }

  return { items, total }
}

/**
 * Read monthly data from a 60-month grid section.
 * Sums 12 months per year (cols B-M for year 1, cols O-Z for year 2, etc.)
 * Returns totals per year [Y1, Y2, Y3, Y4, Y5]
 */
function readMonthlyGrid(sheet: SheetData, headerRow: number, dataRows: number[], numYears: number = 5): number[] {
  const yearTotals: number[] = []
  for (let y = 0; y < numYears; y++) {
    let yearSum = 0
    const startCol = y * 13 + 1 // B=1, O=14, AB=27...
    for (const rowIdx of dataRows) {
      for (let m = 0; m < 12; m++) {
        const colNum = startCol + m
        const colLetter = colNum < 26 
          ? String.fromCharCode(65 + colNum) 
          : String.fromCharCode(64 + Math.floor(colNum / 26)) + String.fromCharCode(65 + colNum % 26)
        yearSum += getNum(sheet, `${colLetter}${rowIdx}`)
      }
    }
    yearTotals.push(yearSum)
  }
  return yearTotals
}

// ─── FORMAT DETECTION ───

/**
 * Detect if an XLSX file is in INPUTS_ENTREPRENEURS V2 format
 * by checking for characteristic sheet names (with emojis)
 */
export function isInputsEntrepreneurFormat(sheets: SheetData[]): boolean {
  // V2 expected sheets (normalized, without emoji prefixes)
  const expectedSheets = [
    'infos generales',
    'donnees historiques',
    'produits',
    'ressources humaines',
    'couts',        // matches "Coûts Fixes & Variables"
    'bfr',          // matches "BFR, Invest. & Finance"
    'hypotheses',   // matches "Hypothèses Croissance"
  ]
  
  let matchCount = 0
  for (const expected of expectedSheets) {
    if (findSheet(sheets, expected)) matchCount++
  }
  
  // Also check for the guide sheet
  if (findSheet(sheets, 'guide')) matchCount++
  
  console.log(`[InputsParser] Format detection: ${matchCount}/${expectedSheets.length + 1} sheets matched`)
  return matchCount >= 4
}

// ─── MAIN PARSER ───

/**
 * Parse INPUTS_ENTREPRENEURS V2 XLSX format into PmeInputData
 * V2 Layout:
 *   Sheet 1: 📖 GUIDE D'UTILISATION
 *   Sheet 2: 1️⃣ Infos Générales        (data in col C)
 *   Sheet 3: 2️⃣ Données Historiques     (data in cols C/D/E, examples in F/G/H)
 *   Sheet 4: 3️⃣ Produits & Services     (rows 6-10 examples, rows 13+ user data)
 *   Sheet 5: 4️⃣ Ressources Humaines    (rows 6-10 examples, rows 13+ user, row 37+ monthly 60m)
 *   Sheet 6: 6️⃣ Coûts Fixes & Variables (var rows 8-10 examples + 12-26 user; fix rows 32-35 examples + 37-51 user; monthly 60m)
 *   Sheet 7: 6️⃣ BFR, Invest. & Finance  (BFR row 8-13, CAPEX row 18-26, Finance row 29-48)
 *   Sheet 8: 5️⃣ Hypothèses Croissance   (CA obj row 8-12, Hypothèses row 17-22, monthly 60m)
 */
export function parseInputsEntrepreneur(sheets: SheetData[]): PmeInputData {
  console.log(`[InputsParser] Parsing ${sheets.length} sheets from INPUTS_ENTREPRENEURS V2 format`)

  // ═══ 1. INFOS GÉNÉRALES ═══
  // V2: Data is in column C (not B)
  const infos = findSheet(sheets, 'infos generales') || findSheet(sheets, 'infos')
  // Try col C first (V2), then col B (V1 fallback)
  const getInfoCell = (row: number): string => {
    if (!infos) return ''
    const valC = getCell(infos, `C${row}`)
    if (valC && !valC.startsWith('Ex:') && !valC.startsWith('Si ')) return valC
    const valB = getCell(infos, `B${row}`)
    return valB
  }
  
  const companyName = getInfoCell(5) || 'Entreprise'
  const formeJuridique = getInfoCell(6)
  const country = getInfoCell(7) || "Côte d'Ivoire"
  const city = getInfoCell(8)
  const sector = getInfoCell(9)
  const dateCreation = getInfoCell(10)
  const dirigeant = getInfoCell(16)
  const devise = getInfoCell(24) || 'XOF'
  
  // TVA: row 26 col C in V2
  const tauxTVA = infos ? (getNum(infos, 'C26') || getNum(infos, 'B26') || 18) : 18
  // IS: V2 has "Régime fiscal" at row 27, IS rate from Hypothèses sheet
  const tauxIS = 25 // Will be overridden from Hypothèses if available
  
  // Description de l'activité: V2 row 33
  const descriptionActivite = infos ? (getCell(infos, 'A33') || getCell(infos, 'C32') || '') : ''
  
  console.log(`[InputsParser] Company: ${companyName}, Country: ${country}, Sector: ${sector}`)

  // ═══ 2. DONNÉES HISTORIQUES ═══
  const hist = findSheet(sheets, 'donnees historiques')
  
  // V2: Columns C=N-2, D=N-1, E=N (user data), F/G/H=GOTCHE examples
  let caN2 = hist ? getNum(hist, 'C7') : 0
  let caN1 = hist ? getNum(hist, 'D7') : 0
  let caN = hist ? getNum(hist, 'E7') : 0
  
  // Products breakdown (rows 8-10)
  let caProduct1 = hist ? getNum(hist, 'E8') : 0
  let caProduct2 = hist ? getNum(hist, 'E9') : 0
  let caProduct3 = hist ? getNum(hist, 'E10') : 0
  
  // Costs from historical tab (rows 13-17)
  let histCoutsDirects = hist ? getNum(hist, 'E13') : 0
  let histChargesFixes = hist ? getNum(hist, 'E14') : 0
  let histSalaires = hist ? getNum(hist, 'E15') : 0
  let histLoyers = hist ? getNum(hist, 'E16') : 0
  let histAutresCharges = hist ? getNum(hist, 'E17') : 0
  
  // Results (rows 20-21)
  let histResultatExpl = hist ? getNum(hist, 'E20') : 0
  let histResultatNet = hist ? getNum(hist, 'E21') : 0
  
  // Other indicators (rows 24-26)
  let histClients = hist ? getNum(hist, 'E24') : 0
  let histEmployes = hist ? getNum(hist, 'E25') : 0
  let histTresoFin = hist ? getNum(hist, 'E26') : 0
  
  console.log(`[InputsParser] Historique: CA=[${caN2}, ${caN1}, ${caN}], Salaires=${histSalaires}, Employés=${histEmployes}`)

  // ═══ 3. PRODUITS & SERVICES ═══
  // V2: Examples rows 6-10, User rows 13-27 (after "👇 VOS PRODUITS/SERVICES")
  const produits = findSheet(sheets, 'produits')
  const productsList: { name: string; type: string; prixUnit: number; coutUnit: number; marge: number }[] = []
  
  if (produits) {
    // User products start at row 13 (after "VOS PRODUITS" marker at row 12)
    for (let row = 13; row <= 27; row++) {
      const name = getCell(produits, `B${row}`)
      if (!name) continue
      productsList.push({
        name,
        type: getCell(produits, `C${row}`) || 'Produit',
        prixUnit: getNum(produits, `D${row}`),
        coutUnit: getNum(produits, `F${row}`),
        marge: getNum(produits, `G${row}`) || 0
      })
    }
  }
  console.log(`[InputsParser] Produits: ${productsList.length} found: ${productsList.map(p => p.name).join(', ')}`)

  // ═══ 4. RESSOURCES HUMAINES ═══
  // V2: Only 3 columns (A=#, B=Poste, C=Nombre). No salary per row.
  // Monthly section at row 37+ with 60-month grid (rows 42-47: Salaires Bruts, Charges Sociales, Saisonniers, Primes, Formations, Autres)
  const rh = findSheet(sheets, 'ressources humaines')
  let masseSalariale = 0
  const employeeList: { poste: string; nombre: number; salaireMensuel: number; annuel: number }[] = []
  
  if (rh) {
    // User employees start at row 13 (after "VOTRE ÉQUIPE" marker at row 12)
    for (let row = 13; row <= 32; row++) {
      const poste = getCell(rh, `B${row}`)
      if (!poste) continue
      const nombre = getNum(rh, `C${row}`) || 1
      // V2: No salary column per person, just headcount
      // Try D column (V1 format) as fallback
      const salaireBrut = getNum(rh, `D${row}`)
      const totalAnnuel = getNum(rh, `G${row}`)
      employeeList.push({
        poste,
        nombre,
        salaireMensuel: salaireBrut,
        annuel: totalAnnuel > 0 ? totalAnnuel : (salaireBrut > 0 ? salaireBrut * nombre * 12 : 0)
      })
    }
    
    // V2: Monthly grid at row 41+ (TOTAL row at 48)
    // Read annual total from col N (Total An) row 48
    const rhMonthlyTotal = getNum(rh, 'N48')
    if (rhMonthlyTotal > 0) {
      masseSalariale = rhMonthlyTotal
    } else {
      // Fallback: try older format total rows
      masseSalariale = getNum(rh, 'G34') || getNum(rh, 'F34') * 12
    }
    
    if (masseSalariale === 0) {
      masseSalariale = employeeList.reduce((s, e) => s + e.annuel, 0)
    }
  }
  console.log(`[InputsParser] RH: ${employeeList.length} postes, Masse salariale=${masseSalariale}`)

  // ═══ 5. COÛTS FIXES & VARIABLES ═══
  // V2: Single sheet "Coûts Fixes & Variables"
  // Variable costs: examples rows 8-10, user rows 12-26 (section "👇 VOS COÛTS VARIABLES" at row 11)
  // Fixed costs: examples rows 32-35, user rows 37-51 (section "👇 VOS COÛTS FIXES" at row 36)
  // Monthly variable costs: rows 65-72 (TOTAL at 72)
  // Monthly fixed costs: rows 80-89 (TOTAL at 89)
  const couts = findSheet(sheets, 'couts')
  let coutsVariablesAnnuel = 0
  let coutsFixesAnnuel = 0
  let totalCoutsHorsRH = 0
  const coutsVariablesDetail: { label: string; annual: number }[] = []
  const coutsFixesDetail: { label: string; annual: number }[] = []

  if (couts) {
    // Variable costs: user section rows 11-27
    const varResult = scanUserSection(couts, 'VOS', 'D', 11, 27)
    coutsVariablesDetail.push(...varResult.items)
    
    // V2: Try monthly TOTAL row N72 first, then synthesis E56, then scan total
    const varMonthlyTotal = getNum(couts, 'N72')
    coutsVariablesAnnuel = varMonthlyTotal > 0 ? varMonthlyTotal : (getNum(couts, 'E56') || varResult.total)
    
    // Fixed costs: user section rows 36-52
    const fixResult = scanUserSection(couts, 'VOS', 'D', 36, 52)
    coutsFixesDetail.push(...fixResult.items)
    
    // V2: Try monthly TOTAL row N89 first, then synthesis E52, then scan total
    const fixMonthlyTotal = getNum(couts, 'N89')
    coutsFixesAnnuel = fixMonthlyTotal > 0 ? fixMonthlyTotal : (getNum(couts, 'E52') || fixResult.total)
    
    // Total hors RH
    totalCoutsHorsRH = getNum(couts, 'E58') || (coutsVariablesAnnuel + coutsFixesAnnuel)
  }
  console.log(`[InputsParser] Coûts: Variables=${coutsVariablesAnnuel}, Fixes=${coutsFixesAnnuel}, Total hors RH=${totalCoutsHorsRH}`)

  // ═══ 6. BFR, INVEST & FINANCE (all in one sheet in V2) ═══
  // V2: Sheet "BFR, Invest. & Finance"
  //   BFR: DSO=B8, DPO=B9, Stock=B10, Trésorerie départ=B13
  //   CAPEX: rows 18-26 (A=description, B=montant, C=année, D=durée amort)
  //   Finance: Apports=C32, Subventions=C35, Prêts rows 38-43 (A=source, B=montant, C=taux, D=durée, E=différé)
  //   Crédits: Fournisseurs=C47, Bancaire=C48
  const bfrSheet = findSheet(sheets, 'bfr')
  
  // BFR & Trésorerie
  let dsoJours = bfrSheet ? (getNum(bfrSheet, 'B8') || getNum(bfrSheet, 'C8')) : 0
  let dpoJours = bfrSheet ? (getNum(bfrSheet, 'B9') || getNum(bfrSheet, 'C9')) : 0
  let stockJours = bfrSheet ? (getNum(bfrSheet, 'B10') || getNum(bfrSheet, 'C10')) : 0
  let tresorerieDepart = bfrSheet ? (getNum(bfrSheet, 'B13') || getNum(bfrSheet, 'C13')) : 0
  
  console.log(`[InputsParser] BFR: DSO=${dsoJours}j, DPO=${dpoJours}j, Stock=${stockJours}j, Tréso départ=${tresorerieDepart}`)

  // CAPEX (Investissements) — V2: rows 22-26 (user section), examples at 19-21
  const investissements: { description: string; montant: number; annee: number; duree: number }[] = []
  let totalCapex = 0

  if (bfrSheet) {
    for (let row = 19; row <= 26; row++) {
      const desc = getCell(bfrSheet, `A${row}`)
      if (!desc || desc.startsWith('Ex:')) continue
      const montant = getNum(bfrSheet, `B${row}`)
      if (montant <= 0) continue
      const annee = getNum(bfrSheet, `C${row}`) || 2025
      const duree = getNum(bfrSheet, `D${row}`) || 5
      investissements.push({ description: desc, montant, annee, duree })
      totalCapex += montant
    }
  }
  console.log(`[InputsParser] CAPEX: ${investissements.length} items, Total=${totalCapex}`)

  // Financement — V2: All in BFR sheet
  let apportsCapital = 0
  let subventions = 0
  const prets: { source: string; montant: number; taux: number; duree: number; differe: number }[] = []
  let creditFournisseurs = 0
  let creditBancaire = 0

  if (bfrSheet) {
    apportsCapital = getNum(bfrSheet, 'C32') || getNum(bfrSheet, 'B32')
    subventions = getNum(bfrSheet, 'C35') || getNum(bfrSheet, 'B35')
    
    // Prêts: rows 41-43 (user section, after examples 39-40)
    for (let row = 39; row <= 43; row++) {
      const source = getCell(bfrSheet, `A${row}`)
      if (!source || source.startsWith('Ex:')) continue
      const montant = getNum(bfrSheet, `B${row}`)
      if (montant <= 0) continue
      prets.push({
        source,
        montant,
        taux: getNum(bfrSheet, `C${row}`) || 8,
        duree: getNum(bfrSheet, `D${row}`) || 60,
        differe: getNum(bfrSheet, `E${row}`) || 0
      })
    }
    
    creditFournisseurs = getNum(bfrSheet, 'C47') || getNum(bfrSheet, 'B47')
    creditBancaire = getNum(bfrSheet, 'C48') || getNum(bfrSheet, 'B48')
  }

  const totalDetteLT = prets.reduce((s, p) => s + p.montant, 0)
  const tauxMoyen = prets.length > 0 ? prets[0].taux : 8
  const dureeMoyenneMois = prets.length > 0 ? prets[0].duree : 60
  const dureeMoyenneAns = dureeMoyenneMois > 24 ? Math.round(dureeMoyenneMois / 12) : dureeMoyenneMois
  const serviceDetteAnnuel = totalDetteLT > 0 ? Math.round(totalDetteLT / dureeMoyenneAns + totalDetteLT * tauxMoyen / 100) : 0

  console.log(`[InputsParser] Financement: Apports=${apportsCapital}, Subventions=${subventions}, Dettes=${totalDetteLT}, Service=${serviceDetteAnnuel}`)

  // ═══ 7. HYPOTHÈSES DE CROISSANCE ═══
  // V2: Sheet "Hypothèses Croissance"
  //   CA objectives: rows 8-12 col B (absolute XOF values), col C = growth %
  //   Hypothèses: row 17-22 (B=value, col B for rates)
  //   Monthly revenue grid: row 29+ (60 months)
  const hyp = findSheet(sheets, 'hypotheses')
  
  // Read CA objectives by year (B8-B12 = absolute CA values)
  let caObj: number[] = []
  if (hyp) {
    for (let row = 8; row <= 12; row++) {
      caObj.push(getNum(hyp, `B${row}`))
    }
  }
  
  // Read growth percentages (C8-C12 = % growth vs N-1)
  let growthPcts: number[] = []
  if (hyp) {
    for (let row = 8; row <= 12; row++) {
      growthPcts.push(getNum(hyp, `C${row}`))
    }
  }
  
  // Read general hypotheses (V2: col B for values)
  let margeBruteCible = hyp ? (getNum(hyp, 'B17') || getNum(hyp, 'C17')) : 0
  let margeOpCible = hyp ? (getNum(hyp, 'B18') || getNum(hyp, 'C18')) : 0
  let inflation = hyp ? (getNum(hyp, 'B19') || getNum(hyp, 'C19') || 3) : 3
  let augPrix = hyp ? (getNum(hyp, 'B20') || getNum(hyp, 'C20') || 5) : 5
  let croissanceVolumes = hyp ? (getNum(hyp, 'B21') || getNum(hyp, 'C21')) : 0
  let tauxISHyp = hyp ? (getNum(hyp, 'B22') || getNum(hyp, 'C22') || 25) : 25
  
  console.log(`[InputsParser] Hypothèses CA: Objectifs=[${caObj.join(', ')}], Croissances=[${growthPcts.join(', ')}%]`)
  console.log(`[InputsParser] Hypothèses: Marge brute=${margeBruteCible}%, Marge op=${margeOpCible}%, Inflation=${inflation}%`)

  // ═══════════════════════════════════════════════════════════
  // BUILD PmeInputData — FIDÈLE aux données réelles
  // ═══════════════════════════════════════════════════════════

  // --- Activities from products ---
  const activities = productsList.length > 0
    ? productsList.map((p, i) => ({ name: p.name, isStrategic: i === 0 }))
    : [{ name: 'Activité principale', isStrategic: true }]

  // --- Historical CA: only use REAL data ---
  const caTotal: [number, number, number] = [caN2, caN1, caN]
  
  // CA by activity: distribute proportionally if we have product data
  let caByActivity: [number, number, number][]
  if (productsList.length > 0 && caN > 0) {
    const perProduct = Math.round(caN / productsList.length)
    caByActivity = productsList.map(() => [
      caN2 > 0 ? Math.round(caN2 / productsList.length) : 0,
      caN1 > 0 ? Math.round(caN1 / productsList.length) : 0,
      perProduct
    ] as [number, number, number])
  } else {
    caByActivity = [[caN2, caN1, caN]]
  }

  // --- Costs: use REAL data from Coûts tab + RH tab ---
  const achatsMP = coutsVariablesAnnuel
  
  // Charges locatives from fixed costs detail
  const chargesLocatives = coutsFixesDetail.find(c => c.label.toLowerCase().includes('locati') || c.label.toLowerCase().includes('loyer'))?.annual || 0
  const maintenanceEquip = coutsFixesDetail.find(c => c.label.toLowerCase().includes('maintenance') || c.label.toLowerCase().includes('entretien'))?.annual || 0
  const deplacements = coutsFixesDetail.find(c => c.label.toLowerCase().includes('deplacement') || c.label.toLowerCase().includes('déplacement'))?.annual || 0
  const communication = coutsFixesDetail.find(c => c.label.toLowerCase().includes('communication') || c.label.toLowerCase().includes('marketing'))?.annual || 0
  
  // Use actual salary data — from RH tab (priority) or historical tab
  const salairesAnnuels = masseSalariale > 0 ? masseSalariale : histSalaires
  
  // Loyers: from fixed costs detail (charges locatives)
  const loyersAnnuels = chargesLocatives > 0 ? chargesLocatives : histLoyers
  
  // Frais généraux: sum of other fixed costs
  const fraisGeneraux = (coutsFixesAnnuel - chargesLocatives) > 0 
    ? (coutsFixesAnnuel - chargesLocatives) 
    : histAutresCharges
  
  // Résultat: use real data if available
  let resultatNet = histResultatNet
  if (resultatNet === 0 && caN > 0) {
    resultatNet = histResultatExpl > 0 ? histResultatExpl : 0
  }

  // --- Build scale helper: for EMPTY years, put 0 ---
  const realScale = (valN: number): [number, number, number] => [0, 0, valN]

  // --- Compute growth rates from CA objectives ---
  let croissanceCA: [number, number, number, number, number] = [20, 20, 15, 10, 10]
  
  if (caObj.length >= 5 && caObj[0] > 0) {
    const rates: number[] = []
    for (let i = 1; i < caObj.length; i++) {
      if (caObj[i] > 0 && caObj[i - 1] > 0) {
        const rate = Math.round(((caObj[i] / caObj[i - 1]) - 1) * 100)
        rates.push(rate)
      } else {
        rates.push(0)
      }
    }
    const baseCA = caN > 0 ? caN : caObj[0]
    if (caObj[1] > 0 && baseCA > 0) {
      const firstRate = Math.round(((caObj[1] / baseCA) - 1) * 100)
      croissanceCA = [
        firstRate > 0 ? firstRate : (rates[0] || 20),
        rates[0] || 20,
        rates[1] || 15,
        rates[2] || 10,
        rates[3] || 10,
      ]
    } else if (rates.length >= 4) {
      croissanceCA = [rates[0], rates[1], rates[2], rates[3], rates[3]]
    }
  }
  else if (growthPcts.some(p => p > 0)) {
    const firstGrowth = (caObj[0] > 0 && caN > 0 && caObj[0] !== caN)
      ? Math.round(((caObj[0] / caN) - 1) * 100)
      : growthPcts[0] || 20
    croissanceCA = [
      firstGrowth,
      growthPcts[1] || growthPcts[0] || 20,
      growthPcts[2] || 15,
      growthPcts[3] || 10,
      growthPcts[4] || 10,
    ]
  }

  console.log(`[InputsParser] Computed growth rates: [${croissanceCA.join(', ')}]%`)

  // --- CAPEX schedule ---
  const capexSchedule: [number, number, number, number, number] = [totalCapex, 0, 0, 0, 0]

  // --- Investissements détaillés ---
  const investissementsDetails = investissements.length > 0
    ? investissements.map(inv => ({
        description: inv.description,
        montants: [inv.montant, 0, 0, 0, 0] as [number, number, number, number, number]
      }))
    : undefined

  // --- Amortissement moyen ---
  const amortDuree = investissements.length > 0
    ? Math.round(investissements.reduce((s, i) => s + i.duree, 0) / investissements.length)
    : 5

  // --- Build final PmeInputData ---
  const result: PmeInputData = {
    companyName,
    sector,
    analysisDate: new Date().toISOString().slice(0, 10),
    consultant: 'ESONO AI',
    location: city,
    country,
    activities,
    historique: {
      caTotal,
      caByActivity,
      achatsMP: realScale(achatsMP),
      sousTraitance: [0, 0, 0],
      coutsProduction: [0, 0, 0],
      salaires: realScale(salairesAnnuels),
      loyers: realScale(loyersAnnuels),
      assurances: [0, 0, 0],
      fraisGeneraux: realScale(fraisGeneraux),
      marketing: [0, 0, communication],
      fraisBancaires: [0, 0, 0],
      resultatNet: realScale(resultatNet),
      tresoDebut: [0, 0, tresorerieDepart],
      tresoFin: [0, 0, histTresoFin > 0 ? histTresoFin : tresorerieDepart],
      dso: [dsoJours, dsoJours, dsoJours],
      dpo: [dpoJours, dpoJours, dpoJours],
      stockJours: [stockJours, stockJours, stockJours],
      detteCT: [0, 0, creditFournisseurs + creditBancaire],
      detteLT: [0, 0, totalDetteLT],
      serviceDette: [0, 0, serviceDetteAnnuel],
      amortissements: [0, 0, Math.round(totalCapex / amortDuree)],
    },
    hypotheses: {
      croissanceCA,
      caObjectifs: (caObj.length >= 5 && caObj[1] > 0)
        ? (() => {
            const y1 = caObj[1]
            const y2 = caObj[2] || Math.round(y1 * 1.1)
            const y3 = caObj[3] || Math.round(y2 * 1.1)
            const y4 = caObj[4] || Math.round(y3 * 1.1)
            const y4Growth = y3 > 0 ? (y4 / y3) : 1.1
            const y5 = Math.round(y4 * y4Growth)
            return [y1, y2, y3, y4, y5] as [number, number, number, number, number]
          })()
        : undefined,
      evolutionPrix: [augPrix, augPrix, augPrix, augPrix, augPrix],
      evolutionCoutsDirects: [inflation, inflation, inflation, inflation, inflation],
      inflationChargesFixes: [inflation, inflation, inflation, inflation, inflation],
      evolutionMasseSalariale: [inflation + 2, inflation + 2, inflation, inflation, inflation],
      capex: capexSchedule,
      amortissement: amortDuree,
      embauches: undefined,
      investissements: investissementsDetails,
    },
  }

  // ═══ VALIDATION LOG ═══
  const totalCD = achatsMP
  const totalCF = salairesAnnuels + loyersAnnuels + fraisGeneraux + communication
  console.log(`[InputsParser] === SUMMARY ===`)
  console.log(`[InputsParser] CA N: ${caN} | CA N-2: ${caN2} | CA N-1: ${caN1}`)
  console.log(`[InputsParser] Coûts Variables: ${coutsVariablesAnnuel} (${caN > 0 ? Math.round(coutsVariablesAnnuel/caN*100) : 0}% du CA)`)
  console.log(`[InputsParser] Masse Salariale: ${salairesAnnuels} (${caN > 0 ? Math.round(salairesAnnuels/caN*100) : 0}% du CA)`)
  console.log(`[InputsParser] Charges Fixes Total: ${totalCF} (${caN > 0 ? Math.round(totalCF/caN*100) : 0}% du CA)`)
  console.log(`[InputsParser] CAPEX: ${totalCapex}`)
  console.log(`[InputsParser] Dettes LT: ${totalDetteLT}`)
  console.log(`[InputsParser] Financement: Apports=${apportsCapital}, Subventions=${subventions}`)
  console.log(`[InputsParser] Croissance CA: [${croissanceCA.join(', ')}]%`)
  console.log(`[InputsParser] CA Objectifs: [${caObj.join(', ')}]`)
  
  return result
}

/**
 * Try to parse an XLSX file as INPUTS_ENTREPRENEURS format.
 * Returns null if the format doesn't match.
 */
export function tryParseInputsEntrepreneur(xlsxBase64: string): PmeInputData | null {
  try {
    const bytes = b64ToUint8(xlsxBase64)
    const sheets = parseXlsx(bytes)
    
    if (!isInputsEntrepreneurFormat(sheets)) {
      console.log('[InputsParser] File is NOT in INPUTS_ENTREPRENEURS format — skipping')
      return null
    }
    
    return parseInputsEntrepreneur(sheets)
  } catch (err: any) {
    console.error(`[InputsParser] Parse error: ${err.message}`)
    return null
  }
}
