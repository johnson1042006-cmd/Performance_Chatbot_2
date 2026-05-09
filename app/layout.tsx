import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import AuthProvider from "@/components/providers/AuthProvider";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-barlow",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-barlow-condensed",
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
        className={`${barlow.variable} ${barlowCondensed.variable} font-sans antialiased`}
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
