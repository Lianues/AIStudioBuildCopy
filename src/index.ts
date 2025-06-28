import { createProjectSummary } from './projectReader';
import { extractXml } from './aiService';
import { applyChanges } from './changeApplier';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { GoogleGenAI } from '@google/genai';
import { promises as fs } from 'fs';
import * as path from 'path';

async function main() {
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

    const systemInstructionPath = path.join(process.cwd(), 'ai的python系统提示词.md');
    const systemInstruction = await fs.readFile(systemInstructionPath, 'utf-8');

    const chat = ai.chats.create({
        model: "gemini-2.5-flash",
        config: {
            systemInstruction: systemInstruction,
        }
    });

    while (true) {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'request',
                message: '请输入您的需求：',
            },
        ]);

        const userInstruction = answers.request;

        try {
            const projectSummary = await createProjectSummary(projectPath);
            const fullPromptString = `${projectSummary}\n\n---User Instruction---\n${userInstruction}`;

            // NOTE: The following block is for debugging. Uncomment to see the full emulated request body sent to the AI, including history.
            /*
            const history = await chat.getHistory();
            const fullRequestForLogging = {
                model: "gemini-2.5-flash",
                contents: [
                    ...history,
                    { role: 'user', parts: [{ text: fullPromptString }] }
                ],
                config: {
                    systemInstruction: systemInstruction,
                }
            };
            // console.log("==================== Full Request to AI (Emulated) ====================");
            // console.log(JSON.stringify(fullRequestForLogging, null, 2));
            // console.log("=====================================================================");
            */

            const result = await chat.sendMessage({ message: fullPromptString });

            // NOTE: The following block is for debugging. Uncomment to see the full response body from the AI.
            /*
            console.log("==================== Full AI Response Body =====================");
            console.log(JSON.stringify(result, null, 2));
            console.log("=============================================================");
            */
            const responseText = result.text;
            const aiResponse = extractXml(responseText ?? '');
            
            if (aiResponse) {
                await applyChanges(aiResponse, projectPath);
                console.log("Changes have been successfully applied.");
            } else {
                console.log("AI did not return any changes.");
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
    }
}

main().catch(console.error);