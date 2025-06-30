import { promises as fs } from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';

export interface TreeNode {
    name: string;
    type: 'file' | 'directory';
    children?: TreeNode[];
    path: string;
}

export async function getFileContent(absolutePath: string): Promise<string> {
    const content = await fs.readFile(absolutePath, 'utf-8');
    return content;
}

function buildFileTree(nodes: { path: string, type: 'file' | 'directory' }[]): TreeNode[] {
    const root: TreeNode = { name: 'root', type: 'directory', children: [], path: '' };
    nodes.sort((a, b) => a.path.localeCompare(b.path));
    for (const node of nodes) {
        const parts = node.path.split('/');
        let currentNode = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const currentPath = parts.slice(0, i + 1).join('/');
            let childNode = currentNode.children?.find(child => child.name === part);
            if (!childNode) {
                const isLastPart = i === parts.length - 1;
                const type = isLastPart ? node.type : 'directory';
                childNode = {
                    name: part,
                    type: type,
                    path: currentPath,
                    ...(type === 'directory' ? { children: [] } : {}),
                };
                currentNode.children?.push(childNode);
            }
            currentNode = childNode;
        }
    }
    return root.children || [];
}

async function getIgnorePatterns(projectDir: string): Promise<string[]> {
    try {
        const ignoreFilePath = path.join(projectDir, '.aiignore');
        const ignoreFileContent = await fs.readFile(ignoreFilePath, 'utf-8');
        return ignoreFileContent.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '' && !line.startsWith('#'))
            .flatMap(pattern => {
                if (pattern.startsWith('/')) {
                    pattern = pattern.substring(1);
                } else if (!pattern.includes('/')) {
                    pattern = `**/${pattern}`;
                }
                if (pattern.endsWith('/')) {
                    const base = pattern.slice(0, -1);
                    return [base, `${base}/**`];
                }
                return [pattern];
            });
    } catch (error) {
        return [];
    }
}

async function listFilesRecursively(dir: string, projectDir: string, ignorePatterns: string[]): Promise<{ path: string; type: 'file' | 'directory' }[]> {
    let entries: { path: string; type: 'file' | 'directory' }[] = [];
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
        const res = path.resolve(dir, dirent.name);
        const relativePath = path.relative(projectDir, res).replace(/\\/g, '/');
        if (relativePath === '' || ignorePatterns.some(pattern => minimatch(relativePath, pattern, { dot: true }))) {
            continue;
        }
        const type = dirent.isDirectory() ? 'directory' : 'file';
        entries.push({ path: relativePath, type });
        if (dirent.isDirectory()) {
            const nestedEntries = await listFilesRecursively(res, projectDir, ignorePatterns);
            entries = entries.concat(nestedEntries);
        }
    }
    return entries;
}

function sortTreeNodes(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') {
            return -1;
        }
        if (a.type === 'file' && b.type === 'directory') {
            return 1;
        }
        return a.name.localeCompare(b.name);
    });

    for (const node of nodes) {
        if (node.type === 'directory' && node.children) {
            sortTreeNodes(node.children);
        }
    }
}

export async function getProjectStructure(projectDir: string): Promise<TreeNode[]> {
    const ignorePatterns = await getIgnorePatterns(projectDir);
    const nodes = await listFilesRecursively(projectDir, projectDir, ignorePatterns);
    const tree = buildFileTree(nodes);
    sortTreeNodes(tree);
    return tree;
}

async function readFilesRecursivelyForSummary(dir: string, projectDir: string, ignorePatterns: string[]): Promise<{ filePath: string; content: string }[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const filePromises = dirents.map(async (dirent) => {
        const res = path.resolve(dir, dirent.name);
        const relativePath = path.relative(projectDir, res).replace(/\\/g, '/');
        if (relativePath === '' || ignorePatterns.some(pattern => minimatch(relativePath, pattern, { dot: true }))) {
            return null;
        }
        if (dirent.isDirectory()) {
            return readFilesRecursivelyForSummary(res, projectDir, ignorePatterns);
        } else {
            const content = await getFileContent(res);
            return { filePath: relativePath, content };
        }
    });
    const results = await Promise.all(filePromises);
    return results.flat().filter(Boolean) as { filePath: string; content: string }[];
}

export async function createProjectSummary(projectDir: string, log: boolean = true): Promise<{ summary: string; includedFiles: string[]; fileContentsMap: { [filePath: string]: string } }> {
    const ignorePatterns = await getIgnorePatterns(projectDir);
    try {
        const files = await readFilesRecursivelyForSummary(projectDir, projectDir, ignorePatterns);
        const includedFiles: string[] = [];
        const fileContentsMap: { [filePath: string]: string } = {};
        const summaryBlocks = files.map(file => {
            if (file) {
                includedFiles.push(file.filePath);
                fileContentsMap[file.filePath] = file.content;
                return `--- START OF FILE ${file.filePath} ---\n${file.content}`;
            }
            return null;
        }).filter(block => block !== null);
        let summary = summaryBlocks.join('\n\n');
        if (summary) {
            summary = `These are the existing files in the app:\n` + summary;
        }
        if (log) {
            console.log('--- Project Files ---');
            includedFiles.forEach(file => console.log(file));
            console.log('--------------------');
        }
        return { summary, includedFiles, fileContentsMap };
    } catch (error) {
        console.error(`为目录 "${projectDir}" 创建项目摘要时出错:`, error);
        return { summary: '', includedFiles: [], fileContentsMap: {} };
    }
}