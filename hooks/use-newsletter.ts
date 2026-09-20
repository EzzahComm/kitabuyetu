'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export function useSubscribeNewsletter() {
  return useMutation({
    mutationFn: (data: { email: string; name?: string; source?: string }) =>
      api.post<{ status: string }>('/newsletter/subscribe', data),
  });
}
