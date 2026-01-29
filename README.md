# Plateforme EdTech Afrique - MVP Phase 1 & Phase 2

## 📋 Vue d'ensemble du projet

**Nom**: Plateforme EdTech Afrique  
**Objectif**: Accompagner les entrepreneurs africains de l'apprentissage au financement en transformant leurs idées en entreprises crédibles et finançables.

**Vision**: Une plateforme reposant sur un tronc pédagogique unique qui transforme progressivement l'apprentissage en livrables standardisés, validés par l'IA et par des coachs humains.

---

## 🌐 URLs

- **Application Local**: http://localhost:3000
- **Application Publique**: https://3000-idz38hzqfzrnrpqb61exq-18e660f9.sandbox.novita.ai
- **GitHub**: _(À configurer)_
- **Production Cloudflare Pages**: _(À déployer)_

---

## ✅ Fonctionnalités Actuelles

### Phase 1 - Fondations (100% ✅)

#### Écrans Transversaux Implémentés

✅ **A1 - Landing/Entry Screen**
- Choix du point de départ (pré-entrepreneur vs entrepreneur)
- Design moderne avec Tailwind CSS
- Orientation claire dès la première seconde

✅ **A2 - Création de compte**
- Formulaire d'inscription complet
- Authentification JWT sécurisée
- Hashing des mots de passe (SHA-256)
- Validation des données
- Redirection automatique vers le dashboard

✅ **A3 - Dashboard Principal**
- Vue globale de la progression
- Score de progression (Learning Progress / Investment Readiness)
- Barre de progression par étapes (1→5)
- Carte "Next Step" avec module recommandé
- Liste complète des modules avec statut
- Statistiques en temps réel

### Phase 2 - Tronc Pédagogique (100% ✅)

#### Module Business Model Canvas - Parcours B1→B7

✅ **B1 - Écran Vidéo Pédagogique** (`/module/:code/video`)
- Vidéo YouTube intégrée (8 minutes)
- Barre de progression (1/7)
- Liste des objectifs d'apprentissage
- 4 points clés avec icônes
- Bouton "Passer au quiz"
- Mise à jour automatique du statut

✅ **B2 - Quiz de Validation** (`/module/:code/quiz`)
- 5 questions à choix multiples
- Validation en temps réel
- Scoring automatique (≥80% requis)
- Explications détaillées pour chaque question
- Feedback visuel (vert/rouge)
- Sauvegarde dans la base de données
- Redirection conditionnelle selon le score

✅ **B3 - Questions Guidées** (`/module/:code/questions`)
- 9 questions structurées (blocs du Canvas)
- Aide contextuelle pour chaque question
- Exemples concrets
- Erreurs fréquentes à éviter
- Sauvegarde automatique en temps réel
- Barre de progression (3/7)

✅ **B4 - Analyse IA / Challenge** (`/module/:code/analysis`)
- Analyse automatique de chaque réponse
- Feedback constructif par section
- Score de crédibilité (0-100%)
- Suggestions d'amélioration
- Navigation inter-blocs
- 2 options: améliorer ou valider directement

✅ **B5 - Réécriture / Itération** (`/module/:code/improve`)
- Affichage réponse originale vs suggestions IA
- Zone de texte pour amélioration
- Sauvegarde des versions améliorées
- Navigation question par question
- Historique des itérations
- Passage à la validation

✅ **B6 - Validation Finale** (`/module/:code/validate`)
- Checklist de qualité
- Récapitulatif du parcours B1→B5
- Bouton de soumission pour validation
- Mise à jour du statut en DB
- Création du livrable
- Redirection vers téléchargement

✅ **B7 - Livrable PDF** (`/module/:code/download`)
- Badge de succès
- Aperçu du document
- Génération PDF client-side (jsPDF)
- Business Model Canvas complet (9 blocs)
- Design professionnel
- Badge "Validé par IA Coach"
- Boutons: Télécharger, Partager, Dashboard
- Suggestions des prochaines étapes

### API Backend Complètes

