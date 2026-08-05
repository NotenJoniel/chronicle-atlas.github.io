# Chronicle Atlas

世界史のタイムラインを視覚的に表現し、**「同じ時代に各地域で何が起きていたか」を比較できる**サイト。
最終到達点は、複数文明を同一の時間軸に重ねる**横串ビュー（同時代比較）**。

## 作業を始める前に必ず読むこと

| ドキュメント | 内容 |
|---|---|
| [.agents/DESIGN.md](.agents/DESIGN.md) | **設計思想・不変条件・判断基準**。実装判断に迷ったらここ |
| [.agents/BACKLOG.md](.agents/BACKLOG.md) | 技術課題・タスクリスト |

## 最低限の約束事（詳細は DESIGN.md）

- **年は整数、紀元前は負数**（`-260` = BC260）。表示文字列はデータに持たせない
- **分類カテゴリは全時代共通の4つ**：`battle` / `politics` / `episode` / `death`
- **フィールド名は camelCase 統一**：`eraPhases` `factions` `categories` `characters` `events` `mapSnapshots` `wikiLinks`
- **JSONはPretty-print**（minify禁止 — diffが壊れると部分編集ができなくなる）
- データ変更後は必ず `node data/validate.js` で **0 errors** を確認する
- 時代固有の値をコードに直書きしない（「他の時代では違う値になるもの」はすべてデータ層）

## ローカルでブラウザ確認する

静的サイトだが `fetch` でJSONを読むため `file://` では動かない。ローカルHTTPサーバーが必要。

- **起動**: `tools\serve.bat` をダブルクリック（または実行）→ ブラウザが自動で `http://localhost:8420/index.html` を開く
- **停止**: `tools\stop-serve.bat` を実行、またはサーバーのコンソールウィンドウを閉じる / Ctrl+C
- ポートを変えたい場合は引数で指定可（例: `tools\serve.bat 8080`）。`stop-serve.bat` も同じポート番号を渡すこと

## Git運用（必須）

`main` = 本番デプロイ（GitHub Pages）

1. 作業は **`develop` ブランチ**
2. ブラウザで動作確認 → ユーザーに報告
3. **ユーザー承認後**に `main` へマージ

> 絶対に未確認のコードを `main` にプッシュしない。

## 構成

```
data/
  schema.json          共通スキーマ（型定義）
  index.json           タイムライン一覧（メタ情報）
  validate.js          バリデーション: node data/validate.js
  timelines/*.json     各時代のデータ（7本）
<timeline-id>/         サブプロジェクト: app.js + styles.css + index.html
index.html             トップページ
```
