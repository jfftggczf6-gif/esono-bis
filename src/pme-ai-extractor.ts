// ═══════════════════════════════════════════════════════════════
// CORRECTION 1 — AI-Powered Data Extraction for PME Framework
// Claude extrait les donnees financieres du texte/fichier Excel
// CORRECTION 2 — Estimation contextuelle des donnees manquantes
// ═══════════════════════════════════════════════════════════════

import { callClaudeJSON, isValidApiKey, type ClaudeContentBlock } from './claude-api'
import type { PmeInputData } from './framework-pme-engine'
import { parseXlsx, xlsxToMarkdownTables, b64ToUint8 } from './xlsx-parser'

// ─── TYPES ───

export interface ExtractionQuality {
  donnees_trouvees: number
  donnees_manquantes: number
  ambiguites: string[]
  confiance: 'haute' | 'moyenne' | 'basse'
  source: 'claude' | 'regex' | 'hybride'
}

export interface EstimationMeta {
  champ: string
  valeur: number
  estime: boolean
  raisonnement: string
  confiance: 'haute' | 'moyenne' | 'basse'
  fourchette?: [number, number]
  source_benchmark?: string
}

export interface EnrichedPmeInput {
  data: PmeInputData
  quality: ExtractionQuality
  estimations: EstimationMeta[]
}

// ─── EXTRACTION PROMPT ───

const SYSTEM_PROMPT_EXTRACTEUR = `Tu es un extracteur de donnees financieres pour PME africaines.

MISSION : Extraire TOUTES les donnees financieres du texte ci-joint et les structurer en JSON strict.

DONNEES A EXTRAIRE (cherche activement, meme si les noms varient) :

1. IDENTIFICATION :
   - raison_sociale, secteur, sous_secteur, pays, ville
   - forme_juridique, date_creation, effectif

2. CHIFFRE D'AFFAIRES (en FCFA, nombres entiers) :
   - ca_n_moins_2, ca_n_moins_1, ca_n (3 dernieres annees)
   - OU ca_previsionnel si c'est un projet
   - activites: [{ nom, ca_n, part_ca_pct }]
   - volumes, prix_unitaires si disponibles

3. COUTS VARIABLES :
   - achats_matieres_premieres, sous_traitance, transport
   - total_couts_variables

4. CHARGES FIXES :
   - salaires_bruts (masse salariale ANNUELLE)
   - charges_sociales, loyer, electricite_eau
   - assurances, frais_generaux, marketing, frais_bancaires
   - honoraires, telecoms

5. INVESTISSEMENTS (CAPEX) :
   - Liste: [{ nom, montant, duree_amortissement }]

6. FINANCEMENT :
   - fonds_propres, emprunts: [{ montant, taux_pct, duree_mois }]
   - subventions: [{ source, montant }]

7. BFR :
   - dso_jours (delai paiement clients)
   - dpo_jours (delai paiement fournisseurs)
   - rotation_stock_jours

8. TRESORERIE :
   - tresorerie_actuelle, tresorerie_debut_exercice

9. HYPOTHESES :
   - taux_croissance_ca: [an1, an2, an3, an4, an5] en %
   - inflation_prevue_pct
   - embauches: [{ poste, annee, salaire_mensuel }]

REGLES D'EXTRACTION :
- Si une donnee est dans le texte mais sous un nom different, EXTRAIS-LA
  (ex: "Revenus" = "Chiffre d'affaires", "CA" = "Chiffre d'affaires")
- Si une donnee est CALCULABLE a partir d'autres, CALCULE-LA
- Si une donnee est ABSENTE, mets null — NE PAS INVENTER
- Pour les montants : convertis en nombre entier FCFA (pas de string)
- Pour les salaires mensuels, PRECISE si c'est mensuel ou annuel
- Signale les donnees AMBIGUES dans "ambiguites"

FORMAT JSON STRICT :
{
  "identification": {
    "raison_sociale": "<string|null>",
    "secteur": "<string|null>",
    "sous_secteur": "<string|null>",
    "pays": "<string|null>",
    "ville": "<string|null>",
    "effectif": "<number|null>"
  },
  "chiffre_affaires": {
    "ca_n_moins_2": "<number|null>",
    "ca_n_moins_1": "<number|null>",
    "ca_n": "<number|null>",
    "activites": [{ "nom": "<string>", "ca_n": "<number>", "is_strategique": "<boolean>" }]
  },
  "couts_variables": {
    "achats_matieres": "<number|null>",
    "sous_traitance": "<number|null>",
    "couts_production": "<number|null>",
    "total": "<number|null>"
  },
  "charges_fixes": {
    "salaires_annuels": "<number|null>",
    "loyers": "<number|null>",
    "assurances": "<number|null>",
    "frais_generaux": "<number|null>",
    "marketing": "<number|null>",
    "frais_bancaires": "<number|null>",
    "total": "<number|null>"
  },
  "investissements": [{ "nom": "<string>", "montant": "<number>", "duree_amort": "<number>" }],
  "financement": {
    "fonds_propres": "<number|null>",
    "emprunts": [{ "montant": "<number>", "taux_pct": "<number>", "duree_mois": "<number>" }],
    "subventions": [{ "source": "<string>", "montant": "<number>" }]
  },
  "bfr": {
    "dso_jours": "<number|null>",
    "dpo_jours": "<number|null>",
    "stock_jours": "<number|null>"
  },
  "tresorerie": {
    "debut_exercice": "<number|null>",
    "fin_exercice": "<number|null>"
  },
  "hypotheses": {
    "croissance_ca_pct": ["<number>", "<number>", "<number>", "<number>", "<number>"],
    "inflation_pct": "<number|null>",
    "embauches": [{ "poste": "<string>", "annee": "<number>", "salaire_mensuel": "<number>" }]
  },
  "resultat_net": "<number|null>",
  "qualite_extraction": {
    "donnees_trouvees": "<number>",
    "donnees_manquantes": "<number>",
    "ambiguites": ["<string>"],
    "confiance": "haute|moyenne|basse"
  }
}`

