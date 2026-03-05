// ═══════════════════════════════════════════════════════════════
// BMC Deliverable Engine — Claude AI-Powered Full Deliverable Generator
// L'agent IA Claude génère 100% du contenu expert du livrable :
//   Scores par bloc, Forces, Vigilances, SWOT, Recommandations,
//   Données financières, Maturity checks
// Fallback : moteur règles si Claude indisponible
// Template : Réplique pixel-perfect du BMC_GOTCHE_FINAL.pdf
// ═══════════════════════════════════════════════════════════════

// ─── Types ───
export interface KBContextForBmc {
  benchmarks: string    // formatted text
  fiscalParams: string
  funders: string
  criteria: string
  feedback: string
}

export interface BmcDeliverableData {
  companyName: string
  entrepreneurName: string
  sector: string
  location: string
  country: string
  brandName: string
  tagline: string
  analysisDate: string
  answers: Map<number, string>
  apiKey?: string            // Anthropic API key for Claude AI
  kbContext?: KBContextForBmc // Knowledge Base context for enriched analysis
}

interface BmcBlocScore {
  key: string
  label: string
  score: number      // 0-100
  comment: string
  canvasSummary?: string[]  // Clean bullet points for Canvas display
}

interface BmcForce {
  title: string
  description: string
}

interface BmcVigilance {
  title: string
  description: string
  action: string
}

interface SwotData {
  forces: string[]
  faiblesses: string[]
  opportunites: string[]
  menaces: string[]
}

interface BmcRecommendation {
  horizon: string
  horizonLabel: string
  items: string[]
}

interface BmcAnalysis {
  globalScore: number
  blocScores: BmcBlocScore[]
  forces: BmcForce[]
  vigilances: BmcVigilance[]
  swot: SwotData
  recommendations: BmcRecommendation[]
  maturityChecks: { label: string, status: 'ok' | 'warning' | 'action' }[]
  propositionDeValeur: string
  caMensuel: string
  margeBrute: string
  coutTotal: string
  aiSource: 'claude' | 'fallback'
  syntheseGlobale?: string
}

// ─── Color Palette (from PDF analysis) ───
const COLORS = {
  primary: '#2d6a4f',           // Dark green-teal (BMC brand)
  primaryLight: '#95d5b2',      // Light green
  primaryBg: '#e8f5e9',
  accent: '#1565c0',            // Blue
  accentLight: '#e3f2fd',
  orange: '#e65100',
  orangeLight: '#fff3e0',
  red: '#c62828',
  redLight: '#ffebee',
  textDark: '#1a2332',
  textMedium: '#444444',
  textLight: '#666666',
  textMuted: '#999999',
  bgCard: '#ffffff',
  bgPage: '#f8fafb',
  border: 'rgba(0,0,0,0.08)',
}

// ─── BMC Section mapping (Question ID → Label) ───
const BMC_SECTIONS: Record<number, { key: string, label: string, icon: string }> = {
  1: { key: 'segments_clients', label: 'Segments Clients', icon: '👥' },
  2: { key: 'proposition_valeur', label: 'Proposition de Valeur', icon: '💎' },
  3: { key: 'canaux', label: 'Canaux', icon: '📦' },
  4: { key: 'relations_clients', label: 'Relations Clients', icon: '🤝' },
  5: { key: 'flux_revenus', label: 'Flux de Revenus', icon: '💰' },
  6: { key: 'ressources_cles', label: 'Ressources Clés', icon: '🔧' },
  7: { key: 'activites_cles', label: 'Activités Clés', icon: '⚙️' },
  8: { key: 'partenaires_cles', label: 'Partenaires Clés', icon: '🤲' },
  9: { key: 'structure_couts', label: 'Structure de Coûts', icon: '📊' },
}

// ─── Canvas Grid Positions (Classic BMC layout) ───
const CANVAS_LAYOUT: { qId: number, gridArea: string }[] = [
  { qId: 8, gridArea: '1 / 1 / 3 / 2' },   // Partenaires Clés (top-left)
  { qId: 7, gridArea: '1 / 2 / 2 / 3' },   // Activités Clés (mid-left top)
  { qId: 6, gridArea: '2 / 2 / 3 / 3' },   // Ressources Clés (mid-left bottom)
  { qId: 2, gridArea: '1 / 3 / 3 / 4' },   // Proposition de Valeur (center)
  { qId: 4, gridArea: '1 / 4 / 2 / 5' },   // Relations Clients (mid-right top)
  { qId: 3, gridArea: '2 / 4 / 3 / 5' },   // Canaux (mid-right bottom)
  { qId: 1, gridArea: '1 / 5 / 3 / 6' },   // Segments Clients (right)
  { qId: 9, gridArea: '3 / 1 / 4 / 3' },   // Structure de Coûts (bottom-left)
  { qId: 5, gridArea: '3 / 3 / 4 / 6' },   // Flux de Revenus (bottom-right)
]

// ─── Helper: Extract bullet points ───
function extractBullets(text: string): string[] {
  if (!text) return []
  const lines = text.split(/[\n\r]+|[•\-–›]\s*|\d+[\.\)]\s*/).map(l => l.trim()).filter(l => l.length > 5)
  if (lines.length <= 1 && text.length > 50) {
    return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10).slice(0, 6)
  }
  return lines.slice(0, 8)
}

// ─── Helper: Clean raw answer text into presentable bullet points ───
// Removes template questions, instructions, checkboxes, section headers
// Produces concise, professional bullet points from raw DOCX content
function cleanAnswerToBullets(text: string): string[] {
  if (!text || text.length < 10) return []
  
  // Patterns to remove (template questions, instructions, headers, formatting noise)
  const removePatterns = [
    /^\d{1,2}\s*[-–.)\s]+\s*[A-ZÀÉÈÊËÏÎÔÙÛÜÇ][A-ZÀÉÈÊËÏÎÔÙÛÜÇ\s'']{3,}$/,  // Section headers like "1- SEGMENTS CLIENTS"
    /^(À qui|Comment\s+(votre|vos|les|le|la)|Pourquoi|Quel(le)?s?\s+(est|sont)|Qui\s+(sont|est)|Ce que|Ce sans|Combien)/i,
    /^(Règle|Phrase de synthèse|Nous aidons \[|Décris|Décrivez|Listez|Indiquez|Précisez|Expliquez|Définissez)/i,
    /^☐\s/,                                                                
    /^(Template|TEMPLATE|Business Model Canvas|Social Impact Canvas)$/i,    
    /^\(.*\)$/,                                                            
    /vendez-vous|vous choisit|vous découvre|vous interagissez|gagnez de l'argent|devez absolument|ne fonctionne pas|vous aide|votre entreprise/i,
    /^(prioritaire|obligatoire|maximum|recommandé|optionnel|exemple)\s*$/i, 
    /^\d{1,2}\s*\/\s*\d{1,2}$/,                                           
    /^(Nombre|Note|Score)\s*:/i,                                           
    /^(Type de relation|Mode de|Méthode de)\s*$/i,                         
    /\?\s*$/,                                                              // Any line ending with ?
    /^\[.*\]$/,                                                            // Placeholder brackets
    /^_{2,}$/,                                                             // Underscores (form fields)
  ]
  
  const lines = text.split(/[\n\r]+/).map(l => l.replace(/^[\s•\-–›☐☑✓✔\d.)\]]+\s*/, '').trim())
  
  const cleaned: string[] = []
  for (const line of lines) {
    if (line.length < 5) continue
    if (removePatterns.some(p => p.test(line))) continue
    // Skip pure labels without value
    if (/^[^:]{3,30}:\s*$/.test(line)) continue
    // Skip repeated section names
    if (/^(segments?\s+clients?|proposition\s+de\s+valeur|canaux|relations?\s+clients?|flux\s+de\s+revenus?|ressources?\s+cl[ée]s?|activit[ée]s?\s+cl[ée]s?|partenaires?\s+cl[ée]s?|structure\s+(de\s+)?co[uû]ts?)\s*$/i.test(line)) continue
    
    // Extract value after colon if present (e.g. "Client principal : les boutiquiers" → "Les boutiquiers")
    const colonMatch = line.match(/^([^:]{3,40}):\s+(.+)$/)
    if (colonMatch && colonMatch[2].length > 3) {
      // Keep label:value format for short labels, capitalize value
      const label = colonMatch[1].trim()
      const value = colonMatch[2].trim()
      // If the label is informative (not just "Réponse" or "Type"), include it
      if (label.length > 15 || /^(produit|service|prix|client|canal|activit|ressourc)/i.test(label)) {
        const capitalized = value.charAt(0).toUpperCase() + value.slice(1)
        cleaned.push(capitalized)
      } else {
        cleaned.push(`${label} : ${value}`)
      }
    } else if (line.length > 8 && !line.endsWith('…')) {
      // Capitalize first letter for consistency
      const capitalized = line.charAt(0).toUpperCase() + line.slice(1)
      cleaned.push(capitalized)
    }
  }
  
  // Deduplicate (case-insensitive), limit to 5 concise bullets
  const seen = new Set<string>()
  const unique: string[] = []
  for (const item of cleaned) {
    const key = item.toLowerCase().replace(/\s+/g, ' ')
    if (!seen.has(key)) {
      seen.add(key)
      // Truncate very long bullets to keep canvas clean
      unique.push(item.length > 100 ? item.slice(0, 97) + '…' : item)
    }
    if (unique.length >= 5) break
  }
  return unique
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE AI — Prompt système pour génération complète du livrable BMC
// ═══════════════════════════════════════════════════════════════

