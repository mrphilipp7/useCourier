import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import {
  FileError,
  UploadCancelledError,
  useCourier,
  XhrRequestError,
  XhrResponseError,
} from "../package/use-courier/index.js";
import { MockXMLHttpRequest } from "./mock-xhr.js";

function makeFile(sizeInBytes = 4, name = "test.txt") {
  return new File([new Uint8Array(sizeInBytes)], name, {
    type: "text/plain",
  });
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

describe("addFile", () => {
  test("tracks the file as uploading and resolves with the server response on success", async () => {
    const { result } = renderHook(() =>
      useCourier<{ url: string }>({ url: "/api/uploads" }),
    );

    let uploadPromise!: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.addFile(makeFile());
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0]?.status).toBe("uploading");
    expect(result.current.files[0]?.uploadProgress).toBe(0);
    expect(MockXMLHttpRequest.last.method).toBe("POST");
    expect(MockXMLHttpRequest.last.url).toBe("/api/uploads");

    act(() => {
      MockXMLHttpRequest.last.emitUploadProgress(50);
    });
    expect(result.current.files[0]?.uploadProgress).toBe(50);
    expect(result.current.files[0]?.status).toBe("uploading");

    act(() => {
      MockXMLHttpRequest.last.emitUploadProgress(100);
    });
    expect(result.current.files[0]?.status).toBe("processing");

    let outcome: unknown;
    await act(async () => {
      MockXMLHttpRequest.last.respondWith(200, { url: "https://cdn.test/f" });
      outcome = await uploadPromise;
    });

    expect(outcome).toEqual({
      success: true,
      data: { url: "https://cdn.test/f" },
    });
    expect(result.current.files[0]?.status).toBe("done");
    expect(result.current.files[0]?.uploadProgress).toBe(100);
  });

  test("resolves with an error result for a non-2xx response", async () => {
    const onUploadError = mock();
    const { result } = renderHook(() =>
      useCourier({ url: "/api/uploads", onUploadError }),
    );

    let uploadPromise!: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.addFile(makeFile());
    });

    let outcome: unknown;
    await act(async () => {
      MockXMLHttpRequest.last.respondWith(500, { error: "nope" });
      outcome = await uploadPromise;
    });

    expect(outcome).toMatchObject({ success: false });
    expect((outcome as { error: Error }).error).toBeInstanceOf(
      XhrResponseError,
    );
    expect(result.current.files[0]?.status).toBe("error");
    expect(onUploadError).toHaveBeenCalledTimes(1);
  });

  test("resolves with an error result for a network failure", async () => {
    const { result } = renderHook(() => useCourier({ url: "/api/uploads" }));

    let uploadPromise!: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.addFile(makeFile());
    });

    let outcome: unknown;
    await act(async () => {
      MockXMLHttpRequest.last.respondWithNetworkError();
      outcome = await uploadPromise;
    });

    expect(outcome).toMatchObject({ success: false });
    expect((outcome as { error: Error }).error).toBeInstanceOf(XhrRequestError);
    expect(result.current.files[0]?.status).toBe("error");
  });

  test("rejects a non-File argument without making a request", async () => {
    const { result } = renderHook(() => useCourier({ url: "/api/uploads" }));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.addFile("not-a-file" as unknown as File);
    });

    expect(outcome).toMatchObject({ success: false });
    expect((outcome as { error: Error }).error).toBeInstanceOf(FileError);
    expect(result.current.files).toHaveLength(0);
    expect(MockXMLHttpRequest.instances).toHaveLength(0);
  });

  test("a beforeUpload rejection fails the file without starting a request", async () => {
    const onUploadError = mock();
    const onUploadSuccess = mock();
    const beforeUpload = mock(() => {
      throw new Error("file too large");
    });
    const { result } = renderHook(() =>
      useCourier({
        url: "/api/uploads",
        beforeUpload,
        onUploadError,
        onUploadSuccess,
      }),
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.addFile(makeFile());
    });

    expect(outcome).toMatchObject({ success: false });
    expect(result.current.files[0]?.status).toBe("error");
    expect(MockXMLHttpRequest.instances).toHaveLength(0);
    expect(onUploadError).toHaveBeenCalledTimes(1);
    expect(onUploadSuccess).not.toHaveBeenCalled();
  });
});