// ─── ESTIMATION PROMPT ───

const SYSTEM_PROMPT_ESTIMATEUR = `Tu es un analyste financier expert PME Afrique de l'Ouest.

CONTEXTE : J'ai extrait des donnees financieres d'un fichier uploade.
Certaines donnees sont MANQUANTES (null).

MISSION : Estime les donnees manquantes en te basant sur :
1. Le SECTEUR et SOUS-SECTEUR de l'entreprise
2. La TAILLE de l'entreprise (CA, effectif)
3. Le PAYS (Cote d'Ivoire par defaut)
4. Les DONNEES DISPONIBLES (pour deduire les manquantes)
5. Les BENCHMARKS sectoriels Afrique de l'Ouest

BENCHMARKS DE REFERENCE PAR SECTEUR :

| Secteur              | Achats/CA | Salaires/CA | CF/CA   | DSO (j) |
|----------------------|-----------|-------------|---------|---------|
| Aviculture pondeuses | 50-65%    | 8-12%       | 25-35%  | 15-30   |
| Aviculture chair     | 55-70%    | 8-12%       | 25-35%  | 7-15    |
| Agriculture (autres) | 30-50%    | 15-25%      | 30-45%  | 30-60   |
| Commerce / Negoce    | 65-80%    | 5-10%       | 15-25%  | 30-45   |
| Services / Conseil   | 5-15%     | 35-55%      | 55-75%  | 45-90   |
| Restauration         | 35-45%    | 20-30%      | 40-55%  | 0-5     |
| Artisanat / Textile  | 30-45%    | 20-35%      | 35-50%  | 15-30   |
| Industrie legere     | 40-55%    | 15-25%      | 35-50%  | 30-60   |
| Tech / Digital       | 5-15%     | 40-60%      | 60-80%  | 30-60   |
| BTP                  | 50-65%    | 20-30%      | 30-45%  | 60-120  |
| Transport            | 40-55%    | 15-25%      | 35-50%  | 15-30   |
| Agro-industrie       | 40-60%    | 10-20%      | 30-45%  | 30-60   |

PARAMETRES COTE D'IVOIRE :
- TVA : 18%, IS : 25%, Charges sociales : ~25%
- SMIG : ~75 000 FCFA/mois
- Taux bancaire PME : 8-14%
- Inflation : 2-4%

REGLES D'ESTIMATION :
- Utilise le MILIEU de la fourchette sectorielle par defaut
- Si CA > 100M FCFA -> charges fixes plus faibles en %
- Si startup (<2 ans) -> DSO plus court, charges fixes plus elevees en %
- Si multi-activites -> repartis les couts proportionnellement au CA
- MARQUE chaque estimation avec confiance et raisonnement

FORMAT JSON :
{
  "estimations": [
    {
      "champ": "achats_matieres",
      "valeur": 38000000,
      "raisonnement": "Aviculture pondeuses CI -> achats 55-65% du CA. CA de 59M -> estimation a 60%",
      "confiance": "moyenne",
      "fourchette": [32500000, 41400000],
      "source_benchmark": "aviculture_pondeuses_aof"
    }
  ],
  "secteur_detecte": "agriculture_aviculture",
  "taille_entreprise": "petite|moyenne|grande",
  "donnees_completees": {
    "achats_matieres": 38000000,
    "salaires_annuels": 36975000,
    "loyers": 3000000,
    "assurances": 500000,
    "frais_generaux": 8000000,
    "marketing": 1500000,
    "frais_bancaires": 600000,
    "dso_jours": 0,
    "dpo_jours": 0,
    "stock_jours": 3,
    "tresorerie_debut": 2500000,
    "tresorerie_fin": 15000000,
    "resultat_net": 4000000
  }
}`

// ─── MAIN EXTRACTION FUNCTION ───

