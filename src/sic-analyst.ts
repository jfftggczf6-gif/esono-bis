// ═══════════════════════════════════════════════════════════════
// SIC Analyst Agent — Analyse scorée du Social Impact Canvas
// Appel Claude API avec le system prompt expert Impact Investing
// ═══════════════════════════════════════════════════════════════

import { callClaudeJSON, isValidApiKey } from './claude-api'

// ─── ODD Colors reference ───
const ODD_COLORS: Record<number, string> = {
  1: '#E5243B', 2: '#DDA63A', 3: '#4C9F38', 4: '#C5192D',
  5: '#FF3A21', 6: '#26BDE2', 7: '#FCC30B', 8: '#A21942',
  9: '#FD6925', 10: '#DD1367', 11: '#FD9D24', 12: '#BF8B2E',
  13: '#3F7E44', 14: '#0A97D9', 15: '#56C02B', 16: '#00689D', 17: '#19486A'
}

// ─── Types ───
export interface SicAnalystDimension {
  score: number
  label: string
  commentaire: string
}

export interface SicAnalystOdd {
  numero: number
  nom: string
  couleur: string
  alignement: 'fort' | 'moyen' | 'faible'
  justification: string
}

export interface SicAnalystRecommandation {
  priorite: number
  titre: string
  detail: string
  impact_score: string
}