describe("retryUpload", () => {
  test("returns a FileError for an unknown id", async () => {
    const { result } = renderHook(() => useCourier({ url: "/api/uploads" }));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.retryUpload("missing-id");
    });

    expect((outcome as { error: Error }).error).toBeInstanceOf(FileError);
  });

  test("returns a FileError when the file isn't in an error state", async () => {
    const { result } = renderHook(() => useCourier({ url: "/api/uploads" }));

    act(() => {
      void result.current.addFile(makeFile());
    });
    const id = result.current.files[0]?.id as string;

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.retryUpload(id);
    });

    expect((outcome as { error: Error }).error).toBeInstanceOf(FileError);
  });

  test("re-uploads a failed file through a new request", async () => {
    const { result } = renderHook(() => useCourier({ url: "/api/uploads" }));

    act(() => {
      void result.current.addFile(makeFile());
    });
    await act(async () => {
      MockXMLHttpRequest.last.respondWith(500, {});
      await Promise.resolve();
    });
    const id = result.current.files[0]?.id as string;
    expect(result.current.files[0]?.status).toBe("error");

    let retryPromise!: Promise<unknown>;
    act(() => {
      retryPromise = result.current.retryUpload(id);
    });

    expect(result.current.files[0]?.status).toBe("uploading");
    expect(MockXMLHttpRequest.instances).toHaveLength(2);

    let outcome: unknown;
    await act(async () => {
      MockXMLHttpRequest.last.respondWith(200, { ok: true });
      outcome = await retryPromise;
    });

    expect(outcome).toEqual({ success: true, data: { ok: true } });
    expect(result.current.files[0]?.status).toBe("done");
  });

  test("an onUploadRetry rejection fails the retry without a new request", async () => {
    const onUploadRetry = mock(() => {
      throw new Error("retry not allowed");
    });
    const { result } = renderHook(() =>
      useCourier({ url: "/api/uploads", onUploadRetry }),
    );

    act(() => {
      void result.current.addFile(makeFile());
    });
    await act(async () => {
      MockXMLHttpRequest.last.respondWith(500, {});
      await Promise.resolve();
    });
    const id = result.current.files[0]?.id as string;

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.retryUpload(id);
    });

    expect((outcome as { error: Error }).error.message).toBe(
      "retry not allowed",
    );
    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    expect(result.current.files[0]?.status).toBe("error");
  });
});

describe("removeFile", () => {
  test("aborts an in-flight upload and drops it from files", async () => {
    const onRemoveFile = mock();
    const { result } = renderHook(() =>
      useCourier({ url: "/api/uploads", onRemoveFile }),
    );

    let uploadPromise!: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.addFile(makeFile());
    });
    const id = result.current.files[0]?.id as string;

    await act(async () => {
      result.current.removeFile(id);
      await uploadPromise;
    });

    expect(MockXMLHttpRequest.last.aborted).toBe(true);
    expect(result.current.files).toHaveLength(0);
    expect(onRemoveFile).toHaveBeenCalledTimes(1);
  });

  test("is a no-op for an unknown id", () => {
    const onRemoveFile = mock();
    const { result } = renderHook(() =>
      useCourier({ url: "/api/uploads", onRemoveFile }),
    );

    act(() => {
      result.current.removeFile("missing-id");
    });

    expect(onRemoveFile).not.toHaveBeenCalled();
  });
});

describe("unmount", () => {
  test("aborts every in-flight upload", async () => {
    const { result, unmount } = renderHook(() =>
      useCourier({ url: "/api/uploads" }),
    );

    let promiseA!: Promise<unknown>;
    let promiseB!: Promise<unknown>;
    act(() => {
      promiseA = result.current.addFile(makeFile(4, "a.txt"));
      promiseB = result.current.addFile(makeFile(4, "b.txt"));
    });
    expect(MockXMLHttpRequest.instances).toHaveLength(2);

    await act(async () => {
      unmount();
      await Promise.all([promiseA, promiseB]);
    });

    expect(MockXMLHttpRequest.instances.every((xhr) => xhr.aborted)).toBe(true);
  });
});

