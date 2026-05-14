# Codex Interface

このディレクトリは、同一LAN内のPCで動くCodexをスマホから操作・閲覧するアプリの設計コンテキストです。

## ドキュメント一覧
- 要件コンテキスト: `context/context.md`
- 機械可読コンテキスト: `context.json`
- 高レベルアーキテクチャ: `context/architecture.md`
- API仕様: `context/api-spec.md`
- セキュリティ設計: `context/security-design.md`
- データモデル: `context/data-model.md`
- モバイルUIフロー: `context/mobile-ui-flow.md`
- MVPロードマップ: `context/mvp-roadmap.md`
- 技術選定: `context/tech-selection.md`
- LAN実機テスト計画: `context/lan-test-plan.md`
- デプロイ/ネットワーク設計: `context/deployment-network.md`
- 拡張ロードマップ: `context/extension-roadmap.md`

## 設計の使い方
1. `context/context.md` で全体像を把握
2. `context/architecture.md` と `context/api-spec.md` を実装の起点にする
3. `context/security-design.md` を先に最低限実装する
4. `context/mvp-roadmap.md` 順で実装を進める

## 実装構成（MVP）
- `apps/gateway`: Fastify + WebSocket のローカルGateway
- `apps/mobile-pwa`: スマホ操作用PWA（React + Vite）

## セットアップ
```bash
npm install
```

## 開発起動
ターミナル1:
```bash
npm run dev:gateway
```

ターミナル2:
```bash
npm run dev:mobile
```

## 動作確認
1. PCブラウザなら `http://localhost:5173`、スマホなら `http://<PCのLAN IP>:5173` を開く
2. PINに `123456` を入力してログイン
3. セッション開始 -> コマンド実行

**注**: API HostとWS URLはブラウザのホストから自動推定されるため、手動設定は不要です。

## ビルド
```bash
npm run build
```
