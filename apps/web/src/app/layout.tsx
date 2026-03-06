import type { Metadata, Viewport } from "next";
import "./globals.css";
import { VitalsReporter } from "@/components/vitals-reporter";

export const metadata: Metadata = {
  title: "CodeLens",
  description: "AI-powered code review interface",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <VitalsReporter />
        {children}
      </body>
    </html>
  );
}
