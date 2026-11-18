import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Still bounded by MAX_CAPTURE_IMAGE_BYTES in server-side validation.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
