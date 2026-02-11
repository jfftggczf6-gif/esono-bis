// ═══════════════════════════════════════════════════════════════
// Inputs Engine — Financial Inputs Analysis & Validation
// Module 3 : 9 onglets, alertes IA temps reel, scoring, coherence
// ═══════════════════════════════════════════════════════════════

// ─── Types ───

export type InputTabKey = 'infos_generales' | 'donnees_historiques' | 'produits_services'
  | 'ressources_humaines' | 'hypotheses_croissance' | 'couts_fixes_variables'
  | 'bfr_tresorerie' | 'investissements' | 'financement'

export const INPUT_TAB_ORDER: InputTabKey[] = [
  'infos_generales', 'donnees_historiques', 'produits_services',
  'ressources_humaines', 'hypotheses_croissance', 'couts_fixes_variables',
  'bfr_tresorerie', 'investissements', 'financement'
]

export const INPUT_TAB_LABELS: Record<InputTabKey, { label: string, icon: string, shortLabel: string }> = {
  infos_generales:      { label: 'Informations Generales',  icon: 'fa-building',     shortLabel: 'Infos' },
  donnees_historiques:   { label: 'Donnees Historiques',     icon: 'fa-chart-line',   shortLabel: 'Historique' },
  produits_services:     { label: 'Produits & Services',     icon: 'fa-boxes-stacked', shortLabel: 'Produits' },
  ressources_humaines:   { label: 'Ressources Humaines',    icon: 'fa-users',        shortLabel: 'RH' },
  hypotheses_croissance: { label: 'Hypotheses Croissance',  icon: 'fa-arrow-trend-up', shortLabel: 'Croissance' },
  couts_fixes_variables: { label: 'Couts Fixes & Variables', icon: 'fa-calculator',   shortLabel: 'Couts' },
  bfr_tresorerie:        { label: 'BFR & Tresorerie',       icon: 'fa-vault',        shortLabel: 'BFR' },
  investissements:       { label: 'Investissements (CAPEX)', icon: 'fa-industry',     shortLabel: 'CAPEX' },
  financement:           { label: 'Financement',            icon: 'fa-hand-holding-dollar', shortLabel: 'Finance' }
}

export interface InputAlert {
  tab: InputTabKey
  field: string
  level: 'error' | 'warning' | 'info'
  message: string
  rule: string
}

export interface TabScore {
  key: InputTabKey
  label: string
  completeness: number    // 0-100%
  filledFields: number
  totalFields: number
  alerts: InputAlert[]
  strengths: string[]
  warnings: string[]
}

export interface FinancialRatios {
  // Marges
  margeBrute: number | null         // %
  margeOperationnelle: number | null // %
  margeNette: number | null         // %
  // Efficacite
  chargesFixesSurCA: number | null  // %
  masseSalarialeSurCA: number | null // %
  // Tresorerie
  dso: number | null                // jours
  dpo: number | null                // jours
  stockJours: number | null         // jours
  bfrSurCA: number | null           // %
  // Croissance
  croissanceCA: number | null       // %
  cagr5Ans: number | null           // %
  // Solvabilite
  detteSurEbitda: number | null
}

export interface InputsAnalysisResult {
  tabs: TabScore[]
  overallCompleteness: number   // 0-100%
  financialRatios: FinancialRatios
  alerts: InputAlert[]
  coherenceIssues: string[]
  recommendations: string[]
  readinessScore: number        // 0-100
  readinessLabel: string
  verdict: string
  timestamp: string
}