function buildBmcSystemPrompt(kbContext?: KBContextForBmc): string {
  const kbBenchmarks = kbContext?.benchmarks || 'Aucun benchmark disponible.'
  const kbFiscal = kbContext?.fiscalParams || 'SMIG : ~75 000 FCFA/mois\nMarge brute aviculture : 25-35%\nMarge brute agriculture : 30-45%\nTVA : 18%, IS : 25%\nCharges sociales : ~25% du brut\nTaux bancaire : 8-14%'
  const kbFunders = kbContext?.funders || 'Aucun bailleur enregistré.'
  const kbCriteria = kbContext?.criteria || 'Aucun critère disponible.'

  return `Tu es un consultant senior spécialisé en Business Model Canvas pour les PME africaines (focus Côte d'Ivoire / Afrique de l'Ouest). Tu génères un diagnostic COMPLET et EXPERT à partir des 9 blocs BMC remplis par un entrepreneur.

TON OBJECTIF : Générer un JSON structuré qui alimente un livrable PDF professionnel de type "investment readiness". Le résultat doit être riche, personnalisé, spécifique au secteur et aux réponses de l'entrepreneur. Pas de phrases génériques.

══════════════════════════════════════════════════════
BASE DE CONNAISSANCES — BENCHMARKS SECTORIELS :
══════════════════════════════════════════════════════
${kbBenchmarks}

══════════════════════════════════════════════════════
PARAMÈTRES FISCAUX & ÉCONOMIQUES :
══════════════════════════════════════════════════════
${kbFiscal}

══════════════════════════════════════════════════════
BAILLEURS DE FONDS & PROGRAMMES :
══════════════════════════════════════════════════════
${kbFunders}

══════════════════════════════════════════════════════
CRITÈRES D'ÉVALUATION INVESTMENT READINESS :
══════════════════════════════════════════════════════
${kbCriteria}

CRITÈRES DE SCORING PAR BLOC (0-100%) :
- Spécificité : réponse concrète vs vague (30%)
- Données chiffrées : présence de métriques, montants, KPIs (25%)
- Cohérence inter-blocs : alignement entre les 9 blocs (20%)
- Réalisme marché : pertinence pour le contexte africain (15%)
- Complétude : tous les aspects couverts (10%)

ÉCHELLE :
- 0-25% : Insuffisant — réponse trop vague ou absente
- 26-50% : À améliorer — idée présente mais manque de détails
- 51-75% : Bien — réponse structurée mais perfectible
- 76-100% : Excellent — réponse détaillée, chiffrée, actionnable

RÈGLES ABSOLUES :
1. Sois exigeant mais constructif. Score > 80% uniquement si vraiment détaillé + chiffré + cohérent.
2. CHAQUE commentaire de bloc doit être SPÉCIFIQUE aux réponses (pas de générique).
3. Les forces/vigilances doivent citer des éléments des réponses.
4. Les recommandations doivent être ACTIONNABLES et adaptées au contexte africain.
5. Le SWOT doit être basé sur les réponses ET le contexte sectoriel ET les benchmarks KB.
6. Extrais les données financières mentionnées (CA, marge, coûts en FCFA).
7. COMPARE systématiquement avec les benchmarks sectoriels fournis.
8. CITE les bailleurs de fonds pertinents dans les recommandations.
9. UTILISE les paramètres fiscaux du pays pour les analyses financières.

IMPORTANT : Réponds UNIQUEMENT avec un objet JSON valide. Pas de markdown, pas de backticks, pas de texte avant ou après.`
}

function buildBmcDeliverableUserPrompt(answers: Map<number, string>, companyName: string, sector: string): string {
  const blocTexts: string[] = []
  for (const [qIdStr, sec] of Object.entries(BMC_SECTIONS)) {
    const qId = Number(qIdStr)
    const answer = answers.get(qId)?.trim() || '(non renseigné)'
    blocTexts.push(`BLOC ${qId} — ${sec.label} :\n${answer}`)
  }

  return `Entreprise : ${companyName || 'Non précisé'}
Secteur : ${sector || 'Non précisé'}

Voici les 9 blocs du Business Model Canvas remplis par l'entrepreneur :

${blocTexts.join('\n\n')}

═══════════════════════════════

Génère le JSON complet du diagnostic livrable avec EXACTEMENT cette structure :

{
  "globalScore": <number 0-100>,
  "syntheseGlobale": "<paragraphe de synthèse expert 3-5 lignes, personnalisé>",
  "blocScores": [
    {
      "key": "<segments_clients|proposition_valeur|canaux|relations_clients|flux_revenus|ressources_cles|activites_cles|partenaires_cles|structure_couts>",
      "label": "<nom du bloc>",
      "score": <number 0-100>,
      "comment": "<commentaire expert spécifique 1-2 phrases, basé sur le contenu>",
      "canvasSummary": ["<bullet point 1 synthétisé: phrase courte et claire résumant un élément clé>", "<bullet point 2>", "<bullet point 3>"]
    }
  ],
  "forces": [
    { "title": "<titre court de la force>", "description": "<description 2-3 phrases, basée sur les réponses>" }
  ],
  "vigilances": [
    { "title": "<titre du risque>", "description": "<explication 1-2 phrases>", "action": "<action concrète recommandée>" }
  ],
  "swot": {
    "forces": ["<force 1>", "<force 2>", "<force 3>", "<force 4>", "<force 5>"],
    "faiblesses": ["<faiblesse 1>", "<faiblesse 2>", "<faiblesse 3>", "<faiblesse 4>", "<faiblesse 5>"],
    "opportunites": ["<opportunité 1>", "<opportunité 2>", "<opportunité 3>", "<opportunité 4>", "<opportunité 5>"],
    "menaces": ["<menace 1>", "<menace 2>", "<menace 3>", "<menace 4>", "<menace 5>"]
  },
  "recommendations": [
    {
      "horizon": "court_terme",
      "horizonLabel": "Court terme — <sous-titre contextuel>",
      "items": ["<recommandation 1>", "<recommandation 2>", "<recommandation 3>", "<recommandation 4>"]
    },
    {
      "horizon": "moyen_terme",
      "horizonLabel": "Moyen terme — <sous-titre contextuel>",
      "items": ["<recommandation 1>", "<recommandation 2>", "<recommandation 3>", "<recommandation 4>"]
    },
    {
      "horizon": "long_terme",
      "horizonLabel": "Long terme — <sous-titre contextuel>",
      "items": ["<recommandation 1>", "<recommandation 2>", "<recommandation 3>", "<recommandation 4>"]
    }
  ],
  "maturityChecks": [
    { "label": "<critère de maturité>", "status": "<ok|warning|action>" }
  ],
  "propositionDeValeur": "<résumé 1 phrase de la proposition de valeur>",
  "caMensuel": "<montant FCFA/mois si mentionné, sinon vide>",
  "margeBrute": "<pourcentage si mentionné, sinon vide>",
  "coutTotal": "<montant FCFA si mentionné, sinon vide>"
}

CONTRAINTES :
- blocScores : EXACTEMENT 9 blocs, triés par score décroissant
- canvasSummary : OBLIGATOIRE pour chaque bloc. 3-5 bullet points par bloc. Chaque bullet doit être une PHRASE COURTE, REFORMULÉE et PROFESSIONNELLE résumant CE QUE L'ENTREPRENEUR A RÉPONDU (pas les questions du template). Tu dois SYNTHÉTISER et REFORMULER les réponses brutes en phrases claires de type consultant. Exemples de BON format : "Boutiquiers détaillants à Bouaflé et Gagnoa", "Livraison d'œufs frais garantie sous 72h", "CA mensuel estimé à 40 000 FCFA par client", "Intégration verticale : production de maïs → aliments → œufs". NE JAMAIS inclure : questions du formulaire, instructions, cases à cocher, texte entre crochets, ou le mot "Réponse".
- forces : 3 à 5 forces SPÉCIFIQUES aux réponses
- vigilances : 3 à 5 risques avec actions concrètes
- swot : 5 éléments par quadrant
- recommendations : EXACTEMENT 3 horizons (court/moyen/long terme), 3-4 items chacun
- maturityChecks : 4 à 6 critères
- Tous les commentaires doivent être SPÉCIFIQUES, pas génériques
- Si des montants en FCFA ou % sont mentionnés dans les réponses, LES EXTRAIRE`
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE AI — Appel API pour génération du livrable
// ═══════════════════════════════════════════════════════════════

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const CLAUDE_MAX_TOKENS = 8192     // Livrable complet = ~4000-6000 tokens
const CLAUDE_TIMEOUT_MS = 120_000   // 120s — livrable complet = beaucoup de tokens

async function callClaudeForDeliverable(
  apiKey: string,
  answers: Map<number, string>,
  companyName: string,
  sector: string,
  kbContext?: KBContextForBmc
): Promise<BmcAnalysis> {
  const userPrompt = buildBmcDeliverableUserPrompt(answers, companyName, sector)
  const systemPrompt = buildBmcSystemPrompt(kbContext)
  const MAX_RETRIES = 3

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)

    try {
      console.log(`[BMC Deliverable] Claude API call attempt ${attempt}/${MAX_RETRIES}`)
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: CLAUDE_MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      // Handle rate limits with exponential backoff
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10)
        const waitMs = Math.max((retryAfter || 10) * 1000, attempt * 12000)
        console.log(`[BMC Deliverable] Rate limited (429), waiting ${waitMs / 1000}s before retry...`)
        await new Promise(resolve => setTimeout(resolve, waitMs))
        continue
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error')
        throw new Error(`Claude API error ${response.status}: ${errorBody.slice(0, 300)}`)
      }

      const data = await response.json() as {
        content?: Array<{ type: string; text?: string }>
        error?: { message?: string }
      }

      if (data.error) {
        throw new Error(`Claude API returned error: ${data.error.message || JSON.stringify(data.error)}`)
      }

      const textBlock = data.content?.find(c => c.type === 'text')
      if (!textBlock?.text) throw new Error('Claude returned empty response')

      // Parse JSON — handle potential markdown wrapping
      let jsonText = textBlock.text.trim()
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
      }

      let parsed: any
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0])
        } else {
          throw new Error(`Failed to parse Claude JSON: ${jsonText.slice(0, 200)}`)
        }
      }

      const result = normalizeBmcAnalysis(parsed)
      // Log canvasSummary extraction for debugging
      const summaryCount = result.blocScores.filter(b => b.canvasSummary && b.canvasSummary.length > 0).length
      console.log(`[BMC Deliverable] canvasSummary extracted for ${summaryCount}/9 blocs`)
      return result

    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        if (attempt < MAX_RETRIES) {
          console.log(`[BMC Deliverable] Timeout on attempt ${attempt}, retrying...`)
          continue
        }
        throw new Error('Claude API timeout after all retries')
      }
      if (attempt >= MAX_RETRIES) throw err
      console.log(`[BMC Deliverable] Attempt ${attempt} failed: ${err.message}, retrying...`)
      await new Promise(resolve => setTimeout(resolve, attempt * 5000))
    }
  }
  throw new Error('Claude API failed after all retries')
}

