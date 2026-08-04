FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PADDLE_PDX_MODEL_SOURCE=BOS \
    FLAGS_allocator_strategy=auto_growth \
    OMP_NUM_THREADS=1

WORKDIR /app
COPY requirements.txt .
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --index-url https://pypi.org/simple --extra-index-url https://www.paddlepaddle.org.cn/packages/stable/cpu/ -r requirements.txt
COPY server.py .

EXPOSE 8000
CMD ["python", "server.py"]
