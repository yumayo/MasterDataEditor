import type {BackgroundTaskTracker} from "./background-task-tracker";
import type {DebugConsoleEntryDetail} from "../panels/debug-console";
import {stringifyJsonForFile} from "../core/json-format";

/** postMessageAsync に統合されるバックグラウンドタスクトラッカー（main.ts で設定される） */
let tracker: BackgroundTaskTracker | false = false;

/**
 * バックグラウンドタスクトラッカーを設定する。
 * main.ts で StatusBar 生成後に呼び出し、C# との全通信を追跡対象にする。
 */
export function configureBackgroundTracker(t: BackgroundTaskTracker): void {
    tracker = t;
}

// =========================================================================
// ファイルキャッシュ
// 起動時に全ファイルを一括読み込みし、以降はキャッシュから同期的に返す。
// writeFileAsync / deleteFileAsync でキャッシュも同期的に更新する。
// =========================================================================
const fileCache = new Map<string, string>();
const dirCache = new Map<string, File[]>();

export type FileScope = 'workspace' | 'user';

export interface FileScopeOptions {
    scope?: FileScope;
}

function getFileScope(options: FileScopeOptions = {}): FileScope {
    return options.scope ?? 'workspace';
}

function getFileCacheKey(filename: string, options: FileScopeOptions = {}): string {
    const scope = getFileScope(options);
    return scope === 'workspace' ? filename : `${scope}:${filename}`;
}

function createFileRequestData(filename: string, options: FileScopeOptions = {}): Record<string, unknown> {
    const scope = getFileScope(options);
    if (scope === 'workspace') return { filename };
    return { filename, scope };
}

/**
 * 起動時に schema/ と data/ 以下の全ファイルを一括読み込みしてキャッシュに格納する。
 * main.ts の初期化冒頭で呼び出すこと。
 * ディレクトリ列挙・ファイル読み込みを並列で実行し、起動時間を短縮する。
 */
export async function preloadAllFilesAsync(): Promise<void> {
    // schema/, data/, plugins/ のディレクトリ列挙を並列実行する
    const [schemaFiles, dataFiles, pluginFilesResult] = await Promise.all([
        postMessageAsync<File[]>('find_files', { directory: 'schema' }),
        postMessageAsync<File[]>('find_files', { directory: 'data' }),
        postMessageAsync<File[]>('find_files', { directory: 'plugins' }).then(
            (files) => ({ files, found: true as const }),
            () => ({ files: [] as File[], found: false as const }),
        ),
    ]);
    dirCache.set('schema', schemaFiles);
    dirCache.set('data', dataFiles);
    if (pluginFilesResult.found) dirCache.set('plugins', pluginFilesResult.files);

    // 全ディレクトリのファイル読み込みを並列実行する（C#側がバックグラウンドスレッドで処理する）
    const readTasks: Promise<void>[] = [];
    for (const file of schemaFiles) {
        if (file.type !== 'file') continue;
        const path = `schema/${file.name}`;
        readTasks.push(postMessageAsync<string>('read_file', { filename: path }).then((content) => { fileCache.set(path, content); }));
    }
    for (const file of dataFiles) {
        if (file.type !== 'file') continue;
        const path = `data/${file.name}`;
        readTasks.push(postMessageAsync<string>('read_file', { filename: path }).then((content) => { fileCache.set(path, content); }));
    }
    for (const file of pluginFilesResult.files) {
        if (file.type !== 'file') continue;
        const path = `plugins/${file.name}`;
        readTasks.push(postMessageAsync<string>('read_file', { filename: path }).then((content) => { fileCache.set(path, content); }));
    }
    await Promise.all(readTasks);
}

/**
 * ファイルに文字列またはJSONデータを書き込む（汎用API）
 * 書き込み後にキャッシュも更新する。
 */
export type WriteFileData = string | object;

export interface WriteFileOptions {
    scope?: FileScope;
    invalidateGitStatus?: boolean;
    suppressSelfSaveGitRefresh?: boolean;
}

