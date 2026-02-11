// ═══════════════════════════════════════════════════════════════════
// INVESTMENT READINESS PLATFORM — MODULE CONTENT & DEFINITIONS
// Architecture: 8 modules séquentiels
//   Modules 1-3 : HYBRIDES (micro-learning + IA + coaching)
//   Modules 4-8 : TRAITEMENT IA AUTOMATIQUE
// ═══════════════════════════════════════════════════════════════════

export type ModuleVariant = 'canvas' | 'finance' | 'auto'
export type ModuleCategory = 'hybrid' | 'automatic'

export interface ModuleContent {
  video_url?: string
  video_duration?: number
  quiz_questions?: QuizQuestion[]
  guided_questions?: GuidedQuestion[]
}

export interface QuizQuestion {
  id: number
  question: string
  options: string[]
  correct_answer: number
  explanation: string
}

export interface GuidedQuestion {
  id: number
  section: string
  question: string
  placeholder: string
  help_text: string
  example: string
  common_mistake: string
}

export type LearningStageKey =
  | 'microLearning'
  | 'quiz'
  | 'inputs'
  | 'analysis'
  | 'iteration'
  | 'validation'
  | 'deliverable'

export interface LearningStageDefinition {
  label: string
  description: string
  focusPoints?: string[]
  optional?: boolean
  deliverables?: string[]
  notes?: string[]
}

export interface LearningModuleOutputSpec {
  format: string
  description: string
}

export interface LearningModuleDefinition {
  id: string
  code: string
  title: string
  shortTitle: string
  slug: string
  order: number
  moduleNumber: number // 1-8
  type: 'input' | 'output'
  category: ModuleCategory
  variant?: ModuleVariant
  icon: string
  color: string
  summary: string
  learningObjectives: string[]
  dependencies: string[]
  sections?: ModuleSectionDefinition[]
  flow: Record<LearningStageKey, LearningStageDefinition>
  outputs: LearningModuleOutputSpec[]
  downstreamFeeds: string[]
}

export interface ModuleSectionDefinition {
  id: string
  title: string
  description: string
  microLearningText: string
  fields?: ModuleFieldDefinition[]
}

export interface ModuleFieldDefinition {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'currency'
  placeholder?: string
  help_text?: string
  required?: boolean
  validation?: string
  options?: { value: string; label: string }[]
}

// ═══════════════════════════════════════════════════════════════════
// MODULE 1 : BMC (Business Model Canvas)
// ═══════════════════════════════════════════════════════════════════
export const bmcContent: ModuleContent = {
  video_url: 'https://www.youtube.com/embed/QoAOzMTLP5s',
  video_duration: 480,
  quiz_questions: [
    {
      id: 1,
      question: "Qu'est-ce que le Business Model Canvas ?",
      options: [
        "Un document financier détaillé",
        "Un outil visuel pour décrire, concevoir et pivoter un modèle économique",
        "Un plan marketing complet",
        "Un organigramme d'entreprise"
      ],
      correct_answer: 1,
      explanation: "Le Business Model Canvas est un outil stratégique de management qui permet de décrire, concevoir, challenger et pivoter un modèle économique."
    },
    {
      id: 2,
      question: "Combien de blocs composent le Business Model Canvas ?",
      options: ["5 blocs", "7 blocs", "9 blocs", "12 blocs"],
      correct_answer: 2,
      explanation: "Le Business Model Canvas est composé de 9 blocs essentiels qui couvrent les 4 principales dimensions d'une entreprise."
    },
    {
      id: 3,
      question: "Quel bloc décrit la valeur unique que votre entreprise apporte ?",
      options: ["Segments de clientèle", "Canaux de distribution", "Proposition de valeur", "Flux de revenus"],
      correct_answer: 2,
      explanation: "La Proposition de Valeur décrit l'ensemble des produits et services qui créent de la valeur pour un segment de clientèle spécifique."
    },
    {
      id: 4,
      question: "Quelle est la différence entre 'Ressources Clés' et 'Activités Clés' ?",
      options: [
        "Il n'y a pas de différence",
        "Les ressources sont ce que vous possédez, les activités sont ce que vous faites",
        "Les ressources sont humaines, les activités sont financières",
        "Les activités viennent avant les ressources"
      ],
      correct_answer: 1,
      explanation: "Les Ressources Clés sont les actifs nécessaires tandis que les Activités Clés sont les actions importantes à entreprendre."
    },
    {
      id: 5,
      question: "Pourquoi la Structure de Coûts et les Sources de Revenus sont-elles liées ?",
      options: [
        "Elles ne sont pas liées",
        "Elles doivent être identiques",
        "Les revenus doivent couvrir les coûts pour assurer la viabilité du modèle",
        "Les coûts déterminent automatiquement les revenus"
      ],
      correct_answer: 2,
      explanation: "La viabilité d'un business model repose sur l'équilibre entre les sources de revenus et la structure de coûts."
    }
  ],
  guided_questions: [
    {
      id: 1,
      section: "Partenaires Clés",
      question: "Qui sont vos partenaires et fournisseurs stratégiques ?",
      placeholder: "Ex: Fournisseurs de matières premières, banques partenaires, distributeurs, ONG locales...",
      help_text: "Les partenariats peuvent optimiser votre modèle, réduire les risques ou acquérir des ressources.",
      example: "Fournisseurs: 3 grossistes certifiés. Partenaires tech: AWS pour hébergement. Partenaires financiers: Orange Money.",
      common_mistake: "Oublier de mentionner POURQUOI ces partenaires sont clés."
    },
    {
      id: 2,
      section: "Activités Clés",
      question: "Quelles sont les activités les plus importantes pour faire fonctionner votre modèle ?",
      placeholder: "Ex: Production, logistique, marketing digital, formation clients...",
      help_text: "Les activités clés sont les actions les plus importantes qu'une entreprise doit entreprendre.",
      example: "Production: Fabrication et contrôle qualité. Marketing: Campagnes digitales. R&D: Amélioration continue.",
      common_mistake: "Confondre tâches quotidiennes et activités stratégiques."
    },
    {
      id: 3,
      section: "Ressources Clés",
      question: "Quelles sont les ressources essentielles (humaines, physiques, intellectuelles, financières) ?",
      placeholder: "Ex: Équipe technique, entrepôt, brevet, capital...",
      help_text: "Pensez aux 4 catégories : physiques, intellectuelles, humaines et financières.",
      example: "Humaines: 3 agronomes + 10 agents terrain. Physiques: 2 véhicules. Intellectuelles: App mobile propriétaire.",
      common_mistake: "Lister tout au lieu de ce qui est INDISPENSABLE et difficile à remplacer."
    },
    {
      id: 4,
      section: "Proposition de Valeur",
      question: "Quelle valeur apportez-vous à vos clients ? Quel problème résolvez-vous ?",
      placeholder: "Ex: Nous facilitons l'accès au financement pour les entrepreneurs sans historique bancaire...",
      help_text: "Votre proposition de valeur est la raison pour laquelle les clients vous choisissent.",
      example: "Plateforme digitale connectant producteurs et restaurants, éliminant intermédiaires et augmentant marges de 30%.",
      common_mistake: "Décrire vos produits au lieu des bénéfices clients."
    },
    {
      id: 5,
      section: "Relation Client",
      question: "Quel type de relation établissez-vous avec chaque segment de clientèle ?",
      placeholder: "Ex: Assistance personnalisée, self-service, communauté...",
      help_text: "Décrivez les types de relations : personnelle, automatisée, communautaire, co-création.",
      example: "Support 24/7 via chatbot IA + hotline. Programme de fidélité. Communauté en ligne.",
      common_mistake: "Oublier que la relation client a un coût."
    },
    {
      id: 6,
      section: "Canaux de Distribution",
      question: "Comment atteignez-vous vos clients et livrez-vous votre proposition de valeur ?",
      placeholder: "Ex: Application mobile, agents terrain, WhatsApp Business...",
      help_text: "Les canaux décrivent comment vous communiquez et livrez la valeur.",
      example: "Phase 1: Vente directe (site + app). Phase 2: Partenaires dans 5 villes. Phase 3: Revendeurs agréés.",
      common_mistake: "Confusion entre canal de communication et canal de distribution."
    },
    {
      id: 7,
      section: "Segments Clients",
      question: "Qui sont vos clients cibles ? Décrivez vos principaux segments.",
      placeholder: "Ex: PME agricoles, femmes entrepreneures 25-40 ans...",
      help_text: "Un segment représente un groupe de personnes que votre entreprise souhaite atteindre et servir.",
      example: "Coopératives agricoles de 10-50 membres en Afrique de l'Ouest, cultivant bio et cherchant l'export.",
      common_mistake: "Dire 'tout le monde'. Soyez spécifique : âge, localisation, secteur, taille, besoins."
    },
    {
      id: 8,
      section: "Structure de Coûts",
      question: "Quels sont vos principaux coûts et comment sont-ils structurés ?",
      placeholder: "Ex: Salaires (40%), infrastructure (15%), marketing (20%)...",
      help_text: "Identifiez les coûts fixes et variables les plus importants.",
      example: "Fixes: Salaires 15K€ + Loyer 2K€ + Logiciels 1K€. Variables: Matières (40% CA) + Livraison (5% CA).",
      common_mistake: "Sous-estimer les coûts indirects (admin, juridique, assurances)."
    },
    {
      id: 9,
      section: "Sources de Revenus",
      question: "Comment générez-vous des revenus ? Quels modèles de pricing ?",
      placeholder: "Ex: Abonnement, commission, vente directe...",
      help_text: "Précisez le modèle de tarification et les montants.",
      example: "Freemium: Gratuit < 50 clients, puis 15€/mois. Commission 3% par transaction. Pub 5000€/mois.",
      common_mistake: "Confondre prix et valeur."
    }
  ]
}

