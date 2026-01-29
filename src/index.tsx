import { Hono } from 'hono'
import { renderer } from './renderer'
import { cors } from 'hono/cors'
import { hashPassword, verifyPassword, generateToken, verifyToken } from './auth'
import { getCookie, setCookie } from 'hono/cookie'
import { getUserWithProgress } from './dashboard'
import { getCookieOptions } from './cookies'
import { moduleRoutes } from './module-routes'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use(renderer)
app.use('/api/*', cors())

// Mount module routes
app.route('/', moduleRoutes)

// Landing Page - A1
app.get('/', (c) => {
  return c.render(
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-green-50">
      <div class="max-w-5xl mx-auto px-4 py-16">
        {/* Header */}
        <div class="text-center mb-16">
          <div class="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-600 to-green-600 rounded-2xl mb-6 shadow-lg">
            <i class="fas fa-graduation-cap text-3xl text-white"></i>
          </div>
          <h1 class="text-5xl font-bold text-gray-900 mb-4">
            Transformez votre idée en entreprise finançable
          </h1>
          <p class="text-xl text-gray-600 max-w-2xl mx-auto">
            Une plateforme qui accompagne les entrepreneurs africains de l'apprentissage au financement
          </p>
        </div>

        {/* Main Question */}
        <div class="mb-12">
          <h2 class="text-3xl font-semibold text-center text-gray-800 mb-8">
            Quel est votre point de départ ?
          </h2>
        </div>

        {/* Choice Cards */}
        <div class="grid md:grid-cols-2 gap-8 mb-12">
          {/* Pre-entrepreneur Card */}
          <a href="/register?type=pre_entrepreneur" class="group block">
            <div class="bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 p-8 border-2 border-transparent hover:border-blue-500 h-full">
              <div class="flex flex-col h-full">
                <div class="flex items-center justify-center w-16 h-16 bg-blue-100 rounded-xl mb-6 group-hover:bg-blue-500 transition-colors">
                  <i class="fas fa-lightbulb text-3xl text-blue-600 group-hover:text-white transition-colors"></i>
                </div>
                <h3 class="text-2xl font-bold text-gray-900 mb-4">
                  Je souhaite devenir entrepreneur
                </h3>
                <p class="text-gray-600 mb-6 flex-grow">
                  Découvrir l'entrepreneuriat, apprendre les fondamentaux et tester mes idées
                </p>
                <div class="space-y-3">
                  <div class="flex items-start gap-3">
                    <i class="fas fa-check text-blue-600 mt-1"></i>
                    <span class="text-sm text-gray-700">Formation pas à pas</span>
                  </div>
                  <div class="flex items-start gap-3">
                    <i class="fas fa-check text-blue-600 mt-1"></i>
                    <span class="text-sm text-gray-700">Validation de compétences</span>
                  </div>
                  <div class="flex items-start gap-3">
                    <i class="fas fa-check text-blue-600 mt-1"></i>
                    <span class="text-sm text-gray-700">Accompagnement IA & Coach</span>
                  </div>
                </div>
                <div class="mt-6 flex items-center text-blue-600 font-semibold group-hover:gap-2 transition-all">
                  <span>Commencer l'apprentissage</span>
                  <i class="fas fa-arrow-right ml-2 group-hover:ml-4 transition-all"></i>
                </div>
              </div>
            </div>
          </a>

          {/* Entrepreneur Card */}
          <a href="/register?type=entrepreneur" class="group block">
            <div class="bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 p-8 border-2 border-transparent hover:border-green-500 h-full">
              <div class="flex flex-col h-full">
                <div class="flex items-center justify-center w-16 h-16 bg-green-100 rounded-xl mb-6 group-hover:bg-green-500 transition-colors">
                  <i class="fas fa-rocket text-3xl text-green-600 group-hover:text-white transition-colors"></i>
                </div>
                <h3 class="text-2xl font-bold text-gray-900 mb-4">
                  Je suis déjà entrepreneur
                </h3>
                <p class="text-gray-600 mb-6 flex-grow">
                  Structurer mon projet, crédibiliser mon entreprise et accéder au financement
                </p>
                <div class="space-y-3">
                  <div class="flex items-start gap-3">
                    <i class="fas fa-check text-green-600 mt-1"></i>
                    <span class="text-sm text-gray-700">Business Plan professionnel</span>
                  </div>
                  <div class="flex items-start gap-3">
                    <i class="fas fa-check text-green-600 mt-1"></i>
                    <span class="text-sm text-gray-700">Projections financières</span>
                  </div>
                  <div class="flex items-start gap-3">
                    <i class="fas fa-check text-green-600 mt-1"></i>
                    <span class="text-sm text-gray-700">Dossiers investisseurs</span>
                  </div>
                </div>
                <div class="mt-6 flex items-center text-green-600 font-semibold group-hover:gap-2 transition-all">
                  <span>Structurer mon entreprise</span>
                  <i class="fas fa-arrow-right ml-2 group-hover:ml-4 transition-all"></i>
                </div>
              </div>
            </div>
          </a>
        </div>

        {/* Features Banner */}
        <div class="bg-white rounded-xl shadow-md p-6">
          <div class="grid md:grid-cols-3 gap-6 text-center">
            <div>
              <div class="text-3xl font-bold text-blue-600 mb-2">5 Étapes</div>
              <div class="text-sm text-gray-600">Parcours structuré</div>
            </div>
            <div>
              <div class="text-3xl font-bold text-green-600 mb-2">IA + Coach</div>
              <div class="text-sm text-gray-600">Double validation</div>
            </div>
            <div>
              <div class="text-3xl font-bold text-purple-600 mb-2">100% Prêt</div>
              <div class="text-sm text-gray-600">Livrables investisseurs</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div class="text-center mt-12">
          <p class="text-gray-500 text-sm">
            Déjà inscrit ? <a href="/login" class="text-blue-600 hover:underline font-medium">Se connecter</a>
          </p>
        </div>
      </div>
    </div>
  )
})

