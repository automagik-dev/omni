#!/usr/bin/env python3
"""Cheap multimodal benchmark over local Omni media.

Keeps private content out of stdout: raw transcripts/descriptions are stored in
JSONL only under the requested output dir; the console prints aggregate metrics.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import pathlib
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from typing import Any

MEDIA_ROOT = pathlib.Path('/home/genie/.omni/data/media')
OMNI_ROOT = pathlib.Path('/home/genie/prod/omni')

# Conservative placeholders. Real provider invoices win; this is just a budget guard.
PRICE_PER_RUN_USD = {
    'stt:groq:whisper-large-v3-turbo': 0.0001,
    'stt:gemini:gemini-3.1-flash-lite': 0.0002,
    'vision:deepseek:deepseek-v4-flash': 0.0002,
    'vision:deepseek:deepseek-v4-pro': 0.0010,
    'vision:gemini:gemini-3.1-flash-lite': 0.0002,
    'tts:gemini:default': 0.002,
    'tts:elevenlabs:default': 0.01,
    'imagegen:gemini:nano-banana-2': 0.05,
    'videogen:gemini:default': 1.00,
}

@dataclass
class BenchResult:
    modality: str
    provider: str
    model: str
    sample_sha256: str | None
    sample_bytes: int | None
    sample_path: str | None
    ok: bool
    latency_ms: int
    output_chars: int
    output_sha256: str | None
    estimated_cost_usd: float
    error: str | None = None
    usage: dict[str, Any] | None = None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str], timeout: int = 120) -> tuple[int, str, int]:
    start = time.time()
    p = subprocess.run(cmd, cwd=OMNI_ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    return p.returncode, p.stdout, int((time.time() - start) * 1000)


def pick_files(exts: tuple[str, ...], limit: int, min_bytes: int, max_bytes: int) -> list[pathlib.Path]:
    out: list[tuple[int, pathlib.Path]] = []
    for p in MEDIA_ROOT.rglob('*'):
        if p.suffix.lower() in exts:
            try:
                s = p.stat().st_size
            except OSError:
                continue
            if min_bytes <= s <= max_bytes:
                out.append((s, p))
    # Spread a little: smallest, middle-ish, largest-ish within cheap range.
    out.sort()
    if len(out) <= limit:
        return [p for _, p in out]
    idxs = sorted(set(int(i * (len(out)-1) / max(1, limit-1)) for i in range(limit)))
    return [out[i][1] for i in idxs]


def record(modality: str, provider: str, model: str, sample: pathlib.Path | None, ok: bool, latency_ms: int, text: str, error: str | None = None, usage: dict[str, Any] | None = None) -> BenchResult:
    key = f'{modality}:{provider}:{model}'
    if key not in PRICE_PER_RUN_USD and modality in ('tts','videogen'):
        key = f'{modality}:{provider}:default'
    return BenchResult(
        modality=modality,
        provider=provider,
        model=model,
        sample_sha256=sha256_file(sample) if sample else None,
        sample_bytes=sample.stat().st_size if sample else None,
        sample_path=str(sample) if sample else None,
        ok=ok,
        latency_ms=latency_ms,
        output_chars=len(text),
        output_sha256=sha256_bytes(text.encode()) if text else None,
        estimated_cost_usd=PRICE_PER_RUN_USD.get(key, 0.001),
        error=error,
        usage=usage,
    )


def bench_stt(audio_files: list[pathlib.Path]) -> list[BenchResult]:
    results=[]
    for p in audio_files:
        for provider, model, lang in [
            ('groq','whisper-large-v3-turbo','pt'),
            ('gemini','gemini-3.1-flash-lite','pt-BR'),
        ]:
            code, out, ms = run(['omni','listen',str(p),'--provider',provider,'--model',model,'--language',lang,'--format','json'], timeout=120)
            ok = code == 0 and '✓ Transcription complete' in out
            err = None if ok else out[-1200:]
            results.append(record('stt', provider, model, p, ok, ms, out if ok else '', err))
    return results


def deepseek_vision(path: pathlib.Path, model: str) -> BenchResult:
    api_key = os.environ.get('DEEPSEEK_API_KEY')
    if not api_key:
        return record('vision','deepseek',model,path,False,0,'','DEEPSEEK_API_KEY missing')
    data = path.read_bytes()
    mime = mimetypes.guess_type(str(path))[0] or 'image/jpeg'
    body = {
        'model': model,
        'max_tokens': 256,
        'thinking': {'type':'disabled'},
        'messages': [{
            'role':'user',
            'content': [
                {'type':'text','text':'Describe the image briefly in Portuguese. If there is text, transcribe the visible text.'},
                {'type':'image','source':{'type':'base64','media_type':mime,'data':base64.b64encode(data).decode()}},
            ],
        }],
    }
    req = urllib.request.Request(
        'https://api.deepseek.com/anthropic/v1/messages',
        data=json.dumps(body).encode(),
        headers={'content-type':'application/json','x-api-key':api_key,'anthropic-version':'2023-06-01'},
    )
    start=time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw=r.read().decode()
            ms=int((time.time()-start)*1000)
            obj=json.loads(raw)
            text='\n'.join(part.get('text','') for part in obj.get('content',[]) if part.get('type')=='text')
            lower = text.lower()
            semantic_fail = any(
                s in lower
                for s in [
                    "can't see",
                    'cannot see',
                    'cannot view',
                    'i cannot see',
                    'i can’t see',
                    'unsupported image',
                    '[unsupported image]',
                    'não consigo ver',
                    'nao consigo ver',
                    'não posso ver',
                    'nao posso ver',
                    'não tenho acesso',
                    'nao tenho acesso',
                    'não consigo descrever',
                    'nao consigo descrever',
                    'não foi fornecida',
                    'nao foi fornecida',
                ]
            )
            return record('vision','deepseek',model,path,not semantic_fail,ms,text, None if not semantic_fail else text[:500], obj.get('usage'))
    except urllib.error.HTTPError as e:
        ms=int((time.time()-start)*1000)
        return record('vision','deepseek',model,path,False,ms,'',e.read().decode()[:1000])
    except Exception as e:
        ms=int((time.time()-start)*1000)
        return record('vision','deepseek',model,path,False,ms,'',repr(e))


def bench_vision(image_files: list[pathlib.Path]) -> list[BenchResult]:
    results=[]
    for p in image_files:
        code,out,ms=run(['omni','see',str(p),'Describe briefly in Portuguese. Transcribe visible text.','--provider','gemini','--language','pt-BR','--max-tokens','256'], timeout=120)
        ok=code==0 and '✗' not in out
        results.append(record('vision','gemini','gemini-3.1-flash-lite',p,ok,ms,out if ok else '',None if ok else out[-1200:]))
        for model in ['deepseek-v4-flash','deepseek-v4-pro']:
            results.append(deepseek_vision(p, model))
    return results


def bench_generation() -> list[BenchResult]:
    results=[]
    text='Mensagem curta em português para benchmark de voz Omni.'
    for provider in ['gemini','elevenlabs']:
        outpath=f'/tmp/omni-bench-tts-{provider}.ogg'
        code,out,ms=run(['omni','speak',text,'--provider',provider,'--output',outpath], timeout=180)
        ok=code==0 and pathlib.Path(outpath).exists()
        results.append(record('tts',provider,'default',None,ok,ms,out if ok else '',None if ok else out[-1200:]))
    code,out,ms=run(['omni','imagine','simple flat icon of a blue whale, white background','--provider','gemini','--model','nano-banana-2','--count','1','--output','/tmp/omni-bench-image.png'], timeout=240)
    ok=code==0 and pathlib.Path('/tmp/omni-bench-image.png').exists()
    results.append(record('imagegen','gemini','nano-banana-2',None,ok,ms,out if ok else '',None if ok else out[-1200:]))
    # One video probe only; budget guard assumes <= $1, and expired Gemini key exits before cost.
    code,out,ms=run(['omni','film','2 second simple animation of a blue dot moving left to right','--provider','gemini','--duration','2','--resolution','720p','--no-audio','--output','/tmp/omni-bench-video.mp4'], timeout=360)
    ok=code==0 and pathlib.Path('/tmp/omni-bench-video.mp4').exists()
    results.append(record('videogen','gemini','default',None,ok,ms,out if ok else '',None if ok else out[-1200:]))
    return results


def summarize(results: list[BenchResult]) -> dict[str, Any]:
    by={}
    for r in results:
        k=f'{r.modality}:{r.provider}:{r.model}'
        s=by.setdefault(k, {'runs':0,'ok':0,'errors':0,'latencies':[],'estimated_cost_usd':0.0})
        s['runs']+=1; s['ok']+=int(r.ok); s['errors']+=int(not r.ok); s['latencies'].append(r.latency_ms); s['estimated_cost_usd']+=r.estimated_cost_usd
    for s in by.values():
        lat=sorted(s.pop('latencies'))
        s['p50_ms']=lat[len(lat)//2] if lat else None
        s['max_ms']=max(lat) if lat else None
        s['estimated_cost_usd']=round(s['estimated_cost_usd'],6)
    return {'total_runs':len(results),'estimated_cost_usd':round(sum(r.estimated_cost_usd for r in results),6),'by_model':by}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--budget', type=float, default=20.0)
    ap.add_argument('--outdir', default='/tmp/omni-multimodal-bench')
    ap.add_argument('--audio-n', type=int, default=5)
    ap.add_argument('--image-n', type=int, default=5)
    args=ap.parse_args()
    outdir=pathlib.Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)
    audio=pick_files(('.ogg','.mp3','.m4a','.wav','.webm'), args.audio_n, 50_000, 700_000)
    images=pick_files(('.jpg','.jpeg','.png','.webp'), args.image_n, 10_000, 250_000)
    results=[]
    projected = args.audio_n*2*0.001 + args.image_n*3*0.002 + 1.2
    if projected > args.budget:
        raise SystemExit(f'Projected benchmark cost ${projected:.2f} exceeds budget ${args.budget:.2f}')
    results += bench_stt(audio)
    results += bench_vision(images)
    results += bench_generation()
    jsonl=outdir/'results.jsonl'
    with jsonl.open('w') as f:
        for r in results:
            f.write(json.dumps(asdict(r), ensure_ascii=False)+'\n')
    summary=summarize(results)
    (outdir/'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print('results_jsonl', jsonl)

if __name__ == '__main__':
    main()
