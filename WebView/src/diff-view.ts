/**
 * 差分ビュー
 * HEAD版CSVと現在版CSVの差分を左右2ペインで表示する読み取り専用ビュー
 */

/**
 * スキーマJSONのヘッダー列定義
 */
interface SchemaColumn {
    key: number;
    name: string;
    type: string;
}

/**
 * スキーマJSON
 */
interface SchemaJson {
    header: SchemaColumn[];
    primary_key: string;
}

/**
 * 差分計算結果の1行分（discriminated union）
 * kind に応じて保持するフィールドが異なるため、as キャストが不要になる
 */
type DiffRow =
    | { kind: 'modified';   headValues: string[]; currentValues: string[]; changedColumnIndices: Set<number> }
    | { kind: 'unchanged';  headValues: string[]; currentValues: string[] }
    | { kind: 'deleted';    headValues: string[] }
    | { kind: 'added';      currentValues: string[] };

/**
 * CSVを行と列に分割する
 * ヘッダー行を除いたデータ行と、PK列インデックスを返す
 */
function parseCsv(csvText: string): { header: string[]; rows: string[][] } {
    const lines = csvText.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return { header: [], rows: [] };
    const header = lines[0].split(',').map(c => c.trim());
    const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));
    return { header, rows };
}

/**
 * 差分ビュー
 * DiffView はコンストラクタ完了時に差分計算とDOMが確定する（生焼けオブジェクト不可）
 */
export class DiffView {
    private readonly element: HTMLElement;

    constructor(tableName: string, schemaJson: string, headCsv: string, currentCsv: string) {
        // スキーマをパースしてPK列名を特定する
        const schema = JSON.parse(schemaJson) as SchemaJson;
        const primaryKeyName = schema.primary_key;

        const head = parseCsv(headCsv);
        const current = parseCsv(currentCsv);

        // 表示に使う列ヘッダーは現在版を優先し、なければHEAD版を使う
        const displayColumns = current.header.length > 0 ? current.header : head.header;

        // PK列のインデックスを取得する（現在版・HEAD版で同じ列名が存在するものを使う）
        const pkIndexInHead = head.header.indexOf(primaryKeyName);
        const pkIndexInCurrent = current.header.indexOf(primaryKeyName);

        // HEAD版・現在版のデータをPK値でMapに変換する
        // PK値が重複している場合は行番号サフィックスを付けて一意にする（例: "1_row0", "1_row1"）
        // buildUniqueKeyMap: 各行に一意キーを割り当てるローカル関数
        const buildUniqueKeyMap = (rows: string[][], pkIndex: number): Map<string, string[]> => {
            const map = new Map<string, string[]>();
            // 各rawPKが何行目で使われたかを記録する（重複検出用）
            const seenIndices = new Map<string, number>();
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rawPk = pkIndex >= 0 && pkIndex < row.length ? row[pkIndex] : '';
                if (!seenIndices.has(rawPk)) {
                    // 初出: rawPKをそのまま使う。後で重複が判明した場合に備えてインデックスを記録する
                    seenIndices.set(rawPk, i);
                    map.set(rawPk, row);
                } else {
                    // 重複: 初出エントリを "_row<初出index>" キーに移動してから新エントリを追加する
                    const firstIndex = seenIndices.get(rawPk)!;
                    if (map.has(rawPk)) {
                        // 初出エントリがまだ rawPK キーにある場合は移動する（2回目の重複時のみ）
                        const firstRow = map.get(rawPk)!;
                        map.delete(rawPk);
                        map.set(rawPk + '_row' + firstIndex, firstRow);
                        // seenIndices の値を -1 にして「移動済み」を示す（3回目以降は rawPK で map.has しない）
                        seenIndices.set(rawPk, -1);
                    }
                    map.set(rawPk + '_row' + i, row);
                }
            }
            return map;
        };

        const headMap = buildUniqueKeyMap(head.rows, pkIndexInHead);
        const currentMap = buildUniqueKeyMap(current.rows, pkIndexInCurrent);

