import api from './api';
import { supabase } from '../supabase';

export interface Zone {
  id: string;
  name: string;
}

/**
 * Fetches zones from the backend API, falling back to Supabase public read
 * if the backend is unavailable or still starting up.
 */
export async function fetchZones(): Promise<Zone[]> {
  try {
    const res = await api.get<Zone[]>('/zones', { timeout: 5000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      return res.data;
    }
  } catch {
    // Fall back to direct Supabase read below
  }

  const { data, error } = await supabase
    .from('zones')
    .select('id, name')
    .order('name');

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

/**
 * Creates a new zone (superadmin only).
 */
export async function createZone(name: string): Promise<Zone> {
  const res = await api.post<Zone>('/zones', { name });
  return res.data;
}

