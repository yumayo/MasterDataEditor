import {DynamicReferenceSchema} from "../../references/reference-expression";

export class EditorTableDataColumn {

    key: number;

    name: string;

    type: string;

    comment: string | null;

    /** 参照式。単純参照は文字列（"table.id"）、動的参照は DynamicReferenceSchema オブジェクト、参照なしは null */
    reference: string | DynamicReferenceSchema | null;

    /** スキーマで明示指定されたデフォルト値（文字列化済み）。未指定の場合は null（型デフォルトが使われる） */
    defaultValue: string | null;

    width: string;

    /** 保存済み・手動指定の幅がなく、参照ヒント読み込み後の幅補正を行う列か。 */
    isAutoWidth = false;

    constructor(key: number, name: string, type: string, comment: string | null, reference: string | DynamicReferenceSchema | null, defaultValue: string | null, width: string) {
        this.key = key;
        this.name = name;
        this.type = type;
        this.comment = comment;
        this.reference = reference;
        this.defaultValue = defaultValue;
        this.width = width;
    }

    serialize() {
        const result: Record<string, unknown> = {
            key: this.key,
            name: this.name,
            type: this.type,
            comment: this.comment,
            width: parseInt(this.width),
        };
        // reference が null の場合はキー自体を出力しない（元スキーマに存在しないキーを汚染しない）
        if (this.reference !== null) {
            result['reference'] = this.reference;
        }
        // defaultValue が null の場合はキー自体を出力しない（元スキーマに存在しないキーを汚染しない）
        // 型に基づいて元のスキーマ型（number/boolean/string）に復元して出力する
        if (this.defaultValue !== null) {
            if (this.type === 'int' || this.type === 'long' || this.type === 'float' || this.type === 'double') {
                result['default'] = Number(this.defaultValue);
            } else if (this.type === 'bool') {
                result['default'] = this.defaultValue === '1' ? 1 : 0;
            } else {
                result['default'] = this.defaultValue;
            }
        }
        return result;
    }
}