const suppressedSelfSaveGitRefreshPaths = new Map<string, number>();
let suppressedSelfSaveGitRefreshDeadline = 0;
// FileWatcher はアプリ自身の保存にも file_changed を返す。
// 保存処理側ですでに git_status を1回取り直しているため、その直後の重複した
// git_status だけを抑止する。ファイルキャッシュの無効化は sidebar 側で常に行う。
const SELF_SAVE_GIT_REFRESH_SUPPRESSION_MS = 1500;

function isMasterDataFile(filename: string): boolean {
    return filename.startsWith('schema/') || filename.startsWith('data/');
}

function affectsGitStatus(filename: string): boolean {
    return filename.startsWith('data/') && filename.endsWith('.csv');
}

function suppressNextSelfSaveGitRefresh(filename: string): void {
    if (!isMasterDataFile(filename)) return;
    suppressedSelfSaveGitRefreshPaths.set(filename, (suppressedSelfSaveGitRefreshPaths.get(filename) ?? 0) + 1);
    suppressedSelfSaveGitRefreshDeadline = performance.now() + SELF_SAVE_GIT_REFRESH_SUPPRESSION_MS;
}

export function consumeSuppressedSelfSaveGitRefresh(filenames: readonly string[] | undefined): boolean {
    if (suppressedSelfSaveGitRefreshPaths.size === 0) return false;
    if (performance.now() > suppressedSelfSaveGitRefreshDeadline) {
        suppressedSelfSaveGitRefreshPaths.clear();
        return false;
    }
    if (filenames === undefined || filenames.length === 0) return false;

    let allFilesAreSelfSave = true;
    const consumedFilenames: string[] = [];
    for (const filename of filenames) {
        const remainingCount = suppressedSelfSaveGitRefreshPaths.get(filename) ?? 0;
        if (remainingCount <= 0) {
            allFilesAreSelfSave = false;
            continue;
        }
        consumedFilenames.push(filename);
    }
    for (const filename of consumedFilenames) {
        const remainingCount = (suppressedSelfSaveGitRefreshPaths.get(filename) ?? 1) - 1;
        if (remainingCount <= 0) {
            suppressedSelfSaveGitRefreshPaths.delete(filename);
        } else {
            suppressedSelfSaveGitRefreshPaths.set(filename, remainingCount);
        }
    }
    return allFilesAreSelfSave && consumedFilenames.length > 0;
}

export async function writeFileAsync(filename: string, data: WriteFileData, options: WriteFileOptions = {}): Promise<void> {
    await postMessageAsync('write_file', { ...createFileRequestData(filename, options), data });
    fileCache.set(getFileCacheKey(filename, options), serializeWriteFileData(data));
    if (options.suppressSelfSaveGitRefresh === true) suppressNextSelfSaveGitRefresh(filename);
    if (getFileScope(options) === 'workspace' && options.invalidateGitStatus !== false && affectsGitStatus(filename)) invalidateGitStatusCache();
}

/** ファイルキャッシュの特定エントリを無効化する。テストやファイルウォッチャーで外部変更された場合に呼ぶ。 */
export function invalidateFileCacheEntry(filename: string): void {
    fileCache.delete(filename);
    fileCache.delete(getFileCacheKey(filename, { scope: 'user' }));
}

/** schema/ と data/ 以下のキャッシュを無効化する。外部ファイル変更通知を受けたときに使用する。 */
export function invalidateMasterDataFileCaches(): void {
    for (const filename of Array.from(fileCache.keys())) {
        if (filename.startsWith('schema/') || filename.startsWith('data/')) {
            fileCache.delete(filename);
        }
    }
    dirCache.delete('schema');
    dirCache.delete('data');
}

/**
 * ファイルから文字列データを読み込む（汎用API）
 * キャッシュにヒットすればC#への問い合わせをスキップする。
 */
export async function readFileAsync(filename: string, options: FileScopeOptions = {}): Promise<string> {
    const startTime = performance.now();
    const cacheKey = getFileCacheKey(filename, options);
    const requestData = createFileRequestData(filename, options);
    const cached = fileCache.get(cacheKey);
    if (cached !== undefined) {
        if (tracker !== false) {
            tracker.recordCacheHit('read_file', startTime, createCacheDebugDetail('read_file', requestData, cached));
        }
        return cached;
    }
    const result = await postMessageAsync<string>('read_file', requestData);
    fileCache.set(cacheKey, result);
    return result;
}

