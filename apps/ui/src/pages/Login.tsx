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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      {/* Atmospheric background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-1/4 -top-1/4 h-[600px] w-[600px] rounded-full bg-primary/10 blur-[128px]" />
        <div className="absolute -bottom-1/4 -right-1/4 h-[500px] w-[500px] rounded-full bg-info/8 blur-[128px]" />
      </div>

      <Card className="relative w-full max-w-md border-white/10 bg-card/60 backdrop-blur-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            <span className="bg-gradient-to-r from-primary to-info bg-clip-text font-display font-bold text-transparent">
              OMNI
            </span>
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
            <Button type="submit" variant="glow" className="w-full" disabled={isLoggingIn || !apiKey.trim()}>
              {isLoggingIn ? 'Validating...' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
