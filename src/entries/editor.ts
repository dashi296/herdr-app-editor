// mods/editor/main.js: wires the Herdr adapters into the editor view.
import { HerdrFileStore } from "../adapters/herdr/file-store";
import { HerdrSlotIO } from "../adapters/herdr/slot-io";
import { SlotStore } from "../ports/slot-store";
import { EditorView, type EditorDeps } from "../ui/editor-view";

export default class Editor extends EditorView {
  protected makeDeps(): EditorDeps {
    return { files: new HerdrFileStore(), store: new SlotStore(new HerdrSlotIO()) };
  }
}