/**
 * CORRECTION 1 (CONFORME): Extract financial data using Claude AI
 * 
 * Strategy (adapté car Claude API ne supporte PAS le XLSX nativement — PDF only) :
 * 
 * A) Si le texte passé est déjà en format Markdown tables (préféré)
 *    → l'envoyer directement à Claude. Le format tableur structuré est
 *    nettement plus lisible pour l'AI que le Row-based format.
 * 
 * B) Si on a le XLSX base64 mais pas de Markdown → on le re-parse en Markdown
 *    tables et on envoie ce Markdown à Claude.
 * 
 * C) Si on n'a que le texte brut → on l'envoie tel quel (legacy)
 * 
 * D) Regex comme fallback/validation (inchangé)
 */
export async function extractPmeDataWithClaude(
  extractedText: string,
  apiKey: string,
  companyName: string = 'Entreprise',
  country: string = "Cote d'Ivoire",
  xlsxBase64?: string
): Promise<{ extracted: any; quality: ExtractionQuality }> {
  
  // CORRECTION 1 CONFORME: Determine best text format for Claude
  let bestText = extractedText
  let extractionMethod = 'text_brut'
  
  // Check if the text is already Markdown tables format (starts with ### FEUILLE)
  if (extractedText.includes('### FEUILLE:') || extractedText.includes('|---')) {
    extractionMethod = 'markdown_tables_pre_parsed'
    console.log(`[PME AI Extractor] Input is already Markdown tables format: ${extractedText.length} chars`)
  }
  // If not already Markdown AND we have raw XLSX, convert it
  else if (xlsxBase64 && xlsxBase64.length > 100) {
    try {
      const bytes = b64ToUint8(xlsxBase64)
      const sheets = parseXlsx(bytes)
      const mdTables = xlsxToMarkdownTables(sheets)
      if (mdTables.length > 200) {
        bestText = mdTables
        extractionMethod = 'xlsx_markdown_tables'
        console.log(`[PME AI Extractor] Converted XLSX to Markdown tables: ${mdTables.length} chars, ${sheets.length} sheets`)
      }
    } catch (err: any) {
      console.warn(`[PME AI Extractor] XLSX→Markdown conversion failed (using text fallback): ${err.message}`)
    }
  }
  
  const userPrompt = `Voici le contenu extrait d'un fichier financier d'une PME.
Extrais TOUTES les donnees financieres en JSON structure.

NOM ENTREPRISE: ${companyName}
PAYS: ${country}
FORMAT SOURCE: ${extractionMethod}${extractionMethod.includes('markdown') ? `

IMPORTANT: Le contenu ci-dessous est au format MARKDOWN TABLE issu d'un tableur Excel.
Chaque section "### FEUILLE:" correspond a un onglet du fichier Excel.
Les lignes "|...|...|" sont des tableaux — identifie les HEADERS (premiere ligne) 
et extrais les VALEURS NUMERIQUES des lignes suivantes.
Les montants sont en FCFA.` : ''}

--- DEBUT CONTENU FICHIER ---
${bestText.slice(0, 15000)}
--- FIN CONTENU FICHIER ---

Extrais les donnees en JSON strict selon le format demande.
ATTENTION: Identifie les headers de chaque tableau et extrait les valeurs numeriques correspondantes.`

  const result = await callClaudeJSON<any>({
    apiKey,
    systemPrompt: SYSTEM_PROMPT_EXTRACTEUR,
    userPrompt,
    maxTokens: 3000,
    timeoutMs: 25_000,
    maxRetries: 2,
    label: 'PME Extraction'
  })

  // Build quality assessment
  const qa = result.qualite_extraction || {}
  const quality: ExtractionQuality = {
    donnees_trouvees: qa.donnees_trouvees || 0,
    donnees_manquantes: qa.donnees_manquantes || 0,
    ambiguites: qa.ambiguites || [],
    confiance: qa.confiance || 'moyenne',
    source: 'claude'
  }

  console.log(`[PME AI Extractor] Claude extraction done (method=${extractionMethod}): ${quality.donnees_trouvees} found, ${quality.donnees_manquantes} missing, confidence=${quality.confiance}`)
  return { extracted: result, quality }
}

/**
 * CORRECTION 2: Estimate missing data using sector benchmarks via Claude
 * Only called when extraction has null fields
 */
