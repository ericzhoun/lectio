"""Generate reviewable verse timings from the downloaded songs' embedded lyrics.

Requires torch, torchaudio and numpy; uses the local GPU when available.
The model is downloaded once by torchaudio. No recordings leave the machine.
Intermediate emissions and detailed evidence live under .tts-work/music/.
Usage: python scripts/align-singing-bible.py [--only 43-john/003] [--force]
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

import numpy as np
import torch
import torchaudio

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'downloads/TheSingingBible-English-Male-Praise'
WORK = ROOT / '.tts-work/music'
WORK.mkdir(parents=True, exist_ok=True)


def normalized(text):
    return re.sub(r'[^A-Z\' ]', '', text.upper().replace('’', "'").replace('—', ' '))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    torch.set_num_threads(4)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
    model = bundle.get_model().to(device).eval()
    labels = bundle.get_labels()
    dictionary = {char: i for i, char in enumerate(labels)}
    print(f'Alignment model ready on {device}', flush=True)
    paths = sorted(SOURCE.glob('*/*.mp3'))
    if args.only:
        paths = [p for p in paths if p.relative_to(SOURCE).with_suffix('').as_posix() == args.only]
    for path in paths:
        relative = path.relative_to(SOURCE)
        output = WORK / (relative.as_posix().replace('/', '-') + '.json')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        same_source = output.exists() and json.loads(output.read_text(encoding='utf-8')).get('sha256') == digest
        if same_source and not args.force:
            continue
        print(f'Aligning {relative}', flush=True)
        info = json.loads(subprocess.check_output([
            'ffprobe', '-v', 'quiet', '-show_format', '-of', 'json', str(path)
        ]))['format']
        lyrics = next((v for k, v in info.get('tags', {}).items() if k.startswith('lyrics')), '')
        lines = [line.strip() for line in lyrics.splitlines() if line.strip()]
        if not lines:
            print('No lyrics; skipped', flush=True)
            continue
        text = '|'.join(normalized(line).strip().replace(' ', '|') for line in lines)
        targets = torch.tensor([[dictionary[c] for c in text]], dtype=torch.int32)
        cache = output.with_suffix('.pt')
        if cache.exists() and same_source:
            emission = torch.load(cache, weights_only=True)
        else:
            pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
                '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'])
            waveform = torch.from_numpy(np.frombuffer(pcm, dtype=np.float32).copy())
            # Keep the 320-sample frame grid continuous. One second of context
            # on each side avoids the decoder treating every chunk as silence.
            frames = []
            core, context = 320000, 16000
            with torch.inference_mode():
                for start in range(0, len(waveform), core):
                    left = max(0, start - context)
                    right = min(len(waveform), start + core + context)
                    e, _ = model(waveform[left:right].unsqueeze(0).to(device))
                    first = (start - left) // 320
                    count = min(core, len(waveform) - start) // 320
                    frames.append(e[0, first:first + count].cpu())
            emission = torch.cat(frames).log_softmax(-1)
            torch.save(emission, cache)
        aligned, scores = torchaudio.functional.forced_align(emission.unsqueeze(0), targets, blank=0)
        spans = torchaudio.functional.merge_tokens(aligned[0], scores[0].exp(), blank=0)
        assert len(spans) == len(text), (len(spans), len(text))
        result = []
        offset = 0
        for number, line in enumerate(lines, 1):
            clean = normalized(line).strip().replace(' ', '|')
            tokens = spans[offset:offset + len(clean)]
            letters = [s for s, c in zip(tokens, clean) if c != '|']
            start, end = letters[0].start * .02, letters[-1].end * .02
            score = sum(s.score for s in letters) / len(letters)
            greedy_ids = emission[letters[0].start:letters[-1].end].argmax(-1).unique_consecutive().tolist()
            heard = ''.join(labels[i] for i in greedy_ids if i).replace('|', ' ')
            result.append({'verse': number, 'start': round(start, 2), 'end': round(end, 2),
                'score': round(score, 4), 'lyrics': line, 'recognized': heard})
            offset += len(clean) + 1
        output.write_text(json.dumps({'file': relative.as_posix(), 'sha256': digest,
            'duration': float(info['duration']), 'model': 'WAV2VEC2_ASR_BASE_960H', 'verses': result},
            ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'Wrote {len(result)} verse candidates to {output.name}', flush=True)


if __name__ == '__main__':
    main()
