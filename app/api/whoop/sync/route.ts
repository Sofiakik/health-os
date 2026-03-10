import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const WHOOP_API = "https://api.prod.whoop.com/developer/v2";

async function refreshTokenIfNeeded(tokenRow: any) {
  const now = new Date();

  if (!tokenRow.expires_at || new Date(tokenRow.expires_at) > now) {
    return tokenRow.access_token;
  }

  if (!tokenRow.refresh_token) {
    throw new Error("No refresh token available");
  }

  const res = await fetch(
    "https://api.prod.whoop.com/oauth/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
        client_id: process.env.WHOOP_CLIENT_ID!,
        client_secret: process.env.WHOOP_CLIENT_SECRET!,
      }),
    }
  );

  const tokens = await res.json();

  if (!tokens.access_token) {
    throw new Error("WHOOP token refresh failed");
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await supabase
    .from("whoop_tokens")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? tokenRow.refresh_token,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", tokenRow.user_id);

  return tokens.access_token;
}

async function fetchWhoop(endpoint: string, token: string) {
  const res = await fetch(`${WHOOP_API}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[whoop sync] non-OK response", res.status, res.statusText, endpoint, body);
    throw new Error(body || `WHOOP API ${res.status} ${res.statusText}`);
  }

  return res.json();
}

type HealthMetricRow = {
  user_id: string;
  metric_type: string;
  metric_value: number;
  metric_timestamp: string;
  source: string;
  metric_unit?: string | null;
  raw_data?: object | null;
};

function whoopRawRecordId(record: any, type: string): string | null {
  if (record.id != null) return String(record.id);
  if (type === "recovery" && record.sleep_id != null) return record.sleep_id;
  return null;
}

function buildWhoopRawRows(
  userId: string,
  cycleRecords: any[],
  recoveryRecords: any[],
  sleepRecords: any[],
  workoutRecords: any[]
): { user_id: string; type: string; payload: object; source_id: string | null }[] {
  const rows: { user_id: string; type: string; payload: object; source_id: string | null }[] = [];
  for (const r of cycleRecords) {
    rows.push({ user_id: userId, type: "cycle", payload: r, source_id: whoopRawRecordId(r, "cycle") });
  }
  for (const r of recoveryRecords) {
    rows.push({ user_id: userId, type: "recovery", payload: r, source_id: whoopRawRecordId(r, "recovery") });
  }
  for (const r of sleepRecords) {
    rows.push({ user_id: userId, type: "sleep", payload: r, source_id: whoopRawRecordId(r, "sleep") });
  }
  for (const r of workoutRecords) {
    rows.push({ user_id: userId, type: "workout", payload: r, source_id: whoopRawRecordId(r, "workout") });
  }
  return rows;
}

function buildHealthMetrics(
  userId: string,
  cycleRecords: any[],
  recoveryRecords: any[],
  sleepRecords: any[]
): HealthMetricRow[] {
  const rows: HealthMetricRow[] = [];

  for (const r of recoveryRecords ?? []) {
    const ts = r.created_at;
    if (!ts) continue;
    const score = r.score ?? {};
    if (score.recovery_score != null) {
      rows.push({ user_id: userId, metric_type: "recovery_score", metric_value: Number(score.recovery_score), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
    if (score.hrv_rmssd_milli != null) {
      rows.push({ user_id: userId, metric_type: "hrv", metric_value: Number(score.hrv_rmssd_milli), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
    if (score.resting_heart_rate != null) {
      rows.push({ user_id: userId, metric_type: "resting_hr", metric_value: Number(score.resting_heart_rate), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
    if (score.spo2_percentage != null) {
      rows.push({ user_id: userId, metric_type: "blood_oxygen", metric_value: Number(score.spo2_percentage), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
    if (score.skin_temp_celsius != null) {
      rows.push({ user_id: userId, metric_type: "skin_temperature", metric_value: Number(score.skin_temp_celsius), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
  }

  for (const r of sleepRecords ?? []) {
    const ts = r.end;
    if (!ts) continue;
    const score = r.score ?? {};
    const stage = score.stage_summary ?? {};
    const inBedMillis = stage.total_in_bed_time_milli ?? 0;
    if (inBedMillis > 0) {
      rows.push({ user_id: userId, metric_type: "sleep_duration", metric_value: inBedMillis / (1000 * 3600), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
    const deepMillis = stage.total_slow_wave_sleep_time_milli ?? 0;
    if (deepMillis > 0) {
      rows.push({ user_id: userId, metric_type: "deep_sleep_duration", metric_value: deepMillis / (1000 * 3600), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
    const remMillis = stage.total_rem_sleep_time_milli ?? 0;
    if (remMillis > 0) {
      rows.push({ user_id: userId, metric_type: "rem_sleep_duration", metric_value: remMillis / (1000 * 3600), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
    if (score.respiratory_rate != null) {
      rows.push({ user_id: userId, metric_type: "respiratory_rate", metric_value: Number(score.respiratory_rate), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
    if (score.sleep_efficiency_percentage != null) {
      rows.push({ user_id: userId, metric_type: "sleep_efficiency", metric_value: Number(score.sleep_efficiency_percentage), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
  }

  for (const r of cycleRecords ?? []) {
    const ts = r.end;
    if (ts == null) continue;
    const score = r.score ?? {};
    if (score.strain != null) {
      rows.push({ user_id: userId, metric_type: "strain", metric_value: Number(score.strain), metric_timestamp: ts, source: "whoop", raw_data: r });
    }
  }

  return rows;
}

export async function GET() {
  try {
    const { data: tokenRow } = await supabase
      .from("whoop_tokens")
      .select("*")
      .limit(1)
      .single();

    if (!tokenRow) {
      return NextResponse.json({ error: "No WHOOP token stored" });
    }

    const accessToken = await refreshTokenIfNeeded(tokenRow);

    const cycles = await fetchWhoop("/cycle", accessToken);
    const recoveries = await fetchWhoop("/recovery", accessToken);
    const sleeps = await fetchWhoop("/activity/sleep", accessToken);
    const workouts = await fetchWhoop("/activity/workout", accessToken);

    const cycleRecords = cycles?.records ?? [];
    const recoveryRecords = recoveries?.records ?? [];
    const sleepRecords = sleeps?.records ?? [];
    const workoutRecords = workouts?.records ?? [];

    const userId = tokenRow.user_id as string;

    const whoopRawRows = buildWhoopRawRows(
      userId,
      cycleRecords,
      recoveryRecords,
      sleepRecords,
      workoutRecords
    );

    if (whoopRawRows.length > 0) {
      const { error: rawError } = await supabase
        .from("whoop_raw")
        .insert(whoopRawRows);

      if (rawError) {
        throw rawError;
      }
    }

    const metricRows = buildHealthMetrics(
      userId,
      cycleRecords,
      recoveryRecords,
      sleepRecords
    );

    if (metricRows.length > 0) {
      const { error: metricsError } = await supabase
        .from("health_metrics")
        .upsert(metricRows, {
          onConflict: "user_id,metric_type,metric_timestamp",
        });

      if (metricsError) {
        throw metricsError;
      }
    }

    let summaryTriggered = false;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
    if (baseUrl) {
      try {
        const summaryRes = await fetch(`${baseUrl}/api/summary/daily`);
        summaryTriggered = summaryRes.ok;
      } catch (_e) {
        // leave summaryTriggered false
      }
    }

    return NextResponse.json({
      success: true,
      cycles: cycleRecords.length,
      recoveries: recoveryRecords.length,
      sleeps: sleepRecords.length,
      workouts: workoutRecords.length,
      whoop_raw_rows: whoopRawRows.length,
      health_metrics_upserted: metricRows.length,
      summary_triggered: summaryTriggered,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Sync failed" },
      { status: 500 }
    );
  }
}
