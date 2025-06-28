/**
 * Extracts XML content from a string that contains a ```xml ... ``` block.
 * @param text The text containing the XML block.
 * @returns The extracted XML string, or an empty string if not found.
 */
export function extractXml(text: string): string {
    const match = text.match(/<changes>[\s\S]*?<\/changes>/);
    return match ? match[0].trim() : '';
}