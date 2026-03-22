export class EditorTableDataColumn {

    key: number;

    name: string;

    type: string;

    comment: string | null;

    reference: string | null;

    /** スキーマで明示指定されたデフォルト値（文字列化済み）。未指定の場合は null（型デフォルトが使われる） */
    defaultValue: string | null;

    width: string;

    /** セル内の `<br>` をHTML改行として描画するかどうか */
    renderAsHtml: boolean;

    constructor(key: number, name: string, type: string, comment: string | null, reference: string | null, defaultValue: string | null, width: string, renderAsHtml: boolean) {
        this.key = key;
        this.name = name;
        this.type = type;
        this.comment = comment;
        this.reference = reference;
        this.defaultValue = defaultValue;
        this.width = width;
        this.renderAsHtml = renderAsHtml;
    }

    /**
     * renderAsHtml フラグを反転する（Undo/Redo対応）
     */
    toggleRenderAsHtml(): void {
        this.renderAsHtml = !this.renderAsHtml;
    }

    serialize() {
        const result: Record<string, unknown> = {
            key: this.key,
            name: this.name,
            type: this.type,
            comment: this.comment,
            reference: this.reference,
            width: parseInt(this.width),
        };
        // defaultValue が null の場合はキー自体を出力しない（元スキーマに存在しないキーを汚染しない）
        // 型に基づいて元のスキーマ型（number/boolean/string）に復元して出力する
        if (this.defaultValue !== null) {
            if (this.type === 'int' || this.type === 'float' || this.type === 'double') {
                result['default'] = Number(this.defaultValue);
            } else if (this.type === 'bool') {
                result['default'] = this.defaultValue === 'true';
            } else {
                result['default'] = this.defaultValue;
            }
        }
        return result;
    }
}
