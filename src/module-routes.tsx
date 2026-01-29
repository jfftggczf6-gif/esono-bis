import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken } from './auth'
import { businessModelCanvasContent } from './module-content'
import { generateMockFeedback, calculateOverallScore, getScoreLabel } from './ai-feedback'

type Bindings = {
  DB: D1Database
}

export const moduleRoutes = new Hono<{ Bindings: Bindings }>()

// B1 - Écran vidéo pédagogique
moduleRoutes.get('/module/:code/video', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    // Get or create progress
    const progress = await c.env.DB.prepare(`
      SELECT * FROM progress 
      WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    if (!progress) {
      await c.env.DB.prepare(`
        INSERT INTO progress (user_id, module_id, status, started_at)
        VALUES (?, ?, 'in_progress', datetime('now'))
      `).bind(payload.userId, module.id).run()
    }

    // Get content based on module
    const content = moduleCode === 'step1_business_model' ? businessModelCanvasContent : null
    if (!content || !content.video_url) {
      return c.redirect(`/module/${moduleCode}`)
    }

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{module.title as string} - Vidéo</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          <link href="/static/style.css" rel="stylesheet" />
        </head>
        <body class="bg-gray-50">
          <div class="min-h-screen py-8 px-4">
            <div class="max-w-5xl mx-auto">
              {/* Header */}
              <div class="mb-6 flex items-center justify-between">
                <a href="/dashboard" class="text-blue-600 hover:text-blue-700 font-medium">
                  <i class="fas fa-arrow-left mr-2"></i>Retour au dashboard
                </a>
                <div class="text-sm text-gray-600">
                  <i class="fas fa-video mr-2"></i>Étape 1/7 - Vidéo pédagogique
                </div>
              </div>

              {/* Progress Bar */}
              <div class="mb-8 bg-white rounded-lg shadow-sm p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-gray-700">Progression du module</span>
                  <span class="text-sm text-gray-600">1/7</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full" style="width: 14%"></div>
                </div>
              </div>

              {/* Main Content */}
              <div class="bg-white rounded-xl shadow-lg overflow-hidden">
                {/* Title */}
                <div class="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
                  <h1 class="text-2xl font-bold mb-2">{module.title as string}</h1>
                  <p class="text-blue-100">{module.description as string}</p>
                </div>

                {/* Video Player */}
                <div class="p-6">
                  <div class="aspect-video bg-black rounded-lg overflow-hidden mb-6">
                    <iframe
                      width="100%"
                      height="100%"
                      src={content.video_url}
                      title="Vidéo pédagogique"
                      frameborder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowfullscreen
                    ></iframe>
                  </div>

                  {/* Video Info */}
                  <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                    <div class="flex items-start gap-3">
                      <i class="fas fa-info-circle text-blue-600 mt-1"></i>
                      <div>
                        <h3 class="font-semibold text-gray-900 mb-2">Objectifs de cette vidéo</h3>
                        <ul class="text-sm text-gray-700 space-y-1">
                          <li>• Comprendre les 9 blocs du Business Model Canvas</li>
                          <li>• Apprendre à cartographier votre modèle économique</li>
                          <li>• Identifier les liens entre les différents blocs</li>
                          <li>• Préparer votre réflexion stratégique</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Key Points */}
                  <div class="bg-gray-50 rounded-lg p-6 mb-6">
                    <h3 class="font-semibold text-gray-900 mb-4">Points clés à retenir</h3>
                    <div class="grid md:grid-cols-2 gap-4">
                      <div class="flex items-start gap-3">
                        <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <i class="fas fa-users text-blue-600"></i>
                        </div>
                        <div>
                          <h4 class="font-medium text-gray-900 mb-1">Clients</h4>
                          <p class="text-sm text-gray-600">Identifiez précisément vos segments de clientèle cibles</p>
                        </div>
                      </div>
                      <div class="flex items-start gap-3">
                        <div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <i class="fas fa-gift text-green-600"></i>
                        </div>
                        <div>
                          <h4 class="font-medium text-gray-900 mb-1">Valeur</h4>
                          <p class="text-sm text-gray-600">Définissez votre proposition de valeur unique</p>
                        </div>
                      </div>
                      <div class="flex items-start gap-3">
                        <div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <i class="fas fa-route text-purple-600"></i>
                        </div>
                        <div>
                          <h4 class="font-medium text-gray-900 mb-1">Canaux</h4>
                          <p class="text-sm text-gray-600">Choisissez vos canaux de distribution et communication</p>
                        </div>
                      </div>
                      <div class="flex items-start gap-3">
                        <div class="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <i class="fas fa-dollar-sign text-yellow-600"></i>
                        </div>
                        <div>
                          <h4 class="font-medium text-gray-900 mb-1">Revenus</h4>
                          <p class="text-sm text-gray-600">Déterminez vos sources de revenus</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Next Step Button */}
                  <div class="flex items-center justify-between">
                    <div class="text-sm text-gray-600">
                      <i class="far fa-clock mr-2"></i>
                      Durée estimée : {Math.floor(content.video_duration! / 60)} minutes
                    </div>
                    <a
                      href={`/module/${moduleCode}/quiz`}
                      class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
                    >
                      Passer au quiz
                      <i class="fas fa-arrow-right"></i>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    )
  } catch (error) {
    console.error('Video error:', error)
    return c.redirect('/dashboard')
  }
})

// B2 - Quiz de validation
moduleRoutes.get('/module/:code/quiz', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    const content = moduleCode === 'step1_business_model' ? businessModelCanvasContent : null
    if (!content || !content.quiz_questions) {
      return c.redirect(`/module/${moduleCode}`)
    }

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{module.title as string} - Quiz</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          <link href="/static/style.css" rel="stylesheet" />
        </head>
        <body class="bg-gray-50">
          <div class="min-h-screen py-8 px-4">
            <div class="max-w-4xl mx-auto">
              {/* Header */}
              <div class="mb-6 flex items-center justify-between">
                <a href="/dashboard" class="text-blue-600 hover:text-blue-700 font-medium">
                  <i class="fas fa-arrow-left mr-2"></i>Retour au dashboard
                </a>
                <div class="text-sm text-gray-600">
                  <i class="fas fa-question-circle mr-2"></i>Étape 2/7 - Quiz de validation
                </div>
              </div>

              {/* Progress Bar */}
              <div class="mb-8 bg-white rounded-lg shadow-sm p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-gray-700">Progression du module</span>
                  <span class="text-sm text-gray-600">2/7</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full" style="width: 29%"></div>
                </div>
              </div>

              {/* Main Content */}
              <div class="bg-white rounded-xl shadow-lg p-8">
                <div class="mb-8">
                  <h1 class="text-2xl font-bold text-gray-900 mb-2">Quiz de Validation</h1>
                  <p class="text-gray-600">
                    Répondez à ces 5 questions pour valider votre compréhension du Business Model Canvas.
                    Vous devez obtenir au moins 80% de bonnes réponses pour continuer.
                  </p>
                </div>

                {/* Quiz Form */}
                <form id="quizForm" class="space-y-8">
                  {content.quiz_questions!.map((q, index) => (
                    <div class="border-b border-gray-200 pb-8 last:border-0">
                      <div class="flex items-start gap-3 mb-4">
                        <div class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span class="text-blue-600 font-bold">{index + 1}</span>
                        </div>
                        <div class="flex-1">
                          <h3 class="font-semibold text-gray-900 mb-4">{q.question}</h3>
                          <div class="space-y-3">
                            {q.options.map((option, optIndex) => (
                              <label class="flex items-start gap-3 p-4 border-2 border-gray-200 rounded-lg hover:border-blue-300 cursor-pointer transition-colors">
                                <input
                                  type="radio"
                                  name={`question_${q.id}`}
                                  value={optIndex}
                                  required
                                  class="mt-1 w-4 h-4 text-blue-600"
                                />
                                <span class="text-gray-700">{option}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div id={`explanation_${q.id}`} class="hidden mt-4 ml-11 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <p class="text-sm text-gray-700">{q.explanation}</p>
                      </div>
                    </div>
                  ))}

                  {/* Results */}
                  <div id="quizResults" class="hidden">
                    <div id="successMessage" class="hidden bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
                      <div class="flex items-start gap-3">
                        <i class="fas fa-check-circle text-2xl text-green-600"></i>
                        <div>
                          <h3 class="font-bold text-green-900 mb-2">Félicitations ! 🎉</h3>
                          <p class="text-green-800 mb-4">
                            Vous avez obtenu <span id="scoreValue" class="font-bold"></span>%.
                            Vous pouvez maintenant passer à l'étape suivante.
                          </p>
                          <a
                            href={`/module/${moduleCode}/questions`}
                            class="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
                          >
                            Continuer vers les questions guidées
                            <i class="fas fa-arrow-right"></i>
                          </a>
                        </div>
                      </div>
                    </div>

                    <div id="failMessage" class="hidden bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
                      <div class="flex items-start gap-3">
                        <i class="fas fa-times-circle text-2xl text-red-600"></i>
                        <div>
                          <h3 class="font-bold text-red-900 mb-2">Pas tout à fait...</h3>
                          <p class="text-red-800 mb-4">
                            Vous avez obtenu <span id="scoreValueFail" class="font-bold"></span>%.
                            Vous devez obtenir au moins 80% pour continuer. Revoyez la vidéo et réessayez.
                          </p>
                          <button
                            type="button"
                            onclick="window.location.reload()"
                            class="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors"
                          >
                            <i class="fas fa-redo"></i>
                            Recommencer le quiz
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div id="submitSection" class="flex justify-end">
                    <button
                      type="submit"
                      class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
                    >
                      Valider mes réponses
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <script dangerouslySetInnerHTML={{__html: `
            const quizData = ${JSON.stringify(content.quiz_questions)};
            const moduleCode = '${moduleCode}';
            const form = document.getElementById('quizForm');
            
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              
              // Calculate score
              let correct = 0;
              const total = quizData.length;
              
              quizData.forEach(q => {
                const selected = document.querySelector('input[name="question_' + q.id + '"]:checked');
                if (selected && parseInt(selected.value) === q.correct_answer) {
                  correct++;
                }
                
                // Show explanation
                document.getElementById('explanation_' + q.id).classList.remove('hidden');
                
                // Highlight correct/incorrect
                const options = document.querySelectorAll('input[name="question_' + q.id + '"]');
                options.forEach((opt, idx) => {
                  const label = opt.closest('label');
                  if (idx === q.correct_answer) {
                    label.classList.add('border-green-500', 'bg-green-50');
                    label.classList.remove('border-gray-200');
                  } else if (opt.checked) {
                    label.classList.add('border-red-500', 'bg-red-50');
                    label.classList.remove('border-gray-200');
                  }
                });
              });
              
              const score = Math.round((correct / total) * 100);
              
              // Save score
              try {
                await fetch('/api/module/quiz', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    module_code: moduleCode,
                    score: score,
                    passed: score >= 80,
                    answers: Array.from(form.elements).filter(e => e.type === 'radio' && e.checked).map(e => e.value)
                  })
                });
              } catch (err) {
                console.error('Error saving quiz:', err);
              }
              
              // Show results
              document.getElementById('quizResults').classList.remove('hidden');
              document.getElementById('submitSection').classList.add('hidden');
              
              if (score >= 80) {
                document.getElementById('successMessage').classList.remove('hidden');
                document.getElementById('scoreValue').textContent = score;
              } else {
                document.getElementById('failMessage').classList.remove('hidden');
                document.getElementById('scoreValueFail').textContent = score;
              }
              
              // Scroll to results
              document.getElementById('quizResults').scrollIntoView({ behavior: 'smooth' });
            });
          `}} />
        </body>
      </html>
    )
  } catch (error) {
    console.error('Quiz error:', error)
    return c.redirect('/dashboard')
  }
})

// B3 - Questions guidées (Input structurant)
moduleRoutes.get('/module/:code/questions', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    // Get progress
    const progress = await c.env.DB.prepare(`
      SELECT * FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    // Get existing answers
    const existingAnswers = await c.env.DB.prepare(`
      SELECT question_number, user_response FROM questions WHERE progress_id = ?
    `).bind(progress?.id || 0).all()

    const answersMap = new Map()
    existingAnswers.results.forEach((a: any) => {
      answersMap.set(a.question_number, a.user_response)
    })

    const content = moduleCode === 'step1_business_model' ? businessModelCanvasContent : null
    if (!content || !content.guided_questions) {
      return c.redirect(`/module/${moduleCode}`)
    }

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{module.title as string} - Questions Guidées</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          <link href="/static/style.css" rel="stylesheet" />
        </head>
        <body class="bg-gray-50">
          <div class="min-h-screen py-8 px-4">
            <div class="max-w-6xl mx-auto">
              {/* Header */}
              <div class="mb-6 flex items-center justify-between">
                <a href="/dashboard" class="text-blue-600 hover:text-blue-700 font-medium">
                  <i class="fas fa-arrow-left mr-2"></i>Retour au dashboard
                </a>
                <div class="text-sm text-gray-600">
                  <i class="fas fa-edit mr-2"></i>Étape 3/7 - Questions guidées
                </div>
              </div>

              {/* Progress Bar */}
              <div class="mb-8 bg-white rounded-lg shadow-sm p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-gray-700">Progression du module</span>
                  <span class="text-sm text-gray-600">3/7</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full transition-all" style="width: 43%"></div>
                </div>
              </div>

              {/* Main Content */}
              <div class="bg-white rounded-xl shadow-lg p-8 mb-6">
                <div class="mb-8">
                  <h1 class="text-3xl font-bold text-gray-900 mb-3">Business Model Canvas - 9 Blocs</h1>
                  <p class="text-gray-600 mb-4">
                    Complétez chaque bloc de votre Business Model Canvas. Prenez le temps de réfléchir à chaque question,
                    les exemples et conseils vous guideront.
                  </p>
                  <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div class="flex items-start gap-3">
                      <i class="fas fa-lightbulb text-blue-600 mt-1"></i>
                      <div class="text-sm">
                        <p class="text-blue-900 font-medium mb-1">Conseil :</p>
                        <p class="text-blue-800">Vos réponses seront sauvegardées automatiquement. Soyez précis et concret dans vos descriptions.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <form id="canvasForm" class="space-y-8">
                  {content.guided_questions!.map((q, index) => (
                    <div class="border-b border-gray-200 pb-8 last:border-0">
                      <div class="grid md:grid-cols-3 gap-6">
                        {/* Question Panel */}
                        <div class="md:col-span-2">
                          <div class="flex items-start gap-3 mb-4">
                            <div class="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-lg flex items-center justify-center flex-shrink-0 font-bold">
                              {index + 1}
                            </div>
                            <div class="flex-1">
                              <h3 class="text-xl font-bold text-gray-900 mb-2">{q.section}</h3>
                              <p class="text-gray-700 font-medium mb-4">{q.question}</p>
                              
                              <textarea
                                id={`question_${q.id}`}
                                name={`question_${q.id}`}
                                rows={6}
                                required
                                class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all resize-y"
                                placeholder={q.placeholder}
                              >{answersMap.get(q.id) || ''}</textarea>
                              
                              <div class="flex items-center justify-between mt-3">
                                <span class="text-sm text-gray-500">
                                  <i class="far fa-keyboard mr-1"></i>
                                  <span id={`charCount_${q.id}`}>0</span> caractères
                                </span>
                                <button
                                  type="button"
                                  onclick={`saveAnswer(${q.id}, '${moduleCode}')`}
                                  class="text-sm text-blue-600 hover:text-blue-700 font-medium"
                                >
                                  <i class="fas fa-save mr-1"></i>Sauvegarder
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Help Panel */}
                        <div class="space-y-4">
                          {/* Help Text */}
                          <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
                            <h4 class="flex items-center gap-2 font-semibold text-purple-900 mb-2">
                              <i class="fas fa-info-circle"></i>
                              Aide
                            </h4>
                            <p class="text-sm text-purple-800">{q.help_text}</p>
                          </div>

                          {/* Example */}
                          <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                            <h4 class="flex items-center gap-2 font-semibold text-green-900 mb-2">
                              <i class="fas fa-check-circle"></i>
                              Exemple
                            </h4>
                            <p class="text-sm text-green-800">{q.example}</p>
                          </div>

                          {/* Common Mistake */}
                          <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                            <h4 class="flex items-center gap-2 font-semibold text-red-900 mb-2">
                              <i class="fas fa-exclamation-triangle"></i>
                              À éviter
                            </h4>
                            <p class="text-sm text-red-800">{q.common_mistake}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Save Status */}
                  <div id="saveStatus" class="hidden">
                    <div class="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                      <i class="fas fa-check-circle text-green-600 text-xl"></i>
                      <span class="text-green-800 font-medium">Réponses sauvegardées avec succès !</span>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div class="flex items-center justify-between pt-6 border-t border-gray-200">
                    <div class="text-sm text-gray-600">
                      <i class="fas fa-clock mr-2"></i>
                      Temps estimé : 30-45 minutes
                    </div>
                    <button
                      type="submit"
                      class="px-8 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-lg transition-all shadow-md hover:shadow-lg"
                    >
                      Soumettre pour analyse
                      <i class="fas fa-arrow-right ml-2"></i>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <script dangerouslySetInnerHTML={{__html: `
            const moduleCode = '${moduleCode}';
            const progressId = ${progress?.id || 0};
            
            // Character counter
            document.querySelectorAll('textarea').forEach(textarea => {
              const id = textarea.id.replace('question_', '');
              const counter = document.getElementById('charCount_' + id);
              
              function updateCounter() {
                counter.textContent = textarea.value.length;
              }
              
              textarea.addEventListener('input', updateCounter);
              updateCounter();
            });
            
            // Auto-save function
            async function saveAnswer(questionId, moduleCode) {
              const textarea = document.getElementById('question_' + questionId);
              const answer = textarea.value.trim();
              
              if (!answer) {
                alert('Veuillez écrire une réponse avant de sauvegarder.');
                return;
              }
              
              try {
                const response = await fetch('/api/module/answer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    module_code: moduleCode,
                    question_number: questionId,
                    answer: answer
                  })
                });
                
                if (response.ok) {
                  // Show save status
                  const status = document.getElementById('saveStatus');
                  status.classList.remove('hidden');
                  setTimeout(() => status.classList.add('hidden'), 3000);
                  
                  // Visual feedback
                  textarea.classList.add('border-green-500');
                  setTimeout(() => textarea.classList.remove('border-green-500'), 2000);
                }
              } catch (err) {
                console.error('Save error:', err);
                alert('Erreur lors de la sauvegarde. Veuillez réessayer.');
              }
            }
            
            // Form submission
            document.getElementById('canvasForm').addEventListener('submit', async (e) => {
              e.preventDefault();
              
              // Check all questions answered
              const textareas = document.querySelectorAll('textarea[required]');
              let allAnswered = true;
              
              textareas.forEach(textarea => {
                if (!textarea.value.trim()) {
                  allAnswered = false;
                  textarea.classList.add('border-red-500');
                }
              });
              
              if (!allAnswered) {
                alert('Veuillez répondre à toutes les questions avant de soumettre.');
                return;
              }
              
              // Save all answers
              const answers = [];
              textareas.forEach(textarea => {
                const id = parseInt(textarea.id.replace('question_', ''));
                answers.push({
                  question_number: id,
                  answer: textarea.value.trim()
                });
              });
              
              try {
                const response = await fetch('/api/module/submit-answers', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    module_code: moduleCode,
                    answers: answers
                  })
                });
                
                if (response.ok) {
                  // Redirect to next step (B4 - Analysis)
                  window.location.href = '/module/' + moduleCode + '/analysis';
                }
              } catch (err) {
                console.error('Submit error:', err);
                alert('Erreur lors de la soumission. Veuillez réessayer.');
              }
            });
            
            // Make saveAnswer global
            window.saveAnswer = saveAnswer;
          `}} />
        </body>
      </html>
    )
  } catch (error) {
    console.error('Questions error:', error)
    return c.redirect('/dashboard')
  }
})

