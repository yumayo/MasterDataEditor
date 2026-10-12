---
name: FEAT バリデーションエラーパネル（2026-03-20初回〜 / 2026-03-21 未開封テーブルジャンプ追加）
description: バリデーションエラーパネルのUXレビュー結果。リサイズハンドル共通化・PROBLEMSパネル高さ調整・ステータスバーエラーアイコン追加・超過分戻りきりドラッグ改善・未開封テーブルへのジャンプ機能のレビューを含む。
type: project
---

## 未開封テーブルへのジャンプ機能レビュー（2026-03-21 第5回）評価: A-

### 今回の変更内容
PROBLEMSパネルのエラー項目クリック時、該当テーブルがタブで開かれていない場合でもテーブルを新規に開いてエラーセルにフォーカスする機能を追加。

### 確認できた正常動作（DOM/スクリーンショット）
1. タブを閉じた後にエラー項目をクリックすると `tab-button-active` が product タブに付与され、テーブルが新規に開かれる（1枚目スクリーンショット・DOM確認）
2. フォーカス後のDOMで `cell-error editor-table-cell-focused` が同一セル（product 行1 category_id）に付与されている（2枚目DOM確認）
3. 2枚のダンプが同一のDOM状態であることを確認（テスト2の「フォーカス移動」はテスト1終了時点の状態を確認するもの）

### 残存課題（改善必須 🔴）
1. **cell-error セルに aria-invalid/aria-describedby がない（ISSUE_0080 から継続）**
   - 該当セル: `<div class="editor-table-cell cell-error editor-table-cell-focused" data-col="1">999</div>`
   - `aria-invalid="true"` と `aria-describedby="..." ` が未付与
   - キーボードナビゲーションユーザーはフォーカスされてもエラーであることを把握できない

### 残存課題（改善推奨 🟡）
1. **validation-panel-group-header に role/aria-label がない**（全レビューサイクルを通じて継続）
   - `<div class="validation-panel-group-header"><span class="validation-panel-group-name">product</span>...`
   - `role="group"` + `aria-label` 未設定
2. **validation-panel-item に aria-label がない**
   - `<div class="validation-panel-item" role="button" tabindex="0">` に aria-label が未設定
   - テキストが3つのspanに分散しており、スクリーンリーダーが全文を正しく読み上げられるか不明
   - 推奨: `aria-label="FK切れ: product 行1 category_id 参照先 category.id に値 999 が存在しません"` のような連結ラベル
3. **resize-handle に role/aria-label なし**（継続課題）

### 特記: 2枚のダンプが同一DOM状態である件
- テスト「テーブルが新規に開かれる」と「エラーセルにフォーカスが移動する」の2つが同一DOMになっている
- これは「開いた直後にフォーカスも完了している」実装になっているためと考えられる（合理的な設計）
- ただし「タブを開く」と「フォーカス移動」が別々にテストアサートされているか、spec の内容確認が望ましい

**Why:** 「PROBLEMSクリック→タブがない→開く→エラーセルへ」は1クリックで完結するべき核心ワークフロー。機能としては正しく動作しており、残課題はアクセシビリティの補足に留まる。
**How to apply:** cell-error に aria-invalid を付与する際は aria-describedby でエラーメッセージIDへの参照も忘れずに付与すること。

## リサイズ共通化・PROBLEMSパネル改善レビュー（2026-03-20 第3回）評価: A

### 今回の変更内容
1. PROBLEMSパネルの高さをドラッグで調整できるようにした
2. リサイズハンドルをSidebar/RelationsPanel/PROBLEMSパネルで共通化（`class="resize-handle" data-direction="horizontal|vertical"`）
3. ステータスバーにエラーアイコンを追加し画面幅いっぱいに配置

### 良い点

1. **リサイズハンドルの共通化が設計的に正しい**
   - `<div class="resize-handle" data-direction="horizontal">` がサイドバー・RelationsPanel・PROBLEMSパネルで統一
   - `data-direction` 属性によりCSSカーソル制御が一元管理できる構造
   - 3箇所でクラス名とデータ属性が完全に統一されており、将来の追加コンポーネントへの適用指針が明確

2. **PROBLEMSパネルの構造が正しい順序で配置されている**
   - `resize-handle` → `validation-panel-header` → `validation-panel-group-header` → `validation-panel-item`
   - リサイズハンドルがパネル内最上部に来ており、ドラッグ操作のヒットエリアがヘッダーと被らない

