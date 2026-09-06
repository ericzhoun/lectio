# -*- coding: utf-8 -*-
"""Lectio TTS synth worker — Kokoro engine (hexgrad/Kokoro-82M).

Same JSONL job protocol as synth.py, so scripts/tts/lib.mts drives either
engine:

    {"id": "2026-09-05", "lang": "zh", "text": "...", "out": "abs/path.wav"}

Kokoro speaks preset voices rather than cloning: af_heart for English,
zm_yunxi for Chinese. Chunk budgets are tuned to the decoder's ~40s ceiling
against measured pace (en ~19 chars/s, zh ~4.5 chars/s), joined with short
breaths. Emits the same status events as synth.py, so the Node orchestrator
can relay either engine's progress unchanged.
"""
import argparse
import json
import os
import re
import sys

os.environ.setdefault("HF_HOME", r"E:\workplace\TTS-cache\hf")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")

CHUNK_MAX = {"en": 300, "zh": 120}
VOICES = {"en": "af_heart", "zh": "zm_yunxi"}
LANG_CODE = {"en": "a", "zh": "z"}

SENTENCE_END = re.compile(r"[.!?。！？；][”’\"')\]」』]*\s*")
CLAUSE_END = re.compile(r"[,;:，；：、—–][”’\"')\]」』]*\s*")


def clean_text(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.replace("\u00a0", " ")).strip()


def split_text(text: str, budget: int) -> list[str]:
    pieces: list[str] = []
    rest = text
    while rest:
        if len(rest) <= budget:
            pieces.append(rest)
            break
        window = rest[:budget]
        cut = 0
        for pattern in (SENTENCE_END, CLAUSE_END):
            last = None
            for m in pattern.finditer(window):
                last = m.end()
            if last and last > budget // 3:
                cut = last
                break
        if not cut:
            cut = budget
        pieces.append(rest[:cut])
        rest = rest[cut:].lstrip()
    return [p.strip() for p in pieces if p.strip()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True, help="JSONL job file")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--voice-en", default=VOICES["en"])
    ap.add_argument("--voice-zh", default=VOICES["zh"])
    args = ap.parse_args()
    voices = {"en": args.voice_en, "zh": args.voice_zh}

    jobs = []
    with open(args.jobs, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                jobs.append(json.loads(line))
    if not jobs:
        print(json.dumps({"event": "empty"}))
        return

    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KPipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(json.dumps({"event": "ready", "device": device, "sr": 24000}), flush=True)

    pipes: dict[str, object] = {}
    sr = 24000
    for job in jobs:
        out_path = job["out"]
        try:
            lang = job["lang"]
            if lang not in LANG_CODE:
                raise ValueError(f"unsupported lang {lang}")
            text = clean_text(job["text"])
            if not text:
                raise ValueError("empty text")
            if lang not in pipes:
                pipes[lang] = KPipeline(lang_code=LANG_CODE[lang], device=device)
            pipe = pipes[lang]

            chunks = split_text(text, CHUNK_MAX.get(lang, 300))
            pieces: list[np.ndarray] = []
            for i, chunk in enumerate(chunks):
                result = list(pipe(chunk, voice=voices[lang], speed=args.speed))
                audio = result[-1].audio if result else None
                if audio is None:
                    continue
                if hasattr(audio, "detach"):
                    audio = audio.detach().cpu().numpy()
                pieces.append(np.asarray(audio, dtype=np.float32))
                print(
                    json.dumps({
                        "event": "chunk", "id": job["id"], "i": i + 1,
                        "n": len(chunks), "chars": len(chunk),
                    }),
                    flush=True,
                )
                if i < len(chunks) - 1:
                    pieces.append(np.zeros(int(sr * 0.25), dtype=np.float32))
            if not pieces:
                raise ValueError("no audio produced")
            full = np.concatenate(pieces)
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            sf.write(out_path, full, sr)
            print(
                json.dumps({
                    "event": "done", "id": job["id"], "out": out_path,
                    "seconds": round(len(full) / sr, 1),
                }),
                flush=True,
            )
        except Exception as e:  # noqa: BLE001
            print(
                json.dumps({
                    "event": "error", "id": job.get("id"),
                    "error": f"{type(e).__name__}: {e}",
                }),
                flush=True,
            )


if __name__ == "__main__":
    main()
