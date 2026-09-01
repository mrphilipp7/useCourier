import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Tests hit local mock HTTP servers on arbitrary ports, which happy-dom's
// default same-origin policy would otherwise block as cross-origin.
GlobalRegistrator.register({
  settings: { fetch: { disableSameOriginPolicy: true } },
});
