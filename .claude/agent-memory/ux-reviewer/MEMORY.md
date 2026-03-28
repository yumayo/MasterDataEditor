# ux-reviewer メモリ

## プロジェクト: App.MasterDataEditor

### UXレビュー実績アーカイブ
- ファイル: project_review_archive_mar2026.md
- 2026-03-15〜23 全レビューの要約と横断的継続課題リストを収録
- ISSUE_0112まで含む最新版

### このプロジェクトの評価軸メモ
- 核心機能 = 外部キー参照の苦痛解消（定義ジャンプ、RelationsPanel）
- 差別化機能が壊れている場合は問答無用で評価下げ
- 状態の永続性（タブ切替をまたいだ状態保存）はユーザーの当然の期待
- 特殊タブ（差分タブ・設定タブ）は `tabStates` に登録されない → DOMクリーンアップは独自に行う必要あり
- `show/hide` や `activate/deactivate` の対称性チェックが繰り返し指摘されている（bug-report #3, #32, #77, #84）
- ミニテーブルの設計原則: ストアの全行を保持し、表示のみFKフィルタリング（storeRowIndicesのサブセット管理はしない）

### 最新レビュー結果（2026-03-28 ISSUE_0125 セルブックマーク機能改修）

#### ISSUE_0125 セルブックマーク機能（v2） 評価: A-
- 変更内容: 前回指摘(2026-03-28旧版)の改修。bookmark-entry に role/tabindex 追加、bookmark-entry-delete に aria-label 追加、bookmark-group に role="group"、bookmark-group-header に role="heading" aria-level="3" 追加、エントリ表示形式を「pk | 列名: 表示名 (pk)」形式に改善、0件時の空メッセージ対応、@bookmark コマンドパレット対応、Ctrl+D トグル、セルレベルブックマーク（data-bookmarked属性）追加。
- 前回からの修正確認: bookmark-entry に role="button" tabindex="0" が付与済み。bookmark-entry-delete に aria-label="item/name: Sword のブックマークを削除"が付与済み。bookmark-group-header に role="heading" aria-level="3" が付与済み。bookmark-group に role="group" が付与済み。0件空メッセージが「該当する項目がありません」で表示（@bookmark 0件テストで確認）。エントリ表示「1 name: Sword (1)」と bookmark-entry-column で区切り文字が入った。
- 良い点: bookmark-group に role="group" + bookmark-group-header に role="heading" aria-level="3" という ARIA 複合ウィジェット構造が正しく設計されている。bookmark-entry に role="button" + tabindex="0" でキーボードナビゲーション可能。bookmark-entry-delete に aria-label="item/name: Sword のブックマークを削除" でエントリのコンテキストを含む説明が付与されており前回の最大問題が解消。data-bookmarked="" 属性がセル DOM に正確に付与されており SSOT が正しい。コマンドパレット @bookmark 候補が「item | name: Sword (1)」形式で人間可読性が高い（スクリーンショット確認）。0件時の「該当する項目がありません」メッセージが正常表示（前回の🟡が解消）。bookmark-entry-column span（「name: 」）が PK と表示名の視覚的セパレーターとして機能し「1 name: Sword (1)」という読みやすい構造になった（前回「1Sword×」連続表示の解消）。アプリ再起動後も bookmark-panel-content に正確にエントリが復元されている（JSON永続化確認）。
- 修正必須(🔴): ブックマーク済みセルのオレンジ三角マーク（::after疑似要素）がスクリーンショットで確認できない。DOMダンプ上では data-bookmarked="" 属性が付与されているが、スクリーンショット「Ctrl+Dでブックマーク追加するとdata-bookmarked属性が付与される」でセルの右上に三角マークが表示されていない（セル右端に小さな青い四角形のようなものが見えるが、これは fill-handle である可能性が高い）。CSS で [data-bookmarked]::after { content: ""; border-right: 6px solid orange; ... } を実装している場合、DOMダンプには疑似要素が出力されないため確認不能だが、スクリーンショットでオレンジ三角が視覚的に確認できない。機能の視覚的フィードバックとして最も重要な部分が見えていないとプランナーが「ブックマーク済みかどうか」を判別できない。
- 修正必須(🔴): bookmark-entry-pk-suffix「 (1)」の表示が冗長。エントリの表示が「1 name: Sword (1)」となり、先頭に「1」、末尾に「(1)」と同じPK値が2回表示されている。プランナーが「どちらが正しい情報か」と混乱する。末尾の `bookmark-entry-pk-suffix` を削除するか、先頭の `bookmark-entry-pk` を削除して「name: Sword (1)」のみにすべき。
- 修正必須(🔴): `bookmark-panel-content` が空のとき（ブックマーク0件でBOOKMARKSパネルを開いた直接表示）の空状態メッセージがない。「@bookmark 0件」テストでは @bookmark コマンドパレット経由の「該当する項目がありません」が表示されているが、BOOKMARKSパネル自体のコンテンツエリアが空のときに何も表示されないとプランナーが「ツールが壊れているのか、まだ追加していないのか」を判別できない（「ブックマークはありません。Ctrl+D または右クリックで追加できます」等のガイダンステキストが必要）。なお DOMダンプを見ると `bookmark-panel-content` は空 div ではなく bookmark-group が追加済みの状態でダンプされているため、0件時の表示は別途確認が必要。
- 修正必須(🔴): activity-bar-item の bookmarks SVG に aria-hidden="true" がない（全サイクル継続課題）。スクリーンリーダーがSVGパスを無意味に読み上げる。
- 改善推奨(🟡): `bookmark-group-header` に折りたたみ機能がない（前回からの継続課題）。テーブルが増えるとスクロールが必要になる。
- 改善推奨(🟡): ブックマークジャンプ後に対象セルへのフォーカスが視覚的に分かるか不明（前回継続課題）。スクリーンショット「エントリクリックで該当テーブルの該当セルにジャンプする」でname列が選択されているように見えるが、「今ジャンプした」という一時的なハイライト演出がない。
- 参考: fill-handle が display:block で残存（left:207px, top:38px）（全サイクル継続課題）。

