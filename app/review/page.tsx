"use client";

import dynamic from "next/dynamic";

const ReviewListClient = dynamic(
  () => import("./ReviewListClient").then((m) => m.ReviewListClient),
  { ssr: false },
);

export default function ReviewListPage() {
  return <ReviewListClient />;
}
