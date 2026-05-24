'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { LoginResponse } from '@/types/api.types';
import type { MemberRole, PlatformRole } from '@/types/enums';

interface AuthUser {
  id:           string;
  firstName:    string;
  lastName:     string;
  phone:        string;
  email:        string | null;
  platformRole: PlatformRole;
  groupRole:    MemberRole;
  groupId:      string;
  groupName:    string;
  // Phase A additions — optional so legacy localStorage payloads still parse.
  groupCode?:   string;
  memberCode?:  string;
  personId?:    string;
  officerRole?: string;
}

interface AuthState {
  user:         AuthUser | null;
  accessToken:  string | null;
  refreshToken: string | null;
  isLoading:    boolean;
}

interface AuthContextValue extends AuthState {
  login:  (data: LoginResponse) => void;
  logout: () => void;
  setAccessToken: (token: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'ky_auth';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null, accessToken: null, refreshToken: null, isLoading: true,
  });

  // Client-only hydration from localStorage. Cannot run in useState initializer
  // because it would cause an SSR/client hydration mismatch. The setState here
  // is a one-time hydration, not a cascading data-derived state.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AuthState;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState({ ...parsed, isLoading: false });
      } else {
        setState((s) => ({ ...s, isLoading: false }));
      }
    } catch {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, []);

  const login = useCallback((data: LoginResponse) => {
    const next: AuthState = {
      user:         data.member,
      accessToken:  data.accessToken,
      refreshToken: data.refreshToken,
      isLoading:    false,
    };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const logout = useCallback(() => {
    const next: AuthState = { user: null, accessToken: null, refreshToken: null, isLoading: false };
    setState(next);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const setAccessToken = useCallback((token: string) => {
    setState((s) => {
      const next = { ...s, accessToken: token };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, setAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
