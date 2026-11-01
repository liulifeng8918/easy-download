"""Conservative shared download budget; no extra dependency or network probes."""
from __future__ import annotations

import ctypes
import os
import threading
from contextlib import contextmanager

GIB = 1024 ** 3


def available_memory() -> int | None:
    if os.name != "nt":
        try:
            return os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
        except (ValueError, OSError, AttributeError):
            return None
    class MemoryStatus(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in
            ("total", "available", "page_total", "page_available", "virtual_total", "virtual_available", "extended")
        ]
    try:
        status = MemoryStatus()
        status.length = ctypes.sizeof(status)
        return int(status.available) if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)) else None
    except (AttributeError, OSError):
        return None


def resource_profile(cpus: int | None = None, memory: int | None = None) -> dict:
    cores = max(1, int(cpus if cpus is not None else (os.cpu_count() or 1)))
    free = memory if memory is not None else available_memory()
    if cores <= 2 or (free is not None and free < GIB):
        budget = 1
    elif cores <= 4 or free is None or free < 3 * GIB:
        budget = 2
    else:
        budget = 4
    return {"budget": budget, "chunk_mib": min(4, budget), "cpus": cores}


class DownloadBudget:
    def __init__(self, sampler=resource_profile):
        self.sampler = sampler
        self.condition = threading.Condition()
        self.used = 0
        self.waiting = 0

    @contextmanager
    def reserve(self):
        with self.condition:
            self.waiting += 1
            try:
                while True:
                    profile = self.sampler()
                    remaining = profile["budget"] - self.used
                    if remaining > 0:
                        share = min(remaining, max(1, profile["budget"] // self.waiting))
                        self.used += share
                        break
                    self.condition.wait(timeout=0.5)
            finally:
                self.waiting -= 1
        try:
            yield {**profile, "fragments": share}
        finally:
            with self.condition:
                self.used -= share
                self.condition.notify_all()
