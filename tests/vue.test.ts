import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createApp,
  defineComponent,
  effectScope,
  h,
  nextTick,
  reactive,
  ref,
  watch,
} from "vue";
import {
  UploadCancelledError,
  useCourier,
  XhrResponseError,
} from "../package/use-courier/vue/index.js";
import type { CourierOptions } from "../package/use-courier/vue/index.js";
import { MockXMLHttpRequest } from "./mock-xhr.js";

function makeFile(sizeInBytes = 4, name = "test.txt") {
  return new File([new Uint8Array(sizeInBytes)], name, { type: "text/plain" });
}

/** Runs setup inside an effect scope, the way a component's setup() does. */
function inScope<T>(setup: () => T) {
  const scope = effectScope();
  const result = scope.run(setup)!;
  return { result, dispose: () => scope.stop() };
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

describe("useCourier (Vue)", () => {
  test("tracks a file through progress to done, with overall", async () => {
    const { result } = inScope(() =>
      useCourier<{ url: string }>({ url: "/api/uploads" }),
    );

    const upload = result.addFile(makeFile());
    expect(result.files.value[0]?.status).toBe("uploading");
    expect(result.overall.value.status).toBe("uploading");

    MockXMLHttpRequest.last.emitUploadProgress(40);
    expect(result.files.value[0]?.uploadProgress).toBe(40);
    expect(result.overall.value.averageProgress).toBe(40);

    MockXMLHttpRequest.last.respondWith(200, { url: "https://cdn.test/f" });
    expect(await upload).toEqual({
      success: true,
      data: { url: "https://cdn.test/f" },
    });
    expect(result.files.value[0]?.status).toBe("done");
    expect(result.overall.value.status).toBe("done");
  });

  test("files is reactive: watchers see every change", () => {
    const { result } = inScope(() => useCourier({ url: "/api/uploads" }));
    const seen: string[] = [];
    watch(
      result.files,
      (files) => seen.push(files.map((f) => f.status).join(",")),
      { flush: "sync" },
    );

    void result.addFile(makeFile());
    MockXMLHttpRequest.last.emitUploadProgress(100);

    expect(seen).toEqual(["uploading", "processing"]);
  });

  test("a getter's options are re-read on every use", () => {
    const endpoint = ref("/api/v1/uploads");
    const { result } = inScope(() =>
      useCourier(() => ({ url: endpoint.value })),
    );

    void result.addFile(makeFile());
    endpoint.value = "/api/v2/uploads";
    void result.addFile(makeFile());

    expect(MockXMLHttpRequest.instances.map((x) => x.url)).toEqual([
      "/api/v1/uploads",
      "/api/v2/uploads",
    ]);
  });

  test("a ref of options and a reactive() object are read latest too", () => {
    const asRef = ref<CourierOptions>({ url: "/a" });
    const asReactive = reactive<CourierOptions>({ url: "/b" });
    const { result } = inScope(() => ({
      fromRef: useCourier(asRef),
      fromReactive: useCourier(asReactive),
    }));

    asRef.value = { url: "/a2" };
    asReactive.url = "/b2";
    void result.fromRef.addFile(makeFile());
    void result.fromReactive.addFile(makeFile());

    expect(MockXMLHttpRequest.instances.map((x) => x.url)).toEqual([
      "/a2",
      "/b2",
    ]);
  });

  test("function-valued options are called as options, not unwrapped as getters", () => {
    const headers = mock(({ item }: { item: { file: File } }) => ({
      "X-File-Name": item.file.name,
    }));
    const { result } = inScope(() =>
      useCourier({ url: "/api/uploads", headers }),
    );

    void result.addFile(makeFile(4, "photo.jpg"));

    expect(headers).toHaveBeenCalledTimes(1);
    expect(MockXMLHttpRequest.last.requestHeaders).toEqual({
      "X-File-Name": "photo.jpg",
    });
  });

  test("callbacks run, including onUploadSuccess with data", async () => {
    const onUploadSuccess = mock();
    const onUploadFinish = mock();
    const { result } = inScope(() =>
      useCourier<{ url: string }>({
        url: "/api/uploads",
        onUploadSuccess,
        onUploadFinish,
      }),
    );

    const upload = result.addFile(makeFile());
    MockXMLHttpRequest.last.respondWith(200, { url: "https://cdn.test/f" });
    await upload;

    expect(onUploadSuccess.mock.calls[0]?.[0]).toMatchObject({
      item: { status: "done" },
      data: { url: "https://cdn.test/f" },
    });
    expect(onUploadFinish).toHaveBeenCalledTimes(1);
  });

  test("retryUpload works from inside onUploadError", async () => {
    let retry: Promise<unknown> | undefined;
    const { result } = inScope(() => {
      const courier = useCourier({
        url: "/api/uploads",
        onUploadError: ({ item }) => {
          if (!retry) retry = courier.retryUpload(item.id);
        },
      });
      return courier;
    });

    const upload = result.addFile(makeFile());
    MockXMLHttpRequest.last.respondWith(500, {});
    await upload;

    expect(MockXMLHttpRequest.instances).toHaveLength(2);
    MockXMLHttpRequest.last.respondWith(200, {});
    expect(await retry).toMatchObject({ success: true });
  });

  test("errors carry status like the React hook", async () => {
    const { result } = inScope(() => useCourier({ url: "/api/uploads" }));

    const upload = result.addFile(makeFile());
    MockXMLHttpRequest.last.respondWithRaw(413, "too large");
    const outcome = await upload;
    const error = (outcome as { error: unknown }).error as XhrResponseError;

    expect(error).toBeInstanceOf(XhrResponseError);
    expect(error.status).toBe(413);
  });

  test("removeFile aborts the upload and drops the file", async () => {
    const { result } = inScope(() => useCourier({ url: "/api/uploads" }));

    const upload = result.addFile(makeFile());
    result.removeFile(result.files.value[0]!.id);

    expect(MockXMLHttpRequest.last.aborted).toBe(true);
    expect(result.files.value).toHaveLength(0);
    expect(((await upload) as { error: Error }).error).toBeInstanceOf(
      UploadCancelledError,
    );
  });

  test("disposing the scope cancels in-flight uploads", async () => {
    const { result, dispose } = inScope(() =>
      useCourier({ url: "/api/uploads" }),
    );

    const upload = result.addFile(makeFile());
    dispose();

    expect(MockXMLHttpRequest.last.aborted).toBe(true);
    expect(((await upload) as { error: Error }).error).toBeInstanceOf(
      UploadCancelledError,
    );
  });

  test("disposing the scope cancels an upload waiting on async headers", async () => {
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const { result, dispose } = inScope(() =>
      useCourier({
        url: "/api/uploads",
        headers: () =>
          new Promise<Record<string, string>>((resolve) => {
            resolveHeaders = resolve;
          }),
      }),
    );

    const upload = result.addFile(makeFile());
    dispose();
    resolveHeaders({});

    expect(((await upload) as { error: Error }).error).toBeInstanceOf(
      UploadCancelledError,
    );
    expect(MockXMLHttpRequest.instances).toHaveLength(0);
  });

  test("works outside an effect scope, without a Vue warning", async () => {
    const warn = mock();
    const originalWarn = console.warn;
    console.warn = warn;
    try {
      const courier = useCourier({ url: "/api/uploads" });
      const upload = courier.addFile(makeFile());
      MockXMLHttpRequest.last.respondWith(200, {});

      expect(await upload).toMatchObject({ success: true });
      expect(courier.files.value[0]?.status).toBe("done");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      console.warn = originalWarn;
    }
  });

  test("in a real component: renders files and cancels uploads on unmount", async () => {
    let addFile!: (file: File) => Promise<unknown>;
    const Uploader = defineComponent({
      setup() {
        const courier = useCourier({ url: "/api/uploads" });
        addFile = courier.addFile;
        return () =>
          h(
            "ul",
            courier.files.value.map((item) =>
              h("li", { key: item.id }, `${item.file.name}: ${item.status}`),
            ),
          );
      },
    });
    const root = document.createElement("div");
    const app = createApp(Uploader);
    app.mount(root);

    const upload = addFile(makeFile(4, "a.txt"));
    await nextTick();
    expect(root.textContent).toBe("a.txt: uploading");

    app.unmount();
    expect(MockXMLHttpRequest.last.aborted).toBe(true);
    expect(((await upload) as { error: Error }).error).toBeInstanceOf(
      UploadCancelledError,
    );
  });
});
