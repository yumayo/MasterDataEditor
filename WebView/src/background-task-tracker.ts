import type {StatusBar} from "./status-bar";
import type {DebugConsole} from "./debug-console";

/**
 * バックグラウンドタスクの追跡
 *
 * 非同期処理をラップして実行中のタスク数・ラベルを StatusBar に通知し、
 * 完了後の経過時間と成否を DebugConsole に記録する。
 * api.ts の postMessageAsync から使われ、C# との通信全体を追跡する。
 */
export class BackgroundTaskTracker {
    private readonly tasks: Map<number, string>;
    private nextId: number;
    private readonly statusBar: StatusBar;
    private readonly debugConsole: DebugConsole;

    constructor(statusBar: StatusBar, debugConsole: DebugConsole) {
        this.tasks = new Map();
        this.nextId = 0;
        this.statusBar = statusBar;
        this.debugConsole = debugConsole;
    }

    /**
     * 非同期処理をラップしてタスクを追跡する。
     * 処理開始時にラベルを登録し、完了時（成功・失敗問わず）に削除する。
     * 完了後は経過時間・成否・呼び出し元情報を DebugConsole に記録する。
     */
    async trackAsync<T>(label: string, promise: Promise<T>): Promise<T> {
        // await 前にスタックを取得しないと呼び出し元情報が消える
        const caller = this.parseCallerInfo();
        const id = this.nextId++;
        const startTime = Date.now();
        this.tasks.set(id, label);
        this.statusBar.updateBackgroundTasks(this.tasks);
        try {
            const result = await promise;
            this.debugConsole.appendEntry(label, Date.now() - startTime, 'success', caller);
            return result;
        } catch (e: unknown) {
            this.debugConsole.appendEntry(label, Date.now() - startTime, 'error', caller);
            throw e;
        } finally {
            this.tasks.delete(id);
            this.statusBar.updateBackgroundTasks(this.tasks);
        }
    }

    /**
     * 現在のスタックトレースから、ラッパー層（BackgroundTaskTracker / api）を除いた
     * 最初の呼び出し元フレームを特定する。
     * スキップ対象フレームを含まない最初の "at ..." 行を返す。
     * 例: "editor-table.ts:123"
     */
    private parseCallerInfo(): string {
        const SKIP_PATTERNS = ['background-task-tracker', '/api.'];
        const stack = new Error().stack;
        if (!stack) return '';
        for (const line of stack.split('\n')) {
            if (!line.trim().startsWith('at ')) continue;
            if (SKIP_PATTERNS.some(p => line.includes(p))) continue;
            // Chromium 形式: "    at funcName (path/to/file.ts:line:col)"
            // または:       "    at path/to/file.ts:line:col"
            const match = line.match(/\((.+):(\d+):\d+\)/) ?? line.match(/at\s+(.+):(\d+):\d+/);
            if (!match) continue;
            const rawName = match[1].split('/').pop() ?? match[1];
            const fileName = rawName.split('?')[0];
            return `${fileName}:${match[2]}`;
        }
        return '';
    }
}
