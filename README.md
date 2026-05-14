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

## テスト
Gateway統合テストを実行:
```bash
npm --workspace apps/gateway run test:run
```

## 本番Codexアダプタ（CLI連携）
Gatewayは `mock` と `cli` の2種類のCodexアダプタを切り替えられます。

- デフォルト: `mock`
- 本番連携: `CODEX_BACKEND=cli`

利用可能な環境変数:
- `CODEX_BACKEND`: `mock` または `cli`
- `CODEX_CLI_COMMAND`: 実行するCLIコマンド名（既定: `codex`）
- `CODEX_CLI_ARGS`: CLI引数（JSON配列または空白区切り文字列）
- `CODEX_CLI_PROMPT_MODE`: `stdin`（既定）または `arg`
- `CODEX_CLI_TIMEOUT_MS`: タイムアウトms（既定: `120000`）

例: Codex CLI を `stdin` 入力で使う
```bash
CODEX_BACKEND=cli \
CODEX_CLI_COMMAND=codex \
CODEX_CLI_ARGS='["chat"]' \
npm run dev:gateway
```

例: プロンプトを引数で渡す
```bash
CODEX_BACKEND=cli \
CODEX_CLI_COMMAND=codex \
CODEX_CLI_PROMPT_MODE=arg \
npm run dev:gateway
```

テスト内容:
- Health API
- PIN認証（正常系・異常系）
- セッション管理
- コマンド実行
- ログAPI

## LAN実機検証手順
1. PC側で起動:
   ```bash
   npm run dev:gateway
   npm run dev:mobile
   ```

2. PCの LAN IP を確認:
   ```bash
   ifconfig
   ```
   （`en0` 等の `inet` アドレスを記録, 例: `192.168.1.10`）

3. スマホで `http://<LAN IP>:5173` にアクセス

4. 検証項目（`context/lan-test-plan.md` 参照）:
   - mDNS/手動IP接続
   - PIN認証
   - コマンド実行とストリーム表示
   - ログ取得とページネーション
   - Wi-Fi 切断/再接続での再接続
