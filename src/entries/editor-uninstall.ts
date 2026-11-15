// mods/editor-uninstall/main.js
import { HerdrSlotIO } from "../adapters/herdr/slot-io";
import { SlotStore } from "../ports/slot-store";
import { UninstallView, type UninstallDeps } from "../ui/uninstall-view";

export default class Uninstall extends UninstallView {
  protected makeDeps(): UninstallDeps {
    const io = new HerdrSlotIO();
    return { io, store: new SlotStore(io) };
  }
}
