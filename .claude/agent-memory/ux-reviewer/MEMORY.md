# ux-reviewer メモリ

## プロジェクト: App.MasterDataEditor

### UXレビュー実績

#### アーカイブ（2026-03-15〜17）
- ファイル: project_review_archive_mar2026.md
- 差分タブ・BUG_0021〜0025・FEAT_0023〜0036 の要約と横断的継続課題リストを収録

#### FEAT_0045/ISSUE_0079 通知UI + 参照エラー通知（2026-03-19初回C→2026-03-20 B→2026-03-21 B）
- ファイル: project_feat0045_notification.md
- 修正済み: notification-bell に role="button"/tabindex="0"/aria-label 付与
- 修正済み: notification-toast に role="alert" 付与
- 修正済み: ベルSVGに aria-hidden="true" 付与
- 修正済み: notification-container をステータスバー内に移動（ISSUE_0079）
- 修正済み: notification-bell に aria-expanded が付与され open/close 状態と連動（2026-03-21確認）
- 修正済み: 参照エラー（console.warn 握りつぶし分）をトーストで通知（2026-03-21確認）
- 修正済み: エラーメッセージが業務用語（「参照テーブルの事前読み込みに失敗しました」等）で記述
- 修正済み: FIFO 3件スタック・4件目追加で最古消失・履歴には全件保持
- 残存(🔴): トーストが縦書き表示（status-bar フレックス継承か flex-direction:column の影響と推察）
- 残存(🔴): 履歴パネルを閉じる手段がDOM上に存在しない（×ボタンなし、ESCハンドラ不明）
- 残存(🔴): 同一メッセージの重複トースト積み上がり（「関連パネルの更新に失敗しました」x2が同時出現）
- 残存(🟡): notification-history-item に role="listitem" なし・notification-history に role="list" なし
- 残存(🟡): トーストにタイムスタンプなし（いつ発生したエラーか不明）
- 残存(🟡): severity 区別なし（全トーストが同一赤色、warning/error 2段階推奨）

#### FEAT バリデーションエラーパネル / ResizeHandle / 未開封テーブルジャンプ（初回B→A→A→A→2026-03-21 A-）
- ファイル: project_feat_validation_panel.md
- 修正済み: validation-panel-item に role/tabindex / status-bar-badge に role/tabindex / show/hide 対称
- 修正済み: validation-panel-close に role/tabindex/aria-label 付与済み
- 修正済み: resize-handle クラスを Sidebar/RelationsPanel/PROBLEMSパネルで共通化（data-direction属性）
- 修正済み: ステータスバーにエラーアイコン+件数追加、aria-hidden/role/tabindex/aria-label 完備
- 修正済み: 超過分戻りきりドラッグ（prevCoord += consumedDelta 方式）3パネル全て対応、DOMで確認
- 修正済み（2026-03-21）: 未開封テーブルへのジャンプ機能を追加。cell-error+editor-table-cell-focused が正しく付与されることDOMで確認
- 残存(🔴): cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080 から継続）
- 残存(🟡): validation-panel-group-header に role/aria-label なし（全サイクル継続課題）
- 残存(🟡): validation-panel-item に aria-label なし（3 span分散のスクリーンリーダー読み上げ懸念）
- 残存(🟡): resize-handle に aria 属性なし（role="separator"/aria-orientation/aria-label 推奨）
- 残存(🟡): バッジのエラー0件時の視覚的区別なし（data-error-count="0" CSSグレーアウト推奨）

#### ISSUE_0080 動的参照バリデーション（2026-03-20レビュー）評価: B+
- cell-error の付与箇所・エラー件数カウント・PROBLEMSメッセージ内容はすべて正確
- BUG#151（参照先テーブル未ロード時の消失）への対処有効性をDOMで確認
- 残存(🔴): cell-error セルに aria-invalid="true" / aria-describedby がない
- 残存(🟡): テスト1のスクリーンショットで reward_record_id 列が画面外（DOMでは確認できるが視覚検証不可）
- 残存(🟡): validation-panel-group-header に role/aria-label なし（継続課題）
- 残存(🟡): 動的参照FKバッジの title が内部式（$(...)）を露出している
- 残存(🟡): バッファ行に row-resize-handle 残存（継続パターン）
- PROBLEMSパネルは display:none のまま（エラー自動開閉廃止の意図通り、赤波線が視覚的補完）