interface File {
    name: string;
    type: 'file' | 'directory';
}

/**
 * ファイルを削除する（汎用API）
 * 削除後にキャッシュからも除去する。
 */
export async function deleteFileAsync(filename: string): Promise<void> {
    await postMessageAsync('delete_file', { filename });
    fileCache.delete(filename);
    if (affectsGitStatus(filename)) invalidateGitStatusCache();
}

/**
 * 指定したディレクトリ以下のファイル一覧を列挙する
 * キャッシュにヒットすればC#への問い合わせをスキップする。
 */
export async function findFilesAsync(directory: string): Promise<File[]> {
    const startTime = performance.now();
    const cached = dirCache.get(directory);
    if (cached !== undefined) {
        if (tracker !== false) {
            tracker.recordCacheHit('find_files', startTime, createCacheDebugDetail('find_files', { directory }, cached));
        }
        return cached;
    }
    const result = await postMessageAsync<File[]>('find_files', { directory });
    dirCache.set(directory, result);
    return result;
}

/**
 * git status で変更されたCSVファイルの一覧
 * isNew: true のとき新規ファイル（??ステータス）。HEAD版CSVが存在しないため git show を呼ばない
 */
export interface GitStatusEntry {
    path: string;
    tableName: string;
    isNew: boolean;
}

/**
 * git status レスポンス
 */
export interface GitStatusResult {
    changes: GitStatusEntry[];
    staged: GitStatusEntry[];
}

// =========================================================================
// git status キャッシュ
// ファイル書き込み・git操作で無効化し、それ以外はキャッシュを返す。
// =========================================================================
let gitStatusCache: GitStatusResult | false = false;
let gitStatusInFlight: Promise<GitStatusResult> | false = false;
let gitStatusRevision = 0;

/** git status キャッシュを無効化する。writeFileAsync / git操作 / ファイルウォッチャー / gitアイコンクリック後に呼ばれる。 */
export function invalidateGitStatusCache(): void {
    gitStatusCache = false;
    gitStatusInFlight = false;
    gitStatusRevision++;
}

/**
 * git status を実行し、変更ファイル・ステージ済みファイルの一覧を返す。
 * キャッシュにヒットすればC#への問い合わせをスキップする。
 */
export async function gitStatusAsync(): Promise<GitStatusResult> {
    const startTime = performance.now();
    if (gitStatusCache !== false) {
        if (tracker !== false) {
            tracker.recordCacheHit('git_status', startTime, createCacheDebugDetail('git_status', {}, gitStatusCache));
        }
        return gitStatusCache;
    }
    if (gitStatusInFlight !== false) return gitStatusInFlight;
    const revision = gitStatusRevision;
    gitStatusInFlight = postMessageAsync<GitStatusResult>('git_status', {})
        .then((result) => {
            if (revision === gitStatusRevision) gitStatusCache = result;
            return result;
        })
        .finally(() => {
            if (revision === gitStatusRevision) gitStatusInFlight = false;
        });
    return gitStatusInFlight;
}

// =========================================================================
// git show キャッシュ
// パスごとにHEAD版の内容をキャッシュする。
// ファイルウォッチャー・git操作で全無効化し、差分ビュー表示時はキャッシュをバイパスする。
// =========================================================================
const gitShowCache = new Map<string, string>();

/** git show キャッシュを全無効化する。ファイルウォッチャー / git操作後に呼ばれる。 */
export function invalidateGitShowCache(): void {
    gitShowCache.clear();
}

/**
 * git show HEAD:path でHEAD時点のファイル内容を返す。
 * キャッシュにヒットすればC#への問い合わせをスキップする。
 */
export async function gitShowAsync(path: string): Promise<string> {
    const startTime = performance.now();
    const cached = gitShowCache.get(path);
    if (cached !== undefined) {
        if (tracker !== false) {
            tracker.recordCacheHit('git_show', startTime, createCacheDebugDetail('git_show', { path }, cached));
        }
        return cached;
    }
    const result = await postMessageAsync<string>('git_show', { path });
    gitShowCache.set(path, result);
    return result;
}