✅ `/api/register` - Création de compte utilisateur  
✅ `/api/login` - Connexion utilisateur  
✅ `/api/logout` - Déconnexion  
✅ `/api/user` - Récupération du profil utilisateur  
✅ `/api/module/quiz` - Sauvegarde résultats quiz  
✅ `/api/module/answer` - Sauvegarde réponse unique  
✅ `/api/module/submit-answers` - Soumission toutes réponses  
✅ `/api/module/improve-answer` - Sauvegarde amélioration  
✅ `/api/module/validate` - Validation finale module  

---

## 🗄️ Architecture de Base de Données (Cloudflare D1)

### Tables Principales

**users** - Comptes utilisateurs
- Authentification JWT
- Types: pre_entrepreneur / entrepreneur
- Statuts: student / entrepreneur / alumni

**projects** - Projets entrepreneuriaux
- Un projet par défaut créé à l'inscription
- Lié aux utilisateurs

**modules** - Modules pédagogiques prédéfinis
- 7 modules fondation (Étapes 1-5)
- Business Model Canvas, Analyse Financière, Projections, etc.

**progress** - Suivi de progression
- État: not_started / in_progress / completed / validated
- Scores de quiz
- Timestamps de complétion

**questions** - Réponses utilisateurs
- Feedback IA
- Itérations multiples
- Validation coach

**user_answers** - Stockage réponses (nouvelle table Phase 2)
- Réponses par question et module
- Historique des modifications
- Support B5/B7

**quiz_attempts** - Tentatives de quiz
- Historique complet
- Scores et résultats

**deliverables** - Documents générés
- PDF, Slides, Canvas, Reports
- Livrables prêts pour investisseurs
- Statuts: pending / ready / archived

---

## 🎯 Parcours Utilisateur Complet

```
1. Landing Page (/) ✅
   ↓
2. Choix: Pré-entrepreneur ou Entrepreneur ✅
   ↓
3. Inscription (/register?type=...) ✅
   ↓
4. Dashboard (/dashboard) ✅
   ↓
5. Sélection Business Model Canvas ✅
   ↓
6. B1 - Vidéo pédagogique (8 min) ✅
   ↓
7. B2 - Quiz validation (5 questions, ≥80%) ✅
   ↓
8. B3 - Questions guidées (9 blocs Canvas) ✅
   ↓
9. B4 - Analyse IA + feedback ✅
   ↓
10. B5 - Amélioration itérative ✅
   ↓
11. B6 - Validation finale ✅
   ↓
12. B7 - Téléchargement PDF ✅
```

---

## 🚧 Fonctionnalités En Attente (Phase 3+)

### Étapes Restantes
⏳ **Étape 2** - Analyse financière (réutilise B1→B7)  
⏳ **Étape 3** - Projections financières (3 scénarios)  
⏳ **Étape 4** - Business Plan complet  
⏳ **Étape 5** - Impact & ODD  

### Fonctionnalités Avancées
⏳ Upload de fichiers (Pitch Deck, documents financiers)  
⏳ Intégration IA réelle (OpenAI/Claude API)  
⏳ Interface bailleurs/donateurs  
⏳ Modules avancés (Croissance, Gouvernance, Marketing)  
⏳ Système de scoring avancé  
⏳ Coaching humain (validation par coachs)  

---

## 🛠️ Stack Technique

### Frontend
- **Hono JSX** - Rendu côté serveur
- **TailwindCSS** - Design system via CDN
- **FontAwesome** - Iconographie
- **JavaScript Vanilla** - Interactions client
- **jsPDF** - Génération PDF client-side

### Backend
- **Hono Framework** - Web framework léger
- **Cloudflare Workers** - Runtime edge
- **Cloudflare D1** - Base de données SQLite distribuée
- **JWT** - Authentification stateless

### Outils
- **Vite** - Build tool
- **Wrangler** - CLI Cloudflare
- **PM2** - Process manager (dev)
- **TypeScript** - Type safety

---

## 🚀 Guide de Développement

### Prérequis
- Node.js 18+
- npm ou pnpm
- Compte Cloudflare (pour production)

