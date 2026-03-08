import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {

 const { data: summaries } = await supabase
   .from("daily_health_summary")
   .select("*")
   .order("date",{ascending:false})
   .limit(45);

 const { data: patterns } = await supabase
   .from("personal_patterns")
   .select("*");

 if (!summaries) return NextResponse.json({error:"no summaries"});

 const today = new Date().toISOString().slice(0,10);

 const insight = `
Recovery: ${summaries[0].recovery_score}
HRV: ${summaries[0].hrv}

Detected patterns: ${patterns?.length ?? 0}

Sleep duration was ${summaries[0].sleep_duration}h.
`;

 await supabase.from("daily_insights").upsert({
   user_id: summaries[0].user_id,
   date: today,
   insight_text: insight
 });

 return NextResponse.json({success:true});

}