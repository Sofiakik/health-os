"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const run = async () => {
      const code = searchParams.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("exchangeCodeForSession error:", error);
          router.replace("/login");
          return;
        }
      }

      router.replace("/calendar");
    };

    run();
  }, [router, searchParams]);

  return <div style={{ padding: 24 }}>Finishing login…</div>;
}

export default function CallBackClient() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <CallbackInner />
    </Suspense>
  );
}