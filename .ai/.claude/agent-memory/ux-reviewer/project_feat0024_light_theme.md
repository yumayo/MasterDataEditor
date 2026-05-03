---
name: FEAT_0024 ライトテーマ色改修（バッジ・ドロップダウン）フィードバック修正後
description: PK/FKバッジのアルファ値引き上げとプルダウン選択色のライトテーマ対応レビュー（2026-03-16 ラウンド2）
type: project
---

## FEAT_0024 ライトテーマ色改修 レビュー（ラウンド2: フィードバック修正後）評価: B+

**Why:** ラウンド1の指摘3点（テーマ設定漏れ・ダークオーバーライド欠如・command-palette同問題）に対する修正内容を検証。

### 解消された問題
- feat-0024-light-theme-colors.spec.ts の3テストすべてで `<body>` に `data-theme` 属性なし（ライトテーマ）が確認済み
- `grid-dropdown-input.css` に `[data-theme="dark"] .grid-dropdown-item.selected { background-color: #264f78 }` と `selected:hover { background-color: #2d5a87 }` が追加済み（対称性OK）
- `command-palette.css` に `[data-theme="dark"] .command-palette-item.selected { background: #264f78 }` が追加済み

### 残存課題
- **command-palette.css のダークテーマで `.selected:hover` が未定義**: `grid-dropdown-input.css` には `[data-theme="dark"] .grid-dropdown-item.selected:hover { #2d5a87 }` があるが、command-palette.css には対称セレクタがない（bug-report #3 対称操作欠落パターン）
- **command-palette.spec.ts が依然 `data-theme="dark"` で動作中**: `.CONTEXT/dump/command-palette/矢印キーでリスト項目を循環選択できる.html` の `<body data-theme="dark">` で確認。`setupTestPageAsync()` に `document.body.removeAttribute('data-theme')` が追加されていない
- **コマンドパレット・ドロップダウンの aria 属性欠如（継続）**: `role="listbox"` / `role="option"` / `aria-selected` が未実装

**How to apply:**
- ライトテーマ専用絶対値（`#cce4f7`）を追加したら、必ずダークオーバーライドと `:hover` バリアントも対称に追加する
- `grid-dropdown-input.css` と `command-palette.css` は「同じ意味の選択色」を持つペアなので、一方を変更したら他方も確認する
- spec のテーマ状態は `setupTestPageAsync()` やグローバルフィクスチャで一元管理するか、各 spec で明示的に設定する
