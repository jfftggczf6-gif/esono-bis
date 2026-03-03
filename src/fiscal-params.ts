// ═══════════════════════════════════════════════════════════════
// Fiscal Parameters — Default values per West-African country
// Used by the Plan OVO generation engine (Step A-bis)
// Sources: UEMOA fiscal code, DGI of each country, BCEAO data
// ═══════════════════════════════════════════════════════════════

export interface FiscalParams {
  country: string
  countryCode: string
  currency: string
  exchangeRateEUR: number         // Local currency per 1 EUR
  vat: number                     // TVA (%)
  corporateTax: number            // Impot sur les societes (%)
  taxRegime1: { name: string; description: string; rate: number }
  taxRegime2: { name: string; description: string; rate: number }
  socialChargesRate: number       // Charges sociales patronales (% du brut)
  smig: number                    // SMIG mensuel en monnaie locale
  bankRate: number                // Taux bancaire moyen (%)
  inflationRate: number           // Inflation annuelle (%)
  loanInterestOVO: number         // Taux pret OVO (%)
  loanInterestFamily: number      // Taux pret famille/amis (%)
  loanInterestBank: number        // Taux pret banque locale (%)
  loanPeriodOVO: number           // Duree pret OVO (ans)
  loanPeriodFamily: number        // Duree pret famille (ans)
  loanPeriodBank: number          // Duree pret banque (ans)
  sectorBenchmarks: {
    grossMarginRange: [number, number]    // Marge brute typique min-max %
    ebitdaMarginRange: [number, number]   // EBITDA margin min-max %
    netMarginRange: [number, number]      // Marge nette min-max %
    debtRatioMax: number                  // Ratio dette max recommande
    currentRatioMin: number               // Ratio liquidite min recommande
    breakEvenMonths: [number, number]     // Seuil rentabilite min-max mois
  }
}

// ═══════════════════════════════════════════════════════════════
// Default fiscal parameters for UEMOA / West-African countries
// ═══════════════════════════════════════════════════════════════

