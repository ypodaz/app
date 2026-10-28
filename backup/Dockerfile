# pg_dump versiyası serverlə eyni olmalıdır (Railway Postgres 18)
FROM postgres:18-alpine
RUN apk add --no-cache python3 py3-boto3
COPY backup.py /backup.py
ENTRYPOINT []
CMD ["python3", "/backup.py"]
