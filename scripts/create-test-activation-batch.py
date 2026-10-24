"""Create one explicit Easy Download test batch and write codes outside the repo."""
from __future__ import annotations

import argparse
import json
import keyring
import sys
from pathlib import Path
from urllib.request import Request, urlopen


SERVICE = "life-license-platform-v1"
OWNER_KEY = "owner-developer-key"


def call(base: str, key: str, route: str, payload: dict) -> dict:
    request = Request(
        f"{base.rstrip('/')}{route}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "authorization": f"Bearer {key}",
            "content-type": "application/json",
            "user-agent": "Life-License-Operator/0.1",
        },
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="生成一次性易下载测试激活码批次")
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--months", type=int, default=1)
    args = parser.parse_args()
    if args.count != 10 or args.months != 1:
        raise SystemExit("本次测试批次固定为 10 个、每个 1 个月；如需生产发码请使用后台明确操作")
    key = keyring.get_password(SERVICE, OWNER_KEY)
    if not key:
        raise SystemExit("Windows 凭据管理器中缺少 owner-developer-key")
    rows: list[dict[str, str]] = []
    for index in range(args.count):
        body = call(args.api_base, key, f"/v1/console/products/{args.app_id}/licenses", {
            "entitlement": {"kind": "months", "value": args.months},
            "deviceLimit": 1,
            "note": "易下载测试批次 2026-08-23",
        })
        license_row = body["license"]
        rows.append({"index": str(index + 1), "licenseId": license_row["id"], "code": license_row["code"]})
    output = Path(args.out).expanduser().resolve()
    if output.exists():
        raise SystemExit(f"拒绝覆盖已存在文件：{output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "易下载测试激活码批次\n"
        "生成数量：10\n"
        "有效期：每个 1 个月\n"
        "用途：2026-08-23 内部测试\n"
        "\n" + "\n".join(f"{row['index']}. {row['code']}" for row in rows) + "\n",
        encoding="utf-8",
    )
    print(f"OK: 已生成 {len(rows)} 个测试激活码，文件：{output}")
    print("激活码未写入代码、终端或 Git；本批次不是产品默认发码规则。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
