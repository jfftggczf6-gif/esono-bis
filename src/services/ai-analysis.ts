// ═══════════════════════════════════════════════════════════════════
// Claude AI Analysis Service — Anthropic API Integration
// Replaces rule-based scoring with contextual AI feedback
// ═══════════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────────

export interface AnalysisBlock {
  questionNumber: number
  blockName: string
  score: number        // 0-100
  level: string        // "Insuffisant" | "À améliorer" | "Bien" | "Excellent"
  answer: string
  forces: string[]
  axes: string[]
  questions: string[]
}

export interface AnalysisResult {
  globalScore: number          // 0-100
  globalLevel: string          // "Insuffisant" | "À améliorer" | "Bien" | "Excellent"
  forcesCount: number
  axesCount: number
  questionsCount: number
  blocksToConsolidate: number  // blocks with score < 60
  blocks: AnalysisBlock[]
  syntheseGlobale: string
  recommandationsPrioritaires: string[]
}

export interface AnswerInput {
  question_number: number
  answer: string
}

// ─── Score helpers ───────────────────────────────────────────────

function getLevel(score: number): string {
  if (score >= 76) return 'Excellent'
  if (score >= 51) return 'Bien'
  if (score >= 26) return 'À améliorer'
  return 'Insuffisant'
}

// ─── System Prompts per Module ───────────────────────────────────

const SYSTEM_PROMPTS: Record<string, string> = {
  mod1_bmc: `Tu es un analyste expert en Business Model Canvas pour les PME africaines, specialise Cote d'Ivoire et Afrique de l'Ouest. Tu evalues les reponses d'un entrepreneur qui remplit son BMC dans le cadre d'un parcours d'investment readiness.

TON ROLE :
- Evaluer chaque bloc du BMC (score 0-100)
- Identifier les forces concretes (ce qui est bien fait)
- Identifier les axes d'amelioration precis (ce qui manque ou est faible)
- Poser des questions de suivi pertinentes pour le coach
- Donner un score global et une synthese

CRITERES D'EVALUATION PAR BLOC :
- Specificite : reponse concrete vs vague (poids 30%)
- Chiffres/metriques : presence de donnees quantifiees (poids 25%)
- Coherence : alignement avec les autres blocs (poids 20%)
- Realisme marche : pertinence pour le contexte africain (poids 15%)
- Completude : tous les aspects couverts (poids 10%)

ECHELLE DE SCORING :
- 0-25% : Insuffisant — reponse trop vague ou absente
- 26-50% : A ameliorer — idee presente mais manque de details
- 51-75% : Bien — reponse structuree mais perfectible
- 76-100% : Excellent — reponse detaillee, chiffree, actionnable

REGLE ABSOLUE : Sois exigeant mais constructif. Un score de 100% est rare. Ne depasse 80% que si la reponse est vraiment detaillee, chiffree ET coherente avec le contexte.

Reponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de backticks, pas de texte avant ou apres le JSON).`,

  mod2_sic: `Tu es un expert en impact social et developpement durable pour les PME africaines. Tu evalues le Social Impact Canvas d'un entrepreneur dans le cadre d'un parcours d'investment readiness pour des fonds d'impact (type OVO Fund).

TON ROLE :
- Evaluer chaque dimension du SIC
- Verifier l'alignement avec les ODD (Objectifs de Developpement Durable)
- Evaluer la mesurabilite des indicateurs d'impact proposes
- Identifier les lacunes en termes d'impact social/environnemental

CRITERES :
- Alignement ODD : pertinence et nombre d'ODD cibles (poids 25%)
- Mesurabilite : indicateurs quantifiables et verifiables (poids 30%)
- Intentionnalite : impact voulu vs collateral (poids 20%)
- Realisme : faisabilite dans le contexte africain (poids 15%)
- Additionnalite : ce que le projet apporte de plus (poids 10%)

ECHELLE DE SCORING :
- 0-25% : Insuffisant — reponse trop vague ou absente
- 26-50% : A ameliorer — idee presente mais manque de details
- 51-75% : Bien — reponse structuree mais perfectible
- 76-100% : Excellent — reponse detaillee, chiffree, actionnable

REGLE ABSOLUE : Sois exigeant mais constructif. Un score de 100% est rare.

Reponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de backticks, pas de texte avant ou apres le JSON).`,

  mod3_inputs: `Tu es un analyste financier senior specialise dans les PME africaines (focus Cote d'Ivoire, Afrique de l'Ouest). Tu evalues les donnees financieres historiques et les hypotheses de projection d'un entrepreneur.

EXPERTISE :
- Modelisation financiere 5 ans
- Detection d'incoherences dans les donnees historiques
- Connaissance du contexte PME Afrique (saisonnalite agricole, informalite, structures de couts reelles)
- Benchmarks sectoriels africains

DEVISE : XOF (FCFA)
PAYS : Cote d'Ivoire
TVA : 18%
IS : 25%
CHARGES SOCIALES : ~25% du brut

CRITERES D'EVALUATION :
- Coherence des donnees historiques (poids 30%)
- Realisme des hypotheses de croissance (poids 25%)
- Completude de la structure de couts (poids 20%)
- Prise en compte des risques (assurance, maintenance, veterinaire...) (poids 15%)
- Clarte et tracabilite des chiffres (poids 10%)

REGLE ABSOLUE : Si les donnees sont contradictoires entre deux reponses, tu DOIS le signaler avec les chiffres contradictoires et baisser le score significativement.

BENCHMARKS COTE D'IVOIRE :
- Marge brute aviculture : 25-35%
- Marge brute agriculture : 30-45%
- Marge brute distribution : 15-25%
- SMIG : ~75 000 FCFA/mois
- Charges patronales : ~25% du brut
- Taux d'interet bancaire : 8-14%

Reponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de backticks, pas de texte avant ou apres le JSON).`
}