export async function estimateMissingData(
  extractedData: any,
  apiKey: string,
  companyName: string,
  sector: string,
  country: string
): Promise<{ estimations: EstimationMeta[]; completedData: Record<string, any> }> {
  
  // Collect nulls
  const nullFields: string[] = []
  const flatData: Record<string, any> = {}

  // Flatten the extracted data to find nulls
  function flattenCheck(obj: any, prefix: string = '') {
    if (!obj || typeof obj !== 'object') return
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (v === null || v === undefined) {
        nullFields.push(key)
      } else if (typeof v === 'object' && !Array.isArray(v)) {
        flattenCheck(v, key)
      } else {
        flatData[key] = v
      }
    }
  }
  flattenCheck(extractedData)

  if (nullFields.length === 0) {
    return { estimations: [], completedData: {} }
  }

  const userPrompt = `ENTREPRISE: ${companyName}
SECTEUR: ${sector || 'Non precise'}
PAYS: ${country}

DONNEES DISPONIBLES :
${JSON.stringify(flatData, null, 2).slice(0, 4000)}

DONNEES MANQUANTES A ESTIMER (${nullFields.length}) :
${nullFields.join('\n')}

Estime les valeurs manquantes en te basant sur le secteur, la taille et les donnees disponibles. Reponds en JSON strict.`

  const result = await callClaudeJSON<any>({
    apiKey,
    systemPrompt: SYSTEM_PROMPT_ESTIMATEUR,
    userPrompt,
    maxTokens: 2000,
    timeoutMs: 15_000,
    maxRetries: 2,
    label: 'PME Estimation'
  })

  const estimations: EstimationMeta[] = (result.estimations || []).map((e: any) => ({
    champ: e.champ || '',
    valeur: e.valeur || 0,
    estime: true,
    raisonnement: e.raisonnement || '',
    confiance: e.confiance || 'moyenne',
    fourchette: e.fourchette,
    source_benchmark: e.source_benchmark
  }))

  return {
    estimations,
    completedData: result.donnees_completees || {}
  }
}

// ─── CONVERSION: Claude JSON → PmeInputData ───

/**
 * VALIDATION: Detect if a value looks like a percentage instead of a FCFA amount.
 * If CA is > 1M FCFA and a cost line is < 200, it's almost certainly a percentage.
 * Convert it to FCFA by multiplying by CA / 100.
 */
function fixPctAsFcfa(val: number, refCA: number, label: string): number {
  if (val <= 0 || refCA <= 0) return val
  // If CA > 500K and value < 200, it's very likely a percentage
  if (refCA > 500_000 && val > 0 && val < 200) {
    const corrected = Math.round(refCA * val / 100)
    console.log(`[PME Validation] ${label}: ${val} looks like a %% (CA=${refCA}), converting to ${corrected} FCFA`)
    return corrected
  }
  return val
}

/**
 * Convert Claude's extracted JSON into PmeInputData format
 * Merges extracted + estimated data
 * INCLUDES validation to detect percentages mistakenly used as FCFA amounts
 */