// Register Page - A2
app.get('/register', (c) => {
  const userType = c.req.query('type') || 'entrepreneur'
  const isPreEntrepreneur = userType === 'pre_entrepreneur'
  
  return c.render(
    <div class="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 py-12 px-4">
      <div class="max-w-md mx-auto">
        {/* Header */}
        <div class="text-center mb-8">
          <a href="/" class="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-green-600 rounded-xl mb-4 shadow-lg">
            <i class="fas fa-graduation-cap text-2xl text-white"></i>
          </a>
          <h1 class="text-3xl font-bold text-gray-900 mb-2">
            {isPreEntrepreneur ? 'Commencer votre apprentissage' : 'Structurer votre entreprise'}
          </h1>
          <p class="text-gray-600">
            {isPreEntrepreneur 
              ? 'Créez votre compte pour accéder aux formations' 
              : 'Créez votre compte pour structurer votre projet'}
          </p>
        </div>

        {/* Registration Form */}
        <div class="bg-white rounded-2xl shadow-lg p-8">
          <form id="registerForm" class="space-y-6">
            <input type="hidden" name="user_type" value={userType} />
            
            {/* Name */}
            <div>
              <label for="name" class="block text-sm font-medium text-gray-700 mb-2">
                Nom complet <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="John Doe"
              />
            </div>

            {/* Email */}
            <div>
              <label for="email" class="block text-sm font-medium text-gray-700 mb-2">
                Email <span class="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="john@example.com"
              />
            </div>

            {/* Password */}
            <div>
              <label for="password" class="block text-sm font-medium text-gray-700 mb-2">
                Mot de passe <span class="text-red-500">*</span>
              </label>
              <input
                type="password"
                id="password"
                name="password"
                required
                minlength="6"
                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
              <p class="text-xs text-gray-500 mt-1">Minimum 6 caractères</p>
            </div>

            {/* Country */}
            <div>
              <label for="country" class="block text-sm font-medium text-gray-700 mb-2">
                Pays <span class="text-red-500">*</span>
              </label>
              <select
                id="country"
                name="country"
                required
                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Sélectionner un pays</option>
                <option value="SN">Sénégal</option>
                <option value="CI">Côte d'Ivoire</option>
                <option value="BF">Burkina Faso</option>
                <option value="ML">Mali</option>
                <option value="BJ">Bénin</option>
                <option value="TG">Togo</option>
                <option value="NE">Niger</option>
                <option value="CM">Cameroun</option>
                <option value="MA">Maroc</option>
                <option value="DZ">Algérie</option>
                <option value="TN">Tunisie</option>
                <option value="KE">Kenya</option>
                <option value="NG">Nigeria</option>
                <option value="GH">Ghana</option>
                <option value="RW">Rwanda</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label for="status" class="block text-sm font-medium text-gray-700 mb-2">
                Statut <span class="text-red-500">*</span>
              </label>
              <select
                id="status"
                name="status"
                required
                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Sélectionner un statut</option>
                <option value="student">Étudiant</option>
                <option value="entrepreneur">Entrepreneur</option>
                <option value="alumni">Alumni</option>
              </select>
            </div>

            {/* Terms */}
            <div class="flex items-start gap-3">
              <input
                type="checkbox"
                id="terms"
                name="terms"
                required
                class="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label for="terms" class="text-sm text-gray-600">
                J'accepte les conditions d'utilisation et la politique de confidentialité
              </label>
            </div>

            {/* Error message */}
            <div id="error-message" class="hidden bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm"></div>

            {/* Submit Button */}
            <button
              type="submit"
              class={`w-full py-3 px-4 rounded-lg text-white font-semibold ${isPreEntrepreneur ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'} transition-colors`}
            >
              <span id="submit-text">Créer mon compte</span>
              <span id="submit-loading" class="hidden">
                <i class="fas fa-spinner fa-spin mr-2"></i>Création en cours...
              </span>
            </button>
          </form>

          {/* Login Link */}
          <div class="text-center mt-6">
            <p class="text-gray-600 text-sm">
              Déjà inscrit ? <a href="/login" class="text-blue-600 hover:underline font-medium">Se connecter</a>
            </p>
          </div>
        </div>
      </div>

      <script src="/static/register.js"></script>
    </div>
  )
})

