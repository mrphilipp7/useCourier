import React from "react";

// useLayoutEffect warns during server rendering on older React versions;
// there's no layout to wait for on the server anyway.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * #29: A ref that always holds the value from the most recent committed
 * render. Uploads outlive the render they started in, so anything they
 * call later (the consumer's callbacks, url, fileChunking) is read through
 * this instead of from that render's closure, which would be stale.
 */
export function useLatest<T>(value: T) {
  const ref = React.useRef(value);

  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });

  return ref;
}