// ─── Coaching Sidebar Content ───
export const TAB_COACHING: Record<InputTabKey, { conseil: string, exemple: string, aEviter: string }> = {
  infos_generales: {
    conseil: 'Remplissez tous les champs obligatoires (*). La forme juridique et le regime fiscal impactent les projections.',
    exemple: 'GOTCHE SARL, Abidjan, Secteur Agriculture, cree en 2020, XOF, TVA 18%, regime Reel Normal.',
    aEviter: 'Ne laissez pas le champ devise vide : toutes les projections en dependent.'
  },
  donnees_historiques: {
    conseil: 'Utilisez vos chiffres reels. Si votre entreprise a moins de 3 ans, remplissez uniquement les annees disponibles.',
    exemple: 'CA N-2: 8,5M XOF | N-1: 15M XOF | N: 32M XOF (croissance +88% puis +113%).',
    aEviter: 'Ne gonflez pas vos chiffres passes. Les investisseurs verifieront la coherence avec les declarations fiscales.'
  },
  produits_services: {
    conseil: 'Listez TOUS vos produits/services meme les secondaires. La diversification rassure les investisseurs.',
    exemple: 'Manioc: 150 XOF/kg, marge 40% | Mais: 120 XOF/kg, marge 40% | Transformation: 200 XOF/tonne.',
    aEviter: 'Une marge superieure a 70% est rare et sera questionnee. Verifiez que tous les couts sont inclus.'
  },
  ressources_humaines: {
    conseil: 'Incluez les charges sociales (~25% du brut en Cote d\'Ivoire). Comptez aussi le dirigeant.',
    exemple: 'Gerant: 500K XOF/mois | Responsable production: 350K | Techniciens (x2): 200K chacun.',
    aEviter: 'N\'oubliez pas les ouvriers saisonniers ou les prestations exterieures. Un sous-effectif sera detecte.'
  },
  hypotheses_croissance: {
    conseil: 'Soyez REALISTE. Une croissance >50%/an doit etre justifiee par un marche porteur ou un contrat signe.',
    exemple: 'Croissance An 1: +30% (nouveaux clients) | An 2-5: +20% (croissance organique). Inflation: 3%.',
    aEviter: 'Promettre +100%/an sans preuve. Les investisseurs preferent une croissance moderee mais credible.'
  },
  couts_fixes_variables: {
    conseil: 'Separez bien couts fixes (loyer, assurances) et variables (matieres premieres, transport). Pensez a l\'assurance et la maintenance.',
    exemple: 'Variables: intrants 500 XOF/kg, transport 10K/tonne | Fixes: loyer 300K/mois, electricite 80K/mois.',
    aEviter: 'Oublier l\'assurance, la maintenance ou les frais bancaires. Ce sont des "oublis classiques" reperes par les analystes.'
  },
  bfr_tresorerie: {
    conseil: 'Le BFR est critique en Afrique de l\'Ouest. Un DSO >60 jours est un risque majeur. Precisez la tresorerie de depart.',
    exemple: 'DSO: 30 jours | DPO: 45 jours | Stock: 15 jours | Tresorerie: 2M XOF.',
    aEviter: 'Un DSO de 90 jours est un signal d\'alerte fort pour les investisseurs. Negociez avec vos clients.'
  },
  investissements: {
    conseil: 'Priorisez les investissements : Critique > Important > Souhaitable. Indiquez la duree d\'amortissement realiste.',
    exemple: 'Materiel agricole: 5M XOF, An 1, amortissement 5 ans, Critique | Vehicule: 8M XOF, An 2, 7 ans, Important.',
    aEviter: 'Un amortissement de 1 an sur du materiel lourd est irrealiste. Utilisez les durees standards de votre secteur.'
  },
  financement: {
    conseil: 'Montrez la diversite de vos sources. Un mix fonds propres + dette + subvention est ideal.',
    exemple: 'Capital: 10M XOF | Subvention FIRCA: 5M XOF | Pret BOA: 15M XOF a 12% sur 36 mois.',
    aEviter: 'Compter uniquement sur un seul type de financement. Un endettement >70% est risque.'
  }
}

// ─── Field definitions per tab ───
export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'currency'
  required: boolean
  placeholder?: string
  options?: string[]
  defaultValue?: string | number
  unit?: string
  group?: string
}

