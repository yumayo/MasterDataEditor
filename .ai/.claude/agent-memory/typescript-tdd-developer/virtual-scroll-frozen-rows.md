---
name: 仮想スクロールと固定行の統合パターン
description: VirtualScrollControllerで固定行をDOMに常駐させる設計パターンと注意点
type: project
---

## 仮想スクロール × 固定行（frozenRow）の統合

### DOM構造
```
[0] header
[1] topSpacer
[2..2+frozen) 固定行（常にDOM上に存在）
[2+frozen..) ビューポート行（スクロールに応じて入れ替え）
```

### 重要な設計判断

1. **renderedStart/renderedEnd の管理範囲**
   - 固定行はビューポート行とは別にDOMに常駐する
   - renderedStart は常に frozenRowCount 以上
   - setFrozenRowCount() で renderedStart を引き上げる

2. **dataRowToDomIndex() の分岐**
   - 固定行（0 <= idx < frozenRowCount）: `DATA_ROW_START_INDEX + idx`
   - 非固定行: `idx - renderedStart + DATA_ROW_START_INDEX + frozenRowCount`
   - 範囲外: null

3. **updateRenderedRows() のviewportDomStart**
   - `viewportDomStart = DATA_ROW_START_INDEX + frozenRowCount`
   - ビューポート行のみ操作し、固定行には触れない

4. **topSpacer の高さ計算**
   - `(newStart - frozenRowCount) * rowHeight`（固定行分を差し引く）

5. **recalculateCore() のスクロール位置計算**
   - `dataAreaScrollTop = max(0, scrollTop - headerHeight - frozenHeight)`
   - 固定行の高さ分もオフセットから除外する

### 注意: restoreBookmarkMarks 等のDOM走査ループ
- 固定行はDOMに常駐、ビューポート行は rendered.start〜rendered.end のみDOMに存在
- ループは `for (let i = 0; i < rendered.end; i++)` とし、`frozenRowCount <= i < rendered.start` をスキップする
- getCell() は DOM 外行で throw するため、getCellOrNull() を使うか、上記スキップを入れる

### 修正時に発生したリグレッション
- restoreBookmarkMarks のループ開始を 0 にしたとき、frozenRowCount=0 のテーブルで
  rendered.start より前の行に getCell() がアクセスして throw するバグが発生
- 対策: getCellOrNull() + ギャップスキップの両方で防御する
