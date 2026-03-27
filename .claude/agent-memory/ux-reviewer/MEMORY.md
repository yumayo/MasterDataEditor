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

### 最新レビュー結果（2026-03-28 ブックマーク機能新規追加）

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
- bookmark-entry に role="button"/tabindex がない（2026-03-28 ブックマーク機能で新規発見）
- bookmark-entry-delete の <button> に aria-label がない（2026-03-28 ブックマーク機能で新規発見）
- bookmark-group-header に role/aria-label がない（validation-panel-group-header と同パターン）
- bookmark-entry-pk / bookmark-entry-display 間のビジュアルセパレーターなし（「1Sword」と連続表示）
