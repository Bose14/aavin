import { supabase } from '../supabase';

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

/**
 * Next gate pass number (6-digit, zero padded) from the database sequence.
 * Numbers are unique and survive restarts/deploys; a number is consumed per call.
 */
export async function getNextGatePassNo(): Promise<string> {
  const { data, error } = await supabase.rpc('next_gate_pass_no');
  if (error || typeof data !== 'string') {
    throw new Error(`Could not allocate a gate pass number: ${error?.message ?? 'empty response'}`);
  }
  return data;
}

/** Shows the next number without using it (the number is only taken when a pass is issued). */
export async function peekNextGatePassNo(): Promise<string> {
  const { data, error } = await supabase.rpc('peek_gate_pass_no');
  if (error || typeof data !== 'string') {
    throw new Error(`Could not read the next gate pass number: ${error?.message ?? 'empty response'}`);
  }
  return data;
}
