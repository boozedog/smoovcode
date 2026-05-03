import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  BufferEncoding,
  CpOptions,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  RmOptions,
} from "just-bash";
import ignore, { type Ignore } from "ignore";

interface ReadFileOptions {
  encoding?: BufferEncoding | null;
}
interface WriteFileOptions {
  encoding?: BufferEncoding;
}
interface DirentEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/**
 * Default secret deny list applied even when no project .smoov/config.json
 * is present. Conservative: covers the obvious credential filenames.
 */
export const DEFAULT_SECRET_DENY: readonly string[] = [
  ".env",
  ".env.*",
  "*.pem",
  "id_rsa",
  "id_rsa.*",
  "id_ed25519",
  "id_ed25519.*",
  "*.key",
];

export interface GitignoreFsOptions {
  /** The wrapped filesystem. */
  inner: IFileSystem;
  /**
   * Patterns to filter against — same syntax as .gitignore, matched with the
   * `ignore` library against root-relative paths.
   */
  patterns: readonly string[];
  /**
   * Optional virtual mount point (for OverlayFs). When set, paths arriving
   * with this prefix have it stripped before matching against `patterns`.
   * If omitted, paths are matched as-is (treated as root-relative).
   */
  mountPoint?: string;
}

/**
 * Filesystem wrapper that hides paths matched by ignore patterns. Reads of
 * matched paths fail with ENOENT; readdir results have matched entries
 * filtered out. Writes pass through unchanged — the bash sandbox writes to
 * an in-memory overlay, so write filtering belongs at the persistence layer.
 */
export class GitignoreFs implements IFileSystem {
  private readonly inner: IFileSystem;
  private readonly mountPoint: string;
  private readonly matcher: Ignore;

  constructor(opts: GitignoreFsOptions) {
    this.inner = opts.inner;
    this.mountPoint = opts.mountPoint ?? "";
    this.matcher = ignore();
    for (const p of opts.patterns) {
      if (p.trim() !== "") this.matcher.add(p);
    }
  }

  /**
   * Convert an incoming path to a project-root-relative path suitable for
   * matching against gitignore patterns. Returns null when the path is
   * outside the mounted area (e.g. above the mount point) — those paths are
   * never matched.
   */
  private toRelative(p: string): string | null {
    let rel: string;
    if (this.mountPoint) {
      if (p === this.mountPoint) return "";
      const prefix = this.mountPoint.endsWith("/") ? this.mountPoint : `${this.mountPoint}/`;
      if (!p.startsWith(prefix)) return null;
      rel = p.slice(prefix.length);
    } else {
      rel = p;
    }
    rel = rel.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
    if (rel === "" || rel === ".") return "";
    return rel;
  }

  isIgnored(p: string): boolean {
    const rel = this.toRelative(p);
    if (rel === null || rel === "") return false;
    return this.matcher.ignores(rel);
  }

  private enoent(path: string): Error {
    const err = new Error(`ENOENT: no such file or directory, '${path}'`) as Error & {
      code?: string;
    };
    err.code = "ENOENT";
    return err;
  }

  async readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string> {
    if (this.isIgnored(path)) throw this.enoent(path);
    return this.inner.readFile(path, options);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    if (this.isIgnored(path)) throw this.enoent(path);
    return this.inner.readFileBuffer(path);
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    return this.inner.writeFile(path, content, options);
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    return this.inner.appendFile(path, content, options);
  }

  async exists(path: string): Promise<boolean> {
    if (this.isIgnored(path)) return false;
    return this.inner.exists(path);
  }

  async stat(path: string): Promise<FsStat> {
    if (this.isIgnored(path)) throw this.enoent(path);
    return this.inner.stat(path);
  }

  async lstat(path: string): Promise<FsStat> {
    if (this.isIgnored(path)) throw this.enoent(path);
    return this.inner.lstat(path);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    return this.inner.mkdir(path, options);
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.inner.readdir(path);
    const base = this.toRelative(path);
    if (base === null) return entries;
    return entries.filter((name) => {
      const rel = base === "" ? name : `${base}/${name}`;
      return !this.matcher.ignores(rel);
    });
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    if (!this.inner.readdirWithFileTypes) {
      const names = await this.readdir(path);
      const out: DirentEntry[] = [];
      for (const name of names) {
        const child = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
        const st = await this.inner.stat(child).catch(() => null);
        out.push({
          name,
          isFile: st?.isFile ?? false,
          isDirectory: st?.isDirectory ?? false,
          isSymbolicLink: st?.isSymbolicLink ?? false,
        });
      }
      return out;
    }
    const entries = await this.inner.readdirWithFileTypes(path);
    const base = this.toRelative(path);
    if (base === null) return entries;
    return entries.filter((e) => {
      const rel = base === "" ? e.name : `${base}/${e.name}`;
      return !this.matcher.ignores(rel);
    });
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    return this.inner.rm(path, options);
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    return this.inner.cp(src, dest, options);
  }

  async mv(src: string, dest: string): Promise<void> {
    return this.inner.mv(src, dest);
  }

  resolvePath(base: string, path: string): string {
    return this.inner.resolvePath(base, path);
  }

  getAllPaths(): string[] {
    const all = this.inner.getAllPaths();
    return all.filter((p) => !this.isIgnored(p));
  }

  async chmod(path: string, mode: number): Promise<void> {
    return this.inner.chmod(path, mode);
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    return this.inner.symlink(target, linkPath);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    return this.inner.link(existingPath, newPath);
  }

  async readlink(path: string): Promise<string> {
    if (this.isIgnored(path)) throw this.enoent(path);
    return this.inner.readlink(path);
  }

  async realpath(path: string): Promise<string> {
    return this.inner.realpath(path);
  }

  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    return this.inner.utimes(path, atime, mtime);
  }
}

export interface LoadIgnorePatternsOptions {
  /** Project root on the real filesystem. */
  root: string;
  /** Extra deny patterns (e.g. from .smoov/config.json secrets.deny). */
  extra?: readonly string[];
}

/**
 * Read and merge ignore patterns from the project's .gitignore, nested
 * .gitignore files, .git/info/exclude, the built-in default secret deny list,
 * and any caller-supplied extras.
 */
export function loadIgnorePatterns(opts: LoadIgnorePatternsOptions): string[] {
  const lines: string[] = [];

  function addFile(src: string, prefix = ""): void {
    if (!existsSync(src)) return;
    const text = readFileSync(src, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      if (prefix === "") {
        lines.push(line);
      } else if (line.startsWith("!")) {
        lines.push(`!${prefix}/${line.slice(1).replace(/^\//, "")}`);
      } else {
        lines.push(`${prefix}/${line.replace(/^\//, "")}`);
      }
    }
  }

  function walk(dir: string, rel = ""): void {
    addFile(join(dir, ".gitignore"), rel);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      walk(join(dir, entry.name), childRel);
    }
  }

  walk(opts.root);
  addFile(join(opts.root, ".git", "info", "exclude"));

  for (const p of DEFAULT_SECRET_DENY) lines.push(p);
  if (opts.extra) {
    for (const p of opts.extra) lines.push(p);
  }
  return lines;
}
