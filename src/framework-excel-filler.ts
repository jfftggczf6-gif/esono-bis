// ═══════════════════════════════════════════════════════════════
// FRAMEWORK EXCEL FILLER — Remplit le vrai template .xlsx
// Ouvre Framework_Analyse_PME_Cote_Ivoire.xlsx, injecte les
// données calculées dans les cellules exactes, et retourne
// le fichier .xlsx complet prêt au téléchargement.
// ═══════════════════════════════════════════════════════════════

import { unzipSync, zipSync, Unzipped } from 'fflate'
import { FRAMEWORK_TEMPLATE_B64 } from './framework-template-b64'
import type { PmeInputData, PmeAnalysisResult } from './framework-pme-engine'

// ─── HELPERS ───

/** Decode base64 to Uint8Array */
function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

/** XML-escape a string */
function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Format number for display */
function fmt(n: number): string {
  return Math.round(n).toString()
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%'
}

function pct(num: number, den: number): number {
  if (den === 0) return 0
  return Math.round((num / den) * 10000) / 100
}

function evolution(start: number, end: number): string {
  if (start === 0) return 'N/A'
  const evo = pct(end - start, start)
  return (evo >= 0 ? '+' : '') + fmtPct(evo)
}

// ─── XML CELL MANIPULATION ───

/**
 * Set a cell value in an OOXML sheet XML string.
 * Creates the cell if it doesn't exist, replaces value if it does.
 * Preserves existing style (s attribute).
 */
function setCell(xml: string, cellRef: string, value: number | string, isString: boolean = false): string {
  const col = cellRef.replace(/[0-9]/g, '')
  const rowNum = cellRef.replace(/[A-Z]/g, '')
  
  // Build the new cell XML
  let newCellXml: string
  if (isString) {
    // Inline string (not shared string) — uses <is><t> to avoid modifying sharedStrings.xml
    newCellXml = `<c r="${cellRef}" t="inlineStr"><is><t>${xmlEsc(String(value))}</t></is></c>`
  } else {
    newCellXml = `<c r="${cellRef}"><v>${value}</v></c>`
  }
  
  // Check if cell already exists
  const cellRegex = new RegExp(`<c\\s+r="${cellRef}"[^>]*>.*?</c>|<c\\s+r="${cellRef}"[^/]*/>`,'s')
  if (cellRegex.test(xml)) {
    // Replace existing cell — but preserve style
    const styleMatch = xml.match(new RegExp(`<c\\s+r="${cellRef}"[^>]*?\\s+s="(\\d+)"`))
    const styleAttr = styleMatch ? ` s="${styleMatch[1]}"` : ''
    
    if (isString) {
      newCellXml = `<c r="${cellRef}"${styleAttr} t="inlineStr"><is><t>${xmlEsc(String(value))}</t></is></c>`
    } else {
      newCellXml = `<c r="${cellRef}"${styleAttr}><v>${value}</v></c>`
    }
    return xml.replace(cellRegex, newCellXml)
  }
  
  // Cell doesn't exist — we need to insert it into the correct row
  const rowRegex = new RegExp(`(<row\\s+r="${rowNum}"[^>]*>)(.*?)(</row>)`, 's')
  const rowMatch = xml.match(rowRegex)
  
  if (rowMatch) {
    // Row exists — insert cell at the right position (before </row>)
    const rowContent = rowMatch[2]
    // Insert cell (simple append at end of row, Excel will reorder)
    const newRowContent = rowContent + newCellXml
    return xml.replace(rowRegex, `$1${newRowContent}$3`)
  }
  
  // Row doesn't exist — create it
  // Find the right insertion point (before </sheetData>)
  const newRowXml = `<row r="${rowNum}">${newCellXml}</row>`
  return xml.replace('</sheetData>', newRowXml + '</sheetData>')
}

/**
 * Set multiple cells at once on a sheet XML
 */
function setCells(xml: string, cells: Array<{ ref: string; value: number | string; isString?: boolean }>): string {
  let result = xml
  for (const cell of cells) {
    result = setCell(result, cell.ref, cell.value, cell.isString ?? (typeof cell.value === 'string'))
  }
  return result
}

// ─── SHEET FILLERS ───

