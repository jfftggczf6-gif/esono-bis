-- Migration 0014: Climate Tech Africa — Rapport CATAL1.5T / GVC / BMZ
-- Source: "Evaluation fondee sur les donnees du secteur des technologies climatiques en Afrique subsaharienne"
-- Donnees extraites: bailleurs, benchmarks, ecosystemes pays, accelerateurs, donnees macro

-- ================================================================
-- 1. SOURCE PRINCIPALE
-- ================================================================

INSERT OR IGNORE INTO kb_sources (category, name, description, url, data_json, region, relevance_score, last_verified_at)
VALUES (
  'report',
  'CATAL1.5T - Rapport Climate Tech Afrique Subsaharienne',
  'Evaluation quantitative de lecosysteme Climate Tech en Afrique subsaharienne (2015-2024). 491 startups, 820+ financements, 3.3 Mds$ investis. Financé par le Fonds Vert pour le Climat (FVC) et le BMZ allemand.',
  'https://www.genspark.ai/api/files/s/WCYVhpiP',
  '{"total_funding_usd":3300000000,"startups_total":491,"startups_funded":432,"deals_total":820,"median_deal_size_usd":600000,"funders_total":503,"top_20_companies_share_pct":70,"peak_years":"2022-2023","co2_per_capita_ssa_tonnes":0.8,"co2_per_capita_global_tonnes":3.9,"adaptation_cost_2050_usd_bn":50}',
  'Afrique subsaharienne',
  95,
  '2025-01-01'
);

-- ================================================================
-- 2. NOUVEAUX BAILLEURS (14 bailleurs supplementaires)
-- ================================================================

-- Proparco (filiale AFD)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'proparco', 'Proparco', 'Promotion et Participation pour la Cooperation economique', 'dfi', 'FR', 'Afrique',
  'https://www.proparco.fr',
  '["infrastructure","energie","agriculture","digital","PME","climat"]',
  '{"min_revenue_eur":500000,"min_employees":10,"sectors":["all"],"countries":["afrique_subsaharienne"],"stage":"growth","climate_focus":true}',
  500000, 50000000,
  '["loan","equity","guarantee","mezzanine"]',
  'Dossier de candidature via site Proparco, due diligence ESG approfondie, comite dinvestissement',
  20, 9,
  'Filiale privee de lAFD. Focus croissant sur climat et genre. Co-investit souvent avec AFD.'
);

-- IFC (SFI - Banque Mondiale)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'ifc', 'IFC', 'Societe Financiere Internationale (Groupe Banque Mondiale)', 'dfi', 'US', 'Global',
  'https://www.ifc.org',
  '["infrastructure","energie","agriculture","digital","industrie","climat","finance"]',
  '{"min_revenue_eur":1000000,"min_employees":50,"sectors":["all"],"countries":["all_developing"],"stage":"growth_to_scale"}',
  1000000, 100000000,
  '["loan","equity","guarantee","syndication","trade_finance"]',
  'Candidature directe ou via intermediaires financiers. Due diligence de 6-12 mois.',
  15, 12,
  'Plus grand investisseur prive dans les PVD. Programme Scaling Solar et IFC Startup Catalyst. Norme de performance ESG de reference.'
);

-- BII (British International Investment)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'bii', 'BII', 'British International Investment', 'dfi', 'GB', 'Afrique',
  'https://www.bii.co.uk',
  '["infrastructure","energie","climat","digital","sante","finance"]',
  '{"min_revenue_eur":500000,"sectors":["climate","infra","digital"],"countries":["africa","south_asia"],"stage":"growth","climate_focus":true}',
  500000, 50000000,
  '["equity","loan","guarantee","carbon_credit_mechanism"]',
  'Approche directe ou partenaire. A investi dans mecanismes innovants de credits carbone avec Shell Foundation.',
  18, 10,
  'Ex-CDC Group. Mecanisme innovant credits carbone: 2M$ initial + 4M$ supplementaires avec Shell Foundation pour SunCulture.'
);

