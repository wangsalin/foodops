import type { Metadata } from "next";
import type { ReactNode } from "react";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { antdTheme } from "@/styles/antd-theme";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "FoodOps Community",
  description: "Open-source local operations loop for chain food and beverage teams",
  icons: {
    icon: "/logo.svg"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ConfigProvider locale={zhCN} theme={antdTheme}>
          <AntdApp>{children}</AntdApp>
        </ConfigProvider>
      </body>
    </html>
  );
}
