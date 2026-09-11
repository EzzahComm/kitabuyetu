/**
 * API Service
 * Centralized API request handler with error handling
 */

interface ApiConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  status: number;
}

class ApiService {
  private baseURL: string;
  private timeout: number;
  private headers: Record<string, string>;

  constructor(config: ApiConfig = {}) {
    this.baseURL = config.baseURL || "/api";
    this.timeout = config.timeout || 30000;
    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
    };
  }

  /**
   * GET request
   */
  async get<T>(
    endpoint: string,
    options?: { params?: Record<string, any> }
  ): Promise<ApiResponse<T>> {
    try {
      const url = new URL(`${this.baseURL}${endpoint}`, window.location.origin);

      if (options?.params) {
        Object.entries(options.params).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            url.searchParams.append(key, String(value));
          }
        });
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json();

      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || "Failed to fetch data",
        status: response.status,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred",
        status: 0,
      };
    }
  }

  /**
   * POST request
   */
  async post<T>(
    endpoint: string,
    body?: Record<string, any>,
    options?: { headers?: Record<string, string> }
  ): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: "POST",
        headers: { ...this.headers, ...options?.headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json();

      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || "Failed to create resource",
        status: response.status,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred",
        status: 0,
      };
    }
  }

  /**
   * PUT request
   */
  async put<T>(
    endpoint: string,
    body?: Record<string, any>,
    options?: { headers?: Record<string, string> }
  ): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: "PUT",
        headers: { ...this.headers, ...options?.headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json();

      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || "Failed to update resource",
        status: response.status,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred",
        status: 0,
      };
    }
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: "DELETE",
        headers: this.headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json().catch(() => ({}));

      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || "Failed to delete resource",
        status: response.status,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred",
        status: 0,
      };
    }
  }

  /**
   * Set authorization token
   */
  setToken(token: string) {
    this.headers["Authorization"] = `Bearer ${token}`;
  }

  /**
   * Remove authorization token
   */
  removeToken() {
    delete this.headers["Authorization"];
  }
}

// Export singleton instance
export const apiClient = new ApiService({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "/api",
});

/**
 * API Endpoints helper
 * Standardized endpoints for dashboard resources
 */
export const endpoints = {
  // Members
  members: {
    list: () => "/members",
    get: (id: string) => `/members/${id}`,
    create: () => "/members",
    update: (id: string) => `/members/${id}`,
    delete: (id: string) => `/members/${id}`,
  },

  // Contributions
  contributions: {
    list: () => "/contributions",
    get: (id: string) => `/contributions/${id}`,
    create: () => "/contributions",
    update: (id: string) => `/contributions/${id}`,
    delete: (id: string) => `/contributions/${id}`,
  },

  // Loans
  loans: {
    list: () => "/loans",
    get: (id: string) => `/loans/${id}`,
    create: () => "/loans",
    update: (id: string) => `/loans/${id}`,
    delete: (id: string) => `/loans/${id}`,
  },

  // Dashboard
  dashboard: {
    overview: () => "/dashboard/overview",
    stats: () => "/dashboard/stats",
  },
};

/**
 * Example usage:
 *
 * // GET request
 * const { success, data } = await apiClient.get<Member[]>(endpoints.members.list());
 *
 * // POST request
 * const { success, data } = await apiClient.post<Member>(
 *   endpoints.members.create(),
 *   { firstName: "John", ... }
 * );
 *
 * // PUT request
 * const { success, data } = await apiClient.put<Member>(
 *   endpoints.members.update(memberId),
 *   { firstName: "Jane", ... }
 * );
 *
 * // DELETE request
 * const { success } = await apiClient.delete(endpoints.members.delete(memberId));
 */
