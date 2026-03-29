import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CareerForge from './CareerForge';

describe('CareerForge UI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders landing and auth sections', () => {
    render(<CareerForge />);

    expect(screen.getByText('CareerForge')).toBeInTheDocument();
    expect(screen.getByText('Career Intelligence Platform')).toBeInTheDocument();
    expect(screen.getByText('Enter Workspace')).toBeInTheDocument();
  });

  it('opens and closes JD modal after entering workspace', async () => {
    const user = userEvent.setup();

    render(<CareerForge />);
    await user.click(screen.getByText('Enter Workspace'));

    await user.click(screen.getAllByText('Resume Lab')[0]);
    await user.click(screen.getByText('Add Job Description'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByText('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
