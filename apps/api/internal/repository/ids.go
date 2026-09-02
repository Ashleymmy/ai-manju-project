package repository

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

func randomRepositoryHex(bytesCount int) string {
	bytes := make([]byte, bytesCount)
	if _, err := rand.Read(bytes); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405.000000000")))
	}

	return hex.EncodeToString(bytes)
}