// ─── BMC Block Mapping ───────────────────────────────────────────

const BMC_BLOCKS: Record<number, string> = {
  1: 'Partenaires Cles',
  2: 'Activites Cles',
  3: 'Ressources Cles',
  4: 'Proposition de Valeur',
  5: 'Relation Client',
  6: 'Canaux de Distribution',
  7: 'Segments Clients',
  8: 'Structure de Couts',
  9: 'Sources de Revenus'
}

const SIC_BLOCKS: Record<number, string> = {
  1: 'Probleme social/environnemental',
  2: 'Transformation visee',
  3: 'Urgence du probleme',
  4: 'Beneficiaires directs',
  5: 'Nombre de personnes impactees',
  6: 'Implication des beneficiaires',
  7: 'KPI d\'impact principal',
  8: 'Cibles d\'impact 1-3 ans',
  9: 'Methode de mesure',
  10: 'Frequence de mesure',
  11: 'ODD cibles',
  12: 'Contribution concrete aux ODD',
  13: 'Preuves de contribution',
  14: 'Risques sur l\'impact',
  15: 'Attenuation des risques'
}

// ─── User Prompt Builders ────────────────────────────────────────

function buildBmcUserPrompt(answers: AnswerInput[]): string {
  const answersMap = new Map(answers.map(a => [a.question_number, a.answer]))
  
  const blocksText = Object.entries(BMC_BLOCKS).map(([id, name]) => {
    const answer = answersMap.get(Number(id)) || '(non rempli)'
    return `Bloc ${id} — ${name} : ${answer}`
  }).join('\n\n')

  return `Voici les 9 blocs BMC remplis par l'entrepreneur. Analyse chaque bloc et donne un scoring detaille.

${blocksText}

Reponds avec ce JSON exact :
{
  "globalScore": <number 0-100>,
  "globalLevel": "<Insuffisant|A ameliorer|Bien|Excellent>",
  "forcesCount": <number>,
  "axesCount": <number>,
  "questionsCount": <number>,
  "blocksToConsolidate": <number de blocs sous 60%>,
  "blocks": [
    {
      "questionNumber": <1-9>,
      "blockName": "<nom du bloc>",
      "score": <number 0-100>,
      "level": "<Insuffisant|A ameliorer|Bien|Excellent>",
      "answer": "<reponse de l'entrepreneur resumee>",
      "forces": ["<force 1>", "<force 2>"],
      "axes": ["<axe d'amelioration 1>"],
      "questions": ["<question pour le coach>"]
    }
  ],
  "syntheseGlobale": "<paragraphe de synthese 3-5 lignes>",
  "recommandationsPrioritaires": ["<recommandation 1>", "<recommandation 2>", "<recommandation 3>"]
}`
}

