import React, {useRef, useEffect} from 'react';
import {useStore} from 'zustand';
import {useRelationsStore} from '../../stores/relations-store';
import {RelationSection} from './RelationSection';

interface RelationsPanelProps {
	/** 定義ジャンプ時のコールバック（テーブル名と行インデックスを渡す） */
	onNavigateToDefinition: (tableName: string, rowIndex: number) => void;
}

/**
 * リサイズハンドルコンポーネント
 *
 * mousedown でドラッグを開始し、document の mousemove/mouseup で幅を更新する。
 * 既存の relations-panel.ts の buildResizeHandle() と同等のロジックを React で実装する。
 * panelRef を通じて panelElement の親要素の右端座標を取得し、幅を計算する。
 */
function ResizeHandle({panelRef}: {panelRef: React.RefObject<HTMLDivElement | null>}): React.ReactElement {
	const setPanelWidth = useRelationsStore.getState().setPanelWidth;

	const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
		// SelectionDragController との競合を防ぐ
		e.stopPropagation();
		e.preventDefault();
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';

		const onMouseMove = (moveEvent: MouseEvent): void => {
			const panel = panelRef.current;
			if (panel === null) return;
			const parent = panel.parentElement;
			if (parent === null) return;
			const parentRight = parent.getBoundingClientRect().right;
			const newWidth = parentRight - moveEvent.clientX;
			setPanelWidth(newWidth);
		};

		const onMouseUp = (): void => {
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};

		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	};

	return <div className="relations-panel-resize-handle" onMouseDown={handleMouseDown} />;
}

/**
 * RelationsPanelコンポーネント
 *
 * 選択行のN:1参照先と1:N逆参照をミニEditorTableとして右ペインに常時全表示する。
 * useRelationsStore でエントリ一覧とパネル幅を購読し、エントリ変化時に再描画する。
 *
 * レイアウト構造:
 *   .relations-panel（flex-basis で幅制御）
 *     .relations-panel-resize-handle（左端に配置、ドラッグで幅変更）
 *     .relations-panel-content | .relations-panel-placeholder（エントリ or プレースホルダー）
 */
export function RelationsPanel({onNavigateToDefinition}: RelationsPanelProps): React.ReactElement {
	const entries = useStore(useRelationsStore, state => state.entries);
	const panelWidth = useStore(useRelationsStore, state => state.panelWidth);
	// panelRef: リサイズハンドルが親要素の右端座標を取得するために使用する
	const panelRef = useRef<HTMLDivElement | null>(null);

	// panelWidth 変更時にインラインスタイルを直接更新する
	// Zustand の状態変化は useEffect を通じて DOM に反映する
	useEffect(() => {
		const panel = panelRef.current;
		if (panel === null) return;
		panel.style.flex = `0 0 ${panelWidth}px`;
	}, [panelWidth]);

	return (
		<div
			className="relations-panel"
			ref={panelRef}
			style={{flex: `0 0 ${panelWidth}px`}}
		>
			<ResizeHandle panelRef={panelRef} />
			{entries.length === 0
				? (
					<div className="relations-panel-placeholder">
						<span>行を選択してください</span>
					</div>
				)
				: (
					<div className="relations-panel-content">
						{/* RELATIONSセクションヘッダー */}
						<div className="relations-panel-section-header">RELATIONS</div>
						{entries.map((entry, index) => (
							<RelationSection
								key={`${entry.tableKey}-${entry.relationType}-${index}`}
								entry={entry}
								onNavigateToDefinition={onNavigateToDefinition}
							/>
						))}
					</div>
				)
			}
		</div>
	);
}
