// S6 spike: watchFolder latency and coverage, plus readTextFile cost for polling.
// Opened once as an overlay; touches only ~/herdr-spike-s6. Closes itself.
import { View, div } from "gpui-kit";
import { props, home, appHome, exec, watchFolder, readTextFile, closeOverlay, theme } from "herdr";
import * as fs from "fs/promises";

export default class S6 extends View {
  init(_props, cx) {
    this.status = "idle";
    this.results = [];
    if (!props()?.overlay) return; // herdr-app check
    this.status = "running";
    cx.spawn(async (cx) => {
      try { await this.run(cx); this.status = "done"; } catch (e) { this.results.push({ fatal: String(e) }); this.status = "fatal"; }
      try {
        const dir = `${appHome()}/data/s6-watch`;
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(`${dir}/result.json`, JSON.stringify(this.results, null, 1));
      } catch (e) { this.status += ` save: ${e}`; }
      cx.notify();
      await cx.sleep(300);
      closeOverlay(props().overlay);
    });
  }

  // Starts a watch, then changes the tree with a shell command after `delay` ms.
  async watchCase(cx, label, root, script, delay = 300, timeout = 5000) {
    const started = Date.now();
    const watch = watchFolder(root);
    exec("sh", ["-c", `sleep ${delay / 1000}; ${script}`], { cwd: root }).catch(() => {});
    const changedAt = started + delay;
    const timer = cx.sleep(timeout).then(() => "timeout");
    const r = await Promise.race([watch.then((paths) => ({ paths })), timer]);
    if (r === "timeout") { this.results.push({ label, fired: false, timeoutMs: timeout }); return; }
    this.results.push({ label, fired: true, latencyMs: Date.now() - changedAt, paths: r.paths.map((p) => p.replace(root, "<root>")) });
  }

  async run(cx) {
    const B = `${home()}/herdr-spike-s6`;
    await this.watchCase(cx, "append to file", B, "printf 'more\\n' >> file.txt");
    await this.watchCase(cx, "atomic replace (write tmp + mv)", B, "printf 'new\\n' > .tmp-x && mv .tmp-x file.txt");
    await this.watchCase(cx, "nested subdir change", B, "printf 'n\\n' >> sub/deep/nested.txt");
    await this.watchCase(cx, "git-ignored dir change", B, "printf 'i\\n' >> ignored/i.txt");
    await this.watchCase(cx, "delete file", B, "rm -f gone.txt");
    await this.watchCase(cx, "no change (control)", B, "true", 300, 2000);
    // readTextFile cost for polling
    for (const name of ["big-1mib.txt", "small.txt"]) {
      const times = [];
      for (let i = 0; i < 5; i++) { const t = Date.now(); await readTextFile(`${B}/${name}`); times.push(Date.now() - t); }
      this.results.push({ label: `readTextFile ${name} x5`, ms: times });
    }
  }

  render(_cx) {
    const t = theme();
    return div().id("s6").size_full().bg(t.popover).text_color(t.foreground).p(12).child(`s6-watch: ${this.status}`);
  }
}
