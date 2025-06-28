import readline from 'readline';

export function getMultilineInput(): Promise<string> {
  return new Promise((resolve) => {
    let input = '';
    const prompt = '请输入您的需求：> ';

    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }

    process.stdout.write(prompt);

    const keypressHandler = (str: string, key: { name: string; ctrl: boolean; shift: boolean; }) => {
      if (key.ctrl && key.name === 'c') {
        process.exit();
      } else if (key.name === 'return' && !key.shift && !key.ctrl) {
        // Enter key to submit
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('keypress', keypressHandler);
        process.stdout.write('\n');
        resolve(input);
      } else if (key.name === 'return' && (key.shift || key.ctrl)) {
        // Shift+Enter or Ctrl+Enter for a new line
        input += '\n';
        process.stdout.write('\n> ');
      } else if (key.name === 'backspace') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          // Clear line and rewrite
          process.stdout.cursorTo(0);
          process.stdout.clearLine(1);
          // Redrawing with the full prompt. This fixes the single-line backspace issue.
          // Note: Redrawing is still naive and will not work correctly when deleting newlines.
          process.stdout.write(prompt + input.replace(/\n/g, '\n> '));
        }
      } else if (str && !key.ctrl && (!key.name || !key.name.includes('return'))) {
        input += str;
        process.stdout.write(str);
      }
    };

    process.stdin.on('keypress', keypressHandler);
  });
}