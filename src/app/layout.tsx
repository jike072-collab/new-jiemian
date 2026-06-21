import type { Metadata } from "next";
import "./globals.css";
import "./auth-visual.css";

export const metadata: Metadata = {
  title: "奥皇 AI",
  description: "一个打开就能用的图片生成、视频生成和本机放大工作台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-black text-white">{children}</body>
    </html>
  );
}
