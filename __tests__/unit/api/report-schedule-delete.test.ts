import { organizationApi } from '@/lib/api/endpoints';

it('accepts the empty 204 returned after removing a report schedule', async () => {
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  try {
    await expect(organizationApi.deleteReportSchedule('schedule-id')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      '/api/admin/organization/reports/schedules/schedule-id',
      expect.objectContaining({ method: 'DELETE' }),
    );
  } finally {
    request.mockRestore();
  }
});
