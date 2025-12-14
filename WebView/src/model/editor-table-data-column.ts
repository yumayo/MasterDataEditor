export class EditorTableDataColumn {

    key: number;

    name: string;

    type: string;

    comment: string | undefined;

    references: string[] | undefined;

    constructor(key: number, name: string, type: string, comment: string | undefined, references: string[] | undefined) {
        this.key = key;
        this.name = name;
        this.type = type;
        this.comment = comment;
        this.references = references;
    }

    serialize() {
        return {
            key: this.key,
            name: this.name,
            type: this.type,
            comment: this.comment,
            references: this.references
        }
    }
}
