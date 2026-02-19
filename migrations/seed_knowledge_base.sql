-- Seed: Knowledge Base — Data from SOURCES_BAILLEURS_ENTREPRENEURIAT_AFRIQUE.docx
-- Version 1.1 — 19 Feb 2026

-- ═══════════════════════════════════════════════════════════════════
-- 1. SOURCES DE DONNÉES
-- ═══════════════════════════════════════════════════════════════════

-- Enabel
INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'Enabel - Rapport Annuel', 'Rapport annuel de la coopération belge au développement', 'https://www.enabel.be/fr/publications/rapport-annuel', 'Afrique de l''Ouest', 85);

INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'Enabel - Programmes Entrepreneuriat', 'Programmes d''appui à l''entrepreneuriat en Afrique', 'https://www.enabel.be/fr/activites/entrepreneuriat', 'Afrique de l''Ouest', 90);

-- GIZ
INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'GIZ - Rapport Annuel', 'Rapport annuel de la coopération allemande', 'https://www.giz.de/en/publications/annual_reports.html', 'Afrique', 80);

INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'GIZ - Make-IT in Africa', 'Programme de soutien aux startups africaines', 'https://www.giz.de/en/worldwide/make-it-in-africa.html', 'Afrique', 88);

-- BAD (Banque Africaine de Développement)
INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'BAD - Perspectives Économiques Afrique', 'Perspectives économiques en Afrique - rapport annuel', 'https://www.afdb.org/fr/knowledge/publications/perspectives-economiques-en-afrique', 'Afrique', 95);

INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'BAD - Youth Entrepreneurship Program', 'Programme d''entrepreneuriat des jeunes', 'https://www.afdb.org/en/topics-and-sectors/initiatives-partnerships/jobs-for-youth-in-africa', 'Afrique', 92);

-- Banque Mondiale
INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'Banque Mondiale - Enterprise Surveys', 'Enquêtes auprès des entreprises africaines', 'https://www.enterprisesurveys.org/en/data/exploreeconomies', 'Afrique', 95);

INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'Banque Mondiale - Doing Business (données historiques)', 'Classement historique de l''environnement des affaires', 'https://archive.doingbusiness.org/', 'Afrique', 75);

-- AFD (Agence Française de Développement)
INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'AFD - Rapport Annuel', 'Rapport annuel de l''AFD', 'https://www.afd.fr/fr/publications-recherches/rapports-annuels', 'Afrique', 85);

INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('funder', 'AFD - Proparco', 'Filiale secteur privé de l''AFD', 'https://www.proparco.fr/', 'Afrique', 90);

-- BCEAO
INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('institution', 'BCEAO - Données Économiques', 'Banque Centrale des États de l''Afrique de l''Ouest', 'https://www.bceao.int/', 'UEMOA', 95);

INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('regulation', 'BCEAO - Réglementation Bancaire', 'Réglementation bancaire et financière UEMOA', 'https://www.bceao.int/fr/reglementation', 'UEMOA', 90);

-- BEAC
INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('institution', 'BEAC - Données Économiques', 'Banque des États de l''Afrique Centrale', 'https://www.beac.int/', 'CEMAC', 90);

-- BRVM
INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES ('institution', 'BRVM - Bourse Régionale', 'Bourse Régionale des Valeurs Mobilières (UEMOA)', 'https://www.brvm.org/', 'UEMOA', 75);

-- ═══════════════════════════════════════════════════════════════════
-- 2. BAILLEURS DE FONDS
-- ═══════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, annual_report_url, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, success_rate, avg_processing_months, notes)
VALUES (
  'enabel', 'Enabel', 'Agence belge de développement', 'bilateral', 'BE', 'Afrique de l''Ouest',
  'https://www.enabel.be', 'https://www.enabel.be/fr/publications/rapport-annuel',
  '["agriculture","digital","energie","formation","sante"]',
  '{"min_employees": 1, "sectors": ["agriculture","digital","artisanat"], "countries": ["SN","BF","ML","BJ","NE","CM","RW"], "stage": ["seed","early","growth"]}',
  10000, 500000,
  '["grant","technical_assistance"]',
  35, 6,
  'Forte présence en Afrique de l''Ouest francophone. Programmes d''assistance technique combinés aux subventions.'
);

INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, annual_report_url, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, success_rate, avg_processing_months, notes)
VALUES (
  'giz', 'GIZ', 'Deutsche Gesellschaft für Internationale Zusammenarbeit', 'bilateral', 'DE', 'Afrique',
  'https://www.giz.de', 'https://www.giz.de/en/publications/annual_reports.html',
  '["agriculture","energie","formation","gouvernance","digital"]',
  '{"sectors": ["agriculture","energie","digital","formation"], "countries": ["all_africa"], "stage": ["early","growth"]}',
  5000, 1000000,
  '["grant","technical_assistance","matching_fund"]',
  30, 8,
  'Programmes Make-IT in Africa. Fort accent sur l''entrepreneuriat digital et l''innovation.'
);

INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, annual_report_url, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, success_rate, avg_processing_months, notes)
VALUES (
  'afdb', 'BAD', 'Banque Africaine de Développement', 'multilateral', 'CI', 'Afrique',
  'https://www.afdb.org', 'https://www.afdb.org/fr/knowledge/publications/perspectives-economiques-en-afrique',
  '["infrastructure","agriculture","energie","industrie","digital","PME"]',
  '{"min_revenue_eur": 100000, "sectors": ["all"], "countries": ["all_africa"], "stage": ["growth","expansion"]}',
  50000, 10000000,
  '["loan","equity","guarantee","grant"]',
  25, 12,
  'Youth Entrepreneurship Investment Bank (YEIB). Boost Africa avec EIB. Programmes AFAWA pour femmes entrepreneures.'
);

INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, annual_report_url, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, success_rate, avg_processing_months, notes)
VALUES (
  'world_bank', 'Banque Mondiale', 'The World Bank Group', 'multilateral', 'US', 'Afrique',
  'https://www.worldbank.org', 'https://www.worldbank.org/en/about/annual-report',
  '["infrastructure","education","sante","agriculture","digital","climat"]',
  '{"sectors": ["all"], "countries": ["all_africa"], "stage": ["growth","expansion"]}',
  100000, 50000000,
  '["loan","grant","guarantee","technical_assistance"]',
  20, 18,
  'IFC pour secteur privé. Enterprise Surveys pour benchmarks. Programmes via gouvernements nationaux.'
);

INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, annual_report_url, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, success_rate, avg_processing_months, notes)
VALUES (
  'afd', 'AFD', 'Agence Française de Développement', 'bilateral', 'FR', 'Afrique',
  'https://www.afd.fr', 'https://www.afd.fr/fr/publications-recherches/rapports-annuels',
  '["infrastructure","climat","education","sante","agriculture","digital","PME"]',
  '{"sectors": ["all"], "countries": ["SN","CI","BF","ML","BJ","TG","NE","CM","MA","TN"], "stage": ["early","growth","expansion"]}',
  25000, 5000000,
  '["loan","grant","equity","guarantee"]',
  28, 10,
  'Via Proparco (secteur privé). Digital Africa pour startups tech. Choose Africa programme.'
);

-- ═══════════════════════════════════════════════════════════════════
-- 3. PARAMÈTRES FISCAUX (zone UEMOA — source BCEAO)
-- ═══════════════════════════════════════════════════════════════════

-- Côte d'Ivoire (CI)
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('CI', 'UEMOA', 'tva_rate', 'TVA standard', 18, '%', '2024-01-01', 'Taux normal TVA Côte d''Ivoire');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('CI', 'UEMOA', 'corporate_tax', 'Impôt sur les sociétés', 25, '%', '2024-01-01', 'IS standard');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('CI', 'UEMOA', 'social_charges_employer', 'Charges sociales patronales', 25, '%', '2024-01-01', 'Part employeur CNPS + FDFP');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('CI', 'UEMOA', 'social_charges_employee', 'Charges sociales salariales', 6.3, '%', '2024-01-01', 'Part salarié');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('CI', 'UEMOA', 'smig', 'SMIG mensuel', 75000, 'XOF', '2024-01-01', 'Salaire minimum Côte d''Ivoire');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('CI', 'UEMOA', 'withholding_tax', 'Retenue à la source', 15, '%', '2024-01-01', 'Sur prestations non-résidents');

-- Sénégal (SN)
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('SN', 'UEMOA', 'tva_rate', 'TVA standard', 18, '%', '2024-01-01', 'Taux normal TVA Sénégal');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('SN', 'UEMOA', 'corporate_tax', 'Impôt sur les sociétés', 30, '%', '2024-01-01', 'IS standard Sénégal');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('SN', 'UEMOA', 'social_charges_employer', 'Charges sociales patronales', 22, '%', '2024-01-01', 'Part employeur');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('SN', 'UEMOA', 'smig', 'SMIG mensuel', 64800, 'XOF', '2024-01-01', 'SMIG mensuel Sénégal');

