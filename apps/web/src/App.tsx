import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiError } from '@/api/client';
import { ApiProvider } from '@/api/api-provider';
import { AuthProvider } from '@/auth/auth-provider';
import { RequireAuth } from '@/auth/require-auth';
import { AppLayout } from '@/components/layout/app-layout';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { EditorPage } from '@/editor/editor-page';
import { AdminAuditPage } from '@/pages/admin-audit-page';
import { AdminMaskingPage } from '@/pages/admin-masking-page';
import { AdminMcpPage } from '@/pages/admin-mcp-page';
import { AdminPage } from '@/pages/admin-page';
import { AdminSsoPage } from '@/pages/admin-sso-page';
import { ApprovalsPage } from '@/pages/approvals-page';
import { AuthCallbackPage } from '@/pages/auth-callback-page';
import { CredentialsPage } from '@/pages/credentials-page';
import { ExecutionPage } from '@/pages/execution-page';
import { ExecutionsPage } from '@/pages/executions-page';
import { HomePage } from '@/pages/home-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { WorkflowsPage } from '@/pages/workflows-page';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Erros de autenticação/autorização não melhoram com nova tentativa.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'workflows', element: <WorkflowsPage /> },
          { path: 'workflows/:id', element: <EditorPage /> },
          { path: 'executions', element: <ExecutionsPage /> },
          { path: 'executions/:id', element: <ExecutionPage /> },
          { path: 'credentials', element: <CredentialsPage /> },
          { path: 'admin', element: <AdminPage /> },
          // Spec 009: SSO, mascaramento, auditoria e aprovações.
          { path: 'admin/sso', element: <AdminSsoPage /> },
          { path: 'admin/masking', element: <AdminMaskingPage /> },
          { path: 'admin/audit', element: <AdminAuditPage /> },
          { path: 'admin/mcp', element: <AdminMcpPage /> },
          { path: 'approvals', element: <ApprovalsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider>
            <RouterProvider router={router} />
            <Toaster />
          </ApiProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