// ═══════════════════════════════════════════════════════════════════
// MODULE 2 : SIC (Social Impact Canvas)
// ═══════════════════════════════════════════════════════════════════
export const sicContent: ModuleContent = {
  video_url: 'https://www.youtube.com/embed/2VMLU5bYFbU',
  video_duration: 420,
  quiz_questions: [
    {
      id: 1,
      question: "Quelle est la difference entre output et outcome dans la mesure d'impact ?",
      options: [
        "Il n'y a pas de difference",
        "L'output est le resultat direct d'une activite, l'outcome est le changement a plus long terme",
        "L'output concerne les finances, l'outcome concerne les clients",
        "L'outcome est plus facile a mesurer que l'output"
      ],
      correct_answer: 1,
      explanation: "L'output (ex: 100 formations delivrees) est le resultat immediat. L'outcome (ex: 60% des formes ont augmente leur revenu) est le changement durable."
    },
    {
      id: 2,
      question: "Qu'est-ce que l'impact washing ?",
      options: [
        "Mesurer trop d'indicateurs",
        "Exagerer ou inventer un impact social/environnemental pour obtenir des financements",
        "Avoir un impact negatif",
        "Ignorer les ODD"
      ],
      correct_answer: 1,
      explanation: "L'impact washing consiste a exagerer ou fabriquer des pretentions d'impact pour paraitre socialement responsable."
    },
    {
      id: 3,
      question: "Qu'est-ce qu'un indicateur SMART ?",
      options: [
        "Un indicateur digital",
        "Specifique, Mesurable, Atteignable, Realiste, Temporellement defini",
        "Un indicateur financier",
        "Un indicateur valide par un auditeur"
      ],
      correct_answer: 1,
      explanation: "SMART garantit que l'indicateur est concret et verifiable : Specifique, Mesurable, Atteignable, Realiste, Temporellement defini."
    },
    {
      id: 4,
      question: "Combien d'ODD maximum recommande-t-on de cibler pour un projet PME ?",
      options: [
        "Tous les 17",
        "Entre 5 et 10",
        "2 a 3 maximum, bien documentes",
        "Un seul"
      ],
      correct_answer: 2,
      explanation: "2-3 ODD bien documentes avec des preuves concretes ont plus de valeur aupres d'un investisseur que 10 ODD superficiels."
    },
    {
      id: 5,
      question: "Quel element rend un impact credible aux yeux d'un investisseur ?",
      options: [
        "Des declarations d'intention",
        "Un grand nombre de beneficiaires estimes",
        "Des indicateurs mesurables avec une methode de collecte definie et une baseline",
        "Un logo ODD sur le pitch deck"
      ],
      correct_answer: 2,
      explanation: "La credibilite vient de la mesurabilite : indicateur precis + valeur actuelle (baseline) + cible + methode + frequence de collecte."
    }
  ],
  guided_questions: [
    // ─── Section 1 : Impact Vise (3 questions) ───
    {
      id: 1,
      section: "Impact Vise",
      question: "Quel probleme social ou environnemental votre entreprise resout-elle ?",
      placeholder: "Decrivez le probleme precis que vous adressez avec des chiffres si possible...",
      help_text: "Soyez precis et quantitatif. Citez des sources si possible (rapport gouvernemental, etude, donnees terrain).",
      example: "Chomage des jeunes diplomes en zone rurale : 42% de taux de chomage chez les 18-30 ans dans la region des Savanes (source: INS 2024). Plus de 15 000 diplomes sans emploi chaque annee.",
      common_mistake: "Etre trop vague ('ameliorer la vie des gens'). Un investisseur veut un probleme precis, chiffre et localise."
    },
    {
      id: 2,
      section: "Impact Vise",
      question: "Quelle transformation concrete votre solution va-t-elle creer ?",
      placeholder: "Decrivez le changement attendu en termes mesurables...",
      help_text: "Formulez le changement comme une equation : situation actuelle -> situation visee. Utilisez des chiffres.",
      example: "Augmenter les revenus des petits agriculteurs de 50% en 3 ans (de 450 000 XOF/an a 675 000 XOF/an) grace a la formation et l'acces au marche direct.",
      common_mistake: "Promettre un changement sans echelle de temps ni indicateur quantifie."
    },
    {
      id: 3,
      section: "Impact Vise",
      question: "Pourquoi ce probleme est-il urgent et important MAINTENANT ?",
      placeholder: "Contexte d'urgence, tendances, donnees recentes...",
      help_text: "Montrez l'urgence avec des tendances actuelles : aggravation du probleme, fenetre d'opportunite, politique publique favorable.",
      example: "Migration massive des jeunes vers Abidjan (+12%/an), taux de malnutrition en hausse dans la region (+8% en 2 ans), nouvelle politique gouvernementale de soutien a l'agriculture durable (Programme National 2025-2030).",
      common_mistake: "Citer des donnees anciennes ou des generalites sans lien avec votre zone d'intervention."
    },
    // ─── Section 2 : Beneficiaires (3 questions) ───
    {
      id: 4,
      section: "Beneficiaires",
      question: "Qui sont vos beneficiaires directs ? (profil, nombre, localisation)",
      placeholder: "Profil: [qui]. Nombre: [combien]. Localisation: [ou]...",
      help_text: "Les beneficiaires directs sont ceux qui recoivent directement votre produit ou service. Soyez precis sur le profil socio-demographique.",
      example: "500 petits agriculteurs de la region de Thies : 70% femmes, age moyen 35 ans, revenus < 500 000 XOF/an, cultivant sur moins de 2 hectares.",
      common_mistake: "Donner un chiffre rond sans justification. Expliquez comment vous arrivez a ce nombre."
    },
    {
      id: 5,
      section: "Beneficiaires",
      question: "Combien de personnes seront impactees d'ici 3 ans ? (directs + indirects)",
      placeholder: "Directs: [nombre + base de calcul]. Indirects: [nombre + explication du mecanisme]...",
      help_text: "Beneficiaires indirects = ceux qui beneficient par ricochet (familles, communaute). Le ratio indirect/direct doit etre justifie.",
      example: "Directs: 2 000 agricultrices formees et accompagnees. Indirects: 10 000 personnes (5 membres par famille en moyenne). Mecanisme: augmentation des revenus familiaux, meilleure alimentation des enfants.",
      common_mistake: "Multiplier les directs par un coefficient exagere pour gonfler les indirects (ratio > 10:1 est suspect)."
    },
    {
      id: 6,
      section: "Beneficiaires",
      question: "Comment vos beneficiaires sont-ils impliques dans la conception et l'amelioration de votre solution ?",
      placeholder: "Mecanismes de participation, consultation, co-creation...",
      help_text: "Un investisseur d'impact verifie que les beneficiaires ne sont pas passifs. Montrez leur role actif.",
      example: "Comite consultatif de 12 agricultrices elu chaque annee. Enquete de satisfaction semestrielle. Sessions de co-design des formations avec les beneficiaires pilotes.",
      common_mistake: "Dire que les beneficiaires 'participent' sans decrire le mecanisme concret."
    },
    // ─── Section 3 : Mesure d'Impact (4 questions) ───
    {
      id: 7,
      section: "Mesure d'Impact",
      question: "Quel est votre indicateur d'impact principal (KPI) ?",
      placeholder: "KPI principal: [indicateur precis et mesurable]...",
      help_text: "Choisissez UN indicateur principal SMART. Il doit etre directement lie a votre impact vise.",
      example: "Revenu agricole moyen annuel des beneficiaires (en XOF). C'est notre KPI principal car il mesure directement l'amelioration economique visee.",
      common_mistake: "Choisir un KPI trop large ('amelioration du bien-etre') ou impossible a mesurer avec vos moyens."
    },
    {
      id: 8,
      section: "Mesure d'Impact",
      question: "Quelle est votre cible d'impact a 1 an et a 3 ans ?",
      placeholder: "Valeur actuelle (baseline): [X]. Cible 1 an: [Y]. Cible 3 ans: [Z]...",
      help_text: "La baseline (valeur actuelle) est indispensable. Sans elle, impossible de mesurer le progres.",
      example: "Baseline: 450 000 XOF/an (enquete T0 sur 200 agricultrices). Cible 1 an: 580 000 XOF (+29%). Cible 3 ans: 780 000 XOF (+73%).",
      common_mistake: "Ne pas avoir de baseline. Comment prouver un progres sans point de depart ?"
    },
    {
      id: 9,
      section: "Mesure d'Impact",
      question: "Quelle methode utilisez-vous pour mesurer votre impact ?",
      placeholder: "Methode(s): enquetes, donnees internes, audit... Frequence: [periodicite]...",
      help_text: "Decrivez vos outils de collecte et la frequence. Un mix de methodes est plus credible.",
      example: "1) Enquete avant/apres aupres des beneficiaires (echantillon 200, semestriel). 2) Donnees de vente du service (mensuel). 3) Temoignages et etudes de cas (trimestriel). Audit externe prevu en annee 2.",
      common_mistake: "Dire qu'on 'va mesurer' sans methode concrete. L'investisseur veut voir un plan de M&E (Monitoring & Evaluation) existant."
    },
    {
      id: 10,
      section: "Mesure d'Impact",
      question: "A quelle frequence mesurez-vous votre impact ?",
      placeholder: "Frequence: mensuelle/trimestrielle/semestrielle/annuelle. Responsable: [qui]...",
      help_text: "La frequence doit etre adaptee a votre indicateur. Un suivi trop rare empeche les corrections.",
      example: "Suivi mensuel des donnees de vente (automatise). Enquete terrain semestrielle (equipe impact, 2 personnes). Rapport annuel d'impact avec audit externe.",
      common_mistake: "Prevoir une frequence irrealiste (suivi quotidien terrain avec 1 personne) ou trop espacee (annuel uniquement)."
    },
    // ─── Section 4 : ODD & Contribution (3 questions) ───
    {
      id: 11,
      section: "ODD & Contribution",
      question: "Quels ODD adressez-vous ? (max 3 ODD principaux)",
      placeholder: "ODD principal: [numero + intitule]. ODD secondaire 1: [...]. ODD secondaire 2: [...]...",
      help_text: "Selectionnez 2-3 ODD maximum. Pour chaque ODD, identifiez la cible specifique (ex: ODD 2, cible 2.3).",
      example: "ODD 2 (Faim Zero) - cible 2.3 : doubler la productivite des petits producteurs alimentaires. ODD 8 (Travail decent) - cible 8.5 : emploi productif pour les femmes. ODD 12 (Conso responsable) - cible 12.2 : gestion durable des ressources naturelles.",
      common_mistake: "Cocher 8-10 ODD sans justification. 2-3 ODD bien documentes avec des preuves ont plus de poids."
    },
    {
      id: 12,
      section: "ODD & Contribution",
      question: "Comment contribuez-vous concretement a ces ODD ? (contribution directe vs indirecte)",
      placeholder: "Pour chaque ODD: action concrete, preuve, direct/indirect...",
      help_text: "Distinguez contribution directe (mecanisme prouve) et indirecte (effet secondaire estime).",
      example: "ODD 2 direct: nos formations augmentent les rendements de 40% (mesure par enquete). ODD 8 direct: 200 emplois crees dans la chaine de valeur. ODD 12 indirect: reduction des dechets agricoles par compostage (pas encore mesure).",
      common_mistake: "Presenter tout comme contribution directe. Un investisseur respecte plus l'honnetete qu'une inflation d'impact."
    },
    {
      id: 13,
      section: "ODD & Contribution",
      question: "Quelles preuves avez-vous de votre contribution aux ODD ?",
      placeholder: "Donnees, rapports, certifications, partenariats officiels...",
      help_text: "Les preuves peuvent etre internes (donnees propres) ou externes (audit, certification, rapport partenaire).",
      example: "Rapport d'impact annuel audite par Cabinet XYZ. Partenariat avec le Ministere de l'Agriculture (convention signee). Certification Commerce Equitable en cours.",
      common_mistake: "Declarer une contribution ODD sans aucune preuve ni plan de collecte de preuves."
    },
    // ─── Section 5 : Risques & Defis (2 questions) ───
    {
      id: 14,
      section: "Risques & Defis",
      question: "Quels sont les principaux risques qui pourraient compromettre votre impact ? (cochez et detaillez)",
      placeholder: "Risques identifies: financement, adoption, culture, infrastructure, reglementation, concurrence, climat, autre. Pour chaque risque, indiquez le niveau (faible/moyen/eleve) et une breve description...",
      help_text: "Identifiez au minimum 3 risques. Un investisseur apprecie la lucidite plus que l'optimisme aveugle.",
      example: "1) Financement insuffisant (eleve) : dependance a 60% des subventions. 2) Resistance culturelle (moyen) : adoption lente des nouvelles pratiques agricoles. 3) Climat (eleve) : secheresse recurrente dans la zone.",
      common_mistake: "Ignorer les risques ou tous les classer en 'faible'. Le deni de risque est un red flag pour les investisseurs."
    },
    {
      id: 15,
      section: "Risques & Defis",
      question: "Comment attenuez-vous chacun de ces risques ?",
      placeholder: "Pour chaque risque identifie: strategie d'attenuation concrete...",
      help_text: "Chaque risque doit avoir un plan B. Montrez que vous avez anticipe les scenarios defavorables.",
      example: "1) Financement: diversification vers revenus propres (objectif 60% autofinancement en an 3). 2) Culture: partenariat avec leaders communautaires + formation par les pairs. 3) Climat: irrigation goutte-a-goutte + varietes resistantes.",
      common_mistake: "Donner des strategies generiques ('on trouvera une solution'). Soyez precis et chiffre."
    }
  ]
}

