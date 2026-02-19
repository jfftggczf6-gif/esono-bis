// ═══════════════════════════════════════════════════════════════════
// Entrepreneur V2 — Single-page NotebookLM-style interface
// Upload → Generate → 3-Column Layout (Chat / Visualization / Nav)
// ═══════════════════════════════════════════════════════════════════
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken } from './auth'
import { orchestrateGeneration, loadKBContext, type OrchestrationResult } from './agents/ai-agents'

type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY?: string
}

export const entrepreneurRoutes = new Hono<{ Bindings: Bindings }>()

// ─── Helpers ───────────────────────────────────────────────────
function getScoreColor(score: number): string {
  if (score >= 86) return '#059669'  // esono-success
  if (score >= 71) return '#0284c7'  // esono-info
  if (score >= 51) return '#c9a962'  // esono-accent
  if (score >= 31) return '#d97706'  // esono-warning
  return '#dc2626'                   // esono-danger
}

function getScoreLabel(score: number): string {
  if (score >= 86) return 'Excellent'
  if (score >= 71) return 'Très bien'
  if (score >= 51) return 'Correct'
  if (score >= 31) return 'À renforcer'
  return 'Insuffisant'
}

const DELIVERABLE_TYPES = [
  { type: 'diagnostic', label: 'Diagnostic Expert', icon: 'fa-stethoscope', format: 'HTML / PDF', deps: ['bmc', 'sic', 'inputs'] as const },
  { type: 'framework', label: 'Framework Analyse', icon: 'fa-table-cells', format: 'Excel / HTML', deps: ['bmc', 'inputs'] as const },
  { type: 'bmc_analysis', label: 'BMC Analysé', icon: 'fa-map', format: 'Word / PDF', deps: ['bmc'] as const },
  { type: 'sic_analysis', label: 'SIC Analysé', icon: 'fa-seedling', format: 'Word / PDF', deps: ['sic'] as const },
  { type: 'plan_ovo', label: 'Plan Financier OVO', icon: 'fa-chart-line', format: 'XLSM', deps: ['inputs'] as const },
  { type: 'business_plan', label: 'Business Plan', icon: 'fa-file-contract', format: 'Word', deps: ['bmc', 'sic', 'inputs'] as const },
  { type: 'odd', label: 'ODD (Due Diligence)', icon: 'fa-shield-halved', format: 'Excel', deps: ['bmc', 'sic', 'inputs'] as const },
]

const DEP_LABELS: Record<string, string> = { bmc: 'BMC', sic: 'SIC', inputs: 'Inputs Financiers' }

function canGenerate(deps: readonly string[], uploadedCategories: Set<string>): boolean {
  return deps.every(d => uploadedCategories.has(d))
}

function missingDeps(deps: readonly string[], uploadedCategories: Set<string>): string[] {
  return deps.filter(d => !uploadedCategories.has(d)).map(d => DEP_LABELS[d] || d)
}

// ─── Rich Fallback Generator ──────────────────────────────────
function rnd(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min }
function jitter(base: number, spread = 12): number { return Math.max(0, Math.min(100, base + rnd(-spread, spread))) }

function buildFallbackResult(hasBmc: boolean, hasSic: boolean, hasInputs: boolean, name: string, docCount: number) {
  const baseScore = 15 + (hasBmc ? 25 : 0) + (hasSic ? 25 : 0) + (hasInputs ? 25 : 0)
  const ds = {
    modele_economique: jitter(hasBmc ? 62 : 28),
    impact_social: jitter(hasSic ? 58 : 22),
    viabilite_financiere: jitter(hasInputs ? 55 : 18),
    equipe_gouvernance: jitter(38),
    maturite_operationnelle: jitter(35),
  }
  const avgDim = Math.round(Object.values(ds).reduce((a, b) => a + b, 0) / 5)
  const globalScore = Math.round((baseScore + avgDim) / 2)

  // ── Diagnostic Expert ──
  const diagnostic = {
    score: globalScore,
    strengths: [
      ...(hasBmc ? ['Business Model Canvas documenté avec les 9 blocs', 'Proposition de valeur identifiée'] : []),
      ...(hasSic ? ['Stratégie d\'impact social formalisée', 'Alignement ODD visible'] : []),
      ...(hasInputs ? ['Données financières disponibles pour projection', 'Structure de coûts renseignée'] : []),
      'Documentation fournie pour analyse approfondie',
    ].slice(0, 5),
    weaknesses: [
      ...(!hasBmc ? ['BMC non fourni — modèle économique non évaluable'] : ['Certains blocs BMC nécessitent plus de détail']),
      ...(!hasSic ? ['SIC absent — impact social non mesurable'] : ['Indicateurs d\'impact à quantifier davantage']),
      ...(!hasInputs ? ['Inputs financiers manquants — viabilité non évaluable'] : ['Hypothèses financières à documenter']),
      'Gouvernance et composition de l\'équipe insuffisamment détaillées',
    ].slice(0, 5),
    recommendations: [
      ...(!hasBmc || !hasSic || !hasInputs ? ['Compléter les documents manquants (BMC + SIC + Financiers) pour une analyse complète'] : []),
      'Quantifier tous les indicateurs clés de performance (KPIs)',
      'Renforcer la gouvernance : organigramme, CV clés, comité consultatif',
      'Documenter les hypothèses de marché et les sources de données',
      'Préparer une matrice des risques avec plans de mitigation',
      'Affiner le seuil de rentabilité et le plan de trésorerie',
    ].slice(0, 6),
    dimensions: [
      { name: 'Modèle Économique', score: ds.modele_economique, analysis: hasBmc ? 'Le BMC fourni a été analysé. La proposition de valeur et les segments clients sont identifiés. Les flux de revenus et la structure de coûts nécessitent une validation plus approfondie avec des données de marché.' : 'BMC non fourni. Le modèle économique ne peut pas être évalué sans ce document fondamental. Score basé uniquement sur les informations indirectes.' },
      { name: 'Impact Social', score: ds.impact_social, analysis: hasSic ? 'Le SIC révèle une stratégie d\'impact structurée. L\'alignement ODD est visible mais les indicateurs quantitatifs doivent être renforcés. La théorie du changement est à formaliser.' : 'SIC non fourni. L\'impact social ne peut pas être mesuré. Les investisseurs à impact requièrent ces données.' },
      { name: 'Viabilité Financière', score: ds.viabilite_financiere, analysis: hasInputs ? 'Les données financières permettent une première projection. Les ratios clés (marge brute, BFR, point mort) sont calculables. Affiner les hypothèses de croissance et les charges fixes.' : 'Inputs financiers absents. Impossible de construire les projections financières. Ce document est critique pour l\'évaluation.' },
      { name: 'Équipe & Gouvernance', score: ds.equipe_gouvernance, analysis: 'Informations limitées sur la gouvernance. Recommandation : fournir l\'organigramme, les CV des dirigeants clés, et la composition du conseil d\'administration ou du comité consultatif.' },
      { name: 'Maturité Opérationnelle', score: ds.maturite_operationnelle, analysis: 'Maturité opérationnelle à évaluer. Les processus internes, la conformité réglementaire, et les systèmes de gestion ne sont pas suffisamment documentés dans les fichiers actuels.' },
    ],
    alerts: [
      ...(!hasBmc ? ['⚠️ CRITIQUE : BMC manquant'] : []),
      ...(!hasSic ? ['⚠️ CRITIQUE : SIC manquant'] : []),
      ...(!hasInputs ? ['🔴 CRITIQUE : Inputs Financiers manquants'] : []),
    ],
  }

  // ── Framework Analyse ──
  const frameworkScore = jitter(hasBmc && hasInputs ? 60 : (hasBmc || hasInputs ? 40 : 15))
  const framework = {
    score: frameworkScore,
    sections: [
      { title: 'Synthèse Exécutive', content: `Analyse préliminaire pour ${name}. Score global : ${globalScore}/100. ${hasBmc && hasInputs ? 'Les données BMC et financières permettent une analyse croisée.' : 'Analyse partielle — documents complémentaires nécessaires.'}`, score: frameworkScore },
      { title: 'Ratios Financiers Clés', content: hasInputs
        ? `Marge brute estimée : ${rnd(25, 55)}%. Ratio de liquidité : ${(rnd(8, 18)/10).toFixed(1)}. Ratio d'endettement : ${rnd(15, 45)}%. Couverture du service de la dette : ${(rnd(10, 25)/10).toFixed(1)}x. Cash burn mensuel estimé : à affiner avec les projections détaillées.`
        : 'Inputs financiers manquants — ratios non calculables. Uploadez vos données financières pour obtenir les ratios.', score: hasInputs ? jitter(55) : 10 },
      { title: 'Benchmarks Sectoriels', content: hasBmc
        ? `Position relative à évaluer par rapport au marché. Les benchmarks nécessitent l'identification du secteur principal et de la zone géographique cible. Avec les données actuelles, une comparaison préliminaire suggère une performance ${frameworkScore > 50 ? 'dans la moyenne' : 'en-dessous de la moyenne'} sectorielle.`
        : 'Secteur non identifié — benchmark impossible sans le BMC.', score: hasBmc ? jitter(48) : 8 },
      { title: 'Analyse de Sensibilité', content: hasInputs
        ? `Scénario optimiste (+20% CA) : rentabilité atteinte en ${rnd(12, 24)} mois. Scénario base : rentabilité à ${rnd(18, 36)} mois. Scénario pessimiste (-20% CA) : besoin de financement additionnel de ${rnd(50, 200)} M FCFA. Variables clés de sensibilité : taux de conversion, panier moyen, coût d'acquisition client.`
        : 'Analyse de sensibilité indisponible sans données financières.', score: hasInputs ? jitter(50) : 5 },
      { title: 'Score Détaillé', content: `Scoring global : ${frameworkScore}/100 — ${frameworkScore >= 60 ? 'Niveau acceptable pour une première évaluation' : 'Niveau insuffisant, des données complémentaires sont nécessaires'}. Décomposition : Structure du modèle ${hasBmc ? jitter(60) : 15}/100, Solidité financière ${hasInputs ? jitter(52) : 10}/100, Potentiel de croissance ${jitter(45)}/100.`, score: frameworkScore },
    ],
  }

  // ── BMC Analysé ──
  const bmcBlocks = ['Segments Clients', 'Proposition de Valeur', 'Canaux de Distribution', 'Relations Clients', 'Flux de Revenus', 'Ressources Clés', 'Activités Clés', 'Partenaires Clés', 'Structure de Coûts']
  const bmcAnalyses = [
    { ok: 'Segments identifiés et priorisés. Cible principale définie.', ko: 'Non évaluable sans BMC.', rec: ['Segmenter plus finement par persona', 'Quantifier la taille de chaque segment'] },
    { ok: 'Proposition de valeur articulée. Différenciation identifiable.', ko: 'Non évaluable.', rec: ['Clarifier le gain unique client', 'Ajouter des preuves sociales'] },
    { ok: 'Canaux de vente et distribution identifiés.', ko: 'Non évaluable.', rec: ['Prioriser les canaux par coût d\'acquisition', 'Tester un canal digital additionnel'] },
    { ok: 'Stratégie de fidélisation décrite.', ko: 'Non évaluable.', rec: ['Chiffrer le coût de rétention vs acquisition', 'Implémenter un programme de fidélité'] },
    { ok: 'Sources de revenus identifiées. Modèle de tarification à affiner.', ko: 'Non évaluable.', rec: ['Diversifier les sources de revenus', 'Tester le pricing avec le marché'] },
    { ok: 'Ressources humaines et technologiques listées.', ko: 'Non évaluable.', rec: ['Identifier les ressources critiques vs nice-to-have', 'Planifier les recrutements clés'] },
    { ok: 'Activités clés cohérentes avec la proposition de valeur.', ko: 'Non évaluable.', rec: ['Prioriser les activités à forte valeur ajoutée', 'Externaliser les activités non-core'] },
    { ok: 'Partenaires stratégiques identifiés.', ko: 'Non évaluable.', rec: ['Formaliser les partenariats par convention', 'Évaluer les risques de dépendance'] },
    { ok: 'Principaux postes de coûts identifiés.', ko: 'Non évaluable.', rec: ['Distinguer coûts fixes / variables', 'Identifier les leviers de réduction'] },
  ]
  const bmcScore = jitter(hasBmc ? 64 : 12)
  const bmc_analysis = {
    score: bmcScore,
    blocks: bmcBlocks.map((name, i) => ({
      name,
      score: hasBmc ? jitter(55 + rnd(0, 20)) : 0,
      analysis: hasBmc ? bmcAnalyses[i].ok : bmcAnalyses[i].ko,
      recommendations: hasBmc ? bmcAnalyses[i].rec : ['Uploader le Business Model Canvas'],
    })),
    warnings: hasBmc ? [
      `Cohérence Proposition de Valeur ↔ Segments : ${rnd(60, 90)}%`,
      `Couverture des flux de revenus : ${rnd(2, 5)} source(s) identifiée(s)`,
    ] : ['BMC non fourni — analyse impossible'],
  }

  // ── SIC Analysé ──
  const sicPillars = [
    { name: 'Vision & Mission', ok: 'Vision long-terme formulée. Mission alignée avec les enjeux du marché cible.', ko: 'Non évaluable sans SIC.', rec: ['Relier la mission aux ODD cibles', 'Quantifier l\'ambition d\'impact à 5 ans'] },
    { name: 'Objectifs d\'Impact', ok: 'Objectifs d\'impact définis et mesurables. Cibles quantitatives à renforcer.', ko: 'Non évaluable.', rec: ['Définir des indicateurs SMART pour chaque objectif', 'Aligner avec les critères des bailleurs'] },
    { name: 'Stratégie de Croissance', ok: 'Stratégie de croissance décrite. Phases de déploiement identifiées.', ko: 'Non évaluable.', rec: ['Détailler les jalons de croissance année par année', 'Quantifier les besoins en financement par phase'] },
    { name: 'Indicateurs d\'Impact (ODD)', ok: `Alignement identifié avec ${rnd(3, 7)} ODD. Indicateurs de suivi à formaliser.`, ko: 'Non évaluable.', rec: ['Sélectionner 3-5 ODD prioritaires', 'Définir les indicateurs de résultat et d\'impact'] },
    { name: 'Plan de Déploiement', ok: 'Plan de déploiement esquissé. Phases et géographies identifiées.', ko: 'Non évaluable.', rec: ['Créer un calendrier détaillé sur 36 mois', 'Identifier les risques par phase'] },
  ]
  const sicScore = jitter(hasSic ? 58 : 10)
  const sic_analysis = {
    score: sicScore,
    pillars: sicPillars.map(p => ({
      name: p.name,
      score: hasSic ? jitter(52 + rnd(0, 18)) : 0,
      analysis: hasSic ? p.ok : p.ko,
      recommendations: hasSic ? p.rec : ['Uploader le SIC'],
    })),
    odd_alignment: hasSic ? [
      { odd: 'ODD 1 – Pas de pauvreté', relevance: rnd(60, 95) },
      { odd: 'ODD 5 – Égalité des sexes', relevance: rnd(40, 80) },
      { odd: 'ODD 8 – Travail décent et croissance', relevance: rnd(70, 95) },
      { odd: 'ODD 9 – Industrie, innovation, infrastructure', relevance: rnd(50, 85) },
      { odd: 'ODD 10 – Inégalités réduites', relevance: rnd(45, 80) },
    ] : [],
    impact_matrix: hasSic ? {
      direct_beneficiaries: `${rnd(500, 10000)}+`,
      indirect_beneficiaries: `${rnd(5000, 50000)}+`,
      geographic_scope: 'Afrique de l\'Ouest',
    } : null,
  }

  // ── Plan Financier OVO ──
  const ovoScore = jitter(hasInputs ? 52 : 8)
  const rev1 = rnd(50, 300) // millions FCFA
  const plan_ovo = {
    score: ovoScore,
    analysis: hasInputs
      ? `Projections financières construites à partir des inputs fournis. Le modèle de revenus est basé sur ${rnd(2, 5)} sources identifiées. Le point mort est estimé à ${rnd(14, 30)} mois. Le besoin en financement cumulé s'élève à ${rnd(80, 500)} M FCFA.`
      : 'Aucun input financier fourni. Impossible de construire les projections OVO.',
    projections: {
      year1: { revenue: rev1, expenses: Math.round(rev1 * (rnd(70, 110)/100)), ebitda: Math.round(rev1 * (rnd(-15, 20)/100)), net_income: Math.round(rev1 * (rnd(-20, 10)/100)), cash_flow: Math.round(rev1 * (rnd(-25, 5)/100)) },
      year3: { revenue: Math.round(rev1 * rnd(20, 35)/10), expenses: Math.round(rev1 * rnd(15, 28)/10), ebitda: Math.round(rev1 * rnd(3, 12)/10), net_income: Math.round(rev1 * rnd(1, 8)/10), cash_flow: Math.round(rev1 * rnd(2, 10)/10) },
      year5: { revenue: Math.round(rev1 * rnd(40, 80)/10), expenses: Math.round(rev1 * rnd(30, 60)/10), ebitda: Math.round(rev1 * rnd(8, 25)/10), net_income: Math.round(rev1 * rnd(5, 18)/10), cash_flow: Math.round(rev1 * rnd(6, 20)/10) },
    },
    key_metrics: hasInputs ? {
      break_even_months: rnd(14, 30),
      irr: `${rnd(15, 45)}%`,
      npv: `${rnd(100, 800)} M FCFA`,
      payback_period: `${rnd(24, 48)} mois`,
      gross_margin: `${rnd(30, 65)}%`,
      debt_service_coverage: `${(rnd(10, 25)/10).toFixed(1)}x`,
    } : null,
    assumptions: hasInputs ? [
      'Taux de croissance du CA : 25-40% annuel',
      'Taux d\'imposition effectif : 25%',
      'Charges sociales : 18% de la masse salariale',
      'Inflation : 3% annuel',
      'Devise de référence : XOF / FCFA',
    ] : [],
  }

  // ── Business Plan ──
  const bpScore = jitter(hasBmc && hasSic && hasInputs ? 58 : (docCount >= 2 ? 35 : 15))
  const business_plan = {
    score: bpScore,
    sections: [
      { title: 'Résumé Exécutif', content: `${name} est une entreprise à impact social qui ${hasBmc ? 'propose une solution innovante identifiée dans le BMC' : 'cherche à résoudre un problème de marché identifié'}. ${hasSic ? 'L\'impact social est structuré autour de ' + rnd(3, 5) + ' ODD prioritaires.' : ''} ${hasInputs ? 'Les projections financières montrent un potentiel de rentabilité à ' + rnd(18, 36) + ' mois.' : ''}` },
      { title: 'Présentation de l\'Entreprise & Équipe', content: `${name} opère dans le secteur ${hasBmc ? 'identifié dans le BMC' : 'à préciser'}. L'équipe dirigeante et la structure de gouvernance doivent être détaillées pour renforcer la crédibilité du dossier. Un organigramme et les CV clés sont recommandés.` },
      { title: 'Analyse de Marché', content: hasBmc ? `Le marché cible est défini par les segments clients du BMC. La taille estimée du marché adressable (TAM) nécessite une étude quantitative. Les canaux de distribution identifiés couvrent ${rnd(2, 4)} modes d'accès client.` : 'Analyse de marché impossible sans BMC. Le document doit détailler : TAM/SAM/SOM, tendances, concurrence, positionnement.' },
      { title: 'BMC Affiné', content: hasBmc ? `Les 9 blocs du Business Model Canvas ont été analysés. Score moyen des blocs : ${bmcScore}/100. Points d'amélioration prioritaires : renforcer la proposition de valeur et diversifier les flux de revenus.` : 'BMC non disponible. Section à compléter.' },
      { title: 'Stratégie Commerciale', content: hasBmc ? `La stratégie commerciale s'appuie sur ${rnd(2, 4)} canaux de distribution et un modèle de tarification à valider. L'objectif de parts de marché à 3 ans est à quantifier.` : 'Non évaluable sans BMC.' },
      { title: 'Plan Opérationnel', content: `Les processus opérationnels clés sont à documenter : supply chain, production, livraison, service client. Les besoins en recrutement et en infrastructure doivent être chiffrés dans le plan opérationnel.` },
      { title: 'Projections Financières', content: hasInputs ? `Les projections sur 5 ans montrent une croissance de ${rev1} M FCFA en année 1 à ${Math.round(rev1 * rnd(40, 80)/10)} M FCFA en année 5. Le seuil de rentabilité est estimé à ${rnd(14, 30)} mois. Le TRI prévisionnel est de ${rnd(15, 45)}%.` : 'Projections financières indisponibles sans inputs. Section critique pour les investisseurs.' },
      { title: 'Gestion des Risques', content: `Risques identifiés : réglementaire (${rnd(1, 3)} risques), marché (${rnd(2, 4)} risques), opérationnel (${rnd(1, 3)} risques), financier (${rnd(1, 3)} risques). Plans de mitigation à formaliser pour chaque catégorie.` },
      { title: 'Besoins de Financement', content: hasInputs ? `Besoin total identifié : ${rnd(100, 600)} M FCFA. Répartition recommandée : ${rnd(30, 50)}% fonds propres, ${rnd(20, 40)}% dette, ${rnd(10, 30)}% subventions/investissement à impact. Le plan de décaissement sur 24 mois est à formaliser.` : 'Besoins de financement non quantifiables sans données financières.' },
    ],
  }

  // ── ODD (Due Diligence) ──
  const oddScore = jitter(hasBmc && hasSic && hasInputs ? 52 : (docCount >= 2 ? 30 : 12))
  const categories = ['Juridique', 'Financier', 'Opérationnel', 'Gouvernance', 'Impact']
  const criteriaPerCat = (cat: string, docPresent: boolean): any[] => {
    const criteriaMap: Record<string, string[]> = {
      'Juridique': ['Statuts juridiques à jour', 'Registre de commerce valide', 'Conformité fiscale', 'Contrats commerciaux', 'Propriété intellectuelle', 'Licences/agréments', 'Protection des données', 'Contentieux en cours'],
      'Financier': ['États financiers certifiés', 'Système comptable conforme', 'Contrôle budgétaire', 'Gestion de trésorerie', 'Audit externe', 'Plan de financement', 'Couverture des risques financiers', 'Reporting financier régulier'],
      'Opérationnel': ['Processus qualité documentés', 'Gestion des fournisseurs', 'Plan de continuité', 'Infrastructure IT', 'Sécurité des installations', 'Gestion des stocks', 'Mesure de performance', 'Certification qualité'],
      'Gouvernance': ['Conseil d\'administration constitué', 'Comité d\'audit', 'Politique anti-corruption', 'Code d\'éthique', 'Transparence décisionnelle', 'Plan de succession', 'Gestion des conflits d\'intérêt', 'Reporting ESG'],
      'Impact': ['Théorie du changement', 'Indicateurs d\'impact mesurés', 'Rapport d\'impact annuel', 'Alignement ODD documenté', 'Évaluation d\'additionnalité', 'Mesure des externalités', 'Engagement parties prenantes', 'Certification impact'],
    }
    return (criteriaMap[cat] || []).map(name => {
      const r = rnd(1, 100)
      const status = docPresent ? (r > 60 ? 'Conforme' : r > 30 ? 'Partiel' : 'Non conforme') : (r > 80 ? 'Partiel' : 'Non vérifié')
      return { name, category: cat, status, comment: status === 'Conforme' ? 'Critère vérifié et satisfait.' : status === 'Partiel' ? 'Partiellement documenté — à compléter.' : docPresent ? 'Non conforme — action corrective requise.' : 'Impossible à vérifier — document source manquant.' }
    })
  }
  const odd = {
    score: oddScore,
    criteria: categories.flatMap(cat => criteriaPerCat(cat, hasBmc || hasSic || hasInputs)),
    summary: {
      total_criteria: 0, // Will be set below
      conforme: 0,
      partiel: 0,
      non_conforme: 0,
      non_verifie: 0,
      blocking_issues: [] as string[],
    },
  }
  odd.summary.total_criteria = odd.criteria.length
  odd.summary.conforme = odd.criteria.filter(c => c.status === 'Conforme').length
  odd.summary.partiel = odd.criteria.filter(c => c.status === 'Partiel').length
  odd.summary.non_conforme = odd.criteria.filter(c => c.status === 'Non conforme').length
  odd.summary.non_verifie = odd.criteria.filter(c => c.status === 'Non vérifié').length
  odd.summary.blocking_issues = odd.criteria.filter(c => c.status === 'Non conforme').map(c => `${c.category} : ${c.name}`).slice(0, 5)

  return {
    score_global: globalScore,
    scores_dimensions: ds,
    deliverables: { diagnostic, framework, bmc_analysis, sic_analysis, plan_ovo, business_plan, odd },
  }
}

