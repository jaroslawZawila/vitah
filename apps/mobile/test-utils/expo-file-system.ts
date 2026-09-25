// In-memory stand-in for `expo-file-system` (File / Directory / Paths). Use with:
//   jest.mock("expo-file-system", () => require("../test-utils/expo-file-system"));

export const disk = new Map<string, string>();
export const downloads = {
  /** Called for every download; throw to simulate a failure. */
  handler: (_url: string, _headers: Record<string, string> | undefined): string => "%PDF-",
};

const join = (parent: string | Directory, name?: string) => {
  const base = typeof parent === "string" ? parent : parent.uri;
  return name ? `${base.replace(/\/$/, "")}/${name}` : base;
};

export const Paths = { document: "file:///documents-dir" };

export class File {
  readonly uri: string;
  constructor(parent: string | Directory, name?: string) {
    this.uri = join(parent, name);
  }
  get name() {
    return this.uri.split("/").pop()!;
  }
  get contentUri() {
    return this.uri.replace("file://", "content://");
  }
  get exists() {
    return disk.has(this.uri);
  }
  create() {
    disk.set(this.uri, "");
  }
  write(content: string) {
    disk.set(this.uri, content);
  }
  async text() {
    const content = disk.get(this.uri);
    if (content === undefined) throw new Error(`No such file: ${this.uri}`);
    return content;
  }
  delete() {
    disk.delete(this.uri);
  }
  static async downloadFileAsync(
    url: string,
    destination: File,
    options?: { headers?: Record<string, string> },
  ) {
    disk.set(destination.uri, downloads.handler(url, options?.headers));
    return destination;
  }
}

export class Directory {
  readonly uri: string;
  constructor(parent: string | Directory, name?: string) {
    this.uri = join(parent, name);
  }
  get exists() {
    return [...disk.keys()].some((uri) => uri.startsWith(`${this.uri}/`));
  }
  create() {}
  list() {
    return [...disk.keys()]
      .filter((uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes("/"))
      .map((uri) => new File(uri));
  }
  delete() {
    for (const uri of [...disk.keys()]) if (uri.startsWith(`${this.uri}/`)) disk.delete(uri);
  }
}
