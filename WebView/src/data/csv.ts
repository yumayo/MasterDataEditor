export class Csv {

    header: string[];
    body: string[][];

    constructor() {
        this.header = [];
        this.body = [];
    }

    load(csvFileContents: string) {
        const hasQuotes = csvFileContents.includes('"');
        if (!hasQuotes) {
            if (csvFileContents.includes('\r')) csvFileContents = csvFileContents.replaceAll('\r', '');
            const lines = csvFileContents.split('\n');
            if (lines.length > 0 && lines[lines.length - 1] === '') {
                lines.pop();
            }

            this.header = lines.length > 0 ? lines[0].split(',') : [];
            const result: string[][] = [];
            for (let i = 1; i < lines.length; ++i) {
                result[i - 1] = lines[i].split(',');
            }
            this.body = result;
            return;
        }

        csvFileContents = csvFileContents.replaceAll('\r', '');

        const lines = csvFileContents.split('\n');
        // toString()が付与する末尾改行による空要素を除去
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        // RFC4180準拠のフィールドパース。フィールド内カンマ・ダブルクォートエスケープに対応する。
        // フィールド内改行は対象外（行分割は事前に済ませる）。
        const parseFields = (line: string): string[] => {
            if (line === '') return [];
            const fields: string[] = [];
            let pos = 0;
            while (pos < line.length) {
                if (line[pos] === '"') {
                    // クォート済みフィールド: 閉じ " まで読み進め、"" をアンエスケープする
                    pos++;
                    let field = '';
                    while (pos < line.length) {
                        if (line[pos] === '"') {
                            if (line[pos + 1] === '"') {
                                // "" → " にアンエスケープ
                                field += '"';
                                pos += 2;
                            } else {
                                // 閉じクォート
                                pos++;
                                break;
                            }
                        } else {
                            field += line[pos];
                            pos++;
                        }
                    }
                    fields.push(field);
                    // フィールド後の , をスキップ
                    if (line[pos] === ',') pos++;
                } else {
                    // 非クォートフィールド: 次の , または行末まで
                    const end = line.indexOf(',', pos);
                    if (end === -1) {
                        fields.push(line.slice(pos));
                        break;
                    } else {
                        fields.push(line.slice(pos, end));
                        pos = end + 1;
                    }
                }
            }
            // 行末が , で終わる場合、ループを抜けた時点で pos === line.length かつ末尾が , なので空フィールドを追加する
            if (line[line.length - 1] === ',') fields.push('');
            return fields;
        };

        if (lines.length > 0) {
            this.header = parseFields(lines[0]);
        }

        const result: string[][] = [];
        for (let i = 1; i < lines.length; ++i) {
            result[i - 1] = parseFields(lines[i]);
        }
        this.body = result;
    }

    toString(): string {
        // RFC4180準拠のフィールドシリアライズ。カンマ・ダブルクォートを含む場合はクォートで囲む。
        const serializeField = (field: string): string => {
            if (field.includes(',') || field.includes('"') || field.includes('\n')) {
                // ダブルクォートを "" にエスケープしてフィールド全体を " で囲む
                return '"' + field.replaceAll('"', '""') + '"';
            }
            return field;
        };

        let result = '';
        result += this.header.map(serializeField).join(',') + '\n';
        result += this.body.map(row => row.map(serializeField).join(',')).join('\n') + '\n';
        return result;
    }
}
