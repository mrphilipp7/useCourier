/**
 * GitHub Pages is static, so there's no real endpoint for the demos to
 * upload to. This fake XMLHttpRequest implements just the surface the hook
 * touches (open/setRequestHeader/send/abort, upload progress events,
 * load/error events) and drives it off timers instead of a network — same
 * idea as tests/mock-xhr.ts, but animated so it reads as a real upload in
 * the browser rather than a scripted test. Framework-free, so both the
 * React and the Vue demos use it.
 */
function createDemoXHR(shouldFail: () => boolean) {
  return class DemoXMLHttpRequest extends EventTarget {
    upload = new EventTarget();
    status = 0;
    responseText = "";
    private timer: ReturnType<typeof setInterval> | null = null;

    open() {}

    setRequestHeader() {}

    send(formData?: FormData) {
      const file = formData?.get("file");
      const fileName = file instanceof File ? file.name : "file";
      let loaded = 0;

      this.timer = setInterval(() => {
        loaded = Math.min(100, loaded + 8 + Math.random() * 12);
        this.upload.dispatchEvent(
          Object.assign(new Event("progress"), {
            lengthComputable: true,
            loaded,
            total: 100,
          }),
        );

        if (loaded >= 100) {
          if (this.timer) clearInterval(this.timer);
          setTimeout(() => {
            if (shouldFail()) {
              this.status = 0;
              this.dispatchEvent(new Event("error"));
            } else {
              this.status = 200;
              this.responseText = JSON.stringify({
                ok: true,
                fileName,
                url: `https://files.example.com/${encodeURIComponent(fileName)}`,
              });
              this.dispatchEvent(new Event("load"));
            }
          }, 350);
        }
      }, 150);
    }

    abort() {
      if (this.timer) clearInterval(this.timer);
      this.dispatchEvent(new Event("abort"));
    }
  };
}

/**
 * Swaps the fake XHR onto globalThis and returns a function that restores
 * the real one.
 */
export function installDemoXHR(shouldFail: () => boolean): () => void {
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = createDemoXHR(
    shouldFail,
  ) as unknown as typeof XMLHttpRequest;
  return () => {
    globalThis.XMLHttpRequest = original;
  };
}
