! gfortran -c -o coverage.o coverage.F90
! Used for optional native coverage ratio; default build uses pure Go in internal/native/coverage.
function cf_coverage_percent(hits, total) bind(c, name="cf_coverage_percent")
  use, intrinsic :: iso_c_binding, only: c_int, c_double
  integer(c_int), value :: hits, total
  real(c_double) :: cf_coverage_percent
  if (total <= 0) then
    cf_coverage_percent = 0.0_c_double
  else
    cf_coverage_percent = 100.0_c_double * dble(min(hits, total)) / dble(total)
  end if
end function cf_coverage_percent