// ═══════════════════════════════════════════════════════════════════
// MODULE 3 : INPUTS ENTREPRENEUR (Collecte données financières)
// ═══════════════════════════════════════════════════════════════════
export const inputsEntrepreneurContent: ModuleContent = {
  video_url: 'https://www.youtube.com/embed/i-nY7Es6S0I',
  video_duration: 540,
  quiz_questions: [
    {
      id: 1,
      question: "Quelle est la différence entre un coût fixe et un coût variable ?",
      options: [
        "Les coûts fixes changent tous les mois, les variables restent stables",
        "Les coûts fixes ne changent pas avec le volume de production, les variables oui",
        "Il n'y a pas de différence en comptabilité africaine",
        "Les coûts fixes sont plus importants que les variables"
      ],
      correct_answer: 1,
      explanation: "Un coût fixe (loyer, salaires) reste stable quel que soit le volume. Un coût variable (matières premières, commissions) augmente avec l'activité."
    },
    {
      id: 2,
      question: "Comment calcule-t-on la marge brute ?",
      options: [
        "Chiffre d'affaires - Impôts",
        "Chiffre d'affaires - Coûts directs/variables",
        "Résultat net - Charges fixes",
        "EBITDA - Amortissements"
      ],
      correct_answer: 1,
      explanation: "Marge brute = Chiffre d'affaires - Coûts directs (matières, main d'œuvre directe). Elle mesure la rentabilité de votre activité core."
    },
    {
      id: 3,
      question: "Qu'est-ce que le BFR (Besoin en Fonds de Roulement) ?",
      options: [
        "Le montant de la dette bancaire",
        "Le cash nécessaire pour financer le décalage entre encaissements et décaissements",
        "Le chiffre d'affaires minimum pour survivre",
        "Le montant des investissements à réaliser"
      ],
      correct_answer: 1,
      explanation: "Le BFR représente le cash bloqué dans le cycle d'exploitation : vous payez vos fournisseurs avant d'être payé par vos clients."
    },
    {
      id: 4,
      question: "Quel taux de charges sociales approximatif s'applique en Côte d'Ivoire ?",
      options: ["10% du brut", "~25% du brut", "50% du brut", "0% pour les PME"],
      correct_answer: 1,
      explanation: "En Côte d'Ivoire, les charges sociales représentent environ 25% du salaire brut (CNPS + assurances obligatoires)."
    },
    {
      id: 5,
      question: "Pourquoi un taux de croissance de 80%/an devrait-il être justifié ?",
      options: [
        "C'est un taux normal en Afrique",
        "Parce qu'un investisseur considérera ces projections irréalistes sans preuves concrètes",
        "Parce que c'est interdit par la loi",
        "Parce que les banques ne financent pas au-delà de 50%"
      ],
      correct_answer: 1,
      explanation: "Un taux de croissance > 50%/an est jugé agressif. Sans contrats signés ou preuves d'adoption, un investisseur l'écarte."
    }
  ],
  guided_questions: [
    {
      id: 1,
      section: "Infos Générales",
      question: "Quelles sont les informations générales de votre entreprise ?",
      placeholder: "Nom, forme juridique, pays, secteur, date de création, contact dirigeant...",
      help_text: "Ces informations permettent de contextualiser votre dossier pour les investisseurs.",
      example: "AGRI-TECH SARL, créée en 2019, Abidjan, CI. Secteur avicole. DG: Konan Yao, tel: +225 07 XX XX XX.",
      common_mistake: "Oublier le régime fiscal ou la devise. En Côte d'Ivoire: TVA 18%, IS 25%, devise XOF."
    },
    {
      id: 2,
      section: "Données Historiques",
      question: "Quel est votre historique financier sur les 3 dernières années ?",
      placeholder: "CA, coûts, résultats, nombre de clients et employés par année...",
      help_text: "Le CA total doit être égal à la somme des CA par produit. Le résultat = CA - coûts.",
      example: "2023: CA 120M XOF, Charges 98M, Résultat 22M, 45 clients, 12 employés. 2024: CA 180M XOF, Charges 140M.",
      common_mistake: "CA total ≠ somme des produits. Vérifiez la cohérence mathématique de chaque année."
    },
    {
      id: 3,
      section: "Produits & Services",
      question: "Listez vos produits/services avec prix unitaire, volume et marge.",
      placeholder: "Produit 1: [nom, prix, volume/mois, CA mensuel, marge %]...",
      help_text: "Volume × Prix = CA mensuel. La marge estimée doit être réaliste par rapport au secteur.",
      example: "Poulets de chair: 3 500 XOF/unité, 2 000 têtes/mois, CA 7M XOF/mois, marge 28%. Œufs: 100 XOF/unité, 30 000/mois.",
      common_mistake: "Volume × Prix ≠ CA mensuel affiché. Vérifiez le calcul."
    },
    {
      id: 4,
      section: "Ressources Humaines",
      question: "Décrivez votre équipe : postes, effectifs, salaires.",
      placeholder: "Poste: [nom, nombre, salaire brut/mois, charges sociales, total chargé]...",
      help_text: "Charges sociales ≈ 25% du brut en Côte d'Ivoire. Total chargé = Brut + Charges.",
      example: "DG: 1, 800K XOF/mois, charges 200K, total 1M. Techniciens: 3, 250K/mois, charges 62K, total 312K/personne.",
      common_mistake: "Oublier les charges sociales ou les sous-estimer."
    },
    {
      id: 5,
      section: "Hypothèses Croissance",
      question: "Quels sont vos objectifs de croissance sur 5 ans ?",
      placeholder: "CA cible N+1 à N+5, taux de croissance, marges cibles...",
      help_text: "Croissance > 50%/an nécessite des justifications concrètes (contrats, commandes, expansion).",
      example: "N+1: 250M (+39%), N+2: 340M (+36%), N+3: 440M (+29%). Marge brute cible: 35%. Marge opérationnelle: 18%.",
      common_mistake: "Projections irréalistes ('×10 en 2 ans') sans preuve de capacité d'absorption."
    },
    {
      id: 6,
      section: "Coûts Fixes & Variables",
      question: "Détaillez vos coûts fixes et variables hors RH.",
      placeholder: "Variables: [poste, montant/mois, % CA]. Fixes: [poste, montant/mois]...",
      help_text: "N'oubliez pas: assurance, maintenance, vétérinaire (aviculture), sécurité.",
      example: "Variables: Aliments 2.8M/mois (40% CA), Médicaments 350K (5%). Fixes: Loyer 500K, Électricité 280K, Assurance 150K.",
      common_mistake: "Assurance = 0, Maintenance = 0 → alerte investisseur. Ces postes doivent exister."
    },
    {
      id: 7,
      section: "BFR & Trésorerie",
      question: "Quels sont vos délais de paiement et votre trésorerie ?",
      placeholder: "DSO (jours clients), DPO (jours fournisseurs), stock moyen, trésorerie départ...",
      help_text: "DSO = jours pour être payé. DPO = jours pour payer fournisseurs. Stock = jours de stock moyen.",
      example: "DSO: 30 jours, DPO: 15 jours, Stock: 7 jours (aliments). Trésorerie départ: 8M XOF.",
      common_mistake: "DSO > 60 jours = alerte. Cela crée un besoin de trésorerie important."
    },
    {
      id: 8,
      section: "Investissements (CAPEX)",
      question: "Listez vos investissements prévus avec montant et priorité.",
      placeholder: "Investissement: [description, montant, année, amortissement, priorité]...",
      help_text: "L'amortissement est la durée sur laquelle l'investissement est comptabilisé (3-10 ans en général).",
      example: "Nouveau poulailler: 25M XOF, Année 1, amorti 10 ans, Priorité haute. Véhicule: 12M, Année 2, amorti 5 ans.",
      common_mistake: "Oublier de prioriser ou de planifier l'amortissement."
    },
    {
      id: 9,
      section: "Financement",
      question: "Quelles sont vos sources de financement actuelles et recherchées ?",
      placeholder: "Capital propre, subventions, prêts (montant, taux, durée, différé)...",
      help_text: "Détaillez chaque source: montant, conditions, statut (obtenu/en cours/recherché).",
      example: "Capital: 15M XOF. Subvention FAFCI: 10M (obtenu). Prêt bancaire: 30M, taux 9%, 5 ans, différé 6 mois (en cours).",
      common_mistake: "Confondre capital et chiffre d'affaires, ou oublier les conditions des prêts."
    }
  ]
}

