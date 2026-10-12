---
name: N:1ミニテーブル コンテキストヒント修正（2026-03-17レビュー）
description: N:1バッジのミニテーブルセクションヘッダーにFK名とFK値が表示されない不具合の修正レビュー。評価: A
type: project
---

## N:1ミニテーブル コンテキストヒント修正（2026-03-17）

**評価: A**

**Why:** N:1ミニテーブルで `fkColumnName: ''` / `fkValue: ''` が空文字列固定だったため `.relations-table-context` 要素が生成・描画されなかった。描画条件が `relationType === '1:N'` に限定されていたことも複合的原因。

**How to apply:** N:1とN:1で対称な修正を確認するパターン（bug-report #3, #104など繰り返し発生）の典型。今後も同様の対称操作漏れを疑う。

### DOM確認結果

#### テスト1（.relations-table-context 存在確認）
- `span.relations-table-context` が `.relations-table-header` 内に正しく出現
- ヘッダー構成（修正後）: `relations-table-title > relations-table-dirty > relations-tag--n1 > relations-table-context > relations-table-row-count`
- テキスト: `quest_id=1`（1行目選択時）

#### テスト2（quest_id=1 の表示確認）
- `span.relations-table-context` のテキストが `quest_id=1` と正確に一致
- ミニテーブルには `id=1 / はじまりのクエスト` が表示され、コンテキストとミニテーブル内容が整合

#### テスト3（行変更後の quest_id=2 への更新確認）
- 3行目（quest_id=2）選択後、`span.relations-table-context` のテキストが `quest_id=2` に正しく更新
- ミニテーブルには `id=2 / ふたつめのクエスト` が表示され、整合確認済み

### 1:N との比較確認
- mini-table-reverse-reference-hint ダンプ（chara/skill）では同じ `.relations-table-context` が `chara_id=1` で表示されており、N:1も同一構造で統一されたことを確認

### 残課題（🟡 改善推奨）
1. `.relations-table-context` に `title` 属性がない。テキストが長い場合（複合FKや長い列名）に省略されてもツールチップが表示されない
2. `span.relations-table-dirty` が常時存在しているが（未ダーティ時も）、テキスト内容が空かどうかで状態を暗黙的に表現している。`aria-hidden="true"` / `data-dirty="false"` 等の明示的な状態表現が望ましい
3. ミニテーブル（`.editor-table--inactive`）内の `row-resize-handle` が継続して残存（他レビューでも継続指摘）
4. `relations-table-context` が `relations-table-dirty` の後・`relations-table-row-count` の前に配置されているが、スクリーンリーダーが読む順序が視覚的な情報階層と一致するか要確認

### 1:Nとの構造的対称性
- 1:N: `[fk_column_name=value]` 形式でコンテキストを表示（親テーブルの「どのIDに対応する子か」を示す）
- N:1（修正後）: 同形式 `[fk_column_name=value]` で表示（「このFK列の値がどの親を参照しているか」を示す）
- 意味論的には逆方向だが、表示フォーマットを統一したことで学習コストが下がる。適切な設計選択。
