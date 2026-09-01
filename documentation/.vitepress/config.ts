import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "useCourier",
  description:
    "A headless React hook for file uploads with progress tracking, retries, cancellation, and chunked uploads for large files.",
  base: "/useCourier/",
  themeConfig: {
    sidebar: [
      {
        text: "Introduction",
        items: [{ text: "Getting Started", link: "/get-started" }],
      },
      {
        text: "API Reference",
        items: [
          { text: "Functions and Options", link: "/api" },
          { text: "Large File Uploads", link: "/large-files" },
          { text: "Backend Integration", link: "/backend-integration" },
        ],
      },
      {
        text: "Framework Examples",
        items: [
          { text: "Express", link: "/examples/express" },
          { text: "Next.js", link: "/examples/nextjs" },
          { text: "TanStack Start", link: "/examples/tanstack-start" },
          { text: "Hono", link: "/examples/hono" },
        ],
      },
      {
        text: "Integrations",
        items: [
          {
            text: "Shadcn Attachments",
            link: "/integrations/shadcn-attachments",
          },
        ],
      },
      {
        text: "Other",
        items: [
          { text: "About", link: "/about" },
          { text: "License", link: "/license" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/mrphilipp7/useCourier" },
    ],
  },
});
