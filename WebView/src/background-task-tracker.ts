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
     * 完了後は経過時間と成否を DebugConsole に記録する。
     */
    async trackAsync<T>(label: string, promise: Promise<T>): Promise<T> {
        const id = this.nextId++;
        const startTime = Date.now();
        this.tasks.set(id, label);
        this.statusBar.updateBackgroundTasks(this.tasks);
        try {
            const result = await promise;
            this.debugConsole.appendEntry(label, Date.now() - startTime, 'success');
            return result;
        } catch (e: unknown) {
            this.debugConsole.appendEntry(label, Date.now() - startTime, 'error');
            throw e;
        } finally {
            this.tasks.delete(id);
            this.statusBar.updateBackgroundTasks(this.tasks);
        }
    }
}
