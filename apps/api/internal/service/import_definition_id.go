package service

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Import definition IDs make an uncertain create response safe to retry. Include
// the actor as well as the scope so a shared workspace cannot replay another
// user's import key. Ordinary creates continue using random IDs.
func importDefinitionID(prefix, scope, userID, key string) string {
	if strings.TrimSpace(key) == "" {
		return prefix + randomHex(12)
	}
	digest := sha256.Sum256([]byte(scope + "\x00" + userID + "\x00" + strings.TrimSpace(key)))
	return prefix + hex.EncodeToString(digest[:12])
}
