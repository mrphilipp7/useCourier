import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { createCourier } from "../package/use-courier/create-courier.js";
import {
  UploadCancelledError,
  useCourier,
} from "../package/use-courier/index.js";
import type { UseCourierProps } from "../package/use-courier/index.js";
import { MockXMLHttpRequest } from "./mock-xhr.js";

function makeFile(sizeInBytes = 4, name = "test.txt") {
  return new File([new Uint8Array(sizeInBytes)], name, { type: "text/plain" });
}

let originalXHR: typeof XMLHttpRequest;

beforeEach(() => {
  originalXHR = globalThis.XMLHttpRequest;
  // @ts-expect-error -- test double, not a full XMLHttpRequest implementation
  globalThis.XMLHttpRequest = MockXMLHttpRequest;
  MockXMLHttpRequest.reset();
});

afterEach(() => {
  globalThis.XMLHttpRequest = originalXHR;
});

// #34: the core runs without React — no renderHook, no act().
describe("createCourier", () => {
  test("uploads a file and notifies subscribers on every change", async () => {
    const courier = createCourier<{ ok: true }>(() => ({
      url: "/api/uploads",
    }));
    const listener = mock();
    courier.subscribe(listener);

    const upload = courier.addFile(makeFile());
    expect(courier.getFiles()[0]?.status).toBe("uploading");

    MockXMLHttpRequest.last.emitUploadProgress(50);
    expect(courier.getFiles()[0]?.uploadProgress).toBe(50);

    MockXMLHttpRequest.last.respondWith(200, { ok: true });
    expect(await upload).toEqual({ success: true, data: { ok: true } });
    expect(courier.getFiles()[0]?.status).toBe("done");
    // added, progress, done
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test("getFiles returns the same array until something changes", () => {
    const courier = createCourier(() => ({ url: "/api/uploads" }));
    const before = courier.getFiles();
    expect(courier.getFiles()).toBe(before);

    void courier.addFile(makeFile());
    expect(courier.getFiles()).not.toBe(before);
  });

  test("an unsubscribed listener isn't called", () => {
    const courier = createCourier(() => ({ url: "/api/uploads" }));
    const listener = mock();
    const unsubscribe = courier.subscribe(listener);
    unsubscribe();

    void courier.addFile(makeFile());
    expect(listener).not.toHaveBeenCalled();
  });

  test("reads options through getOptions on every use, so changes apply", () => {
    let url = "/api/v1/uploads";
    const courier = createCourier(() => ({ url }));

    void courier.addFile(makeFile());
    url = "/api/v2/uploads";
    void courier.addFile(makeFile());

    expect(MockXMLHttpRequest.instances.map((x) => x.url)).toEqual([
      "/api/v1/uploads",
      "/api/v2/uploads",
    ]);
  });

  test("abortAll cancels in-flight uploads", async () => {
    const courier = createCourier(() => ({ url: "/api/uploads" }));

    const upload = courier.addFile(makeFile());
    courier.abortAll();

    expect(MockXMLHttpRequest.last.aborted).toBe(true);
    expect(((await upload) as { error: Error }).error).toBeInstanceOf(
      UploadCancelledError,
    );
  });

  test("abortAll cancels an upload still waiting on async headers", async () => {
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const courier = createCourier(() => ({
      url: "/api/uploads",
      headers: () =>
        new Promise<Record<string, string>>((resolve) => {
          resolveHeaders = resolve;
        }),
    }));

    const upload = courier.addFile(makeFile());
    courier.abortAll();
    resolveHeaders({});

    expect(((await upload) as { error: Error }).error).toBeInstanceOf(
      UploadCancelledError,
    );
    expect(MockXMLHttpRequest.instances).toHaveLength(0);
  });

  test("the courier keeps working after abortAll", async () => {
    const courier = createCourier(() => ({ url: "/api/uploads" }));
    courier.abortAll();

    const upload = courier.addFile(makeFile());
    MockXMLHttpRequest.last.respondWith(200, {});

    expect(await upload).toMatchObject({ success: true });
  });
});

describe("useCourier under React Strict Mode", () => {
  // Strict Mode mounts, unmounts, and remounts once in development, which
  // runs the hook's abortAll cleanup before the component is really used.
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.StrictMode, null, children);

  test("uploads still work after the dev-only remount", async () => {
    const { result } = renderHook(
      () => useCourier<{ ok: true }>({ url: "/api/uploads" }),
      { wrapper },
    );

    let upload!: Promise<unknown>;
    act(() => {
      upload = result.current.addFile(makeFile());
    });
    let outcome: unknown;
    await act(async () => {
      MockXMLHttpRequest.last.respondWith(200, { ok: true });
      outcome = await upload;
    });

    expect(outcome).toEqual({ success: true, data: { ok: true } });
    expect(result.current.files[0]?.status).toBe("done");
  });

  test("async headers still resolve into a request after the remount", async () => {
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const options: UseCourierProps = {
      url: "/api/uploads",
      headers: () =>
        new Promise((resolve) => {
          resolveHeaders = resolve;
        }),
    };
    const { result } = renderHook(() => useCourier(options), { wrapper });

    act(() => {
      void result.current.addFile(makeFile());
    });
    await act(async () => {
      resolveHeaders({ Authorization: "Bearer abc" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    expect(MockXMLHttpRequest.last.requestHeaders).toEqual({
      Authorization: "Bearer abc",
    });
  });

  test("unmounting for real still cancels uploads", async () => {
    const { result, unmount } = renderHook(
      () => useCourier({ url: "/api/uploads" }),
      { wrapper },
    );

    let upload!: Promise<unknown>;
    act(() => {
      upload = result.current.addFile(makeFile());
    });
    unmount();

    expect(MockXMLHttpRequest.last.aborted).toBe(true);
    const outcome = await act(async () => upload);
    expect((outcome as { error: Error }).error).toBeInstanceOf(
      UploadCancelledError,
    );
  });
});
