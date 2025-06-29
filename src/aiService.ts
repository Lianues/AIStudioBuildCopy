/**
 * Extracts XML content from a string that contains a ```xml ... ``` block.
 * @param text The text containing the XML block.
 * @returns The extracted XML string, or an empty string if not found.
 */
import { XMLParser } from 'fast-xml-parser';

/**
 * Extracts XML content from a string that contains a ```xml ... ``` block.
 * @param text The text containing the XML block.
 * @returns The extracted XML string, or an empty string if not found.
 */
export function extractXml(text: string): string {
    const match = text.match(/<changes>[\s\S]*?<\/changes>/);
    return match ? match[0].trim() : '';
}

export interface FileChange {
    type: 'update' | 'delete';
    file: string;
    description: string;
    content?: string; // Content is optional, especially for delete operations
}

/**
 * Parses the XML content and extracts file changes.
 * @param xmlString The XML string containing file changes.
 * @returns An array of FileChange objects.
 */
export function parseXmlChanges(xmlString: string): FileChange[] {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "", // No prefix for attributes
        // Stop parsing at the 'content' node to treat its value as a raw string.
        // This robustly handles CDATA and mixed content.
        stopNodes: ["changes.change.content"],
    });

    const jsonObj = parser.parse(xmlString);
    const changes = jsonObj.changes.change;
    if (!changes) return [];

    const changesArray = Array.isArray(changes) ? changes : [changes];

    return changesArray.map((change: any) => {
        // Default type to 'update' if not specified
        const type = change.type || 'update';
        
        // With the stopNodes option, change.content is now guaranteed to be a string,
        // so the complex object check is no longer needed.
        const contentValue = change.content;

        const fileChange: FileChange = {
            type: type,
            file: change.file,
            description: change.description,
        };

        if (contentValue !== undefined) {
            fileChange.content = String(contentValue);
        }

        return fileChange;
    });
}