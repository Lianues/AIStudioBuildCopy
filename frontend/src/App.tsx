import { useState, useEffect, useCallback } from 'react';
import './App.css';
import FileTree from './components/FileTree';
import type { TreeNode } from './components/FileTree';
import Editor from './components/Editor';
import ChatPanel from './components/ChatPanel';
import EditorTabs from './components/EditorTabs';

function App() {
  const [files, setFiles] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // New state management for tabs and editor content
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});

  const fetchFiles = useCallback(async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) setLoading(true);
    try {
      const response = await fetch('/api/project/files', { cache: 'no-store' });
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      setFiles(data);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      if (!isBackgroundRefresh) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleFileSelect = useCallback(async (path: string) => {
    if (!openFiles.includes(path)) {
      setOpenFiles(prev => [...prev, path]);
    }

    try {
      const response = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to fetch file content');
      const content = await response.text();
      setFileContents(prev => ({ ...prev, [path]: content }));
    } catch (error) {
      console.error('Error fetching file content:', error);
      setFileContents(prev => ({ ...prev, [path]: 'Error loading file content.' }));
    }
    
    setActiveFile(path);
  }, [openFiles]);

  const handleTabClick = (path: string) => {
    setActiveFile(path);
  };

  const handleTabClose = (path: string) => {
    setOpenFiles(prev => prev.filter(file => file !== path));
    setFileContents(prev => {
      const newContents = { ...prev };
      delete newContents[path];
      return newContents;
    });

    if (activeFile === path) {
      const remainingFiles = openFiles.filter(file => file !== path);
      setActiveFile(remainingFiles.length > 0 ? remainingFiles[remainingFiles.length - 1] : null);
    }
  };

  const handleContentChange = (newContent: string) => {
    if (activeFile) {
      setFileContents(prev => ({ ...prev, [activeFile]: newContent }));
    }
  };

  const handleSaveFile = async () => {
    if (!activeFile || fileContents[activeFile] === undefined) {
      console.error('No active file or content to save.');
      return;
    }
    try {
      const response = await fetch('/api/files/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFile, content: fileContents[activeFile] }),
      });
      if (!response.ok) throw new Error('Failed to save file');
      alert('File saved successfully!');
    } catch (error) {
      console.error('Error saving file:', error);
      alert('Error saving file.');
    }
  };

  const handleDeleteFile = async () => {
    if (!activeFile) {
      alert('No file selected to delete.');
      return;
    }
    if (confirm(`Are you sure you want to delete ${activeFile}?`)) {
      try {
        const response = await fetch(`/api/files/content?path=${encodeURIComponent(activeFile)}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error('Failed to delete file');
        handleTabClose(activeFile); // Close the tab after deletion
        fetchFiles(true); // Refresh the file tree
        alert('File deleted successfully!');
      } catch (error) {
        console.error('Error deleting file:', error);
        alert('Error deleting file.');
      }
    }
  };

  // Enhanced event handling for real-time file content updates
  useEffect(() => {
    const eventSource = new EventSource('/api/events');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Refresh file tree on any file event
      if (data.event && data.event.startsWith('file:')) {
        fetchFiles(true);
      }

      // If a changed file is currently open, refresh its content
      if (data.event === 'file:change' && data.path && openFiles.includes(data.path)) {
        const fetchContent = async () => {
          try {
            const response = await fetch(`/api/files/content?path=${encodeURIComponent(data.path)}`, { cache: 'no-store' });
            if (response.ok) {
              const content = await response.text();
              setFileContents(prev => ({ ...prev, [data.path]: content }));
            }
          } catch (error) {
            console.error(`Failed to auto-refresh content for ${data.path}:`, error);
          }
        };
        fetchContent();
      }
    };
    return () => eventSource.close();
  }, [fetchFiles, openFiles]);

  const activeFileContent = activeFile ? fileContents[activeFile] : null;

  return (
    <div className="app-container">
      <div className="panel file-tree-panel">
        <h2>Files</h2>
        <FileTree files={files} loading={loading} error={error} onFileSelect={handleFileSelect} selectedFile={activeFile} />
      </div>
      <div className="panel editor-panel">
        <div className="editor-toolbar">
          <EditorTabs
            openFiles={openFiles}
            activeFile={activeFile}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
          />
          <div className="editor-actions">
            <button onClick={handleSaveFile} disabled={!activeFile}>Save</button>
            <button onClick={handleDeleteFile} disabled={!activeFile}>Delete</button>
          </div>
        </div>
        <Editor
          filePath={activeFile || ''}
          fileContent={activeFileContent}
          onContentChange={handleContentChange}
        />
      </div>
      <div className="panel chat-panel">
        <ChatPanel />
      </div>
    </div>
  );
}

export default App;
