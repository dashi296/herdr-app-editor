import * as fs from "fs/promises";
import { appHome, exec, window } from "herdr";
import { imageDir } from "../../core/draft/paths";
import { NS } from "../../core/names";
import type { ImageStore } from "../../ports/image-store";

/**
 * Images are exposed under appHome()/data/<ns>/images/<pane key>/ (spike S13).
 * macOS and Linux: a symlink, so nothing is copied and the file may be anywhere. Windows has no
 * `ln`: the file is copied with the host fs, which reads only under the home folder and has not
 * been run there yet. Old entries are removed with `rm`/fs.unlink by name, never through the link.
 */
export class HerdrImageStore implements ImageStore {
  private count = 0;

  private rel(paneKey: string): string {
    return `data/${NS}/${imageDir(paneKey)}`;
  }

  async expose(path: string, paneKey: string): Promise<string> {
    const rel = this.rel(paneKey),
      dir = `${appHome()}/${rel}`;
    await this.release(paneKey);
    await fs.mkdir(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${this.count++}`;
    if (window()?.platform === "windows") {
      await fs.writeFile(`${dir}/${name}`, await fs.readFile(path));
    } else {
      // ln -s succeeds for a missing target and image() then shows nothing, so check first.
      const there = await exec("test", ["-f", path, "-a", "-r", path], { timeout: 5000 });
      if (there.code !== 0) throw new Error("the file is missing or unreadable");
      const made = await exec("ln", ["-s", "--", path, `${dir}/${name}`], { timeout: 5000 });
      if (made.code !== 0) throw new Error(made.stderr.trim() || `ln exited with ${made.code}`);
    }
    return `${rel}/${name}`;
  }

  async release(paneKey: string): Promise<void> {
    try {
      const dir = `${appHome()}/${this.rel(paneKey)}`;
      if (!(await fs.exists(dir))) return;
      const names = await fs.readdir(dir);
      if (names.length === 0) return;
      if (window()?.platform === "windows") for (const n of names) await fs.unlink(`${dir}/${n}`);
      // rm removes the link itself; the host fs may refuse a path that resolves outside the app home.
      else await exec("rm", ["-f", "--", ...names.map((n) => `${dir}/${n}`)], { timeout: 5000 });
    } catch {
      /* best effort: a leftover link is a few bytes */
    }
  }
}
