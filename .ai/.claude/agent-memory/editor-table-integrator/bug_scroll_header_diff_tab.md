---
name: 差分タブのスクロール位置復元時に行ヘッダーがずれるバグ
description: 差分タブ非表示(display:none)時にブラウザがスクロール位置をリセットするが、行ヘッダーのleftスタイルが古い値のまま残るバグ
type: project
---

## 症状

差分タブを右スクロール → 通常タブに切り替え → 差分タブに戻ると、
データセルは左端にあるが行ヘッダーだけが右側にずれたまま残る。

## 根本原因

### 行ヘッダーのスティッキー実装

`EditorTable.updateRowHeaderSticky()` は scroll イベントで呼ばれ、
行ヘッダーに `style.left = ${scrollLeft}px` を設定することでスクロールに追従する。

最適化として `lastScrollLeft` でキャッシュし、値が変わらない場合はスキップする。

### display:none によるスクロール位置リセット

Chromium は `display: none` になった要素のスクロール位置を `0` にリセットする。
しかし、このリセット時には **scroll イベントが発火しない**。

`DiffTab.hide()` が `wrapperElement.style.display = 'none'` にするとき:
1. `.diff-pane-left.scrollLeft` が 0 にリセットされる（ブラウザ動作）
2. scroll イベントが発火しないため `updateRowHeaderSticky()` が呼ばれない
3. `lastScrollLeft` は前の値（例: 500）のまま残る
4. 行ヘッダーの `left` スタイルも `500px` のまま

`DiffTab.show()` で `display: ''` に戻しても:
1. ペインの `scrollLeft` は 0 のまま
2. scroll イベントは発火しない
3. 行ヘッダーは `left: 500px` のまま（データセルは 0 基準）→ ずれ発生

## 修正

### `DiffTab.hide()` でスクロール位置を保存

```typescript
hide(): void {
    this.savedScrollLeft = this.leftPaneElement.scrollLeft;
    this.savedScrollTop = this.leftPaneElement.scrollTop;
    this.wrapperElement.style.display = 'none';
}
```

### `DiffTab.show()` でスクロール位置を復元 + 行ヘッダーを同期

```typescript
show(): void {
    this.wrapperElement.style.display = '';
    this.leftPaneElement.scrollLeft = this.savedScrollLeft;
    this.leftPaneElement.scrollTop = this.savedScrollTop;
    this.rightPaneElement.scrollLeft = this.savedScrollLeft;
    this.rightPaneElement.scrollTop = this.savedScrollTop;
    this.leftEditorTable.forceRowHeaderScrollSync();
    this.rightEditorTable.forceRowHeaderScrollSync();
}
```

### `EditorTable.forceRowHeaderScrollSync()` を追加

`lastScrollLeft = -1` にリセットしてから `updateRowHeaderSticky()` を呼ぶことで
スキップガードを無効化して強制的に行ヘッダースタイルを現在の scrollLeft に同期する。

## 影響ファイル

- `/mnt/d/repository/yumayo/App.MasterDataEditor/WebView/src/diff-tab.ts`
  - フィールド追加: `savedScrollLeft`, `savedScrollTop`
  - `hide()`: スクロール位置保存を追加
  - `show()`: スクロール位置復元 + 行ヘッダー同期を追加
- `/mnt/d/repository/yumayo/App.MasterDataEditor/WebView/src/editor-table.ts`
  - `forceRowHeaderScrollSync()` 公開メソッドを追加

## 教訓

`display: none` → `display: ''` 時はブラウザがスクロール位置をリセットするが
scroll イベントは発火しない。スクロール位置に依存したスタイルを管理している場合は
手動での保存・復元が必要。

**Why:** Chromium の display:none 時のスクロールリセット動作が原因。
**How to apply:** 差分タブ以外でも display:none を切り替えるコンポーネントでスクロール位置に依存したスタイルがある場合は同様の対処が必要。
