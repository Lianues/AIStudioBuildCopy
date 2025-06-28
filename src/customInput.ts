import readline from 'readline';
import stringWidth from 'string-width';

export function getMultilineInput(): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [''];
    let cursorLine = 0; // The line number within our `lines` array
    let cursorCol = 0;  // The column number within the current line string
    let lastEnterTime = 0;

    const prompt = '请输入您的需求 (双击Enter或Ctrl+D提交):\n';
    process.stdout.write(prompt);

    const redraw = () => {
      // 1. Move cursor to the start of the first line of our input area.
      readline.moveCursor(process.stdout, 0, -cursorLine);
      readline.cursorTo(process.stdout, 0);

      // 2. Clear everything from here downwards. This preserves the history above.
      readline.clearScreenDown(process.stdout);

      // 3. Rewrite the content.
      process.stdout.write(lines.join('\n'));

      // 4. Move the cursor back to the correct position.
      // First, go to the top of the input area again.
      readline.moveCursor(process.stdout, 0, -(lines.length - 1));
      // Now move down to the correct line.
      readline.moveCursor(process.stdout, 0, cursorLine);
      // Finally, move to the correct column.
      const displayCol = stringWidth(lines[cursorLine].slice(0, cursorCol));
      readline.cursorTo(process.stdout, displayCol);
    };

    const keypressHandler = (str: string, key: { name: string; ctrl: boolean; meta: boolean; shift: boolean; }) => {
      if (key.ctrl && key.name === 'c') {
        process.exit();
      }

      // Submission Logic
      if (key.ctrl && key.name === 'd') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener('keypress', keypressHandler);
        // Move cursor to the end of the input and add a newline
        readline.moveCursor(process.stdout, 0, lines.length - 1 - cursorLine);
        readline.cursorTo(process.stdout, stringWidth(lines[lines.length - 1]));
        process.stdout.write('\n');
        resolve(lines.join('\n'));
        return;
      }

      if (key.name === 'return') {
        const currentTime = Date.now();
        if (currentTime - lastEnterTime < 500) {
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.removeListener('keypress', keypressHandler);
          // Move cursor to the end of the input and add a newline
          readline.moveCursor(process.stdout, 0, lines.length - 1 - cursorLine);
          readline.cursorTo(process.stdout, stringWidth(lines[lines.length - 1]));
          process.stdout.write('\n');
          resolve(lines.join('\n').replace(/\n\n$/, '\n'));
          return;
        }
        lastEnterTime = currentTime;
        const remaining = lines[cursorLine].slice(cursorCol);
        lines[cursorLine] = lines[cursorLine].slice(0, cursorCol);
        cursorLine++;
        lines.splice(cursorLine, 0, remaining);
        cursorCol = 0;
        process.stdout.write('\n'); // Physically create a new line
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
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('keypress', keypressHandler);
  });
}