// B4 - Analyse IA / Challenge
moduleRoutes.get('/module/:code/analysis', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    // Get progress and answers
    const progress = await c.env.DB.prepare(`
      SELECT * FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    const answers = await c.env.DB.prepare(`
      SELECT question_number, user_response FROM questions WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress?.id || 0).all()

    // Generate feedback
    const answersMap = new Map()
    answers.results.forEach((a: any) => {
      answersMap.set(a.question_number, a.user_response)
    })
    
    const feedback = generateMockFeedback(answersMap)
    const overallScore = calculateOverallScore(feedback)
    const scoreInfo = getScoreLabel(overallScore)

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{module.title as string} - Analyse IA</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          <link href="/static/style.css" rel="stylesheet" />
        </head>
        <body class="bg-gray-50">
          <div class="min-h-screen py-8 px-4">
            <div class="max-w-5xl mx-auto">
              {/* Header */}
              <div class="mb-6 flex items-center justify-between">
                <a href="/dashboard" class="text-blue-600 hover:text-blue-700 font-medium">
                  <i class="fas fa-arrow-left mr-2"></i>Retour au dashboard
                </a>
                <div class="text-sm text-gray-600">
                  <i class="fas fa-robot mr-2"></i>Étape 4/7 - Analyse IA
                </div>
              </div>

              {/* Progress Bar */}
              <div class="mb-8 bg-white rounded-lg shadow-sm p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-gray-700">Progression du module</span>
                  <span class="text-sm text-gray-600">4/7</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full transition-all" style="width: 57%"></div>
                </div>
              </div>

              {/* Overall Score Card */}
              <div class={`mb-8 bg-gradient-to-br from-${scoreInfo.color}-500 to-${scoreInfo.color}-600 text-white rounded-xl shadow-lg p-8`}>
                <div class="flex items-center justify-between">
                  <div>
                    <h1 class="text-3xl font-bold mb-2">Analyse de votre Canvas</h1>
                    <p class="text-white/90">Notre IA a analysé vos réponses et vous propose des améliorations</p>
                  </div>
                  <div class="text-right">
                    <div class="text-6xl font-bold mb-2">{overallScore}%</div>
                    <div class="text-xl font-semibold">{scoreInfo.label}</div>
                  </div>
                </div>
              </div>

              {/* Feedback by Section */}
              <div class="space-y-6 mb-8">
                {feedback.map((item, index) => {
                  const iconMap = {
                    strength: { icon: 'check-circle', color: 'green', bg: 'green-50', border: 'green-200' },
                    suggestion: { icon: 'lightbulb', color: 'yellow', bg: 'yellow-50', border: 'yellow-200' },
                    question: { icon: 'question-circle', color: 'blue', bg: 'blue-50', border: 'blue-200' }
                  }
                  const style = iconMap[item.type]
                  
                  return (
                    <div class={`bg-${style.bg} border border-${style.border} rounded-lg p-6`}>
                      <div class="flex items-start gap-4">
                        <div class={`w-12 h-12 bg-${style.color}-100 rounded-lg flex items-center justify-center flex-shrink-0`}>
                          <i class={`fas fa-${style.icon} text-2xl text-${style.color}-600`}></i>
                        </div>
                        <div class="flex-1">
                          <div class="flex items-center justify-between mb-2">
                            <h3 class={`font-bold text-${style.color}-900`}>{item.section}</h3>
                            <div class="flex gap-1">
                              {[1, 2, 3, 4, 5].map(star => (
                                <i class={`fas fa-star text-sm ${star <= item.score ? `text-${style.color}-500` : 'text-gray-300'}`}></i>
                              ))}
                            </div>
                          </div>
                          <p class={`text-${style.color}-800`}>{item.message}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Action Cards */}
              <div class="grid md:grid-cols-2 gap-6 mb-8">
                <div class="bg-white rounded-xl shadow-md p-6 border-2 border-transparent hover:border-blue-300 transition-all">
                  <div class="flex items-start gap-4">
                    <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <i class="fas fa-edit text-2xl text-blue-600"></i>
                    </div>
                    <div class="flex-1">
                      <h3 class="text-lg font-bold text-gray-900 mb-2">Améliorer mes réponses</h3>
                      <p class="text-gray-600 text-sm mb-4">
                        Prenez en compte les suggestions et améliorez vos réponses
                      </p>
                      <a
                        href={`/module/${moduleCode}/improve`}
                        class="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold"
                      >
                        Commencer les améliorations
                        <i class="fas fa-arrow-right"></i>
                      </a>
                    </div>
                  </div>
                </div>

                <div class="bg-white rounded-xl shadow-md p-6 border-2 border-transparent hover:border-green-300 transition-all">
                  <div class="flex items-start gap-4">
                    <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <i class="fas fa-check-double text-2xl text-green-600"></i>
                    </div>
                    <div class="flex-1">
                      <h3 class="text-lg font-bold text-gray-900 mb-2">Passer à la validation</h3>
                      <p class="text-gray-600 text-sm mb-4">
                        Vos réponses sont déjà bonnes ? Passez directement à la validation
                      </p>
                      <a
                        href={`/module/${moduleCode}/validate`}
                        class="inline-flex items-center gap-2 text-green-600 hover:text-green-700 font-semibold"
                      >
                        Valider mon Canvas
                        <i class="fas fa-arrow-right"></i>
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tips */}
              <div class="bg-purple-50 border border-purple-200 rounded-lg p-6">
                <div class="flex items-start gap-3">
                  <i class="fas fa-info-circle text-purple-600 text-xl mt-1"></i>
                  <div>
                    <h4 class="font-semibold text-purple-900 mb-2">Conseils pour améliorer votre score</h4>
                    <ul class="text-sm text-purple-800 space-y-1">
                      <li>• Ajoutez des chiffres et métriques concrètes</li>
                      <li>• Soyez spécifique : évitez "tout le monde", préférez des segments précis</li>
                      <li>• Détaillez avec des exemples concrets de votre contexte</li>
                      <li>• Montrez que vous connaissez votre marché et vos concurrents</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    )
  } catch (error) {
    console.error('Analysis error:', error)
    return c.redirect('/dashboard')
  }
})

