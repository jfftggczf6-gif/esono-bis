// ═══════════════════════════════════════════════════════════════════
// BMC Analysé — Deliverable Page
// Pixel-perfect reproduction of BMC_GOTCHE_FINAL.pdf template
// Sections: Header → Score → Canvas Grid → Diagnostic Scores → Forces/Vigilance → SWOT → Recommandations → Footer
// ═══════════════════════════════════════════════════════════════════

import { escapeHtml, getScoreColor, getScoreLabel } from './deliverable-utils'

/** Full structured BMC data expected from AI agent */
export interface BMCData {
  // Global
  score: number
  company_name: string
  subtitle: string // e.g. "Production & Distribution d'Œufs de Table — Marque OEUFS TICIA"
  location: string // e.g. "BOUAFLÉ & GAGNOA — Côte d'Ivoire"
  sector: string // e.g. "PME Agroalimentaire"
  analysis_date: string
  value_chain: string // e.g. "Chaîne intégrée maïs → œuf"

  // Key tags (badges on score bar)
  tags: { label: string, type: 'success' | 'warning' | 'danger' | 'info' }[]

  // Proposition de valeur (central quote)
  value_proposition_quote: string

  // Canvas blocks — all 9 BMC blocks
  canvas: {
    partenaires_cles: { items: { title: string, detail: string, critical?: boolean }[] }
    activites_cles: { items: { title: string, detail: string, critical?: boolean }[] }
    ressources_cles: { items: { title: string, detail: string, critical?: boolean }[] }
    proposition_valeur: { items: { icon: string, title: string, detail: string }[] }
    relations_clients: { items: { title: string, detail: string }[] }
    canaux: { items: { title: string, detail: string }[] }
    segments_clients: { items: { title: string, detail: string }[] }
    structure_couts: {
      items: { title: string, amount: string, type: string, pct: string }[]
      total: string
      critical_cost: string
    }
    flux_revenus: {
      items: { title: string, detail: string }[]
      ca_mensuel: string
      marge_brute: string
    }
  }

  // Diagnostic scores per block
  block_scores: {
    name: string
    score: number
    color: string // green/orange/red
    comment: string
  }[]

  // Forces (strengths)
  forces: {
    count: number
    items: { title: string, description: string }[]
  }

  // Points de vigilance (risks)
  vigilance: {
    count: number
    items: { title: string, description: string, recommendation: string }[]
  }

  // SWOT
  swot: {
    forces: string[]
    faiblesses: string[]
    opportunites: string[]
    menaces: string[]
  }

  // Recommandations stratégiques
  recommandations: {
    court_terme: { title: string, content: string }
    moyen_terme: { title: string, content: string }
    long_terme: { title: string, content: string }
  }
}

