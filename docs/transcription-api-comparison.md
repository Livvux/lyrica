# Audio Transcription API Comparison (March 2026)

For Lyrica — lyrics video app requiring **word-level timestamps**.

## Comparison Table

| Provider / Model | Price/min | Word Timestamps | Speed | Free Tier | German | Notes |
|---|---|---|---|---|---|---|
| **OpenAI `whisper-1`** | $0.006 | Yes (`timestamp_granularities: ["word"]`, requires `verbose_json`) | ~1x real-time | $5 credit (expires 3 months) | Yes (multilingual) | Legacy model. **Only OpenAI model with word timestamps.** Solid baseline quality. |
| **OpenAI `gpt-4o-transcribe`** | $0.006 (est.) | **NO** | Faster than whisper-1 | Same $5 credit | Yes | Better WER than whisper-1, but **no word-level timestamps** — unusable for Lyrica. |
| **OpenAI `gpt-4o-mini-transcribe`** | $0.003 (est.) | **NO** | Fastest OpenAI | Same $5 credit | Yes | Half the price, but **no word-level timestamps** — unusable for Lyrica. |
| **Groq `whisper-large-v3-turbo`** | $0.00067 ($0.04/hr) | Yes (`timestamp_granularities: ["word"]`, `verbose_json`) | 228x real-time | Free tier with rate limits (25 MB file limit) | Yes (multilingual) | **Best price/performance ratio.** Extremely fast. Slightly higher WER (~12%) than v3. |
| **Groq `whisper-large-v3`** | $0.00185 ($0.111/hr) | Yes (same API as turbo) | 217x real-time | Same free tier (25 MB limit) | Yes (multilingual) | Better accuracy (8.4% WER) but 2.8x more expensive than turbo. |
| **Deepgram Nova-2** | $0.0043 (pre-recorded) | Yes (included, no extra cost) | Near real-time | $200 credit (no expiration, no CC) | Yes (45+ languages) | Mature, reliable. Being superseded by Nova-3. |
| **Deepgram Nova-3** | $0.0043 (pre-recorded PAYG) | Yes (improved precision over Nova-2) | Near real-time | Same $200 credit | Yes | 47% lower WER than Nova-2 for batch. Best accuracy among Deepgram models. |
| **AssemblyAI Universal-2** | $0.0025 ($0.15/hr) | Yes (included in base price) | Near real-time | 185 hrs free (pre-recorded), no CC | Yes (99 languages) | Cheapest per-minute API option. Add-ons (diarization, sentiment) cost extra but not needed for Lyrica. |

## Ranking by Price (per minute, cheapest first)

1. **Groq whisper-large-v3-turbo** — $0.00067/min ($0.04/hr)
2. **Groq whisper-large-v3** — $0.00185/min ($0.111/hr)
3. **AssemblyAI Universal-2** — $0.0025/min ($0.15/hr)
4. **OpenAI gpt-4o-mini-transcribe** — $0.003/min (but NO word timestamps)
5. **Deepgram Nova-2 / Nova-3** — $0.0043/min (pre-recorded batch)
6. **OpenAI whisper-1** — $0.006/min
7. **OpenAI gpt-4o-transcribe** — $0.006/min (but NO word timestamps)

## Ranking by Free Tier Generosity

1. **Deepgram** — $200 credit, no expiration, no CC required
2. **AssemblyAI** — 185 hrs pre-recorded free, no CC required
3. **Groq** — Free tier with rate limits (not credit-based, ongoing)
4. **OpenAI** — $5 credit, expires after 3 months

## Key Findings for Lyrica

### Critical: Word-Level Timestamps

OpenAI's newer `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` models do **NOT** support `timestamp_granularities`. Only the legacy `whisper-1` model provides word-level timestamps at OpenAI. This is a dealbreaker for Lyrica's use case.

All other providers (Groq, Deepgram, AssemblyAI) support word-level timestamps.

### Song Lyrics Quality Concerns

All Whisper-based models (OpenAI whisper-1, Groq whisper-large-v3/turbo) share a fundamental challenge with music transcription:

- **Hallucination risk**: Whisper can fabricate text when encountering background music, instrumental sections, or unclear vocals. A 2025 study found whisper-large-v3 misinterprets non-speech sounds as filler words in up to 55% of cases.
- **Vocal isolation helps**: Pre-processing audio with source separation tools (Demucs, Spleeter) to extract vocals before transcription significantly improves results.
- **No model is music-optimized**: All STT APIs are trained primarily on speech, not singing. Expect higher error rates on lyrics vs. spoken word.

### Recommendation for Lyrica

**Current setup (Groq whisper-large-v3-turbo)** is already the best choice:
- Cheapest API option that supports word timestamps ($0.00067/min)
- 228x real-time speed means near-instant transcription
- Free tier available for development
- OpenAI-compatible API (easy to switch between providers)

**If quality is insufficient**, consider:
1. Switching to **Groq whisper-large-v3** (same API, better WER, 2.8x cost)
2. Adding **vocal isolation** preprocessing (Demucs) before sending to any API
3. Trying **Deepgram Nova-3** (different architecture, may handle music differently)
4. **AssemblyAI** has the best free tier for testing (185 hrs)

---

## Local / Self-Hosted Options (Zero API Cost)

### Options

| Tool | Language | GPU Required | Word Timestamps | Notes |
|---|---|---|---|---|
| **faster-whisper** | Python (CTranslate2) | Recommended (CPU works) | Yes (native) | Best balance of speed, accuracy, and features. Most popular self-hosted option. |
| **WhisperX** | Python (faster-whisper + wav2vec2) | Yes | Yes (best precision via forced alignment) | **Best word-level timestamp accuracy** — uses wav2vec2 forced alignment on top of Whisper. Ideal for subtitle/lyrics use. |
| **whisper.cpp** | C/C++ | No (CPU-optimized, Metal on Mac) | Yes (but lower precision) | Single binary, no Python. Word timestamps can drift 300-800ms on complex audio. |
| **insanely-fast-whisper** | Python (Transformers) | Yes (strong GPU) | Yes | Maximum throughput with serious GPU hardware. |

### Trade-offs vs. API

| Factor | API (Groq/OpenAI) | Self-Hosted |
|---|---|---|
| **Cost** | $0.00067-$0.006/min | $0 (after hardware) |
| **Speed** | 228x real-time (Groq) | 1-10x real-time (depends on hardware) |
| **Setup** | API key, done | Install Python/CUDA, download models (~3GB for large-v3) |
| **Maintenance** | None | Model updates, dependency management |
| **Scaling** | Unlimited (pay per use) | Limited by your hardware |
| **File size limit** | 25-100MB | Unlimited |
| **Timestamp quality** | Good | WhisperX is best-in-class for word alignment |
| **Deployment** | Works on Vercel/serverless | Needs a server with GPU (or slow CPU) |

### Recommendation

For Lyrica's Next.js + Vercel deployment, **self-hosting is not practical** because:
- Vercel serverless functions cannot run GPU workloads
- CPU-based Whisper transcription is slow (1x real-time or slower for large-v3)
- You would need a separate GPU server (adds infrastructure complexity)

**However**, if you ever need the absolute best word-level timestamps for lyrics, **WhisperX** running on a GPU server would give you forced-alignment precision that no API currently matches. This could be a future optimization if timestamp accuracy becomes a pain point.

### Hybrid Approach (Future)

If API costs become significant at scale:
1. Use **Groq API** for real-time user-facing transcription (fast, cheap)
2. Run **WhisperX** on a GPU server for post-processing to refine word timestamps
3. Use **Demucs** for vocal isolation before either step
