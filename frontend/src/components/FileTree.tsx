import React, { useState, useEffect } from 'react';

export interface TreeNode {
  name: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
  path: string;
}


interface FileNodeProps {
  node: TreeNode;
  onToggle: (path: string) => void;
  onFileSelect: (path: string) => void;
  expanded: { [key: string]: boolean };
  path: string;
  selectedFile: string;
}

const FileNode: React.FC<FileNodeProps> = ({ node, onToggle, onFileSelect, expanded, path, selectedFile }) => {
  const isExpanded = expanded[path];
  
  let isActive = false;
  if (selectedFile) {
    if (node.type === 'directory') {
      isActive = selectedFile.startsWith(node.path + '/');
    } else {
      isActive = selectedFile === node.path;
    }
  }
  const nodeClassName = `file-node ${isActive ? 'active' : ''}`;

  const handleClick = () => {
    if (node.type === 'directory') {
      onToggle(path);
    } else {
      onFileSelect(path);
    }
  };

  return (
    <div className="file-node-container">
      <div onClick={handleClick} className={nodeClassName}>
        <span className="file-icon">{node.type === 'directory' ? (isExpanded ? '📂' : '📁') : '📄'}</span>
        <span className="file-name">{node.name}</span>
      </div>
      {node.type === 'directory' && isExpanded && node.children && (
        <div className="file-node-children">
          {node.children.map((child) => (
            <FileNode
              key={child.path}
              node={child}
              onToggle={onToggle}
              onFileSelect={onFileSelect}
              expanded={expanded}
              path={child.path}
              selectedFile={selectedFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface FileTreeProps {
  files: TreeNode[];
  loading: boolean;
  error: string | null;
  onFileSelect: (path: string) => void;
  selectedFile: string;
}

const FileTree: React.FC<FileTreeProps> = ({ files, loading, error, onFileSelect, selectedFile }) => {
  const [expanded, setExpanded] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    if (selectedFile) {
      const parts = selectedFile.split('/');
      const newExpanded: { [key: string]: boolean } = {};
      // Expand all parent directories of the selected file
      for (let i = 1; i < parts.length; i++) {
        const path = parts.slice(0, i).join('/');
        newExpanded[path] = true;
      }
      setExpanded(prev => ({ ...prev, ...newExpanded }));
    }
  }, [selectedFile]);

  const handleToggle = (path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const renderTree = (nodes: TreeNode[]) => {
    // The buildFileTree function is now in the parent, so we just render the nodes.
    return nodes.map((node) => {
      return (
        <FileNode
          key={node.path}
          node={node}
          onToggle={handleToggle}
          onFileSelect={onFileSelect}
          expanded={expanded}
          path={node.path}
          selectedFile={selectedFile}
        />
      );
    });
  };

  if (loading) return <div className="file-tree-status">Loading...</div>;
  if (error) return <div className="file-tree-status">Error: {error}</div>;

  return <div className="file-tree-container">{renderTree(files)}</div>;
};

export default FileTree;