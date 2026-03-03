"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  // Hard guard against accidental double submits (even if React rerenders)
  const inFlightRef = useRef(false);

  // Optional: if user edits email after "sent", reset the button back
  useEffect(() => {
    if (phase === "sent") setPhase("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  async function sendMagicLink() {
    const cleanEmail = email.trim();

    if (!isValidEmail(cleanEmail)) {
      setPhase("error");
      setStatus("Enter a valid email.");
      return;
    }

    // Block duplicate calls (click spam, Enter spam, slow network)
    if (inFlightRef.current || phase === "sending" || phase === "sent") return;

    inFlightRef.current = true;
    setPhase("sending");
    setStatus("");

    const { error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        // Important: works on Vercel AND localhost
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    inFlightRef.current = false;

    if (error) {
      setPhase("error");

      // Make the rate-limit error actionable
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("rate limit") || msg.includes("too many")) {
        setStatus(
          "Rate limit reached. Wait 10–15 minutes, then try again (and don’t click twice)."
        );
      } else {
        setStatus(error.message || "Something went wrong.");
      }

      return;
    }

    setPhase("sent");
    setStatus("Link sent. Check your email.");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault(); // prevents reload + duplicate submits
    void sendMagicLink();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Prevent Enter from firing multiple submits while sending/sent
    if (e.key === "Enter") {
      e.preventDefault();
      void sendMagicLink();
    }
  }

  const buttonLabel =
    phase === "sending"
      ? "Sending..."
      : phase === "sent"
      ? "Link sent"
      : "Send magic link";

  const buttonDisabled =
    phase === "sending" || phase === "sent" || !email.trim();

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1 style={{ marginBottom: 12 }}>Login</h1>

      <form onSubmit={onSubmit}>
        <label style={{ display: "block", marginBottom: 8 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="you@example.com"
            autoComplete="email"
            style={{
              display: "block",
              width: "100%",
              padding: "10px 12px",
              marginTop: 6,
            }}
          />
        </label>

        <button
          type="submit"
          disabled={buttonDisabled}
          style={{
            padding: "10px 12px",
            width: "100%",
            cursor: buttonDisabled ? "not-allowed" : "pointer",
          }}
        >
          {buttonLabel}
        </button>

        {status ? (
          <p style={{ marginTop: 12, color: phase === "error" ? "crimson" : "" }}>
            {status}
          </p>
        ) : null}
      </form>
    </main>
  );
}