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
// 用于存储上次 AI 返回的文件内容，键为文件路径，值为文件内容
let lastFileContents: { [key:string]: string } = {};

/**
* 从用户消息文本中解析文件快照。
* @param messageText 用户消息的文本内容。
* @returns 一个包含文件路径和内容的映射表，如果不匹配则为空对象。
*/
function parseUserMessageForFiles(messageText: string): { [filePath: string]: string } {
    const fileContentsMap: { [filePath: string]: string } = {};
    const fileBlockRegex = /--- START OF FILE (.*?) ---\n([\s\S]*?)(?=\n--- START OF FILE|\n\n---User Instruction---|$)/g;

    if (!messageText.startsWith('These are the existing files in the app:')) {
        return fileContentsMap;
    }

    let match;
    while ((match = fileBlockRegex.exec(messageText)) !== null) {
        const filePath = match[1].trim();
        // 标准化换行符以进行一致的比较
        const content = match[2].trim().replace(/\r\n/g, '\n');
        fileContentsMap[filePath] = content;
    }

    return fileContentsMap;
}
 
 async function loadConfig() {
   try {
     const configPath = path.join(process.cwd(), 'config.jsonc');
     const configFileContent = await fs.readFile(configPath, 'utf-8');
     // 移除注释后再解析
     const contentWithoutComments = configFileContent.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
     config = JSON.parse(contentWithoutComments);
   } catch (error: any) { // 将 error 断言为 any
     console.error(chalk.red(`Error loading config.jsonc: ${error.message}`));
     // 如果配置文件加载失败，使用默认值或空对象
     config = {};
   }
 }

