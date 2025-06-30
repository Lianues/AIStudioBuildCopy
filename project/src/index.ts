#!/usr/bin/env node
import { program } from './cli.js';

(async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('An unexpected error occurred:', error.message);
    process.exit(1);
  }
})();
