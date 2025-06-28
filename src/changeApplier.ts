import * as fs from 'fs/promises';
import * as path from 'path';
import * as xmljs from 'xml-js';

export interface ChangeDetail {
    file: string;
    description: string;
    fullPath: string;
}

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
 * @returns A promise that resolves to an array of change details.
 */
export async function applyChanges(xmlString: string, baseDirectory: string): Promise<ChangeDetail[]> {
    const appliedChanges: ChangeDetail[] = [];
    try {
        const parsedXml = xmljs.xml2js(xmlString, { compact: false, cdataKey: 'text' }) as ChangesDocument;
        const rootElement = parsedXml.elements[0];
        const changeElements = rootElement.elements || [];

        if (rootElement.name !== 'changes' || changeElements.length === 0) {
            console.log('No valid changes found in XML.');
            return appliedChanges;
        }

        for (const change of changeElements) {
            const fileElement = change.elements?.find(e => e.name === 'file');
            const descriptionElement = change.elements?.find(e => e.name === 'description');
            const contentElement = change.elements?.find(e => e.name === 'content');

            const filePath = fileElement?.elements?.[0]?.text;
            const description = descriptionElement?.elements?.[0]?.text ?? 'No description provided.';
            const content = contentElement?.elements?.[0]?.text;

            if (change.type !== 'element' || change.name !== 'change' || !filePath || !content) {
                console.warn('Skipping invalid change element:', change);
                continue;
            }
            const fullPath = path.join(baseDirectory, filePath);

            try {
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, content, 'utf-8');
                
                appliedChanges.push({
                    file: filePath,
                    description: description,
                    fullPath: fullPath,
                });

            } catch (fileError) {
                console.error(`Failed to apply change to file: ${fullPath}`, fileError);
            }
        }
    } catch (error) {
        console.error('Failed to parse XML or apply changes:', error);
        throw error; // Re-throw the error to be handled by the caller
    }
    return appliedChanges;
}