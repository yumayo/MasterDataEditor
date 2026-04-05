---
name: virtual-scroll-patterns
description: VirtualScrollController実装パターンとPhase 1でのEditorTable統合時の注意点
type: project
---

## VirtualScrollController（Phase 1 骨格）

### DOM構造
```
.editor-table (display: table)
  .editor-table-row[0]            = 列ヘッダー行（position: sticky; top: 0）
  .editor-table-spacer-top        = 上部スペーサー行（display: table-row; height: Xpx）
  ... データ行（表示範囲のみ）...
  .editor-table-spacer-bottom     = 下部スペーサー行（display: table-row; height: Ypx）
```

### enabled=true 時の children インデックス体系
- children[0] = ヘッダー行（変わらず）
- children[1] = topSpacer
- children[2..N+1] = データ行
- children[N+2] = bottomSpacer

### 重要な設計判断
1. **getRowElement の変換**: domRowIndex（従来体系: 0=ヘッダー, 1=データ行0）をVirtualScrollController.dataRowToDomIndex()で実DOM childrenインデックスに変換
2. **getRowCount のスペーサー除外**: `this.element.children.length - virtualScroll.spacerCount()` で計算
3. **this.element.children.length の直接参照禁止**: 全箇所を `getRowCount()` に置き換え
4. **this.element.appendChild(dataRow) の禁止**: bottomSpacer手前に挿入するため `virtualScroll.appendDataRow(row)` を使う
5. **EditorTableStructure の tableElement.children[i] も修正**: `getRowElementForInsert()` 経由に変更

### EditorTableコンストラクタの変更
scrollContainer（HTMLElement）引数を追加。Tab.createEditorTable では `editor.getLeftPaneForScroll()`、createMiniEditorTable では引数の `scrollContainer` を渡す。

**Why:** VirtualScrollController のスクロールイベント登録先として必要
**How to apply:** new EditorTable() の呼び出し箇所（tab.ts×2, diff-tab.ts×1）すべてに scrollContainer を渡すこと
