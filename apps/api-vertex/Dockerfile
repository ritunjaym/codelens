FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ \
    && rm -rf /var/lib/apt/lists/*

ENV TOKENIZERS_PARALLELISM=false
ENV HF_HOME=/tmp/hf-cache
ENV TRANSFORMERS_CACHE=/tmp/hf-cache

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download tokenizer so it's baked into the image (fast cold start)
RUN python3 -c "from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('microsoft/codebert-base', cache_dir='/tmp/hf-cache')" || true

COPY main.py .

EXPOSE 8080
CMD uvicorn main:app --host 0.0.0.0 --port ${AIP_HTTP_PORT:-8080}
