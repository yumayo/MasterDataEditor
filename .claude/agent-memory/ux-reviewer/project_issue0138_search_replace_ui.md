---
name: ISSUE_0138 検索置換UI改善（chevronトグル・SVGアイコン・サイドバー最小幅調整）
description: ISSUE_0138の置換UIレビュー結果。評価B+。chevronのaria-expanded欠如・search-panel-replace-rowのstyle空文字問題・fill-handle残存が主要課題。
type: project
---

## ISSUE_0138 置換UI改善 評価: B+

変更内容: search-replace-toggle ボタン（chevronアイコン）追加、search-replace-toggle-expanded クラスでdown/right矢印切替、SVGアイコン化（search-replace-button / search-replace-all-button）、search-panel-replace-indent 要素追加、サイドバー最小幅調整。

### 良い点
- `search-replace-toggle` ボタンに `aria-label="置換モードを切り替え"` と `title="置換モードを切り替え"` が付与されており、アクセシビリティと tooltip の両方が整備された。
- chevron の向き切替（`search-replace-toggle-expanded` クラスの有無）でdown矢印（展開）/right矢印（折りたたみ）を表現し、IDEのVSCode準拠のインタラクションモデル。
- `search-replace-button` に `aria-label="現在のマッチを1件置換"` + `title="置換"`、`search-replace-all-button` に `aria-label="すべてのマッチを一括置換"` + `title="すべて置換"` が付与されており、前回指摘（ISSUE_0138以前のレビュー）で報告した aria-label 欠如が解消された。
- `search-panel-replace-input` の `aria-label="置換後のテキスト"` が前サイクルから引き続き存在している。
- `search-result-replace-preview` に `aria-label="置換後: Blade"` が付与されており、スクリーンリーダーがプレビュー内容を正確に読み上げられる。
- `search-result-pk` に `title="主キー値"` があり、プランナーが「#1」「#3」の数字の意味を理解できる。
- Undo後に Sword/Sword_EX が復元されるUndoテストが通過しており、置換がCommandパターン経由であることが確認できる。
- `search-panel-replace-indent` div で置換行が検索行から視覚的にインデントされており、2段構造が自然に読める。

**Why:** B+ 評価の理由は機能的品質は高いが、chevron トグルの ARIA 状態管理と置換欄の show/hide 制御方式に構造的問題が残っているため。

**How to apply:** 次サイクルで aria-expanded の付与と display:none 制御方式の統一を優先的に確認すること。

### 修正必須(🔴)

1. **`search-replace-toggle` に `aria-expanded` がない**
   - DOMダンプ: `<button class="search-replace-toggle search-replace-toggle-expanded" aria-label="置換モードを切り替え" title="置換モードを切り替え">` — aria-expanded 属性が存在しない。
   - chevron の向きで展開/折りたたみ状態を示しているが、スクリーンリーダーはクラス名を読まない。
   - `aria-expanded="true"` (展開時) / `aria-expanded="false"` (折りたたみ時) + `aria-controls="search-panel-replace-row"` の付与が最低限必要。
   - プランナーシナリオ: スクリーンリーダー利用者が「置換モードを切り替え」ボタンを押した後、置換欄が開いているのか閉じているのかを確認する手段がない。

2. **`search-panel-replace-row` の show/hide を `style=""` と `style="display: none;"` で制御している**
   - 展開時: `<div class="search-panel-replace-row" style="">` (空スタイル = 表示)
   - 折りたたみ時: `<div class="search-panel-replace-row" style="display: none;">`
   - bug-report #84 (CSS `display: none` と JavaScript `style.display = ''` のリセット競合) と同一パターン。CSS側で `.search-panel-replace-row { display: flex }` のようなスタイルが定義されている場合、`style=""` によるリセットが CSS の値を見えなくしているだけで、CSSの詳細度変更時に意図しない挙動が起きるリスクがある。
   - 推奨: `hidden` 属性 (HTMLネイティブ) または専用クラス `.search-replace-row-hidden { display: none !important; }` による制御に統一する。

3. **activity-bar SVG 全件に `aria-hidden="true"` がない（全サイクル継続課題）**
   - DOMダンプ: files/references/search/bookmarks/erDiagram/sourceControl/history/settings の全SVGに aria-hidden 属性なし。
   - スクリーンリーダーがSVGのpathデータを無意味なテキストとして読み上げる。

4. **`search-replace-toggle` の SVG に `aria-hidden="true"` がない**
   - `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.3 5.7..."></svg>` — aria-hidden 属性なし。
   - ボタン自体に `aria-label` があるため SVG は装飾として `aria-hidden="true"` にすべき。同様に `search-replace-button` と `search-replace-all-button` の SVG も aria-hidden なし。

5. **fill-handle が `display:block` で残存（left:207px, top:38px）（全サイクル継続課題）**
   - DOMダンプ: `<div class="fill-handle" style="left: 207px; top: 38px; display: block;">` — 検索パネル表示中もfill-handleが画面上に残っている。

### 改善推奨(🟡)

- chevron は展開/折りたたみ状態を視覚的に示すが、Ctrl+H を押した際に `search-panel-input` ではなく `search-panel-replace-input` にフォーカスが移るかどうかがDOMダンプからは判断できない。プランナーが Ctrl+H を押した直後に即タイプできる状態であれば UX が向上する。
- 正規表現テスト（`S(word)` → `UPPER_$1`）のスクリーンショットで `.* ` ボタンが青くアクティブ表示になっており、正規表現モード有効状態の視覚フィードバックは機能している。ただし `.search-option-button` のアクティブ状態に `aria-pressed="true/false"` がないため、スクリーンリーダーが「押されているか否か」を判断できない（search-option-button 全般の継続課題）。
- `search-result-item-focused` クラスで「次に置換されるマッチ」がハイライトされているが（DOMダンプ確認）、このフォーカスが移動する際（置換ボタン連打時）に視覚的にアニメーションするかどうかは静止画では確認不能。ハイライトの移動が明確に視認できると置換進捗が把握しやすい。
- 置換欄が `search-panel-replace-indent` div でインデントされているため、検索欄と置換欄の入力行に高さの違いがある。狭いサイドバー幅（特に最小幅設定後）で `search-replace-button` と `search-replace-all-button` の2つのSVGボタンが置換入力欄を圧迫するかどうか確認が必要（スクリーンショットでは 300px サイドバー幅で問題なし）。

### bug-report.md との照合結果
- bug-report #77/#84 (show/hide 対称操作・CSS display:none リセット競合): `search-panel-replace-row` の `style=""` と `style="display: none;"` 切替が同パターンに該当する。機能的には動作しているが構造的リスクあり。
- bug-report #3 (対称操作の片方のみ実装): chevron 展開/折りたたみの対称性は「chevronトグルクリックで置換モードが切り替わる」テストで正確に機能が確認されており、今回は該当なし。Ctrl+H で展開 → Ctrl+Shift+F で折りたたみ という別パスの対称性も DOMダンプで `display: none` が確認できている。