### 最新レビュー結果（2026-03-28 データ型別入力コントロール）

#### データ型別入力コントロール 評価: B+
- 変更内容: boolチェックボックス（cell-bool-check/uncheck SVG）、数値型右寄せ（cell-numeric）、int型入力フィルタ（文字・小数点をkeydownでブロック）、上下矢印インクリメント/デクリメント、FK参照列は型別コントロール適用除外。
- 良い点: cell-bool-check SVG（チェックマーク）/ cell-bool-uncheck SVG（透明チェックマーク）の視覚的区別が明確。data-raw-value="true/false" 属性でDOM値と表示を分離しておりSSOT設計が正しい。cell-numeric クラスが id/count/rate/score の全数値列に付与されており、右寄せが一貫している。FK参照列（category_id, data-col="1"）には cell-numeric が付与されず仕様通り。バッファ行（data-row="2", editor-table-empty-row）のbool列にも cell-bool-uncheck SVG が表示されており、空行でも型表示が統一されている。Undo/Redo のCommandパターン対応が確認できる（Ctrl+Z/Y テスト通過）。
- 修正必須(🔴): バッファ行（editor-table-empty-row, data-row="2"）のbool列（data-raw-value=""）に cell-bool-uncheck SVG が表示されている。これはデータが空（未入力）なのに「Falseチェック」を表示しているように見える。プランナーが「行3のactiveはFalseが入力されている」と誤解する。空値の場合は SVG を表示しないか、もしくは空値専用の cell-bool-empty クラスを用意してグレーアウト表示にすべき。
- 修正必須(🔴): bool型セルに role="checkbox" / aria-checked 属性がない。DOMを見ると `<svg class="cell-bool-check">` または `<svg class="cell-bool-uncheck">` だけで、スクリーンリーダーはこれをチェックボックスとして認識できない。親の `editor-table-cell` に `role="checkbox"` と `aria-checked="true/false"` を付けるべき。data-raw-value 属性は存在するので aria-checked="true/false" への変換は容易なはず。
- 修正必須(🔴): bool型セルを Spaceキーでトグルする操作が「選択セルでSpace押下 = トグル」という非標準のキーバインドになっている。テスト仕様を見ると `selectCellAsync` + `page.keyboard.press('Space')` で動作するが、この挙動がプランナーに発見可能かが問題。他のセルでは Spaceキーは何もしないのに bool 型セルだけ特殊動作するため、UI上にキーボードヒントがない。ヘッダーの tooltip や セル hover 時の cursor:pointer への変更（現在の cursor が不明）があると操作の手がかりになる。
- 修正必須(🔴): cell-bool-uncheck の SVG が cell-bool-check の SVG と全く同じ `<path>` データを持っている（DOMダンプ上では `d="M6 11.2L2.5 7.7l1.4-1.4L6 8.4l6.1-6.1 1.4 1.4L6 11.2z"` が両者同一）。視覚的な区別は CSS の fill/opacity で行っていると推測されるが、スクリーンショットでは false 行のチェックマークが薄く見える（暗い色？）だけであり、色覚異常のプランナーには両者が同じに見える可能性がある。アイコン形状自体を変えるか（× または空ボックス）、aria-label で「チェック済み」「未チェック」を明示すること。
- 改善推奨(🟡): int/float/double 型セルの上下矢印インクリメント/デクリメント機能がセル外部から発見できない。ダブルクリックして編集モードに入った後に ArrowUp を押す操作フローであり、プランナーが偶然発見するまで存在に気づかない。ヘッダーの type バッジ（現在は PK/FK バッジのみ）に「int」「float」等の型名を表示し、tooltip で「上下矢印で±1増減可能」と説明するか、編集中に「↑↓」ヒントをセル内に表示すると発見性が向上する。
- 改善推奨(🟡): activity-bar SVG に aria-hidden="true" がない（全サイクル継続課題）。
- 改善推奨(🟡): fill-handle が display:block で残存（left:207px, top:38px）（全サイクル継続課題）。
- 参考: 今回追加されたセル値変更パスが bug-report #7（applyViewAwareCellChanges 統合の背景）に記録された「4操作パスの網羅」の原則に沿っているか要確認。bool型トグルは Commandパターン経由であれば問題ないが、追加された操作パスがテキスト確定・ドロップダウン・Delete・ペースト・Fillの既存パスと共通基盤を使っているか確認を推奨する。