#### bug-diff-tab-textfield-scroll DiffTab右ペインスクロール後テキストフィールドずれ修正（2026-03-21レビュー）評価: A
- 修正済み: GridTextField.show() に container.scrollLeft/scrollTop の加算を追加
- DOMで確認: textfield(top:525,left:141) と selection(top:524,left:141) が整合、scrollTop=300 で正しく配置
- DOMで確認: fill-handle(top:542) も selection.top+height-2 と一致（整合）
- 知見: `position:absolute` 要素の offsetParent がスクロールコンテナ自体の場合は scrollTop/scrollLeft 加算が必要。innerWrapper（スクロールに追従するフロー要素）が offsetParent の場合は不要。コンストラクタコメントで明記するパターンが必要
- 残存(🔴): 左ペインの grid-textfield に contenteditable="true" が残存（makeReadOnly() で contentEditable='false' 設定推奨）— 2026-03-22日本語修正レビューでも未対処確認
- 残存(🔴): 左ペインの editor-table に aria-readonly="true" がない（BUG_0021 から継続）— 2026-03-22日本語修正レビューでも未対処確認
- 残存(🟡): diff-resize-handle に role/aria-orientation/aria-label がない（ISSUE_0092 から継続）
- 残存(🟡): 差分タブ右ペインにバッファ行がない（編集可能ペインにもかかわらず data-row max=99、意図的設計であれば要コメント明記）
- 要bug-report記録: 今回の修正は bug-report.md に未記載。#168 として追加推奨

#### diff-tab-japanese 差分ビュー日本語表示修正（2026-03-22レビュー）評価: A
- 修正済み: GitCommandHelper.RunGitCommand の StandardOutputEncoding を UTF8 に設定
- DOMで確認: 左ペイン「スライム/ドラゴン/ゴブリン/最も弱い魔物/最強の魔物/群れで襲ってくる」すべて文字化けなし
- DOMで確認: diff-cell-deleted（左ペイン description行1）/ diff-cell-added（右ペイン description行1）が正確に付与
- DOMで確認: 変更のない行2・行3に誤検出なし
- bug-report.md #172 として StandardOutput エンコーディング未指定の原因が記録済み
- 残存(🔴): 左ペイン grid-textfield contenteditable="true" 継続未対処（makeReadOnly()推奨）
- 残存(🔴): 左ペイン editor-table に aria-readonly="true" なし（BUG_0021継続）
- 残存(🟡): diff-resize-handle に aria 属性なし（role="separator"/aria-orientation）
- 残存(🟡): 全データ行に row-resize-handle 残存（左右ペイン各3行、差分ビューで必要か要確認）
- 残存(🟡): 左ペインに fill-handle が display:block で表示（読み取り専用ペインには不要）

#### ISSUE_0092 差分タブスクロール位置復元（2026-03-21レビュー）評価: A
- 修正済み: DiffTab.hide()でスクロール位置保存、show()で復元+行ヘッダー強制同期
- DOMで確認: diff-pane-left/rightの全corner-cell・row-headerのleftが200pxに揃っている（scrollLeft=200pxのテストケース）
- DOMで確認: diff-cell-deleted/addedが正確（1変更行に限定、誤検出なし）
- 残存(🟡): diff-resize-handleにaria属性なし（role="separator"等）
- 残存(🟡): 差分タブ内のrow-resize-handleが全データ行に残存（データ行3行x左右2ペインで6個）
- 残存(🟡): fill-handleが左右両ペインに存在（差分ビューでのfill操作の意図確認推奨）
- 継続(💡): 差分ビュー左ペインにaria-readonlyなし（BUG_0021から継続、スコープ外）

#### BUG_0026 クイックビュー位置調整（2026-03-19レビュー）評価: B+
- ファイル: project_bug0026_quick_view_position.md
- 下端はみ出し: top固定+max-height動的付与 正常（top:620px, max-height:100px）
- 右端フォールバック: クイックビューがドロップダウン左側（left:872px < dropdown left:1080px）に配置
- 残課題(🔴): 右端フォールバック時のダンプに max-width の style 属性が確認できない
- 残課題(🔴): max-height:100px は多行参照時に内容が切れる可能性。overflow-y:auto のアサートが必要
- 残課題(🟡): 「max-height が設定されており overflow-y が auto である」テストのダンプが通常配置になっている疑い
- 残課題(🟡): relations-table-context がクイックビューヘッダーに欠如（継続指摘）
- 残課題(🟡): バッファ行に row-resize-handle 残存・role/aria-label 欠如（継続パターン）

