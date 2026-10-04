import { requireAuth } from "@/lib/auth/requireAuth";
import { regenerateExports } from "@/lib/output/pass2";
import { assertId } from "@/lib/storage/paths";
import { getStore } from "@/lib/storage/store";

/** GET /api/export?examId=...&format=wide|long regenerates both CSVs and returns one. */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const examId = url.searchParams.get("examId") ?? "";
  const format = url.searchParams.get("format") === "wide" ? "wide" : "long";
  try {
    assertId(examId, "exam id");
  } catch {
    return Response.json({ error: "bad examId" }, { status: 400 });
  }
  const csv = await regenerateExports(getStore(), examId);
  return new Response(csv[format], {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${examId}-${format}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
