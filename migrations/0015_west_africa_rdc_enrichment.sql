-- ════════════════════════════════════════════════════════════════════════
-- Migration 0015: Enrichissement KB — Afrique de l'Ouest + RDC
-- Focus: Bailleurs manquants, Benchmarks enrichis, Fiscalité, Macro, Accélérateurs
-- ════════════════════════════════════════════════════════════════════════

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PARTIE 1 — NOUVEAUX BAILLEURS (16 bailleurs)                       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── 1.1 Fondations ──────────────────────────────────────────────────

-- Tony Elumelu Foundation
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'tef', 'Tony Elumelu Foundation', 'Tony Elumelu Foundation', 'foundation', 'NG', 'Afrique',
  'https://www.tonyelumelufoundation.org',
  '["agriculture","digital","commerce","industrie","services","energie","sante","education"]',
  '{"min_employees":0,"max_employees":50,"sectors":["all"],"countries":["54_african_countries"],"stage":"idea_to_early","max_age_years":5,"applicant_age_min":18}',
  5000, 5000,
  '["grant"]',
  'Candidature en ligne via TEFConnect (janv-mars). Selection par comite. Formation 12 semaines obligatoire avant deblocage capital.',
  5, 6,
  'Programme phare: 5000$ seed capital non remboursable + formation + mentorat. 1000+ entrepreneurs selectionnes/an. Programme 2026 ouvert. Partenariats UE, PNUD, JICA, AfDB. Plus de 20 000 alumni depuis 2015. En 2024: 3.99M$ a 798 femmes entrepreneures (soutien UE).'
);

-- Fondation Mastercard
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'mastercard_foundation', 'Fondation Mastercard', 'Mastercard Foundation', 'foundation', 'CA', 'Afrique',
  'https://mastercardfdn.org',
  '["education","emploi_jeunes","agriculture","fintech","digital","entrepreneuriat"]',
  '{"sectors":["youth_employment","financial_inclusion","agriculture","edtech"],"countries":["africa"],"stage":"all","youth_focus":true}',
  50000, 50000000,
  '["grant","programme","capacity_building"]',
  'Via partenaires institutionnels (universites, ONG, gouvernements). Pas de candidature individuelle directe.',
  15, 12,
  'Programme Young Africa Works: objectif 30M emplois dignes pour jeunes africains. Budget 500M$+. Partenaires: Universite de Kigali, AIMS, AIF. Specialiste inclusion financiere via mobile money. Tres actif Ghana, Kenya, Rwanda, Senegal, Ethiopie.'
);

-- Fondation Addax & Oryx
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'addax_oryx', 'Fondation Addax & Oryx', 'Addax and Oryx Foundation', 'foundation', 'CH', 'Afrique',
  'https://addax-oryx-foundation.org',
  '["education","sante","eau","agriculture","environnement"]',
  '{"sectors":["community_development"],"countries":["west_africa","central_africa"],"stage":"project_based","ngo_required":true}',
  10000, 200000,
  '["grant"]',
  'Appels a projets ou candidature directe via ONG partenaires.',
  20, 4,
  'Finance des projets communautaires en Afrique de lOuest et centrale. Focus sur les communautes defavorisees.'
);

-- ── 1.2 Investisseurs Impact / VC ──────────────────────────────────

-- Partech Africa
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'partech_africa', 'Partech Africa', 'Partech Africa Fund', 'impact_fund', 'FR', 'Afrique',
  'https://partechpartners.com/africa',
  '["fintech","logistique","sante","education","digital","e_commerce","saas"]',
  '{"min_revenue_eur":100000,"sectors":["tech","digital"],"countries":["africa"],"stage":"series_a_to_b"}',
  500000, 10000000,
  '["equity"]',
  'Deal flow via reseau. Candidature directe possible. Due diligence approfondie.',
  8, 6,
  'Fonds de 280M$ dedie Afrique (Partech Africa Fund II). Portfolio: Yoco, TradeDepot, Wave, InstaDeep, MFS Africa. Leader VC en Afrique francophone.'
);

-- Launch Africa Ventures
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'launch_africa', 'Launch Africa', 'Launch Africa Ventures', 'impact_fund', 'MU', 'Afrique',
  'https://launchafrica.vc',
  '["fintech","healthtech","agritech","edtech","logistique","proptech","cleantech"]',
  '{"sectors":["tech"],"countries":["africa"],"stage":"pre_seed_to_seed"}',
  25000, 200000,
  '["equity","convertible_note"]',
  'Candidature en ligne. Selection rapide (4-8 semaines).',
  15, 2,
  'Plus de 200 investissements dans 40+ pays africains. Fonds panafricain seed stage. Portfolio: Wasoko, Copia, Turaco.'
);

-- Orange Ventures Afrique
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'orange_ventures', 'Orange Ventures', 'Orange Ventures Africa', 'impact_fund', 'FR', 'Afrique',
  'https://orangeventures.fr',
  '["fintech","mobile","digital","cybersecurite","iot","edtech","sante_digitale"]',
  '{"sectors":["digital","mobile","fintech"],"countries":["africa","middle_east"],"stage":"seed_to_series_b","orange_synergy":true}',
  200000, 5000000,
  '["equity","convertible_note"]',
  'Deal flow via ecosysteme Orange. Programme Orange Fab (accelerateur). Candidature directe possible.',
  12, 4,
  'Branche VC du Groupe Orange. Synergie reseau Orange en Afrique (20+ pays). Portfolio: Wave, MAX, Djamo, Afrimarket. Programme Orange Fab actif en CI, SN, CM, MA, TN.'
);

-- Amethis
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'amethis', 'Amethis', 'Amethis Partners', 'impact_fund', 'FR', 'Afrique',
  'https://amethis.com',
  '["finance","sante","education","agroalimentaire","distribution","services","industrie"]',
  '{"min_revenue_eur":5000000,"sectors":["growth_sectors"],"countries":["africa"],"stage":"growth_to_buyout"}',
  5000000, 50000000,
  '["equity","mezzanine"]',
  'Deal flow prive. Due diligence approfondie ESG.',
  10, 8,
  'Societe de capital investissement a impact. 1 Md EUR AUM. Focus PME/ETI en croissance en Afrique. Bureaux: Paris, Abidjan, Casablanca, Nairobi.'
);

-- Oikocredit
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'oikocredit', 'Oikocredit', 'Oikocredit International', 'dfi', 'NL', 'Global',
  'https://www.oikocredit.coop',
  '["microfinance","agriculture","energie_renouvelable","inclusion_financiere"]',
  '{"sectors":["financial_inclusion","agriculture","renewable_energy"],"countries":["developing"],"stage":"growth"}',
  200000, 5000000,
  '["loan","equity","guarantee"]',
  'Candidature directe. Evaluation impact social et financiere.',
  25, 6,
  'Cooperative financiere internationale. 1 Mds EUR investis dans 30+ pays. Specialiste microfinance et agriculture durable en Afrique de lOuest.'
);

