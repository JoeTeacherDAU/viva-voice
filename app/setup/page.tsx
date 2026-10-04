"use client";

import dynamic from "next/dynamic";

// The setup screen needs microphones and IndexedDB, so it renders in the browser only.
const SetupClient = dynamic(() => import("./SetupClient").then((m) => m.SetupClient), {
  ssr: false,
});

export default function SetupPage() {
  return <SetupClient />;
}
