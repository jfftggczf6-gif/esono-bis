// ═══════════════════════════════════════════════════════════════
// OVO Extraction Engine — Claude AI extraction for Plan Financier OVO
// Step C: Call Claude to extract structured financial data from deliverables
// ═══════════════════════════════════════════════════════════════

import { callClaudeJSON } from './claude-api'
import { FiscalParams } from './fiscal-params'
import { getTemplateStructureSummary } from './ovo-template-structure'

// ═══════════════════════════════════════════════════════════════
// TypeScript interfaces matching the JSON schema Claude must return
// ═══════════════════════════════════════════════════════════════

export interface OVOExtractionResult {
  hypotheses: {
    company_name: string
    country: string
    currency: string
    exchange_rate_eur: number
    vat_rate: number
    inflation_rate: number
    corporate_tax_rate: number
    tax_regime_1: { name: string; description: string; rate: number }
    tax_regime_2: { name: string; description: string; rate: number }
    social_charges_rate: number
    base_year: number
    growth_rate_annual: number
    sector: string
    business_model: string
  }
  produits: Array<{
    numero: number           // 1-20
    nom: string
    description: string
    actif: boolean           // filter = 1 or 0
    type: 'product' | 'service'
    gamme: 1 | 2 | 3        // Range: 1=Low, 2=Medium, 3=High
    canal: 1 | 2            // Channel: 1=B2B, 2=B2C
    prix_unitaire: {         // Par annee
      [year: string]: number // YEAR-2, YEAR-1, CURRENT_YEAR, YEAR2, YEAR3, YEAR4, YEAR5
    }
    volume: {
      [year: string]: number
    }
    cout_unitaire: {
      [year: string]: number
    }
  }>
  personnel: Array<{
    categorie: string        // ex: INTERIMAIRES, EMPLOYE(E)S
    departement: string      // ex: VENTE & MARKETING, ADMINISTRATION
    charges_sociales_pct: number  // ex: 0.1645
    effectif: {              // Nombre de personnes par annee
      [year: string]: number
    }
    salaire_brut_mensuel: {  // Salaire brut mensuel par personne
      [year: string]: number
    }
  }>
  compte_resultat: {
    marketing: {
      items: Array<{
        nom: string          // ex: ADVERTISING, COMMISSIONS, etc.
        montants: { [year: string]: number }
      }>
    }
    frais_bureau: {
      items: Array<{
        nom: string          // ex: RENT, ELECTRICITY, INTERNET, etc.
        montants: { [year: string]: number }
      }>
    }
    autres_depenses: {
      items: Array<{
        nom: string
        montants: { [year: string]: number }
      }>
    }
    voyage_transport: {
      montant_annuel: { [year: string]: number }
    }
    assurances: {
      items: Array<{
        nom: string
        montants: { [year: string]: number }
      }>
    }
    entretien: {
      items: Array<{
        nom: string
        montants: { [year: string]: number }
      }>
    }
    tiers: {
      items: Array<{
        nom: string
        montants: { [year: string]: number }
      }>
    }
  }
  investissements: Array<{
    nom: string
    categorie: 'FIXED ASSETS' | 'INTANGIBLE ASSETS' | 'START-UP COSTS'
    annee_acquisition: number
    valeur_acquisition: number
    taux_amortissement: number  // % annuel
  }>
  financement: {
    capital_initial: number
    apport_nouveaux_actionnaires: { [year: string]: number }
    pret_ovo: { montant: number; taux: number; duree: number }
    pret_famille: { montant: number; taux: number; duree: number }
    pret_banque: { montant: number; taux: number; duree: number }
  }
  tresorerie_mensuelle: {
    position_initiale: number
    delai_paiement_clients_jours: number
    delai_paiement_fournisseurs_jours: number
  }
  scenarios_simulation: {
    worst: { revenue_products: number; cogs_products: number; revenue_services: number; cogs_services: number; marketing: number; salaries: number; taxes_staff: number; office: number; other: number; travel: number; insurance: number; maintenance: number; third_parties: number }
    typical: { revenue_products: number; cogs_products: number; revenue_services: number; cogs_services: number; marketing: number; salaries: number; taxes_staff: number; office: number; other: number; travel: number; insurance: number; maintenance: number; third_parties: number }
    best: { revenue_products: number; cogs_products: number; revenue_services: number; cogs_services: number; marketing: number; salaries: number; taxes_staff: number; office: number; other: number; travel: number; insurance: number; maintenance: number; third_parties: number }
  }
  gammes: {
    range1: { nom: string; description: string }
    range2: { nom: string; description: string }
    range3: { nom: string; description: string }
  }
  canaux: {
    channel1: { nom: string; description: string }
    channel2: { nom: string; description: string }
  }
  metadata: {
    extraction_date: string
    sources_used: string[]
    confidence_score: number      // 0-100
    missing_data_notes: string[]
    cascade_applied: string[]     // Which cascade rules were used
  }
}