### 過去のレビュー結果（2026-03-28 検索と置換機能）

#### 検索と置換機能 評価: B+
- 変更内容: Ctrl+Hで置換モード起動、SEARCHパネルに置換入力欄（`search-panel-replace-row`）と「置換」「すべて置換」ボタンを統合。検索結果に置換プレビュー（`search-result-replace-preview`）を表示。Ctrl+Shift+Fでは置換欄を非表示。正規表現キャプチャグループ対応。Undo/Redo対応。
- 良い点: `search-panel-replace-row` が `search-panel-input-row` と縦に並ぶ構造で、VSCode 準拠の2段インプット配置。Ctrl+H / Ctrl+Shift+F でモード切替する設計がIDE経験者に馴染みやすい。`search-result-replace-preview`（`→ Blade` 等）が各結果項目に inline 表示されており、変更後のデータを置換実行前に確認できる安全機能として優秀。`search-result-item-focused` クラスで「次に置換されるマッチ」が視覚的に特定できる（DOMダンプ：置換ボタン後に pk=3 の項目が `.search-result-item-focused`）。置換後に即座に結果リストが更新されグリッドも更新される一気通貫の UX が確認できる（すべて置換後に Blade/Blade_EX が反映済み）。Undo後に Sword/Sword_EX に戻る Undo 動作が検証済み。正規表現キャプチャグループ (`([A-Z][a-z]+)` → `$1` で大文字化) が機能している。
- 修正必須(🔴): `search-replace-button`（「置換」）と `search-replace-all-button`（「すべて置換」）が `<button>` 要素で適切だが、`aria-label` がない。`title` 属性もなく、スクリーンリーダーはボタンテキストの「置換」「すべて置換」をそのまま読むが、「何の」置換かというコンテキストが伝わらない。`aria-label="現在の検索結果を1件置換"` / `aria-label="すべての検索結果を一括置換"` 相当が必要。
- 修正必須(🔴): `search-panel-replace-row` の `style=""` が空で、Ctrl+Shift+F のとき非表示になるはずが DOM ダンプでは `style=""` のまま（Ctrl+H テスト）。CSS クラスによる show/hide ではなく `style=""` / `style="display:none"` で制御している設計が見えるが、Ctrl+H テストの DOM では `search-panel-replace-row` の style が空（= display:block）になっており、「表示中」を確認できる。一方 Ctrl+Shift+F テストの DOM でも同様に `style=""` ——これは「display:none を設定せずにいる」か「初期値のまま」かが DOM から判別しにくい。スクリーンショットでは Ctrl+Shift+F 時に置換欄が消えているため機能的には正常だが、`display:none` ではなく `style=""` という空スタイルで制御している場合、CSS の詳細度が変わったタイミングで意図しない表示が起きるリスクがある。`hidden` 属性または専用 CSS クラス（`.search-replace-hidden`）での制御に変えるべき。
- 修正必須(🔴): `search-panel-replace-input` に `aria-label` がない。placeholder「置換...」は視覚的には分かるが、スクリーンリーダーにとってはフィールドの用途が不明確。`aria-label="置換後のテキスト"` が必要。なお `search-panel-input` にも `aria-label` がなく同じ問題を持つ（これは既存の継続課題）。
- 修正必須(🔴): `search-result-replace-preview`（`→ Blade` 等）の `span` 要素に `aria-hidden="true"` がない。スクリーンリーダーは「Sword → Blade」全体を1エントリとして読み上げてしまい、「現在の値」と「置換後の値」の区切りが不明確になる。`aria-label` で「Sword を Blade に置換」と読ませるか、プレビュー部分を `aria-hidden="true"` で隠して既存ラベルで代替する。
- 改善推奨(🟡): 「すべて置換」ボタンが検索結果が0件でも押せる状態になっているかが DOM ダンプからは不明。通常、検索結果 0 件の場合は `disabled` 属性を付けてグレーアウトすべき。誤クリックでの意図しない空置換を防ぐためのガードレールとして重要。
- 改善推奨(🟡): 置換後に「N 件置換しました」といった成功フィードバックがない（ステータスバーやトーストでの通知）。特に「すべて置換」は数百件を一括変更するケースがあるため、実施件数の通知がないと「本当に全部変わったのか」が確認できない。
- 改善推奨(🟡): `search-option-button` の `data-option="regex"` ボタンのラベルが `.*` のみ。正規表現を知らないプランナーには意味不明。`title="正規表現で検索"` 属性があれば tooltip で説明できる。`data-option="caseSensitive"` の `Aa` と `data-option="wholeWord"` の `|ab|` は `title="単語単位で検索"` があるのに `.*` のみ title がない（一貫性の欠如）。
- 改善推奨(🟡): activity-bar SVG に aria-hidden="true" がない（全サイクル継続課題）。
- 改善推奨(🟡): fill-handle が `display:block` で残存（left:207px, top:38px）（全サイクル継続課題）。