export function claudeResultToPmeInput(
  extracted: any,
  estimations: EstimationMeta[],
  completedData: Record<string, any>,
  companyName: string,
  country: string
): PmeInputData {
  const id = extracted.identification || {}
  const ca = extracted.chiffre_affaires || {}
  const cv = extracted.couts_variables || {}
  const cf = extracted.charges_fixes || {}
  const inv = extracted.investissements || []
  const fin = extracted.financement || {}
  const bfr = extracted.bfr || {}
  const treso = extracted.tresorerie || {}
  const hyp = extracted.hypotheses || {}
  const cd = completedData || {}

  // Helper: get value from extracted, then completedData, then default
  const v = (extractedVal: any, completedKey: string, fallback: number = 0): number => {
    if (extractedVal !== null && extractedVal !== undefined && typeof extractedVal === 'number') return extractedVal
    if (cd[completedKey] !== undefined && cd[completedKey] !== null) return cd[completedKey]
    return fallback
  }

  // CA — find the best value for each year
  let caN = v(ca.ca_n, 'ca_n', 0)
  let caN1 = v(ca.ca_n_moins_1, 'ca_n_moins_1', 0)
  let caN2 = v(ca.ca_n_moins_2, 'ca_n_moins_2', 0)
  
  // VALIDATION: If CA_N is suspiciously low (< 10000) but other years are > 1M, it's corrupt
  if (caN < 10_000 && (caN1 > 1_000_000 || caN2 > 1_000_000)) {
    console.log(`[PME Validation] CA_N=${caN} is suspiciously low vs CA_N-1=${caN1}. Using growth estimate.`)
    caN = caN1 > 0 ? Math.round(caN1 * 1.3) : caN2 > 0 ? Math.round(caN2 * 1.5) : 0
  }
  // Fill missing years
  if (caN1 <= 0 && caN > 0) caN1 = Math.round(caN * 0.4)
  if (caN2 <= 0 && caN1 > 0) caN2 = Math.round(caN1 * 0.6)
  
  const caTotal: [number, number, number] = [caN2, caN1, caN]
  const refCA = caN // Reference CA for validation

  // Activities
  const acts = ca.activites || []
  const activities: { name: string; isStrategic: boolean }[] = acts.length > 0
    ? acts.map((a: any, i: number) => ({
        name: (a.nom || `Activite ${i + 1}`).replace(/\|.*$/g, '').trim().slice(0, 60),
        isStrategic: a.is_strategique ?? (i === 0)
      }))
    : [{ name: 'Activite principale', isStrategic: true }]

  // CA by activity — distribute across years
  const caByActivity: [number, number, number][] = acts.length > 0
    ? acts.map((a: any) => {
        let actCA = a.ca_n || 0
        // VALIDATION: activity CA should not be 0 for all years if we have a total
        if (actCA <= 0 && caN > 0) actCA = Math.round(caN / Math.max(acts.length, 1))
        const ratio = caN > 0 ? actCA / caN : 1 / Math.max(acts.length, 1)
        return [Math.round(caN2 * ratio), Math.round(caN1 * ratio), actCA] as [number, number, number]
      })
    : [[caN2, caN1, caN]]

  // Scale helper for N-2, N-1
  const scale3 = (valN: number): [number, number, number] => {
    return [Math.round(valN * 0.5), Math.round(valN * 0.75), valN]
  }

  // Costs — with percentage detection fix
  let achatsMP = v(cv.achats_matieres, 'achats_matieres', Math.round(refCA * 0.35))
  achatsMP = fixPctAsFcfa(achatsMP, refCA, 'achatsMP')
  
  let sousTraitance = v(cv.sous_traitance, 'sous_traitance', 0)
  sousTraitance = fixPctAsFcfa(sousTraitance, refCA, 'sousTraitance')
  
  let coutsProduction = v(cv.couts_production, 'couts_production', Math.round(refCA * 0.1))
  coutsProduction = fixPctAsFcfa(coutsProduction, refCA, 'coutsProduction')
  
  let salaires = v(cf.salaires_annuels, 'salaires_annuels', Math.round(refCA * 0.15))
  // Don't fix salaires as pct — they can legitimately be large numbers from estimation
  
  let loyers = v(cf.loyers, 'loyers', Math.round(refCA * 0.03))
  loyers = fixPctAsFcfa(loyers, refCA, 'loyers')
  
  let assurances = v(cf.assurances, 'assurances', 0)
  assurances = fixPctAsFcfa(assurances, refCA, 'assurances')
  
  let fraisGeneraux = v(cf.frais_generaux, 'frais_generaux', Math.round(refCA * 0.05))
  fraisGeneraux = fixPctAsFcfa(fraisGeneraux, refCA, 'fraisGeneraux')
  
  let marketing = v(cf.marketing, 'marketing', 0)
  marketing = fixPctAsFcfa(marketing, refCA, 'marketing')
  
  let fraisBancaires = v(cf.frais_bancaires, 'frais_bancaires', 0)
  fraisBancaires = fixPctAsFcfa(fraisBancaires, refCA, 'fraisBancaires')
  
  let resultatNet = v(extracted.resultat_net, 'resultat_net', Math.round(refCA * 0.05))
  resultatNet = fixPctAsFcfa(resultatNet, refCA, 'resultatNet')

  // Tresorerie
  const tresoDebut = v(treso.debut_exercice, 'tresorerie_debut', 0)
  const tresoFin = v(treso.fin_exercice, 'tresorerie_fin', 0)

  // BFR
  const dsoJ = v(bfr.dso_jours, 'dso_jours', 30)
  const dpoJ = v(bfr.dpo_jours, 'dpo_jours', 30)
  const stockJ = v(bfr.stock_jours, 'stock_jours', 15)

  // Debt
  const emprunts = fin.emprunts || []
  const totalDetteLT = emprunts.reduce((s: number, e: any) => s + (e.montant || 0), 0)
  const tauxMoyen = emprunts.length > 0 ? emprunts[0].taux_pct || 8 : 8
  const dureeMoyenne = emprunts.length > 0 ? Math.round((emprunts[0].duree_mois || 60) / 12) : 5
  const serviceDetteAnnuel = totalDetteLT > 0
    ? Math.round(totalDetteLT / dureeMoyenne + totalDetteLT * tauxMoyen / 100)
    : 0

  // CAPEX
  const capexItems = Array.isArray(inv) ? inv : []
  const totalCapex = capexItems.reduce((s: number, i: any) => s + (i.montant || 0), 0)

  // Growth hypotheses
  const croissance = hyp.croissance_ca_pct || []
  const croissanceCA: [number, number, number, number, number] = [
    croissance[0] || 20, croissance[1] || 20, croissance[2] || 15,
    croissance[3] || 10, croissance[4] || 10
  ]
  const inflationPct = hyp.inflation_pct || 3

  // Embauches — clean up poste names (remove Excel cell references like "| C7=1.0 | D7=200000")
  const embauches = (hyp.embauches || []).map((e: any) => {
    let poste = (e.poste || 'Employe').replace(/\s*\|.*$/g, '').trim()
    if (poste.length > 50) poste = poste.slice(0, 50)
    const salaireMensuel = e.salaire_mensuel || 200_000
    return {
      poste,
      annee: e.annee || 1,
      // VALIDATION: if salary looks like annual instead of monthly (> 1M), divide by 12
      salaireMensuel: salaireMensuel > 1_000_000 ? Math.round(salaireMensuel / 12) : salaireMensuel
    }
  })

  // Investissements detailles
  const investissements = capexItems.length > 0
    ? capexItems.map((i: any) => ({
        description: i.nom || 'Investissement',
        montants: [i.montant || 0, 0, 0, 0, 0] as [number, number, number, number, number]
      }))
    : undefined

  return {
    companyName: id.raison_sociale || companyName,
    sector: id.secteur ? `${id.secteur}${id.sous_secteur ? ' / ' + id.sous_secteur : ''}` : '',
    analysisDate: new Date().toISOString().slice(0, 10),
    consultant: 'ESONO AI',
    location: id.ville || '',
    country: id.pays || country,
    activities,
    historique: {
      caTotal,
      caByActivity,
      achatsMP: scale3(achatsMP),
      sousTraitance: scale3(sousTraitance),
      coutsProduction: scale3(coutsProduction),
      salaires: scale3(salaires),
      loyers: scale3(loyers),
      assurances: [0, 0, assurances],
      fraisGeneraux: scale3(fraisGeneraux),
      marketing: [0, 0, marketing],
      fraisBancaires: [0, 0, fraisBancaires],
      resultatNet: scale3(resultatNet),
      tresoDebut: [0, Math.round(tresoFin * 0.2), tresoDebut > 0 ? tresoDebut : Math.round(tresoFin * 0.4)],
      tresoFin: [Math.round(tresoFin * 0.1), Math.round(tresoFin * 0.35), tresoFin],
      dso: [dsoJ, dsoJ, dsoJ],
      dpo: [dpoJ, dpoJ, dpoJ],
      stockJours: [stockJ, stockJ, stockJ],
      detteCT: [0, 0, 0],
      detteLT: [0, 0, totalDetteLT],
      serviceDette: [0, 0, serviceDetteAnnuel],
      amortissements: [0, Math.round(totalCapex * 0.1), Math.round(totalCapex * 0.2)],
    },
    hypotheses: {
      croissanceCA,
      evolutionPrix: [5, 5, 5, 5, 5],
      evolutionCoutsDirects: [inflationPct, inflationPct, inflationPct, inflationPct, inflationPct],
      inflationChargesFixes: [inflationPct, inflationPct, inflationPct, inflationPct, inflationPct],
      evolutionMasseSalariale: [10, 15, 10, 8, 8],
      capex: [totalCapex, Math.round(totalCapex * 0.15), Math.round(totalCapex * 0.05), 0, 0],
      amortissement: 5,
      embauches: embauches.length > 0 ? embauches : undefined,
      investissements,
    }
  }
}

