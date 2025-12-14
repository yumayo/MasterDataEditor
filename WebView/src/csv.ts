export class Csv {

    header: string[];
    body: string[][];

    constructor() {
        this.header = [];
        this.body = [];
    }

    load(csvFileContents: string) {

        csvFileContents = csvFileContents.replace('\r', '');

        const lines = csvFileContents.split('\n');
        if (lines.length > 0) {
            this.header = lines[0].split(',');
        }

        const result = [];
        for (let i = 1; i < lines.length; ++i) {
            result[i - 1] = lines[i].split(',');
        }
        this.body = result;
    }

    toString(): string {
        let result = '';
        result += this.header.join(',') + '\n';
        result += this.body.map(x => x.join(',')).join('\n') + '\n';
        return result;
    }
}