function buildSicUserPrompt(answers: AnswerInput[]): string {
  const answersMap = new Map(answers.map(a => [a.question_number, a.answer]))
  
  const blocksText = Object.entries(SIC_BLOCKS).map(([id, name]) => {
    const answer = answersMap.get(Number(id)) || '(non rempli)'
    return `Question ${id} — ${name} : ${answer}`
  }).join('\n\n')

  return `Voici les 15 reponses du Social Impact Canvas rempli par l'entrepreneur. Analyse chaque dimension et donne un scoring detaille.

${blocksText}

Reponds avec ce JSON exact :
{
  "globalScore": <number 0-100>,
  "globalLevel": "<Insuffisant|A ameliorer|Bien|Excellent>",
  "forcesCount": <number>,
  "axesCount": <number>,
  "questionsCount": <number>,
  "blocksToConsolidate": <number de blocs sous 60%>,
  "blocks": [
    {
      "questionNumber": <1-15>,
      "blockName": "<nom de la dimension>",
      "score": <number 0-100>,
      "level": "<Insuffisant|A ameliorer|Bien|Excellent>",
      "answer": "<reponse de l'entrepreneur resumee>",
      "forces": ["<force 1>"],
      "axes": ["<axe d'amelioration 1>"],
      "questions": ["<question pour le coach>"]
    }
  ],
  "syntheseGlobale": "<paragraphe de synthese 3-5 lignes>",
  "recommandationsPrioritaires": ["<recommandation 1>", "<recommandation 2>", "<recommandation 3>"]
}`
}

function buildInputsUserPrompt(answers: AnswerInput[]): string {
  const answersMap = new Map(answers.map(a => [a.question_number, a.answer]))
  
  const answersText = answers
    .filter(a => a.answer && a.answer.trim())
    .map(a => `Champ ${a.question_number} : ${a.answer}`)
    .join('\n')

  return `Voici les donnees financieres saisies par l'entrepreneur. Analyse la coherence, le realisme et la completude.

${answersText}

Reponds avec ce JSON exact :
{
  "globalScore": <number 0-100>,
  "globalLevel": "<Insuffisant|A ameliorer|Bien|Excellent>",
  "forcesCount": <number>,
  "axesCount": <number>,
  "questionsCount": <number>,
  "blocksToConsolidate": <number de champs problematiques>,
  "blocks": [
    {
      "questionNumber": <number>,
      "blockName": "<nom du champ>",
      "score": <number 0-100>,
      "level": "<Insuffisant|A ameliorer|Bien|Excellent>",
      "answer": "<valeur resumee>",
      "forces": ["<force>"],
      "axes": ["<axe d'amelioration>"],
      "questions": ["<question pour le coach>"]
    }
  ],
  "syntheseGlobale": "<paragraphe de synthese 3-5 lignes>",
  "recommandationsPrioritaires": ["<recommandation 1>", "<recommandation 2>", "<recommandation 3>"]
}`
}

// ─── Get block name helper ───────────────────────────────────────

function getBlockName(moduleCode: string, questionNumber: number): string {
  if (moduleCode === 'mod1_bmc') return BMC_BLOCKS[questionNumber] || `Bloc ${questionNumber}`
  if (moduleCode === 'mod2_sic') return SIC_BLOCKS[questionNumber] || `Question ${questionNumber}`
  return `Champ ${questionNumber}`
}

// ─── Rule-based Fallback ─────────────────────────────────────────