// Alias pour compatibilité avec l'ancien code
export const businessModelCanvasContent = bmcContent
export const activityReportContent: ModuleContent = inputsEntrepreneurContent
export const financialAnalysisContent = inputsEntrepreneurContent

// ═══════════════════════════════════════════════════════════════════
// LEARNING MODULES — 8 MODULES SÉQUENTIELS
// ═══════════════════════════════════════════════════════════════════
export const LEARNING_MODULES: LearningModuleDefinition[] = [
  // ── MODULE 1 : BMC ──
  {
    id: 'mod_01_bmc',
    code: 'mod1_bmc',
    title: 'Business Model Canvas',
    shortTitle: 'BMC',
    slug: 'bmc',
    order: 0,
    moduleNumber: 1,
    type: 'input',
    category: 'hybrid',
    variant: 'canvas',
    icon: 'fas fa-diagram-project',
    color: '#1e3a5f',
    summary: "Cartographier les 9 blocs de votre modèle économique avec l'aide de l'IA et d'un coach.",
    learningObjectives: [
      'Comprendre les 9 blocs du Business Model Canvas',
      'Aligner proposition de valeur, segments et ressources',
      'Détecter les incohérences inter-blocs'
    ],
    dependencies: [],
    flow: {
      microLearning: {
        label: 'Micro-learning',
        description: 'Capsules éducatives pour chaque bloc du BMC avec exemples sectoriels africains.',
      },
      quiz: {
        label: 'Quiz de validation',
        description: '5 questions sur la compréhension des blocs et leurs interactions.',
      },
      inputs: {
        label: 'Saisie assistée IA',
        description: 'Remplissage bloc par bloc avec suggestions IA, exemples pré-remplis et validation temps réel.',
      },
      analysis: {
        label: 'Analyse IA',
        description: 'Score de cohérence par bloc (/10), détection incohérences inter-blocs.',
      },
      iteration: {
        label: 'Itération',
        description: 'Amélioration guidée des blocs faibles avec recommandations IA.',
      },
      validation: {
        label: 'Validation',
        description: 'Validation IA + option coaching humain pour les points de blocage.',
        optional: true,
      },
      deliverable: {
        label: 'Livrables',
        description: 'Excel BMC + HTML Diagnostic.',
        deliverables: ['Excel BMC rempli (grille 9 blocs + récap)', 'HTML Diagnostic BMC (score global, analyse par bloc, recommandations)'],
      },
    },
    outputs: [
      { format: 'xlsx', description: 'Excel BMC — Grille visuelle 9 blocs + récap' },
      { format: 'html', description: 'Diagnostic BMC — Score, analyse, recommandations' }
    ],
    downstreamFeeds: ['mod2_sic', 'mod3_inputs', 'mod4_framework', 'mod7_business_plan'],
  },

  // ── MODULE 2 : SIC ──
  {
    id: 'mod_02_sic',
    code: 'mod2_sic',
    title: 'Social Impact Canvas',
    shortTitle: 'SIC',
    slug: 'sic',
    order: 1,
    moduleNumber: 2,
    type: 'input',
    category: 'hybrid',
    variant: 'canvas',
    icon: 'fas fa-hand-holding-heart',
    color: '#059669',
    summary: "Formaliser votre impact social, mapper les ODD, et définir des indicateurs mesurables.",
    learningObjectives: [
      'Définir un impact visé clair et mesurable',
      'Identifier les bénéficiaires directs et indirects',
      'Mapper les ODD pertinents sans sur-scoring'
    ],
    dependencies: ['mod1_bmc'],
    flow: {
      microLearning: {
        label: 'Micro-learning',
        description: 'Capsules sur la mesure d\'impact, les ODD, et la différence output/outcome.',
      },
      quiz: {
        label: 'Quiz de validation',
        description: 'Questions sur output vs outcome, indicateurs SMART, et impact washing.',
      },
      inputs: {
        label: 'Saisie assistée IA',
        description: '5 sections avec vérification cohérence BMC ↔ SIC.',
      },
      analysis: {
        label: 'Analyse IA',
        description: 'Score impact /10, matrice intentionnel/mesuré/prouvé, vérification SMART.',
      },
      iteration: {
        label: 'Itération',
        description: 'Reformulation des indicateurs et suggestion d\'ODD non identifiés.',
      },
      validation: {
        label: 'Validation',
        description: 'Validation IA + option coaching humain.',
        optional: true,
      },
      deliverable: {
        label: 'Livrables',
        description: 'Excel SIC + HTML Diagnostic SIC.',
        deliverables: ['Excel SIC rempli (6 feuilles + récap visuel)', 'HTML Diagnostic SIC (score impact /10, matrice)'],
      },
    },
    outputs: [
      { format: 'xlsx', description: 'Excel SIC — 6 feuilles + récap visuel' },
      { format: 'html', description: 'Diagnostic SIC — Score impact, matrice' }
    ],
    downstreamFeeds: ['mod4_framework', 'mod7_business_plan', 'mod8_odd'],
  },

  // ── MODULE 3 : INPUTS ENTREPRENEUR ──
  {
    id: 'mod_03_inputs',
    code: 'mod3_inputs',
    title: 'Inputs Entrepreneur',
    shortTitle: 'Inputs Financiers',
    slug: 'inputs',
    order: 2,
    moduleNumber: 3,
    type: 'input',
    category: 'hybrid',
    variant: 'finance',
    icon: 'fas fa-calculator',
    color: '#d97706',
    summary: "Collecte structurée des données financières : historiques, produits, RH, hypothèses, CAPEX, financement.",
    learningObjectives: [
      'Comprendre la différence entre coûts fixes et variables',
      'Structurer des données historiques cohérentes',
      'Formuler des hypothèses de croissance réalistes'
    ],
    dependencies: ['mod1_bmc'],
    flow: {
      microLearning: {
        label: 'Micro-learning',
        description: 'Capsules claires sur les concepts financiers : coûts, marges, BFR, CAPEX.',
      },
      quiz: {
        label: 'Quiz de validation',
        description: 'Questions sur les notions financières de base et ratios clés.',
      },
      inputs: {
        label: 'Saisie assistée IA',
        description: '9 onglets : infos générales, historiques, produits, RH, hypothèses, coûts, BFR, CAPEX, financement.',
      },
      analysis: {
        label: 'Analyse IA',
        description: 'Validation mathématique, détection des données manquantes, estimation par benchmarks.',
      },
      iteration: {
        label: 'Itération',
        description: 'Correction des incohérences signalées, complétion des champs manquants.',
      },
      validation: {
        label: 'Validation',
        description: 'Validation IA obligatoire + option coaching humain (critique pour ce module).',
        optional: false,
        notes: ['Ce module est le plus CRITIQUE car les données financières sont souvent mal comprises.'],
      },
      deliverable: {
        label: 'Livrables',
        description: 'Excel Inputs validé + Rapport de validation.',
        deliverables: ['Excel Inputs validé (avec alertes intégrées)', 'Rapport de validation (incohérences, estimations IA)'],
      },
    },
    outputs: [
      { format: 'xlsx', description: 'Excel Inputs validé — Données structurées avec alertes' },
      { format: 'html', description: 'Rapport de validation — Incohérences, estimations IA' }
    ],
    downstreamFeeds: ['mod4_framework', 'mod5_diagnostic', 'mod6_ovo', 'mod7_business_plan'],
  },

  // ── MODULE 4 : FRAMEWORK ANALYSE PME ──
  {
    id: 'mod_04_framework',
    code: 'mod4_framework',
    title: 'Framework Analyse PME',
    shortTitle: 'Framework',
    slug: 'framework',
    order: 3,
    moduleNumber: 4,
    type: 'output',
    category: 'automatic',
    variant: 'auto',
    icon: 'fas fa-chart-bar',
    color: '#7c3aed',
    summary: "Modélisation financière automatique : marges, projections 5 ans, scénarios, synthèse exécutive.",
    learningObjectives: [],
    dependencies: ['mod1_bmc', 'mod2_sic', 'mod3_inputs'],
    flow: {
      microLearning: { label: '', description: '' },
      quiz: { label: '', description: '' },
      inputs: {
        label: 'Données automatiques',
        description: 'Récupération auto des données des Modules 1, 2 et 3.',
      },
      analysis: {
        label: 'Traitement IA',
        description: 'Modélisation : historiques, marges, coûts, trésorerie, projections 5 ans, scénarios.',
      },
      iteration: { label: '', description: '' },
      validation: { label: '', description: '' },
      deliverable: {
        label: 'Livrable',
        description: 'Excel Framework rempli (8 feuilles).',
        deliverables: ['Excel Framework rempli (projections + annotations IA)'],
      },
    },
    outputs: [
      { format: 'xlsx', description: 'Framework Analyse PME — 8 feuilles avec projections et alertes' }
    ],
    downstreamFeeds: ['mod5_diagnostic', 'mod6_ovo', 'mod7_business_plan'],
  },

  // ── MODULE 5 : DIAGNOSTIC EXPERT ──
  {
    id: 'mod_05_diagnostic',
    code: 'mod5_diagnostic',
    title: 'Diagnostic Expert',
    shortTitle: 'Diagnostic',
    slug: 'diagnostic',
    order: 4,
    moduleNumber: 5,
    type: 'output',
    category: 'automatic',
    variant: 'auto',
    icon: 'fas fa-stethoscope',
    color: '#dc2626',
    summary: "Rapport HTML de diagnostic expert : score de crédibilité, risques, forces/faiblesses, plan d'action.",
    learningObjectives: [],
    dependencies: ['mod1_bmc', 'mod2_sic', 'mod3_inputs', 'mod4_framework'],
    flow: {
      microLearning: { label: '', description: '' },
      quiz: { label: '', description: '' },
      inputs: {
        label: 'Données automatiques',
        description: 'Récupération auto des données des Modules 1 à 4.',
      },
      analysis: {
        label: 'Traitement IA',
        description: 'Diagnostic complet : crédibilité /20, coûts absents, risques, forces/faiblesses, plan d\'action.',
      },
      iteration: { label: '', description: '' },
      validation: { label: '', description: '' },
      deliverable: {
        label: 'Livrable',
        description: 'HTML Diagnostic Expert consultable et téléchargeable.',
        deliverables: ['HTML Diagnostic Expert (responsive, codes couleur, bouton imprimer)'],
      },
    },
    outputs: [
      { format: 'html', description: 'Diagnostic Expert — Score /20, risques, plan d\'action' }
    ],
    downstreamFeeds: ['mod6_ovo', 'mod7_business_plan'],
  },

  // ── MODULE 6 : PLAN FINANCIER OVO ──
  {
    id: 'mod_06_ovo',
    code: 'mod6_ovo',
    title: 'Plan Financier OVO',
    shortTitle: 'Plan OVO',
    slug: 'plan-ovo',
    order: 5,
    moduleNumber: 6,
    type: 'output',
    category: 'automatic',
    variant: 'auto',
    icon: 'fas fa-file-excel',
    color: '#0284c7',
    summary: "Template financier OVO 8 ans : revenus par produit, P&L, cash-flow, financement.",
    learningObjectives: [],
    dependencies: ['mod3_inputs', 'mod4_framework', 'mod5_diagnostic'],
    flow: {
      microLearning: { label: '', description: '' },
      quiz: { label: '', description: '' },
      inputs: {
        label: 'Données automatiques',
        description: 'Récupération auto des données des Modules 3 à 5.',
      },
      analysis: {
        label: 'Traitement IA',
        description: 'Remplissage du template OVO : InputsData, RevenueData, FinanceData.',
      },
      iteration: { label: '', description: '' },
      validation: { label: '', description: '' },
      deliverable: {
        label: 'Livrable',
        description: 'Plan Financier OVO rempli (.xlsm).',
        deliverables: ['Plan Financier OVO rempli (.xlsm)'],
      },
    },
    outputs: [
      { format: 'xlsm', description: 'Plan Financier OVO — Template 8 ans rempli' }
    ],
    downstreamFeeds: ['mod7_business_plan'],
  },

  // ── MODULE 7 : BUSINESS PLAN ──
  {
    id: 'mod_07_bp',
    code: 'mod7_business_plan',
    title: 'Business Plan',
    shortTitle: 'Business Plan',
    slug: 'business-plan',
    order: 6,
    moduleNumber: 7,
    type: 'output',
    category: 'automatic',
    variant: 'auto',
    icon: 'fas fa-file-word',
    color: '#2563eb',
    summary: "Document Word complet : executive summary, présentation, opérations, projet financier.",
    learningObjectives: [],
    dependencies: ['mod1_bmc', 'mod2_sic', 'mod3_inputs', 'mod4_framework', 'mod5_diagnostic', 'mod6_ovo'],
    flow: {
      microLearning: { label: '', description: '' },
      quiz: { label: '', description: '' },
      inputs: {
        label: 'Données automatiques',
        description: 'Consolidation de toutes les données des Modules 1 à 6.',
      },
      analysis: {
        label: 'Traitement IA',
        description: 'Rédaction automatique du BP : résumé exécutif, SWOT, 5P, impact, financier.',
      },
      iteration: { label: '', description: '' },
      validation: { label: '', description: '' },
      deliverable: {
        label: 'Livrable',
        description: 'Business Plan complet (.docx) — max 20 pages.',
        deliverables: ['Business Plan (.docx) — max 20 pages'],
      },
    },
    outputs: [
      { format: 'docx', description: 'Business Plan — Document Word prêt pour comité' }
    ],
    downstreamFeeds: [],
  },

  // ── MODULE 8 : ODD ──
  {
    id: 'mod_08_odd',
    code: 'mod8_odd',
    title: 'Évaluation ODD',
    shortTitle: 'ODD',
    slug: 'odd',
    order: 7,
    moduleNumber: 8,
    type: 'output',
    category: 'automatic',
    variant: 'auto',
    icon: 'fas fa-globe-africa',
    color: '#059669',
    summary: "Évaluation des 40 cibles ODD pré-sélectionnées avec scoring et indicateurs d'impact.",
    learningObjectives: [],
    dependencies: ['mod2_sic', 'mod7_business_plan'],
    flow: {
      microLearning: { label: '', description: '' },
      quiz: { label: '', description: '' },
      inputs: {
        label: 'Données automatiques',
        description: 'Récupération des données SIC (Module 2) et Business Plan (Module 7).',
      },
      analysis: {
        label: 'Traitement IA',
        description: 'Évaluation 40 cibles ODD, scoring 0-3, justifications, indicateurs d\'impact.',
      },
      iteration: { label: '', description: '' },
      validation: { label: '', description: '' },
      deliverable: {
        label: 'Livrable',
        description: 'ODD Template rempli (.xlsx).',
        deliverables: ['ODD Template rempli (.xlsx) — 5 feuilles'],
      },
    },
    outputs: [
      { format: 'xlsx', description: 'ODD Template — Évaluation, indicateurs, aperçu' }
    ],
    downstreamFeeds: [],
  },
]

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