// Login Page
app.get('/login', (c) => {
  return c.render(
    <div class="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center px-4">
      <div class="max-w-md w-full">
        {/* Header */}
        <div class="text-center mb-8">
          <a href="/" class="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-green-600 rounded-xl mb-4 shadow-lg">
            <i class="fas fa-graduation-cap text-2xl text-white"></i>
          </a>
          <h1 class="text-3xl font-bold text-gray-900 mb-2">
            Bon retour !
          </h1>
          <p class="text-gray-600">
            Connectez-vous pour continuer votre parcours
          </p>
        </div>

        {/* Login Form */}
        <div class="bg-white rounded-2xl shadow-lg p-8">
          <form id="loginForm" class="space-y-6">
            {/* Email */}
            <div>
              <label for="email" class="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="john@example.com"
              />
            </div>

            {/* Password */}
            <div>
              <label for="password" class="block text-sm font-medium text-gray-700 mb-2">
                Mot de passe
              </label>
              <input
                type="password"
                id="password"
                name="password"
                required
                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>

            {/* Error message */}
            <div id="error-message" class="hidden bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm"></div>

            {/* Submit Button */}
            <button
              type="submit"
              class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <span id="submit-text">Se connecter</span>
              <span id="submit-loading" class="hidden">
                <i class="fas fa-spinner fa-spin mr-2"></i>Connexion...
              </span>
            </button>
          </form>

          {/* Register Link */}
          <div class="text-center mt-6">
            <p class="text-gray-600 text-sm">
              Pas encore de compte ? <a href="/" class="text-blue-600 hover:underline font-medium">S'inscrire</a>
            </p>
          </div>
        </div>
      </div>

      <script src="/static/login.js"></script>
    </div>
  )
})

