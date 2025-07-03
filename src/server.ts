import express, { RequestHandler } from 'express';
import cors from 'cors';
import { getProjectStructure, getFileContent } from './projectReader';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import * as aiService from './aiService';
import { applyChanges } from './changeApplier';
import { restoreBackup } from './archiver';
import { getProjectDiagnostics } from './tsDiagnostics';
import { watch } from 'chokidar';
import SSE from 'express-sse';
import killPort from 'kill-port';
import detectPort from 'detect-port';

const app = express();
const port = 3001;
const sse = new SSE();

app.use(cors());
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ limit: '10gb', extended: true }));

app.get('/api/events', sse.init);

const rootDir = path.resolve(__dirname, '..');
const projectDir = path.join(rootDir, 'project');
const historyDir = path.join(rootDir, 'history');

// Ensure history directory exists
fs.mkdir(historyDir, { recursive: true });

const saveHistoryHandler: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { messages, id: existingId } = req.body;
    if (!messages) {
      res.status(400).json({ error: 'Messages are required' });
      return;
    }
    
    const id = existingId || uuidv4();
    const filePath = path.join(historyDir, `${id}.json`);
    
    const firstUserMessage = messages.find((m: any) => m.sender === 'user');
    const title = firstUserMessage ? firstUserMessage.text.substring(0, 50) : 'New Chat';

    await fs.writeFile(filePath, JSON.stringify({ id, title, messages }, null, 2));
    res.status(201).json({ id });
  } catch (error) {
    console.error('Failed to save history:', error);
    res.status(500).json({ error: 'Failed to save history' });
  }
};

app.post('/api/history', saveHistoryHandler);

const getHistoryListHandler: RequestHandler = async (req, res): Promise<void> => {
  try {
    const files = await fs.readdir(historyDir);
    const histories = await Promise.all(
      files
        .filter(file => file.endsWith('.json'))
        .map(async (file) => {
          const content = await fs.readFile(path.join(historyDir, file), 'utf-8');
          const { id, title } = JSON.parse(content);
          return { id, title: title || 'New Chat' };
        })
    );
    res.json(histories.reverse());
  } catch (error) {
    console.error('Failed to get history list:', error);
    res.status(500).json({ error: 'Failed to get history list' });
  }
};

app.get('/api/history', getHistoryListHandler);

const getHistoryByIdHandler: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const filePath = path.join(historyDir, `${id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (error) {
    console.error('Failed to get history:', error);
    res.status(404).json({ error: 'History not found' });
  }
};

app.get('/api/history/:id', getHistoryByIdHandler);

const renameHistoryHandler: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }
    const filePath = path.join(historyDir, `${id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    data.title = title;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to rename history:', error);
    res.status(500).json({ error: 'Failed to rename history' });
  }
};

app.patch('/api/history/:id', renameHistoryHandler);

const deleteHistoryHandler: RequestHandler = async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const filePath = path.join(historyDir, `${id}.json`);
    await fs.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete history:', error);
    res.status(500).json({ error: 'Failed to delete history' });
  }
};

app.delete('/api/history/:id', deleteHistoryHandler);

app.get('/api/project/files', async (req, res) => {
  try {
    const files = await getProjectStructure(projectDir);
    res.json(files);
  } catch (error) {
    console.error('Failed to get project structure:', error);
    res.status(500).json({ error: 'Failed to read project files' });
  }
});

