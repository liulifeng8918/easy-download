from __future__ import annotations

import ctypes
import hashlib
import os
import sys
import winreg
from ctypes import wintypes
from pathlib import Path


class StorageError(RuntimeError):
    pass


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data: bytes) -> tuple[DATA_BLOB, ctypes.Array[ctypes.c_char]]:
    buffer = ctypes.create_string_buffer(data)
    return DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def _protect(data: bytes) -> bytes:
    if sys.platform != "win32":
        raise StorageError("V1 SDK 仅支持 Windows DPAPI")
    source, source_buffer = _blob(data)
    entropy, entropy_buffer = _blob(b"life-license-python-v1")
    output = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), "Life License", ctypes.byref(entropy), None, None, 0,
        ctypes.byref(output),
    ):
        raise StorageError("本地授权缓存加密失败")
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del source_buffer, entropy_buffer


def _unprotect(data: bytes) -> bytes:
    if sys.platform != "win32":
        raise StorageError("V1 SDK 仅支持 Windows DPAPI")
    source, source_buffer = _blob(data)
    entropy, entropy_buffer = _blob(b"life-license-python-v1")
    output = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0,
        ctypes.byref(output),
    ):
        raise StorageError("本地授权缓存无法解密")
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del source_buffer, entropy_buffer


class DpapiStorage:
    def __init__(self, app_name: str, file_name: str = "life-license.dat") -> None:
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        self.path = base / app_name / file_name

    def read(self) -> str | None:
        if not self.path.exists():
            return None
        try:
            return _unprotect(self.path.read_bytes()).decode("utf-8")
        except (OSError, UnicodeError, StorageError) as exc:
            raise StorageError("本地授权缓存无法解密") from exc

    def write(self, value: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_bytes(_protect(value.encode("utf-8")))
        os.replace(temporary, self.path)

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


def windows_fingerprint() -> str:
    if sys.platform != "win32":
        raise StorageError("V1 SDK 仅支持 Windows")
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography") as key:
            machine_guid = str(winreg.QueryValueEx(key, "MachineGuid")[0]).strip().lower()
    except OSError as exc:
        raise StorageError("无法读取 Windows 设备标识") from exc
    return hashlib.sha256(f"life-license-device-v1\0{machine_guid}".encode()).hexdigest()