/**
 * git show HEAD:path でHEAD時点のファイル内容を返す。キャッシュをバイパスして常にC#へ問い合わせる。
 * 差分ビュー表示時に使用する。取得結果でキャッシュを更新する。
 */
export async function gitShowFreshAsync(path: string): Promise<string> {
    const result = await postMessageAsync<string>('git_show', { path });
    gitShowCache.set(path, result);
    return result;
}

/**
 * git add でファイルをステージする
 */
export async function gitAddAsync(path: string): Promise<void> {
    await postMessageAsync('git_add', { path });
    invalidateGitStatusCache();
    invalidateGitShowCache();
}

/**
 * git reset でファイルをアンステージする
 */
export async function gitResetAsync(path: string): Promise<void> {
    await postMessageAsync('git_reset', { path });
    invalidateGitStatusCache();
    invalidateGitShowCache();
}

/**
 * git checkout -- でファイルの変更を破棄する
 */
export async function gitDiscardAsync(path: string): Promise<void> {
    await postMessageAsync('git_discard', { path });
    invalidateGitStatusCache();
    invalidateGitShowCache();
}

// =========================================================================
// git blame / git log
// 変更履歴・監査ログ機能で使用する。キャッシュは持たない（都度取得）。
// =========================================================================

/** git blame の1行分のエントリ */
export interface BlameEntry {
    lineNumber: number;
    author: string;
    date: string;
    commitHash: string;
    commitMessage: string;
}

/** git log の1コミット分のエントリ */
export interface LogEntry {
    commitHash: string;
    author: string;
    date: string;
    message: string;
}

/**
 * git blame でファイルの各行の著者・日付・コミット情報を取得する
 */
export async function gitBlameAsync(filename: string): Promise<BlameEntry[]> {
    return postMessageAsync<BlameEntry[]>('git_blame', { filename });
}

/**
 * git log でファイルのコミット履歴を取得する
 * @param filename 対象ファイルパス
 * @param limit 取得するコミット数の上限
 */
export async function gitLogAsync(filename: string, limit: number): Promise<LogEntry[]> {
    return postMessageAsync<LogEntry[]>('git_log', { filename, limit });
}

/**
 * git show commit:path で任意コミット時点のファイル内容を返す。
 * バージョン比較機能で使用する。キャッシュは持たない（都度取得）。
 * @param commit コミットハッシュ（~N サフィックスも可）
 * @param path ファイルパス
 */
export async function gitShowAtCommitAsync(commit: string, path: string): Promise<string> {
    return postMessageAsync<string>('git_show_at_commit', { commit, path });
}


/**
 * リクエストIDカウンター
 * 各リクエストにユニークIDを付与し、レスポンスをIDで照合する。
 * これにより同じ種類のリクエストを並列に送信しても取り違えが起きない。
 */
let nextRequestId = 1;

function postMessageAsync<T>(
    apiName: string,
    requestData: Record<string, unknown>
): Promise<T> {
    const detail = createApiDebugDetail(apiName, requestData);
    const promise = sendRequest<T>(apiName, requestData, detail);
    // トラッカーが設定されている場合はバックグラウンドタスクとして追跡する
    if (tracker !== false) {
        return tracker.trackAsync(apiName, promise, detail);
    }
    return promise;
}

