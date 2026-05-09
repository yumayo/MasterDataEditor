/**
 * description から表示用1行目を取得する。
 * \n で分割して1行目が空文字の場合や description 自体が空の場合は null を返す。
 */
export function extractFirstLineFromDescription(description: string): string | null {
    const firstLine = description.split('\n')[0];
    return firstLine !== '' ? firstLine : null;
}
