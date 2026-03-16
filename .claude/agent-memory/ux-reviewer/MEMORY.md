# ux-reviewer メモリ

## プロジェクト: App.MasterDataEditor

### UXレビュー実績

#### RelationsPanel 定義ジャンプ状態のタブ切替時リセット（過去の指摘、修正済み）
- 評価: 修正済み（bug-report.md #73で記録）
- TabStateにpaneStack/viewIndexを保存・復元するよう修正された

#### ミニテーブル行操作によるメインテーブルデータ破損（過去の指摘、修正済み）
- 評価: 修正済み（bug-report.md #80で記録）
- storeRowIndicesの陳腐化とreloadCellsFromStoreの行数非反映が原因で修正済み

#### 差分タブ重複開き防止（2026-03-15レビュー）
- ファイル: project_diff_tab_dedup.md
- openDiffTab()の重複防止とremoveTabButton()のDOM除去修正が適切に実装されている

#### 差分ビュー右ペインFKドロップダウン追加（2026-03-15レビュー）
- ファイル: project_diff_tab_dropdown.md
- dropdownContainer=wrapperElementパターンで overflow クリッピングを回避
- console.log デバッグログが GridDropdownInput.show() に残存（本番環境への混入リスク）
- 左ペインの読み取り専用状態がDOM上で明示されていない（aria属性なし）

#### BUG_0021 非連番keyスキーマのソート・差分ビューずれ修正（2026-03-16レビュー）評価: A
- ファイル: project_bug0021_non_sequential_key.md
- ソート: data-store-index が attack昇順(10<50<80)に正しく並び替わっている（attack列ヘッダーに sort-asc クラス付与）
- 差分ビュー: CSV列インデックス5(recover_hp)→DOM列インデックス3 への変換が正しく行われ diff-cell-deleted/added が正確に配置されている
- 残課題: 差分ビュー左ペイン（HEAD版）に aria-readonly などの読み取り専用マークアップが皆無（前回レビューの指摘継続）
- 残課題: 差分ビューの行レベルに data-diff-kind="modified" などの属性がなく行単位のアクセシビリティ強調が困難

#### BUG_0022 差分ビューパディング行高さ修正（2026-03-16レビュー、ラウンド2対応確認済み）評価: B
- ファイル: project_bug0022_padding_row_height.md
- createPaddingRow()共通化でheight:20px が正しく付与されバグ解消（ラウンド1）
- ラウンド2追加確認: notifyRightPaneRowDeleted の通常削除パスでも createPaddingRow が使われ height:20px 統一を確認
- ラウンド2追加確認: Undo後の左右ペインの行数・クラスが削除前と完全一致することを確認
- ラウンド2追加確認: 削除後パディング行の row-resize-handle 除去を確認
- 残課題(🔴): 挿入パディング行は diff-row-padding-inserted クラスがあるが、削除パディング行には対称クラスがない。bug-report #3パターン（対称操作の欠落）に該当
- 残課題(🟡): data-row="3" data-store-index="2" のパディング行が store-index を持っており、意図的かゴミ属性か不明
- 残課題(🟡): 削除直後の左ペインに editor-table--inactive がなく、Undo後には付与されるという非対称
- 残課題(🟡): 左ペイン読み取り専用の aria 属性欠如（継続指摘）

#### FEAT_0024 ライトテーマ色改修（ラウンド2 フィードバック修正後）評価: B+
- ファイル: project_feat0024_light_theme.md
- ラウンド1の主要問題（テーマ設定漏れ・ダークオーバーライド欠如）は解消済み
- 残課題: `command-palette.css` に `[data-theme="dark"] .command-palette-item.selected:hover` がない（grid-dropdown との非対称）
- 残課題: `command-palette.spec.ts` の `setupTestPageAsync()` がダークテーマのまま（`data-theme="dark"` をダンプで確認）
- 残課題: コマンドパレット・ドロップダウンの aria-selected / role="listbox" 未実装（継続）

