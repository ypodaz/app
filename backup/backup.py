"""Gecə nüsxəsi: Postgres-in pg_dump-ı Cloudflare R2-yə gedir, köhnələr silinir.

Railway-də ayrıca cron servisi kimi işləyir (railway.json). Xəta olanda sıfırdan fərqli kodla çıxır,
Railway işi «Failed» göstərir.
"""

import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import boto3

BAKU = timezone(timedelta(hours=4))
KEEP_DAYS = int(os.environ.get("KEEP_DAYS", "30"))
KEEP_MIN = 7  # nə olursa olsun, ən son 7 nüsxə silinmir
BUCKET = os.environ.get("R2_BUCKET", "ypod-backups")


def main() -> None:
    name = f"ypod-{datetime.now(BAKU):%Y%m%d-%H%M}.dump"
    path = f"/tmp/{name}"
    subprocess.run(["pg_dump", "--format=custom", "--no-owner", "-f", path, os.environ["DATABASE_URL"]], check=True)
    # nüsxə oxunmursa göndərmirik
    subprocess.run(["pg_restore", "--list", path], check=True, stdout=subprocess.DEVNULL)
    size = os.path.getsize(path)
    s3 = boto3.client("s3", region_name="auto",
                      endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                      aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"])
    s3.upload_file(path, BUCKET, name)
    print(f"göndərildi: {name} ({size} bayt)")

    objs = s3.list_objects_v2(Bucket=BUCKET, Prefix="ypod-").get("Contents", [])
    objs.sort(key=lambda o: o["LastModified"], reverse=True)
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    for o in objs[KEEP_MIN:]:
        if o["LastModified"] < cutoff:
            s3.delete_object(Bucket=BUCKET, Key=o["Key"])
            print(f"silindi: {o['Key']}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:  # mətndə əmr var, əmrdə isə bazanın parolu — çap etmirik
        print(f"nüsxə alınmadı: {e.cmd[0]} kodu {e.returncode}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"nüsxə alınmadı: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
