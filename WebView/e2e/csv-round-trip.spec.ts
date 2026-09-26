import {test, expect} from '@playwright/test';
import {Csv} from '../src/data/csv';

for (const {name, rows} of [
    {name: 'データ行なし', rows: []},
    {name: '空欄だけのデータ行', rows: [['', '']]},
    {name: 'カンマや引用符を含むデータ行', rows: [['1', 'a,b'], ['2', 'say "hello"']]},
]) {
    test(`CSVの保存・再読込で行数と値を維持する: ${name}`, () => {
        const source = new Csv();
        source.header = ['id', 'name'];
        source.body = rows;

        const reloaded = new Csv();
        reloaded.load(source.toString());

        expect(reloaded.header).toEqual(source.header);
        expect(reloaded.body).toEqual(rows);
    });
}
