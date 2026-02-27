import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeLens",
  description: "AI-powered code review interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
