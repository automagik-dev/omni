import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function Login() {
  const [apiKey, setApiKey] = useState('');
  const navigate = useNavigate();
  const { login, isLoggingIn, loginError } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    try {
      await login(apiKey.trim());
      navigate('/');
    } catch {
      // Error is handled by the mutation
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            <span className="text-primary">Omni</span> Dashboard
          </CardTitle>
          <CardDescription>Enter your API key to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="API Key (omni_...)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={isLoggingIn}
                autoFocus
              />
              {loginError && (
                <p className="text-sm text-destructive">
                  {loginError instanceof Error ? loginError.message : 'Invalid API key'}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isLoggingIn || !apiKey.trim()}>
              {isLoggingIn ? 'Validating...' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
