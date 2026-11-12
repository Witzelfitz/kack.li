#!/usr/bin/env python3
"""Import the official EmbeddingGemma 2 text backbone without vision/audio weights."""
import json
import subprocess
from pathlib import Path

container = 'kack-embeddings-ollama-1'
manifest_path = '/root/.ollama/models/manifests/registry.ollama.ai/library/embeddinggemma-2/latest'
manifest = json.loads(subprocess.check_output(['docker', 'exec', container, 'cat', manifest_path]))
layer = next(item for item in manifest['layers'] if item['mediaType'] == 'application/vnd.ollama.image.model')
model = 'FROM /root/.ollama/models/blobs/' + layer['digest'].replace(':', '-')
model += '\nPARAMETER num_ctx 2048\nPARAMETER num_batch 512\nPARAMETER num_thread 1\n'
file = Path(__file__).with_name('Modelfile.text')
file.write_text(model)
subprocess.run(['docker', 'cp', str(file), container + ':/tmp/Modelfile.text'], check=True)
subprocess.run(['docker', 'exec', container, 'ollama', 'create', 'kack-embeddinggemma-2-text', '-f', '/tmp/Modelfile.text'], check=True)