const FISCAL_DEFAULTS: Record<string, FiscalParams> = {
  'cote_divoire': {
    country: "Cote d'Ivoire",
    countryCode: 'CI',
    currency: 'CFA',
    exchangeRateEUR: 655.957,
    vat: 0.18,
    corporateTax: 0.25,
    taxRegime1: { name: 'Impot sur le Revenu', description: 'Revenus <= 200 M F CFA', rate: 0.04 },
    taxRegime2: { name: 'Impot sur le Benefice', description: 'Revenus > 200 M F CFA', rate: 0.30 },
    socialChargesRate: 0.1645,
    smig: 75000,
    bankRate: 0.085,
    inflationRate: 0.035,
    loanInterestOVO: 0.07,
    loanInterestFamily: 0.10,
    loanInterestBank: 0.20,
    loanPeriodOVO: 5,
    loanPeriodFamily: 3,
    loanPeriodBank: 2,
    sectorBenchmarks: {
      grossMarginRange: [0.20, 0.55],
      ebitdaMarginRange: [0.10, 0.30],
      netMarginRange: [0.05, 0.20],
      debtRatioMax: 0.70,
      currentRatioMin: 1.2,
      breakEvenMonths: [12, 30]
    }
  },
  'senegal': {
    country: 'Senegal',
    countryCode: 'SN',
    currency: 'CFA',
    exchangeRateEUR: 655.957,
    vat: 0.18,
    corporateTax: 0.30,
    taxRegime1: { name: 'Impot sur le Revenu', description: 'Revenus <= 50 M F CFA', rate: 0.05 },
    taxRegime2: { name: 'Impot sur le Benefice', description: 'Revenus > 50 M F CFA', rate: 0.30 },
    socialChargesRate: 0.185,
    smig: 58900,
    bankRate: 0.09,
    inflationRate: 0.03,
    loanInterestOVO: 0.07,
    loanInterestFamily: 0.10,
    loanInterestBank: 0.18,
    loanPeriodOVO: 5,
    loanPeriodFamily: 3,
    loanPeriodBank: 2,
    sectorBenchmarks: {
      grossMarginRange: [0.18, 0.50],
      ebitdaMarginRange: [0.08, 0.25],
      netMarginRange: [0.04, 0.18],
      debtRatioMax: 0.65,
      currentRatioMin: 1.2,
      breakEvenMonths: [14, 36]
    }
  },
  'burkina_faso': {
    country: 'Burkina Faso',
    countryCode: 'BF',
    currency: 'CFA',
    exchangeRateEUR: 655.957,
    vat: 0.18,
    corporateTax: 0.275,
    taxRegime1: { name: 'Impot sur le Revenu', description: 'Revenus <= 50 M F CFA', rate: 0.05 },
    taxRegime2: { name: 'Impot sur le Benefice', description: 'Revenus > 50 M F CFA', rate: 0.275 },
    socialChargesRate: 0.16,
    smig: 52500,
    bankRate: 0.10,
    inflationRate: 0.04,
    loanInterestOVO: 0.07,
    loanInterestFamily: 0.10,
    loanInterestBank: 0.22,
    loanPeriodOVO: 5,
    loanPeriodFamily: 3,
    loanPeriodBank: 2,
    sectorBenchmarks: {
      grossMarginRange: [0.15, 0.45],
      ebitdaMarginRange: [0.07, 0.22],
      netMarginRange: [0.03, 0.15],
      debtRatioMax: 0.60,
      currentRatioMin: 1.3,
      breakEvenMonths: [16, 36]
    }
  },
  'mali': {
    country: 'Mali',
    countryCode: 'ML',
    currency: 'CFA',
    exchangeRateEUR: 655.957,
    vat: 0.18,
    corporateTax: 0.30,
    taxRegime1: { name: 'Impot Synthetique', description: 'Revenus <= 100 M F CFA', rate: 0.03 },
    taxRegime2: { name: 'Impot sur le Benefice', description: 'Revenus > 100 M F CFA', rate: 0.30 },
    socialChargesRate: 0.17,
    smig: 40000,
    bankRate: 0.10,
    inflationRate: 0.04,
    loanInterestOVO: 0.07,
    loanInterestFamily: 0.10,
    loanInterestBank: 0.22,
    loanPeriodOVO: 5,
    loanPeriodFamily: 3,
    loanPeriodBank: 2,
    sectorBenchmarks: {
      grossMarginRange: [0.15, 0.45],
      ebitdaMarginRange: [0.07, 0.22],
      netMarginRange: [0.03, 0.15],
      debtRatioMax: 0.60,
      currentRatioMin: 1.3,
      breakEvenMonths: [16, 40]
    }
  },
  'benin': {
    country: 'Benin',
    countryCode: 'BJ',
    currency: 'CFA',
    exchangeRateEUR: 655.957,
    vat: 0.18,
    corporateTax: 0.30,
    taxRegime1: { name: 'Impot Forfaitaire', description: 'Revenus <= 50 M F CFA', rate: 0.05 },
    taxRegime2: { name: 'Impot sur le Benefice', description: 'Revenus > 50 M F CFA', rate: 0.30 },
    socialChargesRate: 0.165,
    smig: 52000,
    bankRate: 0.09,
    inflationRate: 0.03,
    loanInterestOVO: 0.07,
    loanInterestFamily: 0.10,
    loanInterestBank: 0.20,
    loanPeriodOVO: 5,
    loanPeriodFamily: 3,
    loanPeriodBank: 2,
    sectorBenchmarks: {
      grossMarginRange: [0.18, 0.48],
      ebitdaMarginRange: [0.08, 0.24],
      netMarginRange: [0.04, 0.16],
      debtRatioMax: 0.65,
      currentRatioMin: 1.2,
      breakEvenMonths: [14, 36]
    }
  },
  'togo': {
    country: 'Togo',
    countryCode: 'TG',
    currency: 'CFA',
    exchangeRateEUR: 655.957,
    vat: 0.18,
    corporateTax: 0.27,
    taxRegime1: { name: 'Impot Forfaitaire', description: 'Revenus <= 60 M F CFA', rate: 0.04 },
    taxRegime2: { name: 'Impot sur le Benefice', description: 'Revenus > 60 M F CFA', rate: 0.27 },
    socialChargesRate: 0.175,
    smig: 52500,
    bankRate: 0.095,
    inflationRate: 0.035,
    loanInterestOVO: 0.07,
    loanInterestFamily: 0.10,
    loanInterestBank: 0.20,
    loanPeriodOVO: 5,
    loanPeriodFamily: 3,
    loanPeriodBank: 2,
    sectorBenchmarks: {
      grossMarginRange: [0.17, 0.48],
      ebitdaMarginRange: [0.08, 0.23],
      netMarginRange: [0.04, 0.15],
      debtRatioMax: 0.65,
      currentRatioMin: 1.2,
      breakEvenMonths: [15, 36]
    }
  },
  'niger': {
    country: 'Niger',
    countryCode: 'NE',
    currency: 'CFA',
    exchangeRateEUR: 655.957,
    vat: 0.19,
    corporateTax: 0.30,
    taxRegime1: { name: 'Impot Synthetique', description: 'Revenus <= 50 M F CFA', rate: 0.03 },
    taxRegime2: { name: 'Impot sur le Benefice', description: 'Revenus > 50 M F CFA', rate: 0.30 },
    socialChargesRate: 0.16,
    smig: 40462,
    bankRate: 0.11,
    inflationRate: 0.04,
    loanInterestOVO: 0.07,
    loanInterestFamily: 0.10,
    loanInterestBank: 0.22,
    loanPeriodOVO: 5,
    loanPeriodFamily: 3,
    loanPeriodBank: 2,
    sectorBenchmarks: {
      grossMarginRange: [0.14, 0.42],
      ebitdaMarginRange: [0.06, 0.20],
      netMarginRange: [0.03, 0.13],
      debtRatioMax: 0.55,
      currentRatioMin: 1.4,
      breakEvenMonths: [18, 42]
    }
  },
  'guinee_bissau': {
    country: 'Guinee-Bissau',
    countryCode: 'GW',
    currency: 'CFA',
    exchangeRateEUR: 655.957,
    vat: 0.15,
    corporateTax: 0.25,
    taxRegime1: { name: 'Impot Forfaitaire', description: 'Revenus <= 30 M F CFA', rate: 0.03 },
    taxRegime2: { name: 'Impot sur le Benefice', description: 'Revenus > 30 M F CFA', rate: 0.25 },
    socialChargesRate: 0.14,
    smig: 35000,
    bankRate: 0.12,
    inflationRate: 0.045,
    loanInterestOVO: 0.07,
    loanInterestFamily: 0.10,
    loanInterestBank: 0.24,
    loanPeriodOVO: 5,
    loanPeriodFamily: 3,
    loanPeriodBank: 2,
    sectorBenchmarks: {
      grossMarginRange: [0.12, 0.40],
      ebitdaMarginRange: [0.05, 0.18],
      netMarginRange: [0.02, 0.12],
      debtRatioMax: 0.55,
      currentRatioMin: 1.4,
      breakEvenMonths: [18, 48]
    }
  }
}