export const LEARNING_STAGE_SEQUENCE: LearningStageKey[] = [
  'microLearning',
  'quiz',
  'inputs',
  'analysis',
  'iteration',
  'validation',
  'deliverable',
]

const LEARNING_MODULE_MAP = new Map<string, LearningModuleDefinition>(
  LEARNING_MODULES.map((module) => [module.code, module])
)

export const listLearningModules = (type?: LearningModuleDefinition['type']) => {
  const modules = type
    ? LEARNING_MODULES.filter((module) => module.type === type)
    : [...LEARNING_MODULES]
  return modules.sort((a, b) => a.order - b.order)
}

export const getHybridModules = () =>
  LEARNING_MODULES.filter((m) => m.category === 'hybrid').sort((a, b) => a.order - b.order)

export const getAutomaticModules = () =>
  LEARNING_MODULES.filter((m) => m.category === 'automatic').sort((a, b) => a.order - b.order)

export const getLearningModuleDefinition = (moduleCode: string): LearningModuleDefinition | null => {
  return LEARNING_MODULE_MAP.get(moduleCode) ?? null
}

export const getLearningStageKeysForModule = (moduleCode: string): LearningStageKey[] => {
  const definition = getLearningModuleDefinition(moduleCode)
  if (!definition) {
    return [...LEARNING_STAGE_SEQUENCE]
  }

  // Pour les modules automatiques, ne garder que inputs, analysis, deliverable
  if (definition.category === 'automatic') {
    return ['inputs', 'analysis', 'deliverable']
  }

  return LEARNING_STAGE_SEQUENCE.filter((stage) => definition.flow?.[stage])
}