/** Sheet 1: Données Historiques */
function fillSheet1(xml: string, data: PmeInputData, analysis: PmeAnalysisResult): string {
  const h = data.historique
  const hc = analysis.historique
  
  const cells: Array<{ ref: string; value: number | string; isString?: boolean }> = []
  
  // Company info
  cells.push({ ref: 'B5', value: data.companyName, isString: true })
  cells.push({ ref: 'B6', value: data.sector, isString: true })
  cells.push({ ref: 'B7', value: data.analysisDate, isString: true })
  cells.push({ ref: 'B8', value: data.consultant, isString: true })
  
  // CA Total (row 12)
  cells.push({ ref: 'B12', value: h.caTotal[0] })
  cells.push({ ref: 'C12', value: h.caTotal[1] })
  cells.push({ ref: 'D12', value: h.caTotal[2] })
  // E12 has formula — will auto-calculate
  
  // CA Activities (rows 13-15)
  for (let i = 0; i < Math.min(data.activities.length, 3); i++) {
    const row = 13 + i
    cells.push({ ref: `A${row}`, value: `CA ${data.activities[i].name}`, isString: true })
    cells.push({ ref: `B${row}`, value: h.caByActivity[i]?.[0] ?? 0 })
    cells.push({ ref: `C${row}`, value: h.caByActivity[i]?.[1] ?? 0 })
    cells.push({ ref: `D${row}`, value: h.caByActivity[i]?.[2] ?? 0 })
  }
  // Row 16 = Autres
  cells.push({ ref: 'B16', value: 0 })
  cells.push({ ref: 'C16', value: 0 })
  cells.push({ ref: 'D16', value: 0 })
  
  // Coûts Directs (rows 19-22)
  cells.push({ ref: 'B19', value: h.achatsMP[0] })
  cells.push({ ref: 'C19', value: h.achatsMP[1] })
  cells.push({ ref: 'D19', value: h.achatsMP[2] })
  
  cells.push({ ref: 'B20', value: h.sousTraitance[0] })
  cells.push({ ref: 'C20', value: h.sousTraitance[1] })
  cells.push({ ref: 'D20', value: h.sousTraitance[2] })
  
  cells.push({ ref: 'B21', value: h.coutsProduction[0] })
  cells.push({ ref: 'C21', value: h.coutsProduction[1] })
  cells.push({ ref: 'D21', value: h.coutsProduction[2] })
  
  cells.push({ ref: 'B22', value: hc.totalCoutsDirects[0] })
  cells.push({ ref: 'C22', value: hc.totalCoutsDirects[1] })
  cells.push({ ref: 'D22', value: hc.totalCoutsDirects[2] })
  
  // Marge Brute (rows 25-26)
  cells.push({ ref: 'B25', value: hc.margeBrute[0] })
  cells.push({ ref: 'C25', value: hc.margeBrute[1] })
  cells.push({ ref: 'D25', value: hc.margeBrute[2] })
  
  cells.push({ ref: 'B26', value: fmtPct(hc.margeBrutePct[0]), isString: true })
  cells.push({ ref: 'C26', value: fmtPct(hc.margeBrutePct[1]), isString: true })
  cells.push({ ref: 'D26', value: fmtPct(hc.margeBrutePct[2]), isString: true })
  
  // Charges fixes (rows 29-35)
  cells.push({ ref: 'B29', value: h.salaires[0] }); cells.push({ ref: 'C29', value: h.salaires[1] }); cells.push({ ref: 'D29', value: h.salaires[2] })
  cells.push({ ref: 'B30', value: h.loyers[0] }); cells.push({ ref: 'C30', value: h.loyers[1] }); cells.push({ ref: 'D30', value: h.loyers[2] })
  cells.push({ ref: 'B31', value: h.assurances[0] }); cells.push({ ref: 'C31', value: h.assurances[1] }); cells.push({ ref: 'D31', value: h.assurances[2] })
  cells.push({ ref: 'B32', value: h.fraisGeneraux[0] }); cells.push({ ref: 'C32', value: h.fraisGeneraux[1] }); cells.push({ ref: 'D32', value: h.fraisGeneraux[2] })
  cells.push({ ref: 'B33', value: h.marketing[0] }); cells.push({ ref: 'C33', value: h.marketing[1] }); cells.push({ ref: 'D33', value: h.marketing[2] })
  cells.push({ ref: 'B34', value: h.fraisBancaires[0] }); cells.push({ ref: 'C34', value: h.fraisBancaires[1] }); cells.push({ ref: 'D34', value: h.fraisBancaires[2] })
  cells.push({ ref: 'B35', value: hc.totalChargesFixes[0] }); cells.push({ ref: 'C35', value: hc.totalChargesFixes[1] }); cells.push({ ref: 'D35', value: hc.totalChargesFixes[2] })
  
  // Résultat (rows 38-41)
  cells.push({ ref: 'B38', value: hc.ebitda[0] }); cells.push({ ref: 'C38', value: hc.ebitda[1] }); cells.push({ ref: 'D38', value: hc.ebitda[2] })
  cells.push({ ref: 'B39', value: fmtPct(hc.margeEbitdaPct[0]), isString: true }); cells.push({ ref: 'C39', value: fmtPct(hc.margeEbitdaPct[1]), isString: true }); cells.push({ ref: 'D39', value: fmtPct(hc.margeEbitdaPct[2]), isString: true })
  cells.push({ ref: 'B40', value: h.resultatNet[0] }); cells.push({ ref: 'C40', value: h.resultatNet[1] }); cells.push({ ref: 'D40', value: h.resultatNet[2] })
  cells.push({ ref: 'B41', value: fmtPct(hc.margeNettePct[0]), isString: true }); cells.push({ ref: 'C41', value: fmtPct(hc.margeNettePct[1]), isString: true }); cells.push({ ref: 'D41', value: fmtPct(hc.margeNettePct[2]), isString: true })
  
  // Trésorerie (rows 44-46)
  cells.push({ ref: 'B44', value: h.tresoDebut[0] }); cells.push({ ref: 'C44', value: h.tresoDebut[1] }); cells.push({ ref: 'D44', value: h.tresoDebut[2] })
  cells.push({ ref: 'B45', value: h.tresoFin[0] }); cells.push({ ref: 'C45', value: h.tresoFin[1] }); cells.push({ ref: 'D45', value: h.tresoFin[2] })
  cells.push({ ref: 'B46', value: hc.variationTreso[0] }); cells.push({ ref: 'C46', value: hc.variationTreso[1] }); cells.push({ ref: 'D46', value: hc.variationTreso[2] })
  
  // Notes column (F)
  cells.push({ ref: 'F26', value: hc.margeBrutePct[2] >= 25 ? '✅ Benchmark OK' : '⚠️ < benchmark 25-40%', isString: true })
  cells.push({ ref: 'F31', value: h.assurances[2] === 0 ? '⚠️ Aucune assurance' : '', isString: true })
  cells.push({ ref: 'F39', value: hc.margeEbitdaPct[2] >= 15 ? '✅ > 15%' : '⚠️ < benchmark 15%', isString: true })
  
  return setCells(xml, cells)
}