app.get('/api/files/content', async (req, res) => {
  const relativePath = req.query.path as string;

  if (!relativePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const absolutePath = path.resolve(projectDir, relativePath);
    const content = await getFileContent(absolutePath);
    res.type('text/plain').send(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else {
      console.error(`Failed to read file content for ${relativePath}:`, error);
      res.status(500).json({ error: 'Failed to read file content' });
    }
  }
});

app.post('/api/files/content', async (req, res): Promise<void> => {
  const { path: relativePath, content } = req.body;

  if (!relativePath || content === undefined) {
    res.status(400).json({ error: 'File path and content are required' });
    return;
  }

  try {
    const absolutePath = path.resolve(projectDir, relativePath);
    await fs.writeFile(absolutePath, content, 'utf-8');
    res.json({ success: true, message: 'File saved successfully.' });
  } catch (error) {
    console.error(`Failed to write file ${relativePath}:`, error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

app.delete('/api/files/content', async (req, res): Promise<void> => {
  const relativePath = req.query.path as string;

  if (!relativePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const absolutePath = path.resolve(projectDir, relativePath);
    await fs.unlink(absolutePath);
    res.json({ success: true, message: 'File deleted successfully.' });
  } catch (error) {
    console.error(`Failed to delete file ${relativePath}:`, error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

const aiChatHandler: RequestHandler = async (req, res): Promise<void> => {
  const { message, history, userMessageId } = req.body;

  if (!message || !userMessageId || !history) {
    res.status(400).json({ error: 'Message, history, and userMessageId are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event: string, data: object) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Determine if this is the first message of a new chat session
    const isFirstMessage = history.length === 1;
    const stream = aiService.generateChatResponseStream(message, projectDir, userMessageId, history, rootDir, isFirstMessage);
    for await (const event of stream) {
      sendEvent(event.type, event);
    }
  } catch (error) {
    console.error('AI chat stream error:', error);
    sendEvent('error', { message: 'Failed to interact with AI service' });
  } finally {
    sendEvent('done', {});
    res.end();
  }
};

app.post('/api/ai/chat', aiChatHandler);

const applyChangesHandler: RequestHandler = async (req, res): Promise<void> => {
  const { changes } = req.body;

  if (!changes || !Array.isArray(changes)) {
    res.status(400).json({ error: 'Invalid changes format' });
    return;
  }

  try {
    const { appliedChanges, backupCreated, backupFolderName } = await applyChanges(changes, projectDir);
    
    // Send success response FIRST, to unblock the frontend UI
    res.json({ success: true, message: 'Changes applied successfully.', appliedChanges });

    // THEN, perform non-blocking post-change actions
    if (backupCreated && backupFolderName) {
      sse.send({ type: 'backup', message: `AI 修改已应用并存档于 ${backupFolderName}`, backupFolderName: backupFolderName });
    }
    
    // Run diagnostics AFTER the response has been sent
    if (appliedChanges.length > 0) {
        runDiagnosticsAndNotify();
    }

  } catch (error) {
    console.error('Failed to apply changes:', error);
    // Ensure a response is sent even on error
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to apply changes' });
    }
  }
};

app.post('/api/files/apply-changes', applyChangesHandler);

const restoreBackupHandler: RequestHandler = async (req, res): Promise<void> => {
  const { backupFolderName } = req.body;

  if (!backupFolderName) {
    res.status(400).json({ error: 'backupFolderName is required' });
    return;
  }

  try {
    await restoreBackup(projectDir, backupFolderName);
    res.json({ success: true, message: `Project restored from ${backupFolderName}` });
  } catch (error) {
    console.error(`Failed to restore backup ${backupFolderName}:`, error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
};

app.post('/api/project/restore', restoreBackupHandler);

app.get('/', (req, res) => {
  res.json({ message: 'API server is running' });
});

let latestDiagnostics: any[] = [];

async function runDiagnosticsAndNotify() {
  try {
    console.log('Running TypeScript diagnostics...');
    latestDiagnostics = await getProjectDiagnostics(projectDir);
    console.log(`Diagnostics complete. Found ${latestDiagnostics.length} issues.`);
    sse.send({ type: 'diagnostics-complete', count: latestDiagnostics.length });
  } catch (error) {
    console.error('Failed to run diagnostics:', error);
  }
}

app.get('/api/project/diagnostics', (req, res) => {
  res.json(latestDiagnostics);
});

async function startServer() {
  const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });

  const watcher = watch(projectDir, {
    persistent: true,
    ignoreInitial: true,
  });

  const sendSseEvent = (event: string, absolutePath: string) => {
    const relativePath = path.relative(projectDir, absolutePath).replace(/\\/g, '/');
    sse.send({ event: `file:${event}`, path: relativePath });
  };

  watcher
    .on('add', (absolutePath) => sendSseEvent('add', absolutePath))
    .on('addDir', (absolutePath) => sendSseEvent('add', absolutePath))
    .on('change', (absolutePath) => sendSseEvent('change', absolutePath))
    .on('unlink', (absolutePath) => sendSseEvent('unlink', absolutePath))
    .on('unlinkDir', (absolutePath) => sendSseEvent('unlink', absolutePath));

  const gracefulShutdown = (signal: string) => {
    console.log(`Received ${signal}. Shutting down...`);
    watcher.close();
    server.close(() => {
      process.exit(0);
    });
  };

  process.once('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGBREAK', () => gracefulShutdown('SIGBREAK'));

  // Initial diagnostics run
  runDiagnosticsAndNotify();
}

startServer();