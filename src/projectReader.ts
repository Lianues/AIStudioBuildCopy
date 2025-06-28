import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Recursively reads all files in a directory and returns their relative paths and content.
 * @param dir The directory to read.
 * @param projectDir The root project directory for calculating relative paths.
 * @returns A promise that resolves to an array of objects with path and content.
 */
async function readFilesRecursively(dir: string, projectDir: string): Promise<{ filePath: string; content: string }[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
        dirents.map(async (dirent) => {
            const res = path.resolve(dir, dirent.name);
            if (dirent.isDirectory()) {
                return readFilesRecursively(res, projectDir);
            } else {
                const content = await fs.readFile(res, 'utf-8');
                const relativePath = path.relative(projectDir, res).replace(/\\/g, '/');
                return { filePath: relativePath, content };
            }
        })
    );
    // Flatten the array of arrays
    return Array.prototype.concat(...files);
}

/**
 * Reads all files in a project directory and formats their content into a single summary string.
 * @param projectDir The path to the project directory.
 * @returns A promise that resolves to the formatted project summary string.
 */
export async function createProjectSummary(projectDir: string): Promise<string> {
    try {
        const files = await readFilesRecursively(projectDir, projectDir);
        const summaryBlocks = files.map(file => {
            if (file) { // Check if file is not undefined
                return `These are the existing files in the app:\n--- START OF FILE ${file.filePath} ---\n${file.content}`;
            }
            return '';
        }).filter(block => block !== ''); // Filter out empty blocks
        return summaryBlocks.join('\n\n');
    } catch (error) {
        console.error(`Error creating project summary for directory "${projectDir}":`, error);
        return ''; // Return an empty string or re-throw the error as appropriate
    }
}