// API: Register
app.post('/api/register', async (c) => {
  try {
    const { name, email, password, country, status, user_type } = await c.req.json()

    // Validate inputs
    if (!name || !email || !password || !country || !status || !user_type) {
      return c.json({ error: 'Tous les champs sont requis' }, 400)
    }

    if (password.length < 6) {
      return c.json({ error: 'Le mot de passe doit contenir au moins 6 caractères' }, 400)
    }

    // Check if email already exists
    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email).first()

    if (existingUser) {
      return c.json({ error: 'Cet email est déjà utilisé' }, 400)
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Insert user
    const result = await c.env.DB.prepare(`
      INSERT INTO users (email, password_hash, name, country, user_type, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(email, passwordHash, name, country, user_type, status).run()

    // Create default project
    const userId = result.meta.last_row_id
    await c.env.DB.prepare(`
      INSERT INTO projects (user_id, name, description)
      VALUES (?, ?, ?)
    `).bind(userId, `Projet de ${name}`, 'Mon projet entrepreneurial').run()

    // Generate JWT token
    const token = await generateToken({
      userId: Number(userId),
      email,
      userType: user_type
    })

    setCookie(c, 'auth_token', token, getCookieOptions(c))

    return c.json({
      success: true,
      user: { id: userId, name, email, userType: user_type }
    })
  } catch (error) {
    console.error('Registration error:', error)
    return c.json({ error: 'Erreur lors de la création du compte' }, 500)
  }
})

// API: Login
app.post('/api/login', async (c) => {
  try {
    const { email, password } = await c.req.json()

    if (!email || !password) {
      return c.json({ error: 'Email et mot de passe requis' }, 400)
    }

    // Find user
    const user = await c.env.DB.prepare(`
      SELECT id, email, password_hash, name, user_type
      FROM users
      WHERE email = ?
    `).bind(email).first()

    if (!user) {
      return c.json({ error: 'Email ou mot de passe incorrect' }, 401)
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash as string)
    if (!isValid) {
      return c.json({ error: 'Email ou mot de passe incorrect' }, 401)
    }

    // Generate JWT token
    const token = await generateToken({
      userId: user.id as number,
      email: user.email as string,
      userType: user.user_type as 'pre_entrepreneur' | 'entrepreneur'
    })

    setCookie(c, 'auth_token', token, getCookieOptions(c))

    return c.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        userType: user.user_type
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: 'Erreur lors de la connexion' }, 500)
  }
})

// API: Logout
app.post('/api/logout', (c) => {
  const opts = getCookieOptions(c)
  setCookie(c, 'auth_token', '', {
    ...opts,
    maxAge: 0
  })
  return c.json({ success: true })
})

// API: Get current user
app.get('/api/user', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    
    if (!token) {
      return c.json({ error: 'Non authentifié' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.json({ error: 'Token invalide' }, 401)
    }

    const user = await c.env.DB.prepare(`
      SELECT id, email, name, country, user_type, status, created_at
      FROM users
      WHERE id = ?
    `).bind(payload.userId).first()

    if (!user) {
      return c.json({ error: 'Utilisateur non trouvé' }, 404)
    }

    return c.json({ user })
  } catch (error) {
    console.error('Get user error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// Dashboard - A3
app.get('/dashboard', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    
    if (!token) {
      return c.redirect('/login')
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.redirect('/login')
    }

    const data = await getUserWithProgress(c.env.DB, payload.userId)
    if (!data) {
      return c.redirect('/login')
    }

    const { user, project, modules, progress, stats } = data
    const isPreEntrepreneur = user.user_type === 'pre_entrepreneur'

    return c.render(
      <div class="min-h-screen bg-gray-50">
        {/* Navigation Bar */}
        <nav class="bg-white border-b border-gray-200 shadow-sm">
          <div class="max-w-7xl mx-auto px-4 py-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-gradient-to-br from-blue-600 to-green-600 rounded-lg flex items-center justify-center">
                  <i class="fas fa-graduation-cap text-white"></i>
                </div>
                <div>
                  <h1 class="text-lg font-bold text-gray-900">Plateforme EdTech</h1>
                  <p class="text-xs text-gray-500">{project?.name || 'Mon Projet'}</p>
                </div>
              </div>
              <div class="flex items-center gap-4">
                <div class="text-right">
                  <p class="text-sm font-medium text-gray-900">{user.name}</p>
                  <p class="text-xs text-gray-500">{user.email}</p>
                </div>
                <button onclick="logout()" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
                  <i class="fas fa-sign-out-alt mr-2"></i>Déconnexion
                </button>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <div class="max-w-7xl mx-auto px-4 py-8">
          {/* Welcome Banner */}
          <div class={`mb-8 p-6 rounded-2xl ${isPreEntrepreneur ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-gradient-to-br from-green-500 to-green-600'} text-white shadow-lg`}>
            <div class="flex items-start justify-between">
              <div>
                <h2 class="text-2xl font-bold mb-2">
                  Bienvenue, {user.name} ! 👋
                </h2>
                <p class="text-blue-100 mb-4">
                  {isPreEntrepreneur 
                    ? 'Progressez dans votre apprentissage entrepreneurial' 
                    : 'Continuez à structurer votre entreprise'}
                </p>
                <div class="flex items-center gap-6">
                  <div>
                    <div class="text-3xl font-bold">{stats.completedModules}/{stats.totalModules}</div>
                    <div class="text-sm text-blue-100">Modules complétés</div>
                  </div>
                  <div>
                    <div class="text-3xl font-bold">Étape {stats.currentStep}</div>
                    <div class="text-sm text-blue-100">Sur 5 étapes</div>
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-4xl font-bold mb-1">{stats.progressPercentage}%</div>
                <div class="text-sm text-blue-100">Progression globale</div>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div class="mb-8 bg-white rounded-xl shadow-md p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">Votre Parcours</h3>
            <div class="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map(step => {
                const isCompleted = step < stats.currentStep
                const isCurrent = step === stats.currentStep
                return (
                  <div class="flex-1 flex items-center">
                    <div class="flex-1 flex items-center">
                      <div class={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                        isCompleted ? 'bg-green-500 text-white' : 
                        isCurrent ? 'bg-blue-500 text-white' : 
                        'bg-gray-200 text-gray-500'
                      }`}>
                        {isCompleted ? <i class="fas fa-check"></i> : step}
                      </div>
                      {step < 5 && (
                        <div class={`flex-1 h-1 ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}`}></div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div class="flex justify-between mt-3">
              <div class="text-xs text-gray-600 text-center" style="width: 20%">Activité</div>
              <div class="text-xs text-gray-600 text-center" style="width: 20%">Finances</div>
              <div class="text-xs text-gray-600 text-center" style="width: 20%">Projections</div>
              <div class="text-xs text-gray-600 text-center" style="width: 20%">Business Plan</div>
              <div class="text-xs text-gray-600 text-center" style="width: 20%">Impact ODD</div>
            </div>
          </div>

          {/* Next Step Card */}
          {stats.nextModule && (
            <div class="mb-8 bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-xl shadow-md p-6">
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-3">
                    <i class="fas fa-star text-yellow-500"></i>
                    <h3 class="text-lg font-semibold text-gray-900">Prochaine Étape Recommandée</h3>
                  </div>
                  <h4 class="text-xl font-bold text-gray-900 mb-2">{stats.nextModule.title}</h4>
                  <p class="text-gray-600 mb-4">{stats.nextModule.description}</p>
                  <div class="flex items-center gap-4 text-sm text-gray-600">
                    <span><i class="far fa-clock mr-1"></i>{stats.nextModule.estimated_time} min</span>
                    <span><i class="fas fa-layer-group mr-1"></i>Étape {stats.nextModule.step_number}</span>
                  </div>
                </div>
                <a href={`/module/${stats.nextModule.module_code}`} class="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors">
                  Commencer
                  <i class="fas fa-arrow-right ml-2"></i>
                </a>
              </div>
            </div>
          )}

          {/* Modules Grid */}
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-gray-900 mb-6">Tous les Modules</h3>
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(modules as any[]).map(module => {
                const moduleProgress = (progress as any[]).find((p: any) => p.module_id === module.id)
                const isCompleted = moduleProgress?.status === 'completed'
                const isInProgress = moduleProgress?.status === 'in_progress'
                const isNotStarted = !moduleProgress || moduleProgress.status === 'not_started'

                return (
                  <a href={`/module/${module.module_code}`} class="block group">
                    <div class="bg-white rounded-xl shadow-md hover:shadow-xl transition-all p-6 border-2 border-transparent hover:border-blue-300 h-full">
                      <div class="flex items-start justify-between mb-4">
                        <div class={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          isCompleted ? 'bg-green-100' : isInProgress ? 'bg-blue-100' : 'bg-gray-100'
                        }`}>
                          {isCompleted ? (
                            <i class="fas fa-check-circle text-2xl text-green-600"></i>
                          ) : isInProgress ? (
                            <i class="fas fa-spinner text-2xl text-blue-600"></i>
                          ) : (
                            <i class="fas fa-circle text-2xl text-gray-400"></i>
                          )}
                        </div>
                        <span class="text-sm font-medium text-gray-500">Étape {module.step_number}</span>
                      </div>
                      
                      <h4 class="text-lg font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                        {module.title}
                      </h4>
                      <p class="text-sm text-gray-600 mb-4 line-clamp-2">{module.description}</p>
                      
                      <div class="flex items-center justify-between text-xs text-gray-500">
                        <span><i class="far fa-clock mr-1"></i>{module.estimated_time} min</span>
                        {isCompleted && moduleProgress?.quiz_passed && (
                          <span class="text-green-600 font-medium">
                            <i class="fas fa-trophy mr-1"></i>{moduleProgress.quiz_score}%
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>

          {/* Stats Cards */}
          <div class="grid md:grid-cols-3 gap-6">
            <div class="bg-white rounded-xl shadow-md p-6">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-book text-xl text-blue-600"></i>
                </div>
                <div>
                  <div class="text-2xl font-bold text-gray-900">{stats.totalModules}</div>
                  <div class="text-sm text-gray-600">Modules disponibles</div>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-md p-6">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-check-double text-xl text-green-600"></i>
                </div>
                <div>
                  <div class="text-2xl font-bold text-gray-900">{stats.completedModules}</div>
                  <div class="text-sm text-gray-600">Modules complétés</div>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-md p-6">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-chart-line text-xl text-purple-600"></i>
                </div>
                <div>
                  <div class="text-2xl font-bold text-gray-900">{stats.progressPercentage}%</div>
                  <div class="text-sm text-gray-600">Progression totale</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <script src="/static/dashboard.js"></script>
      </div>
    )
  } catch (error) {
    console.error('Dashboard error:', error)
    return c.redirect('/login')
  }
})

// Module entry point - redirect to video
app.get('/module/:code', async (c) => {
  const moduleCode = c.req.param('code')
  return c.redirect(`/module/${moduleCode}/video`)
})

// API: Save quiz results
app.post('/api/module/quiz', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) {
      return c.json({ error: 'Non authentifié' }, 401)
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return c.json({ error: 'Token invalide' }, 401)
    }

    const { module_code, score, passed, answers } = await c.req.json()

    // Get module
    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(module_code).first()

    if (!module) {
      return c.json({ error: 'Module non trouvé' }, 404)
    }

    // Get progress
    const progress = await c.env.DB.prepare(`
      SELECT id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (progress) {
      // Update progress
      await c.env.DB.prepare(`
        UPDATE progress 
        SET quiz_score = ?, quiz_passed = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(score, passed ? 1 : 0, progress.id).run()

      // Save quiz attempt
      await c.env.DB.prepare(`
        INSERT INTO quiz_attempts (progress_id, score, passed, answers_json)
        VALUES (?, ?, ?, ?)
      `).bind(progress.id, score, passed ? 1 : 0, JSON.stringify(answers)).run()
    }

    return c.json({ success: true, score, passed })
  } catch (error) {
    console.error('Quiz save error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Save single answer
app.post('/api/module/answer', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const { module_code, question_number, answer } = await c.req.json()

    // Get module and progress
    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(module_code).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    // Save to questions table (existing logic)
    const existing = await c.env.DB.prepare(`
      SELECT id FROM questions WHERE progress_id = ? AND question_number = ?
    `).bind(progress.id, question_number).first()

    if (existing) {
      await c.env.DB.prepare(`
        UPDATE questions 
        SET user_response = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(answer, existing.id).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO questions (progress_id, question_number, question_text, user_response)
        VALUES (?, ?, ?, ?)
      `).bind(progress.id, question_number, `Question ${question_number}`, answer).run()
    }

    // Also save to user_answers table for B5/B7 compatibility
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO user_answers (user_id, module_code, question_id, answer_text, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).bind(payload.userId, module_code, question_number, answer).run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Answer save error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Submit all answers
app.post('/api/module/submit-answers', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const { module_code, answers } = await c.req.json()

    // Get module and progress
    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(module_code).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    // Save all answers
    for (const ans of answers) {
      const existing = await c.env.DB.prepare(`
        SELECT id FROM questions WHERE progress_id = ? AND question_number = ?
      `).bind(progress.id, ans.question_number).first()

      if (existing) {
        await c.env.DB.prepare(`
          UPDATE questions 
          SET user_response = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(ans.answer, existing.id).run()
      } else {
        await c.env.DB.prepare(`
          INSERT INTO questions (progress_id, question_number, question_text, user_response)
          VALUES (?, ?, ?, ?)
        `).bind(progress.id, ans.question_number, `Question ${ans.question_number}`, ans.answer).run()
      }
      
      // Also save to user_answers
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO user_answers (user_id, module_code, question_id, answer_text, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(payload.userId, module_code, ans.question_number, ans.answer).run()
    }

    // Update progress status
    await c.env.DB.prepare(`
      UPDATE progress 
      SET status = 'in_progress', current_question = 9, updated_at = datetime('now')
      WHERE id = ?
    `).bind(progress.id).run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Submit answers error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Save improved answer
app.post('/api/module/improve-answer', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const { module_code, question_number, improved_answer } = await c.req.json()

    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(module_code).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    const progress = await c.env.DB.prepare(`
      SELECT id FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) return c.json({ error: 'Progress non trouvé' }, 404)

    // Update answer and increment iteration count
    await c.env.DB.prepare(`
      UPDATE questions 
      SET user_response = ?, 
          iteration_count = iteration_count + 1,
          updated_at = datetime('now')
      WHERE progress_id = ? AND question_number = ?
    `).bind(improved_answer, progress.id, question_number).run()

    // Also update user_answers
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO user_answers (user_id, module_code, question_id, answer_text, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).bind(payload.userId, module_code, question_number, improved_answer).run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Improve answer error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

// API: Valider le module (B6)
app.post('/api/module/validate', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.json({ error: 'Non authentifié' }, 401)

    const payload = await verifyToken(token)
    if (!payload) return c.json({ error: 'Token invalide' }, 401)

    const { moduleCode } = await c.req.json()

    const module = await c.env.DB.prepare(`
      SELECT id FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.json({ error: 'Module non trouvé' }, 404)

    // Mettre à jour le statut du progrès
    await c.env.DB.prepare(`
      UPDATE progress 
      SET status = 'validated',
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).run()

    // Créer un livrable
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO deliverables (
        user_id, module_id, title, status, file_url, created_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      payload.userId, 
      module.id, 
      'Business Model Canvas', 
      'ready', 
      `/module/${moduleCode}/download`
    ).run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Validation error:', error)
    return c.json({ error: 'Erreur serveur' }, 500)
  }
})

export default app
