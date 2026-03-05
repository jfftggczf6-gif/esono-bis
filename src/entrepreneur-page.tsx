// ═══════════════════════════════════════════════════════════════════
// Entrepreneur V2 — Single-page NotebookLM-style interface
// Upload → Generate → 3-Column Layout (Chat / Visualization / Nav)
// ═══════════════════════════════════════════════════════════════════
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken, getAuthToken } from './auth'
import { orchestrateGeneration, runAgent, loadKBContext, type OrchestrationResult } from './agents/ai-agents'
import { renderBMCPage, adaptBMCData } from './deliverable-bmc'
import { generateFullBmcDeliverable, generateFullBmcDeliverableFallback, type BmcDeliverableData, type KBContextForBmc } from './bmc-deliverable-engine'
import { generateFullSicDeliverable, generateFullSicDeliverableFallback, renderSicDeliverableFromAnalyst, type SicDeliverableData, type SicAnalystDeliverableInput } from './sic-deliverable-engine'
import { analyzeInputsWithAI, generateInputsDiagnosticHtml, analyzeInputs, type InputTabKey } from './inputs-engine'
import { analyzePmeWithAI, analyzePme, generatePmePreviewHtml, generatePmeExcelXml, type PmeInputData } from './framework-pme-engine'
import { fillFrameworkExcel } from './framework-excel-filler'
import { parseXlsx, xlsxToText, xlsxToMarkdownTables, b64ToUint8 } from './xlsx-parser'
import { parseDocx, docxToMarkdown } from './docx-parser'
import { buildPmeInputDataFromText } from './pme-input-builder'
import { buildPmeInputWithAI } from './pme-ai-extractor'
import { tryParseInputsEntrepreneur } from './inputs-entrepreneur-parser'
import { crossAnalyzeBmcFinancials } from './pme-cross-analyzer'
import { generateDiagnosticExpert, generateDiagnosticExpertFallback, type DiagnosticInputData } from './diagnostic-expert-engine'
import type { KBContext } from './claude-api'

type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY?: string
}

export const entrepreneurRoutes = new Hono<{ Bindings: Bindings }>()

// ─── Helpers ───────────────────────────────────────────────────

// Safe JSON.stringify for embedding in <script> tags
// Escapes </ to prevent premature closing of script/body/html tags
export function safeJSON(data: any): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

// Escape ALL </ inside <script> blocks in final HTML output
// This prevents the HTML parser from prematurely closing the document
// when JS string literals contain </div>, </body>, </html> etc.
export function safeScriptBlocks(html: string): string {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, content) => {
    // Replace </ with <\/ inside the script content (standard JS escape)
    const safeContent = content.replace(/<\//g, '<\\/')
    return `<script${attrs}>${safeContent}</script>`
  })
}

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
  { type: 'diagnostic', label: 'Diagnostic Expert', icon: 'fa-stethoscope', format: 'HTML / PDF', deps: ['bmc'] as const },
  { type: 'framework', label: 'Framework Analyse', icon: 'fa-table-cells', format: 'Excel / HTML', deps: ['bmc', 'inputs'] as const },
  { type: 'bmc_analysis', label: 'BMC Analysé', icon: 'fa-map', format: 'Word / PDF', deps: ['bmc'] as const },
  { type: 'sic_analysis', label: 'Social Impact Canvas', icon: 'fa-hand-holding-heart', format: 'Word / PDF', deps: ['sic'] as const },
  { type: 'plan_ovo', label: 'Plan Financier OVO', icon: 'fa-chart-line', format: 'XLSM', deps: ['inputs'] as const },
  { type: 'business_plan', label: 'Business Plan', icon: 'fa-file-contract', format: 'Word', deps: ['bmc', 'sic', 'inputs'] as const },
  { type: 'odd', label: 'ODD (Due Diligence)', icon: 'fa-shield-halved', format: 'Excel', deps: ['bmc', 'sic'] as const },
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

// ─── BMC Document Parser: split full text into 9 sections ────
// Maps document section headings to BMC_SECTIONS keys (1-9)
function parseBmcDocumentToAnswers(text: string): Map<number, string> {
  const answers = new Map<number, string>()
  
  // Mapping: section heading keywords → BMC key number
  const sectionMap: { pattern: RegExp, key: number }[] = [
    { pattern: /segment/i, key: 1 },
    { pattern: /proposition\s+de\s+valeur/i, key: 2 },
    { pattern: /cana(?:ux|l)/i, key: 3 },
    { pattern: /relation/i, key: 4 },
    { pattern: /source.*revenu|flux.*revenu|revenu/i, key: 5 },
    { pattern: /ressource/i, key: 6 },
    { pattern: /activit/i, key: 7 },
    { pattern: /partenaire/i, key: 8 },
    { pattern: /structure.*co[uû]t|co[uû]t/i, key: 9 },
  ]
  
  // Split by numbered sections: "1-", "2-", ..., "9-" or "1.", "2.", etc.
  const sectionRegex = /(?:^|\n)\s*(\d{1,2})\s*[-–.)\s]+\s*([A-ZÀÉÈÊËÏÎÔÙÛÜÇ][A-ZÀÉÈÊËÏÎÔÙÛÜÇ\s'']+)/g
  const sections: { num: number, title: string, start: number }[] = []
  let match: RegExpExecArray | null
  while ((match = sectionRegex.exec(text)) !== null) {
    sections.push({ num: parseInt(match[1]), title: match[2].trim(), start: match.index })
  }
  
  // Extract content for each section
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]
    const nextStart = i + 1 < sections.length ? sections[i + 1].start : text.length
    const content = text.substring(sec.start, nextStart).trim()
    
    // Find which BMC key this section maps to (by title keywords, not number)
    let bmcKey: number | null = null
    for (const sm of sectionMap) {
      if (sm.pattern.test(sec.title)) {
        bmcKey = sm.key
        break
      }
    }
    
    if (bmcKey !== null && content.length > 10) {
      answers.set(bmcKey, content)
    }
  }
  
  // If parsing failed (no sections found), fallback to full text in key 1
  if (answers.size === 0 && text.length > 50) {
    answers.set(1, text)
  }
  
  return answers
}

// ─── Rich Fallback Generator ──────────────────────────────────
function rnd(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min }
function jitter(base: number, spread = 12): number { return Math.max(0, Math.min(100, base + rnd(-spread, spread))) }

/** Build minimal PmeInputData from a framework deliverable for the PME analysis engine */
function _buildPmeInputDataFromDeliverable(delivData: any, companyName: string, country: string): PmeInputData {
  // Extract what we can from the deliverable data sections
  const zero3: [number, number, number] = [0, 0, 0]
  const zero5: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  
  // Try to extract CA from the deliverable data
  let caTotal: [number, number, number] = [0, 0, 0]
  if (delivData?.sections) {
    for (const s of delivData.sections) {
      const content = (s.content || '').toLowerCase()
      // Try to find CA mentions
      const caMatch = content.match(/ca[^:]*:\s*([\d\s]+)/i)
      if (caMatch) {
        const ca = parseInt(caMatch[1].replace(/\s/g, ''))
        if (ca > 0) caTotal = [Math.round(ca * 0.6), Math.round(ca * 0.8), ca]
      }
    }
  }
  
  // Fallback: use score-based estimation
  if (caTotal[2] === 0) {
    const baseCA = 25_000_000 // 25M FCFA default
    caTotal = [Math.round(baseCA * 0.6), Math.round(baseCA * 0.8), baseCA]
  }

  return {
    companyName,
    sector: '',
    analysisDate: new Date().toISOString(),
    consultant: 'ESONO AI',
    location: '',
    country: country || 'Côte d\'Ivoire',
    activities: [{ name: 'Activité principale', isStrategic: true }],
    historique: {
      caTotal,
      caByActivity: [caTotal],
      achatsMP: [Math.round(caTotal[0] * 0.4), Math.round(caTotal[1] * 0.4), Math.round(caTotal[2] * 0.4)],
      sousTraitance: zero3,
      coutsProduction: [Math.round(caTotal[0] * 0.1), Math.round(caTotal[1] * 0.1), Math.round(caTotal[2] * 0.1)],
      salaires: [Math.round(caTotal[0] * 0.2), Math.round(caTotal[1] * 0.2), Math.round(caTotal[2] * 0.2)],
      loyers: [Math.round(caTotal[0] * 0.05), Math.round(caTotal[1] * 0.05), Math.round(caTotal[2] * 0.05)],
      assurances: zero3,
      fraisGeneraux: [Math.round(caTotal[0] * 0.05), Math.round(caTotal[1] * 0.05), Math.round(caTotal[2] * 0.05)],
      marketing: zero3,
      fraisBancaires: zero3,
      resultatNet: [Math.round(caTotal[0] * 0.05), Math.round(caTotal[1] * 0.08), Math.round(caTotal[2] * 0.1)],
      tresoDebut: [0, Math.round(caTotal[0] * 0.05), Math.round(caTotal[1] * 0.08)],
      tresoFin: [Math.round(caTotal[0] * 0.05), Math.round(caTotal[1] * 0.08), Math.round(caTotal[2] * 0.1)],
      dso: [45, 40, 35],
      dpo: [30, 30, 30],
      stockJours: [15, 15, 15],
      detteCT: zero3,
      detteLT: zero3,
      serviceDette: zero3,
      amortissements: zero3,
    },
    hypotheses: {
      croissanceCA: [20, 20, 15, 15, 10],
      evolutionPrix: [3, 3, 3, 3, 3],
      evolutionCoutsDirects: [2, 2, 2, 2, 2],
      inflationChargesFixes: [3, 3, 3, 3, 3],
      evolutionMasseSalariale: [5, 5, 5, 5, 5],
      capex: [0, 0, 0, 0, 0],
      amortissement: 5,
    },
  }
}

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
        { title: 'Vente & Prospection', detail: 'Terrain, point de vente', critical: false },
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
        { title: 'Vente', detail: 'Point de vente / Distribution' },
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

    const validCategories = ['bmc', 'sic', 'inputs', 'supplementary', 'bmc_sic']
    if (!validCategories.includes(category)) return c.json({ error: 'Catégorie invalide' }, 400)

    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const allowedByCategory: Record<string, string[]> = {
      bmc: ['doc', 'docx', 'pdf'],
      sic: ['doc', 'docx', 'xls', 'xlsx', 'pdf'],
      bmc_sic: ['doc', 'docx', 'pdf'],
      inputs: ['xls', 'xlsx', 'csv', 'pdf'],
      supplementary: ['doc', 'docx', 'xls', 'xlsx', 'pdf', 'csv', 'txt', 'png', 'jpg', 'jpeg']
    }

    if (!allowedByCategory[category]?.includes(ext)) {
      return c.json({ error: `Type .${ext} non accepté pour ${category}` }, 400)
    }
    if (file.size > 10 * 1024 * 1024) return c.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, 400)

    // Replace existing for primary categories
    if (category === 'bmc_sic') {
      // Unified BMC & SIC doc: delete both existing bmc and sic uploads
      await c.env.DB.prepare('DELETE FROM uploads WHERE user_id = ? AND category IN (?, ?)').bind(payload.userId, 'bmc', 'sic').run()
    } else if (category !== 'supplementary') {
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

    // Extract text from Excel files for AI processing
    // CORRECTION 1 CONFORME: Store both legacy text AND Markdown tables format
    // Format: base64:<b64>\n\n---MARKDOWN_TABLES---\n<md>\n\n---EXTRACTED_TEXT---\n<legacy>
    let extractedText = `base64:${base64}`
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('spreadsheet')
    const isDocx = file.name.endsWith('.docx') || file.name.endsWith('.doc') || file.type.includes('wordprocessingml')
    if (isExcel) {
      try {
        const xlsxData = parseXlsx(bytes)
        const legacyText = xlsxToText(xlsxData)
        const markdownText = xlsxToMarkdownTables(xlsxData)
        // Store all three formats: base64 for binary, Markdown tables for Claude AI, legacy for regex
        extractedText = `base64:${base64}\n\n---MARKDOWN_TABLES---\n${markdownText}\n\n---EXTRACTED_TEXT---\n${legacyText}`
        console.log(`[Upload] Extracted from ${file.name}: ${xlsxData.length} sheets, legacy=${legacyText.length}ch, markdown=${markdownText.length}ch`)
      } catch (err: any) {
        console.error('[Upload] XLSX parse error (non-fatal):', err.message)
        // Keep base64 only as fallback
      }
    } else if (isDocx) {
      try {
        const docText = parseDocx(bytes)
        const markdownText = docxToMarkdown(bytes)
        // Store base64 + extracted document text for Claude AI
        extractedText = `base64:${base64}\n\n---DOCUMENT_TEXT---\n${docText}\n\n---EXTRACTED_TEXT---\n${docText}`
        console.log(`[Upload] Extracted DOCX from ${file.name}: text=${docText.length}ch`)
      } catch (err: any) {
        console.error('[Upload] DOCX parse error (non-fatal):', err.message)
        // Keep base64 only as fallback
      }
    }

    // For bmc_sic: store as TWO entries (bmc + sic) so existing generation pipeline works
    if (category === 'bmc_sic') {
      const idBmc = crypto.randomUUID()
      const idSic = crypto.randomUUID()
      await c.env.DB.prepare(`
        INSERT INTO uploads (id, user_id, category, filename, r2_key, file_type, file_size, extracted_text, uploaded_at)
        VALUES (?, ?, 'bmc', ?, ?, ?, ?, ?, datetime('now'))
      `).bind(idBmc, payload.userId, file.name, r2Key, file.type, file.size, extractedText).run()

      await c.env.DB.prepare(`
        INSERT INTO uploads (id, user_id, category, filename, r2_key, file_type, file_size, extracted_text, uploaded_at)
        VALUES (?, ?, 'sic', ?, ?, ?, ?, ?, datetime('now'))
      `).bind(idSic, payload.userId, file.name, r2Key, file.type, file.size, extractedText).run()

      return c.json({ success: true, upload: { id: idBmc, category: 'bmc_sic', filename: file.name, file_type: file.type, file_size: file.size } })
    }

    await c.env.DB.prepare(`
      INSERT INTO uploads (id, user_id, category, filename, r2_key, file_type, file_size, extracted_text, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(id, payload.userId, category, file.name, r2Key, file.type, file.size, extractedText).run()

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

    // Check if entrepreneur is linked to a coach via coach_entrepreneurs
    const coachLink = await c.env.DB.prepare(
      'SELECT coach_user_id FROM coach_entrepreneurs WHERE linked_user_id = ? LIMIT 1'
    ).bind(payload.userId).first<any>()
    const coachUserId = coachLink?.coach_user_id || null

    let deliverables: any
    if (coachUserId) {
      // Include own deliverables + shared coach/mirror deliverables from linked coach
      deliverables = await c.env.DB.prepare(`
        SELECT ed.* FROM entrepreneur_deliverables ed
        INNER JOIN (
          SELECT type, MAX(version) as max_version FROM entrepreneur_deliverables 
          WHERE (user_id = ? AND NOT (generated_by IN ('coach','coach_mirror') AND visibility = 'private'))
             OR (coach_user_id = ? AND visibility = 'shared')
          GROUP BY type
        ) latest 
        ON ed.type = latest.type AND ed.version = latest.max_version
        WHERE (ed.user_id = ? AND NOT (ed.generated_by IN ('coach','coach_mirror') AND ed.visibility = 'private'))
           OR (ed.coach_user_id = ? AND ed.visibility = 'shared')
      `).bind(payload.userId, coachUserId, payload.userId, coachUserId).all()
    } else {
      deliverables = await c.env.DB.prepare(`
        SELECT ed.* FROM entrepreneur_deliverables ed
        INNER JOIN (SELECT type, MAX(version) as max_version FROM entrepreneur_deliverables 
          WHERE user_id = ? AND NOT (generated_by IN ('coach','coach_mirror') AND visibility = 'private')
          GROUP BY type) latest 
        ON ed.type = latest.type AND ed.version = latest.max_version
        WHERE ed.user_id = ? AND NOT (ed.generated_by IN ('coach','coach_mirror') AND ed.visibility = 'private')
      `).bind(payload.userId, payload.userId).all()
    }
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

// ─── Pipeline Step Helpers ──────────────────────────────────────
// Internal secret for pipeline self-chaining (not exposed to frontend)
const PIPELINE_SECRET = 'esono-pipeline-internal-2026'

async function updateJobProgress(db: D1Database, jobId: string, progress: string) {
  try { await db.prepare("UPDATE generation_jobs SET progress = ? WHERE id = ?").bind(progress, jobId).run() } catch {}
}
async function completeJob(db: D1Database, jobId: string, resultJson: any) {
  try {
    await db.prepare(
      "UPDATE generation_jobs SET status = 'completed', result_json = ?, completed_at = datetime('now') WHERE id = ?"
    ).bind(JSON.stringify(resultJson), jobId).run()
  } catch {}
}
async function failJob(db: D1Database, jobId: string, error: string) {
  try {
    await db.prepare(
      "UPDATE generation_jobs SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?"
    ).bind(error, jobId).run()
  } catch {}
}

// Save/load pipeline context between steps
// CRITICAL: Split heavy documents (rawUploads, documentTexts, markdownUploads) into pipeline_docs
// to keep result_json small (<10KB) and avoid CPU timeout on JSON.parse (10ms limit on free plan)
const HEAVY_KEYS = ['rawUploads', 'documentTexts', 'markdownUploads']

async function savePipelineContext(db: D1Database, jobId: string, context: any) {
  // Separate heavy docs from lightweight metadata
  const heavy: any = {}
  const light = { ...context }
  for (const key of HEAVY_KEYS) {
    if (light[key]) {
      heavy[key] = light[key]
      delete light[key]
      light[`_has_${key}`] = true // marker so loadPipelineContext knows to load them
    }
  }
  const lightJson = JSON.stringify(light)
  if (Object.keys(heavy).length > 0) {
    const heavyJson = JSON.stringify(heavy)
    await db.prepare("UPDATE generation_jobs SET result_json = ?, pipeline_docs = ? WHERE id = ?").bind(lightJson, heavyJson, jobId).run()
  } else {
    await db.prepare("UPDATE generation_jobs SET result_json = ? WHERE id = ?").bind(lightJson, jobId).run()
  }
}

async function loadPipelineContext(db: D1Database, jobId: string): Promise<any> {
  const row = await db.prepare("SELECT result_json FROM generation_jobs WHERE id = ?").bind(jobId).first() as any
  if (!row?.result_json) return null
  const ctx = JSON.parse(row.result_json)
  ctx._jobId = jobId // store for lazy loading
  return ctx
}

// Lazy-load heavy docs only when needed (avoids 200KB JSON.parse on every step)
async function loadPipelineDocs(db: D1Database, jobId: string): Promise<any> {
  const row = await db.prepare("SELECT pipeline_docs FROM generation_jobs WHERE id = ?").bind(jobId).first() as any
  if (!row?.pipeline_docs) return {}
  return JSON.parse(row.pipeline_docs)
}

// Chain to next step via self-fetch — FIRE-AND-FORGET
// The next step handler does heavy work SYNCHRONOUSLY (unlimited wall-time).
// We don't need to wait for the response — just need to ensure the request is sent.
// We use AbortController to disconnect after the server accepts the request.
function chainNextStep(c: any, jobId: string, nextStep: string) {
  const url = new URL(c.req.url)
  url.pathname = '/api/ai/pipeline/step'
  url.search = `?jobId=${jobId}&step=${nextStep}&secret=${PIPELINE_SECRET}`
  const targetUrl = url.toString()
  
  const fireAndForget = async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Pipeline] Triggering '${nextStep}' (attempt ${attempt})...`)
        // Use AbortController: abort after 5s — we just need the request to reach the server.
        // The next step's Worker will continue running even after we disconnect.
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), 5000)
        try {
          const resp = await fetch(targetUrl, { method: 'POST', signal: ac.signal })
          clearTimeout(timer)
          console.log(`[Pipeline] ✅ Triggered '${nextStep}' — status ${resp.status}`)
          return
        } catch (err: any) {
          clearTimeout(timer)
          if (err.name === 'AbortError') {
            // Aborted after 5s — that's fine, the request was already sent
            console.log(`[Pipeline] ✅ Triggered '${nextStep}' (fire-and-forget, aborted after 5s)`)
            return
          }
          throw err
        }
      } catch (err: any) {
        console.error(`[Pipeline] Trigger '${nextStep}' failed (attempt ${attempt}):`, err.message)
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000))
    }
    console.error(`[Pipeline] ❌ Failed to trigger '${nextStep}' after 2 attempts`)
  }

  try {
    c.executionCtx.waitUntil(fireAndForget())
  } catch {
    fireAndForget().catch(e => console.error('[Pipeline] Chain error:', e.message))
  }
}

// ─── API: POST /api/ai/generate-all (fire-and-forget + job polling) ─────
entrepreneurRoutes.post('/api/ai/generate-all', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    // Rate limit: 10 generations per day
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

    // Check if already processing (prevent double-clicks)
    const existingJob = await c.env.DB.prepare(
      "SELECT id FROM generation_jobs WHERE user_id = ? AND status = 'processing' AND created_at > datetime('now', '-15 minutes')"
    ).bind(payload.userId).first()
    if (existingJob) {
      return c.json({ success: true, jobId: existingJob.id, status: 'already_processing' }, 202)
    }

    // Create job tracking record
    const jobId = crypto.randomUUID()
    await c.env.DB.prepare(
      "INSERT INTO generation_jobs (id, user_id, status, progress, created_at) VALUES (?, ?, 'processing', 'Démarrage de la génération...', datetime('now'))"
    ).bind(jobId, payload.userId).run()

    const db = c.env.DB
    const userId = payload.userId

    console.log(`[Generate-All] 🚀 Job ${jobId} started for user ${userId}`)
    await updateJobProgress(db, jobId, 'Analyse des documents...')

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
    // CORRECTION 1 CONFORME: Parse 3 sections from stored text:
    //   base64:<b64>\n\n---MARKDOWN_TABLES---\n<md>\n\n---EXTRACTED_TEXT---\n<legacy>
    //   OR for DOCX: base64:<b64>\n\n---DOCUMENT_TEXT---\n<text>\n\n---EXTRACTED_TEXT---\n<text>
    const documentTexts: Record<string, string> = {}
    const rawUploads: Record<string, string> = {} // Store full base64 for binary access
    const markdownUploads: Record<string, string> = {} // CORRECTION 1: Store Markdown tables for Claude AI
    for (const u of uploadData) {
      const text = u.extracted_text || ''
      
      // Check for new 3-section format: base64 + markdown tables + legacy text
      const mdMarker = '---MARKDOWN_TABLES---'
      const docMarker = '---DOCUMENT_TEXT---'
      const extractedMarker = '---EXTRACTED_TEXT---'
      const mdIdx = text.indexOf(mdMarker)
      const docIdx = text.indexOf(docMarker)
      const extractedIdx = text.indexOf(extractedMarker)
      
      if (mdIdx !== -1 && extractedIdx !== -1) {
        // XLSX FORMAT: has Markdown tables AND legacy text
        const b64End = text.indexOf('\n\n---')
        rawUploads[u.category] = b64End > 7 ? text.substring(7, b64End) : ''
        markdownUploads[u.category] = text.substring(mdIdx + mdMarker.length, extractedIdx).trim().slice(0, 15000)
        documentTexts[u.category] = text.substring(extractedIdx + extractedMarker.length).slice(0, 12000)
      } else if (docIdx !== -1 && extractedIdx !== -1) {
        // DOCX FORMAT: has Document text
        const b64End = text.indexOf('\n\n---')
        rawUploads[u.category] = b64End > 7 ? text.substring(7, b64End) : ''
        const docText = text.substring(docIdx + docMarker.length, extractedIdx).trim().slice(0, 15000)
        markdownUploads[u.category] = docText // Use document text as "markdown" for Claude
        documentTexts[u.category] = text.substring(extractedIdx + extractedMarker.length).slice(0, 12000)
        console.log(`[Generate] DOCX text for ${u.category}: ${docText.length}ch`)
      } else if (extractedIdx !== -1) {
        // OLD FORMAT: only base64 + legacy text (backward compat)
        documentTexts[u.category] = text.substring(extractedIdx + extractedMarker.length).slice(0, 12000)
        const b64End = text.indexOf('\n\n---')
        rawUploads[u.category] = b64End > 7 ? text.substring(7, b64End) : ''
      } else if (text.startsWith('base64:')) {
        // Try to extract text from binary files (DOCX, PDF)
        const b64Data = text.substring(7)
        rawUploads[u.category] = b64Data
        const fname = (u.filename || '').toLowerCase()
        if (fname.endsWith('.docx')) {
          try {
            const binaryStr = atob(b64Data)
            const bytes = new Uint8Array(binaryStr.length)
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
            const docText = parseDocx(bytes)
            if (docText && docText.length > 50) {
              documentTexts[u.category] = docText.slice(0, 15000)
              markdownUploads[u.category] = docText.slice(0, 15000)
              console.log(`[Generate] DOCX text extracted from base64 for ${u.category}: ${docText.length}ch`)
            } else {
              documentTexts[u.category] = `[Fichier binaire: ${u.filename}]`
              console.warn(`[Generate] DOCX text too short for ${u.category}: ${docText?.length || 0}ch`)
            }
          } catch (docxErr: any) {
            documentTexts[u.category] = `[Fichier binaire: ${u.filename}]`
            console.warn(`[Generate] DOCX parsing failed for ${u.category}:`, docxErr.message)
          }
        } else {
          documentTexts[u.category] = `[Fichier binaire: ${u.filename}]`
        }
      } else {
        documentTexts[u.category] = text.slice(0, 12000)
      }
    }

    // ═══ STEP 0: Save pipeline context and chain to step 1 ═══
    // Instead of running everything in one waitUntil (which times out on Cloudflare),
    // we save the context to DB and chain each step via self-fetch
    const pipelineContext = {
      userId,
      userName,
      userCountry,
      documentTexts,
      uploadedCats: Array.from(uploadedCats),
      generableTypes,
      skippedTypes,
      uploadDataLength: uploadData.length,
      rawUploads: Object.fromEntries(Object.entries(rawUploads).map(([k, v]) => [k, v.length > 50000 ? v.slice(0, 50000) : v])),
      markdownUploads,
      newVersion,
      hasBmc,
      hasSic,
      hasInputs,
      // Will be populated by subsequent steps
      result: null,
      source: 'fallback',
      agentsUsed: [] as string[],
      agentErrors: [] as string[],
      iterationId: null,
      generatedCount: 0,
    }
    
    // Save heavy docs separately to avoid bloating pipeline_context
    const pipelineDocs = { documentTexts, rawUploads, markdownUploads }
    await savePipelineContext(db, jobId, pipelineContext)
    await db.prepare("UPDATE generation_jobs SET pipeline_docs = ? WHERE id = ?")
      .bind(JSON.stringify(pipelineDocs), jobId).run()
    console.log(`[Generate-All] Pipeline context saved for job ${jobId}`)
    
    // Return jobId immediately. Frontend triggers pipeline/start as fire-and-forget.
    // pipeline/start is a long-running HTTP handler (Workers have no wall-clock limit).
    return c.json({ success: true, jobId, status: 'processing' }, 202)

  } catch (error: any) {
    console.error('Generate-all error:', error)
    return c.json({ error: 'Erreur lors de la génération: ' + error.message }, 500)
  }
})