-- ── 1.3 DFI / Bilateral ────────────────────────────────────────────

-- BOAD (Banque Ouest Africaine de Developpement)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'boad', 'BOAD', 'Banque Ouest Africaine de Developpement', 'multilateral', 'TG', 'UEMOA',
  'https://www.boad.org',
  '["infrastructure","agriculture","industrie","energie","PME","transport","eau"]',
  '{"sectors":["all"],"countries":["uemoa_8_pays"],"stage":"growth_to_infrastructure","uemoa_only":true}',
  500000, 50000000,
  '["loan","equity","guarantee","line_of_credit"]',
  'Via Etats membres ou intermediaires financiers. Lignes de credit PME via banques locales.',
  30, 10,
  'Banque de developpement de lUEMOA. Finance infrastructure et PME dans les 8 pays UEMOA. Lignes de credit PME via banques commerciales locales. Capital 1,4 Mds$.'
);

-- LuxDev
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'luxdev', 'LuxDev', 'Luxembourg Agency for Development Cooperation', 'bilateral', 'LU', 'Afrique de lOuest',
  'https://luxdev.lu',
  '["formation_professionnelle","sante","eau","gouvernance","agriculture","digital"]',
  '{"sectors":["vocational_training","health","governance"],"countries":["burkina_faso","mali","niger","senegal","cabo_verde"],"stage":"project_based"}',
  50000, 5000000,
  '["grant","technical_assistance"]',
  'Via cooperation bilaterale Luxembourg. Appels a propositions.',
  25, 6,
  'Agence luxembourgeoise. Tres active au Sahel (BF, ML, NE, SN, CV). Specialisee formation professionnelle et sante. Budget 2023: 380M EUR.'
);

-- Choose Africa / BPI France
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'choose_africa', 'Choose Africa', 'Choose Africa - Proparco / AFD / BPI France', 'bilateral', 'FR', 'Afrique',
  'https://choose-africa.com',
  '["PME","startup","digital","agriculture","energie","industrie"]',
  '{"sectors":["all_sme"],"countries":["africa"],"stage":"seed_to_growth","sme_focus":true}',
  10000, 10000000,
  '["loan","equity","guarantee","technical_assistance"]',
  'Via intermediaires financiers (banques, fonds). Programmes Digital Africa et French Tech en Afrique.',
  20, 6,
  'Initiative 2.5 Mds EUR pour PME/startups africaines. Coalition Proparco + AFD + BPI France. Programmes: Digital Africa, French Tech Africa, AFAWA (femmes).'
);

-- Union Europeenne (NDICI/Global Gateway)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'eu', 'Union Europeenne', 'European Union - NDICI Global Gateway', 'multilateral', 'BE', 'Afrique',
  'https://international-partnerships.ec.europa.eu',
  '["infrastructure","digital","climat","energie","education","sante","gouvernance","agriculture"]',
  '{"sectors":["all"],"countries":["all_developing"],"stage":"all"}',
  100000, 100000000,
  '["grant","blended_finance","guarantee","budget_support","technical_assistance"]',
  'Appels a propositions via EuropeAid. Partenariats avec gouvernements et ONG.',
  15, 12,
  'Global Gateway: 150 Mds EUR 2021-2027 dont Afrique prioritaire. Team Europe Initiatives. Partenaire TEF pour femmes entrepreneures (3.99M$ en 2024).'
);

-- JICA
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'jica', 'JICA', 'Japan International Cooperation Agency', 'bilateral', 'JP', 'Global',
  'https://www.jica.go.jp',
  '["infrastructure","agriculture","education","sante","industrie","digital","kaizen"]',
  '{"sectors":["all"],"countries":["all_developing"],"stage":"all"}',
  50000, 50000000,
  '["loan","grant","technical_assistance"]',
  'Via ambassades japonaises. Programme NINJA Accelerator pour startups. Appels a propositions TICAD.',
  20, 10,
  'Agence japonaise. Programme NINJA Accelerator pour startups tech. Initiative TICAD. Methode Kaizen pour productivite PME. Active en CI, SN, Ghana, Kenya.'
);

-- ── 1.4 Fonds locaux / regionaux ────────────────────────────────────

-- Gola Capital
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'gola_capital', 'Gola Capital', 'Gola Capital', 'impact_fund', 'SN', 'Afrique de lOuest',
  NULL,
  '["agritech","fintech","digital","logistique","commerce"]',
  '{"sectors":["tech","digital"],"countries":["west_africa_francophone"],"stage":"seed_to_series_a"}',
  50000, 500000,
  '["equity","convertible_note"]',
  'Deal flow local. Candidature directe.',
  25, 3,
  'Fonds VC base en Afrique de lOuest francophone. Senior investment.'
);

-- Zeitec (ex-GreenTec Capital)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'zeitec', 'Zeitec', 'Zeitec (ex-GreenTec Capital Partners)', 'impact_fund', 'DE', 'Afrique',
  'https://zeitec.com',
  '["agritech","energie","sante","education","logistique","environnement"]',
  '{"sectors":["impact","green"],"countries":["africa"],"stage":"seed_to_series_a"}',
  50000, 500000,
  '["equity","venture_building"]',
  'Programme de venture building + investissement. Candidature en ligne.',
  20, 4,
  'Venture builder et investisseur allemand. Accompagnement hands-on (marketing, finance, operations). Portfolio: 40+ startups en Afrique.'
);

