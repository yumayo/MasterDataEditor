/**
 * ビューの列マッピング
 * ビュー上の各列がどのテーブルのどの列に対応するかを管理する
 */
export interface ViewColumnMapping {
    /** ソーステーブル名 */
    tableName: string;
    /** ソーステーブル内の列インデックス */
    sourceColumnIndex: number;
    /** ソーステーブルの列名 */
    sourceColumnName: string;
    /** 結合テーブルの列かどうか */
    isJoinedColumn: boolean;
    /** 結合テーブルのキー列名（結合列のみ） */
    joinKeyColumn: string;
    /** ベーステーブルのキー列名（結合列のみ） */
    baseKeyColumn: string;
}
