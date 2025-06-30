import express, { RequestHandler } from 'express';
import cors from 'cors';
import { getProjectStructure, getFileContent } from './projectReader';
import * as path from 'path';
import * as aiService from './aiService';
import { applyChanges } from './changeApplier';
import { restoreBackup } from './archiver';
import { watch } from 'chokidar';
import SSE from 'express-sse';
import killPort from 'kill-port';
import detectPort from 'detect-port';

const app = express();
const port = 3001;
const sse = new SSE();

app.use(cors());
app.use(express.json());

app.get('/api/events', sse.init);

const projectDir = path.resolve(__dirname, '..', 'project');

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

const aiChatHandler: RequestHandler = async (req, res) => {
  const message = req.query.message as string;
  const userMessageId = Number(req.query.userMessageId);

  if (!message || !userMessageId) {
    res.status(400).json({ error: 'Message is required' });
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
    const stream = aiService.generateChatResponseStream(message, projectDir, userMessageId);
    for await (const event of stream) {
      // Act as a simple proxy, forwarding events to the client.
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

app.get('/api/ai/chat', aiChatHandler);

const applyChangesHandler: RequestHandler = async (req, res) => {
  const { changes } = req.body;

  if (!changes || !Array.isArray(changes)) {
    res.status(400).json({ error: 'Invalid changes format' });
    return;
  }

  try {
    const { appliedChanges, backupCreated, backupFolderName } = await applyChanges(changes, projectDir);
    if (backupCreated && backupFolderName) {
      sse.send({ type: 'backup', message: `AI 修改已应用并存档于 ${backupFolderName}`, backupFolderName: backupFolderName });
    }
    res.json({ success: true, message: 'Changes applied successfully.', appliedChanges });
  } catch (error) {
    console.error('Failed to apply changes:', error);
    res.status(500).json({ error: 'Failed to apply changes' });
  }
};

app.post('/api/files/apply-changes', applyChangesHandler);

const restoreBackupHandler: RequestHandler = async (req, res) => {
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

  // For nodemon restarts
  process.once('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

  // For app termination
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGBREAK', () => gracefulShutdown('SIGBREAK'));
}

startServer();