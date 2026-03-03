// ═══════════════════════════════════════════════════════════════
// OVO Excel Filler — Fills the OVO template cell-by-cell
// Reads extraction_json and writes into the .xlsm template XML
// Uses fflate for ZIP manipulation (Cloudflare Workers compatible)
// RULES: Never modify Pivot/Chart/EUR sheets
//        Only fill InputsData, RevenueData, FinanceData
//        Never overwrite formula cells
// ═══════════════════════════════════════════════════════════════

import pako from 'pako'
import { OVOExtractionResult } from './ovo-extraction-engine'

// Re-export gzip helpers for use in index.tsx
export function gzipCompressSync(data: Uint8Array): Uint8Array {
  return pako.gzip(data, { level: 9 })
}
export function gunzipDecompressSync(data: Uint8Array): Uint8Array {
  return pako.ungzip(data)
}

// ═══════════════════════════════════════════════════════════════
// Year key constants
// ═══════════════════════════════════════════════════════════════
const YEAR_KEYS = [
  'YEAR_MINUS_2', 'YEAR_MINUS_1', 'CURRENT_YEAR',
  'YEAR2', 'YEAR3', 'YEAR4', 'YEAR5'
] as const

// FinanceData: map year key → column letters
// CURRENT_YEAR splits into H1(Q) and H2(R)
// Column S = ANNEE EN COURS TOTAL (FORMULA = avg of Q,R) — do NOT write to S
// Columns: O=YEAR-2, P=YEAR-1, Q=CY_H1, R=CY_H2, [S=formula], T=YEAR2, U=YEAR3, V=YEAR4, W=YEAR5
const FINANCE_FULL_YEAR_COLS: Record<string, string[]> = {
  'YEAR_MINUS_2': ['O'],
  'YEAR_MINUS_1': ['P'],
  'CURRENT_YEAR': ['Q', 'R'],
  'YEAR2': ['T'],
  'YEAR3': ['U'],
  'YEAR4': ['V'],
  'YEAR5': ['W']
}

// ═══════════════════════════════════════════════════════════════
// CellWrite type
// ═══════════════════════════════════════════════════════════════
export interface CellWrite {
  sheet: 'InputsData' | 'RevenueData' | 'FinanceData'
  cell: string       // e.g. 'J5'
  value: string | number
  type: 'n' | 's'    // number or string
}

export interface FillingStats {
  totalCells: number
  inputsDataCells: number
  revenueDataCells: number
  financeDataCells: number
  productsCount: number
  servicesCount: number
  staffCategories: number
  investmentsCount: number
  sheetsModified: string[]
  sheetsPreserved: string[]
}

// Sheet → ZIP path
const SHEET_ZIP_PATHS: Record<string, string> = {
  'InputsData':  'xl/worksheets/sheet3.xml',
  'RevenueData': 'xl/worksheets/sheet4.xml',
  'FinanceData': 'xl/worksheets/sheet7.xml'
}

// ═══════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════

/**
 * Fill the OVO template with extraction data
 * @param templateBytes - Raw .xlsm bytes
 * @param data - OVOExtractionResult from Claude
 * @returns filled .xlsm bytes + stats
 */
export function fillOVOTemplate(
  templateBytes: Uint8Array,
  data: OVOExtractionResult
): { filledBytes: Uint8Array; stats: FillingStats } {

  // 1. Generate cell writes
  const cellWrites = generateCellWrites(data)
  console.log(`[OVO Filler] ${cellWrites.length} cell writes generated`)

  // 2. Unzip template using minimal ZIP parser
  const files = miniUnzip(templateBytes)

  // 3. Parse shared strings
  const ssPath = 'xl/sharedStrings.xml'
  let sharedStrings: string[] = []
  let ssOriginalXml = ''
  if (files[ssPath]) {
    ssOriginalXml = new TextDecoder().decode(files[ssPath])
    sharedStrings = parseSharedStrings(ssOriginalXml)
  }

  // 4. Group writes by sheet
  const writesBySheet: Record<string, CellWrite[]> = {}
  for (const cw of cellWrites) {
    if (!writesBySheet[cw.sheet]) writesBySheet[cw.sheet] = []
    writesBySheet[cw.sheet].push(cw)
  }

  // 5. Apply writes to each sheet
  for (const [sheetName, writes] of Object.entries(writesBySheet)) {
    const zipPath = SHEET_ZIP_PATHS[sheetName]
    if (!zipPath || !files[zipPath]) {
      console.warn(`[OVO Filler] Sheet file not found: ${zipPath}`)
      continue
    }

    let xml = new TextDecoder().decode(files[zipPath])
    const result = applyWritesToSheetXml(xml, writes, sharedStrings)
    xml = result.xml
    sharedStrings = result.sharedStrings
    files[zipPath] = new TextEncoder().encode(xml)
    console.log(`[OVO Filler] ${sheetName}: ${writes.length} writes applied`)
  }

  // 6. Update shared strings
  if (files[ssPath]) {
    files[ssPath] = new TextEncoder().encode(
      rebuildSharedStringsXml(sharedStrings, ssOriginalXml)
    )
  }

  // 7. Re-zip all entries using STORE (no compression)
  const filledBytes = miniZip(files)
  console.log(`[OVO Filler] Re-zipped: ${filledBytes.length} bytes`)

  // 8. Stats
  const stats: FillingStats = {
    totalCells: cellWrites.length,
    inputsDataCells: cellWrites.filter(w => w.sheet === 'InputsData').length,
    revenueDataCells: cellWrites.filter(w => w.sheet === 'RevenueData').length,
    financeDataCells: cellWrites.filter(w => w.sheet === 'FinanceData').length,
    productsCount: data.produits?.filter(p => p.type === 'product').length ?? 0,
    servicesCount: data.produits?.filter(p => p.type === 'service').length ?? 0,
    staffCategories: data.personnel?.length ?? 0,
    investmentsCount: data.investissements?.length ?? 0,
    sheetsModified: ['InputsData', 'RevenueData', 'FinanceData'],
    sheetsPreserved: ['ReadMe', 'Instructions', 'RevenuePivot', 'RevenueChart',
                       'FinancePivot', 'FinanceChart', 'FinanceEUR']
  }

  return { filledBytes, stats }
}

