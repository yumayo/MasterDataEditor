export class EditorTableDataColumn {

    key: number;

    name: string;

    type: string;

    comment: string | null;

    reference: string | null;

    width: string;

    /** セル内の `<br>` をHTML改行として描画するかどうか */
    renderAsHtml: boolean;

    constructor(key: number, name: string, type: string, comment: string | null, reference: string | null, width: string, renderAsHtml: boolean) {
        this.key = key;
        this.name = name;
        this.type = type;
        this.comment = comment;
        this.reference = reference;
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
        return {
            key: this.key,
            name: this.name,
            type: this.type,
            comment: this.comment,
            reference: this.reference,
            width: parseInt(this.width),
        }
    }
}
