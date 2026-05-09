/**
 * ユーザー設定ファイルの保存先
 * CSVマスターデータ（data/）とは分離し、userdata/ に集約する。
 */
export const USERDATA_DIRECTORY = 'userdata';
export const BOOKMARKS_FILE = `${USERDATA_DIRECTORY}/bookmarks.json`;
export const ER_DIAGRAM_LAYOUT_FILE = `${USERDATA_DIRECTORY}/er-diagram-layout.json`;
export const SETTINGS_FILE = `${USERDATA_DIRECTORY}/settings.json`;
export const UI_STATE_FILE = `${USERDATA_DIRECTORY}/ui-state.json`;
