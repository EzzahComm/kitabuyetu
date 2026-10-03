/**
 * HR employee records (Phase 11 foundation) — employee_number generation,
 * manager-existence/self-manager guards, partial update, audit logging on
 * every write, and the terminate lifecycle (idempotency guard + orphaning
 * of direct reports).
 */
import { withAdminDb } from '@/lib/db';
import { createEmployee, listEmployees, updateEmployee, terminateEmployee } from '@/lib/services/hr.service';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withAdminDb: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const validInput = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@kitabuyetu.co.ke',
  employmentType: 'full_time' as const,
  hireDate: '2026-01-01',
};

describe('createEmployee', () => {
  it('generates a KY-EMP-#### number from the sequence and logs an audit entry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '7' }] }); // nextval
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1', employee_number: 'KY-EMP-0007' }] }); // insert
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log

    const result = await createEmployee('admin-1', validInput);

    expect(result.employee_number).toBe('KY-EMP-0007');
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1][1]).toBe('KY-EMP-0007');
    const auditCall = mockQuery.mock.calls[2];
    expect(auditCall[1][0]).toBe('admin-1');
    expect(auditCall[1][1]).toBe('hr_employee.create');
  });

  it('rejects a manager that does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // manager existence check: not found
    await expect(createEmployee('admin-1', { ...validInput, managerId: 'ghost' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('listEmployees', () => {
  it('builds a WHERE clause combining status, department, and search', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listEmployees({ status: 'active', department: 'Engineering', search: 'jane' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('employment_status = $1');
    expect(String(sql)).toContain('department = $2');
    expect(String(sql)).toContain('ILIKE $3');
    expect(params).toEqual(['active', 'Engineering', '%jane%']);
  });

  it('omits WHERE entirely with no filters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listEmployees();
    expect(String(mockQuery.mock.calls[0][0])).not.toContain('WHERE');
  });
});

describe('updateEmployee', () => {
  it('rejects an update with no fields before any query runs', async () => {
    await expect(updateEmployee('admin-1', 'e1', {})).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for an unknown employee', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(updateEmployee('admin-1', 'ghost', { department: 'Ops' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects setting an employee as their own manager', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1' }] }); // existence check
    await expect(updateEmployee('admin-1', 'e1', { managerId: 'e1' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('logs an audit entry with before/after values on success', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1', department: 'Old' }] }); // existence
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1', department: 'New' }] }); // update
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit

    const result = await updateEmployee('admin-1', 'e1', { department: 'New' });

    expect(result.department).toBe('New');
    expect(mockQuery.mock.calls[2][1][1]).toBe('hr_employee.update');
  });
});

describe('terminateEmployee', () => {
  it('throws NotFoundError for an unknown employee', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(terminateEmployee('admin-1', 'ghost', { terminationDate: '2026-01-01' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws ConflictError when already terminated (not idempotent — a second termination is an error)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1', employment_status: 'terminated' }] });
    await expect(terminateEmployee('admin-1', 'e1', { terminationDate: '2026-01-01' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('orphans direct reports and logs an audit entry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1', employment_status: 'active' }] }); // existence
    mockQuery.mockResolvedValueOnce({ rows: [] }); // orphan reports
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1', employment_status: 'terminated' }] }); // terminate update
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit

    const result = await terminateEmployee('admin-1', 'e1', { terminationDate: '2026-01-01', reason: 'Resigned' });

    expect(result.employment_status).toBe('terminated');
    expect(String(mockQuery.mock.calls[1][0])).toContain('SET manager_id = NULL WHERE manager_id = $1');
    expect(mockQuery.mock.calls[3][1][1]).toBe('hr_employee.terminate');
  });
});
