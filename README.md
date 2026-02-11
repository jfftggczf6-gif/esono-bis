# Investment Readiness Platform — PME Afrique

## Vue d'ensemble

Plateforme intelligente de preparation a l'investissement pour les PME africaines (focus Cote d'Ivoire / Afrique de l'Ouest). Accompagne un entrepreneur etape par etape, du business model jusqu'au dossier investisseur complet.

- **Devise par defaut** : XOF (FCFA)
- **TVA** : 18% | **IS** : 25% | **Charges sociales** : ~25% du brut

## Architecture : 8 Modules Sequentiels

### Modules Hybrides (1-3) : Micro-learning + IA + Coaching

| Module | Code | Description | Livrables |
|--------|------|-------------|-----------|
| 1. BMC | `mod1_bmc` | Business Model Canvas — 9 blocs | Excel BMC + HTML Diagnostic |
| 2. SIC | `mod2_sic` | Social Impact Canvas — 5 sections, 14 questions, ODD, SMART | Excel SIC (6 feuilles + recap) + HTML Diagnostic |
| 3. Inputs | `mod3_inputs` | Donnees financieres — historiques, RH, CAPEX | Excel Inputs + Rapport validation |

Chaque section des modules hybrides suit le parcours :
1. **Capsule educative** (30s-2min) avec exemples sectoriels
2. **Saisie assistee IA** — suggestions, validation temps reel
3. **Coaching humain** (optionnel) — chat/visio integre

### Modules Automatiques (4-8) : Traitement IA

| Module | Code | Description | Livrable |
|--------|------|-------------|----------|
| 4. Framework | `mod4_framework` | Modelisation financiere 5 ans | Excel Framework (8 feuilles) |
| 5. Diagnostic | `mod5_diagnostic` | Score credibilite /20, risques, plan action | HTML Diagnostic Expert |
| 6. Plan OVO | `mod6_ovo` | Template financier 8 ans | Plan Financier OVO (.xlsm) |
| 7. Business Plan | `mod7_business_plan` | Document complet max 20 pages | Business Plan (.docx) |
| 8. ODD | `mod8_odd` | Evaluation 40 cibles ODD | ODD Template (.xlsx) |

### Flux de donnees

```
Module 1 (BMC) ────────────────┐
                                ├──→ Module 4 (Framework)
Module 2 (SIC) ────────────────┤         │
                                │         ├──→ Module 5 (Diagnostic)
Module 3 (Inputs) ─────────────┘         │         │
                                          │         ├──→ Module 6 (OVO)
                                          │         │
Module 2 (SIC) ──────────────────────────────────────────→ Module 8 (ODD)
                                          │         │
Modules 1-6 ──────────────────────────────┴─────────┴──→ Module 7 (BP)
```

## Pages de l'application

| Page | URL | Description |
|------|-----|-------------|
| Landing | `/` | Page publique avec presentation des 8 modules |
| Inscription | `/register` | Creation de compte |
| Connexion | `/login` | Authentification |
| Dashboard | `/dashboard` | Vue d'ensemble, progression, cartes modules |
| Module hybride | `/module/:code/video` | Micro-learning video + quiz |
| Module hybride | `/module/:code/quiz` | Quiz de validation (80% min) |
| Module hybride | `/module/:code/questions` | Saisie assistee IA par section |
| Module hybride | `/module/:code/analysis` | Analyse IA avec scoring par section |
| Module hybride | `/module/:code/improve` | Iteration et amelioration |
| Module hybride | `/module/:code/validate` | Validation IA + coach |
| Module hybride | `/module/:code/download` | Livrable final (PDF, HTML, Excel) |
| Module auto (overview) | `/module/:code/overview` | Resume des donnees + bouton generer |
| Module auto (generate) | `/module/:code/generate` | Page de generation IA en cours |
| Livrables | `/livrables` | Liste tous les livrables, statut, telechargement |

## API Endpoints

### Authentification
| Methode | URL | Description |
|---------|-----|-------------|
| POST | `/api/register` | Inscription |
| POST | `/api/login` | Connexion (retourne JWT cookie) |
| POST | `/api/logout` | Deconnexion |
| GET | `/api/user` | Infos utilisateur |

### Modules generiques
| Methode | URL | Description |
|---------|-----|-------------|
| GET | `/api/modules/learning` | Liste des modules |
| POST | `/api/module/quiz` | Soumettre un quiz |
| POST | `/api/module/answer` | Sauvegarder une reponse |
| POST | `/api/module/submit-answers` | Soumettre toutes les reponses |
| POST | `/api/module/improve-answer` | Ameliorer une reponse |
| POST | `/api/module/validate` | Valider un module |
| GET | `/api/module/:code/deliverable` | Recuperer un livrable |
| POST | `/api/module/:code/deliverable/refresh` | Regenerer un livrable |