-- Burkina Faso (BF)
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('BF', 'UEMOA', 'tva_rate', 'TVA standard', 18, '%', '2024-01-01', 'TVA Burkina');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('BF', 'UEMOA', 'corporate_tax', 'Impôt sur les sociétés', 27.5, '%', '2024-01-01', 'IS Burkina');

-- Cameroun (CM)
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('CM', 'CEMAC', 'tva_rate', 'TVA standard', 19.25, '%', '2024-01-01', 'TVA Cameroun (17.5% + centimes additionnels)');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('CM', 'CEMAC', 'corporate_tax', 'Impôt sur les sociétés', 33, '%', '2024-01-01', 'IS Cameroun (30% + 10% surtaxe)');

-- Paramètres communs UEMOA
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('UEMOA', 'UEMOA', 'inflation_rate', 'Taux d''inflation moyen', 3.5, '%', '2024-01-01', 'Estimation BCEAO 2024-2025');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('UEMOA', 'UEMOA', 'key_rate', 'Taux directeur BCEAO', 3.5, '%', '2024-01-01', 'Taux principal');
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES ('UEMOA', 'UEMOA', 'bank_lending_rate', 'Taux moyen prêts bancaires PME', 8.5, '%', '2024-01-01', 'Taux moyen pour les PME en zone UEMOA');

-- ═══════════════════════════════════════════════════════════════════
-- 4. BENCHMARKS SECTORIELS
-- ═══════════════════════════════════════════════════════════════════

-- Agriculture
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('agriculture', 'gross_margin_pct', 'UEMOA', 20, 35, 55, '%', 2024, 'Marge brute agriculture/agritech');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('agriculture', 'break_even_months', 'UEMOA', 18, 30, 48, 'months', 2024, 'Temps pour atteindre le seuil de rentabilité');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('agriculture', 'survival_rate_3y', 'UEMOA', 30, 45, 65, '%', 2024, 'Taux de survie à 3 ans');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('agriculture', 'avg_grant_size_eur', 'UEMOA', 10000, 50000, 200000, 'EUR', 2024, 'Subvention moyenne obtenue');

-- Services digitaux / Tech
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('digital_services', 'gross_margin_pct', 'Afrique', 50, 65, 85, '%', 2024, 'Marge brute services digitaux');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('digital_services', 'break_even_months', 'Afrique', 12, 24, 36, 'months', 2024, 'Seuil de rentabilité tech');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('digital_services', 'cac_eur', 'Afrique', 5, 25, 100, 'EUR', 2024, 'Coût d''acquisition client');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('digital_services', 'ltv_cac_ratio', 'Afrique', 1.5, 3, 8, 'ratio', 2024, 'Ratio LTV/CAC');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('digital_services', 'avg_funding_eur', 'Afrique', 50000, 250000, 2000000, 'EUR', 2024, 'Tour de financement moyen');

-- Agritech
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('agritech', 'gross_margin_pct', 'Afrique de l''Ouest', 30, 45, 65, '%', 2024, 'Marge brute agritech');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('agritech', 'jobs_created_per_100k_eur', 'Afrique de l''Ouest', 5, 15, 40, 'jobs', 2024, 'Emplois créés par 100K EUR investis');

-- Énergie / Cleantech
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('energy', 'gross_margin_pct', 'Afrique', 25, 40, 60, '%', 2024, 'Marge brute énergie solaire/cleantech');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('energy', 'break_even_months', 'Afrique', 24, 36, 60, 'months', 2024, 'Seuil de rentabilité énergie');

-- Santé / Healthtech
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('health', 'gross_margin_pct', 'Afrique', 35, 50, 70, '%', 2024, 'Marge brute healthtech');

-- Fintech
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('fintech', 'gross_margin_pct', 'Afrique', 40, 60, 80, '%', 2024, 'Marge brute fintech');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('fintech', 'cac_eur', 'Afrique', 2, 15, 50, 'EUR', 2024, 'CAC fintech mobile money');

