export class EditorTableDataColumn {

    key: number;

    name: string;

    type: string;

    comment: string | undefined;

    reference: string | undefined;

    constructor(key: number, name: string, type: string, comment: string | undefined, reference: string | undefined) {
        this.key = key;
        this.name = name;
        this.type = type;
        this.comment = comment;
        this.reference = reference;
    }

    serialize() {
        return {
            key: this.key,
            name: this.name,
            type: this.type,
            comment: this.comment,
            reference: this.reference
        }
    }
}
