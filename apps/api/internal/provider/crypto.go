package provider

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

var ErrMissingAppSecret = errors.New("APP_SECRET is required to store bearer api keys")

type SecretBox struct {
	appSecret string
}

func NewSecretBox(appSecret string) SecretBox {
	return SecretBox{appSecret: appSecret}
}

func (b SecretBox) Encrypt(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	if b.appSecret == "" {
		return "", ErrMissingAppSecret
	}

	block, err := aes.NewCipher(b.key())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (b SecretBox) Decrypt(encrypted string) (string, error) {
	if encrypted == "" {
		return "", nil
	}
	if b.appSecret == "" {
		return "", ErrMissingAppSecret
	}

	payload, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(b.key())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(payload) < gcm.NonceSize() {
		return "", errors.New("encrypted api key is invalid")
	}

	nonce := payload[:gcm.NonceSize()]
	ciphertext := payload[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plain), nil
}

func (b SecretBox) key() []byte {
	sum := sha256.Sum256([]byte(b.appSecret))
	return sum[:]
}
