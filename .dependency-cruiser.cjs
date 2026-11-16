// Dependency rule from docs/plans/2026-11-16-native-editor-plan.md §1:
//   entries → ui → ports → core, entries → adapters → ports → core, ui → core.
const HOST = "^(herdr|gpui-kit|gpui-base|fs/promises)$";
module.exports = {
  forbidden: [
    {
      name: "core-is-pure",
      severity: "error",
      comment: "core imports nothing outside core, except the theme data in editor-themes/",
      from: { path: "^src/core/" },
      to: { pathNot: "^(src/core/|editor-themes/[^/]+\\.json$)" },
    },
    { name: "core-no-host", severity: "error", from: { path: "^src/core/" }, to: { path: HOST } },
    {
      name: "ports-only-core",
      severity: "error",
      from: { path: "^src/ports/" },
      to: { pathNot: "^src/(core|ports)/" },
    },
    {
      name: "extensions-only-core",
      severity: "error",
      comment: "extensions are pure: core types and helpers only",
      from: { path: "^src/extensions/" },
      to: { pathNot: "^src/(core|extensions)/" },
    },
    { name: "ui-not-adapters", severity: "error", from: { path: "^src/ui/" }, to: { path: "^src/adapters/" } },
    {
      name: "only-entries-wire",
      severity: "error",
      comment: "nothing but entries imports entries",
      from: { pathNot: "^src/entries/" },
      to: { path: "^src/entries/" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
  },
};
