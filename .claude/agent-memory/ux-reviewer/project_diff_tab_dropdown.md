---
name: 差分ビュー右ペインのFKドロップダウン修正（2026-03-15）
description: DiffTab右ペインにcreateDropdownInput()+setReferenceComponents()を追加した際のUXレビュー結果
type: project
---

右ペインのFK参照ドロップダウン欠落を修正した実装（diff-tab.ts）のUXレビュー結果。

**実装の核心:**
- `buildDiffEditorTable()` の `dropdownContainer` パラメータを nullable にし、左ペインは `null`、右ペインは `wrapperElement` を渡す
- `if (dropdownContainer !== null) { createDropdownInput(); setReferenceComponents(); }` の分岐で右ペインのみドロップダウンを有効化
- `dropdownContainer = wrapperElement`（`div.tab-wrapper.diff-tab-wrapper`）に `.grid-dropdown` を配置することでオーバーフロークリッピングを回避

**Why:** overflow:auto のスクロールコンテナ（rightPaneElement = `.diff-pane-right`）の内側にドロップダウンを置くとクリッピングされるため、外側の wrapperElement に置く必要がある。bug-report #48, #49 で確立されたパターン。

**How to apply:** DiffTab の DOM 構造レビュー時は、ドロップダウンの親要素が overflow:auto コンテナの「外側」にあることを確認する。

**レビュー評価: B（実装は正しいが、左ペインの参照ヒントとの非対称性が未解消）**

主要な指摘点:
1. [改善必須] 左ペインにドロップダウンが全くない（コメントに「ドロップダウン不要」とあるが、参照ヒントは両ペインで有効） → 実際には左ペインは readOnly なのでドロップダウン無効は正しい。コードコメントが誤解を招く可能性。
2. [改善必須] `console.log('[dropdown] show called', ...)` が GridDropdownInput.show() に残存している（デバッグログ本番混入）
3. [改善推奨] 左ペインの読み取り専用状態がDOMで明示されていない（aria-readonly や .read-only クラス等）
4. [改善推奨] ドロップダウンのポジショニング: `wrapperElement` の `position` が `relative` でないとズレる可能性
5. [良い点] `tabReference.preloadReferenceTables()` と `resolveReverseReferencesAsync()` が左右両ペインで呼ばれている（bug-report #103 パターンの踏襲）
