// func seedMix(a, b uint64) uint64
TEXT ·seedMix(SB), $0-24
	MOVQ a+0(FP), AX
	MOVQ b+8(FP), BX
	XORQ BX, AX
	MOVQ AX, ret+16(FP)
	RET
