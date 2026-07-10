import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "./src/cli.ts"
  },
  outDir: "dist",
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "node",
  target: "es2022",
  external: ["@stale-styles/css-modules"],
  skipNodeModulesBundle: true,
  tsconfig: "tsconfig.build.json"
});