function sendRequest<T>(
    apiName: string,
    requestData: Record<string, unknown>,
    detail: DebugConsoleEntryDetail
): Promise<T> {
    const requestId = detail.requestId || String(nextRequestId++);
    const requestMessage = {
        type: `${apiName}_request`,
        requestId,
        ...requestData
    };
    detail.request = requestMessage;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.chrome.webview.removeEventListener('message', responseHandler);
            const errorMessage = `${apiName} timeout (requestId=${requestId})`;
            const response = {
                type: `${apiName}_response`,
                requestId,
                success: false,
                error: errorMessage,
            };
            detail.response = response;
            detail.error = errorMessage;
            detail.completedAt = new Date().toISOString();
            writeApiLog('response', apiName, requestId, response);
            reject(new Error(errorMessage));
        }, 10000);

        const responseHandler = (event: MessageEvent) => {
            try {
                const responseData = JSON.parse(event.data);
                // リクエストIDで照合する。IDが一致しないメッセージは無視して待ち続ける。
                if (!responseData || responseData.type !== `${apiName}_response` || responseData.requestId !== requestId) {
                    return;
                }

                clearTimeout(timeout);
                window.chrome.webview.removeEventListener('message', responseHandler);
                detail.response = responseData;
                detail.completedAt = new Date().toISOString();
                if (!responseData.success) {
                    detail.error = (responseData.error as string) || `${apiName} failed`;
                }
                writeApiLog('response', apiName, requestId, responseData);

                if (responseData.success) {
                    resolve(responseData.data as T);
                } else {
                    reject(new Error((responseData.error as string) || `${apiName} failed`));
                }

            } catch (error) {
                clearTimeout(timeout);
                window.chrome.webview.removeEventListener('message', responseHandler);
                const errorMessage = error instanceof Error ? error.message : String(error);
                const response = {
                    type: `${apiName}_response`,
                    requestId,
                    success: false,
                    error: errorMessage,
                };
                detail.response = response;
                detail.error = errorMessage;
                detail.completedAt = new Date().toISOString();
                writeApiLog('response', apiName, requestId, response);
                reject(error);
            }
        };

        try {
            window.chrome.webview.addEventListener('message', responseHandler);
            writeApiLog('request', apiName, requestId, requestMessage);
            window.chrome.webview.postMessage(JSON.stringify(requestMessage));
        } catch (error) {
            clearTimeout(timeout);
            const errorMessage = error instanceof Error ? error.message : String(error);
            const response = {
                type: `${apiName}_response`,
                requestId,
                success: false,
                error: errorMessage,
            };
            detail.response = response;
            detail.error = errorMessage;
            detail.completedAt = new Date().toISOString();
            writeApiLog('response', apiName, requestId, response);
            reject(error);
        }
    });
}

function createApiDebugDetail(apiName: string, requestData: Record<string, unknown>): DebugConsoleEntryDetail {
    return {
        apiName: createApiDebugLabel(apiName, requestData, false),
        requestId: String(nextRequestId++),
        request: {},
        startedAt: new Date().toISOString(),
    };
}

function createCacheDebugDetail<T>(
    apiName: string,
    requestData: Record<string, unknown>,
    data: T
): DebugConsoleEntryDetail {
    const requestId = String(nextRequestId++);
    return {
        apiName: createApiDebugLabel(apiName, requestData, true),
        requestId,
        request: {
            type: `${apiName}_request`,
            requestId,
            ...requestData,
        },
        response: {
            type: `${apiName}_response`,
            requestId,
            success: true,
            cache: true,
            data,
        },
        startedAt: new Date().toISOString(),
    };
}

function createApiDebugLabel(apiName: string, requestData: Record<string, unknown>, cache: boolean): string {
    const target = getApiDebugTarget(apiName, requestData);
    const label = target === false ? apiName : `${apiName} (${target})`;
    return cache ? `${label} (cache)` : label;
}

function getApiDebugTarget(apiName: string, requestData: Record<string, unknown>): string | false {
    if (apiName === 'read_file' || apiName === 'write_file') {
        const filename = getDebugString(requestData.filename);
        const scope = getDebugString(requestData.scope);
        if (filename === false) return false;
        return scope === false || scope === 'workspace' ? filename : `${scope}:${filename}`;
    }
    if (apiName === 'find_files' || apiName === 'read_files') {
        return getDebugString(requestData.directory);
    }
    return false;
}

function getDebugString(value: unknown): string | false {
    return typeof value === 'string' && value.length > 0 ? value : false;
}

function writeApiLog(phase: 'request' | 'response', apiName: string, requestId: string, payload: unknown): void {
    console.info(`[API ${phase}] ${apiName} requestId=${requestId} ${safeStringify(payload)}`);
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(error);
    }
}

function serializeWriteFileData(data: WriteFileData): string {
    if (typeof data === 'string') return data;
    return stringifyJsonForFile(data);
}
