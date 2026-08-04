FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PADDLE_PDX_MODEL_SOURCE=BOS \
    FLAGS_allocator_strategy=auto_growth \
    OMP_NUM_THREADS=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://pypi.org/simple --extra-index-url https://www.paddlepaddle.org.cn/packages/stable/cpu/ -r requirements.txt
COPY server.py .

EXPOSE 8000
CMD ["python", "server.py"]
