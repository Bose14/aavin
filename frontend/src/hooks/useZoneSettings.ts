import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import {
  DEFAULT_ZONE_SETTINGS,
  getEffectiveSellingRate,
  getLocalTodayIso,
} from '../lib/format';
import type { SellingRateRule, ZoneSettings } from '../lib/format';

const CACHE_KEY = 'aavin_zone_settings_cache_v1';

interface CachedSettingsState {
  settings: ZoneSettings;
  sellingRates: SellingRateRule[];
}

function readCachedSettings(): CachedSettingsState {
  try {
    if (typeof localStorage === 'undefined') {
      return { settings: DEFAULT_ZONE_SETTINGS, sellingRates: [] };
    }
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { settings: DEFAULT_ZONE_SETTINGS, sellingRates: [] };
    const parsed = JSON.parse(raw) as Partial<CachedSettingsState>;
    return {
      settings: { ...DEFAULT_ZONE_SETTINGS, ...(parsed.settings ?? {}) },
      sellingRates: Array.isArray(parsed.sellingRates) ? parsed.sellingRates : [],
    };
  } catch {
    return { settings: DEFAULT_ZONE_SETTINGS, sellingRates: [] };
  }
}

export function useZoneSettings() {
  const [cached] = useState<CachedSettingsState>(readCachedSettings);
  const [settings, setSettings] = useState<ZoneSettings>(cached.settings);
  const [sellingRates, setSellingRates] = useState<SellingRateRule[]>(cached.sellingRates);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ settings: ZoneSettings; selling_rates: SellingRateRule[] }>('/settings');
      if (res.data?.settings) {
        const merged = { ...DEFAULT_ZONE_SETTINGS, ...res.data.settings };
        const rates = Array.isArray(res.data.selling_rates) ? res.data.selling_rates : [];
        setSettings(merged);
        setSellingRates(rates);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ settings: merged, sellingRates: rates }));
        } catch {
          // ignore
        }
      }
    } catch {
      // keep cached/default settings offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const currentSellingRate = getEffectiveSellingRate(getLocalTodayIso(), sellingRates);

  return { settings, sellingRates, currentSellingRate, loading, reload };
}
