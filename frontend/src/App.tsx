import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css'
import FileTree from './components/FileTree';
import type { TreeNode } from './components/FileTree';
import Editor from './components/Editor';
import ChatPanel from './components/ChatPanel';

function App() {
  const [files, setFiles] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;

  const fetchFiles = useCallback(async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) {
      setLoading(true);
    }
    try {
      const response = await fetch('/api/project/files', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      setFiles(data);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      if (!isBackgroundRefresh) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleFileSelect = useCallback(async (path: string) => {
    setSelectedFile(path);
    try {
      const response = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to fetch file content');
      }
      const content = await response.text();
      setFileContent(content);
    } catch (error) {
      console.error('Error fetching file content:', error);
      setFileContent('Error loading file content.');
    }
  }, []);

  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Refresh file list on any change, but do not automatically select.
      if (data.event === 'file:add' || data.event === 'file:unlink' || data.event === 'file:change') {
        fetchFiles(true);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [fetchFiles, handleFileSelect]);

  return (
    <div className="app-container">
      <div className="panel file-tree-panel">
        <h2>Files</h2>
        <FileTree files={files} loading={loading} error={error} onFileSelect={handleFileSelect} selectedFile={selectedFile} />
      </div>
      <div className="panel editor-panel">
        <h2>Editor</h2>
        <Editor fileContent={fileContent} />
      </div>
      <div className="panel chat-panel">
        <h2>AI Chat</h2>
        <ChatPanel />
      </div>
    </div>
  );
}

export default App
