// Pure module: no host imports, bundled into main.js.
export function describe(label: string): string {
  return `// ${label} from a nested module\nconst ok: boolean = true;\n`;
}
