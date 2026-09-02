package config

import "testing"

func TestLoadProvidesDevelopmentBootstrap(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("APP_SECRET", "")
	t.Setenv("ADMIN_USERNAME", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("ALLOW_PUBLIC_SIGNUP", "")

	cfg := Load()

	if cfg.AppSecret == "" {
		t.Fatalf("development AppSecret should be bootstrapped")
	}
	if !cfg.HasAdminBootstrap() {
		t.Fatalf("development admin bootstrap should be available")
	}
	if cfg.AllowPublicSignup {
		t.Fatalf("development public signup should default to disabled")
	}
}

func TestLoadRejectsMissingProductionSecret(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_SECRET", "")
	t.Setenv("ADMIN_USERNAME", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("ALLOW_PUBLIC_SIGNUP", "")

	assertPanics(t, func() { Load() })
}

func TestLoadDoesNotDefaultProductionBootstrap(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_SECRET", "production-secret")
	t.Setenv("ADMIN_USERNAME", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("ALLOW_PUBLIC_SIGNUP", "")

	cfg := Load()

	if cfg.HasAdminBootstrap() {
		t.Fatalf("production admin bootstrap should require explicit credentials")
	}
	if cfg.AllowPublicSignup {
		t.Fatalf("production public signup should default to disabled")
	}
}

func TestLoadProductionSafetyDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_SECRET", "production-secret")
	t.Setenv("COOKIE_SECURE", "")
	t.Setenv("REQUIRE_PERSISTENT_STORAGE", "")
	t.Setenv("ASSET_STORAGE_DIR", "")
	t.Setenv("MAX_ASSET_UPLOAD_BYTES", "")

	cfg := Load()

	if !cfg.CookieSecure {
		t.Fatalf("production COOKIE_SECURE should default to true")
	}
	if !cfg.RequirePersistentStorage {
		t.Fatalf("production REQUIRE_PERSISTENT_STORAGE should default to true")
	}
	if cfg.AssetStorageDir != "./data/assets" {
		t.Fatalf("AssetStorageDir = %q, want default ./data/assets", cfg.AssetStorageDir)
	}
	if cfg.MaxAssetUploadBytes != 100*1024*1024 {
		t.Fatalf("MaxAssetUploadBytes = %d, want 100MiB", cfg.MaxAssetUploadBytes)
	}
}

func TestLoadProductionAlwaysRequiresPersistentStorage(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_SECRET", "production-secret")
	t.Setenv("REQUIRE_PERSISTENT_STORAGE", "false")

	cfg := Load()

	if !cfg.RequirePersistentStorage {
		t.Fatalf("production REQUIRE_PERSISTENT_STORAGE=false should not disable persistence")
	}
}

func TestLoadAllowsExplicitLocalHTTPSOverrides(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("COOKIE_SECURE", "false")
	t.Setenv("REQUIRE_PERSISTENT_STORAGE", "false")
	t.Setenv("MAX_ASSET_UPLOAD_BYTES", "2048")
	t.Setenv("WEBDAV_ALLOWED_HOSTS", "nas.example.com, 192.168.1.0/24, nas.example.com")
	t.Setenv("WEBDAV_PROXY_TIMEOUT_SECONDS", "45")
	t.Setenv("WEBDAV_MAX_REQUEST_BYTES", "4096")

	cfg := Load()

	if cfg.CookieSecure {
		t.Fatalf("COOKIE_SECURE=false should be honored for LAN HTTP testing")
	}
	if cfg.RequirePersistentStorage {
		t.Fatalf("REQUIRE_PERSISTENT_STORAGE=false should be honored when explicitly set")
	}
	if cfg.MaxAssetUploadBytes != 2048 {
		t.Fatalf("MaxAssetUploadBytes = %d, want explicit 2048", cfg.MaxAssetUploadBytes)
	}
	if len(cfg.WebDAVAllowedHosts) != 2 || cfg.WebDAVAllowedHosts[0] != "nas.example.com" || cfg.WebDAVAllowedHosts[1] != "192.168.1.0/24" {
		t.Fatalf("WebDAVAllowedHosts = %#v, want de-duplicated configured values", cfg.WebDAVAllowedHosts)
	}
	if cfg.WebDAVProxyTimeoutSeconds != 45 || cfg.WebDAVMaxRequestBytes != 4096 {
		t.Fatalf("WebDAV limits = %d/%d, want 45/4096", cfg.WebDAVProxyTimeoutSeconds, cfg.WebDAVMaxRequestBytes)
	}
}

func TestLoadDatabasePoolDefaultsAndOverrides(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("DB_MAX_OPEN_CONNS", "")
	t.Setenv("DB_MAX_IDLE_CONNS", "")
	t.Setenv("DB_CONN_MAX_LIFETIME_SECONDS", "")

	defaults := Load()
	if defaults.DBMaxOpenConns != 20 || defaults.DBMaxIdleConns != 10 || defaults.DBConnMaxLifetimeSeconds != 1800 {
		t.Fatalf("database pool defaults = %d/%d/%d, want 20/10/1800", defaults.DBMaxOpenConns, defaults.DBMaxIdleConns, defaults.DBConnMaxLifetimeSeconds)
	}

	t.Setenv("DB_MAX_OPEN_CONNS", "12")
	t.Setenv("DB_MAX_IDLE_CONNS", "6")
	t.Setenv("DB_CONN_MAX_LIFETIME_SECONDS", "600")

	overrides := Load()
	if overrides.DBMaxOpenConns != 12 || overrides.DBMaxIdleConns != 6 || overrides.DBConnMaxLifetimeSeconds != 600 {
		t.Fatalf("database pool overrides = %d/%d/%d, want 12/6/600", overrides.DBMaxOpenConns, overrides.DBMaxIdleConns, overrides.DBConnMaxLifetimeSeconds)
	}
}

func assertPanics(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	fn()
}
