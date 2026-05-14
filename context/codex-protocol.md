# Codex 接続プロトコル仕様（草案）

目的: ローカルGateway経由でCodex系モデル（ローカルまたは外部API）を安全に呼び出すためのAPI・WebSocketプロトコル仕様。

設計方針:
- シンプルな同期実行（短い応答）と、ストリーミング実行（長時間応答／逐次出力）を両方サポートする。
- 全てのリクエストはGatewayで認可・監査・レート制御される。
- 実際のモデルはプラガブル（mock / local engine / external provider）として実装可能。

認証:
- HTTP/WS共通で `Authorization: Bearer <accessToken>` を要求。
- デバイス識別は `X-Device-Id` ヘッダで任意に伝搬。
- refresh の取り扱い・回転は既存の `/auth/refresh` ロジックを使用。

エンドポイント（REST）:

1) POST /api/v1/codex/execute
- 説明: 同期実行。短い応答やすぐ終わるAPIコール向け。
- リクエスト JSON:
  - `model`: string (例: "gpt-codex-local")
  - `prompt`: string
  - `maxTokens?`: number
  - `temperature?`: number
  - `metadata?`: object  // クライアントメタ情報（UI表示用）
- レスポンス 200:
  - `id`: string (実行ID)
  - `output`: string
  - `usage?`: object

2) POST /api/v1/codex/stream
- 説明: ストリーミング実行を開始し、ストリームID を返す（SSE/WSで受信）。
- リクエスト JSON: 同 `execute` と同等。
- レスポンス 200:
  - `streamId`: string
  - `wsUrl`: string (推奨)  // 例: `ws://<host>/ws/codex?streamId=<id>&sessionId=<s>`

WebSocket チャネル（推奨）:
- 接続先: `ws://<gateway>/ws/codex?streamId=<streamId>`
- 接続後のメッセージ形式: JSON
  - クライアント -> サーバ:
    - `{ type: 'init', streamId: '...', metadata: {...} }` // 初期化（既にURLに含む場合は省略可）
    - `{ type: 'cancel' }` // 実行のキャンセル要求
  - サーバ -> クライアント:
    - `{ type: 'chunk', seq: 1, text: '...' }`
    - `{ type: 'done', id: '...', usage: {...} }`
    - `{ type: 'error', code: 'ERR_CODE', message: '...' }`

エラー設計:
- 401: 認証失敗
- 403: 認可エラー（デバイス/ユーザーに権限無し）
- 429: レート制限
- 5xx: モデル/バックエンド障害

監査 / ログ:
- すべての `execute` / `stream` リクエストは `store.addLog` に記録。
- ログ項目: `actor`(deviceId/user), `action`(execute/stream/cancel), `model`, `prompt_hash`（全文は保存しない可）、`id`, `timestamp`。

セキュリティ考慮:
- プロンプトに機密情報が含まれないようUI側で注意喚起。
- Gateway はプロンプトのフルコピーを永続化しない（オプション）。
- 外部APIキーを使う場合はGateway側で秘匿し、PWAに直接渡さない。
- 実行結果は最小限の保持で監査ログのみを残す。長期保存は管理者ポリシーで。

ローカルモック動作フロー（推奨開発手順）:
1. `/api/v1/codex/stream` を叩いて `streamId` を取得
2. `ws://.../ws/codex?streamId=...` に接続
3. サーバは模擬的に数秒かけて `chunk` を順次送信し、最後に `done` を送って切断

拡張:
- バイナリストリーミング（音声合成など）を将来追加可能。メディアタイプやチャンクシリアライゼーションを定義する。
- 認可ポリシー（モデル毎のアクセス制御）を追加可能。

参考: この仕様は草案です。次はサーバ側のモックアダプタを実装して、PWAからの接続フローを統合テストします。