async function main() {
    await loadConfig(); // 在main函数开始时加载配置

    const program = new Command();
    program
        .version("1.0.0")
        .option('-d, --directory <type>', 'Specify the project directory', './project')
        .parse(process.argv);

    const options = program.opts();
    const projectPath = options.directory;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable not set.');
    }
    const ai = new GoogleGenAI({ apiKey });

    const systemInstructionPath = path.join(process.cwd(), 'ai的TSCli系统提示词.md');
    const systemInstruction = await fs.readFile(systemInstructionPath, 'utf-8');

    let chat = ai.chats.create({ // Initialize chat outside the loop for the first turn
        model: "gemini-2.5-flash",
        config: {
            systemInstruction: systemInstruction,
        }
    });

    while (true) {
        const { text: userInstruction, lineCount } = await getMultilineInput();

        // Clear the input prompt and text
        readline.moveCursor(process.stdout, 0, -lineCount);
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);

        // Now, display the formatted user request
        console.log(chalk.magenta('User Request:'));
        console.log(userInstruction); // Print the actual instruction text

        try {
            const { summary, includedFiles, fileContentsMap } = await createProjectSummary(projectPath);

            console.log(chalk.yellow('--- Included Files ---'));
            includedFiles.forEach(file => {
                console.log(chalk.green(file));
            });
            console.log(chalk.yellow('--------------------'));

            // 根据 optimizeCodeContext 配置项精简历史对话
            const optimizeCodeContext = config.optimizeCodeContext ?? true; // 默认启用

            let currentHistory = await chat.getHistory();
            let processedHistory: any[] = [...currentHistory]; // 创建一个副本以进行修改

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

                       if (historicalKeys.length === 0) continue; // 不是包含代码的用户消息

                       if (historicalKeys.length !== currentKeys.length || JSON.stringify(historicalKeys) !== JSON.stringify(currentKeys)) {
                           allFilesMatch = false;
                       } else {
                           for (const key of historicalKeys) {
                               const currentContent = fileContentsMap[key]?.trim().replace(/\r\n/g, '\n');
                               const historicalContent = historicalFileMap[key]; // 已经在parse时trim和标准化
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

            // History management logic based on maxContextHistoryTurns
            const maxTurns = config.maxContextHistoryTurns ?? -1; // Default to -1 (all history)
            let truncatedHistory: any[] = [];

            if (maxTurns === 0) {
                truncatedHistory = []; // 不附带历史记录
            } else if (maxTurns > 0) {
                let userTurnIndices: number[] = [];
                for (let i = 0; i < processedHistory.length; i++) {
                    if (processedHistory[i].role === 'user') {
                        userTurnIndices.push(i);
                    }
                }

                // 确定截取的起始索引
                const startIndexInUserIndices = Math.max(0, userTurnIndices.length - maxTurns);
                const actualStartHistoryIndex = userTurnIndices[startIndexInUserIndices];
                
                truncatedHistory = processedHistory.slice(actualStartHistoryIndex);

            } else { // maxTurns === -1, 附带所有历史记录
                truncatedHistory = processedHistory;
            }

            const fullPromptString = `${summary}\n\n---User Instruction---\n${userInstruction}`;

            // Re-create chat with the truncated history for the current turn
            chat = ai.chats.create({
                model: "gemini-2.5-flash",
                config: {
                    systemInstruction: systemInstruction,
                },
                history: truncatedHistory, // Pass the truncated history
            });
            // 获取用于日志记录的历史记录，并确保 role 和 parts 的顺序
            const historyForLogging = truncatedHistory.map(item => ({
                role: item.role,
                parts: item.parts
            }));

            const fullRequestForLogging = {
                model: "gemini-2.5-flash",
                contents: [
                    ...historyForLogging, // 使用格式化后的历史记录
                    { role: 'user', parts: [{ text: fullPromptString }] }
                ],
                config: {
                    systemInstruction: systemInstruction,
                }
            };

            let responseText = '';
            let usageMetadata: any = null;
            
            if (config.enableStreaming) {
                const stream = await chat.sendMessageStream({ message: fullPromptString });
                let buffer = '';
                type StreamingState = 'TEXT' | 'AWAITING_CHANGE_HEADER' | 'STREAMING_FILE';
                let state: StreamingState = 'TEXT';
                
                let fileStreamInfo: { stream: any; } | null = null;
                let pendingFileName: string | null = null;
                let pendingDescription: string | null = null;

                let spinner: NodeJS.Timeout | null = null;
                const spinnerChars = ['|', '/', '-', '\\'];
                
                const startSpinner = (text: string) => {
                    process.stdout.write(text + ' ');
                    let i = 0;
                    spinner = setInterval(() => {
                        process.stdout.write(chalk.yellow(spinnerChars[i++ % spinnerChars.length]) + '\b');
                    }, 100);
                };

                const stopSpinner = () => {
                    if (spinner) {
                        clearInterval(spinner);
                        spinner = null;
                        process.stdout.write(chalk.green('✓ Done\n'));
                    }
                };
                
                console.log(chalk.blue('AI Response:'));

                for await (const chunk of stream) {
                    buffer += chunk.text ?? '';
                    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;

                    let processBuffer = true;
                    while (processBuffer) {
                        processBuffer = false;
                        switch (state) {
                            case 'TEXT':
                                const changesIndex = buffer.indexOf('<changes>');
                                if (changesIndex !== -1) {
                                    process.stdout.write(buffer.substring(0, changesIndex));
                                    buffer = buffer.substring(changesIndex + '<changes>'.length);
                                    state = 'AWAITING_CHANGE_HEADER';
                                    processBuffer = true;
                                } else {
                                    process.stdout.write(buffer);
                                    buffer = '';
                                }
                                break;

                            case 'AWAITING_CHANGE_HEADER':
                                const endChangesIndex = buffer.indexOf('</changes>');
                                if (endChangesIndex !== -1) {
                                    const textBeforeEnd = buffer.substring(0, endChangesIndex);
                                    process.stdout.write(textBeforeEnd);
                                    buffer = buffer.substring(endChangesIndex + '</changes>'.length);
                                    state = 'TEXT';
                                    processBuffer = true;
                                    break;
                                }
                                
                                if (pendingFileName === null) {
                                    const fileMatch = buffer.match(/<file>([\s\S]*?)<\/file>/);
                                    if (fileMatch) {
                                        pendingFileName = fileMatch[1];
                                        buffer = buffer.substring(buffer.indexOf(fileMatch[0]) + fileMatch[0].length);
                                    }
                                }
                                
                                if (pendingDescription === null) {
                                    const descMatch = buffer.match(/<description>([\s\S]*?)<\/description>/);
                                    if (descMatch) {
                                        pendingDescription = descMatch[1];
                                        buffer = buffer.substring(buffer.indexOf(descMatch[0]) + descMatch[0].length);
                                    }
                                }

                                const contentIndex = buffer.indexOf('<content>');
                                if (pendingFileName !== null && pendingDescription !== null && contentIndex !== -1) {
                                    const spinnerText = chalk.yellow(`Updating ${pendingFileName}: ${pendingDescription}`);
                                    
                                    const fullPath = path.join(projectPath, pendingFileName);
                                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                                    const fileHandle = await fs.open(fullPath, 'w');
                                    fileStreamInfo = {
                                        stream: fileHandle.createWriteStream(),
                                    };
                                    
                                    buffer = buffer.substring(contentIndex + '<content>'.length);
                                    state = 'STREAMING_FILE';
                                    startSpinner(spinnerText);
                                    
                                    pendingFileName = null;
                                    pendingDescription = null;
                                    processBuffer = true;
                                }
                                break;

                            case 'STREAMING_FILE':
                                const endContentIndex = buffer.indexOf('</content>');
                                if (endContentIndex !== -1) {
                                    const endChangeIndex = buffer.indexOf('</change>', endContentIndex);
                                    if (endChangeIndex !== -1) {
                                        const fileContent = buffer.substring(0, endContentIndex);
                                        if (fileContent) await fileStreamInfo!.stream.write(fileContent);
                                        
                                        await new Promise<void>(resolve => fileStreamInfo!.stream.end(resolve));
                                        stopSpinner();
                                        fileStreamInfo = null;
                                        
                                        buffer = buffer.substring(endChangeIndex + '</change>'.length);
                                        state = 'AWAITING_CHANGE_HEADER';
                                        processBuffer = true;
                                    }
                                } else {
                                    await fileStreamInfo!.stream.write(buffer);
                                    buffer = '';
                                }
                                break;
                        }
                    }
                }
                if (state === 'TEXT' && buffer.length > 0) {
                    process.stdout.write(buffer);
                }
                responseText = '';
            } else {
                const result = await chat.sendMessage({ message: fullPromptString });
                responseText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                usageMetadata = result.usageMetadata;
                
                console.log(chalk.blue('AI Response:'));
                const xmlContent = extractXml(responseText);
                if (xmlContent) {
                    const beforeXml = responseText.split(xmlContent)[0].trim().replace(/```xml\s*$/, '').trim();
                    if (beforeXml) console.log(beforeXml);

                    const appliedChanges = await applyChanges(xmlContent, projectPath);

                    console.log(chalk.yellow('--- Applied Changes ---'));
                    for (const change of appliedChanges) {
                        console.log(chalk.green(`${change.file}:`));
                        console.log(chalk.cyan(`  ${change.description}`));
                    }
                    console.log(chalk.yellow('-----------------------'));

                    const afterXml = responseText.split(xmlContent)[1]?.trim().replace(/^\s*```/, '').trim();
                    if (afterXml) console.log(afterXml);
                } else {
                    console.log(responseText);
                }
            }
            
            if (!config.enableStreaming && config.displayTokenConsumption?.enabled && usageMetadata) {
                const displayTypes = config.displayTokenConsumption.displayTypes;
                console.log(chalk.dim('--- Token Usage ---'));
                if (displayTypes.includes('input')) {
                    console.log(chalk.dim(`promptTokenCount（提示token）: ${usageMetadata.promptTokenCount}`));
                }
                if (displayTypes.includes('output')) {
                    console.log(chalk.dim(`candidatesTokenCount（补全token）: ${usageMetadata.candidatesTokenCount}`));
                }
                if (displayTypes.includes('total')) {
                    console.log(chalk.dim(`totalTokenCount（总token）: ${usageMetadata.totalTokenCount}`));
                }
                if (displayTypes.includes('thoughts')) {
                    console.log(chalk.dim(`thoughtsTokenCount（思考token）: ${usageMetadata.thoughtsTokenCount}`));
                }
                console.log(chalk.dim('-------------------'));
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
    }
}

main().catch(console.error);