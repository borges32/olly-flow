import type { SaveExecutionDataPolicy } from '@olly/shared-types';

/** Política de dados das execuções (spec 009, FR-012). */
export const SAVE_POLICY_LABELS: Record<SaveExecutionDataPolicy, string> = {
  all: 'Salvar tudo',
  errorsOnly: 'Só execuções com erro',
  none: 'Nada (só metadados)',
};
