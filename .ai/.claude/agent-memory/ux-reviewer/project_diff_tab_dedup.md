---
name: 差分タブ重複開きバグの修正（2026-03-15）
description: openDiffTab()の重複防止ロジックとremoveTabButton()のDOM除去修正の内容と評価
type: project
---

## 修正内容（6a33d76時点のコード）

1. `removeTabButton()` でタブボタンのDOM要素を `this.tabButtons[index].element.remove()` で除去するよう修正。差分タブは `tabStates` に登録されないため `state.wrapperElement.remove()` が呼ばれず、ここで除去しないとDOMに残存していた。

2. `openDiffTab()` を「既存タブが `diffTabs` Mapに存在する場合は `enableTabButton()` でアクティブ化するだけ」に変更。以前は毎回新しいDiffTabを生成していた。

**Why:** 差分タブは `tabStates` ではなく `diffTabs` Mapで管理される特殊タブ。通常タブのDOMクリーンアップパスを通らないため、個別に `.element.remove()` が必要。

**How to apply:** 差分タブや設定タブのような「特殊タブ」の追加・修正時は、通常タブのDOMクリーンアップパス（`state.wrapperElement.remove()`）を通るか必ず確認する。通らない場合は専用のDOM除去コードを追加する。

## 評価結果

- DOM構造上の問題: なし（タブバーは `ul#tab-content > li.tab-button` の適切な構造）
- 現在のDOMダンプには差分タブが表示されていない（初期状態のためテーブルタブ「test」のみ）
- `removeTabButton()` のDOM除去追加は適切な修正
- `openDiffTab()` の重複防止は `diffTabs.has(diffTabName)` による早期リターンで実装済みで適切

## 残存リスク（bug-report.md #84・#77との照合）

- #84: 設定タブ閉鎖時のパスが `closeTab()` を経由せず `removeTabButton()` を直接呼んでいた問題 → 現在のコードでは `TabButton.onClickCloseButton()` が `Tab.closeTab()` を呼ぶよう修正済み
- #77: show/hide対称操作の欠落 → `closeDiffTab`時に `leaveSettingsMode()` が呼ばれているか確認が必要（`closeTab()` 経由で呼ばれる）
