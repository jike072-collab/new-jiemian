import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "奥皇 AI",
  description: "本地优先的 AI 图片与视频生成工作台",
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
