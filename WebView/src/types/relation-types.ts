/**
 * 列スキーマ情報（FK参照ヒント・ドロップダウン表示用）。
 * useEditorTableKeyboard の ColumnSchema と同一構造（循環参照回避のため再定義）。
 */
export interface RelationColumnSchema {
	/** 列名 */
	name: string;
	/** FK参照式（例: "enemy.id" → enemy テーブルを参照する） */
	reference?: string;
}

/**
 * リレーションパネルに表示する参照エントリ
 *
 * 既存の relations-panel.ts の RelationEntry interface と同一構造。
 * React コンポーネントとの共有型として外部化したもの。
 */
export interface RelationEntry {
	/** 表示ラベル（FK列名または子テーブル名） */
	label: string;
	/** 参照種別: N:1（FK参照先）、1:N（逆参照） */
	relationType: 'N:1' | '1:N';
	/** 参照先/参照元テーブル名（ドリルダウン時の次テーブル） */
	tableKey: string;
	/** テーブルのヘッダー列名配列 */
	header: string[];
	/** 表示する行データ（各行は列値の配列） */
	rows: string[][];
	/** 1:Nの場合: 親テーブルのFK列名（子テーブル側の列名）。N:1の場合は空文字列 */
	fkColumnName: string;
	/** 1:Nの場合: 親テーブルのFK値（自動埋め込みする値）。N:1の場合は空文字列 */
	fkValue: string;
	/**
	 * rows[i] がストアの何行目に対応するかのインデックス配列（0始まり）
	 * 1:Nフィルタリング時に記録し、ミニEditorTableの storeRowIndices として渡す。
	 * N:1はストアの全行を表示するため空配列（通常テーブルと同様 [0,1,...,n-1] として初期化される）。
	 */
	storeRowIndices: number[];
	/** 列スキーマ情報（FK参照ヒント・ドロップダウン表示用） */
	columnSchemas: RelationColumnSchema[];
}
