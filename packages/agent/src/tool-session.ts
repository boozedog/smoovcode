import {
  OverlayFs,
  type CpOptions,
  type FileContent,
  type IFileSystem,
  type MkdirOptions,
  type RmOptions,
} from "just-bash";
import { createTools, type AgentTools, type CreateToolsOptions } from "./tools.ts";

export interface DirtyTracker {
  isDirty(): boolean;
  mark(path?: string): void;
  clear(): void;
  paths(): readonly string[];
}

export class SimpleDirtyTracker implements DirtyTracker {
  private dirty = false;
  private readonly changed = new Set<string>();

  isDirty(): boolean {
    return this.dirty;
  }

  mark(path?: string): void {
    this.dirty = true;
    if (path) this.changed.add(path);
  }

  clear(): void {
    this.dirty = false;
    this.changed.clear();
  }

  paths(): readonly string[] {
    return [...this.changed].sort();
  }
}

export class DirtyTrackingFs implements IFileSystem {
  constructor(
    private readonly inner: IFileSystem,
    private readonly dirty: DirtyTracker,
  ) {}

  readFile: IFileSystem["readFile"] = (path, options) => this.inner.readFile(path, options);
  readFileBuffer: IFileSystem["readFileBuffer"] = (path) => this.inner.readFileBuffer(path);
  exists: IFileSystem["exists"] = (path) => this.inner.exists(path);
  stat: IFileSystem["stat"] = (path) => this.inner.stat(path);
  lstat: IFileSystem["lstat"] = (path) => this.inner.lstat(path);
  readdir: IFileSystem["readdir"] = (path) => this.inner.readdir(path);
  readdirWithFileTypes: IFileSystem["readdirWithFileTypes"] = (path) =>
    this.inner.readdirWithFileTypes?.(path) ?? Promise.resolve([]);
  resolvePath: IFileSystem["resolvePath"] = (base, path) => this.inner.resolvePath(base, path);
  getAllPaths: IFileSystem["getAllPaths"] = () => this.inner.getAllPaths();
  readlink: IFileSystem["readlink"] = (path) => this.inner.readlink(path);
  realpath: IFileSystem["realpath"] = (path) => this.inner.realpath(path);

  async writeFile(path: string, content: FileContent, options?: unknown): Promise<void> {
    await this.inner.writeFile(path, content, options as never);
    this.dirty.mark(path);
  }

  async appendFile(path: string, content: FileContent, options?: unknown): Promise<void> {
    await this.inner.appendFile(path, content, options as never);
    this.dirty.mark(path);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.inner.mkdir(path, options);
    this.dirty.mark(path);
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    await this.inner.rm(path, options);
    this.dirty.mark(path);
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.inner.cp(src, dest, options);
    this.dirty.mark(dest);
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.inner.mv(src, dest);
    this.dirty.mark(src);
    this.dirty.mark(dest);
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.inner.chmod(path, mode);
    this.dirty.mark(path);
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    await this.inner.symlink(target, linkPath);
    this.dirty.mark(linkPath);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.inner.link(existingPath, newPath);
    this.dirty.mark(newPath);
  }

  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    await this.inner.utimes(path, atime, mtime);
    this.dirty.mark(path);
  }
}

export interface ToolSession {
  projectOverlay: OverlayFs;
  dirty: DirtyTracker;
  tools(opts?: Omit<CreateToolsOptions, "session">): AgentTools;
  reset(): void;
}

export function createToolSession(opts: Omit<CreateToolsOptions, "session"> = {}): ToolSession {
  const root = opts.cwd ?? process.cwd();
  const dirty = new SimpleDirtyTracker();
  let projectOverlay = new OverlayFs({ root });

  return {
    get projectOverlay() {
      return projectOverlay;
    },
    dirty,
    tools(toolOpts = {}) {
      return createTools({ ...opts, ...toolOpts, cwd: toolOpts.cwd ?? opts.cwd, session: this });
    },
    reset() {
      projectOverlay = new OverlayFs({ root });
      dirty.clear();
    },
  };
}
