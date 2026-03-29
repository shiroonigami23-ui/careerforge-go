# Fortran coverage helper

`coverage.F90` defines `cf_coverage_percent` (C binding) for a simple JD/resume keyword coverage ratio.

The default Go binary does **not** link this file; `internal/native/coverage` implements the same logic in Go. To experiment with Fortran + cgo on Linux, compile the object and link it from a small `cgo` wrapper (not required for normal builds).
