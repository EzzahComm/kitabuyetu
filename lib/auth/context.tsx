'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { LoginResponse, AdminLoginResponse } from '@/types/api.types';
import type { MemberRole, PlatformRole } from '@/types/enums';

// Tenant (consumer) user shape — group context required.
interface TenantUser {
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
  /** The Membership Number (e.g. BG102534) — the only public payment identifier. */
  membershipNo?: string;
  personId?:    string;
  officerRole?: string;
}

// Backoffice (platform staff) user shape — no group context.
interface BackofficeUser {
  id:           string;
  firstName:    string;
  lastName:     string;
  email:        string;
  platformRole: Exclude<PlatformRole, 'member'>;
  organizationId?:       string;
}

export type AuthUser = TenantUser | BackofficeUser;

// Audience is the source of truth for which surface this user is signed
// in to. `tenant` → consumer dashboard; `backoffice` → admin portal.
// Defaults to 'tenant' when missing for backward compat with existing
// localStorage payloads.
export type AuthAudience = 'tenant' | 'backoffice';

interface AuthState {
  user:         AuthUser | null;
  accessToken:  string | null;
  refreshToken: string | null;
  audience:     AuthAudience;
  isLoading:    boolean;
}

interface AuthContextValue extends AuthState {
  login:      (data: LoginResponse) => void;
  loginAdmin: (data: AdminLoginResponse) => void;
  logout:     () => void;
  /** Store a renewed access token — and, when the server rotated it (§15.3),
   *  the successor refresh token. The old refresh token is consumed
   *  server-side; reusing it revokes the whole session lineage. */
  setAccessToken: (token: string, rotatedRefreshToken?: string) => void;
}

// Narrowing helpers so consumers can guard on shape without importing the
// interface internals.
export function isBackofficeUser(u: AuthUser | null): u is BackofficeUser {
  return !!u && !('groupId' in u);
}
export function isTenantUser(u: AuthUser | null): u is TenantUser {
  return !!u && 'groupId' in u;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'ky_auth';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null, accessToken: null, refreshToken: null, audience: 'tenant', isLoading: true,
  });

  // Client-only hydration from localStorage. Cannot run in useState initializer
  // because it would cause an SSR/client hydration mismatch. The setState here
  // is a one-time hydration, not a cascading data-derived state.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AuthState>;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState({
          user:         parsed.user ?? null,
          accessToken:  parsed.accessToken ?? null,
          refreshToken: parsed.refreshToken ?? null,
          audience:     parsed.audience ?? 'tenant', // legacy payloads default to tenant
          isLoading:    false,
        });
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
      audience:     'tenant',
      isLoading:    false,
    };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const loginAdmin = useCallback((data: AdminLoginResponse) => {
    const next: AuthState = {
      user:         data.member,
      accessToken:  data.accessToken,
      refreshToken: data.refreshToken,
      audience:     'backoffice',
      isLoading:    false,
    };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const logout = useCallback(() => {
    const next: AuthState = {
      user: null, accessToken: null, refreshToken: null, audience: 'tenant', isLoading: false,
    };
    setState(next);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const setAccessToken = useCallback((token: string, rotatedRefreshToken?: string) => {
    setState((s) => {
      const next = {
        ...s,
        accessToken:  token,
        refreshToken: rotatedRefreshToken ?? s.refreshToken,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, loginAdmin, logout, setAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
