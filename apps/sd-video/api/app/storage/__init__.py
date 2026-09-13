"""Storage abstractions for inputs, results and thumbnails."""

from .adapter import OSSStorageAdapter, LocalStorageAdapter, StorageAdapter, SupabaseStorageAdapter, build_storage_adapter

__all__ = ["LocalStorageAdapter", "OSSStorageAdapter", "SupabaseStorageAdapter", "StorageAdapter", "build_storage_adapter"]