-- Investissement RDC specifique - Rawbank Entrepreneuriat
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'kivu_fund', 'Fonds PME RDC', 'Fonds dappui aux PME congolaises (FPI + FEC + Rawbank)', 'government', 'CD', 'RDC',
  NULL,
  '["agriculture","commerce","industrie","services","artisanat","digital"]',
  '{"sectors":["all_sme"],"countries":["rdc"],"stage":"seed_to_growth","rdc_only":true}',
  1000, 100000,
  '["loan","grant","microcredit"]',
  'Via Fonds de Promotion de lIndustrie (FPI) ou programmes bancaires (Rawbank Adiaka, TMB PME). Candidature via agences locales.',
  30, 3,
  'Ecosysteme PME RDC: FPI (prets bonifies), programmes bancaires (Rawbank Adiaka, TMB), microfinance (FINCA, Advans). Challenges: acces au credit tres limite, taux bancaires 18-25%.'
);


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PARTIE 2 — PARAMETRES FISCAUX (7 nouveaux pays)                    ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── 2.1 Mali (ML) ──────────────────────────────────────────────────
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES
  ('ML', 'UEMOA', 'tva_rate', 'TVA standard', 18, '%', '2024-01-01', 'Mali: TVA 18% (taux UEMOA harmonise)'),
  ('ML', 'UEMOA', 'corporate_tax', 'Impot sur les societes (BIC)', 35, '%', '2024-01-01', 'Mali: IS 35% sur benefice imposable'),
  ('ML', 'UEMOA', 'social_charges_employer', 'Charges sociales patronales (INPS)', 22, '%', '2024-01-01', 'Mali: cotisations patronales INPS ~22% (retraite+famille+AT)'),
  ('ML', 'UEMOA', 'social_charges_employee', 'Charges sociales salariales', 5.2, '%', '2024-01-01', 'Mali: cotisations salariales ~5.2%'),
  ('ML', 'UEMOA', 'smig', 'SMIG mensuel', 40000, 'XOF', '2024-01-01', 'Mali: SMIG 40 000 FCFA/mois'),
  ('ML', 'UEMOA', 'withholding_tax', 'Retenue a la source', 15, '%', '2024-01-01', 'Mali: retenue a la source sur prestataires non residents'),
  ('ML', 'UEMOA', 'patente', 'Contribution des patentes', 1, 'variable', '2024-01-01', 'Mali: patente = droit proportionnel sur CA + droit fixe par activite');

-- ── 2.2 Togo (TG) ─────────────────────────────────────────────────
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES
  ('TG', 'UEMOA', 'tva_rate', 'TVA standard', 18, '%', '2024-01-01', 'Togo: TVA 18%'),
  ('TG', 'UEMOA', 'corporate_tax', 'Impot sur les societes', 29, '%', '2024-01-01', 'Togo: IS 29% (parmi les plus bas UEMOA)'),
  ('TG', 'UEMOA', 'social_charges_employer', 'Charges sociales patronales (CNSS)', 17.5, '%', '2024-01-01', 'Togo: cotisations patronales CNSS ~17.5%'),
  ('TG', 'UEMOA', 'social_charges_employee', 'Charges sociales salariales', 4, '%', '2024-01-01', 'Togo: cotisations salariales ~4%'),
  ('TG', 'UEMOA', 'smig', 'SMIG mensuel', 52500, 'XOF', '2025-01-01', 'Togo: SMIG 52 500 FCFA/mois (2025)'),
  ('TG', 'UEMOA', 'withholding_tax', 'Retenue a la source', 13, '%', '2024-01-01', 'Togo: retenue a la source 13%'),
  ('TG', 'UEMOA', 'zone_franche', 'Exoneration zone franche', 0, '%', '2024-01-01', 'Togo: zone franche de transformation pour lexportation - exoneration IS 10 ans');

-- ── 2.3 Benin (BJ) ────────────────────────────────────────────────
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES
  ('BJ', 'UEMOA', 'tva_rate', 'TVA standard', 18, '%', '2024-01-01', 'Benin: TVA 18%'),
  ('BJ', 'UEMOA', 'corporate_tax', 'Impot sur les societes', 30, '%', '2024-01-01', 'Benin: IS 30%'),
  ('BJ', 'UEMOA', 'social_charges_employer', 'Charges sociales patronales (CNSS)', 15.4, '%', '2024-01-01', 'Benin: cotisations patronales CNSS ~15.4%'),
  ('BJ', 'UEMOA', 'social_charges_employee', 'Charges sociales salariales', 3.6, '%', '2024-01-01', 'Benin: cotisations salariales ~3.6%'),
  ('BJ', 'UEMOA', 'smig', 'SMIG mensuel', 52000, 'XOF', '2025-01-01', 'Benin: SMIG 52 000 FCFA/mois (2025/2026 inchange)'),
  ('BJ', 'UEMOA', 'withholding_tax', 'Retenue a la source', 12, '%', '2024-01-01', 'Benin: retenue a la source sur prestataires'),
  ('BJ', 'UEMOA', 'minimum_capital_sarl', 'Capital minimum SARL', 100000, 'XOF', '2024-01-01', 'Benin: OHADA - capital minimum SARL 100 000 FCFA');

-- ── 2.4 Niger (NE) ────────────────────────────────────────────────
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES
  ('NE', 'UEMOA', 'tva_rate', 'TVA standard', 19, '%', '2024-01-01', 'Niger: TVA 19% (au-dessus taux UEMOA)'),
  ('NE', 'UEMOA', 'corporate_tax', 'Impot sur les societes', 30, '%', '2024-01-01', 'Niger: IS 30% sur benefice imposable'),
  ('NE', 'UEMOA', 'social_charges_employer', 'Charges sociales patronales (CNSS)', 16.5, '%', '2024-01-01', 'Niger: cotisations patronales CNSS ~16.5%'),
  ('NE', 'UEMOA', 'social_charges_employee', 'Charges sociales salariales', 5.25, '%', '2024-01-01', 'Niger: cotisations salariales ~5.25%'),
  ('NE', 'UEMOA', 'smig', 'SMIG mensuel', 42000, 'XOF', '2025-10-01', 'Niger: SMIG 42 000 FCFA/mois (revalorise oct 2025, etait 30 047)'),
  ('NE', 'UEMOA', 'withholding_tax', 'Retenue a la source', 16, '%', '2024-01-01', 'Niger: retenue a la source');

-- ── 2.5 Guinee Conakry (GN) ────────────────────────────────────────
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES
  ('GN', NULL, 'tva_rate', 'TVA standard', 18, '%', '2024-01-01', 'Guinee: TVA 18%'),
  ('GN', NULL, 'corporate_tax', 'Impot sur les societes', 35, '%', '2024-01-01', 'Guinee: IS 35%'),
  ('GN', NULL, 'social_charges_employer', 'Charges sociales patronales (CNSS)', 18, '%', '2024-01-01', 'Guinee: cotisations patronales CNSS ~18%'),
  ('GN', NULL, 'social_charges_employee', 'Charges sociales salariales', 5, '%', '2024-01-01', 'Guinee: cotisations salariales ~5%'),
  ('GN', NULL, 'smig', 'SMIG mensuel', 550000, 'GNF', '2025-01-01', 'Guinee: SMIG 550 000 GNF/mois (~40 000 FCFA au taux fluctuant). Monnaie: Franc Guineen'),
  ('GN', NULL, 'currency', 'Monnaie', 1, 'GNF', '2024-01-01', 'Guinee Conakry utilise le Franc Guineen (GNF), pas le FCFA. Non membre UEMOA.');