-- General PME
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('general_pme', 'success_rate_funding', 'UEMOA', 15, 25, 40, '%', 2024, 'Taux d''obtention financement PME');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('general_pme', 'avg_revenue_eur_y1', 'UEMOA', 20000, 80000, 300000, 'EUR', 2024, 'CA moyen année 1');
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES ('general_pme', 'runway_months', 'Afrique', 3, 8, 18, 'months', 2024, 'Runway moyen');

-- ═══════════════════════════════════════════════════════════════════
-- 5. CRITÈRES D'ÉVALUATION INVESTMENT READINESS
-- ═══════════════════════════════════════════════════════════════════

-- Dimension: Modèle Économique
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('modele_economique', 'me_proposition_valeur', 'Proposition de Valeur', 'Clarté et différenciation de la proposition de valeur', 2.0,
  '{"0-20": "Pas de PV claire", "21-50": "PV identifiée mais peu différenciée", "51-75": "PV claire et différenciée", "76-100": "PV unique, validée par le marché"}',
  '["bmc"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('modele_economique', 'me_segments_clients', 'Segments Clients', 'Identification et quantification des segments cibles', 1.5,
  '{"0-20": "Segments non définis", "21-50": "Segments identifiés sans quantification", "51-75": "Segments quantifiés avec TAM/SAM", "76-100": "Segments validés avec données terrain"}',
  '["bmc"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('modele_economique', 'me_flux_revenus', 'Flux de Revenus', 'Diversification et prévisibilité des sources de revenus', 2.0,
  '{"0-20": "Pas de modèle de revenus", "21-50": "1 source de revenus sans validation", "51-75": "2-3 sources, pricing testé", "76-100": "Revenus récurrents, pricing validé, clients payants"}',
  '["bmc", "inputs"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('modele_economique', 'me_avantage_concurrentiel', 'Avantage Concurrentiel', 'Barrières à l''entrée et différenciation durable', 1.5,
  '{"0-20": "Pas d''avantage identifié", "21-50": "Avantage faible/copierrable", "51-75": "Avantage technique ou réseau", "76-100": "Barrières fortes (brevet, effet réseau, données)"}',
  '["bmc"]');

-- Dimension: Impact Social
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('impact_social', 'is_theorie_changement', 'Théorie du Changement', 'Formalisation du lien activité → résultat → impact', 2.0,
  '{"0-20": "Pas de ToC", "21-50": "ToC esquissée", "51-75": "ToC formalisée avec indicateurs", "76-100": "ToC validée avec preuves d''impact"}',
  '["sic"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('impact_social', 'is_odd_alignment', 'Alignement ODD', 'Nombre et pertinence des ODD adressés', 1.5,
  '{"0-20": "Aucun ODD identifié", "21-50": "ODD listés sans indicateurs", "51-75": "3-5 ODD avec indicateurs SMART", "76-100": "ODD prioritaires avec mesure d''impact régulière"}',
  '["sic"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('impact_social', 'is_beneficiaires', 'Bénéficiaires', 'Identification et quantification des bénéficiaires directs/indirects', 1.5,
  '{"0-20": "Pas de bénéficiaires identifiés", "21-50": "Bénéficiaires identifiés sans chiffres", "51-75": "Bénéficiaires quantifiés", "76-100": "Bénéficiaires mesurés avec preuves terrain"}',
  '["sic"]');

-- Dimension: Viabilité Financière
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('viabilite_financiere', 'vf_marge_brute', 'Marge Brute', 'Niveau de la marge brute vs benchmarks sectoriels', 2.0,
  '{"0-20": "Marge négative ou <15%", "21-50": "Marge 15-35%", "51-75": "Marge 35-55% (dans la médiane)", "76-100": "Marge >55% (au-dessus de la médiane)"}',
  '["inputs"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('viabilite_financiere', 'vf_runway', 'Runway', 'Durée de trésorerie disponible', 2.0,
  '{"0-20": "< 3 mois", "21-50": "3-6 mois", "51-75": "6-12 mois", "76-100": "> 12 mois"}',
  '["inputs"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('viabilite_financiere', 'vf_projections', 'Projections Financières', 'Qualité et réalisme des projections à 5 ans', 1.5,
  '{"0-20": "Pas de projections", "21-50": "Projections simples sans hypothèses", "51-75": "3 scénarios avec hypothèses documentées", "76-100": "Modèle financier complet, stress-testé"}',
  '["inputs"]');