/** Sheet 2: Analyse des Marges par Activité */
function fillSheet2(xml: string, data: PmeInputData, analysis: PmeAnalysisResult): string {
  const cells: Array<{ ref: string; value: number | string; isString?: boolean }> = []
  const hc = analysis.historique
  
  // Margin table rows 6-9
  for (let i = 0; i < Math.min(analysis.margesParActivite.length, 3); i++) {
    const m = analysis.margesParActivite[i]
    const row = 6 + i
    cells.push({ ref: `A${row}`, value: m.name, isString: true })
    cells.push({ ref: `B${row}`, value: m.ca })
    cells.push({ ref: `C${row}`, value: m.coutsDirects })
    cells.push({ ref: `D${row}`, value: m.margeBrute })
    cells.push({ ref: `E${row}`, value: fmtPct(m.margePct), isString: true })
    const classLabel = m.classification === 'renforcer' ? '🔥 À RENFORCER'
      : m.classification === 'optimiser' ? '⚠️ À OPTIMISER'
      : m.classification === 'arbitrer' ? '🧠 À ARBITRER' : '❌ À ARRÊTER'
    cells.push({ ref: `F${row}`, value: classLabel, isString: true })
  }
  
  // Total row 10
  cells.push({ ref: 'B10', value: hc.margeBrute[2] + hc.totalCoutsDirects[2] })
  cells.push({ ref: 'C10', value: hc.totalCoutsDirects[2] })
  cells.push({ ref: 'D10', value: hc.margeBrute[2] })
  cells.push({ ref: 'E10', value: fmtPct(hc.margeBrutePct[2]), isString: true })
  
  // Strategic recommendations (rows 20-23)
  const byClass = (c: string) => analysis.margesParActivite.filter(m => m.classification === c).map(m => m.name).join(', ') || '—'
  cells.push({ ref: 'B20', value: byClass('renforcer'), isString: true })
  cells.push({ ref: 'B21', value: byClass('optimiser'), isString: true })
  cells.push({ ref: 'B22', value: byClass('arbitrer'), isString: true })
  cells.push({ ref: 'B23', value: byClass('arreter'), isString: true })
  
  return setCells(xml, cells)
}