// ═══════════════════════════════════════════════════════════════
// Generate all cell writes from extraction data
// ═══════════════════════════════════════════════════════════════

function generateCellWrites(data: OVOExtractionResult): CellWrite[] {
  const writes: CellWrite[] = []
  fillInputsData(writes, data)
  fillRevenueData(writes, data)
  fillFinanceData(writes, data)
  return writes
}

// ═══════════════════════════════════════════════════════════════
// InputsData Filler
// ═══════════════════════════════════════════════════════════════

function fillInputsData(writes: CellWrite[], data: OVOExtractionResult): void {
  const h = data.hypotheses
  if (!h) return

  // Country Related (col J)
  if (h.company_name) w(writes, 'InputsData', 'J5', h.company_name.toUpperCase(), 's')
  if (h.country)      w(writes, 'InputsData', 'J6', h.country.toUpperCase(), 's')
  if (h.currency)     w(writes, 'InputsData', 'J8', h.currency, 's')
  if (h.exchange_rate_eur) w(writes, 'InputsData', 'J9', h.exchange_rate_eur, 'n')

  // Conversion date (today as Excel serial)
  const excelSerial = Math.floor((Date.now() - new Date(1899, 11, 30).getTime()) / 86400000)
  w(writes, 'InputsData', 'J10', excelSerial, 'n')

  if (h.vat_rate != null)       w(writes, 'InputsData', 'J12', h.vat_rate, 'n')
  if (h.inflation_rate != null) w(writes, 'InputsData', 'J14', h.inflation_rate, 'n')

  // Tax Regimes
  if (h.tax_regime_1) {
    if (h.tax_regime_1.name)        w(writes, 'InputsData', 'H17', h.tax_regime_1.name, 's')
    if (h.tax_regime_1.description) w(writes, 'InputsData', 'I17', h.tax_regime_1.description, 's')
    if (h.tax_regime_1.rate != null) w(writes, 'InputsData', 'J17', h.tax_regime_1.rate, 'n')
  }
  if (h.tax_regime_2) {
    if (h.tax_regime_2.name)        w(writes, 'InputsData', 'H18', h.tax_regime_2.name, 's')
    if (h.tax_regime_2.description) w(writes, 'InputsData', 'I18', h.tax_regime_2.description, 's')
    if (h.tax_regime_2.rate != null) w(writes, 'InputsData', 'J18', h.tax_regime_2.rate, 'n')
  }

  // Base year (YEAR-2)
  if (h.base_year) w(writes, 'InputsData', 'J24', h.base_year - 2, 'n')

  // Products (rows 36-55, max 20)
  const products = (data.produits || []).filter(p => p.type === 'product')
  const services = (data.produits || []).filter(p => p.type === 'service')

  for (let i = 0; i < 20; i++) {
    const row = 36 + i
    if (i < products.length) {
      const p = products[i]
      w(writes, 'InputsData', `H${row}`, p.nom || `Produit ${i + 1}`, 's')
      w(writes, 'InputsData', `I${row}`, p.actif ? 1 : 0, 'n')
      if (p.description) w(writes, 'InputsData', `J${row}`, p.description, 's')
    } else {
      // Inactive product: write '-' as name and 0 as filter
      w(writes, 'InputsData', `H${row}`, '-', 's')
      w(writes, 'InputsData', `I${row}`, 0, 'n')
    }
  }

  // Services (rows 58-67, max 10)
  for (let i = 0; i < 10; i++) {
    const row = 58 + i
    if (i < services.length) {
      const s = services[i]
      w(writes, 'InputsData', `H${row}`, s.nom || `Service ${i + 1}`, 's')
      w(writes, 'InputsData', `I${row}`, s.actif ? 1 : 0, 'n')
      if (s.description) w(writes, 'InputsData', `J${row}`, s.description, 's')
    } else {
      w(writes, 'InputsData', `H${row}`, '-', 's')
      w(writes, 'InputsData', `I${row}`, 0, 'n')
    }
  }

  // Gammes / Ranges (rows 70-72, write ONLY to H and J — K is a FORMULA)
  if (data.gammes) {
    const rg = data.gammes
    if (rg.range1) { w(writes, 'InputsData', 'H70', rg.range1.nom || 'LOW END', 's'); w(writes, 'InputsData', 'J70', rg.range1.description || 'Entry level', 's') }
    if (rg.range2) { w(writes, 'InputsData', 'H71', rg.range2.nom || 'MEDIUM END', 's'); w(writes, 'InputsData', 'J71', rg.range2.description || 'Advanced level', 's') }
    if (rg.range3) { w(writes, 'InputsData', 'H72', rg.range3.nom || 'HIGH END', 's'); w(writes, 'InputsData', 'J72', rg.range3.description || 'Professional level', 's') }
  }

  // Distribution Channels
  if (data.canaux) {
    if (data.canaux.channel1) { w(writes, 'InputsData', 'H75', data.canaux.channel1.nom || 'B2B', 's'); w(writes, 'InputsData', 'J75', data.canaux.channel1.description || '', 's') }
    if (data.canaux.channel2) { w(writes, 'InputsData', 'H76', data.canaux.channel2.nom || 'B2C', 's'); w(writes, 'InputsData', 'J76', data.canaux.channel2.description || '', 's') }
  }

  // Product-Range-Channel matrix (rows 79-98 for products, 101-110 for services)
  // Cols: F=range1, G=range2, H=range3, I=channel1, J=channel2
  for (let i = 0; i < Math.min(products.length, 20); i++) {
    const row = 79 + i
    const p = products[i]
    const g = Number(p.gamme) || 1
    w(writes, 'InputsData', `F${row}`, g === 1 ? 1 : 0, 'n')
    w(writes, 'InputsData', `G${row}`, g === 2 ? 1 : 0, 'n')
    w(writes, 'InputsData', `H${row}`, g === 3 ? 1 : 0, 'n')
    const ch = Number(p.canal) || 1
    w(writes, 'InputsData', `I${row}`, ch === 1 ? 1 : 0, 'n')
    w(writes, 'InputsData', `J${row}`, ch === 2 ? 1 : 0, 'n')
  }
  // Services matrix (rows 101-110)
  for (let i = 0; i < Math.min(services.length, 10); i++) {
    const row = 101 + i
    const s = services[i]
    const g = Number(s.gamme) || 1
    w(writes, 'InputsData', `F${row}`, g === 1 ? 1 : 0, 'n')
    w(writes, 'InputsData', `G${row}`, g === 2 ? 1 : 0, 'n')
    w(writes, 'InputsData', `H${row}`, g === 3 ? 1 : 0, 'n')
    const ch = Number(s.canal) || 1
    w(writes, 'InputsData', `I${row}`, ch === 1 ? 1 : 0, 'n')
    w(writes, 'InputsData', `J${row}`, ch === 2 ? 1 : 0, 'n')
  }

  // Staff Categories (rows 113-122) — H=category name, I=department, J=social charge rate
  if (data.personnel) {
    for (let i = 0; i < Math.min(data.personnel.length, 10); i++) {
      const row = 113 + i
      const s = data.personnel[i]
      w(writes, 'InputsData', `H${row}`, (s.categorie || `CAT${i + 1}`).toUpperCase(), 's')
      w(writes, 'InputsData', `I${row}`, (s.departement || '').toUpperCase(), 's')
      w(writes, 'InputsData', `J${row}`, s.charges_sociales_pct ?? h.social_charges_rate ?? 0.1645, 'n')
    }
    // Clear remaining categories (rows after last used)
    for (let i = data.personnel.length; i < 10; i++) {
      const row = 113 + i
      w(writes, 'InputsData', `H${row}`, '-', 's')
      w(writes, 'InputsData', `I${row}`, '', 's')
      w(writes, 'InputsData', `J${row}`, 0, 'n')
    }
  }

  // Loans
  if (data.financement) {
    const f = data.financement
    if (f.pret_ovo) {
      w(writes, 'InputsData', 'I125', f.pret_ovo.taux ?? 0.07, 'n')
      w(writes, 'InputsData', 'J125', f.pret_ovo.duree ?? 5, 'n')
    }
    if (f.pret_famille) {
      w(writes, 'InputsData', 'I126', f.pret_famille.taux ?? 0.10, 'n')
      w(writes, 'InputsData', 'J126', f.pret_famille.duree ?? 3, 'n')
    }
    if (f.pret_banque) {
      w(writes, 'InputsData', 'I127', f.pret_banque.taux ?? 0.20, 'n')
      w(writes, 'InputsData', 'J127', f.pret_banque.duree ?? 2, 'n')
    }
  }

  // Simulation Scenarios (rows 130-142)
  if (data.scenarios_simulation) {
    const items = [
      { row: 130, key: 'revenue_products' }, { row: 131, key: 'cogs_products' },
      { row: 132, key: 'revenue_services' }, { row: 133, key: 'cogs_services' },
      { row: 134, key: 'marketing' }, { row: 135, key: 'salaries' },
      { row: 136, key: 'taxes_staff' }, { row: 137, key: 'office' },
      { row: 138, key: 'other' }, { row: 139, key: 'travel' },
      { row: 140, key: 'insurance' }, { row: 141, key: 'maintenance' },
      { row: 142, key: 'third_parties' }
    ]
    const ss = data.scenarios_simulation
    for (const it of items) {
      const wv = (ss.worst as any)?.[it.key];   if (wv != null) w(writes, 'InputsData', `H${it.row}`, wv, 'n')
      const tv = (ss.typical as any)?.[it.key];  if (tv != null) w(writes, 'InputsData', `I${it.row}`, tv, 'n')
      const bv = (ss.best as any)?.[it.key];     if (bv != null) w(writes, 'InputsData', `J${it.row}`, bv, 'n')
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// RevenueData Filler
// ═══════════════════════════════════════════════════════════════
// Each product/service = 42-row block starting at row 9 + (idx * 42)
// Products: idx 0-19 → rows 9, 51, 93, ... 807
// Services: idx 0-9  → rows 849, 891, 933, ... 1227
//
// Within each 42-row block, the VOLUME section is the first 8 rows:
//   Row+0 = YEAR_MINUS_2, Row+1 = YEAR_MINUS_1, Row+2 = CURRENT_YEAR H1,
//   Row+3 = CURRENT_YEAR H2 (use same value), Row+4..7 = YEAR2..YEAR5+
//
// VOLUME section columns (INPUT cells):
//   L = volume range1, M = volume range2, N = volume range3
//   O = avg unit selling price (FORMULA) — do NOT write
//   P = mix volume range1 %, Q = mix range2 %, R = mix range3 %
//   S = COGS unit range1, T = COGS unit range2, U = COGS unit range3
//   V = avg COGS unit (FORMULA) — do NOT write
//
// 8 year-rows in RevenueData: YEAR-2, YEAR-1, CURRENT_YEAR, YEAR2, YEAR3, YEAR4, YEAR5, YEAR6
// No H1/H2 split in RevenueData (unlike FinanceData)
// YEAR6 uses YEAR5 data as we only have 7 year keys

const REVENUE_YEAR_MAP = [
  'YEAR_MINUS_2',   // row+0 (F=YEAR-2)
  'YEAR_MINUS_1',   // row+1 (F=YEAR-1)
  'CURRENT_YEAR',   // row+2 (F=CURRENT YEAR) — single row, no H1/H2
  'YEAR2',          // row+3 (F=YEAR2)
  'YEAR3',          // row+4 (F=YEAR3)
  'YEAR4',          // row+5 (F=YEAR4)
  'YEAR5',          // row+6 (F=YEAR5)
  'YEAR5'           // row+7 (F=YEAR6) — repeat YEAR5 for the extra year
] as const

function fillRevenueData(writes: CellWrite[], data: OVOExtractionResult): void {
  if (!data.produits || data.produits.length === 0) return

  const products = data.produits.filter(p => p.type === 'product')
  const services = data.produits.filter(p => p.type === 'service')

  // Products occupy blocks 0-19 (rows 9, 51, 93, ...)
  for (let pi = 0; pi < Math.min(products.length, 20); pi++) {
    const item = products[pi]
    const blockStart = 9 + pi * 42
    fillRevenueBlock(writes, item, blockStart)
  }

  // Services occupy blocks 20-29 (rows 849, 891, 933, ...)
  for (let si = 0; si < Math.min(services.length, 10); si++) {
    const item = services[si]
    const blockStart = 849 + si * 42
    fillRevenueBlock(writes, item, blockStart)
  }
}

function fillRevenueBlock(
  writes: CellWrite[],
  item: OVOExtractionResult['produits'][0],
  blockStart: number
): void {
  for (let ri = 0; ri < 8; ri++) {
    const row = blockStart + ri
    const yearKey = REVENUE_YEAR_MAP[ri]

    // Volume (L=range1, M=range2, N=range3)
    const vol = item.volume?.[yearKey] ?? 0
    w(writes, 'RevenueData', `L${row}`, vol, 'n')
    w(writes, 'RevenueData', `M${row}`, 0, 'n')  // range 2
    w(writes, 'RevenueData', `N${row}`, 0, 'n')  // range 3

    // Mix % (100% range 1)
    w(writes, 'RevenueData', `P${row}`, 1, 'n')
    w(writes, 'RevenueData', `Q${row}`, 0, 'n')
    w(writes, 'RevenueData', `R${row}`, 0, 'n')

    // COGS unit price (S=range1, T=range2, U=range3)
    const cogs = item.cout_unitaire?.[yearKey] ?? 0
    w(writes, 'RevenueData', `S${row}`, cogs, 'n')
    w(writes, 'RevenueData', `T${row}`, 0, 'n')  // range 2
    w(writes, 'RevenueData', `U${row}`, 0, 'n')  // range 3

    // Channel mix (W=range1 ch1, X=range2 ch1, Y=range3 ch1, Z=range1 ch2)
    // Default: 100% channel 1 for range 1
    w(writes, 'RevenueData', `W${row}`, 1, 'n')
    w(writes, 'RevenueData', `X${row}`, 0, 'n')
    w(writes, 'RevenueData', `Y${row}`, 0, 'n')
    w(writes, 'RevenueData', `Z${row}`, 0, 'n')
  }
}

// ═══════════════════════════════════════════════════════════════
// FinanceData Filler
// ═══════════════════════════════════════════════════════════════

function fillFinanceData(writes: CellWrite[], data: OVOExtractionResult): void {
  // Operating Expenses: Marketing (rows 201-210)
  fillOpExSection(writes, data.compte_resultat?.marketing?.items, 201, 210)

  // Staff Salaries (rows 213-281, 10 categories × 7 rows)
  fillStaffSalaries(writes, data)

  // Office Costs (rows 294-308)
  fillOpExSection(writes, data.compte_resultat?.frais_bureau?.items, 294, 308)

  // Other Expenses (rows 311-319)
  fillOpExSection(writes, data.compte_resultat?.autres_depenses?.items, 311, 319)

  // Travel & Transportation (rows 322-323)
  fillTravel(writes, data)

  // Insurance (rows 326-332)
  fillOpExSection(writes, data.compte_resultat?.assurances?.items, 326, 332)

  // Maintenance (rows 335-342)
  fillOpExSection(writes, data.compte_resultat?.entretien?.items, 335, 342)

  // Third Parties (rows 345-357)
  fillOpExSection(writes, data.compte_resultat?.tiers?.items, 345, 357)

  // Investments
  fillInvestments(writes, data)
}

/** Fill a generic OpEx section: each item → 1 row, cols O-V = year amounts */
function fillOpExSection(
  writes: CellWrite[],
  items: Array<{ nom: string; montants: Record<string, number> }> | undefined,
  rowStart: number,
  rowEnd: number
): void {
  if (!items || items.length === 0) return
  const maxSlots = rowEnd - rowStart // leave last row for TOTAL (formula)
  for (let i = 0; i < Math.min(items.length, maxSlots); i++) {
    const row = rowStart + i
    const it = items[i]
    if (it.nom) w(writes, 'FinanceData', `H${row}`, it.nom.toUpperCase(), 's')
    for (const [yearKey, cols] of Object.entries(FINANCE_FULL_YEAR_COLS)) {
      const amt = it.montants?.[yearKey] ?? 0
      if (cols.length === 2) {
        const half = Math.round(amt / 2)
        w(writes, 'FinanceData', `${cols[0]}${row}`, half, 'n')
        w(writes, 'FinanceData', `${cols[1]}${row}`, amt - half, 'n')
      } else {
        w(writes, 'FinanceData', `${cols[0]}${row}`, amt, 'n')
      }
    }
  }
}

/**
 * Staff Salaries: 10 categories, each block = 7 rows (with 1 blank row gap)
 * Category blocks start at rows: 213, 220, 227, 234, 241, 248, 255, 262, 269, 276
 * Within each block:
 *   Row+0: NUMBER OF EMPLOYEES (input O-V)
 *   Row+1: GROSS SALARY PER PERSON AND PER PERIOD (input O-V) — use annual salary
 *   Row+2: OTHER ALLOWANCES (input O-V) — write 5% of salary as allowances
 *   Row+3: EMPLOYER SOCIAL SECURITY CONTRIBUTIONS — FORMULA, skip
 *   Row+4: COST PER PERSON PER PERIOD — FORMULA, skip
 *   Row+5: TOTAL — FORMULA, skip
 *   Row+6: (blank gap before next category)
 */
const STAFF_BLOCK_STARTS = [213, 220, 227, 234, 241, 248, 255, 262, 269, 276]

function fillStaffSalaries(writes: CellWrite[], data: OVOExtractionResult): void {
  if (!data.personnel || data.personnel.length === 0) return
  for (let i = 0; i < Math.min(data.personnel.length, 10); i++) {
    const s = data.personnel[i]
    const base = STAFF_BLOCK_STARTS[i]

    for (const [yearKey, cols] of Object.entries(FINANCE_FULL_YEAR_COLS)) {
      const hc = s.effectif?.[yearKey] ?? 0
      const monthly = s.salaire_brut_mensuel?.[yearKey] ?? 0
      const annual = monthly * 12
      // Allowances = 5% of annual salary (matching witness pattern)
      const allowances = Math.round(annual * 0.05)

      if (cols.length === 2) {
        // CURRENT_YEAR: split H1(Q)/H2(R)
        // Headcount = same both halves
        w(writes, 'FinanceData', `${cols[0]}${base}`, hc, 'n')
        w(writes, 'FinanceData', `${cols[1]}${base}`, hc, 'n')
        // Salary split H1/H2 (6 months each)
        const halfSalary = Math.round(annual / 2)
        w(writes, 'FinanceData', `${cols[0]}${base + 1}`, halfSalary, 'n')
        w(writes, 'FinanceData', `${cols[1]}${base + 1}`, annual - halfSalary, 'n')
        // Allowances split H1/H2
        const halfAllow = Math.round(allowances / 2)
        w(writes, 'FinanceData', `${cols[0]}${base + 2}`, halfAllow, 'n')
        w(writes, 'FinanceData', `${cols[1]}${base + 2}`, allowances - halfAllow, 'n')
      } else {
        w(writes, 'FinanceData', `${cols[0]}${base}`, hc, 'n')
        w(writes, 'FinanceData', `${cols[0]}${base + 1}`, annual, 'n')
        w(writes, 'FinanceData', `${cols[0]}${base + 2}`, allowances, 'n')
      }
    }
  }
}

/** Travel & Transportation — write amounts directly to row 322 */
function fillTravel(writes: CellWrite[], data: OVOExtractionResult): void {
  const travel = data.compte_resultat?.voyage_transport?.montant_annuel
  if (!travel) return
  w(writes, 'FinanceData', 'H322', 'VOYAGES ET DEPLACEMENTS', 's')
  for (const [yearKey, cols] of Object.entries(FINANCE_FULL_YEAR_COLS)) {
    const amt = travel[yearKey] ?? 0
    if (cols.length === 2) {
      const half = Math.round(amt / 2)
      w(writes, 'FinanceData', `${cols[0]}322`, half, 'n')
      w(writes, 'FinanceData', `${cols[1]}322`, amt - half, 'n')
    } else {
      w(writes, 'FinanceData', `${cols[0]}322`, amt, 'n')
    }
  }
}

/**
 * Investments in FinanceData:
 * FIXED ASSETS — Office Equipment: rows 408-447 (40 slots, H=name, K=year, L=value, M=amort%, N=residual)
 * FIXED ASSETS — Production Equipment: rows 450-459 (10 slots)
 * FIXED ASSETS — Other Assets: rows 462-481 (20 slots)
 * INTANGIBLE ASSETS: rows 486-490 (5 slots)
 * START-UP COSTS: rows 493-497 (5 slots)
 */
function fillInvestments(writes: CellWrite[], data: OVOExtractionResult): void {
  if (!data.investissements || data.investissements.length === 0) return

  const fixed = data.investissements.filter(inv => inv.categorie === 'FIXED ASSETS')
  const intangible = data.investissements.filter(inv => inv.categorie === 'INTANGIBLE ASSETS')
  const startup = data.investissements.filter(inv => inv.categorie === 'START-UP COSTS')

  // Fixed assets → Office Equipment rows (first 40)
  for (let i = 0; i < Math.min(fixed.length, 40); i++) {
    const row = 408 + i
    const inv = fixed[i]
    w(writes, 'FinanceData', `H${row}`, inv.nom.toUpperCase(), 's')
    w(writes, 'FinanceData', `K${row}`, inv.annee_acquisition, 'n')
    w(writes, 'FinanceData', `L${row}`, inv.valeur_acquisition, 'n')
    w(writes, 'FinanceData', `M${row}`, inv.taux_amortissement ?? 0.2, 'n')
    w(writes, 'FinanceData', `N${row}`, 0, 'n')
  }

  // Intangible assets (rows 486-490)
  for (let i = 0; i < Math.min(intangible.length, 5); i++) {
    const row = 486 + i
    const inv = intangible[i]
    w(writes, 'FinanceData', `H${row}`, inv.nom.toUpperCase(), 's')
    w(writes, 'FinanceData', `L${row}`, inv.valeur_acquisition, 'n')
    w(writes, 'FinanceData', `M${row}`, inv.taux_amortissement ?? 0.2, 'n')
  }

  // Start-up costs (rows 493-497)
  for (let i = 0; i < Math.min(startup.length, 5); i++) {
    const row = 493 + i
    const inv = startup[i]
    w(writes, 'FinanceData', `H${row}`, inv.nom.toUpperCase(), 's')
    w(writes, 'FinanceData', `L${row}`, inv.valeur_acquisition, 'n')
    w(writes, 'FinanceData', `M${row}`, inv.taux_amortissement ?? 0.2, 'n')
  }
}

// ═══════════════════════════════════════════════════════════════
// XML manipulation — apply writes to sheet XML
// ═══════════════════════════════════════════════════════════════

function applyWritesToSheetXml(
  xml: string,
  writes: CellWrite[],
  sharedStrings: string[]
): { xml: string; sharedStrings: string[] } {
  // Map writes by cell ref
  const writeMap = new Map<string, CellWrite>()
  for (const wr of writes) writeMap.set(wr.cell, wr)

  // Group writes by row number for efficient processing
  const writesByRow = new Map<number, Map<string, CellWrite>>()
  for (const [ref, wr] of writeMap) {
    const { row } = parseCellRef(ref)
    if (!writesByRow.has(row)) writesByRow.set(row, new Map())
    writesByRow.get(row)!.set(ref, wr)
  }

  // Process each row that has writes
  for (const [rowNum, rowWrites] of writesByRow) {
    // Find the row element
    const rowRegex = new RegExp(
      `(<row\\s[^>]*r="${rowNum}"[^>]*>)([\\s\\S]*?)(</row>)`,
      ''
    )
    const rowMatch = xml.match(rowRegex)

    if (rowMatch) {
      let rowContent = rowMatch[2]

      for (const [cellRef, wr] of rowWrites) {
        // Check if cell exists in this row
        const cellRegex = new RegExp(
          `<c\\s+r="${cellRef}"[^>]*(?:/>|>[\\s\\S]*?</c>)`,
          ''
        )
        const cellMatch = rowContent.match(cellRegex)

        if (cellMatch) {
          // Cell exists — check for formula
          if (cellMatch[0].includes('<f>') || cellMatch[0].includes('<f ')) {
            continue // NEVER overwrite formulas
          }
          // Replace cell
          rowContent = rowContent.replace(cellMatch[0], buildCellXml(cellRef, wr, sharedStrings))
        } else {
          // Cell doesn't exist — append before closing
          rowContent += buildCellXml(cellRef, wr, sharedStrings)
        }
      }

      xml = xml.replace(rowMatch[0], rowMatch[1] + rowContent + rowMatch[3])
    } else {
      // Row doesn't exist — create it
      const cells = Array.from(rowWrites.entries())
        .map(([ref, wr]) => buildCellXml(ref, wr, sharedStrings))
        .join('')
      const newRow = `<row r="${rowNum}">${cells}</row>`

      // Insert before </sheetData>
      const sdEnd = xml.indexOf('</sheetData>')
      if (sdEnd !== -1) {
        xml = xml.slice(0, sdEnd) + newRow + xml.slice(sdEnd)
      }
    }
  }

  return { xml, sharedStrings }
}

function buildCellXml(ref: string, wr: CellWrite, sharedStrings: string[]): string {
  if (wr.type === 's') {
    const str = String(wr.value)
    let idx = sharedStrings.indexOf(str)
    if (idx === -1) {
      idx = sharedStrings.length
      sharedStrings.push(str)
    }
    return `<c r="${ref}" t="s"><v>${idx}</v></c>`
  }
  return `<c r="${ref}"><v>${wr.value}</v></c>`
}

// ═══════════════════════════════════════════════════════════════
// Shared Strings helpers
// ═══════════════════════════════════════════════════════════════

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  const siRegex = /<si>([\s\S]*?)<\/si>/g
  let m
  while ((m = siRegex.exec(xml)) !== null) {
    const inner = m[1]
    const texts: string[] = []
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g
    let t
    while ((t = tRegex.exec(inner)) !== null) {
      texts.push(decodeXml(t[1]))
    }
    // Also handle <t/> self-closing (empty string)
    if (texts.length === 0 && inner.includes('<t/>')) texts.push('')
    strings.push(texts.join(''))
  }
  return strings
}

function rebuildSharedStringsXml(strings: string[], originalXml: string): string {
  const declMatch = originalXml.match(/^(<\?xml[^?]*\?>)/)
  const decl = declMatch ? declMatch[1] : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

  const rootMatch = originalXml.match(/<sst([^>]*)>/)
  let rootAttrs = rootMatch ? rootMatch[1] : ' xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'

  // Update counts
  rootAttrs = rootAttrs.replace(/count="[^"]*"/, `count="${strings.length}"`)
  rootAttrs = rootAttrs.replace(/uniqueCount="[^"]*"/, `uniqueCount="${strings.length}"`)
  if (!rootAttrs.includes('count=')) rootAttrs += ` count="${strings.length}"`
  if (!rootAttrs.includes('uniqueCount=')) rootAttrs += ` uniqueCount="${strings.length}"`

  let xml = `${decl}\n<sst${rootAttrs}>`
  for (const s of strings) {
    xml += `<si><t>${encodeXml(s)}</t></si>`
  }
  xml += '</sst>'
  return xml
}

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

function parseCellRef(ref: string): { col: string; row: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  return m ? { col: m[1], row: parseInt(m[2]) } : { col: 'A', row: 1 }
}

function encodeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

/** Shorthand for adding a write */
function w(writes: CellWrite[], sheet: CellWrite['sheet'], cell: string, value: string | number, type: 'n' | 's'): void {
  writes.push({ sheet, cell, value, type })
}

// ═══════════════════════════════════════════════════════════════
// Minimal ZIP parser/builder using pako for deflate/inflate
// Compatible with Cloudflare Workers (no Node.js APIs)
// ═══════════════════════════════════════════════════════════════

/** Parse a ZIP archive into a name→data map */
function miniUnzip(zipData: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength)
  const files: Record<string, Uint8Array> = {}

  // Find End of Central Directory
  let eocdPos = -1
  for (let i = zipData.length - 22; i >= Math.max(0, zipData.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdPos = i; break }
  }
  if (eocdPos === -1) throw new Error('Invalid ZIP: EOCD not found')

  const cdOffset = view.getUint32(eocdPos + 16, true)
  const cdCount = view.getUint16(eocdPos + 10, true)

  // Parse Central Directory
  let pos = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > zipData.length) break
    if (view.getUint32(pos, true) !== 0x02014b50) break

    const method = view.getUint16(pos + 10, true)
    const compSize = view.getUint32(pos + 20, true)
    const uncompSize = view.getUint32(pos + 24, true)
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const localOff = view.getUint32(pos + 42, true)

    const name = new TextDecoder().decode(zipData.subarray(pos + 46, pos + 46 + nameLen))

    // Read local file header to find data
    const lfhNameLen = view.getUint16(localOff + 26, true)
    const lfhExtraLen = view.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lfhNameLen + lfhExtraLen
    const rawData = zipData.subarray(dataStart, dataStart + compSize)

    if (method === 0) {
      // STORE
      files[name] = new Uint8Array(rawData)
    } else if (method === 8) {
      // DEFLATE — use pako inflateRaw
      try {
        files[name] = pako.inflateRaw(rawData)
      } catch {
        files[name] = new Uint8Array(rawData)
      }
    } else {
      files[name] = new Uint8Array(rawData)
    }

    pos += 46 + nameLen + extraLen + commentLen
  }

  return files
}

