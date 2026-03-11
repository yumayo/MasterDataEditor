import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import type {RelationEntry} from '../types/relation-types';

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
	/** テスト用: ストア全体を初期状態にリセットする */
	_reset(): void;
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
