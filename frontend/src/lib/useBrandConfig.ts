"use client";

import { useEffect, useState } from "react";

import { defaultBrandConfig, fetchBrandConfig, type BrandConfig } from "@/lib/brand";

export function useBrandConfig() {
  const [brand, setBrand] = useState<BrandConfig>(defaultBrandConfig);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchBrandConfig()
        .then((value) => {
          if (alive) setBrand(value);
        })
        .catch(() => {
          if (alive) setBrand(defaultBrandConfig);
        });
    };
    load();
    window.addEventListener("foodops:brand-updated", load);
    return () => {
      alive = false;
      window.removeEventListener("foodops:brand-updated", load);
    };
  }, []);

  return brand;
}
