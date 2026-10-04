"use client";

import dynamic from "next/dynamic";

const CaptureTest = dynamic(() => import("./CaptureTest").then((m) => m.CaptureTest), {
  ssr: false,
});

export default function CaptureTestPage() {
  return <CaptureTest />;
}
