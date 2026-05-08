import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import AuthProvider from "@/components/providers/AuthProvider";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Performance Cycle | Live Chat Dashboard",
  description: "AI-assisted live chat system for Performance Cycle",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[10000] focus:bg-white focus:text-text-primary focus:px-3 focus:py-2 focus:rounded-button focus:shadow"
        >
          Skip to main content
        </a>
        <AuthProvider>
          <ToastProvider>
            <div id="main-content">{children}</div>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
