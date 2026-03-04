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
// PAGE: /coach/entrepreneurs (alias — redirects to dashboard)
// ═══════════════════════════════════════════════════════════════
coach.get('/coach/entrepreneurs', (c) => c.redirect('/coach/dashboard'))

// ═══════════════════════════════════════════════════════════════
// PAGE: /coach/entrepreneur/:id (detail — placeholder)
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
      <div class="coach-content">
        <div style="text-align:center;padding:48px">
          <p style="color:#64748b;margin-bottom:16px">Cet entrepreneur n'existe pas ou ne fait pas partie de votre portefeuille.</p>
          <a href="/coach/dashboard" style="color:#7c3aed;font-weight:600;text-decoration:none"><i class="fas fa-arrow-left"></i> Retour au dashboard</a>
        </div>
      </div>
    `)))
  }

  const phase = getPhaseLabel(entrepreneur.phase)
  const content = `
    <div class="coach-header">
      <h1 class="coach-header__title">
        <a href="/coach/dashboard" style="color:#94a3b8;text-decoration:none;font-size:14px"><i class="fas fa-arrow-left"></i></a>
        <span>${escapeHtml(entrepreneur.entrepreneur_name)}</span>
        ${entrepreneur.enterprise_name ? `<span style="font-size:14px;font-weight:500;color:#94a3b8">— ${escapeHtml(entrepreneur.enterprise_name)}</span>` : ''}
      </h1>
    </div>
    <div class="coach-content">
      <div class="coach-stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:${phase.color}15;color:${phase.color}"><i class="fas ${phase.icon}"></i></div>
          <div class="coach-stat-card__body">
            <div class="coach-stat-card__value" style="font-size:18px">${phase.label}</div>
            <div class="coach-stat-card__label">Phase actuelle</div>
          </div>
        </div>
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:${getScoreColor(entrepreneur.score_ir)}15;color:${getScoreColor(entrepreneur.score_ir)}"><i class="fas fa-chart-bar"></i></div>
          <div class="coach-stat-card__body">
            <div class="coach-stat-card__value">${entrepreneur.score_ir || 0}<span style="font-size:14px;font-weight:500;color:#94a3b8">/100</span></div>
            <div class="coach-stat-card__label">Score IR</div>
            <div class="coach-stat-card__gauge">
              <div class="coach-stat-card__gauge-fill" style="width:${entrepreneur.score_ir || 0}%;background:${getScoreColor(entrepreneur.score_ir)}"></div>
            </div>
          </div>
        </div>
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:rgba(5,150,105,0.1);color:#059669"><i class="fas fa-check-circle"></i></div>
          <div class="coach-stat-card__body">
            <div class="coach-stat-card__value">${entrepreneur.modules_validated || 0}<span style="font-size:14px;font-weight:500;color:#94a3b8">/${entrepreneur.total_modules || 8}</span></div>
            <div class="coach-stat-card__label">Modules validés</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px">
          <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:8px">
            <i class="fas fa-id-card" style="color:#7c3aed"></i> Informations
          </h3>
          <div style="display:grid;gap:12px">
            <div><span style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase">Email</span><div style="font-size:13px;color:#1e293b;margin-top:2px">${escapeHtml(entrepreneur.email) || '—'}</div></div>
            <div><span style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase">Téléphone</span><div style="font-size:13px;color:#1e293b;margin-top:2px">${escapeHtml(entrepreneur.phone) || '—'}</div></div>
            <div><span style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase">Secteur</span><div style="font-size:13px;color:#1e293b;margin-top:2px">${escapeHtml(entrepreneur.sector) || '—'}</div></div>
            <div><span style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase">Ajouté le</span><div style="font-size:13px;color:#1e293b;margin-top:2px">${new Date(entrepreneur.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
          </div>
        </div>
        <div id="deliverables" style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px">
          <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:8px">
            <i class="fas fa-file-alt" style="color:#2563eb"></i> Livrables (${entrepreneur.deliverables_count || 0})
          </h3>
          <p style="font-size:13px;color:#94a3b8">Les livrables de cet entrepreneur apparaîtront ici.</p>
        </div>
      </div>
    </div>
  `

  return c.html(safeScriptBlocks(coachLayout('entrepreneurs', user.name, content)))
})

// ═══════════════════════════════════════════════════════════════
// PAGE: /coach/templates
// ═══════════════════════════════════════════════════════════════
coach.get('/coach/templates', async (c) => {
  const user = c.get('coachUser') as any

  const templates = [
    { name: 'Business Model Canvas (BMC)', desc: 'Canevas de modèle économique', icon: 'fa-map', color: '#059669', bg: 'rgba(5,150,105,0.1)' },
    { name: 'Social Impact Canvas (SIC)', desc: 'Canevas d\'impact social', icon: 'fa-hand-holding-heart', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    { name: 'Inputs Financiers', desc: 'Données financières de base', icon: 'fa-calculator', color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
    { name: 'Guide Entrepreneur', desc: 'Manuel d\'utilisation ESONO', icon: 'fa-book', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  ]

  const content = `
    <div class="coach-header">
      <h1 class="coach-header__title"><i class="fas fa-file-download" style="color:#7c3aed;font-size:18px"></i> Templates Vierges</h1>
    </div>
    <div class="coach-content">
      <p style="font-size:14px;color:#64748b;margin-bottom:20px">Téléchargez les templates vierges à distribuer à vos entrepreneurs pour faciliter la collecte des données.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">
        ${templates.map(t => `
          <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px;transition:all 0.2s;cursor:pointer" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.06)'" onmouseout="this.style.boxShadow='none'">
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
              <div style="width:44px;height:44px;border-radius:12px;background:${t.bg};color:${t.color};display:flex;align-items:center;justify-content:center;font-size:18px"><i class="fas ${t.icon}"></i></div>
              <div>
                <div style="font-size:14px;font-weight:700;color:#1e293b">${t.name}</div>
                <div style="font-size:12px;color:#94a3b8">${t.desc}</div>
              </div>
            </div>
            <button style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:white;font-size:12px;font-weight:600;color:#475569;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.15s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
              <i class="fas fa-download"></i> Télécharger
            </button>
          </div>
        `).join('')}
      </div>
    </div>
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
