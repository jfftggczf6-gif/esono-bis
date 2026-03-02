// ═══════════════════════════════════════════════════════════════
// SIC Extraction Engine — Extraction intelligente du Social Impact Canvas
// Étape A : parseDocx (réutilisé), Étape B : Claude API, Étape C : regex fallback
// ═══════════════════════════════════════════════════════════════

import { callClaudeJSON, isValidApiKey } from './claude-api'

// ─── Les 9 sections du template SIC + synthèse obligatoire ───
export const SIC_TEMPLATE_SECTIONS = [
  { key: 'probleme_societal', num: 1, label: 'Problème sociétal prioritaire' },
  { key: 'beneficiaires_cibles', num: 2, label: 'Bénéficiaires cibles' },
  { key: 'solution_activites', num: 3, label: 'Solution & Activités à impact' },
  { key: 'changements_attendus', num: 4, label: 'Changements attendus (Outcomes)' },
  { key: 'impact_mesurable', num: 5, label: 'Impact mesurable' },
  { key: 'risques_effets_negatifs', num: 6, label: 'Risques & Effets négatifs potentiels' },
  { key: 'parties_prenantes', num: 7, label: 'Parties prenantes clés' },
  { key: 'alignement_business_impact', num: 8, label: 'Alignement modèle économique / impact' },
  { key: 'ressources_moyens', num: 9, label: 'Ressources & Moyens dédiés à l\'impact' },
] as const

export type SicSectionKey = typeof SIC_TEMPLATE_SECTIONS[number]['key']

export interface SicExtractedSection {
  key: SicSectionKey
  num: number
  label: string
  present: boolean
  content: string            // Texte brut extrait (nettoyé)
  summary: string            // Résumé professionnel (par Claude ou regex)
  key_data: {                // Données structurées extraites
    chiffres?: string[]      // Montants, pourcentages, quantités
    odd_mentionnes?: number[] // Numéros ODD mentionnés
    zones_geo?: string[]     // Zones géographiques
    beneficiaires?: string[] // Types de bénéficiaires
    indicateurs?: string[]   // KPIs / indicateurs
    risques?: string[]       // Risques identifiés
    parties_prenantes?: string[] // Stakeholders
  }
}

export interface SicExtractionResult {
  extraction: {
    sections: SicExtractedSection[]
    synthese: {
      present: boolean
      phrase_impact: string
      maturite: string
    }
  }
  metadata: {
    sections_presentes: number
    sections_absentes: number
    sections_absentes_liste: string[]
    secteur: string | null
    zone_geographique: string | null
    odd_mentionnes: number[]
    beneficiaires_identifies: string[]
    chiffres_cles: string[]
    completude_pct: number
  }
}

// ═══════════════════════════════════════════════════════════════
// ÉTAPE B : Appel Claude API pour extraction structurée
// ═══════════════════════════════════════════════════════════════

const SIC_EXTRACTION_SYSTEM_PROMPT = `Tu es un expert en analyse d'impact social et développement durable en Afrique.
Tu reçois le texte brut extrait d'un fichier Word "Social Impact Canvas" (SIC).
Ce document comporte exactement 9 sections numérotées + 1 synthèse obligatoire.

Ton rôle : extraire, restructurer et résumer le contenu de chaque section de manière **professionnelle, fluide et concise**.

RÈGLES ABSOLUES :
1. **Extraction fidèle** : Extrais le contenu réel rempli par l'entrepreneur, pas les questions/instructions du template.
2. **Ne jamais inventer** : Si une section est vide ou manquante, marque-la present:false avec content:"" et summary:"".
3. **Résumé professionnel** : Pour chaque section présente, rédige un résumé de 2-3 phrases fluides et professionnelles qui synthétise l'essentiel. Pas de bullet points, pas de questions.
4. **Données structurées** : Extrais les chiffres (montants FCFA, %, quantités), ODD mentionnés, zones géographiques, noms de bénéficiaires, indicateurs, risques.
5. **Supprimer le bruit** : Élimine les questions du template, les instructions, les checkboxes (☐, ☑), les "Règle :", les "Phrase clé :".
6. **ODD** : Identifie tous les ODD mentionnés explicitement (ODD 1 à 17) et retourne leurs numéros.
7. **Synthèse** : Extrais la phrase d'impact finale et le niveau de maturité (Idée/Test/Déployé/Mesuré/Scalé).

Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaire, selon ce schéma exact :`