-- FMO (Pays-Bas)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'fmo', 'FMO', 'Nederlandse Financierings-Maatschappij voor Ontwikkelingslanden', 'dfi', 'NL', 'Global',
  'https://www.fmo.nl',
  '["energie","agribusiness","finance","infrastructure","PME"]',
  '{"min_revenue_eur":1000000,"sectors":["energy","agri","finance"],"countries":["all_developing"],"stage":"growth"}',
  1000000, 30000000,
  '["loan","equity","mezzanine","guarantee"]',
  'Candidature via site FMO. Due diligence ESG. Comite dinvestissement.',
  20, 8,
  'Banque de developpement entrepreneurial neerlandaise. Active dans climate tech Afrique subsaharienne.'
);

-- Norfund (Norvege)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'norfund', 'Norfund', 'Norwegian Investment Fund for Developing Countries', 'dfi', 'NO', 'Afrique',
  'https://www.norfund.no',
  '["energie_renouvelable","agriculture","finance","industrie"]',
  '{"min_revenue_eur":500000,"sectors":["clean_energy","finance","agri"],"countries":["africa","south_asia"],"stage":"growth"}',
  500000, 50000000,
  '["equity","loan"]',
  'Investissements directs ou via fonds. Focus sur energie renouvelable.',
  22, 9,
  'Investisseur dancrage dans projets capital-intensifs. Focus energie propre Afrique de lEst.'
);

-- I&P (Investisseurs & Partenaires)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'ip', 'I&P', 'Investisseurs & Partenaires', 'impact_fund', 'FR', 'Afrique subsaharienne',
  'https://www.ietp.com',
  '["agriculture","digital","sante","education","industrie","climat"]',
  '{"min_revenue_eur":50000,"max_employees":200,"sectors":["all_sme"],"countries":["afrique_subsaharienne_francophone"],"stage":"seed_to_growth"}',
  50000, 3000000,
  '["equity","quasi_equity","loan","convertible"]',
  'Candidature directe. Due diligence impact social. Accompagnement post-investissement.',
  30, 6,
  'Groupe dinvestissement a impact social specialise PME Afrique. Tres actif en Cote dIvoire, Senegal, Madagascar. Fonds IPAE, IPDEV.'
);

-- Teranga Capital
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'teranga_capital', 'Teranga Capital', 'Teranga Capital', 'impact_fund', 'SN', 'Afrique de lOuest',
  'https://www.terangacapital.com',
  '["agriculture","digital","education","sante","industrie"]',
  '{"min_revenue_eur":30000,"sectors":["all_sme"],"countries":["senegal","afrique_ouest"],"stage":"seed_to_series_a"}',
  30000, 500000,
  '["equity","quasi_equity","convertible"]',
  'Candidature directe. Accompagnement technique post-investissement.',
  35, 4,
  'Fonds damorçage et dacceleration base a Dakar. Partenaire CATAL1.5T. Specialiste PME Senegal et Afrique de lOuest francophone.'
);

-- Sinergi (Niger + Burkina)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'sinergi', 'Sinergi', 'Sinergi Niger / Sinergi Burkina', 'impact_fund', 'NE', 'Afrique de lOuest',
  NULL,
  '["agriculture","energie","climat","industrie"]',
  '{"min_revenue_eur":10000,"sectors":["agriculture","energie","climat"],"countries":["niger","burkina_faso"],"stage":"seed"}',
  10000, 300000,
  '["equity","loan","grant"]',
  'Candidature locale. Impact investing et acceleration climat.',
  40, 3,
  'Investissement dimpact et acceleration dans la region sahelienne. Fonds dedie climat via CATAL1.5T.'
);

-- Katapult Africa
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'katapult', 'Katapult Africa', 'Katapult Africa Accelerator & Fund', 'impact_fund', 'NO', 'Afrique',
  'https://katapult.vc',
  '["climat","agriculture","digital","energie","impact"]',
  '{"sectors":["climate_tech","impact"],"countries":["africa"],"stage":"pre_seed_to_seed"}',
  25000, 250000,
  '["equity","convertible_note"]',
  'Programme daccelerateur avec investissement. Candidature en ligne.',
  45, 3,
  'Accelerateur et fonds dinvestissement focalise impact et climat. Mentionne dans le rapport CATAL1.5T comme acteur cle.'
);

