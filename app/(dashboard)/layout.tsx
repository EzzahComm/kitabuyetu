'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/topbar';
import { useAuth, isBackofficeUser } from '@/lib/auth/context';
import { configureApiClient } from '@/lib/api/client';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, isLoading, accessToken, audience, logout } = useAuth();
  const router = useRouter();

  // A backoffice (staff) session must never render the tenant dashboard —
  // otherwise a super-admin who follows a stray link lands in the consumer
  // shell and appears to be "inside a group called Kitabu Yetu". Send them
  // back to the backoffice portal instead.
  const isBackoffice = audience === 'backoffice' || isBackofficeUser(user);

  useEffect(() => {
    configureApiClient({
      getToken:       () => accessToken,
      onUnauthorized: () => { logout(); router.push('/login'); },
    });
  }, [accessToken, logout, router]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.push('/login'); return; }
    if (isBackoffice) { router.replace('/admin'); }
  }, [isLoading, user, isBackoffice, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  if (!user || isBackoffice) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
