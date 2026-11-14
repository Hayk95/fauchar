import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Legacy DOM clients attach listeners once; Strict Mode remounts break WebGL/CAD.
  reactStrictMode: false,
};

export default nextConfig;
