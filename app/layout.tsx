import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Viva Voice",
  description: "Paired speaking exam capture and utterance fluency measurement",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${spaceGrotesk.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-on-surface">{children}</body>
    </html>
  );
}
