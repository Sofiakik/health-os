"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const run = async () => {
      const code = params.get("code");
      if (!code) {
        router.replace("/login?error=missing_code");
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        router.replace("/login?error=exchange_failed");
        return;
      }

      router.replace("/calendar");
    };

    run();
  }, [params, router]);

  return <p>Signing you in…</p>;
}