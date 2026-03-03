"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      // This reads the ?code=... from URL and exchanges it for a session
      const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
      if (error) {
        router.replace("/login?error=callback");
        return;
      }
      router.replace("/calendar");
    };

    run();
  }, [router]);

  return <p>Signing you in…</p>;
}