/** Sheet 3: Structure de Coûts & Efficacité */
function fillSheet3(xml: string, data: PmeInputData, analysis: PmeAnalysisResult): string {
  const h = data.historique
  const hc = analysis.historique
  const cells: Array<{ ref: string; value: number | string; isString?: boolean }> = []
  
  // Ratios (rows 6-10)
  cells.push({ ref: 'B6', value: fmtPct(hc.chargesFixesSurCA[0]), isString: true }); cells.push({ ref: 'C6', value: fmtPct(hc.chargesFixesSurCA[1]), isString: true }); cells.push({ ref: 'D6', value: fmtPct(hc.chargesFixesSurCA[2]), isString: true }); cells.push({ ref: 'E6', value: evolution(hc.chargesFixesSurCA[0], hc.chargesFixesSurCA[2]), isString: true })
  cells.push({ ref: 'B7', value: fmtPct(hc.masseSalarialeSurCA[0]), isString: true }); cells.push({ ref: 'C7', value: fmtPct(hc.masseSalarialeSurCA[1]), isString: true }); cells.push({ ref: 'D7', value: fmtPct(hc.masseSalarialeSurCA[2]), isString: true }); cells.push({ ref: 'E7', value: evolution(hc.masseSalarialeSurCA[0], hc.masseSalarialeSurCA[2]), isString: true })
  cells.push({ ref: 'B8', value: fmtPct(hc.margeBrutePct[0]), isString: true }); cells.push({ ref: 'C8', value: fmtPct(hc.margeBrutePct[1]), isString: true }); cells.push({ ref: 'D8', value: fmtPct(hc.margeBrutePct[2]), isString: true }); cells.push({ ref: 'E8', value: evolution(hc.margeBrutePct[0], hc.margeBrutePct[2]), isString: true })
  cells.push({ ref: 'B9', value: fmtPct(hc.margeEbitdaPct[0]), isString: true }); cells.push({ ref: 'C9', value: fmtPct(hc.margeEbitdaPct[1]), isString: true }); cells.push({ ref: 'D9', value: fmtPct(hc.margeEbitdaPct[2]), isString: true }); cells.push({ ref: 'E9', value: evolution(hc.margeEbitdaPct[0], hc.margeEbitdaPct[2]), isString: true })
  cells.push({ ref: 'B10', value: fmtPct(hc.margeNettePct[0]), isString: true }); cells.push({ ref: 'C10', value: fmtPct(hc.margeNettePct[1]), isString: true }); cells.push({ ref: 'D10', value: fmtPct(hc.margeNettePct[2]), isString: true }); cells.push({ ref: 'E10', value: evolution(hc.margeNettePct[0], hc.margeNettePct[2]), isString: true })
  
  // Charges evolution (rows 15-21)
  cells.push({ ref: 'B15', value: h.salaires[0] }); cells.push({ ref: 'C15', value: h.salaires[1] }); cells.push({ ref: 'D15', value: h.salaires[2] }); cells.push({ ref: 'E15', value: evolution(h.salaires[0], h.salaires[2]), isString: true })
  cells.push({ ref: 'B16', value: h.loyers[0] }); cells.push({ ref: 'C16', value: h.loyers[1] }); cells.push({ ref: 'D16', value: h.loyers[2] }); cells.push({ ref: 'E16', value: evolution(h.loyers[0], h.loyers[2]), isString: true })
  cells.push({ ref: 'B17', value: h.assurances[0] }); cells.push({ ref: 'C17', value: h.assurances[1] }); cells.push({ ref: 'D17', value: h.assurances[2] }); cells.push({ ref: 'E17', value: evolution(h.assurances[0], h.assurances[2]), isString: true })
  cells.push({ ref: 'B18', value: h.fraisGeneraux[0] }); cells.push({ ref: 'C18', value: h.fraisGeneraux[1] }); cells.push({ ref: 'D18', value: h.fraisGeneraux[2] }); cells.push({ ref: 'E18', value: evolution(h.fraisGeneraux[0], h.fraisGeneraux[2]), isString: true })
  cells.push({ ref: 'B19', value: h.marketing[0] }); cells.push({ ref: 'C19', value: h.marketing[1] }); cells.push({ ref: 'D19', value: h.marketing[2] }); cells.push({ ref: 'E19', value: evolution(h.marketing[0], h.marketing[2]), isString: true })
  cells.push({ ref: 'B20', value: h.fraisBancaires[0] }); cells.push({ ref: 'C20', value: h.fraisBancaires[1] }); cells.push({ ref: 'D20', value: h.fraisBancaires[2] }); cells.push({ ref: 'E20', value: evolution(h.fraisBancaires[0], h.fraisBancaires[2]), isString: true })
  cells.push({ ref: 'B21', value: hc.totalChargesFixes[0] }); cells.push({ ref: 'C21', value: hc.totalChargesFixes[1] }); cells.push({ ref: 'D21', value: hc.totalChargesFixes[2] }); cells.push({ ref: 'E21', value: evolution(hc.totalChargesFixes[0], hc.totalChargesFixes[2]), isString: true })
  
  // Diagnostic (rows 25-27)
  cells.push({ ref: 'B25', value: analysis.forces.slice(0, 2).join(' · '), isString: true })
  cells.push({ ref: 'B26', value: analysis.faiblesses.slice(0, 2).join(' · '), isString: true })
  cells.push({ ref: 'B27', value: analysis.recommandations.slice(0, 2).join(' · '), isString: true })
  
  return setCells(xml, cells)
}