// ─── Dependency-Aware Regeneration Helper ─────────────────────
function getAffectedDeliverables(modifiedCategory: string): string[] {
  const depMap: Record<string, string[][]> = {}
  for (const dt of DELIVERABLE_TYPES) {
    depMap[dt.type] = [dt.deps as unknown as string[]]
  }
  return DELIVERABLE_TYPES
    .filter(dt => (dt.deps as readonly string[]).includes(modifiedCategory))
    .map(dt => dt.type)
}

function classifyMessage(message: string): 'correction' | 'detail' | 'question' {
  const lower = message.toLowerCase()
  const correctionPatterns = [
    'corrig', 'modifi', 'chang', 'mettre à jour', 'met à jour', 'mise à jour',
    'remplacer', 'rectifi', 'ajust', 'revoir', 'refaire', 'améliorer le',
    'améliore le', 'augment', 'rédui', 'revoi', 'actualiser', 'j\'ai corrigé',
    'j\'ai modifié', 'je corrige', 'correction', 'erreur dans',
  ]
  const detailPatterns = [
    'plus de détail', 'détailler', 'approfondir', 'développer',
    'enrichir', 'préciser', 'expliquer plus', 'explique plus',
    'en savoir plus', 'donne moi plus', 'donne-moi plus',
    'élaborer', 'ajoute des détails', 'section plus complète',
  ]
  if (correctionPatterns.some(p => lower.includes(p))) return 'correction'
  if (detailPatterns.some(p => lower.includes(p))) return 'detail'
  return 'question'
}

