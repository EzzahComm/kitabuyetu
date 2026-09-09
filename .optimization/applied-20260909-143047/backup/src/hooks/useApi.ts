import { useState, useCallback, useEffect } from "react";
import { apiClient, type endpoints } from "@/services/api";

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * useApi hook
 * Handles API calls with loading and error states
 *
 * Usage:
 * const { data, loading, error, execute } = useApi<Member[]>();
 *
 * const fetchMembers = async () => {
 *   await execute(() => apiClient.get('/members'));
 * };
 */
export function useApi<T = any>(initialState: Partial<UseApiState<T>> = {}) {
  const [state, setState] = useState<UseApiState<T>>({
    data: initialState.data ?? null,
    loading: false,
    error: initialState.error ?? null,
  });

  const execute = useCallback(
    async (apiCall: () => Promise<any>) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const response = await apiCall();

        if (response.success) {
          setState((prev) => ({
            ...prev,
            data: response.data as T,
            loading: false,
            error: null,
          }));
          return { success: true, data: response.data };
        } else {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: response.error || "An error occurred",
          }));
          return { success: false, error: response.error };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An error occurred";
        setState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return { success: false, error: errorMessage };
      }
    },
    []
  );

  const setData = useCallback((data: T) => {
    setState((prev) => ({ ...prev, data }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    execute,
    setData,
    setError,
    reset,
  };
}

/**
 * useFetch hook
 * Auto-fetch data on mount
 *
 * Usage:
 * const { data, loading, error } = useFetch<Member[]>(
 *   () => apiClient.get('/members')
 * );
 */
export function useFetch<T = any>(
  fetchFn: () => Promise<any>,
  dependencies: any[] = []
) {
  const api = useApi<T>();

  // Fetch on mount and when dependencies change
  useEffect(() => {
    api.execute(fetchFn);
  }, dependencies);

  return api;
}
