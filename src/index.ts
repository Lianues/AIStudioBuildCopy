require('dotenv').config();

import { createProjectSummary } from './projectReader';
import { extractXml, parseXmlChanges, FileChange } from './aiService';
import { applyChanges } from './changeApplier';
import { Command } from 'commander';
import { getMultilineInput } from './customInput';
import { GoogleGenAI } from '@google/genai';
import { promises as fs } from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import * as readline from 'readline';

interface Config {
  displayTokenConsumption?: {
    enabled: boolean;
    displayTypes: string[];
  };
  maxContextHistoryTurns?: number;
  optimizeCodeContext?: boolean; // 新增配置项
  enableStreaming?: boolean;
}

let config: Config = {}; // 全局配置变量

function parseUserMessageForFiles(messageText: string): { [filePath: string]: string } {
    const fileContentsMap: { [filePath: string]: string } = {};
    const fileBlockRegex = /--- START OF FILE (.*?) ---\n([\s\S]*?)(?=\n--- START OF FILE|\n\n---User Instruction---|$)/g;

    if (!messageText.startsWith('These are the existing files in the app:')) {
        return fileContentsMap;
    }

    let match;
    while ((match = fileBlockRegex.exec(messageText)) !== null) {
        const filePath = match[1].trim();
        const content = match[2].trim().replace(/\r\n/g, '\n');
        fileContentsMap[filePath] = content;
    }

    return fileContentsMap;
}
 
 async function loadConfig() {
   try {
     const configPath = path.join(process.cwd(), 'config.jsonc');
     const configFileContent = await fs.readFile(configPath, 'utf-8');
     const contentWithoutComments = configFileContent.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
     config = JSON.parse(contentWithoutComments);
   } catch (error: any) {
     console.error(chalk.red(`加载config.jsonc出错: ${error.message}`));
     config = {};
   }
 }

