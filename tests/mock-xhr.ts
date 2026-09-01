/**
 * A hand-rolled XMLHttpRequest double. happy-dom's real XHR implementation
 * doesn't dispatch upload progress events (only download progress), so it
 * can't exercise useCourier's progress tracking. This double gives tests
 * full control over when progress/load/error/abort fire.
 */

type Listener = (event: Record<string, unknown>) => void;

class MockEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(type: string, event: Record<string, unknown> = {}) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

export class MockXMLHttpRequest extends MockEventTarget {
  static instances: MockXMLHttpRequest[] = [];

  readonly upload = new MockEventTarget();
  status = 0;
  responseText = "";
  method?: string;
  url?: string;
  body?: FormData;
  aborted = false;

  constructor() {
    super();
    MockXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body?: FormData) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.dispatchEvent("abort");
  }

  /** Simulates bytes sent so far for the current request (0-100). */
  emitUploadProgress(percent: number) {
    this.upload.dispatchEvent("progress", {
      lengthComputable: true,
      loaded: percent,
      total: 100,
    });
  }

  /** Simulates a successful server response. */
  respondWith(status: number, data: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(data);
    this.dispatchEvent("load");
  }

  /** Simulates a network-level failure (no response received). */
  respondWithNetworkError() {
    this.dispatchEvent("error");
  }

  static reset() {
    MockXMLHttpRequest.instances = [];
  }

  static get last(): MockXMLHttpRequest {
    const xhr =
      MockXMLHttpRequest.instances[MockXMLHttpRequest.instances.length - 1];
    if (!xhr) throw new Error("No MockXMLHttpRequest has been created yet");
    return xhr;
  }
}
