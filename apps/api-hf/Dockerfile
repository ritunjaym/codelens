FROM python:3.12-slim

# HF Spaces runs as non-root user
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

# Redirect ALL model/cache writes to /tmp (only writable dir on HF Spaces)
ENV HF_HOME=/tmp/hf-cache
ENV TRANSFORMERS_CACHE=/tmp/hf-cache
ENV TORCH_HOME=/tmp/torch-cache
ENV XDG_CACHE_HOME=/tmp/cache
ENV TOKENIZERS_PARALLELISM=false

WORKDIR /app

# Install dependencies first (layer caching)
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy app code
COPY --chown=user . /app

# HF Spaces requires port 7860
EXPOSE 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
