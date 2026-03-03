"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const run = async () => {
      // Supabase magic/OTP links typically include ?code=...
      const code = searchParams.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("exchangeCodeForSession error:", error);
          router.replace("/login");
          return;
        }
      }

      // If session exists (or after exchanging code), go to calendar
      router.replace("/calendar");
    };

    run();
  }, [router, searchParams]);

  return <div style={{ padding: 24 }}>Finishing login…</div>;
}