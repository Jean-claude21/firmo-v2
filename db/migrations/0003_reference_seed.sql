-- 0003 — Valeurs de départ des référentiels (spec 001).
-- Ce sont des données : l'administration les modifie (ADM-5). Taux de taxe indicatifs, à
-- confirmer pays par pays avant l'ouverture commerciale.

insert into public.currencies (code, labels, minor_units, symbol, symbol_before, thousands_separator, decimal_separator) values
  ('XOF', '{"fr":"Franc CFA (UEMOA)","en":"West African CFA franc"}', 0, 'F CFA', false, ' ', ','),
  ('XAF', '{"fr":"Franc CFA (CEMAC)","en":"Central African CFA franc"}', 0, 'F CFA', false, ' ', ','),
  ('GNF', '{"fr":"Franc guinéen","en":"Guinean franc"}', 0, 'FG', false, ' ', ','),
  ('RWF', '{"fr":"Franc rwandais","en":"Rwandan franc"}', 0, 'FRw', false, ' ', ','),
  ('CDF', '{"fr":"Franc congolais","en":"Congolese franc"}', 2, 'FC', false, ' ', ','),
  ('GHS', '{"fr":"Cedi","en":"Ghanaian cedi"}', 2, 'GH₵', true, ',', '.'),
  ('NGN', '{"fr":"Naira","en":"Nigerian naira"}', 2, '₦', true, ',', '.'),
  ('KES', '{"fr":"Shilling kényan","en":"Kenyan shilling"}', 2, 'KSh', true, ',', '.'),
  ('MAD', '{"fr":"Dirham marocain","en":"Moroccan dirham"}', 2, 'DH', false, ' ', ','),
  ('EUR', '{"fr":"Euro","en":"Euro"}', 2, '€', false, ' ', ','),
  ('USD', '{"fr":"Dollar américain","en":"US dollar"}', 2, '$', true, ',', '.');

insert into public.countries (code, labels, currency_code, phone_prefix, default_locale, legal_ids) values
  ('TG', '{"fr":"Togo","en":"Togo"}', 'XOF', '228', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"nif","labels":{"fr":"NIF","en":"Tax ID"}}]'),
  ('BJ', '{"fr":"Bénin","en":"Benin"}', 'XOF', '229', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"ifu","labels":{"fr":"IFU","en":"Tax ID"}}]'),
  ('CI', '{"fr":"Côte d''Ivoire","en":"Côte d''Ivoire"}', 'XOF', '225', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"cc","labels":{"fr":"Compte contribuable","en":"Tax ID"}}]'),
  ('SN', '{"fr":"Sénégal","en":"Senegal"}', 'XOF', '221', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"ninea","labels":{"fr":"NINEA","en":"Tax ID"}}]'),
  ('BF', '{"fr":"Burkina Faso","en":"Burkina Faso"}', 'XOF', '226', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"ifu","labels":{"fr":"IFU","en":"Tax ID"}}]'),
  ('ML', '{"fr":"Mali","en":"Mali"}', 'XOF', '223', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"nif","labels":{"fr":"NIF","en":"Tax ID"}}]'),
  ('NE', '{"fr":"Niger","en":"Niger"}', 'XOF', '227', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"nif","labels":{"fr":"NIF","en":"Tax ID"}}]'),
  ('GN', '{"fr":"Guinée","en":"Guinea"}', 'GNF', '224', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"nif","labels":{"fr":"NIF","en":"Tax ID"}}]'),
  ('CM', '{"fr":"Cameroun","en":"Cameroon"}', 'XAF', '237', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"niu","labels":{"fr":"NIU","en":"Tax ID"}}]'),
  ('GA', '{"fr":"Gabon","en":"Gabon"}', 'XAF', '241', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"nif","labels":{"fr":"NIF","en":"Tax ID"}}]'),
  ('CG', '{"fr":"Congo","en":"Congo"}', 'XAF', '242', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"niu","labels":{"fr":"NIU","en":"Tax ID"}}]'),
  ('TD', '{"fr":"Tchad","en":"Chad"}', 'XAF', '235', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"nif","labels":{"fr":"NIF","en":"Tax ID"}}]'),
  ('CD', '{"fr":"RD Congo","en":"DR Congo"}', 'CDF', '243', 'fr', '[{"code":"rccm","labels":{"fr":"RCCM","en":"Trade register"}},{"code":"nif","labels":{"fr":"NIF","en":"Tax ID"}}]'),
  ('RW', '{"fr":"Rwanda","en":"Rwanda"}', 'RWF', '250', 'en', '[{"code":"tin","labels":{"fr":"TIN","en":"TIN"}}]'),
  ('GH', '{"fr":"Ghana","en":"Ghana"}', 'GHS', '233', 'en', '[{"code":"tin","labels":{"fr":"TIN","en":"TIN"}}]'),
  ('NG', '{"fr":"Nigeria","en":"Nigeria"}', 'NGN', '234', 'en', '[{"code":"rc","labels":{"fr":"RC","en":"RC number"}},{"code":"tin","labels":{"fr":"TIN","en":"TIN"}}]'),
  ('KE', '{"fr":"Kenya","en":"Kenya"}', 'KES', '254', 'en', '[{"code":"kra_pin","labels":{"fr":"PIN KRA","en":"KRA PIN"}}]'),
  ('MA', '{"fr":"Maroc","en":"Morocco"}', 'MAD', '212', 'fr', '[{"code":"rc","labels":{"fr":"RC","en":"Trade register"}},{"code":"ice","labels":{"fr":"ICE","en":"ICE"}}]'),
  ('FR', '{"fr":"France","en":"France"}', 'EUR', '33', 'fr', '[{"code":"siret","labels":{"fr":"SIRET","en":"SIRET"}}]'),
  ('BE', '{"fr":"Belgique","en":"Belgium"}', 'EUR', '32', 'fr', '[{"code":"bce","labels":{"fr":"N° d''entreprise","en":"Company number"}}]');

