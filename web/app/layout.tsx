import type { Metadata } from "next";
import "./globals.css";

import { AuthProvider } from "./components/AuthProvider";
import { ProfileProvider } from "./components/ProfileProvider";
import AuroraIntro from "./components/AuroraIntro";

export const metadata: Metadata = {
  title: "Aurora",
  description: "Modern Movie Streaming Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ProfileProvider>
            <AuroraIntro />
            {children}
          </ProfileProvider>
        </AuthProvider>
      </body>
    </html>
  );
}