export function renderBMCPage(data: BMCData, userName: string): string {
  const sc = data.score || 0
  const scoreColor = sc >= 70 ? '#059669' : sc >= 50 ? '#d97706' : '#dc2626'

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BMC Analysé — ${escapeHtml(data.company_name || userName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f9fafb; color: #374151; }
    
    /* ── NAV ── */
    .bmc-nav { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
    .bmc-nav a { color: #6366f1; font-size: 13px; font-weight: 500; text-decoration: none; display: flex; align-items: center; gap: 6px; }
    .bmc-nav a:hover { color: #4338ca; }
    .bmc-nav__right { display: flex; gap: 8px; }
    .bmc-nav__btn { padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s; }
    .bmc-nav__btn--pdf { background: #6366f1; color: #fff; }
    .bmc-nav__btn--pdf:hover { background: #4338ca; }
    .bmc-nav__btn--print { background: #f3f4f6; color: #374151; }
    .bmc-nav__btn--print:hover { background: #e5e7eb; }

    /* ── HEADER (dark green gradient) ── */
    .bmc-header { background: linear-gradient(135deg, #1a3c34 0%, #2d5a4e 60%, #3d7a6a 100%); color: #fff; padding: 48px 48px 36px; position: relative; overflow: hidden; }
    .bmc-header::before { content: ''; position: absolute; top: -60%; right: -10%; width: 60%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%); }
    .bmc-header__badge { display: inline-block; padding: 6px 16px; border: 1px solid rgba(255,255,255,0.25); border-radius: 4px; font-size: 11px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.85); margin-bottom: 20px; }
    .bmc-header__company { font-size: 42px; font-weight: 900; line-height: 1.1; margin-bottom: 10px; }
    .bmc-header__subtitle { font-size: 16px; font-weight: 500; color: rgba(255,255,255,0.85); margin-bottom: 20px; }
    .bmc-header__meta { display: flex; gap: 24px; flex-wrap: wrap; font-size: 13px; color: rgba(255,255,255,0.65); }
    .bmc-header__meta-item { display: flex; align-items: center; gap: 6px; }
    .bmc-header__meta-item i { font-size: 14px; }

    /* ── SCORE BAR ── */
    .bmc-score { background: #fff; border: 1px solid #e5e7eb; margin: -24px 48px 0; border-radius: 16px; padding: 24px 32px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; position: relative; z-index: 10; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
    .bmc-score__left { display: flex; align-items: center; gap: 16px; }
    .bmc-score__number { font-size: 42px; font-weight: 900; line-height: 1; }
    .bmc-score__label { font-size: 16px; font-weight: 700; color: #1f2937; }
    .bmc-score__sublabel { font-size: 13px; color: #6b7280; }
    .bmc-score__tags { display: flex; gap: 8px; flex-wrap: wrap; }
    .bmc-tag { display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 99px; font-size: 12px; font-weight: 600; border: 1px solid; }
    .bmc-tag--success { background: #ecfdf5; color: #059669; border-color: #a7f3d0; }
    .bmc-tag--warning { background: #fffbeb; color: #d97706; border-color: #fde68a; }
    .bmc-tag--danger { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
    .bmc-tag--info { background: #eff6ff; color: #2563eb; border-color: #bfdbfe; }

    /* ── MAIN CONTENT AREA ── */
    .bmc-main { max-width: 1200px; margin: 0 auto; padding: 40px 48px; }

    /* ── SECTION TITLES ── */
    .bmc-section-title { font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #9ca3af; margin-bottom: 24px; }

    /* ── CANVAS GRID (5 columns) ── */
    .bmc-canvas { display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: auto auto; gap: 0; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; background: #fff; margin-bottom: 48px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .bmc-canvas__cell { padding: 20px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
    .bmc-canvas__cell:nth-child(5n) { border-right: none; }
    .bmc-canvas__cell--header { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #1a6b52; margin-bottom: 16px; display: flex; align-items: center; gap: 6px; }
    .bmc-canvas__cell--header i { font-size: 12px; }
    
    /* The central value prop cell spans rows */
    .bmc-canvas__vp { grid-column: 3; grid-row: 1 / 3; display: flex; flex-direction: column; }
    .bmc-canvas__vp-quote { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px; margin-top: auto; font-style: italic; font-size: 13px; color: #166534; line-height: 1.6; text-align: center; }

    /* Activities (row 1) + Resources (row 2) share column 2 */
    .bmc-canvas__act-res { grid-column: 2; }
    
    /* Relations (row 1) + Channels (row 2) share column 4 */
    .bmc-canvas__rel-chan { grid-column: 4; }
    
    /* Bottom row: costs + revenue spanning full width */
    .bmc-canvas__bottom { grid-column: 1 / 4; border-right: 1px solid #e5e7eb; }
    .bmc-canvas__bottom-right { grid-column: 4 / 6; border-right: none; }

    .bmc-item { margin-bottom: 12px; }
    .bmc-item__title { font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 2px; }
    .bmc-item__detail { font-size: 12px; color: #6b7280; line-height: 1.5; }
    .bmc-item__critical { display: inline-block; background: #fecaca; color: #dc2626; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 6px; }

    /* ── DIAGNOSTIC SCORES ── */
    .bmc-diag { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 32px; margin-bottom: 48px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .bmc-diag__header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .bmc-diag__header-icon { font-size: 18px; }
    .bmc-diag__header-title { font-size: 18px; font-weight: 800; color: #1f2937; }
    .bmc-diag__global { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 99px; background: #ecfdf5; border: 1px solid #a7f3d0; font-size: 13px; font-weight: 700; color: #059669; margin-left: 12px; }
    .bmc-score-row { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid #f3f4f6; }
    .bmc-score-row:last-child { border-bottom: none; }
    .bmc-score-row__name { width: 180px; font-size: 14px; font-weight: 600; color: #1f2937; flex-shrink: 0; }
    .bmc-score-row__bar { flex: 1; height: 8px; background: #e5e7eb; border-radius: 99px; overflow: hidden; }
    .bmc-score-row__bar-fill { height: 100%; border-radius: 99px; transition: width 0.8s ease; }
    .bmc-score-row__pct { width: 48px; text-align: right; font-size: 18px; font-weight: 800; flex-shrink: 0; }
    .bmc-score-row__comment { font-size: 12px; color: #9ca3af; max-width: 280px; flex-shrink: 0; }

    /* ── FORCES / VIGILANCE (2 columns) ── */
    .bmc-fv { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 48px; }
    .bmc-fv__col { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .bmc-fv__title { font-size: 18px; font-weight: 800; color: #1f2937; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .bmc-fv__badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .bmc-fv__badge--green { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
    .bmc-fv__badge--orange { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
    .bmc-fv__item { margin-top: 20px; }
    .bmc-fv__item-title { font-size: 15px; font-weight: 700; color: #1f2937; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .bmc-fv__item-text { font-size: 13px; color: #6b7280; line-height: 1.7; }
    .bmc-fv__item-rec { font-size: 13px; color: #d97706; font-style: italic; margin-top: 4px; }

    /* ── SWOT MATRIX ── */
    .bmc-swot { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 32px; margin-bottom: 48px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .bmc-swot__title { font-size: 18px; font-weight: 800; color: #1f2937; display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
    .bmc-swot__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
    .bmc-swot__cell { padding: 20px; }
    .bmc-swot__cell:nth-child(1) { border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
    .bmc-swot__cell:nth-child(2) { border-bottom: 1px solid #e5e7eb; }
    .bmc-swot__cell:nth-child(3) { border-right: 1px solid #e5e7eb; }
    .bmc-swot__cell-title { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid; }
    .bmc-swot__cell-title--forces { color: #059669; border-color: #059669; }
    .bmc-swot__cell-title--faiblesses { color: #dc2626; border-color: #dc2626; }
    .bmc-swot__cell-title--opportunites { color: #2563eb; border-color: #2563eb; }
    .bmc-swot__cell-title--menaces { color: #dc2626; border-color: #dc2626; }
    .bmc-swot__item { font-size: 13px; color: #374151; padding: 4px 0; display: flex; align-items: flex-start; gap: 6px; }
    .bmc-swot__item i { margin-top: 3px; font-size: 11px; }

    /* ── RECOMMANDATIONS ── */
    .bmc-reco { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 32px; margin-bottom: 48px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .bmc-reco__title { font-size: 18px; font-weight: 800; color: #1f2937; display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
    .bmc-reco__plan-badge { display: inline-flex; padding: 3px 10px; border-radius: 99px; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; font-size: 11px; font-weight: 600; }
    .bmc-reco__timeline { position: relative; padding-left: 36px; }
    .bmc-reco__timeline::before { content: ''; position: absolute; left: 14px; top: 0; bottom: 0; width: 2px; background: #e5e7eb; }
    .bmc-reco__step { position: relative; margin-bottom: 28px; }
    .bmc-reco__step:last-child { margin-bottom: 0; }
    .bmc-reco__dot { position: absolute; left: -30px; top: 4px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #059669; background: #fff; }
    .bmc-reco__step-title { font-size: 15px; font-weight: 700; color: #059669; margin-bottom: 8px; }
    .bmc-reco__step-text { font-size: 13px; color: #4b5563; line-height: 1.7; }
    .bmc-reco__step-text strong { color: #1f2937; }

    /* ── FOOTER ── */
    .bmc-footer { text-align: center; padding: 40px 48px; color: #9ca3af; font-size: 12px; }
    .bmc-footer__company { font-weight: 700; color: #6b7280; }
    .bmc-footer__quote { font-style: italic; color: #059669; margin-top: 12px; font-size: 13px; }

    /* ── PRINT ── */
    @media print {
      .bmc-nav { display: none !important; }
      body { background: #fff; }
      .bmc-header { break-after: avoid; }
      .bmc-canvas, .bmc-diag, .bmc-fv, .bmc-swot, .bmc-reco { break-inside: avoid; page-break-inside: avoid; }
      .bmc-score { box-shadow: none; border: 1px solid #e5e7eb; }
    }

    @media (max-width: 900px) {
      .bmc-header { padding: 32px 20px 24px; }
      .bmc-score { margin: -16px 20px 0; padding: 16px; flex-direction: column; align-items: flex-start; }
      .bmc-main { padding: 24px 20px; }
      .bmc-canvas { display: flex; flex-direction: column; }
      .bmc-fv { grid-template-columns: 1fr; }
      .bmc-score-row { flex-wrap: wrap; }
      .bmc-score-row__comment { max-width: 100%; margin-top: 4px; }
    }
  </style>
</head>
<body>
  <!-- NAV -->
  <nav class="bmc-nav">
    <a href="/entrepreneur"><i class="fas fa-arrow-left"></i> Retour</a>
    <div class="bmc-nav__right">
      <button class="bmc-nav__btn bmc-nav__btn--print" onclick="window.print()"><i class="fas fa-print"></i> Imprimer</button>
      <button class="bmc-nav__btn bmc-nav__btn--pdf" onclick="window.print()"><i class="fas fa-file-pdf"></i> Télécharger PDF</button>
    </div>
  </nav>

  <!-- HEADER -->
  <header class="bmc-header">
    <div class="bmc-header__badge">BUSINESS MODEL CANVAS</div>
    <h1 class="bmc-header__company">${escapeHtml(data.company_name || userName)}</h1>
    <p class="bmc-header__subtitle">${escapeHtml(data.subtitle || '')}</p>
    <div class="bmc-header__meta">
      ${data.location ? `<span class="bmc-header__meta-item"><i class="fas fa-location-dot"></i> ${escapeHtml(data.location)}</span>` : ''}
      ${data.sector ? `<span class="bmc-header__meta-item"><i class="fas fa-industry"></i> ${escapeHtml(data.sector)}</span>` : ''}
      ${data.analysis_date ? `<span class="bmc-header__meta-item"><i class="fas fa-calendar"></i> Analyse — ${escapeHtml(data.analysis_date)}</span>` : ''}
      ${data.value_chain ? `<span class="bmc-header__meta-item"><i class="fas fa-link"></i> ${escapeHtml(data.value_chain)}</span>` : ''}
    </div>
  </header>

  <!-- SCORE BAR -->
  <section class="bmc-score">
    <div class="bmc-score__left">
      <div class="bmc-score__number" style="color:${scoreColor}">${sc}%</div>
      <div>
        <div class="bmc-score__label">Score BMC Global</div>
        <div class="bmc-score__sublabel">Maturité du business model</div>
      </div>
    </div>
    <div class="bmc-score__tags">
      ${(data.tags || []).map(t => `<span class="bmc-tag bmc-tag--${t.type}"><i class="fas ${t.type === 'success' ? 'fa-check' : t.type === 'warning' ? 'fa-triangle-exclamation' : t.type === 'danger' ? 'fa-triangle-exclamation' : 'fa-arrow-right'}"></i> ${escapeHtml(t.label)}</span>`).join('')}
    </div>
  </section>

  <main class="bmc-main">
    <!-- CANVAS — VUE D'ENSEMBLE -->
    <div class="bmc-section-title">CANVAS — VUE D'ENSEMBLE</div>
    <div class="bmc-canvas">
      <!-- Row 1 Top: Partenaires | Activités | Proposition | Relations | Segments -->
      <div class="bmc-canvas__cell" style="grid-column:1; grid-row:1/3;">
        <div class="bmc-canvas__cell--header"><i class="fas fa-handshake"></i> PARTENAIRES CLÉS</div>
        ${(data.canvas?.partenaires_cles?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› ${escapeHtml(i.title)}${i.critical ? '<span class="bmc-item__critical">CRITIQUE</span>' : ''}</div>
            <div class="bmc-item__detail">${escapeHtml(i.detail)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Column 2: Activités (row 1) -->
      <div class="bmc-canvas__cell bmc-canvas__act-res" style="grid-row:1;">
        <div class="bmc-canvas__cell--header"><i class="fas fa-cogs"></i> ACTIVITÉS CLÉS</div>
        ${(data.canvas?.activites_cles?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› ${escapeHtml(i.title)}${i.critical ? '<span class="bmc-item__critical">CRITIQUE</span>' : ''}</div>
            <div class="bmc-item__detail">${escapeHtml(i.detail)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Column 3: Proposition de Valeur (spans 2 rows) -->
      <div class="bmc-canvas__cell bmc-canvas__vp">
        <div class="bmc-canvas__cell--header"><i class="fas fa-gem"></i> PROPOSITION DE VALEUR</div>
        ${(data.canvas?.proposition_valeur?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› ${escapeHtml(i.icon || '')} ${escapeHtml(i.title)}</div>
            <div class="bmc-item__detail">${escapeHtml(i.detail)}</div>
          </div>
        `).join('')}
        ${data.value_proposition_quote ? `
          <div class="bmc-canvas__vp-quote">"${escapeHtml(data.value_proposition_quote)}"</div>
        ` : ''}
      </div>

      <!-- Column 4: Relations Clients (row 1) -->
      <div class="bmc-canvas__cell bmc-canvas__rel-chan" style="grid-row:1;">
        <div class="bmc-canvas__cell--header"><i class="fas fa-users"></i> RELATIONS CLIENTS</div>
        ${(data.canvas?.relations_clients?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› ${escapeHtml(i.title)}</div>
            <div class="bmc-item__detail">${escapeHtml(i.detail)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Column 5: Segments Clients (spans 2 rows) -->
      <div class="bmc-canvas__cell" style="grid-column:5; grid-row:1/3;">
        <div class="bmc-canvas__cell--header"><i class="fas fa-users-line"></i> SEGMENTS CLIENTS</div>
        ${(data.canvas?.segments_clients?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› ${escapeHtml(i.title)}</div>
            <div class="bmc-item__detail">${escapeHtml(i.detail)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Column 2 Row 2: Ressources Clés -->
      <div class="bmc-canvas__cell bmc-canvas__act-res" style="grid-row:2;">
        <div class="bmc-canvas__cell--header"><i class="fas fa-key"></i> RESSOURCES CLÉS</div>
        ${(data.canvas?.ressources_cles?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› ${escapeHtml(i.title)}${i.critical ? '<span class="bmc-item__critical">CRITIQUE</span>' : ''}</div>
            <div class="bmc-item__detail">${escapeHtml(i.detail)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Column 4 Row 2: Canaux -->
      <div class="bmc-canvas__cell bmc-canvas__rel-chan" style="grid-row:2;">
        <div class="bmc-canvas__cell--header"><i class="fas fa-truck-fast"></i> CANAUX</div>
        ${(data.canvas?.canaux?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› ${escapeHtml(i.title)}</div>
            <div class="bmc-item__detail">${escapeHtml(i.detail)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Bottom Row: Structure de Coûts (cols 1-3) -->
      <div class="bmc-canvas__cell bmc-canvas__bottom" style="grid-row:3;">
        <div class="bmc-canvas__cell--header"><i class="fas fa-money-bill-wave"></i> STRUCTURE DE COÛTS</div>
        ${(data.canvas?.structure_couts?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› <strong>${escapeHtml(i.title)}</strong> — ${escapeHtml(i.amount)} <span style="color:#9ca3af;font-size:11px">(${escapeHtml(i.type)} · ${escapeHtml(i.pct)})</span></div>
          </div>
        `).join('')}
        <div style="border-top:1px dashed #d1d5db;margin-top:12px;padding-top:12px;display:flex;justify-content:space-between">
          <span style="font-size:14px;font-weight:700;color:#1a6b52">${escapeHtml(data.canvas?.structure_couts?.total || '')}</span>
          <span style="font-size:13px;font-weight:700;color:#dc2626">${escapeHtml(data.canvas?.structure_couts?.critical_cost || '')}</span>
        </div>
      </div>

      <!-- Bottom Row: Flux de Revenus (cols 4-5) -->
      <div class="bmc-canvas__cell bmc-canvas__bottom-right" style="grid-row:3;">
        <div class="bmc-canvas__cell--header"><i class="fas fa-coins"></i> FLUX DE REVENUS</div>
        ${(data.canvas?.flux_revenus?.items || []).map(i => `
          <div class="bmc-item">
            <div class="bmc-item__title">› <strong>${escapeHtml(i.title)}</strong></div>
            <div class="bmc-item__detail">${escapeHtml(i.detail)}</div>
          </div>
        `).join('')}
        <div style="border-top:1px dashed #d1d5db;margin-top:12px;padding-top:12px;display:flex;justify-content:space-between">
          <span style="font-size:14px;font-weight:700;color:#1a6b52">${escapeHtml(data.canvas?.flux_revenus?.ca_mensuel || '')}</span>
          <span style="font-size:13px;font-weight:700;color:#1a6b52">${escapeHtml(data.canvas?.flux_revenus?.marge_brute || '')}</span>
        </div>
      </div>
    </div>

    <!-- DIAGNOSTIC EXPERT — SCORES PAR BLOC -->
    <div class="bmc-section-title">DIAGNOSTIC EXPERT</div>
    <div class="bmc-diag">
      <div class="bmc-diag__header">
        <span class="bmc-diag__header-icon">📊</span>
        <span class="bmc-diag__header-title">Scores par bloc BMC</span>
        <span class="bmc-diag__global">Score global : ${sc}%</span>
      </div>
      ${(data.block_scores || []).map(b => {
        const bc = b.score >= 70 ? '#059669' : b.score >= 50 ? '#d97706' : '#dc2626'
        return `
        <div class="bmc-score-row">
          <span class="bmc-score-row__name">${escapeHtml(b.name)}</span>
          <div class="bmc-score-row__bar"><div class="bmc-score-row__bar-fill" style="width:${b.score}%;background:${bc}"></div></div>
          <span class="bmc-score-row__pct" style="color:${bc}">${b.score}%</span>
          <span class="bmc-score-row__comment">${escapeHtml(b.comment)}</span>
        </div>`
      }).join('')}
    </div>

    <!-- FORCES / POINTS DE VIGILANCE -->
    <div class="bmc-fv">
      <!-- Forces -->
      <div class="bmc-fv__col">
        <div class="bmc-fv__title">
          💪 Forces
          <span class="bmc-fv__badge bmc-fv__badge--green">${data.forces?.count || data.forces?.items?.length || 0} atouts majeurs</span>
        </div>
        ${(data.forces?.items || []).map(f => `
          <div class="bmc-fv__item">
            <div class="bmc-fv__item-title">✅ ${escapeHtml(f.title)}</div>
            <div class="bmc-fv__item-text">${escapeHtml(f.description)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Points de vigilance -->
      <div class="bmc-fv__col">
        <div class="bmc-fv__title">
          ⚠️ Points de vigilance
          <span class="bmc-fv__badge bmc-fv__badge--orange">${data.vigilance?.count || data.vigilance?.items?.length || 0} risques identifiés</span>
        </div>
        ${(data.vigilance?.items || []).map(v => `
          <div class="bmc-fv__item">
            <div class="bmc-fv__item-title">◆ ${escapeHtml(v.title)}</div>
            <div class="bmc-fv__item-text">${escapeHtml(v.description)}</div>
            ${v.recommendation ? `<div class="bmc-fv__item-rec">→ <em>${escapeHtml(v.recommendation)}</em></div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    <!-- MATRICE SWOT -->
    <div class="bmc-swot">
      <div class="bmc-swot__title">📋 Matrice SWOT Synthétique</div>
      <div class="bmc-swot__grid">
        <div class="bmc-swot__cell">
          <div class="bmc-swot__cell-title bmc-swot__cell-title--forces">💪 FORCES</div>
          ${(data.swot?.forces || []).map(f => `<div class="bmc-swot__item"><i class="fas fa-check-square" style="color:#059669"></i> ${escapeHtml(f)}</div>`).join('')}
        </div>
        <div class="bmc-swot__cell">
          <div class="bmc-swot__cell-title bmc-swot__cell-title--faiblesses">⚠️ FAIBLESSES</div>
          ${(data.swot?.faiblesses || []).map(f => `<div class="bmc-swot__item"><i class="fas fa-exclamation-triangle" style="color:#dc2626"></i> ${escapeHtml(f)}</div>`).join('')}
        </div>
        <div class="bmc-swot__cell">
          <div class="bmc-swot__cell-title bmc-swot__cell-title--opportunites">🚀 OPPORTUNITÉS</div>
          ${(data.swot?.opportunites || []).map(o => `<div class="bmc-swot__item"><i class="fas fa-rocket" style="color:#2563eb"></i> ${escapeHtml(o)}</div>`).join('')}
        </div>
        <div class="bmc-swot__cell">
          <div class="bmc-swot__cell-title bmc-swot__cell-title--menaces">🔴 MENACES</div>
          ${(data.swot?.menaces || []).map(m => `<div class="bmc-swot__item"><i class="fas fa-circle-exclamation" style="color:#dc2626"></i> ${escapeHtml(m)}</div>`).join('')}
        </div>
      </div>
    </div>

    <!-- RECOMMANDATIONS STRATÉGIQUES -->
    <div class="bmc-reco">
      <div class="bmc-reco__title">
        🎯 Recommandations stratégiques
        <span class="bmc-reco__plan-badge">Plan d'action</span>
      </div>
      <div class="bmc-reco__timeline">
        ${data.recommandations?.court_terme ? `
        <div class="bmc-reco__step">
          <div class="bmc-reco__dot"></div>
          <div class="bmc-reco__step-title">📌 ${escapeHtml(data.recommandations.court_terme.title)}</div>
          <div class="bmc-reco__step-text">${escapeHtml(data.recommandations.court_terme.content)}</div>
        </div>` : ''}
        ${data.recommandations?.moyen_terme ? `
        <div class="bmc-reco__step">
          <div class="bmc-reco__dot"></div>
          <div class="bmc-reco__step-title">📌 ${escapeHtml(data.recommandations.moyen_terme.title)}</div>
          <div class="bmc-reco__step-text">${escapeHtml(data.recommandations.moyen_terme.content)}</div>
        </div>` : ''}
        ${data.recommandations?.long_terme ? `
        <div class="bmc-reco__step">
          <div class="bmc-reco__dot"></div>
          <div class="bmc-reco__step-title">📌 ${escapeHtml(data.recommandations.long_terme.title)}</div>
          <div class="bmc-reco__step-text">${escapeHtml(data.recommandations.long_terme.content)}</div>
        </div>` : ''}
      </div>
    </div>
  </main>

  <!-- FOOTER -->
  <footer class="bmc-footer">
    <div class="bmc-footer__company"><strong>${escapeHtml(data.company_name || userName)}</strong> — Business Model Canvas &amp; Diagnostic Expert</div>
    <div>Document généré le ${escapeHtml(data.analysis_date || new Date().toLocaleDateString('fr-FR'))} • Analyse basée sur les données fournies et expertise sectorielle</div>
    <div class="bmc-footer__quote">"Les chiffres ne servent pas à juger le passé, mais à décider le futur."</div>
  </footer>
</body>
</html>`
}

/**
 * Convert old flat BMC data format to structured BMCData
 * This adapts the existing fallback/AI output to the new template format
 * If the raw content already has enriched canvas/swot/recommandations, use them directly
 */
export function adaptBMCData(rawContent: any, companyName: string, userName: string): BMCData {
  const blocks = rawContent.blocks || []
  const score = rawContent.score || 0

  // Build block scores from blocks array (sorted by score desc)
  const block_scores = blocks.map((b: any) => ({
    name: b.name || b.block || '',
    score: b.score || 0,
    color: (b.score || 0) >= 70 ? 'green' : 'orange',
    comment: b.analysis || ''
  }))
  block_scores.sort((a: any, b: any) => b.score - a.score)

  // Forces = blocks with score >= 70
  const strongBlocks = blocks.filter((b: any) => (b.score || 0) >= 70)
  const weakBlocks = blocks.filter((b: any) => (b.score || 0) < 70)

  const forces = {
    count: strongBlocks.length,
    items: strongBlocks.map((b: any) => ({
      title: b.name || b.block || '',
      description: b.analysis || ''
    }))
  }

  const vigilance = {
    count: weakBlocks.length,
    items: weakBlocks.map((b: any) => ({
      title: b.name || b.block || '',
      description: b.analysis || '',
      recommendation: (b.recommendations || [])[0] || ''
    }))
  }

  // Use enriched SWOT if available, otherwise build from blocks
  const swot = rawContent.swot || {
    forces: strongBlocks.map((b: any) => `${b.name} (${b.score}%)`).slice(0, 5),
    faiblesses: weakBlocks.map((b: any) => `${b.name} — ${(b.recommendations || [])[0] || 'À renforcer'}`).slice(0, 5),
    opportunites: ['Expansion vers d\'autres marchés', 'Diversification des produits/services', 'Digitalisation des canaux'],
    menaces: ['Volatilité des prix', 'Entrée de concurrents', 'Dépendance au financement externe'],
  }

  // Use enriched recommandations if available
  const allRecs = blocks.flatMap((b: any) => (b.recommendations || []).map((r: string) => r))
  const recommandations = rawContent.recommandations || {
    court_terme: { title: 'Court terme — Consolider les fondations', content: allRecs.slice(0, 3).join('. ') || 'Sécuriser les approvisionnements et structurer le suivi client.' },
    moyen_terme: { title: 'Moyen terme — Croissance maîtrisée', content: allRecs.slice(3, 6).join('. ') || 'Diversifier les produits et étendre la zone géographique.' },
    long_terme: { title: 'Long terme — Industrialisation et marque', content: allRecs.slice(6, 9).join('. ') || 'Industrialiser la production et développer la marque.' },
  }

  // Use enriched canvas data if available, otherwise build basic one
  const canvas: BMCData['canvas'] = rawContent.canvas || {
    partenaires_cles: { items: [{ title: 'Partenaires identifiés', detail: 'Relations à formaliser', critical: false }] },
    activites_cles: { items: [{ title: 'Activités opérationnelles', detail: 'Cohérentes avec la proposition de valeur', critical: true }] },
    ressources_cles: { items: [{ title: 'Ressources identifiées', detail: 'Solides mais dépendantes de personnes clés', critical: true }] },
    proposition_valeur: { items: [{ icon: '🎯', title: 'Proposition de valeur', detail: 'Claire et différenciante' }] },
    relations_clients: { items: [{ title: 'Relation personnalisée', detail: 'À formaliser et digitaliser' }] },
    canaux: { items: [{ title: 'Canaux de distribution', detail: 'Fonctionnels, manque de digital' }] },
    segments_clients: { items: [{ title: 'Segments identifiés', detail: 'Zone géographique limitée' }] },
    structure_couts: { items: [], total: 'À détailler', critical_cost: 'À identifier' },
    flux_revenus: { items: [], ca_mensuel: 'À calculer', marge_brute: 'À évaluer' },
  }

  // Use enriched tags if available
  const tags: BMCData['tags'] = rawContent.tags || (() => {
    const t: BMCData['tags'] = []
    if (strongBlocks.length >= 3) t.push({ label: 'Modèle solide', type: 'success' })
    if (score >= 60) t.push({ label: 'Marché porteur', type: 'success' })
    if (weakBlocks.length > 0) t.push({ label: 'Points à renforcer', type: 'warning' })
    return t
  })()

  return {
    score,
    company_name: rawContent.company_name || companyName || userName,
    subtitle: rawContent.subtitle || '',
    location: rawContent.location || '',
    sector: rawContent.sector || 'PME',
    analysis_date: rawContent.analysis_date || new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    value_chain: rawContent.value_chain || '',
    tags,
    value_proposition_quote: rawContent.value_proposition_quote || '',
    canvas,
    block_scores,
    forces,
    vigilance,
    swot,
    recommandations,
  }
}
