# -*- coding: utf-8 -*-
"""Lectio TTS synth worker — batch speech synthesis with Chatterbox (local GPU).

Run by scripts/tts/*.mts with the chatterbox venv python. Loads the
multilingual model once, then processes a JSONL job file:

    {"id": "2026-09-05", "lang": "zh", "text": "...", "out": "abs/path.wav"}

Long texts are chunked (the T3 decoder hard-caps a single generation at
~40s of audio) and the chunks are joined with short breaths. One status
line is printed per job so the Node orchestrator can relay progress.
"""
import argparse
import json
import os
import re
import sys

os.environ.setdefault("HF_HOME", r"E:\workplace\TTS-cache\hf")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("COQUI_TOS_AGREED", "1")

# A chunk must stay under the decoder's ~40s ceiling. Measured pace on this
# model: English ~19 chars/s, Chinese ~2 chars/s (contemplative, with pauses).
CHUNK_MAX = {"en": 450, "zh": 90}

# Where a chunk may end, most natural break first.
SENTENCE_END = re.compile(r"[.!?。！？；][”’\"')\]」』]*\s*")
CLAUSE_END = re.compile(r"[,;:，；：、—–][”’\"')\]」』]*\s*")


def clean_text(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.replace("\u00a0", " ")).strip()


def split_text(text: str, lang: str) -> list[str]:
    budget = CHUNK_MAX.get(lang, 300)
    # Sentence pieces with their trailing punctuation kept.
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
    ap.add_argument("--exaggeration", type=float, default=0.3)
    ap.add_argument("--cfg", type=float, default=0.5)
    args = ap.parse_args()

    jobs = []
    with open(args.jobs, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                jobs.append(json.loads(line))
    if not jobs:
        print(json.dumps({"event": "empty"}))
        return

    import torch
    import torchaudio
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    sr = model.sr
    print(json.dumps({"event": "ready", "device": device, "sr": sr}), flush=True)

    for job in jobs:
        out_path = job["out"]
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        try:
            text = clean_text(job["text"])
            if not text:
                raise ValueError("empty text")
            chunks = split_text(text, job["lang"])
            gap = torch.zeros(int(sr * 0.35))
            pieces = []
            for i, chunk in enumerate(chunks):
                wav = model.generate(
                    chunk,
                    language_id=job["lang"],
                    audio_prompt_path=None,
                    exaggeration=args.exaggeration,
                    cfg_weight=args.cfg,
                )[0]
                pieces.append(wav.detach().cpu())
                if i < len(chunks) - 1:
                    pieces.append(gap)
                print(
                    json.dumps({
                        "event": "chunk", "id": job["id"], "i": i + 1,
                        "n": len(chunks), "chars": len(chunk),
                    }),
                    flush=True,
                )
            audio = torch.cat(pieces, dim=0).unsqueeze(0)
            torchaudio.save(out_path, audio, sr)
            dur = audio.shape[-1] / sr
            print(
                json.dumps({
                    "event": "done", "id": job["id"], "out": out_path,
                    "seconds": round(dur, 1),
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
