
import { createClient } from 'https://esm.sh/@supabase/supabase-js@^2.39.7';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase Initialization Warning: Missing environment variables.");
  console.log("SUPABASE_URL present:", !!supabaseUrl);
  console.log("SUPABASE_ANON_KEY present:", !!supabaseAnonKey);
}

// Only initialize if the URL and Key are provided
export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;