### このプロジェクトの評価軸メモ
- 核心機能 = 外部キー参照の苦痛解消（定義ジャンプ、RelationsPanel）
- 差別化機能が壊れている場合は問答無用で評価下げ
- 状態の永続性（タブ切替をまたいだ状態保存）はユーザーの当然の期待
- 特殊タブ（差分タブ・設定タブ）は `tabStates` に登録されない → DOMクリーンアップは独自に行う必要あり
- `show/hide` や `activate/deactivate` の対称性チェックが繰り返し指摘されている（bug-report #3, #32, #77, #84）
- ミニテーブルの設計原則: ストアの全行を保持し、表示のみFKフィルタリング（storeRowIndicesのサブセット管理はしない）

#### ISSUE_0090 ファイルウォッチャーバッジ表示（2026-03-21レビュー）評価: B
- activity-bar-item[data-panel="sourceControl"] の子に `<span class="activity-bar-badge">N</span>` が動的付与される設計
- バッジ非表示時は span 自体が DOM から消える（display:none ではなく DOM 除去方式）
- スクリーンショットで青い丸バッジ＋数字が視認可能。VSCodeとほぼ同等の見た目を達成
- 残存(🔴): activity-bar-item[data-panel="sourceControl"] に role="button"/tabindex="0" がない（継続課題：横断的なアクセシビリティ問題）
- 残存(🔴): activity-bar-badge に aria-label がない（「3件のファイル変更」等の読み上げ不可）
- 残存(🔴): source-control-panel の staged/changes セクションが空（バッジ件数とパネル内容の不一致）
- 残存(🟡): activity-bar SVG に aria-hidden="true" がない（横断的継続課題）
- 残存(🟡): バッジ数字が大きい場合（99+以上）の表示崩れ対策がDOM上で確認不可（推測）

#### EditorAPI onTableSaved/onRowSelected イベント追加（2026-03-22レビュー）評価: A
- UI変更なし。プログラマティックAPIの追加のみ
- 正常: emitTableSaved は CSVへの書き込み完了 .then() 内で発火（保存前発火なし）
- 正常: onRowSelected はストアインデックス（0始まり）で通知（data.getRows() と対応）
- 正常: ミニテーブルの行選択は onRowSelected をスキップ（外部スクリプトへの誤通知なし）
- 正常: dispose パターンが5イベント全て indexOf+splice で対称実装
- 残存(🟡): onRowSelected がテーブル初回展開の初期フォーカス時にも発火する仕様が EditorEventsAPI のコメントに未記載
- 残存(🟡): ミニテーブル経由保存で onTableSaved が発火するか否かが仕様上不明確
- 残存(🟡): EditorEventsAPI 全イベントに JSDoc がない（rowIndex の0始まり等の仕様が型定義から読み取れない）
- 残存(🟡): ダーティでない状態の Ctrl+S で onTableSaved が発火するか否かのテストなし

#### EditorApiBridge dispose/二重install防止（2026-03-22レビュー）評価: A
- UI変更なし。C#↔WebViewブリッジのライフサイクル管理APIの追加のみ
- 正常: `false` センチネル値でインストール状態を管理（null/undefined 不使用、ガイドライン準拠）
- 正常: install() 二重呼び出しで即エラー、dispose() 未インストール時も即エラー（サイレント無視なし）
- 正常: install/dispose の対称性確認済み（addEventListener/removeEventListener + センチネルリセット）
- 正常: dispose→install 再登録後にリクエストが再処理されることをテストで確認
- 正常: dispose 後のデータ状態に副作用なし（DOMダンプ3件でグリッドデータが同一）
- 残存(🟡): `window.__editorApiBridge` がプロダクションビルドでも露出する（ビルド時フラグでのガード推奨）
- 残存(🟡): `requireArray` の中身の型チェックなし（setCellValues で不正 changes 配列を渡した際のエラーメッセージが内部例外になる）
- 残存(🟡): sendBridgeRequestAsync の timeoutMs 値（1000ms vs 3000ms）に定数化なし（意図がコメントなしで不明瞭）

#### type-validation 型バリデーション（2026-03-22レビュー）評価: A-
- 正常: int列の型不一致（"abc"）に cell-error が正確に付与。行1のvalue列のみ。誤検出ゼロ
- 正常: エラー解消後に cell-error が消え、validation-panel-empty・data-error-count="0" に正しく切り替わる
- 正常: string型列は数値文字列を入れてもエラーにならない（仕様通り）
- 正常: PROBLEMSメッセージが「型不一致 / item 行1 value: / 値 "abc" は型 int と一致しません」と業務用語で明確
- 残存(🔴): cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080・FEAT_validation継続）
- 残存(🔴): 列ヘッダーに型情報バッジがない（int型列のヘッダーに型種別が視覚的に示されていない）
- 残存(🟡): validation-panel-group-header に role/aria-label なし（全サイクル継続）
- 残存(🟡): validation-panel-item に aria-label なし（3span分散）
- 残存(🟡): data-error-count="0" 時のバッジアイコンがグレーアウトされていない
- 残存(🟡): バッファ行（editor-table-empty-row）に row-resize-handle 残存（継続パターン）
- 残存(🟡): エラー解消後も validation-panel が display:block のまま（エラー0件で自動閉じ推奨）
- 知見: 空文字はint型バリデーションをスキップする仕様（バッファ行の空セルにエラー出ない）。validation-engine.tsのコメントへの明記推奨

