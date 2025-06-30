/**
 * Extracts XML content from a string that contains a ```xml ... ``` block.
 * @param text The text containing the XML block.
 * @returns The extracted XML string, or an empty string if not found.
 */
import { GoogleGenAI, GoogleGenAIOptions, Content } from '@google/genai';
import { XMLParser } from 'fast-xml-parser';
import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createProjectSummary } from './projectReader';
import { createBackup } from './archiver';

//<--- 新增配置接口和加载函数 --->
interface Config {
    displayTokenConsumption?: {
        enabled: boolean;
        displayTypes: string[];
    };
    maxContextHistoryTurns?: number;
    optimizeCodeContext?: boolean;
    enableStreaming?: boolean;
}

let config: Config = {};

async function loadConfig(): Promise<void> {
    try {
        const configPath = path.join(process.cwd(), 'config.jsonc');
        const configFileContent = await fs.readFile(configPath, 'utf-8');
        const contentWithoutComments = configFileContent.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
        config = JSON.parse(contentWithoutComments);
    } catch (error: any) {
        console.error(`Error loading config.jsonc: ${error.message}. Using default values.`);
        config = {
            enableStreaming: true,
            maxContextHistoryTurns: -1,
            optimizeCodeContext: true,
            displayTokenConsumption: { enabled: true, displayTypes: ["total"] }
        };
    }
}
//<--- 结束新增部分 --->

/**
 * Extracts XML content from a string that contains a ```xml ... ``` block.
 * @param text The text containing the XML block.
 * @returns The extracted XML string, or an empty string if not found.
 */
export function extractXml(text: string): string {
    const match = text.match(/```xml\s*(<changes>[\s\S]*?<\/changes>)\s*```/);
    return match ? match[1].trim() : '';
}

export interface FileChange {
    type: 'update' | 'delete';
    file: string;
    description: string;
    content?: string;
}

// Map frontend message format to AI Content format
const mapMessagesToContent = (messages: any[]): Content[] => {
    return messages
        .filter(msg => (msg.sender === 'user' || msg.sender === 'ai') && msg.type === 'text' && msg.text)
        .map(msg => ({
            role: msg.sender === 'ai' ? 'model' : 'user',
            parts: [{ text: msg.fullText || msg.text }] // Use fullText if available
        }));
};

let genAI: GoogleGenAI;
let systemInstruction: string;

async function initializeChat(): Promise<void> {
    await loadConfig();
    const apiKey = process.env.GEMINI_API_KEY as string;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable not set.");
    }
    genAI = new GoogleGenAI({ apiKey });

    const systemInstructionPath = path.join(process.cwd(), 'SystemPrompt', 'ai的TSCli系统提示词.md');
    systemInstruction = await fs.readFile(systemInstructionPath, 'utf-8');
}

//<--- 新增历史记录简化逻辑 --->
function parseUserMessageForFiles(messageText: string): { [filePath: string]: string } {
    const fileContentsMap: { [filePath: string]: string } = {};
    if (!messageText.startsWith('These are the existing files in the app:')) {
        return fileContentsMap;
    }
    const fileBlockRegex = /--- START OF FILE (.*?) ---\n([\s\S]*?)(?=\n--- START OF FILE|\n\n---User Instruction---|$)/g;
    let match;
    while ((match = fileBlockRegex.exec(messageText)) !== null) {
        const filePath = match[1].trim();
        const content = match[2].trim().replace(/\r\n/g, '\n');
        fileContentsMap[filePath] = content;
    }
    return fileContentsMap;
}

async function getProcessedHistory(projectPath: string, history: Content[]): Promise<Content[]> {
    const currentHistory: Content[] = history;
    if (!config.optimizeCodeContext || currentHistory.length === 0) {
        return currentHistory;
    }

    const { fileContentsMap } = await createProjectSummary(projectPath, false);
    let processedHistory: Content[] = [...currentHistory];

    for (let i = currentHistory.length - 1; i >= 0; i--) {
        const message = currentHistory[i];
        const messageText = message.parts?.[0]?.text;
        if (!messageText) continue;

        let allFilesMatch = true;
        let stopRecursion = false;

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
                
                const fileSummaryBlocks = historicalKeys.map(filePath =>
                    `--- START OF FILE ${filePath} ---\n[代码内容与当前上下文一致]`
                ).join('\n\n');

                const modifiedUserText = `These are the existing files in the app:\n${fileSummaryBlocks}\n\n---User Instruction---\n${userInstruction}`;
                processedHistory[i] = { ...message, parts: [{ text: modifiedUserText }] };
            } else {
                stopRecursion = true;
            }
        }

        if (stopRecursion) {
            break;
        }
    }
    return processedHistory;
}


