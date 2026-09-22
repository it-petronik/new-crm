import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Enercore Workspace",
    short_name: "Enercore",
    description: "Connected business workspace",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#102326",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