// ═══════════════════════════════════════════════════════════════
// System prompt for Claude — Financial data extraction
// ═══════════════════════════════════════════════════════════════

function buildOVOSystemPrompt(
  kbContext: string,
  templateStructure: string,
  fiscal: FiscalParams
): string {
  return `Tu es un expert financier specialise dans le remplissage de plans financiers pour les PME africaines, format bailleurs (OVO — Overseas Volunteer Organisation).

TON ROLE: Extraire et structurer les donnees financieres a partir des livrables d'analyse (Framework, BMC, SIC, Diagnostic) pour remplir le template Excel OVO.

${templateStructure}

${kbContext}

=== REGLES STRICTES ===

1. FEUILLES PROTEGEES: Ne JAMAIS proposer de modifications pour ReadMe, Instructions, RevenuePivot, RevenueChart, FinancePivot, FinanceChart, FinanceEUR
2. FEUILLES MODIFIABLES: InputsData (parametres), RevenueData (revenus par produit), FinanceData (P&L, charges, investissements)
3. FORMULES: Ne JAMAIS ecraser une cellule qui contient une formule. Les formules calculent automatiquement.
4. ANNEES: Le template couvre YEAR-2, YEAR-1, CURRENT YEAR (avec H1/H2), YEAR2, YEAR3, YEAR4, YEAR5. Utiliser les cles: "YEAR_MINUS_2", "YEAR_MINUS_1", "CURRENT_YEAR", "YEAR2", "YEAR3", "YEAR4", "YEAR5"

=== CASCADE DE DONNEES MANQUANTES ===
Quand une donnee n'est pas disponible dans les livrables, appliquer la cascade suivante:
1. Utiliser les donnees disponibles directement
2. Calculer a partir des ratios disponibles (marge brute, EBITDA %, etc.)
3. Estimer par IA a partir du contexte du secteur et du pays
4. Utiliser les valeurs par defaut du pays: ${fiscal.country}
5. Pour les projections manquantes: appliquer le taux de croissance annuel + inflation

=== PROJECTIONS ===
- Si seules les annees passees sont disponibles, projeter les annees futures avec:
  * Taux de croissance du framework ou estime
  * Ajuster pour l'inflation: ${(fiscal.inflationRate * 100).toFixed(1)}%
  * Respecter les benchmarks sectoriels: marge brute ${(fiscal.sectorBenchmarks.grossMarginRange[0] * 100).toFixed(0)}-${(fiscal.sectorBenchmarks.grossMarginRange[1] * 100).toFixed(0)}%

=== FORMAT DE REPONSE ===
Repondre UNIQUEMENT en JSON valide, sans commentaires, sans markdown. Le JSON doit correspondre exactement au schema suivant:

{
  "hypotheses": {
    "company_name": "string — nom de l'entreprise",
    "country": "string — pays (ex: COTE D'IVOIRE)",
    "currency": "string — monnaie (ex: CFA)",
    "exchange_rate_eur": "number — taux de change (ex: 655.957)",
    "vat_rate": "number — TVA decimal (ex: 0.18)",
    "inflation_rate": "number — inflation decimal (ex: 0.035)",
    "corporate_tax_rate": "number — impot societes (ex: 0.25)",
    "tax_regime_1": { "name": "string", "description": "string", "rate": "number" },
    "tax_regime_2": { "name": "string", "description": "string", "rate": "number" },
    "social_charges_rate": "number — charges sociales (ex: 0.1645)",
    "base_year": "number — annee de base (ex: 2025)",
    "growth_rate_annual": "number — taux croissance annuel estime (ex: 0.15)",
    "sector": "string — secteur d'activite",
    "business_model": "string — modele economique"
  },
  "produits": [
    {
      "numero": 1,
      "nom": "string — nom du produit",
      "description": "string",
      "actif": true,
      "type": "product | service",
      "gamme": "1 | 2 | 3",
      "canal": "1 | 2",
      "prix_unitaire": { "YEAR_MINUS_2": 0, "YEAR_MINUS_1": 0, "CURRENT_YEAR": 0, "YEAR2": 0, "YEAR3": 0, "YEAR4": 0, "YEAR5": 0 },
      "volume": { "YEAR_MINUS_2": 0, "YEAR_MINUS_1": 0, "CURRENT_YEAR": 0, "YEAR2": 0, "YEAR3": 0, "YEAR4": 0, "YEAR5": 0 },
      "cout_unitaire": { "YEAR_MINUS_2": 0, "YEAR_MINUS_1": 0, "CURRENT_YEAR": 0, "YEAR2": 0, "YEAR3": 0, "YEAR4": 0, "YEAR5": 0 }
    }
  ],
  "personnel": [
    {
      "categorie": "string",
      "departement": "string",
      "charges_sociales_pct": 0.1645,
      "effectif": { "YEAR_MINUS_2": 0, "YEAR_MINUS_1": 0, "CURRENT_YEAR": 0, "YEAR2": 0, "YEAR3": 0, "YEAR4": 0, "YEAR5": 0 },
      "salaire_brut_mensuel": { "YEAR_MINUS_2": 0, "YEAR_MINUS_1": 0, "CURRENT_YEAR": 0, "YEAR2": 0, "YEAR3": 0, "YEAR4": 0, "YEAR5": 0 }
    }
  ],
  "compte_resultat": {
    "marketing": { "items": [{ "nom": "string", "montants": {} }] },
    "frais_bureau": { "items": [{ "nom": "string", "montants": {} }] },
    "autres_depenses": { "items": [{ "nom": "string", "montants": {} }] },
    "voyage_transport": { "montant_annuel": {} },
    "assurances": { "items": [{ "nom": "string", "montants": {} }] },
    "entretien": { "items": [{ "nom": "string", "montants": {} }] },
    "tiers": { "items": [{ "nom": "string", "montants": {} }] }
  },
  "investissements": [
    {
      "nom": "string",
      "categorie": "FIXED ASSETS | INTANGIBLE ASSETS | START-UP COSTS",
      "annee_acquisition": 2025,
      "valeur_acquisition": 0,
      "taux_amortissement": 0.20
    }
  ],
  "financement": {
    "capital_initial": 0,
    "apport_nouveaux_actionnaires": {},
    "pret_ovo": { "montant": 0, "taux": ${fiscal.loanInterestOVO}, "duree": ${fiscal.loanPeriodOVO} },
    "pret_famille": { "montant": 0, "taux": ${fiscal.loanInterestFamily}, "duree": ${fiscal.loanPeriodFamily} },
    "pret_banque": { "montant": 0, "taux": ${fiscal.loanInterestBank}, "duree": ${fiscal.loanPeriodBank} }
  },
  "tresorerie_mensuelle": {
    "position_initiale": 0,
    "delai_paiement_clients_jours": 30,
    "delai_paiement_fournisseurs_jours": 60
  },
  "scenarios_simulation": {
    "worst": { "revenue_products": 0.95, "cogs_products": 1.10, "revenue_services": 0.60, "cogs_services": 1.10, "marketing": 1.25, "salaries": 1.25, "taxes_staff": 1.25, "office": 1.10, "other": 1.10, "travel": 1.10, "insurance": 1.10, "maintenance": 1.10, "third_parties": 1.20 },
    "typical": { "revenue_products": 1, "cogs_products": 1, "revenue_services": 1, "cogs_services": 1, "marketing": 1, "salaries": 1, "taxes_staff": 1, "office": 1, "other": 1, "travel": 1, "insurance": 1, "maintenance": 1, "third_parties": 1 },
    "best": { "revenue_products": 1.20, "cogs_products": 0.95, "revenue_services": 1.20, "cogs_services": 0.95, "marketing": 0.85, "salaries": 0.85, "taxes_staff": 0.85, "office": 0.90, "other": 0.90, "travel": 0.90, "insurance": 0.90, "maintenance": 0.90, "third_parties": 0.85 }
  },
  "gammes": {
    "range1": { "nom": "string", "description": "string" },
    "range2": { "nom": "string", "description": "string" },
    "range3": { "nom": "string", "description": "string" }
  },
  "canaux": {
    "channel1": { "nom": "string", "description": "string" },
    "channel2": { "nom": "string", "description": "string" }
  },
  "metadata": {
    "extraction_date": "ISO date string",
    "sources_used": ["framework", "bmc", "sic", "diagnostic"],
    "confidence_score": 75,
    "missing_data_notes": ["Liste des donnees manquantes ou estimees"],
    "cascade_applied": ["Liste des regles de cascade appliquees"]
  }
}

IMPORTANT:
- Tous les montants en monnaie locale (${fiscal.currency})
- Les taux sont en decimales (0.18 = 18%)
- Fournir des projections realistes basees sur les donnees disponibles
- Minimum 1 produit actif, maximum 20 produits + 10 services
- Maximum 10 categories de personnel
- Au moins 1 investissement
- Toujours remplir les 7 annees meme si estimation necessaire
- Le confidence_score reflete la qualite des donnees sources (0-100)
`
}

