"use client";

import { Card, Typography } from "antd";

import { AppShell } from "@/components/layout/AppShell";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <AppShell>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {title}
      </Typography.Title>
      <Card>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {description}
        </Typography.Paragraph>
      </Card>
    </AppShell>
  );
}
