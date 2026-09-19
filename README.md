Lyrica

Create music visualizers and lyric videos from your audio.

Lyrica is a self-hosted web app for turning songs into animated videos. Upload an audio file, choose a visual style, preview the result, and export an MP4. Add automatically transcribed lyrics when you need them, or keep the video entirely visual.

The editor runs in your browser. Video rendering runs on your own computer or server. Automatic transcription is optional and uses Groq or OpenAI with your own API key.

> The interface is currently in German. A transcription API key is not required for visualizer-only videos. See [License](#license) for the current licensing status.

Features

|Area                    |What you can do                                                                                                                |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------|
|Music visualizers       |Choose rainbow, monochrome, or circular wave visuals, with configurable wave colors and beat-reactive effects.                 |
|Optional lyrics         |Generate word-level timestamps through Groq or OpenAI, edit lyric text, add or remove lines, and undo or redo changes.         |
|Text animation          |Choose drift, zoom, slide, typewriter, handwritten-style, or karaoke animation. Adjust fonts, text size, and colors.           |
|Backgrounds and branding|Upload image or video backgrounds and a custom logo. Configure logo size and watermark visibility.                             |
|Visual effects          |Apply glitch, VHS, film grain, chromatic aberration, or camera shake. Start with a style preset or configure the look yourself.|
|Preview and export      |Preview in the browser and render an H.264 MP4 with progress updates, logs, and rendering metrics.                             |

The app also includes reference-lyrics checks and a mix-recognition workflow. These depend on external services and should be reviewed rather than treated as authoritative results. See Optional integrations.

Available controls are defined in the customization panel, lyrics editor, and shared configuration.

Quick start

Requirements

Use Node.js 22 and pnpm 9 to match the included Dockerfile. You also need FFmpeg, including ffprobe, available on your PATH, and a Chrome/Chromium browser for server-side rendering.

The commands below assume a macOS or Linux shell. Native Windows setup is not documented; use a Linux environment such as WSL2 when following these instructions.

Check your prerequisites:

node --version
pnpm --version
ffmpeg -version
ffprobe -version

Install

git clone https://github.com/Livvux/lyrica.git
cd lyrica
pnpm install --frozen-lockfile

Lyrica detects common Chrome and Chromium installation paths. To provision Remotion’s fallback browser, run:

pnpm exec remotion browser ensure

On Linux, the browser also needs its operating-system dependencies. The included Dockerfile shows the system packages used by the container setup. See the Remotion browser documentation for browser provisioning.

Configure optional transcription

For visualizer-only videos, skip this step.

For automatic lyrics, create .env.local in the repository root and configure one provider.

Groq — the current default:

TRANSCRIPTION_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key

OpenAI — alternative:

TRANSCRIPTION_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key

The implementation uses whisper-large-v3-turbo on Groq and whisper-1 on OpenAI. Audio is sent to the selected provider when transcription is requested. Provider usage limits and charges may apply.

The checked-in .env.example currently omits both transcription API keys. Use the minimal examples above rather than relying on that template alone. Do not commit .env.local or put secret keys in NEXT_PUBLIC_* variables.

Provider selection and audio processing are implemented in transcription.ts.

Start the app

pnpm dev --hostname 127.0.0.1

Open http://localhost:3000. Restart the server after changing environment variables.

Make your first video

1. Upload audio. Drag in an MP3, WAV, M4A, or WebM file that your browser can play.
2. Choose a look. Select a visualizer, background, logo, and effects. Leave lyrics disabled for a music-only visualizer.
3. Add lyrics when needed. Select “Lyrics aktivieren”, review the transcription and any reference checks, then correct the text. “Mix erkennen” starts the separate mix workflow.
4. Preview and export. Check the result in the player, select an export profile, and download the completed MP4.

Start with a short audio clip while checking your installation. Singing, overlapping vocals, effects, and instrumental sections can produce transcription mistakes; review the words before publishing.

The lyric editor supports text changes and line insertion/removal. It is not a full timing editor: changing text does not regenerate word alignment.

Export profiles

|Profile              |Resolution |Purpose                                                                            |
|---------------------|-----------|-----------------------------------------------------------------------------------|
|Fast / Schnell       |1280 × 720 |Drafts and setup checks; trades visual fidelity and animation smoothness for speed.|
|Balanced / Ausgewogen|1920 × 1080|Default export profile.                                                            |
|Quality / Qualität   |1920 × 1080|Higher-bitrate output and higher-quality intermediate frames.                      |

The current profiles target landscape video. Rendering speed depends on the audio duration, selected effects, browser, CPU, and available memory.

Lyrica selects render concurrency based on the detected CPU count and total system memory. To reduce memory pressure, set a lower worker count in .env.local:

RENDER_CONCURRENCY=2

An explicit value overrides automatic selection. Increase it cautiously, particularly on a shared server or inside a memory-limited container.

See render-video.ts for profile settings and browser selection, and the render route for progress streaming.

Optional integrations

Vocal separation

Before transcription, Lyrica attempts to isolate vocals using Demucs and the htdemucs_ft model. Demucs is optional and is not installed by pnpm install or the included Dockerfile.

Install it in a separate Python environment and point Lyrica at that environment when needed:

DEMUCS_PYTHON=/absolute/path/to/venv/bin/python
# Optional: select a device supported by your Python/PyTorch setup.
# DEMUCS_DEVICE=cpu

Without a working Demucs installation, transcription falls back to the original audio. Vocal separation can add substantial processing time and does not guarantee a better transcript.

Reference lyrics

The single-song identification route parses filenames such as Artist - Title.mp3 and queries LRCLIB for matching metadata. The lyrics workflow can compare a transcript with external reference lyrics when available.

A filename match is not audio fingerprint recognition. Incorrect filenames, alternate versions, and missing reference data can produce poor matches. Review the proposed results or skip the check.

See the identification route and application workflow.

Mix recognition

The mix workflow uses FFmpeg, Chromaprint’s fpcalc, and AcoustID to identify sampled sections of a longer recording. It lets you review detected artists and titles before loading reference lyrics.

Install fpcalc separately and configure:

ACOUSTID_API_KEY=your_acoustid_client_key
# Optional when fpcalc is already on PATH:
# FPCALC_PATH=/absolute/path/to/fpcalc

The implementation samples overlapping sections and groups consecutive matches. Track boundaries are approximate, and heavily edited, blended, or unidentified recordings may not match. The Dockerfile does not currently install fpcalc.

See the mix identification route.

Configuration reference

|Variable                |Purpose                                                                                                             |
|------------------------|--------------------------------------------------------------------------------------------------------------------|
|`TRANSCRIPTION_PROVIDER`|`groq` by default, or `openai`.                                                                                     |
|`GROQ_API_KEY`          |Required for Groq transcription.                                                                                    |
|`OPENAI_API_KEY`        |Required for OpenAI transcription.                                                                                  |
|`CHROME_EXECUTABLE`     |Optional absolute path to Chrome/Chromium; otherwise Lyrica tries common installation paths and Remotion’s fallback.|
|`RENDER_CONCURRENCY`    |Optional positive integer overriding automatic render worker selection.                                             |
|`NODE_MAX_MEMORY`       |Development-server heap limit in MB; defaults to `8192` in the npm scripts. This is not a production memory setting.|
|`DEMUCS_PYTHON`         |Python executable used for optional vocal separation; defaults to `python3`.                                        |
|`DEMUCS_DEVICE`         |Optional device passed to Demucs.                                                                                   |
|`ACOUSTID_API_KEY`      |Required for mix recognition.                                                                                       |
|`FPCALC_PATH`           |Chromaprint executable; defaults to `fpcalc` on `PATH`.                                                             |

For example, a standard macOS Chrome installation can be selected explicitly:

CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

Fonts must be available in the environment doing the rendering. A font available on your laptop is not automatically available on a remote server or in a container.

Self-hosting

Lyrica needs a running Node.js server, a writable filesystem, native media tools, and a browser for rendering. It is not a static-site application. Choose a host that permits long-running rendering work rather than assuming a short-lived serverless function will fit this workload.

For a local production build, stop the development server first:

pnpm build
pnpm start --hostname 127.0.0.1

The build script includes a guard against running a production build while a development server is active.

Docker

A Dockerfile and Compose configuration are included. The supplied Compose file is deployment-specific, not a portable default. Before running it, replace its fixed network address, create the .env.production file it expects, and review its resource limits and elevated container permissions.

For access only from the Docker host, replace the service’s port mapping with:

ports:
  - "127.0.0.1:3000:3000"

Add the environment variables you need to .env.production, then build and start the service:

docker compose up --build -d
docker compose logs -f lyrica

The Compose configuration mounts tmp/lyrica as a named volume. Demucs and mix recognition require additional dependencies beyond the base image. The repository’s deployment scripts are specific to the maintainer’s infrastructure and are not general installation commands.

Access and storage

Keep the app on a trusted network or behind authentication. Before opening it to other users, review upload handling, request limits, rendering concurrency, proxy timeouts, and filesystem access. Built-in rate limiting is not a substitute for access control or per-user isolation.

Uploaded media and rendered files are stored under tmp/lyrica on the server. The editor also saves state in browser local storage. That browser state is not a backup of the media files; keep your original audio and download finished exports.

Self-hosting does not make the optional integrations offline. Transcription sends audio to the selected provider; reference lookups send song metadata; mix recognition sends audio fingerprints to AcoustID. Review the relevant service terms before processing sensitive or unreleased material.

Development

The stack is Next.js 16, React 19, TypeScript, Tailwind CSS 4, and Remotion 4. Dependency versions and commands are defined in package.json.

src/
├── app/          Application entry point and API routes
├── components/   Upload, preview, customization, lyrics, and export UI
├── lib/          Transcription, timing, validation, and rendering logic
├── remotion/     Video composition and animation components
└── types/        Shared lyrics, style, and video configuration types
scripts/          Development and build helpers

The main flow is:

Upload audio → Choose visuals → Optionally generate and review lyrics
             → Preview in the browser → Render MP4 on the server

Before submitting a change, run:

pnpm lint
pnpm type-check
# Stop the development server before this command:
pnpm build

There is no pnpm test script configured. The root test-*.ts files are developer scripts, not a complete automated test suite. Manually check a short visualizer-only export and, for transcription changes, the lyrics workflow with your own test audio.

Contributing

Bug reports, documentation improvements, and focused pull requests are welcome. Open an issue before a substantial feature change so its scope can be discussed.

For bug reports, include your operating system, Node.js and pnpm versions, steps to reproduce the problem, and relevant logs with secrets removed. Share audio or screenshots only when you have permission to distribute them.

Keep generated videos, uploaded media, API keys, and machine-specific deployment settings out of pull requests.

License

A project license has not yet been declared in this repository. Public source availability alone is not an open-source license. Until an explicit license is added, do not assume general permission to reuse, modify, or redistribute the code. See GitHub’s licensing guidance.

Remotion has its own license terms, including separate free-license eligibility and company-license requirements. Any license subsequently chosen for Lyrica does not replace the licenses of its dependencies.

Music, lyrics, images, video clips, and fonts also have their own rights and terms. Use material you own or have permission to use; generating a video does not grant rights to its source media.

────────

Created by Livvux.
