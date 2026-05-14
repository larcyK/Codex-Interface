# Codex Interface — プロジェクトコンテキスト

作成日: 2026-05-14

## 目的
同一ローカルネットワーク内にあるPC上で動作するCodex（ローカルAI/プロジェクト）をスマートフォンから操作・閲覧できる管理・操作アプリを作る。まずはLAN内で安全に接続できるMVPを目指す。

## スコープ
- ローカルLAN内のPCとスマホ間の通信のみを一次対象とする（インターネット経由のリモートアクセスは拡張機能として後回し）。
- 対象OS（PC側）: macOS / Linux / Windows（優先はmacOS）
- スマホ: iOS / Android（できるだけPWAまたはクロスプラットフォームで対応）

## 必要機能（MVP）
1. LAN上のCodexサービス検出（mDNS/手動IP）
2. 認証（ローカルPIN、トークン）
3. セッション管理（接続/切断、操作ログ）
4. 操作UI（コマンド実行・停止、簡易ログ閲覧、ステータス表示）
5. リアルタイム双方向通信（WebSocket）
6. 軽量永続化（ログ、設定）

## 非機能要件・制約
- 通信はTLSが望ましいが、LAN内テストでは自己署名証明書を許容
- 最低限のレイテンシ（操作は数百ms以内）
- シンプルな導入（ワンバイナリまたは小さなサーバ）
- ローカルネットワークのファイアウォール/ポート開放の必要性を最小化

## セキュリティ考慮
- 初期MVPではローカルPIN + 短期JWTアクセストークン
- mDNSを使う場合、サービス発見のみで自動接続はオプトインにする
- 強い想定: ローカルネットワークを限定的に信頼

## ネットワークとサービス検出
- 推奨: mDNS (.local) と手動IP/ポート設定の両対応
- デフォルトポート案: 8000 (HTTP/REST), 8001 (WebSocket) — 設定可能

## API・プロトコル（概要）
- REST: 認証、設定取得・更新、ログ取得（ページネーション）
- WebSocket: リアルタイムステータス、コマンド実行結果、イベント配信
- APIはJSONベース

## データ・永続化
- ローカル軽量DB: SQLite または JSON ファイル（MVPはJSONでも可）
- 保存対象: 接続履歴、設定、操作ログ（ロールアップ）

## UI/UX（モバイル）
- 初回はPWAまたはReact Native(Expo)でMVPを作成
- 主要画面: 接続一覧（検出/手動）、ダッシュボード（ステータス）、操作画面（コマンド）、ログビュー
- オンライン/オフラインインジケータ、明確な接続状態表示

## 技術スタック候補（MVP優先）
- Backend: Node.js + Express + ws / FastAPI + uvicorn + websockets
- Frontend (mobile): PWA (React) または React Native(Expo) / Flutter
- Discovery: mdns-js (Node) / zeroconf (mobileライブラリ)
- Storage: SQLite / lowdb (JSON)

## テストと検証
- LAN内での接続テスト（複数デバイス）
- 自己署名TLSでの接続検証
- ネットワーク切断・再接続時の挙動検証

## 次のステップ（短期）
1. 高レベルアーキテクチャ図作成
2. APIエンドポイント一覧（REST/WebSocket）の作成
3. 認証フローの詳細設計
4. モバイルUIのワイヤーフレーム

## 参照ドキュメント（外部化コンテキスト）
- `architecture.md`
- `api-spec.md`
- `security-design.md`
- `data-model.md`
- `mobile-ui-flow.md`
- `mvp-roadmap.md`
- `tech-selection.md`
- `lan-test-plan.md`
- `deployment-network.md`
- `extension-roadmap.md`
- `../README.md`

---

このファイルは要件定義と設計の基礎コンテキストです。変更があればここを更新してください。
