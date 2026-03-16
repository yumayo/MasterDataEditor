---
name: FEAT_0035 フィルター機能改修
description: フィルタードロップダウンの7つの改修（空文字除外・ESCキー・FK参照ヒント・ヒント検索・「検索結果なし」・横幅拡大・ボタン均等幅）のUXレビュー（2026-03-17）
type: project
---

## 評価: A-

FEAT_0035の7つの改修すべてが正しくDOMに反映されている。FK参照ヒント付きフィルターはこのツールの核心機能の直接的強化であり価値が高い。残課題はアクセシビリティと細部の一貫性。

**Why:** フィルター機能はゲームプランナーが「条件を満たす行だけ見たい」という日常作業の要になる。FK列で参照名でフィルタリングできることは FK手打ち苦痛解消ゴールに直結する。

**How to apply:** 次回レビュー時は「filter-item-hint と filter-item-label のコントラスト比」「適用ボタンのフォーカス管理」「フィルター状態リセット操作パス」を引き続き確認。

### DOM構造確認結果

#### 参照ヒント付きフィルターアイテム（FK列）
```
div.filter-dropdown.visible
  input.filter-search-input
  div.filter-buttons
    button.filter-select-all
    button.filter-deselect-all
    button.filter-clear
  div.filter-item-list
    label.filter-item
      input[type=checkbox]
      span.filter-item-label  ← ID値（例: "1"）
      span.filter-item-hint   ← 参照名（例: "勇者"）
  button.filter-apply
```

#### 非FK列（参照ヒントなし）
```
label.filter-item
  input[type=checkbox]
  span.filter-item-label  ← 値のみ（例: "armor"）
  （span.filter-item-hint なし）
```

#### 検索結果なし
```
div.filter-item-list
  div.filter-no-result > "検索結果なし"
```

#### 空文字除外確認
- category列に空文字セルが2行あるが、filter-item-listには armor/potion/weapon の3つのみ（空文字なし）
- weaponのみ選択してフィルター適用後、空文字行(data-store-index="1", "3")が display:none にならず表示維持 ← 正しい

#### フィルター適用後のDOM
- フィルター適用済み列ヘッダー: `editor-table-column-header has-icons filter-active`（filter-activeクラス付与）
- 非表示行: `editor-table-row ... style="display: none;"` の inline style
- 行数カウンター: `div.filter-row-count` に `style="display: block;"` + テキスト "3 / 5 行"

### 残課題

#### 🔴 致命的
- なし（7機能すべて正常動作確認）

#### 🟡 改善推奨
1. **filter-dropdown に role="dialog" / aria-label がない**: スクリーンリーダーでフィルターパネルの存在がわからない
2. **filter-item の label 要素に for 属性がない**: checkbox との関連付けが明示されていない（内包関係は機能するが for 属性がベストプラクティス）
3. **filter-item-hint のセマンティクス欠如**: `span.filter-item-hint` に role や aria-label がなく「これが何のヒントか」が機械可読でない。推測: `aria-label="参照: 勇者"` 程度を付与すれば改善
4. **filter-apply ボタンが filter-buttons div の外にある**: `div.filter-buttons`（全選択・全解除・クリア）と独立して `button.filter-apply` が置かれている。視覚上は問題ないがDOM構造として「全選択/全解除/クリア」と「適用」が兄弟要素として散在している
5. **「参照ヒントのテキストで検索」ダンプでname列（非FK）のフィルターが表示される**: `span.filter-item-hint` がなく `span.filter-item-label` のみの label.filter-item が4つある。FK列テスト（chara_id）では `span.filter-item-hint` あり。非対称は意図通りだが、非FK列の検索ダンプでなぜか name 列ではなく「ローブ/剣/杖/盾」が表示されている。これは item テーブルの name 列値と一致しており正常（FK列のみヒントが追加される設計として適切）

#### 💡 参考
- filter-no-result に `aria-live="polite"` を付与すると検索ナロウイングのフィードバックがスクリーンリーダーに伝わる
- 「filter-active クラス付き列ヘッダーのフィルターアイコン色変化」がCSS側で実装されているか（bug-report #116パターン）は CSS ダンプ除去のため確認不可

### bug-report.md との照合
- #92（Object.assignインスタンス不一致）: filter-dropdown の show/hide が visible クラスの付け外しで実装されており、display競合(#94)も回避済み → 問題なし
- #93（フィルター再評価の操作パス漏れ）: ソート後フィルター・フィルター後ソートがそれぞれ正しく動作している（別テストで確認済み）
- #94（display競合）: `visible` クラスで制御されており、`style.display` 直接書き換えはないことを確認
