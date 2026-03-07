# TypeScript TDD Developer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C# (WinForms + WebView2)
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- Build: Vite (`WebView/` directory)

## Key Files
- `/WebView/src/editor-table.ts` - Core table facade
- `/WebView/src/editor-table-handler.ts` - High-level edit handler
- `/WebView/src/editor-table-reference.ts` - Reverse reference hints
- `/WebView/src/editor-table-context-menu.ts` - Context menu handlers
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane)
- `/WebView/src/selection.ts` - Selection and focus management
- `/WebView/e2e/fixtures/test-utils.ts` - Shared test utilities

## Implementation Patterns

### 相互参照クラスの構築
セッターを使わず `connectXxx()` メソッドで相互参照を後から注入する。
```typescript
class A {
  private b!: B;
  connectB(b: B) { this.b = b; }
}
class B {
  private a!: A;
  connectA(a: A) { this.a = a; }
}
// main.ts で
const a = new A(); const b = new B();
a.connectB(b); b.connectA(a);
```

### センチネル値
null/undefined 禁止 → boolean `false` や空文字 `""` をセンチネルとして使う。

### ループ後の副作用
ループ内に副作用を置かない。バッチ処理完了後に1回だけ副作用メソッドを呼ぶ。

### 非同期競合防止
`currentRequestId` パターン: 呼び出し元でインクリメント、`renderAsync` 自身はインクリメントしない。

## Recurring Implementation Mistakes
(ここに発見した繰り返しミスを記録していく)
