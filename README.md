# 発注書ワークスペース

発注が入ったときに、必要情報を入力して発注書PDFを作り、必要なら電子印影を載せて、金額をGoogle Spreadsheetへ送るための軽量なWebアプリです。

## できること

- 発注情報の入力
- 電子印影画像のアップロード
- 発注書PDFの自動生成
- Google Apps ScriptのWebhook経由でSpreadsheetへ金額を追記

## ローカル起動

```bash
npm install
npm start
```

ブラウザで `http://localhost:3000` を開いてください。

## Web公開

このリポジトリは `Render` にそのまま載せられる構成です。`render.yaml` と `Dockerfile` を追加してあるので、GitHubへpushしてRenderで `Blueprint` デプロイを使うと公開できます。

### Renderでの手順

1. GitHubにこのリポジトリをpush
2. Renderで `New +` → `Blueprint`
3. リポジトリを接続
4. 環境変数 `SPREADSHEET_WEBHOOK_URL` を設定
5. デプロイ完了後、発行されたURLを共有

コンテナ内で `fonts-noto-cjk` を入れるため、Linux環境でも日本語PDFを生成できます。

## 環境変数

`SPREADSHEET_WEBHOOK_URL` を設定すると、発注作成時にPOST送信します。

```bash
SPREADSHEET_WEBHOOK_URL="https://script.google.com/macros/s/xxxxx/exec" npm start
```

## Spreadsheet連携の想定

Google Apps Script側で `doPost(e)` を作り、JSONを受けてシートへ1行追加する構成を想定しています。送信されるキーは以下です。

- `issueDate`
- `dueDate`
- `orderTitle`
- `clientName`
- `amount`
- `taxRate`
- `itemDescription`
- `notes`

サンプルは [docs/google-apps-script.js](/Users/jiei88281028/Desktop/gemini_test/docs/google-apps-script.js) に入っています。GASをWebアプリとしてデプロイして、発行されたURLを `SPREADSHEET_WEBHOOK_URL` に設定してください。

## 補足

- PDFは `uploads/` に保存されます。
- 印影画像も `uploads/` に保存されます。
- 日本語フォントはmacOSのシステムフォントを利用しています。
- ワークスペースに保存できない場合は `/tmp/gemini_test_uploads` へ自動退避します。
- クラウド環境では `uploads/` は永続化されないことがあります。長期保存が必要なら、次の段階で `S3` や `Cloudflare R2` などへ保存先を切り出すのがおすすめです。
