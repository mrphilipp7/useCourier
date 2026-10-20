import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { createCourier } from "../package/use-courier/create-courier.js";
import { getOverallUploadState } from "../package/use-courier/overall.js";
import {
  UploadCancelledError,
  useCourier,
} from "../package/use-courier/index.js";
import type {
  CourierOptions,
  UseCourierProps,
} from "../package/use-courier/index.js";
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

describe("chunk resume only reuses matching chunking settings", () => {
  /** Fails a 12-byte file at chunk 1 of 3 (5-byte chunks, no chunk retries). */
  async function failAtChunk1(
    courier: ReturnType<typeof createCourier>,
  ): Promise<string> {
    const upload = courier.addFile(makeFile(12));
    MockXMLHttpRequest.last.respondWith(200, {});
    await Promise.resolve();
    MockXMLHttpRequest.last.respondWithNetworkError();
    await upload;
    return courier.getFiles()[0]!.id;
  }

  test("a retry after chunkSize changes starts over under a new uploadId", async () => {
    let chunkSize = 5;
    const courier = createCourier(() => ({
      url: "/api/uploads",
      fileChunking: {
        route: "/api/chunks",
        threshold: 10,
        chunkSize,
        maxChunkRetries: 0,
      },
    }));
    const id = await failAtChunk1(courier);
    const uploadId = MockXMLHttpRequest.last.body?.get("uploadId");

    chunkSize = 4;
    void courier.retryUpload(id);

    // Resuming at chunk 1 with 4-byte chunks would send bytes 4-8 as the
    // chunk the server expects to hold bytes 5-10, corrupting the file.
    const first = MockXMLHttpRequest.last;
    expect(first.body?.get("chunkIndex")).toBe("0");
    expect(first.body?.get("totalChunks")).toBe("3");
    expect(first.body?.get("uploadId")).not.toBe(uploadId);
    expect(courier.getFiles()[0]?.uploadProgress).toBe(0);
  });

  test("a retry after route changes starts over under a new uploadId", async () => {
    let route = "/api/chunks";
    const courier = createCourier(() => ({
      url: "/api/uploads",
      fileChunking: { route, threshold: 10, chunkSize: 5, maxChunkRetries: 0 },
    }));
    const id = await failAtChunk1(courier);
    const uploadId = MockXMLHttpRequest.last.body?.get("uploadId");

    route = "/api/v2/chunks";
    void courier.retryUpload(id);

    expect(MockXMLHttpRequest.last.url).toBe("/api/v2/chunks");
    expect(MockXMLHttpRequest.last.body?.get("chunkIndex")).toBe("0");
    expect(MockXMLHttpRequest.last.body?.get("uploadId")).not.toBe(uploadId);
  });

  test("a whole-file retry drops the resume point", async () => {
    let chunked = true;
    const courier = createCourier(() => ({
      url: "/api/uploads",
      fileChunking: chunked
        ? {
            route: "/api/chunks",
            threshold: 10,
            chunkSize: 5,
            maxChunkRetries: 0,
          }
        : undefined,
    }));
    const id = await failAtChunk1(courier);

    chunked = false;
    const wholeFile = courier.retryUpload(id);
    MockXMLHttpRequest.last.respondWithNetworkError();
    await wholeFile;

    // Chunking back on: the old resume point must not come back to life.
    chunked = true;
    void courier.retryUpload(id);
    expect(MockXMLHttpRequest.last.body?.get("chunkIndex")).toBe("0");
  });
});

describe("overall and transport edge cases", () => {
  test("weightedProgress isn't stuck at 0 when every file is empty", () => {
    const file = makeFile(0);
    const overall = getOverallUploadState([
      { id: "a", file, status: "done", uploadProgress: 100 },
    ]);
    expect(overall.weightedProgress).toBe(100);
  });

  test("a request that throws while opening isn't left tracked as in flight", async () => {
    const open = MockXMLHttpRequest.prototype.open;
    MockXMLHttpRequest.prototype.open = () => {
      throw new SyntaxError("Invalid URL");
    };
    try {
      const courier = createCourier(() => ({ url: "http://[bad" }));
      const result = await courier.addFile(makeFile());
      expect(result.success).toBe(false);

      courier.removeFile(courier.getFiles()[0]!.id);
      expect(MockXMLHttpRequest.last.aborted).toBe(false);
    } finally {
      MockXMLHttpRequest.prototype.open = open;
    }
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
    const options: CourierOptions = {
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

describe("CourierOptions rename", () => {
  test("the deprecated UseCourierProps alias still type-checks", () => {
    // Compile-time check: both names describe the same options.
    const options: UseCourierProps<{ url: string }> = {
      url: "/api/uploads",
      onUploadSuccess: ({ data }) => void data.url,
    };
    const renamed: CourierOptions<{ url: string }> = options;
    expect(renamed).toBe(options);
  });
});