-- Camoé Capital (Côte d'Ivoire)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'camoe_capital', 'Camoe Capital', 'Camoe Capital', 'impact_fund', 'CI', 'Afrique de lOuest',
  NULL,
  '["agriculture","digital","industrie","PME"]',
  '{"sectors":["all_sme"],"countries":["cote_ivoire","afrique_ouest"],"stage":"seed_to_series_a"}',
  50000, 500000,
  '["equity","quasi_equity"]',
  'Finance responsable. Candidature directe.',
  30, 5,
  'Fonds de finance responsable base en Cote dIvoire.'
);

-- Fonds Vert pour le Climat (GCF)
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'gcf', 'Fonds Vert Climat', 'Green Climate Fund (GCF/FVC)', 'multilateral', 'KR', 'Global',
  'https://www.greenclimate.fund',
  '["climat","energie_renouvelable","adaptation","resilience","foret"]',
  '{"sectors":["climate_mitigation","climate_adaptation"],"countries":["all_developing"],"stage":"all","climate_mandatory":true}',
  500000, 200000000,
  '["grant","loan","equity","guarantee","results_based"]',
  'Via entites accreditees nationales/internationales. Processus long.',
  12, 18,
  'Principal fonds mondial pour le climat. Finance CATAL1.5T. Mecanismes de paiement bases sur les resultats.'
);

-- USAID
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'usaid', 'USAID', 'United States Agency for International Development', 'bilateral', 'US', 'Global',
  'https://www.usaid.gov',
  '["agriculture","energie","sante","education","gouvernance","climat","digital"]',
  '{"sectors":["all"],"countries":["all_developing"],"stage":"all"}',
  10000, 50000000,
  '["grant","technical_assistance","blended_finance"]',
  'Appels a propositions publics. Partenariats avec ONG et entreprises.',
  18, 8,
  'Plus grande agence daide bilaterale. Programmes Power Africa, Feed the Future. Mentionne comme bailleur cle climate tech.'
);

-- GSMA Innovation Fund
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'gsma', 'GSMA Innovation Fund', 'GSMA Climate Resilience Innovation Fund', 'foundation', 'GB', 'Global',
  'https://www.gsma.com/mobilefordevelopment',
  '["digital","climat","resilience","mobile","fintech"]',
  '{"sectors":["mobile_climate","agritech","fintech"],"countries":["africa","asia"],"stage":"seed_to_series_a","mobile_required":true}',
  100000, 500000,
  '["grant","technical_assistance"]',
  'Appels a propositions thematiques. Focus solutions mobiles.',
  25, 4,
  'Fonds cible resilience climatique via technologies mobiles. Subventions et assistance technique.'
);

-- Shell Foundation
INSERT OR IGNORE INTO kb_funders (code, name, full_name, type, country, region, website, focus_sectors, eligibility_criteria, typical_ticket_min, typical_ticket_max, instrument_types, application_process, success_rate, avg_processing_months, notes)
VALUES (
  'shell_foundation', 'Shell Foundation', 'Shell Foundation', 'foundation', 'GB', 'Global',
  'https://shellfoundation.org',
  '["energie","climat","transport","mobilite"]',
  '{"sectors":["energy_access","clean_mobility","climate"],"countries":["africa","south_asia"],"stage":"seed_to_growth"}',
  100000, 5000000,
  '["grant","catalytic_capital","blended"]',
  'Partenariats strategiques. Co-investissement avec DFIs.',
  20, 6,
  'Fondation philanthropique. A co-concu le mecanisme credits carbone avec BII pour SunCulture. Focus energie propre et mobilite.'
);

-- ================================================================
-- 3. BENCHMARKS CLIMATE TECH (50+ nouvelles metriques)
-- ================================================================