### 過去のレビュー結果（2026-03-28 ER図機能新規追加）

#### ER図機能 評価: B
- 変更内容: アクティビティバーにerDiagramアイコン、専用タブとしてSVGベースのER図を表示。テーブルをノード、FK参照を実線エッジ、動的参照を破線エッジで描画。ノードクリックでテーブルタブを開き、選択時に関連エッジをハイライト。ドラッグでノード移動可能。
- 良い点: アクティビティバーへの統合が他パネルと一貫している。`er-diagram-tab-wrapper` が `tab-wrapper` パターンを踏襲しており既存のタブ管理と整合。`er-node-selected` / `er-edge-highlighted` クラスによる選択フィードバックが DOM に正確に反映されている。ノードクリック後に対応テーブルのタブが開き、サイドバーの `explorer-file-active` も同期して更新されている（ノードクリックでの定義ジャンプが機能する）。単純参照は実線・動的参照は破線の視覚的区別があり、凡例でその意味を説明している。DRAG_THRESHOLD=5px によるクリック/ドラッグの誤判定防止が設計済み。
- 修正必須(🔴): `er-node`（`<g>` 要素）にインタラクティブ要素として `role="button"` / `tabindex="0"` がない。SVG の `<g>` 要素はデフォルトでキーボードフォーカスを受け取れないため、キーボード操作でノードを選択・ジャンプできない。テーブル一覧が10個を超えるプロジェクトではマウス操作のみでは全ノードを確認するのが困難であり、Tabキーによるノード巡回ができないのは操作性の欠如。
- 修正必須(🔴): `er-node` の `<g>` 要素に `aria-label="テーブル名"` がなく、スクリーンリーダーがノードを「グループ」として読み上げるだけで何のテーブルか不明。各ノードグループには `aria-label="item テーブル"` 相当の属性が必要。
- 修正必須(🔴): `er-diagram-svg` に `role="img"` と `aria-label` がない。SVG全体がスクリーンリーダーに対して無意味なコンテナとして扱われる。`role="img"` + `aria-label="テーブル関係図（ER図）"` または `<title>` 要素が必要。
- 修正必須(🔴): 凡例 `er-legend` のテキスト要素がインライン `fill="#ccc"` で色指定されており、ライトテーマ切替時に凡例テキストが背景に溶け込む可能性がある（ハードコードされた `fill="#1e1e1e"` の背景色と `fill="#ccc"` のテキスト色が CSS 変数を使用していない）。他要素は `currentColor` / CSS 変数を使っているのに凡例だけ例外になっている。
- 修正必須(🔴): `er-node-title`（テーブル名テキスト）と `er-node-column` がクリック対象の `<g>` の子要素だが、`pointer-events: none` が設定されていない（ソース確認）ため、テキスト要素がマウスイベントを消費してしまい mousedown が `<g>` に届かない可能性がある。DOMダンプからは確認できないが、テキストがクリックを遮断するとノード選択が不安定になる（推測）。
- 改善推奨(🟡): activity-bar-item の erDiagram SVG に `aria-hidden="true"` がない（全サイクル継続課題）。
- 改善推奨(🟡): `er-edge-simple` / `er-edge-dynamic` の `<line>` 要素に `aria-hidden="true"` がない。スクリーンリーダーが無意味な線要素を読み上げる。
- 改善推奨(🟡): ノードクリックで即座にテーブルタブが開くが、ER図タブ自体は閉じずに残る設計。「テーブルを確認しながらER図に戻る」という使い方では良いが、ER図タブとテーブルタブの往来でタブバーが肥大化しやすい。将来的にER図を「ナビゲーター的な常設パネル」として位置付けるか、タブとして使うかの設計判断が必要。
- 改善推奨(🟡): ノードをドラッグで移動できるが、タブを閉じて再度開くと位置がリセットされる（推測）。プランナーが整理したレイアウトが消えてしまうため、localStorage 等への位置永続化があると嬉しい。
- 改善推奨(🟡): テーブル数が増えた場合に全テーブルが画面内に収まらないケースへの対処がない。`er-diagram-svg` が `width="100%" height="100%"` のため、ノードが可視領域外に配置されてもスクロールできるかは CSS 次第（推測）。ズームイン/アウトまたはパン操作があると大規模プロジェクトで実用的になる。
- 改善推奨(🟡): テーブルのdescription（日本語名）がER図ノードに表示されない。スクリーンショットでは `item`（英語テーブル名のみ）が表示されており、Explorer サイドバーの `アイテム` という日本語表記が活かされていない。`er-node-title` の下にサブタイトルとして日本語名を表示するか、`title` 属性で tooltip 表示すると識別性が向上する。