export const TAB_FIELDS: Record<InputTabKey, FieldDef[]> = {
  infos_generales: [
    { key: 'nom_entreprise', label: 'Nom de l\'entreprise', type: 'text', required: true, placeholder: 'Ex: GOTCHE SARL' },
    { key: 'forme_juridique', label: 'Forme juridique', type: 'select', required: false, options: ['SARL', 'SA', 'SAS', 'EI', 'Cooperative', 'Autre'] },
    { key: 'pays', label: 'Pays', type: 'text', required: true, placeholder: 'Ex: Cote d\'Ivoire', defaultValue: 'Cote d\'Ivoire' },
    { key: 'ville', label: 'Ville / Region', type: 'text', required: false, placeholder: 'Ex: Abidjan' },
    { key: 'secteur', label: 'Secteur d\'activite', type: 'select', required: true, options: ['Agriculture', 'Elevage', 'Peche', 'Agroalimentaire', 'Commerce', 'Services', 'Industrie', 'Artisanat', 'Transport', 'BTP', 'Autre'] },
    { key: 'date_creation', label: 'Date de creation', type: 'date', required: false },
    { key: 'immatriculation', label: 'N° immatriculation', type: 'text', required: false },
    { key: 'dirigeant_nom', label: 'Nom du dirigeant', type: 'text', required: true, placeholder: 'Nom complet' },
    { key: 'dirigeant_fonction', label: 'Fonction', type: 'text', required: false, placeholder: 'Ex: Gerant' },
    { key: 'dirigeant_tel', label: 'Telephone', type: 'text', required: true, placeholder: '+225 XX XX XX XX' },
    { key: 'dirigeant_email', label: 'Email', type: 'text', required: true, placeholder: 'email@entreprise.ci' },
    { key: 'devise', label: 'Devise', type: 'select', required: true, options: ['XOF', 'XAF', 'GNF', 'NGN', 'GHS', 'EUR', 'USD'], defaultValue: 'XOF' },
    { key: 'annee_fiscale', label: 'Annee fiscale', type: 'text', required: false, defaultValue: 'Janvier - Decembre' },
    { key: 'taux_tva', label: 'Taux TVA (%)', type: 'number', required: true, defaultValue: 18, unit: '%' },
    { key: 'regime_fiscal', label: 'Regime fiscal', type: 'select', required: false, options: ['Reel Normal', 'Reel Simplifie', 'Impot Synthetique', 'Micro-entreprise'] },
    { key: 'description_activite', label: 'Description de l\'activite', type: 'textarea', required: false, placeholder: 'Decrivez votre activite principale en quelques lignes...' }
  ],
  donnees_historiques: [
    // Revenus
    { key: 'ca_total_n2', label: 'CA Total N-2', type: 'currency', required: false, group: 'Revenus', unit: 'XOF' },
    { key: 'ca_total_n1', label: 'CA Total N-1', type: 'currency', required: false, group: 'Revenus', unit: 'XOF' },
    { key: 'ca_total_n', label: 'CA Total N', type: 'currency', required: true, group: 'Revenus', unit: 'XOF' },
    { key: 'ca_produit1_n', label: 'CA Produit 1 (N)', type: 'currency', required: false, group: 'Revenus', unit: 'XOF' },
    { key: 'ca_produit2_n', label: 'CA Produit 2 (N)', type: 'currency', required: false, group: 'Revenus', unit: 'XOF' },
    { key: 'ca_produit3_n', label: 'CA Produit 3 (N)', type: 'currency', required: false, group: 'Revenus', unit: 'XOF' },
    // Couts
    { key: 'couts_directs_n', label: 'Couts directs/variables (N)', type: 'currency', required: true, group: 'Couts', unit: 'XOF' },
    { key: 'charges_fixes_n', label: 'Charges fixes totales (N)', type: 'currency', required: true, group: 'Couts', unit: 'XOF' },
    { key: 'salaires_n', label: 'dont Salaires & charges (N)', type: 'currency', required: false, group: 'Couts', unit: 'XOF' },
    { key: 'loyer_n', label: 'dont Loyer & utilities (N)', type: 'currency', required: false, group: 'Couts', unit: 'XOF' },
    { key: 'autres_charges_n', label: 'dont Autres charges (N)', type: 'currency', required: false, group: 'Couts', unit: 'XOF' },
    // Resultats
    { key: 'resultat_exploitation_n', label: 'Resultat d\'exploitation (N)', type: 'currency', required: false, group: 'Resultats', unit: 'XOF' },
    { key: 'resultat_net_n', label: 'Resultat net (N)', type: 'currency', required: false, group: 'Resultats', unit: 'XOF' },
    // Autres
    { key: 'nb_clients_n', label: 'Nombre de clients (N)', type: 'number', required: false, group: 'Autres' },
    { key: 'nb_employes_n', label: 'Nombre d\'employes (N)', type: 'number', required: false, group: 'Autres' },
    { key: 'tresorerie_n', label: 'Tresorerie fin annee (N)', type: 'currency', required: false, group: 'Autres', unit: 'XOF' }
  ],
  produits_services: [
    { key: 'produits_json', label: 'Liste des produits/services', type: 'textarea', required: true, placeholder: 'Format JSON : [{nom, type, prix_unitaire, unite, cout_unitaire, marge_pct}]' }
  ],
  ressources_humaines: [
    { key: 'equipe_json', label: 'Liste des postes', type: 'textarea', required: true, placeholder: 'Format JSON : [{poste, nombre, salaire_brut_mensuel}]' }
  ],
  hypotheses_croissance: [
    { key: 'ca_an1', label: 'Objectif CA An 1', type: 'currency', required: true, unit: 'XOF' },
    { key: 'ca_an2', label: 'Objectif CA An 2', type: 'currency', required: false, unit: 'XOF' },
    { key: 'ca_an3', label: 'Objectif CA An 3', type: 'currency', required: false, unit: 'XOF' },
    { key: 'ca_an4', label: 'Objectif CA An 4', type: 'currency', required: false, unit: 'XOF' },
    { key: 'ca_an5', label: 'Objectif CA An 5', type: 'currency', required: false, unit: 'XOF' },
    { key: 'marge_brute_cible', label: 'Marge brute cible (%)', type: 'number', required: true, defaultValue: 40, unit: '%' },
    { key: 'marge_op_cible', label: 'Marge operationnelle cible (%)', type: 'number', required: false, defaultValue: 15, unit: '%' },
    { key: 'inflation', label: 'Inflation annuelle (%)', type: 'number', required: false, defaultValue: 3, unit: '%' },
    { key: 'augmentation_prix', label: 'Augmentation prix annuelle (%)', type: 'number', required: false, defaultValue: 5, unit: '%' },
    { key: 'taux_is', label: 'Taux IS (%)', type: 'number', required: false, defaultValue: 25, unit: '%' }
  ],
  couts_fixes_variables: [
    { key: 'couts_variables_json', label: 'Couts variables', type: 'textarea', required: false, placeholder: 'Format JSON : [{poste, cout_unitaire, unite}]' },
    { key: 'couts_fixes_json', label: 'Couts fixes', type: 'textarea', required: false, placeholder: 'Format JSON : [{poste, montant_mensuel, periodicite, categorie}]' }
  ],
  bfr_tresorerie: [
    { key: 'dso', label: 'Delai clients (DSO)', type: 'number', required: false, unit: 'jours', placeholder: 'Ex: 30' },
    { key: 'dpo', label: 'Delai fournisseurs (DPO)', type: 'number', required: false, unit: 'jours', placeholder: 'Ex: 45' },
    { key: 'stock_moyen', label: 'Stock moyen', type: 'number', required: false, unit: 'jours', placeholder: 'Ex: 15' },
    { key: 'tresorerie_depart', label: 'Tresorerie de depart', type: 'currency', required: true, unit: 'XOF' }
  ],
  investissements: [
    { key: 'investissements_json', label: 'Investissements prevus', type: 'textarea', required: false, placeholder: 'Format JSON : [{description, montant, annee, duree_amortissement, priorite}]' }
  ],
  financement: [
    { key: 'apports_capital', label: 'Apports en capital', type: 'currency', required: false, unit: 'XOF' },
    { key: 'subventions', label: 'Subventions & dons', type: 'currency', required: false, unit: 'XOF' },
    { key: 'credits_fournisseurs', label: 'Credits fournisseurs', type: 'currency', required: false, unit: 'XOF' },
    { key: 'prets_json', label: 'Detail prets', type: 'textarea', required: false, placeholder: 'Format JSON : [{source, montant, taux, duree_mois, differe_mois}]' }
  ]
}

