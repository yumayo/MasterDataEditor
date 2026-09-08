/** Gitが解決できるコミットIDの形式。短縮形は4桁以上、SHA-256は最大64桁。存在と一意性はGit側で検証する。 */
export function isCommitId(value: string): boolean {
    return /^[0-9a-fA-F]{4,64}$/.test(value);
}