-- Source ID reference: on utilise la derniere source inseree
-- On va referencer par subquery

-- ── Climate Tech - Global SSA ──
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('climate_tech', 'total_ecosystem_funding_usd', 'Afrique subsaharienne', 2500000000, 3300000000, 3500000000, 'USD', 2024, 'Investissement total 2015-2024. Source: CATAL1.5T'),
  ('climate_tech', 'total_startups', 'Afrique subsaharienne', NULL, 491, NULL, 'count', 2024, '491 startups identifiees dont 432 financees'),
  ('climate_tech', 'total_funded_startups', 'Afrique subsaharienne', NULL, 432, NULL, 'count', 2024, '88% des startups ont recu un financement'),
  ('climate_tech', 'total_deals', 'Afrique subsaharienne', NULL, 820, NULL, 'count', 2024, '820+ operations de financement enregistrees'),
  ('climate_tech', 'median_deal_size_usd', 'Afrique subsaharienne', 50000, 600000, 5000000, 'USD', 2024, 'Taille mediane 600K$. 70% du total par 20 entreprises'),
  ('climate_tech', 'total_funders', 'Afrique subsaharienne', NULL, 503, NULL, 'count', 2024, '503 financeurs (investisseurs + OSE)'),
  ('climate_tech', 'top20_concentration_pct', 'Afrique subsaharienne', NULL, 70, NULL, '%', 2024, '70% du financement total capte par 20 entreprises'),
  ('climate_tech', 'funding_gap_range_usd', 'Afrique subsaharienne', 50000, 250000, 500000, 'USD', 2024, 'Zone morte: 50K-500K$ manque dinvestisseurs (business angels)'),
  ('climate_tech', 'vc_impact_share_pct', 'Afrique subsaharienne', NULL, 50, NULL, '%', 2024, 'VC et investisseurs dimpact = 50%+ des bailleurs'),
  ('climate_tech', 'eso_grant_share_pct', 'Afrique subsaharienne', NULL, 50, NULL, '%', 2024, '50% des financements < 500K$ sont des subventions OSE'),
  ('climate_tech', 'seed_stage_share_pct', 'Afrique subsaharienne', NULL, 25, NULL, '%', 2024, '25% des operations au stade amorçage'),
  ('climate_tech', 'co2_per_capita_tonnes', 'Afrique subsaharienne', NULL, 0.8, 3.9, 'tonnes', 2024, 'ASS: 0.8t/hab vs mondial 3.9t/hab'),
  ('climate_tech', 'adaptation_cost_2050_usd_bn', 'Afrique', NULL, 50, NULL, 'Mds USD/an', 2050, 'Estimation PNUE: 50 Mds$/an dici 2050');