// ─── Helper: parse currency ───
function parseCurrency(val: any): number | null {
  if (val === null || val === undefined || val === '') return null
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? null : n
}

// ─── Score a single tab ───
export function scoreTab(tabKey: InputTabKey, data: Record<string, any>): TabScore {
  const fields = TAB_FIELDS[tabKey]
  const info = INPUT_TAB_LABELS[tabKey]
  const alerts: InputAlert[] = []
  const strengths: string[] = []
  const warnings: string[] = []

  let filledFields = 0
  const totalFields = fields.length

  for (const field of fields) {
    const val = data[field.key]
    const hasValue = val !== null && val !== undefined && val !== '' && String(val).trim().length > 0
    if (hasValue) filledFields++

    if (field.required && !hasValue) {
      alerts.push({
        tab: tabKey, field: field.key, level: 'error',
        message: `Champ obligatoire "${field.label}" non rempli.`,
        rule: 'required'
      })
    }
  }

  // ─── Tab-specific validations ───
  if (tabKey === 'donnees_historiques') {
    const caN = parseCurrency(data.ca_total_n)
    const caProd1 = parseCurrency(data.ca_produit1_n) ?? 0
    const caProd2 = parseCurrency(data.ca_produit2_n) ?? 0
    const caProd3 = parseCurrency(data.ca_produit3_n) ?? 0
    const sumProduits = caProd1 + caProd2 + caProd3

    if (caN && sumProduits > 0 && Math.abs(caN - sumProduits) > caN * 0.1) {
      alerts.push({
        tab: tabKey, field: 'ca_total_n', level: 'error',
        message: `CA total (${formatXOF(caN)}) different de la somme des produits (${formatXOF(sumProduits)}). Ecart: ${formatXOF(Math.abs(caN - sumProduits))}.`,
        rule: 'ca_coherence'
      })
    }

    const coutsDirects = parseCurrency(data.couts_directs_n)
    const chargesFixes = parseCurrency(data.charges_fixes_n)
    const resultatExpl = parseCurrency(data.resultat_exploitation_n)
    if (caN && coutsDirects !== null && chargesFixes !== null && resultatExpl !== null) {
      const expected = caN - coutsDirects - chargesFixes
      if (Math.abs(resultatExpl - expected) > caN * 0.05) {
        alerts.push({
          tab: tabKey, field: 'resultat_exploitation_n', level: 'warning',
          message: `Resultat d'exploitation (${formatXOF(resultatExpl)}) incoherent avec CA - Couts (${formatXOF(expected)}).`,
          rule: 'resultat_coherence'
        })
      }
    }

    // Croissance check
    const caN1 = parseCurrency(data.ca_total_n1)
    if (caN && caN1 && caN1 > 0) {
      const growth = ((caN - caN1) / caN1) * 100
      if (growth > 200) {
        alerts.push({
          tab: tabKey, field: 'ca_total_n', level: 'warning',
          message: `Croissance CA de ${Math.round(growth)}% en 1 an. Justifiez cette hypercroissance.`,
          rule: 'growth_check'
        })
      }
      if (growth > 0) strengths.push(`Croissance CA positive de ${Math.round(growth)}% (N-1 → N).`)
    }

    // Marge brute check
    if (caN && coutsDirects !== null) {
      const margeBrute = ((caN - coutsDirects) / caN) * 100
      if (margeBrute > 80) {
        warnings.push(`Marge brute de ${Math.round(margeBrute)}% tres elevee. Verifiez les couts directs.`)
      } else if (margeBrute >= 30) {
        strengths.push(`Marge brute saine de ${Math.round(margeBrute)}%.`)
      } else if (margeBrute < 15) {
        warnings.push(`Marge brute faible (${Math.round(margeBrute)}%). Risque de rentabilite.`)
      }
    }
  }

  if (tabKey === 'produits_services') {
    try {
      const produits = JSON.parse(data.produits_json || '[]')
      if (Array.isArray(produits)) {
        for (const p of produits) {
          const marge = parseFloat(p.marge_pct)
          if (marge > 70) {
            alerts.push({
              tab: tabKey, field: `produit_${p.nom}`, level: 'warning',
              message: `"${p.nom}": marge de ${marge}% tres elevee. Des couts oublies ?`,
              rule: 'marge_check'
            })
          }
          if (p.prix_unitaire && p.cout_unitaire) {
            const expected = ((p.prix_unitaire - p.cout_unitaire) / p.prix_unitaire) * 100
            if (Math.abs(expected - marge) > 5) {
              alerts.push({
                tab: tabKey, field: `produit_${p.nom}`, level: 'error',
                message: `"${p.nom}": marge declaree (${marge}%) != marge calculee (${Math.round(expected)}%).`,
                rule: 'marge_coherence'
              })
            }
          }
        }
        if (produits.length >= 3) strengths.push(`${produits.length} produits/services : bonne diversification.`)
        if (produits.length === 1) warnings.push('Un seul produit : risque de dependance.')
      }
    } catch { /* ignore parse errors */ }
  }

  if (tabKey === 'ressources_humaines') {
    try {
      const equipe = JSON.parse(data.equipe_json || '[]')
      if (Array.isArray(equipe)) {
        let totalMasse = 0
        for (const p of equipe) {
          const salaire = parseCurrency(p.salaire_brut_mensuel) ?? 0
          const nombre = parseInt(p.nombre) || 1
          totalMasse += salaire * nombre * 12 * 1.25
        }
        if (totalMasse > 0) strengths.push(`Masse salariale annuelle chargee: ${formatXOF(totalMasse)}.`)
      }
    } catch { /* ignore */ }
  }

  if (tabKey === 'hypotheses_croissance') {
    const caAn1 = parseCurrency(data.ca_an1)
    const caAn5 = parseCurrency(data.ca_an5)
    if (caAn1 && caAn5 && caAn1 > 0) {
      const cagr = (Math.pow(caAn5 / caAn1, 1 / 4) - 1) * 100
      if (cagr > 50) {
        alerts.push({
          tab: tabKey, field: 'ca_an5', level: 'warning',
          message: `CAGR de ${Math.round(cagr)}% sur 5 ans. Justifiez cette trajectoire ambitieuse.`,
          rule: 'cagr_check'
        })
      } else if (cagr >= 15) {
        strengths.push(`CAGR de ${Math.round(cagr)}% : trajectoire ambitieuse mais realiste.`)
      }
    }

    const margeBrute = parseCurrency(data.marge_brute_cible)
    if (margeBrute && margeBrute > 70) {
      warnings.push(`Marge brute cible de ${margeBrute}% tres ambitieuse.`)
    }
  }

  if (tabKey === 'bfr_tresorerie') {
    const dso = parseCurrency(data.dso)
    if (dso !== null && dso > 60) {
      alerts.push({
        tab: tabKey, field: 'dso', level: 'error',
        message: `DSO de ${dso} jours : risque MAJEUR de tresorerie. Negociez des delais plus courts.`,
        rule: 'dso_critical'
      })
    } else if (dso !== null && dso > 45) {
      alerts.push({
        tab: tabKey, field: 'dso', level: 'warning',
        message: `DSO de ${dso} jours : attention au risque de tresorerie.`,
        rule: 'dso_warning'
      })
    }
    if (dso !== null && dso <= 30) strengths.push('DSO court (<=30j) : bonne gestion du poste clients.')
  }

  if (tabKey === 'couts_fixes_variables') {
    try {
      const fixes = JSON.parse(data.couts_fixes_json || '[]')
      if (Array.isArray(fixes)) {
        const categories = fixes.map((f: any) => (f.categorie || f.poste || '').toLowerCase())
        if (!categories.some((c: string) => /assurance/i.test(c))) {
          alerts.push({
            tab: tabKey, field: 'couts_fixes', level: 'warning',
            message: 'Aucune assurance detectee. Avez-vous une assurance professionnelle ?',
            rule: 'assurance_missing'
          })
        }
        if (!categories.some((c: string) => /maintenance|entretien/i.test(c))) {
          alerts.push({
            tab: tabKey, field: 'couts_fixes', level: 'info',
            message: 'Pas de budget maintenance. Prevoyez un budget pour l\'entretien des equipements.',
            rule: 'maintenance_missing'
          })
        }
      }
    } catch { /* ignore */ }
  }

  if (tabKey === 'investissements') {
    try {
      const investissements = JSON.parse(data.investissements_json || '[]')
      if (Array.isArray(investissements)) {
        for (const inv of investissements) {
          const duree = parseInt(inv.duree_amortissement)
          const montant = parseCurrency(inv.montant)
          if (duree && duree < 2 && montant && montant > 1000000) {
            alerts.push({
              tab: tabKey, field: `inv_${inv.description}`, level: 'warning',
              message: `"${inv.description}": amortissement de ${duree} an(s) pour ${formatXOF(montant)}. Duree realiste ?`,
              rule: 'amortissement_check'
            })
          }
        }
      }
    } catch { /* ignore */ }
  }

  const completeness = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0

  return {
    key: tabKey,
    label: info.label,
    completeness,
    filledFields,
    totalFields,
    alerts,
    strengths,
    warnings
  }
}