// ─── MAIN PIPELINE: CORRECTION 1 + 2 combined ───

/**
 * Full AI-powered extraction pipeline (CORRECTION 1 CONFORME):
 * 
 * FLUX COMPLET :
 * 1. Si le texte passé est déjà en Markdown tables (### FEUILLE:) → envoi direct à Claude
 * 2. Sinon, si xlsxBase64 disponible → re-parse en Markdown tables → Claude extrait
 * 3. Sinon, texte brut legacy → Claude extrait (moins précis)
 * 4. Claude estimates missing fields with sector benchmarks (Correction 2)
 * 5. Converts to PmeInputData
 * 6. Merge with regex results (hybrid strategy)
 * Falls back to regex-only if Claude fails
 * 
 * @param extractedText - Best available text: Markdown tables (preferred) or legacy text
 * @param apiKey - Claude API key
 * @param companyName - Company name
 * @param country - Country (default: Cote d'Ivoire)
 * @param regexFallback - Fallback function using regex-based extraction (should receive legacy text)
 * @param xlsxBase64 - Optional: raw XLSX file as base64 string (backup if text isn't Markdown)
 */
export async function buildPmeInputWithAI(
  extractedText: string,
  apiKey: string,
  companyName: string = 'Entreprise',
  country: string = "Cote d'Ivoire",
  regexFallback: (text: string, name: string, country: string) => PmeInputData,
  xlsxBase64?: string
): Promise<EnrichedPmeInput> {
  
  if (!isValidApiKey(apiKey)) {
    console.log('[PME AI Extractor] No valid API key, using regex-only extraction')
    const data = regexFallback(extractedText, companyName, country)
    return {
      data,
      quality: { donnees_trouvees: 0, donnees_manquantes: 0, ambiguites: [], confiance: 'basse', source: 'regex' },
      estimations: []
    }
  }

  try {
    // STEP 1: Claude extracts structured data
    // CORRECTION 1 CONFORME: If xlsxBase64 is available, re-parse to Markdown tables
    // giving Claude a much better representation of the spreadsheet structure
    console.log(`[PME AI Extractor] Step 1: Claude extraction... (hasXlsxBase64=${!!xlsxBase64})`)
    const { extracted, quality } = await extractPmeDataWithClaude(
      extractedText, apiKey, companyName, country, xlsxBase64
    )
    console.log(`[PME AI Extractor] Extraction: ${quality.donnees_trouvees} found, ${quality.donnees_manquantes} missing, confidence=${quality.confiance}`)

    // STEP 2: Estimate missing data if needed
    let estimations: EstimationMeta[] = []
    let completedData: Record<string, any> = {}

    if (quality.donnees_manquantes > 0) {
      console.log('[PME AI Extractor] Step 2: Estimating missing data with sector benchmarks...')
      try {
        const est = await estimateMissingData(
          extracted, apiKey, companyName,
          extracted.identification?.secteur || '',
          country
        )
        estimations = est.estimations
        completedData = est.completedData
        console.log(`[PME AI Extractor] Estimated ${estimations.length} fields`)
      } catch (estErr: any) {
        console.error('[PME AI Extractor] Estimation failed (non-fatal):', estErr.message)
      }
    }

    // STEP 3: Convert to PmeInputData
    const data = claudeResultToPmeInput(extracted, estimations, completedData, companyName, country)

    // STEP 3b: Validate against regex results and pick best
    const regexData = regexFallback(extractedText, companyName, country)
    const finalData = mergeClaudeAndRegex(data, regexData)
    
    // STEP 3c: Post-validation sanity checks
    validateAndFixPmeInputData(finalData)

    quality.source = 'hybride'
    return { data: finalData, quality, estimations }

  } catch (err: any) {
    console.error('[PME AI Extractor] Claude extraction failed, falling back to regex:', err.message)
    const data = regexFallback(extractedText, companyName, country)
    return {
      data,
      quality: { donnees_trouvees: 0, donnees_manquantes: 0, ambiguites: [`Claude error: ${err.message}`], confiance: 'basse', source: 'regex' },
      estimations: []
    }
  }
}

