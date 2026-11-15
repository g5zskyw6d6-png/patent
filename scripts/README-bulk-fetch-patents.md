# 特許の一括定期更新(bulk-fetch-patents)

Supabaseの`companies`テーブルに登録済みの「決まった企業リスト」をまとめて
1回のBigQueryクエリで検索し、各社の特許(Google Patents Public Datasets由来、
ファミリー代表1件/発明)をSupabaseの`patents`テーブルへ反映するバッチです。

1社ずつ「特許取得」画面で取得すると、BigQueryは企業数ぶん同じテーブルを
フルスキャンしてしまい課金がかさみます。このスクリプトは全社ぶんを
1回のクエリにまとめることで、課金をほぼ1回分(企業数に関わらず概ね一定)に
抑えます。

## 初回セットアップ

### 1. 必要な鍵・値を集める

- `GCP_PROJECT_ID` : これまでVercelの環境変数に設定したものと同じ(例: `augmented-world-463802-b7`)
- `GCP_SA_KEY_JSON` : これまでVercelの環境変数に設定したものと同じサービスアカウントJSON(1行の文字列)
- `SUPABASE_SERVICE_ROLE_KEY` : Supabaseダッシュボード → Project Settings → API → `service_role` キー
  (※ `anon` キーとは別物。絶対にブラウザ側のコードやリポジトリに書かないこと)
- `SUPABASE_URL` : 省略可(スクリプト内にデフォルト値あり)

### 2. ローカルでドライラン(課金なし)で試す

Macのターミナルで、`patent-intelligence`フォルダに移動して:

```bash
export GCP_PROJECT_ID=augmented-world-463802-b7
export GCP_SA_KEY_JSON="$(cat /path/to/augmented-world-463802-b7-298523de4563.json)"
export SUPABASE_SERVICE_ROLE_KEY=...
export DRY_RUN=true
npm run bulk-fetch-patents
```

スキャン見積もり(TiB数)だけが表示されて終了すれば成功です。想定よりも
大幅に大きい数字が出た場合は、まず`DATE_FROM`/`DATE_TO`を狭めて再確認してください。

### 3. ローカルで本番実行して動作確認

```bash
unset DRY_RUN
npm run bulk-fetch-patents
```

企業ごとの保存件数サマリーが表示されます。Supabaseの`patents`テーブルを
Table Editorで確認し、`family_id`・`claims_independent`・`description_text`
などが入っていればOKです。

### 4. GitHub Actionsで自動定期実行する

リポジトリの Settings → Secrets and variables → Actions → New repository secret
で、以下を登録してください(手順2で使ったものと同じ値):

- `GCP_PROJECT_ID`
- `GCP_SA_KEY_JSON`
- `SUPABASE_URL`(任意)
- `SUPABASE_SERVICE_ROLE_KEY`

登録が終われば、`.github/workflows/bulk-fetch-patents.yml` が毎月1日に自動実行されます。
Actionsタブの「Bulk fetch patents」→「Run workflow」から手動実行することも可能です。
実行頻度を変えたい場合は、ワークフローファイル内の`cron`式を書き換えてください。

## 注意点

- `DATE_TO`を指定しない場合は実行日が自動的に使われるため、毎回最新の公開分まで
  取り直す形になります。`DATE_FROM`は既定で`2024-01-01`です(画面の初期値と同じ)。
- 1回の実行で`companies`テーブルの全社ぶんを洗い替え(DELETE→INSERT)します。
  手動の「特許取得」画面経由で個別に取得した分も、このバッチが流れると
  同じ`patent_number`+`company_id`の組み合わせは上書きされます。
- 合弁・共同出願などで複数企業に同時にマッチした特許は、マッチした全社の
  `patents`行として(重複して)保存されます。
- 誤って巨大なクエリを実行してしまわないよう、`maximumBytesBilled`(既定2TiB)
  を超えそうな場合はBigQuery側でクエリ自体が失敗するようにしてあります。
