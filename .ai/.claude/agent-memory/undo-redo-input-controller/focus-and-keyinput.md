---
name: キー入力・フォーカス管理の詳細
description: EditorTableHandler.activate/deactivate の排他制御パターンと、relationsPanel=false の場合にフォーカスが取得されない欠陥
type: project
---

## EditorTableHandler のフォーカス管理パターン

### activate/deactivate の役割

- `activate()`: `active=true` + `focusWithoutScrolling()` でキーイベント受け取りとフォーカス取得
- `deactivate()`: `active=false` でキーイベント無効化（フォーカスは自然に失われる）
- `enable()`: タブアクティブ時に初めて呼ぶ（activate と同じ効果だが active=true の場合はスキップ）
- `onKeydown` の先頭で `if (!this.active) return;` → activeでないと全キー入力が無視される

### RelationsPanel 経由の排他制御

複数のEditorTable（左ペイン + ミニテーブル群）があるとき、RelationsPanel.activateHandler(targetTable) が排他制御を担う：
1. 他の全EditorTableのhandlerをdeactivate
2. targetEditorTableのhandlerをactivate

### 既知の欠陥：relationsPanel=false の場合にactivateが呼ばれない

**ファイル**: `editor-table.ts` 405〜414行
**問題**: mousedown ハンドラで relationsPanel !== false の場合のみ activateHandler を呼ぶ。relationsPanel=false（差分タブのEditorTable）の場合は handler.activate() が一切呼ばれない

```typescript
// 問題のコード
if (table.relationsPanel !== false) {
    table.relationsPanel.activateHandler(table);
}
// else ブランチがなく、差分タブではactiveがfalseのまま
```

**影響**: 差分タブの右ペイン（現在版、isStaged=false）でセルをクリックしても active=false → キー入力が無視される

**修正方針**: else { table.handler.activate(); } を追加する

### 差分タブの特殊性

- `DiffTab.buildDiffEditorTable()` では `handler.enable()/activate()` が呼ばれない
- `DiffTab` の EditorTable には `relationsPanel = false`（接続なし）
- `activateDiffTab()` で `relationsPanel.disconnectEditorTable()` が呼ばれる

### dblclick時のフローと「もう一回クリックが必要」の原因

handler.active=false の状態でダブルクリックすると：
1. enableCellEditMode(true) は dblclick イベントで直接呼ばれるため active チェックなしでテキストフィールドを表示できる
2. しかし focusWithoutScrolling() が呼ばれていないため element にフォーカスがない
3. テキストを入力するにはもう一度クリック（→mousedownでactivateが走る）が必要

### GridTextField とキー入力の関係

GridTextField.show() はビジュアルの表示のみ担当。フォーカスは EditorTableHandler.element（contenteditable div）が常に持つ設計。
- キーイベント → contenteditable div → onKeydown → enableCellEditMode → GridTextField.show() でvisual表示
- GridTextField.element は EditorTableHandler.element と同一オブジェクト

