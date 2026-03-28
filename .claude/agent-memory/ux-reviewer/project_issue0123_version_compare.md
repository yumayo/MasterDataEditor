---
name: ISSUE_0123 任意コミット間バージョン比較機能
description: コミット選択ダイアログとペインラベル付き差分タブのUXレビュー（2026-03-29）
type: project
---

## ISSUE_0123 バージョン比較機能 評価: B+

**Why:** 審査対象は「任意コミット間のデータバージョン比較機能」。commit-selector-dialog.ts 新規追加、diff-tab.ts/tab.ts/tab-button.ts 変更。

**How to apply:** 今後の差分ビュー・ダイアログUI改修の際はこの記録を参照して同様の問題の再発を防ぐ。

### 良い点

- タブボタン右クリックのコンテキストメニューへの「バージョン比較...」追加が自然。エクスプローラー右クリックと対称性があり、プランナーが「今開いているテーブルの過去を見る」という動線として直感的。
- ダイアログタイトル「バージョン比較 — test」でテーブル名を含む命名が明確（DOMダンプ: `<div class="commit-selector-title">バージョン比較 — test</div>`）。
- 比較元・比較先の2カラム並列レイアウト（`commit-selector-left` / `commit-selector-right`）がExcelのシート比較に近い直感的なUI。スクリーンショットで「比較元（左）」「比較先（右）」ラベルが明確に表示されている。
- HEAD・WORKING_TREE というプリセットを `preset` クラスで視覚的に区別している設計が良い（`<div class="commit-list-entry preset" data-commit="HEAD">`）。プランナーが「最新版 vs 作業中」という最もよく使うケースに素早くアクセスできる。
- コミットリストが「ハッシュ + コミットメッセージ」の2要素構成（`commit-list-entry-hash` + `commit-list-entry-message`）で、プランナーが日本語のコミットメッセージを頼りに目的のバージョンを特定できる。
- タブボタン名「差分: test (aaa1111 ↔ ccc3333)」に2コミットIDが含まれており、複数の比較タブを開いてもどのタブが何の比較かタブ名で識別できる。
- 差分タブ上部のペインラベル「aaa1111」（左）「ccc3333」（右）が diff-pane-label-left / diff-pane-label-right として実装されており、「今どのバージョンを見ているか」が常に確認できる。スクリーンショットで左ペインラベルが白太字、右ペインラベルが緑系（新しいバージョンを示唆）の配色になっている様子（推測）。
- `diff-cell-deleted` クラスが左ペインの変更セル（value: 100）に付与され、`diff-cell-added` クラスが右ペインの追加行・変更セルに付与されており、赤（削除）・緑（追加）の色区別が機能している。スクリーンショットで左ペインの「100」が赤、右ペインの「150」が緑で表示されていることを確認。
- 比較タブ開後にエクスプローラーの `test` エントリから `explorer-file-active` クラスが消えている（比較タブはデータ編集タブではないため）。特殊タブの状態管理が正確。
- `row-drag-indicator` が DOM に3個存在しているが、これは比較タブ（左ペイン用・右ペイン用）と通常テーブル用の3インスタンスを示しており、構造的に正しい（diff-tab-wrapper 分の EditorTable 追加に対応）。

### 修正必須 🔴

1. **`commit-selector-dialog` に `role="dialog"` / `aria-modal="true"` / `aria-labelledby` がない**
   - DOM: `<div class="commit-selector-dialog"><div class="commit-selector-content">...` という単なる div 構造で、モーダルダイアログとしての ARIA セマンティクスが一切ない。
   - プランナーシナリオ: スクリーンリーダー使用者はダイアログが表示されても「モーダルが開いた」ことが通知されない。フォーカスがダイアログ内に閉じ込められる trap がなければ、Tab キーでダイアログ背後の要素を操作できてしまう。
   - 改善: `role="dialog"` + `aria-modal="true"` + `aria-labelledby="commit-selector-title-id"` を付与し、ダイアログ表示時に最初のフォーカス可能要素（比較元リストの先頭エントリ or キャンセルボタン）に自動フォーカスを移動させる。

2. **`commit-list-entry` が `div` 要素でクリック可能なのに `role="option"` / `tabindex="0"` / `aria-selected` がない**
   - DOM: `<div class="commit-list-entry" data-commit="ccc3333">` という div で、キーボード操作でエントリを選択できない。
   - プランナーシナリオ: マウスを使えないプランナーがコミット選択ダイアログで比較元を選べない。Tab キーで「キャンセル」「比較」ボタンには到達できるが、リスト内のコミットを選ぶ手段がない。
   - 改善: `commit-list` に `role="listbox"` + `aria-label="比較元コミット"` / `aria-label="比較先コミット"` を付与し、各 `commit-list-entry` に `role="option"` + `tabindex="0"` + `aria-selected="true/false"` を付与。キーボードの上下矢印で選択、Enter/Space で確定するリストボックス実装が必要。

3. **どのコミットが「現在選択されている」か視覚的に表示されない**
   - スクリーンショット確認: ダイアログの各コミットエントリに選択状態を示す背景ハイライト・チェックマーク・ラジオボタンが見当たらない。HEAD / WORKING_TREE / ccc3333 / bbb2222 / aaa1111 の5エントリが並んでいるが、どれが「比較元として選択中か」が分からない。
   - プランナーシナリオ: 比較ボタンを押す前に「今どのコミットを選んでいるか」が画面から確認できないため、意図しないバージョン比較を実行してしまうリスクがある。
   - 改善: 選択中のエントリに `commit-list-entry--selected` クラスを付与して背景色・左ボーダー等で視覚フィードバックを提供。DOMダンプでは選択状態を示すクラスが一切見当たらない。

