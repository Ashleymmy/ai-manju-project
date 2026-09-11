package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

const (
	// API database pool defaults leave room for worker replicas and operations
	// against a standard PostgreSQL max_connections=100 deployment.
	defaultDBMaxOpenConns           = 20
	defaultDBMaxIdleConns           = 10
	defaultDBConnMaxLifetimeSeconds = 1800
	// WebDAV defaults match the frozen Studio client's request timeout and asset upload ceiling.
	defaultWebDAVProxyTimeoutSeconds = 120
	defaultWebDAVMaxRequestBytes     = 100 * 1024 * 1024
)

type Config struct {
	AppEnv                    string
	Host                      string
	Port                      string
	FrontendURL               string
	FrontendURLs              []string
	StorageDriver             string
	DatabaseURL               string
	DBMaxOpenConns            int
	DBMaxIdleConns            int
	DBConnMaxLifetimeSeconds  int
	AppSecret                 string
	AllowPublicSignup         bool
	CookieSecure              bool
	AdminUsername             string
	AdminPassword             string
	AdminDisplayName          string
	RequirePersistentStorage  bool
	AssetStorageDir           string
	AssetStorageBackend       string
	OSSRegion                 string
	OSSEndpoint               string
	OSSBucket                 string
	OSSAccessKeyID            string
	OSSAccessKeySecret        string
	OSSSecurityToken          string
	SupabaseStorageURL        string
	SupabaseStoragePublicURL  string
	SupabaseStorageBucket     string
	SupabaseStorageToken      string
	SupabaseStorageTokenFile  string
	SupabaseStorageAPIKey     string
	SupabaseStorageAPIKeyFile string
	SupabaseStorageCAFile     string
	AssetCDNBaseURL           string
	AssetCDNAuthKey           string
	AssetArchiveTimezone      string
	PublicAssetBaseURL        string
	MaxAssetUploadBytes       int64
	RedisURL                  string
	CeleryBrokerURL           string
	CeleryQueueName           string
	JobMaxAttempts            int
	JobDefaultTimeoutSeconds  int
	WebDAVAllowedHosts        []string
	WebDAVProxyTimeoutSeconds int
	WebDAVMaxRequestBytes     int64
	// SD-video is an optional private service. The browser never sees this URL.
	SDVideoBaseURL             string
	SDVideoMode                string
	SDVideoAllowedWorkspaces   []string
	SDVideoAllowedModels       []string
	SDVideoJWTPrivateKey       string
	SDVideoJWTKeyID            string
	SDVideoJWTIssuer           string
	SDVideoJWTAudience         string
	SDVideoRequestTimeoutMilli int
	SDVideoBridgeEnabled       bool
	SDVideoBridgeIntervalSec   int
	SDVideoBridgeBatchSize     int
}

