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

### 最新レビュー結果（2026-03-27 third review）

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
