
const resolveEnv = (key: string): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem(key) || undefined;
};

export const getSupabaseConfig = () => ({
  url: resolveEnv('SUPABASE_URL'),
  key: resolveEnv('SUPABASE_ANON_KEY')
});

export const initSupabase = () => {
  // Return null - will be initialized dynamically in the component
  return null;
};

export const supabase = initSupabase();