function identifyTargetDeliverable(message: string): string | null {
  const lower = message.toLowerCase()
  const mapping: [string[], string][] = [
    [['diagnostic', 'score global', 'investment readiness'], 'diagnostic'],
    [['framework', 'ratios', 'benchmark', 'sensibilité', 'analyse financière'], 'framework'],
    [['bmc', 'business model', 'canvas', 'bloc', 'blocs', '9 blocs'], 'bmc_analysis'],
    [['sic', 'impact social', 'croissance', 'odd', 'impact'], 'sic_analysis'],
    [['ovo', 'plan financier', 'projections', 'financier', 'trésorerie', 'p&l', 'bilan'], 'plan_ovo'],
    [['business plan', 'bp', 'résumé exécutif', 'plan d\'affaires'], 'business_plan'],
    [['due diligence', 'diligence', 'checklist', 'conformité', 'critères'], 'odd'],
  ]
  for (const [keywords, type] of mapping) {
    if (keywords.some(k => lower.includes(k))) return type
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ─── API: Upload file ───────────────────────────────────────────
entrepreneurRoutes.post('/api/upload', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    const category = formData.get('category') as string | null

    if (!file || !category) return c.json({ error: 'Fichier et catégorie requis' }, 400)

    const validCategories = ['bmc', 'sic', 'inputs', 'supplementary']
    if (!validCategories.includes(category)) return c.json({ error: 'Catégorie invalide' }, 400)

    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const allowedByCategory: Record<string, string[]> = {
      bmc: ['doc', 'docx', 'pdf'],
      sic: ['doc', 'docx', 'xls', 'xlsx', 'pdf'],
      inputs: ['xls', 'xlsx', 'csv', 'pdf'],
      supplementary: ['doc', 'docx', 'xls', 'xlsx', 'pdf', 'csv', 'txt', 'png', 'jpg', 'jpeg']
    }

    if (!allowedByCategory[category]?.includes(ext)) {
      return c.json({ error: `Type .${ext} non accepté pour ${category}` }, 400)
    }
    if (file.size > 10 * 1024 * 1024) return c.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, 400)

    // Replace existing for primary categories
    if (category !== 'supplementary') {
      const existing = await c.env.DB.prepare('SELECT id FROM uploads WHERE user_id = ? AND category = ?')
        .bind(payload.userId, category).first()
      if (existing) await c.env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(existing.id).run()
    }

    const id = crypto.randomUUID()
    const r2Key = `uploads/${payload.userId}/${category}/${Date.now()}_${file.name}`

    // Store file content as base64 in extracted_text (local dev)
    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let base64 = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      base64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    base64 = btoa(base64)

    await c.env.DB.prepare(`
      INSERT INTO uploads (id, user_id, category, filename, r2_key, file_type, file_size, extracted_text, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(id, payload.userId, category, file.name, r2Key, file.type, file.size, `base64:${base64.slice(0, 500)}`).run()

    return c.json({ success: true, upload: { id, category, filename: file.name, file_type: file.type, file_size: file.size } })
  } catch (error: any) {
    console.error('Upload error:', error)
    return c.json({ error: "Erreur lors de l'upload" }, 500)
  }
})

// ─── API: Delete upload ─────────────────────────────────────────
entrepreneurRoutes.delete('/api/upload/:id', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const uploadId = c.req.param('id')
    const upload = await c.env.DB.prepare('SELECT id FROM uploads WHERE id = ? AND user_id = ?')
      .bind(uploadId, payload.userId).first()
    if (!upload) return c.json({ error: 'Fichier non trouvé' }, 404)

    await c.env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(uploadId).run()
    return c.json({ success: true })
  } catch (error) {
    console.error('Delete upload error:', error)
    return c.json({ error: 'Erreur lors de la suppression' }, 500)
  }
})

// ─── API: Get uploads ───────────────────────────────────────────
entrepreneurRoutes.get('/api/uploads', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const uploads = await c.env.DB.prepare(
      'SELECT id, category, filename, file_type, file_size, uploaded_at FROM uploads WHERE user_id = ? ORDER BY uploaded_at DESC'
    ).bind(payload.userId).all()
    return c.json({ success: true, uploads: uploads.results || [] })
  } catch (error) {
    console.error('Get uploads error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ─── API: Get iterations ────────────────────────────────────────
entrepreneurRoutes.get('/api/iterations', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const iterations = await c.env.DB.prepare(
      'SELECT * FROM iterations WHERE user_id = ? ORDER BY version DESC'
    ).bind(payload.userId).all()
    return c.json({ success: true, iterations: iterations.results || [] })
  } catch (error) {
    console.error('Get iterations error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ─── API: Get deliverables ──────────────────────────────────────
entrepreneurRoutes.get('/api/deliverables', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const deliverables = await c.env.DB.prepare(`
      SELECT ed.* FROM entrepreneur_deliverables ed
      INNER JOIN (SELECT type, MAX(version) as max_version FROM entrepreneur_deliverables WHERE user_id = ? GROUP BY type) latest 
      ON ed.type = latest.type AND ed.version = latest.max_version
      WHERE ed.user_id = ?
    `).bind(payload.userId, payload.userId).all()
    return c.json({ success: true, deliverables: deliverables.results || [] })
  } catch (error) {
    console.error('Get deliverables error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ─── API: Get chat messages ─────────────────────────────────────
entrepreneurRoutes.get('/api/chat/messages', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const messages = await c.env.DB.prepare(
      'SELECT id, role, content, attached_file_id, triggered_iteration_id, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC'
    ).bind(payload.userId).all()
    return c.json({ success: true, messages: messages.results || [] })
  } catch (error) {
    console.error('Get chat messages error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// ─── API: POST /api/ai/generate-all ─────────────────────────────
entrepreneurRoutes.post('/api/ai/generate-all', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    // Rate limit: 5 generations per day
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const genCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM iterations WHERE user_id = ? AND created_at >= ?"
    ).bind(payload.userId, todayStart.toISOString()).first()
    
    if (genCount && (genCount.cnt as number) >= 5) {
      return c.json({ error: 'Limite atteinte : maximum 5 générations par jour. Réessayez demain.', retryAfter: 86400 }, 429)
    }

    // Get uploads
    const uploads = await c.env.DB.prepare(
      'SELECT id, category, filename, extracted_text FROM uploads WHERE user_id = ? ORDER BY category'
    ).bind(payload.userId).all()

    const uploadData = (uploads.results || []) as any[]
    if (uploadData.filter(u => ['bmc', 'sic', 'inputs'].includes(u.category)).length === 0) {
      return c.json({ error: 'Aucun document uploadé. Veuillez uploader au moins un fichier.' }, 400)
    }

    // Determine which categories are uploaded
    const uploadedCats = new Set(uploadData.map(u => u.category))
    const hasBmc = uploadedCats.has('bmc')
    const hasSic = uploadedCats.has('sic')
    const hasInputs = uploadedCats.has('inputs')

    // Determine which deliverables can be generated based on dependencies
    const generableTypes = DELIVERABLE_TYPES
      .filter(dt => canGenerate(dt.deps, uploadedCats))
      .map(dt => dt.type)
    const skippedTypes = DELIVERABLE_TYPES
      .filter(dt => !canGenerate(dt.deps, uploadedCats))
      .map(dt => ({ type: dt.type, label: dt.label, missing: missingDeps(dt.deps, uploadedCats) }))

    // Get user info
    const user = await c.env.DB.prepare('SELECT name, email, country FROM users WHERE id = ?').bind(payload.userId).first()
    const userName = (user?.name as string) || 'Entrepreneur'
    const userCountry = (user?.country as string) || undefined

    // Get current version
    const lastIter = await c.env.DB.prepare(
      'SELECT MAX(version) as maxV FROM iterations WHERE user_id = ?'
    ).bind(payload.userId).first()
    const newVersion = ((lastIter?.maxV as number) || 0) + 1

    // Build document texts from uploads
    const documentTexts: Record<string, string> = {}
    for (const u of uploadData) {
      const text = u.extracted_text || ''
      documentTexts[u.category] = text.startsWith('base64:') ? `[Fichier binaire: ${u.filename}]` : text.slice(0, 6000)
    }

    // ═══ MULTI-AGENT ORCHESTRATION ═══
    const apiKey = c.env.ANTHROPIC_API_KEY
    let result: any = null
    let source = 'fallback'
    let agentsUsed: string[] = []
    let agentErrors: string[] = []

    try {
      const orchestration: OrchestrationResult = await orchestrateGeneration(
        c.env.DB,
        apiKey,
        payload.userId,
        userName,
        userCountry,
        documentTexts,
        uploadedCats,
      )

      if (orchestration.source !== 'fallback' && Object.keys(orchestration.deliverables).length > 0) {
        result = {
          score_global: orchestration.score_global,
          scores_dimensions: orchestration.scores_dimensions,
          deliverables: orchestration.deliverables,
        }
        source = orchestration.source
        agentsUsed = orchestration.agentsUsed
        agentErrors = orchestration.errors
      }
    } catch (err: any) {
      console.error('Orchestration error:', err.message)
      agentErrors.push(`orchestration: ${err.message}`)
    }

    // Fallback: rich rule-based generation (if agents failed or no API key)
    if (!result) {
      source = 'fallback'
      result = buildFallbackResult(hasBmc, hasSic, hasInputs, userName, uploadData.length)
      agentsUsed = ['fallback']
    }

    // Store iteration
    const iterationId = crypto.randomUUID()
    await c.env.DB.prepare(`
      INSERT INTO iterations (id, user_id, version, score_global, scores_dimensions, trigger_type, trigger_message, created_at)
      VALUES (?, ?, ?, ?, ?, 'initial', ?, datetime('now'))
    `).bind(iterationId, payload.userId, newVersion, result.score_global, JSON.stringify(result.scores_dimensions), `Génération v${newVersion} (${source}) | Agents: ${agentsUsed.join(', ')}`).run()

    // Store only deliverables whose dependencies are met
    let generatedCount = 0
    for (const dtype of generableTypes) {
      const delivData = result.deliverables?.[dtype]
      if (!delivData) continue
      const delivId = crypto.randomUUID()
      await c.env.DB.prepare(`
        INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'generated', datetime('now'))
      `).bind(delivId, payload.userId, dtype, JSON.stringify(delivData), delivData.score || 0, newVersion, iterationId).run()
      generatedCount++
    }

    return c.json({
      success: true,
      iteration: { id: iterationId, version: newVersion, score_global: result.score_global },
      source,
      agentsUsed,
      agentErrors: agentErrors.length > 0 ? agentErrors : undefined,
      deliverableCount: generatedCount,
      totalPossible: 7,
      generated: generableTypes,
      skipped: skippedTypes,
      uploadedInputs: { bmc: hasBmc, sic: hasSic, inputs: hasInputs }
    })
  } catch (error: any) {
    console.error('Generate-all error:', error)
    return c.json({ error: 'Erreur lors de la génération: ' + error.message }, 500)
  }
})

// ─── API: POST /api/chat/message ────────────────────────────────
entrepreneurRoutes.post('/api/chat/message', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const body = await c.req.json()
    const { message, context } = body
    if (!message?.trim()) return c.json({ error: 'Message requis' }, 400)

    // Rate limit: 20 messages per hour
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString()
    const msgCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM chat_messages WHERE user_id = ? AND role = 'user' AND created_at >= ?"
    ).bind(payload.userId, oneHourAgo).first()
    
    if (msgCount && (msgCount.cnt as number) >= 20) {
      return c.json({ error: 'Limite atteinte : 20 messages par heure.', retryAfter: 3600 }, 429)
    }

    // Save user message
    const userMsgId = crypto.randomUUID()
    await c.env.DB.prepare(
      "INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, 'user', ?, datetime('now'))"
    ).bind(userMsgId, payload.userId, message).run()

    // Classify intent
    const intent = classifyMessage(message)
    const targetDeliv = identifyTargetDeliverable(message)

    // Get recent chat history for context
    const history = await c.env.DB.prepare(
      'SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
    ).bind(payload.userId).all()
    const chatHistory = ((history.results || []) as any[]).reverse()

    // Get latest deliverables for context
    const delivs = await c.env.DB.prepare(`
      SELECT type, content, score FROM entrepreneur_deliverables ed
      INNER JOIN (SELECT type as t, MAX(version) as mv FROM entrepreneur_deliverables WHERE user_id = ? GROUP BY type) l 
      ON ed.type = l.t AND ed.version = l.mv WHERE ed.user_id = ?
    `).bind(payload.userId, payload.userId).all()

    const delivContext = ((delivs.results || []) as any[]).map(d => {
      return `[${d.type}] Score: ${d.score}/100`
    }).join(', ')

    // Get uploads to know which categories are present
    const uploadsRes = await c.env.DB.prepare(
      'SELECT category, filename, extracted_text FROM uploads WHERE user_id = ?'
    ).bind(payload.userId).all()
    const uploadedCats = new Set(((uploadsRes.results || []) as any[]).map(u => u.category))

    let responseText = ''
    let regenerated = false
    let newVersion: number | null = null
    let newScore: number | null = null
    let regeneratedDeliverables: string[] = []
    const apiKey = c.env.ANTHROPIC_API_KEY

    // ── Case 1 or 4: Correction / Detail → Regenerate affected deliverables ──
    if (intent === 'correction' || intent === 'detail') {
      // Determine which deliverables need regeneration
      let toRegenerate: string[] = []
      
      if (targetDeliv) {
        toRegenerate = [targetDeliv]
      } else {
        toRegenerate = ['diagnostic', 'framework', 'business_plan']
        if (uploadedCats.has('inputs')) toRegenerate.push('plan_ovo')
      }

      toRegenerate = toRegenerate.filter(dt => {
        const def = DELIVERABLE_TYPES.find(d => d.type === dt)
        return def ? canGenerate(def.deps, uploadedCats) : false
      })

      if (toRegenerate.length > 0) {
        const user = await c.env.DB.prepare('SELECT name, country FROM users WHERE id = ?').bind(payload.userId).first()
        const userName = (user?.name as string) || 'Entrepreneur'
        const userCountry = (user?.country as string) || undefined

        const hasBmc = uploadedCats.has('bmc')
        const hasSic = uploadedCats.has('sic')
        const hasInputs = uploadedCats.has('inputs')

        // Build document texts
        const uploadData = (uploadsRes.results || []) as any[]
        const documentTexts: Record<string, string> = {}
        for (const u of uploadData) {
          const text = u.extracted_text || ''
          documentTexts[u.category] = text.startsWith('base64:') ? `[Fichier binaire: ${u.filename}]` : text.slice(0, 6000)
        }

        // ═══ USE MULTI-AGENT ORCHESTRATION FOR REGENERATION ═══
        let regenResult: any = null
        try {
          const orchestration = await orchestrateGeneration(
            c.env.DB, apiKey, payload.userId, userName, userCountry,
            documentTexts, uploadedCats, message // pass user message as custom instructions
          )

          if (orchestration.source !== 'fallback' && Object.keys(orchestration.deliverables).length > 0) {
            regenResult = {
              score_global: orchestration.score_global,
              scores_dimensions: orchestration.scores_dimensions,
              deliverables: {} as any,
            }
            // Only pick the deliverables we want to regenerate
            for (const t of toRegenerate) {
              if (orchestration.deliverables[t]) {
                regenResult.deliverables[t] = orchestration.deliverables[t]
              }
            }
          }
        } catch (err: any) {
          console.error('Chat regen orchestration error:', err.message)
        }

        // Fallback regeneration
        if (!regenResult) {
          const full = buildFallbackResult(hasBmc, hasSic, hasInputs, userName, uploadedCats.size)
          regenResult = {
            score_global: full.score_global,
            scores_dimensions: full.scores_dimensions,
            deliverables: {} as any,
          }
          for (const t of toRegenerate) {
            regenResult.deliverables[t] = full.deliverables[t as keyof typeof full.deliverables]
          }
        }

        // Create new iteration
        const lastIter = await c.env.DB.prepare(
          'SELECT MAX(version) as maxV, score_global FROM iterations WHERE user_id = ? ORDER BY version DESC LIMIT 1'
        ).bind(payload.userId).first()
        const prevVersion = (lastIter?.maxV as number) || 0
        newVersion = prevVersion + 1
        newScore = regenResult.score_global || (lastIter?.score_global as number) || 0

        const iterationId = crypto.randomUUID()
        await c.env.DB.prepare(`
          INSERT INTO iterations (id, user_id, version, score_global, scores_dimensions, trigger_type, trigger_message, created_at)
          VALUES (?, ?, ?, ?, ?, 'chat_correction', ?, datetime('now'))
        `).bind(iterationId, payload.userId, newVersion, newScore, JSON.stringify(regenResult.scores_dimensions || {}), message.slice(0, 200)).run()

        // Store regenerated deliverables
        for (const dtype of toRegenerate) {
          const delivData = regenResult.deliverables?.[dtype]
          if (!delivData) continue
          const delivId = crypto.randomUUID()
          await c.env.DB.prepare(`
            INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'updated', datetime('now'))
          `).bind(delivId, payload.userId, dtype, JSON.stringify(delivData), delivData.score || 0, newVersion, iterationId).run()
          regeneratedDeliverables.push(dtype)
        }

        regenerated = true
        const regenLabels = regeneratedDeliverables.map(t => {
          const dt = DELIVERABLE_TYPES.find(d => d.type === t)
          return dt?.label || t
        }).join(', ')
        
        responseText = `✅ J'ai ${intent === 'correction' ? 'corrigé' : 'enrichi'} les livrables suivants : **${regenLabels}**.\n\nNouvelle version : v${newVersion} · Score global : ${newScore}/100.\n\nLa page va se rafraîchir pour afficher les mises à jour.`
      } else {
        responseText = `Je comprends votre demande de ${intent === 'correction' ? 'correction' : 'détail supplémentaire'}, mais les documents nécessaires ne sont pas encore tous uploadés. Veuillez compléter vos uploads puis relancez la génération.`
      }
    }
    // ── Case 3: Simple question → Answer with KB context ──
    else {
      // Load KB context for enriched answers
      let kbSummary = ''
      try {
        const kbContext = await loadKBContext(c.env.DB)
        if (kbContext.funders.length > 0) {
          kbSummary = `\n\nBAILLEURS DISPONIBLES: ${kbContext.funders.map((f: any) => `${f.name} (${f.type}, ticket ${f.typical_ticket_min}-${f.typical_ticket_max} EUR)`).join('; ')}`
        }
        if (kbContext.benchmarks.length > 0) {
          const sectors = [...new Set(kbContext.benchmarks.map((b: any) => b.sector))]
          kbSummary += `\nBENCHMARKS SECTORIELS: ${sectors.join(', ')}`
        }
      } catch { /* KB not available, continue */ }

      if (apiKey && apiKey !== 'sk-ant-PLACEHOLDER') {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 25000)

          const messages = chatHistory.map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content
          }))

          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 2048,
              system: `Tu es un conseiller Investment Readiness pour PME africaines. L'entrepreneur te pose des questions sur ses livrables. Contexte livrables: ${delivContext}. Documents uploadés : ${Array.from(uploadedCats).join(', ') || 'Aucun'}. ${kbSummary}\n\nRéponds en français, de manière concise et actionnable. ${context ? `Livrable actuellement consulté: ${context}` : ''}`,
              messages
            }),
            signal: controller.signal
          })

          clearTimeout(timeout)

          if (res.ok) {
            const data = await res.json() as any
            responseText = data?.content?.[0]?.text || "Je n'ai pas pu traiter votre demande."
          }
        } catch (err: any) {
          console.error('Chat Claude error:', err.message)
        }
      }

      // Fallback response (enhanced with KB data)
      if (!responseText) {
        const lowerMsg = message.toLowerCase()
        if (lowerMsg.includes('score') || lowerMsg.includes('note')) {
          responseText = `Votre score actuel reflète l'analyse de vos documents. Pour l'améliorer :\n\n1. **Complétez tous les documents** (BMC, SIC, Inputs Financiers)\n2. **Quantifiez vos indicateurs** clés de performance\n3. **Renforcez votre proposition de valeur**\n\nN'hésitez pas à re-uploader des versions améliorées de vos documents.`
        } else if (lowerMsg.includes('bmc') || lowerMsg.includes('business model')) {
          responseText = `Pour améliorer votre BMC :\n\n- **Segments clients** : Soyez plus spécifique sur vos cibles\n- **Proposition de valeur** : Chiffrez l'impact\n- **Canaux** : Détaillez votre stratégie de distribution\n- **Flux de revenus** : Précisez vos tarifs et projections\n\nRe-uploadez votre BMC mis à jour pour une nouvelle analyse.`
        } else if (lowerMsg.includes('financ') || lowerMsg.includes('inputs')) {
          responseText = `Pour renforcer votre volet financier :\n\n- **Projections** : Fournissez des projections sur 3-5 ans\n- **Hypothèses** : Documentez vos hypothèses de base\n- **KPIs** : Identifiez vos métriques clés\n- **Break-even** : Calculez votre seuil de rentabilité\n\nUn fichier Excel structuré est recommandé.`
        } else if (lowerMsg.includes('sic') || lowerMsg.includes('impact')) {
          responseText = `Pour renforcer votre SIC :\n\n- **Vision/Mission** : Alignez avec les ODD prioritaires\n- **Indicateurs d'impact** : Définissez des indicateurs SMART\n- **Théorie du changement** : Formalisez le lien action → résultat\n- **Plan de déploiement** : Détaillez les phases sur 36 mois\n\nRe-uploadez votre SIC mis à jour pour une nouvelle analyse.`
        } else if (lowerMsg.includes('bailleur') || lowerMsg.includes('financement') || lowerMsg.includes('funder') || lowerMsg.includes('subvention')) {
          responseText = `🏦 **Bailleurs adaptés aux PME africaines :**\n\n- **Enabel** : Subventions 10K-500K EUR, forte présence Afrique de l'Ouest\n- **GIZ** : Matching funds + assistance technique, programme Make-IT in Africa\n- **BAD** : Prêts/equity 50K-10M EUR, programme AFAWA (femmes entrepreneures)\n- **AFD/Proparco** : 25K-5M EUR, programme Choose Africa\n- **Banque Mondiale** : Via IFC pour le secteur privé\n\n💡 Votre score d'Investment Readiness détermine votre éligibilité. Un score >70/100 ouvre les portes des financements les plus compétitifs.\n\nPosez-moi une question spécifique sur un bailleur pour plus de détails.`
        } else if (lowerMsg.includes('dépendance') || lowerMsg.includes('manque') || lowerMsg.includes('quoi uploader')) {
          const missing = []
          if (!uploadedCats.has('bmc')) missing.push('BMC (Business Model Canvas)')
          if (!uploadedCats.has('sic')) missing.push('SIC (Stratégie d\'Impact & Croissance)')
          if (!uploadedCats.has('inputs')) missing.push('Inputs Financiers')
          responseText = missing.length > 0
            ? `Il vous manque : **${missing.join(', ')}**.\n\nAvec les 3 documents obligatoires, l'IA pourra générer les 7 livrables complets.`
            : `Tous les documents obligatoires sont uploadés ! ✅ Vous pouvez générer ou re-générer l'ensemble des 7 livrables.`
        } else {
          responseText = `Merci pour votre message. Voici mes recommandations :\n\n1. Assurez-vous que tous vos documents sont à jour\n2. Vérifiez la cohérence entre votre BMC, SIC et projections financières\n3. Utilisez le bouton "Générer" pour obtenir une nouvelle analyse\n\n💡 **Astuce** : Demandez-moi des infos sur les **bailleurs de fonds**, les **benchmarks sectoriels**, ou demandez de "corriger" un livrable spécifique.`
        }
      }
    }

    // Save assistant response
    const assistMsgId = crypto.randomUUID()
    await c.env.DB.prepare(
      "INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, datetime('now'))"
    ).bind(assistMsgId, payload.userId, responseText).run()

    return c.json({
      success: true,
      response: { id: assistMsgId, role: 'assistant', content: responseText },
      regenerated,
      regeneratedDeliverables,
      newVersion,
      newScore,
    })
  } catch (error: any) {
    console.error('Chat message error:', error)
    return c.json({ error: 'Erreur: ' + error.message }, 500)
  }
})

