import { Command } from 'commander';
import packageJson from '../package.json'; // Removed assert { type: 'json' }
import { handleAddCommand } from './commands/add.js';
import { handleHelloCommand } from './commands/hello.js';

export const program = new Command();

program
  .name('my-cli-app')
  .description('A simple CLI application to manage files')
  .version(packageJson.version);

program
  .command('hello')
  .description('Prints "Hello, world!"')
  .action(() => {
    try {
      handleHelloCommand();
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('version')
  .description('Displays the CLI version')
  .action(() => {
    console.log(`Version: ${packageJson.version}`);
  });

program
  .command('add <filename>')
  .description('Creates an empty file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (filename, options) => {
    try {
      await handleAddCommand(filename, options.verbose);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.on('command:*', () => {
  console.error('Invalid command. See --help for a list of available commands.');
  process.exit(1);
});
