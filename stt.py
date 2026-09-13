# Speech to text for spoken interview answers: a warm faster-whisper worker driven by features.js.
# Protocol: one JSON request per stdin line {"id", "file", "lang"}; one JSON reply per stdout line {"id", "text"} or {"id", "error"}.
# First line out is {"ready": true, "device": ...} once the model is loaded (the first run downloads it).
import json, os, sys

from faster_whisper import WhisperModel

# Egyptian Arabic mixed with English tech words is what the interview hears; the prompt nudges spelling that way.
PROMPTS = {
    'ar': 'ده انترفيو شغل باللهجة المصرية، وممكن أستخدم كلمات تقنية بالإنجليزي زي API و database و cache.',
    'en': 'This is a job interview answer with technical terms.',
}


def load(device):
    if device == 'cuda':
        return WhisperModel(os.environ.get('CRAM_STT_MODEL', 'medium'), device='cuda', compute_type='float16')
    return WhisperModel(os.environ.get('CRAM_STT_MODEL', 'small'), device='cpu', compute_type='int8', cpu_threads=min(8, os.cpu_count() or 4))


def cuda():
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def say(o):
    sys.stdout.write(json.dumps(o, ensure_ascii=False) + '\n')
    sys.stdout.flush()


device = 'cuda' if cuda() else 'cpu'
try:
    model = load(device)
except Exception:  # CUDA present but its libraries are not: CPU still works
    device, model = 'cpu', load('cpu')
say({'ready': True, 'device': device})


def transcribe(req):
    lang = req.get('lang') if req.get('lang') in PROMPTS else None
    segs, _ = model.transcribe(req['file'], language=lang, beam_size=5, initial_prompt=PROMPTS.get(lang), condition_on_previous_text=False)
    return ' '.join(s.text.strip() for s in segs).strip()


for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    try:
        try:
            text = transcribe(req)
        except Exception:
            if device != 'cuda':
                raise
            device, model = 'cpu', load('cpu')  # cuBLAS/cuDNN missing shows up only on first use
            text = transcribe(req)
        say({'id': req['id'], 'text': text, 'device': device})
    except Exception as e:
        say({'id': req.get('id'), 'error': str(e)})
