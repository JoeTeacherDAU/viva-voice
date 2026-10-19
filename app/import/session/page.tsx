"use client";

import dynamic from "next/dynamic";

const SessionImportClient = dynamic(
  () => import("./SessionImportClient").then((m) => m.SessionImportClient),
  { ssr: false },
);

export default function SessionImportPage() {
  return <SessionImportClient />;
}
