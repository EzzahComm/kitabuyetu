'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/sidebar';
import { AdminTopbar } from '@/components/admin/topbar';
import { useAuth } from '@/lib/auth/context';
import { configureApiClient } from '@/lib/api/client';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, accessToken, logout }  = useAuth();
  const router = useRouter();

  // Wire up the API client with the current token
  useEffect(() => {
    configureApiClient({
      getToken:       () => accessToken ?? null,
      onUnauthorized: () => { logout(); router.push('/login'); },
    });
  }, [accessToken, logout, router]);

  // Guard: only super_admin may access the admin portal
  useEffect(() => {
    if (user === null) {
      router.replace('/login');
      return;
    }
    if (user && user.platformRole !== 'super_admin') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  if (!user || user.platformRole !== 'super_admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Verifying access…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AdminTopbar onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
