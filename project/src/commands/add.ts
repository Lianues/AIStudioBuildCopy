import path from 'path';
import fs from 'fs/promises';

/**
 * Handles the logic for the 'add' command, creating an empty file.
 * @param filename The name of the file to create.
 * @param verbose If true, provides more detailed output.
 */
export async function handleAddCommand(filename: string, verbose: boolean): Promise<void> {
  const filePath = path.resolve(process.cwd(), filename);

  try {
    // Check if file exists. fs.access throws if it doesn't.
    await fs.access(filePath);
    // If we reach here, the file exists, so throw an error.
    throw new Error(`File '${filename}' already exists.`);
  } catch (err: any) {
    // If error is ENOENT, file doesn't exist, so we can create it.
    if (err.code === 'ENOENT') {
      try {
        await fs.writeFile(filePath, '');
        if (verbose) {
          console.log(`File '${filename}' created successfully at ${filePath}`);
        } else {
          console.log(`File '${filename}' created successfully.`);
        }
      } catch (writeErr: any) {
        // Handle errors during file writing (e.g., permissions, invalid path components).
        throw new Error(`Unable to create file '${filename}'. Details: ${writeErr.message}`);
      }
    } else {
      // For other errors (e.g., permissions check failure not related to ENOENT), re-throw.
      throw new Error(`Error checking file '${filename}': ${err.message}`);
    }
  }
}