#### FEAT_0025 通常テーブル末尾バッファ行自動補充（ラウンド2フィードバック修正後）評価: A
- ファイル: project_feat0025_buffer_row.md
- deleteRow経路・reloadCellsFromStore経路へのバッファ行補充追加が正しく動作確認（テスト4追加）
- テスト4: 2行→potion削除→sword1行+バッファ行の構造が正しい。ダーティ状態も削除後にvisibleになっている
- テスト3（Undo後）: バッファ行蓄積なし、ダーティ状態リセット済みを確認
- 残課題(🟡): テスト4のダンプでコンテキストメニューが開いたまま残存（left:326px,top:79pxのstyle付き）。deleteRow後にmenu.hide()が呼ばれているか確認が必要
- 残課題(🟡): deleteRow→Undo後のダーティ状態リセットのテストが存在しない（テスト3は昇格Undoのみ）
- 残課題(🟡): バッファ行に row-resize-handle が付いており除去漏れの継続指摘
- 要確認: `diffTab === false` 除外が deleteRow/reloadCellsFromStore 経路にも適用されているかはDOMから確認不可

#### FEAT_0027 クイックビュー改修（CSS改修ラウンド2含む）（2026-03-17レビュー）評価: A
- ファイル: project_feat0027_quick_view_mini_editor.md
- body直下 position:fixed 配置・max-width削除・max-height追加・300msディレイ削除がすべて正しく動作
- 表示/非表示の対称性（visibleクラス付け外し + 中身の空化）が正しく実装
- 残課題(🔴): クイックビュー内 .editor-table に editor-table--inactive が付いていない（ラウンド2でも未修正）
- 残課題(🟡): relations-table-dirty・relations-table-context がクイックビューヘッダーに欠如（RelationsPanelと非対称）
- 残課題(🟡): role="tooltip" / aria-live="polite" なし（スクリーンリーダー非対応）

#### FEAT_0026 フィルターアイコンSVG化（2026-03-16レビュー）評価: A
- DOM: `span.filter-icon > svg[viewBox="0 0 14 14"] > path[fill="currentColor"]`
- createElementNS で生成（innerHTML 回避）、`style="display: block;"` でベースラインズレ防止
- `fill="currentColor"` でテーマ対応完全（JS分岐なし）
- `mousedown` バブリング抑制 / `filter-active` 時の色変化 いずれも適切
- HEADER_ICON_AREA_PX=48 との整合性維持確認（right:30px+width:14px=44px < 48px）
- 残課題(🟡): SVGに `aria-hidden="true"` がなく、span.filter-icon に `aria-label` / `role="button"` もない
- 継続パターン: インタラクティブな `span` に role 未付与（コマンドパレット・ドロップダウンと同じ課題）

#### FEAT_0028 SourceControlPanel見た目改修（2026-03-16レビュー）評価: B+
- STAGED上・CHANGES下の配置が正しく実装されている（DOM順で確認）
- 2行構造（.explorer-file-description + .explorer-file-name）がCHANGESアイテムで正しく表示される
- アクティブ状態の排他制御（セクションをまたいだ .source-control-file-item-active トグル）が正しい
- タブとパネルアイテムの双方向状態同期が確認できた
- 残課題(🔴): STAGEDセクションのアイテムに .explorer-file-description が存在しない（CHANGESとの構造的非対称。bug-report #3パターン）
- 残課題(🔴): .source-control-file-item が div 要素のままで role="button" / tabindex がない（継続する span/div インタラクティブ要素問題）
- 残課題(🟡): 差分タブをXで閉じたとき .source-control-file-item-active が外れるかのテストが確認できない（対称操作のテスト不在リスク）
- 残課題(🟡): タブバーのタブを直接クリックで切り替えたとき、パネル側アクティブが追従するかの確認が必要（状態波及漏れリスク）
- 参考: .source-control-panel が非アクティブ時に sidebar-panel 基底クラスを持たない（他パネルとの不一致）

#### ヘッダーアイコン領域確保（FEAT_0023、2026-03-15レビュー）評価: A
- `.editor-table-column-header.has-icons { padding-right: 48px }` と `HEADER_ICON_AREA_PX = 48` の連動が適切
- ミニテーブル除外が CSS付与（isMiniTableInstance()条件）とJS幅計算（hasIcons=false）の両方で対称に実装されており bug-report #3パターンを回避
- 要改善: `has-badge` による `padding-left:32px` が `calculateColumnWidth` に加算されていない。長いPK/FK列名（例: `player_character_id`）で列名が右側アイコン領域に食い込む可能性あり
- `HEADER_ICON_AREA_PX` の算出根拠（filter-icon right:30px、width:14px）が CSS の absolute positioning に依存しており、CSSを変更した際に定数の更新漏れが起きやすい構造

