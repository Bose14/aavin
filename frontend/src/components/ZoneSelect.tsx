import { useState, useEffect } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { fetchZones } from '../lib/zones';
import type { Zone } from '../lib/zones';

interface ZoneSelectProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  zones?: Zone[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  name?: string;
}

/**
 * Reusable zone dropdown component. Uses provided zones when controlled,
 * or fetches zones automatically with Supabase fallback when standalone.
 */
export default function ZoneSelect({
  value,
  onChange,
  zones: externalZones,
  loading: externalLoading,
  error: externalError,
  onRetry,
  placeholder = 'Select zone…',
  required = false,
  disabled = false,
  className,
  style,
  id,
  name,
}: ZoneSelectProps) {
  const [internalZones, setInternalZones] = useState<Zone[]>([]);
  const [internalLoading, setInternalLoading] = useState(externalZones === undefined);
  const [internalError, setInternalError] = useState('');
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (externalZones !== undefined) return;
    let active = true;
    fetchZones()
      .then(list => {
        if (active) {
          setInternalZones(list);
          setInternalError('');
        }
      })
      .catch(err => {
        if (active) setInternalError(err instanceof Error ? err.message : 'Failed to load zones');
      })
      .finally(() => {
        if (active) setInternalLoading(false);
      });
    return () => { active = false; };
  }, [externalZones, reloadCount]);

  const zones = externalZones ?? internalZones;
  const loading = externalLoading ?? (externalZones !== undefined ? false : internalLoading);
  const error = externalError ?? internalError;

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    setInternalLoading(true);
    setInternalError('');
    setReloadCount(c => c + 1);
  };

  const placeholderText = loading
    ? 'Loading zones…'
    : zones.length === 0
      ? 'No zones available'
      : placeholder;

  return (
    <>
      <select
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled || (loading && zones.length === 0)}
        className={className}
        style={{ color: '#1a1a1a', backgroundColor: '#ffffff', ...style }}
      >
        <option value="">{placeholderText}</option>
        {zones.map(z => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </select>
      {error && (
        <span className="auth-error" style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          Failed to load zones
          <button type="button" className="btn-link" onClick={handleRetry} style={{ marginLeft: 0 }}>
            Retry
          </button>
        </span>
      )}
    </>
  );
}