// ─── Normalize Claude response to BmcAnalysis ───
function normalizeBmcAnalysis(raw: any): BmcAnalysis {
  const globalScore = typeof raw.globalScore === 'number'
    ? Math.max(0, Math.min(100, Math.round(raw.globalScore)))
    : 50

  // Bloc scores — with canvasSummary from Claude
  const blocScores: BmcBlocScore[] = Array.isArray(raw.blocScores)
    ? raw.blocScores.map((b: any) => ({
        key: typeof b.key === 'string' ? b.key : 'unknown',
        label: typeof b.label === 'string' ? b.label : 'Bloc',
        score: typeof b.score === 'number' ? Math.max(0, Math.min(100, Math.round(b.score))) : 50,
        comment: typeof b.comment === 'string' ? b.comment : '',
        canvasSummary: Array.isArray(b.canvasSummary)
          ? b.canvasSummary.filter((s: any) => typeof s === 'string' && s.trim().length > 3).slice(0, 5)
          : undefined
      }))
    : []

  // Forces
  const forces: BmcForce[] = Array.isArray(raw.forces)
    ? raw.forces.slice(0, 5).map((f: any) => ({
        title: typeof f.title === 'string' ? f.title : 'Force',
        description: typeof f.description === 'string' ? f.description : ''
      }))
    : []

  // Vigilances
  const vigilances: BmcVigilance[] = Array.isArray(raw.vigilances)
    ? raw.vigilances.slice(0, 5).map((v: any) => ({
        title: typeof v.title === 'string' ? v.title : 'Risque',
        description: typeof v.description === 'string' ? v.description : '',
        action: typeof v.action === 'string' ? v.action : 'À définir'
      }))
    : []

  // SWOT
  const swot: SwotData = {
    forces: safeStringArray(raw.swot?.forces, 5),
    faiblesses: safeStringArray(raw.swot?.faiblesses, 5),
    opportunites: safeStringArray(raw.swot?.opportunites, 5),
    menaces: safeStringArray(raw.swot?.menaces, 5)
  }

  // Recommendations
  const recommendations: BmcRecommendation[] = Array.isArray(raw.recommendations)
    ? raw.recommendations.slice(0, 3).map((r: any) => ({
        horizon: typeof r.horizon === 'string' ? r.horizon : 'court_terme',
        horizonLabel: typeof r.horizonLabel === 'string' ? r.horizonLabel : 'Recommandation',
        items: safeStringArray(r.items, 4)
      }))
    : []

  // Maturity checks
  const maturityChecks = Array.isArray(raw.maturityChecks)
    ? raw.maturityChecks.slice(0, 6).map((m: any) => ({
        label: typeof m.label === 'string' ? m.label : '',
        status: (['ok', 'warning', 'action'].includes(m.status) ? m.status : 'warning') as 'ok' | 'warning' | 'action'
      }))
    : []

  return {
    globalScore,
    blocScores,
    forces,
    vigilances,
    swot,
    recommendations,
    maturityChecks,
    propositionDeValeur: typeof raw.propositionDeValeur === 'string' ? raw.propositionDeValeur : '',
    caMensuel: typeof raw.caMensuel === 'string' && raw.caMensuel.trim() ? raw.caMensuel : '—',
    margeBrute: typeof raw.margeBrute === 'string' && raw.margeBrute.trim() ? raw.margeBrute : '—',
    coutTotal: typeof raw.coutTotal === 'string' && raw.coutTotal.trim() ? raw.coutTotal : '—',
    aiSource: 'claude',
    syntheseGlobale: typeof raw.syntheseGlobale === 'string' ? raw.syntheseGlobale : undefined
  }
}

function safeStringArray(arr: any, max: number): string[] {
  if (!Array.isArray(arr)) return []
  return arr.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, max)
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK — Moteur règles (si Claude indisponible)
// ═══════════════════════════════════════════════════════════════

function textQuality(text: string): number {
  if (!text || text.trim().length === 0) return 0
  const t = text.trim()
  let score = 0
  if (t.length > 20) score += 15
  if (t.length > 80) score += 15
  if (t.length > 200) score += 10
  if (t.length > 400) score += 10
  if (/\d/.test(t)) score += 15
  if (/\d+\s*%|FCFA|XOF|CFA/i.test(t)) score += 5
  if (/[•\-–›]\s|^\d+[\.\)]/m.test(t)) score += 5
  const hasSpecific = /client|segment|revenu|coût|canal|partenair|activit|ressourc|livrai|produit|prix|marg/i.test(t)
  if (hasSpecific) score += 10
  if (/B2B|B2C|SaaS|marketplace|e-commerce/i.test(t)) score += 5
  return Math.min(score, 100)
}

function extractFinancials(answers: Map<number, string>): { ca: string, marge: string, cout: string } {
  const revenueText = answers.get(5) ?? ''
  const costText = answers.get(9) ?? ''

  const caMatch = revenueText.match(/(\d[\d\s,.]*)\s*(FCFA|XOF|CFA|€|\$)/i)
    ?? revenueText.match(/CA.*?(\d[\d\s,.]*)/i)
    ?? revenueText.match(/(\d[\d\s,.]*)\s*\/\s*mois/i)
  const ca = caMatch ? caMatch[1].trim() : ''

  const margeMatch = revenueText.match(/marge.*?(\d+)\s*%/i) ?? revenueText.match(/(\d+)\s*%.*marge/i)
  const marge = margeMatch ? margeMatch[1] + '%' : ''

  const coutMatch = costText.match(/total.*?(\d[\d\s,.]*)\s*(FCFA|XOF)/i)
    ?? costText.match(/(\d[\d\s,.]*)\s*(FCFA|XOF)/i)
  const cout = coutMatch ? coutMatch[1].trim() + ' ' + (coutMatch[2] ?? '') : ''

  return { ca, marge, cout }
}