-- ── Par pays - Ecosysteme Climate Tech ──
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('climate_tech', 'country_funding_usd', 'Kenya', NULL, 1600000000, NULL, 'USD', 2024, 'Kenya: leader avec 1.6 Mds$, 146 entreprises, 132 financees'),
  ('climate_tech', 'country_companies', 'Kenya', NULL, 146, NULL, 'count', 2024, '146 entreprises climate tech au Kenya'),
  ('climate_tech', 'country_funded_companies', 'Kenya', NULL, 132, NULL, 'count', 2024, '132 entreprises financees au Kenya (90%)'),
  ('climate_tech', 'country_funding_usd', 'Nigeria', NULL, 588000000, NULL, 'USD', 2024, 'Nigeria: 2e marche, 588M$'),
  ('climate_tech', 'country_companies', 'Nigeria', NULL, 110, NULL, 'count', 2024, '110 entreprises climate tech au Nigeria'),
  ('climate_tech', 'country_funded_companies', 'Nigeria', NULL, 97, NULL, 'count', 2024, '97 entreprises financees au Nigeria (88%)'),
  ('climate_tech', 'country_funding_usd', 'South Africa', NULL, 511000000, NULL, 'USD', 2024, 'Afrique du Sud: 3e marche, 511M$'),
  ('climate_tech', 'country_companies', 'South Africa', NULL, 79, NULL, 'count', 2024, '79 entreprises climate tech en Afrique du Sud'),
  ('climate_tech', 'country_funded_companies', 'South Africa', NULL, 70, NULL, 'count', 2024, '70 entreprises financees en Afrique du Sud (89%)'),
  ('climate_tech', 'country_funding_usd', 'Tanzania', NULL, 260000000, NULL, 'USD', 2024, 'Tanzanie: marche emergent, 260M$'),
  ('climate_tech', 'country_companies', 'Tanzania', NULL, 44, NULL, 'count', 2024, '44 entreprises, 39 financees en Tanzanie'),
  ('climate_tech', 'country_funding_usd', 'Zambia', NULL, 114000000, NULL, 'USD', 2024, 'Zambie: marche emergent, 114M$'),
  ('climate_tech', 'country_companies', 'Zambia', NULL, 15, NULL, 'count', 2024, '15 entreprises, 13 financees en Zambie'),
  ('climate_tech', 'country_funding_usd', 'Ghana', NULL, 106000000, NULL, 'USD', 2024, 'Ghana: marche emergent, 106M$'),
  ('climate_tech', 'country_companies', 'Ghana', NULL, 46, NULL, 'count', 2024, '46 entreprises, 40 financees au Ghana'),
  ('climate_tech', 'country_funding_usd', 'Senegal', NULL, 23000000, NULL, 'USD', 2024, 'Senegal: ecosysteme naissant, 23M$, 25 entreprises'),
  ('climate_tech', 'country_companies', 'Senegal', NULL, 25, NULL, 'count', 2024, '25 entreprises, 20 financees au Senegal'),
  ('climate_tech', 'country_funding_usd', 'Cote dIvoire', NULL, 21000000, NULL, 'USD', 2024, 'Cote dIvoire: ecosysteme naissant, 21M$, 26 entreprises'),
  ('climate_tech', 'country_companies', 'Cote dIvoire', NULL, 26, NULL, 'count', 2024, '26 entreprises, 21 financees en Cote dIvoire');

