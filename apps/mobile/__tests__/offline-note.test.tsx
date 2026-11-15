import { fireEvent, render, screen } from "@testing-library/react-native";
import { Image } from "expo-image";
import { OfflineNote, offlineSince } from "../components/offline-note";
import { PhotoImage } from "../components/photo-image";
import { formatShortDateTime } from "../lib/format";

jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok" }) }));

describe("formatShortDateTime", () => {
  it("writes the day and the time in Spain", () => {
    // 09:30 UTC is 10:30 in Madrid in November.
    expect(formatShortDateTime("2026-11-14T09:30:00.000Z", "es")).toMatch(/^14 nov\.?, 10:30$/);
    expect(formatShortDateTime("2026-11-14T09:30:00.000Z", "en")).toMatch(/^14 Nov\.?, 10:30$/);
  });
});

describe("OfflineNote", () => {
  it("says there is no connection and when the data is from", () => {
    render(<OfflineNote offline updatedAt="2026-11-14T09:30:00.000Z" />);

    expect(screen.getByText(/^Sin conexión · datos del 14 nov\.?, 10:30$/)).toBeOnTheScreen();
  });

  it("shows nothing online or without a date", () => {
    const { rerender } = render(<OfflineNote offline={false} updatedAt="2026-11-14T09:30:00.000Z" />);
    expect(screen.queryByText(/Sin conexión/)).toBeNull();

    rerender(<OfflineNote offline updatedAt={undefined} />);
    expect(screen.queryByText(/Sin conexión/)).toBeNull();
  });

  it("offlineSince takes the oldest of the parts that are offline", () => {
    expect(
      offlineSince(
        { offline: true, updatedAt: "2026-11-14T09:00:00.000Z" },
        { offline: true, updatedAt: "2026-11-13T09:00:00.000Z" },
        { offline: false, updatedAt: "2026-11-01T09:00:00.000Z" },
        { offline: true, updatedAt: undefined },
      ),
    ).toBe("2026-11-13T09:00:00.000Z");
    expect(offlineSince({ offline: false, updatedAt: "2026-11-14T09:00:00.000Z" })).toBeUndefined();
  });
});

describe("PhotoImage offline", () => {
  const photo = { id: "p1", caption: null, sizeBytes: 1, uploadedAt: "2026-09-22T10:00:00.000Z" };

  it("shows a placeholder, not an error, for a photo that never downloaded", () => {
    render(<PhotoImage photo={photo} size="thumb" style={{ width: 10, height: 10 }} />);
    const image = screen.UNSAFE_getByType(Image);
    expect(image.props.cachePolicy).toBe("disk");

    fireEvent(image, "error");

    expect(screen.UNSAFE_queryByType(Image)).toBeNull();
    expect(screen.getByLabelText("Foto no disponible sin conexión")).toBeOnTheScreen();
  });

  it("gives the image its size", () => {
    const style = { width: 120, height: 80 };
    render(<PhotoImage photo={photo} size="thumb" style={style} />);

    expect(screen.UNSAFE_getByType(Image).props.style).toEqual(style);
  });

  it("tries a failed photo again when its list reloads", () => {
    const style = { width: 10, height: 10 };
    const { rerender } = render(<PhotoImage photo={photo} size="thumb" style={style} />);
    fireEvent(screen.UNSAFE_getByType(Image), "error");

    // A re-render with the same list keeps the placeholder…
    rerender(<PhotoImage photo={photo} size="thumb" style={style} />);
    expect(screen.UNSAFE_queryByType(Image)).toBeNull();

    // …a reloaded list (new objects, the connection is back) loads it again.
    rerender(<PhotoImage photo={{ ...photo }} size="thumb" style={style} />);
    expect(screen.UNSAFE_getByType(Image)).toBeTruthy();
  });
});
