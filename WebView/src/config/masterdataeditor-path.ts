/**
 * アプリ設定ファイルの保存先
 * CSVマスターデータ（data/）とは分離する。
 * Workspace には .masterdataeditor/settings.json のみを保存し、その他はワークスペース別 User データへ保存する。
 */
export const MASTER_DATA_EDITOR_DIRECTORY = '.masterdataeditor';
export const WORKSPACE_SETTINGS_FILE = `${MASTER_DATA_EDITOR_DIRECTORY}/settings.json`;
export const USER_SETTINGS_FILE = 'settings.json';
export const BOOKMARKS_FILE = 'bookmarks.json';
export const UI_STATE_FILE = 'ui-state.json';

const USER_FILE_OPTIONS = {scope: 'user' as const};

export const BOOKMARKS_FILE_OPTIONS = USER_FILE_OPTIONS;
export const UI_STATE_FILE_OPTIONS = USER_FILE_OPTIONS;
