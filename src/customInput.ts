import readline from 'readline';
import stringWidth from 'string-width';
import chalk from 'chalk';

export async function getMultilineInput(): Promise<{ text: string, lineCount: number }> {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  let keypressHandler: ((str: string, key: { name: string; ctrl: boolean; meta: boolean; shift: boolean; }) => void) | undefined;
  const sigintHandler = () => {
    // This handler will be called on Ctrl+C.
    // We must restore the terminal and exit.
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdout.write('\nInput cancelled. Exiting.\n');
    process.exit(0);
  };

  try {
    // Listen for Ctrl+C
    process.on('SIGINT', sigintHandler);

    return await new Promise((resolve) => {
      const lines: string[] = [''];
      let cursorLine = 0;
      let cursorCol = 0;
      let lastEnterTime = 0;

      const prompt = chalk.cyan('请输入您的需求 (双击 Enter 或 Ctrl+D 提交):\n');
      process.stdout.write(prompt);
      // Save cursor position. This is our anchor.
      process.stdout.write('\x1B[s');

      const termWidth = process.stdout.columns || 80;
      const getVisualHeight = (text: string) => {
          const width = stringWidth(text);
          if (termWidth <= 0) return 1;
          if (width === 0) return 1;
          return Math.ceil(width / termWidth);
      };
      
      const cleanupAndResolve = (result: { text: string, lineCount: number }) => {
        if (keypressHandler) {
          process.stdin.removeListener('keypress', keypressHandler);
        }
        process.removeListener('SIGINT', sigintHandler);

        // Restore cursor to start, clear everything below, write final text, and add a newline.
        process.stdout.write('\x1B[u');
        readline.clearScreenDown(process.stdout);
        process.stdout.write(result.text + '\n');
        
        resolve(result);
      };

      const redraw = () => {
        // Hide cursor to prevent flickering
        process.stdout.write('\x1B[?25l');
        // 1. Restore cursor to the saved starting point
        process.stdout.write('\x1B[u');
        // 2. Clear screen from cursor down
        readline.clearScreenDown(process.stdout);
        // 3. Write content.
        process.stdout.write(lines.join('\n'));
    
        // 4. Calculate where the cursor SHOULD BE, visually, from the start point.
        let targetVisualRow = 0;
        for (let i = 0; i < cursorLine; i++) {
            targetVisualRow += getVisualHeight(lines[i]);
        }
        const prefix = lines[cursorLine].slice(0, cursorCol);
        const prefixWidth = stringWidth(prefix);
        targetVisualRow += Math.floor(prefixWidth / termWidth);
        const targetVisualCol = prefixWidth % termWidth;
    
        // 5. Move cursor to the target position.
        // First, restore to the start point again.
        process.stdout.write('\x1B[u');
        // Now move down and right using ANSI codes.
        if (targetVisualRow > 0) {
            process.stdout.write(`\x1B[${targetVisualRow}B`); // Move down
        }
        if (targetVisualCol > 0) {
            process.stdout.write(`\x1B[${targetVisualCol}C`); // Move right
        }
        // Show cursor again.
        process.stdout.write('\x1B[?25h');
      };

      keypressHandler = (str: string, key: { name: string; ctrl: boolean; meta: boolean; shift: boolean; }) => {
        // Ctrl+C is handled by the SIGINT handler
        if (key.ctrl && key.name === 'c') {
          return;
        }

        // Submission Logic
        if (key.ctrl && key.name === 'd') {
          const lineCount = 1 + lines.length;
          cleanupAndResolve({ text: lines.join('\n'), lineCount });
          return;
        }

        if (key.name === 'return') {
          const currentTime = Date.now();
          if (currentTime - lastEnterTime < 500) {
            let finalLines = lines;
            if (finalLines.length > 0 && finalLines[finalLines.length - 1] === '') {
              finalLines = finalLines.slice(0, finalLines.length - 1);
            }
            const lineCount = 1 + finalLines.length;
            cleanupAndResolve({ text: finalLines.join('\n'), lineCount });
            return;
          }
          lastEnterTime = currentTime;
          const remaining = lines[cursorLine].slice(cursorCol);
          lines[cursorLine] = lines[cursorLine].slice(0, cursorCol);
          cursorLine++;
          lines.splice(cursorLine, 0, remaining);
          cursorCol = 0;
          redraw();
          return;
        }

        // Editing Logic
        switch (key.name) {
          case 'backspace':
            if (cursorCol > 0) {
              lines[cursorLine] = lines[cursorLine].slice(0, cursorCol - 1) + lines[cursorLine].slice(cursorCol);
              cursorCol--;
            } else if (cursorLine > 0) {
              const oldLine = lines[cursorLine];
              lines.splice(cursorLine, 1);
              cursorLine--;
              cursorCol = lines[cursorLine].length;
              lines[cursorLine] += oldLine;
            }
            break;
          case 'up':
            if (cursorLine > 0) {
              cursorLine--;
              cursorCol = Math.min(cursorCol, lines[cursorLine].length);
            }
            break;
          case 'down':
            if (cursorLine < lines.length - 1) {
              cursorLine++;
              cursorCol = Math.min(cursorCol, lines[cursorLine].length);
            }
            break;
          case 'left':
            if (cursorCol > 0) {
              cursorCol--;
            } else if (cursorLine > 0) {
              cursorLine--;
              cursorCol = lines[cursorLine].length;
            }
            break;
          case 'right':
            if (cursorCol < lines[cursorLine].length) {
              cursorCol++;
            } else if (cursorLine < lines.length - 1) {
              cursorLine++;
              cursorCol = 0;
            }
            break;
          default:
            if (str && !key.ctrl && !key.meta) {
              lines[cursorLine] = lines[cursorLine].slice(0, cursorCol) + str + lines[cursorLine].slice(cursorCol);
              cursorCol += str.length;
            }
        }
        redraw();
      };

      readline.emitKeypressEvents(process.stdin);
      process.stdin.on('keypress', keypressHandler);
    });
  } finally {
    // This will always run when the function exits, whether by returning or throwing.
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    // Clean up the SIGINT listener if it's still there
    process.removeListener('SIGINT', sigintHandler);
  }
}