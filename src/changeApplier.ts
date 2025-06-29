import * as fs from 'fs/promises';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { FileChange } from './aiService'; // Import FileChange interface

export interface ChangeDetail {
    file: string;
    description: string;
    fullPath: string;
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
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        textNodeName: "content",
        cdataPropName: "content",
        allowBooleanAttributes: true
    });

    try {
        const jsonObj = parser.parse(xmlString);
        const changes = jsonObj.changes?.change;
        if (!changes) {
            console.log('No valid changes found in XML.');
            return appliedChanges;
        }

        const changesArray: any[] = Array.isArray(changes) ? changes : [changes];

        for (const change of changesArray) {
            const fileChange: FileChange = {
                type: change.type || 'update',
                file: change.file,
                description: change.description,
                content: change.content
            };

            if (!fileChange.file) {
                console.warn('Skipping invalid change element (missing file path):', change);
                continue;
            }

            const fullPath = path.join(baseDirectory, fileChange.file);

            try {
                if (fileChange.type === 'delete') {
                    // Check if file exists before attempting to delete
                    try {
                        await fs.access(fullPath);
                        await fs.unlink(fullPath);
                        console.log(`Deleted file: ${fullPath}`);
                    } catch (accessError) {
                        console.warn(`File not found for deletion, skipping: ${fullPath}`);
                    }
                } else { // 'update'
                    if (fileChange.content === undefined) {
                        console.warn(`Skipping change for ${fileChange.file} due to missing content for 'update' operation.`);
                        continue;
                    }
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, fileChange.content, 'utf-8');
                }
                
                appliedChanges.push({
                    file: fileChange.file,
                    description: fileChange.description,
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