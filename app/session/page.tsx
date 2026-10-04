"use client";

import dynamic from "next/dynamic";

// The live display needs the microphone, Web Audio, and IndexedDB, so it renders in the browser only.
const SessionClient = dynamic(() => import("./SessionClient").then((m) => m.SessionClient), {
  ssr: false,
});

export default function SessionPage() {
  return <SessionClient />;
}