// Country name aliases for detection
const COUNTRY_ALIASES: Record<string, string> = {
  // Cote d'Ivoire
  "cote d'ivoire": 'cote_divoire',
  "cote divoire": 'cote_divoire',
  "côte d'ivoire": 'cote_divoire',
  "ivory coast": 'cote_divoire',
  "ci": 'cote_divoire',
  "abidjan": 'cote_divoire',
  "bouake": 'cote_divoire',
  "yamoussoukro": 'cote_divoire',
  "bouafle": 'cote_divoire',
  "gagnoa": 'cote_divoire',
  // Senegal
  "senegal": 'senegal',
  "sénégal": 'senegal',
  "dakar": 'senegal',
  "sn": 'senegal',
  // Burkina Faso
  "burkina faso": 'burkina_faso',
  "burkina": 'burkina_faso',
  "ouagadougou": 'burkina_faso',
  "bf": 'burkina_faso',
  // Mali
  "mali": 'mali',
  "bamako": 'mali',
  "ml": 'mali',
  // Benin
  "benin": 'benin',
  "bénin": 'benin',
  "cotonou": 'benin',
  "bj": 'benin',
  // Togo
  "togo": 'togo',
  "lome": 'togo',
  "lomé": 'togo',
  "tg": 'togo',
  // Niger
  "niger": 'niger',
  "niamey": 'niger',
  "ne": 'niger',
  // Guinee-Bissau
  "guinee-bissau": 'guinee_bissau',
  "guinée-bissau": 'guinee_bissau',
  "guinea-bissau": 'guinee_bissau',
  "guinea bissau": 'guinee_bissau',
  "bissau": 'guinee_bissau',
  "gw": 'guinee_bissau',
}