/** Build a ZIP archive from a name→data map (STORE mode, no compression) */
function miniZip(files: Record<string, Uint8Array>): Uint8Array {
  const entries = Object.entries(files)
  const parts: Uint8Array[] = []
  const cdParts: Uint8Array[] = []
  let offset = 0

  const enc = new TextEncoder()

  for (const [name, data] of entries) {
    const nameBytes = enc.encode(name)
    const crc = crc32(data)

    // Local file header (30 bytes + name)
    const lfh = new Uint8Array(30 + nameBytes.length)
    const lfhV = new DataView(lfh.buffer)
    lfhV.setUint32(0, 0x04034b50, true)  // sig
    lfhV.setUint16(4, 20, true)           // version needed
    lfhV.setUint16(8, 0, true)            // compression: STORE
    lfhV.setUint32(14, crc, true)         // CRC-32
    lfhV.setUint32(18, data.length, true) // compressed size
    lfhV.setUint32(22, data.length, true) // uncompressed size
    lfhV.setUint16(26, nameBytes.length, true)
    lfh.set(nameBytes, 30)

    parts.push(lfh)
    parts.push(data)

    // Central directory entry (46 bytes + name)
    const cde = new Uint8Array(46 + nameBytes.length)
    const cdeV = new DataView(cde.buffer)
    cdeV.setUint32(0, 0x02014b50, true)  // sig
    cdeV.setUint16(4, 20, true)           // version made by
    cdeV.setUint16(6, 20, true)           // version needed
    cdeV.setUint16(10, 0, true)           // compression: STORE
    cdeV.setUint32(16, crc, true)
    cdeV.setUint32(20, data.length, true)
    cdeV.setUint32(24, data.length, true)
    cdeV.setUint16(28, nameBytes.length, true)
    cdeV.setUint32(42, offset, true)      // local header offset
    cde.set(nameBytes, 46)

    cdParts.push(cde)
    offset += lfh.length + data.length
  }

  const cdStart = offset
  let cdSize = 0
  for (const cd of cdParts) { parts.push(cd); cdSize += cd.length }

  // End of Central Directory (22 bytes)
  const eocd = new Uint8Array(22)
  const eocdV = new DataView(eocd.buffer)
  eocdV.setUint32(0, 0x06054b50, true)
  eocdV.setUint16(8, entries.length, true)
  eocdV.setUint16(10, entries.length, true)
  eocdV.setUint32(12, cdSize, true)
  eocdV.setUint32(16, cdStart, true)
  parts.push(eocd)

  // Concatenate
  const total = parts.reduce((s, p) => s + p.length, 0)
  const result = new Uint8Array(total)
  let pos = 0
  for (const part of parts) { result.set(part, pos); pos += part.length }
  return result
}

/** CRC-32 computation */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xFF]
  return (crc ^ 0xFFFFFFFF) >>> 0
}
