import React, {useRef, useEffect} from 'react';

/**
 * GridTextField コンポーネントの Props 定義
 */
interface GridTextFieldProps {
    /** 表示中か */
    visible: boolean;
    /** 入力初期値 */
    initialValue: string;
    /** セルの位置（絶対配置用） */
    position: {top: number; left: number; width: number; height: number};
    /** 値確定時のコールバック */
    onSubmit: (value: string) => void;
    /** キャンセル時のコールバック */
    onCancel: () => void;
    /** IME変換中かを外部に通知（KeyDownイベント制御用） */
    onCompositionChange: (composing: boolean) => void;
}

/**
 * contenteditableによるセルテキスト入力コンポーネント
 *
 * Vanilla側の GridTextField クラスが担っていた「セルへの文字入力」と
 * EditorTableHandler が担っていた「キーボードイベント処理（Enter/Escape/Tab）」を
 * React コンポーネントとして統合する。
 *
 * - visible が true になった瞬間に自動フォーカス＋初期値設定
 * - IME変換中（composing）は Enter による確定をスキップする
 * - 確定: Enter / Tab → onSubmit を呼び出す
 * - キャンセル: Escape → onCancel を呼び出す
 * - 位置は position prop の absolute 座標で制御する
 */
export function GridTextField({visible, initialValue, position, onSubmit, onCancel, onCompositionChange}: GridTextFieldProps): React.ReactElement {
    const divRef = useRef<HTMLDivElement>(null);
    /** IME変換中フラグ（compositionstart/compositionend で管理） */
    const composingRef = useRef(false);

    // visible が true になったタイミングで初期値設定とフォーカスを行う
    useEffect(() => {
        if (!visible) return;
        const el = divRef.current;
        if (!el) return;

        // 初期値をセルに反映する
        el.textContent = initialValue;
        el.focus();

        // カーソルを末尾に設定する
        if (initialValue.length > 0) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
    }, [visible, initialValue]);

    function handleCompositionStart(): void {
        composingRef.current = true;
        onCompositionChange(true);
    }

    function handleCompositionEnd(): void {
        composingRef.current = false;
        onCompositionChange(false);
    }

    /**
     * divRef から現在の入力テキストを取得する。
     * DOM の textContent が null（textNode なし）の場合は空文字列を返す。
     * Enter / Tab の2箇所で使うため関数化する。
     */
    function getCurrentText(): string {
        const text = divRef.current ? divRef.current.textContent : null;
        return text !== null ? text : '';
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
        }
        // IME変換中は Enter/Tab による確定をスキップする
        if (composingRef.current) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onSubmit(getCurrentText());
            return;
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            // Tab で確定する（次セルへの移動は親コンポーネントの責務）
            onSubmit(getCurrentText());
        }
    }

    return (
        <div
            ref={divRef}
            className="grid-textfield"
            contentEditable
            suppressContentEditableWarning
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            style={{
                display: visible ? 'block' : 'none',
                position: 'absolute',
                top: position.top,
                left: position.left,
                width: position.width,
                height: position.height,
            }}
        />
    );
}