async function main() {
    await loadConfig();

    const program = new Command();
    program
        .version("1.0.0")
        .option('-d, --directory <type>', '指定项目目录', './project')
        .parse(process.argv);

    const options = program.opts();
    const projectPath = options.directory;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY 环境变量未设置。');
    }
    const ai = new GoogleGenAI({ apiKey });

    const systemInstructionPath = path.join(process.cwd(), 'ai的TSCli系统提示词.md');
    const systemInstruction = await fs.readFile(systemInstructionPath, 'utf-8');

    let chat = ai.chats.create({
        model: "gemini-2.5-flash",
        config: { systemInstruction: systemInstruction }
    });

    while (true) {
        const { text: userInstruction, lineCount } = await getMultilineInput();

        readline.moveCursor(process.stdout, 0, -lineCount);
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);

        console.log(chalk.magenta('用户请求:'));
        console.log(userInstruction);

        const { summary, includedFiles, fileContentsMap } = await createProjectSummary(projectPath);
        const includedFilesOutput = chalk.yellow('--- 包含的文件 ---\n') + 
                                   includedFiles.map(file => chalk.green(file)).join('\n') + 
                                   chalk.yellow('\n--------------------');
        console.log(includedFilesOutput);

        let success = false;
        
        // Print header only ONCE before the retry loop
        const aiResponseHeader = chalk.blue('AI 回复:');
        console.log(aiResponseHeader);

        while (!success) {
            // Save cursor position AFTER printing the header and BEFORE the AI call
            process.stdout.write('\u001b[s');

            try {
                const optimizeCodeContext = config.optimizeCodeContext ?? true;
                let currentHistory = await chat.getHistory();
                let processedHistory: any[] = [...currentHistory];

                if (optimizeCodeContext && currentHistory.length > 0) {
                   for (let i = currentHistory.length - 1; i >= 0; i--) {
                       const message = currentHistory[i];
                       let stopRecursion = false;
                       const messageText = message.parts?.[0]?.text;

                       if (!messageText) continue;

                       let allFilesMatch = true;

                       if (message.role === 'model') {
                           const extractedXml = extractXml(messageText);
                           if (!extractedXml) continue;

                           const changesInResponse = parseXmlChanges(extractedXml);
                           if (changesInResponse.length === 0) continue;

                           for (const change of changesInResponse) {
                               const currentFileContent = fileContentsMap[change.file]?.trim().replace(/\r\n/g, '\n');
                               const responseFileContent = String(change.content).trim().replace(/\r\n/g, '\n');
                               if (currentFileContent === undefined || currentFileContent !== responseFileContent) {
                                   allFilesMatch = false;
                                   break;
                               }
                           }

                           if (allFilesMatch) {
                               const simplifiedXml = `<changes><change><file>multiple</file><description>与当前代码一致</description><content><![CDATA[用户已应用本次修改]]></content></change></changes>`;
                               const modifiedModelText = messageText.replace(extractedXml, simplifiedXml);
                               processedHistory[i] = { ...message, parts: [{ text: modifiedModelText }] };
                           } else {
                               stopRecursion = true;
                           }

                       } else if (message.role === 'user') {
                           const historicalFileMap = parseUserMessageForFiles(messageText);
                           const historicalKeys = Object.keys(historicalFileMap).sort();
                           const currentKeys = Object.keys(fileContentsMap).sort();

                           if (historicalKeys.length === 0) continue;

                           if (historicalKeys.length !== currentKeys.length || JSON.stringify(historicalKeys) !== JSON.stringify(currentKeys)) {
                               allFilesMatch = false;
                           } else {
                               for (const key of historicalKeys) {
                                   const currentContent = fileContentsMap[key]?.trim().replace(/\r\n/g, '\n');
                                   const historicalContent = historicalFileMap[key];
                                   if (currentContent !== historicalContent) {
                                       allFilesMatch = false;
                                       break;
                                   }
                               }
                           }

                           if (allFilesMatch) {
                               const instructionMatch = messageText.match(/---User Instruction---([\s\S]*)/);
                               const userInstruction = instructionMatch ? instructionMatch[1].trim() : '';
                               const modifiedUserText = `代码内容与后续提交一致\n\n---User Instruction---\n${userInstruction}`;
                               processedHistory[i] = { ...message, parts: [{ text: modifiedUserText }] };
                           } else {
                               stopRecursion = true;
                           }
                       }

                       if (stopRecursion) {
                           break;
                       }
                   }
                }

                const maxTurns = config.maxContextHistoryTurns ?? -1;
                let truncatedHistory: any[] = [];
                if (maxTurns === 0) {
                    truncatedHistory = [];
                } else if (maxTurns > 0) {
                    let userTurnIndices: number[] = [];
                    for (let i = 0; i < processedHistory.length; i++) {
                        if (processedHistory[i].role === 'user') {
                            userTurnIndices.push(i);
                        }
                    }
                    const startIndexInUserIndices = Math.max(0, userTurnIndices.length - maxTurns);
                    const actualStartHistoryIndex = userTurnIndices[startIndexInUserIndices];
                    truncatedHistory = processedHistory.slice(actualStartHistoryIndex);
                } else {
                    truncatedHistory = processedHistory;
                }

                const fullPromptString = `${summary}\n\n---User Instruction---\n${userInstruction}`;
                chat = ai.chats.create({
                    model: "gemini-2.5-flash",
                    config: { systemInstruction: systemInstruction },
                    history: truncatedHistory,
                });
                
                if (config.enableStreaming) {
                    const stream = await chat.sendMessageStream({ message: fullPromptString });
                    for await (const chunk of stream) {
                        process.stdout.write(chunk.text ?? '');
                    }
                } else {
                    const result = await chat.sendMessage({ message: fullPromptString });
                    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                    const xmlContent = extractXml(responseText);
                    if (xmlContent) {
                        const beforeXml = responseText.split(xmlContent)[0].trim().replace(/```xml\s*$/, '').trim();
                        if (beforeXml) console.log(beforeXml);
                        const appliedChanges = await applyChanges(xmlContent, projectPath);
                        const appliedChangesOutput = chalk.yellow('--- 已应用的变更 ---\n') +
                                                   appliedChanges.map(change => `${chalk.green(`${change.file}:`)}\n${chalk.cyan(`  ${change.description}`)}`).join('\n') +
                                                   chalk.yellow('\n-----------------------');
                        console.log(appliedChangesOutput);
                        const afterXml = responseText.split(xmlContent)[1]?.trim().replace(/^\s*```/, '').trim();
                        if (afterXml) console.log(afterXml);
                    } else {
                        console.log(responseText);
                    }
                }
                success = true;
            } catch (error: any) {
                // Restore cursor to the saved position (right after "AI 回复:")
                process.stdout.write('\u001b[u');
                // Clear from cursor to the end of the screen
                process.stdout.write('\u001b[J');

                const errorString = error.stack || String(error);
                process.stdout.write(chalk.red(errorString) + '\n');
                
                const promptLine = chalk.yellow("按 'r' 键重试, 其他键跳过...");
                process.stdout.write(promptLine);
                
                const key = await new Promise<string>(resolve => {
                    const onKeypress = (_str: string, key: any) => {
                        if (process.stdin.isTTY) process.stdin.setRawMode(false);
                        process.stdin.removeListener('keypress', onKeypress);
                        resolve(key.name);
                    };
                    if (process.stdin.isTTY) process.stdin.setRawMode(true);
                    process.stdin.on('keypress', onKeypress);
                });

                // Restore cursor and clear again to remove the error message and prompt
                process.stdout.write('\u001b[u');
                process.stdout.write('\u001b[J');

                if (key.toLowerCase() !== 'r') {
                    success = true; // This will break the `while(!success)` loop
                }
                // If 'r' is pressed, success remains false, and the loop will retry.
            }
        }
    }
}

main().catch(console.error);