### 過去のレビュー結果（2026-03-28 ブックマーク機能新規追加）

#### ブックマーク機能 評価: B
- 変更内容: アクティビティバーにブックマークアイコン追加、サイドバーにBOOKMARKSパネル、セル右クリックで追加/解除、エントリクリックでジャンプ、テーブル名グルーピング、エントリ×ボタン削除、グループ全削除でグループ消滅
- 良い点: アクティビティバーへの統合が自然。既存パネルと一貫した sidebar-panel 構造を使用。グルーピング表示でテーブル横断的なブックマーク管理が可能。ブックマーク済み行の右クリックで「ブックマークを解除」に切り替わるトグル設計が直感的。エントリが「PK値 + 表示名（Sword等）」のペア表示で人間可読性が確保されている。
- 修正必須(🔴): `bookmark-entry` が `div` で、クリックでジャンプする操作要素に `role="button"` / `tabindex="0"` がない。他の操作系div（bottom-panel-action等）には role/tabindex が付いているのに本要素だけ欠落している。キーボードで到達できず、スクリーンリーダーがボタンと認識できない。
- 修正必須(🔴): `bookmark-entry-delete` の `<button>` テキストが `×`（バツ記号）のみで aria-label がない。スクリーンリーダーが「×」と読み上げるため「何のブックマーク削除ボタンか」が不明。`aria-label="item/Sword のブックマークを削除"` のように親エントリのコンテキストを含む aria-label が必要。
- 修正必須(🔴): `bookmark-group-header` が `div` で `role` / `aria-label` がない。他の同種ヘッダー（source-control-section-header 等）も同様だが、グルーピングの存在をスクリーンリーダーが把握できない。
- 修正必須(🔴): エントリのスクリーンショットで表示が「1Sword×」（PKと表示名と×が一行に詰め込まれ間隔なし）となっており、文字同士が連続して読みにくい。`bookmark-entry-pk` と `bookmark-entry-display` の間に最低4px程度のギャップかセパレーター（`: ` 等）が必要。
- 改善推奨(🟡): `bookmark-group-header` に折りたたみ機能がない。テーブルが数十個あるプロジェクトでは同一テーブルのブックマークが大量に並び、他テーブルのブックマークへのアクセスが困難になる。折りたたみ対応、またはグループ数が多い場合のスクロール対応が将来的に必要。
- 改善推奨(🟡): ブックマークが0件のときの空状態メッセージがない。`bookmark-panel-content` が空のままで、「ブックマークはありません。セルを右クリックして追加してください」のようなガイダンスがあると初見ユーザーが迷わない。
- 改善推奨(🟡): activity-bar-item の SVG に aria-hidden="true" がない（全サイクル継続課題。ブックマークアイコンも同様）。
- 改善推奨(🟡): ブックマークジャンプ後に対象行が視覚的にハイライトされる演出がない（推測）。検索結果ジャンプと同様に、ジャンプ先行のセル選択状態が分かるフィードバックが欲しい。
- 参考: bug-report.md にブックマーク関連の不具合記録なし（新機能のため）

