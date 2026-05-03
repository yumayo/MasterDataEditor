---
name: セル編集確定時のスクロール位置リセットバグ調査記録
description: セル編集確定（Enter）後にスクロール位置が(0,0)にリセットされる問題の調査記録
type: project
---

## 症状
セルを編集して確定すると、スクロール位置が(0,0)にリセットされる。
再現手順: 1024x768, charaテーブル, 一番下右までスクロール, 95行目攻撃力列に1を入力してEnter

## 根本原因仮説（静的コード解析）

`EditorTableHandler.element`（`contenteditable` の `grid-textfield`）は `wrapperElement`（`leftPane` の子要素）に配置されている。
`leftPane` はスクロールコンテナ（`overflow: auto`）。

`onFocusout`（editor-table-handler.ts 行267）で：
```typescript
this.element.focus({ preventScroll: true });
```
Chromiumの一部バージョンで `preventScroll: true` が正しく機能せず、`leftPane.scrollTop` がリセットされる可能性がある。

`grid-textfield` の位置は `top: -99999px, left: -99999px` のため、フォーカス時にブラウザが
スクロールコンテナを(-99999px方向に)スクロールしようとして scrollTop が 0 近くになる。

## 修正方針

`EditorTableHandler` のコンストラクタに `ScrollViewportController` を追加し、
`focus()` 前後でスクロール位置を保護するプライベートメソッドを追加する：

```typescript
private focusWithoutScrolling(): void {
    const scrollTop = this.scrollBinding.getScrollTop();
    const scrollLeft = this.scrollBinding.getScrollLeft();
    this.element.focus({ preventScroll: true });
    this.scrollBinding.setScrollPosition(scrollTop, scrollLeft);
}
```

`onFocusout`（行267）、`enable()`（行118）、`activate()`（行128）の `focus()` 呼び出しを
`focusWithoutScrolling()` に置き換える。

## 影響ファイル
- editor-table-handler.ts: コンストラクタに scrollBinding 追加、focusWithoutScrolling() 追加
- tab.ts (行972): `new EditorTableHandler(editorTable, selection, history)` に scrollController を追加

**Why:** `preventScroll: true` に依存した実装はブラウザ実装差異に脆弱。スクロール保護を明示的に行う。

**How to apply:** EditorTableHandler のコンストラクタ変更時は tab.ts の 2 箇所（createEditorTable + createMiniEditorTable）も更新する。
