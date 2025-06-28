import { createProjectSummary } from './projectReader';
import { extractXml } from './aiService';
import { applyChanges } from './changeApplier';
import { Command } from 'commander';
import { getMultilineInput } from './customInput';
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
        const userInstruction = await getMultilineInput();

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
            console.log("==================== Full Request to AI (Emulated) ====================");
            console.log(JSON.stringify(fullRequestForLogging, null, 2));
            console.log("=====================================================================");
            */

            const result = await chat.sendMessage({ message: fullPromptString });

            // Log the full response body for debugging
            console.log("==================== Full AI Response Body =====================");
            console.log(JSON.stringify(result, null, 2));
            console.log("=============================================================");

            const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            const xmlContent = extractXml(responseText);

            if (xmlContent) {
                const parts = responseText.split(xmlContent);
                const beforeXml = parts[0].trim();
                const afterXml = parts.length > 1 ? parts[1].trim() : '';

                // Clean up potential markdown fences before printing
                if (beforeXml) {
                    console.log(beforeXml.replace(/```xml\s*$/, '').trim());
                }

                const appliedChanges = await applyChanges(xmlContent, projectPath);
                
                const chalk = (await import('chalk')).default;
                console.log(chalk.yellow('--- Applied Changes ---'));
                for (const change of appliedChanges) {
                    console.log(chalk.green(`${change.file}:`));
                    console.log(chalk.cyan(`  ${change.description}`));
                    console.log(chalk.dim(`  Successfully applied change to: ${change.fullPath}`));
                }
                console.log(chalk.yellow('-----------------------'));
                
                if (afterXml) {
                    // Clean up potential closing markdown fence
                    console.log(afterXml.replace(/^\s*```/, '').trim());
                }

            } else {
                // If no XML is found, it's a purely conversational response.
                console.log("AI Response:", responseText);
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
    }
}

main().catch(console.error);