package seed

// Mix combines two 64-bit values for deterministic FAQ selection (used with hash input).
func Mix(a, b uint64) uint64 {
	return seedMix(a, b)
}
