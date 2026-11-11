import { useState, useEffect, useCallback } from 'react';
import { fetchZones } from '../lib/zones';
import type { Zone } from '../lib/zones';

/**
 * Loads the available Aavin zones and exposes loading, error, and reload helpers.
 */
export function useZones() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await fetchZones();
      setZones(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load zones');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchZones()
      .then(list => {
        if (active) {
          setZones(list);
          setError('');
        }
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load zones');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return { zones, loading, error, reload };
}