/**
 * Merge Claude-extracted data with regex-extracted data
 * Strategy: take Claude values if non-zero, else take regex values
 * This ensures we never lose data that regex found but Claude missed
 */
function mergeClaudeAndRegex(claude: PmeInputData, regex: PmeInputData): PmeInputData {
  const merged = { ...claude }

  // For each numeric array field, prefer the one with more non-zero values
  // AND prefer larger values (FCFA amounts over percentage-like values)
  function pickBest3(
    cArr: [number, number, number],
    rArr: [number, number, number]
  ): [number, number, number] {
    const cNonZero = cArr.filter(v => v > 0).length
    const rNonZero = rArr.filter(v => v > 0).length
    
    // If one array has all values < 200 and the other has values > 1000, prefer the larger one
    // This catches the case where Claude returns percentages and regex returns FCFA amounts
    const cMax = Math.max(...cArr)
    const rMax = Math.max(...rArr)
    if (cMax < 200 && rMax > 1_000) return rArr
    if (rMax < 200 && cMax > 1_000) return cArr
    
    // If Claude found more or equal non-zero values, prefer Claude
    if (cNonZero >= rNonZero) return cArr
    return rArr
  }

  const h = merged.historique
  const rh = regex.historique

  // Merge historique — prefer the source with more actual data
  h.caTotal = pickBest3(h.caTotal, rh.caTotal)
  h.achatsMP = pickBest3(h.achatsMP, rh.achatsMP)
  h.coutsProduction = pickBest3(h.coutsProduction, rh.coutsProduction)
  h.salaires = pickBest3(h.salaires, rh.salaires)
  h.loyers = pickBest3(h.loyers, rh.loyers)
  h.fraisGeneraux = pickBest3(h.fraisGeneraux, rh.fraisGeneraux)
  h.resultatNet = pickBest3(h.resultatNet, rh.resultatNet)
  h.tresoFin = pickBest3(h.tresoFin, rh.tresoFin)

  // Activities — prefer the list with more items
  if (regex.activities.length > merged.activities.length && regex.activities[0]?.name !== 'Activite principale') {
    merged.activities = regex.activities
    h.caByActivity = rh.caByActivity
  }

  // Sector — prefer non-empty
  if (!merged.sector && regex.sector) merged.sector = regex.sector

  // Hypotheses — prefer Claude's growth rates if they look realistic
  const ch = merged.hypotheses.croissanceCA
  const rch = regex.hypotheses.croissanceCA
  // If Claude gave default-looking rates [20,20,15,10,10] but regex found specific ones, prefer regex
  if (ch[0] === 20 && ch[1] === 20 && rch[0] !== 20) {
    merged.hypotheses.croissanceCA = rch
  }

  // Embauches — prefer the longer list
  if ((regex.hypotheses.embauches?.length || 0) > (merged.hypotheses.embauches?.length || 0)) {
    merged.hypotheses.embauches = regex.hypotheses.embauches
  }

  // Investissements — prefer the longer list
  if ((regex.hypotheses.investissements?.length || 0) > (merged.hypotheses.investissements?.length || 0)) {
    merged.hypotheses.investissements = regex.hypotheses.investissements
  }

  return merged
}

