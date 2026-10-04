import { NextResponse } from "next/server";
import { COOKIE_NAME, passwordMatches, SESSION_TTL_SECONDS, signSession } from "@/lib/auth";

export async function POST(request: Request) {
  const expected = process.env.VIVA_PASSWORD ?? "";
  const secret = process.env.VIVA_SESSION_SECRET ?? "";
  if (!expected || !secret) {
    return NextResponse.json({ error: "login is not configured" }, { status: 500 });
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!(await passwordMatches(password, expected))) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await signSession(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
