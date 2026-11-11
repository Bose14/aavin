import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || supabaseUrl.startsWith('your_')) {
  throw new Error('SUPABASE_URL is missing or placeholder in backend/.env');
}

if (!supabaseServiceKey || supabaseServiceKey.startsWith('your_')) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing or placeholder in backend/.env');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
