import type { Metadata } from "next";
import { Playfair_Display, DM_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AuthStateProvider } from "./contexts/AuthContext";
import { ClerkSync } from "./contexts/ClerkSync";
import { ChunkErrorRecovery } from "./contexts/ChunkErrorRecovery";
import { ServiceWorkerManager } from "./contexts/ServiceWorkerManager";
import { BrandStrip } from "@/components/BrandStrip";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Onegent — Restaurant Recommendations",
  description: "AI-powered restaurant discovery",
  manifest: "/manifest.json",
};

// Only enable Clerk when real keys are configured (not placeholder values)
const clerkEnabled =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_") &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_placeholder";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const inner = (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#C9A84C" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${playfair.variable} ${dmSans.variable} antialiased`}>
        <ChunkErrorRecovery />
        <ServiceWorkerManager />
        {/* ClerkSync bridges Clerk state to AuthContext (only rendered when Clerk is configured) */}
        {clerkEnabled && <ClerkSync />}
        <BrandStrip />
        {children}
      </body>
    </html>
  );

  // AuthStateProvider must wrap the html element so all client components can access auth state
  const withAuthProvider = <AuthStateProvider>{inner}</AuthStateProvider>;

  return clerkEnabled ? <ClerkProvider>{withAuthProvider}</ClerkProvider> : withAuthProvider;
}
