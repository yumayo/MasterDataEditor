import React, {useState} from 'react';

/**
 * 逆参照エントリの行データ
 */
interface ReferenceRow {
    pkValue: string;
    displayText: string;
}

/**
 * 逆参照エントリ（テーブル名 + 参照行リスト）
 */
export interface ReferenceEntry {
    childTableName: string;
    rows: ReferenceRow[];
}

interface ReferencesPanelProps {
    /** 表示しているPK値（ラベル用） */
    pkValue: string;
    /** 逆参照エントリリスト */
    entries: ReferenceEntry[];
    /** 行クリック時のコールバック（テーブルナビゲーション用） */
    onRowClick: (tableName: string, pkValue: string) => void;
}

/**
 * 逆参照フォルダ1件分のコンポーネント
 * クリックで開閉するアコーディオン形式のフォルダを描画する
 */
function ReferenceFolder({entry, onRowClick}: {entry: ReferenceEntry; onRowClick: (tableName: string, pkValue: string) => void}) {
    const [collapsed, setCollapsed] = useState(false);
    const count = entry.rows.length;

    return (
        <div className="references-folder">
            <div
                className="references-folder-header"
                onClick={() => setCollapsed(prev => !prev)}
            >
                {collapsed ? `▶ ${entry.childTableName} (${count}件)` : `▼ ${entry.childTableName} (${count}件)`}
            </div>
            {!collapsed && (
                <div className="references-folder-content">
                    {entry.rows.map(row => (
                        <div
                            key={row.pkValue}
                            className="references-row"
                            onClick={() => onRowClick(entry.childTableName, row.pkValue)}
                        >
                            {row.displayText !== '' ? row.displayText : 'id:' + row.pkValue}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * REFERENCESパネル
 * PK値に対する逆参照エントリをテーブル名フォルダ形式で表示する。
 * 現時点ではUIの枠組みのみ。後続フェーズで逆参照解決ロジックと統合する。
 */
export function ReferencesPanel({pkValue, entries, onRowClick}: ReferencesPanelProps) {
    return (
        <div className="sidebar-panel references-panel">
            <div className="sidebar-panel-header">REFERENCES</div>
            {pkValue !== '' && (
                <div className="references-panel-pk-label">id: {pkValue}</div>
            )}
            <div className="references-panel-content">
                {entries.map(entry => (
                    <ReferenceFolder
                        key={entry.childTableName}
                        entry={entry}
                        onRowClick={onRowClick}
                    />
                ))}
            </div>
        </div>
    );
}
