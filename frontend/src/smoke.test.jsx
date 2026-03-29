import { render, screen } from '@testing-library/react';
import CareerForge from './CareerForge';

describe('Smoke test', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows landing screen without auth', () => {
    render(<CareerForge />);
    expect(screen.getByText('Career Intelligence Platform')).toBeInTheDocument();
    expect(screen.getByText('Enter Workspace')).toBeInTheDocument();
  });
});