#### 差分ビューペインリサイズハンドル（2026-03-16レビュー）評価: A
- ファイル: project_diff_view_resize_handle.md
- flex-basisパーセンテージ管理・20〜80%クランプ・userSelect解除がすべて正しく実装
- RelationsPanelハンドルとまったく同じパターンで一貫性あり
- 残課題(🔴): 初期状態でハンドルが視覚的に不可視（background: var(--border-color)のみ、border等の常時表示手がかりなし）
- 残課題(🟡): height/align-self 明示なし、ドラッグ中クラスなし、均等リセット手段なし、aria属性なし

#### N:1ミニテーブル コンテキストヒント修正（2026-03-17レビュー）評価: A
- ファイル: project_n1_context_hint.md
- `span.relations-table-context` が N:1 ヘッダーに正しく追加され、1:N と構造的に対称化された
- テキスト更新（行変更時に quest_id=1 → quest_id=2）も正しく動作
- 残課題(🟡): relations-table-context に title 属性なし（長い列名でツールチップなし）
- 残課題(🟡): ミニテーブルの row-resize-handle 残存（継続指摘）
- bug-report #104（N:1とN:1の対称操作欠落）パターンの修正として適切

#### BUG_0025 差分ビュー行挿入後の左ペイン行番号表示修正（2026-03-17レビュー）評価: B+
- 修正の核心: 左ペインのパディング行に行番号が表示されるようになった（data-row-index と 1-indexed 表示が正しく対応）
- 再ナンバリング: 挿入後の既存行の行番号が正しくインクリメントされている（左右ペインで対応行の data-row が一致）
- 残課題(🔴): 右ペインの diff-row-initial-padding に row-resize-handle が残存（左ペインは除去済みで非対称。BUG_0022継続）
- 残課題(🔴): diff-row-deleted 行に row-resize-handle が残存（削除済み行のリサイズは不要で誤操作リスク）
- 残課題(🔴): 行挿入後もコンテキストメニューが残存（left:822px,top:100px/79px のstyle付き）。hide()漏れパターン継続（bug-report #8/#65）
- 残課題(🟡): 左ペイン aria-readonly 欠如（BUG_0021〜BUG_0023から継続）
- 残課題(🟡): diff-row-deleted 行に data-diff-kind 属性なし（BUG_0021から継続）
- 残課題(🟡): 左右ペインで data-row 衝突継続（左=パディング行・右=実データ行の同一 data-row 値）

#### BUG_0023 差分ビューパディング行保存・Dirty・通常タブ反映修正（2026-03-17レビュー）評価: A-
- テスト1: Dirty消去確認済み（tab-button-dirty に visible クラスなし）。bug-report #102修正が有効
- テスト2: パディング行（diff-row-padding-inserted）に data-store-index なし → CSV除外が属性レベルで正しく実装
- テスト3: 通常タブに追加行（id=5）が存在、cell-git-changed クラスで差分ハイライト表示。バッファ行（editor-table-empty-row）1行維持
- 残課題(🔴): 左右ペインで data-row="5" が衝突（左=パディング行・右=実データ行）。行番号の意味が左右で一致しない
- 残課題(🔴): 保存後もコンテキストメニューが残存（left:822px,top:142px のstyle付き）。FEAT_0025レビューと同じ hide()漏れパターン（bug-report #8/#65）
- 残課題(🔴): 差分ビュー左ペイン aria-readonly 欠如（BUG_0021・BUG_0022から継続）
- 残課題(🟡): CHANGES セクションに保存後も quest_reward が残る（git add との区別が不明確。ツールチップ等で補足が必要）
- 残課題(🟡): diff-row-deleted 行に data-diff-kind 属性なし（BUG_0021から継続）
- 確認パターン: 保存経路（Ctrl+S）でのコンテキストメニュー hide() 漏れは「操作パスの網羅漏れ」パターン（bug-report #8, #65）の典型

