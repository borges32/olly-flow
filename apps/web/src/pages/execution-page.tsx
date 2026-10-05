import type { WorkflowDetail } from '@olly/shared-types';
import { ReactFlowProvider } from '@xyflow/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { useExecution, useNodeTypes, useWorkflow } from '@/api/queries';
import { Editor } from '@/editor/editor-page';
import { useEditorStore } from '@/editor/store';

/**
 * Uma execução aberta no canvas, somente leitura, com os dados de cada nó no painel (spec 005,
 * FR-013). Mostra a definição que de fato rodou (pode ser um rascunho não salvo).
 */
export function ExecutionPage() {
  const { id = '' } = useParams();
  const execution = useExecution(id);
  const types = useNodeTypes();
  const data = execution.data;
  const workflow = useWorkflow(data?.workflowId ?? '', data !== undefined);
  const loadedRun = useEditorStore((s) => s.run.executionId);

  const stub = useMemo<WorkflowDetail | undefined>(
    () =>
      data && {
        id: data.workflowId,
        projectId: data.projectId,
        name: workflow.data?.name ?? 'Workflow',
        version: data.workflowVersion ?? 0,
        createdAt: data.startedAt,
        updatedAt: data.startedAt,
        createdBy: null,
        warnings: [],
        definition: data.definition ?? { nodes: [], edges: [], settings: {} },
        publishedVersion: null,
        active: false,
      },
    [data, workflow.data?.name],
  );

  useEffect(() => {
    if (!stub || !data) return;
    const store = useEditorStore.getState();
    store.load(stub);
    store.runStarted(data.id);
    store.applyExecution(data);
  }, [stub, data]);
  useEffect(
    () => () => {
      useEditorStore.getState().reset();
    },
    [id],
  );

  if (execution.isError) {
    return <p className="p-6 text-muted-foreground">Execução não encontrada ou sem acesso.</p>;
  }
  if (!data || !stub || !types.data || loadedRun !== data.id) {
    return (
      <p className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando execução…
      </p>
    );
  }
  return (
    <ReactFlowProvider>
      <Editor workflow={stub} types={types.data} execution={data} />
    </ReactFlowProvider>
  );
}
