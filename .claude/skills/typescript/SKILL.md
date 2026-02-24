---
description: TypeScriptスキルです。TypeScriptの実装を行うときは必ず参照してください。
---

## 相互参照のクラスの作り方

```ts
const instanceA = {} as InstanceA;

// InstanceB を作成（instanceA への参照をコンストラクタで渡す）
const instanceB = new InstanceB(instanceA);

const realInstanceA = new InstanceA(instanceB);

// instanceA に本物のインスタンスの内容をコピー
Object.assign(instanceA, realInstanceA);
Object.setPrototypeOf(instanceA, InstanceA.prototype);
```

## 依存関係の明示化

### コンストラクタで依存を受け取る

依存するオブジェクトは `document.getElementById()` などでグローバルに取得せず、コンストラクタの引数として明示的に受け取る。

```typescript
// 悪い例: 依存関係が暗黙的
class Selection {
    constructor() {
        const editorElement = document.getElementById('editor');
        if (editorElement) {
            // ...
        }
    }
}

// 良い例: 依存関係が明示的
class Selection {
    constructor(editorElement: HTMLElement) {
        this.editorElement = editorElement;
        // ...
    }
}
```

理由:
- 依存関係がコード上から明確に分かる
- 早期リターンによる見つかりにくい不具合を防ぐ
- テスタビリティが向上する

### DOM要素の所有権を明確にする

DOM要素を追加する親要素は、その要素のライフサイクルを管理する責務を持つクラスから渡す。

```typescript
// 悪い例: table.element に fill-handle を追加
// → table.element.children のインデックスがずれて他の機能が壊れる
this.tableElement.appendChild(this.fillHandle);

// 良い例: editor.element に fill-handle を追加
// → table の children には影響しない
this.editorElement.appendChild(this.fillHandle);
```

## 早期リターンの注意点

早期リターンは便利だが、要素が見つからない場合に静かに失敗するため、不具合の原因特定が困難になる。依存関係をコンストラクタで受け取ることで、初期化時点で問題を検出できる。

```typescript
// 注意が必要なパターン
const element = document.getElementById('editor');
if (!element) return; // 静かに失敗する

// 推奨パターン
constructor(editorElement: HTMLElement) {
    this.editorElement = editorElement; // 呼び出し側で必ず渡す必要がある
}
```

## インデックスベースのDOM操作

`element.children[index]` でアクセスする場合、子要素の追加順序に依存する。予期しない要素が追加されるとインデックスがずれる。

対策:
- 関係のない要素は別の親要素に追加する
- または `querySelectorAll('.specific-class')` でクラス指定で取得する
