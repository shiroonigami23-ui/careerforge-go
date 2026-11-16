import { render, screen } from '@testing-library/react';
import CareerForge from './CareerForge';

describe('Smoke test', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the landing screen without signing in', () => {
    render(<CareerForge />);
    expect(screen.getByRole('button', { name: /Analyze a résumé/ })).toBeInTheDocument();
    expect(screen.getByText('Enter Workspace')).toBeInTheDocument();
  });
});
