// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC REPORT GENERATOR
// Provides:
//   1) generateDeterministicDiagnostic() — fallback engine (no Claude)
//   2) generateDiagnosticReportHtml() — HTML report from Claude JSON
// Both work with the Claude-format JSON structure defined in the
// system prompt of POST /api/diagnostic/generate
// ═══════════════════════════════════════════════════════════════

// ─── Helpers ───

function esc(s: any): string {
  if (s === null || s === undefined) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtNum(n: number): string {
  if (isNaN(n) || n === 0) return '—'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + ' Md'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + ' M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + ' k'
  return n.toFixed(0)
}

function scoreColor(score: number): string {
  if (score >= 86) return '#059669'
  if (score >= 71) return '#16a34a'
  if (score >= 51) return '#d97706'
  if (score >= 31) return '#ea580c'
  return '#dc2626'
}

function scoreBg(score: number): string {
  if (score >= 86) return '#ecfdf5'
  if (score >= 71) return '#f0fdf4'
  if (score >= 51) return '#fffbeb'
  if (score >= 31) return '#fff7ed'
  return '#fef2f2'
}

function palierLabel(palier: string): string {
  const labels: Record<string, string> = {
    'en_construction': 'En Construction',
    'a_renforcer': 'À Renforcer',
    'moyen': 'Moyen',
    'bon': 'Bon',
    'excellent': 'Excellent'
  }
  return labels[palier] || palier
}

function niveauColor(niveau: string): string {
  switch (niveau?.toLowerCase()) {
    case 'eleve': case 'élevé': case 'critique': return '#dc2626'
    case 'moyen': case 'moyenne': return '#d97706'
    case 'faible': return '#059669'
    default: return '#6b7280'
  }
}

function niveauBg(niveau: string): string {
  switch (niveau?.toLowerCase()) {
    case 'eleve': case 'élevé': case 'critique': return '#fef2f2'
    case 'moyen': case 'moyenne': return '#fffbeb'
    case 'faible': return '#f0fdf4'
    default: return '#f8fafc'
  }
}

// ═══════════════════════════════════════════════════════════════
// 1) DETERMINISTIC DIAGNOSTIC ENGINE (fallback sans Claude)
// Produces the EXACT same JSON format as the Claude system prompt
// ═══════════════════════════════════════════════════════════════

export function generateDeterministicDiagnostic(
  allDeliverables: Record<string, any>,
  sources: Record<string, boolean>,
  fiscal: any,
  sector: string,
  zone: string,
  kbContext: any,
  kbUsed: boolean
): any {

  const bmc = allDeliverables.bmc_analysis || {}
  const sic = allDeliverables.sic_analysis || {}
  const fw = allDeliverables.framework_analysis || {}
  const pme = allDeliverables.framework_pme_data || {}
  const ovo = allDeliverables.plan_ovo || {}
  const bp = allDeliverables.business_plan || {}
  const odd = allDeliverables.odd_analysis || {}

  // ── Extract key financial metrics ──
  const hist = pme.historique || {}
  const caArray = hist.caTotal || hist.ca_total || []
  const currentCA = caArray.length > 0 ? caArray[caArray.length - 1] : 0
  const charges = pme.charges || {}
  const chargesFixes = charges.totalChargesFixes || charges.total_charges_fixes || 0
  const masseSalariale = charges.masseSalariale || charges.masse_salariale || 0
  const coutMat = (hist.coutMatieres || hist.cout_matieres || [])
  const coutDirects = coutMat.length > 0 ? coutMat[coutMat.length - 1] : 0

  const margeBrute = currentCA > 0 ? ((currentCA - coutDirects) / currentCA * 100) : 0
  const ebitda = currentCA - coutDirects - chargesFixes
  const ebitdaMargin = currentCA > 0 ? (ebitda / currentCA * 100) : 0
  const fixedCostRatio = currentCA > 0 ? (chargesFixes / currentCA * 100) : 0
  const salaryRatio = currentCA > 0 ? (masseSalariale / currentCA * 100) : 0
  const margeNette = ebitdaMargin * 0.7 // estimation simplifiée
  const bfrRatio = pme.bfr?.bfrJoursCA || pme.bfr?.bfr_jours_ca || 0
  const effectif = (pme.rh || {}).effectif || 0

  const hasBmc = sources.bmc
  const hasSic = sources.sic
  const hasFramework = sources.framework || sources.framework_pme_data
  const hasOvo = sources.plan_ovo
  const hasBp = sources.business_plan
  const hasOdd = sources.odd
  const hasFinance = currentCA > 0

  // BMC score
  const bmcScore = bmc.score || bmc.scoreGlobal || 0
  const bmcBlocks = bmc.blocks || bmc.blocs || []

  // SIC score
  const sicScore = sic.score || sic.scoreGlobal || 0

  // ═══ Dimension 1: COHÉRENCE FINANCIÈRE (poids 25%) ═══
  let coherenceScore = 30
  const incoherences: any[] = []
  
  if (hasBmc && hasFramework) {
    coherenceScore += 15
    // Check BMC CA vs Framework CA
    const bmcCA = bmc.ca || bmc.chiffre_affaires || 0
    if (bmcCA > 0 && currentCA > 0 && Math.abs(bmcCA - currentCA) / currentCA > 0.3) {
      incoherences.push({
        type: 'BMC ↔ Framework',
        champ: 'Chiffre d\'affaires',
        valeur_source1: `${fmtNum(bmcCA)} FCFA (BMC)`,
        valeur_source2: `${fmtNum(currentCA)} FCFA (Framework)`,
        ecart: `${((Math.abs(bmcCA - currentCA) / currentCA) * 100).toFixed(0)}%`,
        explication: 'Un écart significatif entre le CA du BMC et le CA historique du Framework suggère des hypothèses différentes.'
      })
      coherenceScore -= 10
    }
    // Check effectif coherence
    if (effectif > 0 && salaryRatio > 50) {
      incoherences.push({
        type: 'Données internes',
        champ: 'Masse salariale vs effectif',
        valeur_source1: `${effectif} employés`,
        valeur_source2: `${salaryRatio.toFixed(0)}% du CA`,
        ecart: `Ratio anormalement élevé`,
        explication: 'La masse salariale semble disproportionnée par rapport à l\'effectif déclaré et au CA.'
      })
      coherenceScore -= 8
    }
  } else {
    if (!hasBmc) coherenceScore -= 15
    if (!hasFramework) coherenceScore -= 15
  }
  
  if (hasOvo && hasFramework) coherenceScore += 10
  if (hasSic && hasBmc) coherenceScore += 5
  coherenceScore = Math.max(5, Math.min(95, coherenceScore))

  // ═══ Dimension 2: VIABILITÉ ÉCONOMIQUE (poids 25%) ═══
  let viabiliteScore = 25
  let seuilRentaMois: number | null = null
  let dscr: number | null = null
  let cashFlowPositifMois: number | null = null

  if (hasFinance) {
    if (margeBrute >= 40) viabiliteScore += 15
    else if (margeBrute >= 25) viabiliteScore += 8
    if (ebitdaMargin > 10) viabiliteScore += 15
    else if (ebitdaMargin > 0) viabiliteScore += 8
    else viabiliteScore -= 5
    if (fixedCostRatio < 60) viabiliteScore += 10
    else if (fixedCostRatio < 80) viabiliteScore += 5
    
    // Seuil de rentabilité estimate
    if (margeBrute > 0 && chargesFixes > 0) {
      seuilRentaMois = Math.round(chargesFixes / (currentCA * margeBrute / 100 / 12))
    }
    // DSCR estimate (simplified)
    if (ebitda > 0) {
      const debtService = pme.financement?.annuiteTotal || (currentCA * 0.08)
      dscr = debtService > 0 ? parseFloat((ebitda / debtService).toFixed(2)) : null
      if (dscr && dscr > 1.25) viabiliteScore += 5
    }
    cashFlowPositifMois = ebitdaMargin > 0 ? 1 : null
  }
  viabiliteScore = Math.max(5, Math.min(95, viabiliteScore))

  // ═══ Dimension 3: RÉALISME DES PROJECTIONS (poids 20%) ═══
  let realismeScore = 35
  const redFlags: string[] = []
  const hyp = pme.hypotheses || {}
  const croissance = hyp.croissanceCA || hyp.croissance_ca || []

  if (croissance.length > 0) {
    realismeScore += 10
    const maxCroissance = Math.max(...croissance.map((c: any) => typeof c === 'number' ? c : 0))
    if (maxCroissance > 50) {
      redFlags.push(`Croissance de ${maxCroissance}% projetée — potentiellement optimiste pour le secteur ${sector}`)
      realismeScore -= 10
    } else if (maxCroissance > 30) {
      redFlags.push(`Croissance de ${maxCroissance}% — ambitieuse, nécessite justification détaillée`)
      realismeScore -= 5
    } else {
      realismeScore += 10
    }
  } else {
    redFlags.push('Aucune hypothèse de croissance formalisée')
  }

  if (hasFramework && margeBrute > 0) realismeScore += 10
  if (hasOvo) realismeScore += 10
  if (hasBp) realismeScore += 5
  
  if (ebitdaMargin < 0 && croissance.some((c: number) => c > 20)) {
    redFlags.push('EBITDA négatif mais croissance optimiste projetée — incohérence')
    realismeScore -= 5
  }
  realismeScore = Math.max(5, Math.min(95, realismeScore))

  // ═══ Dimension 4: COMPLÉTUDE DES COÛTS (poids 15%) ═══
  let completudeScore = 20
  const postesManquants: string[] = []
  const postesPresents: string[] = []

  if (hasFinance) {
    if (chargesFixes > 0) { postesPresents.push('Charges fixes'); completudeScore += 10 }
    else postesManquants.push('Charges fixes')
    
    if (masseSalariale > 0) { postesPresents.push('Masse salariale'); completudeScore += 10 }
    else postesManquants.push('Masse salariale (charges sociales ' + Math.round(fiscal.socialChargesRate * 100) + '%)')

    if (coutDirects > 0) { postesPresents.push('Coûts matières / directs'); completudeScore += 8 }
    else postesManquants.push('Coûts directs / matières premières')

    if (bfrRatio > 0) { postesPresents.push('BFR'); completudeScore += 7 }
    else postesManquants.push('BFR (Besoin en fonds de roulement)')

    if (pme.investissements?.totalCapex || pme.investissements?.total_capex) {
      postesPresents.push('CAPEX / Investissements')
      completudeScore += 7
    } else {
      postesManquants.push('CAPEX / Plan d\'investissements')
    }

    if (pme.financement) { postesPresents.push('Plan de financement'); completudeScore += 8 }
    else postesManquants.push('Plan de financement')
  } else {
    postesManquants.push('TVA (' + Math.round(fiscal.vat * 100) + '%)', 'IS (' + Math.round(fiscal.corporateTax * 100) + '%)', 'Charges sociales (' + Math.round(fiscal.socialChargesRate * 100) + '%)', 'BFR', 'CAPEX')
  }
  completudeScore = Math.max(5, Math.min(95, completudeScore))

  // ═══ Dimension 5: CAPACITÉ DE REMBOURSEMENT (poids 15%) ═══
  let capaciteScore = 20
  let tauxEndettement: number | null = null
  let dureeRemb: number | null = null

  if (hasFinance && ebitda > 0) {
    capaciteScore += 15
    if (dscr && dscr > 1.25) { capaciteScore += 15; }
    else if (dscr && dscr > 1) capaciteScore += 8
    
    // Taux endettement estimate
    const dette = pme.financement?.detteTotal || pme.financement?.dette_total || 0
    if (dette > 0 && currentCA > 0) {
      tauxEndettement = parseFloat((dette / currentCA * 100).toFixed(1))
      if (tauxEndettement < 60) capaciteScore += 10
      else if (tauxEndettement < 80) capaciteScore += 5
    }
    
    // Durée de remboursement
    dureeRemb = pme.financement?.dureeRemboursement || pme.financement?.duree_remboursement || null
    if (dureeRemb && dureeRemb <= 5) capaciteScore += 5
  } else if (ebitda <= 0 && hasFinance) {
    capaciteScore = 10
  }
  
  if (hasOvo) capaciteScore += 10
  capaciteScore = Math.max(5, Math.min(95, capaciteScore))

  // ═══ SCORE GLOBAL ═══
  const scoreGlobal = Math.round(
    coherenceScore * 0.25 +
    viabiliteScore * 0.25 +
    realismeScore * 0.20 +
    completudeScore * 0.15 +
    capaciteScore * 0.15
  )

  // Palier
  let palier: string
  let couleur: string
  if (scoreGlobal <= 30) { palier = 'en_construction'; couleur = '⬜' }
  else if (scoreGlobal <= 50) { palier = 'a_renforcer'; couleur = '🟠' }
  else if (scoreGlobal <= 70) { palier = 'moyen'; couleur = '🟡' }
  else if (scoreGlobal <= 85) { palier = 'bon'; couleur = '🟢' }
  else { palier = 'excellent'; couleur = '🌟' }

  // ═══ POINTS DE VIGILANCE ═══
  const points_vigilance: any[] = []
  
  if (ebitdaMargin < 0) {
    points_vigilance.push({
      categorie: 'financier', niveau: 'eleve', probabilite: 'certaine',
      titre: 'Rentabilité opérationnelle à restaurer',
      description: `L'EBITDA est actuellement négatif (${ebitdaMargin.toFixed(1)}%). C'est un point d'attention prioritaire pour la viabilité.`,
      impact_financier: `Perte opérationnelle de ${fmtNum(Math.abs(ebitda))} FCFA`,
      action_recommandee: 'Nous recommandons de travailler ensemble sur l\'optimisation des charges fixes pour atteindre un EBITDA positif.'
    })
  }
  
  if (fixedCostRatio > 65) {
    points_vigilance.push({
      categorie: 'financier', niveau: fixedCostRatio > 80 ? 'eleve' : 'moyen', probabilite: 'élevée',
      titre: 'Structure de coûts à optimiser',
      description: `Les charges fixes représentent ${fixedCostRatio.toFixed(0)}% du CA. La fourchette recommandée est inférieure à 60%.`,
      impact_financier: `Surcoût de ${fmtNum(chargesFixes - currentCA * 0.55)} FCFA par rapport au benchmark`,
      action_recommandee: 'Identifions ensemble les postes de charges fixes qui peuvent être optimisés ou variabilisés.'
    })
  }
  
  if (!hasBmc || !hasSic) {
    points_vigilance.push({
      categorie: 'strategique', niveau: 'moyen', probabilite: 'élevée',
      titre: 'Documentation stratégique à compléter',
      description: `${!hasBmc ? 'Le BMC' : ''}${!hasBmc && !hasSic ? ' et ' : ''}${!hasSic ? 'le SIC' : ''} manque(nt). Ces documents sont essentiels pour les investisseurs.`,
      impact_financier: 'Accès limité aux financements structurés',
      action_recommandee: 'Prenez le temps de compléter ces livrables fondamentaux — c\'est un investissement dans la crédibilité de votre projet.'
    })
  }

  if (salaryRatio > 40) {
    points_vigilance.push({
      categorie: 'operationnel', niveau: 'moyen', probabilite: 'moyenne',
      titre: 'Optimisation des ressources humaines',
      description: `La masse salariale représente ${salaryRatio.toFixed(0)}% du CA (benchmark: 30-40%).`,
      impact_financier: `${fmtNum(masseSalariale - currentCA * 0.35)} FCFA d'optimisation potentielle`,
      action_recommandee: 'Analysons ensemble la productivité par poste pour identifier les leviers d\'amélioration.'
    })
  }

  // Ensure minimum 2 points_vigilance
  if (points_vigilance.length < 2) {
    points_vigilance.push({
      categorie: 'operationnel', niveau: 'faible', probabilite: 'moyenne',
      titre: 'Suivi de trésorerie à formaliser',
      description: 'Un tableau de bord de trésorerie prévisionnelle est recommandé pour anticiper les besoins.',
      impact_financier: 'Prévention des tensions de trésorerie',
      action_recommandee: 'Mettre en place un suivi hebdomadaire de la trésorerie avec des projections à 3 mois.'
    })
  }
  if (points_vigilance.length < 2) {
    points_vigilance.push({
      categorie: 'esg', niveau: 'faible', probabilite: 'faible',
      titre: 'Conformité réglementaire',
      description: 'Vérifier la conformité aux normes fiscales et sociales en vigueur.',
      impact_financier: 'Éviter les pénalités fiscales',
      action_recommandee: 'Faire un audit de conformité avec un expert-comptable agréé.'
    })
  }

  // ═══ FORCES ═══
  const forces: any[] = []
  if (hasBmc && bmcScore >= 50) forces.push({ titre: 'Modèle économique structuré', justification: `Le BMC est bien rempli (score ${bmcScore}/100), démontrant une réflexion approfondie sur le modèle d'affaires.` })
  if (hasSic && sicScore >= 50) forces.push({ titre: 'Impact social formalisé', justification: `Le SIC montre un engagement clair pour l'impact social (score ${sicScore}/100). C'est un atout majeur pour les investisseurs à impact.` })
  if (margeBrute >= 35) forces.push({ titre: 'Marge brute attractive', justification: `Une marge brute de ${margeBrute.toFixed(1)}% est un indicateur positif de la viabilité du modèle économique.` })
  if (ebitdaMargin > 5) forces.push({ titre: 'Rentabilité opérationnelle', justification: `L'EBITDA de ${ebitdaMargin.toFixed(1)}% montre que l'activité génère des profits opérationnels.` })
  if (hasOvo) forces.push({ titre: 'Plan financier OVO complet', justification: 'Le plan financier sur 5 ans démontre une vision à long terme et facilite les discussions avec les bailleurs.' })
  if (Object.values(sources).filter(Boolean).length >= 4) forces.push({ titre: 'Démarche structurée', justification: `${Object.values(sources).filter(Boolean).length} livrables complétés, démontrant un engagement sérieux dans la préparation investisseur.` })
  forces.push({ titre: 'Utilisation de la plateforme ESANO', justification: 'L\'entrepreneur utilise des outils professionnels pour structurer son dossier, ce qui renforce sa crédibilité.' })
  if (forces.length < 3) forces.push({ titre: 'Potentiel de croissance identifié', justification: `Le secteur ${sector} en ${fiscal.country} offre des opportunités de développement significatives.` })

  // ═══ OPPORTUNITÉS D'AMÉLIORATION ═══
  const opportunites: any[] = []
  if (!hasBmc) opportunites.push({ titre: 'Compléter le Business Model Canvas', justification: 'Le BMC est la pièce maîtresse du dossier investisseur. Sans lui, le modèle économique reste opaque.', priorite: 'haute' })
  if (!hasSic) opportunites.push({ titre: 'Formaliser l\'impact social (SIC)', justification: 'Les investisseurs à impact exigent une mesure formelle de l\'impact. Le SIC ouvre l\'accès à ces financements.', priorite: 'haute' })
  if (ebitdaMargin < 5) opportunites.push({ titre: 'Améliorer la rentabilité opérationnelle', justification: `Un EBITDA de ${ebitdaMargin.toFixed(1)}% est insuffisant pour rassurer les investisseurs.`, priorite: 'haute' })
  if (salaryRatio > 40) opportunites.push({ titre: 'Optimiser la masse salariale', justification: `À ${salaryRatio.toFixed(0)}% du CA, la masse salariale pèse sur la rentabilité.`, priorite: 'moyenne' })
  if (!hasOvo) opportunites.push({ titre: 'Produire le Plan Financier OVO', justification: 'Le plan financier 5 ans est indispensable pour les discussions avec les bailleurs de fonds.', priorite: 'haute' })
  if (postesManquants.length > 2) opportunites.push({ titre: 'Compléter les données de coûts', justification: `${postesManquants.length} postes de coûts manquent, ce qui affecte la fiabilité des projections.`, priorite: 'moyenne' })

  // ═══ RECOMMANDATIONS (5-7) ═══
  const recommandations: any[] = []
  let prio = 1

  if (ebitdaMargin < 0) {
    recommandations.push({
      priorite: prio++,
      titre: 'Restaurer la rentabilité opérationnelle',
      detail: `Réduire les charges fixes de ${fmtNum(chargesFixes)} à environ ${fmtNum(currentCA * 0.55)} FCFA pour atteindre un EBITDA positif.`,
      impact_viabilite: 'Critique — condition sine qua non pour tout financement',
      urgence: 'Immédiat (0-3 mois)',
      action_concrete: 'Identifier les 3 postes de charges fixes les plus élevés et négocier une réduction de 15-20%.',
      message_encourageant: 'C\'est le levier le plus puissant pour transformer votre entreprise. Chaque effort compte !'
    })
  }

  if (!hasBmc) {
    recommandations.push({
      priorite: prio++,
      titre: 'Finaliser le Business Model Canvas',
      detail: 'Remplir les 9 blocs du BMC avec des données quantifiées et cohérentes avec le Framework.',
      impact_viabilite: 'Élevé — document fondamental pour tout investisseur',
      urgence: 'Court terme (0-1 mois)',
      action_concrete: 'Retourner sur le module BMC et compléter chaque bloc avec des réponses détaillées.',
      message_encourageant: 'Le BMC est votre carte de visite stratégique. Vous avez déjà les connaissances, il suffit de les formaliser !'
    })
  }

  if (!hasSic) {
    recommandations.push({
      priorite: prio++,
      titre: 'Produire le Social Impact Canvas',
      detail: 'Formaliser l\'impact social avec des indicateurs SMART et le mapping ODD.',
      impact_viabilite: 'Élevé — accès aux investisseurs à impact',
      urgence: 'Court terme (1-2 mois)',
      action_concrete: 'Compléter les 15 sections du SIC en quantifiant les bénéficiaires et les résultats attendus.',
      message_encourageant: 'Votre impact social est réel — le SIC va le rendre visible et mesurable pour les partenaires !'
    })
  }

  if (salaryRatio > 40) {
    recommandations.push({
      priorite: prio++,
      titre: 'Optimiser la structure RH',
      detail: `Ramener la masse salariale de ${salaryRatio.toFixed(0)}% à 35% du CA, soit ${fmtNum(currentCA * 0.35)} FCFA.`,
      impact_viabilite: `Économie potentielle de ${fmtNum(masseSalariale - currentCA * 0.35)} FCFA/an`,
      urgence: 'Moyen terme (3-6 mois)',
      action_concrete: 'Réaliser un audit des postes et de la productivité. Identifier les optimisations possibles.',
      message_encourageant: 'Optimiser ne signifie pas réduire l\'équipe — c\'est mieux utiliser les talents existants !'
    })
  }

  if (!hasOvo) {
    recommandations.push({
      priorite: prio++,
      titre: 'Générer le Plan Financier OVO',
      detail: 'Produire les projections financières sur 5 ans au format OVO pour les bailleurs.',
      impact_viabilite: 'Élevé — outil de négociation indispensable',
      urgence: 'Court terme (1-2 mois)',
      action_concrete: 'Lancer la génération automatique du Plan OVO depuis le tableau de bord.',
      message_encourageant: 'Le Plan OVO est généré automatiquement à partir de vos données — une étape rapide avec un impact énorme !'
    })
  }

  // Fill to minimum 5 recommendations
  if (recommandations.length < 5) {
    recommandations.push({
      priorite: prio++,
      titre: 'Mettre en place le contrôle de gestion',
      detail: 'Dashboard mensuel avec KPIs financiers et opérationnels clés.',
      impact_viabilite: 'Moyen — pilotage en temps réel de l\'activité',
      urgence: 'Moyen terme (3-6 mois)',
      action_concrete: 'Créer un tableau de bord Excel/Google Sheets avec suivi CA, charges, trésorerie, effectifs.',
      message_encourageant: 'Un bon pilotage est la marque des entreprises qui réussissent. Vous êtes sur la bonne voie !'
    })
  }
  if (recommandations.length < 5) {
    recommandations.push({
      priorite: prio++,
      titre: 'Formaliser la gouvernance',
      detail: 'Organigramme, CV des dirigeants, composition du comité consultatif.',
      impact_viabilite: 'Moyen — crédibilité renforcée auprès des investisseurs',
      urgence: 'Moyen terme (3-6 mois)',
      action_concrete: 'Préparer un organigramme et les CV des dirigeants clés.',
      message_encourageant: 'Les investisseurs investissent dans les personnes autant que dans les projets. Montrez la force de votre équipe !'
    })
  }
  if (recommandations.length < 5) {
    recommandations.push({
      priorite: prio++,
      titre: 'Diversifier les sources de financement',
      detail: 'Explorer les différentes options : OVO, banques, fonds d\'impact, subventions.',
      impact_viabilite: 'Moyen — réduction de la dépendance à une source unique',
      urgence: 'Long terme (6-12 mois)',
      action_concrete: 'Préparer un dossier de présentation adapté à chaque type de bailleur.',
      message_encourageant: 'Avec un dossier bien structuré, de nombreuses portes s\'ouvriront !'
    })
  }
  if (recommandations.length < 5) {
    recommandations.push({
      priorite: prio++,
      titre: 'Renforcer la documentation des processus',
      detail: 'Formaliser les processus clés (production, vente, RH) pour démontrer la maturité organisationnelle.',
      impact_viabilite: 'Moyen — structuration de l\'entreprise',
      urgence: 'Moyen terme (3-6 mois)',
      action_concrete: 'Créer un document décrivant les 5 processus principaux avec les responsabilités associées.',
      message_encourageant: 'Une entreprise bien documentée inspire confiance et facilite la croissance !'
    })
  }
  if (recommandations.length < 5) {
    recommandations.push({
      priorite: prio++,
      titre: 'Développer une stratégie de gestion des risques',
      detail: 'Identifier, évaluer et planifier des mesures de mitigation pour les principaux risques.',
      impact_viabilite: 'Élevé — anticipation et résilience',
      urgence: 'Court terme (1-3 mois)',
      action_concrete: 'Établir une matrice des risques avec probabilité, impact et plan d\'action pour chaque risque.',
      message_encourageant: 'Anticiper les risques, c\'est préparer le succès. Bravo pour cette approche proactive !'
    })
  }

  // ═══ BENCHMARKS SECTORIELS ═══
  const benchmarks = {
    marge_brute: {
      entreprise: hasFinance ? parseFloat(margeBrute.toFixed(1)) : null,
      secteur_min: Math.round(fiscal.sectorBenchmarks.grossMarginRange[0] * 100),
      secteur_max: Math.round(fiscal.sectorBenchmarks.grossMarginRange[1] * 100),
      verdict: hasFinance ? (margeBrute >= fiscal.sectorBenchmarks.grossMarginRange[0] * 100 ? 'Dans la norme' : 'En dessous du benchmark') : 'Non disponible',
      ecart: hasFinance ? `${(margeBrute - fiscal.sectorBenchmarks.grossMarginRange[0] * 100).toFixed(1)} pp vs minimum` : 'N/A'
    },
    marge_ebitda: {
      entreprise: hasFinance ? parseFloat(ebitdaMargin.toFixed(1)) : null,
      secteur_min: Math.round(fiscal.sectorBenchmarks.ebitdaMarginRange[0] * 100),
      secteur_max: Math.round(fiscal.sectorBenchmarks.ebitdaMarginRange[1] * 100),
      verdict: hasFinance ? (ebitdaMargin >= fiscal.sectorBenchmarks.ebitdaMarginRange[0] * 100 ? 'Dans la norme' : 'En dessous') : 'Non disponible',
      ecart: hasFinance ? `${(ebitdaMargin - fiscal.sectorBenchmarks.ebitdaMarginRange[0] * 100).toFixed(1)} pp vs minimum` : 'N/A'
    },
    marge_nette: {
      entreprise: hasFinance ? parseFloat(margeNette.toFixed(1)) : null,
      secteur_min: Math.round(fiscal.sectorBenchmarks.netMarginRange[0] * 100),
      secteur_max: Math.round(fiscal.sectorBenchmarks.netMarginRange[1] * 100),
      verdict: hasFinance ? (margeNette >= fiscal.sectorBenchmarks.netMarginRange[0] * 100 ? 'Dans la norme' : 'En dessous') : 'Non disponible',
      ecart: hasFinance ? `${(margeNette - fiscal.sectorBenchmarks.netMarginRange[0] * 100).toFixed(1)} pp vs minimum` : 'N/A'
    },
    ratio_endettement: {
      entreprise: null as number | null,
      secteur_min: 0,
      secteur_max: Math.round(fiscal.sectorBenchmarks.debtRatioMax * 100),
      verdict: 'Données insuffisantes',
      ecart: 'N/A'
    },
    seuil_rentabilite: {
      entreprise: seuilRentaMois,
      secteur_min: fiscal.sectorBenchmarks.breakEvenMonths[0],
      secteur_max: fiscal.sectorBenchmarks.breakEvenMonths[1],
      verdict: seuilRentaMois ? (seuilRentaMois <= fiscal.sectorBenchmarks.breakEvenMonths[1] ? 'Dans la norme' : 'Au-delà du benchmark') : 'Non calculable',
      ecart: seuilRentaMois ? `${seuilRentaMois} mois vs ${fiscal.sectorBenchmarks.breakEvenMonths[0]}-${fiscal.sectorBenchmarks.breakEvenMonths[1]} mois` : 'N/A'
    }
  }

  // ═══ RÉSUMÉ EXÉCUTIF ═══
  const livrablesList = Object.entries(sources).filter(([, v]) => v).map(([k]) => k)
  const missingList = Object.entries(sources).filter(([, v]) => !v).map(([k]) => k)
  const nbSources = livrablesList.length

  let resume = `L'analyse du dossier d'investissement de cette PME du secteur ${sector} en ${fiscal.country} (zone ${zone}) s'appuie sur ${nbSources} livrable(s) disponible(s). `
  
  if (hasFinance) {
    resume += `L'entreprise réalise un chiffre d'affaires de ${fmtNum(currentCA)} FCFA avec une marge brute de ${margeBrute.toFixed(1)}% et un EBITDA de ${fmtNum(ebitda)} FCFA (${ebitdaMargin.toFixed(1)}%). `
  } else {
    resume += `Les données financières détaillées n'ont pas encore été fournies, ce qui limite la profondeur de l'analyse. `
  }

  resume += `\n\nLe score global d'Investment Readiness atteint ${scoreGlobal}/100, ce qui correspond au palier "${palierLabel(palier)}". `
  if (scoreGlobal >= 70) {
    resume += `C'est un résultat encourageant qui témoigne d'une bonne préparation. `
  } else if (scoreGlobal >= 50) {
    resume += `C'est un bon point de départ, avec des marges d'amélioration identifiées. `
  } else {
    resume += `Des efforts sont nécessaires pour renforcer le dossier, mais les fondations sont posées. `
  }

  if (forces.length > 0) {
    resume += `\n\nParmi les points forts : ${forces.slice(0, 3).map(f => f.titre.toLowerCase()).join(', ')}. `
  }

  if (recommandations.length > 0) {
    resume += `\n\nLes priorités d'action sont : ${recommandations.slice(0, 3).map(r => r.titre.toLowerCase()).join(', ')}. `
  }

  if (missingList.length > 0) {
    resume += `\n\nNote : ${missingList.length} livrable(s) manquant(s) (${missingList.join(', ')}). Un diagnostic plus complet sera possible une fois ces données ajoutées.`
  }

  // ═══ BUILD FINAL JSON (exact Claude format) ═══
  return {
    score_global: scoreGlobal,
    palier,
    label: palierLabel(palier),
    couleur,
    scores_dimensions: {
      coherence: {
        score: coherenceScore,
        label: 'Cohérence financière',
        commentaire: hasFramework && hasBmc 
          ? `Les données entre les livrables sont ${incoherences.length === 0 ? 'globalement cohérentes' : 'partiellement cohérentes avec ' + incoherences.length + ' incohérence(s) détectée(s)'}. ${incoherences.length > 0 ? 'Nous recommandons d\'harmoniser les données.' : 'Bravo pour la cohérence !'}`
          : 'Cohérence difficile à évaluer avec les données disponibles. Nous recommandons de compléter les livrables manquants.',
        incoherences_detectees: incoherences
      },
      viabilite: {
        score: viabiliteScore,
        label: 'Viabilité économique',
        commentaire: hasFinance
          ? `${ebitdaMargin > 0 ? 'L\'activité est rentable au niveau opérationnel' : 'L\'EBITDA est négatif, ce qui nécessite une attention particulière'}. Marge brute: ${margeBrute.toFixed(1)}%. ${dscr ? 'DSCR: ' + dscr.toFixed(2) : ''}`
          : 'Les données financières sont insuffisantes pour évaluer pleinement la viabilité économique.',
        seuil_rentabilite_mois: seuilRentaMois,
        dscr: dscr,
        cash_flow_positif_mois: cashFlowPositifMois
      },
      realisme: {
        score: realismeScore,
        label: 'Réalisme des projections',
        commentaire: croissance.length > 0
          ? `Les hypothèses de croissance ont été analysées. ${redFlags.length === 0 ? 'Elles semblent réalistes pour le secteur.' : redFlags.length + ' point(s) de vigilance identifié(s).'}`
          : 'Aucune hypothèse de croissance formalisée. Nous recommandons de les définir pour renforcer le dossier.',
        red_flags: redFlags
      },
      completude_couts: {
        score: completudeScore,
        label: 'Complétude des coûts',
        commentaire: `${postesPresents.length} poste(s) de coûts documenté(s), ${postesManquants.length} manquant(s). ${postesManquants.length === 0 ? 'Excellent travail de documentation !' : 'Compléter les postes manquants améliorera la fiabilité des projections.'}`,
        postes_manquants: postesManquants,
        postes_presents: postesPresents
      },
      capacite_remboursement: {
        score: capaciteScore,
        label: 'Capacité de remboursement',
        commentaire: hasFinance && ebitda > 0
          ? `L'entreprise génère un cash-flow opérationnel positif. ${dscr ? 'Le DSCR de ' + dscr.toFixed(2) + (dscr >= 1.25 ? ' est supérieur au seuil recommandé de 1.25.' : ' est en dessous du seuil recommandé de 1.25.') : 'Le DSCR n\'a pas pu être calculé.'}`
          : 'La capacité de remboursement est limitée par l\'absence de cash-flow opérationnel positif.',
        dscr: dscr,
        duree_remboursement_ans: dureeRemb,
        taux_endettement: tauxEndettement
      }
    },
    points_vigilance,
    incoherences,
    forces,
    opportunites_amelioration: opportunites,
    recommandations,
    benchmarks,
    resume_executif: resume,
    points_attention_prioritaires: points_vigilance.filter((p: any) => p.niveau === 'eleve' || p.niveau === 'élevé').map((p: any) => p.titre),
    livrables_analyses: sources,
    contexte_pays: {
      pays: fiscal.country,
      zone,
      secteur: sector,
      kb_utilisee: kbUsed,
      sources_kb: kbUsed ? ['kb_benchmarks', 'kb_fiscal_params', 'kb_funders', 'kb_evaluation_criteria', 'kb_sources'] : []
    },
    donnees_completes: Object.values(sources).filter(Boolean).length >= 5,
    message_incomplet: Object.values(sources).filter(Boolean).length < 5
      ? `Données incomplètes — ${missingList.length} livrable(s) manquant(s) : ${missingList.join(', ')}. Le diagnostic sera plus précis avec tous les livrables.`
      : null,
    _source: 'deterministic'
  }
}


// ═══════════════════════════════════════════════════════════════
// 2) HTML REPORT GENERATOR — Full standalone HTML from Claude JSON
// ═══════════════════════════════════════════════════════════════

export function generateDiagnosticReportHtml(
  data: any,
  sector: string,
  country: string,
  zone: string
): string {
  const scoreGlobal = data.score_global || 0
  const palier = data.palier || 'en_construction'
  const dims = data.scores_dimensions || {}
  const vigilance = data.points_vigilance || []
  const incoh = data.incoherences || []
  const forces = data.forces || []
  const opps = data.opportunites_amelioration || []
  const recos = data.recommandations || []
  const benchmarks = data.benchmarks || {}
  const resume = data.resume_executif || ''
  const livrables = data.livrables_analyses || {}
  const ctx = data.contexte_pays || {}

  const dimList = [
    { key: 'coherence', icon: 'fa-link', color: '#2563eb' },
    { key: 'viabilite', icon: 'fa-chart-line', color: '#059669' },
    { key: 'realisme', icon: 'fa-bullseye', color: '#d97706' },
    { key: 'completude_couts', icon: 'fa-list-check', color: '#7c3aed' },
    { key: 'capacite_remboursement', icon: 'fa-hand-holding-dollar', color: '#ea580c' }
  ]

  const livrablesIcons: Record<string, { icon: string; label: string }> = {
    bmc: { icon: 'fa-th', label: 'BMC' },
    sic: { icon: 'fa-seedling', label: 'SIC' },
    framework: { icon: 'fa-chart-pie', label: 'Framework' },
    framework_pme_data: { icon: 'fa-database', label: 'Données PME' },
    plan_ovo: { icon: 'fa-coins', label: 'Plan OVO' },
    business_plan: { icon: 'fa-file-contract', label: 'Business Plan' },
    odd: { icon: 'fa-shield-halved', label: 'ODD' }
  }

  // Dimension cards HTML
  const dimensionCardsHtml = dimList.map(d => {
    const dim = dims[d.key]
    if (!dim) return ''
    const sc = dim.score || 0
    const col = scoreColor(sc)
    const bg = scoreBg(sc)
    return `
      <div style="background:${bg};border:1px solid ${col}22;border-radius:16px;padding:20px;transition:transform 0.2s">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <i class="fas ${d.icon}" style="color:${d.color};font-size:16px"></i>
            <span style="font-size:13px;font-weight:700;color:#0f172a">${esc(dim.label || d.key)}</span>
          </div>
          <span style="font-size:22px;font-weight:800;color:${col}">${sc}<small style="font-size:12px;color:#94a3b8">/100</small></span>
        </div>
        <div style="height:6px;background:#e2e8f0;border-radius:3px;margin-bottom:10px;overflow:hidden">
          <div style="width:${sc}%;height:100%;background:${col};border-radius:3px"></div>
        </div>
        <p style="font-size:12px;color:#475569;line-height:1.6;margin:0">${esc(dim.commentaire || '')}</p>
        ${d.key === 'coherence' && dim.incoherences_detectees?.length > 0 ? `
          <div style="margin-top:10px;padding:8px 12px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca">
            <div style="font-size:10px;font-weight:700;color:#991b1b;margin-bottom:4px">Incohérences détectées :</div>
            ${dim.incoherences_detectees.map((i: any) => `
              <div style="font-size:11px;color:#7f1d1d;padding:3px 0;border-bottom:1px solid #fecaca">
                <strong>${esc(i.champ)}</strong> (${esc(i.type)}): ${esc(i.valeur_source1)} vs ${esc(i.valeur_source2)} — écart ${esc(i.ecart)}
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${d.key === 'realisme' && dim.red_flags?.length > 0 ? `
          <div style="margin-top:10px;padding:8px 12px;background:#fff7ed;border-radius:8px;border:1px solid #fed7aa">
            <div style="font-size:10px;font-weight:700;color:#9a3412;margin-bottom:4px">Points de vigilance :</div>
            ${dim.red_flags.map((rf: any) => `<div style="font-size:11px;color:#9a3412;padding:2px 0">⚠️ ${esc(rf)}</div>`).join('')}
          </div>
        ` : ''}
        ${d.key === 'completude_couts' ? `
          ${dim.postes_presents?.length > 0 ? `<div style="margin-top:8px;font-size:11px;color:#059669">✅ ${dim.postes_presents.map((p: string) => esc(p)).join(', ')}</div>` : ''}
          ${dim.postes_manquants?.length > 0 ? `<div style="margin-top:4px;font-size:11px;color:#dc2626">❌ ${dim.postes_manquants.map((p: string) => esc(p)).join(', ')}</div>` : ''}
        ` : ''}
      </div>
    `
  }).join('')

  // Vigilance cards
  const vigilanceHtml = vigilance.map((v: any) => `
    <div style="background:${niveauBg(v.niveau)};border-left:4px solid ${niveauColor(v.niveau)};border-radius:0 12px 12px 0;padding:16px 20px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:2px 8px;border-radius:4px;color:white;background:${niveauColor(v.niveau)}">${esc(v.niveau)}</span>
        <span style="font-size:10px;color:#6b7280;font-weight:600">${esc(v.categorie)}</span>
      </div>
      <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:4px">${esc(v.titre)}</div>
      <p style="font-size:12px;color:#475569;margin:0 0 8px 0">${esc(v.description)}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><span style="font-size:10px;color:#64748b;font-weight:600">Impact financier :</span> <span style="font-size:11px;color:#0f172a">${esc(v.impact_financier)}</span></div>
        <div><span style="font-size:10px;color:#64748b;font-weight:600">Action :</span> <span style="font-size:11px;color:#0f172a">${esc(v.action_recommandee)}</span></div>
      </div>
    </div>
  `).join('')

  // Forces & Opportunités
  const forcesHtml = forces.map((f: any) => `
    <li style="font-size:13px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.05);display:flex;align-items:flex-start;gap:8px">
      <span style="color:#059669;flex-shrink:0">✅</span>
      <div><strong>${esc(f.titre)}</strong><br><span style="font-size:11px;color:#475569">${esc(f.justification)}</span></div>
    </li>
  `).join('')

  const oppsHtml = opps.map((o: any) => `
    <li style="font-size:13px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.05);display:flex;align-items:flex-start;gap:8px">
      <span style="color:#d97706;flex-shrink:0">💡</span>
      <div>
        <strong>${esc(o.titre)}</strong>
        <span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:${o.priorite === 'haute' ? '#fef2f2' : '#fffbeb'};color:${o.priorite === 'haute' ? '#dc2626' : '#d97706'};margin-left:6px">${esc(o.priorite)}</span>
        <br><span style="font-size:11px;color:#475569">${esc(o.justification)}</span>
      </div>
    </li>
  `).join('')

  // Recommendations
  const recosHtml = recos.map((r: any, i: number) => `
    <div style="display:flex;gap:16px;align-items:flex-start;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;margin-bottom:10px">
      <div style="width:32px;height:32px;border-radius:50%;background:#d97706;color:white;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0">${r.priorite || (i + 1)}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700;color:#92400e;margin-bottom:4px">${esc(r.titre)}</div>
        <div style="font-size:12px;color:#78350f;margin-bottom:6px">${esc(r.detail)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(217,119,6,0.1);color:#92400e">Impact: ${esc(r.impact_viabilite)}</span>
          <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(217,119,6,0.1);color:#92400e">${esc(r.urgence)}</span>
        </div>
        <div style="font-size:11px;color:#059669;font-style:italic">💬 ${esc(r.message_encourageant || '')}</div>
        ${r.action_concrete ? `<div style="font-size:11px;color:#475569;margin-top:4px">📋 ${esc(r.action_concrete)}</div>` : ''}
      </div>
    </div>
  `).join('')

  // Benchmarks
  const benchKeys = ['marge_brute', 'marge_ebitda', 'marge_nette', 'ratio_endettement', 'seuil_rentabilite']
  const benchLabels: Record<string, string> = {
    marge_brute: 'Marge Brute',
    marge_ebitda: 'Marge EBITDA',
    marge_nette: 'Marge Nette',
    ratio_endettement: 'Ratio Endettement',
    seuil_rentabilite: 'Seuil Rentabilité (mois)'
  }
  const benchmarksHtml = benchKeys.map(k => {
    const b = benchmarks[k]
    if (!b) return ''
    const val = b.entreprise
    const verdictCol = b.verdict?.includes('norme') || b.verdict?.includes('Bon') ? '#059669' : b.verdict?.includes('dessous') ? '#dc2626' : '#6b7280'
    return `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:4px">${esc(benchLabels[k] || k)}</div>
        <div style="font-size:22px;font-weight:800;color:${verdictCol}">${val !== null && val !== undefined ? (k === 'seuil_rentabilite' ? val + ' mois' : val + '%') : '—'}</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:2px">Secteur: ${b.secteur_min}${k === 'seuil_rentabilite' ? '' : '%'} - ${b.secteur_max}${k === 'seuil_rentabilite' ? ' mois' : '%'}</div>
        <div style="font-size:10px;font-weight:600;color:${verdictCol};margin-top:4px">${esc(b.verdict)}</div>
      </div>
    `
  }).join('')

  // Livrables status
  const livrablesHtml = Object.entries(livrablesIcons).map(([key, info]) => {
    const ok = livrables[key]
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:${ok ? '#f0fdf4' : '#fef2f2'};border:1px solid ${ok ? '#bbf7d0' : '#fecaca'};border-radius:8px">
        <i class="fas ${info.icon}" style="color:${ok ? '#059669' : '#dc2626'};font-size:12px"></i>
        <span style="font-size:11px;font-weight:600;color:${ok ? '#059669' : '#dc2626'}">${info.label}</span>
        <span style="font-size:10px;margin-left:auto">${ok ? '✅' : '❌'}</span>
      </div>
    `
  }).join('')

  // Incohérences section
  const incohHtml = incoh.length > 0 ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:16px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #f1f5f9">
        <i class="fas fa-triangle-exclamation" style="color:#d97706;font-size:18px"></i> Incohérences détectées entre livrables (${incoh.length})
      </div>
      ${incoh.map((i: any) => `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin-bottom:8px">
          <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px">${esc(i.type)} — ${esc(i.champ)}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px;color:#78350f">
            <div><strong>Source 1:</strong> ${esc(i.valeur_bmc || i.valeur_source1)}</div>
            <div><strong>Source 2:</strong> ${esc(i.valeur_framework || i.valeur_source2)}</div>
            <div><strong>Écart:</strong> ${esc(i.ecart)}</div>
          </div>
          <div style="font-size:11px;color:#78350f;margin-top:4px">${esc(i.explication)}</div>
        </div>
      `).join('')}
    </div>
  ` : ''

  // ═══ ASSEMBLE FULL HTML ═══
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagnostic Expert — Investment Readiness</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; }
    .dr { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
    @media print {
      body { background: white; }
      .dr { padding: 0; }
      .dr-section { break-inside: avoid; box-shadow: none; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="dr">

    <!-- ═══ HEADER ═══ -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#1e40af 100%);border-radius:20px;padding:36px 32px;color:white;margin-bottom:24px;position:relative;overflow:hidden">
      <div style="position:absolute;top:-50%;right:-10%;width:400px;height:400px;background:radial-gradient(circle,rgba(255,255,255,0.06)0%,transparent 70%);border-radius:50%"></div>
      <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:rgba(255,255,255,0.12);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px">
        <i class="fas fa-stethoscope"></i> DIAGNOSTIC EXPERT — INVESTMENT READINESS
      </div>
      <div style="font-size:28px;font-weight:800;margin-bottom:4px">${esc(sector)} — ${esc(country)}</div>
      <div style="font-size:13px;color:#94a3b8;display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <span><i class="fas fa-map-marker-alt"></i> ${esc(country)} (${esc(zone)})</span>
        <span><i class="fas fa-industry"></i> ${esc(sector)}</span>
        <span><i class="fas fa-calendar"></i> ${new Date().toLocaleDateString('fr-FR')}</span>
        <span><i class="fas fa-robot"></i> ${data._source === 'deterministic' || data._fallback ? 'Mode déterministe' : 'IA Claude'}</span>
      </div>
      
      <!-- Score card -->
      <div style="display:flex;align-items:center;gap:24px;background:rgba(255,255,255,0.08);border-radius:16px;padding:24px;border:1px solid rgba(255,255,255,0.1);flex-wrap:wrap">
        <div>
          <div style="font-size:64px;font-weight:900;line-height:1;color:${scoreColor(scoreGlobal)}">${scoreGlobal}<span style="font-size:24px;font-weight:400;color:#94a3b8">/100</span></div>
          <div style="font-size:16px;font-weight:700;letter-spacing:1px;color:${scoreColor(scoreGlobal)};text-transform:uppercase">${esc(palierLabel(palier))}</div>
          <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px;margin-top:8px;width:200px"><div style="height:100%;border-radius:4px;width:${scoreGlobal}%;background:${scoreColor(scoreGlobal)}"></div></div>
        </div>
        <div style="flex:1;min-width:250px">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px">
            ${dimList.map(d => {
              const dim = dims[d.key]
              const sc = dim?.score || 0
              return `
                <div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:10px;border:1px solid rgba(255,255,255,0.08);text-align:center">
                  <div style="font-size:20px;font-weight:800;color:${scoreColor(sc)}">${sc}</div>
                  <div style="font-size:9px;color:#94a3b8;margin-top:2px">${esc(dim?.label || d.key)}</div>
                </div>
              `
            }).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ LIVRABLES STATUS ═══ -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:20px 24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:12px"><i class="fas fa-clipboard-check" style="color:#2563eb"></i> Livrables analysés</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
        ${livrablesHtml}
      </div>
      ${data.message_incomplet ? `<div style="font-size:11px;color:#d97706;margin-top:10px;padding:8px 12px;background:#fffbeb;border-radius:8px">⚠️ ${esc(data.message_incomplet)}</div>` : ''}
    </div>

    <!-- ═══ RÉSUMÉ EXÉCUTIF ═══ -->
    <div style="background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%);border:1px solid #bae6fd;border-radius:16px;padding:24px;margin-bottom:20px">
      <div style="font-size:16px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #bae6fd">
        <i class="fas fa-file-alt" style="color:#0284c7;font-size:18px"></i> Résumé Exécutif
      </div>
      ${resume.split('\n\n').map((p: string) => `<p style="font-size:14px;line-height:1.8;color:#0c4a6e;margin-bottom:12px">${esc(p)}</p>`).join('')}
    </div>

    <!-- ═══ DIMENSIONS ═══ -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:16px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #f1f5f9">
        <i class="fas fa-chart-radar" style="color:#2563eb;font-size:18px"></i> Analyse des 5 Dimensions
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
        ${dimensionCardsHtml}
      </div>
    </div>

    <!-- ═══ POINTS DE VIGILANCE ═══ -->
    ${vigilance.length > 0 ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:16px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #f1f5f9">
        <i class="fas fa-shield-exclamation" style="color:#d97706;font-size:18px"></i> Points de Vigilance (${vigilance.length})
      </div>
      ${vigilanceHtml}
    </div>
    ` : ''}

    <!-- ═══ INCOHÉRENCES ═══ -->
    ${incohHtml}

    <!-- ═══ FORCES & OPPORTUNITÉS ═══ -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:16px;padding:20px">
        <div style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:12px;color:#059669">
          <i class="fas fa-trophy"></i> Forces (${forces.length})
        </div>
        <ul style="list-style:none">${forcesHtml}</ul>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:16px;padding:20px">
        <div style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:12px;color:#d97706">
          <i class="fas fa-lightbulb"></i> Opportunités d'amélioration (${opps.length})
        </div>
        <ul style="list-style:none">${oppsHtml}</ul>
      </div>
    </div>

    <!-- ═══ RECOMMANDATIONS ═══ -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:16px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #f1f5f9">
        <i class="fas fa-rocket" style="color:#ea580c;font-size:18px"></i> Recommandations Prioritaires (${recos.length})
      </div>
      ${recosHtml}
    </div>

    <!-- ═══ BENCHMARKS SECTORIELS ═══ -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
      <div style="font-size:16px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #f1f5f9">
        <i class="fas fa-scale-balanced" style="color:#7c3aed;font-size:18px"></i> Benchmarks Sectoriels — ${esc(country)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        ${benchmarksHtml}
      </div>
    </div>

    <!-- ═══ FOOTER ═══ -->
    <div style="text-align:center;padding:20px;color:#94a3b8;font-size:11px">
      <div>Diagnostic Expert — Plateforme ESANO</div>
      <div style="margin-top:4px">Généré le ${new Date().toLocaleDateString('fr-FR')} • ${esc(country)} • ${esc(sector)}</div>
      <div style="margin-top:4px;font-size:10px">Ce diagnostic est un outil d'aide à la décision. Il ne constitue pas un conseil financier.</div>
    </div>

  </div>
</body>
</html>`
}