        // 全PK値を収集してソートする
        const allPkValues = new Set<string>([...headMap.keys(), ...currentMap.keys()]);
        const sortedPkValues = [...allPkValues].sort((a, b) => {
            const numA = Number(a);
            const numB = Number(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });

        // 差分行リストを構築する
        const diffRows: DiffRow[] = [];
        for (const pk of sortedPkValues) {
            // Map.has() で存在を確認してから Map.get() で値を取得する（undefined を使わない）
            const hasHead = headMap.has(pk);
            const hasCurrent = currentMap.has(pk);
            const headRow = hasHead ? headMap.get(pk)! : null;
            const currentRow = hasCurrent ? currentMap.get(pk)! : null;

            if (headRow !== null && currentRow !== null) {
                // 両方に存在 → セル単位で比較する
                const changedIndices = new Set<number>();
                const maxLen = Math.max(displayColumns.length, headRow.length, currentRow.length);
                for (let i = 0; i < maxLen; i++) {
                    // 配列長チェックで範囲外アクセスを回避する（undefined を使わない）
                    const hVal = i < headRow.length ? headRow[i] : '';
                    const cVal = i < currentRow.length ? currentRow[i] : '';
                    if (hVal !== cVal) changedIndices.add(i);
                }
                const kind = changedIndices.size > 0 ? 'modified' as const : 'unchanged' as const;
                if (kind === 'modified') {
                    diffRows.push({ kind, headValues: headRow, currentValues: currentRow, changedColumnIndices: changedIndices });
                } else {
                    diffRows.push({ kind, headValues: headRow, currentValues: currentRow });
                }
            } else if (headRow !== null) {
                // HEAD版にのみ存在 → 削除行
                diffRows.push({ kind: 'deleted', headValues: headRow });
            } else if (currentRow !== null) {
                // 現在版にのみ存在 → 追加行
                diffRows.push({ kind: 'added', currentValues: currentRow });
            }
        }

        // ルート要素を構築する
        this.element = document.createElement('div');
        this.element.classList.add('diff-view');

        // 左ペイン（変更前）を構築する
        const leftPane = document.createElement('div');
        leftPane.classList.add('diff-view-pane-before');

        const leftLabel = document.createElement('div');
        leftLabel.classList.add('diff-view-label-before');
        leftLabel.textContent = `${tableName} (変更前)`;
        leftPane.appendChild(leftLabel);

        // 右ペイン（変更後）を構築する
        const rightPane = document.createElement('div');
        rightPane.classList.add('diff-view-pane-after');

        const rightLabel = document.createElement('div');
        rightLabel.classList.add('diff-view-label-after');
        rightLabel.textContent = `${tableName} (変更後)`;
        rightPane.appendChild(rightLabel);

        // 列ヘッダー行を追加する
        leftPane.appendChild(this.buildHeaderRow(displayColumns));
        rightPane.appendChild(this.buildHeaderRow(displayColumns));

        // 各差分行をレンダリングする
        for (const row of diffRows) {
            const { leftRow, rightRow } = this.buildDiffRowPair(row, displayColumns);
            leftPane.appendChild(leftRow);
            rightPane.appendChild(rightRow);
        }

        this.element.appendChild(leftPane);
        this.element.appendChild(rightPane);
    }

    /**
     * 差分ビューを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * 差分ビューを親要素から取り外す
     */
    detach(): void {
        if (this.element.parentElement !== null) {
            this.element.parentElement.removeChild(this.element);
        }
    }

    /**
     * 列ヘッダー行のDOM要素を構築する
     */
    private buildHeaderRow(columns: string[]): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('diff-header-row');
        for (const colName of columns) {
            const cell = document.createElement('div');
            cell.classList.add('diff-cell');
            cell.textContent = colName;
            row.appendChild(cell);
        }
        return row;
    }

    /**
     * 差分行の左右ペアを構築する
     * 左: HEAD版、右: 現在版
     * discriminated union により kind に応じて型が確定するため as キャスト不要
     */
    private buildDiffRowPair(
        row: DiffRow,
        columns: string[]
    ): { leftRow: HTMLElement; rightRow: HTMLElement } {
        if (row.kind === 'deleted') {
            // 削除行: 左にデータ行(.diff-row-deleted)、右に空白行(.diff-row-empty)
            const leftRow = this.buildDataRow(row.headValues, columns, new Set(), 'deleted');
            const rightRow = document.createElement('div');
            rightRow.classList.add('diff-row-empty');
            return { leftRow, rightRow };
        }

        if (row.kind === 'added') {
            // 追加行: 左に空白行(.diff-row-empty)、右にデータ行(.diff-row-added)
            const leftRow = document.createElement('div');
            leftRow.classList.add('diff-row-empty');
            const rightRow = this.buildDataRow(row.currentValues, columns, new Set(), 'added');
            return { leftRow, rightRow };
        }

        if (row.kind === 'modified') {
            // 変更行: 左はHEAD版（変更セルに.diff-cell-deleted）、右は現在版（変更セルに.diff-cell-added）
            const leftRow = this.buildDataRow(row.headValues, columns, row.changedColumnIndices, 'deleted-cell');
            const rightRow = this.buildDataRow(row.currentValues, columns, row.changedColumnIndices, 'added-cell');
            return { leftRow, rightRow };
        }

        // unchanged: 左右ともに通常行
        const leftRow = this.buildDataRow(row.headValues, columns, new Set(), 'none');
        const rightRow = this.buildDataRow(row.currentValues, columns, new Set(), 'none');
        return { leftRow, rightRow };
    }

    /**
     * データ行のDOM要素を構築する
     * highlightMode で行全体またはセル単位のハイライトを制御する
     */
    private buildDataRow(
        values: string[],
        columns: string[],
        changedIndices: Set<number>,
        highlightMode: 'deleted' | 'added' | 'deleted-cell' | 'added-cell' | 'none'
    ): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('diff-row');

        if (highlightMode === 'deleted') {
            row.classList.add('diff-row-deleted');
        } else if (highlightMode === 'added') {
            row.classList.add('diff-row-added');
        }

        for (let i = 0; i < columns.length; i++) {
            const cell = document.createElement('div');
            cell.classList.add('diff-cell');
            // 配列長チェックで範囲外アクセスを回避する（undefined を使わない）
            cell.textContent = i < values.length ? values[i] : '';

            if (highlightMode === 'deleted-cell' && changedIndices.has(i)) {
                cell.classList.add('diff-cell-deleted');
            } else if (highlightMode === 'added-cell' && changedIndices.has(i)) {
                cell.classList.add('diff-cell-added');
            }

            row.appendChild(cell);
        }

        return row;
    }
}
