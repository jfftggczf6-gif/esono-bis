// ═══════════════════════════════════════════════════════════════
// DOCX Template Filler for Business Plan
// Uses fflate (ZIP) + XML string manipulation
// Fills the DOCX template with BP JSON data, preserving formatting
// ═══════════════════════════════════════════════════════════════

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

// ─── XML Utilities ────────────────────────────────────────────

/** Escape XML special characters */
function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Normalize text for comparison: replace \u00A0 (non-breaking space) with regular space, trim */
function normalize(s: string): string {
  return s.replace(/\u00A0/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').trim()
}

/** Extract visible text from an XML fragment (strip tags) */
function extractText(xml: string): string {
  const texts: string[] = []
  const re = /<w:t[^>]*>(.*?)<\/w:t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    texts.push(m[1])
  }
  return texts.join('')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}

// ─── Paragraph XML builders ──────────────────────────────────

/** Build a normal paragraph — supports **bold** markdown inline */
function makePara(text: string, bold?: boolean): string {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length === 0) return ''
  return lines.map(line => {
    const trimmed = line.trim()
    if (bold) {
      return `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${xmlEsc(trimmed)}</w:t></w:r></w:p>`
    }
    // Parse **bold** markdown inline
    return `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${buildRunsWithBold(trimmed)}</w:p>`
  }).join('')
}

/** Build XML runs handling **bold** markdown markers */
function buildRunsWithBold(text: string): string {
  // Split on **...** patterns
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map(part => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2)
      return `<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${xmlEsc(inner)}</w:t></w:r>`
    }
    if (!part) return ''
    return `<w:r><w:t xml:space="preserve">${xmlEsc(part)}</w:t></w:r>`
  }).join('')
}

