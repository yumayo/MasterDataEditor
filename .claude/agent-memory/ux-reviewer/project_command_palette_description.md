---
name: コマンドパレット description表示・角直角化改修
description: Ctrl+Pコマンドパレットへのdescription表示・description検索・border-radius:0改修のUXレビュー結果（2026-03-17）
type: project
---

## 評価: A

### DOM構造確認結果

**改修1: border-radius: 0（直角化）**
- `.command-palette { border-radius: 0; }` がCSSに正しく記述されている
- ダンプ上もインラインstyleでのradius上書きなし。完全な直角

**改修2: description表示**
- description あり: `div.command-palette-item > span.command-palette-item-name + span.command-palette-item-description`
- description なし（初期テスト）: `div.command-palette-item > span.command-palette-item-name` のみ
- FK/非FK対称パターンと同様にdescriptionの有無で要素を増減する構造。正しい

**改修3: descriptionによるフィルタリング**
- 「テーブルの説明でフィルタリングにヒットする」ダンプ: 入力「アイテム」でitem(アイテムマスター)のみ残る。正しく動作

### 良い点
- `.command-palette-item` が `display: flex; justify-content: space-between` で name左・description右の水平レイアウト
- `.command-palette-item-name { flex: 1; }` で名前が伸びdescriptionが右端に配置される
- `.command-palette-item-description { font-size: 12px; opacity: 0.6; margin-left: 8px; }` でEXPLORERの `span.explorer-file-description` と同じ視覚的重みに揃えている
- ダークテーマ: `[data-theme="dark"] .command-palette-item.selected` に `background: #264f78; color: #ffffff;` でライトテーマの `#cce4f7` と明確に分離
- `[data-theme="dark"] .command-palette-item.selected:hover { background: #2d5a87; }` が追加されており、前回FEAT_0024レビューで指摘した欠如が解消済み

### 残課題(🟡)

1. `div.command-palette-item` が div 要素で `role="option"` / `aria-selected` がない
   - `div.command-palette-list` に `role="listbox"` がない
   - `input.command-palette-input` に `aria-controls` / `aria-activedescendant` がない
   - スクリーンリーダーからはただのテキスト群に見える（FEAT_0024レビューから継続）

2. `command-palette-item-description` に `aria-label` なし
   - 視覚的に「説明文」だと分かるが機械可読なラベルがない

3. `.command-palette-item-kind` クラスがCSS定義（L75-79）に残っているがDOMには出現しない
   - 将来コマンド種別表示を追加する際の残骸か意図的な予備枠か不明

4. `command-palette-overlay` の `justify-content: center` のみで縦方向は `margin-top: 15vh` で制御しているため、リスト項目が増えてパレットの高さが `max-height: 350px` を超えた場合にoverlayの下端がクリップされる可能性がある（高さ方向のmax制約はリスト内のoverflow-yのみ）

**Why:** アクセシビリティは現状「なくても動く」が、ゲーム会社の開発環境でスクリーンリーダーを使う人が一人でもいれば機能しない。また `role="combobox"` パターンは keyboard navigation の実装品質を保証する仕様でもある。

**How to apply:** 今後コマンドパレット周りを触る際は role="combobox"(input) + role="listbox"(list) + role="option"(item) + aria-selected + aria-activedescendant のセットで追加を推奨。
