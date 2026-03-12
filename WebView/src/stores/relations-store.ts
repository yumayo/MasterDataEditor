import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import type {RelationEntry, RelationColumnSchema} from '../types/relation-types';
import {parseReferenceExpression, isSimpleReference} from '../reference-expression';
import {config} from '../config';
import {useTableStore} from './table-store';
import {useReferenceStore} from './reference-store';
import {useReverseReferenceStore} from './reverse-reference-store';

/**
 * RelationsPanel の状態定義
 *
 * 選択行のリレーションエントリ一覧、パネル幅、表示状態を管理する。
 * 非同期リクエストIDはレースコンディション防止に使用する。
 */
interface RelationsStoreState {
	/** 現在表示中のリレーションエントリ一覧 */
	entries: RelationEntry[];
	/** 非同期リクエストID（レースコンディション防止） */
	currentRequestId: number;
	/** パネル幅（px） */
	panelWidth: number;
	/** パネルが表示中かどうか */
	visible: boolean;

	// アクション
	setEntries(entries: RelationEntry[]): void;
	/** リクエストIDをインクリメントして新しいIDを返す */
	incrementRequestId(): number;
	setPanelWidth(width: number): void;
	setVisible(visible: boolean): void;
	/**
	 * 指定テーブルの指定行に対してリレーションエントリを非同期で解決してストアに設定する。
	 * レースコンディション防止のため、古いリクエストIDの場合は setEntries を呼ばない。
	 */
	updateForRowAsync(tableName: string, rowIndex: number, columnSchemas: RelationColumnSchema[]): Promise<void>;
	/**
	 * 指定テーブルの逆参照マップを事前構築する（タブオープン時に呼ぶ）
	 * useReverseReferenceStore.resolveAsync のラッパー
	 */
	resolveReverseReferencesAsync(tableName: string): Promise<void>;
	/** テスト用: ストア全体を初期状態にリセットする */
	_reset(): void;
}

/**
 * テーブルのヘッダーと全行をストア優先・キャッシュフォールバックで取得する。
 *
 * 1. useTableStore にデータがあればそれを返す（最新データ優先）
 * 2. useReferenceStore の fullDataCache（同期）を確認する
 * 3. useReferenceStore の getFullDataAsync（非同期）でロードする
 * 4. いずれも失敗した場合は null を返す
 */
async function resolveTableDataAsync(tableName: string): Promise<{header: string[]; rows: string[][]} | null> {
	const tableHeader = useTableStore.getState().getHeader(tableName);
	const tableRows = useTableStore.getState().getRows(tableName);
	if (tableHeader !== false && tableRows !== false) {
		return {header: tableHeader, rows: tableRows};
	}
	const syncData = useReferenceStore.getState().getFullDataSync(tableName);
	if (syncData !== null) {
		return {header: syncData.header, rows: Array.from(syncData.rows.values())};
	}
	try {
		const asyncData = await useReferenceStore.getState().getFullDataAsync(tableName);
		return {header: asyncData.header, rows: Array.from(asyncData.rows.values())};
	} catch {
		return null;
	}
}

/**
 * 指定テーブルの指定行からリレーションエントリを解決する。
 *
 * N:1（FK参照先）の解決:
 *   columnSchemas の各列に reference があれば、ストア行の FK値で参照先テーブルをフィルタしてエントリを生成する。
 *
 * 1:N（逆参照）の解決:
 *   逆参照マップの全エントリを走査し、parentColumnName のユニークセットを取得する。
 *   各 parentColumnName に対応するストア行の値でマップをルックアップし、子テーブルデータをフィルタしてエントリを生成する。
 */
