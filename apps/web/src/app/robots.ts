import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/login",
          "/api/",
          "/overview",
          "/offers",
          "/publications",
          "/analytics",
          "/sales",
          "/autopilot",
          "/templates",
          "/integrations",
          "/channels",
          "/settings",
        ],
      },
    ],
    sitemap: "https://botlia.com.br/sitemap.xml",
  };
}