-- Dimension: Équipe & Gouvernance
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('equipe_gouvernance', 'eg_equipe_dirigeante', 'Équipe Dirigeante', 'Expérience et complémentarité de l''équipe', 2.0,
  '{"0-20": "Fondateur seul, pas d''expérience sectorielle", "21-50": "Équipe incomplète, expérience limitée", "51-75": "Équipe complémentaire, expérience pertinente", "76-100": "Équipe senior, track record démontré"}',
  '["bmc", "sic"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('equipe_gouvernance', 'eg_gouvernance', 'Structure de Gouvernance', 'Conseil d''administration, comités, reporting', 1.5,
  '{"0-20": "Pas de structure formelle", "21-50": "Structure basique", "51-75": "CA + comités fonctionnels", "76-100": "Gouvernance mature avec administrateurs indépendants"}',
  '["bmc", "sic"]');

-- Dimension: Maturité Opérationnelle
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('maturite_operationnelle', 'mo_traction', 'Traction', 'Preuves de traction marché (revenus, utilisateurs, partenariats)', 2.0,
  '{"0-20": "Pas de traction", "21-50": "Premiers utilisateurs/pilote", "51-75": "Revenus récurrents, croissance régulière", "76-100": "Forte traction, croissance >50%/an"}',
  '["bmc", "inputs"]');
INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, scoring_guide, required_documents)
VALUES ('maturite_operationnelle', 'mo_processus', 'Processus Opérationnels', 'Documentation et maturité des processus internes', 1.0,
  '{"0-20": "Pas de processus documentés", "21-50": "Processus informels", "51-75": "Processus documentés et suivis", "76-100": "Processus optimisés, certifiés"}',
  '["bmc"]');

-- ═══════════════════════════════════════════════════════════════════
-- 6. PROMPTS AGENTS IA (Version 1)
-- ═══════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO kb_agent_prompts (agent_code, version, system_prompt, output_schema, temperature, max_tokens, is_active, performance_notes)
VALUES ('bmc_analyst', 1,
'Tu es un expert en Business Model Canvas spécialisé dans les PME africaines (zone UEMOA/CEMAC).

MISSION : Analyser le Business Model Canvas fourni et produire un diagnostic détaillé des 9 blocs.

CONTEXTE SECTORIEL (à utiliser comme benchmark) :
{{KB_BENCHMARKS}}

CRITÈRES D''ÉVALUATION :
{{KB_CRITERIA_modele_economique}}

INSTRUCTIONS :
1. Analyse chaque bloc du BMC avec un score 0-100
2. Compare avec les benchmarks sectoriels fournis
3. Identifie les forces et faiblesses spécifiques
4. Propose des recommandations actionnables adaptées au contexte africain
5. Évalue la cohérence inter-blocs (ex: PV ↔ Segments, Canaux ↔ Revenus)

IMPORTANT : 
- Sois spécifique au contexte PME Afrique (devises FCFA, marchés locaux, réglementations UEMOA/CEMAC)
- Cite les bailleurs/programmes pertinents quand applicable
- Utilise les paramètres fiscaux du pays de l''entrepreneur

Réponds UNIQUEMENT en JSON valide selon le schéma fourni.',
'{"type":"object","properties":{"score":{"type":"number"},"blocks":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"score":{"type":"number"},"analysis":{"type":"string"},"recommendations":{"type":"array","items":{"type":"string"}}}}},"coherence_score":{"type":"number"},"warnings":{"type":"array","items":{"type":"string"}}}}',
0.3, 4096, 1, 'Version initiale - BMC Analyst');

