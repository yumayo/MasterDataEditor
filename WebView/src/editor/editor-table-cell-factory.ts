import type {ContextMenuEntry} from "../ui/context-menu";
import type {EditorTable} from "./editor-table";
import type {ReverseReferenceEntry} from "../references/reverse-reference-resolver";
import type {CellPosition} from "./selection";
import type {Tab} from "../tabs/tab";

/**
 * EditorTable の行・セルDOM生成とセル座標/値の低レベルユーティリティ。
 *
 * 既存の呼び出し口は EditorTable の static facade に残し、実処理だけここへ移している。
 */
export class EditorTableCellFactory {
    static createRow(cells: HTMLElement[], rowIndex?: number): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('editor-table-row');
        if (rowIndex !== undefined) {
            row.dataset.row = String(rowIndex);
            const firstCell = cells.length > 0 ? cells[0] : null;
            if (firstCell !== null && firstCell.classList.contains('editor-table-row-header')) {
                const rowIndexText = firstCell.dataset.rowIndex;
                if (rowIndexText !== undefined) row.dataset.rowIndex = rowIndexText;
            }
        }
        for (let i = 0; i < cells.length; ++i) {
            row.appendChild(cells[i]);
        }
        return row;
    }

    /**
     * セルのDOM要素を作成する
     *
     * textContentに値を設定し、イベントリスナーを登録した状態のセル要素を返す。
     * 参照ヒント(.cell-reference-hint)はこのメソッドでは適用されない。
     *
     * 初期描画パス: TabReference.preloadReferenceTables() 完了後に updateReferenceHints() で一括適用
     */
    static createCell(table: EditorTable, value: number | string | string[] | undefined, columnIndex: number, width: string, height: string): HTMLElement {
        const cell = document.createElement('div');
        const tableAny = table as any;
        cell.classList.add('editor-table-cell');
        cell.dataset.col = String(columnIndex);
        EditorTableCellFactory.applyCellWidth(cell, width);
        EditorTableCellFactory.applyCellHeight(cell, height);
        cell.addEventListener('dblclick', () => {
            // bool型（FK参照なし）の場合はトグル操作を行い、テキスト編集モードには入らない
            if (table.getColumnType(columnIndex) === 'bool' && !table.hasColumnReference(columnIndex)) {
                table.toggleBoolCell();
                return;
            }
            // 参照列の場合はドロップダウンを表示
            table.getHandler().enableCellEditModeWithDropdownAsync(true).then((handled: boolean) => {
                if (!handled) {
                    // ドロップダウンで処理されなかった場合は通常の編集モード
                    table.getHandler().enableCellEditMode(true);
                }
            });
        });
        cell.addEventListener('mousedown', (e) => {
            console.log('[SelectionDrag] cell mousedown button=' + e.button);
            // マウスサイドボタン（戻る/進む）はブラウザ履歴ナビゲーション専用のため無視する
            if (e.button !== 0) return;
            const position = EditorTableCellFactory.getCellPosition(cell, tableAny.element as HTMLElement);
            if (!position) return;
            // 編集中のセルを確定する（Ctrl+クリックでも通常クリックでも共通）
            table.getHandler().submitAndHide();
            // フォーカスの排他制御: 接続先に応じて適切な activateHandler を呼び出す
            // RelationsPanel 接続時: 全ミニEditorTableを含む排他制御
            // DiffTab 接続時: 左右ペイン間の排他制御
            // どちらも未接続（通常テーブル単独）: 直接このhandlerをアクティブ化する
            if (table.relationsPanel !== false) {
                table.relationsPanel.activateHandler(table);
            } else if (table.diffTab !== false) {
                table.diffTab.activateHandler(table);
            } else {
                table.getHandler().activate();
            }
            // ミニテーブルのCtrl+クリックで自テーブルを左ペインで開く（ドリルダウン）
            // ペインスタック追加（navigateToDefinition）を先に行い、正しいRPに対して選択状態を設定する。
            // 逆順（selection.start → navigateToDefinition）だと古いRPに対してnotifyが走り無駄な処理が発生する。
            if ((e.ctrlKey || e.metaKey) && table.isMiniTableInstance()) {
                table.navigateToDefinition(position.row);
                table.getSelection().start(position.row, position.column);
                e.preventDefault();
                return;
            }
            // メインテーブルのCtrl+クリックでFK列の参照先 / PK列の逆参照先テーブルを開く（RelationsPanel非表示時のみ）
            // start()でセルを選択した後、end()でドラッグ状態を即解除する。
            // end()を呼ばないとmouseupが発火しないままselecting=trueが残り、戻ったときに範囲選択になる。
            if ((e.ctrlKey || e.metaKey) && !table.isMiniTableInstance()
                && (table.navigateToReferenceTable(position.row, position.column)
                    || table.navigateToReverseReferenceTable(position.row, position.column))) {
                table.getSelection().start(position.row, position.column);
                table.getSelection().end();
                e.preventDefault();
                return;
            }
            if (e.shiftKey) {
                table.getSelection().extendSelection(position.row, position.column);
            } else {
                // SelectionDragController を有効化する（window mousemove/mouseup によるドラッグ選択に必要）。
                // activateTabState 経由で activate が呼ばれるべきだが、HMRリロード後など
                // タイミングによっては呼ばれないケースがあるため、mousedown 時にも確実に有効化する。
                // addEventListener の重複登録は SelectionDragController 側でガードする。
                tableAny.selectionDragController.activate();
                console.log('[SelectionDrag] selection.start row=' + position.row + ' col=' + position.column);
                table.getSelection().start(position.row, position.column);
            }
        });
        cell.addEventListener('contextmenu', (e) => {
            const position = EditorTableCellFactory.getCellPosition(cell, tableAny.element as HTMLElement);
            if (!position) return;
            // 全 parentColumnName の列値でエントリを収集する（非PK列参照にも対応）
            const allEntries: ReverseReferenceEntry[] = [];
            for (const colName of table.getAllParentColumnNames()) {
                const colValue = table.getCellValueByColumnName(position.row, colName);
                if (colValue === '') continue;
                const entries = table.getReverseReferenceEntries(colValue);
                for (const entry of entries) {
                    if (entry.parentColumnName === colName) allEntries.push(entry);
                }
            }
            // PKセルかどうかを判定する（columnIndex はデータ列インデックス = 行ヘッダーを除いた0始まり）
            const tableData = table.getTableData();
            const col = tableData.header[columnIndex];
            const isPkColumn = col !== undefined && tableData.primaryKeyColumns.includes(col.name);
            const pkValue = table.getRowPkValue(position.row);
            const bookmarkRowKey = table.getRowBookmarkKey(position.row);
            // フォームビュー表示はPKセルかつPK値が空でない場合のみ表示する
            const canShowFormView = isPkColumn && pkValue !== '' && table.tab !== false;
            // ブックマーク追加/解除はブックマーク用行キーが取れる通常テーブル（タブあり）でのみ表示する
            // ミニテーブル（RelationsPanel内）やDiffTabではtab===falseなので抑制される
            const canShowBookmark = bookmarkRowKey !== '' && table.tab !== false;
            // 表示するメニュー項目がない場合はメニューを出さない
            if (allEntries.length === 0 && !canShowFormView && !canShowBookmark) return;
            e.preventDefault();
            e.stopPropagation();
            // ドラグ状態をリセット
            table.getSelection().end();
            const menuItems: ContextMenuEntry[] = [];
            if (allEntries.length > 0) {
                menuItems.push({
                    label: '参照箇所を表示',
                    action: () => { table.showReferences(pkValue, allEntries); },
                });
            }
            if (canShowFormView) {
                // クロージャ内で table.tab の型を Tab として保持する（型ガード後の型を維持するため）
                const tabRef = table.tab as Tab;
                menuItems.push({
                    label: 'フォームビューを表示',
                    action: () => { tabRef.showFormPanel(table.tableName, pkValue); },
                });
            }
            // セルレベルのブックマーク追加/解除メニュー（修正10: PK列/非PK列のコードを共通化）
            if (canShowBookmark) {
                const clickedCol = tableData.header[columnIndex];
                const clickedColumnName = clickedCol ? clickedCol.name : '';
                if (clickedColumnName !== '') {
                    // PK列は行レベル判定、非PK列はセルレベル判定
                    const isBookmarked = isPkColumn
                        ? table.hasBookmarkForRow(table.tableName, bookmarkRowKey)
                        : table.hasBookmark(table.tableName, bookmarkRowKey, clickedColumnName);
                    if (isBookmarked) {
                        menuItems.push({
                            label: 'ブックマークを解除',
                            action: () => {
                                if (isPkColumn) {
                                    // 行内の全ブックマークを削除し、該当行全セルの視覚マークも除去する
                                    table.removeBookmarksForRow(table.tableName, bookmarkRowKey);
                                    table.removeBookmarkMarksForRow(position.row);
                                } else {
                                    table.removeBookmark(table.tableName, bookmarkRowKey, clickedColumnName);
                                    cell.removeAttribute('data-bookmarked');
                                }
                            },
                        });
                    } else {
                        const cellValue = table.getCellValueAt(position.row, columnIndex + table.dataColumnOffset());
                        menuItems.push({
                            label: 'ブックマークに追加',
                            action: () => {
                                table.addBookmark(table.tableName, bookmarkRowKey, clickedColumnName, cellValue);
                                cell.setAttribute('data-bookmarked', '');
                            },
                        });
                    }
                }
            }
            tableAny.contextMenu.show(e.clientX, e.clientY, menuItems);
        });
        // renderAsHtml を考慮してセル値を設定する（初期レンダリング時にHTML描画を正しく適用）
        // value の実際の型は string のみ（body.values は string[]、バッファ行は '' を渡す）
        const strValue = value as string;
        // バッファ空行挿入時等で columnIndex がヘッダー範囲外になる場合は false（テキスト描画）でフォールバック
        const cellCol = table.getTableData().header[columnIndex];
        table.reference.applyTextOrHtml(cell, strValue, cellCol ? cellCol.renderAsHtml : false);
        // データ型に基づいたスタイル適用（bool型チェックマーク、数値型右寄せ）
        table.reference.applyTypedCellStyle(cell, strValue, columnIndex);
        return cell;
    }

    static getCellPosition(cell: HTMLElement, tableElement: HTMLElement): CellPosition | null {
        const rowElement = cell.parentElement;
        if (!rowElement) return null;
        // 行インデックスの取得: ヘッダー行は常に children[0]。
        // データ行はバーチャルスクロールにより children のインデックスが論理インデックスとずれるため、
        // 行要素または行ヘッダーの data-row-index 属性（renumberRowsFrom で設定される 0始まりの
        // データ行インデックス）から算出する。固定行 clone は行要素自身が data-row-index を持つ。
        // ヘッダー行は data-row-index を持たないため children インデックスを使う。
        let row: number = -1;
        if (rowElement.classList.contains('editor-table-column-header-row')
            || rowElement.classList.contains('editor-table-source-column-header-row')) {
            row = 0;
        } else if (rowElement.dataset.rowIndex !== undefined) {
            // data-row-index は 0始まりのデータ行インデックス。DOM行インデックスは +1（ヘッダー行分）。
            row = Number(rowElement.dataset.rowIndex) + 1;
        } else {
            const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
            if (rowHeader && rowHeader.dataset.rowIndex !== undefined) {
                // data-row-index は 0始まりのデータ行インデックス。DOM行インデックスは +1（ヘッダー行分）。
                row = Number(rowHeader.dataset.rowIndex) + 1;
            } else {
                // ヘッダー行または data-row-index がない行: children のインデックスで探索する
                for (let i = 0; i < tableElement.children.length; ++i) {
                    if (tableElement.children[i] === rowElement) {
                        row = i;
                        break;
                    }
                }
            }
        }
        if (row === -1) return null;
        const dataColText = cell.dataset.col;
        if (dataColText !== undefined) {
            const dataColumn = Number(dataColText);
            if (!Number.isNaN(dataColumn)) {
                const dataColumnOffset = tableElement.classList.contains('editor-table--blame-visible') ? 2 : 1;
                return { row, column: dataColumnOffset + dataColumn };
            }
        }
        let column: number = -1;
        for (let i = 0; i < rowElement.children.length; ++i) {
            if (rowElement.children[i] === cell) {
                column = i;
                break;
            }
        }
        if (column === -1) return null;
        return {row, column};
    }

    /**
     * セルの値を取得する（参照ヒントを除外）
     * renderAsHtml モードのセルや bool型セル（SVG表示）は innerHTML/textContent から直接値を取れないため、
     * data-raw-value に保存した生テキストを返す。
     */
    static getCellValue(cell: HTMLElement): string {
        // renderAsHtml モードおよび bool型セルは data-raw-value に生テキストが保存されている
        if (cell.dataset.rawValue !== undefined) return cell.dataset.rawValue;
        // .cell-value 要素があればそこから取得
        const valueElement = cell.querySelector('.cell-value');
        if (valueElement) return valueElement.textContent ?? '';
        // ヒント要素がある場合、直下のテキストノードのみを結合して返す
        const hasChildElements = cell.querySelector('.cell-reference-hint, .cell-reverse-reference-hint');
        if (hasChildElements) {
            let text = '';
            for (const node of Array.from(cell.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
            }
            return text;
        }
        // そうでなければ textContent をそのまま返す
        return cell.textContent ?? '';
    }

    /** セルに幅のスタイルを適用 */
    static applyCellWidth(cell: HTMLElement, width: string): void {
        cell.style.width = width;
        cell.style.minWidth = width;
        cell.style.maxWidth = width;
    }

    /** セルに高さのスタイルを適用 */
    static applyCellHeight(cell: HTMLElement, height: string): void {
        cell.style.height = height;
        cell.style.minHeight = height;
        cell.style.maxHeight = height;
        cell.style.lineHeight = height;
    }
}
