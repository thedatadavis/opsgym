import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsGym",
  description: "Policy workspace for agent hardening"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
