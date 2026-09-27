import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getTypologyHistory } from '../api/client';
import type { TypologyHistory } from '../api/types';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { Tile } from '../regulatory-kb/kbShared';
import { VersionContent, VersionDiff } from './typologyShared';
import { errorText } from './typologyUtils';
import './typology-console.css';
import { Loader } from '../../../shell/Loader';

/** Screen 5 — Version compare (screens/06-typology-rules-console.md).
 * Any two versions of one typology, older on the left. */
export function TypologyCompareScreen() {
  const { code = '', older = '', newer = '' } = useParams();
  const base = useFeatureBasePath();
  const navigate = useNavigate();
  const [history, setHistory] = useState<TypologyHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTypologyHistory(code)
      .then(setHistory)
      .catch((err: unknown) => setError(errorText(err)));
  }, [code]);

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!history) return <Loader label="Loading versions…" />;

  const byVersion = new Map(history.versions.map((v) => [v.version, v]));
  const a = byVersion.get(Number(older));
  const b = byVersion.get(Number(newer));
  if (!a || !b) return <div className="aml-status aml-status--error">Version not found for {code}.</div>;

  const go = (x: number, y: number) =>
    navigate(`${base}/typologies/${code}/compare/${Math.min(x, y)}/${Math.max(x, y)}`, { replace: true });
  const picker = (value: number, onChange: (v: number) => void) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {history.versions.map((v) => (
        <option key={v.version} value={v.version}>
          v{v.version} · {v.status}
        </option>
      ))}
    </select>
  );

  return (
    <div className="typology-screen">
      <div className="typology-head">
        <div className="typology-head__main">
          <div className="typology-head__title">Compare versions</div>
          <div className="typology-muted">{code}</div>
        </div>
        <div className="typology-head__actions">
          <Link className="aml-btn" to={`${base}/typologies/${code}`}>
            Back to typology
          </Link>
        </div>
      </div>
      <div className="typology-scroll">
        <div className="typology-detail__versions">
          <Tile title={<>Older {picker(a.version, (v) => go(v, b.version))}</>}>
            <VersionContent version={a} />
          </Tile>
          <Tile title={<>Newer {picker(b.version, (v) => go(a.version, v))}</>}>
            <VersionContent version={b} />
          </Tile>
        </div>
        <Tile title={`Changes from v${a.version} to v${b.version}`}>
          <VersionDiff older={a} newer={b} />
        </Tile>
      </div>
    </div>
  );
}
