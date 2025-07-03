import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { FileChange } from '../../../src/aiService';
import type { DiagnosticInfo } from '../../../src/tsDiagnostics';

interface Message {
  sender: 'user' | 'ai';
  text: string;
  id: number;
  type: 'text' | 'backup' | 'info' | 'error' | 'diagnostic';
  changes?: FileChange[];
  files?: string[];
  tokenUsage?: any;
  backupFolderName?: string;
  userMessageId?: number;
  fullText?: string;
  diagnosticCount?: number;
}

interface ChatPanelProps {
  // No props needed now
}

const TokenUsageCard = ({ tokenUsage }: { tokenUsage: { usage: any, displayTypes: string[] } }) => {
  if (!tokenUsage || !tokenUsage.usage || !tokenUsage.displayTypes) return null;
  const { usage, displayTypes } = tokenUsage;
  const apiKeyToConfigKey: { [key: string]: string } = {
    promptTokenCount: 'input',
    candidatesTokenCount: 'output',
    totalTokenCount: 'total',
    thoughtsTokenCount: 'thoughts'
  };
  const filteredUsage = Object.entries(usage).filter(([apiKey]) =>
    displayTypes.includes(apiKeyToConfigKey[apiKey])
  );
  if (filteredUsage.length === 0) return null;
  return (
    <div className="token-usage-card">
      <strong>Token Usage:</strong>
      <ul>
        {filteredUsage.map(([key, value]) => (
          <li key={key}>{key}: {String(value)}</li>
        ))}
      </ul>
    </div>
  );
};

const FilesCard = ({ files }: { files?: string[] }) => {
  if (!files || files.length === 0) return null;
  return (
    <div className="files-card">
      <strong>Files Included:</strong>
      <ul>
        {files.map((file, index) => (
          <li key={index}>{file}</li>
        ))}
      </ul>
    </div>
  );
};


