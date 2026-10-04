import type { ExpressionPreviewResponse } from '@olly/shared-types';
import { createContext, useContext } from 'react';
import type { SuggestionContext } from '../expression-utils';

/** Tipo MIME do campo arrastado do painel de dados para um parâmetro (SC-005). */
export const FIELD_MIME = 'application/x-olly-field';

export interface ExpressionHelpers {
  suggestions: SuggestionContext;
  preview: (expression: string) => Promise<ExpressionPreviewResponse>;
}

export const ExpressionContext = createContext<ExpressionHelpers | null>(null);

export function useExpressionHelpers(): ExpressionHelpers | null {
  return useContext(ExpressionContext);
}
