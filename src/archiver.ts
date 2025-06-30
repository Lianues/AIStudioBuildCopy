import { promises as fs } from 'fs';
import * as path from 'path';
import ignore from 'ignore';

async function getIgnoreInstance(projectDir: string): Promise<any> {
    const ig = ignore();
    const filesToRead = ['.aiignore', '.gitignore'];
    
    for (const file of filesToRead) {
        try {
            const ignoreFilePath = path.join(projectDir, file);
            const ignoreFileContent = await fs.readFile(ignoreFilePath, 'utf-8');
            ig.add(ignoreFileContent);
        } catch (error) {
            // Ignore if file doesn't exist
        }
    }
    return ig;
}

async function listFiles(dir: string, projectDir: string, ig: any): Promise<string[]> {
    const files: string[] = [];
    try {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        for (const dirent of dirents) {
            const absolutePath = path.resolve(dir, dirent.name);
            const relativePath = path.relative(projectDir, absolutePath).replace(/\\/g, '/');

            if (relativePath === '' || ig.ignores(relativePath)) {
                continue;
            }

            if (dirent.isDirectory()) {
                files.push(...await listFiles(absolutePath, projectDir, ig));
            } else {
                files.push(relativePath);
            }
        }
    } catch (error) {
        // Ignore errors
    }
    return files;
}

async function getLatestBackupDir(backupRoot: string): Promise<string | null> {
    try {
        const dirents = await fs.readdir(backupRoot, { withFileTypes: true });
        const backupDirs = dirents
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .sort()
            .reverse();
        return backupDirs.length > 0 ? path.join(backupRoot, backupDirs[0]) : null;
    } catch (error) {
        return null;
    }
}

async function areDirectoriesEqual(projectPath: string, backupPath: string, projectFiles: string[]): Promise<boolean> {
    try {
        const backupIg = ignore();
        const backupFiles = await listFiles(backupPath, backupPath, backupIg);

        const sortedProjectFiles = [...projectFiles].sort();
        const sortedBackupFiles = [...backupFiles].sort();

        if (sortedProjectFiles.length !== sortedBackupFiles.length || JSON.stringify(sortedProjectFiles) !== JSON.stringify(sortedBackupFiles)) {
            return false;
        }

        for (const file of sortedProjectFiles) {
            const projectFilePath = path.join(projectPath, file);
            const backupFilePath = path.join(backupPath, file);
            const projectFileContent = await fs.readFile(projectFilePath, 'utf-8');
            const backupFileContent = await fs.readFile(backupFilePath, 'utf-8');
            if (projectFileContent !== backupFileContent) {
                return false;
            }
        }
        return true;
    } catch (error) {
        return false;
    }
}

export async function createBackup(projectPath: string, backupFolderName: string): Promise<{created: boolean, folderName: string | null}> {
    const backupRoot = path.join(path.dirname(projectPath), 'backups');
    const ig = await getIgnoreInstance(projectPath);
    const filesToBackup = await listFiles(projectPath, projectPath, ig);
    
    const latestBackupDir = await getLatestBackupDir(backupRoot);

    if (latestBackupDir) {
        const isEqual = await areDirectoriesEqual(projectPath, latestBackupDir, filesToBackup);
        if (isEqual) {
            console.log("No changes detected. Skipping backup.");
            return { created: false, folderName: null };
        }
    }

    const backupDir = path.join(backupRoot, backupFolderName);
    try {
        await fs.mkdir(backupDir, { recursive: true });

        for (const file of filesToBackup) {
            const sourcePath = path.join(projectPath, file);
            const destPath = path.join(backupDir, file);
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.copyFile(sourcePath, destPath);
        }
        console.log(`Backup created successfully at: ${backupDir}`);
        return { created: true, folderName: backupFolderName };
    } catch (error) {
        console.error(`Failed to create backup:`, error);
        return { created: false, folderName: null };
    }
}

export async function restoreBackup(projectPath: string, backupFolderName: string): Promise<void> {
    const backupRoot = path.join(path.dirname(projectPath), 'backups');
    const backupDir = path.join(backupRoot, backupFolderName);
    const ig = await getIgnoreInstance(projectPath);

    const currentFiles = await listFiles(projectPath, projectPath, ig);
    for (const file of currentFiles) {
        try {
            await fs.unlink(path.join(projectPath, file));
        } catch (e) {
            // ignore error
        }
    }

    const backupIg = ignore();
    const backupFiles = await listFiles(backupDir, backupDir, backupIg);
    for (const file of backupFiles) {
        const sourcePath = path.join(backupDir, file);
        const destPath = path.join(projectPath, file);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(sourcePath, destPath);
    }
    console.log(`Project restored from backup: ${backupFolderName}`);
}