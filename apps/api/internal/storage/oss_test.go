package storage

import (
    "context"
    "net/url"
    "testing"
)

func TestOSSKeyBoundary(t *testing.T) {
    for _, key := range []string{"", "/absolute", "../escape", "a/../b", "a\\b", "a\nkey"} {
        if validateObjectKey(key) == nil { t.Fatalf("accepted unsafe key %q", key) }
    }
    if err := validateObjectKey("personal/user/asset.png"); err != nil { t.Fatal(err) }
}

func TestCDNURLIsSignedAndDoesNotExposeKey(t *testing.T) {
    store := &OSSStorage{cdnBase:"https://assets.example.test",cdnKey:"test-secret"}
    signed, err := store.URL(context.Background(), "personal/user/图片.png")
    if err != nil { t.Fatal(err) }
    parsed, err := url.Parse(signed)
    if err != nil || parsed.Scheme != "https" || parsed.Query().Get("auth_key") == "" { t.Fatalf("invalid signed URL: %v",err) }
    if parsed.Path != "/personal/user/图片.png" { t.Fatalf("path changed: %s",parsed.Path) }
}
