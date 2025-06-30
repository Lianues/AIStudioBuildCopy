import * as fs from 'fs/promises';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { FileChange } from './aiService'; // Import FileChange interface
import { createBackup } from './archiver';

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
export async function applyChanges(
    changes: FileChange[],
    baseDirectory: string
): Promise<{ appliedChanges: ChangeDetail[]; backupCreated: boolean; backupFolderName: string | null }> {
    const appliedChanges: ChangeDetail[] = [];
    let backupCreated = false;
    let backupFolderName: string | null = null;

    for (const change of changes) {
        const { type, file, description, content } = change;

        if (!file) {
            console.warn('跳过无效的变更元素 (缺少文件路径):', change);
            continue;
        }

        const fullPath = path.join(baseDirectory, file);

        try {
            if (type === 'delete') {
                try {
                    await fs.access(fullPath);
                    await fs.unlink(fullPath);
                    console.log(`已删除文件: ${fullPath}`);
                } catch (accessError) {
                    console.warn(`未找到要删除的文件，已跳过: ${fullPath}`);
                }
            } else { // 'update'
                if (content === undefined) {
                    console.warn(`由于缺少 'update' 操作的内容, 跳过对 ${file} 的更改。`);
                    continue;
                }
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, content, 'utf-8');
            }
            
            appliedChanges.push({
                file: file,
                description: description,
                fullPath: fullPath,
            });

        } catch (fileError) {
            console.error(`未能将变更应用到文件: ${fullPath}`, fileError);
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