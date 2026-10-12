import type {StatusBar} from "../ui/status-bar";
import type {DebugConsole, DebugConsoleEntryDetail} from "../panels/debug-console";
import {parseCallerInfo} from "../core/caller-info";
import type {GitBlameTiming} from "./git-blame-timing";

/**
 * バックグラウンドタスクの追跡
 *
 * 非同期処理をラップして実行中のタスク数・ラベルを StatusBar に通知する。
 * API通信の追跡では経過時間と成否も DebugConsole に記録し、
 * 通知元が記録を担う処理では進行表示だけを管理する。
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

    /** 通知・ログは呼び出し側に任せ、成功・失敗・破棄の決着まで進行表示だけを管理する。 */
    async trackActivityAsync<T>(label: string, promise: Promise<T>): Promise<T> {
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

    /**
     * 非同期処理をラップしてタスクを追跡する。
     * 処理開始時にラベルを登録し、完了時（成功・失敗問わず）に削除する。
     * 完了後は経過時間・成否・呼び出し元情報を DebugConsole に記録する。
     */
    async trackAsync<T>(label: string, promise: Promise<T>, detail?: DebugConsoleEntryDetail): Promise<T> {
        // await 前にスタックを取得しないと呼び出し元情報が消える
        const caller = parseCallerInfo(BackgroundTaskTracker.SKIP_PATTERNS);
        const startTime = performance.now();
        try {
            const result = await this.trackActivityAsync(label, promise);
            const elapsedUs = Math.round((performance.now() - startTime) * 1000);
            this.debugConsole.appendEntry(detail?.apiName ?? label, elapsedUs, 'success', caller, this.completeDetail(detail, 'success', caller, elapsedUs));
            return result;
        } catch (e: unknown) {
            const elapsedUs = Math.round((performance.now() - startTime) * 1000);
            const completedDetail = this.completeDetail(detail, 'error', caller, elapsedUs);
            if (completedDetail !== undefined && completedDetail.error === undefined) {
                completedDetail.error = e instanceof Error ? e.message : String(e);
            }
            this.debugConsole.appendEntry(detail?.apiName ?? label, elapsedUs, 'error', caller, completedDetail);
            throw e;
        }
    }

    /**
     * キャッシュヒット時の記録をデバッグコンソールに追加する。
     * C#への通信は発生しないため同期的に即座に記録する。
     */
    recordCacheHit(label: string, startTime: number, detail?: DebugConsoleEntryDetail): void {
        const caller = parseCallerInfo(BackgroundTaskTracker.SKIP_PATTERNS);
        const elapsedUs = Math.round((performance.now() - startTime) * 1000);
        this.debugConsole.appendEntry(detail?.apiName ?? `${label} (cache)`, elapsedUs, 'success', caller, this.completeDetail(detail, 'success', caller, elapsedUs));
    }

    recordGitBlameTiming(timing: GitBlameTiming): void {
        const label = `git_blame [${timing.stage}] #${timing.requestId}`;
        const status = timing.success ? 'success' : 'error';
        const caller = typeof timing.consumer === 'string' ? timing.consumer : timing.source;
        this.debugConsole.appendEntry(label, Math.round(timing.durationMs * 1000), status, caller, {
            apiName: label,
            requestId: timing.requestId,
            request: {type: 'git_blame_request', requestId: timing.requestId},
            response: timing,
            status,
            caller,
            durationUs: Math.round(timing.durationMs * 1000),
        });
    }

    private completeDetail(detail: DebugConsoleEntryDetail | undefined, status: 'success' | 'error', caller: string, durationUs: number): DebugConsoleEntryDetail | undefined {
        if (detail === undefined) return undefined;
        return {
            ...detail,
            status,
            caller,
            durationUs,
            completedAt: detail.completedAt ?? new Date().toISOString(),
        };
    }
}