3. **ステータスバーのエラーアイコンが視覚的に有効に機能している**
   - スクリーンショット左下の「x 2」表示が赤いXアイコン+数字で即座に認識できる
   - SVGに `aria-hidden="true"` 付与済み、`role="button"` + `tabindex="0"` + `aria-label` も完備
   - `data-error-count` 属性でSSOTを維持

4. **閉じるボタンのアクセシビリティが整備されている**
   - `validation-panel-close` に `role="button"` + `tabindex="0"` + `aria-label="PROBLEMSパネルを閉じる"` 付与済み
   - 閉じるボタンのSVGにも `aria-hidden="true"` 付与済み

5. **エラーメッセージの情報密度が高い**
   - 「product 行1 id: 主キー値 "1" が重複しています」のようにテーブル名+行番号+列名+値を含む
   - `PK重複`/`FK切れ` バッジが色分け表示でエラー種別を一目で識別できる

### 残存課題（改善推奨 🟡）

1. **validation-panel-group-header に role/aria-label がない**（前回から継続）
   - `<div class="validation-panel-group-header">` に role/aria-label 未設定
   - 複数テーブルのエラーが混在した場合、スクリーンリーダーがグループ帰属を把握できない
   - 推奨: `role="group"` + `aria-label="product のエラー (2 件)"`

2. **エラー0件時のバッジの視覚的区別なし**（前回から継続）
   - `data-error-count="0"` の状態でもバッジが同じスタイルで表示される
   - `data-error-count="0"` をCSSセレクタとしてグレーアウト推奨
   - プランナー視点: エラーがない状態は「すべてOK」なのにアイコンが赤く見えると誤認を招く

3. **resize-handle に aria-label/role がない**
   - `<div class="resize-handle" data-direction="vertical">` にアクセシビリティ属性なし
   - キーボード操作でのリサイズができない（ドラッグ専用になっている）
   - 推奨: `role="separator"` + `aria-orientation="horizontal"` + `aria-label="PROBLEMSパネルの高さを調整"`
   - ただし現状のターゲットユーザー（マウス操作前提のゲームプランナー）への影響は低め

4. **PROBLEMSパネルの最小高さ・最大高さの制約が不明**
   - DOMダンプにはパネルの高さ制御に関するstyle属性が確認できない
   - ドラッグでエディタ領域を潰しきれてしまうリスクがある（推測）
   - 推奨: `min-height: 80px`（最低でもヘッダー+1件が見える高さ）、`max-height: 50vh` の制約

### 修正確認済み（前々回からの指摘）
- validation-panel-item に role/tabindex 付与済み（全DOMダンプで確認）
- status-bar-badge に role/tabindex 付与済み
- show/hide 対称性: `display: block` / `display: none` で対称
- max-height/overflow-y が適切に機能（スクリーンショット確認）
- validation-panel-close のアクセシビリティ属性完備

**Why:** バリデーションパネルは安全網機能。リサイズで高さを調整できることはエラー件数が多いときに特に重要。
**How to apply:** 今後の resize-handle 追加時には data-direction + aria 属性をセットで実装するチェックリストを適用。

---

## 超過分戻りきりドラッグ改善レビュー（2026-03-20 第4回）評価: A

### 今回の変更内容
ResizeHandle のドラッグ追跡を改善。上限/下限到達後にマウスを逆方向に動かしても、超過分を戻りきるまでリサイズが始まらないようにした。対象は Sidebar（150px〜600px）・RelationsPanel（10%〜90%）・ValidationPanel（80px〜400px）。

### 実装方式
`onResize` コールバックが「実際に消費した delta」を返し、`prevCoord += consumedDelta` で前フレーム座標を補正する方式。クランプで実際に動かなかった超過分が `prevCoord` に反映されないため、逆方向に戻しても超過分が解消するまでリサイズが開始しない。

### 確認できた正常動作
- 上限600px到達後に100px超過 → 左に50px戻してもまだ600pxのまま（DOMダンプ `style="width: 600px;"` 確認）
- 下限150px/上限600pxのクランプがピッタリ動作
- `#tab`/`#editor` の `left` と `width: calc(...)` がSidebar幅変更に完全連動

### 残存課題（改善推奨 🟡、resize-handle 共通課題）
- `resize-handle` に `role="separator"` / `aria-orientation` / `aria-label` なし（3箇所共通、前回から継続）
- RelationsPanel / ValidationPanel の幅/高さ調整状態のスクリーンショットがダンプセットに未収録
- 下限到達後の逆方向挙動テスト（上限の対称ケース）が spec に未記載
