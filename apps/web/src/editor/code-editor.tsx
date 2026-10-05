import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { useEffect } from 'react';
import { useTheme } from '@/components/theme/theme-provider';
import { codeDeclarations } from './code-declarations';

// Monaco empacotado localmente (sem CDN), com os workers do Vite (spec 005, plan §10).
self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker(),
};
loader.config({ monaco });

const js = monaco.typescript.javascriptDefaults;
js.setCompilerOptions({
  allowJs: true,
  checkJs: false,
  target: monaco.typescript.ScriptTarget.ES2020,
});
// O código é o corpo de uma função assíncrona: `return` e `await` no nível de cima são válidos.
js.setDiagnosticsOptions({ diagnosticCodesToIgnore: [1108, 1375, 1378] });

let extraLib: monaco.IDisposable | undefined;

/** Editor JavaScript do nó de código (spec 005, FR-012). */
export default function CodeEditor({
  value,
  onChange,
  readOnly,
  nodeNames,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  nodeNames: string[];
  testId: string;
}) {
  const { theme } = useTheme();
  useEffect(() => {
    extraLib?.dispose();
    extraLib = js.addExtraLib(codeDeclarations(nodeNames), 'file:///olly-variaveis.d.ts');
  }, [nodeNames]);
  const onMount: OnMount = (editor) => {
    editor.updateOptions({ tabSize: 2 });
  };
  return (
    <div data-testid={testId} className="overflow-hidden rounded-md border">
      <Editor
        height="320px"
        language="javascript"
        // Caminho com `.js`: o worker do TypeScript trata o modelo como arquivo JavaScript.
        path={`file:///${testId}.js`}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        value={value}
        onMount={onMount}
        onChange={(v) => {
          onChange(v ?? '');
        }}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          // Com EditContext, o foco não fica num campo de texto e atalhos do canvas (ex.: espaço
          // do React Flow) capturam as teclas.
          editContext: false,
          // Sugere os nomes dos nós dentro de `$('...')`.
          quickSuggestions: { other: true, comments: false, strings: true },
        }}
      />
    </div>
  );
}
