// frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import monacoEditorPlugin from 'vite-plugin-monaco-editor';

export default defineConfig({
  plugins: [
    react(),
    (monacoEditorPlugin as any).default({
          languageWorkers: ['editorWorkerService', 'css', 'html', 'json', 'typescript'],
          features: [
                  'accessibilityHelp',
                  'bracketMatching',
                  'browser',
                  'clipboard',
                  'codeAction',
                  'codelens',
                  'colorDetector',
                  'comment',
                  'contextmenu',
                  'coreCommands',
                  'cursorUndo',
                  'dnd',
                  'find',
                  'folding',
                  'fontZoom',
                  'format',
                  'gotoError',
                  'hover',
                  'inPlaceReplace',
                  'inlineHints',
                  'inspectTokens',
                  'linesOperations',
                  'links',
                  'multicursor',
                  'parameterHints',
                  'quickCommand',
                  'quickHelp',
                  'quickOutline',
                  'referenceSearch',
                  'rename',
                  'smartSelect',
                  'snippets',
                  'suggest',
                  'toggleHighContrast',
                  'toggleTabFocusMode',
                  'transpose',
                  'unusualLineTerminators',
                  'viewportSemanticTokens',
                  'wordHighlighter',
                          'wordOperations',
                        ],
                        languages: [
                          'cpp',
                          'csharp',
                          'css',
                          'dockerfile',
                          'go',
                          'html',
                          'java',
                          'javascript',
                          'json',
                          'php',
                          'python',
                          'ruby',
                          'rust',
                          'shell',
                          'sql',
                          'typescript',
                          'yaml',
                        ]
                      })
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
})