-- ── 2.6 Guinee-Bissau (GW) ─────────────────────────────────────────
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES
  ('GW', 'UEMOA', 'tva_rate', 'TVA standard', 17, '%', '2024-01-01', 'Guinee-Bissau: TVA 17% (plus bas UEMOA)'),
  ('GW', 'UEMOA', 'corporate_tax', 'Impot sur les societes', 25, '%', '2024-01-01', 'Guinee-Bissau: IS 25% (parmi les plus bas UEMOA)'),
  ('GW', 'UEMOA', 'social_charges_employer', 'Charges sociales patronales', 14, '%', '2024-01-01', 'Guinee-Bissau: cotisations patronales ~14%'),
  ('GW', 'UEMOA', 'social_charges_employee', 'Charges sociales salariales', 4, '%', '2024-01-01', 'Guinee-Bissau: cotisations salariales ~4%'),
  ('GW', 'UEMOA', 'smig', 'SMIG mensuel', 28000, 'XOF', '2024-01-01', 'Guinee-Bissau: SMIG ~28 000 FCFA/mois (plus bas UEMOA)');

-- ── 2.7 RDC — Republique Democratique du Congo (CD) ─────────────────
INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES
  ('CD', NULL, 'tva_rate', 'TVA standard', 16, '%', '2024-01-01', 'RDC: TVA 16%'),
  ('CD', NULL, 'corporate_tax', 'Impot sur les revenus professionnels (IRP)', 35, '%', '2024-01-01', 'RDC: IS 35% sur benefice imposable'),
  ('CD', NULL, 'social_charges_employer', 'Charges sociales patronales (CNSS)', 14.5, '%', '2024-01-01', 'RDC: cotisations patronales CNSS ~14.5% (branche retraite 5%, risques pro 1.5%, prestations familiales 6.5%, INPP 1.5%)'),
  ('CD', NULL, 'social_charges_employee', 'Charges sociales salariales', 5, '%', '2024-01-01', 'RDC: cotisations salariales ~5% (branche retraite)'),
  ('CD', NULL, 'smig', 'SMIG journalier', 21500, 'CDF', '2026-01-01', 'RDC: SMIG 21 500 CDF/jour (decret janv 2026). ~645 000 CDF/mois. Monnaie: Franc Congolais'),
  ('CD', NULL, 'dividend_tax', 'Impot mobilier sur dividendes', 20, '%', '2024-01-01', 'RDC: impot mobilier 20% sur dividendes'),
  ('CD', NULL, 'property_tax', 'Impot locatif', 20, '%', '2024-01-01', 'RDC: impot locatif 20%'),
  ('CD', NULL, 'currency', 'Monnaie', 1, 'CDF', '2024-01-01', 'RDC utilise le Franc Congolais (CDF). Economie partiellement dollarisee. Non membre UEMOA ni CEMAC.'),
  ('CD', NULL, 'bank_lending_rate', 'Taux moyen prets bancaires PME', 22, '%', '2024-01-01', 'RDC: taux prets bancaires PME tres eleves 18-25%. Acces au credit tres limite.'),
  ('CD', NULL, 'registration_fees', 'Frais creation entreprise RCCM', 120, 'USD', '2024-01-01', 'RDC: frais enregistrement au RCCM/Guichet Unique ~120 USD');


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PARTIE 3 — BENCHMARKS ENRICHIS PAR SECTEUR (Afrique de l'Ouest)    ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── 3.1 Agriculture enrichie ────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('agriculture', 'cac_eur', 'Afrique de lOuest', 5, 15, 40, 'EUR', 2024, 'Cout dacquisition client agriculture: tres variable selon canal (terrain vs digital)'),
  ('agriculture', 'revenue_per_hectare_eur', 'Afrique de lOuest', 200, 800, 2500, 'EUR', 2024, 'Revenu par hectare tres variable: cultures vivrieres (200-500) vs cultures de rente (1500-2500)'),
  ('agriculture', 'avg_team_size', 'Afrique de lOuest', 3, 8, 25, 'persons', 2024, 'Equipe mediane TPE/PME agricole en Afrique de lOuest'),
  ('agriculture', 'export_revenue_pct', 'Afrique de lOuest', 0, 15, 60, '%', 2024, 'Part export: faible pour vivrier, eleve pour cacao/cafe/cajou/karite'),
  ('agriculture', 'mobile_penetration_farmers', 'Afrique de lOuest', 40, 65, 85, '%', 2024, 'Penetration mobile chez agriculteurs: levier pour agritech'),
  ('agriculture', 'post_harvest_loss_pct', 'Afrique de lOuest', 20, 35, 50, '%', 2024, 'Pertes post-recolte 20-50% = opportunite majeure (stockage, chaine du froid, transformation)');

-- ── 3.2 Agritech enrichi ───────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('agritech', 'cac_eur', 'Afrique de lOuest', 8, 25, 60, 'EUR', 2024, 'CAC agritech: plus eleve que agriculture classique (composante tech)'),
  ('agritech', 'ltv_cac_ratio', 'Afrique de lOuest', 1.5, 3, 6, 'ratio', 2024, 'LTV/CAC agritech: objectif >3 pour viabilite'),
  ('agritech', 'avg_funding_eur', 'Afrique de lOuest', 50000, 300000, 2000000, 'EUR', 2024, 'Financement moyen agritech Afrique de lOuest'),
  ('agritech', 'break_even_months', 'Afrique de lOuest', 18, 30, 48, 'months', 2024, 'Break-even agritech: plus long que digital pur (saisonnalite)'),
  ('agritech', 'churn_rate_monthly', 'Afrique de lOuest', 3, 7, 15, '%', 2024, 'Taux dattrition mensuel agritech: eleve si pas de valeur immediate'),
  ('agritech', 'time_to_first_revenue_months', 'Afrique de lOuest', 3, 8, 18, 'months', 2024, 'Delai premiere vente: lie aux cycles agricoles saisonniers');

-- ── 3.3 Digital Services enrichi ───────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('digital_services', 'revenue_per_employee_eur', 'Afrique de lOuest', 15000, 40000, 100000, 'EUR', 2024, 'Productivite par employe services numeriques'),
  ('digital_services', 'churn_rate_monthly', 'Afrique de lOuest', 3, 6, 12, '%', 2024, 'Churn mensuel SaaS/digital en Afrique de lOuest'),
  ('digital_services', 'avg_team_size', 'Afrique de lOuest', 3, 10, 30, 'persons', 2024, 'Equipe mediane startup digital'),
  ('digital_services', 'time_to_first_revenue_months', 'Afrique de lOuest', 2, 6, 12, 'months', 2024, 'Delai premiere vente digital: rapide si service'),
  ('digital_services', 'burn_rate_monthly_eur', 'Afrique de lOuest', 2000, 8000, 25000, 'EUR', 2024, 'Burn rate mensuel startup digital Afrique Ouest'),
  ('digital_services', 'nps_score', 'Afrique de lOuest', 10, 35, 60, 'score', 2024, 'NPS mediane services numeriques'),
  ('digital_services', 'mobile_first_pct', 'Afrique de lOuest', 70, 85, 95, '%', 2024, 'Usage mobile-first: 85%+ des utilisateurs acces par mobile');

-- ── 3.4 Fintech enrichi ────────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('fintech', 'break_even_months', 'Afrique de lOuest', 18, 30, 48, 'months', 2024, 'Break-even fintech: besoin de volume transactionnel important'),
  ('fintech', 'ltv_cac_ratio', 'Afrique de lOuest', 2, 4, 8, 'ratio', 2024, 'LTV/CAC fintech: meilleur ratio grace a la retention'),
  ('fintech', 'avg_funding_eur', 'Afrique de lOuest', 100000, 500000, 5000000, 'EUR', 2024, 'Financement moyen fintech Afrique Ouest: marche le plus finance apres energie'),
  ('fintech', 'revenue_per_employee_eur', 'Afrique de lOuest', 20000, 50000, 150000, 'EUR', 2024, 'Productivite par employe fintech'),
  ('fintech', 'mobile_money_penetration', 'Afrique de lOuest', 30, 55, 80, '%', 2024, 'Penetration mobile money: CI 55%, SN 50%, GH 60%. Levier cle pour fintech.'),
  ('fintech', 'avg_transaction_volume_usd', 'Afrique de lOuest', 5, 15, 50, 'USD', 2024, 'Transaction mediane mobile money: faible mais volume eleve'),
  ('fintech', 'regulatory_compliance_cost_pct', 'Afrique de lOuest', 5, 15, 30, '%', 2024, 'Cout de conformite reglementaire (licence BCEAO, KYC, AML) = 5-30% des couts'),
  ('fintech', 'bancarisation_rate', 'Afrique de lOuest', 15, 35, 55, '%', 2024, 'Taux de bancarisation: opportunite = 65% de non-bancarises');

-- ── 3.5 Sante / Healthtech ─────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('health', 'break_even_months', 'Afrique de lOuest', 24, 36, 60, 'months', 2024, 'Break-even sante: long (reglementation, confiance, adoption)'),
  ('health', 'cac_eur', 'Afrique de lOuest', 10, 30, 80, 'EUR', 2024, 'CAC sante: eleve (necessite confiance medecins + patients)'),
  ('health', 'avg_funding_eur', 'Afrique de lOuest', 50000, 250000, 2000000, 'EUR', 2024, 'Financement moyen healthtech Afrique Ouest'),
  ('health', 'avg_team_size', 'Afrique de lOuest', 4, 12, 30, 'persons', 2024, 'Equipe mediane healthtech (dev + medical)'),
  ('health', 'digital_health_adoption_pct', 'Afrique de lOuest', 5, 15, 35, '%', 2024, 'Adoption sante digitale: encore faible mais en croissance rapide post-COVID');

-- ── 3.6 Education / Edtech ─────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('edtech', 'gross_margin_pct', 'Afrique de lOuest', 50, 70, 85, '%', 2024, 'Marge brute edtech: elevee (contenu digital = cout marginal faible)'),
  ('edtech', 'break_even_months', 'Afrique de lOuest', 18, 28, 42, 'months', 2024, 'Break-even edtech: modere si modele freemium'),
  ('edtech', 'cac_eur', 'Afrique de lOuest', 3, 10, 30, 'EUR', 2024, 'CAC edtech: relativement faible (viralite ecoles)'),
  ('edtech', 'arpu_monthly_eur', 'Afrique de lOuest', 1, 5, 20, 'EUR', 2024, 'ARPU mensuel edtech: faible mais volume eleve'),
  ('edtech', 'churn_rate_monthly', 'Afrique de lOuest', 5, 10, 20, '%', 2024, 'Churn edtech: eleve (saisonnalite scolaire)'),
  ('edtech', 'avg_funding_eur', 'Afrique de lOuest', 25000, 150000, 1000000, 'EUR', 2024, 'Financement moyen edtech Afrique Ouest');

-- ── 3.7 Logistique / Transport ─────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('logistique', 'gross_margin_pct', 'Afrique de lOuest', 10, 20, 35, '%', 2024, 'Marge brute logistique: faible (capital-intensif, carburant)'),
  ('logistique', 'break_even_months', 'Afrique de lOuest', 24, 36, 60, 'months', 2024, 'Break-even logistique: long (flotte, infrastructure)'),
  ('logistique', 'cac_eur', 'Afrique de lOuest', 20, 50, 150, 'EUR', 2024, 'CAC logistique: eleve (B2B, relation commerciale)'),
  ('logistique', 'avg_funding_eur', 'Afrique de lOuest', 100000, 500000, 5000000, 'EUR', 2024, 'Financement moyen logistique: besoin capitaux eleve'),
  ('logistique', 'fuel_cost_share_pct', 'Afrique de lOuest', 25, 40, 55, '%', 2024, 'Part carburant dans les couts: majeur et volatile'),
  ('logistique', 'last_mile_cost_eur_per_km', 'Afrique de lOuest', 0.5, 1.5, 4, 'EUR/km', 2024, 'Cout dernier kilometre: plus eleve quen Europe (routes, congestion)');

-- ── 3.8 E-commerce ─────────────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('e_commerce', 'gross_margin_pct', 'Afrique de lOuest', 15, 25, 40, '%', 2024, 'Marge brute e-commerce: variable selon modele (marketplace vs retail)'),
  ('e_commerce', 'break_even_months', 'Afrique de lOuest', 24, 36, 60, 'months', 2024, 'Break-even e-commerce: long (logistique + acquisition)'),
  ('e_commerce', 'cac_eur', 'Afrique de lOuest', 5, 15, 40, 'EUR', 2024, 'CAC e-commerce: modere (reseaux sociaux + terrain)'),
  ('e_commerce', 'avg_basket_eur', 'Afrique de lOuest', 5, 20, 80, 'EUR', 2024, 'Panier moyen e-commerce Afrique Ouest'),
  ('e_commerce', 'return_rate_pct', 'Afrique de lOuest', 5, 15, 30, '%', 2024, 'Taux de retour: eleve (confiance produit, qualite)'),
  ('e_commerce', 'cash_on_delivery_pct', 'Afrique de lOuest', 40, 65, 85, '%', 2024, 'Paiement a la livraison: 65%+ = defi tresorerie majeur');

-- ── 3.9 Immobilier / Proptech ──────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('proptech', 'gross_margin_pct', 'Afrique de lOuest', 20, 35, 55, '%', 2024, 'Marge brute proptech: variable (plateforme vs construction)'),
  ('proptech', 'break_even_months', 'Afrique de lOuest', 24, 42, 72, 'months', 2024, 'Break-even proptech: tres long (immobilier)'),
  ('proptech', 'avg_funding_eur', 'Afrique de lOuest', 100000, 400000, 3000000, 'EUR', 2024, 'Financement moyen proptech Afrique Ouest'),
  ('proptech', 'urbanisation_rate', 'Afrique de lOuest', 40, 50, 70, '%', 2024, 'Taux durbanisation: moteur de la demande immobiliere'),
  ('proptech', 'housing_deficit_units', 'Afrique de lOuest', 500000, 2000000, 5000000, 'units', 2024, 'Deficit logements par pays: CI ~600K, SN ~300K, NG ~20M = opportunite massive');

-- ── 3.10 PME General enrichi ────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('general_pme', 'survival_rate_3y', 'Afrique de lOuest', 20, 35, 55, '%', 2024, 'Taux de survie 3 ans PME: ~35% seulement'),
  ('general_pme', 'survival_rate_5y', 'Afrique de lOuest', 10, 20, 40, '%', 2024, 'Taux de survie 5 ans PME: ~20%'),
  ('general_pme', 'informality_rate', 'Afrique de lOuest', 60, 80, 95, '%', 2024, 'Taux dinformalite: 80%+ des entreprises non enregistrees'),
  ('general_pme', 'credit_access_pct', 'Afrique de lOuest', 5, 15, 30, '%', 2024, 'Acces au credit bancaire PME: seulement 15% ont un pret bancaire'),
  ('general_pme', 'women_owned_pct', 'Afrique de lOuest', 20, 35, 50, '%', 2024, 'PME detenues par des femmes: ~35% mais seulement 5% ont acces au credit'),
  ('general_pme', 'digital_adoption_pct', 'Afrique de lOuest', 10, 25, 50, '%', 2024, 'Adoption outils digitaux par PME: 25% (site web, reseaux sociaux, compta)'),
  ('general_pme', 'avg_annual_revenue_eur', 'Afrique de lOuest', 5000, 30000, 200000, 'EUR', 2024, 'CA annuel moyen PME formelle en Afrique de lOuest'),
  ('general_pme', 'avg_employees', 'Afrique de lOuest', 1, 5, 20, 'persons', 2024, 'Nombre moyen employes PME formelle'),
  ('general_pme', 'electricity_cost_share_pct', 'Afrique de lOuest', 5, 15, 30, '%', 2024, 'Part de lelectricite dans les couts: obstacle majeur (coupures, groupes)');

-- ── 3.11 Energie enrichi ───────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('energy', 'cac_eur', 'Afrique de lOuest', 30, 80, 200, 'EUR', 2024, 'CAC energie: eleve (installations terrain, derniere mile rurale)'),
  ('energy', 'ltv_cac_ratio', 'Afrique de lOuest', 1.5, 3, 6, 'ratio', 2024, 'LTV/CAC energie: modeles PAYG ameliorent la retention'),
  ('energy', 'avg_funding_eur', 'Afrique de lOuest', 100000, 500000, 10000000, 'EUR', 2024, 'Financement moyen energie: variable (off-grid petit vs infrastructure grand)'),
  ('energy', 'electrification_rate', 'Afrique de lOuest', 20, 45, 75, '%', 2024, 'Taux electrification: CI 75%, SN 70%, GH 85%, ML 45%, NE 20% = opportunite off-grid'),
  ('energy', 'paygo_default_rate', 'Afrique de lOuest', 5, 12, 25, '%', 2024, 'Taux de defaut PAYG solar: risque cle du modele');

-- ── 3.12 RDC Specifique ───────────────────────────────────────────
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('general_pme', 'credit_access_pct', 'RDC', 2, 8, 15, '%', 2024, 'RDC: acces credit PME tres faible (~8%). Taux interet 18-25%.'),
  ('general_pme', 'informality_rate', 'RDC', 80, 90, 95, '%', 2024, 'RDC: ~90% des activites economiques sont informelles'),
  ('general_pme', 'avg_annual_revenue_eur', 'RDC', 2000, 15000, 100000, 'EUR', 2024, 'RDC: CA moyen PME plus faible quen Afrique de lOuest UEMOA'),
  ('digital_services', 'internet_penetration', 'RDC', 10, 25, 40, '%', 2024, 'RDC: penetration internet ~25%. Mobile: 45%. Opportunite digitale massive.'),
  ('energy', 'electrification_rate', 'RDC', 1, 19, 50, '%', 2024, 'RDC: electrification 19% national (1% rural vs 50% Kinshasa). Enorme potentiel hydro/solaire.'),
  ('fintech', 'mobile_money_penetration', 'RDC', 15, 35, 55, '%', 2024, 'RDC: mobile money en croissance rapide. Vodacom M-Pesa, Airtel Money, Orange Money.'),
  ('climate_tech', 'country_funding_usd', 'RDC', NULL, 15000000, NULL, 'USD', 2024, 'RDC: ecosysteme climate tech naissant, ~15M$ investis'),
  ('general_pme', 'population_millions', 'RDC', NULL, 105, NULL, 'millions', 2024, 'RDC: 105M habitants = plus grand marche francophone du monde'),
  ('general_pme', 'gdp_per_capita_usd', 'RDC', NULL, 650, NULL, 'USD', 2024, 'RDC: PIB/hab ~650$ (parmi les plus bas)');


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PARTIE 4 — DONNEES MACRO AFRIQUE DE L'OUEST + RDC                  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- On utilise kb_benchmarks avec sector='macro' pour stocker les donnees macro par pays

INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  -- Cote d'Ivoire
  ('macro', 'gdp_per_capita_usd', 'Cote dIvoire', NULL, 2700, NULL, 'USD', 2024, 'CI: PIB/hab ~2700$ (locomotive UEMOA)'),
  ('macro', 'gdp_growth_pct', 'Cote dIvoire', NULL, 6.5, NULL, '%', 2024, 'CI: croissance PIB ~6.5% (parmi les plus forts Afrique)'),
  ('macro', 'population_millions', 'Cote dIvoire', NULL, 29, NULL, 'millions', 2024, 'CI: 29M habitants'),
  ('macro', 'urbanisation_pct', 'Cote dIvoire', NULL, 52, NULL, '%', 2024, 'CI: 52% urbain (Abidjan 5.6M)'),
  ('macro', 'youth_pct_under_35', 'Cote dIvoire', NULL, 75, NULL, '%', 2024, 'CI: 75% de la population a moins de 35 ans'),
  ('macro', 'internet_penetration_pct', 'Cote dIvoire', NULL, 45, NULL, '%', 2024, 'CI: penetration internet 45%'),
  ('macro', 'mobile_penetration_pct', 'Cote dIvoire', NULL, 75, NULL, '%', 2024, 'CI: penetration mobile unique 75%'),
  
  -- Senegal
  ('macro', 'gdp_per_capita_usd', 'Senegal', NULL, 1800, NULL, 'USD', 2024, 'SN: PIB/hab ~1800$'),
  ('macro', 'gdp_growth_pct', 'Senegal', NULL, 8.5, NULL, '%', 2024, 'SN: croissance PIB ~8.5% (boost petrole/gaz)'),
  ('macro', 'population_millions', 'Senegal', NULL, 18, NULL, 'millions', 2024, 'SN: 18M habitants'),
  ('macro', 'urbanisation_pct', 'Senegal', NULL, 49, NULL, '%', 2024, 'SN: 49% urbain (Dakar 3.8M)'),
  ('macro', 'internet_penetration_pct', 'Senegal', NULL, 58, NULL, '%', 2024, 'SN: penetration internet 58% (leader UEMOA)'),

  -- Burkina Faso
  ('macro', 'gdp_per_capita_usd', 'Burkina Faso', NULL, 900, NULL, 'USD', 2024, 'BF: PIB/hab ~900$'),
  ('macro', 'gdp_growth_pct', 'Burkina Faso', NULL, 4.5, NULL, '%', 2024, 'BF: croissance PIB ~4.5% (contexte securitaire difficile)'),
  ('macro', 'population_millions', 'Burkina Faso', NULL, 23, NULL, 'millions', 2024, 'BF: 23M habitants'),
  ('macro', 'internet_penetration_pct', 'Burkina Faso', NULL, 25, NULL, '%', 2024, 'BF: penetration internet 25%'),

  -- Mali
  ('macro', 'gdp_per_capita_usd', 'Mali', NULL, 900, NULL, 'USD', 2024, 'ML: PIB/hab ~900$'),
  ('macro', 'gdp_growth_pct', 'Mali', NULL, 4, NULL, '%', 2024, 'ML: croissance PIB ~4%'),
  ('macro', 'population_millions', 'Mali', NULL, 23, NULL, 'millions', 2024, 'ML: 23M habitants'),
  ('macro', 'internet_penetration_pct', 'Mali', NULL, 30, NULL, '%', 2024, 'ML: penetration internet 30%'),

  -- Togo
  ('macro', 'gdp_per_capita_usd', 'Togo', NULL, 1000, NULL, 'USD', 2024, 'TG: PIB/hab ~1000$'),
  ('macro', 'gdp_growth_pct', 'Togo', NULL, 5.5, NULL, '%', 2024, 'TG: croissance PIB ~5.5% (port de Lome = hub logistique)'),
  ('macro', 'population_millions', 'Togo', NULL, 9, NULL, 'millions', 2024, 'TG: 9M habitants'),
  ('macro', 'internet_penetration_pct', 'Togo', NULL, 35, NULL, '%', 2024, 'TG: penetration internet 35%'),

  -- Benin
  ('macro', 'gdp_per_capita_usd', 'Benin', NULL, 1400, NULL, 'USD', 2024, 'BJ: PIB/hab ~1400$'),
  ('macro', 'gdp_growth_pct', 'Benin', NULL, 6, NULL, '%', 2024, 'BJ: croissance PIB ~6% (reformes structurelles)'),
  ('macro', 'population_millions', 'Benin', NULL, 13.5, NULL, 'millions', 2024, 'BJ: 13.5M habitants'),
  ('macro', 'internet_penetration_pct', 'Benin', NULL, 35, NULL, '%', 2024, 'BJ: penetration internet 35%'),

  -- Niger
  ('macro', 'gdp_per_capita_usd', 'Niger', NULL, 600, NULL, 'USD', 2024, 'NE: PIB/hab ~600$ (plus bas UEMOA)'),
  ('macro', 'gdp_growth_pct', 'Niger', NULL, 2, NULL, '%', 2024, 'NE: croissance PIB ~2% (contexte politique)'),
  ('macro', 'population_millions', 'Niger', NULL, 27, NULL, 'millions', 2024, 'NE: 27M habitants (croissance demographique la plus forte au monde)'),
  ('macro', 'internet_penetration_pct', 'Niger', NULL, 15, NULL, '%', 2024, 'NE: penetration internet 15%'),

  -- Guinee Conakry
  ('macro', 'gdp_per_capita_usd', 'Guinee', NULL, 1350, NULL, 'USD', 2024, 'GN: PIB/hab ~1350$ (mines = moteur economique)'),
  ('macro', 'gdp_growth_pct', 'Guinee', NULL, 5, NULL, '%', 2024, 'GN: croissance PIB ~5% (secteur minier)'),
  ('macro', 'population_millions', 'Guinee', NULL, 14, NULL, 'millions', 2024, 'GN: 14M habitants'),
  ('macro', 'internet_penetration_pct', 'Guinee', NULL, 30, NULL, '%', 2024, 'GN: penetration internet 30%'),

  -- Guinee-Bissau
  ('macro', 'gdp_per_capita_usd', 'Guinee-Bissau', NULL, 800, NULL, 'USD', 2024, 'GW: PIB/hab ~800$'),
  ('macro', 'population_millions', 'Guinee-Bissau', NULL, 2.1, NULL, 'millions', 2024, 'GW: 2.1M habitants'),

  -- Ghana (comparaison anglophone)
  ('macro', 'gdp_per_capita_usd', 'Ghana', NULL, 2400, NULL, 'USD', 2024, 'GH: PIB/hab ~2400$'),
  ('macro', 'gdp_growth_pct', 'Ghana', NULL, 4.5, NULL, '%', 2024, 'GH: croissance PIB ~4.5%'),
  ('macro', 'population_millions', 'Ghana', NULL, 34, NULL, 'millions', 2024, 'GH: 34M habitants'),
  ('macro', 'internet_penetration_pct', 'Ghana', NULL, 55, NULL, '%', 2024, 'GH: penetration internet 55%'),

  -- Nigeria (comparaison anglophone)
  ('macro', 'gdp_per_capita_usd', 'Nigeria', NULL, 2200, NULL, 'USD', 2024, 'NG: PIB/hab ~2200$ (plus grande economie Afrique)'),
  ('macro', 'population_millions', 'Nigeria', NULL, 230, NULL, 'millions', 2024, 'NG: 230M habitants = plus grand marche Afrique'),
  ('macro', 'internet_penetration_pct', 'Nigeria', NULL, 55, NULL, '%', 2024, 'NG: penetration internet 55%'),

  -- RDC
  ('macro', 'gdp_growth_pct', 'RDC', NULL, 6, NULL, '%', 2024, 'RDC: croissance PIB ~6% (mines, construction)'),
  ('macro', 'urbanisation_pct', 'RDC', NULL, 46, NULL, '%', 2024, 'RDC: 46% urbain (Kinshasa 17M = 3e ville Afrique)'),
  ('macro', 'internet_penetration_pct', 'RDC', NULL, 25, NULL, '%', 2024, 'RDC: penetration internet 25%'),
  ('macro', 'mobile_penetration_pct', 'RDC', NULL, 45, NULL, '%', 2024, 'RDC: penetration mobile unique 45%'),

  -- Taux de change (references)
  ('macro', 'exchange_rate_eur_xof', 'UEMOA', NULL, 655.957, NULL, 'XOF/EUR', 2024, 'Parite fixe EUR/FCFA = 655.957 XOF pour 1 EUR'),
  ('macro', 'exchange_rate_usd_xof', 'UEMOA', NULL, 600, NULL, 'XOF/USD', 2024, 'Taux indicatif USD/FCFA ~600 XOF (fluctuant)'),
  ('macro', 'exchange_rate_eur_gnf', 'Guinee', NULL, 9200, NULL, 'GNF/EUR', 2024, 'Taux indicatif EUR/GNF ~9200 (tres volatile)'),
  ('macro', 'exchange_rate_usd_cdf', 'RDC', NULL, 2800, NULL, 'CDF/USD', 2024, 'Taux indicatif USD/CDF ~2800 (tres volatile, economie dollarisee)');


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PARTIE 5 — ACCELERATEURS / INCUBATEURS AFRIQUE OUEST + RDC         ║
-- ╚══════════════════════════════════════════════════════════════════════╝

INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES
  -- Cote d'Ivoire
  ('institution', 'Impact Lab Abidjan', 'Incubateur dimpact a Abidjan. Accompagne startups sociales et environnementales.', NULL, 'Cote dIvoire', 80),
  ('institution', 'Jokkolabs Abidjan', 'Espace de coworking et incubation a Abidjan. Reseau panafricain.', NULL, 'Cote dIvoire', 75),
  ('institution', 'Orange Fab Cote dIvoire', 'Accelerateur corporate Orange. 3 mois de programme intensif avec acces reseau Orange.', NULL, 'Cote dIvoire', 80),
  ('institution', 'Incub Ivoire (CCI)', 'Incubateur de la CCI dAbidjan pour PME/startup.', NULL, 'Cote dIvoire', 70),
  ('institution', 'CGECI Academy', 'Programme dacceleration du patronat ivoirien (CGECI).', NULL, 'Cote dIvoire', 70),
  
  -- Senegal
  ('institution', 'CTIC Dakar', 'Premier incubateur tech dAfrique francophone (2011). Programmes dacceleration et coworking.', 'https://www.cticdakar.com', 'Senegal', 85),
  ('institution', 'Jokkolabs Dakar', 'Premier hub dAfrique de lOuest (2010). Coworking, incubation, evenements tech.', 'https://jokkolabs.net', 'Senegal', 80),
  ('institution', 'Orange Fab Senegal', 'Accelerateur corporate Orange au Senegal.', NULL, 'Senegal', 75),
  ('institution', 'Founder Institute Dakar', 'Chapter Dakar du Founder Institute mondial.', NULL, 'Senegal', 70),
  ('institution', 'DER (Delegation generale a lEntrepreneuriat Rapide)', 'Programme gouvernemental senegalais de soutien a lentrepreneuriat.', NULL, 'Senegal', 85),
  
  -- Burkina Faso
  ('institution', 'Jokkolabs Ouagadougou', 'Hub dinnovation a Ouagadougou.', NULL, 'Burkina Faso', 70),
  ('institution', 'Yaam Digital Lab', 'Incubateur tech au Burkina Faso.', NULL, 'Burkina Faso', 65),
  
  -- Mali
  ('institution', 'Jokkolabs Bamako', 'Hub dinnovation a Bamako.', NULL, 'Mali', 65),
  ('institution', 'DoniLab', 'Incubateur tech a Bamako. Innovation sociale et entrepreneuriat.', NULL, 'Mali', 70),
  
  -- Togo
  ('institution', 'Woelab', 'Premier lab dinnovation au Togo. Fabrication numerique et opensource.', NULL, 'Togo', 70),
  ('institution', 'Innov Hub Togo', 'Hub dinnovation et espace de coworking a Lome.', NULL, 'Togo', 65),
  
  -- Benin
  ('institution', 'Seme City', 'Cite de linnovation et du savoir au Benin. Initiative gouvernementale majeure.', NULL, 'Benin', 80),
  ('institution', 'EtriLabs', 'Incubateur tech a Cotonou. Programmes dacceleration startup.', NULL, 'Benin', 75),
  
  -- Niger
  ('institution', 'CIPMEN', 'Centre incubateur des PME au Niger. Principal incubateur du pays.', NULL, 'Niger', 70),
  
  -- Guinee
  ('institution', 'Saboutech', 'Incubateur tech a Conakry. Premier hub dinnovation de Guinee.', NULL, 'Guinee', 70),
  
  -- RDC
  ('institution', 'Kinshasa Digital', 'Hub tech a Kinshasa. Coworking et acceleration startups.', NULL, 'RDC', 70),
  ('institution', 'Congo Business Network', 'Reseau dentrepreneurs et incubateur en RDC.', NULL, 'RDC', 65),
  ('institution', 'Ingenious City Lubumbashi', 'Hub dinnovation a Lubumbashi. Tech et entrepreneuriat au Katanga.', NULL, 'RDC', 65),
  
  -- Panafricains presents en Afrique Ouest
  ('institution', 'MEST Africa', 'Programme dentrainement, incubation et investissement. Hubs: Accra, Lagos, Nairobi, Cape Town.', 'https://meltwater.org', 'Afrique de lOuest', 80),
  ('institution', 'Google for Startups Accelerator Africa', 'Accelerateur Google pour startups africaines. Mentorat + cloud credits.', NULL, 'Afrique', 85),
  ('institution', 'Afrilabs', 'Reseau de 400+ hubs dinnovation dans 52 pays africains.', 'https://afrilabs.com', 'Afrique', 85),
  ('institution', 'Digital Africa', 'Initiative franaise pour lentrepreneuriat digital en Afrique. Programmes de financement.', 'https://digital-africa.co', 'Afrique', 80),
  ('institution', 'Catalyst Fund', 'Accelerateur lie aux fonds VC pour startups a impact. Suivi + capital-relais.', NULL, 'Afrique', 80);