4. **`commit-selector-cancel-button` / `commit-selector-compare-button` に `aria-label` がない**
   - DOM: `<button class="commit-selector-cancel-button">キャンセル</button><button class="commit-selector-compare-button">比較</button>` でテキストのみ。スクリーンリーダーは「ボタン キャンセル」「ボタン 比較」と読み上げるが、「何の比較か」というコンテキストが伝わらない。
   - 改善: `aria-label="バージョン比較をキャンセル"` / `aria-label="test の aaa1111 と ccc3333 を比較"` のように選択状態を反映した動的 aria-label が理想。最低限でも `aria-label="比較を実行"` で補完が必要。

5. **`fill-handle` が差分タブのペイン内でも `display: block` で残存（継続課題）**
   - DOM確認: 差分タブ左ペイン内 `<div class="fill-handle" style="left: 138px; top: 38px; display: block;"></div>`、右ペインも同様に `display: block`。
   - `editor-table--inactive` クラスが左ペインの EditorTable に付与されているにもかかわらず、fill-handle は非表示になっていない。フィルハンドルは読み取り専用差分ビューには不要な UI 要素であり、左ペイン（比較元）はデータ編集不可のはずなのにフィルハンドルが表示されていることが論理的に矛盾している。
   - 改善: `editor-table--inactive` な EditorTable の fill-handle は `display: none` にする。

6. **activity-bar SVG に `aria-hidden="true"` がない（全サイクル継続課題）**
   - DOM: files / references / search / bookmarks / erDiagram / sourceControl / history の全アイコン SVG に `aria-hidden` 属性なし。
   - 改善: 全 SVG に `aria-hidden="true"` を付与し、代わりに `activity-bar-item` に `aria-label="ファイル"` 等を付与する。

### 修正推奨 🟡

- **比較元と比較先で同一コミットを選んだ場合の防止がない**。「aaa1111 vs aaa1111」比較を実行しても差分がない結果になるが、ダイアログ上では何も警告しない。「比較」ボタン押下時に同一コミット選択を検出してエラーメッセージを表示するか、比較ボタンをグレーアウトすべき（推測: 現在は何も検証されていない）。

- **ダイアログ外をクリックするとダイアログが閉じるか不明**。`context-menu-overlay` パターンではオーバーレイクリックで閉じる実装があるが、`commit-selector-dialog` にはオーバーレイ要素が見当たらない。DOMダンプ: `commit-selector-dialog` はBODY直下に存在するが、対応するオーバーレイ div がない。モーダルダイアログとして Escape キーでキャンセルできるか、オーバーレイクリックで閉じるかの動作が不明確。

- **差分タブの右ペイン（新しいバージョン）に行追加・削除の行全体ハイライト（`diff-row-added`）が付与されていない**。DOMダンプ確認: 右ペインの行2・行3のセルには `diff-cell-added` クラスが付与されているが、行要素（`editor-table-row`）自体には `diff-row-added` クラスがない。一方ソース管理タブの差分ビュー（`source-control` テスト）では `diff-row-added` クラスが行レベルで付与されている。バージョン比較タブとソース管理タブで差分ハイライトの粒度が異なる可能性がある（推測: `diff-row-added` なし、`diff-cell-added` ありの状態が意図的かどうかが不明）。

- **コミットリストのスクロール上限が不明**。モックデータでは5件（HEAD / WORKING_TREE / ccc3333 / bbb2222 / aaa1111）だが、実際の開発では数十〜数百コミットが存在する。`commit-list` に `max-height` と `overflow-y: auto` が設定されているか DOMダンプのインラインスタイルから確認できない。数百コミットのプロジェクトでダイアログが画面全体を占領するリスクがある。

- **ペインラベルがコミットハッシュ7文字のみ（`aaa1111` / `ccc3333`）で、コミットメッセージが表示されない**。ダイアログ選択時はコミットメッセージ（「初期コミット」「value変更+3行目追加」）が表示されるが、比較タブを開いた後のペインラベルはハッシュのみになる。プランナーが「このペインは何の変更を入れた時点のデータか」を判断するのにペインラベルだけでは情報が不足する。`title` 属性でコミットメッセージをツールチップ表示するか、ラベルをアコーディオン形式で「aaa1111（初期コミット）」と表示することを推奨。

- **タブボタン「差分: test (aaa1111 ↔ ccc3333)」のタイトルが長く、タブが複数並ぶと折りたたまれる**。スクリーンショット確認: タブボタンの横幅が「差分: test (aaa1111 ↔ ccc3333)」という長い文字列に合わせた幅になっており、通常タブの「test」と比べて幅が大きい。テーブル数が多い場合はタブスクロールが発生するリスクあり（`tab-scroll-area` で対応はされているが）。

### bug-report.md との照合

- bug-report #3（対称操作の片方のみ実装）パターン: ダイアログのキャンセルボタン（`commit-selector-cancel-button`）が「比較をキャンセルして閉じる」動作を行うが、Escape キーでも閉じるか、ダイアログ外クリックで閉じるかが対称に実装されているか未確認。コンテキストメニューが `context-menu-overlay visible` の visible クラス制御で開閉するのに対し、ダイアログはオーバーレイなしの実装であり非対称の可能性がある。
- bug-report #77/#84（show/hide の対称性）パターン: `commit-selector-dialog` の表示・非表示切替が正確に対称に実装されているか（比較タブ開後にダイアログが DOM から除去されるか `display:none` になるか）がテストで検証されているか要確認。
- fill-handle `display: block` 残存: 差分タブの非アクティブペインにもフィルハンドルが `display: block` になっている問題は issue-0106 で修正されたフィルハンドルの色変更と同一コンポーネントで発生しており、fill-handle の完全な非表示条件が整備されていない可能性。
