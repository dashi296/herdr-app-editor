import * as fs from "fs/promises";
import { appHome } from "herdr";
import { NS } from "../../core/names";
import type { SlotIO } from "../../ports/slot-store";

/**
 * Store files under appHome()/data/<ns>/. The host fs reads only under home() and writes only
 * under the app home (R13); during `herdr-app check` calls throw synchronously (spike S1-3),
 * so every call is awaited inside an async function.
 */
export class HerdrSlotIO implements SlotIO {
  private root = `${appHome()}/data/${NS}`;

  private abs(rel: string): string {
    return `${this.root}/${rel}`;
  }

  async read(rel: string): Promise<string | null> {
    const path = this.abs(rel);
    if (!(await fs.exists(path))) return null;
    return await fs.readFile(path, "utf8");
  }

  async write(rel: string, text: string): Promise<void> {
    const path = this.abs(rel);
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(path, text);
  }

  async unlink(rel: string): Promise<void> {
    const path = this.abs(rel);
    if (await fs.exists(path)) await fs.unlink(path);
  }

  async list(relDir: string): Promise<string[]> {
    const path = this.abs(relDir);
    if (!(await fs.exists(path))) return [];
    return await fs.readdir(path);
  }
}
