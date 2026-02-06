import { useTheme } from '@/context/ThemeContext';
import { Moon, Sun } from 'lucide-react';
import { Button } from './button';

/**
 * Theme toggle button - switches between light and dark mode
 */
export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {resolvedTheme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