/**
 * Detect country from deliverable content (framework, BMC, diagnostic)
 * Searches through text content for country indicators
 */
export function detectCountry(deliverableContents: string[]): string {
  const combined = deliverableContents.join(' ').toLowerCase()

  // Check for explicit country mentions
  for (const [alias, key] of Object.entries(COUNTRY_ALIASES)) {
    if (combined.includes(alias)) {
      return key
    }
  }

  // Default to Cote d'Ivoire (most common for the platform)
  return 'cote_divoire'
}

/**
 * Get fiscal parameters for a country (by key or auto-detected)
 */
export function getFiscalParams(countryKey: string): FiscalParams {
  return FISCAL_DEFAULTS[countryKey] || FISCAL_DEFAULTS['cote_divoire']
}

/**
 * Build KB RAG context for fiscal parameters
 * Generates the 5 KB queries content for the Claude prompt
 */
export function buildKBContext(fiscal: FiscalParams): {
  kbContext: string
  queries: string[]
} {
  const queries = [
    `TVA et fiscalite entreprise ${fiscal.country} UEMOA zone CFA`,
    `Charges sociales patronales SMIG ${fiscal.country} CNPS`,
    `Taux bancaire moyen PME ${fiscal.country} BCEAO inflation`,
    `Benchmarks sectoriels marge brute EBITDA PME ${fiscal.country}`,
    `Conditions financement PME bailleurs OVO ${fiscal.country}`
  ]

  const kbContext = `
=== PARAMETRES FISCAUX — ${fiscal.country.toUpperCase()} ===
Monnaie: ${fiscal.currency}
Taux de change EUR: ${fiscal.exchangeRateEUR}
TVA: ${(fiscal.vat * 100).toFixed(1)}%
Impot des societes: ${(fiscal.corporateTax * 100).toFixed(1)}%
Regime 1: ${fiscal.taxRegime1.name} (${fiscal.taxRegime1.description}) = ${(fiscal.taxRegime1.rate * 100).toFixed(1)}%
Regime 2: ${fiscal.taxRegime2.name} (${fiscal.taxRegime2.description}) = ${(fiscal.taxRegime2.rate * 100).toFixed(1)}%
Charges sociales patronales: ${(fiscal.socialChargesRate * 100).toFixed(2)}%
SMIG mensuel: ${fiscal.currency} ${fiscal.smig.toLocaleString()}
Taux bancaire moyen: ${(fiscal.bankRate * 100).toFixed(1)}%
Inflation annuelle: ${(fiscal.inflationRate * 100).toFixed(1)}%

=== PARAMETRES PRETS ===
Pret OVO: ${(fiscal.loanInterestOVO * 100)}% sur ${fiscal.loanPeriodOVO} ans
Pret Famille/Amis: ${(fiscal.loanInterestFamily * 100)}% sur ${fiscal.loanPeriodFamily} ans
Pret Banque Locale: ${(fiscal.loanInterestBank * 100)}% sur ${fiscal.loanPeriodBank} ans

=== BENCHMARKS SECTORIELS ${fiscal.country.toUpperCase()} ===
Marge brute typique: ${(fiscal.sectorBenchmarks.grossMarginRange[0] * 100).toFixed(0)}-${(fiscal.sectorBenchmarks.grossMarginRange[1] * 100).toFixed(0)}%
Marge EBITDA typique: ${(fiscal.sectorBenchmarks.ebitdaMarginRange[0] * 100).toFixed(0)}-${(fiscal.sectorBenchmarks.ebitdaMarginRange[1] * 100).toFixed(0)}%
Marge nette typique: ${(fiscal.sectorBenchmarks.netMarginRange[0] * 100).toFixed(0)}-${(fiscal.sectorBenchmarks.netMarginRange[1] * 100).toFixed(0)}%
Ratio dette max: ${(fiscal.sectorBenchmarks.debtRatioMax * 100).toFixed(0)}%
Ratio liquidite min: ${fiscal.sectorBenchmarks.currentRatioMin}
Seuil de rentabilite: ${fiscal.sectorBenchmarks.breakEvenMonths[0]}-${fiscal.sectorBenchmarks.breakEvenMonths[1]} mois
`.trim()

  return { kbContext, queries }
}

export { FISCAL_DEFAULTS }
