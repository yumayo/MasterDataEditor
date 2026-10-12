---
name: FEAT_0041 テーブル名と説明の表示順逆転
description: エクスプローラーとタブでテーブル名を1行目・説明を2行目に並べ替えた改修のUXレビュー（2026-03-18）
type: project
---

FEAT_0041: テーブル名と説明の表示順をテーブル名(1行目)・説明(2行目)に変更。評価: A

**Why:** 従来は説明が1行目・テーブル名が2行目になっており、主情報と補助情報の視覚的階層が逆転していた問題を修正。

**How to apply:** DOM構造の子要素順序が情報階層を正しく表現しているかレビュー時に必ず確認する。

## DOM構造確認結果

### エクスプローラー（sidebar-panel-active）
```html
<div class="explorer-file" style="padding-left: 32px">
  <span class="explorer-file-name">item</span>
  <span class="explorer-file-description">アイテムマスター</span>
</div>
```

### タブ
```html
<li class="tab-button tab-button-active">
  <div class="tab-button-label">
    <span class="tab-button-name">item</span>
    <span class="tab-button-description">アイテムマスター</span>
  </div>
  <div class="tab-button-container">...</div>
</li>
```

## CSS確認結果

### explorer.css
- `.explorer-file-name`: font-size: 12px, font-weight: 500, line-height: 1.3, padding-top: 3px
- `.explorer-file-description`: font-size: 11px, opacity: 0.65, line-height: 1.3, padding-bottom: 3px

### tab-button.css
- `.tab-button-name`: font-size: 12px, font-weight: 500, line-height: 1.3, white-space: nowrap, overflow: hidden, text-overflow: ellipsis
- `.tab-button-description`: font-size: 11px, opacity: 0.65, line-height: 1.3, white-space: nowrap, overflow: hidden, text-overflow: ellipsis

## 良い点
- DOM子要素の順序（name → description）が情報の主従を正しく表現
- エクスプローラーとタブで全く同じ視覚的階層パターンを採用（統一感）
- explorer-file-name に padding-top: 3px、explorer-file-description に padding-bottom: 3px で上下に均等な余白
- tab-button-name/description に text-overflow: ellipsis + overflow: hidden で長い名前の切り捨て対応
- descriptionなしのテーブル（quest）は explorer-file-description span が存在しない（不要なDOM要素を生成しない）

## 残課題
- explorer-file-name に text-overflow: ellipsis / overflow: hidden がない（tab-button-name にはあるため非対称。bug-report #3パターン）
- エクスプローラーの explorer-file-description に title 属性なし（\nで切り捨てた全文が確認不可）
- \n切り捨ては JS側での前処理（split('\n')[0]相当）で行われており、DOMには1行目のみが渡されている。CSS truncation ではなく JS truncation の二重実装になっていないか要確認
- explorer-file / tab-button どちらにも role="button" / aria-label なし（継続パターン）
