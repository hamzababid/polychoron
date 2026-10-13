import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { setTenantTimeZone } from '../shell/tenantTime';

export interface DemoSessionUser {
  userId: string;
  displayName: string;
  email: string;
  roleCodes: string[];
}

export interface DemoSession {
  sessionId: string;
  user: DemoSessionUser;
  /** Screens format every time in tenant.timezone, not the browser's zone. */
  tenant: { tenantId: string; tenantName: string; timezone: string };
  createdAt: string;
}

interface AuthContextValue {
  session: DemoSession | null;
  loading: boolean;
  login: (userId: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = 'polychoron.demoSession';

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Wraps specs/suites/bfsi/features/aml-detection/phase-1-aml-core/api-contracts-phase1.md's
 * POST /api/v1/auth/demo-login — a seeded-user picker, not real
 * authentication (constitution rule 9). The session is kept in
 * localStorage only (per-browser, cleared on logout); there is no
 * token refresh because the backend doesn't expire sessions either.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as DemoSession;
        // Sessions saved before tenant time zones existed: sign in again.
        if (parsed.tenant?.timezone) {
          setTenantTimeZone(parsed.tenant.timezone);
          setSession(parsed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const login = async (userId: string) => {
    const res = await fetch('/api/v1/auth/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Unknown demo user' : `Login failed: ${res.status}`);
    }
    const newSession = (await res.json()) as DemoSession;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    setTenantTimeZone(newSession.tenant.timezone);
    setSession(newSession);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setTenantTimeZone(undefined);
    setSession(null);
  };

  return <AuthContext.Provider value={{ session, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