// ═══════════════════════════════════════════════════════════════
// Main extraction function
// ═══════════════════════════════════════════════════════════════

export interface DeliverableData {
  id: string
  type: string
  content: string
  score: number | null
  available: boolean
}

export interface OVOExtractionInput {
  apiKey: string
  framework: DeliverableData
  bmc?: DeliverableData
  sic?: DeliverableData
  diagnostic?: DeliverableData
  fiscal: FiscalParams
  kbContext: string
}

/**
 * Call Claude to extract structured financial data for the OVO Plan
 * Step C of the generation pipeline
 */
export async function extractOVOData(input: OVOExtractionInput): Promise<OVOExtractionResult> {
  const { apiKey, framework, bmc, sic, diagnostic, fiscal, kbContext } = input

  // Build the template structure summary
  const templateStructure = getTemplateStructureSummary()

  // Build the system prompt
  const systemPrompt = buildOVOSystemPrompt(kbContext, templateStructure, fiscal)

  // Build the user prompt with all available deliverables
  const userPrompt = buildUserPrompt(framework, bmc, sic, diagnostic, fiscal)

  console.log(`[OVO Extraction] Calling Claude with ${userPrompt.length} chars user prompt`)
  console.log(`[OVO Extraction] Sources: framework=${framework.available}, bmc=${!!bmc?.available}, sic=${!!sic?.available}, diagnostic=${!!diagnostic?.available}`)

  const result = await callClaudeJSON<OVOExtractionResult>({
    apiKey,
    systemPrompt,
    userPrompt,
    maxTokens: 8000,
    timeoutMs: 120_000,
    maxRetries: 2,
    label: 'OVO Extraction'
  })

  // Validate and sanitize the result
  return sanitizeExtractionResult(result, fiscal)
}