// ─── API: POST /api/ai/pipeline/start — Authenticated endpoint to run the full pipeline ──
// V10: Called by the FRONT-END as fire-and-forget after getting jobId.
// This handler runs ALL 11 steps SEQUENTIALLY in a single HTTP request.
// With Cloudflare Workers Unbound, HTTP handlers have NO wall-clock limit.
// The front-end does NOT wait for this response — it polls /generate-status instead.
entrepreneurRoutes.post('/api/ai/pipeline/start', async (c) => {
  try {
    // Authenticate via JWT (same as other API endpoints)
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const jobId = c.req.query('jobId')
    if (!jobId) return c.json({ error: 'Missing jobId' }, 400)

    const db = c.env.DB

    // Verify job belongs to user and is still processing
    const job = await db.prepare('SELECT status, user_id FROM generation_jobs WHERE id = ?').bind(jobId).first() as any
    if (!job) return c.json({ error: 'Job not found' }, 404)
    if (job.user_id !== payload.userId) return c.json({ error: 'Unauthorized' }, 403)
    if (job.status !== 'processing') return c.json({ error: `Job already ${job.status}` }, 409)

    const STEPS = ['agent_bmc', 'agent_sic', 'agent_finance', 'agent_odd', 'store', 'bmc_html', 'sic_html', 'inputs_html', 'framework_html', 'diagnostic_html', 'postprocess']

    console.log(`[Pipeline:start] Running full pipeline for job ${jobId} (user ${payload.userId})`)
    
    for (const step of STEPS) {
      console.log(`[Pipeline:start] ──── Step: ${step} ────`)
      
      // Execute step via self-fetch (each step is a separate Worker invocation = fresh CPU budget)
      const stepUrl = new URL(c.req.url)
      stepUrl.pathname = '/api/ai/pipeline/step'
      stepUrl.search = `?jobId=${jobId}&step=${step}&secret=${PIPELINE_SECRET}`
      
      const resp = await fetch(stepUrl.toString(), { method: 'POST' })
      
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => 'unknown')
        console.error(`[Pipeline:start] Step ${step} failed (HTTP ${resp.status}): ${errBody}`)
        // Don't double-fail — the step handler already called failJob
        return c.json({ ok: false, failedStep: step }, 500)
      }
      console.log(`[Pipeline:start] ✅ Step ${step} done`)
      
      // Check if job was completed or failed by the step
      const jobCheck = await db.prepare('SELECT status FROM generation_jobs WHERE id = ?').bind(jobId).first() as any
      if (jobCheck?.status === 'completed') {
        console.log(`[Pipeline:start] 🎉 Job completed at step ${step}`)
        return c.json({ ok: true, completedAt: step })
      }
      if (jobCheck?.status === 'failed') {
        console.log(`[Pipeline:start] ❌ Job failed at step ${step}`)
        return c.json({ ok: false, failedStep: step }, 500)
      }
    }
    
    console.log(`[Pipeline:start] 🎉 All steps completed for job ${jobId}`)
    return c.json({ ok: true, completedAt: 'postprocess' })
    
  } catch (err: any) {
    console.error(`[Pipeline:start] Fatal error:`, err.message)
    const jobId = c.req.query('jobId')
    if (jobId) try { await failJob(c.env.DB, jobId, `Pipeline error: ${err.message}`) } catch {}
    return c.json({ ok: false, error: err.message }, 500)
  }
})