-- ── Par sous-secteur Climate Tech ──
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  -- Energie (33% des entreprises, 70% du financement)
  ('climate_tech_energy', 'companies_share_pct', 'Afrique subsaharienne', NULL, 33, NULL, '%', 2024, 'Energie = 1/3 des entreprises climate tech. 160+ entreprises'),
  ('climate_tech_energy', 'funding_share_pct', 'Afrique subsaharienne', NULL, 70, NULL, '%', 2024, '70% du financement total va a lenergie (solaire dominant)'),
  ('climate_tech_energy', 'company_count', 'Afrique subsaharienne', NULL, 160, NULL, 'count', 2024, '160+ entreprises dans lenergie climat'),
  ('climate_tech_energy', 'top_companies', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Sun King, CrossBoundary, d.Light, Zola, Bboxx, Lumos, Husk Power, Daystar Power, Azuri, Candi Solar'),
  
  -- Agritech & Forets (50% des entreprises actives)
  ('climate_tech_agri', 'companies_share_pct', 'Afrique subsaharienne', NULL, 50, NULL, '%', 2024, 'Agritech + forets = pres de 50% des entreprises actives'),
  ('climate_tech_agri', 'company_count', 'Afrique subsaharienne', NULL, 230, NULL, 'count', 2024, '230+ entreprises agritech/forets/usage des terres'),
  ('climate_tech_agri', 'top_companies', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'SunCulture (irrigation solaire+credits carbone), Apollo Agriculture, Aerobotics, Pula (assurance), Farmerline'),
  
  -- Transport bas carbone
  ('climate_tech_transport', 'ev_share_pct', 'Afrique subsaharienne', NULL, 65, NULL, '%', 2024, '65% des entreprises transport = vehicules electriques'),
  ('climate_tech_transport', 'company_count', 'Afrique subsaharienne', NULL, 35, NULL, 'count', 2024, '~35 entreprises transport bas carbone'),
  ('climate_tech_transport', 'top_companies', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'BasiGo (Kenya), ROAM (Kenya), MAX (Nigeria), Spiro, Moove'),

  -- Villes, Industries, Chaine du froid
  ('climate_tech_cities', 'cold_chain_share_pct', 'Afrique subsaharienne', NULL, 40, NULL, '%', 2024, '40%+ de ce segment = logistique chaine du froid'),
  ('climate_tech_cities', 'company_count', 'Afrique subsaharienne', NULL, 60, NULL, 'count', 2024, '~60 entreprises villes/industries/equipements'),
  ('climate_tech_cities', 'top_companies', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Koolboks (froid solaire), Keep IT Cool'),

  -- Dechets et economie circulaire
  ('climate_tech_waste', 'company_count', 'Afrique subsaharienne', NULL, 20, NULL, 'count', 2024, 'Segment croissant en zones urbaines'),
  ('climate_tech_waste', 'top_companies', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Wecyclers, Scrapays, Coliba (CI - recyclage plastique), Gjenge Makers');

-- ── Metriques financieres Climate Tech ──
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  ('climate_tech', 'capital_intensity', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Intensite capitalistique elevee vs SaaS. Periodes de maturation longues. Tester marges en phase pilote.'),
  ('climate_tech', 'affordability_constraint', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Consommateurs sensibles aux prix = contrainte majeure. Modeles PAYG (pay-as-you-go) dominants.'),
  ('climate_tech', 'carbon_credit_pilot_usd', 'Kenya', 2000000, 6000000, NULL, 'USD', 2024, 'BII + Shell Foundation: 2M$ + 4M$ pour mecanisme credits carbone SunCulture'),
  ('climate_tech', 'mitigation_startups', 'Afrique subsaharienne', NULL, 344, NULL, 'count', 2024, '344 startups dattenuation (vs 139 adaptation)'),
  ('climate_tech', 'adaptation_startups', 'Afrique subsaharienne', NULL, 139, NULL, 'count', 2024, '139 startups dadaptation');

-- ── Enrichissement secteurs existants ──
INSERT OR IGNORE INTO kb_benchmarks (sector, metric, region, value_low, value_median, value_high, unit, year, notes)
VALUES
  -- Energie (enrichir les 2 metriques existantes)
  ('energy', 'solar_offgrid_leaders', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Leaders PAYG solar: Sun King, d.Light, Bboxx, Zola, Lumos, Azuri. Chacun >50M$ leves'),
  ('energy', 'solar_commercial_leaders', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Leaders solar C&I: Daystar Power, CrossBoundary, Candi Solar'),
  ('energy', 'minigrid_leaders', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Leaders mini-reseaux: Husk Power Systems'),
  ('energy', 'clean_cooking_emerging', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Cuisson propre: segment emergent, potentiel impact carbone eleve'),
  ('energy', 'cote_ivoire_tva_solar', 'Cote dIvoire', NULL, 0, NULL, '%', 2024, 'Exoneration TVA equipements solaires en CI depuis 2024'),
  
  -- Agritech
  ('agritech', 'solar_irrigation_model', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'SunCulture: modele innovant irrigation solaire + monetisation credits carbone (Pay-As-You-Grow)'),
  ('agritech', 'crop_insurance_leaders', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Pula: leader assurance agricole parametrique'),
  ('agritech', 'precision_ag_leaders', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Aerobotics: agriculture de precision, imagerie drone/satellite'),
  ('agritech', 'market_access_leaders', 'Afrique subsaharienne', NULL, NULL, NULL, 'text', 2024, 'Farmerline: acces aux marches pour petits exploitants');

-- ================================================================
-- 4. PARAMETRES REGLEMENTAIRES CLIMAT
-- ================================================================

INSERT OR IGNORE INTO kb_fiscal_params (country, zone, param_code, param_label, value, unit, effective_date, notes)
VALUES
  ('CI', 'UEMOA', 'tva_solar_exemption', 'Exoneration TVA equipements solaires', 0, '%', '2024-01-01', 'Cote dIvoire: exoneration TVA sur equipements de production denergie solaire depuis 2024. Source: CATAL1.5T'),
  ('SN', 'UEMOA', 'plastic_ban', 'Interdiction plastiques a usage unique', 1, 'boolean', '2020-01-01', 'Senegal: interdiction des plastiques a usage unique depuis 2020. Stimule le marche du recyclage. Source: CATAL1.5T');

-- ================================================================
-- 5. SOURCES ADDITIONNELLES (OSE, programmes, institutions)
-- ================================================================

INSERT OR IGNORE INTO kb_sources (category, name, description, url, region, relevance_score)
VALUES
  ('funder', 'CATAL1.5T Programme', 'Programme de pre-acceleration et acceleration pour startups climat. Finance par GCF et BMZ. Cible Afrique de lOuest francophone et Amerique latine.', NULL, 'Afrique de lOuest', 90),
  ('institution', 'Kenya Climate Innovation Center (KCIC)', 'Incubateur climat focalise energie propre et agritech resiliente au Kenya.', NULL, 'Kenya', 85),
  ('institution', 'Ghana Climate Innovation Centre (GCIC)', 'Centre dinnovation climat au Ghana. Focus PME et innovation frugale.', NULL, 'Ghana', 80),
  ('institution', 'Bond Innov', 'Partenaire dacceleration pour startups climat en Afrique de lOuest.', NULL, 'Afrique de lOuest', 75),
  ('institution', 'Climate KIC', 'Premiere agence europeenne dediee a linnovation climatique. Coordonne solutions de transformation systemique.', 'https://www.climate-kic.org', 'Global', 75),
  ('institution', 'GIZ develoPPP Ventures', 'Programme GIZ de matching funds pour startups innovantes.', NULL, 'Global', 70),
  ('institution', 'UN Global Cleantech Innovation Programme', 'Programme multilateral ONU pour les technologies propres.', NULL, 'Global', 70),
  ('institution', 'JICA NINJA Accelerator', 'Programme dacceleration de la JICA pour startups tech.', NULL, 'Global', 65),
  ('institution', 'UNICEF Startup Lab', 'Programme multilateral UNICEF pour linnovation sociale/environnementale en phase demarrage.', NULL, 'Global', 65);

-- ================================================================
-- 6. NOUVEAU CRITERE EVALUATION: Impact Climatique
-- ================================================================

INSERT OR IGNORE INTO kb_evaluation_criteria (dimension, criterion_code, criterion_label, description, weight, max_score, scoring_guide, required_documents, funder_relevance)
VALUES
  ('impact_social', 'is_impact_climatique', 'Impact Climatique', 
   'Mesure de limpact climatique: tonnes CO2 evitees/sequestrees, beneficiaires directs resilience, alignement CDN nationaux.',
   2.0, 100,
   '{"0-30":"Aucune mesure dimpact climat","30-50":"Impact climat mentionne mais non quantifie","50-70":"Metriques climat definies (tCO2, beneficiaires)","70-85":"Metriques climat mesurees et verifiables","85-100":"Impact climat certifie, alignement CDN, credits carbone"}',
   '["sic","bmc"]',
   '{"gcf":"critical","bii":"high","proparco":"high","afdb":"medium","giz":"high","usaid":"medium"}'
  ),
  ('impact_social', 'is_genre_inclusion', 'Genre et Inclusion',
   'Prise en compte du genre dans le modele: acces des femmes, leadership feminin, beneficiaires femmes.',
   1.5, 100,
   '{"0-30":"Aucune donnee genre","30-50":"Mention du genre sans metriques","50-70":"Donnees genre collectees","70-85":"Strategie genre implementee, >40% beneficiaires femmes","85-100":"Leadership feminin, certification genre, impact mesure"}',
   '["sic","bmc"]',
   '{"enabel":"high","giz":"high","afdb":"medium","usaid":"high","gcf":"medium"}'
  );
