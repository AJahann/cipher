# Cipher Chromium CI image

Dependency-only, Linux amd64 image: Node 24.11.1, pnpm 12.6.0,
Playwright 1.63.0 Chromium headless shell, ffmpeg, git, zstd, CA certificates and required Debian
libraries. zstd and an identical store path allow host/container cache versions
to match; git avoids checkout archive fallback.
No application source, node_modules, database, secrets or authenticated browser
states are copied. `.dockerignore` excludes everything except the Dockerfile.

Publication runs only for image changes pushed to trusted `main` or the
implementation branch `e2e/chromium-image`. It never runs with write permission
on a pull-request event. The repository-scoped GITHUB_TOKEN has packages:write
only in the publisher job, and checkout does not persist credentials. Publish
after building and smoke-testing; log out, then verify anonymous manifest access
using an empty Docker config. The access check is nonblocking for publication
only, NOT permission to adopt an inaccessible candidate in normal CI.

## Upgrade process

1. Update the immutable Node base digest and exact Node/pnpm/Playwright versions
   together in Dockerfile, publisher tag, smoke test and CI parity guards.
2. Publish on the trusted image branch; require successful launch smoke and
   anonymous access. Newly published GHCR packages may require the owner to set
   visibility to public in package settings. Never add registry credentials to
   fork PR jobs as a workaround.
3. Read the published digest from the workflow summary / metadata artifact, or
   anonymously from the registry manifest. Pin CI to that digest, not a mutable
   tag, and benchmark three complete CI runs before retaining the candidate.
4. If pull, browser launch or version-parity checks fail, restore the previous
   pinned image. Do not reintroduce unbounded browser/apt installs in every job.

The slim image supports default headless Chromium only. Firefox/WebKit and
headed/channel-specific Chromium require a matching image with those binaries.
Local projects remain available with locally installed browsers; normal CI runs
only `--project=chromium`. This is a test image, not an app production runtime.