/**
 * Post-validation: detect and fix obvious data quality issues in PmeInputData.
 * This catches cases where Claude's extraction produced nonsensical values.
 * Mutates the data object in-place.
 */
function validateAndFixPmeInputData(data: PmeInputData): void {
  const h = data.historique
  const caN = h.caTotal[2]
  
  if (caN <= 0) {
    console.warn('[PME Validation] CA Total is 0 — cannot validate proportions')
    return
  }
  
  // 1. Growth rates: cap at reasonable values (< 100% per year for projections)
  for (let i = 0; i < 5; i++) {
    if (data.hypotheses.croissanceCA[i] > 80) {
      console.log(`[PME Validation] CroissanceCA[${i}]=${data.hypotheses.croissanceCA[i]}% capped to 40%`)
      data.hypotheses.croissanceCA[i] = Math.min(data.hypotheses.croissanceCA[i], 40)
    }
  }
  
  // Also cap per-activity growth rates
  if (data.hypotheses.croissanceParActivite) {
    for (let a = 0; a < data.hypotheses.croissanceParActivite.length; a++) {
      for (let i = 0; i < 5; i++) {
        if (data.hypotheses.croissanceParActivite[a][i] > 100) {
          console.log(`[PME Validation] croissanceParActivite[${a}][${i}]=${data.hypotheses.croissanceParActivite[a][i]}% capped to 50%`)
          data.hypotheses.croissanceParActivite[a][i] = 50
        }
      }
    }
  }

  // 2. Check that costs are FCFA amounts, not percentages
  // If any cost line for year N is < 200 but CA > 1M, it's a percentage
  const fix3 = (arr: [number, number, number], label: string): void => {
    if (caN > 500_000 && arr[2] > 0 && arr[2] < 200) {
      const correctedN = Math.round(caN * arr[2] / 100)
      console.log(`[PME Validation] ${label}=[${arr.join(',')}] detected as %%s, converting to FCFA`)
      arr[2] = correctedN
      arr[1] = arr[1] > 0 && arr[1] < 200 ? Math.round(h.caTotal[1] * arr[1] / 100) : Math.round(correctedN * 0.75)
      arr[0] = arr[0] > 0 && arr[0] < 200 ? Math.round(h.caTotal[0] * arr[0] / 100) : Math.round(correctedN * 0.5)
    }
  }
  
  fix3(h.achatsMP, 'achatsMP')
  fix3(h.coutsProduction, 'coutsProduction')
  fix3(h.loyers, 'loyers')
  fix3(h.fraisGeneraux, 'fraisGeneraux')
  fix3(h.resultatNet, 'resultatNet')
  fix3(h.tresoFin, 'tresoFin')
  fix3(h.marketing, 'marketing')
  fix3(h.fraisBancaires, 'fraisBancaires')
  
  // 3. Check CA sum = activities sum (within 10% tolerance)
  const sumActs = h.caByActivity.reduce((s, a) => s + a[2], 0)
  if (sumActs > 0 && Math.abs(sumActs - caN) > caN * 0.1) {
    // Re-normalize activity CAs to match total
    console.log(`[PME Validation] CA activities sum (${sumActs}) != CA total (${caN}), normalizing`)
    for (let a = 0; a < h.caByActivity.length; a++) {
      const ratio = h.caByActivity[a][2] / sumActs
      h.caByActivity[a] = [
        Math.round(h.caTotal[0] * ratio),
        Math.round(h.caTotal[1] * ratio),
        Math.round(caN * ratio)
      ]
    }
  }
  
  // 4. Check charges fixes / CA ratio — if > 100%, something is wrong
  const totalCF = h.salaires[2] + h.loyers[2] + h.assurances[2] + h.fraisGeneraux[2] + h.marketing[2] + h.fraisBancaires[2]
  const cfRatio = totalCF / caN
  if (cfRatio > 1.5) {
    console.log(`[PME Validation] Charges fixes/CA = ${(cfRatio*100).toFixed(0)}% — extremely high, capping salaries`)
    // The most common issue is oversized salaries — cap at 40% of CA
    if (h.salaires[2] > caN * 0.4) {
      const cappedSal = Math.round(caN * 0.25)
      console.log(`[PME Validation] Salaries ${h.salaires[2]} > 40% of CA, capping to ${cappedSal}`)
      h.salaires[2] = cappedSal
      h.salaires[1] = Math.round(cappedSal * 0.75)
      h.salaires[0] = Math.round(cappedSal * 0.5)
    }
  }
  
  // 5. Clean up embauche names (remove Excel cell references)
  if (data.hypotheses.embauches) {
    for (const emb of data.hypotheses.embauches) {
      emb.poste = emb.poste.replace(/\s*\|.*$/g, '').trim()
      if (emb.poste.length > 50) emb.poste = emb.poste.slice(0, 50)
    }
  }
  
  console.log(`[PME Validation] Complete: CA=[${h.caTotal.join(',')}], CF/CA=${(totalCF/caN*100).toFixed(0)}%`)
}
