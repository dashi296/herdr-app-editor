// How the editor gets a picture on screen. The host's image() reads only paths inside the app home
// and remembers what it read under each path (spike S13), so a file elsewhere is exposed under a
// new name in the app home every time it is opened.

export interface ImageStore {
  /**
   * Makes a local image file readable by image() and returns the path to give it (relative to the
   * app home). Each call returns a path not used before and removes what earlier calls made for
   * the same pane. Rejects when the file is missing or unreadable.
   */
  expose(path: string, paneKey: string): Promise<string>;
  /** Removes what expose made for the pane. Never rejects. */
  release(paneKey: string): Promise<void>;
}
