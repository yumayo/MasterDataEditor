---
name: scroll-position 自動スクロール機能（マウスクリック・Shift+クリック）
description: マウスクリック時の scrollFocusIntoView() 追加・Shift+クリック時の scrollCellIntoView() 追加のUXレビュー記録（2026-03-17）
type: project
---

## FEAT: マウスクリック/Shift+クリック時の自動スクロール追加（評価: A-）

**Why:** キーボード操作では既に scrollCellIntoView が動いていたが、マウスクリックでは動いていなかった非対称を解消する変更。

**How to apply:** 今後 Selection のメソッドを追加・変更する際は、キーボード経路とマウス経路の対称性を確認すること。

### 動作確認（DOMダンプから）

- マウスクリック: fill-handle `left: 519px; top: 668px`、corner-cell `left: 161px`（横スクロール済み）
  - 推定フォーカス行 = 行32。列2(col=2)にフォーカスがあり横スクロールが正しく発生している
- Shift+クリック: fill-handle `left: 207px; top: 668px`、corner-cell `left: 0px`
  - 選択範囲が row-header 31個 + 列ヘッダー1個 = 32要素。32行選択 + extendSelection 先へのスクロールが正しく動作
- Tab確定後: fill-handle top=1907px（推定行94）→ スクロール維持確認
- セル編集確定後: fill-handle top=2033px（推定行100）→ スクロール維持確認

### 残課題（未解決）

#### 対称操作の欠落（bug-report #3パターン）
- `selectRow()` に `scrollFocusIntoView()` がない（行ヘッダークリックでフォーカス行へのスクロールが起きない）
- `selectColumn()` に `scrollFocusIntoView()` がない（列ヘッダークリックで同様）
- `extendToRow()` / `extendToColumn()` に `scrollCellIntoView()` がない（Shift+行/列ヘッダークリックで同様）
- `selectAll()` に `scrollFocusIntoView()` がない（左上コーナークリックでrow=1,col=1へのスクロールがない）

#### rAF 競合リスク（bug-report #85パターン）
- `scrollCellIntoView` の rAF 再適用時に rAF ID を保持していない
- 高速連続クリック時に前の rAF が後から発火し、スクロール位置が乱れる可能性
- bug-report.md #85 の教訓「rAF ID を保持して cancelAnimationFrame で競合を管理する」が未適用

#### Shift+クリックの fold-handle位置とフォーカスの不一致
- Shift+クリックは extendSelection を呼ぶため focus（アンカー）は start() 時点のまま
- fill-handle は focus 位置（アンカー）を示す → 拡張先（endRow/endColumn）は fill-handle で視認できない
  → これは設計上の意図通りである可能性が高い（推測）が、拡張先が画面外になった場合のスクロール先は endRow/endColumn であることはDOM確認済み

#### アクセシビリティ（継続課題）
- 選択セルに aria-selected 属性がない（selected クラスのみ）
- フォーカス管理が fill-handle の CSS position で行われており、tabindex / focus() ベースではない
