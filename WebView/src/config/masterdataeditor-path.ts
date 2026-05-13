/**
 * アプリ設定ファイルの保存先
 * CSVマスターデータ（data/）とは分離する。
 * Workspace に保存するのは settings.json のみで、その他は User スコープで同じ相対パスを使う。
 */
export const MASTER_DATA_EDITOR_DIRECTORY = '.masterdataeditor';
export const BOOKMARKS_FILE = `${MASTER_DATA_EDITOR_DIRECTORY}/bookmarks.json`;
export const ER_DIAGRAM_LAYOUT_FILE = `${MASTER_DATA_EDITOR_DIRECTORY}/er-diagram-layout.json`;
export const SETTINGS_FILE = `${MASTER_DATA_EDITOR_DIRECTORY}/settings.json`;
export const UI_STATE_FILE = `${MASTER_DATA_EDITOR_DIRECTORY}/ui-state.json`;

const USER_FILE_OPTIONS = {scope: 'user' as const};

export const BOOKMARKS_FILE_OPTIONS = USER_FILE_OPTIONS;
export const ER_DIAGRAM_LAYOUT_FILE_OPTIONS = USER_FILE_OPTIONS;
export const UI_STATE_FILE_OPTIONS = USER_FILE_OPTIONS;
