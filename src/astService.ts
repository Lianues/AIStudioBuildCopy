import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { Node } from '@babel/types';

/**
 * @file This service handles all interactions with the Abstract Syntax Tree (AST).
 * It is responsible for parsing code, generating navigational paths for AI,
 * and applying block-level changes to the code based on those paths.
 */

interface CodeBlock {
    path: string;
    start: number;
    end: number;
    node: Node;
}

function parseCode(code: string) {
    return parser.parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
        attachComment: true,
    });
}


/**
 * Generates a list of unique, navigable paths for all logical code blocks in a file.
 * @param code The source code of the file.
 * @returns A string array of navigable paths (e.g., "myFunction", "$imports", "$line:42").
 */
export function getNavigationalPaths(code: string): string[] {
    const ast = parseCode(code);
    const lines = code.split('\n');
    const blocks: { path: string, startLine: number }[] = [];

    let hasImports = false;

    ast.program.body.forEach(node => {
        if (!node.loc) return;

        let path: string | null = null;
        const startLine = node.loc.start.line;

        const processDeclaration = (decl: t.Declaration | null) => {
            if (!decl) return;
            if ((t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && decl.id) {
                path = decl.id.name;
            } else if (t.isVariableDeclaration(decl)) {
                const firstDeclarator = decl.declarations[0];
                if (t.isIdentifier(firstDeclarator.id)) {
                    path = firstDeclarator.id.name;
                }
            }
        };

        if (t.isImportDeclaration(node)) {
            if (!hasImports) {
                blocks.push({ path: '$imports', startLine });
                hasImports = true;
            }
            // Don't create individual paths for each import
            return;
        } else if (t.isExportNamedDeclaration(node) && node.declaration) {
            processDeclaration(node.declaration);
        } else if (t.isDeclaration(node)) {
            processDeclaration(node);
        }
        
        // If no specific path was assigned, create a content-addressed line path
        if (path === null) {
            const lineContent = lines[startLine - 1].trim();
            // Only create paths for non-empty lines
            if (lineContent) {
                path = `$line:${startLine}:${lineContent}`;
            }
        }

        if (path) {
            blocks.push({ path, startLine });
        }
    });

    // Sort blocks by line number to ensure correct order
    blocks.sort((a, b) => a.startLine - b.startLine);
    
    // Return unique paths, preserving the sorted order
    const uniquePaths = Array.from(new Set(blocks.map(b => b.path)));
    return uniquePaths;
}

/**
 * Replaces a specific code block, identified by its unique path, with new content.
 * @param originalCode The original source code.
 * @param blockPath The unique path of the block to replace (e.g., "myFunction", "$line:42").
 * @param newBlockContent The new content for the code block.
 * @returns The modified full source code.
 */
export function replaceBlockByPath(originalCode: string, blockPath: string, newBlockContent: string): string {
    const ast = parseCode(originalCode);
    let start = -1;
    let end = -1;

    const setRange = (node: Node) => {
        const comments = node.leadingComments;
        start = comments?.[0]?.start ?? node.start!;
        end = node.end!;
    };

    if (blockPath === '$imports') {
        const importNodes = ast.program.body.filter(node => t.isImportDeclaration(node));
        if (importNodes.length > 0) {
            const firstNode = importNodes[0];
            const lastNode = importNodes[importNodes.length - 1];
            start = firstNode.start!;
            end = lastNode.end!;
        }
    } else {
        // Handle named blocks
        traverse(ast, {
            // This covers `export function/class/const`
            ExportNamedDeclaration(path) {
                const declaration = path.node.declaration;
                if (declaration) {
                    if (t.isFunctionDeclaration(declaration) && declaration.id?.name === blockPath) {
                        setRange(path.node);
                    } else if (t.isClassDeclaration(declaration) && declaration.id?.name === blockPath) {
                        setRange(path.node);
                    } else if (t.isVariableDeclaration(declaration)) {
                        const declarator = declaration.declarations.find(d => t.isIdentifier(d.id) && d.id.name === blockPath);
                        if (declarator) {
                            setRange(path.node);
                        }
                    }
                }
                if (start !== -1) path.stop();
            },
            // This covers `function myFunc() {}`
            FunctionDeclaration(path) {
                if (path.parent.type === 'Program' && path.node.id?.name === blockPath) {
                    setRange(path.node);
                    path.stop();
                }
            },
            // This covers `class MyClass {}`
            ClassDeclaration(path) {
                 if (path.parent.type === 'Program' && path.node.id?.name === blockPath) {
                    setRange(path.node);
                    path.stop();
                }
            },
            // This covers `const x = ...` at the top level
            VariableDeclaration(path) {
                if (path.parent.type === 'Program') {
                    // Find the specific declarator that matches the blockPath
                    const declarator = path.node.declarations.find(d => t.isIdentifier(d.id) && d.id.name === blockPath);
                    if (declarator) {
                        // The range is the entire declaration statement
                        setRange(path.node);
                        path.stop();
                    }
                }
            }
        });
    }

    if (start !== -1 && end !== -1) {
        return originalCode.substring(0, start) + newBlockContent + originalCode.substring(end);
    }

    // Handle $line:XX:content paths with strict validation
    if (blockPath.startsWith('$line:')) {
        const parts = blockPath.split(':');
        
        // Expects format: $line:lineNumber:content
        if (parts.length >= 3) {
            const targetLine = parseInt(parts[1], 10);
            const targetContent = parts.slice(2).join(':').trim();
            let nodeFoundOnLine: Node | null = null;
            let contentMatched = false;

            if (!isNaN(targetLine)) {
                traverse(ast, {
                    enter(path) {
                        // Find the first node that starts on the target line
                        if (path.node.loc && path.node.loc.start.line === targetLine) {
                            nodeFoundOnLine = path.node;
                            path.stop();
                        }
                    }
                });

                if (nodeFoundOnLine) {
                    const { start, end } = nodeFoundOnLine;
                    if (start != null && end != null) {
                        const nodeSource = originalCode.substring(start, end).trim();
                        if (nodeSource === targetContent) {
                            contentMatched = true;
                            setRange(nodeFoundOnLine);
                        } else {
                            console.warn(`Content mismatch for path "${blockPath}". Expected content: "${targetContent}", but found: "${nodeSource}"`);
                        }
                    }
                }
            }
             if (!contentMatched) {
                console.warn(`Strict check failed for path: "${blockPath}". Either line or content did not match.`);
             }
        }
    }

    if (start !== -1 && end !== -1) {
        // Trim leading/trailing whitespace/newlines from the replacement block
        const trimmedNewContent = newBlockContent.trim();
        // Ensure there's a newline separating the blocks
        return originalCode.substring(0, start).trimEnd() + '\n\n' + trimmedNewContent + '\n\n' + originalCode.substring(end).trimStart();
    }

    // If no block was found, return original code as a fallback.
    console.warn(`Could not find block with path: "${blockPath}". Returning original code.`);
    return originalCode;
}