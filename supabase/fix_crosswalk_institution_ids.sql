-- =============================================================================
-- company_crosswalk の OpenAlex機関ID不足を修正
-- =============================================================================
-- 背景:
--   バースト検知機能の検証中、Apple社の論文データに医療系ジャーナルが
--   多数混入していることから調査したところ、実際の原因はデータ誤りではなく
--   「company_crosswalk に登録されている機関IDが1つ（本社所在国のみ）しか
--   なく、OpenAlex上で別IDに分かれている主要な拠点・子会社の論文が
--   丸ごと欠落している」という取り込み範囲の不完全性だった。
--
--   openalex_institution_candidates.json（当初のマッピング候補一覧）と
--   実際の company_crosswalk を全80社で突き合わせ、type=company かつ
--   works_count>=200 件の拠点のうち、crosswalk未登録のものを特定。
--   本ファイルはその不足分をcrosswalkに追加するUPDATE文（40社分）。
--
-- 対象外（本ファイルでは変更しない）:
--   ・catl, dassault, esteelauder, haleon, kose, lghh, murata, polaorbis
--     → そもそも openalex_institution_ids が null（未マッピング）。別対応が必要。
--   ・tesla
--     → 候補に出た "Ericsson (Croatia)" 等は発明家ニコラ・テスラに由来する
--       無関係な組織（誤検知）。現状の1件登録が正しいため変更なし。
--   ・loreal, nec
--     → crosswalkに登録済みのIDが候補ファイルに存在せず、正誤を確認できない。
--       別途手動でOpenAlex上の正しい機関IDを確認する必要がある。
--
-- 実行後に必要な作業:
--   crosswalkを直すだけでは openalex.works の既存データは変わらない。
--   下記UPDATE後、ハーベスタを対象企業だけ再実行する必要がある:
--     ONLY_SLUGS=apple,microsoft,... node openalex-harvester-all.mjs
--   （ONLY_SLUGS対応は openalex-harvester-all.mjs 側に追加済み）
--
-- 実行場所: Supabase Dashboard → SQL Editor
-- =============================================================================

UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I45928872', 'I4210095624', 'I4210086143']::text[] WHERE canonical_slug = 'alibaba';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1311688040', 'I4210089985', 'I4210123934']::text[] WHERE canonical_slug = 'amazon';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210153776', 'I1311269955', 'I4210107260', 'I4210141230']::text[] WHERE canonical_slug = 'apple';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I889804353', 'I4210120115', 'I4210151956', 'I4210127256', 'I4210145457', 'I4210156055']::text[] WHERE canonical_slug = 'bosch';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1320697193', 'I4210119835', 'I4210105067', 'I4399598468']::text[] WHERE canonical_slug = 'canon';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210135004', 'I305386']::text[] WHERE canonical_slug = 'colgate';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210132650', 'I67530263']::text[] WHERE canonical_slug = 'denso';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1306339040', 'I4210139236', 'I4210131589', 'I4210094041', 'I4210159398', 'I4210126170', 'I4210163994', 'I4210134493', 'I4210149044']::text[] WHERE canonical_slug = 'ericsson';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I2252096349', 'I4210094759', 'I4210159607', 'I4210153853']::text[] WHERE canonical_slug = 'fujitsu';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210090411', 'I1291425158', 'I4210100430', 'I4210113297', 'I4210117425', 'I4210148186']::text[] WHERE canonical_slug = 'google';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I71187865', 'I4210111733']::text[] WHERE canonical_slug = 'henkel';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I65143321', 'I4210089357', 'I86725329', 'I4210137426', 'I4387156034', 'I4210108607', 'I4210157168', 'I4210107938', 'I4210118907']::text[] WHERE canonical_slug = 'hitachi';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I2250955327', 'I4210160618', 'I4210159102', 'I4210146936', 'I4210115038', 'I4210123571', 'I4210129353']::text[] WHERE canonical_slug = 'huawei';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1341412227', 'I4210126794', 'I4210113654']::text[] WHERE canonical_slug = 'ibm';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1343180700', 'I4210158342', 'I4210094487', 'I4210142644', 'I4210146682', 'I4210104622', 'I131781684', 'I4210133876']::text[] WHERE canonical_slug = 'intel';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1330063522', 'I4210135437', 'I4210140598', 'I4210160666', 'I4210157709', 'I4210110219']::text[] WHERE canonical_slug = 'jnjconsumer';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I207623266', 'I4210105503']::text[] WHERE canonical_slug = 'kao';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210114444', 'I2252078561', 'I4210111288', 'I4210118911']::text[] WHERE canonical_slug = 'meta';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1290206253', 'I4210164937', 'I4210113369', 'I4210086099', 'I4210124949', 'I4210105678', 'I4400600948', 'I4210087053', 'I4210125051', 'I4210153468']::text[] WHERE canonical_slug = 'microsoft';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210133125', 'I4210159266', 'I39854257', 'I4210149377', 'I4210089619', 'I4210133619']::text[] WHERE canonical_slug = 'mitsubishie';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I2738502077', 'I72090969', 'I4210159457', 'I4210149358', 'I4210099903', 'I4210106018', 'I63162264', 'I4210098141', 'I4210105201', 'I4210160875']::text[] WHERE canonical_slug = 'nokia';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I2251713219', 'I4210092597', 'I4210090123']::text[] WHERE canonical_slug = 'ntt';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210127875', 'I1304085615']::text[] WHERE canonical_slug = 'nvidia';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1342911587', 'I4210165642']::text[] WHERE canonical_slug = 'oracle';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1283155146', 'I4210155557', 'I4210095956', 'I4210122264', 'I4210086863']::text[] WHERE canonical_slug = 'panasonic';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I74680897', 'I4210128863', 'I4210115918', 'I4210102648', 'I4210114316', 'I4210108292']::text[] WHERE canonical_slug = 'pg';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210122849', 'I1329325741', 'I4210131230', 'I4210162505', 'I2890193189', 'I4210133649', 'I4210086647', 'I4210165709', 'I4210159858', 'I4210118413']::text[] WHERE canonical_slug = 'philips';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210087596', 'I19268510']::text[] WHERE canonical_slug = 'qualcomm';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210115825', 'I4210125531', 'I51036467']::text[] WHERE canonical_slug = 'reckitt';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210153176', 'I75636454']::text[] WHERE canonical_slug = 'renesas';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I2250650973', 'I4210101778', 'I4210139030', 'I4210117523', 'I4210155230', 'I4387155180', 'I4210141363', 'I4210121247']::text[] WHERE canonical_slug = 'samsung';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210132444', 'I4210133614', 'I4210117871', 'I4210125512', 'I4210113521']::text[] WHERE canonical_slug = 'sap';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1325886976', 'I4210137693', 'I4210153902', 'I4210151799', 'I51629411', 'I4210127033', 'I105695857', 'I4210114920', 'I4210160616', 'I4210126633']::text[] WHERE canonical_slug = 'siemens';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210142504', 'I1311218312']::text[] WHERE canonical_slug = 'smic';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210120159', 'I4210118101']::text[] WHERE canonical_slug = 'softbank';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I2800278093', 'I4210122684', 'I4210143797', 'I1304132090']::text[] WHERE canonical_slug = 'sony';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210165351', 'I4391768151', 'I4210137853', 'I1293612202', 'I4210093665', 'I917207718', 'I4210120547']::text[] WHERE canonical_slug = 'toyota';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210120917', 'I4210119559', 'I1334877674']::text[] WHERE canonical_slug = 'tsmc';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I1342131907', 'I4210113155', 'I4210100606', 'I4210124316', 'I4210103721', 'I4210119897']::text[] WHERE canonical_slug = 'unilever';
UPDATE integration.company_crosswalk SET openalex_institution_ids = ARRAY['I4210098582', 'I75746372']::text[] WHERE canonical_slug = 'zte';

-- ---------------------------------------------------------------------------
-- 動作確認: 各社の登録件数が増えていることを確認
-- ---------------------------------------------------------------------------
-- SELECT canonical_slug, array_length(openalex_institution_ids,1) AS id_count
-- FROM integration.company_crosswalk
-- WHERE canonical_slug IN ('apple','microsoft','siemens','philips','meta','nvidia')
-- ORDER BY canonical_slug;
