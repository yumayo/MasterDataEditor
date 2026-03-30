---
name: ISSUE_0120 blameビュー行ヘッダー改修後レビュー（2026-03-30）
description: ISSUE_0120の前回指摘（C+評価）に対する改修結果レビュー。行ヘッダー幅拡張・横並びレイアウト・構造化・ARIA対応の改善状況を記録。
type: project
---

## ISSUE_0120 blameビュー 改修後レビュー（2026-03-30）評価: B+

**Why:** 前回（C+）の主要指摘6件への対応状況を確認するレビュー。

**How to apply:** blame UIに関する次回以降の指摘では、本記録の「解消済み」項目を再指摘しないこと。

### 前回指摘からの改善確認

#### 解消済み
- blame-info の高さ問題（🔴 → 解消）: `editor-table--blame-visible` クラスで row-header を `display:flex; align-items:center; width:240px` に拡張。height は 20px 固定のままだが、flex 横並びにより blame-info が高さに収まるレイアウトに変更済み。スクリーンショットで「2 Alice 2026-03-01」「3 Bob 2026-03-15」が1行に横並び表示されており、データセルとの行高さが一致していることを視覚確認。
- blame-info の構造化（🔴 → 解消）: `<span class="blame-author">Alice</span><span class="blame-date">2026-03-01</span>` の2要素構造になった。blame-author に max-width:80px + ellipsis 適用。
- blame-info のARIA対応（🔴 → 解消）: `role="note"` + `aria-label="最終変更: Alice（2026-03-01）"` + `title="最終変更: Alice（2026-03-01）"` の3点セットが付与された。title 属性によりフル著者名のツールチップも解消。
- バッファ行への blame-info 誤表示（🔴 → 解消）: data-row-index=3（editor-table-empty-row）に blame-info がなくなった（row-index=1,2のみ blame-info 保持）。

### 残存課題

#### 修正必須（🔴）
1. **行1（data-row-index=0）に blame-info がない**
   DOM: `data-row-index="0"` に blame-info 要素なし。行2（data-row-index=1）は Alice、行3（data-row-index=2）は Bob と表示されているが、行1は空白。blame データが取得できていない行（コミット対象外？）か、インデックスのオフセットバグの可能性がある。プランナーが「行1は誰も変更していないのか」と誤解する。
   - スクリーンショット確認: 行1ヘッダーが「1」のみ、行2が「2 Alice 2026-03-01」、行3が「3 Bob 2026-03-15」

2. **activity-bar SVG に aria-hidden="true" がない（全サイクル継続課題）**
   DOMダンプ先頭3000文字内に aria-hidden なし SVG が6件。

#### 改善推奨（🟡）
1. **fill-handle が display:block で残存**（left:515px, top:59px）— 全サイクル継続課題

2. **blame-date の日付フォーマットが ISO 8601 のまま（2026-03-01）**
   「3月1日」「3/1」のような日本語フォーマットの方がプランナーには読みやすい。ただしソート性は ISO の方が優秀なため、表示のみ変換し data 属性に ISO を保持する設計が望ましい。

3. **blame-info の gap:8px がセル幅次第でトランケートされる可能性**
   blame-author の max-width が 80px 固定のため、著者名が 80px を超える場合は ellipsis で省略されるが、240px のヘッダーのうち行番号テキスト（数値、約 10-20px）+ padding-left 8px + blame-info の margin-left 8px = 残り約 200px を blame-info が使用する設計。blame-info 自体に overflow:hidden があるため長い著者名は切れる。これは許容範囲内だが、title 属性でフル情報が確認できることを前提としている。

### CSS設計の確認

- `.editor-table--blame-visible .editor-table-row-header` で width:240px + display:flex + align-items:center を一括指定。インラインスタイルは height: 20px 固定のまま変更なし → CSSクラスが優先されるため設計上正しい。
- `.editor-table-corner-cell` も同様に 240px に拡張済み → 列ヘッダーとデータ列の位置ずれが防止されている。
- `.blame-info { display:flex; gap:8px; font-size:11px; opacity:0.6; white-space:nowrap; overflow:hidden; margin-left:8px }` — 行番号テキストノードと blame-info が flex の兄弟要素として横並びになる正しい構造。
