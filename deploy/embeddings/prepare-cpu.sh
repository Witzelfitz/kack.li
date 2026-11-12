#!/bin/sh
# Run on the x86-64 Docker host, in the deployment directory.
set -eu
cd "$(dirname "$0")"
SOURCE=ollama/ollama:0.40.16@sha256:910d0d8107b538fb0894e63163eb195de0cc7aefcbc666dc62d3b18f71124592
test ! -e cpu-runtime || { echo 'cpu-runtime already exists; inspect it before rebuilding.' >&2; exit 1; }
mkdir -p cpu-runtime/lib
docker pull "$SOURCE"
docker run --rm --entrypoint sh "$SOURCE" -c 'tar -C /usr/bin -cf - ollama' | tar -xf - -C cpu-runtime
docker run --rm --entrypoint sh "$SOURCE" -c 'cd /usr/lib/ollama && find . -maxdepth 1 ! -type d -print0 | tar --null -T - -cf -' | tar -xf - -C cpu-runtime/lib
docker build -f Dockerfile.cpu -t kack/ollama-cpu:0.40.16 .
echo 'CPU image ready. The unused source image can be removed after the CPU service passes its health checks.'
