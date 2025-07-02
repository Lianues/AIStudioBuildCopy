import React, { useRef, useEffect } from 'react';
import * as monaco from 'monaco-editor';

interface EditorProps {
  fileContent: string | null;
  filePath: string;
  onContentChange: (newContent: string) => void;
}

const Editor: React.FC<EditorProps> = ({ fileContent, filePath, onContentChange }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const contentChangeSubscription = useRef<monaco.IDisposable | null>(null);

  // Runs ONCE when the component mounts to create the editor and set up TS.
  useEffect(() => {
    // 1. Configure TypeScript language service to show diagnostics
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
    });

    // 2. Create the editor instance
    if (divRef.current) {
      editorRef.current = monaco.editor.create(divRef.current, {
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: true },
      });
    }

    // 3. Cleanup on component unmount
    return () => {
      editorRef.current?.dispose();
    };
  }, []); // Empty dependency array ensures this runs only once.

  // Runs whenever fileContent or filePath changes to update the model.
  useEffect(() => {
    const editor = editorRef.current;
    // Ensure editor instance and file content are ready
    if (editor && fileContent !== null) {
      const modelUri = monaco.Uri.parse(filePath || 'default.txt');
      let model = monaco.editor.getModel(modelUri);

      if (model && model.getValue() !== fileContent) {
        // If model exists and content is different, update its value.
        model.setValue(fileContent);
      } else if (!model) {
        // Otherwise, create a new model.
        model = monaco.editor.createModel(fileContent, undefined, modelUri);
      }
      
      if (editor.getModel() !== model) {
        editor.setModel(model);
      }

      // Detach any existing listener before attaching a new one
      contentChangeSubscription.current?.dispose();
      
      // Listen for content changes and report them back to the parent
      contentChangeSubscription.current = editor.onDidChangeModelContent(() => {
        onContentChange(editor.getValue());
      });
    }
  }, [fileContent, filePath, onContentChange]);

  return (
    <div className="editor-content" style={{ height: '100%', width: '100%', position: 'relative' }}>
      <div 
        ref={divRef} 
        style={{ 
          height: '100%', 
          width: '100%', 
          visibility: fileContent !== null ? 'visible' : 'hidden' 
        }} 
      />
      {fileContent === null && (
        <div className="editor-placeholder" style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <p>Select a file from the list to view its content.</p>
        </div>
      )}
    </div>
  );
};

export default Editor;