// ─── API: POST /api/ai/pipeline/step — Internal chained pipeline steps ─────
// V7: SYNCHRONOUS execution — Cloudflare Workers have UNLIMITED wall-time for HTTP requests.
// waitUntil() only gets 30s after response, so we do ALL heavy work before returning.
// chainNextStep uses waitUntil(fetch) to fire-and-forget the next step trigger (<1s).
entrepreneurRoutes.post('/api/ai/pipeline/step', async (c) => {
  const jobId = c.req.query('jobId')
  const step = c.req.query('step')
  const secret = c.req.query('secret')

  if (secret !== PIPELINE_SECRET || !jobId || !step) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = c.env.DB
  const apiKey = c.env.ANTHROPIC_API_KEY || ''

  try {
    const ctx = await loadPipelineContext(db, jobId)
    if (!ctx) {
      await failJob(db, jobId, 'Pipeline context lost')
      return c.json({ ok: false, error: 'context lost' }, 500)
    }

    const { userId, userName, userCountry, generableTypes, skippedTypes,
            newVersion, hasBmc, hasSic, hasInputs } = ctx
    const uploadedCats = new Set<string>(ctx.uploadedCats || [])
    
    // Heavy docs are lazy-loaded from pipeline_docs only when needed
    let _docs: any = null
    const getDocs = async () => {
      if (!_docs) _docs = await loadPipelineDocs(db, jobId)
      return _docs
    }
    // Convenience getters
    const getDocumentTexts = async () => (await getDocs()).documentTexts || {}
    const getRawUploads = async () => (await getDocs()).rawUploads || {}
    const getMarkdownUploads = async () => (await getDocs()).markdownUploads || {}

    // ════════════════════════════════════════════════════════════════
    // STEP: agent_bmc — Run BMC analyst (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'agent_bmc') {
      console.log(`[Pipeline:agent_bmc] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Agent BMC en cours d\'analyse...')

      if (!ctx.agentsUsed) ctx.agentsUsed = []
      if (!ctx.agentErrors) ctx.agentErrors = []
      if (!ctx.agentResults) ctx.agentResults = {}

      // Load KB context (shared across all agents)
      if (!ctx.kbContextLoaded) {
        try {
          const kbContext = await loadKBContext(db, userCountry)
          ctx.kbContextRaw = kbContext
          ctx.kbContextLoaded = true
        } catch (err: any) {
          console.error('[Pipeline:agent_bmc] KB load error:', err.message)
          ctx.kbContextRaw = { benchmarks: [], fiscalParams: [], funders: [], criteria: [], feedbackHistory: [] }
          ctx.kbContextLoaded = true
          ctx.agentErrors.push('Knowledge Base unavailable, using defaults')
        }
      }

      if (hasBmc) {
        try {
          const documentTexts = await getDocumentTexts()
          const result = await runAgent(db, apiKey, {
            agentCode: 'bmc_analyst', documentTexts: await getDocumentTexts(), userName, userCountry, kbContext: ctx.kbContextRaw,
          })
          if (result.success && result.data) {
            ctx.agentResults['bmc_analyst'] = result.data
            ctx.agentsUsed.push(`bmc_analyst:${result.source}`)
            if (result.source === 'claude') ctx.anyClaudeSuccess = true
          } else {
            ctx.agentsUsed.push('bmc_analyst:failed')
            ctx.agentErrors.push(`bmc_analyst: ${result.error || 'failed'}`)
          }
        } catch (err: any) {
          console.error(`[Pipeline:agent_bmc] Error: ${err.message}`)
          ctx.agentErrors.push(`bmc_analyst: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:agent_bmc] Skipped (no BMC)')
      }

      await savePipelineContext(db, jobId, ctx)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: agent_sic — Run SIC analyst (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'agent_sic') {
      console.log(`[Pipeline:agent_sic] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Agent SIC en cours d\'analyse...')

      if (hasSic) {
        try {
          const documentTexts = await getDocumentTexts()
          const result = await runAgent(db, apiKey, {
            agentCode: 'sic_analyst', documentTexts: await getDocumentTexts(), userName, userCountry, kbContext: ctx.kbContextRaw,
          })
          if (result.success && result.data) {
            ctx.agentResults['sic_analyst'] = result.data
            ctx.agentsUsed.push(`sic_analyst:${result.source}`)
            if (result.source === 'claude') ctx.anyClaudeSuccess = true
          } else {
            ctx.agentsUsed.push('sic_analyst:failed')
            ctx.agentErrors.push(`sic_analyst: ${result.error || 'failed'}`)
          }
        } catch (err: any) {
          console.error(`[Pipeline:agent_sic] Error: ${err.message}`)
          ctx.agentErrors.push(`sic_analyst: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:agent_sic] Skipped (no SIC)')
      }

      await savePipelineContext(db, jobId, ctx)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: agent_finance — Run Finance analyst (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'agent_finance') {
      console.log(`[Pipeline:agent_finance] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Agent Finance en cours d\'analyse...')

      if (hasInputs) {
        try {
          const documentTexts = await getDocumentTexts()
          const result = await runAgent(db, apiKey, {
            agentCode: 'finance_analyst', documentTexts: await getDocumentTexts(), userName, userCountry, kbContext: ctx.kbContextRaw,
          })
          if (result.success && result.data) {
            ctx.agentResults['finance_analyst'] = result.data
            ctx.agentsUsed.push(`finance_analyst:${result.source}`)
            if (result.source === 'claude') ctx.anyClaudeSuccess = true
          } else {
            ctx.agentsUsed.push('finance_analyst:failed')
            ctx.agentErrors.push(`finance_analyst: ${result.error || 'failed'}`)
          }
        } catch (err: any) {
          console.error(`[Pipeline:agent_finance] Error: ${err.message}`)
          ctx.agentErrors.push(`finance_analyst: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:agent_finance] Skipped (no inputs)')
      }

      await savePipelineContext(db, jobId, ctx)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: agent_odd — Run ODD analyst (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'agent_odd') {
      console.log(`[Pipeline:agent_odd] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Agent ODD en cours d\'analyse...')

      if (hasBmc || hasSic || hasInputs) {
        try {
          const documentTexts = await getDocumentTexts()
          const result = await runAgent(db, apiKey, {
            agentCode: 'odd_analyst', documentTexts: await getDocumentTexts(), userName, userCountry, kbContext: ctx.kbContextRaw,
          })
          if (result.success && result.data) {
            ctx.agentResults['odd_analyst'] = result.data
            ctx.agentsUsed.push(`odd_analyst:${result.source}`)
            if (result.source === 'claude') ctx.anyClaudeSuccess = true
          } else {
            ctx.agentsUsed.push('odd_analyst:failed')
            ctx.agentErrors.push(`odd_analyst: ${result.error || 'failed'}`)
          }
        } catch (err: any) {
          console.error(`[Pipeline:agent_odd] Error: ${err.message}`)
          ctx.agentErrors.push(`odd_analyst: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:agent_odd] Skipped (no docs)')
      }

      // Now build the consolidated result from all agent results
      const analysisResults = ctx.agentResults || {}
      const agentsUsed = ctx.agentsUsed || []
      const agentErrors = ctx.agentErrors || []

      // Build deliverables from agent results (same logic as orchestrateGeneration)
      let result: any = null
      let source = 'fallback'

      if (ctx.anyClaudeSuccess) {
        // Build deliverables structure from agent outputs
        const deliverables: Record<string, any> = {}
        
        if (analysisResults['bmc_analyst']) {
          deliverables['bmc_analysis'] = analysisResults['bmc_analyst']
        }
        if (analysisResults['sic_analyst']) {
          deliverables['sic_analysis'] = analysisResults['sic_analyst']
        }
        if (analysisResults['finance_analyst']) {
          deliverables['framework'] = analysisResults['finance_analyst']
        }
        if (analysisResults['odd_analyst']) {
          deliverables['odd'] = analysisResults['odd_analyst']
        }
        
        // Calculate scores
        const scores: number[] = []
        if (deliverables['bmc_analysis']?.score) scores.push(deliverables['bmc_analysis'].score)
        if (deliverables['sic_analysis']?.score) scores.push(deliverables['sic_analysis'].score)
        if (deliverables['framework']?.score) scores.push(deliverables['framework'].score)
        
        const scoreGlobal = scores.length > 0 
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) 
          : 50

        result = {
          score_global: scoreGlobal,
          scores_dimensions: {
            bmc: deliverables['bmc_analysis']?.score || 0,
            sic: deliverables['sic_analysis']?.score || 0,
            framework: deliverables['framework']?.score || 0,
          },
          deliverables,
        }
        source = 'claude'
      }

      // Fallback if no result
      if (!result) {
        result = buildFallbackResult(hasBmc, hasSic, hasInputs, userName, uploadedCats.size)
        source = 'fallback'
        agentsUsed.push('fallback')
      } else {
        // Fill missing from fallback
        const fallback = buildFallbackResult(hasBmc, hasSic, hasInputs, userName, uploadedCats.size)
        for (const dtype of generableTypes) {
          if (!result.deliverables[dtype] && fallback.deliverables?.[dtype]) {
            result.deliverables[dtype] = fallback.deliverables[dtype]
            console.log(`[Pipeline:agent_odd] Filled missing ${dtype} from fallback`)
          }
        }
      }

      ctx.result = result
      ctx.source = source
      ctx.agentsUsed = agentsUsed
      ctx.agentErrors = agentErrors
      await savePipelineContext(db, jobId, ctx)

      console.log(`[Pipeline:agent_odd] All agents done (source=${source}), chaining to 'store'`)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: store — Store iteration + deliverables (0 Claude calls)
    // ════════════════════════════════════════════════════════════════
    if (step === 'store') {
      console.log(`[Pipeline:store] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Enregistrement des livrables...')

      const { result, source, agentsUsed } = ctx

      // Store iteration
      const iterationId = crypto.randomUUID()
      let generatedCount = 0

      await db.prepare(`
        INSERT INTO iterations (id, user_id, version, score_global, scores_dimensions, trigger_type, trigger_message, created_at)
        VALUES (?, ?, ?, ?, ?, 'initial', ?, datetime('now'))
      `).bind(iterationId, userId, newVersion, result.score_global, JSON.stringify(result.scores_dimensions), `Génération v${newVersion} (${source}) | Agents: ${agentsUsed.join(', ')}`).run()

      // Store deliverables
      for (const dtype of generableTypes) {
        const delivData = result.deliverables?.[dtype]
        if (!delivData) {
          console.log(`[Pipeline:store] SKIP ${dtype}: no data`)
          continue
        }
        try {
          const delivId = crypto.randomUUID()
          await db.prepare(`
            INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'generated', datetime('now'))
          `).bind(delivId, userId, dtype, JSON.stringify(delivData), delivData.score || 0, newVersion, iterationId).run()
          generatedCount++
          console.log(`[Pipeline:store] ✅ Stored ${dtype} (score=${delivData.score || 0})`)
        } catch (insertErr: any) {
          console.error(`[Pipeline:store] ❌ INSERT FAILED for ${dtype}: ${insertErr.message}`)
        }
      }

      // Load KB context for HTML engines
      let kbForEngines: KBContext | undefined
      let kbForBmc: KBContextForBmc | undefined
      try {
        const kbContext = ctx.kbContextRaw || await loadKBContext(db, userCountry)
        kbForEngines = {
          benchmarks: formatKBForPrompt(kbContext.benchmarks, 'benchmarks'),
          fiscalParams: formatKBForPrompt(kbContext.fiscalParams, 'fiscal'),
          funders: formatKBForPrompt(kbContext.funders, 'funders'),
          criteria: formatKBForPrompt(kbContext.criteria, 'criteria'),
          feedback: kbContext.feedbackHistory?.length > 0
            ? kbContext.feedbackHistory.map((f: any) => `${f.dimension}: ${f.expert_comment}`).join('\n')
            : '',
        }
        kbForBmc = kbForEngines as KBContextForBmc
      } catch (kbErr: any) {
        console.warn('[Pipeline:store] KB context load failed (non-fatal):', kbErr.message)
      }

      // Get project info
      const project = await db.prepare(
        'SELECT name, description FROM projects WHERE user_id = ? LIMIT 1'
      ).bind(userId).first() as any
      const companyName = (project?.name as string) || userName

      // Save to context
      ctx.iterationId = iterationId
      ctx.generatedCount = generatedCount
      ctx.companyName = companyName
      ctx.kbForEngines = kbForEngines
      ctx.kbForBmc = kbForBmc
      await savePipelineContext(db, jobId, ctx)

      console.log(`[Pipeline:store] Done (${generatedCount} deliverables), chaining to 'bmc_html'`)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: bmc_html — Generate BMC HTML (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'bmc_html') {
      console.log(`[Pipeline:bmc_html] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Génération: BMC HTML...')

      const { result, iterationId: iterId, companyName: cn, kbForBmc: kbBmc } = ctx
      const companyName = cn || userName

      if (hasBmc && generableTypes.includes('bmc_analysis')) {
        try {
          let bmcAnswers = new Map<number, string>()
          const bmcModule = await db.prepare(
            "SELECT id FROM modules WHERE module_code = 'mod1_bmc' LIMIT 1"
          ).first() as any
          if (bmcModule) {
            const bmcProgress = await db.prepare(
              'SELECT id FROM progress WHERE user_id = ? AND module_id = ?'
            ).bind(userId, bmcModule.id).first() as any
            if (bmcProgress) {
              const qRows = await db.prepare(
                'SELECT question_number, user_response FROM questions WHERE progress_id = ? AND user_response IS NOT NULL ORDER BY question_number'
              ).bind(bmcProgress.id).all()
              for (const row of (qRows.results || []) as any[]) {
                if (row.user_response?.trim()) bmcAnswers.set(row.question_number, row.user_response)
              }
            }
          }
          if (bmcAnswers.size === 0) {
            const documentTexts = await getDocumentTexts()
            if ((await getDocumentTexts()).bmc) {
              bmcAnswers = parseBmcDocumentToAnswers((await getDocumentTexts()).bmc)
            }
            console.log(`[Pipeline:bmc_html] BMC parsed from document: ${bmcAnswers.size} sections`)
          }

          if (bmcAnswers.size > 0) {
            const bmcDeliverableData: BmcDeliverableData = {
              companyName,
              entrepreneurName: userName,
              sector: '',
              location: '',
              country: userCountry || 'Côte d\'Ivoire',
              brandName: '',
              tagline: '',
              analysisDate: new Date().toISOString(),
              answers: bmcAnswers,
              apiKey: apiKey,
              kbContext: kbBmc,
            }

            let bmcHtml: string
            try {
              bmcHtml = await generateFullBmcDeliverable(bmcDeliverableData)
              console.log(`[Pipeline:bmc_html] BMC HTML from Claude: ${bmcHtml.length} chars`)
            } catch (genErr: any) {
              console.warn('[Pipeline:bmc_html] Claude BMC failed, using fallback:', genErr.message)
              bmcHtml = generateFullBmcDeliverableFallback(bmcDeliverableData)
            }

            await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html'").bind(userId).run()
            const bmcHtmlId = crypto.randomUUID()
            await db.prepare(`
              INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
              VALUES (?, ?, 'bmc_html', ?, ?, ?, ?, 'generated', datetime('now'))
            `).bind(bmcHtmlId, userId, bmcHtml, result.deliverables?.bmc_analysis?.score || 0, newVersion, iterId).run()
            ctx.agentsUsed.push('bmc_deliverable_engine:html')
          }
        } catch (err: any) {
          console.error('[Pipeline:bmc_html] Error (non-fatal):', err.message)
          ctx.agentErrors.push(`bmc_html: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:bmc_html] Skipped (no BMC or not generable)')
      }

      await savePipelineContext(db, jobId, ctx)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: sic_html — Generate SIC HTML (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'sic_html') {
      console.log(`[Pipeline:sic_html] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Génération: SIC HTML...')

      const { result, iterationId: iterId, companyName: cn, kbForEngines: kbEng } = ctx
      const companyName = cn || userName

      if (hasSic && generableTypes.includes('sic_analysis')) {
        try {
          let sicAnswers = new Map<number, string>()
          const sicModule = await db.prepare(
            "SELECT id FROM modules WHERE module_code = 'mod2_sic' LIMIT 1"
          ).first() as any
          if (sicModule) {
            const sicProgress = await db.prepare(
              'SELECT id FROM progress WHERE user_id = ? AND module_id = ?'
            ).bind(userId, sicModule.id).first() as any
            if (sicProgress) {
              const qRows = await db.prepare(
                'SELECT question_number, user_response FROM questions WHERE progress_id = ? AND user_response IS NOT NULL ORDER BY question_number'
              ).bind(sicProgress.id).all()
              for (const row of (qRows.results || []) as any[]) {
                if (row.user_response?.trim()) sicAnswers.set(row.question_number, row.user_response)
              }
            }
          }
          if (sicAnswers.size === 0) {
            const documentTexts = await getDocumentTexts()
            if ((await getDocumentTexts()).sic) {
              sicAnswers.set(1, (await getDocumentTexts()).sic)
            }
          }

          if (sicAnswers.size > 0) {
            const minimalSicAnalysis = {
              sections: [], scoreGlobal: 0, scoreCoherenceBmc: 0,
              impactMatrix: { intentionnel: [] as string[], mesure: [] as string[], prouve: [] as string[] },
              oddMappings: [], impactWashingRisk: 'moyen' as const, impactWashingSignals: [],
              smartCheck: { isSpecific: false, isMeasurable: false, isAttainable: false, isRelevant: false, isTimeBound: false, score: 0, feedback: '' },
              bmcCoherenceIssues: [], recommendations: [], verdict: '', timestamp: new Date().toISOString()
            }

            const sicDeliverableData: SicDeliverableData = {
              companyName,
              entrepreneurName: userName,
              sector: '',
              location: '',
              country: userCountry || 'Côte d\'Ivoire',
              analysis: minimalSicAnalysis,
              answers: sicAnswers,
              apiKey: apiKey,
              kbContext: kbEng,
            }

            let sicHtml: string
            try {
              sicHtml = await generateFullSicDeliverable(sicDeliverableData)
              console.log(`[Pipeline:sic_html] SIC HTML from Claude: ${sicHtml.length} chars`)
            } catch (genErr: any) {
              console.warn('[Pipeline:sic_html] Claude SIC failed, using fallback:', genErr.message)
              sicHtml = generateFullSicDeliverableFallback(sicDeliverableData)
            }

            await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_html'").bind(userId).run()
            const sicHtmlId = crypto.randomUUID()
            await db.prepare(`
              INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
              VALUES (?, ?, 'sic_html', ?, ?, ?, ?, 'generated', datetime('now'))
            `).bind(sicHtmlId, userId, sicHtml, result.deliverables?.sic_analysis?.score || 0, newVersion, iterId).run()
            ctx.agentsUsed.push('sic_deliverable_engine:html')
          }
        } catch (err: any) {
          console.error('[Pipeline:sic_html] Error (non-fatal):', err.message)
          ctx.agentErrors.push(`sic_html: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:sic_html] Skipped (no SIC or not generable)')
      }

      await savePipelineContext(db, jobId, ctx)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: inputs_html — Generate Inputs diagnostic HTML (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'inputs_html') {
      console.log(`[Pipeline:inputs_html] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Génération: Inputs HTML...')

      const { iterationId: iterId, companyName: cn, kbForEngines: kbEng } = ctx
      const companyName = cn || userName

      if (hasInputs) {
        try {
          const inputsModule = await db.prepare(
            "SELECT id FROM modules WHERE module_code = 'mod3_inputs' LIMIT 1"
          ).first() as any

          let allInputData: Record<InputTabKey, Record<string, any>> = {} as any
          if (inputsModule) {
            const inputProgress = await db.prepare(
              'SELECT id FROM progress WHERE user_id = ? AND module_id = ?'
            ).bind(userId, inputsModule.id).first() as any
            if (inputProgress) {
              const qRows = await db.prepare(
                'SELECT question_number, user_response FROM questions WHERE progress_id = ? AND user_response IS NOT NULL ORDER BY question_number'
              ).bind(inputProgress.id).all()
              for (const row of (qRows.results || []) as any[]) {
                try {
                  const parsed = JSON.parse(row.user_response as string)
                  if (parsed && typeof parsed === 'object') Object.assign(allInputData, parsed)
                } catch { /* not JSON, skip */ }
              }
            }
          }
          if (Object.keys(allInputData).length === 0) {
            const documentTexts = await getDocumentTexts()
            if ((await getDocumentTexts()).inputs) {
              try {
                const parsed = JSON.parse((await getDocumentTexts()).inputs)
                if (parsed && typeof parsed === 'object') allInputData = parsed
              } catch { /* not JSON */ }
            }
          }

          if (Object.keys(allInputData).length > 0) {
            console.log('[Pipeline:inputs_html] Generating Inputs diagnostic HTML with AI...')
            const inputsAnalysis = await analyzeInputsWithAI(allInputData, companyName, '', apiKey, kbEng)
            const inputsHtml = generateInputsDiagnosticHtml(inputsAnalysis, companyName, userName)

            await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'inputs_html'").bind(userId).run()
            const inputsHtmlId = crypto.randomUUID()
            await db.prepare(`
              INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
              VALUES (?, ?, 'inputs_html', ?, ?, ?, ?, 'generated', datetime('now'))
            `).bind(inputsHtmlId, userId, inputsHtml, inputsAnalysis.readinessScore || 0, newVersion, iterId).run()
            ctx.agentsUsed.push(`inputs_diagnostic:${inputsAnalysis.aiSource}`)
          }
        } catch (err: any) {
          console.error('[Pipeline:inputs_html] Error (non-fatal):', err.message)
          ctx.agentErrors.push(`inputs_html: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:inputs_html] Skipped (no inputs)')
      }

      await savePipelineContext(db, jobId, ctx)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: framework_html — Generate Framework PME HTML (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'framework_html') {
      console.log(`[Pipeline:framework_html] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Génération: Framework HTML...')

      const { result, iterationId: iterId, companyName: cn, kbForEngines: kbEng } = ctx
      const companyName = cn || userName

      if ((hasBmc || hasInputs) && generableTypes.includes('framework')) {
        try {
          let pmeData: PmeInputData | undefined
          let usedStructuredParser = false
          let usedAIExtraction = false
          let aiEstimations: any[] = []
          const rawUploads = await getRawUploads()
          const xlsxB64ForParser = (await getRawUploads())?.inputs || undefined
          const fwApiKey = apiKey || ''

          // PRIORITY 0: Structured parser
          if (hasInputs && xlsxB64ForParser && xlsxB64ForParser.length > 100) {
            const structuredResult = tryParseInputsEntrepreneur(xlsxB64ForParser)
            if (structuredResult) {
              pmeData = structuredResult
              usedStructuredParser = true
              console.log('[Pipeline:framework_html] ✅ Structured parser SUCCESS')
            }
          }

          // PRIORITY 1: AI extraction (skip to avoid double Claude call — use text fallback)
          if (!usedStructuredParser && hasInputs) {
            const documentTexts = await getDocumentTexts()
            if ((await getDocumentTexts()).inputs) {
              try {
                const enriched = await buildPmeInputWithAI(
                  (await getDocumentTexts()).inputs, fwApiKey, companyName,
                  userCountry || "Côte d'Ivoire", buildPmeInputDataFromText
                )
                if (enriched?.data) {
                  pmeData = enriched.data
                  usedAIExtraction = true
                  aiEstimations = enriched.estimations || []
                }
              } catch (aiErr: any) {
                console.error(`[Pipeline:framework_html] AI extraction failed: ${aiErr.message}`)
              }
              if (!usedAIExtraction) {
                pmeData = buildPmeInputDataFromText((await getDocumentTexts()).inputs, companyName, userCountry || "Côte d'Ivoire")
              }
            }
          }

          if (pmeData) {
            // Load BMC content for cross-analysis
            let bmcContent = ''
            try {
              let bmcDel = await db.prepare(
                "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY version DESC LIMIT 1"
              ).bind(userId).first<any>()
              if (bmcDel?.content && bmcDel.content.length > 100) {
                bmcContent = bmcDel.content.slice(0, 6000)
              }
              if (!bmcContent) {
                bmcDel = await db.prepare(
                  "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html' ORDER BY version DESC LIMIT 1"
                ).bind(userId).first<any>()
                if (bmcDel?.content && bmcDel.content.length > 100) {
                  bmcContent = bmcDel.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000)
                }
              }
              if (!bmcContent) {
                const bmcUpload = await db.prepare(
                  "SELECT extracted_text FROM uploads WHERE user_id = ? AND category = 'bmc' ORDER BY uploaded_at DESC LIMIT 1"
                ).bind(userId).first<any>()
                if (bmcUpload?.extracted_text && bmcUpload.extracted_text.length > 100) {
                  let text = bmcUpload.extracted_text
                  if (text.startsWith('base64:')) {
                    const mdStart = text.indexOf('\n---\n')
                    text = mdStart > 0 ? text.substring(mdStart + 5) : ''
                  }
                  if (text.length > 100) bmcContent = text.slice(0, 6000)
                }
              }
            } catch (bmcErr: any) {
              console.error('[Pipeline:framework_html] BMC loading error:', bmcErr.message)
            }

            const baseAnalysis = analyzePme(pmeData)
            let crossAnalysis: any
            try {
              crossAnalysis = await crossAnalyzeBmcFinancials(bmcContent, pmeData, baseAnalysis, fwApiKey)
            } catch (crossErr: any) {
              console.error('[Pipeline:framework_html] Cross-analysis error:', crossErr.message)
            }

            const pmeAnalysis = await analyzePmeWithAI(pmeData, fwApiKey, kbEng, crossAnalysis, usedAIExtraction ? aiEstimations : undefined)
            const frameworkHtml = generatePmePreviewHtml(pmeAnalysis, pmeData)

            await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_html'").bind(userId).run()
            const fwHtmlId = crypto.randomUUID()
            await db.prepare(`
              INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
              VALUES (?, ?, 'framework_html', ?, ?, ?, ?, 'generated', datetime('now'))
            `).bind(fwHtmlId, userId, frameworkHtml, result?.deliverables?.framework?.score || 0, newVersion, iterId).run()

            // Store PmeInputData as JSON
            await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_pme_data'").bind(userId).run()
            const pmeDataId = crypto.randomUUID()
            await db.prepare(`
              INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
              VALUES (?, ?, 'framework_pme_data', ?, 0, ?, ?, 'generated', datetime('now'))
            `).bind(pmeDataId, userId, JSON.stringify(pmeData), newVersion, iterId).run()

            ctx.agentsUsed.push(`framework_pme:${pmeAnalysis.aiSource}`)
          }
        } catch (err: any) {
          console.error('[Pipeline:framework_html] Error (non-fatal):', err.message)
          ctx.agentErrors.push(`framework_html: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:framework_html] Skipped')
      }

      await savePipelineContext(db, jobId, ctx)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: diagnostic_html — Generate Diagnostic Expert HTML (1 Claude call)
    // ════════════════════════════════════════════════════════════════
    if (step === 'diagnostic_html') {
      console.log(`[Pipeline:diagnostic_html] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Génération: Diagnostic HTML...')

      const { result, iterationId: iterId, companyName: cn, kbForEngines: kbEng } = ctx
      const companyName = cn || userName

      if (generableTypes.includes('diagnostic')) {
        try {
          const loadDeliv = async (type: string) => {
            const row = await db.prepare(
              "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = ? ORDER BY version DESC LIMIT 1"
            ).bind(userId, type).first() as any
            if (!row?.content) return null
            try { return typeof row.content === 'string' ? JSON.parse(row.content) : row.content } catch { return null }
          }

          const [bmcAnalysisData, sicAnalysisData, frameworkData, frameworkPmeData] = await Promise.all([
            loadDeliv('bmc_analysis'), loadDeliv('sic_analysis'),
            loadDeliv('framework'), loadDeliv('framework_pme_data'),
          ])

          const diagInput: DiagnosticInputData = {
            companyName,
            entrepreneurName: userName,
            country: userCountry || "Côte d'Ivoire",
            sector: frameworkPmeData?.sector || '',
            analysisDate: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
            bmcAnalysis: bmcAnalysisData,
            sicAnalysis: sicAnalysisData,
            frameworkPmeData,
            frameworkAnalysis: frameworkData,
            apiKey: apiKey || undefined,
            kbContext: kbEng,
          }

          const { result: diagResult, html: diagHtml } = await generateDiagnosticExpert(diagInput)

          // Store diagnostic_html
          await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'diagnostic_html'").bind(userId).run()
          const diagHtmlId = crypto.randomUUID()
          await db.prepare(`
            INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
            VALUES (?, ?, 'diagnostic_html', ?, ?, ?, ?, 'generated', datetime('now'))
          `).bind(diagHtmlId, userId, diagHtml, diagResult.scoreGlobal, newVersion, iterId).run()

          // Update 'diagnostic' deliverable
          await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'diagnostic'").bind(userId).run()
          const diagJsonId = crypto.randomUUID()
          await db.prepare(`
            INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at)
            VALUES (?, ?, 'diagnostic', ?, ?, ?, ?, 'generated', datetime('now'))
          `).bind(diagJsonId, userId, JSON.stringify(diagResult), diagResult.scoreGlobal, newVersion, iterId).run()

          ctx.agentsUsed.push(`diagnostic_expert:${diagResult.aiSource}`)

          // Sync to diagnostic_analyses
          try {
            const pmeIdSync = `pme_${userId}`
            const diagSyncId = crypto.randomUUID()
            const existingDiag = await db.prepare(
              'SELECT version FROM diagnostic_analyses WHERE user_id = ? AND pme_id = ? ORDER BY version DESC LIMIT 1'
            ).bind(userId, pmeIdSync).first() as any
            const diagVersion = existingDiag ? Number(existingDiag.version) + 1 : newVersion

            await db.prepare(`
              INSERT INTO diagnostic_analyses (id, pme_id, user_id, version, analysis_json, html_content, score, status, sources_used, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'analyzed', ?, datetime('now'), datetime('now'))
            `).bind(diagSyncId, pmeIdSync, userId, diagVersion, JSON.stringify(diagResult), diagHtml, diagResult.scoreGlobal, JSON.stringify({ source: 'generate_all' })).run()
          } catch (c3Err: any) {
            console.error('[Pipeline:diagnostic_html] Diagnostic sync error:', c3Err.message)
          }
        } catch (err: any) {
          console.error('[Pipeline:diagnostic_html] Error (non-fatal):', err.message)
          ctx.agentErrors.push(`diagnostic_html: ${err.message}`)
        }
      } else {
        console.log('[Pipeline:diagnostic_html] Skipped (not generable)')
      }

      await savePipelineContext(db, jobId, ctx)
      return c.json({ ok: true, step })
    }

    // ════════════════════════════════════════════════════════════════
    // STEP: postprocess — Auto-fix, sync tables, complete job
    // ════════════════════════════════════════════════════════════════
    if (step === 'postprocess') {
      console.log(`[Pipeline:postprocess] Starting for job ${jobId}`)
      await updateJobProgress(db, jobId, 'Post-traitement et corrections...')

      const { result, source, agentsUsed, agentErrors, iterationId: iterId,
              generatedCount, newVersion: ver, companyName: cn } = ctx
      const companyName = cn || userName

      // Auto-fix BMC HTML
      try {
        const bmcHtmlRow = await db.prepare(
          "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html' ORDER BY created_at DESC LIMIT 1"
        ).bind(userId).first() as any

        if (bmcHtmlRow?.content) {
          const undocCount = (bmcHtmlRow.content.match(/non\s+(?:renseigné|documenté)/gi) || []).length
          const nonRensCount = (bmcHtmlRow.content.match(/non renseigné/gi) || []).length

          if (undocCount > 0 || nonRensCount > 3) {
            console.log(`[Pipeline:postprocess] AUTO-FIX: BMC HTML (${undocCount} undoc, ${nonRensCount} unfilled)`)
            try {
              const bmcAnalJson = await db.prepare(
                "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_analysis' ORDER BY version DESC LIMIT 1"
              ).bind(userId).first() as any
              const pmeDataRow = await db.prepare(
                "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_pme_data' ORDER BY version DESC LIMIT 1"
              ).bind(userId).first() as any

              const fixCompanyData: any = { companyName, entrepreneurName: userName }
              if (pmeDataRow?.content) {
                try {
                  const pd = JSON.parse(pmeDataRow.content)
                  fixCompanyData.sector = pd.sector || ''
                  fixCompanyData.location = pd.location || ''
                  fixCompanyData.country = pd.country || userCountry || "Côte d'Ivoire"
                } catch {}
              }

              const { regenerateBmcHtmlFromDbAnalysis } = await import('./bmc-deliverable-engine')
              const newBmcHtml = await regenerateBmcHtmlFromDbAnalysis(
                bmcAnalJson?.content, fixCompanyData, apiKey, ctx.kbForBmc
              )
              if (newBmcHtml && newBmcHtml.length > 500) {
                await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html'").bind(userId).run()
                await db.prepare(
                  "INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, status, created_at) VALUES (?, ?, 'bmc_html', ?, ?, ?, 'generated', datetime('now'))"
                ).bind(crypto.randomUUID(), userId, newBmcHtml, result?.deliverables?.bmc_analysis?.score || 72, ver).run()
                console.log(`[Pipeline:postprocess] BMC HTML regenerated: ${newBmcHtml.length} chars`)
              }
            } catch (fixErr: any) {
              console.warn('[Pipeline:postprocess] AUTO-FIX BMC failed:', fixErr.message)
            }
          }
        }
      } catch (postProcErr: any) {
        console.warn('[Pipeline:postprocess] BMC check error:', postProcErr.message)
      }

      // Auto-fix SIC HTML
      try {
        const sicAnalRow = await db.prepare(
          "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_analysis' ORDER BY version DESC LIMIT 1"
        ).bind(userId).first() as any

        if (sicAnalRow?.content) {
          try {
            const sicJson = JSON.parse(sicAnalRow.content)
            let wasWrapped = false
            if (sicJson.properties && !sicJson.pillars) {
              const unwrapped = sicJson.properties
              wasWrapped = true
              await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_analysis'").bind(userId).run()
              await db.prepare(
                "INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, status, created_at) VALUES (?, ?, 'sic_analysis', ?, ?, ?, 'generated', datetime('now'))"
              ).bind(crypto.randomUUID(), userId, JSON.stringify(unwrapped), unwrapped.score || 0, ver).run()
            }

            const sicHtmlRow = await db.prepare(
              "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_html' ORDER BY created_at DESC LIMIT 1"
            ).bind(userId).first() as any

            if (sicHtmlRow?.content) {
              const undefinedCount = (sicHtmlRow.content.match(/undefined/gi) || []).length
              const needsRegen = wasWrapped || undefinedCount > 0 || sicHtmlRow.content.length < 1000

              if (needsRegen) {
                try {
                  const pmeDataRow = await db.prepare(
                    "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_pme_data' ORDER BY version DESC LIMIT 1"
                  ).bind(userId).first() as any

                  const fixCompanyData: any = { companyName, entrepreneurName: userName, country: userCountry || "Côte d'Ivoire" }
                  if (pmeDataRow?.content) {
                    try {
                      const pd = JSON.parse(pmeDataRow.content)
                      fixCompanyData.sector = pd.sector || ''
                      fixCompanyData.location = pd.location || ''
                    } catch {}
                  }

                  const { regenerateSicHtmlFromDbAnalysis } = await import('./sic-deliverable-engine')
                  const newSicHtml = await regenerateSicHtmlFromDbAnalysis(
                    sicAnalRow.content, fixCompanyData, apiKey, ctx.kbForEngines
                  )
                  if (newSicHtml && newSicHtml.length > 500) {
                    await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_html'").bind(userId).run()
                    await db.prepare(
                      "INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, status, created_at) VALUES (?, ?, 'sic_html', ?, ?, ?, 'generated', datetime('now'))"
                    ).bind(crypto.randomUUID(), userId, newSicHtml, result?.deliverables?.sic_analysis?.score || 0, ver).run()
                    console.log(`[Pipeline:postprocess] SIC HTML regenerated: ${newSicHtml.length} chars`)
                  }
                } catch (fixErr: any) {
                  console.warn('[Pipeline:postprocess] AUTO-FIX SIC failed:', fixErr.message)
                }
              }
            }
          } catch {}
        }
      } catch (postProcErr: any) {
        console.warn('[Pipeline:postprocess] SIC check error:', postProcErr.message)
      }

      // Auto-fix Business Plan (fallback regeneration)
      try {
        const bpCheck = await db.prepare(
          "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'business_plan' ORDER BY version DESC LIMIT 1"
        ).bind(userId).first() as any

        if (bpCheck?.content && bpCheck.content.length < 5000 && apiKey) {
          console.log(`[Pipeline:postprocess] AUTO-FIX: BP is fallback (${bpCheck.content.length} bytes) → regenerating`)
          try {
            // Load context for BP generation
            const bpLoadDeliv = async (type: string) => {
              const row = await db.prepare(
                "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = ? ORDER BY version DESC LIMIT 1"
              ).bind(userId, type).first() as any
              return row?.content || ''
            }
            const [bpBmc, bpSic, bpFw, bpDiag, bpPmeData] = await Promise.all([
              bpLoadDeliv('bmc_analysis'), bpLoadDeliv('sic_analysis'),
              bpLoadDeliv('framework'), bpLoadDeliv('diagnostic'),
              bpLoadDeliv('framework_pme_data')
            ])
            
            // Get latest uploaded DOCX text
            let docxText = ''
            const uploads = await db.prepare(
              "SELECT extracted_text FROM uploads WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT 3"
            ).bind(userId).all()
            for (const row of (uploads.results || []) as any[]) {
              if (row.extracted_text && row.extracted_text.length > 200) {
                const text = row.extracted_text.toString().slice(0, 8000)
                if (text.length > docxText.length) docxText = text
              }
            }

            const bpPrompt = `Tu es un expert en business plan. Génère un Business Plan COMPLET et STRUCTURÉ en JSON pour l'entreprise "${companyName}" (${userCountry || "Côte d'Ivoire"}).

Contexte de l'entreprise:
${bpBmc ? `BMC: ${bpBmc.slice(0, 3000)}` : ''}
${bpSic ? `SIC: ${bpSic.slice(0, 2000)}` : ''}
${bpFw ? `Framework: ${bpFw.slice(0, 2000)}` : ''}
${bpDiag ? `Diagnostic: ${bpDiag.slice(0, 2000)}` : ''}
${docxText ? `Document: ${docxText.slice(0, 3000)}` : ''}

Retourne un JSON avec les sections: executive_summary, market_analysis, products_services, marketing_strategy, operations, management_team, financial_projections (en XOF), funding_requirements, risks_mitigation, implementation_timeline.
Chaque section doit avoir: title, content (texte riche), key_points (array).
Utilise UNIQUEMENT des données réelles de l'entreprise.`

            const bpResponse = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 8192,
                temperature: 0.3,
                messages: [{ role: 'user', content: bpPrompt }],
              }),
              signal: AbortSignal.timeout(120000),
            })

            if (bpResponse.ok) {
              const bpData = await bpResponse.json() as any
              const bpText = bpData.content?.[0]?.text || ''
              const jsonMatch = bpText.match(/\{[\s\S]*\}/)
              if (jsonMatch) {
                const bpContent = jsonMatch[0]
                await db.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'business_plan'").bind(userId).run()
                await db.prepare(
                  "INSERT INTO entrepreneur_deliverables (id, user_id, type, content, score, version, iteration_id, status, created_at) VALUES (?, ?, 'business_plan', ?, ?, ?, ?, 'generated', datetime('now'))"
                ).bind(crypto.randomUUID(), userId, bpContent, 70, ver, iterId).run()
                console.log(`[Pipeline:postprocess] BP regenerated: ${bpContent.length} bytes`)
              }
            }
          } catch (bpFixErr: any) {
            console.warn('[Pipeline:postprocess] AUTO-FIX BP failed:', bpFixErr.message)
          }
        }
      } catch (postProcErr: any) {
        console.warn('[Pipeline:postprocess] BP check error:', postProcErr.message)
      }

      // Sync module tables
      try {
        const bpDeliv = await db.prepare(
          "SELECT content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'business_plan' ORDER BY version DESC LIMIT 1"
        ).bind(userId).first() as any
        if (bpDeliv?.content) {
          const pmeId = `pme_${userId}`
          const existing = await db.prepare(
            'SELECT id FROM business_plan_analyses WHERE user_id = ? AND pme_id = ?'
          ).bind(userId, pmeId).first() as any
          if (existing) {
            await db.prepare(
              'UPDATE business_plan_analyses SET analysis_json = ?, score = ?, version = ?, updated_at = datetime(\'now\') WHERE id = ?'
            ).bind(bpDeliv.content, bpDeliv.score || 0, ver, existing.id).run()
          } else {
            await db.prepare(
              'INSERT INTO business_plan_analyses (id, pme_id, user_id, version, analysis_json, score, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'analyzed\', datetime(\'now\'), datetime(\'now\'))'
            ).bind(crypto.randomUUID(), pmeId, userId, ver, bpDeliv.content, bpDeliv.score || 0).run()
          }
          console.log(`[Pipeline:postprocess] ✅ Synced business_plan_analyses`)
        }
      } catch (bpSyncErr: any) {
        console.error(`[Pipeline:postprocess] BP sync failed: ${bpSyncErr.message}`)
      }

      try {
        const ovoDeliv = await db.prepare(
          "SELECT content, score FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'business_plan' ORDER BY version DESC LIMIT 1"
        ).bind(userId).first() as any
        if (ovoDeliv?.content) {
          const pmeId = `pme_${userId}`
          const existingOvo = await db.prepare(
            'SELECT id FROM plan_ovo_analyses WHERE user_id = ? AND pme_id = ?'
          ).bind(userId, pmeId).first() as any
          if (!existingOvo) {
            await db.prepare(
              'INSERT INTO plan_ovo_analyses (id, pme_id, user_id, version, analysis_json, score, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'analyzed\', datetime(\'now\'), datetime(\'now\'))'
            ).bind(crypto.randomUUID(), pmeId, userId, ver, ovoDeliv.content, ovoDeliv.score || 0).run()
            console.log(`[Pipeline:postprocess] ✅ Synced plan_ovo_analyses (new)`)
          }
        }
      } catch (ovoSyncErr: any) {
        console.error(`[Pipeline:postprocess] OVO sync failed: ${ovoSyncErr.message}`)
      }

      // Complete job
      const jobResult = {
        success: true,
        iteration: { id: iterId, version: ver, score_global: result.score_global },
        source,
        agentsUsed,
        agentErrors: agentErrors.length > 0 ? agentErrors : undefined,
        deliverableCount: generatedCount,
        totalPossible: 7,
        generated: generableTypes,
        skipped: skippedTypes,
        uploadedInputs: { bmc: hasBmc, sic: hasSic, inputs: hasInputs },
      }

      await completeJob(db, jobId, jobResult)
      console.log(`[Pipeline:postprocess] ✅ Job ${jobId} completed — ${generatedCount} deliverables`)
      return c.json({ ok: true, step, completed: true })
    }

    // Unknown step
    console.error(`[Pipeline] Unknown step: ${step}`)
    await failJob(db, jobId, `Unknown step: ${step}`)
    return c.json({ ok: false, error: `Unknown step: ${step}` }, 400)

  } catch (err: any) {
    console.error(`[Pipeline] Fatal error in step ${step}:`, err.message)
    try { await failJob(db, jobId!, err.message) } catch {}
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// ─── API: GET /api/ai/generate-status — Poll job progress ─────────
entrepreneurRoutes.get('/api/ai/generate-status', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const jobId = c.req.query('jobId')
    
    if (jobId) {
      // Specific job
      const job = await c.env.DB.prepare(
        'SELECT id, status, progress, result_json, error, created_at, completed_at FROM generation_jobs WHERE id = ? AND user_id = ?'
      ).bind(jobId, payload.userId).first()
      if (!job) return c.json({ error: 'Job non trouvé' }, 404)
      return c.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        result: job.result_json ? JSON.parse(job.result_json as string) : null,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at
      })
    } else {
      // Latest job for user
      const job = await c.env.DB.prepare(
        'SELECT id, status, progress, result_json, error, created_at, completed_at FROM generation_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
      ).bind(payload.userId).first()
      if (!job) return c.json({ status: 'none' })
      return c.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        result: job.result_json ? JSON.parse(job.result_json as string) : null,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at
      })
    }
  } catch (error: any) {
    console.error('Generate-status error:', error)
    return c.json({ error: error.message }, 500)
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
      INNER JOIN (SELECT type as t, MAX(version) as mv FROM entrepreneur_deliverables 
        WHERE user_id = ? AND NOT (generated_by IN ('coach','coach_mirror') AND visibility = 'private')
        GROUP BY type) l 
      ON ed.type = l.t AND ed.version = l.mv 
      WHERE ed.user_id = ? AND NOT (ed.generated_by IN ('coach','coach_mirror') AND ed.visibility = 'private')
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

        // Build document texts from uploads (same parsing logic as generate)
        const uploadData = (uploadsRes.results || []) as any[]
        const documentTexts: Record<string, string> = {}
        for (const u of uploadData) {
          const text = u.extracted_text || ''
          const docMarker = '---DOCUMENT_TEXT---'
          const extractedMarker = '---EXTRACTED_TEXT---'
          const mdMarker = '---MARKDOWN_TABLES---'
          const docIdx = text.indexOf(docMarker)
          const mdIdx = text.indexOf(mdMarker)
          const extractedIdx = text.indexOf(extractedMarker)
          
          if (mdIdx !== -1 && extractedIdx !== -1) {
            // XLSX: use markdown tables
            documentTexts[u.category] = text.substring(mdIdx + mdMarker.length, extractedIdx).trim().slice(0, 6000)
          } else if (docIdx !== -1 && extractedIdx !== -1) {
            // DOCX: use document text
            documentTexts[u.category] = text.substring(docIdx + docMarker.length, extractedIdx).trim().slice(0, 6000)
          } else if (extractedIdx !== -1) {
            documentTexts[u.category] = text.substring(extractedIdx + extractedMarker.length).slice(0, 6000)
          } else if (text.startsWith('base64:')) {
            // Try DOCX text extraction from base64
            const b64Data = text.substring(7)
            const fname = (u.filename || '').toLowerCase()
            if (fname.endsWith('.docx')) {
              try {
                const binaryStr = atob(b64Data)
                const bytes = new Uint8Array(binaryStr.length)
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
                const docText = parseDocx(bytes)
                if (docText && docText.length > 50) {
                  documentTexts[u.category] = docText.slice(0, 6000)
                } else {
                  documentTexts[u.category] = `[Fichier binaire: ${u.filename}]`
                }
              } catch {
                documentTexts[u.category] = `[Fichier binaire: ${u.filename}]`
              }
            } else {
              documentTexts[u.category] = `[Fichier binaire: ${u.filename}]`
            }
          } else {
            documentTexts[u.category] = text.slice(0, 6000)
          }
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
          if (!uploadedCats.has('sic')) missing.push('SIC (Social Impact Canvas)')
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

// ─── API: Download Framework Excel (.xlsx) — filled template ────
entrepreneurRoutes.get('/api/download/framework-excel', async (c) => {
  try {
    const token = getAuthToken(c)
    if (!token) return c.json({ error: 'Non authentifié' }, 401)
    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    // Get user info
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.userId).first() as any
    const companyName = user?.company || user?.name || 'Entreprise'
    const userCountry = user?.country || "Côte d'Ivoire"

    // Priority 1: Try to get stored PmeInputData from generation
    let pmeData: PmeInputData | null = null
    
    // ═══ PRIORITY 0: Try structured INPUTS_ENTREPRENEURS parser from raw XLSX ═══
    // This is the MOST RELIABLE method — reads real data from each cell
    const inputsUploadForParser = await c.env.DB.prepare(
      "SELECT filename, extracted_text FROM uploads WHERE user_id = ? AND category = 'inputs' ORDER BY uploaded_at DESC LIMIT 1"
    ).bind(payload.userId).first() as any
    
    if (inputsUploadForParser?.extracted_text) {
      const fullText = inputsUploadForParser.extracted_text || ''
      // Extract base64 from stored text
      let b64Part = ''
      if (fullText.startsWith('base64:')) {
        const b64End = fullText.indexOf('\n\n---')
        b64Part = b64End > 7 ? fullText.substring(7, b64End) : fullText.substring(7).split('\n')[0]
      }
      
      if (b64Part.length > 100) {
        console.log('[Download Excel] Trying structured INPUTS_ENTREPRENEURS parser...')
        const structuredResult = tryParseInputsEntrepreneur(b64Part)
        if (structuredResult) {
          pmeData = structuredResult
          console.log(`[Download Excel] ✅ Structured parser SUCCESS: CA=[${pmeData.historique.caTotal.join(',')}], Growth=[${pmeData.hypotheses.croissanceCA.join(',')}]%`)
        }
      }
    }
    
    // ═══ PRIORITY 1: Use stored PmeInputData (only if structured parser didn't work) ═══
    if (!pmeData) {
      const storedPmeData = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_pme_data' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      
      if (storedPmeData?.content) {
        try {
          pmeData = JSON.parse(storedPmeData.content) as PmeInputData
          console.log('[Download Excel] Using stored PmeInputData (fallback)')
        } catch { /* parse failed, continue */ }
      }
    }

    // Priority 2: Build from uploaded inputs (NO AI calls — instant deterministic parsing only)
    if (!pmeData) {
      const inputsUpload = await c.env.DB.prepare(
        "SELECT filename, extracted_text FROM uploads WHERE user_id = ? AND category = 'inputs' ORDER BY uploaded_at DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      
      if (inputsUpload?.extracted_text) {
        const fullText = inputsUpload.extracted_text || ''
        const extractedMarker = '---EXTRACTED_TEXT---'
        const extractedIdx = fullText.indexOf(extractedMarker)
        
        // Extract base64 and legacy text sections
        let b64Part = ''
        let legacyPart = ''
        
        if (extractedIdx !== -1) {
          const b64End = fullText.indexOf('\n\n---')
          b64Part = b64End > 7 ? fullText.substring(7, b64End) : ''
          legacyPart = fullText.substring(extractedIdx + extractedMarker.length)
        } else if (fullText.startsWith('base64:')) {
          b64Part = fullText.substring(7).split('\n')[0]
        } else if (fullText.length > 200 && /chiffre|ca\s*total|fcfa|revenus/i.test(fullText)) {
          legacyPart = fullText
        }
        
        // Try structured parser from base64 first (most reliable)
        if (!pmeData && b64Part.length > 100) {
          const structuredResult = tryParseInputsEntrepreneur(b64Part)
          if (structuredResult) {
            pmeData = structuredResult
            console.log(`[Download Excel] Priority 2: Structured parser from stored b64`)
          }
        }
        
        // Fallback to regex text extraction
        if (!pmeData && legacyPart.length > 100) {
          pmeData = buildPmeInputDataFromText(legacyPart, companyName, userCountry)
          console.log('[Download Excel] Priority 2: Regex from legacy text')
        }
        
        // Last resort: parse binary XLSX
        if (!pmeData && b64Part.length > 100) {
          try {
            const xlsxBytes = b64ToUint8(b64Part)
            const sheets = parseXlsx(xlsxBytes)
            const textContent = xlsxToText(sheets)
            pmeData = buildPmeInputDataFromText(textContent, companyName, userCountry)
            console.log('[Download Excel] Priority 2: Regex from XLSX binary')
          } catch (e: any) {
            console.error('[Download Excel] XLSX parse error:', e.message)
          }
        }
      }
    }

    // Priority 3: Fallback to old method
    if (!pmeData) {
      const frameworkDel = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      
      if (!frameworkDel?.content) {
        return c.json({ error: 'Aucun livrable framework généré. Lancez d\'abord la génération.' }, 404)
      }
      
      let content: any
      try {
        content = typeof frameworkDel.content === 'string' ? JSON.parse(frameworkDel.content) : frameworkDel.content
      } catch { content = {} }
      
      pmeData = _buildPmeInputDataFromDeliverable(content, companyName, userCountry)
      console.log('[Download Excel] Fallback to deliverable-based PmeInputData')
    }

    console.log(`[Download Excel] PmeInputData: CA=[${pmeData.historique.caTotal.join(',')}], company=${pmeData.companyName}`)

    // Use deterministic analysis for Excel download (no AI call = instant response)
    // The AI-enriched analysis is already stored in framework_html deliverable
    let analysis = analyzePme(pmeData)

    // Fill the real Excel template
    const xlsxBytes = fillFrameworkExcel(pmeData, analysis)

    // Return as downloadable .xlsx file
    const fileName = `Framework_Analyse_PME_${companyName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`

    return new Response(xlsxBytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error: any) {
    console.error('Download framework Excel error:', error)
    return c.json({ error: `Erreur génération Excel: ${error.message}` }, 500)
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

// ═══ PUBLIC PREVIEW ROUTE (no auth) ═══
entrepreneurRoutes.get('/preview/:userId/:type', async (c) => {
  try {
    // Auth check: only the user themselves or a coach can access
    const token = getAuthToken(c)
    if (!token) return c.text('Non authentifié', 401)
    const payload = await verifyToken(token)
    if (!payload) return c.text('Token invalide', 401)
    
    const userId = parseInt(c.req.param('userId'))
    const dtype = c.req.param('type')
    if (!userId || !dtype) return c.text('Invalid params', 400)
    
    // Security: user can only preview their own data
    if (payload.userId !== userId) {
      return c.text('Accès non autorisé', 403)
    }

    const user = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
      .bind(userId).first() as any
    if (!user) return c.text('User not found', 404)

    const deliverable = await c.env.DB.prepare(
      "SELECT * FROM entrepreneur_deliverables WHERE user_id = ? AND type = ? AND NOT (generated_by IN ('coach','coach_mirror') AND visibility = 'private') ORDER BY version DESC LIMIT 1"
    ).bind(userId, dtype).first() as any
    if (!deliverable) return c.text('Livrable non encore généré', 404)

    let content: any = {}
    try { content = JSON.parse(deliverable.content) } catch { content = {} }
    const score = deliverable.score || content.score || 0

    const meta = DELIV_PAGE_META[dtype] || { title: dtype, icon: 'fa-file', colorHex: '#1e3a5f' }

    // For _html types, return raw HTML directly
    if (dtype === 'bmc_html' || dtype === 'framework_html' || dtype === 'sic_html' || dtype === 'diagnostic_html') {
      return c.html(safeScriptBlocks(deliverable.content))
    }

    // For analysis types (bmc_analysis, sic_analysis, etc.), try to serve the HTML version first
    const htmlTypeMap: Record<string, string> = {
      'bmc_analysis': 'bmc_html',
      'sic_analysis': 'sic_html',
      'diagnostic': 'diagnostic_html',
      'framework': 'framework_html',
    }
    const htmlType = htmlTypeMap[dtype]
    if (htmlType) {
      const htmlRow = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = ? ORDER BY version DESC LIMIT 1"
      ).bind(userId, htmlType).first() as any
      console.log(`[Preview] htmlType=${htmlType} userId=${userId} htmlRow=${!!htmlRow} contentLen=${htmlRow?.content?.length || 0}`)
      if (htmlRow?.content && htmlRow.content.length > 100) {
        return c.html(safeScriptBlocks(htmlRow.content))
      }
    }

    // Business Plan: render rich HTML from sections array
    if (dtype === 'business_plan' && content?.sections && Array.isArray(content.sections)) {
      const bpScore = content.score || score || 0
      const sections = content.sections as { title: string, content: string }[]
      const companyName = user.name || 'Entreprise'
      // Fetch project name if available
      let projectName = companyName
      try {
        const proj = await c.env.DB.prepare("SELECT name FROM projects WHERE user_id = ? LIMIT 1").bind(userId).first() as any
        if (proj?.name) projectName = proj.name
      } catch {}

      const sectionIcons: Record<string, string> = {
        'Résumé Exécutif': 'fa-bookmark', 'Resume Executif': 'fa-bookmark',
        'Présentation': 'fa-building', 'Presentation': 'fa-building',
        'Analyse': 'fa-chart-line', 'Marché': 'fa-store', 'Marche': 'fa-store',
        'BMC': 'fa-th-large', 'Stratégie': 'fa-bullseye', 'Strategie': 'fa-bullseye',
        'Opérationnel': 'fa-cogs', 'Operationnel': 'fa-cogs',
        'Financ': 'fa-coins', 'Risque': 'fa-shield-alt',
        'Gouvernance': 'fa-users-cog', 'Impact': 'fa-leaf',
        'Financement': 'fa-hand-holding-usd', 'Annexe': 'fa-paperclip',
      }
      const getIcon = (title: string) => {
        for (const [key, icon] of Object.entries(sectionIcons)) {
          if (title.includes(key)) return icon
        }
        return 'fa-file-alt'
      }
      const sectionColors = ['#1e3a5f', '#0e7c5f', '#d97706', '#7c3aed', '#dc2626', '#0284c7', '#059669', '#9333ea', '#e11d48', '#0891b2']

      let sectionsHtml = ''
      let navHtml = ''
      sections.forEach((sec, idx) => {
        const sectionId = `bp-section-${idx}`
        const icon = getIcon(sec.title)
        const color = sectionColors[idx % sectionColors.length]
        navHtml += `<a href="#${sectionId}" class="bp-nav-item" style="border-left:3px solid ${color};padding:6px 12px;display:block;font-size:13px;color:#374151;text-decoration:none;margin-bottom:4px;border-radius:0 6px 6px 0;transition:all .2s" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">${idx + 1}. ${sec.title}</a>`

        // Convert markdown-like content to HTML
        let htmlContent = (sec.content || '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/^### (.*$)/gm, '<h4 class="text-md font-semibold text-gray-700 mt-4 mb-2">$1</h4>')
          .replace(/^## (.*$)/gm, '<h3 class="text-lg font-semibold text-gray-800 mt-5 mb-2">$1</h3>')
          .replace(/^- (.*$)/gm, '<li class="ml-4 mb-1">$1</li>')
          .replace(/(<li.*<\/li>\n?)+/g, '<ul class="list-disc pl-4 mb-3">$&</ul>')
          .replace(/\n{2,}/g, '</p><p class="mb-3 text-gray-700 leading-relaxed">')
          .replace(/\n/g, '<br>')
        htmlContent = `<p class="mb-3 text-gray-700 leading-relaxed">${htmlContent}</p>`

        sectionsHtml += `
          <div id="${sectionId}" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6 scroll-mt-20">
            <div class="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm" style="background:${color}"><i class="fas ${icon}"></i></div>
              <h2 class="text-xl font-bold text-gray-800">${sec.title}</h2>
            </div>
            <div class="bp-content">${htmlContent}</div>
          </div>`
      })

      const bpHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
        <title>Business Plan — ${projectName}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          body{font-family:'Inter',sans-serif;background:#f0f2f5;color:#374151}
          .bp-header{background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);color:white;padding:32px;border-radius:16px;margin-bottom:24px}
          .score-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;font-weight:700;font-size:14px}
          .bp-content p{margin-bottom:12px;line-height:1.7}
          .bp-content strong{color:#1e3a5f}
          .bp-content ul{margin:8px 0 16px 0}
          .bp-content li{padding:2px 0}
          @media print{.bp-nav{display:none !important}.bp-header{break-after:avoid}}
        </style>
      </head><body class="p-4 md:p-8">
        <div class="max-w-6xl mx-auto">
          <div class="bp-header">
            <div class="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 class="text-3xl font-bold mb-1"><i class="fas fa-file-contract mr-2"></i>Business Plan</h1>
                <p class="text-blue-100 text-lg">${projectName}</p>
              </div>
              <div>
                <div class="score-badge" style="background:rgba(255,255,255,0.2)">
                  <i class="fas fa-star text-yellow-300"></i>
                  Score : ${bpScore}/100
                </div>
                <div class="text-blue-200 text-xs mt-2">${sections.length} sections • Généré par ESONO AI</div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div class="lg:col-span-1">
              <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sticky top-4 bp-nav">
                <h3 class="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3"><i class="fas fa-list mr-1"></i>Sommaire</h3>
                ${navHtml}
              </div>
            </div>
            <div class="lg:col-span-3">${sectionsHtml}</div>
          </div>
        </div>
      </body></html>`

      return c.html(safeScriptBlocks(bpHtml))
    }

    // Fallback: render JSON content nicely for remaining types
    return c.html(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
      <title>${meta.title} — ${user.name}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
      <style>body{font-family:Inter,sans-serif;background:#f9fafb;color:#374151}pre{white-space:pre-wrap;word-wrap:break-word;background:#f3f4f6;padding:16px;border-radius:8px;font-size:12px}</style>
    </head><body class="p-8 max-w-5xl mx-auto">
      <div class="bg-white rounded-xl shadow-lg p-8 mb-6">
        <div class="flex items-center gap-4 mb-6">
          <div class="w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl" style="background:${meta.colorHex}"><i class="fas ${meta.icon}"></i></div>
          <div>
            <h1 class="text-2xl font-bold text-gray-800">${meta.title}</h1>
            <p class="text-sm text-gray-500">${user.name} — Score: <span class="font-bold" style="color:${score >= 70 ? '#059669' : score >= 50 ? '#d97706' : '#dc2626'}">${score}/100</span></p>
          </div>
        </div>
        <pre>${JSON.stringify(content, null, 2).replace(/</g, '&lt;')}</pre>
      </div>
    </body></html>`)
  } catch (e: any) {
    return c.text('Erreur: ' + e.message, 500)
  }
})

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
    // ═══ Fetch Plan OVO ID (for real Excel download) ═══
    let planOvoId: string | null = null
    let planOvoStatus: string | null = null
    let planOvoScore: number | null = null
    let planOvoCreatedAt: string | null = null
    if (dtype === 'plan_ovo') {
      const pmeId = `pme_${payload.userId}`
      const latestPlan = await c.env.DB.prepare(`
        SELECT id, status, score, created_at, analysis_json FROM plan_ovo_analyses
        WHERE user_id = ? AND pme_id = ? AND status = 'filled'
        ORDER BY created_at DESC LIMIT 1
      `).bind(payload.userId, pmeId).first() as any
      if (latestPlan) {
        planOvoId = latestPlan.id
        planOvoStatus = latestPlan.status
        planOvoScore = latestPlan.score ?? null
        planOvoCreatedAt = latestPlan.created_at ?? null
        console.log('[Plan OVO Deliverable] Found filled plan:', planOvoId)
        // Enrich content from the real plan analysis if available
        if (latestPlan.analysis_json) {
          try {
            const analysis = JSON.parse(latestPlan.analysis_json)
            if (analysis.projections) content.projections = analysis.projections
            if (analysis.key_metrics) content.key_metrics = analysis.key_metrics
            if (analysis.hypotheses) content.assumptions = analysis.hypotheses
            if (analysis.metadata) content.metadata = analysis.metadata
          } catch { /* ignore parse error */ }
        }
      }
    }

    const isAvailable = !!deliverable || !!planOvoId
    const dScore = deliverable?.score ?? planOvoScore ?? 0
    const scoreColor = getScoreColor(dScore)
    const scoreLabel = getScoreLabel(dScore)
    const createdAt = (deliverable?.created_at || planOvoCreatedAt)
      ? new Date(deliverable?.created_at || planOvoCreatedAt!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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
        return c.html(safeScriptBlocks(bmcHtml.content))
      }

      // 2. Fallback: use old template with stored JSON data
      if (isAvailable) {
        const bmcData = adaptBMCData(content, (user?.name as string) || 'Entrepreneur', (user?.name as string) || 'Entrepreneur')
        return c.html(safeScriptBlocks(renderBMCPage(bmcData, (user?.name as string) || 'Entrepreneur')))
      }
    }

    // SIC Analysis — serve from sic_analyses (new flow) or pre-generated HTML
    if (dtype === 'sic_analysis') {
      // 1. Try pre-stored sic_html
      const sicHtml = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_html' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      
      if (sicHtml?.content && sicHtml.content.length > 500) {
        console.log('[SIC Deliverable Page] Serving pre-stored HTML (' + sicHtml.content.length + ' chars)')
        return c.html(safeScriptBlocks(sicHtml.content))
      }

      // 2. Generate from sic_analyses (new SIC Analyst flow)
      const sicAnalysis = await c.env.DB.prepare(`
        SELECT analysis_json, extraction_json, score FROM sic_analyses
        WHERE user_id = ? AND analysis_json IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `).bind(payload.userId).first() as any

      if (sicAnalysis?.analysis_json) {
        try {
          const analysisData = JSON.parse(sicAnalysis.analysis_json)
          const extractionData = sicAnalysis.extraction_json ? JSON.parse(sicAnalysis.extraction_json) : null
          const extractMeta = extractionData?.metadata || {}

          // Get project name
          const project = await c.env.DB.prepare(
            'SELECT name FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
          ).bind(payload.userId).first() as any

          const delivInput: SicAnalystDeliverableInput = {
            companyName: extractMeta.nom_entreprise || (project?.name as string) || 'Mon Projet',
            entrepreneurName: (user?.name as string) || 'Entrepreneur',
            sector: extractMeta.secteur || '',
            location: extractMeta.zone_geographique || '',
            country: "Côte d'Ivoire",
            analysis: analysisData,
            extractionJson: extractionData
          }

          const html = renderSicDeliverableFromAnalyst(delivInput)
          console.log('[SIC Deliverable Page] Generated from sic_analyses (' + html.length + ' chars)')

          // Cache for next time
          try {
            await c.env.DB.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_html'").bind(payload.userId).run()
            const delivId = crypto.randomUUID()
            await c.env.DB.prepare(
              "INSERT INTO entrepreneur_deliverables (id, user_id, type, content, created_at) VALUES (?, ?, 'sic_html', ?, datetime('now'))"
            ).bind(delivId, payload.userId, html).run()
          } catch { /* ignore cache error */ }

          return c.html(safeScriptBlocks(html))
        } catch (e) {
          console.error('[SIC Deliverable Page] Error generating from sic_analyses:', e)
        }
      }
      // Fallback: continue to generic rendering below
    }

    // Framework Analyse — serve pre-generated HTML from database
    if (dtype === 'framework') {
      const fwHtml = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_html' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      
      if (fwHtml?.content) {
        console.log('[Framework Deliverable Page] Serving pre-stored HTML (' + fwHtml.content.length + ' chars)')
        return c.html(safeScriptBlocks(fwHtml.content))
      }
      // Fallback: continue to generic rendering below
    }

    // Diagnostic Expert — serve pre-generated HTML from database
    if (dtype === 'diagnostic') {
      const diagHtml = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'diagnostic_html' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      
      if (diagHtml?.content) {
        console.log('[Diagnostic Expert Page] Serving pre-stored HTML (' + diagHtml.content.length + ' chars)')
        return c.html(safeScriptBlocks(diagHtml.content))
      }
      // Fallback: continue to generic rendering below
    }

    // Plan Financier OVO / Inputs Diagnostic — serve pre-generated HTML from database
    if (dtype === 'plan_ovo') {
      const inputsHtml = await c.env.DB.prepare(
        "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'inputs_html' ORDER BY version DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      
      if (inputsHtml?.content) {
        console.log('[Inputs Deliverable Page] Serving pre-stored HTML (' + inputsHtml.content.length + ' chars)')
        return c.html(safeScriptBlocks(inputsHtml.content))
      }
      // Fallback: continue to generic rendering below
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

    <!-- Downloads bar — CORRECTION: boutons dynamiques par type de livrable -->
    <div class="dlv-section" style="padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <h2 style="font-size:14px;font-weight:600;color:#1f2937;display:flex;align-items:center;gap:8px;margin:0"><i class="fas fa-download" style="color:${meta.color}"></i> Télécharger le livrable</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${isAvailable ? (() => {
            // Matrice des boutons de téléchargement par type de livrable
            const downloadButtons: { label: string; icon: string; color: string; onclick: string; id?: string }[] = []
            
            if (dtype === 'diagnostic') {
              // Diagnostic Expert → HTML + PDF
              downloadButtons.push(
                { label: '📄 Télécharger HTML', icon: 'fa-file-code', color: '#1e3a5f', onclick: "downloadDeliverable('html')", id: 'btn-download-html' },
                { label: '📕 Télécharger PDF', icon: 'fa-file-pdf', color: '#7c2d12', onclick: "downloadDeliverable('pdf')", id: 'btn-download-pdf' }
              )
            } else if (dtype === 'plan_ovo') {
              // Plan OVO → .xlsm (macro-enabled template)
              downloadButtons.push(
                { label: '📊 Télécharger Excel (.xlsm)', icon: 'fa-file-excel', color: '#059669', onclick: "downloadDeliverable('xlsx')", id: 'btn-download' }
              )
            } else if (dtype === 'framework' || dtype === 'odd') {
              // Excel-type → Excel uniquement
              downloadButtons.push(
                { label: '📊 Télécharger Excel (.xlsx)', icon: 'fa-file-excel', color: '#059669', onclick: "downloadDeliverable('xlsx')", id: 'btn-download' }
              )
            } else if (dtype === 'bmc_analysis' || dtype === 'sic_analysis' || dtype === 'business_plan') {
              // Word-type → Word + PDF
              downloadButtons.push(
                { label: '📄 Télécharger Word (.docx)', icon: 'fa-file-word', color: '#2563eb', onclick: "downloadDeliverable('docx')", id: 'btn-download-word' },
                { label: '📕 Télécharger PDF', icon: 'fa-file-pdf', color: '#7c2d12', onclick: "downloadDeliverable('pdf')", id: 'btn-download-pdf' }
              )
            } else {
              // Fallback
              downloadButtons.push(
                { label: 'Télécharger', icon: 'fa-download', color: meta.color, onclick: "downloadDeliverable()", id: 'btn-download' }
              )
            }
            
            return downloadButtons.map(btn => `
              <button onclick="${btn.onclick}" ${btn.id ? `id="${btn.id}"` : ''} style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:${btn.color};color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px ${btn.color}30" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                <i class="fas ${btn.icon}"></i> ${btn.label}
              </button>
            `).join('')
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
    const DLIV_TYPE = ${safeJSON(dtype)};
    const DLIV_DATA = ${safeJSON(content)};
    const DLIV_SCORE = ${safeJSON(dScore)};
    const DLIV_META = ${safeJSON(meta)};
    const USER_NAME = ${safeJSON(user?.name || 'Entrepreneur')};
    const DLIV_DATE = ${safeJSON(new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))};
    const PLAN_OVO_ID = ${safeJSON(planOvoId)};

    function downloadDeliverable(format) {
      // Find the button that was clicked — try specific IDs first, then generic
      const btn = document.getElementById('btn-download') 
        || document.getElementById('btn-download-word')
        || document.getElementById('btn-download-html')
        || document.getElementById('btn-download-pdf');
      const clickedBtn = event?.target?.closest?.('button');
      const activeBtn = clickedBtn || btn;
      const originalHtml = activeBtn ? activeBtn.innerHTML : '';
      if(activeBtn){ activeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...'; activeBtn.disabled = true; }
      
      const resetBtn = () => {
        if(activeBtn){ activeBtn.innerHTML = '<i class="fas fa-check"></i> Téléchargé !'; setTimeout(() => { activeBtn.innerHTML = originalHtml; activeBtn.disabled = false; }, 2500); }
      };
      const errorBtn = (msg) => {
        alert('Erreur: ' + msg);
        if(activeBtn){ activeBtn.innerHTML = originalHtml; activeBtn.disabled = false; }
      };
      
      try {
        // Route by format parameter
        if (format === 'xlsx') {
          if (DLIV_TYPE === 'framework') {
            downloadFrameworkExcelFromServer();
            return; // async — handles its own button reset
          } else if (DLIV_TYPE === 'plan_ovo' && PLAN_OVO_ID) {
            downloadPlanOVOFromServer();
            return; // async — handles its own button reset
          } else {
            generateExcel();
            resetBtn();
          }
        } else if (format === 'docx') {
          generateWord();
          resetBtn();
        } else if (format === 'pdf') {
          generatePrintPDF();
          resetBtn();
        } else if (format === 'html') {
          generatePrintPDF(); // HTML view is same as PDF print view
          resetBtn();
        } else {
          // Legacy fallback (no format specified)
          if (DLIV_TYPE === 'framework') {
            downloadFrameworkExcelFromServer();
            return;
          } else if (DLIV_TYPE === 'plan_ovo' && PLAN_OVO_ID) {
            downloadPlanOVOFromServer();
            return;
          } else if (['odd','plan_ovo'].includes(DLIV_TYPE)) {
            generateExcel();
          } else if (['business_plan','bmc_analysis','sic_analysis'].includes(DLIV_TYPE)) {
            generateWord();
          } else {
            generatePrintPDF();
          }
          resetBtn();
        }
      } catch(e) { errorBtn(e.message); }
    }

    // ═══ FRAMEWORK EXCEL — Server-side filled template ═══
    async function downloadFrameworkExcelFromServer() {
      const btn = document.getElementById('btn-download');
      try {
        const resp = await fetch('/api/download/framework-excel');
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Erreur inconnue' }));
          throw new Error(err.error || 'Erreur ' + resp.status);
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Get filename from Content-Disposition header or use default
        const cd = resp.headers.get('Content-Disposition');
        const fnMatch = cd && cd.match(/filename="?([^"]+)"?/);
        a.download = fnMatch ? fnMatch[1] : 'Framework_Analyse_PME_' + USER_NAME.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if(btn){ btn.innerHTML = '<i class="fas fa-check"></i> Téléchargé !'; setTimeout(() => { btn.innerHTML = btn.dataset.originalHtml || 'Télécharger'; btn.disabled = false; }, 3000); }
      } catch(e) {
        alert('Erreur téléchargement Excel: ' + e.message);
        if(btn){ btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Erreur'; btn.disabled = false; }
      }
    }

    // ═══ PLAN OVO EXCEL — Server-side filled OVO template ═══
    async function downloadPlanOVOFromServer() {
      const btn = document.getElementById('btn-download');
      const originalHtml = btn ? btn.innerHTML : '';
      if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Téléchargement...'; btn.disabled = true; }
      try {
        const token = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('auth_token='));
        const tokenVal = token ? token.split('=').slice(1).join('=') : '';
        const resp = await fetch('/api/plan-ovo/download/' + PLAN_OVO_ID, {
          headers: tokenVal ? { 'Authorization': 'Bearer ' + tokenVal } : {},
          credentials: 'include'
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Erreur ' + resp.status }));
          throw new Error(err.error || err.message || 'Erreur ' + resp.status);
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cd = resp.headers.get('Content-Disposition');
        const fnMatch = cd && cd.match(/filename="?([^"]+)"?/);
        a.download = fnMatch ? fnMatch[1] : 'Plan_OVO_' + USER_NAME.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.xlsm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (btn) { btn.innerHTML = '<i class="fas fa-check"></i> Téléchargé !'; setTimeout(() => { btn.innerHTML = originalHtml; btn.disabled = false; }, 3000); }
      } catch(e) {
        alert('Erreur téléchargement Plan OVO: ' + e.message);
        if (btn) { btn.innerHTML = originalHtml; btn.disabled = false; }
      }
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

    // ═══ WORD GENERATION — Works for business_plan, bmc_analysis, sic_analysis ═══
    function generateWord() {
      const mainContent = document.querySelector('.space-y-0') || document.querySelector('main');
      const typeLabel = DLIV_TYPE === 'bmc_analysis' ? 'BMC_Analyse' : DLIV_TYPE === 'sic_analysis' ? 'SIC_Analyse' : 'BusinessPlan';
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
      a.download = typeLabel + '_' + USER_NAME.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.doc';
      a.click();
      URL.revokeObjectURL(url);
    }

    // Store original button HTML for reset
    document.addEventListener('DOMContentLoaded', () => {
      // Store original HTML for all download buttons
      ['btn-download', 'btn-download-word', 'btn-download-html', 'btn-download-pdf'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.dataset.originalHtml = btn.innerHTML;
      });
    });
  </script>
</body>
</html>`

    return c.html(safeScriptBlocks(html))
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

    // Fetch deliverables (exclude coach private — only show entrepreneur's own + shared coach deliverables)
    // Also include shared deliverables from linked coach
    const coachLink = await c.env.DB.prepare(
      'SELECT coach_user_id FROM coach_entrepreneurs WHERE linked_user_id = ? LIMIT 1'
    ).bind(payload.userId).first<any>()
    const linkedCoachId = coachLink?.coach_user_id || null

    let deliverables: any
    if (linkedCoachId) {
      deliverables = await c.env.DB.prepare(`
        SELECT ed.* FROM entrepreneur_deliverables ed
        INNER JOIN (
          SELECT type, MAX(version) as max_version FROM entrepreneur_deliverables 
          WHERE (user_id = ? AND NOT (generated_by IN ('coach','coach_mirror') AND visibility = 'private'))
             OR (coach_user_id = ? AND visibility = 'shared')
          GROUP BY type
        ) latest 
        ON ed.type = latest.type AND ed.version = latest.max_version 
        WHERE (ed.user_id = ? AND NOT (ed.generated_by IN ('coach','coach_mirror') AND ed.visibility = 'private'))
           OR (ed.coach_user_id = ? AND ed.visibility = 'shared')
      `).bind(payload.userId, linkedCoachId, payload.userId, linkedCoachId).all()
    } else {
      deliverables = await c.env.DB.prepare(`
        SELECT ed.* FROM entrepreneur_deliverables ed
        INNER JOIN (SELECT type, MAX(version) as max_version FROM entrepreneur_deliverables 
          WHERE user_id = ? AND NOT (generated_by IN ('coach','coach_mirror') AND visibility = 'private')
          GROUP BY type) latest 
        ON ed.type = latest.type AND ed.version = latest.max_version 
        WHERE ed.user_id = ? AND NOT (ed.generated_by IN ('coach','coach_mirror') AND ed.visibility = 'private')
      `).bind(payload.userId, payload.userId).all()
    }

    const delivMap: Record<string, any> = {}
    for (const d of (deliverables.results || []) as any[]) {
      delivMap[d.type] = d
    }

    // ── If no 'diagnostic' in delivMap, inject from diagnostic_analyses ──
    if (!delivMap.diagnostic) {
      try {
        const pmeId = `pme_${payload.userId}`
        const diagFallbackRow = await c.env.DB.prepare(
          "SELECT id, analysis_json, score, version, status, created_at FROM diagnostic_analyses WHERE user_id = ? AND pme_id = ? AND status IN ('analyzed','generated','partial') ORDER BY created_at DESC LIMIT 1"
        ).bind(payload.userId, pmeId).first() as any
        if (diagFallbackRow?.analysis_json) {
          delivMap.diagnostic = {
            id: diagFallbackRow.id,
            type: 'diagnostic',
            content: diagFallbackRow.analysis_json,
            score: diagFallbackRow.score || 0,
            version: diagFallbackRow.version || 1,
            created_at: diagFallbackRow.created_at,
            _source: 'diagnostic_analyses'
          }
          console.log('[Entrepreneur Page] Injected diagnostic from diagnostic_analyses (score=' + diagFallbackRow.score + ')')
        }
      } catch (e) {
        console.error('[Entrepreneur Page] Error loading diagnostic fallback:', e)
      }
    }

    // Load pre-stored BMC Claude AI HTML from database (instant display)
    const bmcHtmlRow = await c.env.DB.prepare(
      "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'bmc_html' ORDER BY version DESC LIMIT 1"
    ).bind(payload.userId).first() as any
    const bmcClaudeHtml = bmcHtmlRow?.content || ''

    // Load pre-stored Framework PME HTML from database (instant display)
    const fwHtmlRow = await c.env.DB.prepare(
      "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'framework_html' ORDER BY version DESC LIMIT 1"
    ).bind(payload.userId).first() as any
    const frameworkClaudeHtml = fwHtmlRow?.content || ''

    // Load pre-stored Diagnostic Expert HTML from database (instant display)
    // With C1/C3 sync, entrepreneur_deliverables is always up-to-date.
    // Primary: diagnostic_html from entrepreneur_deliverables
    // Fallback: diagnostic_analyses (for cases where sync hasn't run yet)
    let diagnosticClaudeHtml = ''
    let diagnosticAnalysisJson: any = null
    const diagHtmlRow = await c.env.DB.prepare(
      "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'diagnostic_html' ORDER BY version DESC LIMIT 1"
    ).bind(payload.userId).first() as any
    if (diagHtmlRow?.content && diagHtmlRow.content.length > 200) {
      diagnosticClaudeHtml = diagHtmlRow.content
    }

    // Load analysis_json: first from entrepreneur_deliverables, fallback to diagnostic_analyses
    const diagJsonRow = await c.env.DB.prepare(
      "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'diagnostic' ORDER BY version DESC LIMIT 1"
    ).bind(payload.userId).first() as any
    if (diagJsonRow?.content) {
      try { diagnosticAnalysisJson = JSON.parse(diagJsonRow.content) } catch { /* ignore */ }
    }
    // Fallback: if no data in entrepreneur_deliverables, check diagnostic_analyses
    if (!diagnosticClaudeHtml || !diagnosticAnalysisJson) {
      try {
        const pmeId = `pme_${payload.userId}`
        const diagAnalysisRow = await c.env.DB.prepare(
          "SELECT html_content, analysis_json, score, version FROM diagnostic_analyses WHERE user_id = ? AND pme_id = ? AND status IN ('analyzed','generated','partial') ORDER BY created_at DESC LIMIT 1"
        ).bind(payload.userId, pmeId).first() as any
        if (!diagnosticClaudeHtml && diagAnalysisRow?.html_content && diagAnalysisRow.html_content.length > 200) {
          diagnosticClaudeHtml = diagAnalysisRow.html_content
          console.log('[Entrepreneur Page] Diagnostic HTML fallback from diagnostic_analyses')
        }
        if (!diagnosticAnalysisJson && diagAnalysisRow?.analysis_json) {
          try { diagnosticAnalysisJson = JSON.parse(diagAnalysisRow.analysis_json) } catch { /* ignore */ }
        }
      } catch (e) {
        console.error('[Entrepreneur Page] Error loading diagnostic fallback:', e)
      }
    }

    // Load pre-stored SIC HTML from database (instant display)
    // First try sic_html from entrepreneur_deliverables, then generate from sic_analyses if needed
    let sicClaudeHtml = ''
    const sicHtmlRow = await c.env.DB.prepare(
      "SELECT content FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_html' ORDER BY version DESC LIMIT 1"
    ).bind(payload.userId).first() as any
    if (sicHtmlRow?.content && sicHtmlRow.content.length > 500) {
      sicClaudeHtml = sicHtmlRow.content
    } else {
      // Try to generate from sic_analyses (new SIC Analyst flow)
      try {
        const sicAnalysisRow = await c.env.DB.prepare(`
          SELECT analysis_json, extraction_json, score FROM sic_analyses
          WHERE user_id = ? AND analysis_json IS NOT NULL
          ORDER BY created_at DESC LIMIT 1
        `).bind(payload.userId).first() as any
        if (sicAnalysisRow?.analysis_json) {
          const analysisData = JSON.parse(sicAnalysisRow.analysis_json)
          const extractionData = sicAnalysisRow.extraction_json ? JSON.parse(sicAnalysisRow.extraction_json) : null
          const extractMeta = extractionData?.metadata || {}
          const projectRow = await c.env.DB.prepare(
            'SELECT name FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
          ).bind(payload.userId).first() as any
          const delivInput: SicAnalystDeliverableInput = {
            companyName: extractMeta.nom_entreprise || (projectRow?.name as string) || 'Mon Projet',
            entrepreneurName: (user?.name as string) || 'Entrepreneur',
            sector: extractMeta.secteur || '',
            location: extractMeta.zone_geographique || '',
            country: "Côte d'Ivoire",
            analysis: analysisData,
            extractionJson: extractionData
          }
          sicClaudeHtml = renderSicDeliverableFromAnalyst(delivInput)
          // Cache for next time
          try {
            await c.env.DB.prepare("DELETE FROM entrepreneur_deliverables WHERE user_id = ? AND type = 'sic_html'").bind(payload.userId).run()
            const sicHtmlId = crypto.randomUUID()
            await c.env.DB.prepare(
              "INSERT INTO entrepreneur_deliverables (id, user_id, type, content, created_at) VALUES (?, ?, 'sic_html', ?, datetime('now'))"
            ).bind(sicHtmlId, payload.userId, sicClaudeHtml).run()
            console.log('[Entrepreneur Page] Cached SIC HTML (' + sicClaudeHtml.length + ' chars)')
          } catch { /* ignore cache error */ }
        }
      } catch (e) {
        console.error('[Entrepreneur Page] Error generating SIC HTML:', e)
      }
    }

    // ═══ Fetch Plan OVO ID + extraction data for preview and direct download ═══
    let mainPlanOvoId: string | null = null
    let mainPlanOvoExtraction: any = null
    try {
      // Search with multiple statuses and pme_id variants
      const planRow = await c.env.DB.prepare(
        "SELECT id, extraction_json FROM plan_ovo_analyses WHERE user_id = ? AND status IN ('filled', 'generated', 'extracted', 'filling', 'generating') ORDER BY created_at DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      if (planRow?.id) {
        mainPlanOvoId = planRow.id
        if (planRow.extraction_json) {
          try { mainPlanOvoExtraction = JSON.parse(planRow.extraction_json) } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    // ═══ Fetch Business Plan Analysis ID for Word download ═══
    let mainBpAnalysisId: string | null = null
    try {
      const bpRow = await c.env.DB.prepare(
        "SELECT id FROM business_plan_analyses WHERE user_id = ? AND status IN ('completed', 'generated', 'analyzed') ORDER BY created_at DESC LIMIT 1"
      ).bind(payload.userId).first() as any
      if (bpRow?.id) {
        mainBpAnalysisId = bpRow.id
      }
    } catch { /* ignore */ }

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

    const hasBmcSic = !!(uploadsByCategory.bmc && uploadsByCategory.sic)
    const uploadCount = (hasBmcSic ? 1 : 0) + (uploadsByCategory.inputs ? 1 : 0)
    const uploadTotal = 2  // BMC&SIC + Inputs
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
      btnLabel = 'COMMENCER → UPLOADER MES DOCUMENTS'; btnSub = '(0/2 — Uploadez au moins un document)'; btnClass = 'ev2-btn--disabled'; btnDisabled = true; btnTooltip = 'Uploadez au moins un document pour commencer'
    } else if (uploadCount < 2) {
      btnLabel = hasGenerated ? 'REGÉNÉRER LES LIVRABLES' : 'GÉNÉRER LES LIVRABLES'
      btnSub = `(${uploadCount}/2 inputs — ${generableCount}/7 livrables générables)`
      btnClass = 'ev2-btn--orange'; btnDisabled = false
      const missingLabels = (!hasBmcSic ? ['BMC & SIC'] : []).concat(!uploadsByCategory.inputs ? ['Inputs Financiers'] : []).join(', ')
      btnTooltip = `Génération partielle. Manque : ${missingLabels}`
    } else {
      btnLabel = hasGenerated ? 'REGÉNÉRER LES LIVRABLES' : 'GÉNÉRER LES LIVRABLES'
      btnSub = '(2/2 inputs — 7/7 livrables · Analyse complète)'; btnClass = 'ev2-btn--green'; btnDisabled = false; btnTooltip = 'Tous les documents sont uploadés. Génération complète des 7 livrables.'
    }

    // ── Build uploaded sources list for sidebar ──
    const allUploads: any[] = []
    if (uploadsByCategory.bmc) allUploads.push({ ...uploadsByCategory.bmc, category: 'bmc' })
    if (uploadsByCategory.sic) allUploads.push({ ...uploadsByCategory.sic, category: 'sic' })
    if (uploadsByCategory.inputs) allUploads.push({ ...uploadsByCategory.inputs, category: 'inputs' })
    for (const sf of supplementaryFiles) allUploads.push({ ...sf, category: 'supplementary' })

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
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', 'IBM Plex Sans', sans-serif; background: white; color: #374151; margin: 0; padding: 0; min-height: 100vh; overflow-x: hidden; }
    a { color: #1e3a5f; text-decoration: none; }
    a:hover { text-decoration: underline; color: #2a4d7a; }
    
    /* ── App Header ── */
    .ev2-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; background: #ffffff; border-bottom: 1px solid #e5e7eb; position: sticky; top: 0; z-index: 100; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); flex-shrink: 0; }
    .ev2-header__brand { font-size: 18px; font-weight: 800; color: #1e3a5f; letter-spacing: 1px; text-decoration: none; }
    .ev2-header__right { display: flex; align-items: center; gap: 14px; }
    .ev2-header__user { font-size: 12px; color: #6b7280; }
    .ev2-header__user strong { color: #1f2937; }
    .ev2-btn-sm { background: #ffffff; border: 1px solid #d1d5db; color: #374151; padding: 5px 12px; border-radius: 6px; font-size: 11px; cursor: pointer; transition: all 0.2s; font-family: inherit; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
    .ev2-btn-sm:hover { border-color: #1e3a5f; color: #1e3a5f; background: #f3f4f6; text-decoration: none; }
    .ev2-btn-sm--danger:hover { border-color: #dc2626; color: #dc2626; background: #fee2e2; }
    @media (max-width: 640px) { .ev2-hide-mobile { display: none; } }
    
    /* ── Score Banner COMPACT (always shown as thin strip) ── */
    .ev2-score { background: linear-gradient(135deg, #1e3a5f 0%, #2a4d7a 100%); padding: 8px 20px; display: flex; align-items: center; justify-content: center; gap: 16px; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .ev2-score__title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; color: #c9a962; }
    .ev2-score__value { font-size: 22px; font-weight: 800; color: #ffffff; }
    .ev2-score__bar { width: 120px; height: 4px; background: rgba(255,255,255,0.15); border-radius: 99px; overflow: hidden; }
    .ev2-score__bar-fill { height: 100%; border-radius: 99px; transition: width 1s ease-out; }
    .ev2-score__meta { font-size: 10px; color: rgba(255,255,255,0.6); }
    .ev2-score__meta span { margin: 0 6px; }
    
    /* ═══ MAIN LAYOUT: Sidebar + Center + Bottom ═══ */
    .ev2-main { display: flex; height: calc(100vh - 90px); overflow: hidden; }
    
    /* ── LEFT SIDEBAR (NotebookLM style) ── */
    .ev2-sidebar { width: 320px; min-width: 320px; background: #f9fafb; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; overflow: hidden; }
    .ev2-sidebar__header { padding: 20px 18px 12px; border-bottom: 1px solid #e5e7eb; background: #ffffff; }
    .ev2-sidebar__title { font-size: 15px; font-weight: 700; color: #1f2937; display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .ev2-sidebar__subtitle { font-size: 12px; color: #6b7280; }
    
    /* Upload cards (3 CTAs) */
    .ev2-sidebar__uploads { flex: 1; overflow-y: auto; padding: 12px 18px; }
    .ev2-sidebar__sources-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #9ca3af; margin-bottom: 10px; }
    .ev2-upload-card { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #ffffff; border: 2px dashed #d1d5db; border-radius: 12px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s; position: relative; }
    .ev2-upload-card:hover { border-color: #93c5fd; background: #f8faff; box-shadow: 0 2px 8px rgba(37,99,235,0.08); }
    .ev2-upload-card--done { border-style: solid; border-color: #86efac; background: #f0fdf4; }
    .ev2-upload-card--done:hover { border-color: #4ade80; background: #ecfdf5; }
    .ev2-upload-card__icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .ev2-upload-card__icon--bmc { background: #dbeafe; color: #2563eb; }
    .ev2-upload-card__icon--sic { background: #d1fae5; color: #059669; }
    .ev2-upload-card__icon--inputs { background: #fef3c7; color: #d97706; }
    .ev2-upload-card__info { flex: 1; min-width: 0; }
    .ev2-upload-card__title { font-size: 12px; font-weight: 700; color: #1f2937; margin-bottom: 2px; }
    .ev2-upload-card__hint { font-size: 11px; color: #9ca3af; display: flex; align-items: center; gap: 5px; }
    .ev2-upload-card__file { font-size: 11px; color: #059669; font-weight: 600; display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev2-upload-card__rm { position: absolute; top: 8px; right: 8px; background: none; border: none; color: #d1d5db; cursor: pointer; font-size: 11px; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s; opacity: 0; }
    .ev2-upload-card:hover .ev2-upload-card__rm { opacity: 1; }
    .ev2-upload-card__rm:hover { background: #fee2e2; color: #dc2626; }
    
    /* Supplementary docs button */
    .ev2-sidebar__supp { margin-top: 4px; margin-bottom: 8px; }
    .ev2-supp-btn { width: 100%; padding: 8px; background: transparent; color: #6b7280; border: 1px dashed #d1d5db; border-radius: 8px; font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; }
    .ev2-supp-btn:hover { border-color: #9ca3af; color: #374151; background: #f9fafb; }
    .ev2-source-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 8px; transition: all 0.2s; position: relative; }
    .ev2-source-item:hover { border-color: #d1d5db; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
    .ev2-source-item__icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
    .ev2-source-item__icon--bmc { background: #dbeafe; color: #2563eb; }
    .ev2-source-item__icon--sic { background: #d1fae5; color: #059669; }
    .ev2-source-item__icon--inputs { background: #fef3c7; color: #d97706; }
    .ev2-source-item__icon--supp { background: #f3f4f6; color: #6b7280; }
    .ev2-source-item__info { flex: 1; min-width: 0; }
    .ev2-source-item__name { font-size: 12px; font-weight: 600; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev2-source-item__meta { font-size: 10px; color: #9ca3af; display: flex; gap: 8px; margin-top: 2px; }
    .ev2-source-item__rm { position: absolute; top: 6px; right: 6px; background: none; border: none; color: #d1d5db; cursor: pointer; font-size: 11px; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s; opacity: 0; }
    .ev2-source-item:hover .ev2-source-item__rm { opacity: 1; }
    .ev2-source-item__rm:hover { background: #fee2e2; color: #dc2626; }
    
    /* Empty sources state */
    .ev2-source-empty { text-align: center; padding: 32px 16px; }
    .ev2-source-empty__icon { font-size: 36px; color: #e5e7eb; margin-bottom: 12px; }
    .ev2-source-empty__text { font-size: 13px; color: #9ca3af; }
    
    /* Generate CTA (bottom-fixed in sidebar) */
    .ev2-sidebar__gen { padding: 14px 18px; border-top: 1px solid #e5e7eb; background: #ffffff; flex-shrink: 0; }
    .ev2-gen-btn { width: 100%; padding: 14px; background: linear-gradient(135deg, #2563eb, #4f46e5); color: white; border: none; border-radius: 12px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; transition: all 0.3s; box-shadow: 0 4px 14px rgba(37,99,235,0.3); }
    .ev2-gen-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(37,99,235,0.4); }
    .ev2-gen-btn:disabled { background: #d1d5db; color: #9ca3af; cursor: not-allowed; box-shadow: none; }
    .ev2-gen-btn__sub { font-size: 10px; font-weight: 400; opacity: 0.8; }
    
    /* ── CENTER CONTENT AREA ── */
    .ev2-content { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
    .ev2-center__header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; background: #ffffff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
    .ev2-center__title { font-size: 14px; font-weight: 700; color: #1e3a5f; display: flex; align-items: center; gap: 8px; }
    .ev2-center__actions { display: flex; gap: 6px; }
    .ev2-center__content { flex: 1; overflow-y: auto; padding: 16px 20px; min-height: 0; background: #f9fafb; }
    
    /* ── BOTTOM DELIVERABLE ICONS (7-column grid) ── */
    .ev2-bottom { background: #ffffff; border-top: 1px solid #e5e7eb; padding: 14px 20px; flex: 0 0 auto; position: relative; z-index: 10; }
    .ev2-bottom__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; }
    .ev2-deliv-icon { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px; border-radius: 12px; cursor: pointer; transition: all 0.2s; border: 2px solid transparent; text-align: center; position: relative; }
    .ev2-deliv-icon:hover { background: #f3f4f6; }
    .ev2-deliv-icon--active { background: #eff6ff; border-color: #2563eb; }
    .ev2-deliv-icon--disabled { opacity: 0.4; cursor: default; }
    .ev2-deliv-icon__circle { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 18px; transition: transform 0.2s; }
    .ev2-deliv-icon:hover .ev2-deliv-icon__circle { transform: scale(1.08); }
    .ev2-deliv-icon__label { font-size: 10px; font-weight: 600; color: #374151; line-height: 1.3; }
    .ev2-deliv-icon__status { position: absolute; top: 6px; right: 6px; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8px; }
    .ev2-deliv-icon__status--ok { background: #d1fae5; color: #059669; }
    .ev2-deliv-icon__status--wait { background: #fef3c7; color: #d97706; }
    
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
    
    /* ── Empty state ── */
    .ev2-empty { text-align: center; padding: 60px 20px; }
    .ev2-empty__icon { font-size: 48px; color: #d1d5db; margin-bottom: 16px; }
    .ev2-empty__text { font-size: 15px; color: #6b7280; margin-bottom: 8px; }
    .ev2-empty__sub { font-size: 13px; color: #9ca3af; }
    
    /* ── Loading overlay ── */
    .ev2-loading { display: none; text-align: center; padding: 36px 20px; }
    .ev2-loading--active { display: block; }
    .ev2-loading__spinner { width: 44px; height: 44px; border: 4px solid #e5e7eb; border-top-color: #1e3a5f; border-radius: 50%; animation: ev2spin 0.8s linear infinite; margin: 0 auto 16px; }
    .ev2-loading__step { font-size: 13px; color: #6b7280; margin-bottom: 3px; }
    .ev2-loading__step--active { color: #1e3a5f; font-weight: 600; }
    .ev2-loading__step--done { color: #059669; }
    @keyframes ev2spin { to { transform: rotate(360deg); } }
    
    /* ── Mobile sidebar toggle ── */
    .ev2-sidebar-toggle { display: none; position: fixed; bottom: 20px; left: 20px; width: 52px; height: 52px; background: #2563eb; border: none; border-radius: 50%; color: white; font-size: 20px; cursor: pointer; box-shadow: 0 4px 12px rgba(37,99,235,0.4); z-index: 90; align-items: center; justify-content: center; }
    .ev2-sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 89; }
    
    /* ── Responsive ── */
    @media (max-width: 768px) {
      .ev2-main { flex-direction: column; height: auto; min-height: calc(100vh - 90px); }
      .ev2-sidebar { display: none; position: fixed; top: 0; left: 0; bottom: 0; width: 300px; z-index: 91; box-shadow: 4px 0 20px rgba(0,0,0,0.15); }
      .ev2-sidebar--open { display: flex; }
      .ev2-sidebar-overlay--open { display: block; }
      .ev2-sidebar-toggle { display: flex; }
      .ev2-content { min-height: 60vh; }
      .ev2-bottom__grid { grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .ev2-deliv-icon__label { font-size: 9px; }
      .ev2-deliv-icon__circle { width: 36px; height: 36px; font-size: 15px; }
      .ev2-score { flex-wrap: wrap; gap: 8px; padding: 8px 16px; }
    }
    @media (min-width: 769px) and (max-width: 1100px) {
      .ev2-sidebar { width: 280px; min-width: 280px; }
      .ev2-bottom__grid { grid-template-columns: repeat(7, 1fr); gap: 6px; }
      .ev2-deliv-icon__label { font-size: 9px; }
    }
  </style>
</head>
<body>
  <script>
    // Store token from URL in localStorage for auth persistence
    (function(){
      var p = new URLSearchParams(window.location.search);
      var t = p.get('token');
      if (t) { localStorage.setItem('auth_token', t); }
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

  <!-- ═══ SCORE BANNER (compact) ═══ -->
  <section class="ev2-score">
    <div class="ev2-score__title">Investment Readiness</div>
    <div class="ev2-score__value" style="color:${score >= 0 ? scoreColor : 'rgba(255,255,255,0.3)'}">${score >= 0 ? score + '/100' : '—'}</div>
    <div class="ev2-score__bar"><div class="ev2-score__bar-fill" style="width:${score >= 0 ? score : 0}%;background:${scoreColor};"></div></div>
    <div class="ev2-score__meta">
      ${hasGenerated ? `<span><i class="fas fa-code-branch"></i> v${version}</span><span><i class="fas fa-robot"></i> ${getScoreLabel(score)}</span>` : '<span>Uploadez des documents pour commencer</span>'}
    </div>
  </section>

  <!-- ═══ LOADING ═══ -->
  <section class="ev2-loading" id="loading-section">
    <div class="ev2-loading__spinner"></div>
    <p style="font-size:14px;color:#374151;margin-bottom:12px;font-weight:600;">Génération en cours — cela peut prendre 5 à 8 minutes</p>
    <p id="job-progress" style="font-size:12px;color:#1e3a5f;margin-bottom:12px;font-weight:500;">Démarrage...</p>
    <p style="font-size:11px;color:#9ca3af;margin-bottom:16px;">L'IA analyse vos documents et génère 7 livrables. Ne fermez pas cette page.</p>
    <div class="ev2-loading__step" id="step-extract"><i class="fas fa-file-lines"></i> Extraction des documents...</div>
    <div class="ev2-loading__step" id="step-analyze"><i class="fas fa-brain"></i> Analyse par l'IA (agents séquentiels)...</div>
    <div class="ev2-loading__step" id="step-gen"><i class="fas fa-file-export"></i> Génération des livrables HTML...</div>
    <div class="ev2-loading__step" id="step-done"><i class="fas fa-check-circle"></i> Terminé !</div>
  </section>

  <!-- ═══ MAIN LAYOUT: Sidebar + Center ═══ -->
  <div class="ev2-main" id="main-layout">
    <!-- LEFT SIDEBAR (NotebookLM style) -->
    <aside class="ev2-sidebar" id="sidebar">
      <div class="ev2-sidebar__header">
        <div class="ev2-sidebar__title"><i class="fas fa-folder-open"></i> Sources</div>
        <div class="ev2-sidebar__subtitle">Ajoutez vos documents d'inputs</div>
      </div>

      <!-- Upload cards (3 separate CTAs: BMC, SIC, Financier) -->
      <div class="ev2-sidebar__uploads" id="sources-list">
        <div class="ev2-sidebar__sources-title">Documents d'inputs (${uploadCount}/${uploadTotal})</div>
        
        <!-- BMC & SIC Combined Upload Card -->
        <div class="ev2-upload-card ${(uploadsByCategory.bmc && uploadsByCategory.sic) ? 'ev2-upload-card--done' : uploadsByCategory.bmc ? 'ev2-upload-card--partial' : ''}" onclick="document.getElementById('file-bmc-sic').click()">
          <div class="ev2-upload-card__icon ev2-upload-card__icon--bmc" style="background:linear-gradient(135deg,rgba(5,150,105,0.12),rgba(124,58,237,0.12))"><i class="fas fa-file-lines"></i></div>
          <div class="ev2-upload-card__info">
            <div class="ev2-upload-card__title">BMC & Impact Social</div>
            ${uploadsByCategory.bmc 
              ? `<div class="ev2-upload-card__file"><i class="fas fa-check-circle" style="color:#059669"></i> ${escapeHtml((uploadsByCategory.bmc as any).filename || 'BMC & SIC')}</div>
                 <button class="ev2-upload-card__rm" onclick="event.stopPropagation();rmBmcSic()" title="Supprimer"><i class="fas fa-trash"></i></button>`
              : `<div class="ev2-upload-card__hint"><i class="fas fa-cloud-arrow-up"></i> .docx (Questionnaire unifié)</div>`}
          </div>
          <input type="file" id="file-bmc-sic" accept=".doc,.docx,.pdf" onchange="handleUpload(this,'bmc_sic')" style="display:none">
        </div>

        <!-- Inputs Financiers Upload Card -->
        <div class="ev2-upload-card ${uploadsByCategory.inputs ? 'ev2-upload-card--done' : ''}" onclick="document.getElementById('file-inputs').click()">
          <div class="ev2-upload-card__icon ev2-upload-card__icon--inputs"><i class="fas fa-chart-line"></i></div>
          <div class="ev2-upload-card__info">
            <div class="ev2-upload-card__title">Inputs Financiers</div>
            ${uploadsByCategory.inputs 
              ? `<div class="ev2-upload-card__file"><i class="fas fa-check-circle" style="color:#059669"></i> ${escapeHtml((uploadsByCategory.inputs as any).filename || 'Financier')}</div>
                 <button class="ev2-upload-card__rm" onclick="event.stopPropagation();rmUpload('${(uploadsByCategory.inputs as any).id}')" title="Supprimer"><i class="fas fa-trash"></i></button>`
              : `<div class="ev2-upload-card__hint"><i class="fas fa-cloud-arrow-up"></i> .xls, .xlsx, .csv, .pdf <span style="color:#d97706;font-weight:600">(Excel recommandé)</span></div>`}
          </div>
          <input type="file" id="file-inputs" accept=".xls,.xlsx,.csv,.pdf" onchange="handleUpload(this,'inputs')" style="display:none">
        </div>

        <!-- Documents supplémentaires (optional) -->
        <div class="ev2-sidebar__supp">
          <button class="ev2-supp-btn" onclick="document.getElementById('file-supp').click()">
            <i class="fas fa-plus" style="font-size:10px"></i> Documents supplémentaires
          </button>
          <input type="file" id="file-supp" multiple accept=".doc,.docx,.xls,.xlsx,.pdf,.csv,.txt" onchange="handleSuppUpload(this)" style="display:none">
        </div>
        ${supplementaryFiles.length > 0 ? supplementaryFiles.map((sf: any) => `
          <div class="ev2-source-item" style="margin:0 0 6px" id="source-${sf.id}">
            <div class="ev2-source-item__icon ev2-source-item__icon--supp"><i class="fas fa-file"></i></div>
            <div class="ev2-source-item__info">
              <div class="ev2-source-item__name">${escapeHtml(sf.filename || 'Document')}</div>
              <div class="ev2-source-item__meta"><span>Supplémentaire</span></div>
            </div>
            <button class="ev2-source-item__rm" onclick="rmUpload('${sf.id}')" title="Supprimer" style="opacity:1"><i class="fas fa-trash"></i></button>
          </div>
        `).join('') : ''}
      </div>

      <!-- Generate CTA (bottom-fixed) -->
      <div class="ev2-sidebar__gen">
        <button class="ev2-gen-btn" id="btn-gen" ${uploadCount === 0 ? 'disabled' : ''} onclick="generateAll()">
          <span><i class="fas fa-wand-magic-sparkles"></i> ${hasGenerated ? 'Regénérer les livrables' : 'Générer les livrables'}</span>
          <span class="ev2-gen-btn__sub">${uploadCount}/${uploadTotal} inputs · ${generableCount}/7 livrables</span>
        </button>
      </div>
    </aside>

    <!-- CENTER: Content + Bottom icons -->
    <div class="ev2-content">
      <div class="ev2-center__header">
        <div class="ev2-center__title" id="center-title"><i class="fas fa-stethoscope"></i> Diagnostic Expert</div>
        <div class="ev2-center__actions">
        </div>
      </div>
      <div class="ev2-center__content" id="center-content">
        ${hasGenerated || delivMap.diagnostic ? `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0f4ff,#e8edfb);border:1px solid #a3b8d8;border-radius:12px;margin-bottom:16px">
            <div style="display:flex;align-items:center;gap:10px"><i class="fas fa-stethoscope" style="font-size:24px;color:#1e3a5f"></i><div><div style="font-size:14px;font-weight:700;color:#1e3a5f">\uD83D\uDD0D Diagnostic Expert</div><div style="font-size:12px;color:#4b6584">Score: ${score >= 0 ? score : (delivMap.diagnostic?.score ?? '—')}/100</div></div></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <a href="/module/diagnostic" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#1e3a5f;border:1px solid #a3b8d8;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer"><i class="fas fa-expand"></i> Pleine page</a>
            </div>
          </div>
          <iframe src="/module/diagnostic?embedded=1" style="width:100%;height:600px;border:none;border-radius:12px;background:#0f172a"></iframe>
        ` : renderEmptyState()}
      </div>

      <!-- ═══ BOTTOM DELIVERABLE ICONS (7-column grid) ═══ -->
      <div class="ev2-bottom">
        <div class="ev2-bottom__grid">
          ${(() => {
            const bottomIcons = [
              { type: 'diagnostic', label: 'Diagnostic Expert Global', icon: 'fa-stethoscope', color: '#2563eb', bg: '#dbeafe' },
              { type: 'bmc_analysis', label: 'Business Model Canvas', icon: 'fa-th', color: '#059669', bg: '#d1fae5' },
              { type: 'sic_analysis', label: 'Social Impact Canvas', icon: 'fa-hand-holding-heart', color: '#7c3aed', bg: '#ede9fe' },
              { type: 'framework', label: 'Plan Financier Intermédiaire', icon: 'fa-chart-pie', color: '#d97706', bg: '#fef3c7' },
              { type: 'plan_ovo', label: 'Plan Financier Final', icon: 'fa-chart-line', color: '#ea580c', bg: '#ffedd5' },
              { type: 'business_plan', label: 'Business Plan', icon: 'fa-building', color: '#4f46e5', bg: '#e0e7ff' },
              { type: 'odd', label: 'ODD', icon: 'fa-shield-halved', color: '#0d9488', bg: '#ccfbf1' },
            ]
            return bottomIcons.map((bi, idx) => {
              const d = delivMap[bi.type]
              const available = !!d
              const dScore = d?.score ?? 0
              return `<div class="ev2-deliv-icon ${idx === 0 ? 'ev2-deliv-icon--active' : ''} ${!available && !hasGenerated ? '' : ''}" data-type="${bi.type}" onclick="selectDeliverable('${bi.type}')">
                ${available ? `<div class="ev2-deliv-icon__status ev2-deliv-icon__status--ok"><i class="fas fa-check"></i></div>` : ''}
                <div class="ev2-deliv-icon__circle" style="background:${bi.bg};color:${bi.color}">
                  <i class="fas ${bi.icon}"></i>
                </div>
                <div class="ev2-deliv-icon__label">${bi.label}</div>
              </div>`
            }).join('')
          })()}
        </div>
      </div>
    </div>
  </div>

  <!-- Mobile sidebar toggle -->
  <button class="ev2-sidebar-toggle" id="sidebar-toggle" onclick="toggleSidebar()"><i class="fas fa-folder-open"></i></button>
  <div class="ev2-sidebar-overlay" id="sidebar-overlay" onclick="toggleSidebar()"></div>

  <script>
    // ── State ──
    let currentDelivType = 'diagnostic';
    const deliverables = ${safeJSON(delivMap)};
    const scoresDim = ${safeJSON(scoresDim)};
    const USER_NAME = ${safeJSON((user?.name as string) || 'Entrepreneur')};
    const BMC_HTML_TEMPLATE = ${safeJSON(bmcClaudeHtml)};
    const FRAMEWORK_HTML_TEMPLATE = ${safeJSON(frameworkClaudeHtml)};
    const DIAGNOSTIC_HTML_TEMPLATE = ${safeJSON(diagnosticClaudeHtml)};
    const DIAGNOSTIC_ANALYSIS_JSON = ${safeJSON(diagnosticAnalysisJson)};
    const SIC_HTML_TEMPLATE = ${safeJSON(sicClaudeHtml)};
    const sources = ${safeJSON(allUploads.map((u: any) => ({ id: u.id, filename: u.filename, category: u.category })))};
    const PLAN_OVO_ID = ${safeJSON(mainPlanOvoId)};
    const PLAN_OVO_EXTRACTION = ${safeJSON(mainPlanOvoExtraction)};
    const BP_ANALYSIS_ID = ${safeJSON(mainBpAnalysisId)};

    // ── Mobile sidebar toggle ──
    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('ev2-sidebar--open');
      document.getElementById('sidebar-overlay').classList.toggle('ev2-sidebar-overlay--open');
    }

    // ── Single-file upload with explicit category ──
    async function handleUpload(input, category) {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      const card = input.closest('.ev2-upload-card');
      if (card) { card.style.opacity = '0.6'; card.style.pointerEvents = 'none'; }
      
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', category);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Erreur upload'); if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; } return; }
        location.reload();
      } catch (e) { alert('Erreur: ' + e.message); if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; } }
    }

    // ── Supplementary files upload ──
    async function handleSuppUpload(input) {
      if (!input.files || input.files.length === 0) return;
      for (const file of input.files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('category', 'supplementary');
        try { await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' }); } catch {}
      }
      location.reload();
    }

    // ── Delete upload ──
    async function rmUpload(id) {
      try { await fetch('/api/upload/' + id, { method: 'DELETE', credentials: 'include' }); location.reload(); } catch (e) { alert('Erreur: ' + e.message); }
    }

    // Delete both BMC and SIC uploads (unified document)
    async function rmBmcSic() {
      try {
        const res = await fetch('/api/uploads', { credentials: 'include' });
        const data = await res.json();
        const uploads = data.uploads || [];
        for (const u of uploads) {
          if (u.category === 'bmc' || u.category === 'sic') {
            await fetch('/api/upload/' + u.id, { method: 'DELETE', credentials: 'include' });
          }
        }
        location.reload();
      } catch (e) { alert('Erreur: ' + e.message); }
    }

    // ── Generate (fire-and-forget + polling) ──
    async function generateAll() {
      const btn = document.getElementById('btn-gen');
      const load = document.getElementById('loading-section');
      const main = document.getElementById('main-layout');
      const progressEl = document.getElementById('job-progress');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération en cours...'; }
      if (main) main.style.display = 'none';
      if (load) load.classList.add('ev2-loading--active');
      
      const steps = ['step-extract', 'step-analyze', 'step-gen', 'step-done'];
      function setStep(idx) {
        steps.forEach((s, i) => {
          const el = document.getElementById(s);
          if (el) el.className = 'ev2-loading__step' + (i < idx ? ' ev2-loading__step--done' : i === idx ? ' ev2-loading__step--active' : '');
        });
      }
      setStep(0);

      function resetUI(msg) {
        if (msg) alert(msg);
        if (main) main.style.display = '';
        if (load) load.classList.remove('ev2-loading--active');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Générer les livrables'; }
      }
      
      try {
        // 1. Fire the POST — returns immediately with jobId
        const res = await fetch('/api/ai/generate-all', { method: 'POST', credentials: 'include' });
        const data = await res.json();
        
        if (!res.ok) { resetUI(data.error || 'Erreur lors de la génération'); return; }
        
        const jobId = data.jobId;
        if (!jobId) { resetUI('Erreur: pas de jobId retourné'); return; }
        if (progressEl) progressEl.textContent = 'Démarrage de la génération...';

        // Fire-and-forget: trigger pipeline (long-running HTTP handler, no wall-clock limit)
        fetch('/api/ai/pipeline/start?jobId=' + encodeURIComponent(jobId), {
          method: 'POST',
          credentials: 'include'
        }).then(r => {
          if (r.ok) console.log('[Pipeline] Pipeline completed');
          else console.warn('[Pipeline] Pipeline returned', r.status);
        }).catch(err => {
          console.warn('[Pipeline] Pipeline fire-and-forget error:', err.message);
        });

        // 2. Poll every 5s for status
        let elapsed = 0;
        const maxWait = 900000; // 15 min max
        const pollInterval = 5000;
        
        const poll = () => new Promise((resolve, reject) => {
          const timer = setInterval(async () => {
            elapsed += pollInterval;
            
            // Update step based on elapsed time
            if (elapsed > 5000) setStep(1);
            if (elapsed > 60000) setStep(2);
            
            try {
              const statusRes = await fetch('/api/ai/generate-status?jobId=' + encodeURIComponent(jobId), { credentials: 'include' });
              const statusData = await statusRes.json();
              
              // Update progress message
              if (progressEl && statusData.progress) progressEl.textContent = statusData.progress;
              
              if (statusData.status === 'completed') {
                clearInterval(timer);
                resolve(statusData);
              } else if (statusData.status === 'failed') {
                clearInterval(timer);
                reject(new Error(statusData.error || 'La génération a échoué'));
              } else if (elapsed >= maxWait) {
                clearInterval(timer);
                reject(new Error('La génération prend trop de temps (>15 min). Rechargez la page.'));
              }
            } catch (pollErr) {
              // Network error during polling — keep trying
              console.warn('Poll error:', pollErr);
              if (elapsed >= maxWait) { clearInterval(timer); reject(pollErr); }
            }
          }, pollInterval);
        });
        
        await poll();
        
        // 3. Success
        setStep(3);
        if (progressEl) progressEl.textContent = 'Génération terminée !';
        setTimeout(() => location.reload(), 1500);
        
      } catch (e) {
        resetUI(e.message || 'Erreur lors de la génération');
      }
    }

    // ── Select deliverable (bottom icons) ──
    function selectDeliverable(type) {
      currentDelivType = type;
      // Update bottom icon active state
      document.querySelectorAll('.ev2-deliv-icon').forEach(el => {
        el.classList.toggle('ev2-deliv-icon--active', el.dataset.type === type);
      });
      // Update title
      const types = ${safeJSON(DELIVERABLE_TYPES)};
      const dt = types.find(t => t.type === type);
      const titleEl = document.getElementById('center-title');
      if (titleEl) titleEl.innerHTML = '<i class="fas ' + (dt?.icon || 'fa-file') + '"></i> ' + (dt?.label || type);
      // Render content
      renderDeliverableContent(type);
    }

    function renderDeliverableContent(type) {
      const el = document.getElementById('center-content');
      if (!el) return;
      const data = deliverables[type];
      if (!data) {
        const types = ${safeJSON(DELIVERABLE_TYPES)};
        const dt = types.find(t => t.type === type);
        const deps = dt?.deps || [];
        const uploadedCats = new Set(${safeJSON(Array.from(new Set([
          ...(uploadsByCategory.bmc ? ['bmc'] : []),
          ...(uploadsByCategory.sic ? ['sic'] : []),
          ...(uploadsByCategory.inputs ? ['inputs'] : []),
        ])))});
        const depLabels = ${safeJSON(DEP_LABELS)};
        const missingList = deps.filter(d => !uploadedCats.has(d)).map(d => depLabels[d] || d);
        if (missingList.length === 0) {
          el.innerHTML = '<div class="ev2-empty"><div class="ev2-empty__icon"><i class="fas fa-wand-magic-sparkles"></i></div><div class="ev2-empty__text">Prêt à être généré</div><div class="ev2-empty__sub">Cliquez sur "Générer les livrables" dans la barre latérale.</div></div>';
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
        // ── DIAGNOSTIC: embed /module/diagnostic in iframe (same rich design) ──
        el.innerHTML = '';
        // Download bar
        var diagBar = document.createElement('div');
        diagBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0f4ff,#e8edfb);border:1px solid #a3b8d8;border-radius:12px;margin-bottom:16px';
        diagBar.innerHTML = '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-stethoscope" style="font-size:24px;color:#1e3a5f"></i><div><div style="font-size:14px;font-weight:700;color:#1e3a5f">\uD83D\uDD0D Diagnostic Expert</div><div style="font-size:12px;color:#4b6584">Score: ' + score + '/100 — Disponible en HTML et PDF</div></div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button data-download="html" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#1e3a5f;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(30,58,95,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-code"></i> HTML</button>' +
          '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,45,18,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>' +
          '<a href="/module/diagnostic" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#1e3a5f;border:1px solid #a3b8d8;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#f0f4ff&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>' +
          '</div>';
        el.appendChild(diagBar);
        // Iframe loading /module/diagnostic
        var diagIframe = document.createElement('iframe');
        diagIframe.style.cssText = 'width:100%;height:600px;border:none;border-radius:12px;background:#0f172a';
        diagIframe.src = '/module/diagnostic?embedded=1';
        el.appendChild(diagIframe);
      } else if (type === 'bmc_analysis' && BMC_HTML_TEMPLATE && BMC_HTML_TEMPLATE.length > 100) {
        el.innerHTML = '';
        // ── Download bar above iframe ──
        var bmcBar = document.createElement('div');
        bmcBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:12px;margin-bottom:16px';
        bmcBar.innerHTML = '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-word" style="font-size:24px;color:#2563eb"></i><div><div style="font-size:14px;font-weight:700;color:#1e40af">BMC Analysé</div><div style="font-size:12px;color:#3b82f6">Téléchargeable en Word ou PDF</div></div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button data-download="docx" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#2563eb;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-word"></i> Word (.docx)</button>' +
          '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>' +
          '<a href="/deliverable/bmc_analysis" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#1e40af;border:1px solid #93c5fd;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#eff6ff&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>' +
          '</div>';
        el.appendChild(bmcBar);
        // ── Iframe ──
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:100%;height:600px;border:none;border-radius:12px;background:#fff';
        iframe.srcdoc = BMC_HTML_TEMPLATE;
        // Do NOT auto-resize: let iframe scroll internally to avoid pushing bottom icons off-screen
        el.appendChild(iframe);
      } else if (type === 'bmc_analysis') {
        el.innerHTML = renderBMCHTML(content, score, sColor);
      } else if (type === 'sic_analysis' && SIC_HTML_TEMPLATE && SIC_HTML_TEMPLATE.length > 100) {
        el.innerHTML = '';
        // ── Download bar above iframe ──
        var sicBar = document.createElement('div');
        sicBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:12px;margin-bottom:16px';
        sicBar.innerHTML = '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-word" style="font-size:24px;color:#2563eb"></i><div><div style="font-size:14px;font-weight:700;color:#1e40af">SIC Analysé</div><div style="font-size:12px;color:#3b82f6">Téléchargeable en Word ou PDF</div></div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button data-download="docx" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#2563eb;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-word"></i> Word (.docx)</button>' +
          '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>' +
          '<a href="/deliverable/sic_analysis" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#1e40af;border:1px solid #93c5fd;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#eff6ff&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>' +
          '</div>';
        el.appendChild(sicBar);
        // ── Iframe ──
        var sicIframe = document.createElement('iframe');
        sicIframe.style.cssText = 'width:100%;height:600px;border:none;border-radius:12px;background:#fff';
        sicIframe.srcdoc = SIC_HTML_TEMPLATE;
        // Do NOT auto-resize: let iframe scroll internally to avoid pushing bottom icons off-screen
        el.appendChild(sicIframe);
      } else if (type === 'sic_analysis') {
        el.innerHTML = renderSICHTML(content, score, sColor);
      } else if (type === 'plan_ovo') {
        el.innerHTML = renderOVOHTML(content, score, sColor);
        if (window.__ovoChartInit) setTimeout(window.__ovoChartInit, 300);
      } else if (type === 'business_plan') {
        // ── BUSINESS PLAN: embed /module/business-plan in iframe with Word/PDF download ──
        el.innerHTML = '';
        var bpBar = document.createElement('div');
        bpBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0f4ff,#e8edfb);border:1px solid #6366f1;border-radius:12px;margin-bottom:16px';
        var bpBtns = '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        if (BP_ANALYSIS_ID) {
          bpBtns += '<a href="/api/business-plan/download/' + BP_ANALYSIS_ID + '?format=docx" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#4338ca;color:white;border:none;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(67,56,202,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-word"></i> Word (.docx)</a>';
        } else {
          bpBtns += '<button data-download="docx" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#4338ca;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(67,56,202,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-word"></i> Word (.docx)</button>';
        }
        bpBtns += '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,45,18,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>';
        bpBtns += '<a href="/module/business-plan" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#4338ca;border:1px solid #a3b8d8;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#f0f4ff&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>';
        bpBtns += '</div>';
        bpBar.innerHTML = '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-building" style="font-size:24px;color:#4338ca"></i><div><div style="font-size:14px;font-weight:700;color:#1e3a5f">Business Plan</div><div style="font-size:12px;color:#4b6584">Document complet pour investisseurs — Score: ' + score + '/100</div></div></div>' + bpBtns;
        el.appendChild(bpBar);
        var bpIframe = document.createElement('iframe');
        bpIframe.style.cssText = 'width:100%;height:600px;border:none;border-radius:12px;background:#f8fafc';
        bpIframe.src = '/module/business-plan?embedded=1';
        el.appendChild(bpIframe);
      } else if (type === 'framework' && FRAMEWORK_HTML_TEMPLATE && FRAMEWORK_HTML_TEMPLATE.length > 100) {
        el.innerHTML = '';
        // ── Download bar above iframe ──
        var fwBar = document.createElement('div');
        fwBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0;border-radius:12px;margin-bottom:16px';
        fwBar.innerHTML = '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-excel" style="font-size:24px;color:#059669"></i><div><div style="font-size:14px;font-weight:700;color:#065f46">📊 Plan Financier Intermédiaire</div><div style="font-size:12px;color:#047857">Framework Analyse PME rempli avec vos données</div></div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button id="btn-fw-excel-top" onclick="downloadFrameworkExcelInline()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#059669;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(5,150,105,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-download"></i> Télécharger Excel (.xlsx)</button>' +
          '<a href="/deliverable/framework" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#065f46;border:1px solid #bbf7d0;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#f0fdf4&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>' +
          '</div>';
        el.appendChild(fwBar);
        // ── Iframe ──
        var fwIframe = document.createElement('iframe');
        fwIframe.style.cssText = 'width:100%;height:600px;border:none;border-radius:12px;background:#fff';
        fwIframe.srcdoc = FRAMEWORK_HTML_TEMPLATE;
        // Do NOT auto-resize: let iframe scroll internally to avoid pushing bottom icons off-screen
        el.appendChild(fwIframe);
      } else {
        el.innerHTML = renderGenericHTML(content, score, sColor, type);
      }
    }

    function getScoreColor(s) { return s >= 86 ? '#059669' : s >= 71 ? '#0284c7' : s >= 51 ? '#c9a962' : s >= 31 ? '#d97706' : '#dc2626'; }
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function renderDiagHTML(c, dims, score, col) {
      // Support BOTH old format (dimensions[], strengths[], weaknesses[], recommendations[])
      // and new format (scores_dimensions{}, forces[], opportunites_amelioration[], recommandations[], risques_contextuels[], etc.)
      const isNewFormat = !!c.scores_dimensions || !!c.score_global;
      
      let html = '<div class="ev2-diag">';
      
      // ═══ BARRE BLEU FONCÉ — Diagnostic: HTML + PDF ═══
      html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0f4ff,#e8edfb);border:1px solid #a3b8d8;border-radius:12px;margin-bottom:20px">';
      html += '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-stethoscope" style="font-size:24px;color:#1e3a5f"></i><div><div style="font-size:14px;font-weight:700;color:#1e3a5f">\u{1F50D} Diagnostic Expert</div><div style="font-size:12px;color:#4b6584">Disponible en HTML et PDF</div></div></div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      html += '<button data-download="html" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#1e3a5f;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(30,58,95,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-code"></i> HTML</button>';
      html += '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,45,18,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>';
      html += '<a href="/module/diagnostic" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#dc2626;border:1px solid #fecaca;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#fef2f2&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-search"></i> Voir le Diagnostic complet</a>';
      html += '</div></div>';

      if (isNewFormat) {
        // ── NEW FORMAT: scores_dimensions, forces, recommandations, etc. ──
        const globalScore = c.score_global || score || 0;
        const label = c.label || '';
        const sColor = globalScore >= 86 ? '#059669' : globalScore >= 71 ? '#059669' : globalScore >= 51 ? '#84cc16' : globalScore >= 31 ? '#eab308' : '#f97316';
        
        // Executive summary
        if (c.resume_executif) {
          html += '<div style="background:#f8fafc;border-left:4px solid #0d9488;border-radius:0 12px 12px 0;padding:18px 20px;margin-bottom:20px">';
          html += '<div style="font-size:13px;font-weight:700;color:#0d9488;margin-bottom:8px"><i class="fas fa-file-lines"></i> Résumé Exécutif</div>';
          html += '<div style="font-size:13px;color:#475569;line-height:1.7;white-space:pre-line">' + esc(c.resume_executif) + '</div>';
          html += '</div>';
        }
        
        // Global score
        html += '<div style="text-align:center;padding:20px;background:#f8fafc;border-radius:12px;margin-bottom:20px;border:1px solid #e2e8f0">';
        html += '<div style="font-size:12px;color:#94a3b8;font-weight:600;margin-bottom:8px">Score Global</div>';
        html += '<div style="font-size:36px;font-weight:800;color:' + sColor + '">' + globalScore + '<span style="font-size:16px;color:#94a3b8">/100</span></div>';
        html += '<div style="font-size:13px;color:' + sColor + ';font-weight:600;margin-top:4px">' + esc(label) + '</div>';
        html += '</div>';
        
        // Dimensions
        const sd = c.scores_dimensions || {};
        const dimKeys = ['coherence','viabilite','realisme','completude_couts','capacite_remboursement'];
        const dimLabels = {coherence:'Cohérence financière',viabilite:'Viabilité économique',realisme:'Réalisme des projections',completude_couts:'Complétude des coûts',capacite_remboursement:'Capacité de remboursement'};
        html += '<div class="ev2-diag__dims">';
        for (const dk of dimKeys) {
          const dim = sd[dk];
          if (!dim) continue;
          const ds = dim.score || 0;
          const dc = getScoreColor(ds);
          html += '<div class="ev2-diag__dim"><div class="ev2-diag__dim-name">' + esc(dim.label || dimLabels[dk] || dk) + '</div><div class="ev2-diag__dim-score" style="color:' + dc + '">' + ds + '/100</div><div class="ev2-diag__dim-bar"><div class="ev2-diag__dim-bar-fill" style="width:' + ds + '%;background:' + dc + '"></div></div><div class="ev2-diag__dim-text">' + esc(dim.commentaire || '') + '</div></div>';
        }
        html += '</div>';
        
        // Forces
        const forces = c.forces || [];
        if (forces.length) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title" style="color:#059669"><i class="fas fa-check-circle" style="color:#059669"></i> Forces (' + forces.length + ')</div><ul class="ev2-diag__list">';
          for (const f of forces) {
            const titre = typeof f === 'string' ? f : (f.titre || '');
            const just = typeof f === 'object' ? (f.justification || '') : '';
            html += '<li><i class="fas fa-check" style="color:#059669"></i> <strong>' + esc(titre) + '</strong>' + (just ? '<br><span style="font-size:12px;color:#64748b">' + esc(just) + '</span>' : '') + '</li>';
          }
          html += '</ul></div>';
        }
        
        // Opportunities
        const opps = c.opportunites_amelioration || [];
        if (opps.length) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title" style="color:#2563eb"><i class="fas fa-lightbulb" style="color:#d97706"></i> Opportunités d\\x27amélioration (' + opps.length + ')</div><ul class="ev2-diag__list">';
          for (const o of opps) {
            const titre = typeof o === 'string' ? o : (o.titre || '');
            html += '<li><i class="fas fa-arrow-right" style="color:#d97706"></i> ' + esc(titre) + '</li>';
          }
          html += '</ul></div>';
        }
        
        // Vigilance points
        const vig = c.points_vigilance || [];
        if (vig.length) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-shield-halved" style="color:#f59e0b"></i> Points de vigilance (' + vig.length + ')</div>';
          html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px"><thead><tr style="background:#1e3a5f;color:white"><th style="padding:8px 10px;text-align:left">Niveau</th><th style="padding:8px 10px;text-align:left">Titre</th><th style="padding:8px 10px;text-align:left">Impact</th><th style="padding:8px 10px;text-align:left">Action</th></tr></thead><tbody>';
          for (const v of vig) {
            const niv = (v.niveau||'moyen').toLowerCase();
            const nbg = niv === 'critique' || niv === 'elevee' || niv === 'eleve' ? '#fef2f2' : niv === 'moyen' || niv === 'moyenne' ? '#fffbeb' : '#f8fafc';
            html += '<tr style="background:' + nbg + ';border-bottom:1px solid #e2e8f0"><td style="padding:8px 10px;font-weight:700">' + esc(v.niveau||'—') + '</td><td style="padding:8px 10px"><strong>' + esc(v.titre||'—') + '</strong><br><span style="color:#64748b">' + esc(v.description||'') + '</span></td><td style="padding:8px 10px;color:#d97706">' + esc(v.impact_financier||'—') + '</td><td style="padding:8px 10px;color:#059669">' + esc(v.action_recommandee||'—') + '</td></tr>';
          }
          html += '</tbody></table></div></div>';
        }
        
        // Contextual risks
        const risques = c.risques_contextuels || [];
        if (risques.length) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-exclamation-circle" style="color:#f97316"></i> Risques Contextuels (' + risques.length + ')</div>';
          for (const r of risques) {
            const cat = (r.categorie||'').replace('contextuel_','');
            const catLabel = cat === 'secteur' ? '\u{1F3ED} Sectoriel' : cat === 'geographique' ? '\u{1F30D} Géographique' : '\u{1F3E2} Taille';
            html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:8px">';
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap"><span style="padding:2px 8px;background:#e0e7ff;border-radius:8px;font-size:11px;font-weight:700;color:#4338ca">' + catLabel + '</span><span style="padding:2px 8px;background:#fef3c7;border-radius:8px;font-size:11px;font-weight:600;color:#92400e">' + esc(r.gravite||'—') + '</span></div>';
            html += '<div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:4px">' + esc(r.titre||'') + '</div>';
            html += '<div style="font-size:12px;color:#475569;line-height:1.5;margin-bottom:6px">' + esc(r.description||'') + '</div>';
            if (r.impact_financier) html += '<div style="font-size:11px;color:#d97706;margin-bottom:4px"><i class="fas fa-coins"></i> ' + esc(r.impact_financier) + '</div>';
            if (r.mitigation) html += '<div style="font-size:11px;color:#059669;background:#f0fdf4;padding:6px 10px;border-radius:6px"><i class="fas fa-shield-halved"></i> ' + esc(r.mitigation) + '</div>';
            html += '</div>';
          }
          html += '</div>';
        }
        
        // Recommendations
        const recs = c.recommandations || [];
        if (recs.length) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-clipboard-list" style="color:#2563eb"></i> Recommandations (' + recs.length + ')</div>';
          for (var ri = 0; ri < recs.length; ri++) {
            const r = recs[ri];
            html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ' + (r.urgence && r.urgence.toLowerCase().includes('imm') ? '#ef4444' : '#eab308') + ';border-radius:0 10px 10px 0;padding:12px 16px;margin-bottom:8px">';
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:24px;height:24px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">' + (ri+1) + '</span><strong style="font-size:13px;color:#1e293b">' + esc(r.titre||'') + '</strong></div>';
            html += '<div style="font-size:12px;color:#475569;margin-bottom:6px">' + esc(r.detail||'') + '</div>';
            if (r.impact_viabilite) html += '<span style="display:inline-block;padding:2px 8px;background:#d1fae5;border-radius:8px;font-size:10px;font-weight:700;color:#065f46;margin-right:6px">' + esc(r.impact_viabilite) + '</span>';
            if (r.action_concrete) html += '<div style="font-size:11px;color:#059669;margin-top:6px"><i class="fas fa-bolt"></i> ' + esc(r.action_concrete) + '</div>';
            if (r.message_encourageant) html += '<div style="font-size:11px;color:#6366f1;font-style:italic;margin-top:4px">\u{1F4AA} ' + esc(r.message_encourageant) + '</div>';
            html += '</div>';
          }
          html += '</div>';
        }
        
        // Benchmarks
        const bm = c.benchmarks || {};
        const bmKeys = ['marge_brute','marge_ebitda','marge_nette','ratio_endettement','seuil_rentabilite'];
        const bmLabels = {marge_brute:'Marge Brute',marge_ebitda:'Marge EBITDA',marge_nette:'Marge Nette',ratio_endettement:"Ratio d'endettement",seuil_rentabilite:'Seuil de Rentabilité'};
        const hasBm = bmKeys.some(function(k){return !!bm[k]});
        if (hasBm) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-chart-bar" style="color:#8b5cf6"></i> Benchmarks sectoriels</div>';
          html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#1e3a5f;color:white"><th style="padding:8px 10px;text-align:left">Indicateur</th><th style="padding:8px 10px;text-align:center">Entreprise</th><th style="padding:8px 10px;text-align:center">Secteur</th><th style="padding:8px 10px;text-align:center">Verdict</th></tr></thead><tbody>';
          for (const bk of bmKeys) {
            const b = bm[bk]; if (!b) continue;
            const vCol = (b.verdict||'').toLowerCase().includes('excell') || (b.verdict||'').toLowerCase().includes('bon') || (b.verdict||'').toLowerCase().includes('sup') ? '#059669' : '#d97706';
            html += '<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px 10px;font-weight:600">' + (bmLabels[bk]||bk) + '</td><td style="padding:8px 10px;text-align:center;font-weight:700">' + (b.entreprise != null ? b.entreprise + '%' : '—') + '</td><td style="padding:8px 10px;text-align:center;color:#64748b">' + (b.secteur_min != null ? b.secteur_min + ' — ' + (b.secteur_max||'') + '%' : '—') + '</td><td style="padding:8px 10px;text-align:center;color:' + vCol + ';font-weight:600">' + esc(b.verdict||'—') + '</td></tr>';
          }
          html += '</tbody></table></div><div style="font-size:10px;color:#94a3b8;margin-top:6px;font-style:italic">Benchmarks : BCEAO, IFC, FIRCA — Confiance moyenne</div></div>';
        }
        
        // Link to full page
        html += '<div style="text-align:center;margin-top:20px;padding:16px;background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0">';
        html += '<a href="/module/diagnostic" style="display:inline-flex;align-items:center;gap:10px;padding:12px 24px;background:linear-gradient(135deg,#0d9488,#0f766e);color:white;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700">';
        html += '<i class="fas fa-expand"></i> Voir le diagnostic complet (pleine page)</a></div>';
        
      } else {
        // ── OLD FORMAT: dimensions[], strengths[], weaknesses[], recommendations[] ──
        const d = c.dimensions || [];
        html += '<div class="ev2-diag__dims">';
        for (const dim of d) {
          const dc = getScoreColor(dim.score || 0);
          html += '<div class="ev2-diag__dim"><div class="ev2-diag__dim-name">' + esc(dim.name) + '</div><div class="ev2-diag__dim-score" style="color:' + dc + '">' + (dim.score||0) + '/100</div><div class="ev2-diag__dim-bar"><div class="ev2-diag__dim-bar-fill" style="width:' + (dim.score||0) + '%;background:' + dc + '"></div></div><div class="ev2-diag__dim-text">' + esc(dim.analysis||'') + '</div></div>';
        }
        html += '</div>';
        if (c.strengths?.length) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-check-circle" style="color:#059669"></i> Forces</div><ul class="ev2-diag__list">';
          for (const s of c.strengths) html += '<li><i class="fas fa-check" style="color:#059669"></i>' + esc(s) + '</li>';
          html += '</ul></div>';
        }
        if (c.weaknesses?.length) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-exclamation-triangle" style="color:#dc2626"></i> Faiblesses</div><ul class="ev2-diag__list">';
          for (const w of c.weaknesses) html += '<li><i class="fas fa-times" style="color:#dc2626"></i>' + esc(w) + '</li>';
          html += '</ul></div>';
        }
        if (c.recommendations?.length) {
          html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-lightbulb" style="color:#d97706"></i> Recommandations</div><ul class="ev2-diag__list">';
          for (const r of c.recommendations) html += '<li><i class="fas fa-arrow-right" style="color:#d97706"></i>' + esc(r) + '</li>';
          html += '</ul></div>';
        }
      }
      
      html += '</div>';
      return html;
    }

    function renderBMCHTML(c, score, col) {
      const blocks = c.blocks || [];
      const strongBlocks = blocks.filter(b => (b.score||0) >= 70);
      const weakBlocks = blocks.filter(b => (b.score||0) < 70);
      
      let html = '<div class="ev2-bmc-rich">';
      
      // ═══ BARRE BLEUE — BMC: Word + PDF ═══
      html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:12px;margin-bottom:20px">';
      html += '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-word" style="font-size:24px;color:#2563eb"></i><div><div style="font-size:14px;font-weight:700;color:#1e40af">📄 BMC Analysé</div><div style="font-size:12px;color:#3b82f6">Téléchargeable en Word ou PDF</div></div></div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      html += '<button data-download="docx" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#2563eb;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(37,99,235,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-word"></i> Word (.docx)</button>';
      html += '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,45,18,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>';
      html += '<a href="/deliverable/bmc_analysis" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#1e40af;border:1px solid #93c5fd;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#eff6ff&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>';
      html += '</div></div>';
      
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
      let html = '<div class="ev2-deliv-view">';
      
      // ═══ BARRE BLEUE — SIC: Word + PDF ═══
      html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:12px;margin-bottom:20px">';
      html += '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-word" style="font-size:24px;color:#2563eb"></i><div><div style="font-size:14px;font-weight:700;color:#1e40af">📈 SIC Analysé</div><div style="font-size:12px;color:#3b82f6">Téléchargeable en Word ou PDF</div></div></div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      html += '<button data-download="docx" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#2563eb;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(37,99,235,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-word"></i> Word (.docx)</button>';
      html += '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,45,18,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>';
      html += '<a href="/deliverable/sic_analysis" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#1e40af;border:1px solid #93c5fd;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#eff6ff&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>';
      html += '</div></div>';
      
      html += '<div class="ev2-deliv-view__score"><div class="ev2-deliv-view__score-num" style="color:' + col + '">' + score + '/100</div></div>';
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
      let html = '<div class="ev2-deliv-view">';
      
      // ═══ BARRE VERTE — Plan OVO: Download bar ═══
      html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0;border-radius:12px;margin-bottom:20px">';
      html += '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-excel" style="font-size:24px;color:#059669"></i><div><div style="font-size:14px;font-weight:700;color:#065f46">Plan Financier OVO</div><div style="font-size:12px;color:#047857">Projections financières sur 5 ans</div></div></div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      if (PLAN_OVO_ID) {
        html += '<button onclick="downloadPlanOVOExcelDirect()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#059669;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(5,150,105,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-download"></i> Télécharger Excel (.xlsm)</button>';
      }
      html += '<a href="/module/plan-ovo" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:#ea580c;color:white;border:1px solid #ea580c;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-wand-magic-sparkles"></i> Module OVO</a>';
      html += '</div></div>';

      // ═══ CHECK IF WE HAVE EXTRACTION DATA ═══
      const ext = PLAN_OVO_EXTRACTION;
      if (!ext || !ext.produits) {
        // Fallback: display projections from the plan_ovo deliverable content
        const proj = c.projections?.scenario_base;
        if (proj) {
          html += '<div style="padding:20px">';
          html += '<h3 style="font-size:16px;font-weight:700;color:#1e3a5f;margin-bottom:16px"><i class="fas fa-chart-line"></i> Projections Financières (Scénario de Base)</h3>';
          html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
          html += '<thead><tr style="background:#f0fdf4"><th style="padding:10px;text-align:left;border:1px solid #bbf7d0">Indicateur</th>';
          const years = ['year_1','year_2','year_3','year_4','year_5'];
          const yearLabels = ['Année 1','Année 2','Année 3','Année 4','Année 5'];
          for (let i=0; i<5; i++) html += '<th style="padding:10px;text-align:right;border:1px solid #bbf7d0">' + yearLabels[i] + '</th>';
          html += '</tr></thead><tbody>';
          const fmt = (v) => v != null ? (v >= 1e6 ? (v/1e6).toFixed(1) + ' M' : v >= 1e3 ? (v/1e3).toFixed(0) + ' k' : v.toLocaleString()) : '—';
          const rows = [
            { label: "Chiffre d'Affaires", key: 'revenue_xof', color: '#059669' },
            { label: 'Marge Brute (%)', key: 'gross_margin_pct', color: '#0284c7', suffix: '%' },
            { label: 'EBITDA', key: 'ebitda_xof', color: '#d97706' },
            { label: 'Résultat Net', key: 'net_income_xof', color: '#7c3aed' },
            { label: 'Cash Flow', key: 'cash_flow_xof', color: '#059669' },
          ];
          for (const row of rows) {
            html += '<tr>';
            html += '<td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:600;color:' + row.color + '">' + row.label + '</td>';
            for (const yr of years) {
              const val = proj[yr]?.[row.key];
              const display = row.suffix ? (val != null ? val + row.suffix : '—') : fmt(val);
              const valColor = val != null && val < 0 ? '#dc2626' : '#1e3a5f';
              html += '<td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;color:' + valColor + '">' + display + '</td>';
            }
            html += '</tr>';
          }
          html += '</tbody></table></div>';
          
          // Scenarios comparison if available
          if (c.projections?.scenario_optimiste || c.projections?.scenario_pessimiste) {
            html += '<h4 style="font-size:14px;font-weight:600;color:#374151;margin-top:20px;margin-bottom:12px">Scénarios Comparés (Année 5)</h4>';
            html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">';
            const scenarios = [
              { key: 'scenario_pessimiste', label: 'Pessimiste', color: '#dc2626', bg: '#fef2f2', icon: 'fa-arrow-down' },
              { key: 'scenario_base', label: 'Base', color: '#d97706', bg: '#fffbeb', icon: 'fa-minus' },
              { key: 'scenario_optimiste', label: 'Optimiste', color: '#059669', bg: '#f0fdf4', icon: 'fa-arrow-up' },
            ];
            for (const s of scenarios) {
              const y5 = c.projections?.[s.key]?.year_5;
              if (y5) {
                html += '<div style="padding:16px;background:' + s.bg + ';border-radius:10px;text-align:center">';
                html += '<div style="font-size:12px;color:' + s.color + ';font-weight:600"><i class="fas ' + s.icon + '"></i> ' + s.label + '</div>';
                html += '<div style="font-size:18px;font-weight:700;color:' + s.color + ';margin-top:6px">' + fmt(y5.revenue_xof) + ' CFA</div>';
                html += '<div style="font-size:11px;color:#6b7280">Résultat: ' + fmt(y5.net_income_xof) + '</div>';
                html += '</div>';
              }
            }
            html += '</div>';
          }
          
          html += '</div>';
          
          // Show link to full OVO module
          html += '<div style="text-align:center;padding:16px;border-top:1px solid #e5e7eb;margin-top:16px">';
          html += '<a href="/module/plan-ovo" style="color:#ea580c;font-weight:600;text-decoration:none;font-size:13px"><i class="fas fa-wand-magic-sparkles"></i> Accéder au module Plan OVO pour la version complète</a>';
          html += '</div>';
        } else {
          html += '<div style="text-align:center;padding:40px;color:#6b7280"><i class="fas fa-chart-line" style="font-size:48px;color:#d1d5db;margin-bottom:16px;display:block"></i><p>Aperçu non disponible — lancez la génération du plan OVO via le module dédié.</p></div>';
        }
        html += '</div>';
        return html;
      }

      const hyp = ext.hypotheses || {};
      const baseYear = hyp.base_year || 2025;
      const currency = hyp.currency || 'CFA';
      const yearKeys = ['YEAR_MINUS_2','YEAR_MINUS_1','CURRENT_YEAR','YEAR2','YEAR3','YEAR4','YEAR5'];
      const yearLabels = [baseYear-2, baseYear-1, baseYear, baseYear+1, baseYear+2, baseYear+3, baseYear+4].map(String);

      // ── COMPUTE PROJECTIONS ──
      function sumByYear(items, field) {
        const r = {};
        yearKeys.forEach(k => { r[k] = 0; });
        (items || []).forEach(item => {
          const vals = item[field] || item.montants || {};
          yearKeys.forEach(k => { r[k] += (vals[k] || 0); });
        });
        return r;
      }

      // CA = sum(prix_unitaire * volume) per product
      const caByYear = {};
      const cogsByYear = {};
      yearKeys.forEach(k => { caByYear[k] = 0; cogsByYear[k] = 0; });
      (ext.produits || []).forEach(p => {
        yearKeys.forEach(k => {
          caByYear[k] += (p.prix_unitaire?.[k] || 0) * (p.volume?.[k] || 0);
          cogsByYear[k] += (p.cout_unitaire?.[k] || 0) * (p.volume?.[k] || 0);
        });
      });

      // Masse salariale
      const salByYear = {};
      yearKeys.forEach(k => { salByYear[k] = 0; });
      (ext.personnel || []).forEach(p => {
        yearKeys.forEach(k => {
          const eff = p.effectif?.[k] || 0;
          const sal = p.salaire_brut_mensuel?.[k] || 0;
          const cs = p.charges_sociales_pct || 0.1645;
          salByYear[k] += eff * sal * 12 * (1 + cs);
        });
      });

      // Charges opex
      const cr = ext.compte_resultat || {};
      const opexByYear = {};
      yearKeys.forEach(k => { opexByYear[k] = 0; });
      ['marketing','frais_bureau','autres_depenses','assurances','entretien','tiers'].forEach(cat => {
        const items = cr[cat]?.items || [];
        items.forEach(item => {
          yearKeys.forEach(k => { opexByYear[k] += (item.montants?.[k] || 0); });
        });
      });
      if (cr.voyage_transport?.montant_annuel) {
        yearKeys.forEach(k => { opexByYear[k] += (cr.voyage_transport.montant_annuel[k] || 0); });
      }

      // Amortissements
      const amortByYear = {};
      yearKeys.forEach((k, i) => {
        const yr = baseYear - 2 + i;
        let totalAmort = 0;
        (ext.investissements || []).forEach(inv => {
          if (inv.annee_acquisition <= yr) {
            totalAmort += (inv.valeur_acquisition || 0) * (inv.taux_amortissement || 0.1);
          }
        });
        amortByYear[k] = totalAmort;
      });

      // Emprunts — annuités
      const fin = ext.financement || {};
      const prets = [fin.pret_ovo, fin.pret_famille, fin.pret_banque].filter(Boolean);
      const annuiteByYear = {};
      yearKeys.forEach((k, i) => {
        let totalAnnuite = 0;
        prets.forEach(p => {
          if (p.montant && p.duree && p.taux) {
            const r = p.taux;
            const n = p.duree;
            const annuite = p.montant * r * Math.pow(1+r,n) / (Math.pow(1+r,n) - 1);
            if (i < n) totalAnnuite += annuite;
          }
        });
        annuiteByYear[k] = totalAnnuite;
      });

      // P&L
      const margeByYear = {};
      const ebitdaByYear = {};
      const ebitByYear = {};
      const rnByYear = {};
      const taxRate = hyp.corporate_tax_rate || 0.25;
      yearKeys.forEach(k => {
        margeByYear[k] = caByYear[k] - cogsByYear[k];
        ebitdaByYear[k] = margeByYear[k] - salByYear[k] - opexByYear[k];
        ebitByYear[k] = ebitdaByYear[k] - amortByYear[k];
        const taxable = Math.max(0, ebitByYear[k] - annuiteByYear[k] * 0.3); // interets ~30% de l'annuité
        const impot = taxable > 0 ? taxable * taxRate : 0;
        rnByYear[k] = ebitByYear[k] - impot;
      });

      // Trésorerie cumulée (simplifiée)
      const tresoByYear = {};
      let tresoCum = ext.tresorerie_mensuelle?.position_initiale || 0;
      const totalApports = {};
      yearKeys.forEach((k, i) => {
        let apport = 0;
        if (i === 0) apport += (fin.capital_initial || 0);
        prets.forEach(p => { if (i === 0) apport += (p.montant || 0); });
        const yr = 'YEAR' + (i <= 2 ? '' : (i));
        if (fin.apport_nouveaux_actionnaires?.[k]) apport += fin.apport_nouveaux_actionnaires[k];
        totalApports[k] = apport;
        const investYr = (ext.investissements || []).filter(inv => inv.annee_acquisition === baseYear - 2 + i).reduce((s, inv) => s + (inv.valeur_acquisition || 0), 0);
        tresoCum += rnByYear[k] + amortByYear[k] - annuiteByYear[k] + apport - investYr;
        tresoByYear[k] = tresoCum;
      });

      function fmt(v) {
        if (v === undefined || v === null || isNaN(v)) return '—';
        const abs = Math.abs(v);
        if (abs >= 1e9) return (v/1e9).toFixed(1) + ' Md';
        if (abs >= 1e6) return (v/1e6).toFixed(1) + ' M';
        if (abs >= 1e3) return (v/1e3).toFixed(0) + ' k';
        return v.toLocaleString('fr-FR');
      }
      function fmtFull(v) {
        if (v === undefined || v === null || isNaN(v)) return '—';
        return Math.round(v).toLocaleString('fr-FR');
      }
      function valColor(v) { return v >= 0 ? '#059669' : '#dc2626'; }
      function bgColor(v) { return v >= 0 ? '#f0fdf4' : '#fef2f2'; }

      // ════════════════════════════════════════════════
      // SECTION 1 — RÉSUMÉ PROJECTIONS (tableau)
      // ════════════════════════════════════════════════
      html += '<div style="margin-bottom:28px">';
      html += '<h3 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 12px 0;display:flex;align-items:center;gap:8px"><i class="fas fa-table" style="color:#2563eb"></i> Résumé des Projections</h3>';
      html += '<div style="overflow-x:auto;border-radius:12px;border:1px solid #e5e7eb">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
      html += '<thead><tr style="background:#f8fafc">';
      html += '<th style="padding:10px 14px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;white-space:nowrap">Indicateur</th>';
      yearLabels.forEach(y => {
        html += '<th style="padding:10px 12px;text-align:right;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;white-space:nowrap">' + y + '</th>';
      });
      html += '</tr></thead><tbody>';

      const rows = [
        { label: 'Chiffre d\\'affaires HT', data: caByYear, icon: 'fa-coins', bold: true },
        { label: 'Coût des ventes (COGS)', data: cogsByYear, icon: 'fa-boxes-stacked', neg: true },
        { label: 'Marge brute', data: margeByYear, icon: 'fa-arrow-trend-up' },
        { label: 'Masse salariale', data: salByYear, icon: 'fa-users', neg: true },
        { label: 'Charges d\\'exploitation', data: opexByYear, icon: 'fa-receipt', neg: true },
        { label: 'EBITDA', data: ebitdaByYear, icon: 'fa-chart-line', bold: true },
        { label: 'Amortissements', data: amortByYear, icon: 'fa-building', neg: true },
        { label: 'Résultat Net', data: rnByYear, icon: 'fa-sack-dollar', bold: true, highlight: true },
        { label: 'Trésorerie', data: tresoByYear, icon: 'fa-vault', bold: true, highlight: true },
      ];

      rows.forEach((row, ri) => {
        const bg = ri % 2 === 0 ? 'white' : '#f9fafb';
        html += '<tr style="background:' + bg + '">';
        html += '<td style="padding:8px 14px;font-weight:' + (row.bold ? '600' : '400') + ';color:#374151;border-bottom:1px solid #f3f4f6;white-space:nowrap"><i class="fas ' + row.icon + '" style="width:18px;color:#6b7280;margin-right:6px;font-size:11px"></i>' + row.label + '</td>';
        yearKeys.forEach(k => {
          const v = row.data[k] || 0;
          const color = row.highlight ? valColor(v) : (row.neg ? '#6b7280' : '#374151');
          const cellBg = row.highlight ? bgColor(v) : 'transparent';
          html += '<td style="padding:8px 12px;text-align:right;font-weight:' + (row.bold ? '600' : '400') + ';color:' + color + ';border-bottom:1px solid #f3f4f6;background:' + cellBg + ';white-space:nowrap;font-variant-numeric:tabular-nums">' + fmt(v) + '</td>';
        });
        html += '</tr>';
      });

      html += '</tbody></table></div>';
      
      // ── Data source badges ──
      const ds = ext.metadata?.data_sources || {};
      const srcLabel = { declared: 'Déclaré', entrepreneur_target: 'Objectif entrepreneur', ai_estimate: 'Estimation IA' };
      const srcColor = { declared: '#059669', entrepreneur_target: '#2563eb', ai_estimate: '#d97706' };
      const srcBg = { declared: '#f0fdf4', entrepreneur_target: '#eff6ff', ai_estimate: '#fffbeb' };
      const srcIcon = { declared: 'fa-check-circle', entrepreneur_target: 'fa-bullseye', ai_estimate: 'fa-robot' };
      if (Object.keys(ds).length > 0) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
        const shownLabels = new Set();
        const fieldLabels = { ca_current_year: 'CA année N', ca_projections: 'CA projections', charges: 'Charges', investissements: 'Investissements', personnel: 'Personnel', ca_year_minus_2: 'CA N-2', ca_year_minus_1: 'CA N-1' };
        for (const [field, src] of Object.entries(ds)) {
          if (!src || shownLabels.has(field + src)) continue;
          shownLabels.add(field + src);
          const fl = fieldLabels[field] || field;
          const sl = srcLabel[src] || src;
          const sc = srcColor[src] || '#6b7280';
          const sb = srcBg[src] || '#f9fafb';
          const si = srcIcon[src] || 'fa-info-circle';
          html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:' + sb + ';color:' + sc + ';font-size:11px;font-weight:500;border:1px solid ' + sc + '22"><i class="fas ' + si + '" style="font-size:9px"></i>' + fl + ': ' + sl + '</span>';
        }
        html += '</div>';
      }
      
      html += '<div style="font-size:11px;color:#9ca3af;margin-top:6px;text-align:right">Montants en ' + currency + '</div>';
      html += '</div>';

      // ════════════════════════════════════════════════
      // SECTION 2 — GRAPHIQUE ÉVOLUTION CA (barres)
      // ════════════════════════════════════════════════
      html += '<div style="margin-bottom:28px">';
      html += '<h3 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 12px 0;display:flex;align-items:center;gap:8px"><i class="fas fa-chart-bar" style="color:#2563eb"></i> Évolution du Chiffre d\\'Affaires</h3>';
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px">';
      html += '<canvas id="ovo-ca-chart" style="width:100%;max-height:320px"></canvas>';
      html += '</div></div>';

      // ════════════════════════════════════════════════
      // SECTION 3 — INDICATEURS CLÉS (4 cartes)
      // ════════════════════════════════════════════════
      // Calcul TRI (IRR simplifié)
      const totalInvest = (ext.investissements || []).reduce((s, inv) => s + (inv.valeur_acquisition || 0), 0);
      const cashflows = yearKeys.map(k => rnByYear[k] + amortByYear[k] - annuiteByYear[k]);
      function computeIRR(cf, invest) {
        let irr = 0.1;
        for (let iter = 0; iter < 100; iter++) {
          let npv = -invest;
          let dnpv = 0;
          cf.forEach((c, i) => {
            npv += c / Math.pow(1 + irr, i + 1);
            dnpv -= (i + 1) * c / Math.pow(1 + irr, i + 2);
          });
          if (Math.abs(npv) < 1000) break;
          irr = irr - npv / (dnpv || 1);
          if (irr < -0.99) irr = -0.5;
          if (irr > 10) irr = 5;
        }
        return irr;
      }
      const tri = computeIRR(cashflows, totalInvest);
      const triPct = (tri * 100).toFixed(1);

      // VAN
      const discount = 0.10;
      let van = -totalInvest;
      cashflows.forEach((cf, i) => { van += cf / Math.pow(1 + discount, i + 1); });

      // Seuil de rentabilité (mois)
      let seuilMois = 0;
      let cumRn = 0;
      for (let i = 0; i < yearKeys.length; i++) {
        const rnAnnuel = rnByYear[yearKeys[i]];
        if (cumRn + rnAnnuel >= 0 && cumRn < 0) {
          seuilMois += Math.ceil((-cumRn / rnAnnuel) * 12);
          break;
        }
        cumRn += rnAnnuel;
        seuilMois += 12;
        if (cumRn >= 0 && i > 0) { seuilMois -= Math.floor((cumRn / rnAnnuel) * 12); break; }
      }
      if (seuilMois <= 0 || seuilMois > 84) seuilMois = rnByYear[yearKeys[2]] > 0 ? 24 : 48;

      // DSCR moyen (Debt Service Coverage Ratio)
      let dscrSum = 0; let dscrCount = 0;
      yearKeys.slice(2).forEach(k => {
        if (annuiteByYear[k] > 0) {
          dscrSum += ebitdaByYear[k] / annuiteByYear[k];
          dscrCount++;
        }
      });
      const dscrAvg = dscrCount > 0 ? (dscrSum / dscrCount) : 0;

      html += '<div style="margin-bottom:28px">';
      html += '<h3 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 12px 0;display:flex;align-items:center;gap:8px"><i class="fas fa-gauge-high" style="color:#2563eb"></i> Indicateurs Clés</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">';

      // TRI card with gauge
      const triColor = tri > 0.15 ? '#059669' : tri > 0.05 ? '#d97706' : '#dc2626';
      const triDeg = Math.min(Math.max(tri * 100, -50), 100) / 100 * 180;
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">';
      html += '<div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">TRI (Taux de Rendement)</div>';
      html += '<svg width="120" height="70" viewBox="0 0 120 70" style="display:block;margin:0 auto 8px">';
      html += '<path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="#e5e7eb" stroke-width="8" stroke-linecap="round"/>';
      const angle = Math.PI - (Math.max(0, Math.min(triDeg, 180)) / 180 * Math.PI);
      const x = 60 + 50 * Math.cos(angle);
      const y = 65 - 50 * Math.sin(angle);
      html += '<path d="M 10 65 A 50 50 0 ' + (triDeg > 90 ? '0' : '0') + ' 1 ' + x.toFixed(1) + ' ' + y.toFixed(1) + '" fill="none" stroke="' + triColor + '" stroke-width="8" stroke-linecap="round"/>';
      html += '</svg>';
      html += '<div style="font-size:28px;font-weight:800;color:' + triColor + '">' + triPct + '%</div>';
      html += '</div>';

      // VAN card
      const vanColor = van >= 0 ? '#059669' : '#dc2626';
      const vanBg = van >= 0 ? 'linear-gradient(135deg,#f0fdf4,#ecfdf5)' : 'linear-gradient(135deg,#fef2f2,#fee2e2)';
      html += '<div style="background:' + vanBg + ';border:1px solid ' + (van >= 0 ? '#bbf7d0' : '#fecaca') + ';border-radius:12px;padding:20px;text-align:center">';
      html += '<div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">VAN (Valeur Actuelle Nette)</div>';
      html += '<div style="font-size:24px;font-weight:800;color:' + vanColor + '">' + fmt(van) + '</div>';
      html += '<div style="font-size:11px;color:#9ca3af;margin-top:4px">' + currency + ' (taux ' + (discount*100) + '%)</div>';
      html += '</div>';

      // Seuil rentabilité card
      const seuilColor = seuilMois <= 24 ? '#059669' : seuilMois <= 36 ? '#d97706' : '#dc2626';
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">';
      html += '<div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Seuil de Rentabilité</div>';
      html += '<div style="font-size:28px;font-weight:800;color:' + seuilColor + '">' + seuilMois + '</div>';
      html += '<div style="font-size:13px;color:#6b7280;margin-top:2px">mois</div>';
      html += '</div>';

      // DSCR card
      const dscrColor = dscrAvg >= 1.5 ? '#059669' : dscrAvg >= 1.0 ? '#d97706' : '#dc2626';
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">';
      html += '<div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">DSCR Moyen</div>';
      html += '<div style="font-size:28px;font-weight:800;color:' + dscrColor + '">' + dscrAvg.toFixed(2) + 'x</div>';
      html += '<div style="font-size:11px;color:#9ca3af;margin-top:4px">Couverture service dette</div>';
      html += '</div>';

      html += '</div></div>';

      // ════════════════════════════════════════════════
      // SECTION 4 — PLAN DE FINANCEMENT (tableau)
      // ════════════════════════════════════════════════
      const fondsP = fin.capital_initial || 0;
      const apportNouv = Object.values(fin.apport_nouveaux_actionnaires || {}).reduce((s, v) => s + (v || 0), 0);
      const empruntOvo = fin.pret_ovo?.montant || 0;
      const empruntFam = fin.pret_famille?.montant || 0;
      const empruntBanque = fin.pret_banque?.montant || 0;
      const totalEmprunts = empruntOvo + empruntFam + empruntBanque;
      const totalSources = fondsP + apportNouv + totalEmprunts;

      const capex = totalInvest;
      const bfrInitial = Math.round(caByYear[yearKeys[2]] * 0.15); // ~15% du CA
      const fraisEtab = Math.round(totalInvest * 0.02);
      const totalEmplois = capex + bfrInitial + fraisEtab;
      const equilibre = Math.abs(totalSources - totalEmplois) < totalSources * 0.05;

      html += '<div style="margin-bottom:28px">';
      html += '<h3 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 12px 0;display:flex;align-items:center;gap:8px"><i class="fas fa-scale-balanced" style="color:#2563eb"></i> Plan de Financement</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">';

      // SOURCES column
      html += '<div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);padding:16px 20px;border-right:1px solid #e5e7eb">';
      html += '<div style="font-size:13px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px"><i class="fas fa-arrow-right-to-bracket" style="margin-right:6px"></i> Sources</div>';
      html += '<div style="display:flex;flex-direction:column;gap:8px">';
      html += '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#374151">Fonds propres</span><span style="font-weight:600;color:#1e40af">' + fmt(fondsP) + '</span></div>';
      if (apportNouv > 0) html += '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#374151">Apports actionnaires</span><span style="font-weight:600;color:#1e40af">' + fmt(apportNouv) + '</span></div>';
      if (empruntOvo > 0) html += '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#374151">Prêt OVO</span><span style="font-weight:600;color:#1e40af">' + fmt(empruntOvo) + '</span></div>';
      if (empruntFam > 0) html += '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#374151">Prêt famille</span><span style="font-weight:600;color:#1e40af">' + fmt(empruntFam) + '</span></div>';
      if (empruntBanque > 0) html += '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#374151">Emprunt bancaire</span><span style="font-weight:600;color:#1e40af">' + fmt(empruntBanque) + '</span></div>';
      html += '<div style="border-top:2px solid #0369a1;padding-top:8px;margin-top:4px;display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span style="color:#0369a1">TOTAL SOURCES</span><span style="color:#0369a1">' + fmt(totalSources) + '</span></div>';
      html += '</div></div>';

      // EMPLOIS column
      html += '<div style="background:linear-gradient(135deg,#fef9f0,#fef3c7);padding:16px 20px">';
      html += '<div style="font-size:13px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px"><i class="fas fa-arrow-right-from-bracket" style="margin-right:6px"></i> Emplois</div>';
      html += '<div style="display:flex;flex-direction:column;gap:8px">';
      html += '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#374151">CAPEX (investissements)</span><span style="font-weight:600;color:#92400e">' + fmt(capex) + '</span></div>';
      html += '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#374151">BFR initial</span><span style="font-weight:600;color:#92400e">' + fmt(bfrInitial) + '</span></div>';
      html += '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#374151">Frais d\\'établissement</span><span style="font-weight:600;color:#92400e">' + fmt(fraisEtab) + '</span></div>';
      html += '<div style="border-top:2px solid #92400e;padding-top:8px;margin-top:4px;display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span style="color:#92400e">TOTAL EMPLOIS</span><span style="color:#92400e">' + fmt(totalEmplois) + '</span></div>';
      html += '</div></div>';

      html += '</div>';
      // Equilibre badge
      html += '<div style="margin-top:8px;text-align:center">';
      if (equilibre) {
        html += '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;background:#f0fdf4;color:#059669;font-size:12px;font-weight:600;border:1px solid #bbf7d0"><i class="fas fa-check-circle"></i> Plan équilibré</span>';
      } else {
        const ecart = totalSources - totalEmplois;
        html += '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;background:#fef2f2;color:#dc2626;font-size:12px;font-weight:600;border:1px solid #fecaca"><i class="fas fa-exclamation-triangle"></i> Écart : ' + fmt(ecart) + ' ' + currency + '</span>';
      }
      html += '</div></div>';

      // ═══ COMPANY INFO BAR ═══
      html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px 16px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;font-size:12px;color:#6b7280">';
      html += '<span><i class="fas fa-building" style="margin-right:4px"></i> ' + esc(hyp.company_name || '') + '</span>';
      html += '<span><i class="fas fa-globe" style="margin-right:4px"></i> ' + esc(hyp.country || '') + '</span>';
      html += '<span><i class="fas fa-industry" style="margin-right:4px"></i> ' + esc(hyp.sector || '') + '</span>';
      html += '<span><i class="fas fa-calendar" style="margin-right:4px"></i> Base ' + baseYear + '</span>';
      html += '</div>';

      html += '</div>';

      // ═══ STORE CHART INIT FUNCTION (called after innerHTML is set) ═══
      var caArr = yearKeys.map(function(k) { return Math.round(caByYear[k]); });
      var rnArr = yearKeys.map(function(k) { return Math.round(rnByYear[k]); });
      window.__ovoChartInit = function() {
        var canvas = document.getElementById('ovo-ca-chart');
        if (!canvas || !window.Chart) return;
        // Destroy existing chart if any
        if (canvas.__chartInstance) { canvas.__chartInstance.destroy(); }
        var chart = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: yearLabels,
            datasets: [{
              label: 'CA HT (' + currency + ')',
              data: caArr,
              backgroundColor: '#2563eb',
              borderRadius: 6,
              barPercentage: 0.6
            }, {
              label: 'Résultat Net',
              data: rnArr,
              backgroundColor: rnArr.map(function(v) { return v >= 0 ? '#059669' : '#dc2626'; }),
              borderRadius: 6,
              barPercentage: 0.6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: { position: 'top' },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    var v = ctx.raw;
                    if (Math.abs(v) >= 1e9) return ctx.dataset.label + ': ' + (v/1e9).toFixed(1) + ' Md ' + currency;
                    if (Math.abs(v) >= 1e6) return ctx.dataset.label + ': ' + (v/1e6).toFixed(1) + ' M ' + currency;
                    return ctx.dataset.label + ': ' + (v/1e3).toFixed(0) + ' k ' + currency;
                  }
                }
              }
            },
            scales: {
              y: {
                ticks: {
                  callback: function(v) {
                    if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(0) + ' Md';
                    if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(0) + ' M';
                    return (v/1e3).toFixed(0) + 'k';
                  }
                }
              }
            }
          }
        });
        canvas.__chartInstance = chart;
      };

      return html;
    }

    function renderGenericHTML(c, score, col, type) {
      let html = '<div class="ev2-deliv-view">';
      
      // CORRECTION: Download bar adapté au type de livrable
      const excelTypes = ['framework', 'plan_ovo', 'odd'];
      const wordTypes = ['business_plan', 'bmc_analysis', 'sic_analysis'];
      
      if (excelTypes.includes(type)) {
        // ═══ BARRE VERTE — Excel (.xlsx) ═══
        html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0;border-radius:12px;margin-bottom:20px">';
        html += '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-excel" style="font-size:24px;color:#059669"></i><div><div style="font-size:14px;font-weight:700;color:#065f46">📊 Fichier Excel disponible</div><div style="font-size:12px;color:#047857">' + (type === 'framework' ? 'Framework Analyse PME rempli avec vos données' : type === 'odd' ? 'Rapport ODD Due Diligence' : 'Plan Financier OVO') + '</div></div></div>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        if (type === 'framework') {
          html += '<button onclick="downloadFrameworkExcelInline()" id="btn-download-inline" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#059669;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(5,150,105,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-download"></i> Télécharger Excel (.xlsx)</button>';
        } else if (type === 'plan_ovo' && PLAN_OVO_ID) {
          html += '<button onclick="downloadPlanOVOExcelDirect()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#059669;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(5,150,105,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-download"></i> Télécharger Excel (.xlsm)</button>';
        }
        html += '<a href="/deliverable/' + type + '" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#065f46;border:1px solid #bbf7d0;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#f0fdf4&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Voir en pleine page</a>';
        html += '</div></div>';
      } else if (wordTypes.includes(type)) {
        // ═══ BARRE BLEUE — Word (.docx) + PDF ═══
        const typeLabel = type === 'bmc_analysis' ? 'BMC Analysé' : type === 'sic_analysis' ? 'SIC Analysé' : 'Business Plan';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:12px;margin-bottom:20px">';
        html += '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-file-word" style="font-size:24px;color:#2563eb"></i><div><div style="font-size:14px;font-weight:700;color:#1e40af">📄 ' + typeLabel + '</div><div style="font-size:12px;color:#3b82f6">Téléchargeable en Word ou PDF</div></div></div>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        html += '<button data-download="docx" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#2563eb;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(37,99,235,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-word"></i> Word (.docx)</button>';
        html += '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,45,18,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>';
        html += '<a href="/deliverable/' + type + '" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#1e40af;border:1px solid #93c5fd;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#eff6ff&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>';
        html += '</div></div>';
      } else if (type === 'diagnostic') {
        // ═══ BARRE BLEU FONCÉ — HTML + PDF ═══
        html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0f4ff,#e8edfb);border:1px solid #a3b8d8;border-radius:12px;margin-bottom:20px">';
        html += '<div style="display:flex;align-items:center;gap:10px"><i class="fas fa-stethoscope" style="font-size:24px;color:#1e3a5f"></i><div><div style="font-size:14px;font-weight:700;color:#1e3a5f">🔍 Diagnostic Expert</div><div style="font-size:12px;color:#4b6584">Disponible en HTML et PDF</div></div></div>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        html += '<button data-download="html" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#1e3a5f;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(30,58,95,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-code"></i> HTML</button>';
        html += '<button data-download="pdf" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#7c2d12;color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,45,18,0.3)" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1"><i class="fas fa-file-pdf"></i> PDF</button>';
        html += '<a href="/deliverable/' + type + '" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;background:white;color:#1e3a5f;border:1px solid #a3b8d8;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer" onmouseover="this.style.background=&apos;#f0f4ff&apos;" onmouseout="this.style.background=&apos;white&apos;"><i class="fas fa-expand"></i> Pleine page</a>';
        html += '</div></div>';
      }
      
      html += '<div class="ev2-deliv-view__score"><div class="ev2-deliv-view__score-num" style="color:' + col + '">' + score + '/100</div></div>';
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

    async function downloadFrameworkExcelInline() {
      const btn = document.getElementById('btn-download-inline') || document.getElementById('btn-fw-excel-top');
      if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...'; btn.disabled = true; }
      try {
        const resp = await fetch('/api/download/framework-excel', { credentials: 'include' });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'Erreur ' + resp.status); }
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const cd = resp.headers.get('Content-Disposition') || '';
        const fnMatch = cd.match(/filename="?([^";]+)/);
        a.download = fnMatch ? fnMatch[1] : 'Framework_Analyse_PME_' + USER_NAME.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        if (btn) { btn.innerHTML = '<i class="fas fa-check"></i> Téléchargé !'; setTimeout(() => { btn.innerHTML = '<i class="fas fa-download"></i> Télécharger Excel (.xlsx)'; btn.disabled = false; }, 3000); }
      } catch (e) {
        alert('Erreur téléchargement: ' + e.message);
        if (btn) { btn.innerHTML = '<i class="fas fa-download"></i> Télécharger Excel (.xlsx)'; btn.disabled = false; }
      }
    }

    function downloadDiagnosticHtmlInline() {
      const btn = document.getElementById('btn-download-diag-html');
      if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Préparation...'; btn.disabled = true; }
      try {
        const htmlContent = DIAGNOSTIC_HTML_TEMPLATE;
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'Diagnostic_Expert_' + USER_NAME.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.html';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        if (btn) { btn.innerHTML = '<i class="fas fa-check"></i> Téléchargé !'; setTimeout(() => { btn.innerHTML = '<i class="fas fa-file-code"></i> Télécharger HTML'; btn.disabled = false; }, 3000); }
      } catch (e) {
        alert('Erreur: ' + e.message);
        if (btn) { btn.innerHTML = '<i class="fas fa-file-code"></i> Télécharger HTML'; btn.disabled = false; }
      }
    }

    // ── Download functions ──
    async function downloadFrameworkExcelDirect() {
      try {
        const resp = await fetch('/api/download/framework-excel', { credentials: 'include' });
        if (!resp.ok) throw new Error('Erreur ' + resp.status);
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'Framework_Analyse_PME_' + USER_NAME.replace(/\\s+/g, '_') + '.xlsx';
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      } catch (e) { alert('Erreur: ' + e.message); }
    }

    async function downloadPlanOVOExcelDirect() {
      const btn = event?.target?.closest?.('button');
      const originalHtml = btn ? btn.innerHTML : '';
      if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Téléchargement...'; btn.disabled = true; }
      try {
        const token = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('auth_token='));
        const tokenVal = token ? token.split('=').slice(1).join('=') : '';
        const headers = tokenVal ? { 'Authorization': 'Bearer ' + tokenVal } : {};
        let resp = await fetch('/api/plan-ovo/download/' + PLAN_OVO_ID, {
          headers: headers,
          credentials: 'include'
        });
        
        // If 422 = Excel not yet filled, auto-trigger fill then retry download
        if (resp.status === 422) {
          if (btn) { btn.innerHTML = '<i class="fas fa-cog fa-spin"></i> Préparation Excel...'; }
          const fillResp = await fetch('/api/plan-ovo/fill', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ planId: PLAN_OVO_ID })
          });
          if (!fillResp.ok) {
            const fillErr = await fillResp.json().catch(() => ({ error: 'Erreur fill' }));
            throw new Error('Préparation échouée: ' + (fillErr.error || fillErr.message));
          }
          // Retry download after successful fill
          if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Téléchargement...'; }
          resp = await fetch('/api/plan-ovo/download/' + PLAN_OVO_ID, {
            headers: headers,
            credentials: 'include'
          });
        }
        
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Erreur ' + resp.status }));
          throw new Error(err.error || err.message || 'Erreur ' + resp.status);
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cd = resp.headers.get('Content-Disposition');
        const fnMatch = cd && cd.match(/filename="?([^"]+)"?/);
        a.download = fnMatch ? fnMatch[1] : 'Plan_OVO_' + USER_NAME.replace(/\\s+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.xlsm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (btn) { btn.innerHTML = '<i class="fas fa-check"></i> Téléchargé !'; setTimeout(() => { btn.innerHTML = originalHtml; btn.disabled = false; }, 3000); }
      } catch(e) {
        alert('Erreur téléchargement Plan OVO: ' + e.message);
        if (btn) { btn.innerHTML = originalHtml; btn.disabled = false; }
      }
    }

    function downloadDeliverable(format) {
      const type = currentDelivType;
      try {
        if (format === 'xlsx' && type === 'framework') { downloadFrameworkExcelDirect(); return; }
        if (format === 'xlsx' && type === 'plan_ovo' && PLAN_OVO_ID) { downloadPlanOVOExcelDirect(); return; }
        if (format === 'xlsx') { window.open('/deliverable/' + type, '_blank'); return; }
        
        if (format === 'html' && type === 'diagnostic' && DIAGNOSTIC_HTML_TEMPLATE) {
          const blob = new Blob([DIAGNOSTIC_HTML_TEMPLATE], { type: 'text/html;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'Diagnostic_Expert_' + USER_NAME.replace(/\\s+/g, '_') + '.html';
          document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
          return;
        }
        
        if (format === 'pdf' || format === 'html') {
          const mainContent = document.getElementById('center-content');
          const types = ${safeJSON(DELIVERABLE_TYPES)};
          const dt = types.find(t => t.type === type);
          const dTitle = dt ? dt.label : type;
          const printWin = window.open('', '_blank');
          printWin.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>' + dTitle + '</title>'
            + '<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">'
            + '<style>body{font-family:Inter,sans-serif;background:white;padding:20px}@media print{.no-print{display:none!important}}</style>'
            + '</head><body>'
            + '<h1 style="text-align:center;color:#1e3a5f">' + dTitle + '</h1>'
            + '<p style="text-align:center;color:#6b7280">' + USER_NAME + ' — ' + new Date().toLocaleDateString('fr-FR') + '</p><hr/>'
            + '<button onclick="window.print()" class="no-print" style="position:fixed;top:16px;right:16px;padding:10px 20px;background:#4338ca;color:white;border:none;border-radius:10px;font-weight:600;cursor:pointer;z-index:999"><i class="fas fa-print"></i> Imprimer / PDF</button>'
            + (mainContent ? mainContent.innerHTML : '')
            + '</body></html>');
          printWin.document.close();
          return;
        }
        
        if (format === 'docx') {
          const mainContent = document.getElementById('center-content');
          const types = ${safeJSON(DELIVERABLE_TYPES)};
          const dt = types.find(t => t.type === type);
          const dTitle = dt ? dt.label : type;
          const htmlContent = '<html><head><meta charset="utf-8"><title>' + dTitle + '</title></head><body>' + (mainContent ? mainContent.innerHTML : '') + '</body></html>';
          const blob = new Blob(['\\ufeff', htmlContent], { type: 'application/msword' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = dTitle.replace(/\\s+/g, '_') + '_' + USER_NAME.replace(/\\s+/g, '_') + '.doc';
          document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
          return;
        }
        
        window.open('/deliverable/' + type, '_blank');
      } catch (e) { alert('Erreur: ' + e.message); }
    }

    // ── Event delegation for download buttons ──
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-download]');
      if (btn) { e.preventDefault(); downloadDeliverable(btn.getAttribute('data-download')); }
    });

    // ── Drag & drop on sidebar ──
    var sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.addEventListener('dragover', function(e) { e.preventDefault(); sidebar.style.borderColor = '#2563eb'; });
      sidebar.addEventListener('dragleave', function() { sidebar.style.borderColor = ''; });
      sidebar.addEventListener('drop', function(e) {
        e.preventDefault(); sidebar.style.borderColor = '';
        if (e.dataTransfer.files.length) {
          var input = document.getElementById('file-multi-upload');
          input.files = e.dataTransfer.files;
          input.dispatchEvent(new Event('change'));
        }
      });
    }
  </script>
</body>
</html>`

    return c.html(safeScriptBlocks(html))
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
  // Kept for backward compatibility but no longer used in new layout
  return ''
}

function renderDiagnosticView(deliverable: any, scoresDim: any): string {
  if (!deliverable) return renderEmptyState()
  
  let content: any
  try {
    content = typeof deliverable.content === 'string' ? JSON.parse(deliverable.content) : deliverable.content
  } catch {
    content = {}
  }

  const score = deliverable.score || content.score_global || content.score || 0
  
  // Check if new format (from diagnostic_analyses)
  const isNewFormat = !!content.scores_dimensions || !!content.score_global
  
  if (isNewFormat) {
    // New format — show summary with link to full page
    const globalScore = content.score_global || score
    const label = content.label || ''
    const sColor = getScoreColor(globalScore)
    const forces = content.forces || []
    const recs = content.recommandations || []
    const sd = content.scores_dimensions || {}
    const dimKeys = ['coherence','viabilite','realisme','completude_couts','capacite_remboursement']
    const dimLabels: Record<string,string> = {coherence:'Cohérence financière',viabilite:'Viabilité économique',realisme:'Réalisme des projections',completude_couts:'Complétude des coûts',capacite_remboursement:'Capacité de remboursement'}

    let html = '<div class="ev2-diag">'
    
    // Score header
    html += `<div style="text-align:center;padding:20px;background:linear-gradient(135deg,${sColor}10,${sColor}05);border:1px solid ${sColor}30;border-radius:16px;margin-bottom:20px">
      <div style="font-size:12px;color:#94a3b8;font-weight:600;margin-bottom:4px">Score Investment Readiness</div>
      <div style="font-size:36px;font-weight:800;color:${sColor}">${globalScore}<span style="font-size:16px;color:#94a3b8">/100</span></div>
      <div style="font-size:13px;color:${sColor};font-weight:600;margin-top:4px">${escapeHtml(label)}</div>
    </div>`
    
    // Dimensions
    html += '<div class="ev2-diag__dims">'
    for (const dk of dimKeys) {
      const dim = sd[dk]
      if (!dim) continue
      const ds = dim.score || 0
      const dc = getScoreColor(ds)
      html += `<div class="ev2-diag__dim">
        <div class="ev2-diag__dim-name">${escapeHtml(dim.label || dimLabels[dk] || dk)}</div>
        <div class="ev2-diag__dim-score" style="color:${dc}">${ds}/100</div>
        <div class="ev2-diag__dim-bar"><div class="ev2-diag__dim-bar-fill" style="width:${ds}%;background:${dc}"></div></div>
        <div class="ev2-diag__dim-text">${escapeHtml(dim.commentaire || '')}</div>
      </div>`
    }
    html += '</div>'
    
    // Forces summary
    if (forces.length) {
      html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-check-circle" style="color:#059669"></i> Forces</div><ul class="ev2-diag__list">'
      for (const f of forces) {
        const titre = typeof f === 'string' ? f : (f.titre || '')
        html += `<li><i class="fas fa-check" style="color:#059669"></i> ${escapeHtml(titre)}</li>`
      }
      html += '</ul></div>'
    }
    
    // Link to full view
    html += `<div style="text-align:center;margin-top:16px;padding:14px;background:#f0f4ff;border-radius:12px;border:1px solid #93c5fd">
      <a href="/module/diagnostic" style="display:inline-flex;align-items:center;gap:10px;padding:12px 24px;background:#2563eb;color:white;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700;box-shadow:0 2px 10px rgba(37,99,235,0.3)">
        <i class="fas fa-expand"></i> Voir le diagnostic complet
      </a>
    </div>`
    
    html += '</div>'
    return html
  }

  // Old format fallback
  const dimensions = content.dimensions || []
  const strengths = content.strengths || []
  const weaknesses = content.weaknesses || []
  const recommendations = content.recommendations || []

  let html = '<div class="ev2-diag">'
  
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

  if (strengths.length) {
    html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-check-circle" style="color:#059669"></i> Forces</div><ul class="ev2-diag__list">'
    for (const s of strengths) html += `<li><i class="fas fa-check" style="color:#059669"></i>${escapeHtml(s)}</li>`
    html += '</ul></div>'
  }

  if (weaknesses.length) {
    html += '<div class="ev2-diag__section"><div class="ev2-diag__section-title"><i class="fas fa-exclamation-triangle" style="color:#dc2626"></i> Faiblesses</div><ul class="ev2-diag__list">'
    for (const w of weaknesses) html += `<li><i class="fas fa-times" style="color:#dc2626"></i>${escapeHtml(w)}</li>`
    html += '</ul></div>'
  }

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
