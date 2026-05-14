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
1. PCブラウザなら `http://localhost:5173` を開く
2. スマホから開く場合は、PCのLAN IPで `http://<PCのLAN IP>:5173` を開く
3. API Hostを `http://<PCのLAN IP>:8000` に設定
4. PINに `123456` を入力してログイン
5. セッション開始 -> コマンド実行

### スマホ接続の補足
- `localhost` はスマホ自身を指すため、PCのGatewayには接続できない
- macOSでLAN IPを確認する例:

```bash
ifconfig
```

- `en0` や `en1` の `inet`（例: `192.168.x.x`）を利用する

## ビルド
```bash
npm run build
```
