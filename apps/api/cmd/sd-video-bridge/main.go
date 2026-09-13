package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/router"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := router.RunSDVideoBridge(ctx, config.Load()); err != nil {
		log.Fatal(err)
	}
}