#### マウスクリック/Shift+クリック 自動スクロール追加（2026-03-17レビュー）評価: A-
- ファイル: project_scroll_position_autoscroll.md
- マウスクリック: fill-handle left:519px/top:668px + corner-cell left:161px → 行32・列2へのスクロール正常
- Shift+クリック: 31行のrow-header selected + 列ヘッダー1個 = 32要素選択 + corner-cell left:0px → 拡張先スクロール正常
- Tab確定後・セル編集確定後もスクロール位置維持を確認（top=1907px/2033px）
- 残課題(🟡): selectRow/selectColumn/extendToRow/extendToColumn/selectAll に scrollFocusIntoView 未追加（対称操作の欠落 bug-report #3）
- 残課題(🟡): scrollCellIntoView の rAF ID を保持していないため高速連続クリック時の競合リスク（bug-report #85パターン）

#### FEAT_0032 tab-list height: 100% 追加（2026-03-17レビュー）評価: A
- CSS 1行追加のみ。tab-scroll-area(47px)全体を tab-list が埋めることを2テストで検証
- クリック領域がタブの下半分まで拡大されプランナーの高速タブ切り替えが改善
- 残課題(🟡): li.tab-button に role="tab" / aria-selected なし（コマンドパレット・ドロップダウンと同じ継続パターン）
- 残課題(🟡): .tab-button-dirty に title 属性なし（未保存ドットの意味が初見では不明）
- 要確認: .tab-button の height は tab.css に明示ルールなし（flex stretch で伸びている可能性。CSS側の根拠明示が望ましい）

#### FEAT_0033 フィルターとソートアイコンの位置・見た目調整（2026-03-17レビュー）評価: A
- ソートアイコン: createElementNS で SVG 化。ascSvg(10x6)とdescSvg(10x6)が sort-indicator 内に縦並び（gap:1px）
- フィルターアイコンhover: background-color 削除済み。color: var(--font-color) のみ変化するスッキリした実装
- フィルターアイコン(right:30px)とソートインジケーター(right:8px)の間に36pxの隙間があり重ならない
- fill="currentColor" と opacity:0.3/1.0 の二段階表現で「ソート可能/ソート中」の状態が視覚的に明確
- 残課題(🟡): sort-indicator div に role="button" / title / aria-label がない（継続パターン）
- 残課題(🟡): sort-icon-asc/desc の svg に aria-hidden="true" がない（FEAT_0026と同じ継続課題）
- 残課題(🟡): HEADER_ICON_AREA_PX=48 の算出根拠が CSS の absolute positioning に依存（CSSを変えると定数更新漏れリスク）
- 良いパターン: sortIndicator.addEventListener('mousedown', e.stopPropagation) で列選択への誤バブリングを防止

#### FEAT_0035 フィルター機能改修（2026-03-17レビュー）評価: A-
- ファイル: project_feat0035_filter_improvements.md
- 7つの改修（空文字除外・ESCキー・FK参照ヒント・ヒント検索・「検索結果なし」・横幅拡大・ボタン均等幅）すべて正常動作確認
- FK列フィルター: label.filter-item > span.filter-item-label + span.filter-item-hint の2要素構造
- 非FK列フィルター: label.filter-item > span.filter-item-label のみ（filter-item-hint なし）。FK/非FK列で対称に実装
- 空文字除外: category列に空文字セルが2行あってもドロップダウンリストに空文字エントリーなし
- 空文字行常時表示: weapon選択フィルター適用後も空文字行が display:none にならず表示維持（正しい）
- 行数カウンター: div.filter-row-count に "3 / 5 行" 形式で表示（適用中のみ display:block）
- 残課題(🟡): filter-dropdown に role="dialog" / aria-label がない（スクリーンリーダー非対応）
- 残課題(🟡): filter-item の label 要素に for 属性がない（内包関係は機能するが明示的関連付けが望ましい）
- 残課題(🟡): filter-item-hint に aria-label がない（「これが何のヒントか」が機械可読でない）
- 残課題(🟡): filter-apply が filter-buttons div の外で独立している（DOM構造の整理余地あり）
- 残課題(🟡): filter-no-result に aria-live="polite" がない（動的更新のスクリーンリーダー非対応）