### 過去のレビュー結果（2026-03-28 NotificationToast調整3点）

#### NotificationToast調整3点 評価: B
- 変更内容: (1)トーストポップアップ廃止（通常通知はステータスバーメッセージ欄のみ）、(2)DEBUG CONSOLE「API」列→「メッセージ」列に改名、(3)DEBUG CONSOLE行高さ18px固定
- 良い点: 通常通知フロー（show()）では `notification-bell` / `notification-history` が DOM に一切存在せず、旧実装の痕跡が完全排除されている。「メッセージ」列への改名でDOMダンプから `debug-console-col-label` ヘッダーが「メッセージ」になっており一貫している。`notification-message` の `text-overflow: ellipsis` が CSS で正しく設定されており、長いメッセージも安全。行高さ `height: 18px` + `padding: 1px 12px` でコンパクトに仕上がっており、多件数ログ閲覧に適した密度。
- 修正必須(🔴): エラー通知フロー（`エラー通知を表示するとトーストポップアップが右下に表示される` テスト）で `notification-bell` / `notification-history` が依然として DOM に存在する。通常通知フローとエラー通知フローで実装パスが分岐したままであり、廃止されたはずの要素が別フローから呼び出されている。
- 修正必須(🔴): 「トーストエリアがステータスバーの上方に表示される」テストのDOMで `notification-container` 内に `notification-toast-area` と `notification-message` が**同時に**存在する。トーストポップアップ廃止の設計意図と矛盾する。このテスト自体が廃止すべき旧仕様を検証しているか、テストの削除または期待値の修正が必要。
- 改善推奨(🟡): DEBUG CONSOLE 行高さ 18px は11pxフォントに対して適切だが、`padding: 1px 12px` の上下1pxパディングが実効行高さ(18px = コンテンツ + padding)と干渉している可能性。`height: 18px` を `min-height: 18px` に変えないと長いメッセージが折り返せない（現状は `white-space: nowrap` でellipsisになっており問題は顕在化していないが、将来の仕様変更で壊れやすい）。
- 改善推奨(🟡): `notification-message` に `aria-live="polite"` がない（ステータスバーのライブリージョンとして）。スクリーンリーダー利用者には通知が届かない。
- 改善推奨(🟡): activity-bar の SVG に aria-hidden="true" がない（継続課題）。

### 過去のレビュー結果（2026-03-28 旧NotificationToast メッセージバー化）

#### NotificationToast メッセージバー化（第1ラウンド） 評価: C → 本ラウンドで部分修正
- 修正済み: 通常通知フローの `notification-bell` / `notification-history` 廃止を確認
- 未修正: エラー通知フローに `notification-bell` / `notification-history` が残存

### 過去のレビュー結果（2026-03-27 third review）