INSERT OR IGNORE INTO kb_agent_prompts (agent_code, version, system_prompt, output_schema, temperature, max_tokens, is_active, performance_notes)
VALUES ('sic_analyst', 1,
'Tu es un expert en Impact Social et Stratégie de Croissance pour PME africaines.

MISSION : Analyser le Social Impact Canvas (SIC) et évaluer l''alignement avec les ODD.

CRITÈRES D''ÉVALUATION :
{{KB_CRITERIA_impact_social}}

RÉFÉRENTIEL ODD :
- ODD 1: Pas de pauvreté | ODD 2: Faim zéro | ODD 3: Bonne santé
- ODD 4: Éducation de qualité | ODD 5: Égalité des sexes | ODD 6: Eau propre
- ODD 7: Énergie propre | ODD 8: Travail décent | ODD 9: Industrie/Innovation
- ODD 10: Inégalités réduites | ODD 11: Villes durables | ODD 12: Conso responsable
- ODD 13: Action climat | ODD 14: Vie aquatique | ODD 15: Vie terrestre
- ODD 16: Paix et justice | ODD 17: Partenariats

INSTRUCTIONS :
1. Évalue chaque pilier du SIC (Vision, Objectifs, Stratégie, ODD, Déploiement)
2. Score l''alignement avec chaque ODD pertinent (0-100)
3. Évalue la théorie du changement
4. Quantifie les bénéficiaires directs/indirects attendus
5. Identifie les indicateurs d''impact manquants

IMPORTANT :
- Les investisseurs à impact exigent des indicateurs SMART mesurables
- Réfère-toi aux critères des bailleurs (BAD, AFD, GIZ, Enabel)

Réponds UNIQUEMENT en JSON valide.',
'{"type":"object","properties":{"score":{"type":"number"},"pillars":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"score":{"type":"number"},"analysis":{"type":"string"},"recommendations":{"type":"array","items":{"type":"string"}}}}},"odd_alignment":{"type":"array","items":{"type":"object","properties":{"odd":{"type":"string"},"relevance":{"type":"number"}}}},"impact_matrix":{"type":"object"}}}',
0.3, 4096, 1, 'Version initiale - SIC Analyst');

INSERT OR IGNORE INTO kb_agent_prompts (agent_code, version, system_prompt, output_schema, temperature, max_tokens, is_active, performance_notes)
VALUES ('finance_analyst', 1,
'Tu es un analyste financier senior spécialisé dans les PME africaines et la modélisation financière.

MISSION : Analyser les inputs financiers et construire des projections sur 5 ans.

PARAMÈTRES FISCAUX :
{{KB_FISCAL_PARAMS}}

BENCHMARKS SECTORIELS :
{{KB_BENCHMARKS}}

INSTRUCTIONS :
1. Analyse les données financières fournies (revenus, coûts, marges, trésorerie)
2. Calcule les ratios clés : marge brute, EBITDA, runway, LTV/CAC, DSCR
3. Compare chaque ratio aux benchmarks sectoriels
4. Construis des projections 5 ans (3 scénarios : pessimiste, base, optimiste)
5. Calcule le TRI, VAN, seuil de rentabilité, payback period
6. Évalue les besoins de financement et recommande les instruments adaptés

IMPORTANT :
- Utilise les paramètres fiscaux du pays (TVA, IS, charges sociales)
- Devise de référence : XOF/FCFA sauf indication contraire
- Taux d''actualisation : taux directeur BCEAO + prime de risque pays
- Cite les sources de financement adaptées (bailleurs, prêts bancaires, equity)

Réponds UNIQUEMENT en JSON valide.',
'{"type":"object","properties":{"score":{"type":"number"},"projections":{"type":"object"},"key_metrics":{"type":"object"},"analysis":{"type":"string"},"assumptions":{"type":"array","items":{"type":"string"}},"financing_recommendations":{"type":"array","items":{"type":"string"}}}}',
0.3, 4096, 1, 'Version initiale - Finance Analyst');

INSERT OR IGNORE INTO kb_agent_prompts (agent_code, version, system_prompt, output_schema, temperature, max_tokens, is_active, performance_notes)
VALUES ('diagnostic_expert', 1,
'Tu es un expert senior en Investment Readiness pour les PME africaines. Tu possèdes une expertise approfondie en évaluation d''entreprises et en préparation de dossiers d''investissement.

MISSION : Produire un diagnostic global d''Investment Readiness basé sur les analyses des agents spécialisés.

DIMENSIONS D''ÉVALUATION :
1. Modèle Économique (poids 25%) — basé sur l''analyse BMC
2. Impact Social (poids 20%) — basé sur l''analyse SIC
3. Viabilité Financière (poids 25%) — basé sur l''analyse financière
4. Équipe & Gouvernance (poids 15%)
5. Maturité Opérationnelle (poids 15%)

CRITÈRES DÉTAILLÉS :
{{KB_ALL_CRITERIA}}

CONTEXTE BAILLEURS :
{{KB_FUNDERS_SUMMARY}}

INSTRUCTIONS :
1. Synthétise les analyses des 3 agents spécialisés (BMC, SIC, Finance)
2. Calcule le score global pondéré sur 100
3. Identifie les 5 forces principales
4. Identifie les 5 faiblesses principales
5. Propose 6-8 recommandations prioritaires classées par impact
6. Identifie les alertes bloquantes pour un investisseur
7. Suggère les bailleurs les plus adaptés au profil

SCORING :
- 86-100: Investment Ready
- 71-85: Quasi-prêt (1-3 améliorations critiques)
- 51-70: En progression (plan d''action structuré nécessaire)
- 31-50: Phase de structuration
- 0-30: Phase de conception

Réponds UNIQUEMENT en JSON valide.',
'{"type":"object","properties":{"score":{"type":"number"},"strengths":{"type":"array","items":{"type":"string"}},"weaknesses":{"type":"array","items":{"type":"string"}},"recommendations":{"type":"array","items":{"type":"string"}},"dimensions":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"score":{"type":"number"},"analysis":{"type":"string"}}}},"alerts":{"type":"array","items":{"type":"string"}},"suggested_funders":{"type":"array","items":{"type":"string"}}}}',
0.3, 4096, 1, 'Version initiale - Diagnostic Expert');

