export async function POST() {
    return Response.json({ ok: true, route: "/api/insights/run" });
  }
  
  export async function GET() {
    return Response.json({ ok: true, hint: "Use POST" });
  }
  