#### destColumn動的解決の参照ヒント表示（dynamic-reference-dest-column-resolution / reference-hint） 評価: A
- 良い点: destColumn正常系で item_id 列の全行に cell-reference-hint が正確に表示（行1=剣, 行2=槍, 行3=盾）。前回レビューで🔴指摘した「動的参照でcell-reference-hintが表示されない」問題が解消済み。destColumn=存在しない列名の場合は item_id 列の全セルからcell-reference-hintが正しく除去され、数字のみ表示される（安全なフォールバック）。item_id ヘッダーの title="FK: 動的参照 (type_map → master_table.column)" で通常FKと区別できている（正常系・異常系とも一貫）。reference-hintスペックでも単純参照・type_map参照・動的参照の3ケースすべてで cell-reference-hint が正確に表示されている。bug-report #184（destColumn PK列名固定バグ）の修正が参照ヒント表示にも正しく反映されている。
- 改善推奨(🟡): type_id 列（data-col="1"）に cell-error クラスが付いているが、これはテスト用スキーマの参照先が type_map.ja ではなく type_map.id になっているため（FK切れ3件）。実際のテスト意図上は「type_idは正常、item_idを確認したい」はずなので、テストフィクスチャのFK設定が実態に合っているか確認推奨。
- 改善推奨(🟡): cell-error セルに aria-invalid="true"/aria-describedby がない（全サイクル継続課題）。
- 改善推奨(🟡): fill-handle が data-col="0" の位置（left:207px, top:38px）で display:block のまま残存（行1選択時に fill-handle が行2相当の位置に常時表示されている）。

### 過去のレビュー結果（2026-03-27 second review）

#### parentColumnName動的解決（reverse-reference-dynamic-parent-column） 評価: A
- 良い点: id列の cell-reverse-reference-hint に「ガチャ1」「ガチャ2」が正確に表示（code値でマッチングされている）。行切替でミニテーブルフィルタが正確に追随（M001→1行, M002→1行）。bug-report #59（PK値固定ルックアップ）の再発なし。record_id列ヘッダーに title="FK: 動的参照 (table → master.column)" が表示されており通常FKと区別できる。
- 修正必須(🔴): テストタイトル「code列に逆参照ヒントが表示されること」に対してDOMに code列（data-col="1"）へのヒントが存在しない。テスト意図と実装の乖離がある。id列への表示が正しい仕様ならテストタイトルの修正が必要。
- 改善推奨(🟡): relations-table-dirty（●）がデータ変更なし状態でも表示（継続課題）。
- 改善推奨(🟡): fill-handle がミニテーブル（editor-table--inactive）に display:block で残存（継続課題）。
- 未確認: ペインスタック（定義ジャンプ後のRP2）での逆参照ヒント表示テストが存在しない（bug-report #72 再発リスク）。

### 過去のレビュー結果（2026-03-27 first review）

#### destColumn動的解決（dynamicReference） 評価: A
- 良い点: reward_record_id ヘッダーの title="FK: 動的参照 (table → master.column)" で通常FKと区別できている。cell-error が動的参照のバリデーション失敗時に正確に付与される。2種類のエラーメッセージ（「参照先に値なし」と「参照元カラムが空」）が適切に区別されており、プランナーが問題を診断しやすい。RelationsPanelが行切替で動的に参照先テーブルを切り替える（quest id=1でchara、id=2でitem）。RP2（定義ジャンプ後）でも動的参照が正しく解決されている。Undoのバリデーション再計算が正確。
- 修正済み(2026-03-27 third): 動的参照でcell-reference-hintが表示されない問題 → 解消確認。
- 改善推奨(🟡): cell-error セルに aria-invalid/aria-describedby がない（継続課題）。
- 改善推奨(🟡): fill-handle がミニテーブルに display:block で残存（継続課題）。
- 改善推奨(🟡): relations-table-dirty（●）がエラーなし状態でも全セクションに表示。未保存変更がない場合は非表示にすべき。
- 未確認: reward_record_id ドロップダウン候補が reward_table_id の値に応じて動的に切り替わるかのDOMダンプが存在しない。

### 過去のレビュー結果（2026-03-25）

#### プラグインバリデーション機能 評価: B
- 良い点: プラグインバッジ（validation-panel-item-kind-plugin）が警告色（#cda632/黄金色）でPK重複・FK切れの赤バッジと明確に差別化されている。convertPluginErrors()でtableName="(plugin)"グループに分離し、PKエラーグループと視覚的に分断できている。PluginValidationRunnerのrunAllPluginsAsync()が構文エラーをcatchしてプラグインエラーとして報告するフォールスルー設計が適切。executePlugin()がnew Functionで実行スコープをtables/assertに限定しており安全。
- 修正必須(🔴): クリックジャンプ不可の視覚的表現がない。role="button"/tabindex="0"が設定されているにもかかわらず何も起きないアイテムが存在し、プランナーが「壊れている」と誤認する。cursor:default + pointer-events:none の追加またはrole/tabindex の除去が必須。
- 修正必須(🔴): グループ名が "(plugin)" という内部識別子そのまま。プランナー向けには「プラグイン」または「カスタムチェック」等の日本語が適切。
- 修正必須(🔴): location表示が "(plugin):" のみでプラグインファイル名が重複表示される（message側にも "[balance-check.js]" が含まれるため）。locationはプラグインファイル名のみにし、messageにはassertメッセージのみを表示する分離が必要。
- 修正必須(🔴): DOMダンプが存在しない（テストが実行されていない）。plugin-validation.spec.tsは存在するがautoDumpが機能していない。テスト実行後にDOMダンプを確認してビジュアル検証が必要。
- 改善推奨(🟡): validation-panel-group-header に role/aria-label なし（全サイクル継続課題）。
- 改善推奨(🟡): プラグインエラーにはcell-errorクラスが付与されない（セル特定不能）が、エラー件数バッジには計上される。プランナーが「赤バッジが出ているのにどのセルも赤くない」と混乱する可能性。

