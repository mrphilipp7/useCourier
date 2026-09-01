---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "useCourier"
  text: "File uploads with real progress"
  tagline: A headless React hook with XHR progress tracking, retries, cancellation, and chunked uploads for large files.
  actions:
    - theme: brand
      text: Get Started
      link: /get-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/mrphilipp7/useCourier

features:
  - title: Real upload progress
    details: Built on XMLHttpRequest instead of fetch, so you get real 0-100% progress events fetch can't give you.
  - title: Retries and cancellation
    details: Retry a failed upload or cancel one in flight, with lifecycle callbacks to hook in your own side effects.
  - title: Chunked uploads for large files
    details: Files too big for a single request are split into sequential chunks, each retried independently on failure.
  - title: Headless and typed
    details: No UI, no styling opinions — bring your own components. Fully typed API with generics for your response shape.
---