function analyzeBmcFallback(answers: Map<number, string>): BmcAnalysis {
  const blocScores: BmcBlocScore[] = []

  for (const [qIdStr, sec] of Object.entries(BMC_SECTIONS)) {
    const qId = Number(qIdStr)
    const answer = answers.get(qId) ?? ''
    const quality = textQuality(answer)

    let comment = ''
    if (quality >= 80) comment = 'Excellente description, détaillée et quantifiée'
    else if (quality >= 60) comment = 'Bonne description, quelques précisions possibles'
    else if (quality >= 40) comment = 'Description correcte, à enrichir avec des données concrètes'
    else if (quality > 0) comment = 'Description trop courte ou vague — ajoutez des détails'
    else comment = 'Non renseigné'

    if (qId === 2 && quality >= 60) comment = 'Claire, différenciante et vérifiable'
    if (qId === 7 && quality >= 60) comment = 'Maîtrisées, intégration verticale'
    if (qId === 6 && quality >= 60) comment = 'Solides mais à vérifier la dépendance personnes'
    if (qId === 1 && quality >= 60) comment = 'Identifiés, zone géographique à étendre'
    if (qId === 4 && quality >= 60) comment = 'Personnalisées mais à formaliser'
    if (qId === 5 && quality >= 50) comment = 'Récurrents, attention au mono-produit'
    if (qId === 8 && quality >= 50) comment = 'Identifiés, relations à formaliser'
    if (qId === 3 && quality >= 40) comment = 'Fonctionnels, manque de digital'
    if (qId === 9 && quality >= 40) comment = 'Exposée aux matières premières'

    // Generate clean canvasSummary from raw answer text (remove template questions/instructions)
    const cleanBullets = cleanAnswerToBullets(answer)
    
    blocScores.push({ key: sec.key, label: sec.label, score: quality, comment, canvasSummary: cleanBullets })
  }

  blocScores.sort((a, b) => b.score - a.score)

  const globalScore = blocScores.length > 0
    ? Math.round(blocScores.reduce((s, b) => s + b.score, 0) / blocScores.length)
    : 0

  const forces: BmcForce[] = []
  const propositionText = answers.get(2) ?? ''
  const activitesText = answers.get(7) ?? ''
  const segmentsText = answers.get(1) ?? ''
  const revenusText = answers.get(5) ?? ''
  const ressourcesText = answers.get(6) ?? ''

  if (activitesText.length > 100 && /intégr|chaîne|vertical|maîtris/i.test(activitesText)) {
    forces.push({ title: 'Intégration verticale complète', description: 'Maîtrise totale de la chaîne de valeur — contrôle de la qualité et des coûts à chaque étape.' })
  }
  if (propositionText.length > 50) {
    const propBullets = extractBullets(propositionText)
    forces.push({ title: 'Proposition de valeur claire et différenciante', description: propBullets[0] ?? 'Promesse simple, concrète et vérifiable.' })
  }
  if (segmentsText.length > 50 && /croissanc|demande|march/i.test(segmentsText)) {
    forces.push({ title: 'Marché structurellement porteur', description: 'Marché en croissance avec demande supérieure à l\'offre locale.' })
  }
  if (revenusText.length > 30 && /recurr|hebdo|mensuel|abonn/i.test(revenusText)) {
    forces.push({ title: 'Modèle récurrent', description: 'Récurrence naturelle des revenus stabilisant le CA.' })
  }
  if (ressourcesText.length > 30 && /marque|brand|TICIA/i.test(ressourcesText)) {
    forces.push({ title: 'Marque identifiable', description: 'Marque établie renforçant la reconnaissance et fidélisation.' })
  }
  if (forces.length < 2) {
    for (const bloc of blocScores.filter(b => b.score >= 60).slice(0, 3)) {
      if (!forces.some(f => f.title.toLowerCase().includes(bloc.label.toLowerCase()))) {
        forces.push({ title: `${bloc.label} solide`, description: bloc.comment })
      }
    }
  }

  const vigilances: BmcVigilance[] = []
  const coutText = answers.get(9) ?? ''
  const canauxText = answers.get(3) ?? ''
  const partenairesText = answers.get(8) ?? ''

  if (coutText && /maïs|matière|intrant/i.test(coutText)) {
    vigilances.push({ title: 'Dépendance matières premières', description: 'Coûts de matières premières significatifs. Fluctuation impacte la marge.', action: 'Sécuriser des contrats d\'approvisionnement à prix fixe.' })
  }
  if (revenusText && !/divers|second|complém/i.test(revenusText)) {
    vigilances.push({ title: 'Mono-produit', description: 'Activité reposant sur un seul produit/service. Risque de concentration.', action: 'Diversifier progressivement l\'offre.' })
  }
  if (canauxText && !/digital|web|online|whatsapp|facebook|instagram/i.test(canauxText)) {
    vigilances.push({ title: 'Absence de digital', description: 'Aucun canal digital détecté.', action: 'Créer une présence digitale minimale.' })
  }
  if (segmentsText && /seul|unique|limit|2 ville|zone restreint/i.test(segmentsText)) {
    vigilances.push({ title: 'Concentration géographique', description: 'Zone géographique limitée.', action: 'Expansion géographique progressive.' })
  }
  if (partenairesText && !/contrat|formalis|accord/i.test(partenairesText)) {
    vigilances.push({ title: 'Relations fournisseurs non formalisées', description: 'Relations non contractualisées. Risque de rupture.', action: 'Contractualiser avec les fournisseurs critiques.' })
  }
  for (const bloc of blocScores.filter(b => b.score < 50).slice(0, 3)) {
    if (!vigilances.some(v => v.title.toLowerCase().includes(bloc.label.toLowerCase()))) {
      vigilances.push({ title: `${bloc.label} à renforcer`, description: `Score ${bloc.score}% — ${bloc.comment}`, action: 'Enrichir avec données concrètes.' })
    }
  }

  const swot: SwotData = {
    forces: forces.map(f => f.title),
    faiblesses: vigilances.map(v => v.title),
    opportunites: ['Expansion vers d\'autres villes/régions', 'Diversification produits et services', 'Digitalisation (WhatsApp Business, e-commerce)', 'Croissance démographique = demande croissante', 'Partenariats avec grandes surfaces/restaurants'].slice(0, 5),
    menaces: ['Volatilité prix matières premières', 'Risque sanitaire/réglementaire', 'Entrée concurrents industriels', 'Dépendance financement externe', 'Instabilité climatique'].slice(0, 5)
  }
  if (activitesText && /intégr/i.test(activitesText)) swot.forces.push('Intégration verticale')
  if (propositionText) swot.forces.push('Proposition de valeur claire')
  swot.forces = [...new Set(swot.forces)].slice(0, 6)

  const recommendations: BmcRecommendation[] = [
    { horizon: 'court_terme', horizonLabel: 'Court terme — Consolider les fondations', items: ['Sécuriser les approvisionnements via contrats à prix fixe.', 'Structurer le suivi client (CRM simple).', 'Formaliser les processus clés.', 'Contractualiser les relations fournisseurs.'] },
    { horizon: 'moyen_terme', horizonLabel: 'Moyen terme — Croissance maîtrisée', items: ['Diversifier les produits/services.', 'Étendre la zone géographique.', 'Créer une présence digitale professionnelle.', 'Renforcer les fonds propres.'] },
    { horizon: 'long_terme', horizonLabel: 'Long terme — Industrialisation et marque', items: ['Industrialiser et automatiser la production.', 'Développer la marque au niveau national.', 'Explorer l\'export sous-régional.', 'Structurer une gouvernance formelle.'] }
  ]

  const maturityChecks: BmcAnalysis['maturityChecks'] = []
  if (propositionText.length > 50) maturityChecks.push({ label: 'Proposition de valeur', status: 'ok' })
  else maturityChecks.push({ label: 'Proposition de valeur', status: 'warning' })
  if (segmentsText && /croissanc|demande|march/i.test(segmentsText)) maturityChecks.push({ label: 'Marché porteur', status: 'ok' })
  else maturityChecks.push({ label: 'Marché porteur', status: 'warning' })
  if (revenusText && !/divers/i.test(revenusText)) maturityChecks.push({ label: 'Mono-produit', status: 'warning' })
  else maturityChecks.push({ label: 'Produit diversifié', status: 'ok' })
  if (canauxText && /digital|web/i.test(canauxText)) maturityChecks.push({ label: 'Présence digitale', status: 'ok' })
  else maturityChecks.push({ label: 'Digitalisation nécessaire', status: 'action' })

  const financials = extractFinancials(answers)

  return {
    globalScore,
    blocScores,
    forces: forces.slice(0, 5),
    vigilances: vigilances.slice(0, 5),
    swot,
    recommendations,
    maturityChecks,
    propositionDeValeur: propositionText.length > 0 ? extractBullets(propositionText)[0] ?? '' : '',
    caMensuel: financials.ca ? financials.ca + ' FCFA/mois' : '—',
    margeBrute: financials.marge || '—',
    coutTotal: financials.cout || '—',
    aiSource: 'fallback'
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ASYNC: Analyze BMC via Claude AI (with fallback)
// ═══════════════════════════════════════════════════════════════

async function analyzeBmcWithAI(
  answers: Map<number, string>,
  companyName: string,
  sector: string,
  apiKey?: string,
  kbContext?: KBContextForBmc
): Promise<BmcAnalysis> {
  // If no API key → fallback
  if (!apiKey || apiKey === 'sk-ant-PLACEHOLDER' || apiKey.length < 20) {
    console.log('[BMC Deliverable] No API key → using rule-based fallback')
    return analyzeBmcFallback(answers)
  }

  try {
    console.log('[BMC Deliverable] Calling Claude AI for full deliverable generation (with KB:', kbContext ? 'YES' : 'NO', ')...')
    const analysis = await callClaudeForDeliverable(apiKey, answers, companyName, sector, kbContext)
    console.log(`[BMC Deliverable] Claude AI generated successfully — Score: ${analysis.globalScore}%, Forces: ${analysis.forces.length}, Vigilances: ${analysis.vigilances.length}`)
    return analysis
  } catch (err: any) {
    console.error('[BMC Deliverable] Claude AI failed, falling back to rules:', err.message)
    return analyzeBmcFallback(answers)
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Generate Full BMC Deliverable HTML (ASYNC — Claude AI)
// ═══════════════════════════════════════════════════════════════
export async function generateFullBmcDeliverable(data: BmcDeliverableData): Promise<string> {
  const { companyName, entrepreneurName, sector, location, country, brandName, tagline, answers, apiKey, kbContext } = data
  const analysis = await analyzeBmcWithAI(answers, companyName, sector, apiKey, kbContext)
  return renderBmcDeliverableHtml(analysis, data)
}

// Synchronous version (fallback only — no Claude AI)
export function generateFullBmcDeliverableFallback(data: BmcDeliverableData): string {
  const analysis = analyzeBmcFallback(data.answers)
  return renderBmcDeliverableHtml(analysis, data)
}

// ═══════════════════════════════════════════════════════════════
// HTML RENDERER — Pixel-perfect template (unchanged)
// ═══════════════════════════════════════════════════════════════
function renderBmcDeliverableHtml(analysis: BmcAnalysis, data: BmcDeliverableData): string {
  const { companyName, sector, location, country, brandName, tagline, answers } = data
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const locationStr = [location, country].filter(Boolean).join(' — ')
  const sectorStr = sector || 'PME'

  const scoreColor = analysis.globalScore >= 80 ? COLORS.primary : analysis.globalScore >= 60 ? COLORS.accent : analysis.globalScore >= 40 ? COLORS.orange : COLORS.red
  const aiLabel = analysis.aiSource === 'claude' ? 'Analyse propulsée par Claude AI' : 'Analyse automatique (règles)'

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Business Model Canvas — ${companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: ${COLORS.primary};
      --primary-light: ${COLORS.primaryLight};
      --primary-bg: ${COLORS.primaryBg};
      --accent: ${COLORS.accent};
      --accent-light: ${COLORS.accentLight};
      --orange: ${COLORS.orange};
      --orange-light: ${COLORS.orangeLight};
      --red: ${COLORS.red};
      --red-light: ${COLORS.redLight};
      --text-dark: ${COLORS.textDark};
      --text-medium: ${COLORS.textMedium};
      --text-light: ${COLORS.textLight};
      --text-muted: ${COLORS.textMuted};
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',system-ui,sans-serif; background:white; color:var(--text-dark); line-height:1.6; }
    .bmc-container { max-width:1200px; margin:0 auto; padding:0 24px; }

    /* ─── HEADER ─── */
    .bmc-header {
      background: linear-gradient(135deg, #1a2e28 0%, #2d6a4f 40%, #40916c 100%);
      padding: 48px 0 56px;
      color: white;
      position: relative;
      overflow: hidden;
    }
    .bmc-header::before {
      content:''; position:absolute; top:-50%; right:-10%;
      width:400px; height:400px; border-radius:50%; background:rgba(255,255,255,0.04);
    }
    .bmc-header__inner { position:relative; z-index:1; }
    .bmc-header__icon {
      width:56px; height:56px; background:rgba(255,255,255,0.15);
      border-radius:16px; display:flex; align-items:center; justify-content:center;
      font-size:24px; margin-bottom:16px; backdrop-filter:blur(8px);
    }
    .bmc-header__title { font-size:36px; font-weight:800; letter-spacing:-0.5px; margin-bottom:4px; }
    .bmc-header__company { font-size:18px; font-weight:600; opacity:0.95; }
    .bmc-header__meta { font-size:14px; font-weight:400; opacity:0.75; margin-top:4px; }
    .bmc-header__tags { display:flex; gap:8px; margin-top:16px; flex-wrap:wrap; }
    .bmc-header__tag { padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600; background:rgba(255,255,255,0.15); backdrop-filter:blur(8px); }
    .bmc-header__ai-badge {
      display:inline-flex; align-items:center; gap:6px;
      padding:4px 14px; border-radius:20px; font-size:11px; font-weight:600;
      background: ${analysis.aiSource === 'claude' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.1)'};
      border: 1px solid ${analysis.aiSource === 'claude' ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.2)'};
    }

    /* ─── SCORE HERO ─── */
    .bmc-score-hero {
      background:white; border-radius:20px; margin:-36px 24px 0;
      position:relative; z-index:10; box-shadow:0 8px 32px rgba(0,0,0,0.1);
      padding:32px 40px; display:grid; grid-template-columns:auto 1fr auto; gap:32px; align-items:center;
    }
    .bmc-score-circle {
      width:130px; height:130px; border-radius:50%;
      display:flex; flex-direction:column; align-items:center; justify-content:center; color:white;
    }
    .bmc-score-circle__value { font-size:42px; font-weight:800; line-height:1; }
    .bmc-score-circle__unit { font-size:13px; font-weight:400; opacity:0.85; }
    .bmc-score-label { font-size:13px; color:var(--text-muted); margin-bottom:4px; }
    .bmc-maturity-checks { display:flex; flex-direction:column; gap:6px; }
    .bmc-maturity-check { font-size:13px; display:flex; align-items:center; gap:6px; }

    /* ─── SECTION CARDS ─── */
    .bmc-card {
      background:white; border-radius:16px; padding:32px;
      margin:24px 0; border:1px solid var(--border);
    }
    .bmc-section-title {
      font-size:20px; font-weight:700; color:var(--primary);
      display:flex; align-items:center; gap:10px; margin-bottom:20px;
    }

    /* ─── SYNTHESE ─── */
    .bmc-synthese {
      background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
      border: 1px solid #86efac; border-radius:12px; padding:20px;
      font-size:14px; line-height:1.7; color:#14532d; margin-bottom:20px;
    }

    /* ─── CANVAS GRID ─── */
    .bmc-canvas-grid {
      display:grid;
      grid-template-columns: repeat(5, 1fr);
      grid-template-rows: auto auto auto;
      gap:0; border:2px solid #2d6a4f; border-radius:12px; overflow:hidden;
    }
    .bmc-canvas-cell {
      padding:16px; border:1px solid #e2e8f0; min-height:140px;
      position:relative;
    }
    .bmc-canvas-cell__header {
      font-size:10px; font-weight:700; text-transform:uppercase;
      letter-spacing:0.5px; color:white; padding:4px 10px;
      border-radius:4px; display:inline-block; margin-bottom:10px;
    }
    .bmc-canvas-cell__bullet {
      font-size:11px; color:var(--text-dark); margin-bottom:5px; line-height:1.4;
      padding-left:12px; position:relative;
    }
    .bmc-canvas-cell__bullet::before {
      content:'›'; position:absolute; left:0; color:var(--primary); font-weight:700;
    }
    .bmc-canvas-cell__subtitle {
      font-size:10px; font-weight:600; color:var(--text-light);
      text-transform:uppercase; letter-spacing:0.3px; margin:8px 0 4px;
    }

    /* ─── DIAGNOSTIC EXPERT ─── */
    .bmc-diag-grid { display:grid; gap:12px; }
    .bmc-diag-row {
      display:grid; grid-template-columns:1fr 60px auto;
      align-items:center; gap:12px; padding:12px 16px;
      border-radius:10px; background:#fafbfc; border:1px solid rgba(0,0,0,0.05);
    }
    .bmc-diag-row__label { font-size:14px; font-weight:600; }
    .bmc-diag-row__score { font-size:16px; font-weight:800; text-align:center; }
    .bmc-diag-row__comment { font-size:12px; color:var(--text-light); }
    .bmc-diag-bar { height:6px; background:#e5e7eb; border-radius:3px; overflow:hidden; margin-top:4px; }
    .bmc-diag-bar__fill { height:100%; border-radius:3px; }

    /* ─── FORCES & VIGILANCES ─── */
    .bmc-forces-grid { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
    .bmc-force-card {
      border-radius:12px; padding:20px; border-left:4px solid;
    }
    .bmc-force-card__title { font-size:15px; font-weight:700; margin-bottom:8px; }
    .bmc-force-card__text { font-size:13px; line-height:1.6; }
    .bmc-force-card__action { font-size:12px; font-weight:600; margin-top:8px; display:flex; align-items:center; gap:4px; }

    /* ─── SWOT ─── */
    .bmc-swot-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .bmc-swot-cell { border-radius:12px; padding:20px; min-height:160px; }
    .bmc-swot-cell__title { font-size:14px; font-weight:700; margin-bottom:12px; }
    .bmc-swot-item { font-size:12px; margin-bottom:5px; line-height:1.5; }

    /* ─── RECOMMENDATIONS ─── */
    .bmc-reco-card {
      border-radius:12px; padding:20px; margin-bottom:16px;
      border-left:4px solid; background:#fafbfc;
    }
    .bmc-reco-card__horizon { font-size:14px; font-weight:700; margin-bottom:10px; display:flex; align-items:center; gap:8px; }
    .bmc-reco-card__item { font-size:13px; color:var(--text-dark); margin-bottom:6px; padding-left:16px; position:relative; line-height:1.5; }
    .bmc-reco-card__item::before { content:'→'; position:absolute; left:0; font-weight:700; color:var(--primary); }

    /* ─── FOOTER ─── */
    .bmc-footer {
      background:linear-gradient(135deg, #1a2e28 0%, #2d6a4f 40%, #40916c 100%);
      border-radius:16px; padding:40px; margin:24px 0 48px;
      color:white; text-align:center;
    }
    .bmc-footer__title { font-size:22px; font-weight:800; margin-bottom:4px; }
    .bmc-footer__company { font-size:16px; font-weight:500; opacity:0.9; }
    .bmc-footer__meta { font-size:12px; opacity:0.6; margin-top:8px; }
    .bmc-footer__quote { font-style:italic; font-size:13px; opacity:0.7; margin-top:16px; }

    /* ─── Print ─── */
    @media print {
      body { background:white; }
      .bmc-header { page-break-after:avoid; }
      .bmc-score-hero { box-shadow:none; border:1px solid #e5e7eb; }
      .bmc-card { page-break-inside:avoid; }
    }
    @media (max-width:768px) {
      .bmc-score-hero { grid-template-columns:1fr; text-align:center; }
      .bmc-canvas-grid { grid-template-columns:1fr 1fr; }
      .bmc-forces-grid { grid-template-columns:1fr; }
      .bmc-swot-grid { grid-template-columns:1fr; }
    }
  </style>
</head>
<body>
  <!-- ═══ 1. HEADER ═══ -->
  <div class="bmc-header">
    <div class="bmc-container bmc-header__inner">
      <div class="bmc-header__icon">📋</div>
      <div class="bmc-header__title">BUSINESS MODEL CANVAS</div>
      <div class="bmc-header__company">${companyName}</div>
      <div class="bmc-header__meta">
        ${[sector, brandName ? 'Marque ' + brandName : '', locationStr].filter(Boolean).join(' — ')}
      </div>
      <div class="bmc-header__tags">
        <span class="bmc-header__tag">${sectorStr}</span>
        <span class="bmc-header__tag">Analyse — ${dateStr}</span>
        ${tagline ? `<span class="bmc-header__tag">${tagline}</span>` : ''}
        <span class="bmc-header__ai-badge">${analysis.aiSource === 'claude' ? '🤖 Claude AI' : '⚙️ Auto'} ${aiLabel}</span>
      </div>
    </div>
  </div>

  <div class="bmc-container">
    <!-- ═══ 2. SCORE HERO ═══ -->
    <div class="bmc-score-hero">
      <div>
        <div class="bmc-score-circle" style="background:${scoreColor};">
          <span class="bmc-score-circle__value">${analysis.globalScore}%</span>
          <span class="bmc-score-circle__unit">Score BMC Global</span>
        </div>
      </div>
      <div>
        <div class="bmc-score-label">Maturité du business model</div>
        <div class="bmc-maturity-checks">
          ${analysis.maturityChecks.map(ch => {
            const icon = ch.status === 'ok' ? '✓' : ch.status === 'warning' ? '⚠' : '→'
            const color = ch.status === 'ok' ? COLORS.primary : ch.status === 'warning' ? COLORS.orange : COLORS.accent
            return `<div class="bmc-maturity-check">
              <span style="color:${color};font-weight:700;">${icon}</span>
              <span style="color:${color};">${ch.label}</span>
            </div>`
          }).join('')}
        </div>
      </div>
      <div style="text-align:right;">
        ${analysis.caMensuel !== '—' ? `<div style="font-size:12px;color:var(--text-muted);">CA mensuel</div><div style="font-size:18px;font-weight:700;color:var(--primary);">≈ ${analysis.caMensuel}</div>` : ''}
        ${analysis.margeBrute !== '—' ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">Marge brute</div><div style="font-size:18px;font-weight:700;color:var(--accent);">≈ ${analysis.margeBrute}</div>` : ''}
      </div>
    </div>

    <!-- ═══ SYNTHESE GLOBALE (Claude AI) ═══ -->
    ${analysis.syntheseGlobale ? `
    <div class="bmc-card">
      <div class="bmc-section-title">🧠 Synthèse Globale — Diagnostic Expert</div>
      <div class="bmc-synthese">${analysis.syntheseGlobale}</div>
    </div>
    ` : ''}

    <!-- ═══ 3. CANVAS — VUE D'ENSEMBLE ═══ -->
    <div class="bmc-card">
      <div class="bmc-section-title">🗂️ CANVAS — VUE D'ENSEMBLE</div>
      <div class="bmc-canvas-grid">
        ${CANVAS_LAYOUT.map(cell => {
          const sec = BMC_SECTIONS[cell.qId]
          const answer = answers.get(cell.qId) ?? ''
          // Prefer Claude's clean canvasSummary over raw text bullets
          const blocData = analysis.blocScores.find(b => b.key === sec.key)
          const aiBullets = blocData?.canvasSummary?.filter(s => s && s.length > 3) || []
          const bullets = aiBullets.length > 0 ? aiBullets : cleanAnswerToBullets(answer)
          const headerColor = cell.qId === 2 ? COLORS.primary :
            [7, 6].includes(cell.qId) ? COLORS.accent :
            [4, 3].includes(cell.qId) ? '#7c3aed' :
            cell.qId === 8 ? '#0891b2' :
            cell.qId === 1 ? '#be185d' :
            cell.qId === 9 ? COLORS.orange : COLORS.red
          const isBottom = cell.qId === 9 || cell.qId === 5
          return `<div class="bmc-canvas-cell" style="grid-area:${cell.gridArea};">
            <div class="bmc-canvas-cell__header" style="background:${headerColor};">${sec.icon} ${sec.label.toUpperCase()}</div>
            ${isBottom && cell.qId === 9 && analysis.coutTotal !== '—' ? `<div style="font-size:11px;font-weight:700;color:var(--orange);margin-bottom:6px;">TOTAL ≈ ${analysis.coutTotal}</div>` : ''}
            ${isBottom && cell.qId === 5 && analysis.caMensuel !== '—' ? `<div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:6px;">CA mensuel ≈ ${analysis.caMensuel}${analysis.margeBrute !== '—' ? ' · Marge ≈ ' + analysis.margeBrute : ''}</div>` : ''}
            ${bullets.length > 0
              ? bullets.slice(0, 5).map(b => `<div class="bmc-canvas-cell__bullet">${b}</div>`).join('')
              : '<div style="font-size:11px;color:#999;font-style:italic;">Non renseigné</div>'}
          </div>`
        }).join('')}
      </div>
    </div>

    <!-- ═══ 4. DIAGNOSTIC EXPERT — Scores par bloc ═══ -->
    <div class="bmc-card">
      <div class="bmc-section-title">📊 DIAGNOSTIC EXPERT</div>
      <div style="font-size:14px;font-weight:600;color:var(--text-dark);margin-bottom:16px;">
        Score global : <span style="color:${scoreColor};font-size:18px;font-weight:800;">${analysis.globalScore}%</span>
      </div>
      <div class="bmc-diag-grid">
        ${analysis.blocScores.map(bloc => {
          const barColor = bloc.score >= 80 ? COLORS.primary : bloc.score >= 60 ? COLORS.accent : bloc.score >= 40 ? COLORS.orange : COLORS.red
          return `<div class="bmc-diag-row">
            <div>
              <div class="bmc-diag-row__label">${bloc.label}</div>
              <div class="bmc-diag-bar"><div class="bmc-diag-bar__fill" style="width:${bloc.score}%;background:${barColor};"></div></div>
            </div>
            <div class="bmc-diag-row__score" style="color:${barColor};">${bloc.score}%</div>
            <div class="bmc-diag-row__comment">${bloc.comment}</div>
          </div>`
        }).join('')}
      </div>
    </div>

    <!-- ═══ 5. FORCES ═══ -->
    <div class="bmc-card">
      <div class="bmc-section-title">💪 Forces — ${analysis.forces.length} atouts majeurs</div>
      <div style="display:grid;gap:16px;">
        ${analysis.forces.map(f =>
          `<div class="bmc-force-card" style="border-color:${COLORS.primary};background:${COLORS.primaryBg};">
            <div class="bmc-force-card__title" style="color:${COLORS.primary};">✓ ${f.title}</div>
            <div class="bmc-force-card__text" style="color:#14532d;">${f.description}</div>
          </div>`
        ).join('')}
      </div>
    </div>

    <!-- ═══ 6. POINTS DE VIGILANCE ═══ -->
    <div class="bmc-card">
      <div class="bmc-section-title">⚠️ Points de vigilance — ${analysis.vigilances.length} risques identifiés</div>
      <div style="display:grid;gap:16px;">
        ${analysis.vigilances.map(v =>
          `<div class="bmc-force-card" style="border-color:${COLORS.orange};background:${COLORS.orangeLight};">
            <div class="bmc-force-card__title" style="color:${COLORS.orange};">⚠ ${v.title}</div>
            <div class="bmc-force-card__text" style="color:#7c2d12;">${v.description}</div>
            <div class="bmc-force-card__action" style="color:${COLORS.primary};">→ ${v.action}</div>
          </div>`
        ).join('')}
      </div>
    </div>

    <!-- ═══ 7. MATRICE SWOT SYNTHÉTIQUE ═══ -->
    <div class="bmc-card">
      <div class="bmc-section-title">📋 Matrice SWOT Synthétique</div>
      <div class="bmc-swot-grid">
        <div class="bmc-swot-cell" style="background:#dcfce7;border:1px solid #86efac;">
          <div class="bmc-swot-cell__title" style="color:#166534;">💪 FORCES</div>
          ${analysis.swot.forces.map(f => `<div class="bmc-swot-item" style="color:#14532d;">${f}</div>`).join('')}
        </div>
        <div class="bmc-swot-cell" style="background:#fee2e2;border:1px solid #fca5a5;">
          <div class="bmc-swot-cell__title" style="color:#991b1b;">⚡ FAIBLESSES</div>
          ${analysis.swot.faiblesses.map(f => `<div class="bmc-swot-item" style="color:#7f1d1d;">${f}</div>`).join('')}
        </div>
        <div class="bmc-swot-cell" style="background:#dbeafe;border:1px solid #93c5fd;">
          <div class="bmc-swot-cell__title" style="color:#1e40af;">🚀 OPPORTUNITÉS</div>
          ${analysis.swot.opportunites.map(f => `<div class="bmc-swot-item" style="color:#1e3a5f;">${f}</div>`).join('')}
        </div>
        <div class="bmc-swot-cell" style="background:#fff7ed;border:1px solid #fdba74;">
          <div class="bmc-swot-cell__title" style="color:#9a3412;">⛔ MENACES</div>
          ${analysis.swot.menaces.map(f => `<div class="bmc-swot-item" style="color:#7c2d12;">${f}</div>`).join('')}
        </div>
      </div>
    </div>

    <!-- ═══ 8. RECOMMANDATIONS STRATÉGIQUES ═══ -->
    <div class="bmc-card">
      <div class="bmc-section-title">🎯 Recommandations stratégiques — Plan d'action</div>
      ${analysis.recommendations.map((rec, idx) => {
        const colors = [
          { border: COLORS.primary, bg: COLORS.primaryBg, icon: '🏗️' },
          { border: COLORS.accent, bg: COLORS.accentLight, icon: '📈' },
          { border: '#7c3aed', bg: '#f5f3ff', icon: '🏭' },
        ]
        const style = colors[idx] ?? colors[0]
        return `<div class="bmc-reco-card" style="border-color:${style.border};background:${style.bg};">
          <div class="bmc-reco-card__horizon" style="color:${style.border};">${style.icon} ${rec.horizonLabel}</div>
          ${rec.items.map(item => `<div class="bmc-reco-card__item">${item}</div>`).join('')}
        </div>`
      }).join('')}
    </div>

    <!-- ═══ 9. PROPOSITION DE VALEUR DÉTAILLÉE ═══ -->
    ${answers.get(2) ? `
    <div class="bmc-card">
      <div class="bmc-section-title">💎 Proposition de Valeur — Détail</div>
      <div style="padding:20px;border-radius:12px;background:linear-gradient(135deg,${COLORS.primaryBg},#f0fdf4);border:1px solid ${COLORS.primaryLight};">
        <div style="font-size:16px;color:var(--primary);font-weight:700;margin-bottom:12px;font-style:italic;">
          "${analysis.propositionDeValeur || extractBullets(answers.get(2)!)[0] || ''}"
        </div>
        <div style="display:grid;gap:8px;">
          ${extractBullets(answers.get(2)!).slice(0, 5).map(b =>
            `<div style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--text-dark);">
              <span style="color:${COLORS.primary};font-weight:700;">›</span> ${b}
            </div>`
          ).join('')}
        </div>
      </div>
    </div>
    ` : ''}

    <!-- ═══ FOOTER ═══ -->
    <div class="bmc-footer">
      <div class="bmc-footer__title">BUSINESS MODEL CANVAS</div>
      <div class="bmc-footer__company">${companyName}</div>
      <div class="bmc-footer__meta">
        ${[sector, brandName ? 'Marque ' + brandName : '', locationStr].filter(Boolean).join(' — ')}
      </div>
      <div class="bmc-footer__meta">Document généré le ${dateStr} • ${aiLabel}</div>
      <div class="bmc-footer__quote">"Les chiffres ne servent pas à juger le passé, mais à décider le futur."</div>
    </div>
  </div>

  <div style="text-align:center;padding:16px;color:#94a3b8;font-size:11px;">
    Généré par ESONO Investment Readiness · Module 1 BMC · ${dateStr} · ${analysis.aiSource === 'claude' ? '🤖 Claude AI' : '⚙️ Moteur règles'}
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════
// Diagnostic Résumé (lighter version — also uses Claude AI)
// ═══════════════════════════════════════════════════════════════
export async function generateBmcDiagnosticHtml(data: BmcDeliverableData): Promise<string> {
  const { companyName, entrepreneurName, answers, apiKey } = data
  const analysis = await analyzeBmcWithAI(answers, companyName, data.sector, apiKey)
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const scoreColor = analysis.globalScore >= 80 ? '#059669' : analysis.globalScore >= 60 ? '#0284c7' : analysis.globalScore >= 40 ? '#d97706' : '#dc2626'

  const blocRows = analysis.blocScores.map(b => {
    const barColor = b.score >= 80 ? '#059669' : b.score >= 60 ? '#0284c7' : b.score >= 40 ? '#d97706' : '#dc2626'
    return `<div style="padding:10px;border-radius:8px;border:1px solid rgba(0,0,0,0.06);margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:600;font-size:13px;">${b.label}</span>
        <span style="font-weight:700;color:${barColor};font-size:14px;">${b.score}%</span>
      </div>
      <div style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:4px;">
        <div style="height:100%;width:${b.score}%;background:${barColor};border-radius:3px;"></div>
      </div>
      <div style="font-size:11px;color:#666;">${b.comment}</div>
    </div>`
  }).join('')

  const forcesList = analysis.forces.map(f => `<li style="margin-bottom:6px;font-size:13px;"><strong style="color:#059669;">✓ ${f.title}</strong> — ${f.description}</li>`).join('')
  const vigilancesList = analysis.vigilances.map(v => `<li style="margin-bottom:6px;font-size:13px;"><strong style="color:#d97706;">⚠ ${v.title}</strong> — ${v.description} <em style="color:#0284c7;">→ ${v.action}</em></li>`).join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagnostic BMC - ${companyName}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter','IBM Plex Sans',system-ui,sans-serif; background:white; color:#1e293b; line-height:1.6; }
    .container { max-width:900px; margin:0 auto; padding:32px 24px; }
    .header { text-align:center; margin-bottom:32px; }
    .header h1 { font-size:28px; color:#2d6a4f; margin-bottom:8px; }
    .header p { color:#64748b; font-size:14px; }
    .card { background:white; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
    .card h2 { font-size:18px; color:#2d6a4f; margin-bottom:16px; }
    @media print { body { background:white; } .card { box-shadow:none; border:1px solid #e5e7eb; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Diagnostic Business Model Canvas</h1>
      <p>${entrepreneurName} · ${companyName} · ${dateStr}</p>
      <p style="font-size:12px;color:#94a3b8;margin-top:4px;">${analysis.aiSource === 'claude' ? '🤖 Analyse Claude AI' : '⚙️ Analyse automatique'}</p>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;gap:24px;">
        <div style="width:110px;height:110px;border-radius:50%;background:${scoreColor};display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;">
          <span style="font-size:32px;font-weight:800;">${analysis.globalScore}%</span>
          <span style="font-size:11px;opacity:0.8;">Score BMC</span>
        </div>
        <div style="flex:1;">
          <h2 style="margin-bottom:8px;">Score Global BMC</h2>
          <p style="font-size:14px;color:#64748b;">${analysis.syntheseGlobale || (analysis.globalScore >= 80 ? 'Excellent business model, bien structuré et documenté.' : analysis.globalScore >= 60 ? 'Bon business model avec des axes d\'amélioration identifiés.' : analysis.globalScore >= 40 ? 'Business model à renforcer — plusieurs blocs nécessitent plus de détails.' : 'Business model insuffisamment documenté.')}</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📊 Scores par Bloc BMC</h2>
      ${blocRows}
    </div>

    <div class="card">
      <h2>💪 Forces (${analysis.forces.length})</h2>
      <ul style="padding-left:20px;">${forcesList}</ul>
    </div>

    <div class="card">
      <h2>⚠️ Points de Vigilance (${analysis.vigilances.length})</h2>
      <ul style="padding-left:20px;">${vigilancesList}</ul>
    </div>

    <div style="text-align:center;padding:24px;color:#94a3b8;font-size:12px;">
      Généré par ESONO Investment Readiness · Module 1 BMC · ${new Date().toISOString().slice(0, 10)} · ${analysis.aiSource === 'claude' ? '🤖 Claude AI' : '⚙️ Règles'}
    </div>
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════
// REGENERATION — Convert DB analysis JSON to full BmcAnalysis + HTML
// Used to regenerate bmc_html from existing bmc_analysis without re-calling Claude
// ═══════════════════════════════════════════════════════════════

/**
 * Maps a DB block name (e.g. "Segments Clients") to the BMC_SECTIONS key system
 */
function findSectionByName(name: string): { qId: number, key: string, label: string, icon: string } | null {
  const normalized = name.toLowerCase().trim()
  for (const [qIdStr, sec] of Object.entries(BMC_SECTIONS)) {
    if (sec.label.toLowerCase() === normalized || sec.key.replace(/_/g, ' ') === normalized) {
      return { qId: Number(qIdStr), ...sec }
    }
  }
  // Fuzzy match
  const fuzzyMap: Record<string, number> = {
    'segment': 1, 'client': 1, 'cible': 1,
    'proposition': 2, 'valeur': 2,
    'canaux': 3, 'canal': 3, 'distribution': 3,
    'relation': 4,
    'flux': 5, 'revenu': 5, 'revenue': 5,
    'ressource': 6,
    'activit': 7,
    'partenaire': 8,
    'coût': 9, 'cout': 9, 'cost': 9, 'structure': 9,
  }
  for (const [keyword, qId] of Object.entries(fuzzyMap)) {
    if (normalized.includes(keyword)) {
      const sec = BMC_SECTIONS[qId]
      return { qId, ...sec }
    }
  }
  return null
}

/**
 * Extract clean bullet points from an analysis text paragraph
 */
function analysisToBullets(analysis: string): string[] {
  if (!analysis || analysis.trim().length < 10) return []
  
  // Split on sentence boundaries
  const sentences = analysis
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length < 200)
  
  // Take the most informative sentences (containing data, specifics)
  const scored = sentences.map(s => {
    let score = 0
    if (/\d/.test(s)) score += 3  // Has numbers
    if (/XOF|FCFA|CFA|%|€/.test(s)) score += 2  // Has financial data
    if (/région|zone|Sénégal|Kaolack|Thiès|Tambacounda/i.test(s)) score += 2  // Has location
    if (s.length > 40) score += 1
    if (/PAYG|solaire|kit|mobile money|Wave|Orange/i.test(s)) score += 1
    return { text: s, score }
  })
  
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 5).map(s => s.text)
}

/**
 * Convert the simplified DB analysis format to full BmcAnalysis + render HTML
 * 
 * @param dbAnalysis - The JSON stored in DB: {score, blocks[{name, score, analysis, recommendations}], coherence_score, warnings}
 * @param companyData - Company metadata for the HTML header
 * @returns Full HTML string
 */
export function regenerateBmcHtmlFromDbAnalysis(
  dbAnalysis: {
    score?: number
    blocks?: Array<{ name: string, score: number, analysis: string, recommendations: string[] }>
    coherence_score?: number
    warnings?: string[]
    // Claude rich format (v12+)
    diagnostic_global?: { score_global?: number, niveau?: string, resume_executif?: string }
    analyse_blocs?: Record<string, { score?: number, forces?: string[], faiblesses?: string[], recommandations?: string[], benchmark?: string }>
    coherence_inter_blocs?: { score?: number, analyse?: string, synergies_identifiees?: string[], incoherences?: string[] }
    recommandations_strategiques?: Array<{ priorite?: string, action?: string, impact?: string, detail?: string }>
    [key: string]: any
  },
  companyData: {
    companyName: string
    entrepreneurName: string
    sector: string
    location: string
    country: string
  }
): string {
  // ═══ NORMALIZE: Convert Claude rich format to legacy blocks format ═══
  const BLOC_NAME_MAP: Record<string, string> = {
    proposition_valeur: 'Proposition de valeur',
    segments_clients: 'Segments clients',
    canaux_distribution: 'Canaux de distribution',
    relation_client: 'Relations clients',
    flux_revenus: 'Flux de revenus',
    ressources_cles: 'Ressources clés',
    activites_cles: 'Activités clés',
    partenaires_cles: 'Partenaires clés',
    structure_couts: 'Structure de coûts',
  }

  let blocks: Array<{ name: string, score: number, analysis: string, recommendations: string[] }> = []
  let finalScore = dbAnalysis.score || 0
  let coherenceScore = dbAnalysis.coherence_score
  let warnings = dbAnalysis.warnings || []

  if (dbAnalysis.analyse_blocs && typeof dbAnalysis.analyse_blocs === 'object' && !dbAnalysis.blocks) {
    // ── Claude rich format: convert analyse_blocs dict → blocks array ──
    console.log('[regenerateBmcHtml] Detected Claude rich format — normalizing analyse_blocs')
    for (const [key, bloc] of Object.entries(dbAnalysis.analyse_blocs)) {
      if (!bloc || typeof bloc !== 'object') continue
      const name = BLOC_NAME_MAP[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      const forces = Array.isArray(bloc.forces) ? bloc.forces : []
      const faiblesses = Array.isArray(bloc.faiblesses) ? bloc.faiblesses : []
      const analysis = [
        ...forces.map(f => `✓ ${f}`),
        ...faiblesses.map(f => `⚠ ${f}`),
        bloc.benchmark || ''
      ].filter(Boolean).join('. ')
      blocks.push({
        name,
        score: typeof bloc.score === 'number' ? bloc.score : 0,
        analysis,
        recommendations: Array.isArray(bloc.recommandations) ? bloc.recommandations : []
      })
    }
    // Extract score from diagnostic_global
    if (dbAnalysis.diagnostic_global?.score_global) {
      finalScore = dbAnalysis.diagnostic_global.score_global
    }
    // Extract coherence
    if (dbAnalysis.coherence_inter_blocs?.score) {
      coherenceScore = dbAnalysis.coherence_inter_blocs.score
    }
    // Extract warnings from faiblesses + incoherences
    const incoherences = dbAnalysis.coherence_inter_blocs?.incoherences || []
    if (incoherences.length > 0) warnings = [...warnings, ...incoherences]

    console.log(`[regenerateBmcHtml] Normalized: ${blocks.length} blocks, score=${finalScore}, coherence=${coherenceScore}`)
  } else {
    blocks = dbAnalysis.blocks || []
  }
  
  // Convert blocks to BmcBlocScore with canvasSummary from analysis text
  const blocScores: BmcBlocScore[] = blocks.map(block => {
    const section = findSectionByName(block.name)
    return {
      key: section?.key || block.name.toLowerCase().replace(/\s+/g, '_'),
      label: section?.label || block.name,
      score: Math.max(0, Math.min(100, Math.round(block.score))),
      comment: block.analysis || '',
      canvasSummary: analysisToBullets(block.analysis)
    }
  })
  
  // Ensure all 9 BMC sections exist
  for (const [qIdStr, sec] of Object.entries(BMC_SECTIONS)) {
    if (!blocScores.find(b => b.key === sec.key)) {
      blocScores.push({
        key: sec.key,
        label: sec.label,
        score: 0,
        comment: 'Bloc non analysé',
        canvasSummary: []
      })
    }
  }
  
  // Generate forces from high-scoring blocks
  const forces: BmcForce[] = blocks
    .filter(b => b.score >= 70)
    .slice(0, 4)
    .map(b => {
      const firstSentence = b.analysis.split(/[.!?]/)[0] || b.name
      return {
        title: b.name + ' — Score élevé (' + b.score + '%)',
        description: b.analysis.slice(0, 300)
      }
    })
  
  // Generate vigilances from low-scoring blocks
  const vigilances: BmcVigilance[] = blocks
    .filter(b => b.score < 60)
    .slice(0, 4)
    .map(b => ({
      title: b.name + ' — À améliorer (' + b.score + '%)',
      description: b.analysis.slice(0, 200),
      action: (b.recommendations && b.recommendations[0]) || 'Compléter la documentation de ce bloc'
    }))
  
  // Generate SWOT from blocks
  const swot: SwotData = {
    forces: blocks.filter(b => b.score >= 70).map(b => b.name + ' (' + b.score + '%) : ' + (b.analysis.split('.')[0] || '')),
    faiblesses: blocks.filter(b => b.score < 50).map(b => b.name + ' (' + b.score + '%) : documentation insuffisante'),
    opportunites: blocks
      .flatMap(b => (b.recommendations || []).slice(0, 1))
      .filter(Boolean)
      .slice(0, 4),
    menaces: warnings.slice(0, 4)
  }
  
  // Generate recommendations from block recommendations
  const allRecos = blocks.flatMap(b => (b.recommendations || []))
  const recommendations: BmcRecommendation[] = [
    {
      horizon: 'court_terme',
      horizonLabel: '📌 Court terme (0-3 mois)',
      items: allRecos.slice(0, 4)
    },
    {
      horizon: 'moyen_terme',
      horizonLabel: '🎯 Moyen terme (3-12 mois)',
      items: allRecos.slice(4, 8)
    },
    {
      horizon: 'long_terme',
      horizonLabel: '🚀 Long terme (12+ mois)',
      items: allRecos.slice(8, 12)
    }
  ].filter(r => r.items.length > 0)
  
  // Maturity checks
  const avgScore = finalScore
  const maturityChecks: { label: string, status: 'ok' | 'warning' | 'action' }[] = [
    { label: 'Business Model Canvas complet', status: blocks.filter(b => b.score > 0).length >= 7 ? 'ok' : 'warning' },
    { label: 'Scoring par bloc réalisé', status: 'ok' },
    { label: 'Analyse de cohérence inter-blocs', status: coherenceScore && coherenceScore > 60 ? 'ok' : 'warning' },
    { label: 'Recommandations d\'amélioration', status: allRecos.length >= 5 ? 'ok' : 'warning' },
    { label: 'Forces et vigilances identifiées', status: forces.length > 0 && vigilances.length > 0 ? 'ok' : 'warning' },
    { label: 'Score global ≥ 70%', status: avgScore >= 70 ? 'ok' : avgScore >= 50 ? 'warning' : 'action' },
  ]
  
  // Build syntheseGlobale
  const topBlocks = blocks.filter(b => b.score >= 70).map(b => b.name).join(', ')
  const weakBlocks = blocks.filter(b => b.score < 50).map(b => b.name).join(', ')
  const syntheseGlobale = `Score global BMC : ${avgScore}%. Points forts : ${topBlocks || 'aucun bloc ≥ 70%'}. ` +
    (weakBlocks ? `Points d'amélioration : ${weakBlocks}. ` : '') +
    `${blocks.length} blocs analysés sur 9 du canvas.`
  
  // Extract financial data from blocks
  const revenueBlock = blocks.find(b => b.name.toLowerCase().includes('revenu') || b.name.toLowerCase().includes('flux'))
  const costBlock = blocks.find(b => b.name.toLowerCase().includes('coût') || b.name.toLowerCase().includes('cost'))
  const caMatch = revenueBlock?.analysis.match(/(\d[\d\s,.]*)\s*(XOF|FCFA|CFA)/i)
  const coutMatch = costBlock?.analysis.match(/(\d[\d\s,.]*)\s*(XOF|FCFA|CFA)/i)
  const margeMatch = revenueBlock?.analysis.match(/marge.*?(\d+)\s*%/i) || revenueBlock?.analysis.match(/(\d+)\s*%.*marge/i)
  
  const analysis: BmcAnalysis = {
    globalScore: avgScore,
    blocScores,
    forces,
    vigilances,
    swot,
    recommendations,
    maturityChecks,
    propositionDeValeur: blocks.find(b => b.name.toLowerCase().includes('proposition'))?.analysis?.slice(0, 200) || '',
    caMensuel: caMatch ? caMatch[1].trim() + ' ' + caMatch[2] : '—',
    margeBrute: margeMatch ? margeMatch[1] + '%' : '—',
    coutTotal: coutMatch ? coutMatch[1].trim() + ' ' + coutMatch[2] : '—',
    aiSource: 'claude',
    syntheseGlobale
  }
  
  // Build a minimal BmcDeliverableData with empty answers (not needed since canvasSummary is populated)
  const data: BmcDeliverableData = {
    companyName: companyData.companyName,
    entrepreneurName: companyData.entrepreneurName,
    sector: companyData.sector,
    location: companyData.location,
    country: companyData.country,
    brandName: '',
    tagline: '',
    analysisDate: new Date().toISOString(),
    answers: new Map()
  }
  
  return renderBmcDeliverableHtml(analysis, data)
}
