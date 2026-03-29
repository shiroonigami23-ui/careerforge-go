package coverage

// Percent returns keyword coverage 0–100 given hits vs JD unique keyword count.
func Percent(hits, jdTotal int) int {
	if jdTotal <= 0 {
		return 0
	}
	if hits < 0 {
		hits = 0
	}
	if hits > jdTotal {
		hits = jdTotal
	}
	r := float64(hits) / float64(jdTotal) * 100
	return int(r + 0.5)
}
