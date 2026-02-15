export class EditorTableDataColumn {

    key: number;

    name: string;

    type: string;

    comment: string | undefined;

    reference: string | undefined;

    width: string;

    constructor(key: number, name: string, type: string, comment: string | undefined, reference: string | undefined, width: string) {
        this.key = key;
        this.name = name;
        this.type = type;
        this.comment = comment;
        this.reference = reference;
        this.width = width;
    }

    serialize() {
        return {
            key: this.key,
            name: this.name,
            type: this.type,
            comment: this.comment,
            reference: this.reference,
            width: parseInt(this.width)
        }
    }
}
