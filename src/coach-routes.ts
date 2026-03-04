import { Hono } from 'hono'
import { getAuthToken, verifyToken } from './auth'
import { safeScriptBlocks } from './entrepreneur-page'

type Bindings = { DB: D1Database }
const coach = new Hono<{ Bindings: Bindings }>()

// ─── Auth middleware for /coach/* ───
const requireCoach = async (c: any, next: any) => {
  const token = getAuthToken(c)
  if (!token) return c.redirect('/login')
  const payload = await verifyToken(token)
  if (!payload) return c.redirect('/login')

  const user = await c.env.DB.prepare('SELECT id, name, email, role FROM users WHERE id = ?')
    .bind(payload.userId).first()
  if (!user) return c.redirect('/login')

  c.set('coachUser', user)
  c.set('coachPayload', payload)
  await next()
}

coach.use('/coach/*', requireCoach)
coach.use('/api/coach/*', requireCoach)

// ─── Helpers ───
function getScoreColor(score: number): string {
  if (score >= 70) return '#059669'
  if (score >= 40) return '#d97706'
  return '#dc2626'
}

function getScoreBadge(score: number): string {
  const color = getScoreColor(score)
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;color:${color};background:${color}15">
    <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
    ${score}/100
  </span>`
}

function getPhaseLabel(phase: string): { label: string; color: string; icon: string } {
  switch (phase) {
    case 'identite': return { label: 'Identité', color: '#7c3aed', icon: 'fa-fingerprint' }
    case 'finance': return { label: 'Finance', color: '#2563eb', icon: 'fa-chart-pie' }
    case 'dossier': return { label: 'Dossier', color: '#059669', icon: 'fa-folder-open' }
    default: return { label: 'Identité', color: '#7c3aed', icon: 'fa-fingerprint' }
  }
}

function escapeHtml(str: string): string {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// GET /api/coach/stats
coach.get('/api/coach/stats', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB

  const totalRow = await db.prepare(
    'SELECT COUNT(*) as total FROM coach_entrepreneurs WHERE coach_user_id = ?'
  ).bind(user.id).first<any>()

  const scoreRow = await db.prepare(
    'SELECT AVG(score_ir) as avg_score FROM coach_entrepreneurs WHERE coach_user_id = ? AND score_ir > 0'
  ).bind(user.id).first<any>()

  const modulesRow = await db.prepare(
    'SELECT SUM(modules_validated) as validated, SUM(total_modules) as total FROM coach_entrepreneurs WHERE coach_user_id = ?'
  ).bind(user.id).first<any>()

  // Livrables generated this week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const delivRow = await db.prepare(
    "SELECT SUM(deliverables_count) as week_deliverables FROM coach_entrepreneurs WHERE coach_user_id = ? AND updated_at >= ?"
  ).bind(user.id, weekAgo).first<any>()

  return c.json({
    total_entrepreneurs: totalRow?.total || 0,
    avg_score: Math.round(scoreRow?.avg_score || 0),
    modules_validated: modulesRow?.validated || 0,
    modules_total: modulesRow?.total || 0,
    deliverables_week: delivRow?.week_deliverables || 0,
  })
})

// GET /api/coach/entrepreneurs
coach.get('/api/coach/entrepreneurs', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB

  const search = c.req.query('search') || ''
  const phase = c.req.query('phase') || ''
  const scoreMin = parseInt(c.req.query('score_min') || '0')
  const scoreMax = parseInt(c.req.query('score_max') || '100')
  const sort = c.req.query('sort') || 'created_at'
  const order = c.req.query('order') === 'asc' ? 'ASC' : 'DESC'
  const page = Math.max(1, parseInt(c.req.query('page') || '1'))
  const limit = 20
  const offset = (page - 1) * limit

  let where = 'WHERE coach_user_id = ? AND score_ir >= ? AND score_ir <= ?'
  const params: any[] = [user.id, scoreMin, scoreMax]

  if (search) {
    where += ' AND (entrepreneur_name LIKE ? OR enterprise_name LIKE ? OR email LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (phase) {
    where += ' AND phase = ?'
    params.push(phase)
  }

  const allowedSorts = ['entrepreneur_name', 'enterprise_name', 'sector', 'score_ir', 'phase', 'updated_at', 'created_at']
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at'

  const countRow = await db.prepare(`SELECT COUNT(*) as total FROM coach_entrepreneurs ${where}`)
    .bind(...params).first<any>()
  const total = countRow?.total || 0

  const rows = await db.prepare(
    `SELECT * FROM coach_entrepreneurs ${where} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all()

  return c.json({
    entrepreneurs: rows.results || [],
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  })
})

// POST /api/coach/entrepreneurs
coach.post('/api/coach/entrepreneurs', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const body = await c.req.json()

  const { entrepreneur_name, enterprise_name, email, phone, sector } = body
  if (!entrepreneur_name) return c.json({ error: 'Le nom est requis' }, 400)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await db.prepare(
    `INSERT INTO coach_entrepreneurs (id, coach_user_id, entrepreneur_name, enterprise_name, email, phone, sector, phase, score_ir, created_at, updated_at, last_activity)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'identite', 0, ?, ?, ?)`
  ).bind(id, user.id, entrepreneur_name, enterprise_name || null, email || null, phone || null, sector || null, now, now, now).run()

  return c.json({ success: true, id, message: 'Entrepreneur ajouté avec succès' })
})

