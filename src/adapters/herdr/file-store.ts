import { exec, readTextFile, watchFolder, window, writeTextFile } from "herdr";
import type { FileStore, FolderWatch } from "../../ports/file-store";

export class HerdrFileStore implements FileStore {
  read(path: string, machine: string | null): Promise<string | null> {
    return readTextFile(path, { on: machine });
  }

  async write(path: string, text: string, expected: string | null): Promise<void> {
    await writeTextFile(path, text, expected);
  }

  watch(dir: string): FolderWatch {
    const w = watchFolder(dir);
    return { changes: w, cancel: () => w.cancel() };
  }

  async canWrite(path: string, machine: string | null): Promise<boolean | null> {
    if (machine !== null) return false; // writes are local only
    try {
      if (window()?.platform === "windows") {
        // Read-only attribute. Quotes are doubled as the shipped Files mod does for PowerShell literals.
        // Not yet run on Windows (plan S4): a failure returns null, which disables saving.
        const literal = "'" + path.replace(/['\u2018\u2019\u201a\u201b]/g, "$&$&") + "'";
        const r = await exec("powershell", ["-NoProfile", "-Command", `if ((Get-Item -LiteralPath ${literal} -ErrorAction Stop).IsReadOnly) { exit 1 } else { exit 0 }`], { timeout: 10000 });
        return r.code === 0 ? true : r.code === 1 ? false : null;
      }
      const r = await exec("test", ["-w", path], { timeout: 5000 });
      return r.code === 0;
    } catch {
      return null;
    }
  }
}