export function generateFallbackAnalysis(moduleCode: string, answers: AnswerInput[]): AnalysisResult {
  const blocks: AnalysisBlock[] = answers
    .filter(a => a.answer && a.answer.trim())
    .map(a => {
      const wordCount = a.answer.split(/\s+/).length
      const hasNumbers = /\d+/.test(a.answer)
      const hasSpecifics = /partenaire|client|fournisseur|marge|chiffre|FCFA|XOF|%|budget/i.test(a.answer)
      
      let score = 30 // base
      if (wordCount > 15) score += 10
      if (wordCount > 40) score += 10
      if (wordCount > 80) score += 10
      if (hasNumbers) score += 15
      if (hasSpecifics) score += 10
      score = Math.min(score, 85)

      const forces: string[] = []
      const axes: string[] = []
      const questions: string[] = []

      if (wordCount > 40) forces.push('Description detaillee et structuree.')
      else if (wordCount > 15) forces.push('Description adequate.')
      else axes.push('Reponse trop courte — ajoutez des details et exemples concrets.')

      if (hasNumbers) forces.push('Presence de donnees chiffrees.')
      else axes.push('Ajoutez des chiffres et metriques pour renforcer la credibilite.')

      if (!hasSpecifics) questions.push('Pouvez-vous etre plus specifique sur les elements mentionnes ?')

      return {
        questionNumber: a.question_number,
        blockName: getBlockName(moduleCode, a.question_number),
        score,
        level: getLevel(score),
        answer: a.answer.length > 200 ? a.answer.slice(0, 200) + '...' : a.answer,
        forces,
        axes,
        questions
      }
    })

  const globalScore = blocks.length > 0
    ? Math.round(blocks.reduce((s, b) => s + b.score, 0) / blocks.length)
    : 0

  return {
    globalScore,
    globalLevel: getLevel(globalScore),
    forcesCount: blocks.reduce((s, b) => s + b.forces.length, 0),
    axesCount: blocks.reduce((s, b) => s + b.axes.length, 0),
    questionsCount: blocks.reduce((s, b) => s + b.questions.length, 0),
    blocksToConsolidate: blocks.filter(b => b.score < 60).length,
    blocks,
    syntheseGlobale: `Analyse basee sur des regles automatiques (mode fallback). ${blocks.length} bloc(s) analyses. Score moyen : ${globalScore}%. Pour une analyse plus detaillee et contextuelle, relancez l'analyse IA.`,
    recommandationsPrioritaires: [
      'Ajoutez des chiffres et metriques a chaque bloc.',
      'Detaillez vos reponses avec des exemples concrets du contexte ivoirien.',
      'Assurez la coherence entre tous les blocs.'
    ]
  }
}

// ─── Claude API Call ─────────────────────────────────────────────

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const CLAUDE_MAX_TOKENS = 4096
const CLAUDE_TIMEOUT_MS = 30_000

export async function callClaudeAnalysis(
  apiKey: string,
  moduleCode: string,
  answers: AnswerInput[]
): Promise<AnalysisResult> {
  // Get system prompt
  const systemPrompt = SYSTEM_PROMPTS[moduleCode]
  if (!systemPrompt) {
    // Use BMC prompt as default for unknown modules
    console.warn(`No system prompt for module ${moduleCode}, using BMC default`)
  }

  // Build user prompt
  let userPrompt: string
  if (moduleCode === 'mod1_bmc') {
    userPrompt = buildBmcUserPrompt(answers)
  } else if (moduleCode === 'mod2_sic') {
    userPrompt = buildSicUserPrompt(answers)
  } else if (moduleCode === 'mod3_inputs') {
    userPrompt = buildInputsUserPrompt(answers)
  } else {
    // Generic fallback for other modules
    userPrompt = buildBmcUserPrompt(answers)
  }

  // Call Claude API with timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)

  try {
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
        system: systemPrompt || SYSTEM_PROMPTS.mod1_bmc,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

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

    // Extract text from response
    const textBlock = data.content?.find(c => c.type === 'text')
    if (!textBlock?.text) {
      throw new Error('Claude API returned empty response')
    }

    // Parse JSON — handle potential markdown wrapping
    let jsonText = textBlock.text.trim()
    
    // Strip markdown code block if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch (parseErr) {
      // Try to extract JSON from surrounding text
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else {
        throw new Error(`Failed to parse Claude response as JSON: ${jsonText.slice(0, 200)}`)
      }
    }

    // Validate and normalize the response
    return normalizeAnalysisResult(parsed, moduleCode, answers)

  } catch (err: any) {
    clearTimeout(timeoutId)
    
    if (err.name === 'AbortError') {
      throw new Error('Claude API timeout (>30s). Reessayez dans quelques instants.')
    }
    throw err
  }
}

