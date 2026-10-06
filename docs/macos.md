# Native macOS app

Lyrica uses a compiled Swift/AppKit executable and the system WKWebView for its
existing editor. It bundles the Next.js server, Node.js, FFmpeg/ffprobe, their
non-system dynamic libraries, and Remotion's Chrome Headless Shell. It does not
require a terminal, Homebrew, a separately installed Chrome, or a running web
server to launch. The editor remains web-based; this is not a SwiftUI rewrite.

Build on macOS with Xcode Command Line Tools, Python 3, Node.js, pnpm,
FFmpeg and ffprobe available on PATH:

```sh
pnpm install --frozen-lockfile
pnpm macos:build
open dist/Lyrica.app
```

`pnpm macos:run` builds and opens the app. The Codex Run action uses the same
`script/build_and_run.sh` entrypoint. `--verify` checks the native process;
`--logs` follows the local service log. The packager targets the build machine's
architecture, not a universal binary. Native library OS requirements also apply;
an arm64 build must be tested on the target macOS release before distribution.
The packager derives `LSMinimumSystemVersion` from all staged native libraries.
The build verified on 2026-10-06 is **arm64, macOS 27.0 or later**, because the
installed FFmpeg libraries require macOS 27. Build with older-compatible media
tools to target older macOS releases; changing the plist alone is insufficient.

Drag `dist/Lyrica.app` to Applications or open it in place. The app uses port
47831 on loopback only. It authenticates its WebView with a per-launch HttpOnly
cookie and rejects foreign origins/Host headers. A port conflict is reported
instead of attaching to an unrelated server. Closing the window quits the app;
its supervisor stops the local service and renderer process group, including
when the native app crashes. Quitting cancels an active export.

Data lives in `~/Library/Application Support/Lyrica`:

- `tmp/lyrica`: uploaded media and rendered files (the existing cleanup policy applies).
- `runtime/<build-id>`: writable Next.js build/cache and links into the app.
- `desktop.log`: current launch log.
- `.env.local`: optional transcription/integration settings, created by the user.

Use **Lyrica → Datenordner öffnen** to open this directory. For optional
transcription, add `GROQ_API_KEY` (and `TRANSCRIPTION_PROVIDER=groq`) or
`OPENAI_API_KEY` (and `TRANSCRIPTION_PROVIDER=openai`) to `.env.local`, then restart.
Keys are never copied from the checkout into the app. Demucs/Python and
Chromaprint are optional and not bundled; configure absolute executable paths
for those integrations. Visualizer-only rendering works without API keys.

Verification:

```sh
pnpm lint
pnpm type-check
pnpm test
node scripts/test-macos.mjs
codesign --verify --deep --strict dist/Lyrica.app
```

The desktop smoke test starts an isolated packaged server on port 47832, uses
synthetic audio, checks access restrictions, upload, ranged audio, an actual MP4
export including audio, and shutdown. Also verify native file selection, preview
playback and the Save dialog in the actual app.

The generated bundle is ad-hoc signed for local use. It is **not notarized** or
Developer ID signed. Public distribution needs a signing identity, notarization,
target-OS testing, and a review of the bundled dependencies' license obligations
(including Remotion and FFmpeg). The bundle contains dependency license files;
`Contents/Resources/native-dependencies.json` lists the staged native libraries.

Implementation references: the local Next.js documentation directory was absent;
the installed Next.js/Remotion types and source were checked alongside the
[Next.js custom-server documentation](https://nextjs.org/docs/app/guides/custom-server),
[Apple WKUIDelegate](https://developer.apple.com/documentation/webkit/wkuidelegate)
and [WKDownloadDelegate](https://developer.apple.com/documentation/webkit/wkdownloaddelegate).