// B5 - Réécriture / Itération
moduleRoutes.get('/module/:code/improve', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')

    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    const progress = await c.env.DB.prepare(`
      SELECT * FROM progress WHERE user_id = ? AND module_id = ?
    `).bind(payload.userId, module.id).first()

    const answers = await c.env.DB.prepare(`
      SELECT question_number, user_response, iteration_count FROM questions 
      WHERE progress_id = ?
      ORDER BY question_number
    `).bind(progress?.id || 0).all()

    const answersMap = new Map()
    answers.results.forEach((a: any) => {
      answersMap.set(a.question_number, {
        response: a.user_response,
        iterations: a.iteration_count || 0
      })
    })

    const content = moduleCode === 'step1_business_model' ? businessModelCanvasContent : null
    if (!content) return c.redirect(`/module/${moduleCode}`)

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{module.title as string} - Amélioration</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          <link href="/static/style.css" rel="stylesheet" />
        </head>
        <body class="bg-gray-50">
          <div class="min-h-screen py-8 px-4">
            <div class="max-w-7xl mx-auto">
              {/* Header */}
              <div class="mb-6 flex items-center justify-between">
                <a href={`/module/${moduleCode}/analysis`} class="text-blue-600 hover:text-blue-700 font-medium">
                  <i class="fas fa-arrow-left mr-2"></i>Retour à l'analyse
                </a>
                <div class="text-sm text-gray-600">
                  <i class="fas fa-sync-alt mr-2"></i>Étape 5/7 - Amélioration
                </div>
              </div>

              {/* Progress Bar */}
              <div class="mb-8 bg-white rounded-lg shadow-sm p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-gray-700">Progression du module</span>
                  <span class="text-sm text-gray-600">5/7</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full transition-all" style="width: 71%"></div>
                </div>
              </div>

              {/* Instructions */}
              <div class="bg-white rounded-xl shadow-lg p-8 mb-8">
                <h1 class="text-3xl font-bold text-gray-900 mb-4">Améliorez vos réponses</h1>
                <p class="text-gray-600 mb-6">
                  Relisez vos réponses initiales et améliorez-les en tenant compte des suggestions de l'analyse IA.
                  L'historique de vos modifications est conservé.
                </p>
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div class="flex items-start gap-3">
                    <i class="fas fa-lightbulb text-blue-600 mt-1"></i>
                    <div class="text-sm">
                      <p class="text-blue-900 font-medium mb-1">Astuce :</p>
                      <p class="text-blue-800">
                        Vous pouvez modifier uniquement les sections qui nécessitent une amélioration.
                        Cliquez sur "Sauvegarder" après chaque modification.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Improvement Form */}
              <form id="improveForm" class="space-y-6">
                {content.guided_questions!.map((q, index) => {
                  const answerData = answersMap.get(q.id)
                  const currentAnswer = answerData?.response || ''
                  const iterations = answerData?.iterations || 0
                  
                  return (
                    <div class="bg-white rounded-xl shadow-md p-6">
                      <div class="flex items-start justify-between mb-4">
                        <div class="flex items-start gap-3">
                          <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <span class="text-blue-600 font-bold">{index + 1}</span>
                          </div>
                          <div>
                            <h3 class="text-xl font-bold text-gray-900">{q.section}</h3>
                            <p class="text-gray-600 text-sm">{q.question}</p>
                          </div>
                        </div>
                        {iterations > 0 && (
                          <div class="bg-purple-100 px-3 py-1 rounded-full text-sm text-purple-700 font-medium">
                            <i class="fas fa-history mr-1"></i>
                            V{iterations + 1}
                          </div>
                        )}
                      </div>

                      <div class="space-y-4">
                        {/* Original Answer */}
                        <div>
                          <label class="block text-sm font-medium text-gray-700 mb-2">
                            Réponse actuelle
                          </label>
                          <div class="bg-gray-50 border-2 border-gray-200 rounded-lg p-4 text-gray-700 whitespace-pre-wrap">
                            {currentAnswer || 'Pas encore de réponse'}
                          </div>
                        </div>

                        {/* Improved Answer */}
                        <div>
                          <label class="block text-sm font-medium text-gray-700 mb-2">
                            Version améliorée
                          </label>
                          <textarea
                            id={`improved_${q.id}`}
                            name={`improved_${q.id}`}
                            rows={6}
                            class="w-full px-4 py-3 border-2 border-blue-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all resize-y"
                            placeholder="Écrivez votre version améliorée ici..."
                          >{currentAnswer}</textarea>
                        </div>

                        {/* Action Buttons */}
                        <div class="flex items-center justify-between">
                          <button
                            type="button"
                            onclick={`saveImprovement(${q.id}, '${moduleCode}')`}
                            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                          >
                            <i class="fas fa-save mr-2"></i>
                            Sauvegarder cette amélioration
                          </button>
                          <span id={`status_${q.id}`} class="text-sm text-gray-500"></span>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* Submit All */}
                <div class="bg-white rounded-xl shadow-md p-6">
                  <div class="flex items-center justify-between">
                    <div>
                      <h3 class="font-bold text-gray-900 mb-1">Prêt à continuer ?</h3>
                      <p class="text-gray-600 text-sm">
                        Une fois satisfait de vos améliorations, passez à la validation finale
                      </p>
                    </div>
                    <a
                      href={`/module/${moduleCode}/validate`}
                      class="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-lg transition-all"
                    >
                      Passer à la validation
                      <i class="fas fa-arrow-right ml-2"></i>
                    </a>
                  </div>
                </div>
              </form>
            </div>
          </div>

          <script dangerouslySetInnerHTML={{__html: `
            async function saveImprovement(questionId, moduleCode) {
              const textarea = document.getElementById('improved_' + questionId)
              const status = document.getElementById('status_' + questionId)
              const answer = textarea.value.trim()
              
              if (!answer) {
                status.textContent = 'Veuillez écrire une amélioration'
                status.className = 'text-sm text-red-600'
                return
              }
              
              status.textContent = 'Sauvegarde en cours...'
              status.className = 'text-sm text-blue-600'
              
              try {
                const response = await fetch('/api/module/improve-answer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    module_code: moduleCode,
                    question_number: questionId,
                    improved_answer: answer
                  })
                })
                
                if (response.ok) {
                  status.textContent = '✓ Sauvegardé'
                  status.className = 'text-sm text-green-600'
                  textarea.classList.add('border-green-500')
                  setTimeout(() => {
                    textarea.classList.remove('border-green-500')
                    status.textContent = ''
                  }, 2000)
                } else {
                  status.textContent = '✗ Erreur'
                  status.className = 'text-sm text-red-600'
                }
              } catch (err) {
                console.error('Save error:', err)
                status.textContent = '✗ Erreur réseau'
                status.className = 'text-sm text-red-600'
              }
            }
            
            window.saveImprovement = saveImprovement
          `}} />
        </body>
      </html>
    )
  } catch (error) {
    console.error('Improve error:', error)
    return c.redirect('/dashboard')
  }
})

