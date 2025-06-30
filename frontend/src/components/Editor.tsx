import React from 'react';

interface EditorProps {
  fileContent: string | null;
}

const Editor: React.FC<EditorProps> = ({ fileContent }) => {
  const lines = fileContent ? fileContent.split('\n') : [];
  return (
    <div className="editor-content">
      {fileContent !== null ? (
        <div className="editor-wrapper">
          <div className="line-numbers" aria-hidden="true">
            {lines.map((_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
          <pre><code>{fileContent}</code></pre>
        </div>
      ) : (
        <div className="editor-placeholder">
          <p>Select a file from the list to view its content.</p>
        </div>
      )}
    </div>
  );
};

export default Editor;