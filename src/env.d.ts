/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_SHOWCASE_PROFILE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