/** Sheet 4: Trésorerie & BFR */
function fillSheet4(xml: string, data: PmeInputData, analysis: PmeAnalysisResult): string {
  const h = data.historique
  const hc = analysis.historique
  const cells: Array<{ ref: string; value: number | string; isString?: boolean }> = []
  
  // Trésorerie (rows 6-9)
  cells.push({ ref: 'B6', value: h.tresoFin[0] }); cells.push({ ref: 'C6', value: h.tresoFin[1] }); cells.push({ ref: 'D6', value: h.tresoFin[2] })
  cells.push({ ref: 'B7', value: hc.cashFlowOp[0] }); cells.push({ ref: 'C7', value: hc.cashFlowOp[1] }); cells.push({ ref: 'D7', value: hc.cashFlowOp[2] })
  cells.push({ ref: 'B8', value: hc.caf[0] }); cells.push({ ref: 'C8', value: hc.caf[1] }); cells.push({ ref: 'D8', value: hc.caf[2] })
  cells.push({ ref: 'B9', value: hc.dscr[0] >= 99 ? 'N/A' : hc.dscr[0].toFixed(2), isString: true })
  cells.push({ ref: 'C9', value: hc.dscr[1] >= 99 ? 'N/A' : hc.dscr[1].toFixed(2), isString: true })
  cells.push({ ref: 'D9', value: hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toFixed(2), isString: true })
  cells.push({ ref: 'F9', value: '> 1.2 requis', isString: true })
  
  // BFR (rows 14-18)
  cells.push({ ref: 'B14', value: h.dso[0] + 'j', isString: true }); cells.push({ ref: 'C14', value: h.dso[1] + 'j', isString: true }); cells.push({ ref: 'D14', value: h.dso[2] + 'j', isString: true })
  cells.push({ ref: 'B15', value: h.dpo[0] + 'j', isString: true }); cells.push({ ref: 'C15', value: h.dpo[1] + 'j', isString: true }); cells.push({ ref: 'D15', value: h.dpo[2] + 'j', isString: true })
  cells.push({ ref: 'B16', value: h.stockJours[0] + 'j', isString: true }); cells.push({ ref: 'C16', value: h.stockJours[1] + 'j', isString: true }); cells.push({ ref: 'D16', value: h.stockJours[2] + 'j', isString: true })
  cells.push({ ref: 'B17', value: hc.bfr[0] }); cells.push({ ref: 'C17', value: hc.bfr[1] }); cells.push({ ref: 'D17', value: hc.bfr[2] })
  cells.push({ ref: 'B18', value: fmtPct(hc.bfrSurCA[0]), isString: true }); cells.push({ ref: 'C18', value: fmtPct(hc.bfrSurCA[1]), isString: true }); cells.push({ ref: 'D18', value: fmtPct(hc.bfrSurCA[2]), isString: true })
  
  // Endettement (rows 22-25)
  cells.push({ ref: 'B22', value: h.detteCT[0] }); cells.push({ ref: 'C22', value: h.detteCT[1] }); cells.push({ ref: 'D22', value: h.detteCT[2] })
  cells.push({ ref: 'B23', value: h.detteLT[0] }); cells.push({ ref: 'C23', value: h.detteLT[1] }); cells.push({ ref: 'D23', value: h.detteLT[2] })
  cells.push({ ref: 'B24', value: hc.totalDettes[0] }); cells.push({ ref: 'C24', value: hc.totalDettes[1] }); cells.push({ ref: 'D24', value: hc.totalDettes[2] })
  cells.push({ ref: 'B25', value: hc.detteSurEbitda[0] >= 99 ? 'N/A' : hc.detteSurEbitda[0].toFixed(1) + 'x', isString: true })
  cells.push({ ref: 'C25', value: hc.detteSurEbitda[1] >= 99 ? 'N/A' : hc.detteSurEbitda[1].toFixed(1) + 'x', isString: true })
  cells.push({ ref: 'D25', value: hc.detteSurEbitda[2] >= 99 ? 'N/A' : hc.detteSurEbitda[2].toFixed(1) + 'x', isString: true })
  
  return setCells(xml, cells)
}

