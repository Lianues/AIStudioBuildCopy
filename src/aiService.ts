/**
 * Extracts XML content from a string that contains a ```xml ... ``` block.
 * @param text The text containing the XML block.
 * @returns The extracted XML string, or an empty string if not found.
 */
import { GoogleGenAI, Content } from '@google/genai';
import OpenAI from 'openai';
import { XMLParser } from 'fast-xml-parser';
import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createProjectSummary } from './projectReader';
import { createBackup } from './archiver';

//<--- 新增配置接口和加载函数 --->
interface Config {
    apiProvider?: 'gemini' | 'openai';
    displayTokenConsumption?: {
        enabled: boolean;
        displayTypes: string[];
    };
    maxContextHistoryTurns?: number;
    optimizeCodeContext?: boolean;
    enableStreaming?: boolean;
    modelParameters?: { // Gemini-specific
        model: string;
        temperature: number;
        topP?: number;
        topK?: number;
        systemPromptPath: string;
    };
    openaiParameters?: { // OpenAI-specific
        baseURL: string;
        model: string;
        temperature: number;
        topP?: number;
        systemPromptPath: string;
    };
}

let config: Config = {};

async function loadConfig(): Promise<void> {
    try {
        const configPath = path.join(process.cwd(), 'config.jsonc');
        const configFileContent = await fs.readFile(configPath, 'utf-8');
        const contentWithoutComments = configFileContent.replace(/(?<!:)\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
        config = JSON.parse(contentWithoutComments);
    } catch (error: any) {
        console.error(`Error loading config.jsonc: ${error.message}. Using default values.`);
        config = {
            enableStreaming: true,
            maxContextHistoryTurns: -1,
            optimizeCodeContext: true,
            displayTokenConsumption: { enabled: true, displayTypes: ["total"] },
            modelParameters: {
                model: "gemini-2.5-flash",
                temperature: 0.1,
                topP: 0.95,
                topK: 40,
                systemPromptPath: "SystemPrompt/ai的TS系统提示词.md"
            }
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
let openai: OpenAI;
let systemInstruction: string;

async function initializeChat(): Promise<void> {
    await loadConfig();
    
    const provider = config.apiProvider || 'gemini';
    console.log(`Initializing AI service with provider: ${provider}`);

    if (provider === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY as string;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY environment variable not set for Gemini provider.");
        }
        genAI = new GoogleGenAI({ apiKey });
    } else if (provider === 'openai') {
        const apiKey = process.env.OPENAI_API_KEY as string;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY environment variable not set for OpenAI provider.");
        }
        openai = new OpenAI({
            apiKey: apiKey,
            baseURL: config.openaiParameters?.baseURL,
        });
    }

    systemInstruction = ''; // Default to empty string
    const systemPromptPath = provider === 'gemini'
        ? config.modelParameters?.systemPromptPath
        : config.openaiParameters?.systemPromptPath;

    if (systemPromptPath) {
        try {
            const fullPath = path.join(process.cwd(), systemPromptPath);
            systemInstruction = await fs.readFile(fullPath, 'utf-8');
            console.log(`System prompt loaded successfully from: ${systemPromptPath}`);
        } catch (error: any) {
            console.error(`Could not load system prompt from ${systemPromptPath}: ${error.message}`);
        }
    }
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

//<--- 新增OpenAI消息映射函数 --->
const mapMessagesToOpenAIFormat = (messages: any[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => {
    return messages
        .filter(msg => (msg.sender === 'user' || msg.sender === 'ai') && msg.type === 'text' && msg.text)
        .map(msg => ({
            role: msg.sender === 'ai' ? 'assistant' : 'user',
            content: msg.fullText || msg.text
        }));
};

async function* generateGeminiResponseStream(
    fullPrompt: string,
    truncatedHistory: Content[]
): AsyncGenerator<StreamEvent> {
    const modelName = config.modelParameters?.model || 'gemini-1.5-flash';
    const { temperature, topP, topK } = config.modelParameters || {};

    const generationConfig: { temperature?: number; topP?: number; topK?: number } = {};
    if (temperature !== undefined) generationConfig.temperature = temperature;
    if (topP !== undefined) generationConfig.topP = topP;
    if (topK !== undefined) generationConfig.topK = topK;

    console.log('--- AI Request Body (Gemini) ---');
    console.log(JSON.stringify({ model: modelName, history: truncatedHistory, prompt: fullPrompt, ...generationConfig }, null, 2));
    console.log('--------------------');

    const chat = genAI.chats.create({
        model: modelName,
        history: truncatedHistory,
        config: { systemInstruction, ...generationConfig },
    });

    if (config.enableStreaming) {
        const stream = await chat.sendMessageStream({ message: fullPrompt });
        let usageMetadata;
        for await (const chunk of stream) {
            const chunkText = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            if (chunkText) yield { type: 'chunk', content: chunkText };
            if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
        }
        if (config.displayTokenConsumption?.enabled && usageMetadata) {
            console.log('--- AI Usage Metadata (Gemini Stream) ---');
            console.log(JSON.stringify({ usageMetadata }, null, 2));
            console.log('---------------------------------');
            yield { type: 'token', usage: usageMetadata, displayTypes: config.displayTokenConsumption.displayTypes || [] };
        }
    } else {
        const result = await chat.sendMessage({ message: fullPrompt });
        console.log('--- AI Raw Response (Gemini) ---');
        console.log(JSON.stringify(result, null, 2));
        console.log('---------------------------------');
        const fullResponseText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        yield { type: 'chunk', content: fullResponseText };
        if (config.displayTokenConsumption?.enabled && result.usageMetadata) {
            yield { type: 'token', usage: result.usageMetadata, displayTypes: config.displayTokenConsumption.displayTypes || [] };
        }
    }
}

async function* generateOpenAIResponseStream(
    fullPrompt: string,
    truncatedHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): AsyncGenerator<StreamEvent> {
    const modelName = config.openaiParameters?.model || 'gpt-4-turbo';
    const { temperature, topP } = config.openaiParameters || {};

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push(...truncatedHistory, { role: 'user', content: fullPrompt });

    console.log('--- AI Request Body (OpenAI) ---');
    console.log(JSON.stringify({ model: modelName, messages, temperature, topP }, null, 2));
    console.log('--------------------');

    if (config.enableStreaming) {
        const stream = await openai.chat.completions.create({
            model: modelName,
            messages: messages,
            temperature: temperature,
            top_p: topP,
            stream: true,
        });
        for await (const chunk of stream) {
            console.log('--- AI Raw Response Chunk (OpenAI Stream) ---');
            console.log(JSON.stringify(chunk, null, 2));
            console.log('---------------------------------');
            const chunkText = chunk.choices[0]?.delta?.content || '';
            if (chunkText) yield { type: 'chunk', content: chunkText };
        }
        // Note: OpenAI streaming API doesn't provide token usage details in the same way as Gemini.
        // It might be in the last chunk, or require a separate non-streaming call to estimate.
        // For now, we are not yielding a 'token' event for OpenAI stream.
    } else {
        const completion = await openai.chat.completions.create({
            model: modelName,
            messages: messages,
            temperature: temperature,
            top_p: topP,
            stream: false,
        });
        console.log('--- AI Raw Response (OpenAI) ---');
        console.log(JSON.stringify(completion, null, 2));
        console.log('---------------------------------');
        const fullResponseText = completion.choices[0]?.message?.content || '';
        yield { type: 'chunk', content: fullResponseText };
        if (config.displayTokenConsumption?.enabled && completion.usage) {
            const usage = {
                promptTokenCount: completion.usage.prompt_tokens,
                candidatesTokenCount: completion.usage.completion_tokens,
                totalTokenCount: completion.usage.total_tokens
            };
            yield { type: 'token', usage, displayTypes: config.displayTokenConsumption.displayTypes || [] };
        }
    }
}


export async function* generateChatResponseStream(
    message: string,
    projectPath: string,
    userMessageId: number,
    clientHistory: any[] // Comes from frontend state
): AsyncGenerator<StreamEvent> {
    try {
        const backupName = `${new Date().toISOString().replace(/[:.]/g, '-')}_initial`;
        const { created, folderName } = await createBackup(projectPath, backupName);
        if (created && folderName) {
            yield { type: 'backup', message: `初始项目状态已存档于 ${folderName}`, backupFolderName: folderName, userMessageId };
        }

        if (!genAI && !openai) {
            await initializeChat();
        }

        const { summary, includedFiles } = await createProjectSummary(projectPath, true);
        const fullPrompt = `${summary}\n\n---User Instruction---\n${message}`;
        yield { type: 'files', files: includedFiles, fullPrompt };

        const historyForContext = clientHistory.slice(0, -1);
        const provider = config.apiProvider || 'gemini';

        if (provider === 'gemini') {
            const chatHistory = mapMessagesToContent(historyForContext);
            const processedHistory = await getProcessedHistory(projectPath, chatHistory);
            const truncatedHistory = getTruncatedHistory(processedHistory);
            yield* generateGeminiResponseStream(fullPrompt, truncatedHistory);
        } else { // openai
            const chatHistory = mapMessagesToOpenAIFormat(historyForContext);
            // Note: History processing/simplification is currently only implemented for Gemini format.
            // For OpenAI, we will use a simple truncation for now.
            const maxTurns = config.maxContextHistoryTurns ?? -1;
            let truncatedHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
            if (maxTurns === 0) {
                truncatedHistory = [];
            } else if (maxTurns > 0) {
                const userTurnIndices = chatHistory.reduce((acc, msg, i) => {
                    if (msg.role === 'user') acc.push(i);
                    return acc;
                }, [] as number[]);
                const startIndex = Math.max(0, userTurnIndices.length - maxTurns);
                const actualStartIndex = userTurnIndices[startIndex];
                truncatedHistory = chatHistory.slice(actualStartIndex);
            } else {
                truncatedHistory = chatHistory; // maxTurns === -1
            }
            yield* generateOpenAIResponseStream(fullPrompt, truncatedHistory);
        }
    } catch (error: any) {
        console.error(`Error calling AI (${config.apiProvider || 'gemini'}):`, error);
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