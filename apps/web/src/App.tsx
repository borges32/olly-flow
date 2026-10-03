import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiError } from '@/api/client';
import { ApiProvider } from '@/api/api-provider';
import { AuthProvider } from '@/auth/auth-provider';
import { RequireAuth } from '@/auth/require-auth';
import { AppLayout } from '@/components/layout/app-layout';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { AuthCallbackPage } from '@/pages/auth-callback-page';
import { HomePage } from '@/pages/home-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { PlaceholderPage } from '@/pages/placeholder-page';

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
          { path: 'workflows', element: <PlaceholderPage title="Workflows" spec="002" /> },
          { path: 'executions', element: <PlaceholderPage title="Execuções" spec="003" /> },
          { path: 'credentials', element: <PlaceholderPage title="Credenciais" spec="004" /> },
          { path: 'admin', element: <PlaceholderPage title="Administração" spec="002" /> },
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