/** Sheet 5: Hypothèses de Projection */
function fillSheet5(xml: string, data: PmeInputData, analysis: PmeAnalysisResult): string {
  const hyp = data.hypotheses
  const cells: Array<{ ref: string; value: number | string; isString?: boolean }> = []
  
  // Hypothèses CA (rows 6-11)
  for (let y = 0; y < 5; y++) {
    const col = String.fromCharCode(66 + y) // B-F
    cells.push({ ref: `${col}6`, value: fmtPct(hyp.croissanceCA[y]), isString: true })
  }
  cells.push({ ref: 'G6', value: hyp.croissanceCA[0] > 30 ? '⚠️ Optimiste' : 'Justifié', isString: true })
  
  // Per-activity growth (rows 7-9)
  for (let a = 0; a < Math.min(data.activities.length, 3); a++) {
    const row = 7 + a
    cells.push({ ref: `A${row}`, value: `Croissance ${data.activities[a].name} (%)`, isString: true })
    for (let y = 0; y < 5; y++) {
      const col = String.fromCharCode(66 + y)
      cells.push({ ref: `${col}${row}`, value: fmtPct(hyp.croissanceParActivite?.[a]?.[y] ?? hyp.croissanceCA[y]), isString: true })
    }
  }
  
  // Prix moyen (row 10)
  for (let y = 0; y < 5; y++) {
    cells.push({ ref: `${String.fromCharCode(66 + y)}10`, value: fmtPct(hyp.evolutionPrix[y]), isString: true })
  }
  
  // Nouveaux clients (row 11)
  for (let y = 0; y < 5; y++) {
    cells.push({ ref: `${String.fromCharCode(66 + y)}11`, value: hyp.nouveauxClients?.[y] ?? 0 })
  }
  
  // Hypothèses coûts (rows 15-17)
  for (let y = 0; y < 5; y++) {
    const col = String.fromCharCode(66 + y)
    cells.push({ ref: `${col}15`, value: fmtPct(hyp.evolutionCoutsDirects[y]), isString: true })
    cells.push({ ref: `${col}16`, value: fmtPct(hyp.inflationChargesFixes[y]), isString: true })
    cells.push({ ref: `${col}17`, value: fmtPct(hyp.evolutionMasseSalariale[y]), isString: true })
  }
  
  // Plan d'embauche (rows 22+)
  if (hyp.embauches && hyp.embauches.length > 0) {
    hyp.embauches.forEach((emb, i) => {
      const row = 22 + i
      cells.push({ ref: `A${row}`, value: emb.poste, isString: true })
      if (emb.annee >= 1 && emb.annee <= 5) {
        cells.push({ ref: `${String.fromCharCode(65 + emb.annee)}${row}`, value: 1 })
      }
      cells.push({ ref: `G${row}`, value: emb.salaireMensuel })
    })
  }
  
  // CAPEX (rows 32+)
  const invests = hyp.investissements ?? [{ description: 'CAPEX Global', montants: hyp.capex }]
  invests.forEach((inv, i) => {
    const row = 32 + i
    cells.push({ ref: `A${row}`, value: inv.description, isString: true })
    for (let y = 0; y < 5; y++) {
      cells.push({ ref: `${String.fromCharCode(66 + y)}${row}`, value: inv.montants[y] })
    }
    cells.push({ ref: `G${row}`, value: inv.montants.reduce((s, v) => s + v, 0) })
  })
  
  return setCells(xml, cells)
}

/** Sheet 6: Projection Financière 5 Ans */
function fillSheet6(xml: string, data: PmeInputData, analysis: PmeAnalysisResult): string {
  const p = analysis.projection
  const cells: Array<{ ref: string; value: number | string; isString?: boolean }> = []
  
  function cagr(start: number, end: number, years: number): string {
    if (start <= 0 || end <= 0 || years <= 0) return 'N/A'
    return fmtPct(Math.round((Math.pow(end / start, 1 / years) - 1) * 10000) / 100)
  }
  
  const fillRow = (row: number, values: number[], cagrVal?: string) => {
    for (let y = 0; y < 5; y++) {
      cells.push({ ref: `${String.fromCharCode(66 + y)}${row}`, value: Math.round(values[y]) })
    }
    if (cagrVal) cells.push({ ref: `G${row}`, value: cagrVal, isString: true })
  }
  
  const fillRowPct = (row: number, values: number[]) => {
    for (let y = 0; y < 5; y++) {
      cells.push({ ref: `${String.fromCharCode(66 + y)}${row}`, value: fmtPct(values[y]), isString: true })
    }
  }
  
  // P&L (rows 6-24)
  fillRow(6, p.caTotal, cagr(p.caTotal[0], p.caTotal[4], 4))
  for (let a = 0; a < data.activities.length && a < 3; a++) {
    fillRow(7 + a, p.caByActivity[a])
  }
  fillRow(11, p.coutsDirects)
  fillRow(12, p.margeBrute, cagr(p.margeBrute[0], p.margeBrute[4], 4))
  fillRowPct(13, p.margeBrutePct)
  fillRow(15, p.chargesFixes)
  fillRow(16, p.salaires)
  fillRow(17, p.loyers)
  fillRow(18, p.autresCharges)
  fillRow(20, p.ebitda, cagr(p.ebitda[0], p.ebitda[4], 4))
  fillRowPct(21, p.margeEbitdaPct)
  fillRow(23, p.resultatNet, cagr(p.resultatNet[0], p.resultatNet[4], 4))
  fillRowPct(24, p.margeNettePct)
  
  // Cash-flow (rows 28-33)
  fillRow(28, p.cashFlowOp)
  fillRow(29, p.capex)
  fillRow(30, p.variationBFR)
  fillRow(31, p.remboursementDettes)
  fillRow(32, p.cashFlowNet)
  fillRow(33, p.tresoCumulee)
  
  // Point mort (rows 37-40)
  fillRow(37, p.chargesFixesAnnuelles)
  fillRowPct(38, p.margeSurCoutsVariablesPct)
  fillRow(39, p.caPointMort)
  for (let y = 0; y < 5; y++) {
    cells.push({ ref: `${String.fromCharCode(66 + y)}40`, value: p.moisPointMort[y].toFixed(1), isString: true })
  }
  
  return setCells(xml, cells)
}

