'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth/context';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/ThemeProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SessionQueries>{children}</SessionQueries>
      </AuthProvider>
    </ThemeProvider>
  );
}

function SessionQueries({ children }: { children: React.ReactNode }) {
  const { sessionRevision } = useAuth();
  // Remount query consumers so both cached results and local copies of those
  // results stay with the previous session, even when the URL stays the same.
  return <SessionQueryProvider key={sessionRevision}>{children}</SessionQueryProvider>;
}

function SessionQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