### Module 2 SIC (Social Impact Canvas)
| Methode | URL | Description |
|---------|-----|-------------|
| POST | `/api/sic/analyze` | Lancer l'analyse SIC (scoring 5 sections, SMART, ODD, impact washing) |
| GET | `/api/sic/deliverable` | Obtenir le diagnostic HTML SIC |
| POST | `/api/sic/deliverable/refresh` | Regenerer le diagnostic SIC |

### Finances (Modules 3+4)
| Methode | URL | Description |
|---------|-----|-------------|
| GET/POST | `/api/finance/inputs` | Inputs financiers |
| POST | `/api/finance/analyze` | Analyse financiere |
| POST | `/api/finance/validate` | Validation financiere |
| GET/POST | `/api/finance/deliverable` | Livrable financier |
| GET/POST | `/api/activity-report/*` | Rapport d'activite |

## Stack technique

- **Backend** : Hono (TypeScript) sur Cloudflare Workers
- **Base de donnees** : Cloudflare D1 (SQLite)
- **Frontend** : JSX server-side + Tailwind CSS (CDN) + FontAwesome
- **Design system** : ESONO (CSS custom)
- **Moteur SIC** : `sic-engine.ts` — scoring, SMART check, ODD mapping, impact washing detection

## Module 2 SIC — Architecture detaillee

### Sections du SIC (14 questions)
1. **Impact Vise** (Q1-Q3) : Probleme social, changement vise, zone geographique
2. **Beneficiaires** (Q4-Q6) : Profil, comptage, implication
3. **Mesure d'Impact** (Q7-Q10) : KPI, baseline, cible, methode, frequence
4. **ODD & Contribution** (Q11-Q13) : ODD selectionnes, contribution directe/indirecte, preuves
5. **Risques & Defis** (Q14-Q15) : Risques identifies, strategies d'attenuation

### Moteur d'analyse SIC (`sic-engine.ts`)
- **Score global /10** (moyenne ponderee des 5 sections)
- **Verification SMART** (5 criteres: Specifique, Mesurable, Atteignable, Relevant, Temporel)
- **Mapping ODD** (extraction automatique, contribution directe/indirecte, niveau de preuve)
- **Detection impact washing** (signaux faible/moyen/eleve)
- **Coherence BMC ↔ SIC** (proposition de valeur vs impact vise, segments vs beneficiaires)
- **Matrice d'impact** (Intentionnel → Mesure → Prouve)
- **Diagnostic HTML** complet avec visualisations ODD et scoring par section

### Base de donnees SIC
- `sic_data` : Donnees structurees par section
- `sic_deliverables` : Livrables SIC (excel_sic, html_diagnostic)

## Developpement local

```bash
# Installation
npm install

# Appliquer les migrations (incluant 0009 pour SIC)
npm run db:migrate:local

# Build
npm run build

# Demarrer
pm2 start ecosystem.config.cjs

# Tester
curl http://localhost:3000
```

## Fonctionnalites implementees

- [x] Landing page avec presentation 8 modules (hybrides + automatiques)
- [x] Inscription / Connexion avec JWT
- [x] Dashboard avec barre de progression 8 etapes
- [x] Cartes modules hybrides (1-3) avec badges micro-learning/IA/coaching
- [x] Cartes modules automatiques (4-8) avec formats livrables
- [x] Systeme de verrouillage sequentiel (dependances entre modules)
- [x] Page module automatique : overview + generation + download
- [x] Page livrables centralisee avec statut par fichier
- [x] Navigation sidebar avec les 8 modules + livrables
- [x] Module 1 BMC : parcours complet video → quiz → questions → analyse → validation → livrable
- [x] Module 2 SIC : parcours complet video → quiz → 14 questions → analyse SIC → validation → diagnostic HTML
- [x] Moteur SIC : scoring /10, SMART check, ODD mapping, impact washing detection, coherence BMC
- [x] API SIC : /api/sic/analyze, /api/sic/deliverable, /api/sic/deliverable/refresh
- [x] Page download SIC dediee : scores par section, alignement ODD, recommandations
- [x] Migration DB 0009 pour tables SIC (sic_data, sic_deliverables)
- [x] Regression test E2E : 34 endpoints, 100% de reussite

## Prochaines etapes

- [ ] Contenu Inputs (Module 3) : 9 onglets financiers avec validation mathematique
- [ ] Integration IA reelle (API OpenAI) pour analyse et generation
- [ ] Moteur de generation des livrables Excel/HTML/Word/XLSM
- [ ] Chat coaching integre avec notifications
- [ ] Export pack complet (.zip) depuis la page livrables
- [ ] Deploiement Cloudflare Pages

## Derniere mise a jour

2026-02-11 — Module 2 SIC complet : moteur d'analyse, diagnostic HTML, 14 questions guidees, API endpoints, page download dediee
