# Codex Interface MVPロードマップ

最終更新: 2026-05-14

## Phase 0: 設計確定（1週）
- アーキテクチャ/API/セキュリティ合意
- モバイル画面フロー合意
- リスク棚卸し

## Phase 1: Gateway基盤（1-2週）
- REST `/health`, `/auth/pin`, `/server/info`
- JWT発行/検証
- WebSocket接続・ハートビート
- ログ永続化（SQLite）

## Phase 2: 操作機能（1週）
- `/commands` 実装
- 実行結果のWSストリーミング
- キャンセル処理

## Phase 3: モバイルMVP（1-2週）
- 接続先選択・PIN認証
- ダッシュボード・操作画面・ログ画面
- 再接続制御

## Phase 4: 実機検証（1週）
- iOS/Android実機LAN検証
- 切断復帰試験
- 失敗系・レート制限試験

## 受け入れ基準（MVP）
- 同一LANで接続・認証・操作・ログ閲覧が可能
- 通信切断後に自動再接続が動作
- 不正PIN連打でレート制限が機能
- 主要APIに対して基本テストが存在
