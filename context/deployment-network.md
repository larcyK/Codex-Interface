# Codex Interface デプロイ・ネットワーク設計（MVP）

最終更新: 2026-05-14

## 1. 実行形態
- PC上でGatewayをローカルサービスとして常駐
- Codex runtimeは同一ホスト内プロセス連携

## 2. ポート設計
- HTTP REST: 8000/tcp
- WebSocket: 8001/tcp
- mDNS: 5353/udp
- すべて設定ファイルで上書き可能

## 3. ネットワーク要件
- PCとスマホが同一サブネット
- APでクライアント分離が無効
- ローカルファイアウォールで8000/8001許可

## 4. サービス検出
- mDNSサービス名: `_codexif._tcp.local`
- 広告情報: `host`, `port`, `version`, `features`
- mDNS失敗時は手動IP/ポート入力へフォールバック

## 5. 設定ファイル案

```json
{
  "server": {"host": "0.0.0.0", "httpPort": 8000, "wsPort": 8001},
  "discovery": {"mdns": true, "serviceName": "_codexif._tcp.local"},
  "security": {"allowHttpInLanDev": true, "pinHash": "..."}
}
```

## 6. 起動順序
1. 設定ロード
2. SQLiteオープン
3. REST起動
4. WS起動
5. mDNS広告開始
6. health=ok 公開

## 7. 運用上の注意
- ルーター再起動後はmDNS再広告を実施
- IP変更に備え、固定IPまたはDHCP予約を推奨
- ログ肥大化を防ぐためローテーション
