#!/bin/sh
set -eu

# Persist content-hashed bundles across container replacements. HTML always
# comes from the current image; old tabs may still request an earlier bundle.
web_root=${STUDIO_WEB_ROOT:-/usr/share/nginx/html}
cache_root=${STUDIO_ASSET_CACHE:-/var/cache/studio-assets}
# Keep inactive bundles for 30 days; current bundles are refreshed on startup.
retention_days=${STUDIO_ASSET_RETENTION_DAYS:-30}
case "$retention_days" in ''|*[!0-9]*|0) echo 'Invalid asset retention days' >&2; exit 1 ;; esac
case "$cache_root" in ''|/) echo 'Invalid asset cache directory' >&2; exit 1 ;; esac
[ "$web_root" != "$cache_root" ] || exit 1

for relative in assets director-desk/assets; do
    source="$web_root/$relative"
    target="$cache_root/$relative"
    [ -d "$source" ] || continue
    mkdir -p "$target"
    cp -R "$source/." "$target/"
    # Never prune the live image, HTML, API data or user media.
    find "$target" -type f -mtime "+$retention_days" -delete
done
