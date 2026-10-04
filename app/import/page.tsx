"use client";

import dynamic from "next/dynamic";

const ImportClient = dynamic(() => import("./ImportClient").then((m) => m.ImportClient), {
  ssr: false,
});

export default function ImportPage() {
  return <ImportClient />;
}