// B6 - Validation Coach/IA
moduleRoutes.get('/module/:code/validate', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')
    
    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    // Récupérer toutes les réponses sauvegardées
    const responses = await c.env.DB.prepare(`
      SELECT question_id, answer_text FROM user_answers 
      WHERE user_id = ? AND module_code = ?
      ORDER BY question_id
    `).bind(payload.userId, moduleCode).all()

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Validation - {module.title}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
        </head>
        <body class="bg-gray-50">
          {/* Header */}
          <nav class="bg-white shadow-sm border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 py-4">
              <a href="/dashboard" class="text-blue-600 hover:text-blue-700 flex items-center gap-2">
                <i class="fas fa-arrow-left"></i>
                <span>Retour au dashboard</span>
              </a>
            </div>
          </nav>

          <div class="max-w-4xl mx-auto px-4 py-8">
            {/* Breadcrumb */}
            <div class="mb-6 text-sm text-gray-600">
              <span>Étape 1</span> › <span>{module.title}</span> › <span class="font-semibold text-gray-900">B6 - Validation</span>
            </div>

            {/* Progress Bar */}
            <div class="mb-8">
              <div class="flex justify-between items-center mb-2">
                <span class="text-sm font-medium text-gray-700">Progression</span>
                <span class="text-sm text-gray-600">6/7</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div class="bg-green-500 h-2 rounded-full" style="width: 86%"></div>
              </div>
            </div>

            {/* Titre */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <i class="fas fa-check-circle text-green-600 text-xl"></i>
                </div>
                <div>
                  <h1 class="text-2xl font-bold text-gray-900">Validation Finale</h1>
                  <p class="text-gray-600">Votre Business Model Canvas est prêt pour validation</p>
                </div>
              </div>
            </div>

            {/* Checklist de Validation */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h2 class="text-lg font-semibold text-gray-900 mb-4">Checklist de Qualité</h2>
              <div class="space-y-3">
                <label class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" class="w-5 h-5 text-green-600 rounded focus:ring-green-500" checked />
                  <span class="text-gray-700">✓ Tous les 9 blocs du Canvas sont complétés</span>
                </label>
                <label class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" class="w-5 h-5 text-green-600 rounded focus:ring-green-500" checked />
                  <span class="text-gray-700">✓ Chaque bloc contient des informations concrètes</span>
                </label>
                <label class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" class="w-5 h-5 text-green-600 rounded focus:ring-green-500" checked />
                  <span class="text-gray-700">✓ Les améliorations suggérées par l'IA ont été intégrées</span>
                </label>
                <label class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" class="w-5 h-5 text-green-600 rounded focus:ring-green-500" checked />
                  <span class="text-gray-700">✓ Le Business Model est cohérent et réaliste</span>
                </label>
              </div>
            </div>

            {/* Récapitulatif */}
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
              <h3 class="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <i class="fas fa-info-circle"></i>
                Récapitulatif de votre parcours
              </h3>
              <ul class="space-y-2 text-sm text-blue-800">
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>B1 - Vidéo pédagogique visionnée</span>
                </li>
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>B2 - Quiz de validation réussi (≥80%)</span>
                </li>
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>B3 - 9 questions guidées complétées</span>
                </li>
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>B4 - Analyse IA effectuée avec suggestions</span>
                </li>
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>B5 - Améliorations apportées et sauvegardées</span>
                </li>
              </ul>
            </div>

            {/* Statut de Validation */}
            <div id="validationStatus" class="hidden mb-6"></div>

            {/* Actions */}
            <div class="flex gap-4">
              <button 
                onclick="submitForValidation()"
                class="flex-1 bg-green-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-green-700 transition flex items-center justify-center gap-2"
              >
                <i class="fas fa-check-circle"></i>
                <span>Soumettre pour Validation</span>
              </button>
              <a 
                href={`/module/${moduleCode}/improve`}
                class="bg-gray-100 text-gray-700 py-3 px-6 rounded-lg font-medium hover:bg-gray-200 transition flex items-center justify-center gap-2"
              >
                <i class="fas fa-arrow-left"></i>
                <span>Retour aux Améliorations</span>
              </a>
            </div>
          </div>

          <script dangerouslySetInnerHTML={{__html: `
            async function submitForValidation() {
              const btn = event.target.closest('button')
              const originalHTML = btn.innerHTML
              btn.disabled = true
              btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Validation en cours...'
              
              try {
                const response = await fetch('/api/module/validate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    moduleCode: '${moduleCode}'
                  })
                })
                
                const result = await response.json()
                
                if (result.success) {
                  // Afficher succès
                  const status = document.getElementById('validationStatus')
                  status.className = 'bg-green-50 border border-green-200 rounded-lg p-6 mb-6'
                  status.innerHTML = \`
                    <div class="flex items-start gap-3">
                      <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <i class="fas fa-trophy text-green-600 text-lg"></i>
                      </div>
                      <div class="flex-1">
                        <h3 class="font-semibold text-green-900 mb-2">🎉 Félicitations !</h3>
                        <p class="text-green-800 mb-4">Votre Business Model Canvas a été validé avec succès ! Vous pouvez maintenant télécharger votre livrable professionnel.</p>
                        <div class="flex gap-3">
                          <a href="/module/${moduleCode}/download" class="bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition inline-flex items-center gap-2">
                            <i class="fas fa-download"></i>
                            <span>Télécharger le PDF</span>
                          </a>
                          <a href="/dashboard" class="bg-white text-green-700 border border-green-300 py-2 px-4 rounded-lg hover:bg-green-50 transition inline-flex items-center gap-2">
                            <i class="fas fa-home"></i>
                            <span>Retour au Dashboard</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  \`
                  status.classList.remove('hidden')
                  
                  // Masquer le bouton de validation
                  btn.closest('.flex').classList.add('hidden')
                } else {
                  btn.disabled = false
                  btn.innerHTML = originalHTML
                  alert('Erreur: ' + (result.error || 'Validation échouée'))
                }
              } catch (err) {
                console.error('Validation error:', err)
                btn.disabled = false
                btn.innerHTML = originalHTML
                alert('Erreur de connexion au serveur')
              }
            }
            
            window.submitForValidation = submitForValidation
          `}} />
        </body>
      </html>
    )
  } catch (error) {
    console.error('Validation page error:', error)
    return c.redirect('/dashboard')
  }
})

