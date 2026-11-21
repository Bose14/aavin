import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import {
  DEFAULT_DAIRY_UNIT_SETTINGS,
  getEffectiveSellingRate,
  getLocalTodayIso,
} from '../lib/format';
import type { SellingRateRule, DairyUnitSettings } from '../lib/format';

const CACHE_KEY = 'aavin_dairy_unit_settings_cache_v1';

interface CachedSettingsState {
  settings: DairyUnitSettings;
  sellingRates: SellingRateRule[];
}

function readCachedSettings(): CachedSettingsState {
  try {
    if (typeof localStorage === 'undefined') {
      return { settings: DEFAULT_DAIRY_UNIT_SETTINGS, sellingRates: [] };
    }
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { settings: DEFAULT_DAIRY_UNIT_SETTINGS, sellingRates: [] };
    const parsed = JSON.parse(raw) as Partial<CachedSettingsState>;
    return {
      settings: { ...DEFAULT_DAIRY_UNIT_SETTINGS, ...(parsed.settings ?? {}) },
      sellingRates: Array.isArray(parsed.sellingRates) ? parsed.sellingRates : [],
    };
  } catch {
    return { settings: DEFAULT_DAIRY_UNIT_SETTINGS, sellingRates: [] };
  }
}

export function useDairyUnitSettings() {
  const [cached] = useState<CachedSettingsState>(readCachedSettings);
  const [settings, setSettings] = useState<DairyUnitSettings>(cached.settings);
  const [sellingRates, setSellingRates] = useState<SellingRateRule[]>(cached.sellingRates);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ settings: DairyUnitSettings; selling_rates: SellingRateRule[] }>('/settings');
      if (res.data?.settings) {
        const merged = { ...DEFAULT_DAIRY_UNIT_SETTINGS, ...res.data.settings };
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
