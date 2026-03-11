import React from 'react';
import {EditorTableView} from '../EditorTable/EditorTableView';

/** FK自動埋め込みエントリ（1:N行追加時に使用） */
interface AutoFillEntry {
	columnName: string;
	value: string;
}

interface MiniEditorTableProps {
	/** 表示するテーブル名 */
	tableName: string;
	/**
	 * DOMの行インデックス（0始まり）からストアの行インデックスへのマッピング。
	 * 1:Nミニテーブルのフィルタリング済みストアインデックスを渡す。
	 * null の場合はストア行と同じ順序（0, 1, 2, ...）として扱う（N:1テーブル用）。
	 */
	storeRowIndices: number[] | null;
	/**
	 * FK自動埋め込み情報（1:N行追加時）。
	 * 現時点では型定義のみ。将来的に EditorTableView へ渡すプロップスを追加する際に使用する。
	 */
	autoFillEntries: AutoFillEntry[];
}

/**
 * ミニEditorTableコンポーネント
 *
 * RelationsPanelの各セクションに表示する編集可能なミニテーブル。
 * EditorTableView を mini-editor-table クラスでラップして高さを制限する。
 *
 * 将来的に EditorTableView が isMiniTable props を受け取る場合は
 * そちらに切り替えるが、現時点は className の切り替えで対応する。
 */
export function MiniEditorTable({tableName, storeRowIndices, autoFillEntries: _autoFillEntries}: MiniEditorTableProps): React.ReactElement {
	return (
		<div className="mini-editor-table">
			<EditorTableView
				tableName={tableName}
				storeRowIndices={storeRowIndices}
			/>
		</div>
	);
}
