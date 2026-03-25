// Server / scripts only — uses SUPABASE_SERVICE_ROLE_KEY (never import from client code).
import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !key) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY"
  );
}

export const supabaseAdmin = createClient(url, key);
