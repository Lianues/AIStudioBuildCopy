/**
 * Extracts XML content from a string that contains a ```xml ... ``` block.
 * @param text The text containing the XML block.
 * @returns The extracted XML string, or an empty string if not found.
 */
export function extractXml(text: string): string {
    if (text.startsWith('<')) {
        return text;
    }
    const match = text.match(/```xml\n([\s\S]*?)```/);
    return match ? match[1].trim() : '';
}