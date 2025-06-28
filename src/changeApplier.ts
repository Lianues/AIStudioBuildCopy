import * as fs from 'fs/promises';
import * as path from 'path';
import * as xmljs from 'xml-js';

interface XmlElement {
    type: 'element' | 'text';
    name?: string;
    attributes?: { [key: string]: string };
    elements?: XmlElement[];
    text?: string;
}

interface ChangesDocument {
    elements: [XmlElement];
}

/**
 * Parses an XML string containing file modification instructions and applies them to the file system.
 *
 * @param xmlString The XML string with change instructions.
 * @param baseDirectory The base directory where changes will be applied.
 */
export async function applyChanges(xmlString: string, baseDirectory: string): Promise<void> {
    try {
        const parsedXml = xmljs.xml2js(xmlString, { compact: false, cdataKey: 'text' }) as ChangesDocument;
        const rootElement = parsedXml.elements[0];
        const changeElements = rootElement.elements || [];

        if (rootElement.name !== 'changes' || changeElements.length === 0) {
            console.log('No valid changes found in XML.');
            return;
        }

        for (const change of changeElements) {
            const fileElement = change.elements?.find(e => e.name === 'file');
            const contentElement = change.elements?.find(e => e.name === 'content');

            const filePath = change.attributes?.file ?? fileElement?.elements?.[0]?.text;
            const content = contentElement?.elements?.[0]?.text ?? change.elements?.[0]?.text;

            if (change.type !== 'element' || change.name !== 'change' || !filePath || !content) {
                console.warn('Skipping invalid change element:', change);
                continue;
            }
            const fullPath = path.join(baseDirectory, filePath);

            try {
                // Ensure the parent directory exists
                const dirName = path.dirname(fullPath);
                await fs.mkdir(dirName, { recursive: true });

                // Write the file
                await fs.writeFile(fullPath, content, 'utf-8');
                console.log(`Successfully applied change to: ${fullPath}`);

            } catch (fileError) {
                console.error(`Failed to apply change to file: ${fullPath}`, fileError);
            }
        }
    } catch (error) {
        console.error('Failed to parse XML or apply changes:', error);
        throw error; // Re-throw the error to be handled by the caller
    }
}