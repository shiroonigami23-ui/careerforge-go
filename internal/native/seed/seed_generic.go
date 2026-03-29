//go:build !amd64

package seed

func seedMix(a, b uint64) uint64 {
	return a ^ b
}
