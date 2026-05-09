export function stringifyJsonForFile(value: unknown, space = 4): string {
    const json = JSON.stringify(value, null, space);
    if (json === undefined) {
        throw new Error('Cannot stringify value as JSON');
    }
    return json.replace(/\r\n?/g, '\n') + '\n';
}
