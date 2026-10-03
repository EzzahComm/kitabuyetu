/**
 * Job applications (Phase 12 groundwork) — public submission (resume upload
 * is best-effort, never blocks the application), stage transitions (locked
 * once hired), and the hireApplicant integration point into Phase 11's
 * hr_employees, which must be atomic with the application's own update.
 */
import { withAdminDb } from '@/lib/db';
import { createEmployeeWith } from '@/lib/services/hr.service';
import { uploadResume, createResumeSignedUrl } from '@/lib/supabase/resume-storage';
import {
  submitApplication,
  listApplications,
  updateApplicationStage,
  hireApplicant,
  getResumeUrl,
} from '@/lib/services/careers.service';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/services/hr.service', () => ({
  createEmployeeWith: jest.fn(),
}));
jest.mock('@/lib/supabase/resume-storage', () => ({
  uploadResume: jest.fn(),
  createResumeSignedUrl: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
  (createEmployeeWith as jest.Mock).mockReset();
  (uploadResume as jest.Mock).mockReset().mockResolvedValue(undefined);
  (createResumeSignedUrl as jest.Mock).mockReset().mockResolvedValue('https://signed.example/resume.pdf');
});

const validInput = {
  jobSlug: 'engineer',
  jobTitle: 'Software Engineer',
  applicantName: 'Jane Doe',
  applicantEmail: 'jane@example.com',
};

describe('submitApplication', () => {
  it('inserts the application and logs an audit entry with a NULL actor (anonymous submission)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', resume_path: null }] }); // insert
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit

    const result = await submitApplication(validInput);

    expect(result.id).toBe('app-1');
    const auditCall = mockQuery.mock.calls[1];
    expect(auditCall[1][0]).toBeNull(); // actor_id
    expect(auditCall[1][1]).toBe('job_application.submit');
  });

  it('uploads a resume and links its path when provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', resume_path: null }] }); // insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', resume_path: 'app-1/resume.pdf' }] }); // update with path
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit

    const result = await submitApplication(validInput, {
      buffer: Buffer.from('x'),
      contentType: 'application/pdf',
      filename: 'cv.pdf',
    });

    expect(result.resume_path).toBe('app-1/resume.pdf');
    expect(uploadResume).toHaveBeenCalledWith('app-1/resume.pdf', expect.any(Buffer), 'application/pdf');
  });

  it('does not fail the application when the resume upload throws', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', resume_path: null }] }); // insert
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit (upload path skipped — never reaches the UPDATE)
    (uploadResume as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));

    const result = await submitApplication(validInput, {
      buffer: Buffer.from('x'),
      contentType: 'application/pdf',
      filename: 'cv.pdf',
    });

    expect(result.id).toBe('app-1');
    expect(result.resume_path).toBeNull();
  });
});

describe('listApplications', () => {
  it('combines jobSlug and stage filters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listApplications({ jobSlug: 'engineer', stage: 'screening' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('job_slug = $1');
    expect(String(sql)).toContain('stage = $2');
    expect(params).toEqual(['engineer', 'screening']);
  });
});

describe('getResumeUrl', () => {
  it('returns null when the application has no resume', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', resume_path: null }] });
    expect(await getResumeUrl('app-1')).toBeNull();
    expect(createResumeSignedUrl).not.toHaveBeenCalled();
  });

  it('mints a signed URL when a resume path exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', resume_path: 'app-1/resume.pdf' }] });
    const url = await getResumeUrl('app-1');
    expect(url).toBe('https://signed.example/resume.pdf');
    expect(createResumeSignedUrl).toHaveBeenCalledWith('app-1/resume.pdf');
  });
});

describe('updateApplicationStage', () => {
  it('throws NotFoundError for an unknown application', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(updateApplicationStage('admin-1', 'ghost', { stage: 'screening' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws ConflictError once an application is already hired', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', stage: 'hired' }] });
    await expect(updateApplicationStage('admin-1', 'app-1', { stage: 'rejected' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('hireApplicant', () => {
  const applicationRow = {
    id: 'app-1',
    stage: 'interview',
    applicant_name: 'Jane Doe',
    applicant_email: 'jane@example.com',
    applicant_phone: null,
    job_title: 'Software Engineer',
    job_slug: 'engineer',
  };

  it('throws ConflictError if already hired', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...applicationRow, stage: 'hired' }] });
    await expect(
      hireApplicant('admin-1', 'app-1', { employmentType: 'full_time', hireDate: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(createEmployeeWith).not.toHaveBeenCalled();
  });

  it('rejects hiring a rejected application', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...applicationRow, stage: 'rejected' }] });
    await expect(
      hireApplicant('admin-1', 'app-1', { employmentType: 'full_time', hireDate: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(createEmployeeWith).not.toHaveBeenCalled();
  });

  it('creates the employee via createEmployeeWith on the SAME client (atomic with the application update)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [applicationRow] }); // existence check
    (createEmployeeWith as jest.Mock).mockResolvedValueOnce({ id: 'emp-1', employee_number: 'KY-EMP-0001' });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...applicationRow, stage: 'hired', hired_employee_id: 'emp-1' }] }); // update
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit

    const result = await hireApplicant('admin-1', 'app-1', { employmentType: 'full_time', hireDate: '2026-01-01' });

    expect(result.employee.id).toBe('emp-1');
    expect(result.application.hired_employee_id).toBe('emp-1');
    // Same mockClient passed through — proves no second withAdminDb/transaction was opened.
    expect(createEmployeeWith).toHaveBeenCalledWith(
      mockClient,
      'admin-1',
      expect.objectContaining({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      }),
    );
  });

  it('splits a multi-word name into first/last correctly', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...applicationRow, applicant_name: 'Mary Jane Watson' }] });
    (createEmployeeWith as jest.Mock).mockResolvedValueOnce({ id: 'emp-1', employee_number: 'KY-EMP-0002' });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...applicationRow, stage: 'hired' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await hireApplicant('admin-1', 'app-1', { employmentType: 'full_time', hireDate: '2026-01-01' });

    expect(createEmployeeWith).toHaveBeenCalledWith(
      mockClient,
      'admin-1',
      expect.objectContaining({
        firstName: 'Mary',
        lastName: 'Jane Watson',
      }),
    );
  });
});
