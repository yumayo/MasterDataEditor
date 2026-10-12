---
name: FEAT_0038 検索機能改修
description: ローマ字検索・大文字小文字/全角半角無視・ハイライト・PK値表示・数値自動wholeWordのUXレビュー（2026-03-17）
type: project
---

## FEAT_0038 検索機能改修（2026-03-17レビュー）評価: A-

### 実装確認済み

- ハイライト: `span.search-highlight` が コマンドパレット・フィルタードロップダウン・全文検索の3箇所で統一して使われている
- CSS: `.search-highlight { background-color: #fde68a; border-radius: 3px; padding: 0 2px; }` → 黄色背景・角丸3px・左右2pxパディング。sidebar.css 1箇所で管理（良い）
- PK値表示: `span.search-result-pk` が `.search-result-location`（テーブル.列名）と `.search-result-value` の間に配置
- 数値自動wholeWord: `data-option="wholeWord"` ボタンに `search-option-active` クラスが付与される（数値入力時のみ）
- 自動/手動フラグの区別: DOM上は同じ `search-option-active` クラスだが、手動ON後は数値解除後も維持（テスト確認済み）
- ローマ字→日本語変換: 全文検索で「surai」→「スライム」ヒット確認。フィルターで「buki」→「ぶき」、「aite」→「アイテム」の部分マッチヒント付き確認
- コマンドパレット: `span.command-palette-item-name > span.search-highlight` と `span.command-palette-item-description > span.search-highlight` の両方でハイライト確認

### 良い点

- sidebar.css の `.search-highlight` が3コンポーネント共通。スタイルの一貫性が担保されている
- `data-raw-text` 属性にオリジナルテキストを保持し、ハイライト用 span 挿入後もマッチング対象が壊れない設計（filter-item-label で確認）
- 数値自動wholeWord: 入力変化にリアルタイム連動しており、意図しない部分マッチを防ぐ配慮が優秀

### 残課題（🔴）

- `span.search-result-pk` のラベルが皆無。単なる数値「1」「2」が表示されており、初見ユーザーには「これが何か」が伝わらない（PKとの対応が不明）
  - 推奨: `title="主キー値"` または前置テキスト「#1」形式、もしくはCSSで ::before { content: "#"; } を付ける
- 数値自動wholeWordのON/OFFがユーザーに通知されない。`search-option-active` クラスはビジュアル変化のみで、「なぜ自動でONになったのか」の説明が一切ない
  - 推奨: `title="数値入力のため単語単位検索を自動ON"` など title 属性でコンテキスト補足

### 残課題（🟡）

- `span.search-result-pk` が `span` 要素で aria-label なし（「これは主キー値です」という機械可読な意味付けがない）
- 全文検索パネルで「検索結果なし」表示が DOM に確認できない（フィルタードロップダウンには `.filter-no-result` があるが search-panel には対応要素が見当たらない）
- `span.search-highlight` に `aria-label` がなく、スクリーンリーダーで「ここがマッチ箇所」という情報が伝わらない（`mark` 要素を使うのが意味的に正しい）
- コマンドパレットでdescription側にもハイライトが入るが、`command-palette-item-description` は薄い文字色で表示されるためハイライト（黄色背景）のコントラストが低い可能性（推測）

### bug-report.mdとの照合

- bug-report #3（対称操作の欠落）: フィルタードロップダウンに `data-raw-text` 属性があるのに対し、search-panel の `.search-result-value` には対応属性がない。将来のリハイライト時にDOMを再パースする必要が生じるリスク
- bug-report #116（ハードコード色）: `.search-highlight` の `background-color: #fde68a` はライトテーマ用の固定色。ダークテーマ（data-theme="dark"）でのコントラスト確保が CSS に書かれていない。ライトテーマでは適切だがダークテーマでは黄色背景が浮いて見える可能性（推測：DOMダンプはdark theme下）

**Why:** ハイライトの共通化とローマ字検索は非エンジニアのプランナーが日本語データを探すうえで核心的な機能改善。PK値表示もどのレコードか特定するために必須。ただし PK 値が「1」と表示されるだけでは「何のIDか」が伝わらず、特に多テーブル環境で混乱を招く。

**How to apply:** 次回レビューでは `.search-result-pk` のラベル有無と `mark` 要素への置き換えを確認ポイントとして明示的にチェックする。