async function resolveEntriesAsync(tableName: string, rowIndex: number, columnSchemas: RelationColumnSchema[]): Promise<RelationEntry[]> {
	const entries: RelationEntry[] = [];
	const tableRows = useTableStore.getState().getRows(tableName);
	const tableHeader = useTableStore.getState().getHeader(tableName);
	if (tableRows === false || tableHeader === false) return entries;
	const row = tableRows[rowIndex];
	if (!row) return entries;

	// N:1（FK参照先）の解決
	for (let colIdx = 0; colIdx < columnSchemas.length; colIdx++) {
		const schema = columnSchemas[colIdx];
		if (!schema.reference) continue;
		const expr = parseReferenceExpression(schema.reference);
		if (!isSimpleReference(expr)) continue;
		const fkValue = row[colIdx];
		if (fkValue === '') continue;
		const refTableData = await resolveTableDataAsync(expr.tableName);
		if (refTableData === null) continue;
		const {header, rows: allRows} = refTableData;
		const refColIdx = header.indexOf(expr.columnName);
		const filteredRows = refColIdx === -1 ? [] : allRows.filter(r => r[refColIdx] === fkValue);
		// 参照先テーブルのヘッダーから columnSchemas を構築する（FK参照ヒント用）
		// スキーマファイルは持たないため reference は空（ヒント表示のみ）
		const refColumnSchemas: RelationColumnSchema[] = header.map(name => ({name}));
		entries.push({
			label: schema.name,
			relationType: 'N:1',
			tableKey: expr.tableName,
			header,
			rows: filteredRows,
			fkColumnName: '',
			fkValue: '',
			// N:1はストア全行を表示するため storeRowIndices は空配列（ミニEditorTable初期化時に通常テーブルとして扱われる）
			storeRowIndices: [],
			columnSchemas: refColumnSchemas,
		});
	}

	// 1:N（逆参照）の解決
	// 逆参照マップが未構築の場合は先に構築する
	await useReverseReferenceStore.getState().resolveAsync(tableName);
	const reverseMap = useReverseReferenceStore.getState().getSync(tableName);
	if (reverseMap === null) return entries;

	// 逆参照マップに使われている全 parentColumnName のユニークセットを構築する
	const parentColumnNames = new Set<string>();
	reverseMap.forEach(entryList => {
		for (const entry of entryList) {
			parentColumnNames.add(entry.parentColumnName);
		}
	});

	for (const parentColumnName of parentColumnNames) {
		const colIdx = tableHeader.indexOf(parentColumnName);
		if (colIdx === -1) continue;
		const columnValue = row[colIdx];
		if (columnValue === '') continue;
		const reverseEntriesForColumn = reverseMap.get(columnValue);
		if (!reverseEntriesForColumn) continue;
		for (const reverseEntry of reverseEntriesForColumn) {
			// このエントリが現在の parentColumnName に対応するものか確認する（値の衝突を防ぐ）
			if (reverseEntry.parentColumnName !== parentColumnName) continue;
			const childTableData = await resolveTableDataAsync(reverseEntry.childTableName);
			if (childTableData === null) continue;
			const {header, rows: allRows} = childTableData;
			const pkColIdx = header.indexOf(config.primaryKeyColumnName);
			let filteredRows: string[][];
			let filteredStoreRowIndices: number[];
			if (reverseEntry.childColumnName !== '') {
				// 単純参照: 子テーブルのFK列値で直接フィルタ（常に最新データを反映）
				const fkColIdx = header.indexOf(reverseEntry.childColumnName);
				if (fkColIdx !== -1) {
					const withIndices = allRows.map((r, i) => ({row: r, storeIndex: i})).filter(({row}) => row[fkColIdx] === columnValue);
					filteredRows = withIndices.map(({row}) => row);
					filteredStoreRowIndices = withIndices.map(({storeIndex}) => storeIndex);
				} else {
					filteredRows = [];
					filteredStoreRowIndices = [];
				}
			} else if (pkColIdx !== -1) {
				// 動的参照: reverseEntry.rows のPKセットでフィルタ（FK列名が特定できないため従来通り）
				const pkSet = new Set(reverseEntry.rows.map(r => r.pkValue));
				const withIndices = allRows.map((r, i) => ({row: r, storeIndex: i})).filter(({row}) => pkSet.has(row[pkColIdx]));
				filteredRows = withIndices.map(({row}) => row);
				filteredStoreRowIndices = withIndices.map(({storeIndex}) => storeIndex);
			} else {
				filteredRows = [];
				filteredStoreRowIndices = [];
			}
			// 子テーブルのヘッダーから columnSchemas を構築する（FK参照ヒント用）
			const childColumnSchemas: RelationColumnSchema[] = header.map(name => ({name}));
			entries.push({
				label: reverseEntry.childTableName,
				relationType: '1:N',
				tableKey: reverseEntry.childTableName,
				header,
				rows: filteredRows,
				fkColumnName: reverseEntry.childColumnName,
				// fkValue: 逆参照マップのキー（= 参照先列の実際の値）。非PK列参照にも対応するため columnValue を使う
				fkValue: columnValue,
				storeRowIndices: filteredStoreRowIndices,
				columnSchemas: childColumnSchemas,
			});
		}
	}

	return entries;
}

/**
 * RelationsPanel 状態を管理する Zustand ストア（vanilla）
 *
 * table-store.ts / sidebar-store.ts と同じ createStore + immer パターンで実装する。
 * React コンポーネント内では `useStore(useRelationsStore, selector)` で購読し、
 * 既存の RelationsPanel クラスから `useRelationsStore.getState().setEntries(...)` で更新する。
 */
export const useRelationsStore = createStore<RelationsStoreState>()(
	immer((set, get) => ({
		entries: [],
		currentRequestId: 0,
		panelWidth: 400,
		visible: true,

		setEntries(entries) {
			set(draft => {
				draft.entries = entries;
			});
		},

		incrementRequestId() {
			// get() で現在値を読み、set() でインクリメントしてから新しいIDを返す
			const nextId = get().currentRequestId + 1;
			set(draft => {
				draft.currentRequestId = nextId;
			});
			return nextId;
		},

		setPanelWidth(width) {
			set(draft => {
				draft.panelWidth = width;
			});
		},

		setVisible(visible) {
			set(draft => {
				draft.visible = visible;
			});
		},

		async updateForRowAsync(tableName, rowIndex, columnSchemas) {
			const requestId = get().incrementRequestId();
			const entries = await resolveEntriesAsync(tableName, rowIndex, columnSchemas);
			// 非同期処理中に新しいリクエストが来ていた場合は描画しない（レースコンディション防止）
			if (requestId !== get().currentRequestId) return;
			get().setEntries(entries);
		},

		async resolveReverseReferencesAsync(tableName) {
			await useReverseReferenceStore.getState().resolveAsync(tableName);
		},

		_reset() {
			set(draft => {
				draft.entries = [];
				draft.currentRequestId = 0;
				draft.panelWidth = 400;
				draft.visible = true;
			});
		},
	}))
);
