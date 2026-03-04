import { Hono } from 'hono'
import { getAuthToken, verifyToken } from './auth'

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
  await next()
}

coach.use('/coach/*', requireCoach)

// ─── Coach layout helper ───
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
    body { font-family:'Inter',system-ui,sans-serif; background:white; color:#1e293b; min-height:100vh; }

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
      font-size:14px; font-weight:800; color:white;
    }
    .coach-sidebar__brand-text {
      display:flex; flex-direction:column;
    }
    .coach-sidebar__brand-name {
      font-size:15px; font-weight:700; color:white; letter-spacing:0.5px;
    }
    .coach-sidebar__brand-sub {
      font-size:11px; color:#9ca3af; margin-top:2px;
    }

    /* Nav links */
    .coach-nav { flex:1; padding:16px 10px; display:flex; flex-direction:column; gap:4px; }
    .coach-nav__link {
      display:flex; align-items:center; gap:12px;
      padding:10px 14px; border-radius:8px;
      font-size:13px; font-weight:500; color:#9ca3af;
      text-decoration:none; transition:all 0.15s;
      border-left:3px solid transparent;
    }
    .coach-nav__link:hover { background:#1e293b; color:#e2e8f0; }
    .coach-nav__link--active {
      background:#1e293b; color:white; font-weight:600;
      border-left-color:#7c3aed;
    }
    .coach-nav__link i { width:18px; text-align:center; font-size:14px; }

    /* Switch role */
    .coach-sidebar__footer {
      padding:12px 10px; border-top:1px solid rgba(255,255,255,0.08);
      display:flex; flex-direction:column; gap:8px;
    }
    .coach-switch-btn {
      display:flex; align-items:center; gap:10px;
      padding:10px 14px; border-radius:8px;
      font-size:12px; font-weight:600; color:#a78bfa;
      text-decoration:none; background:rgba(124,58,237,0.1);
      transition:all 0.15s; border:none; cursor:pointer; width:100%; text-align:left;
    }
    .coach-switch-btn:hover { background:rgba(124,58,237,0.2); color:#c4b5fd; }
    .coach-sidebar__user {
      padding:8px 14px; font-size:11px; color:#6b7280;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }

    /* ===== MAIN CONTENT ===== */
    .coach-main { margin-left:240px; min-height:100vh; }
    .coach-header {
      padding:20px 32px; border-bottom:1px solid #f1f5f9;
      display:flex; align-items:center; justify-content:space-between;
      background:white; position:sticky; top:0; z-index:50;
    }
    .coach-header__title { font-size:20px; font-weight:700; color:#1e293b; }
    .coach-header__actions { display:flex; align-items:center; gap:12px; }
    .coach-content { padding:24px 32px; }

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
    }

    /* ===== CARDS / STATS ===== */
    .coach-stats { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; margin-bottom:24px; }
    .coach-stat-card {
      background:white; border:1px solid #f1f5f9; border-radius:12px;
      padding:20px; display:flex; flex-direction:column; gap:8px;
    }
    .coach-stat-card__icon {
      width:40px; height:40px; border-radius:10px;
      display:flex; align-items:center; justify-content:center;
      font-size:16px;
    }
    .coach-stat-card__value { font-size:24px; font-weight:800; color:#1e293b; }
    .coach-stat-card__label { font-size:12px; color:#64748b; font-weight:500; }
    .coach-card {
      background:white; border:1px solid #f1f5f9; border-radius:12px;
      padding:24px; margin-bottom:16px;
    }
    .coach-card__title {
      font-size:16px; font-weight:700; color:#1e293b; margin-bottom:16px;
      display:flex; align-items:center; gap:10px;
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

    <nav class="coach-nav">
      ${navHtml}
    </nav>

    <div class="coach-sidebar__footer">
      <a href="/select-role" class="coach-switch-btn">
        <i class="fas fa-sync-alt"></i>
        <span>Basculer en Entrepreneur</span>
      </a>
      <div class="coach-sidebar__user">
        <i class="fas fa-user-circle"></i> ${userName}
      </div>
    </div>
  </aside>

  <div class="coach-main">
    ${content}
  </div>
</body>
</html>`
}

// ─── Dashboard ───
coach.get('/coach/dashboard', async (c) => {
  const user = c.get('coachUser') as any

  // Count entrepreneurs (all users except current)
  const stats = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as total_users,
      SUM(CASE WHEN role = 'entrepreneur' OR role IS NULL THEN 1 ELSE 0 END) as entrepreneurs
    FROM users WHERE id != ?
  `).bind(user.id).first()

  // Count deliverables generated
  const deliverables = await c.env.DB.prepare(`
    SELECT COUNT(*) as total FROM module_analyses
  `).first()

  const totalEntrepreneurs = (stats?.entrepreneurs as number) || 0
  const totalDeliverables = (deliverables?.total as number) || 0

  const content = `
    <div class="coach-header">
      <h1 class="coach-header__title"><i class="fas fa-chart-line" style="color:#7c3aed;margin-right:8px;font-size:18px"></i> Dashboard</h1>
      <div class="coach-header__actions">
        <span style="font-size:12px;color:#64748b"><i class="fas fa-clock"></i> ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </div>
    </div>
    <div class="coach-content">
      <div class="coach-stats">
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:rgba(124,58,237,0.1);color:#7c3aed">
            <i class="fas fa-users"></i>
          </div>
          <div class="coach-stat-card__value">${totalEntrepreneurs}</div>
          <div class="coach-stat-card__label">Entrepreneurs inscrits</div>
        </div>
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:rgba(5,150,105,0.1);color:#059669">
            <i class="fas fa-file-alt"></i>
          </div>
          <div class="coach-stat-card__value">${totalDeliverables}</div>
          <div class="coach-stat-card__label">Livrables générés</div>
        </div>
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:rgba(234,179,8,0.1);color:#d97706">
            <i class="fas fa-tasks"></i>
          </div>
          <div class="coach-stat-card__value">8</div>
          <div class="coach-stat-card__label">Modules actifs</div>
        </div>
        <div class="coach-stat-card">
          <div class="coach-stat-card__icon" style="background:rgba(220,38,38,0.1);color:#dc2626">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <div class="coach-stat-card__value">—</div>
          <div class="coach-stat-card__label">Alertes en attente</div>
        </div>
      </div>

      <div class="coach-card">
        <div class="coach-card__title"><i class="fas fa-bolt" style="color:#d97706"></i> Actions rapides</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
          <a href="/coach/entrepreneurs" style="padding:14px;border-radius:10px;border:1px solid #e2e8f0;text-decoration:none;display:flex;align-items:center;gap:10px;transition:all 0.15s;color:#1e293b">
            <i class="fas fa-user-plus" style="color:#7c3aed"></i>
            <span style="font-size:13px;font-weight:600">Voir les entrepreneurs</span>
          </a>
          <a href="/coach/templates" style="padding:14px;border-radius:10px;border:1px solid #e2e8f0;text-decoration:none;display:flex;align-items:center;gap:10px;transition:all 0.15s;color:#1e293b">
            <i class="fas fa-download" style="color:#059669"></i>
            <span style="font-size:13px;font-weight:600">Templates vierges</span>
          </a>
          <a href="/select-role" style="padding:14px;border-radius:10px;border:1px solid #e2e8f0;text-decoration:none;display:flex;align-items:center;gap:10px;transition:all 0.15s;color:#1e293b">
            <i class="fas fa-sync-alt" style="color:#a78bfa"></i>
            <span style="font-size:13px;font-weight:600">Mode Entrepreneur</span>
          </a>
        </div>
      </div>

      <div class="coach-card">
        <div class="coach-card__title"><i class="fas fa-users" style="color:#2563eb"></i> Derniers entrepreneurs</div>
        <p style="font-size:13px;color:#64748b">La liste détaillée est disponible dans l'onglet <a href="/coach/entrepreneurs" style="color:#7c3aed;font-weight:600">Mes Entrepreneurs</a>.</p>
      </div>
    </div>
  `

  return c.html(coachLayout('dashboard', user.name, content))
})

// ─── Mes Entrepreneurs (placeholder) ───
coach.get('/coach/entrepreneurs', async (c) => {
  const user = c.get('coachUser') as any

  const users = await c.env.DB.prepare(`
    SELECT u.id, u.name, u.email, u.created_at,
      (SELECT COUNT(*) FROM module_analyses WHERE user_id = u.id) as deliverable_count
    FROM users u
    WHERE u.id != ? AND (u.role = 'entrepreneur' OR u.role IS NULL)
    ORDER BY u.created_at DESC
    LIMIT 50
  `).bind(user.id).all()

  const rows = (users.results || []).map((u: any) => `
    <tr>
      <td style="padding:12px 16px;font-weight:600;font-size:13px">${u.name || '—'}</td>
      <td style="padding:12px 16px;font-size:13px;color:#64748b">${u.email}</td>
      <td style="padding:12px 16px;text-align:center">
        <span style="background:rgba(124,58,237,0.1);color:#7c3aed;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600">${u.deliverable_count || 0}</span>
      </td>
      <td style="padding:12px 16px;font-size:12px;color:#94a3b8">${new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
      <td style="padding:12px 16px">
        <a href="/coach/entrepreneur/${u.id}" style="font-size:12px;color:#7c3aed;font-weight:600;text-decoration:none">
          <i class="fas fa-eye"></i> Voir le dossier
        </a>
      </td>
    </tr>
  `).join('')

  const content = `
    <div class="coach-header">
      <h1 class="coach-header__title"><i class="fas fa-users" style="color:#7c3aed;margin-right:8px;font-size:18px"></i> Mes Entrepreneurs</h1>
    </div>
    <div class="coach-content">
      <div class="coach-card" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:2px solid #f1f5f9">
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Nom</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Email</th>
              <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Livrables</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Inscrit le</th>
              <th style="padding:10px 16px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#94a3b8;font-size:13px">Aucun entrepreneur pour le moment</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `

  return c.html(coachLayout('entrepreneurs', user.name, content))
})

// ─── Templates Vierges (placeholder) ───
coach.get('/coach/templates', async (c) => {
  const user = c.get('coachUser') as any
  const content = `
    <div class="coach-header">
      <h1 class="coach-header__title"><i class="fas fa-file-download" style="color:#7c3aed;margin-right:8px;font-size:18px"></i> Templates Vierges</h1>
    </div>
    <div class="coach-content">
      <div class="coach-card">
        <div class="coach-card__title"><i class="fas fa-file-excel" style="color:#059669"></i> Templates disponibles</div>
        <p style="font-size:13px;color:#64748b;margin-bottom:16px">Téléchargez les templates vierges à distribuer à vos entrepreneurs.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
          <div style="padding:16px;border:1px solid #e2e8f0;border-radius:10px;display:flex;align-items:center;gap:12px">
            <div style="width:36px;height:36px;border-radius:8px;background:rgba(5,150,105,0.1);color:#059669;display:flex;align-items:center;justify-content:center"><i class="fas fa-file-excel"></i></div>
            <div>
              <div style="font-size:13px;font-weight:600;color:#1e293b">Template BMC</div>
              <div style="font-size:11px;color:#94a3b8">Business Model Canvas</div>
            </div>
          </div>
          <div style="padding:16px;border:1px solid #e2e8f0;border-radius:10px;display:flex;align-items:center;gap:12px">
            <div style="width:36px;height:36px;border-radius:8px;background:rgba(37,99,235,0.1);color:#2563eb;display:flex;align-items:center;justify-content:center"><i class="fas fa-file-excel"></i></div>
            <div>
              <div style="font-size:13px;font-weight:600;color:#1e293b">Template SIC</div>
              <div style="font-size:11px;color:#94a3b8">Social Impact Canvas</div>
            </div>
          </div>
          <div style="padding:16px;border:1px solid #e2e8f0;border-radius:10px;display:flex;align-items:center;gap:12px">
            <div style="width:36px;height:36px;border-radius:8px;background:rgba(217,119,6,0.1);color:#d97706;display:flex;align-items:center;justify-content:center"><i class="fas fa-file-excel"></i></div>
            <div>
              <div style="font-size:13px;font-weight:600;color:#1e293b">Template Inputs</div>
              <div style="font-size:11px;color:#94a3b8">Données financières</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  return c.html(coachLayout('templates', user.name, content))
})

// ─── Paramètres (placeholder) ───
coach.get('/coach/settings', async (c) => {
  const user = c.get('coachUser') as any
  const content = `
    <div class="coach-header">
      <h1 class="coach-header__title"><i class="fas fa-cog" style="color:#7c3aed;margin-right:8px;font-size:18px"></i> Paramètres</h1>
    </div>
    <div class="coach-content">
      <div class="coach-card">
        <div class="coach-card__title"><i class="fas fa-user" style="color:#64748b"></i> Mon Profil</div>
        <div style="display:grid;gap:12px;max-width:400px">
          <div>
            <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px">Nom</div>
            <div style="font-size:14px;font-weight:600;color:#1e293b">${user.name}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px">Email</div>
            <div style="font-size:14px;color:#1e293b">${user.email}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px">Rôle actuel</div>
            <span style="font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;background:rgba(124,58,237,0.1);color:#7c3aed">Coach</span>
          </div>
        </div>
      </div>
      <div class="coach-card">
        <div class="coach-card__title"><i class="fas fa-sign-out-alt" style="color:#dc2626"></i> Session</div>
        <button onclick="fetch('/api/logout',{method:'POST',credentials:'include'}).then(function(){localStorage.clear();window.location.href='/login'})" 
          style="padding:10px 20px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;font-size:13px;font-weight:600;cursor:pointer">
          Se déconnecter
        </button>
      </div>
    </div>
  `

  return c.html(coachLayout('settings', user.name, content))
})

export { coach as coachRoutes }