### Installation

```bash
cd /home/user/webapp
npm install
```

### Configuration Base de Données

```bash
# Appliquer les migrations en local
npm run db:migrate:local

# Console D1 locale
npm run db:console:local
```

### Développement Local

```bash
# Build du projet
npm run build

# Démarrer avec PM2 (sandbox)
pm2 start ecosystem.config.cjs

# Ou démarrer directement (local machine)
npm run dev:sandbox
```

### Tests

```bash
# Tester le serveur
curl http://localhost:3000

# Tester l'API d'inscription
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"test123","country":"SN","status":"entrepreneur","user_type":"entrepreneur"}'

# Tester le parcours complet
# 1. Créer un compte via /register
# 2. Se connecter via /login
# 3. Accéder au dashboard
# 4. Cliquer sur "Business Model Canvas"
# 5. Suivre B1→B2→B3→B4→B5→B6→B7
```

---

## 📦 Scripts Disponibles

```json
{
  "dev": "vite",
  "dev:sandbox": "wrangler pages dev dist --d1=webapp-production --local --ip 0.0.0.0 --port 3000",
  "build": "vite build",
  "deploy:prod": "npm run build && wrangler pages deploy dist --project-name webapp",
  "db:migrate:local": "wrangler d1 migrations apply webapp-production --local",
  "db:migrate:prod": "wrangler d1 migrations apply webapp-production",
  "clean-port": "fuser -k 3000/tcp 2>/dev/null || true",
  "git:commit": "git add . && git commit -m"
}
```

---

## 📊 Statut du Projet

**Phase Actuelle**: Phase 2 - Tronc Pédagogique Complet  
**Dernière Mise à Jour**: 2025-01-29  
**Statut**: ✅ Phase 1 + Phase 2 Complètes - Parcours B1→B7 fonctionnel

### Progression Globale

| Phase | Statut | Progrès |
|-------|--------|---------|
| **Phase 1** - Fondations | ✅ Terminé | 100% |
| **Phase 2** - Tronc B1→B7 | ✅ Terminé | 100% |
| **Phase 3** - Étapes 2-5 | ⏳ En attente | 0% |
| **Phase 4** - Fonctionnalités avancées | ⏳ En attente | 0% |

### Statistiques Actuelles

- **Commits Git**: 9
- **Fichiers TypeScript/TSX**: 18
- **Lignes de code**: ~5000
- **Bundle size**: 153.79 KB
- **Écrans fonctionnels**: 13
- **Routes API**: 9
- **Tables DB**: 8
- **Modules complétés**: 1 (Business Model Canvas)

### Prochaines Étapes Recommandées

1. **Tests Utilisateurs** - Valider le parcours B1→B7 complet
2. **Intégration IA Réelle** - Remplacer mocks par OpenAI/Claude
3. **Développer Étapes 2-5** - Réutiliser B1→B7
4. **Upload Fichiers** - Cloudflare R2 pour pitch decks
5. **Déploiement Production** - Cloudflare Pages
6. **Interface Bailleurs** - Vue macro pour investisseurs

---

## 🔐 Sécurité

- ✅ Mots de passe hashés (SHA-256 + salt)
- ✅ JWT avec expiration (7 jours)
- ✅ Cookies httpOnly, secure (prod), sameSite
- ✅ Validation inputs côté serveur
- ✅ Détection automatique dev/prod pour cookies
- ⚠️ **TODO**: Implémenter rate limiting
- ⚠️ **TODO**: Passer à bcrypt en production

---

## 🤝 Contribution

### Structure de Commit
```
git add .
git commit -m "feat: ajouter fonctionnalité X"
git commit -m "fix: corriger bug Y"
git commit -m "docs: mettre à jour README"
```

### Branches
- `main` - Production
- `dev` - Développement
- `feature/*` - Nouvelles fonctionnalités

---

## 📞 Support & Contact

Pour toute question ou problème, consultez la documentation ou créez une issue sur GitHub.

---

**Fait avec ❤️ pour l'écosystème entrepreneurial africain**