insert into public.taxes (country_code, code, labels, rate_bp, is_default) values
  ('TG', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('BJ', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('CI', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('SN', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('BF', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('ML', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('NE', 'tva', '{"fr":"TVA","en":"VAT"}', 1900, true),
  ('GN', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('CM', 'tva', '{"fr":"TVA","en":"VAT"}', 1925, true),
  ('GA', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('CG', 'tva', '{"fr":"TVA","en":"VAT"}', 1890, true),
  ('TD', 'tva', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('CD', 'tva', '{"fr":"TVA","en":"VAT"}', 1600, true),
  ('RW', 'vat', '{"fr":"TVA","en":"VAT"}', 1800, true),
  ('GH', 'vat', '{"fr":"TVA","en":"VAT"}', 1500, true),
  ('NG', 'vat', '{"fr":"TVA","en":"VAT"}', 750, true),
  ('KE', 'vat', '{"fr":"TVA","en":"VAT"}', 1600, true),
  ('MA', 'tva', '{"fr":"TVA","en":"VAT"}', 2000, true),
  ('FR', 'tva', '{"fr":"TVA","en":"VAT"}', 2000, true),
  ('BE', 'tva', '{"fr":"TVA","en":"VAT"}', 2100, true);

insert into public.units (code, labels, short_labels, position) values
  ('unit', '{"fr":"unité","en":"unit"}', '{"fr":"u","en":"pc"}', 1),
  ('lump_sum', '{"fr":"forfait","en":"lump sum"}', '{"fr":"forfait","en":"lump sum"}', 2),
  ('m', '{"fr":"mètre","en":"metre"}', '{"fr":"m","en":"m"}', 3),
  ('lm', '{"fr":"mètre linéaire","en":"linear metre"}', '{"fr":"ml","en":"lm"}', 4),
  ('m2', '{"fr":"mètre carré","en":"square metre"}', '{"fr":"m²","en":"m²"}', 5),
  ('m3', '{"fr":"mètre cube","en":"cubic metre"}', '{"fr":"m³","en":"m³"}', 6),
  ('kg', '{"fr":"kilogramme","en":"kilogram"}', '{"fr":"kg","en":"kg"}', 7),
  ('t', '{"fr":"tonne","en":"tonne"}', '{"fr":"t","en":"t"}', 8),
  ('l', '{"fr":"litre","en":"litre"}', '{"fr":"l","en":"l"}', 9),
  ('h', '{"fr":"heure","en":"hour"}', '{"fr":"h","en":"h"}', 10),
  ('day', '{"fr":"jour","en":"day"}', '{"fr":"j","en":"day"}', 11),
  ('bag', '{"fr":"sac","en":"bag"}', '{"fr":"sac","en":"bag"}', 12),
  ('trip', '{"fr":"voyage","en":"trip"}', '{"fr":"voyage","en":"trip"}', 13),
  ('lot', '{"fr":"lot","en":"lot"}', '{"fr":"lot","en":"lot"}', 14),
  ('km', '{"fr":"kilomètre","en":"kilometre"}', '{"fr":"km","en":"km"}', 15);

insert into public.trades (code, labels, units, position) values
  ('masonry', '{"fr":"Maçonnerie, bâtiment","en":"Masonry, building"}', '{m2,m3,bag,trip,unit,lump_sum,day}', 1),
  ('carpentry', '{"fr":"Menuiserie","en":"Carpentry"}', '{unit,m2,lm,lump_sum}', 2),
  ('metalwork', '{"fr":"Chaudronnerie, métallerie, soudure","en":"Metalwork, welding"}', '{unit,kg,m,lm,m2,lump_sum}', 3),
  ('plumbing', '{"fr":"Plomberie","en":"Plumbing"}', '{unit,m,lump_sum,h}', 4),
  ('electricity', '{"fr":"Électricité","en":"Electrical work"}', '{unit,m,lump_sum,h}', 5),
  ('painting', '{"fr":"Peinture, décoration","en":"Painting, decoration"}', '{m2,unit,l,lump_sum,day}', 6),
  ('tailoring', '{"fr":"Couture, mode","en":"Tailoring, fashion"}', '{unit,m,lot}', 7),
  ('mechanics', '{"fr":"Mécanique, garage","en":"Mechanics, garage"}', '{unit,h,lump_sum,l}', 8),
  ('catering', '{"fr":"Traiteur, restauration","en":"Catering"}', '{unit,kg,lot,lump_sum}', 9),
  ('repair', '{"fr":"Réparation, électronique","en":"Repair, electronics"}', '{unit,h,lump_sum}', 10),
  ('services', '{"fr":"Conseil, services","en":"Consulting, services"}', '{h,day,lump_sum,unit}', 11),
  ('trade', '{"fr":"Commerce","en":"Retail, trade"}', '{unit,kg,l,bag,lot}', 12),
  ('other', '{"fr":"Autre métier","en":"Other trade"}', '{unit,lump_sum,h,day}', 99);

insert into public.document_types (code, labels, number_prefix, counts_quota, acceptable, validity_days, payable, position) values
  ('quote', '{"fr":"Devis","en":"Quote"}', 'DEV', true, true, 30, false, 1),
  ('proforma', '{"fr":"Facture proforma","en":"Pro forma invoice"}', 'PRO', true, true, 30, false, 2),
  ('invoice', '{"fr":"Facture","en":"Invoice"}', 'FAC', true, false, null, true, 3),
  ('receipt', '{"fr":"Reçu","en":"Receipt"}', 'REC', false, false, null, false, 4),
  ('delivery_note', '{"fr":"Bon de livraison","en":"Delivery note"}', 'BL', false, false, null, false, 5);

insert into public.templates (code, labels, descriptions, position) values
  ('classic', '{"fr":"Classique","en":"Classic"}', '{"fr":"Sobre et rassurant, en-tête encadré.","en":"Sober and reassuring, framed header."}', 1),
  ('modern', '{"fr":"Moderne","en":"Modern"}', '{"fr":"Bandeau de couleur, chiffres mis en avant.","en":"Colour band, figures up front."}', 2),
  ('clean', '{"fr":"Épuré","en":"Clean"}', '{"fr":"Beaucoup d''air, typographie fine.","en":"Airy, light typography."}', 3);

insert into public.channels (code, labels, enabled) values
  ('simulator', '{"fr":"Simulateur","en":"Simulator"}', true),
  ('telegram', '{"fr":"Telegram","en":"Telegram"}', false),
  ('whatsapp', '{"fr":"WhatsApp","en":"WhatsApp"}', false);

insert into public.ai_tasks (task, labels, model) values
  ('transcribe', '{"fr":"Transcription des notes vocales","en":"Voice note transcription"}', 'gpt-4o-mini-transcribe'),
  ('read', '{"fr":"Lecture d''une vente (texte ou photo)","en":"Reading a sale (text or photo)"}', 'gpt-5.4-mini'),
  ('intent', '{"fr":"Compréhension des demandes","en":"Understanding requests"}', 'gpt-5.4-mini');

insert into public.feature_flags (key, enabled, description) values
  ('whatsapp_flows', false, 'Formulaires dans WhatsApp (compte Meta vérifié requis) ; sinon lien vers le formulaire web.'),
  ('png_preview', true, 'Envoyer l''aperçu image du document dans le chat.');

insert into public.settings (key, value, description) values
  ('default_country', '"TG"', 'Pays d''une organisation dont le numéro ne correspond à aucun pays.'),
  ('portal_link_minutes', '15', 'Durée de validité d''un lien d''accès envoyé dans le chat.'),
  ('org_session_days', '7', 'Durée d''une session artisan sur le web.'),
  ('staff_session_hours', '12', 'Durée d''une session d''administration.'),
  ('share_link_days', '180', 'Durée de validité d''un lien de partage de document.');