/** Sheet 7: Analyse par Scénarios */
function fillSheet7(xml: string, data: PmeInputData, analysis: PmeAnalysisResult): string {
  const cells: Array<{ ref: string; value: number | string; isString?: boolean }> = []
  const s = analysis.scenarios // [Prudent, Central, Ambitieux]
  
  // Hypothèses (rows 6-9) — already have default values, update with actual
  cells.push({ ref: 'B6', value: fmtPct(s[0].croissanceCAGR), isString: true })
  cells.push({ ref: 'C6', value: fmtPct(s[1].croissanceCAGR), isString: true })
  cells.push({ ref: 'D6', value: fmtPct(s[2].croissanceCAGR), isString: true })
  
  cells.push({ ref: 'B7', value: fmtPct(s[0].margeBrutePct), isString: true })
  cells.push({ ref: 'C7', value: fmtPct(s[1].margeBrutePct), isString: true })
  cells.push({ ref: 'D7', value: fmtPct(s[2].margeBrutePct), isString: true })
  
  cells.push({ ref: 'B8', value: fmtPct(s[0].chargesFixesSurCA), isString: true })
  cells.push({ ref: 'C8', value: fmtPct(s[1].chargesFixesSurCA), isString: true })
  cells.push({ ref: 'D8', value: fmtPct(s[2].chargesFixesSurCA), isString: true })
  
  // Résultats An 5 (rows 13-18)
  cells.push({ ref: 'B13', value: s[0].caAn5 }); cells.push({ ref: 'C13', value: s[1].caAn5 }); cells.push({ ref: 'D13', value: s[2].caAn5 })
  cells.push({ ref: 'B14', value: s[0].ebitdaAn5 }); cells.push({ ref: 'C14', value: s[1].ebitdaAn5 }); cells.push({ ref: 'D14', value: s[2].ebitdaAn5 })
  cells.push({ ref: 'B15', value: fmtPct(s[0].margeEbitdaAn5), isString: true }); cells.push({ ref: 'C15', value: fmtPct(s[1].margeEbitdaAn5), isString: true }); cells.push({ ref: 'D15', value: fmtPct(s[2].margeEbitdaAn5), isString: true })
  cells.push({ ref: 'B16', value: s[0].resultatNetAn5 }); cells.push({ ref: 'C16', value: s[1].resultatNetAn5 }); cells.push({ ref: 'D16', value: s[2].resultatNetAn5 })
  cells.push({ ref: 'B17', value: s[0].tresoCumulee }); cells.push({ ref: 'C17', value: s[1].tresoCumulee }); cells.push({ ref: 'D17', value: s[2].tresoCumulee })
  cells.push({ ref: 'B18', value: fmtPct(s[0].roi), isString: true }); cells.push({ ref: 'C18', value: fmtPct(s[1].roi), isString: true }); cells.push({ ref: 'D18', value: fmtPct(s[2].roi), isString: true })
  
  // Sensibilité (rows 23-25)
  for (let i = 0; i < analysis.sensibilites.length && i < 3; i++) {
    const sens = analysis.sensibilites[i]
    const row = 23 + i
    cells.push({ ref: `B${row}`, value: `EBITDA: ${sens.impactEbitda >= 0 ? '+' : ''}${fmt(sens.impactEbitda)} FCFA`, isString: true })
    cells.push({ ref: `C${row}`, value: `Résultat: ${sens.impactResultatNet >= 0 ? '+' : ''}${fmt(sens.impactResultatNet)} FCFA`, isString: true })
    cells.push({ ref: `D${row}`, value: `Tréso: ${sens.impactTreso >= 0 ? '+' : ''}${fmt(sens.impactTreso)} FCFA`, isString: true })
  }
  
  // Recommandation (rows 29-30)
  cells.push({ ref: 'B29', value: 'Central — approche réaliste et prudente', isString: true })
  cells.push({ ref: 'B30', value: analysis.aiExpertCommentary?.analyseScenariosComment || 'Équilibre entre ambition et réalisme. Hypothèses testées sur les benchmarks sectoriels.', isString: true })
  
  return setCells(xml, cells)
}

