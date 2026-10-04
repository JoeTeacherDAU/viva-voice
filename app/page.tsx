import Link from "next/link";
import { Card } from "@/lib/ui";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="flex flex-col gap-4 max-w-md w-full">
        <h1 className="text-3xl font-semibold">Viva Voice</h1>
        <p className="text-on-surface-variant">Paired speaking exam capture.</p>
        <Link className="text-primary underline" href="/setup">
          Go to setup
        </Link>
      </Card>
    </main>
  );
}
