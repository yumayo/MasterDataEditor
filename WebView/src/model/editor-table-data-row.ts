export class EditorTableDataRow {

    values: string[];

    constructor(values: string[]) {
        this.values = values;
    }

    serialize() {
        return this.values;
    }
}
