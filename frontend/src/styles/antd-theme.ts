import type { ThemeConfig } from "antd";

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: "#569435",
    borderRadius: 8,
    colorBgLayout: "#f4f7fb",
    colorText: "#0f172a",
    colorTextSecondary: "#64748b",
    colorBorder: "#dbe4ee",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
  },
  components: {
    Layout: {
      headerBg: "#ffffff",
      siderBg: "#ffffff",
      triggerBg: "#ffffff",
      bodyBg: "#f4f7fb"
    },
    Card: {
      colorBgContainer: "rgba(255,255,255,0.78)",
      colorBorderSecondary: "rgba(230,234,220,0.82)",
      borderRadiusLG: 8
    },
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#64748b",
      rowHoverBg: "#f6fbfd",
      colorBgContainer: "#ffffff",
      borderColor: "#e5edf5"
    },
    Menu: {
      itemBg: "#ffffff",
      itemSelectedBg: "#e6f8fb",
      itemSelectedColor: "#087c89"
    },
    Input: {
      colorBgContainer: "rgba(255,255,255,0.72)",
      colorBorder: "#dbe4ee",
      activeBorderColor: "#569435",
      hoverBorderColor: "#569435"
    },
    Button: {
      primaryShadow: "none"
    },
    Tag: {
      borderRadiusSM: 999
    }
  }
};