const SIC_EXTRACTION_SCHEMA = `{
  "sections": [
    {
      "key": "probleme_societal",
      "num": 1,
      "label": "Problème sociétal prioritaire",
      "present": true,
      "content": "Le texte nettoyé extrait pour cette section...",
      "summary": "Résumé professionnel de 2-3 phrases...",
      "key_data": {
        "chiffres": ["46,55%", "10 000 FCFA"],
        "odd_mentionnes": [2, 3],
        "zones_geo": ["Bouaflé", "Gagnoa"],
        "beneficiaires": ["enfants en milieu rural"],
        "indicateurs": [],
        "risques": [],
        "parties_prenantes": []
      }
    }
  ],
  "synthese": {
    "present": true,
    "phrase_impact": "Notre projet vise à...",
    "maturite": "Test / pilote"
  },
  "metadata": {
    "secteur": "Aviculture / Agroalimentaire",
    "zone_geographique": "Ouest Côte d'Ivoire",
    "odd_mentionnes": [1, 2, 3, 8, 12],
    "beneficiaires_identifies": ["enfants des couches sociales à faible revenu"],
    "chiffres_cles": ["23% réduction coût", "72h après ponte"]
  }
}

IMPORTANT : 
- Le tableau "sections" DOIT contenir exactement 9 objets, un par section (1 à 9).
- Les clés de section sont : probleme_societal, beneficiaires_cibles, solution_activites, changements_attendus, impact_mesurable, risques_effets_negatifs, parties_prenantes, alignement_business_impact, ressources_moyens.
- Si une section est vide/absente → present:false, content:"", summary:"", key_data vides.
- Les ODD doivent être des entiers de 1 à 17.
- Extrais TOUS les chiffres pertinents (montants, pourcentages, durées, quantités).`

