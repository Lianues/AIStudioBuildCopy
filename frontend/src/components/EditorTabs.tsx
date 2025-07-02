import React from 'react';
import './EditorTabs.css';

interface EditorTabsProps {
  openFiles: string[];
  activeFile: string | null;
  onTabClick: (file: string) => void;
  onTabClose: (file: string) => void;
}

const EditorTabs: React.FC<EditorTabsProps> = ({ openFiles, activeFile, onTabClick, onTabClose }) => {
  if (openFiles.length === 0) {
    return null;
  }

  return (
    <div className="editor-tabs">
      {openFiles.map(file => (
        <div
          key={file}
          className={`editor-tab ${file === activeFile ? 'active' : ''}`}
          onClick={() => onTabClick(file)}
        >
          <span className="tab-name">{file.split('/').pop()}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation(); // Prevent tab click when closing
              onTabClose(file);
            }}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
};

export default EditorTabs;