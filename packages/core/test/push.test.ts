import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPush } from "../src/push";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

const message = (to: string) => ({ to, title: "T", body: "B" });

describe("sendPush", () => {
  it("posts the messages to Expo and returns unregistered phones", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }],
      }),
    );

    const gone = await sendPush([message("ExponentPushToken[a]"), message("ExponentPushToken[b]")]);

    expect(gone).toEqual(["ExponentPushToken[b]"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(JSON.parse(init.body)).toEqual([
      { to: "ExponentPushToken[a]", title: "T", body: "B", sound: "default" },
      { to: "ExponentPushToken[b]", title: "T", body: "B", sound: "default" },
    ]);
  });

  it("sends in batches of 100", async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      Response.json({ data: JSON.parse(init.body).map(() => ({ status: "ok" })) }),
    );

    await sendPush(Array.from({ length: 150 }, (_, i) => message(`ExponentPushToken[${i}]`)));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toHaveLength(50);
  });

  it("throws when Expo rejects the request", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(sendPush([message("ExponentPushToken[a]")])).rejects.toThrow("500");
  });
});
