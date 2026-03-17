---
name: FEAT_0042 HTMLのセルを表示する（2026-03-18レビュー）
description: 列ヘッダー右クリック「HTMLとして表示」トグル機能のUXレビュー結果
type: project
---

## FEAT_0042 HTMLのセルを表示する（2026-03-18レビュー）評価: B

### 確認したDOMダンプ
- 列ヘッダーを右クリックするとコンテキストメニューに「HTMLとして表示」が含まれること
- 「HTMLとして表示」メニューを選択するとスキーマに renderAsHtml_ true が保存されること
- renderAsHtml列のセルで _br_ タグが _br_ 要素としてDOMに存在すること
- renderAsHtml列のセルで _script_ がエスケープされたテキストとして表示されること
- renderAsHtml列のセルで _script_ 要素がDOMに存在しないこと
- renderAsHtml列のセルの innerHTML に _br_ が含まれること

### 良い点
- context-menu-separator でHTML設定と列操作グループが正しく区切られている
- `<script>` が `&lt;script&gt;` にエスケープされDOMに要素として存在しない（XSS対策正常）
- `data-raw-value` で元のCSV生値が保持されており、編集時の値復元が可能

### 残課題(🔴): セル高さ固定のまま `<br>` 改行が視覚的に見えない
- DOM: `style="height: 20px; min-height: 20px; max-height: 20px; line-height: 20px;"` がrenderAsHtml列のセルに対してもハードコードされたまま
- `<br>` が DOM に存在しても高さ固定で内容が切れる or 隣行と重なる
- bug-report #115（差分ビューのパディング行セル高さが1px未満）と同根の問題
- 改善方向: renderAsHtml列のセルは min-height のみ保持し、height/max-height を auto に変更する

### 残課題(🔴): チェックマーク ON/OFF が全角空白とUnicode文字の切り替えで実装されている
- OFF時: `<div class="context-menu-item">　HTMLとして表示</div>`（先頭に全角空白）
- ON時: `<div class="context-menu-item">✓ HTMLとして表示</div>`（✓文字）
- `role="menuitemcheckbox"` / `aria-checked` がない
- 全角空白はフォント依存でずれる可能性がある
- 改善方向: `role="menuitemcheckbox"` + `aria-checked="true/false"` + CSS `::before` でチェックマーク表示

### 残課題(🟡): 列ヘッダーにHTML表示中を示す視覚マーカーがない
- description列ヘッダーに html-mode-active クラスや column-header-badge--html 相当がない
- 複数タブ間でどの列がHTMLモードかひと目でわからない

### 残課題(🟡): overflow 制御の明示がない（推測含む）
- editor-table-cell のインラインスタイルに overflow の記述なし
- <br> でセルがはみ出した場合の挙動が不明確

### 確認できないもの（テスト不在）
- `<img onerror>` など他タグのサニタイズ範囲
- ダブルクリック編集時に `<br>` リテラルが正しく復元されるか
