package server

import (
	"crypto/sha256"
	"encoding/hex"
)

func sha256HexForTest(salt []byte, password string) string {
	sum := sha256.Sum256(append(append([]byte{}, salt...), []byte(password)...))
	return hex.EncodeToString(sum[:])
}

func hexString(b []byte) string { return hex.EncodeToString(b) }