export interface SicAnalystResult {
  score_global: number
  palier: string
  label: string
  dimensions: {
    probleme_vision: SicAnalystDimension
    beneficiaires: SicAnalystDimension
    mesure_impact: SicAnalystDimension
    alignement_odd: SicAnalystDimension
    gestion_risques: SicAnalystDimension
  }
  synthese_impact: string
  chiffres_cles: {
    beneficiaires_directs: { nombre: number; horizon: string }
    beneficiaires_indirects: { nombre: number }
    impact_total_projete: { nombre: number }
    odd_adresses: { nombre: number }
  }
  canvas_blocs: {
    probleme_social: { titre: string; points: string[] }
    transformation_visee: { titre: string; points: string[] }
    beneficiaires: { titre: string; points: string[] }
    solution_activites: { titre: string; points: string[] }
    indicateurs_mesure: {
      titre: string
      indicateurs: Array<{ nom: string; type: 'output' | 'outcome' | 'impact' }>
      cible_1_an: string
      methode: string
      frequence: string
    }
    odd_cibles: {
      titre: string
      odds: SicAnalystOdd[]
    }
  }
  risques_attenuation: {
    risques: Array<{ risque: string; mitigation: string }>
  }
  theorie_du_changement: {
    probleme: string
    activites: string
    outputs: string
    outcomes: string
    impact: string
  }
  changements: { court_terme: string; moyen_terme: string; long_terme: string }
  croisement_bmc: { disponible: boolean; coherences: string[]; incoherences: string[] }
  recommandations: SicAnalystRecommandation[]
  alignement_modele: {
    impact_position: string
    correlation_croissance: string
    conflit_rentabilite: string
    commentaire: string
  }
  niveau_maturite: string
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT — Expert Impact Investing / ESG
// ═══════════════════════════════════════════════════════════════

const SIC_ANALYST_SYSTEM_PROMPT = `Tu es un expert en Impact Investing et évaluation ESG (Environnement, Social, Gouvernance) spécialisé dans les PME en Afrique de l'Ouest (UEMOA / Côte d'Ivoire).

MISSION : Analyser le Social Impact Canvas de cet entrepreneur et produire un JSON d'analyse scoré.

ENTRÉE : Le JSON d'extraction des 9 sections du template SIC est fourni ci-dessous.

══════════════════════════════════════
SCORING — 5 DIMENSIONS
══════════════════════════════════════

Évalue chaque dimension de 0 à 100. Le score global = moyenne pondérée.

DIMENSION 1 — PROBLÈME & VISION (poids : 25%)
  Agrège : Section 1 (Problème) + Section 4 (Outcomes)
  Tu évalues :
    - Le problème est-il clairement défini ? (1 seul, pas 3)
    - Est-il documenté avec des données ? (chiffres, sources, pas juste des affirmations)
    - Est-il ancré localement ? (zones géographiques précises, pas "en Afrique")
    - Les outcomes sont-ils progressifs et crédibles ? (court/moyen/long terme)
    - La phrase de transformation est-elle percutante ?
  Barème :
    80-100 = Problème clair, documenté, outcomes crédibles
    50-79  = Problème identifié mais données imprécises ou outcomes vagues
    30-49  = Problème vague, pas de données, outcomes non définis
    0-29   = Pas de problème social identifiable

DIMENSION 2 — BÉNÉFICIAIRES (poids : 20%)
  Agrège : Section 2 (Bénéficiaires) + Section 3 (Solution)
  Tu évalues :
    - Les bénéficiaires directs sont-ils QUANTIFIÉS ? (un nombre, pas "les communautés")
    - Les bénéficiaires indirects sont-ils identifiés ?
    - Les vulnérabilités sont-elles décrites concrètement ?
    - La solution atteint-elle bien les bénéficiaires visés ?
    - Le nombre de bénéficiaires est-il RÉALISTE ?
  Barème :
    80-100 = Quantifiés + vulnérables + atteignables
    50-79  = Identifiés mais pas tous quantifiés
    30-49  = Vagues ("la communauté", "les gens")
    0-29   = Non identifiés

DIMENSION 3 — MESURE D'IMPACT (poids : 20%)
  Agrège : Section 5 (Impact mesurable) + Section 4 (Outcomes)
  
  ATTENTION CRITIQUE — distingue ces 3 niveaux :
    OUTPUT   = résultat direct de l'activité (ex: "500 personnes formées")
    OUTCOME  = changement pour les bénéficiaires (ex: "70% ont un emploi après la formation")
    IMPACT   = effet sociétal long terme (ex: "recul du chômage dans la zone")
  
  Pour CHAQUE indicateur de l'entrepreneur, indique si c'est un output, outcome ou impact.
  Un bon SIC devrait avoir au moins 1 indicateur de type OUTCOME ou IMPACT.
  
  Tu évalues :
    - Les indicateurs mesurent-ils l'IMPACT réel ? (pas juste l'activité)
    - Les indicateurs sont-ils SMART ? (Spécifique, Mesurable, Atteignable, Réaliste, Temporel)
    - La méthode de mesure est-elle réaliste et documentée ?
    - La fréquence est-elle adaptée ?
    - Y a-t-il des cibles chiffrées ?
  Barème :
    80-100 = ≥3 KPIs SMART d'impact/outcome + méthode documentée
    50-79  = KPIs présents mais confusion output/outcome
    30-49  = 1-2 indicateurs vagues, pas de méthode
    0-29   = Aucun indicateur mesurable

DIMENSION 4 — ALIGNEMENT ODD (poids : 20%)
  Agrège : Section 7 (Parties prenantes) + Section 8 (Alignement) + ODD détectés
  
  IDENTIFIE les ODD même si l'entrepreneur ne les mentionne PAS.
  Table de déduction par secteur :
    Agriculture/Élevage → ODD 1, 2, 8, 12, 15
    Énergie solaire/renouvelable → ODD 7, 13
    Éducation/Formation → ODD 4, 8, 10
    Santé → ODD 3, 6
    Tech/Digital → ODD 4, 9, 10
    BTP/Infrastructure → ODD 9, 11
    Commerce équitable → ODD 1, 8, 12
    Recyclage/Déchets → ODD 12, 13, 15
    Emploi femmes/égalité → ODD 5, 8, 10
    Eau/Assainissement → ODD 6, 14
  
  Pour chaque ODD identifié, donne :
    - Numéro + Nom officiel de l'ODD
    - Niveau d'alignement : "fort" / "moyen" / "faible"
    - Justification en 1 phrase
  
  Tu évalues :
    - Combien d'ODD sont adressés ? (2-5 = idéal, plus de 8 = pas crédible)
    - Les ODD sont-ils JUSTIFIÉS ? (pas juste une liste)
    - L'impact est-il au CŒUR du modèle économique ?
    - La croissance AMPLIFIE-t-elle l'impact ?
    - Les parties prenantes sont-elles diversifiées ?
  Barème :
    80-100 = 3-5 ODD justifiés + impact = cœur du modèle
    50-79  = ODD listés + impact croissant avec le CA
    30-49  = ODD vaguement mentionnés + impact = effet secondaire
    0-29   = Aucun alignement ODD

DIMENSION 5 — GESTION DES RISQUES (poids : 15%)
  Agrège : Section 6 (Risques) + Section 9 (Ressources)
  Tu évalues :
    - Les risques sont-ils identifiés ? (sociaux ET environnementaux)
    - Les mesures de mitigation sont-elles crédibles et concrètes ?
    - Des ressources HUMAINES sont-elles dédiées au suivi d'impact ?
    - Un BUDGET est-il alloué au M&E (Monitoring & Evaluation) ?
    - Y a-t-il des outils/méthodologies de suivi ?
    - Le modèle est-il résilient si un financement s'arrête ?
  Barème :
    80-100 = Risques identifiés + mitigation crédible + ressources dédiées
    50-79  = Risques listés mais mitigation incomplète ou ressources non documentées
    30-49  = Risques partiellement identifiés, pas de ressources
    0-29   = Aucune gestion des risques

══════════════════════════════════════
SCORE GLOBAL
══════════════════════════════════════

score_global = (probleme_vision × 0.25) + (beneficiaires × 0.20) + (mesure_impact × 0.20) + (alignement_odd × 0.20) + (gestion_risques × 0.15)

Paliers :
  0-30   → palier: "non_demontre",  label: "Impact Non Démontré"
  31-50  → palier: "a_structurer",  label: "Impact à Structurer"
  51-70  → palier: "en_construction", label: "Impact Social : En Construction"
  71-85  → palier: "solide",        label: "Impact Solide — Prêt pour Bailleurs"
  86-100 → palier: "exemplaire",    label: "Impact Exemplaire"

══════════════════════════════════════
THÉORIE DU CHANGEMENT
══════════════════════════════════════

Construis une théorie du changement en 5 étapes à partir des sections 1, 3, 4 :
  PROBLÈME → ACTIVITÉS → OUTPUTS → OUTCOMES → IMPACT
  Chaque étape = 1 phrase courte résumée.
  Si l'entrepreneur ne l'a pas fournie explicitement, RECONSTRUIT-LA.

══════════════════════════════════════
CROISEMENT BMC ↔ SIC (si BMC disponible)
══════════════════════════════════════

Si le JSON du BMC analysé est fourni, vérifie :
  1. Segments Clients BMC ↔ Bénéficiaires SIC : cohérence ?
  2. Proposition de Valeur BMC ↔ Solution SIC : alignement ?
  3. Flux de Revenus BMC ↔ Alignement éco/impact : le CA et l'impact vont dans le même sens ?
  4. Partenaires Clés BMC ↔ Parties Prenantes SIC : overlap ?
  Signale toute INCOHÉRENCE.

══════════════════════════════════════
RECOMMANDATIONS
══════════════════════════════════════

Produis le TOP 3 des recommandations pour améliorer le score.
Chaque recommandation doit avoir :
  - Un titre clair et actionnable
  - Un détail (2-3 phrases) avec une action concrète
  - L'impact estimé sur le score ("+X points sur [dimension]")

RÉPONDS UNIQUEMENT EN JSON.

COULEURS ODD À INCLURE dans odd_cibles.odds[].couleur :
  ODD 1:#E5243B  ODD 2:#DDA63A  ODD 3:#4C9F38  ODD 4:#C5192D
  ODD 5:#FF3A21  ODD 6:#26BDE2  ODD 7:#FCC30B  ODD 8:#A21942
  ODD 9:#FD6925  ODD 10:#DD1367 ODD 11:#FD9D24 ODD 12:#BF8B2E
  ODD 13:#3F7E44 ODD 14:#0A97D9 ODD 15:#56C02B ODD 16:#00689D ODD 17:#19486A`

// ═══════════════════════════════════════════════════════════════
// JSON output schema (included in prompt for Claude)
// ═══════════════════════════════════════════════════════════════

const SIC_OUTPUT_SCHEMA = `
FORMAT JSON DE SORTIE (tu DOIS retourner cette structure EXACTE) :
{
  "score_global": 0,
  "palier": "en_construction",
  "label": "Impact Social : En Construction",
  "dimensions": {
    "probleme_vision": { "score": 0, "label": "Problème & Vision", "commentaire": "..." },
    "beneficiaires": { "score": 0, "label": "Bénéficiaires", "commentaire": "..." },
    "mesure_impact": { "score": 0, "label": "Mesure d'Impact", "commentaire": "..." },
    "alignement_odd": { "score": 0, "label": "Alignement ODD", "commentaire": "..." },
    "gestion_risques": { "score": 0, "label": "Gestion des Risques", "commentaire": "..." }
  },
  "synthese_impact": "paragraphe de synthèse...",
  "chiffres_cles": {
    "beneficiaires_directs": { "nombre": 0, "horizon": "3 ans" },
    "beneficiaires_indirects": { "nombre": 0 },
    "impact_total_projete": { "nombre": 0 },
    "odd_adresses": { "nombre": 0 }
  },
  "canvas_blocs": {
    "probleme_social": { "titre": "PROBLÈME SOCIAL", "points": ["...", "..."] },
    "transformation_visee": { "titre": "TRANSFORMATION VISÉE", "points": ["...", "..."] },
    "beneficiaires": { "titre": "BÉNÉFICIAIRES", "points": ["...", "..."] },
    "solution_activites": { "titre": "SOLUTION & ACTIVITÉS À IMPACT", "points": ["...", "..."] },
    "indicateurs_mesure": {
      "titre": "INDICATEURS & MESURE",
      "indicateurs": [
        { "nom": "...", "type": "output|outcome|impact" }
      ],
      "cible_1_an": "...",
      "methode": "...",
      "frequence": "..."
    },
    "odd_cibles": {
      "titre": "ODD CIBLÉS",
      "odds": [
        { "numero": 2, "nom": "Faim zéro", "couleur": "#DDA63A", "alignement": "fort", "justification": "..." }
      ]
    }
  },
  "risques_attenuation": {
    "risques": [
      { "risque": "...", "mitigation": "..." }
    ]
  },
  "theorie_du_changement": {
    "probleme": "...", "activites": "...", "outputs": "...", "outcomes": "...", "impact": "..."
  },
  "changements": { "court_terme": "...", "moyen_terme": "...", "long_terme": "..." },
  "croisement_bmc": { "disponible": false, "coherences": [], "incoherences": [] },
  "recommandations": [
    { "priorite": 1, "titre": "...", "detail": "...", "impact_score": "+X points sur ..." }
  ],
  "alignement_modele": {
    "impact_position": "coeur_du_modele|effet_secondaire|activite_annexe",
    "correlation_croissance": "augmente|stagne|diminue",
    "conflit_rentabilite": "faible|moyen|fort",
    "commentaire": "..."
  },
  "niveau_maturite": "idee|test_pilote|deploye|mesure|scale"
}`

// ═══════════════════════════════════════════════════════════════
// Main function: call Claude to analyze the SIC extraction
// ═══════════════════════════════════════════════════════════════

export async function analyzeSicWithClaude(
  apiKey: string,
  extractionJson: any,
  bmcAnalysisJson?: any | null
): Promise<SicAnalystResult> {

  // Build user prompt with extraction data
  let userPrompt = `Voici le JSON d'extraction des 9 sections du Social Impact Canvas de cet entrepreneur :\n\n`
  userPrompt += '```json\n' + JSON.stringify(extractionJson, null, 2) + '\n```\n\n'

  if (bmcAnalysisJson) {
    userPrompt += `Voici également le JSON du Business Model Canvas analysé de cette PME (pour le croisement BMC ↔ SIC) :\n\n`
    userPrompt += '```json\n' + JSON.stringify(bmcAnalysisJson, null, 2).slice(0, 5000) + '\n```\n\n'
    userPrompt += `IMPORTANT : Le BMC est disponible, active le croisement BMC ↔ SIC et mets "disponible": true.\n\n`
  } else {
    userPrompt += `NOTE : Aucun BMC n'est disponible pour cette PME. Mets "disponible": false dans croisement_bmc.\n\n`
  }

  userPrompt += `Analyse ce SIC et retourne UNIQUEMENT le JSON d'analyse scoré selon le format demandé. Pas de markdown, pas de commentaire.`

  const fullSystemPrompt = SIC_ANALYST_SYSTEM_PROMPT + '\n\n' + SIC_OUTPUT_SCHEMA

  const raw = await callClaudeJSON<any>({
    apiKey,
    systemPrompt: fullSystemPrompt,
    userPrompt,
    maxTokens: 4000,
    timeoutMs: 90_000,
    maxRetries: 2,
    label: 'SIC Analyst'
  })

  return normalizeSicAnalysis(raw, !!bmcAnalysisJson)
}

// ═══════════════════════════════════════════════════════════════
// Normalizer: validate and complete Claude's response
// ═══════════════════════════════════════════════════════════════

function normalizeSicAnalysis(raw: any, hasBmc: boolean): SicAnalystResult {
  // ── Dimensions ──
  const dims = raw?.dimensions || {}
  const normDim = (key: string, defaultLabel: string): SicAnalystDimension => {
    const d = dims[key] || {}
    return {
      score: clampScore(d.score),
      label: d.label || defaultLabel,
      commentaire: d.commentaire || ''
    }
  }

  const dimensions = {
    probleme_vision: normDim('probleme_vision', 'Problème & Vision'),
    beneficiaires: normDim('beneficiaires', 'Bénéficiaires'),
    mesure_impact: normDim('mesure_impact', "Mesure d'Impact"),
    alignement_odd: normDim('alignement_odd', 'Alignement ODD'),
    gestion_risques: normDim('gestion_risques', 'Gestion des Risques'),
  }

  // ── Score global (recalculate to ensure correctness) ──
  const scoreGlobal = Math.round(
    dimensions.probleme_vision.score * 0.25 +
    dimensions.beneficiaires.score * 0.20 +
    dimensions.mesure_impact.score * 0.20 +
    dimensions.alignement_odd.score * 0.20 +
    dimensions.gestion_risques.score * 0.15
  )

  // ── Palier ──
  let palier: string
  let label: string
  if (scoreGlobal <= 30) { palier = 'non_demontre'; label = 'Impact Non Démontré' }
  else if (scoreGlobal <= 50) { palier = 'a_structurer'; label = 'Impact à Structurer' }
  else if (scoreGlobal <= 70) { palier = 'en_construction'; label = 'Impact Social : En Construction' }
  else if (scoreGlobal <= 85) { palier = 'solide'; label = 'Impact Solide — Prêt pour Bailleurs' }
  else { palier = 'exemplaire'; label = 'Impact Exemplaire' }

  // ── Canvas blocs ──
  const cb = raw?.canvas_blocs || {}
  const normBloc = (key: string, defaultTitre: string) => {
    const b = cb[key] || {}
    return {
      titre: b.titre || defaultTitre,
      points: Array.isArray(b.points) ? b.points.filter((p: any) => typeof p === 'string') : []
    }
  }

  // indicateurs_mesure
  const indMes = cb.indicateurs_mesure || {}
  const indicateurs_mesure = {
    titre: indMes.titre || 'INDICATEURS & MESURE',
    indicateurs: Array.isArray(indMes.indicateurs)
      ? indMes.indicateurs.map((i: any) => ({
          nom: i.nom || '',
          type: (['output', 'outcome', 'impact'].includes(i.type) ? i.type : 'output') as 'output' | 'outcome' | 'impact'
        }))
      : [],
    cible_1_an: indMes.cible_1_an || '',
    methode: indMes.methode || '',
    frequence: indMes.frequence || ''
  }

  // odd_cibles
  const oddRaw = cb.odd_cibles || {}
  const odd_cibles = {
    titre: oddRaw.titre || 'ODD CIBLÉS',
    odds: Array.isArray(oddRaw.odds)
      ? oddRaw.odds.map((o: any) => ({
          numero: typeof o.numero === 'number' ? o.numero : 0,
          nom: o.nom || `ODD ${o.numero}`,
          couleur: o.couleur || ODD_COLORS[o.numero] || '#666',
          alignement: (['fort', 'moyen', 'faible'].includes(o.alignement) ? o.alignement : 'moyen') as 'fort' | 'moyen' | 'faible',
          justification: o.justification || ''
        }))
      : []
  }

  // ── Théorie du changement ──
  const tdc = raw?.theorie_du_changement || {}
  const theorie_du_changement = {
    probleme: tdc.probleme || '',
    activites: tdc.activites || '',
    outputs: tdc.outputs || '',
    outcomes: tdc.outcomes || '',
    impact: tdc.impact || ''
  }

  // ── Changements ──
  const chg = raw?.changements || {}
  const changements = {
    court_terme: chg.court_terme || '',
    moyen_terme: chg.moyen_terme || '',
    long_terme: chg.long_terme || ''
  }

  // ── Croisement BMC ──
  const crBmc = raw?.croisement_bmc || {}
  const croisement_bmc = {
    disponible: hasBmc && (crBmc.disponible !== false),
    coherences: Array.isArray(crBmc.coherences) ? crBmc.coherences : [],
    incoherences: Array.isArray(crBmc.incoherences) ? crBmc.incoherences : []
  }

  // ── Recommandations ──
  const recos = Array.isArray(raw?.recommandations)
    ? raw.recommandations.slice(0, 5).map((r: any, i: number) => ({
        priorite: r.priorite || i + 1,
        titre: r.titre || '',
        detail: r.detail || '',
        impact_score: r.impact_score || ''
      }))
    : []

  // ── Risques ──
  const risquesRaw = raw?.risques_attenuation || {}
  const risques_attenuation = {
    risques: Array.isArray(risquesRaw.risques)
      ? risquesRaw.risques.map((r: any) => ({
          risque: r.risque || '',
          mitigation: r.mitigation || ''
        }))
      : []
  }

  // ── Alignement modèle ──
  const am = raw?.alignement_modele || {}
  const alignement_modele = {
    impact_position: am.impact_position || 'effet_secondaire',
    correlation_croissance: am.correlation_croissance || 'stagne',
    conflit_rentabilite: am.conflit_rentabilite || 'moyen',
    commentaire: am.commentaire || ''
  }

  // ── Chiffres clés ──
  const ck = raw?.chiffres_cles || {}
  const chiffres_cles = {
    beneficiaires_directs: {
      nombre: typeof ck.beneficiaires_directs?.nombre === 'number' ? ck.beneficiaires_directs.nombre : 0,
      horizon: ck.beneficiaires_directs?.horizon || '3 ans'
    },
    beneficiaires_indirects: {
      nombre: typeof ck.beneficiaires_indirects?.nombre === 'number' ? ck.beneficiaires_indirects.nombre : 0
    },
    impact_total_projete: {
      nombre: typeof ck.impact_total_projete?.nombre === 'number' ? ck.impact_total_projete.nombre : 0
    },
    odd_adresses: {
      nombre: odd_cibles.odds.length || (typeof ck.odd_adresses?.nombre === 'number' ? ck.odd_adresses.nombre : 0)
    }
  }

  return {
    score_global: scoreGlobal,
    palier,
    label,
    dimensions,
    synthese_impact: raw?.synthese_impact || '',
    chiffres_cles,
    canvas_blocs: {
      probleme_social: normBloc('probleme_social', 'PROBLÈME SOCIAL'),
      transformation_visee: normBloc('transformation_visee', 'TRANSFORMATION VISÉE'),
      beneficiaires: normBloc('beneficiaires', 'BÉNÉFICIAIRES'),
      solution_activites: normBloc('solution_activites', 'SOLUTION & ACTIVITÉS À IMPACT'),
      indicateurs_mesure,
      odd_cibles,
    },
    risques_attenuation,
    theorie_du_changement,
    changements,
    croisement_bmc,
    recommandations: recos,
    alignement_modele,
    niveau_maturite: raw?.niveau_maturite || 'idee'
  }
}

// ═══════════════════════════════════════════════════════════════
// Fallback: rule-based scoring when Claude is unavailable
// ═══════════════════════════════════════════════════════════════

export function analyzeSicFallback(extractionJson: any): SicAnalystResult {
  const sections = extractionJson?.extraction?.sections || []
  const synthese = extractionJson?.extraction?.synthese || {}
  const meta = extractionJson?.metadata || {}

  // Simple heuristic scoring based on content presence and quality
  const sectionPresent = (key: string): boolean => {
    const s = sections.find((sec: any) => sec.key === key)
    return s?.present === true && s?.content?.length > 20
  }

  const sectionLength = (key: string): number => {
    const s = sections.find((sec: any) => sec.key === key)
    return s?.content?.length || 0
  }

  // Dimension 1: Problème & Vision
  let problemeScore = 20
  if (sectionPresent('probleme_societal')) problemeScore += 25
  if (sectionPresent('changements_attendus')) problemeScore += 20
  if (sectionLength('probleme_societal') > 200) problemeScore += 10
  if (meta.zone_geographique) problemeScore += 10
  problemeScore = Math.min(problemeScore, 100)

  // Dimension 2: Bénéficiaires
  let benefScore = 15
  if (sectionPresent('beneficiaires_cibles')) benefScore += 25
  if (sectionPresent('solution_activites')) benefScore += 20
  if (sectionLength('beneficiaires_cibles') > 150) benefScore += 10
  if (meta.beneficiaires_identifies?.length > 0) benefScore += 10
  benefScore = Math.min(benefScore, 100)

  // Dimension 3: Mesure d'impact
  let mesureScore = 10
  if (sectionPresent('impact_mesurable')) mesureScore += 25
  if (sectionLength('impact_mesurable') > 100) mesureScore += 10
  if (meta.chiffres_cles?.length > 0) mesureScore += 15
  mesureScore = Math.min(mesureScore, 100)

  // Dimension 4: Alignement ODD
  let oddScore = 10
  if (sectionPresent('parties_prenantes')) oddScore += 15
  if (sectionPresent('alignement_business_impact')) oddScore += 20
  if (meta.odd_mentionnes?.length > 0) oddScore += 15 + Math.min(meta.odd_mentionnes.length * 5, 20)
  oddScore = Math.min(oddScore, 100)

  // Dimension 5: Gestion des risques
  let risqueScore = 10
  if (sectionPresent('risques_effets_negatifs')) risqueScore += 25
  if (sectionPresent('ressources_moyens')) risqueScore += 20
  if (sectionLength('risques_effets_negatifs') > 100) risqueScore += 10
  risqueScore = Math.min(risqueScore, 100)

  const scoreGlobal = Math.round(
    problemeScore * 0.25 + benefScore * 0.20 + mesureScore * 0.20 + oddScore * 0.20 + risqueScore * 0.15
  )

  let palier: string, labelText: string
  if (scoreGlobal <= 30) { palier = 'non_demontre'; labelText = 'Impact Non Démontré' }
  else if (scoreGlobal <= 50) { palier = 'a_structurer'; labelText = 'Impact à Structurer' }
  else if (scoreGlobal <= 70) { palier = 'en_construction'; labelText = 'Impact Social : En Construction' }
  else if (scoreGlobal <= 85) { palier = 'solide'; labelText = 'Impact Solide — Prêt pour Bailleurs' }
  else { palier = 'exemplaire'; labelText = 'Impact Exemplaire' }

  // Build basic canvas blocs from extraction
  const getPoints = (key: string): string[] => {
    const s = sections.find((sec: any) => sec.key === key)
    if (!s?.summary) return []
    return s.summary.split(/[.;]/).filter((p: string) => p.trim().length > 10).slice(0, 3).map((p: string) => p.trim())
  }

  return {
    score_global: scoreGlobal,
    palier,
    label: labelText,
    dimensions: {
      probleme_vision: { score: problemeScore, label: 'Problème & Vision', commentaire: 'Analyse automatique basée sur la présence et la qualité du contenu.' },
      beneficiaires: { score: benefScore, label: 'Bénéficiaires', commentaire: 'Analyse automatique basée sur la présence et la qualité du contenu.' },
      mesure_impact: { score: mesureScore, label: "Mesure d'Impact", commentaire: 'Analyse automatique basée sur la présence et la qualité du contenu.' },
      alignement_odd: { score: oddScore, label: 'Alignement ODD', commentaire: 'Analyse automatique basée sur la présence et la qualité du contenu.' },
      gestion_risques: { score: risqueScore, label: 'Gestion des Risques', commentaire: 'Analyse automatique basée sur la présence et la qualité du contenu.' },
    },
    synthese_impact: synthese.phrase_impact || 'Analyse automatique — synthèse non disponible.',
    chiffres_cles: {
      beneficiaires_directs: { nombre: 0, horizon: '3 ans' },
      beneficiaires_indirects: { nombre: 0 },
      impact_total_projete: { nombre: 0 },
      odd_adresses: { nombre: meta.odd_mentionnes?.length || 0 }
    },
    canvas_blocs: {
      probleme_social: { titre: 'PROBLÈME SOCIAL', points: getPoints('probleme_societal') },
      transformation_visee: { titre: 'TRANSFORMATION VISÉE', points: getPoints('changements_attendus') },
      beneficiaires: { titre: 'BÉNÉFICIAIRES', points: getPoints('beneficiaires_cibles') },
      solution_activites: { titre: 'SOLUTION & ACTIVITÉS À IMPACT', points: getPoints('solution_activites') },
      indicateurs_mesure: { titre: 'INDICATEURS & MESURE', indicateurs: [], cible_1_an: '', methode: '', frequence: '' },
      odd_cibles: { titre: 'ODD CIBLÉS', odds: [] },
    },
    risques_attenuation: { risques: [] },
    theorie_du_changement: { probleme: '', activites: '', outputs: '', outcomes: '', impact: '' },
    changements: { court_terme: '', moyen_terme: '', long_terme: '' },
    croisement_bmc: { disponible: false, coherences: [], incoherences: [] },
    recommandations: [
      { priorite: 1, titre: 'Quantifier les bénéficiaires', detail: 'Indiquez le nombre exact de bénéficiaires directs et indirects avec un horizon temporel.', impact_score: '+10 points sur Bénéficiaires' },
      { priorite: 2, titre: 'Définir des indicateurs SMART', detail: 'Ajoutez au moins 3 KPIs mesurables avec méthode et fréquence de collecte.', impact_score: '+15 points sur Mesure d\'Impact' },
      { priorite: 3, titre: 'Mapper les ODD', detail: 'Identifiez 3-5 ODD avec justification et niveau d\'alignement.', impact_score: '+10 points sur Alignement ODD' }
    ],
    alignement_modele: { impact_position: 'effet_secondaire', correlation_croissance: 'stagne', conflit_rentabilite: 'moyen', commentaire: 'Analyse automatique — détails non disponibles.' },
    niveau_maturite: synthese.maturite?.toLowerCase().includes('scale') ? 'scale' :
                     synthese.maturite?.toLowerCase().includes('mesur') ? 'mesure' :
                     synthese.maturite?.toLowerCase().includes('deploy') ? 'deploye' :
                     synthese.maturite?.toLowerCase().includes('test') ? 'test_pilote' : 'idee'
  }
}

// ─── Helpers ───

function clampScore(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  if (isNaN(n)) return 40
  return Math.max(0, Math.min(100, Math.round(n)))
}
