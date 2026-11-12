import api from './api';

const OFFLINE_QUEUE_KEY = 'aavin_offline_milk_queue_v1';

export interface QueuedMilkPayload {
  date: string;
  shift: 'AM' | 'PM';
  fat_pct: number;
  snf_pct: number;
  quantity_litres: number;
  rejection_qty: number;
  rejection_reason?: string;
  temperature?: number;
  rate_per_litre?: number;
  rate_override?: boolean;
  rate_override_reason?: string;
}

export interface OfflineMilkItem {
  localId: string;
  createdAt: string;
  payload: QueuedMilkPayload;
}

export function listOfflineMilkEntries(): OfflineMilkItem[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(items: OfflineMilkItem[]) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('aavin-offline-queue-changed'));
    }
  } catch {
    // ignore storage quota failures
  }
}

export function enqueueOfflineMilkEntry(payload: QueuedMilkPayload): OfflineMilkItem {
  const queue = listOfflineMilkEntries();
  const item: OfflineMilkItem = {
    localId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    payload,
  };
  queue.push(item);
  saveQueue(queue);
  return item;
}

export function removeOfflineMilkEntry(localId: string): OfflineMilkItem[] {
  const next = listOfflineMilkEntries().filter(i => i.localId !== localId);
  saveQueue(next);
  return next;
}

export async function syncOfflineMilkEntries(): Promise<{
  synced: number;
  failed: Array<{ localId: string; error: string }>;
  remaining: number;
}> {
  const queue = listOfflineMilkEntries();
  if (queue.length === 0) return { synced: 0, failed: [], remaining: 0 };

  let synced = 0;
  const failed: Array<{ localId: string; error: string }> = [];
  const stillPending: OfflineMilkItem[] = [];

  for (const item of queue) {
    try {
      await api.post('/milk', item.payload);
      synced += 1;
    } catch (err: unknown) {
      const maybeAxios = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
      const status = maybeAxios?.response?.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        // Server rejected permanently (e.g. duplicate entry); drop from queue and report
        failed.push({ localId: item.localId, error: maybeAxios.response?.data?.error || 'Rejected by server' });
      } else {
        stillPending.push(item);
      }
    }
  }

  saveQueue(stillPending);
  return { synced, failed, remaining: stillPending.length };
}
