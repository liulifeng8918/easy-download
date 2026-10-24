"""Issue Easy Download licenses from the developer machine.

The Developer Key is read from Windows Credential Manager through keyring and
is never written to the output file. The output contains only the codes and
non-secret license IDs needed for operator records.
"""
from __future__ import annotations

import argparse
import json
import keyring
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SERVICE = "life-license-platform-v1"
OWNER_KEY = "owner-developer-key"
SUPPORTED_MONTHS = (1, 2, 6, 12, 24, 36)


def post_json(base: str, developer_key: str, app_id: str, months: int, note: str) -> dict:
    payload = {
        "entitlement": {"kind": "months", "value": months},
        "deviceLimit": 1,
        "note": note,
    }
    request = Request(
        f"{base.rstrip('/')}/v1/console/products/{app_id}/licenses",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "authorization": f"Bearer {developer_key}",
            "content-type": "application/json",
            "user-agent": "Life-License-Operator/easy-download-0.1.3",
        },
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        body = json.loads(response.read().decode("utf-8"))
    if not isinstance(body.get("license"), dict):
        raise RuntimeError("授权服务没有返回许可证记录")
    return body["license"]


def main() -> int:
    parser = argparse.ArgumentParser(description="签发易下载激活码（Developer Key 只从 Windows 凭据管理器读取）")
    parser.add_argument("--months", type=int, choices=SUPPORTED_MONTHS, required=True, help="有效期：1/2/6/12/24/36 个月")
    parser.add_argument("--count", type=int, default=1, help="生成数量，默认 1")
    parser.add_argument("--out", required=True, help="输出到凭据管理器之外的安全文件路径")
    parser.add_argument("--note", default="易下载正式发放", help="开发者后台备注")
    parser.add_argument("--api-base", default="", help="可选；默认读取项目 config/license.public.json")
    parser.add_argument("--app-id", default="", help="可选；默认读取项目 config/license.public.json")
    args = parser.parse_args()
    if not 1 <= args.count <= 100:
        raise SystemExit("--count 必须在 1 到 100 之间")

    root = Path(__file__).resolve().parents[1]
    config = json.loads((root / "config" / "license.public.json").read_text(encoding="utf-8"))
    api_base = (args.api_base or str(config["apiBase"])).strip().rstrip("/")
    app_id = (args.app_id or str(config["appId"])).strip()
    developer_key = keyring.get_password(SERVICE, OWNER_KEY)
    if not developer_key:
        raise SystemExit("Windows 凭据管理器中没有 owner-developer-key；不会尝试从文件或环境变量读取密钥。")

    rows: list[dict[str, str]] = []
    for _ in range(args.count):
        try:
            license_row = post_json(api_base, developer_key, app_id, args.months, args.note)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, RuntimeError) as exc:
            raise SystemExit(f"签发失败，已停止；之前已经成功签发的记录不会回滚：{exc}") from exc
        code = str(license_row.get("code") or "").strip().upper()
        license_id = str(license_row.get("id") or "").strip()
        if not code or not license_id:
            raise SystemExit("授权服务返回记录不完整，未写入输出文件。")
        rows.append({"licenseId": license_id, "code": code})

    output = Path(args.out).expanduser().resolve()
    if output.exists():
        raise SystemExit(f"拒绝覆盖已存在文件：{output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    created = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    lines = [
        "易下载激活码发放记录",
        f"生成时间（UTC）：{created}",
        f"数量：{len(rows)}",
        f"有效期：每个 {args.months} 个月",
        "用途：易下载，不区分功能模块",
        "",
    ]
    lines.extend(f"{index}. {row['code']}    许可证ID：{row['licenseId']}" for index, row in enumerate(rows, 1))
    lines.append("")
    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"OK: 已签发 {len(rows)} 枚易下载激活码，已保存到：{output}")
    print("Developer Key 未写入文件、终端或 Git。请把文件中的激活码通过安全渠道交给对应用户。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyError as exc:
        raise SystemExit(f"license.public.json 缺少配置项：{exc}") from exc