/**
 * Build user prompt with all available deliverable data
 */
function buildUserPrompt(
  framework: DeliverableData,
  bmc?: DeliverableData,
  sic?: DeliverableData,
  diagnostic?: DeliverableData,
  fiscal?: FiscalParams
): string {
  let prompt = `Extrais les donnees financieres structurees a partir des livrables suivants pour remplir le Plan Financier OVO.

=== FRAMEWORK (Plan Financier Intermediaire) — SOURCE PRINCIPALE ===
Score: ${framework.score || 'N/A'}
${framework.content}

`

  if (bmc?.available && bmc.content) {
    prompt += `=== BMC ANALYSE (Business Model Canvas) ===
Score: ${bmc.score || 'N/A'}
${bmc.content}

`
  }

  if (sic?.available && sic.content) {
    prompt += `=== SIC ANALYSE (Social Impact Canvas) ===
Score: ${sic.score || 'N/A'}
${sic.content}

`
  }

  if (diagnostic?.available && diagnostic.content) {
    prompt += `=== DIAGNOSTIC EXPERT ===
Score: ${diagnostic.score || 'N/A'}
${diagnostic.content}

`
  }

  prompt += `=== INSTRUCTIONS ===
1. Extraire TOUTES les donnees financieres disponibles des livrables ci-dessus
2. Pour les donnees manquantes, utiliser la cascade: donnees disponibles > ratios > estimation IA > defauts pays
3. Projeter sur 7 annees (YEAR-2 a YEAR5) en utilisant la croissance et l'inflation
4. Les montants doivent etre en ${fiscal?.currency || 'CFA'}
5. Retourner le JSON complet selon le schema defini dans les instructions systeme
6. Etre realiste et coherent avec le secteur et le pays de l'entreprise

Genere le JSON complet maintenant.`

  return prompt
}