INSERT OR IGNORE INTO kb_agent_prompts (agent_code, version, system_prompt, output_schema, temperature, max_tokens, is_active, performance_notes)
VALUES ('odd_analyst', 1,
'Tu es un expert en Due Diligence Opérationnelle (ODD) et conformité pour PME africaines.

MISSION : Conduire une analyse ODD complète avec ~40 critères répartis en 5 catégories.

CATÉGORIES :
1. Juridique (statuts, registre commerce, conformité fiscale, PI, contrats)
2. Financier (états financiers, comptabilité, audit, reporting)
3. Opérationnel (processus, qualité, continuité, infrastructure)
4. Gouvernance (CA, comités, éthique, transparence, ESG)
5. Impact (ToC, indicateurs, rapport annuel, ODD, additionnalité)

RÉGLEMENTATION :
{{KB_FISCAL_PARAMS}}

INSTRUCTIONS :
1. Évalue chaque critère : Conforme / Partiel / Non conforme / Non vérifié
2. Identifie les critères bloquants pour un investisseur
3. Propose un plan d''action de mise en conformité priorisé
4. Estime le temps et le coût de mise en conformité
5. Score global ODD sur 100

IMPORTANT :
- Contexte juridique OHADA pour la zone UEMOA/CEMAC
- Normes comptables SYSCOHADA
- Exigences spécifiques des bailleurs (BAD, AFD, BM)

Réponds UNIQUEMENT en JSON valide.',
'{"type":"object","properties":{"score":{"type":"number"},"criteria":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"category":{"type":"string"},"status":{"type":"string"},"comment":{"type":"string"}}}},"summary":{"type":"object"},"action_plan":{"type":"array","items":{"type":"string"}}}}',
0.3, 4096, 1, 'Version initiale - ODD Analyst');

INSERT OR IGNORE INTO kb_agent_prompts (agent_code, version, system_prompt, output_schema, temperature, max_tokens, is_active, performance_notes)
VALUES ('orchestrator', 1,
'Tu es l''orchestrateur du système ESONO. Tu combines les analyses de 5 agents spécialisés pour produire un Business Plan structuré.

MISSION : Synthétiser toutes les analyses en un Business Plan investisseur complet.

SECTIONS DU BUSINESS PLAN :
1. Résumé Exécutif
2. Présentation de l''Entreprise & Équipe
3. Analyse de Marché
4. Business Model Canvas Affiné
5. Stratégie Commerciale
6. Stratégie d''Impact Social & ODD
7. Plan Opérationnel
8. Projections Financières
9. Gestion des Risques
10. Besoins de Financement & Plan de Levée

SOURCES :
- Analyse BMC : {{BMC_ANALYSIS}}
- Analyse SIC : {{SIC_ANALYSIS}}
- Analyse Finance : {{FINANCE_ANALYSIS}}
- Diagnostic : {{DIAGNOSTIC}}
- ODD : {{ODD_ANALYSIS}}

CONTEXTE BAILLEURS :
{{KB_FUNDERS_SUMMARY}}

INSTRUCTIONS :
1. Rédige chaque section en intégrant les données des agents
2. Assure la cohérence entre les sections
3. Le ton doit être professionnel, adapté aux investisseurs
4. Chaque section doit contenir des données chiffrées
5. Score global du BP sur 100

Réponds UNIQUEMENT en JSON valide.',
'{"type":"object","properties":{"score":{"type":"number"},"sections":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"content":{"type":"string"}}}}}}',
0.4, 8192, 1, 'Version initiale - Orchestrator / Business Plan');