#### ISSUE_0102 PROBLEMSパネルジャンプ後フォーカス修正（2026-03-22初回レビューA → 2026-03-22再修正レビューA）
- 初回修正: jumpToError() 内で handler.activate() を呼んでフォーカスを grid-textfield に確実に戻す
- 再修正: ジャンプ後にキー入力した文字がテキストフィールドに反映されない問題を修正（bug-report.md #174）
- DOMで確認（FK切れ再修正後）: grid-textfield-active に "a" が保持されている（文字が消えない）
- DOMで確認（PK重複再修正後）: grid-textfield-active に "x" が保持されている（文字が消えない）
- DOMで確認（FK切れ）: grid-textfield-active(top:21/left:210) と selection(top:20/left:210) が完全整合
- DOMで確認（FK切れ）: cell-error + editor-table-cell-focused が category_id セルに正確に付与
- DOMで確認（FK切れ）: grid-dropdown.visible が同時表示され FK修正フローが一操作で開始できる
- DOMで確認（PK重複）: grid-textfield-active(top:21/left:52) と selection(top:20/left:52) が完全整合
- DOMで確認（PK重複）: cell-pk-duplicate + cell-error + editor-table-cell-focused が行1 id セルに正確に付与
- 残存(🔴): cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080から継続）
- 残存(🟡): validation-panel-group-header に role/aria-label なし（全サイクル継続）
- 残存(🟡): ミニテーブルの fill-handle が editor-table--inactive でも display:block（継続パターン）
- 残存(🟡): ミニテーブルの grid-textfield に contenteditable="true" が残存（editor-table--inactive でも露出）
- 要確認: SearchPanel・ReferencesPanelからのジャンプでも同様に文字入力が反映されるか（bug-report #174 の言及範囲）

#### ISSUE_0101 ミニテーブルgit差分ハイライト反映（2026-03-22レビュー）評価: A
- 修正済み: createMiniEditorTable() 末尾に refreshGitDiffAsync() を fire-and-forget で追加
- DOMで確認（テスト1）: ミニテーブル内 `data-col="1"` セルに `cell-git-changed` が正確に付与（メインテーブルの同セルと一致）
- DOMで確認（テスト2）: 変更のないセル（id列）に cell-git-changed が付与されない（誤検出ゼロ）
- DOMで確認（テスト3）: 変更のない enemy 行（id=2/ドラゴン）参照時、ミニテーブル全セルに cell-git-changed なし
- 正常: メインテーブル（enemy タブ）とミニテーブル（quest RelationsPanel）の cell-git-changed 付与が完全一致
- 正常: relations-table-dirty（●）がミニテーブルのヘッダーに表示されており、参照先テーブルの変更状態も通知済み
- 残存(🟡): ミニテーブルの fill-handle が display:block で表示（非アクティブテーブルに fill-handle は不要か要確認）
- 残存(🟡): ミニテーブルの grid-textfield に contenteditable="true" が残存（editor-table--inactive でも露出）
- 残存(🟡): ミニテーブルの row-resize-handle がバッファ行（editor-table-empty-row）に残存（継続パターン）
- 知見: fire-and-forget の refreshGitDiffAsync は非同期競合を requestId パターンで防止済み（bug-report.md #ミニテーブルスキップ言及）

### 横断的な継続課題（最新）
- インタラクティブな div/span 要素に role="button"/tabindex がない（activity-bar-item, notification-bell ほか）
- SVG に aria-hidden="true" がない（filter-icon, sort-icon, activity-bar SVG）
- 差分ビュー左ペインに aria-readonly がない（BUG_0021から継続）
- row-resize-handle がミニテーブル・バッファ行・差分削除行に残存
- コンテキストメニューが操作後に残存（hide()漏れ、bug-report #8/#65）
- cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080から全サイクル継続）
- validation-panel-group-header に role/aria-label なし（全サイクル継続）
- 列ヘッダーに型情報バッジがない（型バリデーション機能追加に伴う新規課題）