// ─── Main analysis function ───
export function analyzeInputs(allData: Record<InputTabKey, Record<string, any>>): InputsAnalysisResult {
  const tabs = INPUT_TAB_ORDER.map(key => scoreTab(key, allData[key] || {}))
  const allAlerts = tabs.flatMap(t => t.alerts)
  const overallCompleteness = Math.round(tabs.reduce((s, t) => s + t.completeness, 0) / tabs.length)

  // ─── Financial Ratios ───
  const hist = allData.donnees_historiques || {}
  const hyp = allData.hypotheses_croissance || {}
  const bfr = allData.bfr_tresorerie || {}
  const caN = parseCurrency(hist.ca_total_n)
  const coutsDirects = parseCurrency(hist.couts_directs_n)
  const chargesFixes = parseCurrency(hist.charges_fixes_n)
  const salaires = parseCurrency(hist.salaires_n)
  const resultatNet = parseCurrency(hist.resultat_net_n)
  const caAn1 = parseCurrency(hyp.ca_an1)
  const caAn5 = parseCurrency(hyp.ca_an5)

  const margeBrute = (caN && coutsDirects !== null) ? Math.round(((caN - coutsDirects) / caN) * 100) : null
  const margeOp = (caN && coutsDirects !== null && chargesFixes !== null) ? Math.round(((caN - coutsDirects - chargesFixes) / caN) * 100) : null
  const margeNette = (caN && resultatNet !== null) ? Math.round((resultatNet / caN) * 100) : null
  const chargesFixesSurCA = (caN && chargesFixes !== null) ? Math.round((chargesFixes / caN) * 100) : null
  const masseSalarialeSurCA = (caN && salaires !== null) ? Math.round((salaires / caN) * 100) : null
  const cagr5Ans = (caAn1 && caAn5 && caAn1 > 0) ? Math.round((Math.pow(caAn5 / caAn1, 0.25) - 1) * 100) : null

  const financialRatios: FinancialRatios = {
    margeBrute, margeOperationnelle: margeOp, margeNette,
    chargesFixesSurCA, masseSalarialeSurCA,
    dso: parseCurrency(bfr.dso), dpo: parseCurrency(bfr.dpo),
    stockJours: parseCurrency(bfr.stock_moyen), bfrSurCA: null,
    croissanceCA: null, cagr5Ans, detteSurEbitda: null
  }

  // ─── Coherence checks ───
  const coherenceIssues: string[] = []
  if (caN && caAn1 && caAn1 < caN * 0.5) {
    coherenceIssues.push('L\'objectif An 1 est inferieur a 50% du CA actuel. Regression prevue ?')
  }
  if (margeBrute !== null && parseCurrency(hyp.marge_brute_cible) !== null) {
    const cible = parseCurrency(hyp.marge_brute_cible)!
    if (Math.abs(margeBrute - cible) > 20) {
      coherenceIssues.push(`Marge brute actuelle (${margeBrute}%) tres differente de la cible (${cible}%).`)
    }
  }

  // ─── Recommendations ───
  const recommendations: string[] = []
  const errorCount = allAlerts.filter(a => a.level === 'error').length
  const warningCount = allAlerts.filter(a => a.level === 'warning').length

  if (errorCount > 0) recommendations.push(`Corrigez les ${errorCount} erreur(s) de coherence detectees.`)
  if (warningCount > 0) recommendations.push(`Verifiez les ${warningCount} alerte(s) IA.`)

  for (const tab of tabs) {
    if (tab.completeness < 50) {
      recommendations.push(`Completez l'onglet "${tab.label}" (${tab.completeness}% rempli).`)
    }
  }

  if (margeBrute !== null && margeBrute < 20) {
    recommendations.push('Marge brute faible : optimisez les couts directs ou revisez la tarification.')
  }
  if (financialRatios.dso !== null && financialRatios.dso > 45) {
    recommendations.push('Reduisez les delais clients pour ameliorer la tresorerie.')
  }

  // ─── Readiness Score ───
  let readinessScore = overallCompleteness
  if (errorCount > 0) readinessScore -= errorCount * 5
  if (warningCount > 0) readinessScore -= warningCount * 2
  readinessScore = Math.max(0, Math.min(100, readinessScore))

  let readinessLabel: string
  if (readinessScore >= 80) readinessLabel = 'Pret pour l\'analyse'
  else if (readinessScore >= 60) readinessLabel = 'Presque pret'
  else if (readinessScore >= 40) readinessLabel = 'A completer'
  else readinessLabel = 'Insuffisant'

  let verdict: string
  if (readinessScore >= 80) {
    verdict = 'Excellent : Les inputs financiers sont complets et coherents. Pret pour la modelisation 5 ans.'
  } else if (readinessScore >= 60) {
    verdict = 'Bien : La majorite des donnees sont presentes. Completez les champs manquants pour lancer l\'analyse.'
  } else if (readinessScore >= 40) {
    verdict = 'A completer : Plusieurs onglets sont incomplets. Finalisez la saisie avant de continuer.'
  } else {
    verdict = 'Insuffisant : Trop peu de donnees pour generer une analyse fiable. Completez les onglets obligatoires.'
  }

  return {
    tabs, overallCompleteness, financialRatios,
    alerts: allAlerts, coherenceIssues, recommendations,
    readinessScore, readinessLabel, verdict,
    timestamp: new Date().toISOString()
  }
}

