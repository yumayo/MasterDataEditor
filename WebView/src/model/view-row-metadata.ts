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
