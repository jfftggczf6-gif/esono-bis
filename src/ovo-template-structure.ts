// ═══════════════════════════════════════════════════════════════
// OVO Template Structure — Maps the Excel template layout
// Used by the extraction engine to know which cells to fill
// RULES: Never modify Pivot/Chart/EUR sheets; only InputsData, RevenueData, FinanceData
// ═══════════════════════════════════════════════════════════════

/**
 * Complete structure of the OVO template
 * Describes sheets, their purpose, editable cells, and formulas
 */
export const OVO_TEMPLATE_STRUCTURE = {
  sheets: {
    ReadMe: { editable: false, description: 'Instructions generales, ne pas modifier' },
    Instructions: { editable: false, description: 'Guide de remplissage, ne pas modifier' },
    InputsData: { editable: true, description: 'Donnees entreprise, parametres fiscaux, produits, personnel, prets, simulations' },
    RevenueData: { editable: true, description: 'Revenus par produit/service, prix, volumes, couts unitaires' },
    RevenuePivot: { editable: false, description: 'Tableau croise dynamique revenus — ne pas modifier' },
    RevenueChart: { editable: false, description: 'Graphiques revenus — ne pas modifier' },
    FinanceData: { editable: true, description: 'P&L, charges, investissements, bilan, tresorerie' },
    FinancePivot: { editable: false, description: 'Tableau croise dynamique finance — ne pas modifier' },
    FinanceChart: { editable: false, description: 'Graphiques finance — ne pas modifier' },
    FinanceEUR: { editable: false, description: 'Conversion EUR auto — ne pas modifier' }
  },

  // ═══════════════════════════════════════════════════════════
  // InputsData Sheet — Column J holds values, C3:K503
  // ═══════════════════════════════════════════════════════════
  inputsData: {
    // Section 1: Country Related (rows 4-22)
    countryRelated: {
      company:     { cell: 'J5',  item: 'COMPANY',       description: 'Nom de lentreprise' },
      country:     { cell: 'J6',  item: 'COUNTRY',        description: 'Pays (ex: COTE D\'IVOIRE)' },
      currency:    { cell: 'J8',  item: 'LOCAL CURRENCY',  description: 'Monnaie locale (ex: CFA)' },
      exchangeRate:{ cell: 'J9',  item: 'EXCHANGE RATE',   description: 'Taux de change monnaie/EUR' },
      conversionDate:{ cell: 'J10', item: 'CONVERSION DATE',description: 'Date de conversion (Excel serial date)' },
      vat:         { cell: 'J12', item: 'VAT',             description: 'TVA applicable (decimal, ex: 0.18)' },
      inflation:   { cell: 'J14', item: 'INFLATION',       description: 'Inflation annuelle (decimal, ex: 0.03)' },
      taxRegime1Rate: { cell: 'J17', item: 'TAX REGIME 1', description: 'Taux regime 1 (ex: 0.04)' },
      taxRegime1Desc1:{ cell: 'H17', item: 'TAX REGIME 1', description: 'Nom regime 1 (ex: IMPOT SUR LE REVENU)' },
      taxRegime1Desc2:{ cell: 'I17', item: 'TAX REGIME 1', description: 'Condition regime 1 (ex: REVENUS <= 200 M F CFA)' },
      taxRegime2Rate: { cell: 'J18', item: 'TAX REGIME 2', description: 'Taux regime 2 (ex: 0.30)' },
      taxRegime2Desc1:{ cell: 'H18', item: 'TAX REGIME 2', description: 'Nom regime 2' },
      taxRegime2Desc2:{ cell: 'I18', item: 'TAX REGIME 2', description: 'Condition regime 2' }
    },

    // Section 2: Year Related (rows 23-33)
    yearRelated: {
      yearMinus2:   { cell: 'J24', item: 'YEAR-2',       description: 'Annee N-2 (ex: 2023)' },
      // YEAR-1 to YEAR6 are FORMULAS (J25=J24+1, J26=J25+1, etc.) — do NOT overwrite
    },

    // Section 3: Products (rows 35-55) — up to 20 products
    products: {
      // For each product: H=name, I=filter (1=active, 0=inactive)
      // Products are PRODUCT 01 to PRODUCT 20 at rows 36-55
      rowStart: 36,
      rowEnd: 55,
      nameCol: 'H',     // Product name
      filterCol: 'I',   // 1 = active, 0 = inactive
      descCol: 'J',     // Free text description
    },

    // Section 3: Services (rows 57-67) — up to 10 services
    services: {
      rowStart: 58,
      rowEnd: 67,
      nameCol: 'H',
      filterCol: 'I',
      descCol: 'J',
    },

    // Section 4: Ranges (rows 69-72) — 3 ranges (Low/Medium/High end)
    ranges: {
      range1Name: { cell: 'H70', description: 'Gamme 1 nom (ex: LOW END)' },
      range1Desc: { cell: 'J70', description: 'Gamme 1 description' },
      range2Name: { cell: 'H71', description: 'Gamme 2 nom (ex: MEDIUM END)' },
      range2Desc: { cell: 'J71', description: 'Gamme 2 description' },
      range3Name: { cell: 'H72', description: 'Gamme 3 nom (ex: HIGH END)' },
      range3Desc: { cell: 'J72', description: 'Gamme 3 description' },
    },

    // Section 4: Distribution Channels (rows 74-76) — 2 channels
    distributionChannels: {
      channel1Name: { cell: 'H75', description: 'Canal 1 nom (ex: B2B)' },
      channel1Desc: { cell: 'J75', description: 'Canal 1 description' },
      channel2Name: { cell: 'H76', description: 'Canal 2 nom (ex: B2C)' },
      channel2Desc: { cell: 'J76', description: 'Canal 2 description' },
    },

    // Section 4: Product-Range-Channel Matrix (rows 78-98)
    // F:H = Range 1/2/3 assignment (0 or 1), I:J = Channel 1/2 assignment (0 or 1)
    productRangeMatrix: {
      rowStart: 79,  // Product 01
      rowEnd: 98,    // Product 20
      range1Col: 'F',
      range2Col: 'G',
      range3Col: 'H',
      channel1Col: 'I',
      channel2Col: 'J',
    },

    // Section 5: Staff Categories (rows 112-122) — up to 10 categories
    staffCategories: {
      rowStart: 113,
      rowEnd: 122,
      categoryCol: 'H',     // Occupational category name
      departmentCol: 'I',   // Department name
      socialSecurityCol: 'J' // Social security % of gross
    },

    // Section 6: Loans (rows 124-127)
    loans: {
      ovoInterest:    { cell: 'I125', description: 'Taux interet pret OVO (ex: 0.07)' },
      ovoPeriod:      { cell: 'J125', description: 'Duree remboursement OVO (ans)' },
      familyInterest: { cell: 'I126', description: 'Taux interet pret famille (ex: 0.10)' },
      familyPeriod:   { cell: 'J126', description: 'Duree pret famille (ans)' },
      bankInterest:   { cell: 'I127', description: 'Taux interet pret banque (ex: 0.20)' },
      bankPeriod:     { cell: 'J127', description: 'Duree pret banque (ans)' },
    },

    // Section 7: Simulation Scenarios (rows 129-142)
    simulation: {
      // H=worst case, I=typical case, J=best case
      // Rows 130-142 have multipliers for each scenario
      rowStart: 130,
      rowEnd: 142,
      worstCol: 'H',
      typicalCol: 'I',
      bestCol: 'J',
      items: [
        { row: 130, item: 'REVENUE PRODUCTS' },
        { row: 131, item: 'COST OF GOODS SOLD PRODUCTS' },
        { row: 132, item: 'REVENUE SERVICES' },
        { row: 133, item: 'COST OF GOODS SOLD SERVICES' },
        { row: 134, item: 'MARKETING COST' },
        { row: 135, item: 'STAFF SALARIES' },
        { row: 136, item: 'TAXES AND DUTIES ON STAFF' },
        { row: 137, item: 'OFFICE COSTS' },
        { row: 138, item: 'OTHER EXPENSES' },
        { row: 139, item: 'TRAVEL & TRANSPORTATION' },
        { row: 140, item: 'INSURANCE' },
        { row: 141, item: 'MAINTENANCE' },
        { row: 142, item: 'THIRD PARTIES' },
      ]
    }
  },

  // ═══════════════════════════════════════════════════════════
  // RevenueData Sheet — C7:AS1268
  // Per-product revenue details for each year
  // ═══════════════════════════════════════════════════════════
  revenueData: {
    description: `
      Each product occupies a BLOCK of rows (8 rows per year-set × block structure).
      Row structure per product block:
      - UNIT SELLING PRICE (by range: Low/Medium/High, by channel: B2B/B2C)
      - VOLUME MIX (% allocation across ranges/channels)
      - UNIT COST (COGS per unit, by range)
      - Values computed: Revenue per product per year = Volume × Avg Price
      - Columns: J=YEAR-2, K=YEAR-1 (actuals), L+=CURRENT YEAR through YEAR5 (forecasts)
      
      KEY COLUMNS (per year):
      - J: UNIT SELLING PRICE per unit (LOCAL CURRENCY)
      - K: VOLUME (quantity sold)
      - L: AVERAGE COGS (cost per unit)
      - Quarterly breakdown available in later columns
      
      PRODUCT BLOCKS start at:
      - Product 01: Row 8 (summary row 9+)
      - Product 02: Row 50 (summary row 51+)
      - Each product block spans ~42 rows
      - Products referenced via InputsData PRODUCT 01-20 names
    `,
    // For each product, the AI must provide per-year data:
    // quantity, unit_selling_price, unit_cost (COGS)
    // These map to specific rows within each product block
    yearColumns: {
      'YEAR-2':       { col: 'J', type: 'actual' },
      'YEAR-1':       { col: 'K', type: 'actual' },
      'CURRENT YEAR': { col: 'L', type: 'forecast' },
      'YEAR2':        { col: 'N', type: 'forecast' },
      'YEAR3':        { col: 'O', type: 'forecast' },
      'YEAR4':        { col: 'P', type: 'forecast' },
      'YEAR5':        { col: 'Q', type: 'forecast' },
    }
  },

  // ═══════════════════════════════════════════════════════════
  // FinanceData Sheet — C3:AH839
  // P&L, Operating Expenses, Investments, Balance Sheet, Cash Flow
  // ═══════════════════════════════════════════════════════════
  financeData: {
    sections: {
      // Section 1: Revenue and Gross Profit (rows 6-195)
      revenueGrossProfit: {
        rowRange: '6-195',
        description: 'Volume, prix moyen, revenus produits/services, COGS, marge brute',
        note: 'Most rows are FORMULAS referencing RevenueData — do NOT overwrite'
      },
      // Section 2: Operating Expenses (rows 199-403)
      operatingExpenses: {
        rowRange: '199-403',
        description: 'Marketing, salaires, charges sociales, frais bureau, autres depenses, voyages, assurances, entretien, tiers',
        subSections: [
          { name: 'Marketing Cost', rows: '201-211' },
          { name: 'Staff Salaries', rows: '213-281', note: '10 categories × headcount × gross salary per year' },
          { name: 'Taxes and Duties on Staff', rows: '283-292' },
          { name: 'Office Costs', rows: '294-309' },
          { name: 'Other Expenses', rows: '311-320' },
          { name: 'Travel & Transportation', rows: '322-324' },
          { name: 'Insurance', rows: '326-333' },
          { name: 'Maintenance', rows: '335-343' },
          { name: 'Third Parties', rows: '345-358' },
        ]
      },
      // Section 3: Investments & Amortisations (rows 406-580+)
      investments: {
        rowRange: '406-580',
        description: 'Immobilisations corporelles, incorporelles, frais de demarrage, amortissements',
        note: 'Each investment: name, acquisition year, value, amortisation rate'
      },
      // Section 4: General Financing (rows 580+)
      generalFinancing: {
        description: 'Capital, prets OVO/famille/banque, remboursements, interets'
      },
      // Section 5: P&L Summary
      profitAndLoss: {
        description: 'Revenue - COGS - OpEx - Amortisations - Interest - Taxes = Net Profit'
      },
      // Section 6: Balance Sheet
      balanceSheet: {
        description: 'Actifs (immobilises + courants) = Passifs (capitaux propres + dettes)'
      },
      // Section 7: Cash Flow Statement
      cashFlow: {
        description: 'Tresorerie: resultat net + amortissements - variation BFR - investissements + financement'
      }
    },
    yearColumns: {
      // FinanceData year columns (year header rows reference InputsData)
      'YEAR-2':       { col: 'O' },
      'YEAR-1':       { col: 'P' },
      'CURRENT YEAR H1': { col: 'Q' },
      'CURRENT YEAR H2': { col: 'R' },
      'YEAR2':        { col: 'S' },
      'YEAR3':        { col: 'T' },
      'YEAR4':        { col: 'U' },
      'YEAR5':        { col: 'V' },
    }
  }
}