/**
 * Sanitize and validate the extraction result
 * Ensures all required fields are present and values are reasonable
 */
function sanitizeExtractionResult(result: any, fiscal: FiscalParams): OVOExtractionResult {
  // Ensure hypotheses exist with defaults
  if (!result.hypotheses) result.hypotheses = {}
  const h = result.hypotheses
  h.country = h.country || fiscal.country
  h.currency = h.currency || fiscal.currency
  h.exchange_rate_eur = h.exchange_rate_eur || fiscal.exchangeRateEUR
  h.vat_rate = h.vat_rate ?? fiscal.vat
  h.inflation_rate = h.inflation_rate ?? fiscal.inflationRate
  h.corporate_tax_rate = h.corporate_tax_rate ?? fiscal.corporateTax
  h.social_charges_rate = h.social_charges_rate ?? fiscal.socialChargesRate
  h.base_year = h.base_year || new Date().getFullYear()
  h.growth_rate_annual = h.growth_rate_annual ?? 0.15

  if (!h.tax_regime_1) h.tax_regime_1 = fiscal.taxRegime1
  if (!h.tax_regime_2) h.tax_regime_2 = fiscal.taxRegime2

  // Ensure produits is an array with at least 1 entry
  if (!Array.isArray(result.produits) || result.produits.length === 0) {
    result.produits = [{
      numero: 1,
      nom: 'Produit Principal',
      description: 'Produit principal de l\'entreprise',
      actif: true,
      type: 'product',
      gamme: 1,
      canal: 1,
      prix_unitaire: { YEAR_MINUS_2: 0, YEAR_MINUS_1: 0, CURRENT_YEAR: 0, YEAR2: 0, YEAR3: 0, YEAR4: 0, YEAR5: 0 },
      volume: { YEAR_MINUS_2: 0, YEAR_MINUS_1: 0, CURRENT_YEAR: 0, YEAR2: 0, YEAR3: 0, YEAR4: 0, YEAR5: 0 },
      cout_unitaire: { YEAR_MINUS_2: 0, YEAR_MINUS_1: 0, CURRENT_YEAR: 0, YEAR2: 0, YEAR3: 0, YEAR4: 0, YEAR5: 0 }
    }]
  }

  // Ensure personnel exists
  if (!Array.isArray(result.personnel)) result.personnel = []

  // Ensure compte_resultat exists
  if (!result.compte_resultat) result.compte_resultat = {}
  const cr = result.compte_resultat
  if (!cr.marketing) cr.marketing = { items: [] }
  if (!cr.frais_bureau) cr.frais_bureau = { items: [] }
  if (!cr.autres_depenses) cr.autres_depenses = { items: [] }
  if (!cr.voyage_transport) cr.voyage_transport = { montant_annuel: {} }
  if (!cr.assurances) cr.assurances = { items: [] }
  if (!cr.entretien) cr.entretien = { items: [] }
  if (!cr.tiers) cr.tiers = { items: [] }

  // Ensure investissements exists
  if (!Array.isArray(result.investissements)) result.investissements = []

  // Ensure financement exists
  if (!result.financement) result.financement = {}
  const f = result.financement
  f.capital_initial = f.capital_initial ?? 0
  if (!f.pret_ovo) f.pret_ovo = { montant: 0, taux: fiscal.loanInterestOVO, duree: fiscal.loanPeriodOVO }
  if (!f.pret_famille) f.pret_famille = { montant: 0, taux: fiscal.loanInterestFamily, duree: fiscal.loanPeriodFamily }
  if (!f.pret_banque) f.pret_banque = { montant: 0, taux: fiscal.loanInterestBank, duree: fiscal.loanPeriodBank }

  // Ensure tresorerie_mensuelle exists
  if (!result.tresorerie_mensuelle) {
    result.tresorerie_mensuelle = {
      position_initiale: 0,
      delai_paiement_clients_jours: 30,
      delai_paiement_fournisseurs_jours: 60
    }
  }

  // Ensure scenarios_simulation exists
  if (!result.scenarios_simulation) {
    result.scenarios_simulation = {
      worst:   { revenue_products: 0.95, cogs_products: 1.10, revenue_services: 0.60, cogs_services: 1.10, marketing: 1.25, salaries: 1.25, taxes_staff: 1.25, office: 1.10, other: 1.10, travel: 1.10, insurance: 1.10, maintenance: 1.10, third_parties: 1.20 },
      typical: { revenue_products: 1, cogs_products: 1, revenue_services: 1, cogs_services: 1, marketing: 1, salaries: 1, taxes_staff: 1, office: 1, other: 1, travel: 1, insurance: 1, maintenance: 1, third_parties: 1 },
      best:    { revenue_products: 1.20, cogs_products: 0.95, revenue_services: 1.20, cogs_services: 0.95, marketing: 0.85, salaries: 0.85, taxes_staff: 0.85, office: 0.90, other: 0.90, travel: 0.90, insurance: 0.90, maintenance: 0.90, third_parties: 0.85 }
    }
  }

  // Ensure gammes and canaux exist
  if (!result.gammes) {
    result.gammes = {
      range1: { nom: 'LOW END', description: 'Entree de gamme' },
      range2: { nom: 'MEDIUM END', description: 'Gamme intermediaire' },
      range3: { nom: 'HIGH END', description: 'Haut de gamme' }
    }
  }
  if (!result.canaux) {
    result.canaux = {
      channel1: { nom: 'B2B', description: 'Vente aux entreprises' },
      channel2: { nom: 'B2C', description: 'Vente aux particuliers' }
    }
  }

  // Ensure metadata exists
  if (!result.metadata) result.metadata = {}
  const m = result.metadata
  m.extraction_date = m.extraction_date || new Date().toISOString()
  m.sources_used = m.sources_used || ['framework']
  m.confidence_score = m.confidence_score ?? 50
  m.missing_data_notes = m.missing_data_notes || []
  m.cascade_applied = m.cascade_applied || []

  return result as OVOExtractionResult
}
