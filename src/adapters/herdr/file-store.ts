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
    if (window()?.platform === "windows") return null; // no `test`; to be settled by the Windows run of S4
    try {
      const r = await exec("test", ["-w", path], { timeout: 5000 });
      return r.code === 0;
    } catch {
      return null;
    }
  }
}
