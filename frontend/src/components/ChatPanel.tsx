import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { FileChange } from '../../../src/aiService';

interface Message {
  sender: 'user' | 'ai';
  text: string;
  id: number; // ID is now mandatory
  changes?: FileChange[];
  files?: string[]; // For user messages
  tokenUsage?: any; // For AI messages
}

interface ChatPanelProps {
  // No props needed now
}

const TokenUsageCard = ({ tokenUsage }: { tokenUsage: { usage: any, displayTypes: string[] } }) => {
  if (!tokenUsage || !tokenUsage.usage || !tokenUsage.displayTypes) return null;

  const { usage, displayTypes } = tokenUsage;

  // Map API keys to the keys used in config.jsonc for filtering
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

const AIMessageRenderer = React.memo(({ msg, onChangesParsed }: { msg: Message, onChangesParsed: (changes: FileChange[]) => void }) => {

  const parsedContent = useMemo(() => {
    const text = msg.text;
    const segments = [];
    const allChanges: FileChange[] = [];

    const changesStartTag = '<changes>';
    const changesEndTag = '</changes>';

    const startPos = text.indexOf(changesStartTag);

    // If there's no <changes> block, it's all just text.
    if (startPos === -1) {
      segments.push({ type: 'text', content: text });
      return { segments, allChanges };
    }

    // --- Text before the changes block ---
    segments.push({ type: 'text', content: text.substring(0, startPos) });

    const endPos = text.indexOf(changesEndTag, startPos);

    // Determine the content within the <changes> block
    const changesContent = text.substring(startPos + changesStartTag.length, endPos === -1 ? text.length : endPos);

    // --- The changes block itself ---
    const changeRegex = /<change type="(update|delete)">\s*<file>([\s\S]*?)<\/file>\s*<description>([\s\S]*?)<\/description>([\s\S]*?)<\/change>/g;
    let match;
    const parsedChangesInBlock: FileChange[] = [];

    while ((match = changeRegex.exec(changesContent)) !== null) {
      const [, type, file, description, innerContent] = match;
      const contentTag = /<content><!\[CDATA\[([\s\S]*?)\]\]><\/content>/;
      const contentMatch = innerContent.match(contentTag);
      const content = contentMatch ? contentMatch[1] : undefined;
      
      const change: FileChange = { type: type as 'update' | 'delete', file, description, content };
      parsedChangesInBlock.push(change);
    }
    
    // Add the single changes block segment
    segments.push({ type: 'changes-block', changes: parsedChangesInBlock });
    allChanges.push(...parsedChangesInBlock);

    // --- Text after the changes block (if it's closed) ---
    if (endPos !== -1) {
      segments.push({ type: 'text', content: text.substring(endPos + changesEndTag.length) });
    }

    return { segments, allChanges };
  }, [msg.text]);

  useEffect(() => {
    onChangesParsed(parsedContent.allChanges);
  }, [parsedContent.allChanges, onChangesParsed]);

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
          // Render a header if the block has started but no changes are parsed yet
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

const ChatPanel: React.FC<ChatPanelProps> = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [cachedChanges, setCachedChanges] = useState<FileChange[]>([]);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [messages]);

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

  const handleSendMessage = async () => {
    if (inputValue.trim() === '') return;

    const userMessageId = Date.now();
    const aiMessageId = userMessageId + 1;

    const userMessage: Message = { id: userMessageId, sender: 'user', text: inputValue };
    const aiMessage: Message = { id: aiMessageId, sender: 'ai', text: '' };

    setCachedChanges([]);
    setMessages((prevMessages) => [...prevMessages, userMessage, aiMessage]);
    setInputValue('');
    setIsLoading(true);

    const eventSource = new EventSource(`/api/ai/chat?message=${encodeURIComponent(inputValue)}`);

    eventSource.addEventListener('files', (event) => {
        const data = JSON.parse(event.data);
        setMessages((prevMessages) => prevMessages.map(msg =>
            msg.id === userMessageId ? { ...msg, files: data.files } : msg
        ));
    });

    eventSource.addEventListener('chunk', (event) => {
      const data = JSON.parse(event.data);
      setMessages((prevMessages) => prevMessages.map(msg =>
        msg.id === aiMessageId ? { ...msg, text: msg.text + data.content } : msg
      ));
    });

    eventSource.addEventListener('token', (event) => {
        const data = JSON.parse(event.data); // data now contains { usage, displayTypes }
        setMessages((prevMessages) => prevMessages.map(msg =>
            msg.id === aiMessageId ? { ...msg, tokenUsage: data } : msg
        ));
    });

    eventSource.addEventListener('done', () => {
      eventSource.close();
      setIsLoading(false);
    });

    eventSource.onerror = (err) => {
      console.error('EventSource failed:', err);
      const errorMessage: Message = {
        id: aiMessageId,
        sender: 'ai',
        text: 'Sorry, something went wrong. Please try again.',
      };
      setMessages((prevMessages) => prevMessages.map(msg => msg.id === aiMessageId ? errorMessage : msg));
      eventSource.close();
      setIsLoading(false);
    };
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="chat-panel-container">
      <div ref={chatHistoryRef} className="chat-history">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.sender}-message`}>
            <div className="message-bubble">
              {msg.sender === 'ai' ? (
                <AIMessageRenderer msg={msg} onChangesParsed={setCachedChanges} />
              ) : (
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
              )}
              {msg.sender === 'user' && <FilesCard files={msg.files} />}
              {msg.sender === 'ai' && <TokenUsageCard tokenUsage={msg.tokenUsage} />}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message ai-message">
            <div className="message-bubble">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
            </div>
          </div>
        )}
      </div>
      <div className="chat-input-form">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          className="chat-input"
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button
          type="button"
          onClick={handleSendMessage}
          disabled={isLoading}
          className="send-button"
        >
          Send
        </button>
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
  );
};

export default ChatPanel;