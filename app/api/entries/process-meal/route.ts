import { NextResponse } from "next/server";
import { processMealEntry } from "@/lib/mealNutrition";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!;

function mustEnv(name: string, v: string | undefined): string {
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function getUserIdFromBearer(req: Request): Promise<string> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) throw new Error("Missing Authorization Bearer token");

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    throw new Error(`Not authenticated (${res.status}): ${details}`);
  }

  const user = (await res.json()) as { id: string };
  return user.id;
}

export async function POST(req: Request) {
  try {
    const userId = await getUserIdFromBearer(req);

    const body = (await req.json()) as { entry_id?: string };
    if (!body.entry_id) {
      return NextResponse.json({ error: "Missing entry_id" }, { status: 400 });
    }

    const result = await processMealEntry({ entry_id: body.entry_id, user_id: userId });

    return NextResponse.json({
      ok: true,
      entry_id: body.entry_id,
      ...result,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

