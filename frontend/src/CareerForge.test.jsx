import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CareerForge from './CareerForge';

describe('CareerForge UI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the landing page with the sample report', () => {
    render(<CareerForge />);
    expect(screen.getAllByText('CareerForge').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/résumé/i);
    expect(screen.getByLabelText('Sample report')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Analyze a résumé/ })).toBeInTheDocument();
  });

  it('opens the analyzer and enables Analyze fit only with both documents', async () => {
    const user = userEvent.setup();
    render(<CareerForge />);
    await user.click(screen.getByRole('button', { name: /Analyze a résumé/ }));
    const analyze = screen.getByRole('button', { name: /Analyze fit/ });
    expect(analyze).toBeDisabled();
    await user.upload(document.getElementById('resume-upload'), new File(['Python Docker'], 'cv.txt', { type: 'text/plain' }));
    expect(screen.getByText(/cv\.txt/)).toBeInTheDocument();
    expect(analyze).toBeDisabled();
    await user.type(screen.getByLabelText('Job description text'), 'Python developer');
    expect(analyze).toBeEnabled();
  });

  it('rejects unsupported files with a clear message', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<CareerForge />);
    await user.click(screen.getByRole('button', { name: /Analyze a résumé/ }));
    await user.upload(document.getElementById('resume-upload'), new File(['MZ'], 'setup.exe'));
    expect(await screen.findByRole('status')).toHaveTextContent(/\.exe files are not supported/);
  });

  it('opens the sign-in dialog and switches to account creation', async () => {
    const user = userEvent.setup();
    render(<CareerForge />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('dialog', { name: 'Create an account' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('switches between light and dark theme', async () => {
    const user = userEvent.setup();
    render(<CareerForge />);
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(localStorage.getItem('careerforge_theme')).toBe('dark');
  });
});
