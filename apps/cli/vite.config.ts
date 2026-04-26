import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: false,
    exports: false,
    noExternal: [/^@smoovcode\//],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
