import fs from 'fs';
import path from 'path';

export interface StoredGatePass {
  gate_pass_no: string;
  gate_pass_number?: string;
  date: string;
  time: string;
  sl_no?: string;
  item?: string;
  quantity?: string;
  purpose?: string;
  whether_returnable?: string;
  to_whom_issued: string;
  issued_by?: string;
  vehicle_no: string;
  issuing_officer?: string;
  security_officer?: string;
  received_by?: string;
  remarks?: string;
  created_at?: string;
}

const DATA_DIR = path.resolve(__dirname, '../../.data');
const STORE_FILE = path.join(DATA_DIR, 'gate_passes.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readGatePassStore(): Record<string, StoredGatePass> {
  try {
    ensureDir();
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      return JSON.parse(raw) as Record<string, StoredGatePass>;
    }
  } catch (err) {
    console.warn('[gatePassStore] Failed to read fallback store:', err);
  }
  return {};
}

export function saveGatePassFallback(tripId: string, pass: StoredGatePass): void {
  try {
    ensureDir();
    const store = readGatePassStore();
    store[String(tripId)] = pass;
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[gatePassStore] Failed to save fallback gate pass:', err);
  }
}

export function getGatePassFallback(tripId: string): StoredGatePass | null {
  const store = readGatePassStore();
  return store[String(tripId)] ?? null;
}

export function deleteGatePassFallback(tripId: string): void {
  try {
    ensureDir();
    const store = readGatePassStore();
    if (store[String(tripId)]) {
      delete store[String(tripId)];
      fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[gatePassStore] Failed to delete fallback gate pass:', err);
  }
}

export function getNextGatePassNo(): string {
  const store = readGatePassStore();
  let max = 0;
  for (const [id, pass] of Object.entries(store)) {
    if (id.includes('test')) continue;
    const raw = pass.gate_pass_no || pass.gate_pass_number || '0';
    const num = parseInt(String(raw).replace(/\D/g, ''), 10);
    if (!isNaN(num) && num < 900000) {
      if (num === 5616) {
        if (max < 1) max = 1;
      } else if (num > max) {
        max = num;
      }
    }
  }
  const next = max + 1;
  return String(next).padStart(6, '0');
}