export const MODULE_CONTENTS_BY_CODE: Record<string, ModuleContent> = {
  mod1_bmc: bmcContent,
  mod2_sic: sicContent,
  mod3_inputs: inputsEntrepreneurContent,
  // Compatibilité anciens codes
  step1_business_model: bmcContent,
  step1_activity_report: inputsEntrepreneurContent,
  step2_financial_analysis: inputsEntrepreneurContent
}

export const getModuleContentByCode = (moduleCode: string): ModuleContent | null => {
  return MODULE_CONTENTS_BY_CODE[moduleCode] ?? null
}

export const getModuleVariant = (moduleCode: string): ModuleVariant => {
  const definition = getLearningModuleDefinition(moduleCode)
  if (definition?.variant) {
    return definition.variant
  }
  return 'canvas'
}

export const getStageRouteForModule = (moduleCode: string, stage: LearningStageKey): string => {
  const definition = getLearningModuleDefinition(moduleCode)

  // Modules automatiques ont un flow simplifié
  if (definition?.category === 'automatic') {
    switch (stage) {
      case 'inputs':
        return `/module/${moduleCode}/overview`
      case 'analysis':
        return `/module/${moduleCode}/generate`
      case 'deliverable':
        return `/module/${moduleCode}/download`
      default:
        return `/module/${moduleCode}/overview`
    }
  }

  // Modules hybrides
  const variant = getModuleVariant(moduleCode)

  switch (stage) {
    case 'microLearning':
      return `/module/${moduleCode}/video`
    case 'quiz':
      return `/module/${moduleCode}/quiz`
    case 'inputs':
      return variant === 'finance'
        ? `/module/${moduleCode}/inputs`
        : `/module/${moduleCode}/questions`
    case 'analysis':
      return `/module/${moduleCode}/analysis`
    case 'iteration':
      return `/module/${moduleCode}/improve`
    case 'validation':
      return `/module/${moduleCode}/validate`
    case 'deliverable':
    default:
      return `/module/${moduleCode}/download`
  }
}

export const getGuidedQuestionsForModule = (moduleCode: string): GuidedQuestion[] => {
  const content = MODULE_CONTENTS_BY_CODE[moduleCode]
  return content?.guided_questions ?? bmcContent.guided_questions ?? []
}

export const isModuleUnlocked = (moduleCode: string, completedModules: Set<string>): boolean => {
  const definition = getLearningModuleDefinition(moduleCode)
  if (!definition) return false
  if (definition.dependencies.length === 0) return true
  return definition.dependencies.every((dep) => completedModules.has(dep))
}

export const getModuleDeliverables = (moduleCode: string): LearningModuleOutputSpec[] => {
  const definition = getLearningModuleDefinition(moduleCode)
  return definition?.outputs ?? []
}

export const getAllDeliverables = (): { moduleCode: string; moduleTitle: string; moduleNumber: number; outputs: LearningModuleOutputSpec[] }[] => {
  return LEARNING_MODULES
    .filter((m) => m.outputs.length > 0)
    .sort((a, b) => a.order - b.order)
    .map((m) => ({
      moduleCode: m.code,
      moduleTitle: m.title,
      moduleNumber: m.moduleNumber,
      outputs: m.outputs
    }))
}
