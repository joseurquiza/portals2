
import { createClient } from 'https://esm.sh/@supabase/supabase-js@^2.39.7';

const resolveEnv = (key: string): string | undefined => {
  const env = (process as any).env || {};
  return localStorage.getItem(key) || env[key] || env[`VITE_${key}`] || env[`NEXT_PUBLIC_${key}`] || env[`REACT_APP_${key}`];
};

export const getSupabaseConfig = () => ({
  url: resolveEnv('SUPABASE_URL'),
  key: resolveEnv('SUPABASE_ANON_KEY')
});

export const initSupabase = () => {
  const { url, key } = getSupabaseConfig();
  if (url && key) {
    try {
      return createClient(url, key);
    } catch (e) {
      console.error("Failed to init Supabase client", e);
      return null;
    }
  }
  return null;
};

export const supabase = initSupabase();
