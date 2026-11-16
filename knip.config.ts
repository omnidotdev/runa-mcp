import type { KnipConfig } from "knip";

/**
 * Knip configuration
 * @see https://knip.dev/reference/configuration
 */
const knipConfig: KnipConfig = {
  entry: ["src/index.ts"],
  project: ["src/**/*.ts", "test/**/*.ts"],
  ignoreExportsUsedInFile: {
    interface: true,
    type: true,
  },
};

export default knipConfig;
