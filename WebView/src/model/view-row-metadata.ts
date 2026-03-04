/**
 * 各joinレベルのグループ情報
 * 1:n展開で生成された複合行のレベルごとの位置を追跡する
 */
export interface ViewRowGroupInfo {
    /** このレベルでのグループ内位置（0=リーダー行） */
    groupPosition: number;
    /** このレベルでのグループサイズ */
    groupSize: number;
    /** このレベルのJOINソーステーブル名 */
    sourceTable: string;
    /** このレベルのJOINソースカラム値（折りたたみキーに使用） */
    sourceKeyValue: string;
}

/**
 * ビュー行のメタデータ
 * 1:n展開で生成された各行のパディング情報とグループ構造を保持する
 */
export interface ViewRowMetadata {
    /** 元のベーステーブル行インデックス */
    baseRowIndex: number;
    /** 各joinレベルのグループ情報 */
    groupInfos: ViewRowGroupInfo[];
    /** パディング列のboolean配列（true=パディング、インデックス=列マッピングインデックス） */
    paddingColumns: boolean[];
}

// =========================================================================
// DOM属性ユーティリティ関数
// ビュー行のメタデータをDOM属性に格納し、DOMをSSOTとして扱う
// =========================================================================

/** DOM行にビュー行メタデータをdata属性として設定する */
export function setViewRowMetadata(domRow: HTMLElement, baseRowIndex: number, groupInfos: ViewRowGroupInfo[]): void {
    domRow.setAttribute('data-base-row-index', String(baseRowIndex));
    domRow.setAttribute('data-group-infos', JSON.stringify(groupInfos));
}

/** DOM行のdata-base-row-index属性を読み取り数値で返す */
export function getBaseRowIndex(domRow: HTMLElement): number {
    return Number(domRow.getAttribute('data-base-row-index'));
}

/** DOM行のdata-group-infos属性をJSON.parseしてViewRowGroupInfo配列で返す */
export function getGroupInfos(domRow: HTMLElement): ViewRowGroupInfo[] {
    return JSON.parse(domRow.getAttribute('data-group-infos') as string) as ViewRowGroupInfo[];
}