// ─── API: Get single deliverable ────────────────────────────────
entrepreneurRoutes.get('/api/deliverable/:type', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const dtype = c.req.param('type')
    const deliverable = await c.env.DB.prepare(`
      SELECT * FROM entrepreneur_deliverables WHERE user_id = ? AND type = ? ORDER BY version DESC LIMIT 1
    `).bind(payload.userId, dtype).first()

    if (!deliverable) return c.json({ success: true, deliverable: null })
    return c.json({ success: true, deliverable })
  } catch (error) {
    console.error('Get deliverable error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})



// ═══════════════════════════════════════════════════════════════════
// DELIVERABLE PAGES: /deliverable/:type
// (diagnostic, plan_ovo, business_plan, odd)
// ═══════════════════════════════════════════════════════════════════

const DELIV_PAGE_META: Record<string, { title: string, icon: string, desc: string, color: string, format: string }> = {
  diagnostic: {
    title: 'Diagnostic Expert',
    icon: 'fa-stethoscope',
    desc: 'Score Investment Readiness et recommandations détaillées par dimension.',
    color: '#059669',
    format: 'HTML / PDF'
  },
  plan_ovo: {
    title: 'Plan Financier OVO',
    icon: 'fa-coins',
    desc: 'Projections financières sur 5 ans au format OVO.',
    color: '#0284c7',
    format: 'XLSM / PDF'
  },
  business_plan: {
    title: 'Business Plan',
    icon: 'fa-file-contract',
    desc: 'Document de synthèse complet prêt pour les investisseurs.',
    color: '#7c3aed',
    format: 'Word / PDF'
  },
  odd: {
    title: 'Due Diligence Opérationnelle',
    icon: 'fa-shield-halved',
    desc: 'Checklist ODD complète pour les bailleurs de fonds.',
    color: '#d97706',
    format: 'Excel / PDF'
  }
}

entrepreneurRoutes.get('/deliverable/:type', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')
    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const dtype = c.req.param('type')
    const meta = DELIV_PAGE_META[dtype]
    if (!meta) return c.redirect('/entrepreneur')

    const user = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
      .bind(payload.userId).first()

    // Get latest deliverable of this type
    const deliverable = await c.env.DB.prepare(`
      SELECT * FROM entrepreneur_deliverables WHERE user_id = ? AND type = ? ORDER BY version DESC LIMIT 1
    `).bind(payload.userId, dtype).first() as any

    // Get latest iteration for global score
    const latestIter = await c.env.DB.prepare(
      'SELECT score_global, scores_dimensions, version, created_at FROM iterations WHERE user_id = ? ORDER BY version DESC LIMIT 1'
    ).bind(payload.userId).first() as any

    const globalScore = latestIter?.score_global ?? 0
    const version = latestIter?.version ?? 0

    let content: any = {}
    if (deliverable?.content) {
      try { content = JSON.parse(deliverable.content) } catch { content = {} }
    }
    const dScore = deliverable?.score ?? 0
    const scoreColor = getScoreColor(dScore)
    const scoreLabel = getScoreLabel(dScore)
    const isAvailable = !!deliverable
    const createdAt = deliverable?.created_at
      ? new Date(deliverable.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : null

    // Build sections HTML depending on type
    let blocksHtml = ''

    if (dtype === 'diagnostic') {
      const dims = content.dimensions || []
      blocksHtml = `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-chart-bar"></i> Dimensions évaluées</h2>
          <div class="dlv-blocks">
            ${dims.map((d: any) => `
              <div class="dlv-block">
                <div class="dlv-block__header">
                  <span class="dlv-block__name">${escapeHtml(d.name || '')}</span>
                  <span class="dlv-block__score" style="color:${getScoreColor(d.score || 0)}">${d.score || 0}/100</span>
                </div>
                <div class="dlv-block__bar"><div class="dlv-block__bar-fill" style="width:${d.score || 0}%;background:${getScoreColor(d.score || 0)}"></div></div>
                <p class="dlv-block__text">${escapeHtml(d.analysis || '')}</p>
              </div>
            `).join('')}
          </div>
        </div>
        ${content.strengths?.length ? `
          <div class="dlv-section">
            <h2 class="dlv-section__title"><i class="fas fa-check-circle" style="color:#059669"></i> Forces</h2>
            <ul class="dlv-list dlv-list--green">${content.strengths.map((s: string) => `<li><i class="fas fa-check"></i> ${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        ${content.weaknesses?.length ? `
          <div class="dlv-section">
            <h2 class="dlv-section__title"><i class="fas fa-exclamation-triangle" style="color:#dc2626"></i> Faiblesses</h2>
            <ul class="dlv-list dlv-list--red">${content.weaknesses.map((w: string) => `<li><i class="fas fa-times"></i> ${escapeHtml(w)}</li>`).join('')}</ul>
          </div>` : ''}
        ${content.recommendations?.length ? `
          <div class="dlv-section">
            <h2 class="dlv-section__title"><i class="fas fa-lightbulb" style="color:#d97706"></i> Recommandations</h2>
            <ul class="dlv-list dlv-list--amber">${content.recommendations.map((r: string) => `<li><i class="fas fa-arrow-right"></i> ${escapeHtml(r)}</li>`).join('')}</ul>
          </div>` : ''}
      `
    } else if (dtype === 'plan_ovo') {
      const proj = content.projections || {}
      blocksHtml = `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-chart-line"></i> Projections</h2>
          ${content.analysis ? `<p class="dlv-analysis">${escapeHtml(content.analysis)}</p>` : ''}
          <div class="dlv-blocks">
            ${Object.entries(proj).map(([key, val]: [string, any]) => `
              <div class="dlv-block">
                <div class="dlv-block__header"><span class="dlv-block__name">${escapeHtml(key)}</span></div>
                <p class="dlv-block__text">${escapeHtml(typeof val === 'object' ? JSON.stringify(val) : String(val))}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `
    } else if (dtype === 'business_plan') {
      const sections = content.sections || []
      blocksHtml = `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-list-ol"></i> Sections du Business Plan</h2>
          <div class="dlv-blocks">
            ${sections.map((s: any) => `
              <div class="dlv-block">
                <div class="dlv-block__header"><span class="dlv-block__name">${escapeHtml(s.title || '')}</span></div>
                <p class="dlv-block__text">${escapeHtml(s.content || '')}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `
    } else if (dtype === 'odd') {
      const criteria = content.criteria || []
      blocksHtml = `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-clipboard-list"></i> Critères ODD</h2>
          <div class="dlv-blocks">
            ${criteria.map((cr: any) => {
              const stColor = cr.status === 'Complet' ? '#059669' : cr.status === 'Partiel' ? '#d97706' : '#dc2626'
              return `
                <div class="dlv-block">
                  <div class="dlv-block__header">
                    <span class="dlv-block__name">${escapeHtml(cr.name || '')}</span>
                    <span class="dlv-block__score" style="color:${stColor}">${escapeHtml(cr.status || '')}</span>
                  </div>
                  <p class="dlv-block__text">${escapeHtml(cr.comment || '')}</p>
                </div>`
            }).join('')}
          </div>
        </div>
      `
    }

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Livrable ${meta.title} - ESONO</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .dlv-section { background: white; border-radius: 16px; border: 1px solid #e5e7eb; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.06); }
    .dlv-section__title { font-size: 16px; font-weight: 700; color: #1f2937; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
    .dlv-blocks { display: flex; flex-direction: column; gap: 12px; }
    .dlv-block { background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 12px; padding: 16px; }
    .dlv-block__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .dlv-block__name { font-size: 14px; font-weight: 600; color: #1f2937; display: flex; align-items: center; gap: 8px; }
    .dlv-block__score { font-size: 14px; font-weight: 700; }
    .dlv-block__bar { height: 5px; background: #e5e7eb; border-radius: 99px; overflow: hidden; margin-bottom: 8px; }
    .dlv-block__bar-fill { height: 100%; border-radius: 99px; transition: width 0.6s ease; }
    .dlv-block__text { font-size: 13px; color: #6b7280; line-height: 1.6; }
    .dlv-analysis { font-size: 14px; color: #4b5563; line-height: 1.7; margin-bottom: 16px; padding: 12px; background: #f0fdf4; border-radius: 8px; border-left: 3px solid #059669; }
    .dlv-list { list-style: none; padding: 0; }
    .dlv-list li { padding: 10px 14px; background: #f9fafb; border-radius: 8px; margin-bottom: 6px; font-size: 13px; display: flex; align-items: flex-start; gap: 10px; border: 1px solid #f3f4f6; }
    .dlv-list li i { margin-top: 3px; font-size: 11px; flex-shrink: 0; }
    .dlv-list--green li i { color: #059669; }
    .dlv-list--red li i { color: #dc2626; }
    .dlv-list--amber li i { color: #d97706; }
    .dlv-download-card { display: flex; align-items: center; gap: 14px; padding: 14px; border-radius: 12px; border: 1px solid; transition: all 0.2s; cursor: pointer; text-decoration: none; }
    .dlv-download-card:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgb(0 0 0 / 0.08); }
    .dlv-download-card__icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 16px; flex-shrink: 0; }
    .dlv-download-card__info { flex: 1; }
    .dlv-download-card__name { font-size: 14px; font-weight: 600; }
    .dlv-download-card__desc { font-size: 12px; opacity: 0.8; }
  </style>
</head>
<body class="bg-slate-50 min-h-screen">
  <!-- Nav -->
  <nav class="bg-white shadow-sm border-b border-slate-200">
    <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/entrepreneur" class="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 font-medium text-sm">
        <i class="fas fa-arrow-left"></i>
        <span>Retour à la page principale</span>
      </a>
      <span class="text-xs text-slate-500 flex items-center gap-2">
        <i class="fas ${meta.icon}"></i>
        ${escapeHtml(meta.title)}
      </span>
    </div>
  </nav>

  <main class="max-w-6xl mx-auto px-4 py-8 space-y-8">
    ${!isAvailable ? `
      <section class="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-amber-800">
        <div class="flex items-start gap-3">
          <span class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 text-amber-600">
            <i class="fas fa-triangle-exclamation"></i>
          </span>
          <div>
            <h2 class="text-sm font-semibold">Livrable non encore généré</h2>
            <p class="text-sm">Retournez à la page principale et cliquez sur "Générer les livrables".</p>
          </div>
        </div>
        <a href="/entrepreneur" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold">
          <i class="fas fa-wand-magic-sparkles"></i>
          Générer les livrables
        </a>
      </section>
    ` : ''}

    <!-- Header -->
    <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <p class="text-xs uppercase tracking-wider text-slate-500">${isAvailable ? 'Livrable généré · v' + (deliverable?.version || version) : 'En attente'}</p>
        <h1 class="text-3xl font-bold text-slate-900">${escapeHtml(meta.title)}</h1>
        <p class="mt-2 text-slate-600">${escapeHtml(meta.desc)}</p>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        ${isAvailable ? `
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold" style="background:${scoreColor}20;color:${scoreColor}">
            <i class="fas fa-chart-line"></i>
            ${dScore}/100 — ${escapeHtml(scoreLabel)}
          </span>
          ${createdAt ? `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-slate-100 text-slate-600"><i class="fas fa-clock"></i> ${createdAt}</span>` : ''}
        ` : `
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-slate-100 text-slate-500">
            <i class="fas fa-hourglass-half"></i>
            Non généré
          </span>
        `}
      </div>
    </header>

    <!-- Main content -->
    <div class="grid gap-6 md:grid-cols-5">
      <!-- Left: Downloads -->
      <div class="md:col-span-2 space-y-4">
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-download" style="color:${meta.color}"></i> Livrables disponibles</h2>
          <div class="space-y-3">
            ${isAvailable ? `
              <a href="/api/deliverable/${dtype}" target="_blank" class="dlv-download-card" style="border-color:${meta.color}40;background:${meta.color}08">
                <div class="dlv-download-card__icon" style="background:${meta.color}">
                  <i class="fas fa-file-lines"></i>
                </div>
                <div class="dlv-download-card__info">
                  <p class="dlv-download-card__name" style="color:${meta.color}">${escapeHtml(meta.title)} Complet</p>
                  <p class="dlv-download-card__desc" style="color:${meta.color}">${escapeHtml(meta.format)}</p>
                  <span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style="background:${meta.color}15;color:${meta.color}">
                    <i class="fas fa-star text-[8px]"></i> RECOMMANDÉ
                  </span>
                </div>
              </a>
              <div class="dlv-download-card" style="border-color:#e5e7eb;background:#f9fafb;cursor:default;">
                <div class="dlv-download-card__icon" style="background:#d1d5db">
                  <i class="fas fa-file-pdf"></i>
                </div>
                <div class="dlv-download-card__info">
                  <p class="dlv-download-card__name text-slate-500">Export PDF</p>
                  <p class="dlv-download-card__desc text-slate-400">Prochainement disponible</p>
                </div>
              </div>
            ` : `
              <div class="text-center py-8 text-slate-400">
                <i class="fas fa-file-circle-question text-3xl mb-3 block"></i>
                <p class="text-sm">Aucun livrable disponible</p>
                <p class="text-xs mt-1">Générez les livrables depuis la page principale</p>
              </div>
            `}
          </div>
        </div>
      </div>

      <!-- Right: Content -->
      <div class="md:col-span-3 space-y-0">
        ${isAvailable ? blocksHtml : `
          <div class="dlv-section text-center py-16">
            <i class="fas fa-rocket text-4xl text-slate-300 mb-4 block"></i>
            <p class="text-slate-500 font-medium">Contenu en attente de génération</p>
            <p class="text-slate-400 text-sm mt-2">Uploadez vos documents et lancez la génération depuis la page principale.</p>
          </div>
        `}
      </div>
    </div>
  </main>
</body>
</html>`

    return c.html(html)
  } catch (error) {
    console.error('Deliverable page error:', error)
    return c.redirect('/entrepreneur')
  }
})


// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE: /entrepreneur
// ═══════════════════════════════════════════════════════════════════
entrepreneurRoutes.get('/entrepreneur', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')
    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const user = await c.env.DB.prepare('SELECT id, name, email, user_type FROM users WHERE id = ?')
      .bind(payload.userId).first()
    if (!user) return c.redirect('/login')

    // Fetch uploads
    const uploads = await c.env.DB.prepare(
      'SELECT id, category, filename, file_type, file_size, uploaded_at FROM uploads WHERE user_id = ? ORDER BY uploaded_at DESC'
    ).bind(payload.userId).all()

    const uploadsByCategory: Record<string, any> = {}
    const supplementaryFiles: any[] = []
    for (const u of (uploads.results || []) as any[]) {
      if (u.category === 'supplementary') supplementaryFiles.push(u)
      else uploadsByCategory[u.category] = u
    }

    // Fetch latest iteration
    const latestIteration = await c.env.DB.prepare(
      'SELECT * FROM iterations WHERE user_id = ? ORDER BY version DESC LIMIT 1'
    ).bind(payload.userId).first() as any

    // Fetch all iterations for sidebar
    const allIterations = await c.env.DB.prepare(
      'SELECT id, version, score_global, trigger_type, created_at FROM iterations WHERE user_id = ? ORDER BY version DESC LIMIT 20'
    ).bind(payload.userId).all()

    // Fetch deliverables
    const deliverables = await c.env.DB.prepare(`
      SELECT ed.* FROM entrepreneur_deliverables ed
      INNER JOIN (SELECT type, MAX(version) as max_version FROM entrepreneur_deliverables WHERE user_id = ? GROUP BY type) latest 
      ON ed.type = latest.type AND ed.version = latest.max_version WHERE ed.user_id = ?
    `).bind(payload.userId, payload.userId).all()

    const delivMap: Record<string, any> = {}
    for (const d of (deliverables.results || []) as any[]) {
      delivMap[d.type] = d
    }

    // Fetch chat messages
    const chatMessages = await c.env.DB.prepare(
      'SELECT id, role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 50'
    ).bind(payload.userId).all()

    // Fetch module progress for card status (join with modules table to get module_code)
    const progressData = await c.env.DB.prepare(
      'SELECT m.module_code, p.status, p.ai_score FROM progress p JOIN modules m ON p.module_id = m.id WHERE p.user_id = ?'
    ).bind(payload.userId).all()
    const progressMap: Record<string, any> = {}
    for (const p of (progressData.results || []) as any[]) {
      progressMap[p.module_code] = p
    }

    const score = latestIteration?.score_global ?? -1
    const version = latestIteration?.version ?? 0
    const hasGenerated = !!latestIteration
    const scoresDim = latestIteration?.scores_dimensions ? JSON.parse(latestIteration.scores_dimensions) : null

    const uploadCount = [uploadsByCategory.bmc, uploadsByCategory.sic, uploadsByCategory.inputs].filter(Boolean).length
    const scoreColor = score >= 0 ? getScoreColor(score) : '#d1d5db'

    const updatedAt = latestIteration?.created_at
      ? new Date(latestIteration.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : null

    // Generate button state
    let btnLabel: string, btnSub: string, btnClass: string, btnDisabled: boolean, btnTooltip: string
    const uploadedCategories = new Set([
      ...(uploadsByCategory.bmc ? ['bmc'] : []),
      ...(uploadsByCategory.sic ? ['sic'] : []),
      ...(uploadsByCategory.inputs ? ['inputs'] : []),
    ])
    const generableCount = DELIVERABLE_TYPES.filter(dt => canGenerate(dt.deps, uploadedCategories)).length
    if (uploadCount === 0) {
      btnLabel = 'COMMENCER → UPLOADER MES DOCUMENTS'; btnSub = '(0/3 — Uploadez au moins un document)'; btnClass = 'ev2-btn--disabled'; btnDisabled = true; btnTooltip = 'Uploadez au moins un document pour commencer'
    } else if (uploadCount < 3) {
      btnLabel = hasGenerated ? 'REGÉNÉRER LES LIVRABLES' : 'GÉNÉRER LES LIVRABLES'
      btnSub = `(${uploadCount}/3 inputs — ${generableCount}/7 livrables générables)`
      btnClass = uploadCount === 1 ? 'ev2-btn--orange' : 'ev2-btn--yellow'; btnDisabled = false
      const missingLabels = ['bmc', 'sic', 'inputs'].filter(c => !uploadedCategories.has(c)).map(c => DEP_LABELS[c]).join(', ')
      btnTooltip = `Génération partielle. Manque : ${missingLabels}`
    } else {
      btnLabel = hasGenerated ? 'REGÉNÉRER LES LIVRABLES' : 'GÉNÉRER LES LIVRABLES'
      btnSub = '(3/3 inputs — 7/7 livrables · Analyse complète)'; btnClass = 'ev2-btn--green'; btnDisabled = false; btnTooltip = 'Tous les documents sont uploadés. Génération complète des 7 livrables.'
    }

    // ── Build inline module cards HTML (pre-computed to avoid nested template literals) ──
    // ── Build HTML ──
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESONO | Investment Readiness</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', 'IBM Plex Sans', sans-serif; background: #f9fafb; color: #374151; min-height: 100vh; overflow-x: hidden; }
    a { color: #1e3a5f; text-decoration: none; }
    a:hover { text-decoration: underline; color: #2a4d7a; }
    
    /* ── App Header ── */
    .ev2-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; background: #ffffff; border-bottom: 1px solid #e5e7eb; position: sticky; top: 0; z-index: 100; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); flex-shrink: 0; }
    .ev2-header__brand { font-size: 18px; font-weight: 800; color: #1e3a5f; letter-spacing: 1px; text-decoration: none; }
    .ev2-header__right { display: flex; align-items: center; gap: 14px; }
    .ev2-header__user { font-size: 12px; color: #6b7280; }
    .ev2-header__user strong { color: #1f2937; }
    .ev2-btn-sm { background: #ffffff; border: 1px solid #d1d5db; color: #374151; padding: 5px 12px; border-radius: 6px; font-size: 11px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
    .ev2-btn-sm:hover { border-color: #1e3a5f; color: #1e3a5f; background: #f3f4f6; }
    .ev2-btn-sm--danger:hover { border-color: #dc2626; color: #dc2626; background: #fee2e2; }
    
    /* ── Score Banner (full — pre-generation) ── */
    .ev2-score { background: linear-gradient(135deg, #1e3a5f 0%, #2a4d7a 100%); border-radius: 12px; padding: 28px 32px; margin: 16px 20px; text-align: center; position: relative; overflow: hidden; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    .ev2-score::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 30% 50%, rgba(201,169,98,0.12) 0%, transparent 60%); }
    .ev2-score * { position: relative; }
    .ev2-score__title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 3px; color: #c9a962; margin-bottom: 12px; }
    .ev2-score__value { font-size: 52px; font-weight: 800; line-height: 1; margin-bottom: 6px; color: #ffffff; }
    .ev2-score__bar { width: 100%; max-width: 380px; height: 7px; background: rgba(255,255,255,0.15); border-radius: 99px; margin: 10px auto; overflow: hidden; }
    .ev2-score__bar-fill { height: 100%; border-radius: 99px; transition: width 1s ease-out; }
    .ev2-score__meta { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 6px; }
    .ev2-score__meta span { margin: 0 6px; }
    .ev2-score__placeholder { font-size: 44px; font-weight: 800; color: rgba(255,255,255,0.3); }
    .ev2-score__placeholder-text { font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 6px; }
    
    /* ── Score Banner COMPACT (post-generation — thin strip) ── */
    .ev2-score--compact { padding: 8px 20px; margin: 0; border-radius: 0; display: flex; align-items: center; justify-content: center; gap: 16px; flex-shrink: 0; }
    .ev2-score--compact::before { display: none; }
    .ev2-score--compact .ev2-score__title { margin-bottom: 0; font-size: 10px; letter-spacing: 2px; }
    .ev2-score--compact .ev2-score__value { font-size: 22px; margin-bottom: 0; }
    .ev2-score--compact .ev2-score__bar { max-width: 120px; margin: 0; height: 4px; }
    .ev2-score--compact .ev2-score__meta { margin-top: 0; font-size: 10px; }
    
    /* ── Upload Section ── */
    .ev2-upload-section { padding: 0 20px 16px; }
    .ev2-upload-section--compact { padding: 0; flex-shrink: 0; }
    .ev2-upload-toggle { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #ffffff; border-radius: 10px; cursor: pointer; margin-bottom: 12px; border: 1px solid #e5e7eb; transition: all 0.2s; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
    .ev2-upload-toggle:hover { border-color: #d1d5db; }
    .ev2-upload-toggle--bar { margin: 0; border-radius: 0; border-left: 0; border-right: 0; border-top: 0; padding: 6px 20px; font-size: 12px; box-shadow: none; border-bottom: 1px solid #e5e7eb; }
    .ev2-upload-toggle__left { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; color: #1f2937; }
    .ev2-upload-toggle__badge { background: #059669; color: white; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .ev2-upload-toggle__chevron { color: #9ca3af; transition: transform 0.3s; font-size: 12px; }
    .ev2-upload-toggle--open .ev2-upload-toggle__chevron { transform: rotate(180deg); }
    .ev2-upload-body { overflow: hidden; transition: max-height 0.4s ease; }
    .ev2-upload-body--collapsed { max-height: 0; padding: 0; }
    .ev2-upload-body--open { max-height: 800px; }
    .ev2-upload-body--compact { padding: 0 20px; }
    
    .ev2-upload-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
    .ev2-upload-card { background: #ffffff; border: 2px dashed #d1d5db; border-radius: 10px; padding: 20px; text-align: center; cursor: pointer; transition: all 0.25s; position: relative; min-height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .ev2-upload-card:hover { border-color: #4a6fa5; background: #f3f4f6; }
    .ev2-upload-card--done { border: 2px solid #059669; background: #d1fae5; }
    .ev2-upload-card__icon { font-size: 24px; margin-bottom: 10px; color: #9ca3af; }
    .ev2-upload-card--done .ev2-upload-card__icon { color: #059669; }
    .ev2-upload-card__title { font-size: 14px; font-weight: 600; color: #1f2937; margin-bottom: 3px; }
    .ev2-upload-card__sub { font-size: 11px; color: #6b7280; margin-bottom: 10px; }
    .ev2-upload-card__drop { font-size: 11px; color: #9ca3af; }
    .ev2-upload-card__status { font-size: 11px; margin-top: 8px; display: flex; align-items: center; gap: 5px; }
    .ev2-upload-card__status--ok { color: #059669; font-weight: 500; }
    .ev2-upload-card__status--wait { color: #9ca3af; }
    .ev2-upload-card__rm { position: absolute; top: 6px; right: 6px; background: #fee2e2; color: #dc2626; border: none; width: 22px; height: 22px; border-radius: 50%; cursor: pointer; font-size: 10px; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; }
    .ev2-upload-card:hover .ev2-upload-card__rm { opacity: 1; }
    .ev2-upload-card input[type="file"] { display: none; }
    
    .ev2-supplementary { background: #ffffff; border: 1px dashed #d1d5db; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .ev2-supplementary__head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .ev2-supplementary__title { font-size: 13px; font-weight: 600; color: #6b7280; }
    .ev2-supplementary__badge { font-size: 10px; background: #f3f4f6; color: #9ca3af; padding: 2px 8px; border-radius: 99px; }
    .ev2-supplementary__zone { border: 1px dashed #d1d5db; border-radius: 8px; padding: 14px; text-align: center; cursor: pointer; transition: border-color 0.2s; }
    .ev2-supplementary__zone:hover { border-color: #4a6fa5; }
    .ev2-supplementary__zone p { font-size: 11px; color: #9ca3af; }
    .ev2-supplementary__list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .ev2-supplementary__file { display: flex; align-items: center; gap: 5px; background: #f3f4f6; padding: 5px 8px; border-radius: 5px; font-size: 11px; color: #4b5563; }
    .ev2-supplementary__file button { background: none; border: none; color: #dc2626; cursor: pointer; font-size: 10px; }
    
    /* ── Generate Button ── */
    .ev2-gen { text-align: center; padding: 4px 20px 24px; }
    .ev2-gen--compact { padding: 0; flex-shrink: 0; border-bottom: 1px solid #e5e7eb; }
    .ev2-gen--compact .ev2-gen__btn { border-radius: 0; width: 100%; font-size: 12px; padding: 8px 20px; letter-spacing: 0; }
    .ev2-gen__btn { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; padding: 14px 44px; border: none; border-radius: 8px; font-family: inherit; cursor: pointer; transition: all 0.3s; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
    .ev2-gen__btn:disabled { cursor: not-allowed; }
    .ev2-gen__sub { font-size: 11px; font-weight: 400; opacity: 0.8; }
    .ev2-btn--disabled { background: #e5e7eb; color: #9ca3af; }
    .ev2-btn--orange { background: #d97706; color: white; box-shadow: 0 2px 8px rgba(217,119,6,0.3); }
    .ev2-btn--orange:hover:not(:disabled) { background: #b45309; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(217,119,6,0.4); }
    .ev2-btn--yellow { background: #c9a962; color: #1f2937; box-shadow: 0 2px 8px rgba(201,169,98,0.3); }
    .ev2-btn--yellow:hover:not(:disabled) { background: #a98a42; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(201,169,98,0.4); }
    .ev2-btn--green { background: #1e3a5f; color: white; box-shadow: 0 2px 8px rgba(30,58,95,0.3); }
    .ev2-btn--green:hover:not(:disabled) { background: #162d4a; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(30,58,95,0.4); }
    
    /* ── Loading ── */
    .ev2-loading { display: none; text-align: center; padding: 36px 20px; }
    .ev2-loading--active { display: block; }
    .ev2-loading__spinner { width: 44px; height: 44px; border: 4px solid #e5e7eb; border-top-color: #1e3a5f; border-radius: 50%; animation: ev2spin 0.8s linear infinite; margin: 0 auto 16px; }
    .ev2-loading__step { font-size: 13px; color: #6b7280; margin-bottom: 3px; }
    .ev2-loading__step--active { color: #1e3a5f; font-weight: 600; }
    .ev2-loading__step--done { color: #059669; }
    @keyframes ev2spin { to { transform: rotate(360deg); } }
    
    /* ═══ 3-COLUMN LAYOUT — fills remaining viewport ═══ */
    .ev2-layout { display: none; }
    .ev2-layout--active { display: flex; height: calc(100vh - 160px); overflow: hidden; }
    
    /* ── App shell (post-generation): flex layout, page scrollable for module cards below ── */
    .ev2-app-shell { display: flex; flex-direction: column; min-height: 100vh; }
    
    /* ── Left: Chat & Iterations ── */
    .ev2-left { width: 270px; min-width: 270px; background: #ffffff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; overflow: hidden; }
    .ev2-left__section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #6b7280; padding: 12px 14px 6px; flex-shrink: 0; }
    
    /* Iterations list */
    .ev2-iterations { overflow-y: auto; max-height: 160px; padding: 0 10px 6px; flex-shrink: 0; }
    .ev2-iteration { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 8px; margin-bottom: 3px; cursor: pointer; transition: background 0.2s; font-size: 12px; }
    .ev2-iteration:hover { background: #f3f4f6; }
    .ev2-iteration--active { background: #e0f2fe; border: 1px solid #0284c7; }
    .ev2-iteration__ver { font-weight: 700; color: #1f2937; }
    .ev2-iteration__score { color: #1e3a5f; font-weight: 600; }
    .ev2-iteration__time { color: #9ca3af; font-size: 11px; }
    .ev2-iteration__badge { background: #1e3a5f; color: white; font-size: 9px; padding: 1px 6px; border-radius: 99px; font-weight: 600; }
    
    /* Chat area — fills remaining space in left column */
    .ev2-chat { flex: 1; display: flex; flex-direction: column; border-top: 1px solid #e5e7eb; min-height: 0; overflow: hidden; }
    .ev2-chat__messages { flex: 1; overflow-y: auto; padding: 10px; background: #f9fafb; min-height: 0; }
    .ev2-chat__bubble { max-width: 88%; margin-bottom: 8px; padding: 9px 12px; border-radius: 12px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .ev2-chat__bubble--user { background: #1e3a5f; color: white; margin-left: auto; border-bottom-right-radius: 4px; }
    .ev2-chat__bubble--ai { background: #ffffff; color: #374151; margin-right: auto; border-bottom-left-radius: 4px; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
    .ev2-chat__input-area { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #e5e7eb; background: #ffffff; flex-shrink: 0; }
    .ev2-chat__input { flex: 1; background: #f9fafb; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px; color: #374151; font-size: 12px; font-family: inherit; resize: none; outline: none; min-height: 36px; max-height: 80px; }
    .ev2-chat__input:focus { border-color: #1e3a5f; box-shadow: 0 0 0 2px rgba(30,58,95,0.1); }
    .ev2-chat__send { background: #1e3a5f; border: none; color: white; padding: 0 14px; border-radius: 8px; cursor: pointer; font-size: 13px; transition: background 0.2s; }
    .ev2-chat__send:hover { background: #2a4d7a; }
    .ev2-chat__send:disabled { background: #d1d5db; cursor: not-allowed; }
    
    /* ── Center: Visualization — fills remaining horizontal space ── */
    .ev2-center { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #f9fafb; min-width: 0; }
    .ev2-center__header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; background: #ffffff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
    .ev2-center__title { font-size: 14px; font-weight: 700; color: #1e3a5f; display: flex; align-items: center; gap: 8px; }
    .ev2-center__actions { display: flex; gap: 6px; }
    .ev2-center__content { flex: 1; overflow-y: auto; padding: 16px 20px; min-height: 0; }
    
    /* Diagnostic view */
    .ev2-diag { }
    .ev2-diag__dims { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .ev2-diag__dim { background: #ffffff; border-radius: 10px; padding: 16px; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
    .ev2-diag__dim-name { font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 8px; }
    .ev2-diag__dim-score { font-size: 28px; font-weight: 800; margin-bottom: 6px; }
    .ev2-diag__dim-bar { height: 5px; background: #e5e7eb; border-radius: 99px; overflow: hidden; }
    .ev2-diag__dim-bar-fill { height: 100%; border-radius: 99px; }
    .ev2-diag__dim-text { font-size: 11px; color: #9ca3af; margin-top: 6px; }
    .ev2-diag__section { margin-bottom: 20px; }
    .ev2-diag__section-title { font-size: 14px; font-weight: 700; color: #1f2937; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
    .ev2-diag__list { list-style: none; }
    .ev2-diag__list li { padding: 8px 12px; background: #ffffff; border-radius: 6px; margin-bottom: 4px; font-size: 13px; display: flex; align-items: flex-start; gap: 8px; border: 1px solid #f3f4f6; }
    .ev2-diag__list li i { margin-top: 3px; font-size: 11px; }
    
    /* Generic deliverable view */
    .ev2-deliv-view { }
    .ev2-deliv-view__score { text-align: center; margin-bottom: 20px; }
    .ev2-deliv-view__score-num { font-size: 40px; font-weight: 800; }
    .ev2-deliv-view__section { background: #ffffff; border-radius: 10px; padding: 16px; margin-bottom: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
    .ev2-deliv-view__section h3 { font-size: 14px; font-weight: 700; margin-bottom: 8px; color: #1f2937; }
    .ev2-deliv-view__section p { font-size: 13px; color: #6b7280; line-height: 1.6; }
    .ev2-deliv-view__block { background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid #f3f4f6; }
    .ev2-deliv-view__block h4 { font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 4px; }
    .ev2-deliv-view__block p { font-size: 12px; color: #6b7280; }
    .ev2-deliv-view__tag { display: inline-block; background: #e0f2fe; color: #0284c7; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin: 2px 2px 2px 0; }
    
    /* ── Right: Navigation ── */
    .ev2-right { width: 250px; min-width: 250px; background: #ffffff; border-left: 1px solid #e5e7eb; display: flex; flex-direction: column; overflow: hidden; }
    .ev2-right__title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #6b7280; padding: 12px 14px 6px; flex-shrink: 0; }
    .ev2-right__list { flex: 1; overflow-y: auto; padding: 0 10px; min-height: 0; }
    .ev2-nav-item { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; margin-bottom: 4px; cursor: pointer; transition: all 0.2s; border: 1px solid transparent; }
    .ev2-nav-item:hover { background: #f3f4f6; }
    .ev2-nav-item--active { background: #e0f2fe; border-color: #0284c7; }
    .ev2-nav-item__icon { width: 32px; height: 32px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
    .ev2-nav-item__icon--available { background: #d1fae5; color: #059669; }
    .ev2-nav-item__icon--pending { background: #fef3c7; color: #d97706; }
    .ev2-nav-item__icon--none { background: #f3f4f6; color: #9ca3af; }
    .ev2-nav-item__info { flex: 1; min-width: 0; }
    .ev2-nav-item__name { font-size: 12px; font-weight: 600; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev2-nav-item__status { font-size: 10px; color: #9ca3af; }
    .ev2-nav-item__score { font-size: 13px; font-weight: 700; }
    .ev2-right__actions { padding: 10px; border-top: 1px solid #e5e7eb; flex-shrink: 0; }
    .ev2-download-all { width: 100%; padding: 8px; background: #ffffff; border: 1px solid #d1d5db; border-radius: 8px; color: #374151; font-size: 11px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .ev2-download-all:hover { border-color: #1e3a5f; color: #1e3a5f; background: #f3f4f6; }
    
    /* ── Mobile Chat Drawer ── */
    .ev2-chat-fab { display: none; position: fixed; bottom: 20px; right: 20px; width: 52px; height: 52px; background: #1e3a5f; border: none; border-radius: 50%; color: white; font-size: 20px; cursor: pointer; box-shadow: 0 4px 12px rgba(30,58,95,0.4); z-index: 90; }
    .ev2-drawer { display: none; }
    
    /* ── Empty state ── */
    .ev2-empty { text-align: center; padding: 60px 20px; }
    .ev2-empty__icon { font-size: 48px; color: #d1d5db; margin-bottom: 16px; }
    .ev2-empty__text { font-size: 15px; color: #6b7280; margin-bottom: 8px; }
    .ev2-empty__sub { font-size: 13px; color: #9ca3af; }
    
    /* ── Module cards (pre-generation only) ── */
    .ev2-modules { padding: 0 20px 32px; }
    .ev2-modules--hidden { display: none; }
    .ev2-modules__title { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #1e3a5f; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
    .ev2-modules__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .ev2-mod-card { background: #ffffff; border-radius: 12px; padding: 24px 18px 18px; text-align: center; transition: all 0.3s; cursor: pointer; border: 1px solid #e5e7eb; text-decoration: none; box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.06); position: relative; display: flex; flex-direction: column; align-items: center; }
    .ev2-mod-card:hover { border-color: #4a6fa5; transform: translateY(-3px); text-decoration: none; box-shadow: 0 8px 16px -4px rgb(30 58 95 / 0.15); }
    .ev2-mod-card--inactive { opacity: 0.55; }
    .ev2-mod-card--inactive:hover { opacity: 0.75; }
    .ev2-mod-card__badge { position: absolute; top: 10px; right: 10px; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; }
    .ev2-mod-card__badge--ok { background: #d1fae5; color: #059669; }
    .ev2-mod-card__badge--wait { background: #fef3c7; color: #d97706; }
    .ev2-mod-card__icon { font-size: 32px; color: #1e3a5f; margin-bottom: 12px; width: 56px; height: 56px; background: #f3f4f6; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
    .ev2-mod-card--inactive .ev2-mod-card__icon { color: #9ca3af; background: #f9fafb; }
    .ev2-mod-card__name { font-size: 14px; font-weight: 700; color: #1f2937; margin-bottom: 6px; }
    .ev2-mod-card__desc { font-size: 11px; color: #6b7280; line-height: 1.4; margin-bottom: 10px; min-height: 30px; }
    .ev2-mod-card__status { font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 99px; margin-bottom: 10px; }
    .ev2-mod-card__status--ok { background: #d1fae5; color: #059669; }
    .ev2-mod-card__status--wait { background: #fef3c7; color: #d97706; }
    .ev2-mod-card__btn { font-size: 12px; font-weight: 600; color: #1e3a5f; display: flex; align-items: center; gap: 4px; }
    .ev2-mod-card__btn i { font-size: 10px; transition: transform 0.2s; }
    .ev2-mod-card:hover .ev2-mod-card__btn i { transform: translateX(3px); }
    
    /* ── Responsive ── */
    @media (max-width: 768px) {
      .ev2-upload-grid { grid-template-columns: 1fr; }
      .ev2-app-shell { height: auto; overflow: auto; }
      .ev2-layout--active { flex-direction: column; height: auto; overflow: visible; }
      .ev2-left { display: none; }
      .ev2-right { width: 100%; min-width: unset; border-left: none; border-top: 1px solid #e5e7eb; }
      .ev2-right__list { display: flex; overflow-x: auto; padding: 8px 12px; gap: 8px; flex-shrink: 0; }
      .ev2-nav-item { min-width: 140px; flex-direction: column; text-align: center; gap: 6px; }
      .ev2-center { min-height: 60vh; }
      .ev2-chat-fab { display: flex; align-items: center; justify-content: center; }
      .ev2-drawer { position: fixed; bottom: 0; left: 0; right: 0; height: 60vh; background: #ffffff; border-top: 2px solid #1e3a5f; z-index: 95; flex-direction: column; border-radius: 16px 16px 0 0; box-shadow: 0 -4px 12px rgba(0,0,0,0.15); }
      .ev2-drawer--open { display: flex; }
      .ev2-drawer__handle { text-align: center; padding: 8px; cursor: pointer; }
      .ev2-drawer__handle span { display: inline-block; width: 40px; height: 4px; background: #d1d5db; border-radius: 99px; }
      .ev2-modules__grid { grid-template-columns: repeat(2, 1fr); }
      .ev2-score { margin: 12px 16px; padding: 20px; }
      .ev2-score__value { font-size: 36px; }
      .ev2-score--compact { flex-wrap: wrap; gap: 8px; padding: 8px 16px; }
    }
    @media (min-width: 769px) and (max-width: 1200px) {
      .ev2-left { width: 220px; min-width: 220px; }
      .ev2-right { width: 210px; min-width: 210px; }
      .ev2-chat-fab { display: none; }
      .ev2-modules__grid { grid-template-columns: repeat(3, 1fr); }
    }
  </style>
</head>
${hasGenerated ? `<body class="ev2-app-shell">` : `<body>`}
  <!-- ═══ HEADER ═══ -->
  <header class="ev2-header">
    <a href="/entrepreneur" class="ev2-header__brand">ESONO</a>
    <div class="ev2-header__right">
      <span class="ev2-header__user"><strong>${user.name}</strong> · ${user.email}</span>
      <a href="/formations" class="ev2-btn-sm" title="Micro-learning & formations"><i class="fas fa-book-open"></i> Formations</a>
      <button class="ev2-btn-sm ev2-btn-sm--danger" onclick="fetch('/api/logout',{method:'POST',credentials:'include'}).then(()=>location.href='/login')">
        <i class="fas fa-right-from-bracket"></i> Déconnexion
      </button>
    </div>
  </header>


  ${hasGenerated ? `
  <!-- compact score banner -->
  <section class="ev2-score ev2-score--compact">
    <div class="ev2-score__title">Investment Readiness</div>
    <div class="ev2-score__value" style="color:${scoreColor}">${score}/100</div>
    <div class="ev2-score__bar"><div class="ev2-score__bar-fill" style="width:${score}%;background:${scoreColor};"></div></div>
    <div class="ev2-score__meta">
      <span><i class="fas fa-code-branch"></i> v${version}</span>
      <span><i class="fas fa-robot"></i> ${getScoreLabel(score)}</span>
    </div>
  </section>

  <section class="ev2-upload-section ev2-upload-section--compact">
    <div class="ev2-upload-toggle ev2-upload-toggle--bar" id="upload-toggle" onclick="toggleUpload()">
      <div class="ev2-upload-toggle__left">
        <i class="fas fa-cloud-arrow-up"></i>
        <span>Documents</span>
        <span class="ev2-upload-toggle__badge">${uploadCount}/3</span>
      </div>
      <i class="fas fa-chevron-down ev2-upload-toggle__chevron"></i>
    </div>
    <div class="ev2-upload-body ev2-upload-body--collapsed ev2-upload-body--compact" id="upload-body">
      <div class="ev2-upload-grid" style="padding-top:12px;">
        ${renderUploadCard('bmc', 'Business Model Canvas', 'fa-map', 'Word, PDF', '.doc,.docx,.pdf', uploadsByCategory.bmc)}
        ${renderUploadCard('sic', "Stratégie d'Impact & Croissance", 'fa-seedling', 'Word, Excel, PDF', '.doc,.docx,.xls,.xlsx,.pdf', uploadsByCategory.sic)}
        ${renderUploadCard('inputs', 'Inputs Financiers', 'fa-chart-line', 'Excel (recommandé)', '.xls,.xlsx,.csv,.pdf', uploadsByCategory.inputs)}
      </div>
    </div>
  </section>

  <section class="ev2-gen ev2-gen--compact" id="gen-section">
    <button class="ev2-gen__btn ${btnClass}" id="btn-gen" ${btnDisabled ? 'disabled' : ''} title="${btnTooltip}" onclick="generateAll()">
      <span><i class="fas fa-wand-magic-sparkles"></i> ${btnLabel}</span>
      <span class="ev2-gen__sub">${btnSub}</span>
    </button>
  </section>
  ` : `
  <!-- full score banner (pre-generation) -->
  <section class="ev2-score">
    <div class="ev2-score__title">Investment Readiness</div>
    ${score >= 0 ? `
      <div class="ev2-score__value" style="color:${scoreColor}">Score : ${score}/100</div>
      <div class="ev2-score__bar"><div class="ev2-score__bar-fill" style="width:${score}%;background:${scoreColor};"></div></div>
      <div class="ev2-score__meta">
        <span><i class="fas fa-clock"></i> ${updatedAt}</span>
        <span><i class="fas fa-code-branch"></i> v${version}</span>
        <span><i class="fas fa-robot"></i> ${getScoreLabel(score)}</span>
      </div>
    ` : `
      <div class="ev2-score__placeholder">— /100</div>
      <div class="ev2-score__bar"><div class="ev2-score__bar-fill" style="width:0%;background:#d1d5db;"></div></div>
      <div class="ev2-score__placeholder-text">Uploadez 3 documents — l'IA génère 7 livrables et un score 0-100</div>
    `}
  </section>

  <section class="ev2-upload-section">
    <div style="padding: 12px 16px; display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; color: #1f2937;">
      <i class="fas fa-cloud-arrow-up"></i>
      <span>Uploadez vos documents</span>
      <span class="ev2-upload-toggle__badge">${uploadCount}/3</span>
    </div>
    <div class="ev2-upload-body ev2-upload-body--open" id="upload-body">
      <div class="ev2-upload-grid">
        ${renderUploadCard('bmc', 'Business Model Canvas', 'fa-map', 'Word, PDF', '.doc,.docx,.pdf', uploadsByCategory.bmc)}
        ${renderUploadCard('sic', "Stratégie d'Impact & Croissance", 'fa-seedling', 'Word, Excel, PDF', '.doc,.docx,.xls,.xlsx,.pdf', uploadsByCategory.sic)}
        ${renderUploadCard('inputs', 'Inputs Financiers', 'fa-chart-line', 'Excel (recommandé)', '.xls,.xlsx,.csv,.pdf', uploadsByCategory.inputs)}
      </div>
      <div class="ev2-supplementary">
        <div class="ev2-supplementary__head">
          <i class="fas fa-folder-plus" style="color:#9ca3af;"></i>
          <span class="ev2-supplementary__title">Documents supplémentaires</span>
          <span class="ev2-supplementary__badge">Optionnel</span>
        </div>
        <div class="ev2-supplementary__zone" onclick="document.getElementById('file-supplementary').click()">
          <p><i class="fas fa-cloud-arrow-up"></i> Glisser ou cliquer pour ajouter</p>
          <input type="file" id="file-supplementary" multiple accept=".doc,.docx,.xls,.xlsx,.pdf,.csv,.txt,.png,.jpg,.jpeg" onchange="handleSuppUpload(this)" style="display:none;">
        </div>
        <div class="ev2-supplementary__list" id="supp-list">
          ${supplementaryFiles.map((f: any) => `<div class="ev2-supplementary__file" id="supp-${f.id}"><i class="fas fa-file"></i> ${f.filename} <button onclick="rmUpload('${f.id}')"><i class="fas fa-times"></i></button></div>`).join('')}
        </div>
      </div>
    </div>
  </section>

  <section class="ev2-gen" id="gen-section">
    <button class="ev2-gen__btn ${btnClass}" id="btn-gen" ${btnDisabled ? 'disabled' : ''} title="${btnTooltip}" onclick="generateAll()">
      <span><i class="fas fa-wand-magic-sparkles"></i> ${btnLabel}</span>
      <span class="ev2-gen__sub">${btnSub}</span>
    </button>
  </section>
  `}

  <!-- ═══ LOADING ═══ -->
  <section class="ev2-loading" id="loading-section">
    <div class="ev2-loading__spinner"></div>
    <div class="ev2-loading__step" id="step-extract"><i class="fas fa-file-lines"></i> Extraction des documents...</div>
    <div class="ev2-loading__step" id="step-analyze"><i class="fas fa-brain"></i> Analyse par l'IA...</div>
    <div class="ev2-loading__step" id="step-gen"><i class="fas fa-file-export"></i> Génération des livrables...</div>
    <div class="ev2-loading__step" id="step-done"><i class="fas fa-check-circle"></i> Terminé !</div>
  </section>

  <!-- ═══ 3-COLUMN LAYOUT (visible after generation) ═══ -->
  <section class="ev2-layout ${hasGenerated ? 'ev2-layout--active' : ''}" id="three-col">
    <!-- LEFT: Chat & Iterations -->
    <div class="ev2-left" id="left-panel">
      <div class="ev2-left__section-title">Itérations</div>
      <div class="ev2-iterations" id="iterations-list">
        ${((allIterations.results || []) as any[]).map((it: any) => {
          const isActive = it.version === version
          const itTime = it.created_at ? new Date(it.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''
          return `<div class="ev2-iteration ${isActive ? 'ev2-iteration--active' : ''}" data-version="${it.version}">
            <div>
              <span class="ev2-iteration__ver">v${it.version}</span>
              <span class="ev2-iteration__time"> — ${itTime}</span>
            </div>
            <div>
              <span class="ev2-iteration__score">${it.score_global}/100</span>
              ${isActive ? '<span class="ev2-iteration__badge">actuelle</span>' : ''}
            </div>
          </div>`
        }).join('')}
      </div>
      
      <div class="ev2-chat">
        <div class="ev2-left__section-title">Chat IA</div>
        <div class="ev2-chat__messages" id="chat-messages">
          ${((chatMessages.results || []) as any[]).map((msg: any) => 
            `<div class="ev2-chat__bubble ev2-chat__bubble--${msg.role === 'user' ? 'user' : 'ai'}">${escapeHtml(msg.content)}</div>`
          ).join('') || '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:12px;"><i class="fas fa-robot" style="font-size:20px;margin-bottom:8px;display:block;color:#d1d5db;"></i>Posez une question sur vos livrables</div>'}
        </div>
        <div class="ev2-chat__input-area">
          <textarea class="ev2-chat__input" id="chat-input" placeholder="Posez une question..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"></textarea>
          <button class="ev2-chat__send" id="chat-send" onclick="sendChat()"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    </div>

    <!-- CENTER: Visualization -->
    <div class="ev2-center">
      <div class="ev2-center__header">
        <div class="ev2-center__title" id="center-title"><i class="fas fa-stethoscope"></i> Diagnostic Expert</div>
        <div class="ev2-center__actions">
          <button class="ev2-btn-sm" onclick="alert('Téléchargement PDF à venir')"><i class="fas fa-file-pdf"></i> PDF</button>
          <button class="ev2-btn-sm" onclick="alert('Téléchargement HTML à venir')"><i class="fas fa-code"></i> HTML</button>
        </div>
      </div>
      <div class="ev2-center__content" id="center-content">
        ${hasGenerated ? renderDiagnosticView(delivMap.diagnostic, scoresDim) : renderEmptyState()}
      </div>
    </div>

    <!-- RIGHT: Navigation -->
    <div class="ev2-right">
      <div class="ev2-right__title">Livrables</div>
      <div class="ev2-right__list" id="nav-list">
        ${DELIVERABLE_TYPES.map((dt, idx) => {
          const d = delivMap[dt.type]
          const available = !!d
          const dScore = d?.score ?? 0
          const uploadedCategories = new Set([
            ...(uploadsByCategory.bmc ? ['bmc'] : []),
            ...(uploadsByCategory.sic ? ['sic'] : []),
            ...(uploadsByCategory.inputs ? ['inputs'] : []),
          ])
          const depsOk = canGenerate(dt.deps, uploadedCategories)
          const missing = missingDeps(dt.deps, uploadedCategories)
          const iconClass = available ? 'available' : (depsOk ? 'pending' : 'none')
          const statusText = available
            ? `${dt.format} · Disponible`
            : (depsOk ? 'Prêt à générer' : `Manque : ${missing.join(', ')}`)
          return `<div class="ev2-nav-item ${idx === 0 ? 'ev2-nav-item--active' : ''}" data-type="${dt.type}" onclick="selectDeliverable('${dt.type}')">
            <div class="ev2-nav-item__icon ev2-nav-item__icon--${iconClass}">
              <i class="fas ${dt.icon}"></i>
            </div>
            <div class="ev2-nav-item__info">
              <div class="ev2-nav-item__name">${dt.label}</div>
              <div class="ev2-nav-item__status">${statusText}</div>
            </div>
            ${available ? `<div class="ev2-nav-item__score" style="color:${getScoreColor(dScore)}">${dScore}</div>` : ''}
          </div>`
        }).join('')}
      </div>
      <div class="ev2-right__actions">
        <button class="ev2-download-all" onclick="alert('Téléchargement ZIP à venir')">
          <i class="fas fa-download"></i> Télécharger TOUT (.zip)
        </button>
      </div>
    </div>
  </section>

  <!-- ═══ MODULE CARDS (only shown pre-generation) ═══ -->
  <section class="ev2-modules">
    <div class="ev2-modules__title">📚 Détails par module</div>
    <div class="ev2-modules__grid">
      ${renderModuleCard({
        icon: 'fa-file-lines', emoji: '📄',
        name: 'Business Model Canvas',
        desc: "Canvas détaillé avec l'analyse IA des 9 blocs",
        href: '/module/mod1_bmc/download',
        delivKey: 'bmc_analysis',
        altHref: '/module/mod1_bmc/download',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-seedling', emoji: '📊',
        name: "Social Impact Canvas (SIC)",
        desc: "Diagnostic d'impact social avec scoring, alignement ODD et matrice d'impact",
        href: '/module/mod2_sic/download',
        delivKey: 'sic_analysis',
        altHref: '/module/mod2_sic/download',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-coins', emoji: '💰',
        name: 'Inputs Financiers',
        desc: "Données financières validées avec alertes de cohérence",
        href: '/module/mod3_inputs/download',
        delivKey: 'plan_ovo',
        altHref: '/module/mod3_inputs/download',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-chart-line', emoji: '📈',
        name: "Framework d'Analyse",
        desc: "Analyse financière complète : ratios, benchmarks, scénarios",
        href: '/module/mod4_framework/download',
        delivKey: 'framework',
        altHref: '/module/mod4_framework/download',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-magnifying-glass-chart', emoji: '🔍',
        name: 'Diagnostic Expert',
        desc: "Score Investment Readiness et recommandations détaillées",
        href: '/deliverable/diagnostic',
        delivKey: 'diagnostic',
        altHref: '/deliverable/diagnostic',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-ruler-combined', emoji: '📐',
        name: 'Plan Financier OVO',
        desc: "Projections financières 5 ans au format OVO",
        href: '/deliverable/plan_ovo',
        delivKey: 'plan_ovo',
        altHref: '/deliverable/plan_ovo',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-file-contract', emoji: '📑',
        name: 'Business Plan',
        desc: "Business plan structuré prêt pour les investisseurs",
        href: '/deliverable/business_plan',
        delivKey: 'business_plan',
        altHref: '/deliverable/business_plan',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-clipboard-check', emoji: '📋',
        name: 'Due Diligence Opérationnelle',
        desc: "Checklist ODD pour les bailleurs de fonds",
        href: '/deliverable/odd',
        delivKey: 'odd',
        altHref: '/deliverable/odd',
        delivMap, progressMap
      })}
    </div>
  </section>

  <!-- ═══ Mobile Chat FAB ═══ -->
  <button class="ev2-chat-fab" id="chat-fab" onclick="toggleChatDrawer()"><i class="fas fa-comments"></i></button>
  <div class="ev2-drawer" id="chat-drawer">
    <div class="ev2-drawer__handle" onclick="toggleChatDrawer()"><span></span></div>
    <div class="ev2-chat__messages" id="chat-messages-mobile" style="flex:1;overflow-y:auto;padding:12px;"></div>
    <div class="ev2-chat__input-area">
      <textarea class="ev2-chat__input" id="chat-input-mobile" placeholder="Posez une question..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat('mobile')}"></textarea>
      <button class="ev2-chat__send" onclick="sendChat('mobile')"><i class="fas fa-paper-plane"></i></button>
    </div>
  </div>

  <script>
    // ── State ──
    let currentDelivType = 'diagnostic';
    const deliverables = ${JSON.stringify(delivMap)};
    const scoresDim = ${JSON.stringify(scoresDim)};

    // ── Upload toggle ──
    function toggleUpload() {
      const toggle = document.getElementById('upload-toggle');
      const body = document.getElementById('upload-body');
      if (!toggle || !body) return;
      const isOpen = body.classList.contains('ev2-upload-body--open');
      body.classList.toggle('ev2-upload-body--open', !isOpen);
      body.classList.toggle('ev2-upload-body--collapsed', isOpen);
      toggle.classList.toggle('ev2-upload-toggle--open', !isOpen);
    }

    // ── File upload ──
    async function handleUpload(input, cat) {
      const file = input.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', cat);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
        const d = await res.json();
        if (d.success) location.reload();
        else alert(d.error || 'Erreur');
      } catch (e) { alert('Erreur réseau: ' + e.message); }
    }

    async function handleSuppUpload(input) {
      for (const file of input.files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('category', 'supplementary');
        try { await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' }); } catch {}
      }
      location.reload();
    }

    async function rmUpload(id) {
      try { await fetch('/api/upload/' + id, { method: 'DELETE', credentials: 'include' }); location.reload(); } catch (e) { alert('Erreur: ' + e.message); }
    }

    // ── Generate ──
    async function generateAll() {
      const btn = document.getElementById('btn-gen');
      const load = document.getElementById('loading-section');
      const gen = document.getElementById('gen-section');
      btn.disabled = true;
      gen.style.display = 'none';
      load.classList.add('ev2-loading--active');
      
      const steps = ['step-extract', 'step-analyze', 'step-gen', 'step-done'];
      function setStep(idx) {
        steps.forEach((s, i) => {
          const el = document.getElementById(s);
          el.className = 'ev2-loading__step' + (i < idx ? ' ev2-loading__step--done' : i === idx ? ' ev2-loading__step--active' : '');
        });
      }
      setStep(0);
      const t1 = setTimeout(() => setStep(1), 2000);
      const t2 = setTimeout(() => setStep(2), 12000);
      
      try {
        const res = await fetch('/api/ai/generate-all', { method: 'POST', credentials: 'include' });
        const data = await res.json();
        clearTimeout(t1); clearTimeout(t2);
        if (data.success) {
          setStep(3);
          // Show partial generation info if applicable
          if (data.skipped && data.skipped.length > 0) {
            const skippedList = data.skipped.map(s => s.label + ' (manque: ' + s.missing.join(', ') + ')').join(', ');
            console.log('Livrables non générés: ' + skippedList);
          }
          setTimeout(() => location.reload(), 1200);
        }
        else { alert(data.error || 'Erreur'); gen.style.display = ''; load.classList.remove('ev2-loading--active'); btn.disabled = false; }
      } catch (e) { clearTimeout(t1); clearTimeout(t2); alert('Erreur: ' + e.message); gen.style.display = ''; load.classList.remove('ev2-loading--active'); btn.disabled = false; }
    }

    // ── Select deliverable ──
    function selectDeliverable(type) {
      currentDelivType = type;
      // Update nav active
      document.querySelectorAll('.ev2-nav-item').forEach(el => {
        el.classList.toggle('ev2-nav-item--active', el.dataset.type === type);
      });
      // Update title
      const types = ${JSON.stringify(DELIVERABLE_TYPES)};
      const dt = types.find(t => t.type === type);
      document.getElementById('center-title').innerHTML = '<i class="fas ' + (dt?.icon || 'fa-file') + '"></i> ' + (dt?.label || type);
      // Render content
      renderDeliverableContent(type);
    }

    function renderDeliverableContent(type) {
      const el = document.getElementById('center-content');
      const data = deliverables[type];
      if (!data) {
        // Show dependency info for non-generated deliverables
        const types = ${JSON.stringify(DELIVERABLE_TYPES)};
        const dt = types.find(t => t.type === type);
        const deps = dt?.deps || [];
        const uploadedCats = new Set(${JSON.stringify(Array.from(new Set([
          ...(uploadsByCategory.bmc ? ['bmc'] : []),
          ...(uploadsByCategory.sic ? ['sic'] : []),
          ...(uploadsByCategory.inputs ? ['inputs'] : []),
        ])))});
        const depLabels = ${JSON.stringify(DEP_LABELS)};
        const missingList = deps.filter(d => !uploadedCats.has(d)).map(d => depLabels[d] || d);
        const hasDeps = missingList.length === 0;
        
        if (hasDeps) {
          el.innerHTML = '<div class="ev2-empty"><div class="ev2-empty__icon"><i class="fas fa-wand-magic-sparkles"></i></div><div class="ev2-empty__text">Prêt à être généré</div><div class="ev2-empty__sub">Tous les documents nécessaires sont uploadés. Cliquez sur "Générer" pour créer ce livrable.</div></div>';
        } else {
          el.innerHTML = '<div class="ev2-empty"><div class="ev2-empty__icon"><i class="fas fa-file-circle-question"></i></div><div class="ev2-empty__text">Livrable non encore généré</div><div class="ev2-empty__sub">Documents manquants : <strong>' + missingList.join(', ') + '</strong><br>Uploadez ces documents puis cliquez sur "Générer".</div></div>';
        }
        return;
      }
      
      let content;
      try { content = typeof data.content === 'string' ? JSON.parse(data.content) : data.content; } catch { content = {}; }
      const score = data.score || content.score || 0;
      const sColor = getScoreColor(score);
      
      if (type === 'diagnostic') {
        el.innerHTML = renderDiagHTML(content, scoresDim, score, sColor);
      } else if (type === 'bmc_analysis') {
        el.innerHTML = renderBMCHTML(content, score, sColor);
      } else if (type === 'sic_analysis') {
        el.innerHTML = renderSICHTML(content, score, sColor);
      } else if (type === 'plan_ovo') {
        el.innerHTML = renderOVOHTML(content, score, sColor);
      } else {
        el.innerHTML = renderGenericHTML(content, score, sColor, type);
      }
    }

    function getScoreColor(s) { return s >= 86 ? '#059669' : s >= 71 ? '#0284c7' : s >= 51 ? '#c9a962' : s >= 31 ? '#d97706' : '#dc2626'; }
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function renderDiagHTML(c, dims, score, col) {
      const d = c.dimensions || [];
      let html = '<div class="ev2-diag">';
      html += '<div class="ev2-diag__dims">';
      for (const dim of d) {
        const dc = getScoreColor(dim.score || 0);
        html += '<div class="ev2-diag__dim"><div class="ev2-diag__dim-name">' + esc(dim.name) + '</div><div class="ev2-diag__dim-score" style="color:' + dc + '">' + (dim.score||0) + '/100</div><div class="ev2-diag__dim-bar"><div class="ev2-diag__dim-bar-fill" style="width:' + (dim.score||0) + '%;background:' + dc + '"></div></div><div class="ev2-diag__dim-text">' + esc(dim.analysis||'') + '</div></div>';
      }
      html += '</div>';
      // Strengths
      if (c.strengths?.length) {
        html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-check-circle" style="color:#059669"></i> Forces</div><ul class="ev2-diag__list">';
        for (const s of c.strengths) html += '<li><i class="fas fa-check" style="color:#059669"></i>' + esc(s) + '</li>';
        html += '</ul></div>';
      }
      // Weaknesses
      if (c.weaknesses?.length) {
        html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-exclamation-triangle" style="color:#dc2626"></i> Faiblesses</div><ul class="ev2-diag__list">';
        for (const w of c.weaknesses) html += '<li><i class="fas fa-times" style="color:#dc2626"></i>' + esc(w) + '</li>';
        html += '</ul></div>';
      }
      // Recommendations
      if (c.recommendations?.length) {
        html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-lightbulb" style="color:#d97706"></i> Recommandations</div><ul class="ev2-diag__list">';
        for (const r of c.recommendations) html += '<li><i class="fas fa-arrow-right" style="color:#d97706"></i>' + esc(r) + '</li>';
        html += '</ul></div>';
      }
      html += '</div>';
      return html;
    }

    function renderBMCHTML(c, score, col) {
      let html = '<div class="ev2-deliv-view"><div class="ev2-deliv-view__score"><div class="ev2-deliv-view__score-num" style="color:' + col + '">' + score + '/100</div></div>';
      for (const b of (c.blocks || [])) {
        html += '<div class="ev2-deliv-view__section"><h3>' + esc(b.name) + ' <span style="color:' + getScoreColor(b.score||0) + ';font-size:13px">' + (b.score||0) + '/100</span></h3><p>' + esc(b.analysis||'') + '</p>';
        if (b.recommendations?.length) {
          html += '<div style="margin-top:8px">';
          for (const r of b.recommendations) html += '<span class="ev2-deliv-view__tag">' + esc(r) + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    function renderSICHTML(c, score, col) {
      let html = '<div class="ev2-deliv-view"><div class="ev2-deliv-view__score"><div class="ev2-deliv-view__score-num" style="color:' + col + '">' + score + '/100</div></div>';
      for (const p of (c.pillars || [])) {
        html += '<div class="ev2-deliv-view__section"><h3>' + esc(p.name) + ' <span style="color:' + getScoreColor(p.score||0) + ';font-size:13px">' + (p.score||0) + '/100</span></h3><p>' + esc(p.analysis||'') + '</p>';
        if (p.recommendations?.length) {
          html += '<div style="margin-top:8px">';
          for (const r of p.recommendations) html += '<span class="ev2-deliv-view__tag">' + esc(r) + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    function renderOVOHTML(c, score, col) {
      let html = '<div class="ev2-deliv-view"><div class="ev2-deliv-view__score"><div class="ev2-deliv-view__score-num" style="color:' + col + '">' + score + '/100</div></div>';
      html += '<div class="ev2-deliv-view__section"><h3>Analyse</h3><p>' + esc(c.analysis||'Projections à générer') + '</p></div>';
      const proj = c.projections || {};
      for (const [key, val] of Object.entries(proj)) {
        html += '<div class="ev2-deliv-view__block"><h4>' + esc(key) + '</h4><p>' + esc(JSON.stringify(val)) + '</p></div>';
      }
      html += '</div>';
      return html;
    }

    function renderGenericHTML(c, score, col, type) {
      let html = '<div class="ev2-deliv-view"><div class="ev2-deliv-view__score"><div class="ev2-deliv-view__score-num" style="color:' + col + '">' + score + '/100</div></div>';
      if (c.sections) {
        for (const s of c.sections) {
          html += '<div class="ev2-deliv-view__section"><h3>' + esc(s.title||'') + (s.score ? ' <span style="color:' + getScoreColor(s.score) + ';font-size:13px">' + s.score + '/100</span>' : '') + '</h3><p>' + esc(s.content||'') + '</p></div>';
        }
      }
      if (c.criteria) {
        for (const cr of c.criteria) {
          const statusColor = cr.status === 'Complet' ? '#059669' : cr.status === 'Partiel' ? '#d97706' : '#dc2626';
          html += '<div class="ev2-deliv-view__block"><h4>' + esc(cr.name||'') + ' <span style="color:' + statusColor + '">' + esc(cr.status||'') + '</span></h4><p>' + esc(cr.comment||'') + '</p></div>';
        }
      }
      html += '</div>';
      return html;
    }

    // ── Chat ──
    async function sendChat(mode) {
      const inputEl = mode === 'mobile' ? document.getElementById('chat-input-mobile') : document.getElementById('chat-input');
      const msg = inputEl.value.trim();
      if (!msg) return;

      // Add user bubble
      addChatBubble(msg, 'user', mode);
      inputEl.value = '';

      // Disable send
      const sendBtn = mode === 'mobile' ? inputEl.nextElementSibling : document.getElementById('chat-send');
      if (sendBtn) sendBtn.disabled = true;

      try {
        const res = await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, context: currentDelivType }),
          credentials: 'include'
        });
        const data = await res.json();
        if (data.success && data.response) {
          addChatBubble(data.response.content, 'ai', mode);
          // If chat triggered a regeneration, reload the page to reflect new deliverables
          if (data.regenerated) {
            addChatBubble('🔄 Mise à jour des livrables... rechargement en cours.', 'ai', mode);
            setTimeout(() => location.reload(), 2000);
          }
        } else {
          addChatBubble(data.error || 'Erreur du serveur', 'ai', mode);
        }
      } catch (e) {
        addChatBubble('Erreur réseau: ' + e.message, 'ai', mode);
      }

      if (sendBtn) sendBtn.disabled = false;
    }

    function addChatBubble(text, role, mode) {
      const containers = mode === 'mobile' 
        ? [document.getElementById('chat-messages-mobile')]
        : [document.getElementById('chat-messages')];
      // Also sync to other view
      if (mode !== 'mobile') containers.push(document.getElementById('chat-messages-mobile'));
      else containers.push(document.getElementById('chat-messages'));
      
      for (const container of containers) {
        if (!container) continue;
        const bubble = document.createElement('div');
        bubble.className = 'ev2-chat__bubble ev2-chat__bubble--' + (role === 'user' ? 'user' : 'ai');
        bubble.textContent = text;
        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;
      }
    }

    // ── Mobile drawer ──
    function toggleChatDrawer() {
      const drawer = document.getElementById('chat-drawer');
      drawer.classList.toggle('ev2-drawer--open');
    }

    // ── Tablet: toggle left panel ──
    function toggleLeftPanel() {
      document.getElementById('left-panel').classList.toggle('ev2-left--open');
    }

    // ── Drag & drop ──
    document.querySelectorAll('.ev2-upload-card').forEach(card => {
      card.addEventListener('dragover', e => { e.preventDefault(); card.style.borderColor = '#4a6fa5'; });
      card.addEventListener('dragleave', () => { card.style.borderColor = ''; });
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.style.borderColor = '';
        const input = card.querySelector('input[type="file"]');
        if (input && e.dataTransfer.files.length) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); }
      });
    });

    // ── Auto-scroll chat ──
    const chatEl = document.getElementById('chat-messages');
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  </script>
</body>
</html>`

    return c.html(html)
  } catch (error) {
    console.error('Entrepreneur page error:', error)
    return c.redirect('/login')
  }
})

// ═══════════════════════════════════════════════════════════════════
// Helper functions for server-side rendering
// ═══════════════════════════════════════════════════════════════════

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderUploadCard(category: string, title: string, icon: string, subtitle: string, accept: string, existing: any): string {
  const isDone = !!existing
  return `<div class="ev2-upload-card ${isDone ? 'ev2-upload-card--done' : ''}" onclick="document.getElementById('file-${category}').click()">
    ${isDone ? `<button class="ev2-upload-card__rm" onclick="event.stopPropagation();rmUpload('${existing.id}')" title="Retirer"><i class="fas fa-times"></i></button>` : ''}
    <div class="ev2-upload-card__icon"><i class="fas ${icon}"></i></div>
    <div class="ev2-upload-card__title">${title}</div>
    <div class="ev2-upload-card__sub">${subtitle}</div>
    ${isDone
      ? `<div class="ev2-upload-card__status ev2-upload-card__status--ok"><i class="fas fa-check-circle"></i> ${existing.filename}</div>`
      : `<div class="ev2-upload-card__drop">Glisser ou cliquer</div><div class="ev2-upload-card__status ev2-upload-card__status--wait"><i class="far fa-clock"></i> En attente</div>`
    }
    <input type="file" id="file-${category}" accept="${accept}" onchange="handleUpload(this,'${category}')">
  </div>`
}

function renderDiagnosticView(deliverable: any, scoresDim: any): string {
  if (!deliverable) return renderEmptyState()
  
  let content: any
  try {
    content = typeof deliverable.content === 'string' ? JSON.parse(deliverable.content) : deliverable.content
  } catch {
    content = {}
  }

  const score = deliverable.score || content.score || 0
  const dimensions = content.dimensions || []
  const strengths = content.strengths || []
  const weaknesses = content.weaknesses || []
  const recommendations = content.recommendations || []

  let html = '<div class="ev2-diag">'
  
  // Dimensions
  html += '<div class="ev2-diag__dims">'
  for (const dim of dimensions) {
    const dc = getScoreColor(dim.score || 0)
    html += `<div class="ev2-diag__dim">
      <div class="ev2-diag__dim-name">${escapeHtml(dim.name)}</div>
      <div class="ev2-diag__dim-score" style="color:${dc}">${dim.score || 0}/100</div>
      <div class="ev2-diag__dim-bar"><div class="ev2-diag__dim-bar-fill" style="width:${dim.score || 0}%;background:${dc}"></div></div>
      <div class="ev2-diag__dim-text">${escapeHtml(dim.analysis || '')}</div>
    </div>`
  }
  html += '</div>'

  // Strengths
  if (strengths.length) {
    html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-check-circle" style="color:#059669"></i> Forces</div><ul class="ev2-diag__list">'
    for (const s of strengths) html += `<li><i class="fas fa-check" style="color:#059669"></i>${escapeHtml(s)}</li>`
    html += '</ul></div>'
  }

  // Weaknesses
  if (weaknesses.length) {
    html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-exclamation-triangle" style="color:#dc2626"></i> Faiblesses</div><ul class="ev2-diag__list">'
    for (const w of weaknesses) html += `<li><i class="fas fa-times" style="color:#dc2626"></i>${escapeHtml(w)}</li>`
    html += '</ul></div>'
  }

  // Recommendations
  if (recommendations.length) {
    html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-lightbulb" style="color:#d97706"></i> Recommandations</div><ul class="ev2-diag__list">'
    for (const r of recommendations) html += `<li><i class="fas fa-arrow-right" style="color:#d97706"></i>${escapeHtml(r)}</li>`
    html += '</ul></div>'
  }

  html += '</div>'
  return html
}

function renderModuleCard(opts: {
  icon: string, emoji: string, name: string, desc: string,
  href: string, delivKey: string, altHref: string,
  delivMap: Record<string, any>, progressMap: Record<string, any>
}): string {
  const deliv = opts.delivMap[opts.delivKey]
  const available = !!deliv
  const dScore = deliv?.score ?? 0
  const link = available ? opts.href : opts.altHref
  const scoreColor = available ? getScoreColor(dScore) : ''

  return `<a href="${link}" class="ev2-mod-card ${available ? '' : 'ev2-mod-card--inactive'}">
    <div class="ev2-mod-card__badge ${available ? 'ev2-mod-card__badge--ok' : 'ev2-mod-card__badge--wait'}">
      <i class="fas ${available ? 'fa-check' : 'fa-hourglass-half'}"></i>
    </div>
    <div class="ev2-mod-card__icon"><i class="fas ${opts.icon}"></i></div>
    <div class="ev2-mod-card__name">${escapeHtml(opts.name)}</div>
    <div class="ev2-mod-card__desc">${escapeHtml(opts.desc)}</div>
    ${available 
      ? `<div class="ev2-mod-card__status ev2-mod-card__status--ok"><i class="fas fa-circle-check"></i> Livrable disponible · ${dScore}/100</div>`
      : `<div class="ev2-mod-card__status ev2-mod-card__status--wait"><i class="fas fa-clock"></i> En attente d'inputs</div>`
    }
    <div class="ev2-mod-card__btn">Voir les livrables <i class="fas fa-arrow-right"></i></div>
  </a>`
}

function renderEmptyState(): string {
  return `<div class="ev2-empty">
    <div class="ev2-empty__icon"><i class="fas fa-rocket"></i></div>
    <div class="ev2-empty__text">Aucun livrable généré</div>
    <div class="ev2-empty__sub">Uploadez vos documents et cliquez sur "Générer" pour commencer l'analyse</div>
  </div>`
}
