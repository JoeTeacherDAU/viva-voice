import { requireAuth } from "@/lib/auth/requireAuth";
import { assertId, paths } from "@/lib/storage/paths";
import { getJson, getStore, putJson } from "@/lib/storage/store";
import { validateExam } from "@/lib/validation";

/** GET /api/exam?examId=... downloads the exam record as JSON (build-plan P7.3). */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const examId = new URL(request.url).searchParams.get("examId") ?? "";
  try {
    assertId(examId, "exam id");
  } catch {
    return Response.json({ error: "bad examId" }, { status: 400 });
  }
  const exam = await getJson(getStore(), paths.exam(examId));
  if (!exam) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(JSON.stringify(exam, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${examId}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** POST /api/exam with an exam record writes exams/{id}.json after schema validation. */
export async function POST(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  let exam: unknown;
  try {
    exam = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const v = validateExam(exam);
  if (!v.ok) return Response.json({ error: v.errors.join("; ") }, { status: 422 });
  const id = (exam as { id: string }).id;
  await putJson(getStore(), paths.exam(id), exam);
  return Response.json({ ok: true, examId: id });
}