describe("chunked uploads", () => {
  test("uses the whole-file endpoint for files at or below the threshold", () => {
    const { result } = renderHook(() =>
      useCourier({
        url: "/api/uploads",
        fileChunking: { route: "/api/uploads/chunks", threshold: 10 },
      }),
    );

    act(() => {
      void result.current.addFile(makeFile(10));
    });

    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    expect(MockXMLHttpRequest.last.url).toBe("/api/uploads");
  });

  test("splits a file above the threshold into sequential chunk requests", async () => {
    const { result } = renderHook(() =>
      useCourier<{ done: true }>({
        url: "/api/uploads",
        fileChunking: {
          route: "/api/uploads/chunks",
          threshold: 10,
          chunkSize: 5,
        },
      }),
    );

    let uploadPromise!: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.addFile(makeFile(12));
    });

    // Chunks are sent one at a time, not all at once.
    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    const firstChunk = MockXMLHttpRequest.last;
    expect(firstChunk.url).toBe("/api/uploads/chunks");
    expect(firstChunk.body?.get("chunkIndex")).toBe("0");
    expect(firstChunk.body?.get("totalChunks")).toBe("3");
    const uploadId = firstChunk.body?.get("uploadId");
    expect(typeof uploadId).toBe("string");

    await act(async () => {
      firstChunk.respondWith(200, { chunkIndex: 0, received: true });
      await Promise.resolve();
    });
    expect(MockXMLHttpRequest.instances).toHaveLength(2);
    const secondChunk = MockXMLHttpRequest.last;
    expect(secondChunk.body?.get("chunkIndex")).toBe("1");
    expect(secondChunk.body?.get("uploadId")).toBe(uploadId);

    await act(async () => {
      secondChunk.respondWith(200, { chunkIndex: 1, received: true });
      await Promise.resolve();
    });
    expect(MockXMLHttpRequest.instances).toHaveLength(3);
    const thirdChunk = MockXMLHttpRequest.last;
    expect(thirdChunk.body?.get("chunkIndex")).toBe("2");

    let outcome: unknown;
    await act(async () => {
      thirdChunk.respondWith(200, { done: true });
      outcome = await uploadPromise;
    });

    expect(outcome).toEqual({ success: true, data: { done: true } });
    expect(result.current.files[0]?.status).toBe("done");
  });

  test("reports progress cumulatively across chunks", async () => {
    const { result } = renderHook(() =>
      useCourier({
        url: "/api/uploads",
        fileChunking: {
          route: "/api/uploads/chunks",
          threshold: 10,
          chunkSize: 5,
        },
      }),
    );

    act(() => {
      void result.current.addFile(makeFile(12));
    });

    // First chunk (5 of 12 bytes) fully sent: 5 / 12 * 100 ≈ 42%.
    act(() => {
      MockXMLHttpRequest.last.emitUploadProgress(100);
    });
    expect(result.current.files[0]?.uploadProgress).toBe(42);

    await act(async () => {
      MockXMLHttpRequest.last.respondWith(200, {});
      await Promise.resolve();
    });

    // Second chunk (bytes 5-10 of 12) fully sent: 10 / 12 * 100 ≈ 83%.
    act(() => {
      MockXMLHttpRequest.last.emitUploadProgress(100);
    });
    expect(result.current.files[0]?.uploadProgress).toBe(83);
  });

  test("retries a failed chunk up to maxChunkRetries times before failing", async () => {
    const { result } = renderHook(() =>
      useCourier({
        url: "/api/uploads",
        fileChunking: {
          route: "/api/uploads/chunks",
          threshold: 10,
          chunkSize: 5,
          maxChunkRetries: 1,
        },
      }),
    );

    let uploadPromise!: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.addFile(makeFile(12));
    });

    await act(async () => {
      MockXMLHttpRequest.last.respondWithNetworkError();
      await Promise.resolve();
    });
    // First failure is retried: a second XHR for the same chunk.
    expect(MockXMLHttpRequest.instances).toHaveLength(2);

    let outcome: unknown;
    await act(async () => {
      MockXMLHttpRequest.last.respondWithNetworkError();
      outcome = await uploadPromise;
    });

    // maxChunkRetries exhausted: no third attempt, upload fails.
    expect(MockXMLHttpRequest.instances).toHaveLength(2);
    expect(outcome).toMatchObject({ success: false });
    expect((outcome as { error: Error }).error).toBeInstanceOf(XhrRequestError);
    expect(result.current.files[0]?.status).toBe("error");
  });

  test("does not retry a chunk that was cancelled", async () => {
    const { result } = renderHook(() =>
      useCourier({
        url: "/api/uploads",
        fileChunking: {
          route: "/api/uploads/chunks",
          threshold: 10,
          chunkSize: 5,
          maxChunkRetries: 2,
        },
      }),
    );

    let uploadPromise!: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.addFile(makeFile(12));
    });

    let outcome: unknown;
    await act(async () => {
      MockXMLHttpRequest.last.abort();
      outcome = await uploadPromise;
    });

    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    expect((outcome as { error: Error }).error).toBeInstanceOf(
      UploadCancelledError,
    );
    expect(result.current.files[0]?.status).toBe("error");
  });
});
