import { promises as fs } from 'fs';
import * as path from 'path';
import { GoogleGenAI } from "@google/genai";

/**
 * Extracts XML content from a string that contains a ```xml ... ``` block.
 * @param text The text containing the XML block.
 * @returns The extracted XML string, or an empty string if not found.
 */
function extractXml(text: string): string {
    if (text.startsWith('<')) {
        return text;
    }
    const match = text.match(/```xml\n([\s\S]*?)```/);
    return match ? match[1].trim() : '';
}

/**
 * Invokes the AI model with a project summary and a user instruction.
 * @param projectSummary A string containing the summary of the project files.
 * @param userInstruction The user's instruction for the AI.
 * @returns A promise that resolves to the pure XML response from the AI.
 */
export async function invokeAI(projectSummary: string, userInstruction: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable not set.');
    }

    const genAI = new GoogleGenAI({ apiKey });

    const systemInstructionPath = path.join(process.cwd(), 'ai的python系统提示词.md');
    const systemInstruction = await fs.readFile(systemInstructionPath, 'utf-8');

    const content = `${projectSummary}\n\n---User Instruction---\n${userInstruction}`;

    const contents = [
        { role: "user", parts: [{ text: content }] }
    ];
    const request = {
        model: "gemini-2.5-flash",
        contents: contents,
        config: {
            systemInstruction: systemInstruction,
        }
    };
    console.log("Sending to AI:", JSON.stringify(request, null, 2));
    const result = await genAI.models.generateContent(request);
    
    const responseText = result.text;
    console.log("AI Response:", responseText);
    console.log("AI Response:", responseText);
    return extractXml(responseText ?? '');
}