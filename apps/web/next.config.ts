import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
// Load environment variables from the monorepo root if present
loadEnvConfig(path.resolve(projectDir, "../.."));

const nextConfig: NextConfig = {
  transpilePackages: ["@bim/contracts"],
};

export default nextConfig;
