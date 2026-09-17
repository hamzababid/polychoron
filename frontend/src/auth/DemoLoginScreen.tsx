import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import './login.css';

// Hardcoded picker options — this is a seeded-user picker, not real
// auth (constitution rule 9); matches the 2 demo users seeded by
// app-api's src/scripts/seed-demo-users.ts.
const DEMO_USERS = [
  { userId: 'demo-analyst-1', label: 'Amina Raza', role: 'AML Analyst' },
  { userId: 'demo-compliance-officer-1', label: 'Bilal Siddiqui', role: 'AML Senior Compliance Officer' },
];

export function DemoLoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (userId: string) => {
    setPending(userId);
    setError(null);
    try {
      await login(userId);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        <h1 className="login__brand">Polychoron AI</h1>
        <p className="login__subtitle">Demo sign-in — pick a seeded user (no password).</p>
        {DEMO_USERS.map((u) => (
          <button
            key={u.userId}
            className="login__user"
            disabled={pending !== null}
            onClick={() => void handleLogin(u.userId)}
          >
            <span className="login__userName">{u.label}</span>
            <span className="login__userRole">{u.role}</span>
          </button>
        ))}
        {error && <p className="login__error">{error}</p>}
      </div>
    </div>
  );
}
