import * as ts from 'typescript';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface DiagnosticInfo {
  filePath: string;
  lineNumber: number;
  message: string;
  lineText: string;
}

async function getAllTsFiles(dir: string): Promise<string[]> {
  let files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        files = files.concat(await getAllTsFiles(fullPath));
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function getProjectDiagnostics(projectDir: string): Promise<DiagnosticInfo[]> {
  const tsFiles = await getAllTsFiles(projectDir);
  if (tsFiles.length === 0) {
    return [];
  }

  const program = ts.createProgram(tsFiles, {
    noEmit: true,
    jsx: ts.JsxEmit.React, // Basic config to support JSX
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
    allowSyntheticDefaultImports: true,
  });

  const allDiagnostics = ts.getPreEmitDiagnostics(program);
  const diagnosticInfos: DiagnosticInfo[] = [];

  for (const diagnostic of allDiagnostics) {
    if (diagnostic.file && diagnostic.start) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      const sourceLine = diagnostic.file.text.split('\n')[line];
      
      diagnosticInfos.push({
        filePath: path.relative(projectDir, diagnostic.file.fileName).replace(/\\/g, '/'),
        lineNumber: line + 1,
        message,
        lineText: sourceLine.trim(),
      });
    }
  }

  return diagnosticInfos;
}