export async function callClaudeForSicExtraction(
  apiKey: string,
  rawText: string,
  filename: string
): Promise<SicExtractionResult | null> {
  if (!isValidApiKey(apiKey)) {
    console.log('[SIC Extraction] Invalid API key, skipping Claude call')
    return null
  }

  const userPrompt = `Voici le contenu brut extrait du fichier "${filename}" (Social Impact Canvas).
Extrais et structure les 9 sections + synthèse selon le schéma JSON demandé.

CONTENU DU DOCUMENT :
───────────────────
${rawText.slice(0, 15000)}
───────────────────

Rappel : 9 sections exactes, résumés professionnels fluides, données structurées extraites.
Réponds UNIQUEMENT en JSON valide.`

  try {
    const result = await callClaudeJSON<any>({
      apiKey,
      systemPrompt: SIC_EXTRACTION_SYSTEM_PROMPT + '\n\n' + SIC_EXTRACTION_SCHEMA,
      userPrompt,
      maxTokens: 6000,
      timeoutMs: 60_000,
      maxRetries: 2,
      label: 'SIC Extraction'
    })

    // Normalize and validate the result
    return normalizeSicExtraction(result)
  } catch (err: any) {
    console.error('[SIC Extraction] Claude API error:', err.message)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// Normalizer : valide et complète le résultat Claude
// ═══════════════════════════════════════════════════════════════

function normalizeSicExtraction(raw: any): SicExtractionResult {
  const sections: SicExtractedSection[] = []

  const rawSections: any[] = Array.isArray(raw?.sections) ? raw.sections : []

  for (const tmpl of SIC_TEMPLATE_SECTIONS) {
    // Find matching section in Claude's response
    const match = rawSections.find((s: any) =>
      s.key === tmpl.key || s.num === tmpl.num ||
      (s.label && s.label.toLowerCase().includes(tmpl.label.toLowerCase().split(' ')[0]))
    )

    if (match && match.present !== false && match.content && match.content.trim().length > 10) {
      sections.push({
        key: tmpl.key,
        num: tmpl.num,
        label: tmpl.label,
        present: true,
        content: cleanText(match.content || ''),
        summary: cleanText(match.summary || ''),
        key_data: {
          chiffres: ensureArray(match.key_data?.chiffres),
          odd_mentionnes: ensureNumberArray(match.key_data?.odd_mentionnes),
          zones_geo: ensureArray(match.key_data?.zones_geo),
          beneficiaires: ensureArray(match.key_data?.beneficiaires),
          indicateurs: ensureArray(match.key_data?.indicateurs),
          risques: ensureArray(match.key_data?.risques),
          parties_prenantes: ensureArray(match.key_data?.parties_prenantes),
        }
      })
    } else {
      sections.push({
        key: tmpl.key,
        num: tmpl.num,
        label: tmpl.label,
        present: false,
        content: '',
        summary: '',
        key_data: {}
      })
    }
  }

  // Synthese
  const synthese = {
    present: !!(raw?.synthese?.phrase_impact && raw.synthese.phrase_impact.trim().length > 10),
    phrase_impact: cleanText(raw?.synthese?.phrase_impact || ''),
    maturite: raw?.synthese?.maturite || 'Non précisé'
  }

  // Metadata
  const sectionsPresentes = sections.filter(s => s.present).length
  const sectionsAbsentes = 9 - sectionsPresentes
  const sectionsAbsentesListe = sections.filter(s => !s.present).map(s => s.label)

  // Collect all ODD from all sections
  const allOdds = new Set<number>()
  for (const s of sections) {
    if (s.key_data.odd_mentionnes) {
      for (const n of s.key_data.odd_mentionnes) {
        if (n >= 1 && n <= 17) allOdds.add(n)
      }
    }
  }
  if (raw?.metadata?.odd_mentionnes) {
    for (const n of ensureNumberArray(raw.metadata.odd_mentionnes)) {
      if (n >= 1 && n <= 17) allOdds.add(n)
    }
  }

  // Collect all beneficiaries
  const allBenef = new Set<string>()
  for (const s of sections) {
    if (s.key_data.beneficiaires) {
      for (const b of s.key_data.beneficiaires) allBenef.add(b)
    }
  }
  if (raw?.metadata?.beneficiaires_identifies) {
    for (const b of ensureArray(raw.metadata.beneficiaires_identifies)) allBenef.add(b)
  }

  // Collect all key figures
  const allChiffres = new Set<string>()
  for (const s of sections) {
    if (s.key_data.chiffres) {
      for (const ch of s.key_data.chiffres) allChiffres.add(ch)
    }
  }
  if (raw?.metadata?.chiffres_cles) {
    for (const ch of ensureArray(raw.metadata.chiffres_cles)) allChiffres.add(ch)
  }

  return {
    extraction: {
      sections,
      synthese
    },
    metadata: {
      sections_presentes: sectionsPresentes,
      sections_absentes: sectionsAbsentes,
      sections_absentes_liste: sectionsAbsentesListe,
      secteur: raw?.metadata?.secteur || null,
      zone_geographique: raw?.metadata?.zone_geographique || null,
      odd_mentionnes: Array.from(allOdds).sort((a, b) => a - b),
      beneficiaires_identifies: Array.from(allBenef),
      chiffres_cles: Array.from(allChiffres),
      completude_pct: Math.round((sectionsPresentes / 9) * 100)
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK REGEX : extraction sans Claude
// ═══════════════════════════════════════════════════════════════

export function extractSicSectionsRegex(rawText: string): SicExtractionResult {
  const sections: SicExtractedSection[] = []
  const text = rawText || ''

  // Split text by section numbers (1- ... 2- ... etc.)
  const sectionRegex = /(?:^|\n)\s*(\d{1,2})\s*[-–.)\s]+\s*/g
  const sectionPositions: { num: number; start: number }[] = []
  let match: RegExpExecArray | null

  while ((match = sectionRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10)
    if (num >= 1 && num <= 9) {
      sectionPositions.push({ num, start: match.index })
    }
  }

  // Find SYNTHÈSE section
  const syntheseMatch = text.match(/SYNTH[ÈE]SE\s+D['']IMPACT/i)
  const syntheseStart = syntheseMatch ? text.indexOf(syntheseMatch[0]) : -1

  // Extract content for each section
  for (const tmpl of SIC_TEMPLATE_SECTIONS) {
    const pos = sectionPositions.find(p => p.num === tmpl.num)
    if (!pos) {
      sections.push({
        key: tmpl.key,
        num: tmpl.num,
        label: tmpl.label,
        present: false,
        content: '',
        summary: '',
        key_data: {}
      })
      continue
    }

    // Find the end of this section (next section start or synthese or end of text)
    const nextPositions = sectionPositions
      .filter(p => p.start > pos.start)
      .sort((a, b) => a.start - b.start)
    const endPos = nextPositions.length > 0
      ? nextPositions[0].start
      : (syntheseStart > pos.start ? syntheseStart : text.length)

    let content = text.slice(pos.start, endPos).trim()

    // Clean content: remove section number header, questions, instructions, checkboxes
    content = cleanSectionContent(content)

    const present = content.length > 15

    sections.push({
      key: tmpl.key,
      num: tmpl.num,
      label: tmpl.label,
      present,
      content: present ? content : '',
      summary: present ? buildRegexSummary(content, tmpl.key) : '',
      key_data: present ? extractKeyData(content) : {}
    })
  }

  // Extract synthese
  let phraseImpact = ''
  let maturite = 'Non précisé'
  if (syntheseStart >= 0) {
    const syntheseText = text.slice(syntheseStart)
    // Extract the impact phrase
    const phraseMatch = syntheseText.match(/Notre\s+projet\s+vise\s+[àa]\s+(.+?)(?:\n|$)/i)
    if (phraseMatch) {
      phraseImpact = 'Notre projet vise à ' + phraseMatch[1].trim()
    }
    // Extract maturity level
    if (/Scalé/i.test(syntheseText)) maturite = 'Scalé'
    else if (/Mesuré/i.test(syntheseText)) maturite = 'Mesuré'
    else if (/Déployé/i.test(syntheseText)) maturite = 'Déployé'
    else if (/Test|pilote/i.test(syntheseText)) maturite = 'Test / pilote'
    else if (/Idée/i.test(syntheseText)) maturite = 'Idée'
  }

  const sectionsPresentes = sections.filter(s => s.present).length

  // Collect metadata
  const allOdds = new Set<number>()
  const oddMatches = text.match(/ODD\s*(\d{1,2})/gi) || []
  for (const m of oddMatches) {
    const n = parseInt(m.replace(/ODD\s*/i, ''), 10)
    if (n >= 1 && n <= 17) allOdds.add(n)
  }

  // Zone geographique
  const zoneMatch = text.match(/(?:Côte\s+d['']Ivoire|Bouafl[eé]|Gagnoa|Abidjan|Afrique\s+de\s+l['']Ouest)/gi)
  const zone = zoneMatch ? [...new Set(zoneMatch)].join(', ') : null

  // Secteur detection
  let secteur: string | null = null
  if (/avicul|poulail|poule|œuf|oeufs|pondeuse/i.test(text)) secteur = 'Aviculture'
  else if (/agri|mais|maïs|soja|culture/i.test(text)) secteur = 'Agriculture'
  else if (/tech|numérique|digital/i.test(text)) secteur = 'Tech / Numérique'

  return {
    extraction: {
      sections,
      synthese: {
        present: phraseImpact.length > 10,
        phrase_impact: phraseImpact,
        maturite
      }
    },
    metadata: {
      sections_presentes: sectionsPresentes,
      sections_absentes: 9 - sectionsPresentes,
      sections_absentes_liste: sections.filter(s => !s.present).map(s => s.label),
      secteur,
      zone_geographique: zone,
      odd_mentionnes: Array.from(allOdds).sort((a, b) => a - b),
      beneficiaires_identifies: extractBeneficiaires(text),
      chiffres_cles: extractChiffres(text),
      completude_pct: Math.round((sectionsPresentes / 9) * 100)
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function cleanText(s: string): string {
  return (s || '').trim()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
}

function ensureArray(v: any): string[] {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string' && x.trim().length > 0).map(x => x.trim())
  return []
}

function ensureNumberArray(v: any): number[] {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'number' && Number.isFinite(x)).map(x => Math.round(x))
  return []
}

function cleanSectionContent(text: string): string {
  return text
    // Remove section number header
    .replace(/^\s*\d{1,2}\s*[-–.)\s]+[A-ZÀÉÈÊËÏÎÔÙÛÜÇ\s]+\n/m, '')
    // Remove template questions
    .replace(/(?:Quel|Qui|En quoi|Comment|Ce que|Ce qui|Leur|L['']impact|Plus vous|Risque de)[^\n?]*\?/g, '')
    // Remove instructions / rules
    .replace(/Règle\s*:.*$/gm, '')
    .replace(/Phrase\s+clé\s*:.*$/gm, '')
    .replace(/IMPORTANT\s*:.*$/gm, '')
    // Remove checkboxes and bullets 
    .replace(/\s*[☐☑✓✗]\s*/g, '')
    .replace(/^\s*•\s*$/gm, '')
    // Remove section sub-headers
    .replace(/^\s*•\s*(Bénéficiaires|Parties prenantes|Indicateurs|Méthode|Fréquence|Budget|Outils|Ressources)[^:]*:\s*$/gm, '')
    // Remove empty lines and normalize
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim()
}

function buildRegexSummary(content: string, key: SicSectionKey): string {
  // Extract first meaningful sentences
  const sentences = content
    .split(/[.\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && !/^[☐☑•\-]/.test(s))
    .slice(0, 3)

  if (sentences.length === 0) return content.slice(0, 200)
  return sentences.join('. ').slice(0, 300) + (sentences.join('. ').length > 300 ? '...' : '')
}

function extractKeyData(content: string): SicExtractedSection['key_data'] {
  const chiffres: string[] = []
  const oddNums: number[] = []
  const zones: string[] = []

  // Extract numbers/percentages
  const numMatches = content.match(/\d[\d\s]*(?:,\d+)?\s*(?:%|FCFA|CFA|mois|ans|jours|heures?|km|ha|tonnes?)/gi) || []
  chiffres.push(...numMatches.slice(0, 5).map(s => s.trim()))

  // Extract ODD
  const oddMatches = content.match(/ODD\s*(\d{1,2})/gi) || []
  for (const m of oddMatches) {
    const n = parseInt(m.replace(/ODD\s*/i, ''), 10)
    if (n >= 1 && n <= 17) oddNums.push(n)
  }

  // Extract zones
  const zoneMatches = content.match(/(?:Bouafl[eé]|Gagnoa|Abidjan|Yamoussoukro|Daloa|San\s*Pedro|Korhogo|Côte\s+d['']Ivoire)/gi) || []
  zones.push(...[...new Set(zoneMatches)])

  return {
    chiffres: chiffres.length > 0 ? chiffres : undefined,
    odd_mentionnes: oddNums.length > 0 ? oddNums : undefined,
    zones_geo: zones.length > 0 ? zones : undefined,
  }
}

function extractBeneficiaires(text: string): string[] {
  const results: string[] = []
  const patterns = [
    /[Bb]énéficiaires?\s+directs?\s*:?\s*(.+?)(?:\n|$)/,
    /[Bb]énéficiaires?\s+indirects?\s*:?\s*(.+?)(?:\n|$)/,
    /enfants?\s+[\w\s']+/i,
    /population\s+[\w\s']+/i,
    /couches?\s+sociales?\s+[\w\s']+/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      const val = (m[1] || m[0]).trim().slice(0, 100)
      if (val.length > 5 && !results.includes(val)) results.push(val)
    }
  }
  return results.slice(0, 5)
}

function extractChiffres(text: string): string[] {
  const results: string[] = []
  const matches = text.match(/\d[\d\s]*(?:,\d+)?\s*(?:%|FCFA|CFA|mois|ans|jours|heures?|H\b|km|ha|tonnes?)/gi) || []
  for (const m of matches) {
    const v = m.trim()
    if (v.length > 1 && !results.includes(v)) results.push(v)
  }
  return results.slice(0, 10)
}
