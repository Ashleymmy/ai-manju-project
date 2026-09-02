package main

import (
	"log"
	"strings"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/router"
	"github.com/joho/godotenv"
)

func main() {
	// 加载环境变量
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}

	// 启动服务器
	cfg := config.Load()
	validateRuntimeSecurity(cfg)
	r := router.NewWithConfig(cfg)

	log.Printf("API listening on %s:%s", cfg.Host, cfg.Port)
	log.Printf("Local: http://localhost:%s", cfg.Port)
	log.Printf("LAN:   http://<host-lan-ip>:%s", cfg.Port)
	if err := r.Run(cfg.Host + ":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}

func validateRuntimeSecurity(cfg config.Config) {
	weakSecrets := map[string]bool{
		"":               true,
		"dev-secret":     true,
		"beta-change-me": true,
		"changeme":       true,
		"change-me":      true,
	}
	weakAdminPasswords := map[string]bool{
		"":         true,
		"admin":    true,
		"password": true,
		"123456":   true,
		"changeme": true,
	}

	weakAppSecret := weakSecrets[strings.TrimSpace(cfg.AppSecret)] || len(strings.TrimSpace(cfg.AppSecret)) < 16
	weakAdminPassword := weakAdminPasswords[strings.TrimSpace(cfg.AdminPassword)] || len(strings.TrimSpace(cfg.AdminPassword)) < 8
	if !weakAppSecret && !weakAdminPassword {
		return
	}

	message := "weak or missing security configuration detected: set strong APP_SECRET and ADMIN_PASSWORD before team Beta/production use"
	if cfg.AppEnv == "production" {
		log.Fatal(message)
	}
	log.Printf("WARNING: %s", message)
}
