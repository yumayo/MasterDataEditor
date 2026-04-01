# ISSUE_0141: 参照パネル非表示時にフォームビューが表示されない

## 種別
不具合

## 症状
右上のトグルボタンで参照パネル（RelationsPanel）を非表示にしている状態で、PKセルを右クリック →「フォームビューを表示」をクリックしても、フォームビューが表示されない。

## 再現手順
1. テーブルを開く
2. 右上のトグルボタンで参照パネルを非表示にする
3. PKセルを右クリック
4. 「フォームビューを表示」をクリック
5. → フォームビューが表示されない

## 根本原因
`Tab.createFormPanel()` が `relationsPanel.getPanelElement().parentElement`（= `editor-right-slot`）にFormPanelを追加するが、参照パネル非表示時は `editor-right-slot` が `visibility: hidden` + `flex-basis: 0` に設定されているため、追加されたFormPanelも見えない。

### 関連コード
- `Editor.hideRelationsPanel()` → `applyRelationsPanelVisibility()` で rightSlot を `visibility: hidden`, `flex-basis: 0` に設定
- `Tab.createFormPanel()` が rightSlot にFormPanelを追加するが、rightSlotの表示状態を考慮していない

## 対策案
`Tab.createFormPanel()` 内でFormPanelを追加する際に、`Editor` に対して rightSlot を一時的に表示状態にするよう要求する。`Tab.closeFormPanel()` で閉じた際は元の非表示状態に戻す。