#### FEAT_0036 列幅自動調整機能（2026-03-17レビュー）評価: A
- ファイル: project_feat0036_column_resize_autofit.md
- ダブルクリック自動幅: `name`列が296pxに計算（`very_long_item_name_exceeding_default_width`包含。正確）
- FK参照ヒント含む幅: `enemy_id`列が233pxに計算（「超強力なレッドドラゴン（エリート）」を包含。正確）
- 複数列D&D等幅一括: id列・name列が共に179pxに揃い、value列（非選択）は99pxのまま不変
- 複数列ダブルクリック各列独立: id列77px（短い整数）・name列296px（長い文字列）と各列データ量に応じた異なる幅
- Undo/Redo連鎖: Ctrl+Z後に元幅復元+Dirty解消、Ctrl+Y後に自動調整幅再適用+Dirty付与 いずれも正常
- 最小幅制約: 全列50px以上を維持
- 注意点: 列幅変更でも `tab-button-dirty-visible` が付く（CSV保存不要な表示設定変更なのにDirtyフラグが立つ）
- 注意点: `複数列D&DリサイズをCtrl+Z 1回で全列が元の幅に戻ること` のダンプファイルが `&` 文字によりファイルシステム上で欠落（autoDumpのエスケープ漏れ）

#### FEAT_0034 アクティビティバー調整（2026-03-17レビュー）評価: A-
- gitアイコン: circle×3 + path でブランチ分岐を正確に表現。stroke="currentColor"でテーマ対応完全
- 透明border常時配置: `.activity-bar-item { border-left: 2px solid transparent; box-sizing: border-box }` でレイアウトシフト防止
- 選択色: `.activity-bar-item-active { border-left: 2px solid var(--selection-color) }` でVSCode準拠の青色border
- 全アイコンが fill="currentColor" / stroke="currentColor" で統一。bug-report #116（ハードコード色）パターン回避
- 残課題(🔴): `.activity-bar-item` が div 要素で role="button" / tabindex / aria-label がない（キーボード操作不可・継続パターン）
- 残課題(🔴): SVGに aria-hidden="true" がなく親要素にも aria-label がない（FEAT_0026・FEAT_0033と同じ継続課題）
- 残課題(🟡): SVG生成に innerHTML を使用（createElementNS を推奨するプロジェクト方針との不一致）
- 残課題(🟡): gitアイコン下端ノード cy=20+r=2.5 → 下端22.5px（viewBox下端まで1.5px）。stroke-width=1.5でclip懸念
- 残課題(🟡): アクティブ時にアイコン色自体の変化がない（opacity変化 + border-left のみ。アイコン青染めで二重強調の余地あり）

### このプロジェクトの評価軸メモ
- 核心機能 = 外部キー参照の苦痛解消（定義ジャンプ、RelationsPanel）
- 差別化機能が壊れている場合は問答無用で評価下げ
- 状態の永続性（タブ切替をまたいだ状態保存）はユーザーの当然の期待
- 特殊タブ（差分タブ・設定タブ）は `tabStates` に登録されない → DOMクリーンアップは独自に行う必要あり
- `show/hide` や `activate/deactivate` の対称性チェックが繰り返し指摘されている（bug-report #3, #32, #77, #84）

### DOM構造パターン（良い例）
- タブバー: `div#tab > div.tab-scroll-area > ul#tab-content.tab-list > li.tab-button`
- タブボタン: `.tab-button-name`, `.tab-button-dirty`, `button.tab-button-close` の3要素構成
- ソース管理パネルは `div.source-control-panel` として sidebar 内に存在

### 繰り返し発生するUI問題パターン（bug-report.mdより）
1. 対称操作の欠落（#3, #32, #44, #54, #58, #74, #77, #84）
2. 操作パスの網羅漏れ（#8, #23, #65, #78, #79, #90）
3. クロージャ/キャッシュの陳腐化（#6, #91, #92）
4. 状態変更の波及先への未伝播（#4, #80, #90）
5. 非同期レースコンディション（#42, #60, #77, #86）
