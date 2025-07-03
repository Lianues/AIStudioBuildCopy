import * as fs from 'fs/promises';
import * as path from 'path';
import { FileChange } from './aiService';
import { createBackup } from './archiver';
import { replaceBlockByPath } from './astService';

export interface ChangeDetail {
    file: string;
    description: string;
    fullPath: string;
}

/**
 * Applies a series of file changes, using AST-based block replacement for updates.
 *
 * @param changes An array of file change instructions.
 * @param baseDirectory The base directory where changes will be applied.
 * @returns A promise that resolves to an object containing applied changes and backup info.
 */
export async function applyChanges(
    changes: FileChange[],
    baseDirectory: string
): Promise<{ appliedChanges: ChangeDetail[]; backupCreated: boolean; backupFolderName: string | null }> {
    const appliedChanges: ChangeDetail[] = [];
    let backupCreated = false;
    let backupFolderName: string | null = null;

    const fileContentCache = new Map<string, string>();

    for (const change of changes) {
        const { type, file, description, content, blockPath } = change;

        if (!file) {
            console.warn('Skipping invalid change object (missing file path):', change);
            continue;
        }

        const fullPath = path.join(baseDirectory, file);

        try {
            if (type === 'delete') {
                try {
                    await fs.access(fullPath);
                    await fs.unlink(fullPath);
                    console.log(`Deleted file: ${fullPath}`);
                } catch (accessError) {
                    console.warn(`File to delete not found, skipped: ${fullPath}`);
                }
            } else { // 'update'
                if (content === undefined) {
                    console.warn(`Skipping update for ${file} due to missing content.`);
                    continue;
                }

                // Strategy dispatch: Check for full-file vs block-based change
                if (blockPath === '$fullfile') {
                    // --- Full-file change (for non-parsable files) ---
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, content, 'utf-8');
                    fileContentCache.set(fullPath, content);

                } else if (blockPath) {
                    // --- Block-based change (for parsable files) ---
                    let originalContent = fileContentCache.get(fullPath);
                    if (originalContent === undefined) {
                        originalContent = await fs.readFile(fullPath, 'utf-8');
                        fileContentCache.set(fullPath, originalContent);
                    }
                    const newContent = replaceBlockByPath(originalContent, blockPath, content);
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, newContent, 'utf-8');
                    fileContentCache.set(fullPath, newContent);
                } else {
                    // --- Full-file change (legacy or when no block path is provided) ---
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, content, 'utf-8');
                    fileContentCache.set(fullPath, content);
                }
            }
            
            appliedChanges.push({
                file: file,
                description: description || '',
                fullPath: fullPath,
            });

        } catch (fileError) {
            console.error(`Failed to apply changes to file: ${fullPath}`, fileError);
        }
    }

    if (appliedChanges.length > 0) {
        const backupName = `${new Date().toISOString().replace(/[:.]/g, '-')}_ai_change`;
        const backupResult = await createBackup(baseDirectory, backupName);
        backupCreated = backupResult.created;
        backupFolderName = backupResult.folderName;
    }

    return { appliedChanges, backupCreated, backupFolderName };
}