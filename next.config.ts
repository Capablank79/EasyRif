import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "pdfkit", "exceljs"],
  experimental: {
    // Imagen máxima de 3 MB + sobrecarga multipart; el valor por defecto (1 MB) rompía las subidas.
    serverActions: { bodySizeLimit: "4mb" },
  },
  outputFileTracingIncludes: {
    "/api/comprobante/[token]": [
      "./node_modules/@expo-google-fonts/noto-sans/**/*.ttf",
      "./node_modules/@expo-google-fonts/noto-sans-mono/**/*.ttf",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