func Load() Config {
	appEnv := strings.ToLower(getEnv("APP_ENV", "development"))
	frontendURL := getEnv("FRONTEND_URL", "http://localhost:3100")
	cfg := Config{
		AppEnv:                     appEnv,
		Host:                       getEnv("HOST", "0.0.0.0"),
		Port:                       getEnv("PORT", "3101"),
		FrontendURL:                frontendURL,
		FrontendURLs:               parseFrontendURLs(os.Getenv("FRONTEND_URLS"), frontendURL),
		StorageDriver:              normalizeStorageDriver(appEnv, os.Getenv("STORAGE_DRIVER")),
		DatabaseURL:                os.Getenv("DATABASE_URL"),
		DBMaxOpenConns:             getIntEnv("DB_MAX_OPEN_CONNS", defaultDBMaxOpenConns),
		DBMaxIdleConns:             getIntEnv("DB_MAX_IDLE_CONNS", defaultDBMaxIdleConns),
		DBConnMaxLifetimeSeconds:   getIntEnv("DB_CONN_MAX_LIFETIME_SECONDS", defaultDBConnMaxLifetimeSeconds),
		AppSecret:                  defaultDevSecret(appEnv, secretEnv("APP_SECRET")),
		AllowPublicSignup:          getBoolEnv("ALLOW_PUBLIC_SIGNUP", false),
		CookieSecure:               getBoolEnv("COOKIE_SECURE", appEnv == "production"),
		AdminUsername:              defaultDevAdminUsername(appEnv, os.Getenv("ADMIN_USERNAME")),
		AdminPassword:              defaultDevAdminPassword(appEnv, secretEnv("ADMIN_PASSWORD")),
		AdminDisplayName:           defaultDevAdminDisplayName(appEnv, os.Getenv("ADMIN_DISPLAY_NAME")),
		RequirePersistentStorage:   requirePersistentStorage(appEnv, os.Getenv("REQUIRE_PERSISTENT_STORAGE")),
		AssetStorageDir:            getEnv("ASSET_STORAGE_DIR", "./data/assets"),
		AssetArchiveTimezone:       getEnv("ASSET_ARCHIVE_TIMEZONE", "Asia/Shanghai"),
		PublicAssetBaseURL:         strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_ASSET_BASE_URL")), "/"),
		MaxAssetUploadBytes:        getInt64Env("MAX_ASSET_UPLOAD_BYTES", 100*1024*1024),
		RedisURL:                   os.Getenv("REDIS_URL"),
		CeleryQueueName:            getEnv("CELERY_QUEUE_NAME", "celery"),
		JobMaxAttempts:             getIntEnv("JOB_MAX_ATTEMPTS", 3),
		JobDefaultTimeoutSeconds:   getIntEnv("JOB_DEFAULT_TIMEOUT", 900),
		WebDAVAllowedHosts:         parseCommaSeparated(os.Getenv("WEBDAV_ALLOWED_HOSTS")),
		WebDAVProxyTimeoutSeconds:  getIntEnv("WEBDAV_PROXY_TIMEOUT_SECONDS", defaultWebDAVProxyTimeoutSeconds),
		WebDAVMaxRequestBytes:      getInt64Env("WEBDAV_MAX_REQUEST_BYTES", defaultWebDAVMaxRequestBytes),
		SDVideoBaseURL:             strings.TrimRight(strings.TrimSpace(os.Getenv("SD_VIDEO_BASE_URL")), "/"),
		AssetStorageBackend:        getEnv("ASSET_STORAGE_BACKEND", "local"),
		OSSRegion:                  os.Getenv("STUDIO_OSS_REGION"),
		OSSEndpoint:                os.Getenv("STUDIO_OSS_ENDPOINT"),
		OSSBucket:                  os.Getenv("STUDIO_OSS_BUCKET"),
		OSSAccessKeyID:             secretEnv("STUDIO_OSS_ACCESS_KEY_ID"),
		OSSAccessKeySecret:         secretEnv("STUDIO_OSS_ACCESS_KEY_SECRET"),
		OSSSecurityToken:           secretEnv("STUDIO_OSS_SECURITY_TOKEN"),
		SupabaseStorageURL:         os.Getenv("STUDIO_SUPABASE_URL"),
		SupabaseStoragePublicURL:   os.Getenv("STUDIO_SUPABASE_PUBLIC_URL"),
		SupabaseStorageBucket:      os.Getenv("STUDIO_SUPABASE_BUCKET"),
		SupabaseStorageToken:       os.Getenv("STUDIO_SUPABASE_STORAGE_TOKEN"),
		SupabaseStorageTokenFile:   os.Getenv("STUDIO_SUPABASE_STORAGE_TOKEN_FILE"),
		SupabaseStorageAPIKey:      os.Getenv("STUDIO_SUPABASE_API_KEY"),
		SupabaseStorageAPIKeyFile:  os.Getenv("STUDIO_SUPABASE_API_KEY_FILE"),
		SupabaseStorageCAFile:      os.Getenv("STUDIO_SUPABASE_CA_FILE"),
		AssetCDNBaseURL:            os.Getenv("ASSET_CDN_BASE_URL"),
		AssetCDNAuthKey:            secretEnv("ASSET_CDN_AUTH_KEY"),
		SDVideoMode:                normalizeSDVideoMode(os.Getenv("SD_VIDEO_MODE")),
		SDVideoAllowedWorkspaces:   parseCommaSeparated(os.Getenv("SD_VIDEO_ALLOWED_WORKSPACES")),
		SDVideoAllowedModels:       parseCommaSeparated(os.Getenv("SD_VIDEO_ALLOWED_MODELS")),
		SDVideoJWTPrivateKey:       os.Getenv("SD_VIDEO_JWT_PRIVATE_KEY"),
		SDVideoJWTKeyID:            getEnv("SD_VIDEO_JWT_KID", "studio-sdvideo-1"),
		SDVideoJWTIssuer:           getEnv("SD_VIDEO_JWT_ISSUER", "ai-manju-studio"),
		SDVideoJWTAudience:         getEnv("SD_VIDEO_JWT_AUDIENCE", "sd-video"),
		SDVideoRequestTimeoutMilli: getIntEnv("SD_VIDEO_REQUEST_TIMEOUT_MILLISECONDS", 120000),
		SDVideoBridgeEnabled:       getBoolEnv("SD_VIDEO_BRIDGE_ENABLED", true),
		SDVideoBridgeIntervalSec:   getIntEnv("SD_VIDEO_BRIDGE_INTERVAL_SECONDS", 5),
		SDVideoBridgeBatchSize:     getIntEnv("SD_VIDEO_BRIDGE_BATCH_SIZE", 20),
	}

	cfg.CeleryBrokerURL = getEnv("CELERY_BROKER_URL", cfg.RedisURL)
	if cfg.DatabaseURL == "" {
		cfg.DatabaseURL = buildPostgresDSN()
	}
	if cfg.AppEnv == "production" && strings.TrimSpace(cfg.AppSecret) == "" {
		panic("APP_SECRET is required in production")
	}
	return cfg
}

func normalizeSDVideoMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "shadow", "active":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "disabled"
	}
}

// 密钥可以来自只读挂载文件，示例配置和日志不携带真实值。
func secretEnv(name string) string {
	if file := strings.TrimSpace(os.Getenv(name + "_FILE")); file != "" {
		data, err := os.ReadFile(file)
		if err != nil {
			panic("cannot read secret file for " + name)
		}
		return strings.TrimSpace(string(data))
	}
	return os.Getenv(name)
}

func (c Config) HasAdminBootstrap() bool {
	return strings.TrimSpace(c.AdminUsername) != "" && strings.TrimSpace(c.AdminPassword) != ""
}

func defaultDevSecret(appEnv string, value string) string {
	if strings.TrimSpace(value) != "" || appEnv == "production" {
		return value
	}

	return "dev-local-session-secret-change-before-production"
}

func defaultDevAdminUsername(appEnv string, value string) string {
	if strings.TrimSpace(value) != "" || appEnv == "production" {
		return strings.TrimSpace(value)
	}

	return "admin"
}

func defaultDevAdminPassword(appEnv string, value string) string {
	if strings.TrimSpace(value) != "" || appEnv == "production" {
		return value
	}

	return "admin12345"
}

func defaultDevAdminDisplayName(appEnv string, value string) string {
	if strings.TrimSpace(value) != "" || appEnv == "production" {
		return strings.TrimSpace(value)
	}

	return "Local Admin"
}

func normalizeStorageDriver(appEnv string, value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value != "" {
		return value
	}
	if appEnv == "development" || appEnv == "test" {
		return "memory"
	}
	return "postgres"
}

func requirePersistentStorage(appEnv string, value string) bool {
	if appEnv == "production" {
		return true
	}
	return getBoolValue(value, appEnv != "development" && appEnv != "test")
}

func parseFrontendURLs(frontendURLs string, fallback string) []string {
	source := frontendURLs
	if strings.TrimSpace(source) == "" {
		source = fallback
	}

	seen := make(map[string]bool)
	urls := make([]string, 0)
	for _, part := range strings.Split(source, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		urls = append(urls, trimmed)
	}

	if len(urls) == 0 {
		return []string{"http://localhost:3100"}
	}

	return urls
}

func parseCommaSeparated(source string) []string {
	seen := make(map[string]bool)
	values := make([]string, 0)
	for _, part := range strings.Split(source, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		values = append(values, trimmed)
	}
	return values
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}

func getBoolEnv(key string, fallback bool) bool {
	return getBoolValue(os.Getenv(key), fallback)
}

func getBoolValue(raw string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(raw))
	if value == "" {
		return fallback
	}

	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func getInt64Env(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}

func getIntEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}

func buildPostgresDSN() string {
	host := os.Getenv("DB_HOST")
	if host == "" {
		return ""
	}

	port := getEnv("DB_PORT", "5432")
	user := getEnv("DB_USER", "postgres")
	password := secretEnv("DB_PASSWORD")
	dbName := getEnv("DB_NAME", "ai_manju")
	sslMode := getEnv("DB_SSLMODE", "disable")

	if password == "" {
		return fmt.Sprintf("host=%s port=%s user=%s dbname=%s sslmode=%s", host, port, user, dbName, sslMode)
	}

	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, port, user, password, dbName, sslMode)
}
