import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Inline the mock-transcriber switch so browser code can read it too.
  env: {
    VIVA_MOCK_ASR: process.env.VIVA_MOCK_ASR ?? "",
  },
};

export default nextConfig;
