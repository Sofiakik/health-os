"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    async function handleAuth() {
      await supabase.auth.getSession();
      router.push("/calendar");
    }

    handleAuth();
  }, [router]);

  return <p>Signing you in...</p>;
}