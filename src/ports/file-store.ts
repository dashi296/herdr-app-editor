// The editor's view of the files it edits. Local and remote reads; writes and watches are local only (R4).

export interface FolderWatch {
  /** Changed paths (or the root itself: reload everything). */
  readonly changes: Promise<string[]>;
  cancel(): void;
}

export interface FileStore {
  /** UTF-8 text up to 1 MiB, or null when absent. Rejects on invalid UTF-8 or size (R3). */
  read(path: string, machine: string | null): Promise<string | null>;
  /** Replaces the file only if it still holds `expected` (null: create). */
  write(path: string, text: string, expected: string | null): Promise<void>;
  watch(dir: string): FolderWatch;
  /**
   * Whether saving would be allowed. writeTextFile replaces read-only files (spike S4, R17),
   * so this is checked before opening for edit and before each save. null: unknown on this platform.
   */
  canWrite(path: string, machine: string | null): Promise<boolean | null>;
}
