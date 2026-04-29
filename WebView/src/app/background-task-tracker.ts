import type {StatusBar} from "../ui/status-bar";
import type {DebugConsole} from "../panels/debug-console";
import {parseCallerInfo} from "../core/caller-info";

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

    /** parseCallerInfo でスキップするフレームパターン（自身のファイル名 + api + 共通モジュール） */
    private static readonly SKIP_PATTERNS: ReadonlyArray<string> = ['background-task-tracker', '/api.', 'caller-info'];

    /**
     * 非同期処理をラップしてタスクを追跡する。
     * 処理開始時にラベルを登録し、完了時（成功・失敗問わず）に削除する。
     * 完了後は経過時間・成否・呼び出し元情報を DebugConsole に記録する。
     */
    async trackAsync<T>(label: string, promise: Promise<T>): Promise<T> {
        // await 前にスタックを取得しないと呼び出し元情報が消える
        const caller = parseCallerInfo(BackgroundTaskTracker.SKIP_PATTERNS);
        const id = this.nextId++;
        const startTime = performance.now();
        this.tasks.set(id, label);
        this.statusBar.updateBackgroundTasks(this.tasks);
        try {
            const result = await promise;
            this.debugConsole.appendEntry(label, Math.round((performance.now() - startTime) * 1000), 'success', caller);
            return result;
        } catch (e: unknown) {
            this.debugConsole.appendEntry(label, Math.round((performance.now() - startTime) * 1000), 'error', caller);
            throw e;
        } finally {
            this.tasks.delete(id);
            this.statusBar.updateBackgroundTasks(this.tasks);
        }
    }

    /**
     * キャッシュヒット時の記録をデバッグコンソールに追加する。
     * C#への通信は発生しないため同期的に即座に記録する。
     */
    recordCacheHit(label: string, startTime: number): void {
        const caller = parseCallerInfo(BackgroundTaskTracker.SKIP_PATTERNS);
        const elapsedUs = Math.round((performance.now() - startTime) * 1000);
        this.debugConsole.appendEntry(`${label} (cache)`, elapsedUs, 'success', caller);
    }
}
