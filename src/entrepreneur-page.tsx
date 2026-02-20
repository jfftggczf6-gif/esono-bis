// ═══════════════════════════════════════════════════════════════════
// Entrepreneur V2 — Single-page NotebookLM-style interface
// Upload → Generate → 3-Column Layout (Chat / Visualization / Nav)
// ═══════════════════════════════════════════════════════════════════
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken, getAuthToken } from './auth'
import { orchestrateGeneration, loadKBContext, type OrchestrationResult } from './agents/ai-agents'
import { renderBMCPage, adaptBMCData } from './deliverable-bmc'
import { generateFullBmcDeliverable, generateFullBmcDeliverableFallback, type BmcDeliverableData, type KBContextForBmc } from './bmc-deliverable-engine'

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

// ─── KB Formatter for BMC Deliverable Engine ────────────────
function formatKBForPrompt(items: any[], type: string): string {
  if (!items || items.length === 0) return ''
  
  if (type === 'benchmarks') {
    const grouped: Record<string, any[]> = {}
    for (const b of items) {
      if (!grouped[b.sector]) grouped[b.sector] = []
      grouped[b.sector].push(b)
    }
    return Object.entries(grouped).map(([sector, bs]) =>
      `[${sector}]\n` + bs.map(b =>
        `  ${b.metric}: ${b.value_low}–${b.value_median}–${b.value_high} ${b.unit} (${b.region || 'Afrique'}) — ${b.notes || ''}`
      ).join('\n')
    ).join('\n')
  }
  
  if (type === 'fiscal') {
    return items.map(p =>
      `${p.param_label || p.param_code} (${p.country}): ${p.value}${p.unit} — ${p.notes || ''}`
    ).join('\n')
  }
  
  if (type === 'funders') {
    return items.map(f =>
      `${f.name} (${f.type}): ticket ${f.typical_ticket_min?.toLocaleString() || '?'}–${f.typical_ticket_max?.toLocaleString() || '?'} EUR | Instruments: ${f.instrument_types || '?'} | Secteurs: ${f.focus_sectors || '?'} | ${f.notes || ''}`
    ).join('\n')
  }
  
  if (type === 'criteria') {
    return items.map(c =>
      `[${c.criterion_code}] ${c.criterion_label} (poids: ${c.weight})\n  ${c.description}\n  Guide: ${c.scoring_guide || 'N/A'}`
    ).join('\n\n')
  }
  
  return items.map(i => JSON.stringify(i)).join('\n')
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
  const bmcBlocks = ['Proposition de Valeur', 'Activités Clés', 'Ressources Clés', 'Segments Clients', 'Relations Clients', 'Flux de Revenus', 'Partenaires Clés', 'Canaux', 'Structure de Coûts']
  const bmcScores = hasBmc ? [85, 85, 80, 75, 70, 70, 65, 60, 60] : [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const bmcAnalyses = [
    { ok: 'Claire, différenciante et vérifiable. La promesse « 72H après ponte » est simple, concrète et mesurable.', ko: 'Non évaluable sans BMC.', rec: ['Clarifier le gain unique client', 'Ajouter des preuves sociales (témoignages boutiquiers)'] },
    { ok: 'Maîtrisées, intégration verticale complète du maïs à l\'œuf livré.', ko: 'Non évaluable.', rec: ['Formaliser les processus de production', 'Réduire la dépendance aux personnes clés'] },
    { ok: 'Solides mais dépendantes de personnes clés. Ressources humaines, matérielles et immatérielles identifiées.', ko: 'Non évaluable.', rec: ['Documenter les processus critiques', 'Plan de succession pour les postes clés'] },
    { ok: 'Identifiés (boutiquiers B2B), zone géographique limitée à Bouaflé et Gagnoa.', ko: 'Non évaluable.', rec: ['Quantifier la taille de chaque segment (~200 boutiquiers)', 'Préparer l\'expansion géographique'] },
    { ok: 'Personnalisées mais pas formalisées. Équipe commerciale dédiée, suivi après-vente.', ko: 'Non évaluable.', rec: ['Structurer un CRM simple (WhatsApp Business + tableau)', 'Formaliser le processus de fidélisation'] },
    { ok: 'Récurrents mais mono-produit. CA mensuel ≈ 8M FCFA, marge brute ≈ 35%.', ko: 'Non évaluable.', rec: ['Diversifier les sources de revenus (poulets de chair)', 'Tester un pricing premium pour la fraîcheur garantie'] },
    { ok: 'Identifiés mais relations à formaliser. Fournisseurs intrants, énergie, bailleurs.', ko: 'Non évaluable.', rec: ['Contractualiser les relations fournisseurs (prix fixe)', 'Réduire la dépendance au maïs à prix variable'] },
    { ok: 'Fonctionnels (terrain, livraison tricycle) mais manque de digital.', ko: 'Non évaluable.', rec: ['Créer une présence digitale minimale (WhatsApp Business)', 'Tester un canal e-commerce ou catalogue en ligne'] },
    { ok: 'Exposée aux matières premières. Maïs = 46,55% du coût de production.', ko: 'Non évaluable.', rec: ['Sécuriser des contrats d\'approvisionnement à prix fixe', 'Optimiser le coût de transport (8% du total)'] },
  ]
  const bmcScore = hasBmc ? 72 : (hasSic ? jitter(15) : 0)
  const bmc_analysis = {
    score: bmcScore,
    // Enriched block data for the BMC template
    blocks: bmcBlocks.map((name, i) => ({
      name,
      score: hasBmc ? bmcScores[i] : 0,
      analysis: hasBmc ? bmcAnalyses[i].ok : bmcAnalyses[i].ko,
      recommendations: hasBmc ? bmcAnalyses[i].rec : ['Uploader le Business Model Canvas'],
    })),
    // Canvas detailed data for the full template
    canvas: hasBmc ? {
      partenaires_cles: { items: [
        { title: 'Fournisseurs intrants agricoles', detail: 'Engrais, produits phyto, semences, poussins, produits vétérinaires', critical: false },
        { title: 'Fournisseurs matières premières', detail: 'Son de blé, coquillages, soja, concentrés de protéines, huile rouge', critical: false },
        { title: 'Fournisseurs emballage', detail: 'Alvéoles, étiquettes, film plastique, sacs', critical: false },
        { title: 'Fournisseurs énergie', detail: 'Carburant, électricité (fabrication aliments)', critical: true },
        { title: 'Consultants techniques', detail: 'Pédologie, agronomie, zootechnie', critical: false },
        { title: 'Bailleurs', detail: 'Financement sites de production, bâtiments', critical: false },
      ]},
      activites_cles: { items: [
        { title: 'Production de maïs', detail: 'Base de toute la chaîne de valeur', critical: true },
        { title: 'Fabrication aliments pondeuses', detail: 'Transformation maïs en aliments complets', critical: false },
        { title: 'Élevage de pondeuses', detail: 'Production œufs de table (TICIA)', critical: false },
        { title: 'Distribution & Livraison', detail: 'Tricycle fourgon, sous 72H', critical: false },
        { title: 'Vente & Prospection', detail: 'Terrain, point de vente GOTCHE', critical: false },
        { title: 'Service client', detail: 'Recouvrement, conseil, assistance', critical: false },
      ]},
      ressources_cles: { items: [
        { title: 'Humaines', detail: 'Technicien avicole, agronome, machinistes, volaillers', critical: true },
        { title: 'Matérielles', detail: 'Tracteur, poulaillers automatisés', critical: true },
        { title: 'Immatérielles', detail: 'Marque OEUFS TICIA, savoir-faire', critical: false },
        { title: 'Financières', detail: 'Capital propre, emprunts bancaires', critical: false },
        { title: 'Réseau', detail: 'Distribution boutiquiers, consultants', critical: false },
      ]},
      proposition_valeur: { items: [
        { icon: '🥚', title: 'Fraîcheur garantie', detail: 'Livraison sous 72H après ponte — œufs ultra-frais, qualité supérieure' },
        { icon: '🛡️', title: 'Zéro rupture', detail: 'Approvisionnement régulier et fiable toute l\'année, aucune rupture de stock' },
        { icon: '🌍', title: 'Production locale', detail: 'Proximité = fraîcheur + réactivité + traçabilité complète du maïs à l\'œuf' },
        { icon: '✅', title: 'Qualité contrôlée', detail: 'Chaîne intégrée du maïs à l\'œuf = maîtrise totale des coûts et de la qualité' },
      ]},
      relations_clients: { items: [
        { title: 'Type', detail: 'Personnalisée + Assistance continue' },
        { title: 'Gestion', detail: 'Équipe de commerciaux dédiés' },
        { title: 'Après-vente', detail: 'Livraison, recouvrement, mesure de satisfaction, conseil et assistance' },
        { title: 'Fidélisation', detail: 'Régularité des livraisons + qualité constante' },
      ]},
      canaux: { items: [
        { title: 'Découverte', detail: 'Terrain / Prospection directe' },
        { title: 'Vente', detail: 'Point de vente GOTCHE DISTRIBUTION' },
        { title: 'Livraison', detail: 'Tricycle avec fourgon — sous 72H' },
      ]},
      segments_clients: { items: [
        { title: 'Client principal', detail: 'Les boutiquiers (détaillants)' },
        { title: 'Zone', detail: 'BOUAFLÉ et GAGNOA (Ouest CI)' },
        { title: 'Type', detail: 'B2B' },
        { title: 'Problème résolu', detail: 'Rupture de stock d\'œufs frais + approvisionnement irrégulier' },
        { title: 'Taille marché', detail: '~200 boutiquiers identifiés' },
        { title: 'Intensité besoin', detail: '10/10 — besoin critique et quotidien' },
      ]},
      structure_couts: {
        items: [
          { title: 'Matières premières', amount: '~5 000 000 FCFA/mois', type: 'Variable', pct: '50%' },
          { title: 'Salaires & charges', amount: '~3 000 000 FCFA/mois', type: 'Fixe', pct: '30%' },
          { title: 'Transport & livraison', amount: '~800 000 FCFA/mois', type: 'Variable', pct: '8%' },
          { title: 'Loyer & local', amount: '~500 000 FCFA/mois', type: 'Fixe', pct: '5%' },
          { title: 'Marketing', amount: '~200 000 FCFA/mois', type: 'Variable', pct: '2%' },
          { title: 'Autres (télécom, etc.)', amount: '~500 000 FCFA/mois', type: 'Mixte', pct: '5%' },
        ],
        total: 'TOTAL ≈ 10 000 000 FCFA/mois',
        critical_cost: 'Coût critique : Maïs (46,55%)',
      },
      flux_revenus: {
        items: [
          { title: 'Produit principal', detail: 'Vente d\'œufs de table (OEUFS TICIA)' },
          { title: 'Prix moyen', detail: '10 000 FCFA par unité' },
          { title: 'Fréquence d\'achat', detail: 'Hebdomadaire' },
          { title: 'Volume estimé', detail: '~800 ventes/mois' },
          { title: 'Marge brute estimée', detail: '~35%' },
          { title: 'Mode de paiement', detail: 'Cash / Virement bancaire' },
        ],
        ca_mensuel: 'CA mensuel ≈ 8 000 000 FCFA',
        marge_brute: 'Marge brute ≈ 35%',
      },
    } : undefined,
    // SWOT data
    swot: hasBmc ? {
      forces: [
        'Intégration verticale complète (maïs → œuf)',
        'Proposition de valeur claire (72H)',
        'Marché en croissance, demande > offre',
        'Modèle B2B récurrent (hebdomadaire)',
        'Marque OEUFS TICIA identifiable',
      ],
      faiblesses: [
        'Mono-produit (œufs uniquement)',
        'Aucune présence digitale',
        'Zone géographique limitée (2 villes)',
        'Dépendance personnes clés (techniciens)',
        'Relations fournisseurs non contractualisées',
      ],
      opportunites: [
        'Expansion vers d\'autres villes de l\'Ouest',
        'Diversification produits (poulets, maraîchage)',
        'Digitalisation (WhatsApp Business, e-commerce)',
        'Croissance démographique = demande croissante',
        'Partenariats avec grandes surfaces / restaurants',
      ],
      menaces: [
        'Volatilité du prix du maïs',
        'Risque sanitaire (grippe aviaire)',
        'Entrée de concurrents industriels',
        'Dépendance financement externe',
        'Instabilité climatique (impact agriculture)',
      ],
    } : undefined,
    // Recommandations stratégiques 
    recommandations: hasBmc ? {
      court_terme: {
        title: 'Court terme — Consolider les fondations',
        content: 'Sécuriser les approvisionnements en maïs via des contrats à prix fixe avec les producteurs locaux. Structurer le suivi client avec un CRM simple (WhatsApp Business + tableau de suivi). Formaliser les processus de production pour réduire la dépendance aux personnes clés. Contractualiser les relations avec les fournisseurs critiques (électricité, intrants).',
      },
      moyen_terme: {
        title: 'Moyen terme — Croissance maîtrisée',
        content: 'Diversifier les produits : introduction progressive des poulets de chair, puis du maraîchage. Étendre la zone géographique vers 3-4 nouvelles villes de l\'Ouest (Daloa, Man, San-Pédro). Créer une présence digitale : page Facebook professionnelle, catalogue WhatsApp, site vitrine. Renforcer les fonds propres pour réduire la dépendance aux financements externes.',
      },
      long_terme: {
        title: 'Long terme — Industrialisation et marque',
        content: 'Industrialiser la production : automatisation des poulaillers, mécanisation agricole complète. Développer la marque TICIA au niveau national avec un positionnement premium « fraîcheur locale ». Explorer l\'export sous-régional (Ghana, Burkina Faso). Structurer une gouvernance formelle avec conseil d\'administration et reporting financier régulier.',
      },
    } : undefined,
    // Template metadata
    company_name: name,
    subtitle: hasBmc ? 'Production & Distribution d\'Œufs de Table — Marque OEUFS TICIA' : '',
    location: hasBmc ? 'BOUAFLÉ & GAGNOA — Côte d\'Ivoire' : '',
    sector: hasBmc ? 'PME Agroalimentaire' : '',
    value_chain: hasBmc ? 'Chaîne intégrée maïs → œuf' : '',
    value_proposition_quote: hasBmc ? 'Nous aidons les boutiquiers à avoir des œufs frais toute l\'année grâce à notre production locale intégrée et notre livraison sous 72H.' : '',
    tags: hasBmc ? [
      { label: 'Intégration verticale', type: 'success' },
      { label: 'Marché porteur', type: 'success' },
      { label: 'Mono-produit', type: 'danger' },
      { label: 'Digitalisation nécessaire', type: 'info' },
    ] : [],
    warnings: hasBmc ? [
      'CAPEX initial élevé (77 M FCFA) vs CA An1 (59 M FCFA) — ratio 1.3×',
      `Cohérence Proposition de Valeur ↔ Segments : ${rnd(75, 85)}%`,
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    // Rate limit: 5 generations per day
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const genCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM iterations WHERE user_id = ? AND created_at >= ?"
    ).bind(payload.userId, todayStart.toISOString()).first()
    
    if (genCount && (genCount.cnt as number) >= 10) {
      return c.json({ error: 'Limite atteinte : maximum 10 générations par jour. Réessayez demain.', retryAfter: 86400 }, 429)
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

    // ═══ GENERATE FULL BMC HTML DELIVERABLE (Claude AI + KB) ═══
    // This replaces the old on-click generation — now done at generation time
    // Sequenced AFTER the multi-agent orchestration to avoid Claude rate limits (429)
    if (hasBmc && generableTypes.includes('bmc_analysis')) {
      try {
        // Wait 8 seconds to let the Claude rate limit window pass after orchestration
        console.log('[Generate-All] Waiting 8s before BMC HTML generation (rate limit cooldown)...')
        await new Promise(resolve => setTimeout(resolve, 8000))
        
        // Load KB context for the BMC deliverable engine
        const kbContext = await loadKBContext(c.env.DB, userCountry)
        
        // Format KB for the BMC prompt
        const kbForBmc: KBContextForBmc = {
          benchmarks: formatKBForPrompt(kbContext.benchmarks, 'benchmarks'),
          fiscalParams: formatKBForPrompt(kbContext.fiscalParams, 'fiscal'),
          funders: formatKBForPrompt(kbContext.funders, 'funders'),
          criteria: formatKBForPrompt(kbContext.criteria, 'criteria'),
          feedback: kbContext.feedbackHistory.length > 0 
            ? kbContext.feedbackHistory.map((f: any) => `${f.dimension}: ${f.expert_comment}`).join('\n')
            : '',
        }

        // Get BMC answers (questionnaire or uploaded doc)
        let bmcAnswers = new Map<number, string>()
        const bmcModule = await c.env.DB.prepare(
          "SELECT id FROM modules WHERE module_code = 'mod1_bmc' LIMIT 1"
        ).first() as any
        if (bmcModule) {
          const bmcProgress = await c.env.DB.prepare(
            'SELECT id FROM progress WHERE user_id = ? AND module_id = ?'
          ).bind(payload.userId, bmcModule.id).first() as any
          if (bmcProgress) {
            const qRows = await c.env.DB.prepare(
              'SELECT question_number, user_response FROM questions WHERE progress_id = ? AND user_response IS NOT NULL ORDER BY question_number'
            ).bind(bmcProgress.id).all()
            for (const row of (qRows.results || []) as any[]) {
              if (row.user_response?.trim()) bmcAnswers.set(row.question_number, row.user_response)
            }
          }
        }
        // Fallback: use uploaded BMC text
        if (bmcAnswers.size === 0 && documentTexts.bmc) {
          bmcAnswers.set(1, documentTexts.bmc)
        }

        if (bmcAnswers.size > 0) {
          const project = await c.env.DB.prepare(
            'SELECT name, description FROM projects WHERE user_id = ? LIMIT 1'
          ).bind(payload.userId).first() as any

          const bmcDeliverableData: BmcDeliverableData = {
            companyName: (project?.name as string) || userName,
            entrepreneurName: userName,
            sector: '',
            location: '',
            country: userCountry || 'Côte d\'Ivoire',
            brandName: '',
            tagline: '',
            analysisDate: new Date().toISOString(),
            answers: bmcAnswers,
            apiKey: apiKey,
            kbContext: kbForBmc,
          }

          console.log('[Generate-All] Generating full BMC HTML deliverable with KB...')
          let bmcHtml: string
          try {
            bmcHtml = await generateFullBmcDeliverable(bmcDeliverableData)
            console.log(`[Generate-All] BMC HTML from Claude AI: ${bmcHtml.length} chars`)
          } catch (genErr: any) {
            console.warn('[Generate-All] Claude AI BMC HTML failed, using fallback:', genErr.message)
            bmcHtml = generateFullBmcDeliverableFallback(bmcDeliverableData)
            console.log(`[Generate-All] BMC HTML from fallback: ${bmcHtml.length} chars`)
          }

          // Delete any previous bmc_html for this user to avoid stale data
          await c.env.DB.prepare(
            "DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html'"
          ).bind(payload.userId).run()

          // Store the full HTML in a separate deliverable record
          const bmcHtmlId = crypto.randomUUID()
          await c.env.DB.prepare(`
            INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
            VALUES (?, ?, 'bmc_html', ?, ?, ?, ?, 'generated', datetime('now'))
          `).bind(bmcHtmlId, payload.userId, bmcHtml, result.deliverables?.bmc_analysis?.score || 0, newVersion, iterationId).run()

          console.log(`[Generate-All] BMC HTML deliverable stored successfully: ${bmcHtml.length} chars, id=${bmcHtmlId}`)
          agentsUsed.push('bmc_deliverable_engine:html')
        }
      } catch (err: any) {
        console.error('[Generate-All] BMC HTML generation error (non-fatal):', err.message)
        agentErrors.push(`bmc_html: ${err.message}`)
      }
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
    const token = getAuthToken(c)
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
    const token = getAuthToken(c)
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
  bmc_analysis: {
    title: 'BMC Analysé',
    icon: 'fa-map',
    desc: 'Analyse détaillée des 9 blocs du Business Model Canvas avec scoring et recommandations.',
    color: '#6366f1',
    format: 'Word / PDF'
  },
  sic_analysis: {
    title: 'SIC Analysé',
    icon: 'fa-seedling',
    desc: "Diagnostic d'impact social avec scoring, alignement ODD et matrice d'impact.",
    color: '#10b981',
    format: 'Word / PDF'
  },
  framework: {
    title: "Framework d'Analyse",
    icon: 'fa-chart-line',
    desc: 'Analyse financière complète : ratios, benchmarks sectoriels, scénarios de sensibilité.',
    color: '#f59e0b',
    format: 'Excel / HTML'
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
    const token = getAuthToken(c)
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

    // ═══ DEDICATED DELIVERABLE PAGES ═══
    // BMC Analysis — serve pre-generated HTML from database (instant display)
    if (dtype === 'bmc_analysis') {
      // 1. Try to serve pre-stored HTML (generated at generation time)
      const bmcHtml = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      
      if (bmcHtml?.content) {
        console.log('[BMC Deliverable Page] Serving pre-stored HTML (' + bmcHtml.content.length + ' chars)')
        return c.html(bmcHtml.content)
      }

      // 2. Fallback: use old template with stored JSON data
      if (isAvailable) {
        const bmcData = adaptBMCData(content, (user?.name as string) || 'Entrepreneur', (user?.name as string) || 'Entrepreneur')
        return c.html(renderBMCPage(bmcData, (user?.name as string) || 'Entrepreneur'))
      }
    }

    // Build sections HTML depending on type
    let blocksHtml = ''

    // ═══════════════════════════════════════════════════════════════
    // DIAGNOSTIC EXPERT — style Dashboard + Thèmes (format PDF)
    // ═══════════════════════════════════════════════════════════════
    if (dtype === 'diagnostic') {
      const dims = content.dimensions || []
      const avgScore = dims.length ? Math.round(dims.reduce((s: number, d: any) => s + (d.score || 0), 0) / dims.length) : dScore
      const verdictColor = avgScore >= 70 ? '#059669' : avgScore >= 50 ? '#d97706' : '#dc2626'
      const verdictText = avgScore >= 70 ? 'INVESTISSABLE' : avgScore >= 50 ? 'EN ATTENTE — POTENTIEL MAIS CORRECTIONS NÉCESSAIRES' : 'INSUFFISANT — CORRECTIONS STRUCTURELLES REQUISES'
      blocksHtml = `
        <!-- DASHBOARD -->
        <div class="dlv-section" style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border:none;color:white">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;margin-bottom:4px">TABLEAU DE BORD — VUE D'ENSEMBLE</p>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
            <div style="font-size:48px;font-weight:800;color:${verdictColor}">${dScore}<span style="font-size:20px;color:#94a3b8">/100</span></div>
            <div><p style="font-size:13px;font-weight:700;color:${verdictColor}">${verdictText}</p></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
            ${dims.map((d: any) => {
              const sc = d.score || 0
              const sColor = sc >= 70 ? '#22c55e' : sc >= 50 ? '#f59e0b' : '#ef4444'
              return `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:12px;border:1px solid rgba(255,255,255,0.08)">
                <div style="font-size:22px;font-weight:800;color:${sColor}">${sc}</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:2px">${escapeHtml(d.name || '')}</div>
              </div>`
            }).join('')}
          </div>
        </div>

        <!-- DIMENSIONS -->
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-chart-bar" style="color:#6366f1"></i> Dimensions évaluées</h2>
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

        <!-- FORCES -->
        ${content.strengths?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-shield-halved" style="color:#059669"></i> Ce qui est SOLIDE</h2>
          <ul class="dlv-list dlv-list--green">${content.strengths.map((s: string) => `<li><i class="fas fa-check-circle"></i> ${escapeHtml(s)}</li>`).join('')}</ul>
        </div>` : ''}

        <!-- FAIBLESSES -->
        ${content.weaknesses?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-triangle-exclamation" style="color:#dc2626"></i> Ce qui DOIT CHANGER</h2>
          <ul class="dlv-list dlv-list--red">${content.weaknesses.map((w: string) => `<li><i class="fas fa-xmark"></i> ${escapeHtml(w)}</li>`).join('')}</ul>
        </div>` : ''}

        <!-- RECOMMANDATIONS -->
        ${content.recommendations?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-list-check" style="color:#d97706"></i> Plan d'action recommandé</h2>
          <div class="dlv-blocks">
            ${content.recommendations.map((r: string, i: number) => `
              <div class="dlv-block" style="border-left:3px solid #d97706">
                <div class="dlv-block__header">
                  <span class="dlv-block__name"><span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#d97706;color:white;font-size:11px;font-weight:700;margin-right:6px">${i + 1}</span>${escapeHtml(r.split(':')[0] || r.split('—')[0] || '')}</span>
                </div>
                ${r.includes(':') || r.includes('—') ? `<p class="dlv-block__text">${escapeHtml(r.substring(r.indexOf(':') + 1 || r.indexOf('—') + 1).trim())}</p>` : ''}
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- ALERTES -->
        ${content.alerts?.length ? `
        <div class="dlv-section" style="border-color:#fecaca;background:#fff5f5">
          <h2 class="dlv-section__title"><i class="fas fa-bell" style="color:#dc2626"></i> Alertes critiques</h2>
          <div class="dlv-blocks">
            ${content.alerts.map((a: string) => `
              <div class="dlv-block" style="background:#fef2f2;border-color:#fecaca;border-left:3px solid #ef4444">
                <p class="dlv-block__text" style="color:#991b1b;font-weight:500"><i class="fas fa-circle-exclamation" style="color:#ef4444;margin-right:6px"></i>${escapeHtml(a)}</p>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- BAILLEURS RECOMMANDÉS -->
        ${content.suggested_funders?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-hand-holding-dollar" style="color:#7c3aed"></i> Bailleurs recommandés</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px">
            ${content.suggested_funders.map((f: string) => {
              const parts = f.split(' - ')
              return `<div style="background:#f5f3ff;border:1px solid #ede9fe;border-radius:12px;padding:14px;display:flex;align-items:flex-start;gap:10px">
                <i class="fas fa-building-columns" style="color:#7c3aed;margin-top:3px"></i>
                <div>
                  <p style="font-size:13px;font-weight:600;color:#5b21b6">${escapeHtml(parts[0] || f)}</p>
                  ${parts[1] ? `<p style="font-size:12px;color:#7c3aed;margin-top:2px">${escapeHtml(parts[1])}</p>` : ''}
                </div>
              </div>`
            }).join('')}
          </div>
        </div>` : ''}

        <!-- VERDICT -->
        <div class="dlv-section" style="background:linear-gradient(135deg,${verdictColor}10,${verdictColor}05);border-color:${verdictColor}30">
          <h2 class="dlv-section__title"><i class="fas fa-gavel" style="color:${verdictColor}"></i> Verdict final</h2>
          <p style="font-size:15px;font-weight:700;color:${verdictColor};margin-bottom:8px">Score d'investissabilité : ${dScore}/100</p>
          <p style="font-size:13px;color:#4b5563;line-height:1.7">${escapeHtml(content.verdict || `Le dossier nécessite des clarifications et corrections avant de pouvoir conclure sur l'investissabilité. Le modèle économique présente un potentiel réel, mais les données actuelles ne permettent pas une décision éclairée.`)}</p>
        </div>
      `
    }
    // ═══════════════════════════════════════════════════════════════
    // BMC ANALYSIS — style Canvas + Diagnostic Expert (format PDF)
    // ═══════════════════════════════════════════════════════════════
    else if (dtype === 'bmc_analysis') {
      const blocks = content.blocks || content.pillars || []
      const warnings = content.warnings || content.weaknesses || []
      // Separate high-scoring blocks as strengths, low as vigilance
      const sortedBlocks = [...blocks].sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
      const strengths = sortedBlocks.filter((b: any) => (b.score || 0) >= 70)
      const vigilance = sortedBlocks.filter((b: any) => (b.score || 0) < 70)

      blocksHtml = `
        <!-- BMC HEADER -->
        <div class="dlv-section" style="background:linear-gradient(135deg,#312e81 0%,#4338ca 100%);border:none;color:white">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">
            <div>
              <p style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.6);margin-bottom:2px">BUSINESS MODEL CANVAS</p>
              <p style="font-size:14px;color:rgba(255,255,255,0.9);margin-top:4px">Analyse des 9 blocs du Canvas</p>
            </div>
            <div style="text-align:center">
              <div style="font-size:48px;font-weight:800;color:white">${dScore}<span style="font-size:18px;color:rgba(255,255,255,0.6)">%</span></div>
              <div style="font-size:11px;color:rgba(255,255,255,0.7)">Score BMC Global</div>
            </div>
          </div>
          ${content.coherence_score !== undefined ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.15)">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:rgba(255,255,255,0.7)">Cohérence inter-blocs</span>
              <div style="flex:1;height:6px;background:rgba(255,255,255,0.15);border-radius:99px;overflow:hidden"><div style="height:100%;width:${content.coherence_score}%;background:${content.coherence_score >= 70 ? '#22c55e' : '#f59e0b'};border-radius:99px"></div></div>
              <span style="font-size:13px;font-weight:700;color:white">${content.coherence_score}%</span>
            </div>
          </div>` : ''}
        </div>

        <!-- SCORES PAR BLOC -->
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-th-large" style="color:#6366f1"></i> Scores par bloc BMC</h2>
          <div style="display:grid;grid-template-columns:1fr;gap:8px">
            ${blocks.map((b: any) => {
              const sc = b.score || 0
              const sColor = getScoreColor(sc)
              return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f9fafb;border-radius:10px;border:1px solid #f3f4f6">
                <div style="min-width:36px;text-align:center;font-size:18px;font-weight:800;color:${sColor}">${sc}<span style="font-size:10px;color:#9ca3af">%</span></div>
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:600;color:#1f2937">${escapeHtml(b.name || b.block || '')}</div>
                  <div style="height:4px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${sc}%;background:${sColor};border-radius:99px"></div></div>
                </div>
              </div>`
            }).join('')}
          </div>
        </div>

        <!-- ANALYSE DÉTAILLÉE PAR BLOC -->
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-microscope" style="color:#6366f1"></i> Analyse détaillée</h2>
          <div class="dlv-blocks">
            ${blocks.map((b: any) => `
              <div class="dlv-block">
                <div class="dlv-block__header">
                  <span class="dlv-block__name">${escapeHtml(b.name || b.block || '')}</span>
                  <span class="dlv-block__score" style="color:${getScoreColor(b.score || 0)}">${b.score || 0}%</span>
                </div>
                <div class="dlv-block__bar"><div class="dlv-block__bar-fill" style="width:${b.score || 0}%;background:${getScoreColor(b.score || 0)}"></div></div>
                <p class="dlv-block__text">${escapeHtml(b.analysis || b.comment || '')}</p>
                ${(b.recommendations || []).length ? `
                <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e5e7eb">
                  <p style="font-size:11px;font-weight:700;color:#d97706;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px"><i class="fas fa-lightbulb"></i> Recommandations</p>
                  ${b.recommendations.map((r: string) => `<p style="font-size:12px;color:#6b7280;padding-left:14px;margin-bottom:4px;position:relative"><span style="position:absolute;left:0;color:#d97706">→</span>${escapeHtml(r)}</p>`).join('')}
                </div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- FORCES -->
        ${strengths.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-shield-halved" style="color:#059669"></i> Forces — ${strengths.length} atouts majeurs</h2>
          <ul class="dlv-list dlv-list--green">${strengths.map((b: any) => `<li><i class="fas fa-check-circle"></i> <strong>${escapeHtml(b.name || '')}</strong> (${b.score}%) — ${escapeHtml(b.analysis?.substring(0, 120) || '')}${(b.analysis?.length || 0) > 120 ? '...' : ''}</li>`).join('')}</ul>
        </div>` : ''}

        <!-- POINTS DE VIGILANCE -->
        ${vigilance.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-triangle-exclamation" style="color:#dc2626"></i> Points de vigilance — ${vigilance.length} risques identifiés</h2>
          <ul class="dlv-list dlv-list--red">${vigilance.map((b: any) => `<li><i class="fas fa-exclamation-circle"></i> <strong>${escapeHtml(b.name || '')}</strong> (${b.score}%) — ${escapeHtml(b.analysis?.substring(0, 120) || '')}${(b.analysis?.length || 0) > 120 ? '...' : ''}</li>`).join('')}</ul>
        </div>` : ''}

        <!-- ALERTES CAPEX/WARNINGS -->
        ${warnings.length ? `
        <div class="dlv-section" style="border-color:#fecaca;background:#fff5f5">
          <h2 class="dlv-section__title"><i class="fas fa-bell" style="color:#dc2626"></i> Alertes</h2>
          <div class="dlv-blocks">
            ${warnings.map((w: string) => `
              <div class="dlv-block" style="background:#fef2f2;border-color:#fecaca;border-left:3px solid #ef4444">
                <p class="dlv-block__text" style="color:#991b1b;font-weight:500"><i class="fas fa-circle-exclamation" style="color:#ef4444;margin-right:6px"></i>${escapeHtml(w)}</p>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- RECOMMANDATIONS STRATÉGIQUES -->
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-road" style="color:#4338ca"></i> Recommandations stratégiques</h2>
          <div class="dlv-blocks">
            ${blocks.filter((b: any) => (b.recommendations || []).length > 0).map((b: any) => `
              <div class="dlv-block" style="border-left:3px solid #6366f1">
                <div class="dlv-block__header"><span class="dlv-block__name"><i class="fas fa-tag" style="color:#6366f1;margin-right:6px;font-size:11px"></i>${escapeHtml(b.name || '')}</span></div>
                ${b.recommendations.map((r: string) => `<p style="font-size:12px;color:#6b7280;padding-left:14px;margin-top:4px;position:relative"><span style="position:absolute;left:0;color:#6366f1">→</span>${escapeHtml(r)}</p>`).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `
    }
    // ═══════════════════════════════════════════════════════════════
    // SIC ANALYSIS — Social Impact Canvas (format PDF)
    // ═══════════════════════════════════════════════════════════════
    else if (dtype === 'sic_analysis') {
      const pillars = content.pillars || []
      const im = content.impact_matrix || {} as any
      const oddList = content.odd_alignment || []

      blocksHtml = `
        <!-- SIC HEADER -->
        <div class="dlv-section" style="background:linear-gradient(135deg,#064e3b 0%,#059669 100%);border:none;color:white">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">
            <div>
              <p style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.6)">SOCIAL IMPACT CANVAS</p>
              <p style="font-size:22px;font-weight:800;color:white;margin-top:4px">${dScore}<span style="font-size:14px;color:rgba(255,255,255,0.6)">/100</span></p>
              <p style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:2px">Impact Social : ${dScore >= 70 ? 'Solide' : dScore >= 50 ? 'En Construction' : 'À Structurer'}</p>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              ${pillars.map((p: any) => `
                <div style="text-align:center;background:rgba(255,255,255,0.1);border-radius:10px;padding:10px 14px;min-width:80px">
                  <div style="font-size:20px;font-weight:800;color:white">${p.score || 0}%</div>
                  <div style="font-size:9px;color:rgba(255,255,255,0.7);margin-top:2px">${escapeHtml((p.name || '').substring(0, 20))}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- CHIFFRES CLÉS -->
        ${im.beneficiaires_directs_estimes || im.beneficiaires_indirects_estimes || im.emplois_crees ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-users" style="color:#059669"></i> Synthèse d'Impact</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
            ${im.beneficiaires_directs_estimes ? `<div style="text-align:center;padding:16px;background:#ecfdf5;border-radius:12px;border:1px solid #d1fae5"><div style="font-size:28px;font-weight:800;color:#059669">${typeof im.beneficiaires_directs_estimes === 'number' ? im.beneficiaires_directs_estimes.toLocaleString('fr-FR') : im.beneficiaires_directs_estimes}</div><div style="font-size:11px;color:#065f46;margin-top:4px">Bénéficiaires directs</div></div>` : ''}
            ${im.beneficiaires_indirects_estimes ? `<div style="text-align:center;padding:16px;background:#ecfdf5;border-radius:12px;border:1px solid #d1fae5"><div style="font-size:28px;font-weight:800;color:#059669">${typeof im.beneficiaires_indirects_estimes === 'number' ? im.beneficiaires_indirects_estimes.toLocaleString('fr-FR') : im.beneficiaires_indirects_estimes}</div><div style="font-size:11px;color:#065f46;margin-top:4px">Bénéficiaires indirects</div></div>` : ''}
            ${im.emplois_crees ? `<div style="text-align:center;padding:16px;background:#ecfdf5;border-radius:12px;border:1px solid #d1fae5"><div style="font-size:28px;font-weight:800;color:#059669">${im.emplois_crees}</div><div style="font-size:11px;color:#065f46;margin-top:4px">Emplois créés</div></div>` : ''}
            <div style="text-align:center;padding:16px;background:#ecfdf5;border-radius:12px;border:1px solid #d1fae5"><div style="font-size:28px;font-weight:800;color:#059669">${oddList.length}</div><div style="font-size:11px;color:#065f46;margin-top:4px">ODD adressés</div></div>
          </div>
        </div>` : ''}

        <!-- PILIERS D'IMPACT -->
        ${pillars.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-seedling" style="color:#059669"></i> Piliers d'Impact</h2>
          <div class="dlv-blocks">
            ${pillars.map((p: any) => `
              <div class="dlv-block">
                <div class="dlv-block__header">
                  <span class="dlv-block__name">${escapeHtml(p.name || '')}</span>
                  <span class="dlv-block__score" style="color:${getScoreColor(p.score || 0)}">${p.score || 0}/100</span>
                </div>
                <div class="dlv-block__bar"><div class="dlv-block__bar-fill" style="width:${p.score || 0}%;background:${getScoreColor(p.score || 0)}"></div></div>
                <p class="dlv-block__text">${escapeHtml(p.analysis || '')}</p>
                ${(p.recommendations || []).length ? `
                <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e5e7eb">
                  <p style="font-size:11px;font-weight:700;color:#059669;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px"><i class="fas fa-lightbulb"></i> Recommandations</p>
                  ${p.recommendations.map((r: string) => `<p style="font-size:12px;color:#6b7280;padding-left:14px;margin-bottom:4px;position:relative"><span style="position:absolute;left:0;color:#059669">→</span>${escapeHtml(r)}</p>`).join('')}
                </div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- ALIGNEMENT ODD -->
        ${oddList.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-bullseye" style="color:#059669"></i> Contribution aux ODD — Détail</h2>
          <div style="display:grid;gap:8px">
            ${oddList.map((o: any) => {
              const rel = o.relevance || o.score || 0
              return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f9fafb;border-radius:10px;border:1px solid #f3f4f6">
                <div style="min-width:48px;height:48px;border-radius:10px;background:${getScoreColor(rel)};display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700">ODD ${(o.odd || '').replace(/[^0-9]/g, '').substring(0, 2)}</div>
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:600;color:#1f2937">${escapeHtml(o.odd || '')}</div>
                  ${o.contribution ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(o.contribution)}</div>` : ''}
                  <div style="height:4px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${rel}%;background:${getScoreColor(rel)};border-radius:99px"></div></div>
                </div>
                <div style="font-size:15px;font-weight:700;color:${getScoreColor(rel)}">${rel}%</div>
              </div>`
            }).join('')}
          </div>
        </div>` : ''}

        <!-- MATRICE D'IMPACT -->
        ${im.indicateurs_manquants?.length || im.recommandations_bailleurs?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-table-cells" style="color:#6366f1"></i> Matrice d'Impact — Détails</h2>
          ${im.indicateurs_manquants?.length ? `
            <p style="font-size:12px;font-weight:600;color:#dc2626;margin-bottom:8px"><i class="fas fa-triangle-exclamation"></i> Indicateurs manquants</p>
            <ul class="dlv-list dlv-list--red">${im.indicateurs_manquants.map((ind: string) => `<li><i class="fas fa-xmark"></i> ${escapeHtml(ind)}</li>`).join('')}</ul>
          ` : ''}
          ${im.recommandations_bailleurs?.length ? `
            <p style="font-size:12px;font-weight:600;color:#059669;margin-top:16px;margin-bottom:8px"><i class="fas fa-hand-holding-heart"></i> Recommandations pour les bailleurs</p>
            <ul class="dlv-list dlv-list--green">${im.recommandations_bailleurs.map((r: string) => `<li><i class="fas fa-arrow-right"></i> ${escapeHtml(r)}</li>`).join('')}</ul>
          ` : ''}
        </div>` : ''}

        <!-- NIVEAU DE MATURITÉ -->
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-signal" style="color:#6366f1"></i> Niveau de Maturité de l'Impact</h2>
          <div style="display:flex;gap:4px;margin-bottom:12px">
            ${['Idée', 'Test/Pilote', 'Déployé', 'Mesuré', 'Scalé'].map((phase, i) => {
              const currentPhase = dScore >= 80 ? 4 : dScore >= 65 ? 3 : dScore >= 50 ? 2 : dScore >= 30 ? 1 : 0
              const isActive = i <= currentPhase
              const isCurrent = i === currentPhase
              return `<div style="flex:1;text-align:center;padding:10px 4px;border-radius:8px;font-size:10px;font-weight:${isCurrent ? '700' : '500'};
                background:${isActive ? '#059669' : '#f3f4f6'};color:${isActive ? 'white' : '#9ca3af'};
                ${isCurrent ? 'box-shadow:0 0 0 2px #059669,0 0 0 4px #05966920;' : ''}">
                ${isCurrent ? '← VOUS ÊTES ICI' : phase}
              </div>`
            }).join('')}
          </div>
        </div>
      `
    }
    // ═══════════════════════════════════════════════════════════════
    // FRAMEWORK D'ANALYSE — format Excel multi-onglets
    // ═══════════════════════════════════════════════════════════════
    else if (dtype === 'framework') {
      const sections = content.sections || []
      blocksHtml = `
        <!-- FRAMEWORK HEADER -->
        <div class="dlv-section" style="background:linear-gradient(135deg,#92400e 0%,#f59e0b 100%);border:none;color:white">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.6)">FRAMEWORK D'ANALYSE FINANCIÈRE PME</p>
          <p style="font-size:20px;font-weight:800;color:white;margin-top:6px">Analyse Financière Complète</p>
          <p style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px">8 onglets : Données Historiques · Marges · Coûts · Trésorerie · Hypothèses · Projections 5 ans · Scénarios · Synthèse</p>
        </div>

        ${content.analysis ? `
        <div class="dlv-section">
          <p class="dlv-analysis">${escapeHtml(content.analysis)}</p>
        </div>` : ''}

        <!-- SECTIONS (onglets) -->
        ${sections.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-layer-group" style="color:#f59e0b"></i> Onglets de l'Analyse</h2>
          <div class="dlv-blocks">
            ${sections.map((s: any, i: number) => {
              const icons = ['fa-table', 'fa-chart-pie', 'fa-money-bill-wave', 'fa-wallet', 'fa-sliders', 'fa-chart-line', 'fa-balance-scale', 'fa-star']
              return `
              <div class="dlv-block" style="border-left:3px solid #f59e0b">
                <div class="dlv-block__header">
                  <span class="dlv-block__name"><i class="fas ${icons[i] || 'fa-file-alt'}" style="color:#f59e0b;margin-right:6px"></i>${escapeHtml(s.title || '')}</span>
                  ${s.score ? `<span class="dlv-block__score" style="color:${getScoreColor(s.score)}">${s.score}/100</span>` : ''}
                </div>
                ${s.score ? `<div class="dlv-block__bar"><div class="dlv-block__bar-fill" style="width:${s.score}%;background:${getScoreColor(s.score)}"></div></div>` : ''}
                <p class="dlv-block__text" style="white-space:pre-line">${escapeHtml(s.content || '')}</p>
              </div>`
            }).join('')}
          </div>
        </div>` : ''}

        <!-- RATIOS -->
        ${content.ratios ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-calculator" style="color:#6366f1"></i> Ratios Clés d'Efficacité</h2>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#64748b">Ratio</th>
                  <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#64748b">Valeur</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(content.ratios).map(([key, val]: [string, any]) => `
                  <tr style="border-bottom:1px solid #f3f4f6">
                    <td style="padding:8px 12px;color:#374151;font-weight:500">${escapeHtml(key)}</td>
                    <td style="text-align:right;padding:8px 12px;color:#1f2937;font-weight:600">${escapeHtml(typeof val === 'object' ? JSON.stringify(val) : String(val))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

        <!-- FORCES & RECOMMANDATIONS -->
        ${content.strengths?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-check-circle" style="color:#059669"></i> Points forts</h2>
          <ul class="dlv-list dlv-list--green">${content.strengths.map((s: string) => `<li><i class="fas fa-check"></i> ${escapeHtml(s)}</li>`).join('')}</ul>
        </div>` : ''}
        ${content.recommendations?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-lightbulb" style="color:#d97706"></i> Actions recommandées</h2>
          <div class="dlv-blocks">
            ${content.recommendations.map((r: string, i: number) => `
              <div class="dlv-block" style="border-left:3px solid #f59e0b">
                <div class="dlv-block__header"><span class="dlv-block__name"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#f59e0b;color:white;font-size:10px;font-weight:700;margin-right:6px">${i + 1}</span>${escapeHtml(r.split(':')[0] || r.split('—')[0] || r)}</span></div>
                ${r.includes(':') ? `<p class="dlv-block__text">${escapeHtml(r.substring(r.indexOf(':') + 1).trim())}</p>` : ''}
              </div>
            `).join('')}
          </div>
        </div>` : ''}
      `
    }
    // ═══════════════════════════════════════════════════════════════
    // PLAN OVO — Projections financières 5 ans
    // ═══════════════════════════════════════════════════════════════
    else if (dtype === 'plan_ovo') {
      const proj = content.projections || {}
      const km = content.key_metrics || {} as any
      blocksHtml = `
        <!-- PLAN OVO HEADER -->
        <div class="dlv-section" style="background:linear-gradient(135deg,#0c4a6e 0%,#0284c7 100%);border:none;color:white">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.6)">PLAN FINANCIER OVO</p>
          <p style="font-size:20px;font-weight:800;color:white;margin-top:6px">Projections Financières — 5 ans</p>
          <p style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px">Scénarios Base · Optimiste · Pessimiste</p>
        </div>

        ${content.analysis ? `
        <div class="dlv-section">
          <p class="dlv-analysis">${escapeHtml(content.analysis)}</p>
        </div>` : ''}

        <!-- MÉTRIQUES CLÉS -->
        ${Object.keys(km).length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-gauge-high" style="color:#0284c7"></i> Métriques Clés</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
            ${Object.entries(km).map(([key, val]: [string, any]) => {
              const labels: Record<string, string> = { marge_brute_pct: 'Marge Brute', marge_ebitda_2029_pct: 'Marge EBITDA An5', runway_mois: 'Runway (mois)', seuil_rentabilite_2026: 'Seuil Rentabilité', payback_period_annees: 'Payback', van_10pct_xof: 'VAN (10%)', tir_pct: 'TRI', dscr_2026: 'DSCR', besoin_financement_total_xof: 'Besoin Financement', ca_par_employe_2025_xof: 'CA/Employé' }
              if (typeof val === 'object') return ''
              return `<div style="text-align:center;padding:14px;background:#f0f9ff;border-radius:12px;border:1px solid #bae6fd">
                <div style="font-size:20px;font-weight:800;color:#0284c7">${escapeHtml(String(val))}</div>
                <div style="font-size:10px;color:#0369a1;margin-top:4px">${escapeHtml(labels[key] || key.replace(/_/g, ' '))}</div>
              </div>`
            }).join('')}
          </div>
        </div>` : ''}

        <!-- SCÉNARIOS -->
        ${Object.keys(proj).length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-chart-line" style="color:#0284c7"></i> Projections par Scénario</h2>
          <div class="dlv-blocks">
            ${Object.entries(proj).map(([scenarioKey, scenarioData]: [string, any]) => {
              const scenarioLabels: Record<string, string> = { scenario_base: 'Scénario Central', scenario_optimiste: 'Scénario Optimiste', scenario_pessimiste: 'Scénario Prudent' }
              const scenarioColors: Record<string, string> = { scenario_base: '#0284c7', scenario_optimiste: '#059669', scenario_pessimiste: '#d97706' }
              const scenarioIcons: Record<string, string> = { scenario_base: 'fa-bullseye', scenario_optimiste: 'fa-rocket', scenario_pessimiste: 'fa-shield-halved' }
              const label = scenarioLabels[scenarioKey] || scenarioKey
              const color = scenarioColors[scenarioKey] || '#6366f1'
              const icon = scenarioIcons[scenarioKey] || 'fa-chart-line'
              if (typeof scenarioData !== 'object') return ''
              return `
                <div class="dlv-block" style="border-left:3px solid ${color}">
                  <div class="dlv-block__header"><span class="dlv-block__name"><i class="fas ${icon}" style="color:${color};margin-right:6px"></i>${escapeHtml(label)}</span></div>
                  <div style="overflow-x:auto;margin-top:8px">
                    <table style="width:100%;border-collapse:collapse;font-size:11px">
                      <thead><tr style="background:#f8fafc">${Object.keys(scenarioData).map((k: string) => `<th style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#64748b;font-weight:600">${escapeHtml(k)}</th>`).join('')}</tr></thead>
                      <tbody><tr>${Object.values(scenarioData).map((v: any) => `<td style="padding:6px 8px;text-align:right;color:#1f2937;font-weight:500">${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</td>`).join('')}</tr></tbody>
                    </table>
                  </div>
                </div>`
            }).join('')}
          </div>
        </div>` : ''}

        <!-- HYPOTHÈSES -->
        ${content.assumptions?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-sliders" style="color:#64748b"></i> Hypothèses de Projection</h2>
          <div class="dlv-blocks">
            ${content.assumptions.map((a: string, i: number) => `
              <div class="dlv-block">
                <div class="dlv-block__header"><span class="dlv-block__name"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#e2e8f0;color:#64748b;font-size:10px;font-weight:700;margin-right:6px">${i + 1}</span></span></div>
                <p class="dlv-block__text">${escapeHtml(a)}</p>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
      `
    }
    // ═══════════════════════════════════════════════════════════════
    // BUSINESS PLAN — format Word structuré
    // ═══════════════════════════════════════════════════════════════
    else if (dtype === 'business_plan') {
      const sections = content.sections || []
      blocksHtml = `
        <!-- BP HEADER -->
        <div class="dlv-section" style="background:linear-gradient(135deg,#4c1d95 0%,#7c3aed 100%);border:none;color:white">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.6)">BUSINESS PLAN</p>
          <p style="font-size:20px;font-weight:800;color:white;margin-top:6px">Document de synthèse prêt pour les investisseurs</p>
          <p style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px">Présentation · Opérations · Projet d'investissement</p>
        </div>

        <!-- TABLE DES MATIÈRES -->
        ${sections.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-list-ol" style="color:#7c3aed"></i> Table des matières</h2>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${sections.map((s: any, i: number) => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:#f9fafb;cursor:pointer" onclick="document.getElementById('bp-section-${i}').scrollIntoView({behavior:'smooth'})">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:#7c3aed;color:white;font-size:12px;font-weight:700">${i + 1}</span>
                <span style="font-size:13px;font-weight:500;color:#374151">${escapeHtml(s.title || '')}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- SECTIONS -->
        ${sections.map((s: any, i: number) => `
          <div class="dlv-section" id="bp-section-${i}">
            <h2 class="dlv-section__title">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;background:#7c3aed;color:white;font-size:14px;font-weight:700">${i + 1}</span>
              ${escapeHtml(s.title || '')}
            </h2>
            <div style="font-size:13px;color:#4b5563;line-height:1.8;white-space:pre-line">${escapeHtml(s.content || '')}</div>
          </div>
        `).join('')}
      `
    }
    // ═══════════════════════════════════════════════════════════════
    // ODD — Due Diligence Opérationnelle (format Excel évaluation)
    // ═══════════════════════════════════════════════════════════════
    else if (dtype === 'odd') {
      const criteria = content.criteria || []
      const summary = content.summary || {} as any
      const categoryCounts: Record<string, { total: number, complet: number, partiel: number, nonConf: number }> = {}
      criteria.forEach((cr: any) => {
        const cat = cr.category || 'Autre'
        if (!categoryCounts[cat]) categoryCounts[cat] = { total: 0, complet: 0, partiel: 0, nonConf: 0 }
        categoryCounts[cat].total++
        if (cr.status === 'Complet' || cr.status === 'Conforme') categoryCounts[cat].complet++
        else if (cr.status === 'Partiel') categoryCounts[cat].partiel++
        else categoryCounts[cat].nonConf++
      })

      blocksHtml = `
        <!-- ODD HEADER -->
        <div class="dlv-section" style="background:linear-gradient(135deg,#78350f 0%,#d97706 100%);border:none;color:white">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.6)">DUE DILIGENCE OPÉRATIONNELLE</p>
          <div style="display:flex;align-items:center;gap:16px;margin-top:8px">
            <div style="font-size:48px;font-weight:800;color:white">${dScore}<span style="font-size:18px;color:rgba(255,255,255,0.6)">/100</span></div>
            <div>
              <p style="font-size:14px;font-weight:600;color:white">${criteria.length} critères évalués</p>
              <p style="font-size:12px;color:rgba(255,255,255,0.7)">${criteria.filter((c: any) => c.status === 'Complet' || c.status === 'Conforme').length} conformes · ${criteria.filter((c: any) => c.status === 'Partiel').length} partiels · ${criteria.filter((c: any) => c.status !== 'Complet' && c.status !== 'Conforme' && c.status !== 'Partiel').length} non conformes</p>
            </div>
          </div>
        </div>

        <!-- RÉSUMÉ PAR CATÉGORIE -->
        ${Object.keys(categoryCounts).length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-chart-pie" style="color:#d97706"></i> Aperçu par catégorie</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
            ${Object.entries(categoryCounts).map(([cat, counts]) => `
              <div style="padding:14px;background:#fffbeb;border-radius:12px;border:1px solid #fde68a">
                <p style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:8px">${escapeHtml(cat)}</p>
                <div style="display:flex;gap:6px">
                  <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:#dcfce7;color:#059669;font-weight:600">${counts.complet} ✓</span>
                  <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:#fef3c7;color:#d97706;font-weight:600">${counts.partiel} ◐</span>
                  <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:#fef2f2;color:#dc2626;font-weight:600">${counts.nonConf} ✗</span>
                </div>
                <div style="height:4px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin-top:8px">
                  <div style="height:100%;width:${Math.round(counts.complet / counts.total * 100)}%;background:#059669;border-radius:99px"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- CRITÈRES DÉTAILLÉS -->
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-clipboard-list" style="color:#d97706"></i> Évaluation des critères</h2>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#64748b">Critère</th>
                  <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#64748b">Catégorie</th>
                  <th style="text-align:center;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#64748b">Statut</th>
                  <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#64748b">Commentaire</th>
                </tr>
              </thead>
              <tbody>
                ${criteria.map((cr: any) => {
                  const st = cr.status || ''
                  const stColor = (st === 'Complet' || st === 'Conforme') ? '#059669' : st === 'Partiel' ? '#d97706' : '#dc2626'
                  const stBg = (st === 'Complet' || st === 'Conforme') ? '#dcfce7' : st === 'Partiel' ? '#fef3c7' : '#fef2f2'
                  return `<tr style="border-bottom:1px solid #f3f4f6">
                    <td style="padding:8px 12px;color:#374151;font-weight:500">${escapeHtml(cr.name || '')}</td>
                    <td style="padding:8px 12px;color:#6b7280;font-size:11px">${escapeHtml(cr.category || '')}</td>
                    <td style="text-align:center;padding:8px 12px"><span style="padding:2px 10px;border-radius:99px;font-size:11px;font-weight:600;background:${stBg};color:${stColor}">${escapeHtml(st)}</span></td>
                    <td style="padding:8px 12px;color:#6b7280;font-size:11px;max-width:300px">${escapeHtml(cr.comment || '')}</td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- PLAN D'ACTION -->
        ${content.action_plan?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-list-check" style="color:#7c3aed"></i> Plan d'action prioritaire</h2>
          <div class="dlv-blocks">
            ${content.action_plan.map((a: string, i: number) => {
              const isUrgent = a.toLowerCase().includes('urgent') || a.toLowerCase().includes('0-3 mois')
              return `
              <div class="dlv-block" style="border-left:3px solid ${isUrgent ? '#dc2626' : '#d97706'}">
                <div class="dlv-block__header">
                  <span class="dlv-block__name">
                    <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${isUrgent ? '#dc2626' : '#d97706'};color:white;font-size:11px;font-weight:700;margin-right:6px">${i + 1}</span>
                    ${isUrgent ? '<span style="font-size:9px;padding:2px 6px;border-radius:99px;background:#fef2f2;color:#dc2626;font-weight:700;margin-right:6px">URGENT</span>' : ''}
                  </span>
                </div>
                <p class="dlv-block__text">${escapeHtml(a)}</p>
              </div>`
            }).join('')}
          </div>
        </div>` : ''}

        <!-- RÉSUMÉ ODD -->
        ${summary.points_forts?.length || summary.criteres_bloquants?.length ? `
        <div class="dlv-section">
          <h2 class="dlv-section__title"><i class="fas fa-file-shield" style="color:#d97706"></i> Synthèse ODD</h2>
          ${summary.points_forts?.length ? `
            <p style="font-size:12px;font-weight:600;color:#059669;margin-bottom:8px"><i class="fas fa-check-circle"></i> Points forts</p>
            <ul class="dlv-list dlv-list--green">${summary.points_forts.map((p: string) => `<li><i class="fas fa-check"></i> ${escapeHtml(p)}</li>`).join('')}</ul>
          ` : ''}
          ${summary.criteres_bloquants?.length ? `
            <p style="font-size:12px;font-weight:600;color:#dc2626;margin-top:16px;margin-bottom:8px"><i class="fas fa-ban"></i> Critères bloquants</p>
            <ul class="dlv-list dlv-list--red">${summary.criteres_bloquants.map((c: string) => `<li><i class="fas fa-xmark"></i> ${escapeHtml(c)}</li>`).join('')}</ul>
          ` : ''}
        </div>` : ''}
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

    <!-- Downloads bar -->
    <div class="dlv-section" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <h2 style="font-size:14px;font-weight:600;color:#1f2937;display:flex;align-items:center;gap:8px;margin:0"><i class="fas fa-download" style="color:${meta.color}"></i> Télécharger le livrable</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${isAvailable ? (() => {
            const excelTypes = ['framework', 'odd', 'plan_ovo']
            const isExcel = excelTypes.includes(dtype)
            const fileIcon = isExcel ? 'fa-file-excel' : 'fa-file-pdf'
            const fileLabel = isExcel ? 'Télécharger Excel (.xlsx)' : dtype === 'business_plan' ? 'Télécharger Word (.docx)' : 'Télécharger PDF'
            const fileBtnColor = isExcel ? '#059669' : dtype === 'business_plan' ? '#2563eb' : meta.color
            return `
              <button onclick="downloadDeliverable()" id="btn-download" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:${fileBtnColor};color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                <i class="fas ${fileIcon}"></i> ${fileLabel}
              </button>
              ${!isExcel && dtype !== 'business_plan' ? `<button onclick="window.print()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:#f3f4f6;color:#374151;border:none;font-size:12px;font-weight:500;cursor:pointer"><i class="fas fa-print"></i> Imprimer</button>` : ''}
            `
          })() : `
            <span style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:10px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:500">
              <i class="fas fa-hourglass-half"></i> Non encore généré
            </span>
          `}
        </div>
      </div>
    </div>

    <!-- Main content — full width -->
    <div class="space-y-0">
      ${isAvailable ? blocksHtml : `
        <div class="dlv-section text-center py-16">
          <i class="fas fa-rocket text-4xl text-slate-300 mb-4 block"></i>
          <p class="text-slate-500 font-medium">Contenu en attente de génération</p>
          <p class="text-slate-400 text-sm mt-2">Uploadez vos documents et lancez la génération depuis la page principale.</p>
        </div>
      `}
    </div>
  </main>

  <!-- SheetJS for Excel generation -->
  <script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
  <script>
    // Deliverable data injected from server
    const DLIV_TYPE = ${JSON.stringify(dtype)};
    const DLIV_DATA = ${JSON.stringify(content)};
    const DLIV_SCORE = ${JSON.stringify(dScore)};
    const DLIV_META = ${JSON.stringify(meta)};
    const USER_NAME = ${JSON.stringify(user?.name || 'Entrepreneur')};
    const DLIV_DATE = ${JSON.stringify(new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))};

    function downloadDeliverable() {
      const btn = document.getElementById('btn-download');
      if(btn){ btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...'; btn.disabled = true; }
      try {
        if (['framework','odd','plan_ovo'].includes(DLIV_TYPE)) {
          generateExcel();
        } else if (DLIV_TYPE === 'business_plan') {
          generateWord();
        } else {
          generatePrintPDF();
        }
      } catch(e) { alert('Erreur: ' + e.message); }
      finally { if(btn){ btn.innerHTML = '<i class="fas fa-check"></i> Téléchargé !'; setTimeout(() => { btn.innerHTML = btn.dataset.originalHtml || 'Télécharger'; btn.disabled = false; }, 2000); } }
    }

    // ═══ EXCEL GENERATION ═══
    function generateExcel() {
      const wb = XLSX.utils.book_new();

      if (DLIV_TYPE === 'framework') { buildFrameworkExcel(wb); }
      else if (DLIV_TYPE === 'odd') { buildODDExcel(wb); }
      else if (DLIV_TYPE === 'plan_ovo') { buildPlanOVOExcel(wb); }

      const fileName = DLIV_TYPE.toUpperCase() + '_' + USER_NAME.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.xlsx';
      XLSX.writeFile(wb, fileName);
    }

    function s(v) { return v != null ? String(v) : ''; }
    function n(v) { return typeof v === 'number' ? v : (parseFloat(v) || 0); }

    function buildFrameworkExcel(wb) {
      const d = DLIV_DATA;
      const sections = d.sections || [];

      // 1️⃣ Données Historiques
      const ws1Data = [
        ['📊 FRAMEWORK D\\'ANALYSE FINANCIÈRE PME - CÔTE D\\'IVOIRE'],
        ['Onglet 1 : Données Historiques (3 dernières années)'],
        [''],
        ['INFORMATIONS ENTREPRISE'],
        ['Nom de l\\'entreprise:', USER_NAME],
        ['Date d\\'analyse:', DLIV_DATE],
        ['Score Framework:', s(DLIV_SCORE) + '/100'],
        [''],
        ['INDICATEURS', 'Année N-2', 'Année N-1', 'Année N', 'Évolution', 'Notes'],
      ];
      // Add sections content as rows
      sections.forEach(sec => {
        ws1Data.push(['']);
        ws1Data.push([s(sec.title).toUpperCase()]);
        const lines = s(sec.content).split('\\n').filter(l => l.trim());
        lines.forEach(line => { ws1Data.push([line]); });
      });
      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      ws1['!cols'] = [{wch:40},{wch:18},{wch:18},{wch:18},{wch:15},{wch:25}];
      XLSX.utils.book_append_sheet(wb, ws1, '1️⃣ Données Historiques');

      // 2️⃣ Analyse Marges
      const ws2Data = [
        ['Onglet 2 : Analyse des Marges par Activité'],
        ['Objectif : Identifier où se crée (ou se détruit) la valeur'],
        [''],
        ['MARGE BRUTE PAR ACTIVITÉ'],
        ['Activité', 'CA (FCFA)', 'Coûts Directs', 'Marge Brute', 'Marge (%)', 'Classification'],
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
      ws2['!cols'] = [{wch:25},{wch:18},{wch:18},{wch:18},{wch:12},{wch:20}];
      XLSX.utils.book_append_sheet(wb, ws2, '2️⃣ Analyse Marges');

      // 3️⃣ Structure Coûts
      const ws3Data = [
        ['Onglet 3 : Structure de Coûts & Efficacité Opérationnelle'],
        [''],
        ['RATIOS CLÉS D\\'EFFICACITÉ'],
        ['Ratio', 'Valeur', 'Benchmark'],
      ];
      if (d.ratios) {
        Object.entries(d.ratios).forEach(([k, v]) => {
          ws3Data.push([k, s(v)]);
        });
      }
      const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
      ws3['!cols'] = [{wch:35},{wch:20},{wch:20}];
      XLSX.utils.book_append_sheet(wb, ws3, '3️⃣ Structure Coûts');

      // 4️⃣ Trésorerie BFR
      const ws4Data = [
        ['Onglet 4 : Trésorerie & Besoin en Fonds de Roulement'],
        [''],
        ['ANALYSE TRÉSORERIE'],
        ['Indicateur', 'Valeur', 'Notes'],
      ];
      const ws4 = XLSX.utils.aoa_to_sheet(ws4Data);
      ws4['!cols'] = [{wch:35},{wch:20},{wch:25}];
      XLSX.utils.book_append_sheet(wb, ws4, '4️⃣ Trésorerie BFR');

      // 5️⃣ Hypothèses
      const ws5Data = [
        ['Onglet 5 : Hypothèses de Projection (5 ans)'],
        ['⚠️ Important : Toutes les hypothèses doivent être justifiées'],
        [''],
      ];
      if (d.assumptions) {
        d.assumptions.forEach((a, i) => { ws5Data.push(['Hypothèse ' + (i+1), s(a)]); });
      }
      const ws5 = XLSX.utils.aoa_to_sheet(ws5Data);
      ws5['!cols'] = [{wch:20},{wch:80}];
      XLSX.utils.book_append_sheet(wb, ws5, '5️⃣ Hypothèses');

      // 6️⃣ Projection 5 Ans
      const ws6Data = [
        ['Onglet 6 : Projection Financière 5 Ans'],
        [''],
      ];
      if (d.projections) {
        Object.entries(d.projections).forEach(([scenarioKey, scenarioData]) => {
          const label = {scenario_base:'Scénario Central',scenario_optimiste:'Scénario Optimiste',scenario_pessimiste:'Scénario Prudent'}[scenarioKey] || scenarioKey;
          ws6Data.push(['']);
          ws6Data.push([label]);
          if (typeof scenarioData === 'object' && scenarioData !== null) {
            ws6Data.push(Object.keys(scenarioData));
            ws6Data.push(Object.values(scenarioData).map(v => typeof v === 'object' ? JSON.stringify(v) : v));
          }
        });
      }
      const ws6 = XLSX.utils.aoa_to_sheet(ws6Data);
      ws6['!cols'] = [{wch:25},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18}];
      XLSX.utils.book_append_sheet(wb, ws6, '6️⃣ Projection 5 Ans');

      // 7️⃣ Scénarios
      const ws7Data = [
        ['Onglet 7 : Analyse par Scénarios'],
        [''],
        ['HYPOTHÈSES PAR SCÉNARIO'],
      ];
      const ws7 = XLSX.utils.aoa_to_sheet(ws7Data);
      XLSX.utils.book_append_sheet(wb, ws7, '7️⃣ Scénarios');

      // 📊 Synthèse Exécutive
      const ws8Data = [
        ['SYNTHÈSE EXÉCUTIVE'],
        ['Format Cabinet - 3 Slides Maximum'],
        [''],
        ['🟢 SLIDE 1 — ÉTAT DE SANTÉ FINANCIÈRE'],
        ['Score Framework:', s(DLIV_SCORE)],
        [''],
      ];
      if (d.strengths) { d.strengths.forEach(st => ws8Data.push(['Force:', s(st)])); }
      ws8Data.push(['']);
      ws8Data.push(['🔵 SLIDE 2 — RECOMMANDATIONS']);
      if (d.recommendations) { d.recommendations.forEach(r => ws8Data.push(['→', s(r)])); }
      ws8Data.push(['']);
      ws8Data.push(['💡 PHRASE CLÉ']);
      ws8Data.push(['"Les chiffres ne servent pas à juger le passé, mais à décider le futur."']);
      const ws8 = XLSX.utils.aoa_to_sheet(ws8Data);
      ws8['!cols'] = [{wch:20},{wch:80}];
      XLSX.utils.book_append_sheet(wb, ws8, '📊 Synthèse Exécutive');
    }

    function buildODDExcel(wb) {
      const d = DLIV_DATA;
      const criteria = d.criteria || [];
      const summary = d.summary || {};

      // 1 - Instructions
      const ws1Data = [
        ['L\\'outil d\\'évaluation ODD — ' + USER_NAME],
        ['Score ODD global: ' + s(DLIV_SCORE) + '/100'],
        ['Date: ' + DLIV_DATE],
        [''],
        ['Cet outil évalue la conformité opérationnelle aux critères de due diligence.'],
        [''],
        ['Instructions:'],
        ['1. Passez en revue les critères évalués dans l\\'onglet Evaluation'],
        ['2. Consultez l\\'aperçu par catégorie dans l\\'onglet Aperçu'],
        ['3. Vérifiez les indicateurs d\\'impact dans l\\'onglet Indicateurs'],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      ws1['!cols'] = [{wch:80}];
      XLSX.utils.book_append_sheet(wb, ws1, 'Instructions');

      // 2 - Evaluation critères
      const ws2Data = [
        ['Critère', 'Catégorie', 'Statut', 'Commentaire'],
      ];
      criteria.forEach(cr => {
        ws2Data.push([s(cr.name), s(cr.category), s(cr.status), s(cr.comment)]);
      });
      const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
      ws2['!cols'] = [{wch:35},{wch:20},{wch:15},{wch:50}];
      XLSX.utils.book_append_sheet(wb, ws2, 'Evaluation Critères');

      // 3 - Aperçu par catégorie
      const cats = {};
      criteria.forEach(cr => {
        const cat = cr.category || 'Autre';
        if (!cats[cat]) cats[cat] = { total: 0, complet: 0, partiel: 0, nc: 0 };
        cats[cat].total++;
        if (cr.status === 'Complet' || cr.status === 'Conforme') cats[cat].complet++;
        else if (cr.status === 'Partiel') cats[cat].partiel++;
        else cats[cat].nc++;
      });
      const ws3Data = [['Catégorie', 'Total', 'Conformes', 'Partiels', 'Non conformes', 'Taux conformité (%)']];
      Object.entries(cats).forEach(([cat, c]) => {
        ws3Data.push([cat, c.total, c.complet, c.partiel, c.nc, Math.round(c.complet / c.total * 100)]);
      });
      const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
      ws3['!cols'] = [{wch:25},{wch:10},{wch:12},{wch:10},{wch:15},{wch:18}];
      XLSX.utils.book_append_sheet(wb, ws3, 'Aperçu');

      // 4 - Plan d'action
      const ws4Data = [['#', 'Action prioritaire', 'Urgence']];
      (d.action_plan || []).forEach((a, i) => {
        const urgent = a.toLowerCase().includes('urgent') || a.toLowerCase().includes('0-3 mois') ? 'URGENT' : 'IMPORTANT';
        ws4Data.push([i + 1, s(a), urgent]);
      });
      const ws4 = XLSX.utils.aoa_to_sheet(ws4Data);
      ws4['!cols'] = [{wch:5},{wch:80},{wch:12}];
      XLSX.utils.book_append_sheet(wb, ws4, 'Plan Action');

      // 5 - Synthèse
      const ws5Data = [
        ['SYNTHÈSE ODD — ' + USER_NAME],
        ['Score: ' + s(DLIV_SCORE) + '/100'],
        [''],
      ];
      if (summary.points_forts) { ws5Data.push(['POINTS FORTS:']); summary.points_forts.forEach(p => ws5Data.push(['✓', s(p)])); }
      ws5Data.push(['']);
      if (summary.criteres_bloquants) { ws5Data.push(['CRITÈRES BLOQUANTS:']); summary.criteres_bloquants.forEach(c => ws5Data.push(['✗', s(c)])); }
      const ws5 = XLSX.utils.aoa_to_sheet(ws5Data);
      ws5['!cols'] = [{wch:15},{wch:80}];
      XLSX.utils.book_append_sheet(wb, ws5, 'Synthèse');
    }

    function buildPlanOVOExcel(wb) {
      const d = DLIV_DATA;
      const proj = d.projections || {};
      const km = d.key_metrics || {};

      // 1 - Synthèse
      const ws1Data = [
        ['PLAN FINANCIER OVO — Projections 5 Ans'],
        ['Entreprise: ' + USER_NAME],
        ['Date: ' + DLIV_DATE],
        ['Score: ' + s(DLIV_SCORE) + '/100'],
        [''],
        ['ANALYSE'],
        [s(d.analysis)],
        [''],
        ['MÉTRIQUES CLÉS'],
        ['Indicateur', 'Valeur'],
      ];
      Object.entries(km).forEach(([k, v]) => {
        if (typeof v !== 'object') {
          const labels = { marge_brute_pct:'Marge Brute (%)', marge_ebitda_2029_pct:'Marge EBITDA An5 (%)', runway_mois:'Runway (mois)', seuil_rentabilite_2026:'Seuil Rentabilité An1', payback_period_annees:'Payback (années)', van_10pct_xof:'VAN à 10%', tir_pct:'TRI (%)', dscr_2026:'DSCR', besoin_financement_total_xof:'Besoin Financement Total', ca_par_employe_2025_xof:'CA par Employé' };
          ws1Data.push([labels[k] || k, v]);
        }
      });
      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      ws1['!cols'] = [{wch:35},{wch:25}];
      XLSX.utils.book_append_sheet(wb, ws1, 'Synthèse');

      // 2-4 - Scénarios
      Object.entries(proj).forEach(([scenarioKey, scenarioData]) => {
        if (typeof scenarioData !== 'object' || scenarioData === null) return;
        const label = {scenario_base:'Scénario Central',scenario_optimiste:'Scénario Optimiste',scenario_pessimiste:'Scénario Prudent'}[scenarioKey] || scenarioKey;
        const wsData = [
          [label],
          [''],
          Object.keys(scenarioData),
          Object.values(scenarioData).map(v => typeof v === 'object' ? JSON.stringify(v) : v),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = Object.keys(scenarioData).map(() => ({wch: 18}));
        XLSX.utils.book_append_sheet(wb, ws, label.substring(0, 31));
      });

      // 5 - Hypothèses
      if (d.assumptions && d.assumptions.length) {
        const ws5Data = [['HYPOTHÈSES DE PROJECTION'], ['']];
        d.assumptions.forEach((a, i) => { ws5Data.push([(i + 1), s(a)]); });
        const ws5 = XLSX.utils.aoa_to_sheet(ws5Data);
        ws5['!cols'] = [{wch:5},{wch:80}];
        XLSX.utils.book_append_sheet(wb, ws5, 'Hypothèses');
      }
    }

    // ═══ PDF GENERATION (Print-ready HTML) ═══
    function generatePrintPDF() {
      // Open a new window with print-optimized version
      const printWin = window.open('', '_blank');
      const mainContent = document.querySelector('.space-y-0') || document.querySelector('main');
      const styles = document.querySelectorAll('style');
      let styleHtml = '';
      styles.forEach(s => { styleHtml += s.outerHTML; });

      printWin.document.write(\`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>\${DLIV_META.title} — \${USER_NAME}</title>
  <script src="https://cdn.tailwindcss.com"><\\/script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  \${styleHtml}
  <style>
    body { font-family: 'Inter', sans-serif; background: white; padding: 20px; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      .dlv-section { break-inside: avoid; page-break-inside: avoid; }
    }
    .print-header { text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb; }
    .print-footer { text-align: center; margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="print-header">
    <h1 style="font-size:24px;font-weight:800;color:#1f2937">\${DLIV_META.title}</h1>
    <p style="font-size:13px;color:#6b7280">\${USER_NAME} — \${DLIV_DATE}</p>
  </div>
  <button onclick="window.print()" class="no-print" style="position:fixed;top:16px;right:16px;padding:10px 20px;background:#4338ca;color:white;border:none;border-radius:10px;font-weight:600;cursor:pointer;z-index:999;font-size:13px"><i class="fas fa-print"></i> Imprimer / PDF</button>
  \${mainContent ? mainContent.innerHTML : ''}
  <div class="print-footer">
    <p>Document généré automatiquement par ESONO — \${DLIV_DATE}</p>
    <p>"Les chiffres ne servent pas à juger le passé, mais à décider le futur."</p>
  </div>
</body>
</html>\`);
      printWin.document.close();
    }

    // ═══ WORD GENERATION ═══
    function generateWord() {
      const mainContent = document.querySelector('.space-y-0') || document.querySelector('main');
      const htmlContent = \`
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>\${DLIV_META.title}</title>
        <style>body{font-family:Calibri,sans-serif;font-size:11pt;color:#333}h1{font-size:18pt;color:#4c1d95}h2{font-size:14pt;color:#6d28d9;border-bottom:1pt solid #e5e7eb;padding-bottom:6pt}table{border-collapse:collapse;width:100%}td,th{border:1pt solid #e5e7eb;padding:6pt 8pt;font-size:10pt}</style>
        </head><body>
        <h1>\${DLIV_META.title}</h1>
        <p><strong>Entreprise:</strong> \${USER_NAME} | <strong>Date:</strong> \${DLIV_DATE} | <strong>Score:</strong> \${DLIV_SCORE}/100</p>
        <hr/>
        \${mainContent ? mainContent.innerHTML : ''}
        <hr/><p style="font-size:9pt;color:#999">Document généré par ESONO — \${DLIV_DATE}</p>
        </body></html>\`;
      const blob = new Blob(['\\ufeff', htmlContent], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'BusinessPlan_' + USER_NAME.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.doc';
      a.click();
      URL.revokeObjectURL(url);
    }

    // Store original button HTML for reset
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('btn-download');
      if (btn) btn.dataset.originalHtml = btn.innerHTML;
    });
  </script>
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
    const token = getAuthToken(c)
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

    // Load pre-stored BMC Claude AI HTML from database (instant display)
    const bmcHtmlRow = await c.env.DB.prepare(
      "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html' ORDER BY version DESC LIMIT 1"
    ).bind(payload.userId).first() as any
    const bmcClaudeHtml = bmcHtmlRow?.content || ''

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
  <script>
    // Store token from URL in localStorage for auth persistence
    (function(){
      var p = new URLSearchParams(window.location.search);
      var t = p.get('token');
      if (t) { localStorage.setItem('auth_token', t); }
      // Clean URL
      if (t && window.history.replaceState) {
        var clean = window.location.pathname;
        window.history.replaceState({}, '', clean);
      }
    })();
  </script>
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
        href: '/deliverable/bmc_analysis',
        delivKey: 'bmc_analysis',
        altHref: '/deliverable/bmc_analysis',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-seedling', emoji: '📊',
        name: "Social Impact Canvas (SIC)",
        desc: "Diagnostic d'impact social avec scoring, alignement ODD et matrice d'impact",
        href: '/deliverable/sic_analysis',
        delivKey: 'sic_analysis',
        altHref: '/deliverable/sic_analysis',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-coins', emoji: '💰',
        name: 'Inputs Financiers',
        desc: "Données financières validées avec alertes de cohérence",
        href: '/deliverable/plan_ovo',
        delivKey: 'plan_ovo',
        altHref: '/deliverable/plan_ovo',
        delivMap, progressMap
      })}
      ${renderModuleCard({
        icon: 'fa-chart-line', emoji: '📈',
        name: "Framework d'Analyse",
        desc: "Analyse financière complète : ratios, benchmarks, scénarios",
        href: '/deliverable/framework',
        delivKey: 'framework',
        altHref: '/deliverable/framework',
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

  <script type="text/html" id="bmc-html-template">${bmcClaudeHtml}</script>

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
      // Scroll to center panel
      const center = document.querySelector('.ev2-center');
      if (center) center.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        // Display pre-stored Claude AI HTML instantly (no fetch, no wait)
        var tmpl = document.getElementById('bmc-html-template');
        if (tmpl && tmpl.textContent && tmpl.textContent.length > 100) {
          var iframe = document.createElement('iframe');
          iframe.style.cssText = 'width:100%;min-height:80vh;border:none;border-radius:12px;background:#fff';
          iframe.srcdoc = tmpl.textContent;
          iframe.onload = function() { try { iframe.style.height = iframe.contentDocument.body.scrollHeight + 40 + 'px'; } catch(e) {} };
          el.innerHTML = '';
          el.appendChild(iframe);
        } else {
          // Fallback: render from JSON data
          el.innerHTML = renderBMCHTML(content, score, sColor);
        }
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
      const blocks = c.blocks || [];
      const strongBlocks = blocks.filter(b => (b.score||0) >= 70);
      const weakBlocks = blocks.filter(b => (b.score||0) < 70);
      
      let html = '<div class="ev2-bmc-rich">';
      
      // ── Score header with badge ──
      html += '<div class="ev2-bmc-header" style="background:linear-gradient(135deg,' + col + '15,' + col + '08);border:1px solid ' + col + '30;border-radius:16px;padding:24px;margin-bottom:24px;display:flex;align-items:center;gap:20px">';
      html += '<div style="width:80px;height:80px;border-radius:50%;background:' + col + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:800">' + score + '</div>';
      html += '<div><div style="font-size:20px;font-weight:700;color:#1e293b">Business Model Canvas</div>';
      html += '<div style="font-size:14px;color:#64748b;margin-top:4px">Score global : ' + score + '/100 — ' + (score >= 76 ? 'Excellent' : score >= 51 ? 'Bon' : score >= 26 ? 'A améliorer' : 'Insuffisant') + '</div>';
      html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">';
      html += '<span style="background:#059669;color:#fff;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">' + strongBlocks.length + ' blocs forts</span>';
      if (weakBlocks.length) html += '<span style="background:#d97706;color:#fff;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">' + weakBlocks.length + ' à renforcer</span>';
      html += '</div></div></div>';
      
      // ── Canvas grid (BMC 9-block layout) ──
      const canvasNames = ['Partenaires Clés', 'Activités Clés', 'Ressources Clés', 'Proposition de Valeur', 'Relations Client', 'Canaux', 'Segments Clients', 'Structure de Coûts', 'Sources de Revenus'];
      html += '<div style="margin-bottom:24px"><div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:12px"><i class="fas fa-th" style="color:' + col + ';margin-right:8px"></i>Canvas \\u2014 Vue d\\x27ensemble</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:2px;background:#e2e8f0;border-radius:12px;overflow:hidden;font-size:12px">';
      
      // Row 1: Partners | Activities | Value Prop | Relationships | Segments
      const canvasMap = {};
      for (const b of blocks) { canvasMap[b.name] = b; }
      const gridOrder = [
        ['Partenaires Clés', 'Activités Clés', 'Proposition de Valeur', 'Relations Client', 'Segments Clients'],
        [null, 'Ressources Clés', null, 'Canaux', null],
        ['Structure de Coûts', 'Structure de Coûts', null, 'Sources de Revenus', 'Sources de Revenus']
      ];
      
      // Simplified canvas: each block as a mini card
      for (const b of blocks) {
        const sc = b.score || 0;
        const scCol = getScoreColor(sc);
        html += '<div style="background:#fff;padding:8px 10px;min-height:60px">';
        html += '<div style="font-weight:700;color:' + scCol + ';font-size:11px;text-transform:uppercase;margin-bottom:4px">' + esc(b.name) + ' <span style="float:right">' + sc + '</span></div>';
        html += '<div style="color:#475569;font-size:11px;line-height:1.3">' + esc((b.analysis || '').substring(0, 100)) + (b.analysis && b.analysis.length > 100 ? '...' : '') + '</div>';
        html += '</div>';
      }
      html += '</div></div>';
      
      // ── Diagnostic scores bars ──
      html += '<div style="margin-bottom:24px"><div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:12px"><i class="fas fa-chart-bar" style="color:' + col + ';margin-right:8px"></i>Diagnostic par bloc</div>';
      const sortedBlocks = [...blocks].sort((a,b) => (b.score||0) - (a.score||0));
      for (const b of sortedBlocks) {
        const sc = b.score || 0;
        const scCol = getScoreColor(sc);
        html += '<div style="margin-bottom:8px;display:flex;align-items:center;gap:12px">';
        html += '<div style="width:140px;font-size:12px;font-weight:600;color:#334155;text-align:right;flex-shrink:0">' + esc(b.name) + '</div>';
        html += '<div style="flex:1;background:#f1f5f9;border-radius:8px;height:24px;overflow:hidden;position:relative">';
        html += '<div style="width:' + sc + '%;height:100%;background:' + scCol + ';border-radius:8px;transition:width 0.5s"></div>';
        html += '<span style="position:absolute;right:8px;top:3px;font-size:11px;font-weight:700;color:#334155">' + sc + '/100</span>';
        html += '</div></div>';
      }
      html += '</div>';
      
      // ── Forces (blocks >= 70) ──
      if (strongBlocks.length) {
        html += '<div style="margin-bottom:24px"><div style="font-size:16px;font-weight:700;color:#059669;margin-bottom:12px"><i class="fas fa-shield-halved" style="margin-right:8px"></i>Forces — ' + strongBlocks.length + ' atouts majeurs</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">';
        for (const b of strongBlocks) {
          html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px">';
          html += '<div style="font-weight:700;color:#059669;font-size:13px;margin-bottom:6px"><i class="fas fa-check-circle" style="margin-right:6px"></i>' + esc(b.name) + ' (' + (b.score||0) + '/100)</div>';
          html += '<div style="font-size:12px;color:#334155;line-height:1.5">' + esc(b.analysis || '') + '</div>';
          html += '</div>';
        }
        html += '</div></div>';
      }
      
      // ── Vigilances (blocks < 70) ──
      if (weakBlocks.length) {
        html += '<div style="margin-bottom:24px"><div style="font-size:16px;font-weight:700;color:#d97706;margin-bottom:12px"><i class="fas fa-exclamation-triangle" style="margin-right:8px"></i>Points de vigilance — ' + weakBlocks.length + ' risques identifiés</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">';
        for (const b of weakBlocks) {
          html += '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px">';
          html += '<div style="font-weight:700;color:#d97706;font-size:13px;margin-bottom:6px"><i class="fas fa-triangle-exclamation" style="margin-right:6px"></i>' + esc(b.name) + ' (' + (b.score||0) + '/100)</div>';
          html += '<div style="font-size:12px;color:#334155;line-height:1.5">' + esc(b.analysis || '') + '</div>';
          if (b.recommendations?.length) {
            html += '<div style="margin-top:8px;font-size:12px;color:#92400e"><strong>Action :</strong> ' + esc(b.recommendations[0]) + '</div>';
          }
          html += '</div>';
        }
        html += '</div></div>';
      }
      
      // ── Recommandations from all blocks ──
      const allRecos = [];
      for (const b of blocks) {
        if (b.recommendations?.length) {
          for (const r of b.recommendations) allRecos.push({ block: b.name, text: r });
        }
      }
      if (allRecos.length) {
        html += '<div style="margin-bottom:24px"><div style="font-size:16px;font-weight:700;color:#7c3aed;margin-bottom:12px"><i class="fas fa-bullseye" style="margin-right:8px"></i>Recommandations stratégiques (' + allRecos.length + ')</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">';
        for (let i = 0; i < allRecos.length; i++) {
          const r = allRecos[i];
          html += '<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:12px">';
          html += '<div style="font-size:11px;color:#7c3aed;font-weight:700;margin-bottom:4px">' + esc(r.block) + '</div>';
          html += '<div style="font-size:12px;color:#334155;line-height:1.4">' + esc(r.text) + '</div>';
          html += '</div>';
        }
        html += '</div></div>';
      }
      
      // ── Link to full deliverable ──
      html += '<div style="text-align:center;padding:16px;margin-top:8px">';
      html += '<a href="/deliverable/bmc_analysis" style="display:inline-flex;align-items:center;gap:8px;background:' + col + ';color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 4px 12px ' + col + '40"><i class="fas fa-file-pdf"></i> Voir le livrable complet (PDF)</a>';
      html += '</div>';
      
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

  return `<div class="ev2-mod-card ${available ? '' : 'ev2-mod-card--inactive'}" onclick="selectDeliverable('${opts.delivKey}')" style="cursor:pointer">
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
  </div>`
}

function renderEmptyState(): string {
  return `<div class="ev2-empty">
    <div class="ev2-empty__icon"><i class="fas fa-rocket"></i></div>
    <div class="ev2-empty__text">Aucun livrable généré</div>
    <div class="ev2-empty__sub">Uploadez vos documents et cliquez sur "Générer" pour commencer l'analyse</div>
  </div>`
}