// ─── HTML Diagnostic Generator ───
export function generateInputsDiagnosticHtml(
  analysis: InputsAnalysisResult,
  companyName: string,
  entrepreneurName: string
): string {
  const { tabs, overallCompleteness, financialRatios, alerts, coherenceIssues, recommendations, readinessScore, readinessLabel, verdict } = analysis

  const scoreColor = readinessScore >= 80 ? '#059669' : readinessScore >= 60 ? '#0284c7' : readinessScore >= 40 ? '#d97706' : '#dc2626'
  const errorAlerts = alerts.filter(a => a.level === 'error')
  const warningAlerts = alerts.filter(a => a.level === 'warning')

  const tabRows = tabs.map(t => {
    const barColor = t.completeness >= 80 ? '#059669' : t.completeness >= 60 ? '#0284c7' : t.completeness >= 40 ? '#d97706' : '#dc2626'
    const alertBadge = t.alerts.filter(a => a.level === 'error').length > 0
      ? `<span style="background:#fee2e2;color:#991b1b;font-size:11px;padding:2px 8px;border-radius:12px;font-weight:600;">${t.alerts.filter(a => a.level === 'error').length} erreur(s)</span>`
      : t.alerts.filter(a => a.level === 'warning').length > 0
        ? `<span style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 8px;border-radius:12px;font-weight:600;">${t.alerts.filter(a => a.level === 'warning').length} alerte(s)</span>`
        : `<span style="background:#dcfce7;color:#166534;font-size:11px;padding:2px 8px;border-radius:12px;font-weight:600;">OK</span>`

    return `<div style="padding:10px;border-radius:8px;border:1px solid rgba(0,0,0,0.08);margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:600;font-size:13px;">${t.label}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          ${alertBadge}
          <span style="font-weight:700;color:${barColor};">${t.completeness}%</span>
        </div>
      </div>
      <div style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${t.completeness}%;background:${barColor};border-radius:3px;"></div>
      </div>
    </div>`
  }).join('')

  const ratioItems = [
    { label: 'Marge brute', value: financialRatios.margeBrute !== null ? `${financialRatios.margeBrute}%` : '-', benchmark: '>30%' },
    { label: 'Marge operationnelle', value: financialRatios.margeOperationnelle !== null ? `${financialRatios.margeOperationnelle}%` : '-', benchmark: '>15%' },
    { label: 'Marge nette', value: financialRatios.margeNette !== null ? `${financialRatios.margeNette}%` : '-', benchmark: '>10%' },
    { label: 'Charges fixes / CA', value: financialRatios.chargesFixesSurCA !== null ? `${financialRatios.chargesFixesSurCA}%` : '-', benchmark: '<50%' },
    { label: 'DSO (jours)', value: financialRatios.dso !== null ? `${financialRatios.dso}j` : '-', benchmark: '<45j' },
    { label: 'CAGR 5 ans', value: financialRatios.cagr5Ans !== null ? `${financialRatios.cagr5Ans}%` : '-', benchmark: '15-30%' }
  ].map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
    <span style="color:#475569;">${r.label}</span>
    <span style="font-weight:700;">${r.value} <span style="color:#94a3b8;font-weight:400;font-size:11px;">(bench: ${r.benchmark})</span></span>
  </div>`).join('')

  const alertsHtml = [...errorAlerts.map(a => `<div style="padding:8px;border-radius:6px;background:#fee2e2;border-left:3px solid #dc2626;margin-bottom:4px;font-size:12px;">
    <span style="color:#991b1b;font-weight:600;">&#9888; ${a.message}</span>
  </div>`), ...warningAlerts.slice(0, 5).map(a => `<div style="padding:8px;border-radius:6px;background:#fef3c7;border-left:3px solid #d97706;margin-bottom:4px;font-size:12px;">
    <span style="color:#92400e;">&#9888; ${a.message}</span>
  </div>`)].join('')

  const recoHtml = recommendations.slice(0, 8).map((r, i) => `<li style="margin-bottom:6px;font-size:13px;">${r}</li>`).join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagnostic Inputs Financiers - ${companyName}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter','IBM Plex Sans',system-ui,sans-serif; background:#f8fafc; color:#1e293b; line-height:1.6; }
    .container { max-width:900px; margin:0 auto; padding:32px 24px; }
    .header { text-align:center; margin-bottom:32px; }
    .header h1 { font-size:26px; color:#1e3a5f; margin-bottom:8px; }
    .header p { color:#64748b; font-size:14px; }
    .card { background:white; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
    .card h2 { font-size:17px; color:#1e3a5f; margin-bottom:14px; display:flex; align-items:center; gap:8px; }
    .score-hero { display:flex; align-items:center; gap:24px; }
    .score-circle { width:110px; height:110px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-size:28px; font-weight:800; }
    .score-circle small { font-size:12px; font-weight:400; opacity:0.9; }
    @media print { body { background:white; } .card { box-shadow:none; border:1px solid #e5e7eb; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>&#128202; Diagnostic Inputs Financiers</h1>
      <p>${entrepreneurName} &middot; ${companyName} &middot; ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>

    <div class="card">
      <div class="score-hero">
        <div class="score-circle" style="background:${scoreColor};">
          ${readinessScore}%
          <small>Pret</small>
        </div>
        <div style="flex:1;">
          <h2 style="margin-bottom:8px;">Score de Readiness</h2>
          <div style="padding:12px;border-radius:8px;background:${scoreColor}10;border-left:4px solid ${scoreColor};color:${scoreColor};font-size:14px;">
            ${verdict}
          </div>
          <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;">
            <span style="font-size:12px;padding:4px 10px;border-radius:20px;background:#e0e7ff;color:#3730a3;font-weight:600;">Completude: ${overallCompleteness}%</span>
            <span style="font-size:12px;padding:4px 10px;border-radius:20px;background:${errorAlerts.length > 0 ? '#fee2e2' : '#dcfce7'};color:${errorAlerts.length > 0 ? '#991b1b' : '#166534'};font-weight:600;">Erreurs: ${errorAlerts.length}</span>
            <span style="font-size:12px;padding:4px 10px;border-radius:20px;background:${warningAlerts.length > 0 ? '#fef3c7' : '#dcfce7'};color:${warningAlerts.length > 0 ? '#92400e' : '#166534'};font-weight:600;">Alertes: ${warningAlerts.length}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>&#128196; Completude par onglet</h2>
      ${tabRows}
    </div>

    <div class="card">
      <h2>&#128200; Ratios Financiers Cles</h2>
      <p style="font-size:13px;color:#64748b;margin-bottom:12px;">Calcules a partir de vos donnees historiques et hypotheses.</p>
      ${ratioItems}
    </div>

    ${alertsHtml ? `<div class="card">
      <h2 style="color:#dc2626;">&#9888; Alertes & Incoherences</h2>
      ${alertsHtml}
    </div>` : ''}

    ${coherenceIssues.length > 0 ? `<div class="card">
      <h2>&#128279; Problemes de coherence</h2>
      ${coherenceIssues.map(i => `<div style="font-size:13px;color:#d97706;margin-bottom:6px;">&#9888; ${i}</div>`).join('')}
    </div>` : ''}

    <div class="card">
      <h2>&#128161; Recommandations</h2>
      <ol style="padding-left:20px;">${recoHtml}</ol>
    </div>

    <div style="text-align:center;padding:24px;color:#94a3b8;font-size:12px;">
      Genere par ESONO Investment Readiness &middot; Module 3 Inputs &middot; ${new Date().toISOString().slice(0, 10)}
    </div>
  </div>
</body>
</html>`
}

// ─── Helpers ───
function formatXOF(amount: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(amount)) + ' XOF'
}

export function getInputsReadinessLabel(score: number): { label: string, color: string } {
  if (score >= 80) return { label: 'Pret', color: 'green' }
  if (score >= 60) return { label: 'Presque pret', color: 'blue' }
  if (score >= 40) return { label: 'A completer', color: 'yellow' }
  return { label: 'Insuffisant', color: 'red' }
}
