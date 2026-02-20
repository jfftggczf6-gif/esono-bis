// ═══════════════════════════════════════════════════════════════
// XLSX PARSER — Parse .xlsx files using fflate (no Node.js APIs)
// Extracts cell data from all worksheets as structured text
// ═══════════════════════════════════════════════════════════════

import { unzipSync } from 'fflate'

interface CellData {
  ref: string
  value: string
  type: 'number' | 'string' | 'bool' | 'formula'
}

interface SheetData {
  name: string
  cells: CellData[]
}

/**
 * Parse an .xlsx file from a Uint8Array (binary content)
 * Returns structured data: sheet names + cell values
 */
export function parseXlsx(data: Uint8Array): SheetData[] {
  const files = unzipSync(data)
  const decoder = new TextDecoder('utf-8')
  
  // 1. Read shared strings
  const sharedStrings: string[] = []
  const ssPath = 'xl/sharedStrings.xml'
  if (files[ssPath]) {
    const ssXml = decoder.decode(files[ssPath])
    // Extract <t> elements from shared strings
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g
    let m
    while ((m = tRegex.exec(ssXml)) !== null) {
      sharedStrings.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))
    }
  }
  
  // 2. Read workbook.xml for sheet names
  const sheetNames: string[] = []
  const wbPath = 'xl/workbook.xml'
  if (files[wbPath]) {
    const wbXml = decoder.decode(files[wbPath])
    const sheetRegex = /<sheet\s+name="([^"]+)"/g
    let m
    while ((m = sheetRegex.exec(wbXml)) !== null) {
      sheetNames.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    }
  }
  
  // 3. Read each sheet
  const sheets: SheetData[] = []
  for (let i = 0; i < 20; i++) {
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`
    if (!files[sheetPath]) break
    
    const sheetXml = decoder.decode(files[sheetPath])
    const cells: CellData[] = []
    
    // Parse cells: <c r="A1" t="s"><v>0</v></c>
    const cellRegex = /<c\s+r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g
    let cm
    while ((cm = cellRegex.exec(sheetXml)) !== null) {
      const ref = cm[1]
      const attrs = cm[2]
      const inner = cm[3]
      
      // Get type
      const typeMatch = attrs.match(/\s+t="([^"]+)"/)
      const cellType = typeMatch ? typeMatch[1] : 'n'
      
      // Get value
      const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/)
      // Also check for inline strings
      const inlineMatch = inner.match(/<is>\s*<t[^>]*>([\s\S]*?)<\/t>\s*<\/is>/)
      
      let value = ''
      let dataType: CellData['type'] = 'number'
      
      if (inlineMatch) {
        value = inlineMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        dataType = 'string'
      } else if (valueMatch) {
        const raw = valueMatch[1]
        if (cellType === 's') {
          // Shared string reference
          const idx = parseInt(raw)
          value = sharedStrings[idx] || ''
          dataType = 'string'
        } else if (cellType === 'b') {
          value = raw === '1' ? 'TRUE' : 'FALSE'
          dataType = 'bool'
        } else {
          value = raw
          dataType = 'number'
        }
      }
      
      // Check for formula
      if (inner.includes('<f>') || inner.includes('<f ')) {
        dataType = 'formula'
      }
      
      if (value !== '') {
        cells.push({ ref, value, type: dataType })
      }
    }
    
    sheets.push({
      name: sheetNames[i] || `Sheet${i + 1}`,
      cells,
    })
  }
  
  return sheets
}

/**
 * Convert parsed xlsx data to readable text format
 * for AI processing and storage
 */
export function xlsxToText(sheets: SheetData[]): string {
  const lines: string[] = []
  for (const sheet of sheets) {
    lines.push(`\n=== FEUILLE: ${sheet.name} ===`)
    
    // Group cells by row
    const rows: Record<number, CellData[]> = {}
    for (const cell of sheet.cells) {
      const rowNum = parseInt(cell.ref.replace(/[A-Z]/g, ''))
      if (!rows[rowNum]) rows[rowNum] = []
      rows[rowNum].push(cell)
    }
    
    // Output rows sorted
    const sortedRows = Object.entries(rows).sort(([a], [b]) => parseInt(a) - parseInt(b))
    for (const [rowNum, cells] of sortedRows) {
      const cellTexts = cells
        .sort((a, b) => a.ref.localeCompare(b.ref))
        .map(c => `${c.ref}=${c.value}`)
        .join(' | ')
      lines.push(`  Row ${rowNum}: ${cellTexts}`)
    }
  }
  return lines.join('\n')
}

/**
 * Decode base64 to Uint8Array (works in Cloudflare Workers)
 */
export function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}
