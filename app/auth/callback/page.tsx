import { Suspense } from "react";
import CallbackClient from "./CallBackClient";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Signing you in…</div>}>
      <CallbackClient />
    </Suspense>
  );
}