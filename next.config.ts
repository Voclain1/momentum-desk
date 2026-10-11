import type { NextConfig } from "next";
import { parseEnv } from "./lib/env";

// Fail fast on a misconfigured environment when `next dev`/`next build` starts.
parseEnv(process.env);

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
