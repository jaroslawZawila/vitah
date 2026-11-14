import { File } from "expo-file-system";
import { downloadWithToken } from "../lib/download";

jest.mock("expo-file-system", () => ({ File: { downloadFileAsync: jest.fn() } }));

const download = jest.mocked(File.downloadFileAsync);
const file = (exists: boolean) => ({ exists, delete: jest.fn() }) as unknown as File & { delete: jest.Mock };

beforeEach(() => {
  download.mockReset();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("downloadWithToken", () => {
  it("downloads with the client's token and clears its timer", async () => {
    const target = file(false);
    download.mockResolvedValueOnce(target);

    await downloadWithToken("https://api.test/doc", target, "tok");

    expect(download).toHaveBeenCalledWith("https://api.test/doc", target, {
      headers: { Authorization: "Bearer tok" },
      signal: expect.any(AbortSignal),
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("gives up on a download that stalls, later than an API call would, leaving no partial file", async () => {
    const target = file(true);
    download.mockImplementationOnce(
      (_url, _file, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );

    const result = downloadWithToken("https://api.test/doc", target, "tok").catch((error: Error) => error.name);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(download.mock.calls[0]![2]!.signal!.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(30_000);

    expect(await result).toBe("AbortError");
    expect(target.delete).toHaveBeenCalled();
  });

  it("throws a failed download's error", async () => {
    const target = file(false);
    download.mockRejectedValueOnce(new Error("UnableToDownload: 404"));

    await expect(downloadWithToken("https://api.test/doc", target, "tok")).rejects.toThrow("404");
    expect(target.delete).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
