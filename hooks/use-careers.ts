'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface ApplicationFormData {
  jobSlug: string;
  jobTitle: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  coverNote?: string;
  resume?: File | null;
}

export function useSubmitApplication() {
  return useMutation({
    mutationFn: (data: ApplicationFormData) => {
      const formData = new FormData();
      formData.set('jobSlug', data.jobSlug);
      formData.set('jobTitle', data.jobTitle);
      formData.set('applicantName', data.applicantName);
      formData.set('applicantEmail', data.applicantEmail);
      if (data.applicantPhone) formData.set('applicantPhone', data.applicantPhone);
      if (data.coverNote) formData.set('coverNote', data.coverNote);
      if (data.resume) formData.set('resume', data.resume);
      return api.upload<{ id: string; status: string }>('/careers/apply', formData);
    },
  });
}
