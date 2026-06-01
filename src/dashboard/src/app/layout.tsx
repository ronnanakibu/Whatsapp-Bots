import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RonnBot Radio",
  description: "Premium, highly animated music streaming experience",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased text-white selection:bg-purple-500/30">
        {children}
      </body>
    </html>
  );
}
