import { promises as fs } from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';

/**
 * Recursively reads all files in a directory and returns their relative paths and content.
 * @param dir The directory to read.
 * @param projectDir The root project directory for calculating relative paths.
 * @param ignorePatterns An array of glob patterns to ignore.
 * @returns A promise that resolves to an array of objects with path and content.
 */
async function readFilesRecursively(dir: string, projectDir: string, ignorePatterns: string[]): Promise<{ filePath: string; content: string }[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });

    const filePromises = dirents.map(async (dirent) => {
        const res = path.resolve(dir, dirent.name);
        const relativePath = path.relative(projectDir, res).replace(/\\/g, '/');

        if (relativePath === '') {
            return null;
        }

        const isIgnored = ignorePatterns.some(pattern => minimatch(relativePath, pattern, { dot: true }));

        if (isIgnored) {
            return null; // This file or directory is ignored.
        }

        if (dirent.isDirectory()) {
            return readFilesRecursively(res, projectDir, ignorePatterns);
        } else {
            const content = await fs.readFile(res, 'utf-8');
            return { filePath: relativePath, content };
        }
    });

    const results = await Promise.all(filePromises);

    // Flatten the array of arrays and remove nulls.
    return results.flat().filter(Boolean) as { filePath: string; content: string }[];
}


/**
 * Reads all files in a project directory and formats their content into a single summary string.
 * @param projectDir The path to the project directory.
 * @returns A promise that resolves to the formatted project summary string and a map of file contents.
 */
export async function createProjectSummary(projectDir: string): Promise<{ summary: string; includedFiles: string[]; fileContentsMap: { [filePath: string]: string } }> {
    let ignorePatterns: string[] = [];
    try {
        const ignoreFilePath = path.join(projectDir, '.aiignore');
        const ignoreFileContent = await fs.readFile(ignoreFilePath, 'utf-8');
        
        ignorePatterns = ignoreFileContent.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '' && !line.startsWith('#'))
            .flatMap(pattern => {
                // Handle gitignore-style patterns.
                // See: https://git-scm.com/docs/gitignore
                if (pattern.startsWith('/')) {
                    // Anchored to project root. Remove leading slash for minimatch on relative paths.
                    pattern = pattern.substring(1);
                } else if (!pattern.includes('/')) {
                    // Not anchored, matches anywhere in the project.
                    pattern = `**/${pattern}`;
                }

                if (pattern.endsWith('/')) {
                    // Directory-only pattern. Match the directory itself and its contents.
                    const base = pattern.slice(0, -1);
                    return [base, `${base}/**`];
                }
                
                return [pattern];
            });

    } catch (error) {
        // .aiignore not found or other read error, proceed with no ignore patterns.
    }

    try {
        const files = await readFilesRecursively(projectDir, projectDir, ignorePatterns);
        const includedFiles: string[] = [];
        const fileContentsMap: { [filePath: string]: string } = {};

        const summaryBlocks = files.map(file => {
            if (file) {
                includedFiles.push(file.filePath);
                fileContentsMap[file.filePath] = file.content; // 存储文件内容
                return `--- START OF FILE ${file.filePath} ---\n${file.content}`;
            }
            return null;
        }).filter(block => block !== null);

        let summary = summaryBlocks.join('\n\n');
        if (summary) {
            summary = `These are the existing files in the app:\n` + summary;
        }

        return { summary, includedFiles, fileContentsMap };
    } catch (error) {
        console.error(`为目录 "${projectDir}" 创建项目摘要时出错:`, error);
        return { summary: '', includedFiles: [], fileContentsMap: {} };
    }
}