#### RelationsPanelトグル（非表示時ミニテーブル構築スキップ）評価: B+
- 前回(2026-03-24)から変化なし。未修正課題が継続。

### 横断的な継続課題（最新）
- インタラクティブな div/span 要素に role="button"/tabindex がない（activity-bar-item, notification-bell ほか）
- SVG に aria-hidden="true" がない（filter-icon, sort-icon, activity-bar SVG）
- row-resize-handle がミニテーブル・バッファ行・差分削除行に残存
- cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080から全サイクル継続）
- validation-panel-group-header に role/aria-label なし（全サイクル継続）
- fill-handle が非表示・inactive ペインに display:block で残存
- 起動時スキャン中であることを示すインジケーターなし（2026-03-24）
- editor-right-slot の非表示時に 6px 幅の透明スロットが残留（relations-panel-toggle で新規発見、2026-03-24）
- プラグインエラーのvalidation-panel-itemにrole="button"が付いているが、クリックしても何も起きない（2026-03-25新規発見）
- notification-bell / notification-history がエラー通知フローにまだ残存（2026-03-28 第2ラウンドでも未修正）
- 「トーストエリアがステータスバーの上方に表示される」テストが旧仕様を検証しており、テスト自体の削除または期待値修正が必要（2026-03-28 第2ラウンド発見）
- bookmark-entry-pk-suffix「(1)」がPK値と重複表示で冗長（ISSUE_0125で新規発見）
- ブックマーク済みセルのオレンジ三角マーク（::after）がスクリーンショット上で確認不能（ISSUE_0125で発見）
- bookmark-panel-content 0件時の空状態メッセージがBOOKMARKSパネル直接表示時にない（ISSUE_0125で確認要）
- ※ 旧版で指摘した bookmark-entry role/tabindex, aria-label, bookmark-group-header role, セパレーター欠如 は全て修正済み（ISSUE_0125で解消確認）
- er-node (<g>要素) に role="button"/tabindex がない（2026-03-28 ER図機能で新規発見）
- er-diagram-svg に role="img"/aria-label がない（2026-03-28 ER図機能で新規発見）
- er-legend の fill/stroke がCSSカスタムプロパティを使わずハードコード（テーマ切替時に破綻するリスク）
- search-replace-button / search-replace-all-button に aria-label がない（2026-03-28 検索置換機能で新規発見）
- search-panel-replace-input に aria-label がない（search-panel-input も同様）（2026-03-28 検索置換機能で新規発見）
- search-result-replace-preview の span に aria-hidden がなく、スクリーンリーダーが「元の値 → 置換後」を区別できない（2026-03-28 検索置換機能で新規発見）
- search-panel-replace-row の show/hide が style="" 空文字制御で、hidden 属性または CSS クラスより壊れやすい（2026-03-28 検索置換機能で新規発見）
- regex オプションボタン（.*）に title 属性がなく、Aa / |ab| と一貫性がない（2026-03-28 検索置換機能で新規発見）
- バッファ行（editor-table-empty-row）のbool列にcell-bool-uncheck SVGが表示されており空値とFalse値が視覚的に区別できない（2026-03-28 型別入力コントロールで新規発見）
- cell-bool-check/uncheck セルに role="checkbox"/aria-checked がなく、スクリーンリーダーがチェックボックスとして認識できない（2026-03-28 型別入力コントロールで新規発見）
- cell-bool-check と cell-bool-uncheck の SVG path が同一形状で色/透明度のみの区別（色覚異常対応が不十分）（2026-03-28 型別入力コントロールで新規発見）