// ─── Normalize Claude Response ───────────────────────────────────

function normalizeAnalysisResult(raw: any, moduleCode: string, answers: AnswerInput[]): AnalysisResult {
  // Validate required fields
  const globalScore = typeof raw.globalScore === 'number'
    ? Math.max(0, Math.min(100, Math.round(raw.globalScore)))
    : 50

  const blocks: AnalysisBlock[] = Array.isArray(raw.blocks)
    ? raw.blocks.map((b: any, idx: number) => ({
        questionNumber: typeof b.questionNumber === 'number' ? b.questionNumber : idx + 1,
        blockName: typeof b.blockName === 'string' ? b.blockName : getBlockName(moduleCode, idx + 1),
        score: typeof b.score === 'number' ? Math.max(0, Math.min(100, Math.round(b.score))) : 50,
        level: typeof b.level === 'string' ? b.level : getLevel(b.score ?? 50),
        answer: typeof b.answer === 'string' ? b.answer : '',
        forces: Array.isArray(b.forces) ? b.forces.filter((f: any) => typeof f === 'string') : [],
        axes: Array.isArray(b.axes) ? b.axes.filter((a: any) => typeof a === 'string') : [],
        questions: Array.isArray(b.questions) ? b.questions.filter((q: any) => typeof q === 'string') : []
      }))
    : []

  const forcesCount = typeof raw.forcesCount === 'number'
    ? raw.forcesCount
    : blocks.reduce((s, b) => s + b.forces.length, 0)

  const axesCount = typeof raw.axesCount === 'number'
    ? raw.axesCount
    : blocks.reduce((s, b) => s + b.axes.length, 0)

  const questionsCount = typeof raw.questionsCount === 'number'
    ? raw.questionsCount
    : blocks.reduce((s, b) => s + b.questions.length, 0)

  return {
    globalScore,
    globalLevel: typeof raw.globalLevel === 'string' ? raw.globalLevel : getLevel(globalScore),
    forcesCount,
    axesCount,
    questionsCount,
    blocksToConsolidate: typeof raw.blocksToConsolidate === 'number'
      ? raw.blocksToConsolidate
      : blocks.filter(b => b.score < 60).length,
    blocks,
    syntheseGlobale: typeof raw.syntheseGlobale === 'string'
      ? raw.syntheseGlobale
      : 'Analyse completee par Claude AI.',
    recommandationsPrioritaires: Array.isArray(raw.recommandationsPrioritaires)
      ? raw.recommandationsPrioritaires.filter((r: any) => typeof r === 'string').slice(0, 5)
      : ['Detaillez vos reponses.', 'Ajoutez des chiffres.', 'Verifiez la coherence.']
  }
}

// ─── Main Entry Point ────────────────────────────────────────────

export async function analyzeWithClaude(
  apiKey: string | undefined,
  moduleCode: string,
  answers: AnswerInput[]
): Promise<{ analysis: AnalysisResult; source: 'claude' | 'fallback'; error?: string }> {
  // If no API key, use fallback immediately
  if (!apiKey || apiKey === 'sk-ant-PLACEHOLDER' || apiKey.length < 20) {
    return {
      analysis: generateFallbackAnalysis(moduleCode, answers),
      source: 'fallback',
      error: 'Cle API Anthropic non configuree. Analyse rule-based utilisee.'
    }
  }

  try {
    const analysis = await callClaudeAnalysis(apiKey, moduleCode, answers)
    return { analysis, source: 'claude' }
  } catch (err: any) {
    console.error(`Claude analysis failed for ${moduleCode}:`, err.message || err)
    return {
      analysis: generateFallbackAnalysis(moduleCode, answers),
      source: 'fallback',
      error: `Analyse IA indisponible: ${err.message || 'Erreur inconnue'}. Analyse rule-based utilisee.`
    }
  }
}
