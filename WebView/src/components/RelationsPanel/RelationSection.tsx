import React from 'react';
import type {RelationEntry} from '../../types/relation-types';
import {MiniEditorTable} from './MiniEditorTable';

interface RelationSectionProps {
	/** 表示するリレーションエントリ */
	entry: RelationEntry;
	/** 定義ジャンプ時のコールバック（テーブル名と行インデックスを渡す） */
	onNavigateToDefinition: (tableName: string, rowIndex: number) => void;
}

/**
 * 参照種別バッジを構築する
 *
 * N:1は青系、1:Nは緑系のクラスで区別する。
 */
function RelationTypeBadge({relationType}: {relationType: 'N:1' | '1:N'}): React.ReactElement {
	const badgeClass = relationType === '1:N'
		? 'relations-section-badge relations-section-badge--1n'
		: 'relations-section-badge relations-section-badge--n1';
	return <span className={badgeClass}>{relationType}</span>;
}

/**
 * 1つのリレーションエントリを表示するセクションコンポーネント
 *
 * セクションヘッダー（テーブル名・行数・参照種別バッジ）と
 * ミニEditorTableで構成される。
 *
 * 将来的には onNavigateToDefinition を MiniEditorTable へ渡して
 * Ctrl+Click / F12 によるジャンプ機能を実装する。
 * 現時点では型シグネチャのみ定義し、実際の呼び出しは EditorTableView に委ねる。
 */
export function RelationSection({entry, onNavigateToDefinition: _onNavigateToDefinition}: RelationSectionProps): React.ReactElement {
	// 1:NエントリでFK条件コンテキスト（例: enemy_id=3）を持つ場合に表示する
	const hasContext = entry.relationType === '1:N' && entry.fkColumnName !== '';

	return (
		<div className="relations-section">
			<div className="relations-section-header">
				<span className="relations-table-title">{entry.tableKey}</span>
				<RelationTypeBadge relationType={entry.relationType} />
				{hasContext && (
					<span className="relations-table-context">
						{entry.fkColumnName}={entry.fkValue}
					</span>
				)}
				<span className="relations-row-count">{entry.rows.length} rows</span>
			</div>
			<MiniEditorTable
				tableName={entry.tableKey}
				storeRowIndices={entry.storeRowIndices.length > 0 ? entry.storeRowIndices : null}
				autoFillEntries={
					entry.fkColumnName !== '' && entry.fkValue !== ''
						? [{columnName: entry.fkColumnName, value: entry.fkValue}]
						: []
				}
				columnSchemas={entry.columnSchemas}
			/>
		</div>
	);
}
