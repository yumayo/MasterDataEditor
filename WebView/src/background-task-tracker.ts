import type {StatusBar} from "./status-bar";

/**
 * バックグラウンドタスクの追跡
 *
 * 非同期処理をラップして実行中のタスク数・ラベルを StatusBar に通知する。
 * api.ts の postMessageAsync から使われ、C# との通信全体を追跡する。
 */
export class BackgroundTaskTracker {
    private readonly tasks: Map<number, string>;
    private nextId: number;
    private readonly statusBar: StatusBar;

    constructor(statusBar: StatusBar) {
        this.tasks = new Map();
        this.nextId = 0;
        this.statusBar = statusBar;
    }

    /**
     * 非同期処理をラップしてタスクを追跡する。
     * 処理開始時にラベルを登録し、完了時（成功・失敗問わず）に削除する。
     */
    async trackAsync<T>(label: string, promise: Promise<T>): Promise<T> {
        const id = this.nextId++;
        this.tasks.set(id, label);
        this.statusBar.updateBackgroundTasks(this.tasks);
        try {
            return await promise;
        } finally {
            this.tasks.delete(id);
            this.statusBar.updateBackgroundTasks(this.tasks);
        }
    }
}
