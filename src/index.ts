import { createProjectSummary } from './projectReader';
import { invokeAI } from './aiService';
import { applyChanges } from './changeApplier';
import { Command } from 'commander';
import inquirer from 'inquirer';

interface ChatMessage {
    role: 'user' | 'model';
    content: string;
}

async function main() {
    const program = new Command();
    program
        .version("1.0.0")
        .option('-d, --directory <type>', 'Specify the project directory', './project')
        .parse(process.argv);

    const options = program.opts();
    const projectPath = options.directory;

    const chatHistory: ChatMessage[] = [];

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
            const summary = await createProjectSummary(projectPath);
            const historyString = chatHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
            const fullContext = `${summary}\n\n--- Chat History ---\n${historyString}`;
            
            const aiResponse = await invokeAI(fullContext, userInstruction);
            
            if (aiResponse) {
                await applyChanges(aiResponse, projectPath);
                console.log("Changes have been successfully applied.");
                chatHistory.push({ role: 'user', content: userInstruction });
                chatHistory.push({ role: 'model', content: aiResponse });
            } else {
                console.log("AI did not return any changes.");
            }
        } catch (error) {
            console.error("An error occurred:", error);
        }
    }
}

main().catch(console.error);