/** Sheet 8: Synthèse Exécutive */
function fillSheet8(xml: string, data: PmeInputData, analysis: PmeAnalysisResult): string {
  const hc = analysis.historique
  const h = data.historique
  const hyp = data.hypotheses
  const cells: Array<{ ref: string; value: number | string; isString?: boolean }> = []
  
  // Slide 1 — État de santé (rows 6-12)
  cells.push({ ref: 'A6', value: `CA : ${fmt(h.caTotal[2])} FCFA (CAGR ${fmtPct(hc.cagrCA)}) | Marge brute : ${fmtPct(hc.margeBrutePct[2])} | EBITDA : ${fmt(hc.ebitda[2])} FCFA (${fmtPct(hc.margeEbitdaPct[2])})`, isString: true })
  cells.push({ ref: 'A7', value: `Trésorerie : ${fmt(h.tresoFin[2])} FCFA | DSCR : ${hc.dscr[2] >= 99 ? 'N/A' : hc.dscr[2].toString()} | BFR/CA : ${fmtPct(hc.bfrSurCA[2])}`, isString: true })
  
  // Forces (rows 10-11)
  analysis.forces.slice(0, 3).forEach((f, i) => {
    cells.push({ ref: `A${10 + i}`, value: `✅ ${f}`, isString: true })
  })
  
  // Faiblesses (rows 13-14)
  analysis.faiblesses.slice(0, 3).forEach((f, i) => {
    cells.push({ ref: `A${13 + i}`, value: `⚠️ ${f}`, isString: true })
  })
  
  // Slide 2 — Marges (rows 18-21)
  const fortPotentiel = analysis.margesParActivite.filter(m => m.classification === 'renforcer')
  fortPotentiel.forEach((m, i) => {
    cells.push({ ref: `A${19 + i}`, value: `🔥 ${m.name} — Marge ${fmtPct(m.margePct)}, CA ${fmt(m.ca)} FCFA`, isString: true })
  })
  
  const problemes = analysis.margesParActivite.filter(m => m.classification === 'optimiser' || m.classification === 'arreter')
  problemes.forEach((m, i) => {
    cells.push({ ref: `A${22 + i}`, value: `⚠️ ${m.name} — Marge ${fmtPct(m.margePct)}`, isString: true })
  })
  
  // Slide 3 — Plan d'action (rows 29-37)
  analysis.recommandations.slice(0, 4).forEach((r, i) => {
    cells.push({ ref: `A${29 + i}`, value: `${i + 1}. ${r}`, isString: true })
  })
  
  // Impact attendu
  const central = analysis.scenarios[1]
  cells.push({ ref: 'A32', value: `CA An 5 (central) : ${fmt(central.caAn5)} FCFA | EBITDA An 5 : ${fmt(central.ebitdaAn5)} FCFA | Marge EBITDA : ${fmtPct(central.margeEbitdaAn5)}`, isString: true })
  
  // Besoins financiers
  cells.push({ ref: 'A35', value: `CAPEX total (5 ans) : ${fmt(hyp.capex.reduce((s, v) => s + v, 0))} FCFA | Timing : An 1-2 prioritaire`, isString: true })
  
  // Phrase clé
  cells.push({ ref: 'A39', value: analysis.phraseCleDirigeant, isString: true })
  
  return setCells(xml, cells)
}


// ═══════════════════════════════════════════════════════════════
// MAIN: Fill template and return .xlsx bytes
// ═══════════════════════════════════════════════════════════════

export function fillFrameworkExcel(data: PmeInputData, analysis: PmeAnalysisResult): Uint8Array {
  // 1. Decode template from base64
  const templateBytes = b64ToUint8(FRAMEWORK_TEMPLATE_B64)
  
  // 2. Unzip the .xlsx
  const files = unzipSync(templateBytes)
  
  // 3. Decode sheet XMLs as text
  const decoder = new TextDecoder('utf-8')
  const encoder = new TextEncoder()
  
  const sheetFiles = [
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml',
    'xl/worksheets/sheet3.xml',
    'xl/worksheets/sheet4.xml',
    'xl/worksheets/sheet5.xml',
    'xl/worksheets/sheet6.xml',
    'xl/worksheets/sheet7.xml',
    'xl/worksheets/sheet8.xml',
  ]
  
  const fillers = [fillSheet1, fillSheet2, fillSheet3, fillSheet4, fillSheet5, fillSheet6, fillSheet7, fillSheet8]
  
  for (let i = 0; i < 8; i++) {
    const path = sheetFiles[i]
    if (files[path]) {
      let xml = decoder.decode(files[path])
      xml = fillers[i](xml, data, analysis)
      files[path] = encoder.encode(xml)
    }
  }
  
  // 4. Re-zip with same structure
  const result = zipSync(files, { level: 6 })
  return result
}