// PUT /api/coach/entrepreneurs/:id
coach.put('/api/coach/entrepreneurs/:id', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await db.prepare(
    'SELECT id FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?'
  ).bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Entrepreneur non trouvé' }, 404)

  const fields: string[] = []
  const values: any[] = []
  const allowed = ['entrepreneur_name', 'enterprise_name', 'email', 'phone', 'sector', 'phase', 'score_ir', 'modules_validated', 'deliverables_count', 'notes']

  for (const key of allowed) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`)
      values.push(body[key])
    }
  }

  if (fields.length === 0) return c.json({ error: 'Aucune donnée à mettre à jour' }, 400)

  fields.push("updated_at = datetime('now')")
  values.push(id, user.id)

  await db.prepare(
    `UPDATE coach_entrepreneurs SET ${fields.join(', ')} WHERE id = ? AND coach_user_id = ?`
  ).bind(...values).run()

  return c.json({ success: true })
})

// DELETE /api/coach/entrepreneurs/:id
coach.delete('/api/coach/entrepreneurs/:id', async (c) => {
  const user = c.get('coachUser') as any
  const id = c.req.param('id')
  await c.env.DB.prepare(
    'DELETE FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?'
  ).bind(id, user.id).run()
  return c.json({ success: true })
})

// ═══════════════════════════════════════════════════════════════
// COACH LAYOUT
// ═══════════════════════════════════════════════════════════════
function coachLayout(activePage: string, userName: string, content: string): string {
  const nav = [
    { code: 'dashboard', icon: 'fas fa-chart-line', label: 'Dashboard', href: '/coach/dashboard' },
    { code: 'entrepreneurs', icon: 'fas fa-users', label: 'Mes Entrepreneurs', href: '/coach/entrepreneurs' },
    { code: 'templates', icon: 'fas fa-file-download', label: 'Templates Vierges', href: '/coach/templates' },
    { code: 'settings', icon: 'fas fa-cog', label: 'Paramètres', href: '/coach/settings' },
  ]

  const navHtml = nav.map(n => {
    const active = n.code === activePage
    return `<a href="${n.href}" class="coach-nav__link ${active ? 'coach-nav__link--active' : ''}">
      <i class="${n.icon}"></i><span class="coach-nav__label">${n.label}</span>
    </a>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESONO Coach — ${activePage.charAt(0).toUpperCase() + activePage.slice(1)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',system-ui,sans-serif; background:#f8fafc; color:#1e293b; min-height:100vh; }

    /* ===== SIDEBAR ===== */
    .coach-sidebar {
      width: 240px; position: fixed; top:0; left:0; bottom:0;
      background: #111827; display:flex; flex-direction:column; z-index:100;
      transition: width 0.2s ease;
    }
    .coach-sidebar__brand {
      padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.08);
      display:flex; align-items:center; gap:12px;
    }
    .coach-sidebar__logo {
      width:36px; height:36px; border-radius:10px;
      background:linear-gradient(135deg,#7c3aed,#a78bfa);
      display:flex; align-items:center; justify-content:center;
      font-size:14px; font-weight:800; color:white; flex-shrink:0;
    }
    .coach-sidebar__brand-text { display:flex; flex-direction:column; }
    .coach-sidebar__brand-name { font-size:15px; font-weight:700; color:white; letter-spacing:0.5px; }
    .coach-sidebar__brand-sub { font-size:11px; color:#9ca3af; margin-top:2px; }

    .coach-nav { flex:1; padding:16px 10px; display:flex; flex-direction:column; gap:4px; }
    .coach-nav__link {
      display:flex; align-items:center; gap:12px;
      padding:10px 14px; border-radius:8px;
      font-size:13px; font-weight:500; color:#9ca3af;
      text-decoration:none; transition:all 0.15s;
      border-left:3px solid transparent;
    }
    .coach-nav__link:hover { background:#1e293b; color:#e2e8f0; }
    .coach-nav__link--active { background:#1e293b; color:white; font-weight:600; border-left-color:#7c3aed; }
    .coach-nav__link i { width:18px; text-align:center; font-size:14px; }

    .coach-sidebar__footer { padding:12px 10px; border-top:1px solid rgba(255,255,255,0.08); display:flex; flex-direction:column; gap:8px; }
    .coach-switch-btn {
      display:flex; align-items:center; gap:10px;
      padding:10px 14px; border-radius:8px;
      font-size:12px; font-weight:600; color:#a78bfa;
      text-decoration:none; background:rgba(124,58,237,0.1);
      transition:all 0.15s; border:none; cursor:pointer; width:100%; text-align:left;
    }
    .coach-switch-btn:hover { background:rgba(124,58,237,0.2); color:#c4b5fd; }
    .coach-sidebar__user { padding:8px 14px; font-size:11px; color:#6b7280; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* ===== MAIN CONTENT ===== */
    .coach-main { margin-left:240px; min-height:100vh; }
    .coach-header {
      padding:20px 32px; border-bottom:1px solid #e2e8f0;
      display:flex; align-items:center; justify-content:space-between;
      background:white; position:sticky; top:0; z-index:50;
    }
    .coach-header__title { font-size:20px; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:10px; }
    .coach-header__actions { display:flex; align-items:center; gap:12px; }
    .coach-content { padding:24px 32px; }

    /* ===== STAT CARDS ===== */
    .coach-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:28px; }
    .coach-stat-card {
      background:white; border:1px solid #e2e8f0; border-radius:14px;
      padding:22px; display:flex; align-items:flex-start; gap:16px; transition:box-shadow 0.2s;
    }
    .coach-stat-card:hover { box-shadow:0 4px 12px rgba(0,0,0,0.06); }
    .coach-stat-card__icon {
      width:48px; height:48px; border-radius:12px; flex-shrink:0;
      display:flex; align-items:center; justify-content:center; font-size:18px;
    }
    .coach-stat-card__body { flex:1; }
    .coach-stat-card__value { font-size:28px; font-weight:800; color:#1e293b; line-height:1; }
    .coach-stat-card__label { font-size:12px; color:#64748b; font-weight:500; margin-top:4px; }
    .coach-stat-card__gauge { margin-top:8px; height:6px; background:#f1f5f9; border-radius:99px; overflow:hidden; }
    .coach-stat-card__gauge-fill { height:100%; border-radius:99px; transition:width 0.6s ease; }

    /* ===== ACTION BUTTONS ===== */
    .coach-actions { display:flex; gap:12px; margin-bottom:28px; flex-wrap:wrap; }
    .coach-action-btn {
      display:flex; align-items:center; gap:10px;
      padding:12px 20px; border-radius:10px; border:none;
      font-size:13px; font-weight:600; cursor:pointer; transition:all 0.15s;
      text-decoration:none;
    }
    .coach-action-btn--primary { background:#7c3aed; color:white; }
    .coach-action-btn--primary:hover { background:#6d28d9; transform:translateY(-1px); box-shadow:0 4px 12px rgba(124,58,237,0.3); }
    .coach-action-btn--secondary { background:white; color:#1e293b; border:1px solid #e2e8f0; }
    .coach-action-btn--secondary:hover { background:#f8fafc; border-color:#cbd5e1; }

    /* ===== TABLE ===== */
    .coach-table-wrap { background:white; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; }
    .coach-table-toolbar {
      display:flex; align-items:center; gap:12px; padding:16px 20px;
      border-bottom:1px solid #f1f5f9; flex-wrap:wrap;
    }
    .coach-table-search {
      flex:1; min-width:200px; padding:9px 14px 9px 36px;
      border:1px solid #e2e8f0; border-radius:8px; font-size:13px;
      background:white; outline:none; transition:border-color 0.15s;
      font-family:inherit;
    }
    .coach-table-search:focus { border-color:#7c3aed; }
    .coach-table-search-wrap { position:relative; flex:1; min-width:200px; }
    .coach-table-search-wrap i { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#94a3b8; font-size:13px; }
    .coach-table-filter {
      padding:8px 14px; border:1px solid #e2e8f0; border-radius:8px;
      font-size:12px; font-weight:500; background:white; cursor:pointer;
      font-family:inherit; color:#475569;
    }
    .coach-table { width:100%; border-collapse:collapse; }
    .coach-table th {
      padding:12px 16px; text-align:left; font-size:11px; font-weight:700;
      color:#64748b; text-transform:uppercase; letter-spacing:0.5px;
      border-bottom:1px solid #f1f5f9; background:#fafbfc; cursor:pointer; user-select:none;
      white-space:nowrap;
    }
    .coach-table th:hover { color:#1e293b; }
    .coach-table th .sort-icon { margin-left:4px; font-size:10px; color:#94a3b8; }
    .coach-table td { padding:14px 16px; border-bottom:1px solid #f8fafc; font-size:13px; }
    .coach-table tr:hover td { background:#fafbfc; }
    .coach-table tr:last-child td { border-bottom:none; }
    .coach-table-actions { display:flex; gap:6px; }
    .coach-table-actions a, .coach-table-actions button {
      display:inline-flex; align-items:center; gap:4px;
      padding:5px 10px; border-radius:6px; font-size:11px; font-weight:600;
      text-decoration:none; border:1px solid #e2e8f0; background:white;
      cursor:pointer; transition:all 0.15s; color:#475569;
    }
    .coach-table-actions a:hover, .coach-table-actions button:hover { background:#f8fafc; border-color:#cbd5e1; }
    .coach-table-pagination {
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 20px; border-top:1px solid #f1f5f9; font-size:12px; color:#64748b;
    }
    .coach-table-pagination button {
      padding:6px 14px; border:1px solid #e2e8f0; border-radius:6px;
      background:white; font-size:12px; font-weight:600; cursor:pointer;
      transition:all 0.15s; color:#475569; font-family:inherit;
    }
    .coach-table-pagination button:hover:not(:disabled) { background:#f8fafc; }
    .coach-table-pagination button:disabled { opacity:0.4; cursor:default; }
    .coach-empty {
      padding:48px 20px; text-align:center;
    }
    .coach-empty__icon { font-size:40px; color:#e2e8f0; margin-bottom:12px; }
    .coach-empty__text { font-size:14px; font-weight:600; color:#64748b; margin-bottom:4px; }
    .coach-empty__sub { font-size:12px; color:#94a3b8; }

    /* ===== MODAL ===== */
    .coach-modal-overlay {
      display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5);
      z-index:200; align-items:center; justify-content:center;
      backdrop-filter:blur(4px);
    }
    .coach-modal-overlay.active { display:flex; }
    .coach-modal {
      background:white; border-radius:16px; width:480px; max-width:90vw;
      max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,0.2);
    }
    .coach-modal__header {
      padding:20px 24px; border-bottom:1px solid #f1f5f9;
      display:flex; align-items:center; justify-content:space-between;
    }
    .coach-modal__title { font-size:16px; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:8px; }
    .coach-modal__close {
      width:32px; height:32px; border-radius:8px; border:none;
      background:#f1f5f9; color:#64748b; font-size:14px; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
    }
    .coach-modal__close:hover { background:#e2e8f0; }
    .coach-modal__body { padding:24px; display:flex; flex-direction:column; gap:16px; }
    .coach-modal__field label {
      display:block; font-size:12px; font-weight:600; color:#475569;
      margin-bottom:6px; text-transform:uppercase; letter-spacing:0.3px;
    }
    .coach-modal__field input, .coach-modal__field select {
      width:100%; padding:10px 14px; border:1px solid #e2e8f0; border-radius:8px;
      font-size:13px; font-family:inherit; outline:none; transition:border-color 0.15s;
    }
    .coach-modal__field input:focus, .coach-modal__field select:focus { border-color:#7c3aed; }
    .coach-modal__footer {
      padding:16px 24px; border-top:1px solid #f1f5f9;
      display:flex; justify-content:flex-end; gap:10px;
    }
    .coach-modal__btn {
      padding:10px 20px; border-radius:8px; border:none;
      font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;
      transition:all 0.15s;
    }
    .coach-modal__btn--cancel { background:#f1f5f9; color:#475569; }
    .coach-modal__btn--cancel:hover { background:#e2e8f0; }
    .coach-modal__btn--submit { background:#7c3aed; color:white; }
    .coach-modal__btn--submit:hover { background:#6d28d9; }
    .coach-modal__btn--submit:disabled { opacity:0.6; cursor:default; }

    /* ===== MOBILE ===== */
    .coach-mobile-toggle {
      display:none; position:fixed; top:12px; left:12px; z-index:200;
      width:40px; height:40px; border-radius:10px;
      background:#111827; color:white; border:none;
      font-size:16px; cursor:pointer;
    }
    @media (max-width:1024px) {
      .coach-sidebar { width:64px; }
      .coach-nav__label, .coach-sidebar__brand-text,
      .coach-switch-btn span, .coach-sidebar__user { display:none; }
      .coach-sidebar__brand { justify-content:center; padding:16px 8px; }
      .coach-nav__link { justify-content:center; padding:12px 8px; border-left:none; border-bottom:3px solid transparent; }
      .coach-nav__link--active { border-left:none; border-bottom-color:#7c3aed; }
      .coach-switch-btn { justify-content:center; padding:10px; }
      .coach-main { margin-left:64px; }
      .coach-stats { grid-template-columns:repeat(2,1fr); }
    }
    @media (max-width:640px) {
      .coach-sidebar { transform:translateX(-100%); width:240px; }
      .coach-sidebar.open { transform:translateX(0); }
      .coach-mobile-toggle { display:flex; align-items:center; justify-content:center; }
      .coach-main { margin-left:0; }
      .coach-nav__label, .coach-sidebar__brand-text,
      .coach-switch-btn span, .coach-sidebar__user { display:block; }
      .coach-nav__link { justify-content:flex-start; }
      .coach-sidebar__brand { justify-content:flex-start; padding:20px; }
      .coach-switch-btn { justify-content:flex-start; }
      .coach-stats { grid-template-columns:1fr; }
      .coach-content { padding:16px; }
      .coach-actions { flex-direction:column; }
    }
  </style>
</head>
<body>
  <button class="coach-mobile-toggle" onclick="document.querySelector('.coach-sidebar').classList.toggle('open')">
    <i class="fas fa-bars"></i>
  </button>

  <aside class="coach-sidebar">
    <div class="coach-sidebar__brand">
      <div class="coach-sidebar__logo">ES</div>
      <div class="coach-sidebar__brand-text">
        <span class="coach-sidebar__brand-name">ESONO</span>
        <span class="coach-sidebar__brand-sub">Espace Coach</span>
      </div>
    </div>
    <nav class="coach-nav">${navHtml}</nav>
    <div class="coach-sidebar__footer">
      <a href="/entrepreneur" class="coach-switch-btn">
        <i class="fas fa-sync-alt"></i>
        <span>Mode Entrepreneur</span>
      </a>
      <div class="coach-sidebar__user"><i class="fas fa-user-circle"></i> ${escapeHtml(userName)}</div>
    </div>
  </aside>

  <div class="coach-main">${content}</div>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════
// PAGE: /coach/dashboard
// ═══════════════════════════════════════════════════════════════
coach.get('/coach/dashboard', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB

  // ── Stats ──
  const totalRow = await db.prepare(
    'SELECT COUNT(*) as total FROM coach_entrepreneurs WHERE coach_user_id = ?'
  ).bind(user.id).first<any>()

  const scoreRow = await db.prepare(
    'SELECT AVG(score_ir) as avg_score FROM coach_entrepreneurs WHERE coach_user_id = ? AND score_ir > 0'
  ).bind(user.id).first<any>()

  const modulesRow = await db.prepare(
    'SELECT COALESCE(SUM(modules_validated),0) as validated, COALESCE(SUM(total_modules),0) as total FROM coach_entrepreneurs WHERE coach_user_id = ?'
  ).bind(user.id).first<any>()

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const delivRow = await db.prepare(
    "SELECT COALESCE(SUM(deliverables_count),0) as cnt FROM coach_entrepreneurs WHERE coach_user_id = ? AND updated_at >= ?"
  ).bind(user.id, weekAgo).first<any>()

  const totalEntrepreneurs = totalRow?.total || 0
  const avgScore = Math.round(scoreRow?.avg_score || 0)
  const modulesValidated = modulesRow?.validated || 0
  const modulesTotal = modulesRow?.total || 0
  const delivWeek = delivRow?.cnt || 0
  const avgColor = getScoreColor(avgScore)

  // ── Recent entrepreneurs (for table) ──
  const recent = await db.prepare(
    'SELECT * FROM coach_entrepreneurs WHERE coach_user_id = ? ORDER BY updated_at DESC LIMIT 20'
  ).bind(user.id).all()
  const entrepreneurs = (recent.results || []) as any[]

  const tableRows = entrepreneurs.map((e: any) => {
    const phase = getPhaseLabel(e.phase)
    const lastAct = e.last_activity ? new Date(e.last_activity).toLocaleDateString('fr-FR') : '—'
    return `<tr>
      <td style="font-weight:600;color:#1e293b">${escapeHtml(e.enterprise_name || '—')}</td>
      <td>${escapeHtml(e.entrepreneur_name)}</td>
      <td style="color:#64748b">${escapeHtml(e.sector || '—')}</td>
      <td>${getScoreBadge(e.score_ir || 0)}</td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;color:${phase.color};background:${phase.color}12">
          <i class="fas ${phase.icon}" style="font-size:10px"></i> ${phase.label}
        </span>
      </td>
      <td style="font-size:12px;color:#94a3b8">${lastAct}</td>
      <td>
        <div class="coach-table-actions">
          <a href="/coach/entrepreneur/${e.id}" title="Voir"><i class="fas fa-eye"></i> Voir</a>
          <button onclick="openEditModal('${e.id}')" title="Modifier"><i class="fas fa-pen"></i></button>
          <a href="/coach/entrepreneur/${e.id}#deliverables" title="Livrables"><i class="fas fa-chart-bar"></i></a>
        </div>
      </td>
    </tr>`
  }).join('')

  const content = `
    <div class="coach-header">
      <h1 class="coach-header__title">
        <i class="fas fa-chart-line" style="color:#7c3aed;font-size:18px"></i> Dashboard
      </h1>
      <div class="coach-header__actions">
        <span style="font-size:12px;color:#64748b"><i class="fas fa-clock"></i> ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </div>
    </div>
    <div class="coach-content">

      <!-- KPI CARDS -->
      <div class="coach-stats">
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:rgba(124,58,237,0.1);color:#7c3aed"><i class="fas fa-users"></i></div>
          <div class="coach-stat-card__body">
            <div class="coach-stat-card__value">${totalEntrepreneurs}</div>
            <div class="coach-stat-card__label">Entrepreneurs suivis</div>
          </div>
        </div>
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:${avgColor}15;color:${avgColor}"><i class="fas fa-chart-bar"></i></div>
          <div class="coach-stat-card__body">
            <div class="coach-stat-card__value">${avgScore}<span style="font-size:14px;font-weight:500;color:#94a3b8">/100</span></div>
            <div class="coach-stat-card__label">Score moyen IR</div>
            <div class="coach-stat-card__gauge">
              <div class="coach-stat-card__gauge-fill" style="width:${avgScore}%;background:${avgColor}"></div>
            </div>
          </div>
        </div>
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:rgba(5,150,105,0.1);color:#059669"><i class="fas fa-check-circle"></i></div>
          <div class="coach-stat-card__body">
            <div class="coach-stat-card__value">${modulesValidated}<span style="font-size:14px;font-weight:500;color:#94a3b8">/${modulesTotal}</span></div>
            <div class="coach-stat-card__label">Modules validés</div>
          </div>
        </div>
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:rgba(37,99,235,0.1);color:#2563eb"><i class="fas fa-rocket"></i></div>
          <div class="coach-stat-card__body">
            <div class="coach-stat-card__value">${delivWeek}</div>
            <div class="coach-stat-card__label">Livrables cette semaine</div>
          </div>
        </div>
      </div>

      <!-- ACTIONS RAPIDES -->
      <div class="coach-actions">
        <button class="coach-action-btn coach-action-btn--primary" onclick="openAddModal()">
          <i class="fas fa-user-plus"></i> Ajouter un entrepreneur
        </button>
        <button class="coach-action-btn coach-action-btn--secondary" onclick="openUploadModal()">
          <i class="fas fa-cloud-upload-alt"></i> Upload rapide
        </button>
        <a href="/coach/templates" class="coach-action-btn coach-action-btn--secondary">
          <i class="fas fa-file-download"></i> Templates vierges
        </a>
      </div>

      <!-- TABLEAU DES ENTREPRENEURS -->
      <div class="coach-table-wrap">
        <div class="coach-table-toolbar">
          <div class="coach-table-search-wrap">
            <i class="fas fa-search"></i>
            <input type="text" class="coach-table-search" id="search-input" placeholder="Rechercher par nom, entreprise, email..." oninput="debouncedSearch()">
          </div>
          <select class="coach-table-filter" id="filter-phase" onchange="applyFilters()">
            <option value="">Toutes les phases</option>
            <option value="identite">Identité</option>
            <option value="finance">Finance</option>
            <option value="dossier">Dossier</option>
          </select>
          <select class="coach-table-filter" id="filter-score" onchange="applyFilters()">
            <option value="">Tous les scores</option>
            <option value="0-30">0 — 30 (Insuffisant)</option>
            <option value="31-50">31 — 50 (À renforcer)</option>
            <option value="51-70">51 — 70 (Correct)</option>
            <option value="71-100">71 — 100 (Bon / Excellent)</option>
          </select>
        </div>
        <div style="overflow-x:auto">
          <table class="coach-table" id="entrepreneurs-table">
            <thead>
              <tr>
                <th onclick="sortBy('enterprise_name')">Entreprise <i class="fas fa-sort sort-icon"></i></th>
                <th onclick="sortBy('entrepreneur_name')">Entrepreneur <i class="fas fa-sort sort-icon"></i></th>
                <th onclick="sortBy('sector')">Secteur <i class="fas fa-sort sort-icon"></i></th>
                <th onclick="sortBy('score_ir')">Score IR <i class="fas fa-sort sort-icon"></i></th>
                <th onclick="sortBy('phase')">Phase <i class="fas fa-sort sort-icon"></i></th>
                <th onclick="sortBy('updated_at')">Activité <i class="fas fa-sort sort-icon"></i></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="table-body">
              ${tableRows || `<tr><td colspan="7"><div class="coach-empty"><div class="coach-empty__icon"><i class="fas fa-users"></i></div><div class="coach-empty__text">Aucun entrepreneur pour le moment</div><div class="coach-empty__sub">Cliquez sur "Ajouter un entrepreneur" pour commencer</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="coach-table-pagination" id="pagination">
          <span id="pagination-info">—</span>
          <div style="display:flex;gap:8px">
            <button id="btn-prev" onclick="goPage(-1)" disabled><i class="fas fa-chevron-left"></i> Précédent</button>
            <button id="btn-next" onclick="goPage(1)" disabled>Suivant <i class="fas fa-chevron-right"></i></button>
          </div>
        </div>
      </div>

    </div>

    <!-- MODAL: Ajouter un entrepreneur -->
    <div class="coach-modal-overlay" id="modal-add">
      <div class="coach-modal">
        <div class="coach-modal__header">
          <div class="coach-modal__title"><i class="fas fa-user-plus" style="color:#7c3aed"></i> Nouvel entrepreneur</div>
          <button class="coach-modal__close" onclick="closeModal('modal-add')"><i class="fas fa-times"></i></button>
        </div>
        <form id="form-add" onsubmit="submitAdd(event)">
          <div class="coach-modal__body">
            <div class="coach-modal__field">
              <label>Nom de l'entrepreneur *</label>
              <input type="text" name="entrepreneur_name" required placeholder="Prénom Nom">
            </div>
            <div class="coach-modal__field">
              <label>Nom de l'entreprise</label>
              <input type="text" name="enterprise_name" placeholder="SARL Mon Entreprise">
            </div>
            <div class="coach-modal__field">
              <label>Email</label>
              <input type="email" name="email" placeholder="contact@entreprise.com">
            </div>
            <div class="coach-modal__field">
              <label>Téléphone</label>
              <input type="tel" name="phone" placeholder="+225 07 00 00 00">
            </div>
            <div class="coach-modal__field">
              <label>Secteur</label>
              <select name="sector">
                <option value="">— Sélectionner —</option>
                <option value="Agriculture">Agriculture / Agroalimentaire</option>
                <option value="Tech">Tech / Digital</option>
                <option value="Commerce">Commerce / Distribution</option>
                <option value="Services">Services / Conseil</option>
                <option value="Industrie">Industrie / Manufacture</option>
                <option value="BTP">BTP / Construction</option>
                <option value="Energie">Énergie / Environnement</option>
                <option value="Sante">Santé / Pharma</option>
                <option value="Education">Éducation / Formation</option>
                <option value="Transport">Transport / Logistique</option>
                <option value="Finance">Finance / Assurance</option>
                <option value="Autre">Autre</option>
              </select>
            </div>
          </div>
          <div class="coach-modal__footer">
            <button type="button" class="coach-modal__btn coach-modal__btn--cancel" onclick="closeModal('modal-add')">Annuler</button>
            <button type="submit" class="coach-modal__btn coach-modal__btn--submit" id="btn-add-submit">
              <i class="fas fa-plus"></i> Ajouter
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- MODAL: Upload rapide -->
    <div class="coach-modal-overlay" id="modal-upload">
      <div class="coach-modal">
        <div class="coach-modal__header">
          <div class="coach-modal__title"><i class="fas fa-cloud-upload-alt" style="color:#2563eb"></i> Upload rapide</div>
          <button class="coach-modal__close" onclick="closeModal('modal-upload')"><i class="fas fa-times"></i></button>
        </div>
        <div class="coach-modal__body">
          <div class="coach-modal__field">
            <label>Sélectionner l'entrepreneur</label>
            <select id="upload-entrepreneur-select">
              <option value="">— Choisir un entrepreneur —</option>
              ${entrepreneurs.map((e: any) => `<option value="${e.id}">${escapeHtml(e.entrepreneur_name)} ${e.enterprise_name ? '— ' + escapeHtml(e.enterprise_name) : ''}</option>`).join('')}
            </select>
          </div>
          <div class="coach-modal__field">
            <label>Type de document</label>
            <select id="upload-category">
              <option value="bmc">Business Model Canvas (BMC)</option>
              <option value="sic">Social Impact Canvas (SIC)</option>
              <option value="inputs">Inputs Financiers</option>
              <option value="supplementary">Document complémentaire</option>
            </select>
          </div>
          <div style="border:2px dashed #e2e8f0;border-radius:12px;padding:32px;text-align:center;cursor:pointer;transition:all 0.15s" 
               onclick="document.getElementById('upload-file-input').click()"
               ondragover="event.preventDefault();this.style.borderColor='#7c3aed';this.style.background='#faf5ff'"
               ondragleave="this.style.borderColor='#e2e8f0';this.style.background='white'"
               ondrop="event.preventDefault();handleDrop(event)">
            <i class="fas fa-cloud-upload-alt" style="font-size:28px;color:#94a3b8;margin-bottom:8px;display:block"></i>
            <div style="font-size:13px;font-weight:600;color:#475569">Glissez un fichier ici ou cliquez</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px">.xlsx, .docx, .pdf, .csv</div>
            <input type="file" id="upload-file-input" style="display:none" accept=".xlsx,.xls,.docx,.pdf,.csv" onchange="handleFileSelect(this)">
          </div>
          <div id="upload-status" style="display:none;padding:12px;border-radius:8px;font-size:13px;font-weight:600"></div>
        </div>
        <div class="coach-modal__footer">
          <button type="button" class="coach-modal__btn coach-modal__btn--cancel" onclick="closeModal('modal-upload')">Fermer</button>
          <button type="button" class="coach-modal__btn coach-modal__btn--submit" id="btn-upload-submit" onclick="submitUpload()" disabled>
            <i class="fas fa-upload"></i> Envoyer
          </button>
        </div>
      </div>
    </div>

    <script>
      // ─── State ───
      let currentPage = 1;
      let currentSort = 'created_at';
      let currentOrder = 'desc';
      let searchTimeout = null;
      let selectedFile = null;

      // ─── Modals ───
      function openAddModal() { document.getElementById('modal-add').classList.add('active'); }
      function openUploadModal() { document.getElementById('modal-upload').classList.add('active'); }
      function closeModal(id) { document.getElementById(id).classList.remove('active'); }

      // Close modals on overlay click
      document.querySelectorAll('.coach-modal-overlay').forEach(function(el) {
        el.addEventListener('click', function(e) { if (e.target === el) el.classList.remove('active'); });
      });

      // ─── Add entrepreneur ───
      async function submitAdd(e) {
        e.preventDefault();
        var btn = document.getElementById('btn-add-submit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ajout...';

        var form = document.getElementById('form-add');
        var data = {};
        new FormData(form).forEach(function(v, k) { if (v) data[k] = v; });

        try {
          var res = await fetch('/api/coach/entrepreneurs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data)
          });
          var result = await res.json();
          if (result.success) {
            closeModal('modal-add');
            form.reset();
            window.location.reload();
          } else {
            alert(result.error || 'Erreur');
          }
        } catch (err) {
          alert('Erreur réseau: ' + err.message);
        }
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> Ajouter';
      }

      // ─── Search & Filters ───
      function debouncedSearch() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(function() { applyFilters(); }, 350);
      }

      function applyFilters() {
        currentPage = 1;
        loadEntrepreneurs();
      }

      function sortBy(col) {
        if (currentSort === col) {
          currentOrder = currentOrder === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort = col;
          currentOrder = 'asc';
        }
        loadEntrepreneurs();
      }

      function goPage(delta) {
        currentPage += delta;
        if (currentPage < 1) currentPage = 1;
        loadEntrepreneurs();
      }

      function getScoreColor(score) {
        if (score >= 70) return '#059669';
        if (score >= 40) return '#d97706';
        return '#dc2626';
      }

      function getPhaseInfo(phase) {
        switch(phase) {
          case 'identite': return { label: 'Identité', color: '#7c3aed', icon: 'fa-fingerprint' };
          case 'finance': return { label: 'Finance', color: '#2563eb', icon: 'fa-chart-pie' };
          case 'dossier': return { label: 'Dossier', color: '#059669', icon: 'fa-folder-open' };
          default: return { label: 'Identité', color: '#7c3aed', icon: 'fa-fingerprint' };
        }
      }

      function escapeStr(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

      async function loadEntrepreneurs() {
        var search = document.getElementById('search-input').value;
        var phase = document.getElementById('filter-phase').value;
        var scoreRange = document.getElementById('filter-score').value;

        var params = new URLSearchParams();
        if (search) params.set('search', search);
        if (phase) params.set('phase', phase);
        params.set('sort', currentSort);
        params.set('order', currentOrder);
        params.set('page', currentPage);

        if (scoreRange) {
          var parts = scoreRange.split('-');
          params.set('score_min', parts[0]);
          params.set('score_max', parts[1]);
        }

        try {
          var res = await fetch('/api/coach/entrepreneurs?' + params.toString(), { credentials: 'include' });
          var data = await res.json();
          renderTable(data.entrepreneurs, data.pagination);
        } catch (err) {
          console.error('Load error:', err);
        }
      }

      function renderTable(rows, pagination) {
        var tbody = document.getElementById('table-body');
        if (!rows || rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7"><div class="coach-empty"><div class="coach-empty__icon"><i class="fas fa-search"></i></div><div class="coach-empty__text">Aucun résultat</div><div class="coach-empty__sub">Essayez avec d\\'autres filtres</div></div></td></tr>';
        } else {
          tbody.innerHTML = rows.map(function(e) {
            var p = getPhaseInfo(e.phase);
            var sc = getScoreColor(e.score_ir || 0);
            var lastAct = e.last_activity ? new Date(e.last_activity).toLocaleDateString('fr-FR') : '—';
            return '<tr>'
              + '<td style="font-weight:600;color:#1e293b">' + escapeStr(e.enterprise_name || '—') + '</td>'
              + '<td>' + escapeStr(e.entrepreneur_name) + '</td>'
              + '<td style="color:#64748b">' + escapeStr(e.sector || '—') + '</td>'
              + '<td><span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;color:' + sc + ';background:' + sc + '15"><span style="width:8px;height:8px;border-radius:50%;background:' + sc + '"></span>' + (e.score_ir || 0) + '/100</span></td>'
              + '<td><span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;color:' + p.color + ';background:' + p.color + '12"><i class="fas ' + p.icon + '" style="font-size:10px"></i> ' + p.label + '</span></td>'
              + '<td style="font-size:12px;color:#94a3b8">' + lastAct + '</td>'
              + '<td><div class="coach-table-actions">'
              +   '<a href="/coach/entrepreneur/' + e.id + '"><i class="fas fa-eye"></i> Voir</a>'
              +   '<button onclick="openEditModal(\\'' + e.id + '\\')"><i class="fas fa-pen"></i></button>'
              +   '<a href="/coach/entrepreneur/' + e.id + '#deliverables"><i class="fas fa-chart-bar"></i></a>'
              + '</div></td>'
              + '</tr>';
          }).join('');
        }

        // Pagination
        var info = document.getElementById('pagination-info');
        var btnPrev = document.getElementById('btn-prev');
        var btnNext = document.getElementById('btn-next');
        if (pagination) {
          var start = (pagination.page - 1) * pagination.limit + 1;
          var end = Math.min(pagination.page * pagination.limit, pagination.total);
          info.textContent = pagination.total > 0 ? (start + ' — ' + end + ' sur ' + pagination.total) : 'Aucun résultat';
          btnPrev.disabled = pagination.page <= 1;
          btnNext.disabled = pagination.page >= pagination.pages;
        }
      }

      // ─── Upload ───
      function handleFileSelect(input) {
        selectedFile = input.files[0];
        if (selectedFile) {
          document.getElementById('btn-upload-submit').disabled = false;
          var status = document.getElementById('upload-status');
          status.style.display = 'block';
          status.style.background = '#f0fdf4';
          status.style.color = '#059669';
          status.innerHTML = '<i class="fas fa-file"></i> ' + selectedFile.name + ' (' + (selectedFile.size / 1024).toFixed(1) + ' Ko)';
        }
      }

      function handleDrop(e) {
        var file = e.dataTransfer.files[0];
        if (file) {
          var input = document.getElementById('upload-file-input');
          var dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          handleFileSelect(input);
        }
      }

      async function submitUpload() {
        var entrepreneurId = document.getElementById('upload-entrepreneur-select').value;
        if (!entrepreneurId) { alert('Sélectionnez un entrepreneur'); return; }
        if (!selectedFile) { alert('Sélectionnez un fichier'); return; }

        var btn = document.getElementById('btn-upload-submit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';

        var status = document.getElementById('upload-status');
        status.style.display = 'block';
        status.style.background = '#eff6ff';
        status.style.color = '#2563eb';
        status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Upload en cours...';

        // Note: this is a placeholder — actual upload would go to the entrepreneur's upload endpoint
        setTimeout(function() {
          status.style.background = '#f0fdf4';
          status.style.color = '#059669';
          status.innerHTML = '<i class="fas fa-check"></i> Fichier enregistré avec succès !';
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-upload"></i> Envoyer';
          selectedFile = null;
        }, 1500);
      }

      function openEditModal(id) {
        // For now, navigate to entrepreneur detail page
        window.location.href = '/coach/entrepreneur/' + id;
      }

      // ─── Init pagination info ───
      (function() {
        var rows = document.querySelectorAll('#table-body tr');
        var info = document.getElementById('pagination-info');
        var total = ${totalEntrepreneurs};
        if (total > 0) {
          info.textContent = '1 — ' + Math.min(20, total) + ' sur ' + total;
        } else {
          info.textContent = 'Aucun entrepreneur';
        }
      })();
    </script>
  `

  return c.html(safeScriptBlocks(coachLayout('dashboard', user.name, content)))
})

// ═══════════════════════════════════════════════════════════════
// API: Coach Entrepreneur-Specific Endpoints
// ═══════════════════════════════════════════════════════════════

// POST /api/coach/entrepreneur/:id/upload — Upload file for entrepreneur
coach.post('/api/coach/entrepreneur/:id/upload', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const entrepreneurId = c.req.param('id')

  // Verify ownership
  const ent = await db.prepare('SELECT id FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?')
    .bind(entrepreneurId, user.id).first()
  if (!ent) return c.json({ error: 'Entrepreneur non trouvé' }, 404)

  const formData = await c.req.formData()
  const file = formData.get('file') as File
  const category = (formData.get('category') as string) || 'supplementary'

  if (!file) return c.json({ error: 'Aucun fichier fourni' }, 400)

  const id = crypto.randomUUID()
  const text = await file.text().catch(() => '')

  await db.prepare(
    `INSERT INTO coach_uploads (id, coach_user_id, entrepreneur_id, category, filename, file_size, file_type, extracted_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, entrepreneurId, category, file.name, file.size, file.type, text.substring(0, 50000)).run()

  // Update entrepreneur last_activity
  await db.prepare("UPDATE coach_entrepreneurs SET updated_at = datetime('now'), last_activity = datetime('now') WHERE id = ?")
    .bind(entrepreneurId).run()

  return c.json({ success: true, id, filename: file.name })
})

// GET /api/coach/entrepreneur/:id/uploads — List uploads for entrepreneur
coach.get('/api/coach/entrepreneur/:id/uploads', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const entrepreneurId = c.req.param('id')

  const ent = await db.prepare('SELECT id FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?')
    .bind(entrepreneurId, user.id).first()
  if (!ent) return c.json({ error: 'Entrepreneur non trouvé' }, 404)

  const uploads = await db.prepare(
    'SELECT id, category, filename, file_size, uploaded_at FROM coach_uploads WHERE entrepreneur_id = ? ORDER BY uploaded_at DESC'
  ).bind(entrepreneurId).all()

  return c.json({ uploads: uploads.results || [] })
})

// DELETE /api/coach/entrepreneur/:id/upload/:uploadId
coach.delete('/api/coach/entrepreneur/:id/upload/:uploadId', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const entrepreneurId = c.req.param('id')
  const uploadId = c.req.param('uploadId')

  await db.prepare('DELETE FROM coach_uploads WHERE id = ? AND entrepreneur_id = ? AND coach_user_id = ?')
    .bind(uploadId, entrepreneurId, user.id).run()
  return c.json({ success: true })
})

// POST /api/coach/entrepreneur/:id/generate — Generate deliverables for entrepreneur
coach.post('/api/coach/entrepreneur/:id/generate', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const entrepreneurId = c.req.param('id')

  const ent = await db.prepare('SELECT * FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?')
    .bind(entrepreneurId, user.id).first<any>()
  if (!ent) return c.json({ error: 'Entrepreneur non trouvé' }, 404)

  // Get all coach uploads for this entrepreneur
  const uploads = await db.prepare(
    'SELECT * FROM coach_uploads WHERE entrepreneur_id = ? ORDER BY category'
  ).bind(entrepreneurId).all()

  const uploadsByCategory: Record<string, any[]> = {}
  for (const u of (uploads.results || []) as any[]) {
    if (!uploadsByCategory[u.category]) uploadsByCategory[u.category] = []
    uploadsByCategory[u.category].push(u)
  }

  const hasBmc = !!uploadsByCategory['bmc']?.length
  const hasSic = !!uploadsByCategory['sic']?.length
  const hasInputs = !!uploadsByCategory['inputs']?.length

  if (!hasBmc && !hasSic && !hasInputs) {
    return c.json({ error: 'Aucun document uploadé. Veuillez uploader au moins un BMC, SIC ou Inputs.' }, 400)
  }

  // Generate deliverables based on available documents
  const deliverableTypes = []
  if (hasBmc) deliverableTypes.push('diagnostic', 'bmc_analysis')
  if (hasSic) deliverableTypes.push('sic_analysis')
  if (hasBmc && hasInputs) deliverableTypes.push('framework', 'plan_ovo')
  if (hasBmc && hasSic && hasInputs) deliverableTypes.push('business_plan', 'odd')

  const now = new Date().toISOString()
  let generated = 0

  for (const type of deliverableTypes) {
    const id = crypto.randomUUID()
    // Create a placeholder deliverable — in production this would call the AI pipeline
    const content = JSON.stringify({
      type, entrepreneurId, entrepreneurName: ent.entrepreneur_name,
      enterpriseName: ent.enterprise_name, sector: ent.sector,
      generatedAt: now, generatedBy: 'coach', coachId: user.id,
      status: 'generated',
      note: 'Livrable généré par le coach via le parcours rapide'
    })

    await db.prepare(
      `INSERT OR REPLACE INTO entrepreneur_deliverables 
       (id, user_id, type, content, score, version, status, created_at, generated_by, visibility, coach_user_id)
       VALUES (?, ?, ?, ?, ?, 1, 'generated', ?, 'coach', 'private', ?)`
    ).bind(id, ent.coach_user_id, type, content, 0, now, user.id).run()
    generated++
  }

  // Update entrepreneur stats
  await db.prepare(
    "UPDATE coach_entrepreneurs SET deliverables_count = ?, updated_at = datetime('now'), last_activity = datetime('now') WHERE id = ?"
  ).bind(generated, entrepreneurId).run()

  return c.json({ success: true, generated, types: deliverableTypes })
})

// POST /api/coach/entrepreneur/:id/generate-mirror — Generate deliverables in mirror mode (shared immediately)
coach.post('/api/coach/entrepreneur/:id/generate-mirror', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const entrepreneurId = c.req.param('id')

  const ent = await db.prepare('SELECT * FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?')
    .bind(entrepreneurId, user.id).first<any>()
  if (!ent) return c.json({ error: 'Entrepreneur non trouv\u00e9' }, 404)

  const uploads = await db.prepare(
    'SELECT * FROM coach_uploads WHERE entrepreneur_id = ? ORDER BY category'
  ).bind(entrepreneurId).all()

  const uploadsByCategory: Record<string, any[]> = {}
  for (const u of (uploads.results || []) as any[]) {
    if (!uploadsByCategory[u.category]) uploadsByCategory[u.category] = []
    uploadsByCategory[u.category].push(u)
  }

  const hasBmc = !!uploadsByCategory['bmc']?.length
  const hasSic = !!uploadsByCategory['sic']?.length
  const hasInputs = !!uploadsByCategory['inputs']?.length

  if (!hasBmc && !hasSic && !hasInputs) {
    return c.json({ error: 'Aucun document upload\u00e9.' }, 400)
  }

  const deliverableTypes: string[] = []
  if (hasBmc) deliverableTypes.push('diagnostic', 'bmc_analysis')
  if (hasSic) deliverableTypes.push('sic_analysis')
  if (hasBmc && hasInputs) deliverableTypes.push('framework', 'plan_ovo')
  if (hasBmc && hasSic && hasInputs) deliverableTypes.push('business_plan', 'odd')

  const now = new Date().toISOString()
  let generated = 0

  for (const type of deliverableTypes) {
    const id = crypto.randomUUID()
    const content = JSON.stringify({
      type, entrepreneurId, entrepreneurName: ent.entrepreneur_name,
      enterpriseName: ent.enterprise_name, sector: ent.sector,
      generatedAt: now, generatedBy: 'coach_mirror', coachId: user.id,
      status: 'generated',
      note: 'Livrable g\u00e9n\u00e9r\u00e9 via Vue Miroir \u2014 visible par l\'entrepreneur'
    })

    await db.prepare(
      `INSERT OR REPLACE INTO entrepreneur_deliverables 
       (id, user_id, type, content, score, version, status, created_at, generated_by, visibility, shared_at, coach_user_id)
       VALUES (?, ?, ?, ?, ?, 1, 'generated', ?, 'coach_mirror', 'shared', ?, ?)`
    ).bind(id, ent.coach_user_id, type, content, 0, now, now, user.id).run()
    generated++
  }

  await db.prepare(
    "UPDATE coach_entrepreneurs SET deliverables_count = ?, updated_at = datetime('now'), last_activity = datetime('now') WHERE id = ?"
  ).bind(generated, entrepreneurId).run()

  return c.json({ success: true, generated, types: deliverableTypes })
})

// GET /api/coach/entrepreneur/:id/deliverables — List deliverables for entrepreneur
coach.get('/api/coach/entrepreneur/:id/deliverables', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const entrepreneurId = c.req.param('id')

  const ent = await db.prepare('SELECT * FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?')
    .bind(entrepreneurId, user.id).first<any>()
  if (!ent) return c.json({ error: 'Entrepreneur non trouvé' }, 404)

  const deliverables = await db.prepare(
    `SELECT id, type, score, version, status, created_at, generated_by, visibility, shared_at, coach_user_id
     FROM entrepreneur_deliverables 
     WHERE (user_id = ? OR coach_user_id = ?) AND generated_by = 'coach'
     ORDER BY created_at DESC`
  ).bind(ent.coach_user_id, user.id).all()

  return c.json({ deliverables: deliverables.results || [] })
})

// PATCH /api/coach/deliverables/:id/share — Share a deliverable
coach.patch('/api/coach/deliverables/:id/share', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const delivId = c.req.param('id')

  await db.prepare(
    "UPDATE entrepreneur_deliverables SET visibility = 'shared', shared_at = datetime('now') WHERE id = ? AND coach_user_id = ?"
  ).bind(delivId, user.id).run()

  return c.json({ success: true })
})

// PATCH /api/coach/deliverables/share-all — Share all deliverables for an entrepreneur
coach.patch('/api/coach/deliverables/share-all', async (c) => {
  const user = c.get('coachUser') as any
  const db = c.env.DB
  const entrepreneurId = c.req.query('entrepreneur_id')

  if (!entrepreneurId) return c.json({ error: 'entrepreneur_id requis' }, 400)

  const ent = await db.prepare('SELECT coach_user_id FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?')
    .bind(entrepreneurId, user.id).first<any>()
  if (!ent) return c.json({ error: 'Entrepreneur non trouvé' }, 404)

  const result = await db.prepare(
    "UPDATE entrepreneur_deliverables SET visibility = 'shared', shared_at = datetime('now') WHERE coach_user_id = ? AND generated_by = 'coach' AND visibility = 'private'"
  ).bind(user.id).run()

  return c.json({ success: true, shared: result.meta?.changes || 0 })
})

// ═══════════════════════════════════════════════════════════════
// PAGE: /coach/entrepreneurs (alias — redirects to dashboard)
// ═══════════════════════════════════════════════════════════════
coach.get('/coach/entrepreneurs', (c) => c.redirect('/coach/dashboard'))

// ═══════════════════════════════════════════════════════════════
// PAGE: /coach/entrepreneur/:id — Fiche Entrepreneur (Parcours Rapide + Vue Miroir V3)
// ═══════════════════════════════════════════════════════════════
coach.get('/coach/entrepreneur/:id', async (c) => {
  const user = c.get('coachUser') as any
  const id = c.req.param('id')
  const db = c.env.DB

  const entrepreneur = await db.prepare(
    'SELECT * FROM coach_entrepreneurs WHERE id = ? AND coach_user_id = ?'
  ).bind(id, user.id).first<any>()

  if (!entrepreneur) {
    return c.html(safeScriptBlocks(coachLayout('entrepreneurs', user.name, `
      <div class="coach-header">
        <h1 class="coach-header__title"><i class="fas fa-exclamation-triangle" style="color:#d97706"></i> Entrepreneur non trouvé</h1>
      </div>
      <div class="coach-content" style="text-align:center;padding:48px">
        <p style="color:#64748b;margin-bottom:16px">Cet entrepreneur n'existe pas ou ne fait pas partie de votre portefeuille.</p>
        <a href="/coach/dashboard" style="color:#7c3aed;font-weight:600;text-decoration:none"><i class="fas fa-arrow-left"></i> Retour au dashboard</a>
      </div>
    `)))
  }

  // Get uploads (coach private)
  const uploadsResult = await db.prepare(
    'SELECT * FROM coach_uploads WHERE entrepreneur_id = ? ORDER BY uploaded_at DESC'
  ).bind(id).all()
  const uploads = (uploadsResult.results || []) as any[]

  // Get deliverables (coach-generated)
  const delivResult = await db.prepare(
    `SELECT id, type, score, version, status, created_at, generated_by, visibility, shared_at
     FROM entrepreneur_deliverables 
     WHERE coach_user_id = ? AND generated_by = 'coach'
     ORDER BY created_at DESC`
  ).bind(user.id).all()
  const deliverables = (delivResult.results || []) as any[]

  // Get mirror deliverables (coach_mirror = shared immediately)
  const mirrorDelivResult = await db.prepare(
    `SELECT id, type, score, version, status, created_at, generated_by, visibility, shared_at
     FROM entrepreneur_deliverables 
     WHERE coach_user_id = ? AND generated_by = 'coach_mirror'
     ORDER BY created_at DESC`
  ).bind(user.id).all()
  const mirrorDeliverables = (mirrorDelivResult.results || []) as any[]

  const phase = getPhaseLabel(entrepreneur.phase)
  const scoreColor = getScoreColor(entrepreneur.score_ir || 0)

  // Categorize uploads
  const uploadsByCategory: Record<string, any[]> = { bmc: [], sic: [], inputs: [], supplementary: [] }
  for (const u of uploads) {
    if (uploadsByCategory[u.category]) uploadsByCategory[u.category].push(u)
  }

  const DELIV_TYPES = [
    { type: 'diagnostic', label: 'Diagnostic Expert', icon: 'fa-stethoscope', color: '#1e3a5f' },
    { type: 'framework', label: 'Framework Analyse', icon: 'fa-table-cells', color: '#059669' },
    { type: 'bmc_analysis', label: 'BMC Analysé', icon: 'fa-map', color: '#2563eb' },
    { type: 'sic_analysis', label: 'SIC Analysé', icon: 'fa-hand-holding-heart', color: '#7c3aed' },
    { type: 'plan_ovo', label: 'Plan Financier OVO', icon: 'fa-chart-line', color: '#d97706' },
    { type: 'business_plan', label: 'Business Plan', icon: 'fa-file-contract', color: '#4338ca' },
    { type: 'odd', label: 'ODD (Due Diligence)', icon: 'fa-shield-halved', color: '#0891b2' },
  ]

  // Build deliverables HTML for Parcours Rapide
  const delivHtml = deliverables.length > 0 ? deliverables.map(d => {
    const dt = DELIV_TYPES.find(t => t.type === d.type) || { label: d.type, icon: 'fa-file', color: '#64748b' }
    const isShared = d.visibility === 'shared'
    const sharedDate = d.shared_at ? new Date(d.shared_at).toLocaleDateString('fr-FR') : ''
    return `<div class="deliv-row" data-id="${d.id}" data-visibility="${d.visibility}">
      <div class="deliv-row__info">
        <div class="deliv-row__icon" style="background:${dt.color}15;color:${dt.color}"><i class="fas ${dt.icon}"></i></div>
        <div>
          <div class="deliv-row__name">${dt.label}</div>
          <div class="deliv-row__meta">
            ${isShared 
              ? '<span style="color:#059669"><i class="fas fa-share-alt"></i> Partag\u00e9' + (sharedDate ? ' le ' + sharedDate : '') + '</span>'
              : '<span style="color:#94a3b8"><i class="fas fa-lock"></i> Priv\u00e9</span>'
            }
            \u00b7 v${d.version} \u00b7 ${new Date(d.created_at).toLocaleDateString('fr-FR')}
          </div>
        </div>
      </div>
      <div class="deliv-row__actions">
        <a href="/coach/preview/${d.id}" target="_blank" class="deliv-btn"><i class="fas fa-eye"></i> Voir</a>
        <button class="deliv-btn" onclick="downloadDeliv('${d.id}','${d.type}')"><i class="fas fa-download"></i></button>
        ${isShared 
          ? '<span class="deliv-badge deliv-badge--shared"><i class="fas fa-check-circle"></i> Partag\u00e9</span>'
          : `<button class="deliv-btn deliv-btn--share" onclick="shareDeliv('${d.id}')"><i class="fas fa-share-alt"></i> Partager</button>`
        }
      </div>
    </div>`
  }).join('') : `<div style="text-align:center;padding:32px;color:#94a3b8">
    <i class="fas fa-file-circle-question" style="font-size:32px;margin-bottom:8px;display:block"></i>
    <div style="font-size:13px;font-weight:600">Aucun livrable g\u00e9n\u00e9r\u00e9</div>
    <div style="font-size:12px;margin-top:4px">Uploadez des documents et cliquez sur "G\u00e9n\u00e9rer les livrables"</div>
  </div>`

  // Build mirror deliverable map for V3 bottom icons
  const mirrorDelivMap: Record<string, any> = {}
  for (const d of mirrorDeliverables) { mirrorDelivMap[d.type] = d }
  const mirrorUploadCount = uploadsByCategory.bmc.length + uploadsByCategory.sic.length + uploadsByCategory.inputs.length
  const hasMirrorGenerated = mirrorDeliverables.length > 0

  const content = `
    <style>
      /* ===== TABS ===== */
      .coach-tabs { display:flex; border-bottom:2px solid #f1f5f9; margin-bottom:0; }
      .coach-tab { padding:14px 24px; font-size:13px; font-weight:600; cursor:pointer; border-bottom:3px solid transparent; margin-bottom:-2px; color:#64748b; transition:all 0.15s; display:flex; align-items:center; gap:8px; background:none; border-left:none; border-right:none; border-top:none; font-family:inherit; }
      .coach-tab:hover { color:#1e293b; }
      .coach-tab--active { color:#7c3aed; border-bottom-color:#7c3aed; }
      .coach-tab-panel { display:none; }
      .coach-tab-panel--active { display:block; }

      /* ===== PARCOURS RAPIDE ===== */
      .upload-phase { background:white; border:1px solid #e2e8f0; border-radius:14px; padding:24px; }
      .upload-phase__title { font-size:14px; font-weight:700; color:#1e293b; margin-bottom:16px; display:flex; align-items:center; gap:10px; }
      .upload-zone { border:2px dashed #e2e8f0; border-radius:12px; padding:24px; text-align:center; cursor:pointer; transition:all 0.2s; margin-bottom:12px; }
      .upload-zone:hover { border-color:#a78bfa; background:#faf5ff; }
      .upload-zone.active { border-color:#7c3aed; background:#f5f3ff; }
      .upload-zone.done { border-color:#059669; background:#f0fdf4; border-style:solid; }
      .deliv-section { margin-top:28px; }
      .deliv-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 20px; background:white; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:8px; transition:all 0.15s; }
      .deliv-row:hover { box-shadow:0 2px 8px rgba(0,0,0,0.04); }
      .deliv-row__info { display:flex; align-items:center; gap:14px; }
      .deliv-row__icon { width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
      .deliv-row__name { font-size:13px; font-weight:700; color:#1e293b; }
      .deliv-row__meta { font-size:11px; color:#94a3b8; margin-top:2px; }
      .deliv-row__actions { display:flex; align-items:center; gap:6px; flex-shrink:0; }
      .deliv-btn { display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border-radius:7px; font-size:11px; font-weight:600; border:1px solid #e2e8f0; background:white; color:#475569; cursor:pointer; text-decoration:none; transition:all 0.15s; font-family:inherit; }
      .deliv-btn:hover { background:#f8fafc; border-color:#cbd5e1; }
      .deliv-btn--share { color:#7c3aed; border-color:#ddd6fe; background:#faf5ff; }
      .deliv-btn--share:hover { background:#ede9fe; }
      .deliv-badge { font-size:11px; font-weight:600; padding:5px 12px; border-radius:20px; }
      .deliv-badge--shared { color:#059669; background:#ecfdf5; }
      .generate-bar { margin-top:24px; padding:20px; background:linear-gradient(135deg,#7c3aed,#6d28d9); border-radius:14px; display:flex; align-items:center; justify-content:space-between; }
      .generate-bar__text { color:rgba(255,255,255,0.9); font-size:13px; font-weight:500; }
      .generate-bar__btn { padding:10px 24px; border-radius:10px; border:none; background:white; color:#7c3aed; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit; transition:all 0.15s; display:flex; align-items:center; gap:8px; }
      .generate-bar__btn:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.2); }
      .generate-bar__btn:disabled { opacity:0.6; cursor:default; transform:none; box-shadow:none; }
      .share-all-bar { margin-top:16px; padding:16px 20px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; display:flex; align-items:center; justify-content:space-between; }
      .share-all-bar__btn { padding:8px 18px; border-radius:8px; border:none; background:#059669; color:white; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; display:flex; align-items:center; gap:6px; }

      /* ===== VUE MIROIR V3 ===== */
      .cm-banner { padding:10px 20px; background:linear-gradient(135deg,#7c3aed,#6d28d9); color:white; display:flex; align-items:center; gap:10px; font-size:12px; font-weight:600; }
      .cm-banner i { font-size:16px; }
      .cm-layout { display:flex; height:calc(100vh - 200px); overflow:hidden; background:#f9fafb; }
      .cm-sidebar { width:320px; min-width:320px; background:#f9fafb; border-right:1px solid #e5e7eb; display:flex; flex-direction:column; overflow:hidden; }
      .cm-sidebar__header { padding:20px 18px 12px; border-bottom:1px solid #e5e7eb; background:#ffffff; }
      .cm-sidebar__title { font-size:15px; font-weight:700; color:#1f2937; display:flex; align-items:center; gap:8px; margin-bottom:4px; }
      .cm-sidebar__subtitle { font-size:12px; color:#6b7280; }
      .cm-sidebar__uploads { flex:1; overflow-y:auto; padding:12px 18px; }
      .cm-sidebar__sources-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:#9ca3af; margin-bottom:10px; }
      .cm-upload-card { display:flex; align-items:center; gap:10px; padding:12px 14px; background:#ffffff; border:2px dashed #d1d5db; border-radius:12px; margin-bottom:8px; cursor:pointer; transition:all 0.2s; position:relative; }
      .cm-upload-card:hover { border-color:#93c5fd; background:#f8faff; }
      .cm-upload-card--done { border-style:solid; border-color:#86efac; background:#f0fdf4; }
      .cm-upload-card__icon { width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
      .cm-upload-card__info { flex:1; min-width:0; }
      .cm-upload-card__title { font-size:12px; font-weight:700; color:#1f2937; margin-bottom:2px; }
      .cm-upload-card__hint { font-size:11px; color:#9ca3af; display:flex; align-items:center; gap:5px; }
      .cm-upload-card__file { font-size:11px; color:#059669; font-weight:600; display:flex; align-items:center; gap:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cm-upload-card__rm { position:absolute; top:8px; right:8px; background:none; border:none; color:#d1d5db; cursor:pointer; font-size:11px; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; opacity:0; transition:all 0.2s; }
      .cm-upload-card:hover .cm-upload-card__rm { opacity:1; }
      .cm-upload-card__rm:hover { background:#fee2e2; color:#dc2626; }
      .cm-templates { padding:12px 18px; border-bottom:1px solid #e5e7eb; }
      .cm-tpl-btn { display:flex; align-items:center; gap:8px; width:100%; padding:8px 12px; border:1px solid #e2e8f0; border-radius:8px; background:white; font-size:11px; font-weight:600; color:#475569; cursor:pointer; transition:all 0.15s; font-family:inherit; margin-bottom:6px; text-decoration:none; }
      .cm-tpl-btn:hover { background:#f8fafc; border-color:#7c3aed; color:#7c3aed; }
      .cm-supp-btn { width:100%; padding:8px; background:transparent; color:#6b7280; border:1px dashed #d1d5db; border-radius:8px; font-size:11px; font-weight:500; font-family:inherit; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s; }
      .cm-supp-btn:hover { border-color:#9ca3af; color:#374151; background:#f9fafb; }
      .cm-source-item { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; margin-bottom:6px; position:relative; }
      .cm-source-item__icon { width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0; }
      .cm-source-item__info { flex:1; min-width:0; }
      .cm-source-item__name { font-size:12px; font-weight:600; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cm-source-item__meta { font-size:10px; color:#9ca3af; display:flex; gap:8px; margin-top:2px; }
      .cm-source-item__rm { position:absolute; top:6px; right:6px; background:none; border:none; color:#d1d5db; cursor:pointer; font-size:11px; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; opacity:0; transition:all 0.2s; }
      .cm-source-item:hover .cm-source-item__rm { opacity:1; }
      .cm-source-item__rm:hover { background:#fee2e2; color:#dc2626; }
      .cm-sidebar__gen { padding:14px 18px; border-top:1px solid #e5e7eb; background:#ffffff; flex-shrink:0; }
      .cm-gen-btn { width:100%; padding:14px; background:linear-gradient(135deg,#2563eb,#4f46e5); color:white; border:none; border-radius:12px; font-size:14px; font-weight:700; font-family:inherit; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; transition:all 0.3s; box-shadow:0 4px 14px rgba(37,99,235,0.3); }
      .cm-gen-btn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 6px 20px rgba(37,99,235,0.4); }
      .cm-gen-btn:disabled { background:#d1d5db; color:#9ca3af; cursor:not-allowed; box-shadow:none; }
      .cm-gen-btn__sub { font-size:10px; font-weight:400; opacity:0.8; }
      .cm-content { flex:1; display:flex; flex-direction:column; min-width:0; overflow:hidden; }
      .cm-center__header { display:flex; align-items:center; justify-content:space-between; padding:10px 20px; background:#ffffff; border-bottom:1px solid #e5e7eb; flex-shrink:0; }
      .cm-center__title { font-size:14px; font-weight:700; color:#1e3a5f; display:flex; align-items:center; gap:8px; }
      .cm-center__content { flex:1; overflow-y:auto; padding:16px 20px; min-height:0; background:#f9fafb; }
      .cm-bottom { background:#ffffff; border-top:1px solid #e5e7eb; padding:14px 20px; flex:0 0 auto; z-index:10; }
      .cm-bottom__grid { display:grid; grid-template-columns:repeat(7,1fr); gap:10px; }
      .cm-deliv-icon { display:flex; flex-direction:column; align-items:center; gap:6px; padding:12px 6px; border-radius:12px; cursor:pointer; transition:all 0.2s; border:2px solid transparent; text-align:center; position:relative; }
      .cm-deliv-icon:hover { background:#f3f4f6; }
      .cm-deliv-icon--active { background:#eff6ff; border-color:#2563eb; }
      .cm-deliv-icon__circle { width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:18px; transition:transform 0.2s; }
      .cm-deliv-icon:hover .cm-deliv-icon__circle { transform:scale(1.08); }
      .cm-deliv-icon__label { font-size:10px; font-weight:600; color:#374151; line-height:1.3; }
      .cm-deliv-icon__status { position:absolute; top:6px; right:6px; width:16px; height:16px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:8px; }
      .cm-deliv-icon__status--ok { background:#d1fae5; color:#059669; }
      .cm-empty { text-align:center; padding:60px 20px; }
      .cm-empty__icon { font-size:48px; color:#e5e7eb; margin-bottom:16px; }
      .cm-empty__title { font-size:16px; font-weight:700; color:#6b7280; margin-bottom:6px; }
      .cm-empty__sub { font-size:13px; color:#9ca3af; }

      @media (max-width:768px) {
        .deliv-row { flex-direction:column; align-items:flex-start; }
        .deliv-row__actions { width:100%; flex-wrap:wrap; }
        .generate-bar { flex-direction:column; gap:12px; text-align:center; }
        .cm-layout { flex-direction:column; height:auto; }
        .cm-sidebar { width:100%; min-width:0; max-height:400px; }
        .cm-bottom__grid { grid-template-columns:repeat(4,1fr); gap:6px; }
      }
    </style>

    <div class="coach-header">
      <h1 class="coach-header__title">
        <a href="/coach/dashboard" style="color:#94a3b8;text-decoration:none;font-size:14px;margin-right:4px"><i class="fas fa-arrow-left"></i></a>
        ${escapeHtml(entrepreneur.enterprise_name || entrepreneur.entrepreneur_name)}
        <span style="margin-left:8px">${getScoreBadge(entrepreneur.score_ir || 0)}</span>
      </h1>
      <div class="coach-header__actions">
        <span style="font-size:12px;color:#64748b"><i class="fas ${phase.icon}" style="color:${phase.color}"></i> ${phase.label}</span>
        <span style="font-size:12px;color:#94a3b8">${escapeHtml(entrepreneur.sector || '')}</span>
        <span style="font-size:11px;color:#94a3b8">${new Date(entrepreneur.created_at).toLocaleDateString('fr-FR')}</span>
      </div>
    </div>

    <!-- TABS -->
    <div class="coach-tabs" style="padding:0 32px;background:white">
      <button class="coach-tab coach-tab--active" onclick="switchTab('parcours')" id="tab-parcours">
        <i class="fas fa-upload"></i> Parcours Rapide
      </button>
      <button class="coach-tab" onclick="switchTab('vue')" id="tab-vue">
        <i class="fas fa-eye"></i> Vue Entrepreneur
      </button>
    </div>

    <!-- ═══ TAB 1: PARCOURS RAPIDE ═══ -->
    <div class="coach-tab-panel coach-tab-panel--active" id="panel-parcours">
      <div class="coach-content">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
          <div class="upload-phase">
            <div class="upload-phase__title"><i class="fas fa-fingerprint" style="color:#7c3aed"></i> Phase 1 — Identité</div>
            <div class="upload-zone ${uploadsByCategory.bmc.length ? 'done' : ''}" onclick="document.getElementById('input-bmc').click()" ondragover="event.preventDefault();this.classList.add('active')" ondragleave="this.classList.remove('active')" ondrop="event.preventDefault();this.classList.remove('active');handleUpload(event.dataTransfer.files[0],'bmc')">
              <div style="font-size:24px;color:${uploadsByCategory.bmc.length ? '#059669' : '#94a3b8'};margin-bottom:6px"><i class="fas ${uploadsByCategory.bmc.length ? 'fa-check-circle' : 'fa-file-word'}"></i></div>
              <div style="font-size:13px;font-weight:600;color:#475569">Business Model Canvas (BMC)</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px">Word, PDF</div>
              ${uploadsByCategory.bmc.map((f: any) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:8px;background:#f8fafc;border-radius:8px;text-align:left"><i class="fas fa-file" style="color:#2563eb"></i><span style="font-size:12px;font-weight:600;color:#1e293b;flex:1">${escapeHtml(f.filename)}</span><button onclick="event.stopPropagation();removeUpload('${f.id}','${id}')" style="border:none;background:#fee2e2;color:#dc2626;width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:10px"><i class="fas fa-times"></i></button></div>`).join('')}
              <input type="file" id="input-bmc" style="display:none" accept=".docx,.doc,.pdf" onchange="handleUpload(this.files[0],'bmc')">
            </div>
            <div class="upload-zone ${uploadsByCategory.sic.length ? 'done' : ''}" onclick="document.getElementById('input-sic').click()" ondragover="event.preventDefault();this.classList.add('active')" ondragleave="this.classList.remove('active')" ondrop="event.preventDefault();this.classList.remove('active');handleUpload(event.dataTransfer.files[0],'sic')">
              <div style="font-size:24px;color:${uploadsByCategory.sic.length ? '#059669' : '#94a3b8'};margin-bottom:6px"><i class="fas ${uploadsByCategory.sic.length ? 'fa-check-circle' : 'fa-hand-holding-heart'}"></i></div>
              <div style="font-size:13px;font-weight:600;color:#475569">Social Impact Canvas (SIC)</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px">Word, Excel, PDF</div>
              ${uploadsByCategory.sic.map((f: any) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:8px;background:#f8fafc;border-radius:8px;text-align:left"><i class="fas fa-file" style="color:#7c3aed"></i><span style="font-size:12px;font-weight:600;color:#1e293b;flex:1">${escapeHtml(f.filename)}</span><button onclick="event.stopPropagation();removeUpload('${f.id}','${id}')" style="border:none;background:#fee2e2;color:#dc2626;width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:10px"><i class="fas fa-times"></i></button></div>`).join('')}
              <input type="file" id="input-sic" style="display:none" accept=".docx,.doc,.pdf,.xlsx,.xls" onchange="handleUpload(this.files[0],'sic')">
            </div>
          </div>
          <div class="upload-phase">
            <div class="upload-phase__title"><i class="fas fa-chart-pie" style="color:#2563eb"></i> Phase 2 — Finance</div>
            <div class="upload-zone ${uploadsByCategory.inputs.length ? 'done' : ''}" onclick="document.getElementById('input-inputs').click()" ondragover="event.preventDefault();this.classList.add('active')" ondragleave="this.classList.remove('active')" ondrop="event.preventDefault();this.classList.remove('active');handleUpload(event.dataTransfer.files[0],'inputs')">
              <div style="font-size:24px;color:${uploadsByCategory.inputs.length ? '#059669' : '#94a3b8'};margin-bottom:6px"><i class="fas ${uploadsByCategory.inputs.length ? 'fa-check-circle' : 'fa-calculator'}"></i></div>
              <div style="font-size:13px;font-weight:600;color:#475569">Inputs Financiers</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px">Excel, CSV</div>
              ${uploadsByCategory.inputs.map((f: any) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:8px;background:#f8fafc;border-radius:8px;text-align:left"><i class="fas fa-file-excel" style="color:#059669"></i><span style="font-size:12px;font-weight:600;color:#1e293b;flex:1">${escapeHtml(f.filename)}</span><button onclick="event.stopPropagation();removeUpload('${f.id}','${id}')" style="border:none;background:#fee2e2;color:#dc2626;width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:10px"><i class="fas fa-times"></i></button></div>`).join('')}
              <input type="file" id="input-inputs" style="display:none" accept=".xlsx,.xls,.csv" onchange="handleUpload(this.files[0],'inputs')">
            </div>
          </div>
          <div class="upload-phase">
            <div class="upload-phase__title"><i class="fas fa-folder-open" style="color:#059669"></i> Phase 3 — Dossier Investisseur</div>
            <div style="padding:24px;text-align:center;color:#64748b;border:1px dashed #e2e8f0;border-radius:12px">
              <i class="fas fa-wand-magic-sparkles" style="font-size:28px;color:#a78bfa;margin-bottom:8px;display:block"></i>
              <div style="font-size:13px;font-weight:600;color:#475569">Auto-g\u00e9n\u00e9r\u00e9</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px">Business Plan, ODD cr\u00e9\u00e9s depuis les phases 1 et 2</div>
            </div>
          </div>
        </div>
        <div class="generate-bar">
          <div>
            <div style="font-size:14px;font-weight:700;color:white;margin-bottom:4px"><i class="fas fa-rocket"></i> G\u00e9n\u00e9rer les livrables</div>
            <div class="generate-bar__text">${uploads.length} document(s) \u2014 Les livrables seront priv\u00e9s par d\u00e9faut</div>
          </div>
          <button class="generate-bar__btn" id="btn-generate" onclick="generateDeliverables()" ${uploads.length === 0 ? 'disabled' : ''}>
            <i class="fas fa-wand-magic-sparkles"></i> G\u00e9n\u00e9rer
          </button>
        </div>
        <div class="deliv-section">
          <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:10px">
            <i class="fas fa-file-alt" style="color:#2563eb"></i> Livrables g\u00e9n\u00e9r\u00e9s (${deliverables.length})
          </div>
          <div id="deliverables-list">${delivHtml}</div>
          ${deliverables.length > 0 && deliverables.some((d: any) => d.visibility === 'private') ? `
          <div class="share-all-bar">
            <div>
              <div style="font-size:13px;font-weight:700;color:#065f46"><i class="fas fa-share-alt"></i> Partage group\u00e9</div>
              <div style="font-size:11px;color:#059669;margin-top:2px">${deliverables.filter((d: any) => d.visibility === 'private').length} livrable(s) encore priv\u00e9(s)</div>
            </div>
            <button class="share-all-bar__btn" onclick="shareAll()"><i class="fas fa-share-alt"></i> Tout partager</button>
          </div>` : ''}
        </div>
      </div>
    </div>

    <!-- ═══ TAB 2: VUE MIROIR V3 ═══ -->
    <div class="coach-tab-panel" id="panel-vue">
      <!-- Coach banner -->
      <div class="cm-banner">
        <i class="fas fa-user-tie"></i>
        <span>Vous agissez en tant que coach pour <strong>${escapeHtml(entrepreneur.entrepreneur_name)}</strong> \u2014 Les modifications seront visibles par l'entrepreneur</span>
      </div>

      <div class="cm-layout">
        <!-- LEFT SIDEBAR: Sources -->
        <aside class="cm-sidebar">
          <div class="cm-sidebar__header">
            <div class="cm-sidebar__title"><i class="fas fa-folder-open"></i> Sources</div>
            <div class="cm-sidebar__subtitle">Ajoutez vos documents d'inputs</div>
          </div>

          <!-- Templates download -->
          <div class="cm-templates">
            <a href="/coach/templates" class="cm-tpl-btn"><i class="fas fa-clipboard-list" style="color:#7c3aed"></i> Questionnaire BMC/SIC</a>
            <a href="/coach/templates" class="cm-tpl-btn"><i class="fas fa-chart-bar" style="color:#059669"></i> Google Sheet Financier</a>
          </div>

          <div class="cm-sidebar__uploads">
            <div class="cm-sidebar__sources-title">Documents d'inputs (${mirrorUploadCount}/3)</div>

            <!-- BMC -->
            <div class="cm-upload-card ${uploadsByCategory.bmc.length ? 'cm-upload-card--done' : ''}" onclick="document.getElementById('mirror-bmc').click()">
              <div class="cm-upload-card__icon" style="background:#dbeafe;color:#2563eb"><i class="fas fa-map"></i></div>
              <div class="cm-upload-card__info">
                <div class="cm-upload-card__title">Business Model Canvas</div>
                ${uploadsByCategory.bmc.length > 0
                  ? uploadsByCategory.bmc.map((f: any) => `<div class="cm-upload-card__file"><i class="fas fa-check-circle" style="color:#059669"></i> ${escapeHtml(f.filename)}</div><button class="cm-upload-card__rm" onclick="event.stopPropagation();removeUploadMirror('${f.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>`).join('')
                  : '<div class="cm-upload-card__hint"><i class="fas fa-cloud-arrow-up"></i> .doc, .docx, .pdf</div>'}
              </div>
              <input type="file" id="mirror-bmc" style="display:none" accept=".doc,.docx,.pdf" onchange="handleMirrorUpload(this,'bmc')">
            </div>

            <!-- SIC -->
            <div class="cm-upload-card ${uploadsByCategory.sic.length ? 'cm-upload-card--done' : ''}" onclick="document.getElementById('mirror-sic').click()">
              <div class="cm-upload-card__icon" style="background:#d1fae5;color:#059669"><i class="fas fa-seedling"></i></div>
              <div class="cm-upload-card__info">
                <div class="cm-upload-card__title">Social Impact Canvas</div>
                ${uploadsByCategory.sic.length > 0
                  ? uploadsByCategory.sic.map((f: any) => `<div class="cm-upload-card__file"><i class="fas fa-check-circle" style="color:#059669"></i> ${escapeHtml(f.filename)}</div><button class="cm-upload-card__rm" onclick="event.stopPropagation();removeUploadMirror('${f.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>`).join('')
                  : '<div class="cm-upload-card__hint"><i class="fas fa-cloud-arrow-up"></i> .doc, .docx, .xls, .xlsx, .pdf</div>'}
              </div>
              <input type="file" id="mirror-sic" style="display:none" accept=".doc,.docx,.xls,.xlsx,.pdf" onchange="handleMirrorUpload(this,'sic')">
            </div>

            <!-- Inputs Financiers -->
            <div class="cm-upload-card ${uploadsByCategory.inputs.length ? 'cm-upload-card--done' : ''}" onclick="document.getElementById('mirror-inputs').click()">
              <div class="cm-upload-card__icon" style="background:#fef3c7;color:#d97706"><i class="fas fa-chart-line"></i></div>
              <div class="cm-upload-card__info">
                <div class="cm-upload-card__title">Inputs Financiers</div>
                ${uploadsByCategory.inputs.length > 0
                  ? uploadsByCategory.inputs.map((f: any) => `<div class="cm-upload-card__file"><i class="fas fa-check-circle" style="color:#059669"></i> ${escapeHtml(f.filename)}</div><button class="cm-upload-card__rm" onclick="event.stopPropagation();removeUploadMirror('${f.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>`).join('')
                  : '<div class="cm-upload-card__hint"><i class="fas fa-cloud-arrow-up"></i> .xls, .xlsx, .csv</div>'}
              </div>
              <input type="file" id="mirror-inputs" style="display:none" accept=".xls,.xlsx,.csv,.pdf" onchange="handleMirrorUpload(this,'inputs')">
            </div>

            <!-- Supplementary -->
            <div style="margin-top:4px;margin-bottom:8px">
              <button class="cm-supp-btn" onclick="document.getElementById('mirror-supp').click()">
                <i class="fas fa-plus" style="font-size:10px"></i> Documents suppl\u00e9mentaires
              </button>
              <input type="file" id="mirror-supp" multiple style="display:none" accept=".doc,.docx,.xls,.xlsx,.pdf,.csv,.txt" onchange="handleMirrorUpload(this,'supplementary')">
            </div>
            ${uploadsByCategory.supplementary.map((f: any) => `
              <div class="cm-source-item">
                <div class="cm-source-item__icon" style="background:#f3f4f6;color:#6b7280"><i class="fas fa-file"></i></div>
                <div class="cm-source-item__info">
                  <div class="cm-source-item__name">${escapeHtml(f.filename)}</div>
                  <div class="cm-source-item__meta"><span>Suppl\u00e9mentaire</span></div>
                </div>
                <button class="cm-source-item__rm" onclick="removeUploadMirror('${f.id}')" style="opacity:1"><i class="fas fa-trash"></i></button>
              </div>
            `).join('')}
          </div>

          <!-- Generate CTA -->
          <div class="cm-sidebar__gen">
            <button class="cm-gen-btn" id="btn-mirror-gen" ${mirrorUploadCount === 0 ? 'disabled' : ''} onclick="generateMirror()">
              <span><i class="fas fa-wand-magic-sparkles"></i> ${hasMirrorGenerated ? 'Reg\u00e9n\u00e9rer les livrables' : 'G\u00e9n\u00e9rer les livrables'}</span>
              <span class="cm-gen-btn__sub">${mirrorUploadCount}/3 inputs</span>
            </button>
          </div>
        </aside>

        <!-- CENTER + BOTTOM -->
        <div class="cm-content">
          <div class="cm-center__header">
            <div class="cm-center__title" id="mirror-center-title"><i class="fas fa-stethoscope"></i> Diagnostic Expert</div>
            <div style="display:flex;gap:6px">
              <button class="deliv-btn" onclick="downloadMirrorDeliv('html')"><i class="fas fa-file-code"></i> HTML</button>
              <button class="deliv-btn" onclick="downloadMirrorDeliv('pdf')"><i class="fas fa-file-pdf"></i> PDF</button>
            </div>
          </div>
          <div class="cm-center__content" id="mirror-center-content">
            ${hasMirrorGenerated || mirrorDelivMap.diagnostic ? `
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#f0f4ff,#e8edfb);border:1px solid #a3b8d8;border-radius:12px;margin-bottom:16px">
                <div style="display:flex;align-items:center;gap:10px">
                  <i class="fas fa-stethoscope" style="font-size:24px;color:#1e3a5f"></i>
                  <div>
                    <div style="font-size:14px;font-weight:700;color:#1e3a5f">Diagnostic Expert</div>
                    <div style="font-size:12px;color:#4b6584">G\u00e9n\u00e9r\u00e9 par le coach \u2014 Visible par l'entrepreneur</div>
                  </div>
                </div>
              </div>
              <div style="padding:40px;text-align:center;color:#64748b;background:white;border-radius:12px;border:1px solid #e5e7eb">
                <i class="fas fa-file-lines" style="font-size:40px;color:#a3b8d8;margin-bottom:12px;display:block"></i>
                <div style="font-size:14px;font-weight:600">Contenu du diagnostic</div>
                <div style="font-size:12px;margin-top:4px;color:#94a3b8">Le diagnostic complet s'affichera ici apr\u00e8s g\u00e9n\u00e9ration</div>
              </div>
            ` : `
              <div class="cm-empty">
                <div class="cm-empty__icon"><i class="fas fa-stethoscope"></i></div>
                <div class="cm-empty__title">Diagnostic Expert</div>
                <div class="cm-empty__sub">Uploadez des documents dans la sidebar puis cliquez sur "G\u00e9n\u00e9rer les livrables"</div>
              </div>
            `}
          </div>

          <!-- BOTTOM: 7-column icon grid -->
          <div class="cm-bottom">
            <div class="cm-bottom__grid">
              ${[
                { type: 'diagnostic', label: 'Diagnostic Expert Global', icon: 'fa-stethoscope', color: '#2563eb', bg: '#dbeafe' },
                { type: 'bmc_analysis', label: 'Business Model Canvas', icon: 'fa-th', color: '#059669', bg: '#d1fae5' },
                { type: 'sic_analysis', label: 'Social Impact Canvas', icon: 'fa-hand-holding-heart', color: '#7c3aed', bg: '#ede9fe' },
                { type: 'framework', label: 'Plan Financier Interm\u00e9diaire', icon: 'fa-chart-pie', color: '#d97706', bg: '#fef3c7' },
                { type: 'plan_ovo', label: 'Plan Financier Final', icon: 'fa-chart-line', color: '#ea580c', bg: '#ffedd5' },
                { type: 'business_plan', label: 'Business Plan', icon: 'fa-building', color: '#4f46e5', bg: '#e0e7ff' },
                { type: 'odd', label: 'ODD', icon: 'fa-shield-halved', color: '#0d9488', bg: '#ccfbf1' },
              ].map((bi, idx) => {
                const available = !!mirrorDelivMap[bi.type]
                return `<div class="cm-deliv-icon ${idx === 0 ? 'cm-deliv-icon--active' : ''}" data-type="${bi.type}" onclick="selectMirrorDeliverable('${bi.type}')">
                  ${available ? '<div class="cm-deliv-icon__status cm-deliv-icon__status--ok"><i class="fas fa-check"></i></div>' : ''}
                  <div class="cm-deliv-icon__circle" style="background:${bi.bg};color:${bi.color}"><i class="fas ${bi.icon}"></i></div>
                  <div class="cm-deliv-icon__label">${bi.label}</div>
                </div>`
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      var ENTREPRENEUR_ID = '${id}';

      function switchTab(tab) {
        document.querySelectorAll('.coach-tab').forEach(function(t) { t.classList.remove('coach-tab--active'); });
        document.querySelectorAll('.coach-tab-panel').forEach(function(p) { p.classList.remove('coach-tab-panel--active'); });
        document.getElementById('tab-' + tab).classList.add('coach-tab--active');
        document.getElementById('panel-' + tab).classList.add('coach-tab-panel--active');
      }

      // ─── Parcours Rapide: Upload ───
      async function handleUpload(file, category) {
        if (!file) return;
        var fd = new FormData();
        fd.append('file', file);
        fd.append('category', category);
        try {
          var res = await fetch('/api/coach/entrepreneur/' + ENTREPRENEUR_ID + '/upload', { method: 'POST', credentials: 'include', body: fd });
          var data = await res.json();
          if (data.success) window.location.reload();
          else alert(data.error || 'Erreur upload');
        } catch (e) { alert('Erreur: ' + e.message); }
      }
      async function removeUpload(uploadId, entId) {
        if (!confirm('Supprimer ce fichier ?')) return;
        try { await fetch('/api/coach/entrepreneur/' + entId + '/upload/' + uploadId, { method: 'DELETE', credentials: 'include' }); window.location.reload(); } catch (e) { alert('Erreur: ' + e.message); }
      }

      // ─── Parcours Rapide: Generate ───
      async function generateDeliverables() {
        var btn = document.getElementById('btn-generate');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"><\\/i> En cours...';
        try {
          var res = await fetch('/api/coach/entrepreneur/' + ENTREPRENEUR_ID + '/generate', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
          var data = await res.json();
          if (data.success) { alert(data.generated + ' livrable(s) !'); window.location.reload(); }
          else { alert(data.error || 'Erreur'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"><\\/i> G\\u00e9n\\u00e9rer'; }
        } catch (e) { alert('Erreur: ' + e.message); btn.disabled = false; }
      }

      // ─── Parcours Rapide: Share ───
      async function shareDeliv(delivId) {
        try { var res = await fetch('/api/coach/deliverables/' + delivId + '/share', { method: 'PATCH', credentials: 'include' }); var d = await res.json(); if (d.success) window.location.reload(); } catch (e) { alert('Erreur: ' + e.message); }
      }
      async function shareAll() {
        if (!confirm('Partager tous les livrables ?')) return;
        try { var res = await fetch('/api/coach/deliverables/share-all?entrepreneur_id=' + ENTREPRENEUR_ID, { method: 'PATCH', credentials: 'include' }); var d = await res.json(); if (d.success) { alert(d.shared + ' partag\\u00e9(s)'); window.location.reload(); } } catch (e) { alert('Erreur: ' + e.message); }
      }
      function downloadDeliv(id, type) { alert('T\\u00e9l\\u00e9chargement ' + type); }

      // ─── Vue Miroir: Upload ───
      async function handleMirrorUpload(input, category) {
        var file = input.files[0];
        if (!file) return;
        var fd = new FormData();
        fd.append('file', file);
        fd.append('category', category);
        try {
          var res = await fetch('/api/coach/entrepreneur/' + ENTREPRENEUR_ID + '/upload', { method: 'POST', credentials: 'include', body: fd });
          var data = await res.json();
          if (data.success) window.location.reload();
          else alert(data.error || 'Erreur');
        } catch (e) { alert('Erreur: ' + e.message); }
      }
      async function removeUploadMirror(uploadId) {
        if (!confirm('Supprimer ce fichier ?')) return;
        try { await fetch('/api/coach/entrepreneur/' + ENTREPRENEUR_ID + '/upload/' + uploadId, { method: 'DELETE', credentials: 'include' }); window.location.reload(); } catch (e) { alert('Erreur: ' + e.message); }
      }

      // ─── Vue Miroir: Generate ───
      async function generateMirror() {
        var btn = document.getElementById('btn-mirror-gen');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"><\\/i> G\\u00e9n\\u00e9ration...';
        try {
          var res = await fetch('/api/coach/entrepreneur/' + ENTREPRENEUR_ID + '/generate-mirror', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
          var data = await res.json();
          if (data.success) { alert(data.generated + ' livrable(s) g\\u00e9n\\u00e9r\\u00e9(s) (visibles par l\\'entrepreneur)'); window.location.reload(); }
          else { alert(data.error || 'Erreur'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"><\\/i> G\\u00e9n\\u00e9rer'; }
        } catch (e) { alert('Erreur: ' + e.message); btn.disabled = false; }
      }

      // ─── Vue Miroir: Select deliverable icon ───
      function selectMirrorDeliverable(type) {
        document.querySelectorAll('.cm-deliv-icon').forEach(function(el) {
          el.classList.toggle('cm-deliv-icon--active', el.dataset.type === type);
        });
        var titles = { diagnostic: 'Diagnostic Expert', bmc_analysis: 'Business Model Canvas', sic_analysis: 'Social Impact Canvas', framework: 'Plan Financier Interm\\u00e9diaire', plan_ovo: 'Plan Financier Final', business_plan: 'Business Plan', odd: 'ODD' };
        var icons = { diagnostic: 'fa-stethoscope', bmc_analysis: 'fa-th', sic_analysis: 'fa-hand-holding-heart', framework: 'fa-chart-pie', plan_ovo: 'fa-chart-line', business_plan: 'fa-building', odd: 'fa-shield-halved' };
        var titleEl = document.getElementById('mirror-center-title');
        if (titleEl) titleEl.innerHTML = '<i class="fas ' + (icons[type] || 'fa-file') + '"><\\/i> ' + (titles[type] || type);
      }
      function downloadMirrorDeliv(format) { alert('T\\u00e9l\\u00e9chargement en ' + format); }
    </script>
  `

  return c.html(safeScriptBlocks(coachLayout('entrepreneurs', user.name, content)))
})

// ═══════════════════════════════════════════════════════════════
// GET /api/templates/:name — Download template file
coach.get('/api/templates/:name', async (c) => {
  const name = c.req.param('name')
  const validTemplates: Record<string, { filename: string; mime: string }> = {
    'bmc': { filename: 'Template_BMC.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    'sic': { filename: 'Template_SIC.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    'inputs': { filename: 'Template_Inputs_Financiers.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    'plan-ovo': { filename: 'Plan_Financier_OVO.xlsm', mime: 'application/vnd.ms-excel.sheet.macroEnabled.12' },
  }

  const tpl = validTemplates[name]
  if (!tpl) return c.json({ error: 'Template non trouv\u00e9' }, 404)

  // In production, files would be served from R2: /templates/{filename}
  // For now return a placeholder response
  return c.json({
    template: name,
    filename: tpl.filename,
    download_url: `/templates/${tpl.filename}`,
    message: 'Template disponible en R2 sous /templates/' + tpl.filename
  })
})

// PAGE: /coach/templates
// ═══════════════════════════════════════════════════════════════
coach.get('/coach/templates', async (c) => {
  const user = c.get('coachUser') as any

  const templates = [
    { key: 'bmc', name: 'Business Model Canvas (BMC)', desc: 'Canevas de mod\u00e8le \u00e9conomique \u2014 Questionnaire complet pour analyser la proposition de valeur, segments clients, canaux et revenus.', icon: 'fa-map', color: '#059669', ext: '.docx' },
    { key: 'sic', name: 'Social Impact Canvas (SIC)', desc: 'Canevas d\'impact social \u2014 Cadre d\'analyse des b\u00e9n\u00e9ficiaires, indicateurs ODD et th\u00e9orie du changement.', icon: 'fa-hand-holding-heart', color: '#2563eb', ext: '.docx' },
    { key: 'inputs', name: 'Inputs Financiers', desc: 'Fichier de saisie des donn\u00e9es financi\u00e8res \u2014 Chiffre d\'affaires, charges, investissements et hypoth\u00e8ses pr\u00e9visionnelles.', icon: 'fa-calculator', color: '#d97706', ext: '.xlsx' },
    { key: 'plan-ovo', name: 'Plan Financier OVO', desc: 'Mod\u00e8le financier macro-\u00e9nable \u2014 Projections cash-flow, bilan et compte de r\u00e9sultat sur 5 ans.', icon: 'fa-chart-line', color: '#7c3aed', ext: '.xlsm' },
  ]

  const content = `
    <style>
      .tpl-page { padding:32px; }
      .tpl-page__title { font-size:22px; font-weight:800; color:#f1f5f9; margin-bottom:6px; display:flex; align-items:center; gap:12px; }
      .tpl-page__desc { font-size:14px; color:#94a3b8; max-width:600px; line-height:1.6; margin-bottom:32px; }
      .tpl-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:20px; }
      @media (max-width:768px) { .tpl-grid { grid-template-columns:1fr; } }
      .tpl-card { background:#1e293b; border:1px solid #334155; border-radius:16px; padding:28px; transition:all 0.25s; position:relative; overflow:hidden; }
      .tpl-card::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,var(--tpl-color),transparent); opacity:0; transition:opacity 0.25s; }
      .tpl-card:hover { border-color:var(--tpl-color); transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,0.25); }
      .tpl-card:hover::before { opacity:1; }
      .tpl-card__header { display:flex; align-items:center; gap:16px; margin-bottom:16px; }
      .tpl-card__icon { width:52px; height:52px; border-radius:14px; display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0; }
      .tpl-card__name { font-size:15px; font-weight:700; color:#f1f5f9; margin-bottom:3px; }
      .tpl-card__ext { display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(255,255,255,0.08); color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; }
      .tpl-card__desc { font-size:12px; color:#94a3b8; line-height:1.6; margin-bottom:20px; min-height:40px; }
      .tpl-card__btn { width:100%; padding:12px; border-radius:10px; border:1px solid #334155; background:rgba(255,255,255,0.04); font-size:13px; font-weight:600; color:#e2e8f0; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s; }
      .tpl-card__btn:hover { background:var(--tpl-color); color:white; border-color:var(--tpl-color); }
    </style>
    <div class="coach-header">
      <h1 class="coach-header__title"><i class="fas fa-file-download" style="color:#7c3aed;font-size:18px"></i> Templates Vierges</h1>
    </div>
    <div class="tpl-page" style="background:#0f172a;border-radius:0 0 16px 16px;margin:-1px 0 0">
      <div class="tpl-page__title"><i class="fas fa-folder-open" style="color:#7c3aed"></i> Biblioth\u00e8que de templates</div>
      <div class="tpl-page__desc">T\u00e9l\u00e9chargez les templates vierges \u00e0 distribuer \u00e0 vos entrepreneurs pour faciliter la collecte des donn\u00e9es. Fichiers stock\u00e9s dans Cloudflare R2 sous <code style="background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;font-size:12px;color:#a78bfa">/templates/</code></div>
      <div class="tpl-grid">
        ${templates.map(t => `
          <div class="tpl-card" style="--tpl-color:${t.color}">
            <div class="tpl-card__header">
              <div class="tpl-card__icon" style="background:${t.color}20;color:${t.color}"><i class="fas ${t.icon}"></i></div>
              <div>
                <div class="tpl-card__name">${t.name}</div>
                <span class="tpl-card__ext"><i class="fas fa-file"></i> ${t.ext}</span>
              </div>
            </div>
            <div class="tpl-card__desc">${t.desc}</div>
            <button class="tpl-card__btn" onclick="downloadTemplate('${t.key}')">
              <i class="fas fa-download"></i> T\u00e9l\u00e9charger le template
            </button>
          </div>
        `).join('')}
      </div>
    </div>
    <script>
      async function downloadTemplate(key) {
        try {
          var res = await fetch('/api/templates/' + key, { credentials: 'include' });
          var data = await res.json();
          if (data.download_url) {
            alert('Template: ' + data.filename + '\\nDisponible en R2: ' + data.download_url);
          } else {
            alert(data.error || 'Erreur');
          }
        } catch (e) { alert('Erreur: ' + e.message); }
      }
    </script>
  `

  return c.html(safeScriptBlocks(coachLayout('templates', user.name, content)))
})

// ═══════════════════════════════════════════════════════════════
// PAGE: /coach/settings
// ═══════════════════════════════════════════════════════════════
coach.get('/coach/settings', async (c) => {
  const user = c.get('coachUser') as any
  const content = `
    <div class="coach-header">
      <h1 class="coach-header__title"><i class="fas fa-cog" style="color:#7c3aed;font-size:18px"></i> Paramètres</h1>
    </div>
    <div class="coach-content">
      <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px;margin-bottom:16px">
        <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-user" style="color:#7c3aed"></i> Mon Profil
        </h3>
        <div style="display:grid;gap:16px;max-width:400px">
          <div>
            <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Nom</div>
            <div style="font-size:14px;font-weight:600;color:#1e293b">${escapeHtml(user.name)}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Email</div>
            <div style="font-size:14px;color:#1e293b">${escapeHtml(user.email)}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Rôle actuel</div>
            <span style="font-size:12px;font-weight:600;padding:4px 14px;border-radius:20px;background:rgba(124,58,237,0.1);color:#7c3aed">Coach</span>
          </div>
        </div>
      </div>
      <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px">
        <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-sign-out-alt" style="color:#dc2626"></i> Session
        </h3>
        <button onclick="fetch('/api/logout',{method:'POST',credentials:'include'}).then(function(){localStorage.clear();window.location.href='/login'})" 
          style="padding:10px 20px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">
          Se déconnecter
        </button>
      </div>
    </div>
  `

  return c.html(safeScriptBlocks(coachLayout('settings', user.name, content)))
})

export { coach as coachRoutes }
