import { newIdempotencyKey, pickedPhoto } from "../lib/warranty";

/** The size of each file on the phone, by uri. */
const mockSizes: Record<string, number> = {};
jest.mock("expo-file-system", () => ({
  File: class {
    mockUri: string;
    constructor(mockUri: string) {
      this.mockUri = mockUri;
    }
    get size() {
      return mockSizes[this.mockUri] ?? 0;
    }
  },
}));

describe("newIdempotencyKey", () => {
  it("is a key the server takes, a new one each time", () => {
    const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
  });
});

describe("pickedPhoto", () => {
  beforeEach(() => {
    for (const uri of Object.keys(mockSizes)) delete mockSizes[uri];
  });

  it("names the upload after the picked file, or after its type", () => {
    mockSizes["file:///a.jpg"] = 10;
    expect(pickedPhoto({ uri: "file:///a.jpg", fileName: "IMG_1.jpg", mimeType: "image/jpeg" })).toEqual({
      uri: "file:///a.jpg",
      name: "IMG_1.jpg",
      type: "image/jpeg",
      size: 10,
    });
    expect(pickedPhoto({ uri: "file:///b", mimeType: "image/png" })).toMatchObject({ name: "foto.png", type: "image/png", size: null });
    expect(pickedPhoto({ uri: "file:///c" })).toMatchObject({ name: "foto.jpg", type: "image/jpeg" });
  });

  it("refuses a photo larger than the server takes", () => {
    mockSizes["file:///big.jpg"] = 4 * 1024 * 1024 + 1;
    expect(pickedPhoto({ uri: "file:///big.jpg" })).toBeNull();
  });

  it("measures the copy it uploads, not the original the picker describes (Android)", () => {
    // A 9 MB HEIC in the gallery, re-encoded by the picker to a 1.2 MB JPEG.
    mockSizes["file:///cache/ImagePicker/x.jpeg"] = 1_200_000;
    const asset = { uri: "file:///cache/ImagePicker/x.jpeg", fileName: "IMG_9.heic", mimeType: "image/heic", fileSize: 9_000_000 };

    expect(pickedPhoto(asset)).toMatchObject({ type: "image/jpeg", size: 1_200_000 });
  });
});