/**
 * Describe the template structure as a summary for Claude
 * Used in the system prompt to inform the AI about the template layout
 */
export function getTemplateStructureSummary(): string {
  return `
=== STRUCTURE DU TEMPLATE OVO (Plan Financier Format Bailleurs) ===

FEUILLES MODIFIABLES (InputsData, RevenueData, FinanceData uniquement):
- InputsData: Colonne J = valeurs principales, C3:K503
- RevenueData: Donnees revenus par produit, C7:AS1268
- FinanceData: P&L, charges, investissements, bilan, tresorerie, C3:AH839

FEUILLES PROTEGEES (NE PAS MODIFIER):
- ReadMe, Instructions, RevenuePivot, RevenueChart, FinancePivot, FinanceChart, FinanceEUR

=== InputsData — Cellules cles (colonne J) ===
SECTION 1 - PAYS:
  J5  = COMPANY (nom entreprise)
  J6  = COUNTRY (pays)
  J8  = LOCAL CURRENCY (ex: CFA)
  J9  = EXCHANGE RATE (ex: 655.957)
  J12 = VAT (ex: 0.18)
  J14 = INFLATION (ex: 0.03)
  J17 = TAX REGIME 1 rate, H17/I17 = descriptions
  J18 = TAX REGIME 2 rate, H18/I18 = descriptions

SECTION 2 - ANNEES:
  J24 = YEAR-2 (ex: 2023), J25-J33 = formules auto (+1)

SECTION 3 - PRODUITS (lignes 36-55, jusqu'a 20):
  H = Nom produit, I = Filtre (1=actif, 0=inactif), J = Description
  Services: lignes 58-67 (jusqu'a 10)

SECTION 4 - GAMMES ET CANAUX:
  Gammes: H70-72 (Low/Medium/High End)
  Canaux: H75-76 (B2B, B2C)
  Matrice produit-gamme-canal: lignes 79-98 (F-J: 0 ou 1)

SECTION 5 - PERSONNEL (lignes 113-122, jusqu'a 10 categories):
  H = Categorie professionnelle, I = Departement, J = Charges sociales %

SECTION 6 - PRETS:
  I125/J125 = Pret OVO (taux / duree)
  I126/J126 = Pret Famille (taux / duree)
  I127/J127 = Pret Banque (taux / duree)

SECTION 7 - SCENARIOS (lignes 130-142):
  H = Worst case multiplier, I = Typical, J = Best case
  Pour: revenus produits/services, COGS, marketing, salaires, etc.

=== FinanceData — Sections principales ===
Section 1 (R6-195):   Revenue & Gross Profit (volumes, prix, COGS, marge brute)
Section 2 (R199-403): Operating Expenses (marketing, salaires, bureau, tiers, etc.)
Section 3 (R406-580): Investments & Amortisations
Section 4+:           Financing, P&L Summary, Balance Sheet, Cash Flow

Colonnes annees FinanceData: O=YEAR-2, P=YEAR-1, Q=CY-H1, R=CY-H2, S=YEAR2, T=YEAR3, U=YEAR4, V=YEAR5

=== RevenueData — Structure par produit ===
Chaque produit occupe un bloc de ~42 lignes avec:
- Prix unitaire (par gamme, par canal)
- Mix volumes (repartition %)
- Cout unitaire (COGS)
Colonnes: J=YEAR-2, K=YEAR-1, L=CURRENT YEAR, N=YEAR2, O=YEAR3, P=YEAR4, Q=YEAR5

REGLE CRUCIALE: La plupart des lignes FinanceData sont des FORMULES.
Seules les cellules d'entree (jaunes/sans formule) doivent etre remplies.
Les formules calculent automatiquement les totaux, ratios et indicateurs.
`.trim()
}