function getTruncatedHistory(processedHistory: Content[]): Content[] {
    const maxTurns = config.maxContextHistoryTurns ?? -1;
    if (maxTurns === 0) {
        return [];
    } else if (maxTurns > 0) {
        const userTurnIndices = processedHistory.reduce((acc, msg, i) => {
            if (msg.role === 'user') acc.push(i);
            return acc;
        }, [] as number[]);
        
        const startIndexInUserIndices = Math.max(0, userTurnIndices.length - maxTurns);
        const actualStartHistoryIndex = userTurnIndices[startIndexInUserIndices];
        return processedHistory.slice(actualStartHistoryIndex);
    }
    return processedHistory; // maxTurns === -1
}
//<--- 结束新增部分 --->


export type StreamEvent =
  | { type: 'chunk'; content: string }
  | { type: 'token'; usage: any; displayTypes: string[] }
  | { type: 'files'; files: string[]; fullPrompt: string }
  | { type: 'backup'; message: string; backupFolderName: string; userMessageId: number }
  | { type: 'error'; message: string };

export async function* generateChatResponseStream(
    message: string,
    projectPath: string,
    userMessageId: number,
    clientHistory: any[] // Comes from frontend state
): AsyncGenerator<StreamEvent> {
    const backupName = `${new Date().toISOString().replace(/[:.]/g, '-')}_initial`;
    const { created, folderName } = await createBackup(projectPath, backupName);

    if (created && folderName) {
        yield { type: 'backup', message: `初始项目状态已存档于 ${folderName}`, backupFolderName: folderName, userMessageId };
    }

    if (!genAI) {
        await initializeChat();
    }

    try {
        const { summary, includedFiles } = await createProjectSummary(projectPath, true);
        const fullPrompt = `${summary}\n\n---User Instruction---\n${message}`;
        yield { type: 'files', files: includedFiles, fullPrompt };

        // Exclude the last message from clientHistory, as it's the current user prompt
        // which is being combined with the file context in fullPrompt.
        const historyForContext = clientHistory.slice(0, -1);
        const chatHistory = mapMessagesToContent(historyForContext);
        const processedHistory = await getProcessedHistory(projectPath, chatHistory);
        const truncatedHistory = getTruncatedHistory(processedHistory);

        const fullRequestForLogging = {
            model: "gemini-2.5-flash",
            contents: [
                ...truncatedHistory,
                { role: 'user', parts: [{ text: fullPrompt }] }
            ],
            systemInstruction: systemInstruction,
        };

        console.log('--- AI Request Body ---');
        console.log(JSON.stringify(fullRequestForLogging, null, 2));
        console.log('--------------------');

        const chat = genAI.chats.create({
            model: "gemini-2.5-flash",
            history: truncatedHistory,
            config: {
                systemInstruction: systemInstruction,
            },
        });

        let fullResponseText = '';
        if (config.enableStreaming) {
            const stream = await chat.sendMessageStream({ message: fullPrompt });
            let usageMetadata;
            for await (const chunk of stream) {
                const chunkText = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                if (chunkText) {
                    fullResponseText += chunkText;
                    yield { type: 'chunk', content: chunkText };
                }
                if (chunk.usageMetadata) {
                    usageMetadata = chunk.usageMetadata;
                }
            }
            if (config.displayTokenConsumption?.enabled && usageMetadata) {
                yield { type: 'token', usage: usageMetadata, displayTypes: config.displayTokenConsumption.displayTypes || [] };
            }
        } else {
            const result = await chat.sendMessage({ message: fullPrompt });
            fullResponseText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            yield { type: 'chunk', content: fullResponseText };
            if (config.displayTokenConsumption?.enabled && result.usageMetadata) {
                yield { type: 'token', usage: result.usageMetadata, displayTypes: config.displayTokenConsumption.displayTypes || [] };
            }
        }
        // No longer manually update history here; frontend is the source of truth.
    } catch (error: any) {
        console.error("Error calling Google AI:", error);
        yield { type: 'error', message: `Sorry, I encountered an error: ${error.message}` };
    }
}

export function parseXmlChanges(xmlString: string): FileChange[] {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "", // No prefix for attributes
        // Stop parsing at the 'content' node to treat its value as a raw string.
        // This robustly handles CDATA and mixed content.
        stopNodes: ["changes.change.content"],
    });

    const jsonObj = parser.parse(xmlString);
    const changes = jsonObj.changes.change;
    if (!changes) return [];

    const changesArray = Array.isArray(changes) ? changes : [changes];

    return changesArray.map((change: any) => {
        // Default type to 'update' if not specified
        const type = change.type || 'update';
        
        // With the stopNodes option, change.content is now guaranteed to be a string.
        let contentValue = change.content;

        // Strip CDATA wrapper if it exists
        if (typeof contentValue === 'string') {
            const cdataMatch = contentValue.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
            if (cdataMatch) {
                contentValue = cdataMatch[1];
            }
        }

        const fileChange: FileChange = {
            type: type,
            file: change.file,
            description: change.description,
        };

        if (contentValue !== undefined) {
            fileChange.content = contentValue;
        }

        return fileChange;
    });
}