/** Build a bullet-list paragraph using the template's list style */
function makeBullet(text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${xmlEsc(text.trim())}</w:t></w:r></w:p>`
}

/** Build content from markdown text — handles **bold**, bullet lists, double newlines */
function makeContent(text: string | undefined | null): string {
  if (!text || text === 'À compléter' || text === 'A completer') return ''
  // Normalize literal \\n to real newlines (from JSON double-escaped strings)
  let normalized = text.replace(/\\n/g, '\n')
  // Clean up orphan markdown bold artifacts from partial extraction
  // First: properly handle **bold** markers by keeping content (will be rendered as bold by buildRunsWithBold)
  // Only clean artifacts that are NOT valid bold markers
  normalized = normalized.replace(/^\*\*\s*:?\s*$/gm, '')         // lines that are just ** or ** :
  normalized = normalized.replace(/^\*\*\s*:\s*/gm, '')           // ** : at very start of line (no preceding word)
  normalized = normalized.replace(/\*\*\s*$/gm, '')               // trailing ** at end of line
  // Clean "word** :" artifacts — but only when ** is NOT preceded by another ** (not a bold marker)
  // e.g. "Bénéficiaires** :" should become "Bénéficiaires :" but "**Bénéficiaires**" should stay  
  normalized = normalized.replace(/(?<!\*)\*\*\s*:(\s)/g, ' :$1')  // word** : → word :
  normalized = normalized.replace(/(?<!\*)\*\*\s*(?=\n|$)/g, '')   // trailing word** at end → word
  return markdownToDocx(normalized)
}

/** Convert markdown-like text to DOCX XML paragraphs */
function markdownToDocx(text: string): string {
  let xml = ''
  // Split by double newlines into paragraphs/blocks
  const blocks = text.split(/\n\n+/)
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    // Check if block is a list (lines starting with - or * or numbered)
    const lines = trimmed.split('\n')
    let allList = true
    for (const l of lines) {
      if (!l.trim().match(/^[-*•]\s|^\d+[\.\)]\s/)) { allList = false; break }
    }
    if (allList && lines.length > 0) {
      for (const l of lines) {
        const bulletText = l.trim().replace(/^[-*•]\s+/, '').replace(/^\d+[\.\)]\s+/, '').trim()
        // Support **bold** : **label** : content format in bullets
        xml += `<w:p><w:pPr><w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${buildRunsWithBold(bulletText)}</w:p>`
      }
    } else {
      // Regular paragraph(s)
      for (const l of lines) {
        const lt = l.trim()
        if (!lt) continue
        xml += `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${buildRunsWithBold(lt)}</w:p>`
      }
    }
  }
  return xml
}

/** Build bullet list from an array */
function makeBulletList(items: any[], field?: string): string {
  if (!items || !Array.isArray(items) || items.length === 0) return ''
  return items.map(item => {
    const text = typeof item === 'string' ? item : (field ? item[field] : Object.values(item).filter(Boolean).join(' — '))
    return makeBullet(text)
  }).join('')
}

/** Format a number for display */
function fmtNum(n: any): string {
  const v = Number(String(n).replace(/\s/g, ''))
  if (isNaN(v)) return String(n || '—')
  return v.toLocaleString('fr-FR')
}

// ─── Section content builders ────────────────────────────────

function buildIntroduction(bp: any): string {
  const resume = bp.resume_executif || {}
  let xml = ''
  if (resume.synthese || resume.description) xml += makeContent(resume.synthese || resume.description)
  if (resume.points_cles?.length) {
    xml += makePara('Points clés :', true)
    xml += makeBulletList(resume.points_cles)
  }
  if (resume.montant_recherche && resume.montant_recherche !== 'À compléter') {
    xml += makePara(`Financement recherché : ${resume.montant_recherche}`, true)
  }
  if (resume.usage_fonds && resume.usage_fonds !== 'À compléter') {
    xml += makePara(`Utilisation des fonds : ${resume.usage_fonds}`)
  }
  return xml || makePara('(Section à compléter)')
}

function buildResumeGestion(bp: any): string {
  const resume = bp.resume_executif || {}
  let xml = ''
  if (resume.synthese || resume.description) xml += makeContent(resume.synthese || resume.description)
  if (resume.points_cles?.length) {
    xml += makePara('Points clés :', true)
    xml += makeBulletList(resume.points_cles)
  }
  if (resume.montant_recherche && resume.montant_recherche !== 'À compléter') {
    xml += makePara(`Financement recherché : ${resume.montant_recherche}`)
  }
  if (resume.usage_fonds && resume.usage_fonds !== 'À compléter') {
    xml += makePara(`Utilisation des fonds : ${resume.usage_fonds}`)
  }
  return xml || makePara('(À compléter)')
}

function buildRevueHistorique(bp: any): string {
  const pres = bp.presentation_entreprise || {}
  const hist = pres.revue_historique || {}
  let xml = ''
  if (hist.raison_creation) xml += makeContent(hist.raison_creation)
  if (hist.realisations_cles?.length) {
    xml += makePara('Réalisations clés :', true)
    xml += makeBulletList(hist.realisations_cles)
  }
  // Fallback: use description_generale if no sub-fields
  if (!xml && (pres.description_generale || pres.description)) {
    xml += makeContent(pres.description_generale || pres.description)
  }
  return xml || makePara('(À compléter)')
}

function buildVisionMission(bp: any): string {
  const pres = bp.presentation_entreprise || {}
  const vmv = pres.vision_mission_valeurs || {}
  let xml = ''
  if (vmv.vision) {
    xml += makePara('A : Vision :', true)
    xml += makeContent(vmv.vision)
  }
  if (vmv.mission) {
    xml += makePara('B : La mission :', true)
    xml += makeContent(vmv.mission)
  }
  if (Array.isArray(vmv.valeurs) && vmv.valeurs.length > 0) {
    xml += makePara('C : Valeurs :', true)
    for (const v of vmv.valeurs) {
      const name = typeof v === 'string' ? v : (v.valeur || v.nom || 'Valeur')
      const ex = typeof v === 'string' ? '' : (v.exemple || v.description || '')
      xml += makeBullet(`${name}${ex ? ' — ' + ex : ''}`)
    }
  }
  // Fallback: if still empty, use description_generale
  if (!xml && (pres.description_generale || pres.description)) {
    xml += makeContent(pres.description_generale || pres.description)
  }
  return xml || makePara('(À compléter)')
}

function buildEntreprise(bp: any): string {
  const pres = bp.presentation_entreprise || {}
  let xml = ''
  if (pres.description_generale || pres.description) {
    xml += makePara('A : Description générale :', true)
    xml += makeContent(pres.description_generale || pres.description)
  }
  if (pres.objectifs_smart) {
    xml += makePara('B : L\'avenir :', true)
    if (pres.objectifs_smart.court_terme_1an?.length) {
      xml += makePara('Objectifs à court terme (1 an) :')
      xml += makeBulletList(pres.objectifs_smart.court_terme_1an)
    }
    if (pres.objectifs_smart.long_terme_3_5ans?.length) {
      xml += makePara('Objectifs à long terme (3-5 ans) :')
      xml += makeBulletList(pres.objectifs_smart.long_terme_3_5ans)
    }
  }
  if (pres.operations && typeof pres.operations === 'string') {
    xml += makeContent(pres.operations)
  }
  return xml || makePara('(À compléter)')
}

function buildSwotContent(bp: any): string {
  // Only risk management text (the SWOT table itself is filled separately)
  const swot = bp.analyse_swot || {}
  let xml = ''

  // Risk management section after SWOT table
  if (swot.gestion_risques?.length) {
    xml += makePara('Gestion des risques :', true)
    // Risk table
    xml += '<w:tbl><w:tblPr><w:tblStyle w:val="Grilledutableau"/><w:tblW w:w="9072" w:type="dxa"/><w:tblBorders>'
    xml += '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '</w:tblBorders></w:tblPr>'
    // Header
    xml += '<w:tr>'
    for (const h of ['Type de risque', 'Probabilité', 'Impact', 'Mitigation']) {
      xml += `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${xmlEsc(h)}</w:t></w:r></w:p></w:tc>`
    }
    xml += '</w:tr>'
    for (const r of swot.gestion_risques) {
      xml += '<w:tr>'
      xml += `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEsc(r.type_risque || r.risque || '')}</w:t></w:r></w:p></w:tc>`
      xml += `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEsc(r.probabilite || r.probability || '')}</w:t></w:r></w:p></w:tc>`
      xml += `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEsc(r.impact || r.gravite || '')}</w:t></w:r></w:p></w:tc>`
      xml += `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEsc(r.mitigation || '')}</w:t></w:r></w:p></w:tc>`
      xml += '</w:tr>'
    }
    xml += '</w:tbl>'
  }
  // Also add risks from risques_mitigation if present
  const risques = bp.risques_mitigation || []
  if (risques.length > 0 && !swot.gestion_risques?.length) {
    xml += makePara('Gestion des risques :', true)
    xml += '<w:tbl><w:tblPr><w:tblStyle w:val="Grilledutableau"/><w:tblW w:w="9072" w:type="dxa"/><w:tblBorders>'
    xml += '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '</w:tblBorders></w:tblPr>'
    xml += '<w:tr>'
    for (const h of ['Risque', 'Probabilité', 'Impact', 'Mitigation']) {
      xml += `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${xmlEsc(h)}</w:t></w:r></w:p></w:tc>`
    }
    xml += '</w:tr>'
    for (const r of risques) {
      xml += '<w:tr>'
      xml += `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEsc(r.risque || r.type_risque || '')}</w:t></w:r></w:p></w:tc>`
      xml += `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEsc(r.probabilite || '')}</w:t></w:r></w:p></w:tc>`
      xml += `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEsc(r.impact || '')}</w:t></w:r></w:p></w:tc>`
      xml += `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEsc(r.mitigation || '')}</w:t></w:r></w:p></w:tc>`
      xml += '</w:tr>'
    }
    xml += '</w:tbl>'
  }
  return xml
}

function buildModeleEntreprise(bp: any): string {
  const modele = bp.model_economique || bp.modele_economique || bp.economic_model || {}
  const offre = bp.offre_produit_service || bp.product_service || {}
  let xml = ''

  // Fallback: if only .description exists and no structured sub-fields
  const hasSubFields = modele.segments_clients || modele.canaux_distribution || modele.sources_revenus || modele.activites_cles
  if (modele.description && !hasSubFields && !offre.proposition_valeur) {
    xml += makeContent(modele.description)
    return xml
  }

  xml += makePara('A : Produit/service et proposition de valeur unique :', true)
  if (offre.description) xml += makeContent(offre.description)
  if (offre.proposition_valeur) xml += makeContent(offre.proposition_valeur)
  if (offre.probleme_resolu) xml += makePara('Problème résolu : ' + offre.probleme_resolu)
  if (offre.avantage_concurrentiel) xml += makePara('Avantage concurrentiel : ' + offre.avantage_concurrentiel)

  xml += makePara('B : Clients, canaux d\'accès et relations avec les clients :', true)
  if (modele.segments_clients) xml += makeContent(modele.segments_clients)
  if (modele.canaux_distribution) xml += makeContent(modele.canaux_distribution)
  if (modele.relations_clients) xml += makeContent(modele.relations_clients)
  if (!modele.segments_clients && !modele.canaux_distribution) {
    // Fall back to description for clients section
    if (modele.description) xml += makeContent(modele.description.substring(0, 500))
  }

  xml += makePara('C : Revenus et dépenses :', true)
  if (modele.sources_revenus) xml += makeContent(modele.sources_revenus)
  if (modele.structure_couts) xml += makeContent(modele.structure_couts)

  xml += makePara('D : Principales activités, ressources et partenaires :', true)
  if (modele.activites_cles) xml += makeContent(modele.activites_cles)
  if (modele.ressources_cles) xml += makeContent(modele.ressources_cles)
  if (modele.partenaires_cles) xml += makeContent(modele.partenaires_cles)

  return xml || (modele.description ? makeContent(modele.description) : makePara('(À compléter)'))
}

function buildMarche(bp: any): string {
  const marche = bp.analyse_marche || bp.market_analysis || {}
  let xml = ''

  // Fallback: if only .description exists (from generate-all simplified format)
  if (marche.description && !marche.taille_marche && !marche.tendances?.length) {
    xml += makeContent(marche.description)
    return xml
  }

  xml += makePara('A : Marché et potentiel de marché :', true)
  if (marche.taille_marche) xml += makeContent(marche.taille_marche)
  if (marche.potentiel_croissance) xml += makeContent(marche.potentiel_croissance)

  xml += makePara('B : Compétitivité :', true)
  if (Array.isArray(marche.concurrents) && marche.concurrents.length > 0) {
    for (const c of marche.concurrents) {
      const name = c.nom || c.name || 'Concurrent'
      const forces = c.forces || c.strengths || ''
      xml += makeBullet(`${name}${forces ? ' — ' + forces : ''}`)
    }
  }
  if (marche.differenciation) xml += makeContent(marche.differenciation)

  xml += makePara('C : Analyses et tendances du marché :', true)
  if (marche.tendances?.length) xml += makeBulletList(marche.tendances)

  return xml || makePara('(À compléter)')
}

function buildMarketing(bp: any): string {
  const mkt = bp.strategie_marketing || bp.marketing_strategy || {}
  let xml = ''
  // Fallback: if only .description exists
  if (mkt.description && !mkt.produit && !mkt.prix) {
    xml += makeContent(mkt.description)
    return xml
  }
  if (mkt.produit) { xml += makePara('A : Produit (ou service) :', true); xml += makeContent(mkt.produit) }
  if (mkt.point_de_vente) { xml += makePara('B : Point(s) de vente :', true); xml += makeContent(mkt.point_de_vente) }
  if (mkt.prix) {
    xml += makePara('C : Prix :', true)
    if (typeof mkt.prix === 'object') {
      if (mkt.prix.prix_vente) xml += makePara('Prix de vente : ' + mkt.prix.prix_vente)
      if (mkt.prix.prix_revient) xml += makePara('Prix de revient : ' + mkt.prix.prix_revient)
      if (mkt.prix.marge) xml += makePara('Marge : ' + mkt.prix.marge)
      if (mkt.prix.strategie) xml += makePara('Stratégie : ' + mkt.prix.strategie)
    } else {
      xml += makeContent(mkt.prix)
    }
  }
  if (mkt.promotion) { xml += makePara('D : Promotion :', true); xml += makeContent(mkt.promotion) }
  if (mkt.personnel) { xml += makePara('E : Personnel :', true); xml += makeContent(mkt.personnel) }
  return xml || makePara('(À compléter)')
}

function buildEquipe(bp: any): string {
  const ops = bp.plan_operationnel || bp.operational_plan || {}
  let xml = ''
  // Fallback: if only .description exists
  if (ops.description && !ops.equipe_direction?.length && !ops.personnel) {
    xml += makeContent(ops.description)
    return xml
  }

  if (ops.equipe_direction?.length) {
    xml += makePara('A : L\'équipe de direction :', true)
    for (const m of ops.equipe_direction) {
      xml += makeBullet(`${m.nom || '—'} — ${m.role || ''}${m.competences ? ' (' + m.competences + ')' : ''}`)
    }
  }

  if (ops.personnel) {
    xml += makePara('B : Le personnel :', true)
    if (typeof ops.personnel === 'object') {
      if (ops.personnel.effectif) xml += makePara('Effectif : ' + ops.personnel.effectif)
      if (ops.personnel.qualifications) xml += makePara('Qualifications : ' + ops.personnel.qualifications)
      if (ops.personnel.politique_rh) xml += makePara('Politique RH : ' + ops.personnel.politique_rh)
    } else {
      xml += makeContent(ops.personnel)
    }
  }

  if (ops.organigramme_description) {
    xml += makePara('C : Organigramme :', true)
    xml += makeContent(ops.organigramme_description)
  }

  if (ops.conseil_administration && ops.conseil_administration !== 'À compléter') {
    xml += makePara('D : Autres parties prenantes :', true)
    xml += makeContent(ops.conseil_administration)
  }

  return xml || makePara('(À compléter)')
}

function buildDescriptionProjet(bp: any): string {
  const gouv = bp.gouvernance || bp.governance || {}
  let xml = ''
  // Fallback: if only .description exists
  if (gouv.description && !gouv.projet_description && !gouv.situation_actuelle) {
    xml += makeContent(gouv.description)
    return xml
  }
  if (gouv.projet_description) xml += makeContent(gouv.projet_description)
  if (gouv.situation_actuelle && gouv.situation_actuelle !== 'À compléter') {
    xml += makePara('Situation actuelle :', true)
    xml += makeContent(gouv.situation_actuelle)
  }
  if (gouv.duree_mise_en_oeuvre && gouv.duree_mise_en_oeuvre !== 'À compléter') {
    xml += makePara('Durée de mise en œuvre : ' + gouv.duree_mise_en_oeuvre)
  }
  if (gouv.objectif_projet && gouv.objectif_projet !== 'À compléter') {
    xml += makePara('Objectif du projet :', true)
    xml += makeContent(gouv.objectif_projet)
  }
  return xml || makePara('(À compléter)')
}

function buildImpact(bp: any): string {
  const impact = bp.impact_social || bp.social_impact || {}
  let xml = ''
  // Fallback: if only .description exists
  if (impact.description && !impact.impact_social && !impact.odd_cibles?.length) {
    xml += makeContent(impact.description)
    return xml
  }
  if (impact.impact_social) { xml += makePara('Impact social :', true); xml += makeContent(impact.impact_social) }
  if (impact.impact_environnemental) { xml += makePara('Impact environnemental :', true); xml += makeContent(impact.impact_environnemental) }
  if (impact.impact_economique) { xml += makePara('Impact économique :', true); xml += makeContent(impact.impact_economique) }
  // Only show beneficiaires if it adds new info (not already covered by other sections)
  if (impact.beneficiaires) {
    const benefText = typeof impact.beneficiaires === 'string' ? impact.beneficiaires : ''
    const alreadyCovered = [impact.impact_social, impact.impact_environnemental, impact.impact_economique]
      .filter(Boolean).join(' ')
    // Check if beneficiaires text is substantially different from what's already shown
    const benefCore = benefText.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '').substring(0, 100)
    const coveredCore = alreadyCovered.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '')
    if (benefCore && !coveredCore.includes(benefCore.substring(0, 50))) {
      xml += makePara('Bénéficiaires :', true); xml += makeContent(benefText)
    }
  }
  if (impact.odd_cibles?.length) {
    xml += makePara('ODD ciblés :', true)
    xml += makeBulletList(impact.odd_cibles)
  }
  if (impact.indicateurs?.length) {
    xml += makePara('Indicateurs d\'impact :', true)
    xml += makeBulletList(impact.indicateurs)
  }
  return xml || makePara('(À compléter)')
}

function buildFinancier(bp: any): string {
  const fin = bp.plan_financier || bp.financial_plan || {}
  let xml = ''
  // Fallback: if only .description exists AND no financial table data
  if (fin.description && !fin.plan_investissement && !fin.tableau_financier_3ans && !fin.kpis) {
    xml += makeContent(fin.description)
    return xml
  }
  // Always show description text first for narrative context
  if (fin.description) {
    xml += makeContent(fin.description)
  }

  if (fin.plan_investissement) {
    xml += makePara('A : Plan d\'investissement :', true)
    xml += makeContent(fin.plan_investissement)
  }

  if (fin.justification_financement && fin.justification_financement !== 'À compléter') {
    xml += makeContent(fin.justification_financement)
  }

  // Add info text: the financial table below is filled from the data
  xml += makePara('B : Plan financier :', true)

  // Build the 12-row financial table matching the template structure
  const ft = fin.tableau_financier_3ans || {}
  const finRows: [string, any][] = [
    ['Apport personnel', ft.apport_personnel],
    ['Prêts', ft.prets],
    ['Subventions / dons', ft.subventions_dons],
    ['Chiffre d\'affaires', ft.chiffre_affaires],
    ['Coûts directs', ft.couts_directs],
    ['Coûts indirects', ft.couts_indirects],
    ['Amortissements', ft.amortissements],
    ['Résultat net', ft.resultat_net],
    ['Cash-flow', ft.cash_flow],
    ['Valeur des actifs', ft.valeur_actifs],
    ['Dettes totales', ft.dettes_totales],
    ['Fonds propres', ft.fonds_propres],
  ]

  if (finRows.some(([, v]) => Array.isArray(v) && v.length > 0)) {
    xml += '<w:tbl><w:tblPr><w:tblStyle w:val="Grilledutableau"/><w:tblW w:w="9072" w:type="dxa"/><w:tblBorders>'
    xml += '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    xml += '</w:tblBorders></w:tblPr>'

    // Header row
    xml += '<w:tr>'
    for (const h of ['Plan financier', '1ère année', '2ème année', '3ème année']) {
      xml += `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${xmlEsc(h)}</w:t></w:r></w:p></w:tc>`
    }
    xml += '</w:tr>'

    for (const [label, values] of finRows) {
      const vals = Array.isArray(values) ? values : ['—', '—', '—']
      const isHighlight = label === 'Chiffre d\'affaires' || label === 'Résultat net' || label === 'Cash-flow'
      const fill = isHighlight ? 'E2EFDA' : ''
      xml += '<w:tr>'
      xml += `<w:tc><w:tcPr>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr><w:p><w:r>${isHighlight ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(label)}</w:t></w:r></w:p></w:tc>`
      for (const v of vals) {
        xml += `<w:tc><w:tcPr>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r>${isHighlight ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(fmtNum(v))}</w:t></w:r></w:p></w:tc>`
      }
      xml += '</w:tr>'
    }
    xml += '</w:tbl>'
  }

  // KPIs
  if (fin.kpis && Object.keys(fin.kpis).length > 0) {
    xml += makePara('Indicateurs clés :', true)
    for (const [k, v] of Object.entries(fin.kpis)) {
      if (v && v !== 'À compléter') {
        const label = k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
        xml += makePara(`${label} : ${v}`)
      }
    }
  }

  return xml || makePara('(À compléter)')
}

function buildAttentesOvo(bp: any): string {
  const att = bp.attentes_ovo || {}
  const bes = bp.besoins_financement || {}
  let xml = ''
  xml += makePara('A : Financier :', true)
  if (att.montant_demande) xml += makePara('Montant demandé : ' + att.montant_demande)
  if (att.contribution_entrepreneur) xml += makePara('Contribution de l\'entrepreneur : ' + att.contribution_entrepreneur)
  if (att.autres_investisseurs) xml += makePara('Autres investisseurs : ' + att.autres_investisseurs)
  // Fall back to besoins_financement description if no structured attentes
  if (!att.montant_demande && bes.description) {
    xml += makeContent(bes.description.substring(0, 500))
  }
  xml += makePara('B : Expertise :', true)
  if (att.expertise_necessaire) xml += makePara('Expertise nécessaire : ' + att.expertise_necessaire)
  if (att.coaching_souhaite) xml += makePara('Coaching souhaité : ' + att.coaching_souhaite)
  return xml || (bes.description ? makeContent(bes.description) : makePara('(À compléter)'))
}

// ─── Section mapping (heading text → content builder) ────────

interface SectionMapping {
  match: (text: string) => boolean
  build: (bp: any) => string
  /** If true, tables between this heading and the next are kept (not replaced) */
  keepTables?: boolean
}

const SECTION_MAPPINGS: SectionMapping[] = [
  { match: t => t === 'INTRODUCTION', build: buildIntroduction },
  { match: t => t.includes('Informations sur l'), build: () => '', keepTables: true },
  { match: t => t.includes('sum') && t.includes('gestion'), build: buildResumeGestion },
  { match: t => t.includes('Revue historique'), build: buildRevueHistorique },
  { match: t => t.includes('Vision, mission'), build: buildVisionMission },
  { match: t => normalize(t).startsWith("L'entreprise"), build: buildEntreprise },
  { match: t => t.includes('Analyse SWOT'), build: buildSwotContent, keepTables: true },
  { match: t => t.includes('le de l') && (t.includes('Mod') || t.includes('mod')), build: buildModeleEntreprise },
  { match: t => t.includes('concurrence'), build: buildMarche },
  { match: t => t.includes('vente') || t.includes('5P'), build: buildMarketing },
  { match: t => t.includes('quipe') && t.includes('organisation'), build: buildEquipe },
  { match: t => normalize(t) === 'Description generale :' || (t.includes('Description') && !t.includes('SENTATION')), build: buildDescriptionProjet },
  { match: t => normalize(t).startsWith('Impact'), build: buildImpact },
  { match: t => normalize(t).startsWith('Financier'), build: buildFinancier },
  { match: t => t.includes('Attentes') || t.includes('OVO'), build: buildAttentesOvo },
]

// ─── Table fillers (fill existing template tables in-place) ──

/**
 * Fill the Info table (Table 0): 8 rows × 2 columns
 * Row labels: Nom, Site web, Personne en contact, Courrier électronique,
 *             Téléphone, Date de création, Numéro d'entreprise, Compte bancaire
 */
function fillInfoTable(tableXml: string, bp: any): string {
  const pres = bp.presentation_entreprise || {}
  const info = pres.informations_table || {}
  const meta = bp.metadata || {}

  // Map row labels (from template) to BP data values
  const valueMap: Record<string, string> = {
    'nom': info.nom || meta.entreprise || '',
    'site web': info.site_web || '',
    'personne en contact': info.contact || meta.entrepreneur || '',
    'courrier': info.email || '',
    'phone': info.telephone || '',
    'date de cr': info.date_creation || '',
    'num': info.numero_entreprise || '',
    'compte': info.compte_bancaire || '',
    'adresse': info.adresse || '',
    'forme': info.forme_juridique || '',
  }

  // Process each row: find empty second cell and fill it
  const rowRegex = /<w:tr\b[^>]*>.*?<\/w:tr>/gs
  let result = tableXml
  const rows = [...tableXml.matchAll(rowRegex)]

  for (const rowMatch of rows) {
    const rowXml = rowMatch[0]
    // Extract text from first cell to identify row
    const cellRegex = /<w:tc\b[^>]*>.*?<\/w:tc>/gs
    const cells = [...rowXml.matchAll(cellRegex)]
    if (cells.length < 2) continue

    const labelText = normalize(extractText(cells[0][0])).toLowerCase()

    // Find matching value
    let value = ''
    for (const [key, val] of Object.entries(valueMap)) {
      if (labelText.includes(key)) {
        value = val
        break
      }
    }
    if (!value || value === 'À compléter') continue

    // Replace the second cell's paragraph content
    const secondCell = cells[1][0]
    // Find the paragraph(s) in the second cell and insert text
    const newSecondCell = secondCell.replace(
      /(<w:p\b[^>]*>)(.*?)(<\/w:p>)/s,
      (_, pOpen, _content, pClose) => {
        // Preserve paragraph properties if any
        const pprMatch = _content.match(/(<w:pPr\b.*?<\/w:pPr>)/)
        const ppr = pprMatch ? pprMatch[1] : ''
        // Get run properties from existing runs
        const rprMatch = _content.match(/(<w:rPr\b.*?<\/w:rPr>)/)
        const rpr = rprMatch ? rprMatch[1] : ''
        return `${pOpen}${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(value)}</w:t></w:r>${pClose}`
      }
    )
    result = result.replace(secondCell, newSecondCell)
  }

  return result
}

/**
 * Fill the SWOT table (Table 1): 2 rows × 2 columns
 * Row 0: Points forts (internes) | Faiblesses (internes)
 * Row 1: Opportunités (externes) | Menaces (externes)
 */
function fillSwotTable(tableXml: string, bp: any): string {
  const swot = bp.analyse_swot || {}

  // The SWOT data: forces, faiblesses, opportunites, menaces
  const cellData: string[][] = [
    swot.forces || [],
    swot.faiblesses || [],
    swot.opportunites || [],
    swot.menaces || [],
  ]

  // Find rows and cells
  const rowRegex = /<w:tr\b[^>]*>.*?<\/w:tr>/gs
  const rows = [...tableXml.matchAll(rowRegex)]
  let result = tableXml

  const cellIndex = [
    [0, 1],  // Row 0: forces, faiblesses
    [2, 3],  // Row 1: opportunites, menaces
  ]

  for (let ri = 0; ri < Math.min(rows.length, 2); ri++) {
    const rowXml = rows[ri][0]
    const cellRegex = /<w:tc\b[^>]*>.*?<\/w:tc>/gs
    const cells = [...rowXml.matchAll(cellRegex)]
    if (cells.length < 2) continue

    for (let ci = 0; ci < 2; ci++) {
      const dataIdx = cellIndex[ri][ci]
      const items = cellData[dataIdx]
      if (!items || items.length === 0) continue

      const cellXml = cells[ci][0]
      // Build replacement content: keep the header paragraph, add item paragraphs
      const paragraphs = [...cellXml.matchAll(/<w:p\b[^>]*>.*?<\/w:p>/gs)]
      if (paragraphs.length === 0) continue

      // Keep the first paragraph (header/title) and replace the rest
      const headerPara = paragraphs[0][0]
      // Get cell properties
      const tcPrMatch = cellXml.match(/<w:tcPr\b.*?<\/w:tcPr>/s)
      const tcPr = tcPrMatch ? tcPrMatch[0] : ''

      let newCell = `<w:tc>${tcPr}${headerPara}`
      for (const item of items) {
        newCell += `<w:p><w:r><w:t xml:space="preserve">- ${xmlEsc(item)}</w:t></w:r></w:p>`
      }
      newCell += '</w:tc>'

      result = result.replace(cellXml, newCell)
    }
  }

  return result
}

/**
 * Fill the Financial table (Table 2): 12 rows × 4 columns
 * Header: Plan financier | 1ère année | 2ème année | 3ème année
 * Row labels mapped to BP financial data
 */
function fillFinancialTable(tableXml: string, bp: any): string {
  const fin = bp.plan_financier || bp.financial_plan || {}
  const ft = fin.tableau_financier_3ans || {}

  // Map row label keywords → data arrays [year1, year2, year3]
  // Template labels: Contribution des entreprises locales, Prêts bancaires locaux,
  //   Prêts de l'étranger, Subventions, Total, Revenu, Dépenses, Marge brute,
  //   Bénéfice net, CA seuil de rentabilité, Bilan final trésorerie
  const labelToData: { match: string; data: any[] | undefined }[] = [
    { match: 'contribution', data: ft.apport_personnel },
    { match: 'bancaires', data: ft.prets },
    { match: 'tranger', data: ft.prets },  // prêts de l'étranger → same or zeros
    { match: 'subvention', data: ft.subventions_dons },
    { match: 'total', data: undefined },  // computed
    { match: 'revenu', data: ft.chiffre_affaires },
    { match: 'pense', data: ft.couts_directs },  // dépenses → coûts directs
    { match: 'marge brute', data: undefined },  // computed
    { match: 'fice net', data: ft.resultat_net },  // bénéfice net
    { match: 'seuil', data: undefined },
    { match: 'sorerie', data: ft.cash_flow },  // trésorerie
  ]

  // Compute total = apport + prêts + subventions
  const computeTotal = () => {
    const ap = ft.apport_personnel || [0, 0, 0]
    const pr = ft.prets || [0, 0, 0]
    const sub = ft.subventions_dons || [0, 0, 0]
    return [0, 1, 2].map(i => (Number(ap[i]) || 0) + (Number(pr[i]) || 0) + (Number(sub[i]) || 0))
  }

  // Compute marge brute = CA - coûts directs
  const computeMargin = () => {
    const ca = ft.chiffre_affaires || [0, 0, 0]
    const cd = ft.couts_directs || [0, 0, 0]
    return [0, 1, 2].map(i => (Number(ca[i]) || 0) - (Number(cd[i]) || 0))
  }

  // Process each row
  const rowRegex = /<w:tr\b[^>]*>.*?<\/w:tr>/gs
  const rows = [...tableXml.matchAll(rowRegex)]
  let result = tableXml

  for (let ri = 1; ri < rows.length; ri++) {  // Skip header row (ri=0)
    const rowXml = rows[ri][0]
    const cellRegex = /<w:tc\b[^>]*>.*?<\/w:tc>/gs
    const cells = [...rowXml.matchAll(cellRegex)]
    if (cells.length < 4) continue

    const labelText = normalize(extractText(cells[0][0])).toLowerCase()

    // Find matching data
    let data: any[] | undefined
    for (const mapping of labelToData) {
      if (labelText.includes(mapping.match)) {
        data = mapping.data
        break
      }
    }

    // Handle computed rows
    if (labelText.includes('total')) {
      data = computeTotal()
    } else if (labelText.includes('marge brute')) {
      data = computeMargin()
    }

    if (!data || !Array.isArray(data) || data.length === 0) continue

    // Fill cells 1, 2, 3 with data values
    let newRow = rowXml
    for (let ci = 1; ci <= 3; ci++) {
      if (ci - 1 >= data.length) break
      const cellXml = cells[ci][0]
      const val = fmtNum(data[ci - 1])

      // Replace the cell paragraph content with the value
      const newCell = cellXml.replace(
        /(<w:p\b[^>]*>)(.*?)(<\/w:p>)/s,
        (_, pOpen, content, pClose) => {
          const pprMatch = content.match(/(<w:pPr\b.*?<\/w:pPr>)/)
          const ppr = pprMatch ? pprMatch[1] : ''
          const rprMatch = content.match(/(<w:rPr\b.*?<\/w:rPr>)/)
          const rpr = rprMatch ? rprMatch[1] : ''
          return `${pOpen}${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(val)}</w:t></w:r>${pClose}`
        }
      )
      newRow = newRow.replace(cellXml, newCell)
    }
    result = result.replace(rowXml, newRow)
  }

  return result
}

// ═══════════════════════════════════════════════════════════════
// Main DOCX filler function
// ═══════════════════════════════════════════════════════════════

export function fillDocxTemplate(templateBase64: string, bpData: any): Uint8Array {
  console.log('[DOCX Filler] Starting template filling...')

  // 1. Decode base64 → unzip
  const binaryStr = atob(templateBase64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

  const unzipped = unzipSync(bytes)

  // 2. Read document.xml
  const docXmlBytes = unzipped['word/document.xml']
  if (!docXmlBytes) throw new Error('document.xml not found in template')
  let docXml = strFromU8(docXmlBytes)

  // 3. Parse all body-level elements (paragraphs and tables)
  // We need to identify: paragraphs with heading styles, tables, and content paragraphs
  interface BodyElement {
    type: 'paragraph' | 'table' | 'sdt' | 'other'
    xml: string
    index: number  // char position in docXml
    end: number    // end char position
    headingLevel?: number  // 1 or 2 for Titre1/Titre2
    headingText?: string   // normalized heading text
  }

  const bodyElements: BodyElement[] = []

  // Match paragraphs and tables at the top level within w:body
  // We need to handle both <w:p> and <w:tbl> elements
  const elementRegex = /(<w:p\b[^>]*>.*?<\/w:p>|<w:tbl\b[^>]*>.*?<\/w:tbl>|<w:sdt\b[^>]*>.*?<\/w:sdt>)/gs
  let em: RegExpExecArray | null
  while ((em = elementRegex.exec(docXml)) !== null) {
    const xml = em[0]
    const idx = em.index
    const end = idx + xml.length

    if (xml.startsWith('<w:p')) {
      const styleMatch = xml.match(/<w:pStyle w:val="(Titre1|Titre2)"/)
      const el: BodyElement = { type: 'paragraph', xml, index: idx, end }

      if (styleMatch) {
        const rawText = extractText(xml)
        el.headingLevel = styleMatch[1] === 'Titre1' ? 1 : 2
        el.headingText = normalize(rawText)
      }
      bodyElements.push(el)
    } else if (xml.startsWith('<w:tbl')) {
      bodyElements.push({ type: 'table', xml, index: idx, end })
    } else if (xml.startsWith('<w:sdt')) {
      bodyElements.push({ type: 'sdt', xml, index: idx, end })
    }
  }

  console.log(`[DOCX Filler] Found ${bodyElements.length} body elements`)

  // 4. Fill existing tables (Info, SWOT, Financial)
  // Table identification by position relative to headings
  let tableCounter = 0
  for (let i = 0; i < bodyElements.length; i++) {
    if (bodyElements[i].type !== 'table') continue

    const tbl = bodyElements[i]
    const tblText = normalize(extractText(tbl.xml)).toLowerCase()

    let filledXml: string | null = null

    if (tableCounter === 0) {
      // Table 0: Info table (Nom, Site web, etc.)
      console.log('[DOCX Filler] Filling info table (Table 0)')
      filledXml = fillInfoTable(tbl.xml, bpData)
    } else if (tableCounter === 1) {
      // Table 1: SWOT table (2x2 matrix)
      console.log('[DOCX Filler] Filling SWOT table (Table 1)')
      filledXml = fillSwotTable(tbl.xml, bpData)
    } else if (tableCounter === 2) {
      // Table 2: Financial table
      console.log('[DOCX Filler] Filling financial table (Table 2)')
      filledXml = fillFinancialTable(tbl.xml, bpData)
    }

    if (filledXml) {
      docXml = docXml.slice(0, tbl.index) + filledXml + docXml.slice(tbl.end)
      // Update indices for subsequent elements
      const delta = filledXml.length - tbl.xml.length
      for (let j = i + 1; j < bodyElements.length; j++) {
        bodyElements[j].index += delta
        bodyElements[j].end += delta
      }
      bodyElements[i].xml = filledXml
      bodyElements[i].end = tbl.index + filledXml.length
    }
    tableCounter++
  }

  // 5. Now re-parse after table updates to get correct indices
  bodyElements.length = 0
  elementRegex.lastIndex = 0
  while ((em = elementRegex.exec(docXml)) !== null) {
    const xml = em[0]
    const idx = em.index
    const end = idx + xml.length

    if (xml.startsWith('<w:p')) {
      const styleMatch = xml.match(/<w:pStyle w:val="(Titre1|Titre2)"/)
      const el: BodyElement = { type: 'paragraph', xml, index: idx, end }
      if (styleMatch) {
        el.headingLevel = styleMatch[1] === 'Titre1' ? 1 : 2
        el.headingText = normalize(extractText(xml))
      }
      bodyElements.push(el)
    } else if (xml.startsWith('<w:tbl')) {
      bodyElements.push({ type: 'table', xml, index: idx, end })
    } else if (xml.startsWith('<w:sdt')) {
      bodyElements.push({ type: 'sdt', xml, index: idx, end })
    }
  }

  // 6. Build heading → section ranges and replace content
  // For each heading that has a mapping, replace content between heading and next heading/table
  interface SectionRange {
    headingIdx: number     // index in bodyElements
    headingText: string
    contentStart: number   // char position after heading paragraph
    contentEnd: number     // char position of next heading or end of body
    mapping: SectionMapping
    // Elements to preserve (tables within this section that should be kept)
    preservedElements: BodyElement[]
  }

  const sections: SectionRange[] = []

  // Find content headings (skip TOC/empty headings)
  const headingIndices: number[] = []
  for (let i = 0; i < bodyElements.length; i++) {
    if (bodyElements[i].headingLevel && bodyElements[i].headingText && bodyElements[i].headingText!.length > 0) {
      headingIndices.push(i)
    }
  }

  // Skip first few headings if they're TOC entries (empty or very early)
  const contentHeadingIndices = headingIndices.filter(idx => {
    const el = bodyElements[idx]
    // Skip empty headings and very early ones (TOC)
    return el.headingText && el.headingText.length > 2 && idx > 3
  })

  for (let hi = 0; hi < contentHeadingIndices.length; hi++) {
    const hIdx = contentHeadingIndices[hi]
    const heading = bodyElements[hIdx]
    const nextHIdx = hi + 1 < contentHeadingIndices.length ? contentHeadingIndices[hi + 1] : -1

    const headingText = heading.headingText || ''
    const mapping = SECTION_MAPPINGS.find(sm => sm.match(headingText))

    if (!mapping) {
      // No mapping for this heading (e.g., parent H1s like "PRÉSENTATION DE L'ENTREPRISE")
      // Skip — don't replace content for unmatched headings
      continue
    }

    const contentStart = heading.end
    let contentEnd: number

    if (nextHIdx >= 0) {
      contentEnd = bodyElements[nextHIdx].index
    } else {
      const bodyEndIdx = docXml.indexOf('</w:body>')
      contentEnd = bodyEndIdx > 0 ? bodyEndIdx : docXml.length
    }

    // Collect tables within this section that should be preserved
    const preservedElements: BodyElement[] = []
    if (mapping.keepTables) {
      for (let ei = hIdx + 1; ei < bodyElements.length; ei++) {
        if (bodyElements[ei].index >= contentEnd) break
        if (bodyElements[ei].type === 'table') {
          preservedElements.push(bodyElements[ei])
        }
      }
    }

    sections.push({
      headingIdx: hIdx,
      headingText,
      contentStart,
      contentEnd,
      mapping,
      preservedElements,
    })
  }

  console.log(`[DOCX Filler] Processing ${sections.length} sections`)

  // 7. Apply replacements in reverse order to preserve indices
  sections.sort((a, b) => b.contentStart - a.contentStart)

  for (const section of sections) {
    const newContent = section.mapping.build(bpData)

    if (section.preservedElements.length > 0) {
      // Keep existing tables in place, insert generated content after them
      // Order: preserved tables first (e.g. SWOT matrix), then new content (e.g. risk table)
      const preservedXml = section.preservedElements.map(el => el.xml).join('')
      docXml = docXml.slice(0, section.contentStart) + preservedXml + newContent + docXml.slice(section.contentEnd)
    } else {
      docXml = docXml.slice(0, section.contentStart) + newContent + docXml.slice(section.contentEnd)
    }
  }

  // 8. Clean up any remaining template placeholder/guidance text
  // Remove paragraphs that contain template guidance questions
  const guidancePatterns = [
    'Quels sont', 'Quel est l', 'Quelle est la', 'Quelles sont',
    'Décrivez brièvement', 'Formulez des', 'Identifiez les',
    'Ce chapitre fournit', 'Ce chapitre donne', 'Ce document fournit',
    'Ce résumé met en', 'Bien que le Business',
    'Décrivez votre', 'Expliquez comment', 'Listez les',
    'Comment votre', 'Comment gérerez',
    'Pourquoi votre', 'Pourquoi l',
    'Fournir des preuves', 'Fournissez des',
    'Une analyse SWOT', 'Si l\'analyse SWOT',
    'Les chiffres ci-dessus', 'Utilisez pour cela',
    'À compléter',
  ]

  // Find and remove guidance paragraphs (but NOT from headings or tables)
  for (const pattern of guidancePatterns) {
    const regex = new RegExp(`<w:p\\b[^>]*>(?:(?!<w:pStyle w:val="Titre[12]")[\\s\\S])*?${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?<\\/w:p>`, 'g')
    // We need to be careful not to remove heading paragraphs
    // Simpler approach: match paragraphs that contain the guidance text but are NOT headings
    const matches = [...docXml.matchAll(/<w:p\b[^>]*>.*?<\/w:p>/gs)]
    for (const m of matches.reverse()) {
      const paraXml = m[0]
      // Skip if it's a heading
      if (paraXml.includes('w:val="Titre1"') || paraXml.includes('w:val="Titre2"')) continue
      // Skip if it's inside a table (rough check)
      const before = docXml.slice(Math.max(0, m.index! - 20), m.index!)
      if (before.includes('</w:tc') || before.includes('<w:tc>')) continue

      const text = extractText(paraXml)
      if (text.includes(pattern)) {
        docXml = docXml.slice(0, m.index!) + docXml.slice(m.index! + m[0].length)
      }
    }
  }

  console.log('[DOCX Filler] Template filling complete')

  // 9. Re-zip with modified document.xml
  unzipped['word/document.xml'] = strToU8(docXml)

  const zipped = zipSync(unzipped, { level: 6 })
  return zipped
}
