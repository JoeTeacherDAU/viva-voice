import { Suspense } from "react";
import { Card } from "@/lib/ui";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="flex flex-col gap-4 max-w-sm w-full">
        <h1 className="text-2xl font-semibold">Viva Voice</h1>
        <Suspense>
          <LoginForm />
        </Suspense>
      </Card>
    </main>
  );
}
