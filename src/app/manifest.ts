import type { MetadataRoute } from "next";

// Lets the app be added to a phone's home screen and open full-screen,
// like an installed app (iPhone: Share -> Add to Home Screen).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Finance",
    short_name: "Finance",
    description: "A shared household finance tracker",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#EAF4FC",
    theme_color: "#1C2B3A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