const AIMessageRenderer = React.memo(({ msg, onChangesParsed, historyJustLoaded }: { msg: Message, onChangesParsed: (changes: FileChange[]) => void, historyJustLoaded: boolean }) => {
  const parsedContent = useMemo(() => {
    const text = msg.text;
    const allChanges: FileChange[] = [];

    const changesStartTag = '<changes>';
    const changesEndTag = '</changes>';
    const startPos = text.indexOf(changesStartTag);
    const endPos = text.lastIndexOf(changesEndTag);

    if (startPos === -1 || endPos === -1) {
      return { segments: [{ type: 'text', content: text }], allChanges: [] };
    }

    const segments = [];
    const preContent = text.substring(0, startPos);
    if (preContent) {
      segments.push({ type: 'text', content: preContent });
    }

    const xmlText = text.substring(startPos, endPos + changesEndTag.length);

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        throw new Error(`XML parsing error: ${parserError.textContent}`);
      }

      const parsedChangesInBlock: FileChange[] = [];
      
      const fileUpdates = xmlDoc.getElementsByTagName('file_update');
      if (fileUpdates.length > 0) {
        for (const fileUpdate of Array.from(fileUpdates)) {
            const fileNode = fileUpdate.querySelector('file');
            const descriptionNode = fileUpdate.querySelector('description');
            const operationsNode = fileUpdate.querySelector('operations');

            if (fileNode && descriptionNode && operationsNode) {
                const filePath = fileNode.textContent || '';
                const description = descriptionNode.textContent || '';
                const blocks = operationsNode.getElementsByTagName('block');

                for (const block of Array.from(blocks)) {
                    const pathNode = block.querySelector('path');
                    const contentNode = block.querySelector('content');
                    
                    // New format: <path> and <content> tags
                    if (pathNode && contentNode) {
                        const blockPath = pathNode.textContent || '';
                        const content = contentNode.textContent || '';
                         if (blockPath) {
                            parsedChangesInBlock.push({
                                type: 'update',
                                file: filePath,
                                description: description,
                                blockPath: blockPath,
                                content: content,
                            });
                        }
                    } else { 
                        // Legacy format: name attribute
                        const blockPath = block.getAttribute('name');
                        const content = block.textContent;
                        if (blockPath) {
                            parsedChangesInBlock.push({
                                type: 'update',
                                file: filePath,
                                description: description,
                                blockPath: blockPath,
                                content: content || '',
                            });
                        }
                    }
                }
            }
        }
      } else {
        // FALLBACK: Legacy "full" mode parser
        const legacyChanges = xmlDoc.getElementsByTagName('change');
        for (const legacyChange of Array.from(legacyChanges)) {
          const type = legacyChange.getAttribute('type') as 'update' | 'delete';
          const file = legacyChange.querySelector('file')?.textContent || '';
          const description = legacyChange.querySelector('description')?.textContent || '';
          const content = legacyChange.querySelector('content')?.textContent ?? undefined;
          if (type && file) {
            parsedChangesInBlock.push({ type, file, description, content });
          }
        }
      }

      if (parsedChangesInBlock.length > 0) {
        segments.push({ type: 'changes-block', changes: parsedChangesInBlock });
        allChanges.push(...parsedChangesInBlock);
      } else {
        // If parsing succeeds but finds no valid changes, show the original XML
        segments.push({ type: 'text', content: xmlText });
      }

    } catch (e) {
      console.error("Error processing AI response XML:", e);
      // On error, treat the whole block as text to avoid losing information
      segments.push({ type: 'text', content: xmlText });
    }

    const postContent = text.substring(endPos + changesEndTag.length);
    if (postContent) {
      segments.push({ type: 'text', content: postContent });
    }

    return { segments, allChanges };
  }, [msg.text]);

  useEffect(() => {
    if (!historyJustLoaded) {
      onChangesParsed(parsedContent.allChanges);
    }
  }, [parsedContent.allChanges, onChangesParsed, historyJustLoaded]);

  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>
      {parsedContent.segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <React.Fragment key={index}>{segment.content}</React.Fragment>;
        }
        if (segment.type === 'changes-block') {
          if (segment.changes && segment.changes.length > 0) {
            return (
              <div key={index} className="changes-summary">
                <strong>Suggested Changes:</strong>
                <ul>
                  {segment.changes.map((change, cIndex) => (
                    <li key={cIndex}>
                      <p><strong>File:</strong> {change.file}</p>
                      <p><strong>Action:</strong> {change.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
          return (
            <div key={index} className="changes-summary">
              <strong>Suggested Changes:</strong>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
});

interface HistoryItem {
  id: string;
  title: string;
}

const ChatPanel: React.FC<ChatPanelProps> = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [cachedChanges, setCachedChanges] = useState<FileChange[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [needsSave, setNeedsSave] = useState(false);
  const [historyJustLoaded, setHistoryJustLoaded] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [diagnosticErrorCount, setDiagnosticErrorCount] = useState(0);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/history');
      const data = await response.json();
      setHistory(data);
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }
  }, []);

  useEffect(() => {
    if (showHistory) {
      fetchHistory();
    }
  }, [showHistory, fetchHistory]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (text.trim() === '') return;

    setHistoryJustLoaded(false);
    const userMessageId = Date.now();
    const aiMessageId = userMessageId + 1;

    const userMessage: Message = { id: userMessageId, sender: 'user', text, type: 'text' };
    const aiMessage: Message = { id: aiMessageId, sender: 'ai', text: '', type: 'text' };

    setCachedChanges([]);
    const newMessages = [...messages, userMessage];
    setMessages([...newMessages, aiMessage]);
    setInputValue('');
    setIsLoading(true);
    setDiagnosticErrorCount(0);

    const historyForApi = newMessages;
    await executeChatRequest(text, historyForApi, userMessageId, aiMessageId);
  }, [messages]);

  useEffect(() => {
    const globalEventSource = new EventSource('/api/events');
    
    globalEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'diagnostics-complete') {
        if (!isLoadingRef.current) {
          setDiagnosticErrorCount(data.count);
        }
      } else if (data.type === 'backup' && !data.userMessageId) {
        const backupMessage: Message = {
          id: Date.now(),
          sender: 'ai',
          type: 'backup',
          text: data.message,
          backupFolderName: data.backupFolderName
        };
        setMessages(prev => [...prev, backupMessage]);
        setNeedsSave(true);
      } else if (data.type === 'info') {
        const infoMessage: Message = {
          id: Date.now(),
          sender: 'ai',
          type: 'info',
          text: data.message,
        };
        setMessages(prev => [...prev, infoMessage]);
      }
    };
    globalEventSource.onerror = (err) => {
      console.error('Global EventSource failed:', err);
    };
    return () => {
      globalEventSource.close();
    };
  }, []);

  useEffect(() => {
    const fetchInitialDiagnostics = async () => {
      try {
        const response = await fetch('/api/project/diagnostics');
        if (response.ok) {
          const diagnostics: DiagnosticInfo[] = await response.json();
          if (!isLoadingRef.current) {
            setDiagnosticErrorCount(diagnostics.length);
          }
        }
      } catch (error) {
        console.error('Failed to fetch initial diagnostics:', error);
      }
    };

    fetchInitialDiagnostics();
  }, []);

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [messages, diagnosticErrorCount]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${scrollHeight}px`;
    }
  }, [inputValue]);

  const handleRestore = async (backupFolderName: string) => {
    if (!confirm(`您确定要将项目恢复到备份 "${backupFolderName}" 吗？当前的所有未保存更改都将丢失。`)) {
      return;
    }
    try {
      const response = await fetch('http://localhost:3001/api/project/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupFolderName }),
      });
      const data = await response.json();
      if (data.success) {
        window.dispatchEvent(new CustomEvent('project-restored'));
      } else {
        console.error('Restore failed:', data.error);
      }
    } catch (error) {
      console.error('Error during restore:', error);
    }
  };

  const handleApplyChanges = async () => {
    if (cachedChanges.length === 0) return;
    try {
      const response = await fetch('/api/files/apply-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: cachedChanges }),
      });
      if (!response.ok) throw new Error('Failed to apply changes.');
      console.log('Changes applied successfully!');
      setCachedChanges([]);
    } catch (error) {
      console.error('Error applying changes:', error);
    }
  };

  useEffect(() => {
    if (needsSave) {
      const saveHistory = async () => {
        if (messages.length === 0) {
          setNeedsSave(false);
          return;
        }
        try {
          const response = await fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, id: currentChatId || undefined }),
          });
          const data = await response.json();
          if (!currentChatId) {
            setCurrentChatId(data.id);
          }
        } catch (error) {
          console.error('Failed to save history:', error);
        } finally {
          setNeedsSave(false);
        }
      };
      saveHistory();
    }
  }, [needsSave, messages, currentChatId]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setNeedsSave(true);
  }, []);

  const executeChatRequest = async (messageText: string, historyForApi: Message[], userMessageId: number, aiMessageId: number) => {
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          history: historyForApi,
          userMessageId: userMessageId
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          handleStop();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const eventMatch = block.match(/event: (.*)/);
          const dataMatch = block.match(/data: (.*)/);

          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            switch (eventType) {
              case 'files':
                setMessages((prev) =>
                  prev.map(msg =>
                    msg.id === userMessageId
                      ? { ...msg, files: data.files, fullText: data.fullPrompt }
                      : msg
                  )
                );
                break;
              case 'backup':
                if (data.userMessageId) {
                  const backupMessage: Message = {
                    id: Date.now(),
                    sender: 'ai',
                    type: 'backup',
                    text: data.message,
                    backupFolderName: data.backupFolderName,
                    userMessageId: data.userMessageId,
                  };
                  setMessages(prev => {
                    const userMsgIndex = prev.findIndex(msg => msg.id === backupMessage.userMessageId);
                    if (userMsgIndex !== -1) {
                      return [...prev.slice(0, userMsgIndex), backupMessage, ...prev.slice(userMsgIndex)];
                    }
                    return [...prev, backupMessage];
                  });
                }
                break;
              case 'chunk':
                setMessages((prev) => prev.map(msg => msg.id === aiMessageId ? { ...msg, text: msg.text + data.content } : msg));
                break;
              case 'token':
                setMessages((prev) => prev.map(msg => msg.id === aiMessageId ? { ...msg, tokenUsage: data } : msg));
                break;
              case 'error':
                throw new Error(data.message);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Fetch aborted by user.');
      } else {
        console.error('Chat stream failed:', err);
        const errorMessage: Message = {
          id: aiMessageId,
          sender: 'ai',
          text: `Sorry, an error occurred: ${err.message}`,
          type: 'error',
          userMessageId: userMessageId,
        };
        setMessages((prev) => prev.map(msg => msg.id === aiMessageId ? errorMessage : msg));
      }
      setIsLoading(false);
      setNeedsSave(true);
    }
  };

  const handleFixErrors = async () => {
    try {
      const response = await fetch('/api/project/diagnostics');
      const diagnostics: DiagnosticInfo[] = await response.json();
      if (diagnostics.length === 0) {
        alert('No errors found!');
        setDiagnosticErrorCount(0);
        return;
      }
      
      let prompt = 'Please fix the following TypeScript errors in the project:\n\n';
      diagnostics.forEach(d => {
        prompt += `File: ${d.filePath}\n`;
        prompt += `Line ${d.lineNumber}: ${d.lineText}\n`;
        prompt += `Error: ${d.message}\n\n`;
      });

      handleSendMessage(prompt);

    } catch (error) {
      console.error('Failed to fetch diagnostics:', error);
      alert('Could not fetch project errors.');
    }
  };

  const handleRetry = async (erroringMessage: Message) => {
    const userMessageId = erroringMessage.userMessageId;
    if (!userMessageId) return;

    const userMessage = messages.find(msg => msg.id === userMessageId);
    if (!userMessage) return;

    setIsLoading(true);
    setHistoryJustLoaded(false);

    const newAiMessage: Message = { id: erroringMessage.id, sender: 'ai', text: '', type: 'text' };
    setMessages(prev => prev.map(msg => msg.id === erroringMessage.id ? newAiMessage : msg));

    const userMessageIndex = messages.findIndex(msg => msg.id === userMessageId);
    if (userMessageIndex === -1) return;
    const historyForApi = messages.slice(0, userMessageIndex + 1);

    await executeChatRequest(userMessage.text, historyForApi, userMessage.id, erroringMessage.id);
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(inputValue);
    }
  };

  const handleNewChat = () => {
    handleStop();
    setMessages([]);
    setCurrentChatId(null);
  };

  const handleRenameHistory = async (id: string, currentTitle: string) => {
    const newTitle = prompt('Enter new title:', currentTitle);
    if (newTitle && newTitle.trim() !== '') {
      try {
        await fetch(`/api/history/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        fetchHistory();
      } catch (error) {
        console.error('Failed to rename history:', error);
      }
    }
  };

  const handleDeleteHistory = async (id: string) => {
    if (confirm('Are you sure you want to delete this chat history?')) {
      try {
        await fetch(`/api/history/${id}`, {
          method: 'DELETE',
        });
        fetchHistory();
      } catch (error) {
        console.error('Failed to delete history:', error);
      }
    }
  };

  const handleStartEdit = (message: Message) => {
    setEditingMessageId(message.id);
    setEditingText(message.text);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingText('');
  };

  const handleSaveEdit = () => {
    if (editingMessageId === null) return;

    setMessages(prevMessages =>
      prevMessages.map(msg => {
        if (msg.id === editingMessageId) {
          const instructionRegex = /---User Instruction---([\s\S]*)/;
          const newFullText = msg.fullText
            ? msg.fullText.replace(instructionRegex, `---User Instruction---\n${editingText}`)
            : '';
          return { ...msg, text: editingText, fullText: newFullText };
        }
        return msg;
      })
    );

    setEditingMessageId(null);
    setEditingText('');
    setNeedsSave(true);
  };

  const handleDeleteMessage = (messageIdToDelete: number) => {
    setMessages(prevMessages => prevMessages.filter(message => message.id !== messageIdToDelete));
    setNeedsSave(true);
  };

  const handleLoadHistory = async (id: string) => {
    handleStop();
    setIsLoading(false);
    try {
      const response = await fetch(`/api/history/${id}`);
      const data = await response.json();
      setMessages(data.messages);
      setCurrentChatId(data.id);
      setShowHistory(false);
      setCachedChanges([]);
      setHistoryJustLoaded(true);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  };

  return (
    <>
      <div className="chat-panel-header">
        <h2>AI Chat</h2>
        <div className="chat-header-buttons">
          <button title="New Chat" className="header-button new-chat-button" onClick={handleNewChat}>+</button>
          <button title="History" className="header-button history-button" onClick={() => setShowHistory(!showHistory)}>☰</button>
        </div>
      </div>
      {showHistory && (
        <div className="history-panel">
          <h3>History</h3>
          <ul>
            {history.map((item) => (
              <li key={item.id} >
                <span className="history-item-title" onClick={() => handleLoadHistory(item.id)}>
                  {item.title}
                </span>
                <div className="history-item-buttons">
                  <button onClick={() => handleRenameHistory(item.id, item.title)} title="Rename">✏️</button>
                  <button onClick={() => handleDeleteHistory(item.id)} title="Delete">🗑️</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="chat-panel-container">
        <div ref={chatHistoryRef} className="chat-history">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="message-wrapper"
              onMouseEnter={() => setHoveredMessageId(msg.id)}
              onMouseLeave={() => setHoveredMessageId(null)}
            >
              <div className={`message ${msg.sender}-message`}>
                <div className="message-bubble">
                  {(() => {
                    if (msg.type === 'backup') {
                      return (
                        <div>
                          <p>{msg.text}</p>
                          {msg.backupFolderName && (
                            <button onClick={() => handleRestore(msg.backupFolderName!)} style={{ marginLeft: '10px', cursor: 'pointer' }}>
                              恢复到此版本
                            </button>
                          )}
                        </div>
                      );
                    }
                    if (msg.sender === 'ai') {
                      if (msg.type === 'error') {
                        return (
                          <div>
                            <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                            {msg.userMessageId && (
                              <button onClick={() => handleRetry(msg)} style={{ marginLeft: '10px', cursor: 'pointer' }}>
                                Retry
                              </button>
                            )}
                          </div>
                        );
                      }
                      return <AIMessageRenderer msg={msg} onChangesParsed={setCachedChanges} historyJustLoaded={historyJustLoaded} />;
                    }
                    if (editingMessageId === msg.id) {
                      return (
                        <div className="edit-container">
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="edit-textarea"
                            rows={Math.max(3, editingText.split('\n').length)}
                          />
                          <div className="edit-buttons">
                            <button onClick={handleSaveEdit}>Save</button>
                            <button onClick={handleCancelEdit}>Cancel</button>
                          </div>
                        </div>
                      );
                    }
                    return <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>;
                  })()}
                  {editingMessageId !== msg.id && msg.sender === 'user' && <FilesCard files={msg.files} />}
                  {editingMessageId !== msg.id && msg.sender === 'ai' && msg.type !== 'backup' && <TokenUsageCard tokenUsage={msg.tokenUsage} />}
                </div>
              </div>
              {hoveredMessageId === msg.id && !editingMessageId && (
                <div className={`message-actions ${msg.sender === 'user' ? 'message-actions-user' : 'message-actions-ai'}`}>
                  {msg.sender === 'user' && (
                    <button
                      onClick={() => handleStartEdit(msg)}
                      className="action-button"
                      title="Edit message"
                    >
                      ✏️
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteMessage(msg.id)}
                    className="action-button"
                    title="Delete message"
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="message ai-message">
              <div className="message-bubble">
                <div className="typing-indicator"><span></span><span></span><span></span></div>
              </div>
            </div>
          )}
          {!isLoading && diagnosticErrorCount > 0 && (
            <div className="message ai-message">
              <div className="message-bubble">
                <p>在项目中发现 {diagnosticErrorCount} 个 TypeScript 错误。</p>
                <button onClick={handleFixErrors} style={{ marginLeft: '10px', cursor: 'pointer' }}>
                  修复错误
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="chat-input-form">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            className="chat-input"
            placeholder="Type your message..."
            disabled={isLoading}
            rows={1}
            style={{
              resize: 'none',
              overflowY: 'auto',
              maxHeight: '150px',
            }}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={handleStop}
              className="send-button stop-button"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSendMessage(inputValue)}
              className="send-button"
            >
              Send
            </button>
          )}
          {!isLoading && cachedChanges.length > 0 && (
            <button
              type="button"
              onClick={handleApplyChanges}
              className="apply-changes-button"
            >
              Apply Changes
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default ChatPanel;