// B7 - Téléchargement du Livrable PDF
moduleRoutes.get('/module/:code/download', async (c) => {
  try {
    const token = getCookie(c, 'auth_token')
    if (!token) return c.redirect('/login')
    
    const payload = await verifyToken(token)
    if (!payload) return c.redirect('/login')

    const moduleCode = c.req.param('code')
    const module = await c.env.DB.prepare(`
      SELECT * FROM modules WHERE module_code = ?
    `).bind(moduleCode).first()

    if (!module) return c.redirect('/dashboard')

    // Récupérer toutes les réponses de l'utilisateur
    const responses = await c.env.DB.prepare(`
      SELECT question_id, answer_text FROM user_answers 
      WHERE user_id = ? AND module_code = ?
      ORDER BY question_id
    `).bind(payload.userId, moduleCode).all()

    const answersMap: Record<number, string> = {}
    responses.results.forEach((r: any) => {
      answersMap[r.question_id] = r.answer_text
    })

    return c.html(
      <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Télécharger - {module.title}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
          <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
        </head>
        <body class="bg-gray-50">
          {/* Header */}
          <nav class="bg-white shadow-sm border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 py-4">
              <a href="/dashboard" class="text-blue-600 hover:text-blue-700 flex items-center gap-2">
                <i class="fas fa-arrow-left"></i>
                <span>Retour au dashboard</span>
              </a>
            </div>
          </nav>

          <div class="max-w-4xl mx-auto px-4 py-8">
            {/* Breadcrumb */}
            <div class="mb-6 text-sm text-gray-600">
              <span>Étape 1</span> › <span>{module.title}</span> › <span class="font-semibold text-gray-900">B7 - Livrable</span>
            </div>

            {/* Progress Bar */}
            <div class="mb-8">
              <div class="flex justify-between items-center mb-2">
                <span class="text-sm font-medium text-gray-700">Progression</span>
                <span class="text-sm text-green-600 font-semibold">7/7 - Terminé ✓</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div class="bg-green-500 h-2 rounded-full" style="width: 100%"></div>
              </div>
            </div>

            {/* Badge de Succès */}
            <div class="bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-200 rounded-lg p-8 mb-6 text-center">
              <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-trophy text-green-600 text-4xl"></i>
              </div>
              <h1 class="text-3xl font-bold text-gray-900 mb-2">Module Terminé !</h1>
              <p class="text-gray-700 text-lg mb-1">Félicitations pour avoir complété votre</p>
              <p class="text-2xl font-semibold text-blue-600 mb-4">{module.title}</p>
              <div class="inline-flex items-center gap-2 bg-green-100 text-green-800 px-4 py-2 rounded-full">
                <i class="fas fa-check-circle"></i>
                <span class="font-medium">Validé par l'IA Coach</span>
              </div>
            </div>

            {/* Aperçu du Document */}
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h2 class="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <i class="fas fa-file-pdf text-red-600"></i>
                Aperçu du Livrable
              </h2>
              <div class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-8">
                <div class="text-center">
                  <i class="fas fa-file-alt text-gray-400 text-5xl mb-4"></i>
                  <p class="text-gray-700 font-medium mb-2">Business Model Canvas - Version Professionnelle</p>
                  <p class="text-sm text-gray-600">Format PDF - Prêt pour présentation aux investisseurs</p>
                </div>
              </div>
            </div>

            {/* Que contient ce document ? */}
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
              <h3 class="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <i class="fas fa-info-circle"></i>
                Contenu du Document
              </h3>
              <ul class="space-y-2 text-sm text-blue-800">
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>Les 9 blocs du Business Model Canvas complétés</span>
                </li>
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>Vos réponses détaillées et améliorées</span>
                </li>
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>Format professionnel prêt pour partage</span>
                </li>
                <li class="flex items-center gap-2">
                  <i class="fas fa-check text-green-600"></i>
                  <span>Badge de validation IA Coach</span>
                </li>
              </ul>
            </div>

            {/* Actions de Téléchargement */}
            <div class="space-y-4">
              <button 
                onclick="downloadPDF()"
                class="w-full bg-red-600 text-white py-4 px-6 rounded-lg font-medium hover:bg-red-700 transition flex items-center justify-center gap-3 text-lg"
              >
                <i class="fas fa-download text-xl"></i>
                <span>Télécharger le PDF</span>
              </button>
              
              <div class="grid grid-cols-2 gap-4">
                <a 
                  href="/dashboard"
                  class="bg-gray-100 text-gray-700 py-3 px-6 rounded-lg font-medium hover:bg-gray-200 transition flex items-center justify-center gap-2"
                >
                  <i class="fas fa-home"></i>
                  <span>Retour au Dashboard</span>
                </a>
                <button 
                  onclick="shareDocument()"
                  class="bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 transition flex items-center justify-center gap-2"
                >
                  <i class="fas fa-share-alt"></i>
                  <span>Partager</span>
                </button>
              </div>
            </div>

            {/* Prochaines Étapes */}
            <div class="mt-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 class="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <i class="fas fa-rocket text-blue-600"></i>
                Prochaines Étapes
              </h3>
              <div class="space-y-3">
                <a href="/dashboard" class="block p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <i class="fas fa-calculator text-blue-600"></i>
                    </div>
                    <div>
                      <p class="font-medium text-gray-900">Étape 2 - Analyse Financière</p>
                      <p class="text-sm text-gray-600">Comprendre vos chiffres clés</p>
                    </div>
                  </div>
                </a>
                <a href="/dashboard" class="block p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <i class="fas fa-chart-line text-green-600"></i>
                    </div>
                    <div>
                      <p class="font-medium text-gray-900">Étape 3 - Projections Financières</p>
                      <p class="text-sm text-gray-600">Scénarios pour les investisseurs</p>
                    </div>
                  </div>
                </a>
              </div>
            </div>
          </div>

          {/* Données pour le PDF */}
          <script dangerouslySetInnerHTML={{__html: `
            const userData = ${JSON.stringify(answersMap)}
            const moduleName = "${module.title}"
            
            function downloadPDF() {
              const { jsPDF } = window.jspdf
              const doc = new jsPDF()
              
              // Configuration
              const pageWidth = 210
              const pageHeight = 297
              const margin = 20
              const maxWidth = pageWidth - (2 * margin)
              
              // En-tête
              doc.setFillColor(59, 130, 246)
              doc.rect(0, 0, pageWidth, 40, 'F')
              
              doc.setTextColor(255, 255, 255)
              doc.setFontSize(24)
              doc.setFont('helvetica', 'bold')
              doc.text('Business Model Canvas', pageWidth / 2, 20, { align: 'center' })
              
              doc.setFontSize(12)
              doc.setFont('helvetica', 'normal')
              doc.text('Plateforme EdTech - Entrepreneurs Afrique', pageWidth / 2, 30, { align: 'center' })
              
              // Badge de validation
              doc.setTextColor(34, 197, 94)
              doc.setFontSize(10)
              doc.text('✓ Validé par IA Coach', pageWidth / 2, 37, { align: 'center' })
              
              // Contenu
              doc.setTextColor(0, 0, 0)
              let yPos = 55
              
              const questions = [
                { id: 1, title: '1. Segments de Clientèle', icon: '👥' },
                { id: 2, title: '2. Proposition de Valeur', icon: '💎' },
                { id: 3, title: '3. Canaux de Distribution', icon: '📢' },
                { id: 4, title: '4. Relations Clients', icon: '🤝' },
                { id: 5, title: '5. Flux de Revenus', icon: '💰' },
                { id: 6, title: '6. Ressources Clés', icon: '🔑' },
                { id: 7, title: '7. Activités Clés', icon: '⚙️' },
                { id: 8, title: '8. Partenaires Clés', icon: '🤝' },
                { id: 9, title: '9. Structure de Coûts', icon: '💳' }
              ]
              
              questions.forEach((q, index) => {
                // Vérifier si on doit ajouter une nouvelle page
                if (yPos > 250) {
                  doc.addPage()
                  yPos = 20
                }
                
                // Titre de la section
                doc.setFontSize(14)
                doc.setFont('helvetica', 'bold')
                doc.setTextColor(37, 99, 235)
                doc.text(\`\${q.icon} \${q.title}\`, margin, yPos)
                yPos += 8
                
                // Contenu
                doc.setFontSize(10)
                doc.setFont('helvetica', 'normal')
                doc.setTextColor(0, 0, 0)
                
                const answer = userData[q.id] || 'Non renseigné'
                const lines = doc.splitTextToSize(answer, maxWidth)
                
                lines.forEach(line => {
                  if (yPos > 280) {
                    doc.addPage()
                    yPos = 20
                  }
                  doc.text(line, margin, yPos)
                  yPos += 5
                })
                
                yPos += 5
              })
              
              // Pied de page
              const totalPages = doc.internal.pages.length - 1
              for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i)
                doc.setFontSize(8)
                doc.setTextColor(128, 128, 128)
                doc.text(\`Page \${i} / \${totalPages}\`, pageWidth / 2, pageHeight - 10, { align: 'center' })
                doc.text(\`Généré le \${new Date().toLocaleDateString('fr-FR')}\`, margin, pageHeight - 10)
              }
              
              // Télécharger
              doc.save('Business-Model-Canvas.pdf')
              
              // Feedback visuel
              const btn = event.target
              const originalHTML = btn.innerHTML
              btn.innerHTML = '<i class="fas fa-check mr-2"></i>Téléchargement réussi !'
              btn.className = btn.className.replace('bg-red-600', 'bg-green-600').replace('hover:bg-red-700', 'hover:bg-green-700')
              
              setTimeout(() => {
                btn.innerHTML = originalHTML
                btn.className = btn.className.replace('bg-green-600', 'bg-red-600').replace('hover:bg-green-700', 'hover:bg-red-700')
              }, 3000)
            }
            
            function shareDocument() {
              if (navigator.share) {
                navigator.share({
                  title: 'Business Model Canvas',
                  text: 'Découvrez mon Business Model Canvas validé !',
                  url: window.location.href
                }).catch(err => console.log('Share cancelled'))
              } else {
                alert('Fonctionnalité de partage non disponible sur ce navigateur')
              }
            }
            
            window.downloadPDF = downloadPDF
            window.shareDocument = shareDocument
          `}} />
        </body>
      </html>
    )
  } catch (error) {
    console.error('Download page error:', error)
    return c.redirect('/dashboard')
  }
})
