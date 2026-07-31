import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addServer } from '@/lib/servers';
import { createOmniClient } from '@omni/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

interface AddServerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the id of the newly added server once it validated and was saved. */
  onAdded: (serverId: string) => void;
}

/**
 * A validation failure the user can act on.
 *
 * `hint` carries the operator-facing remedy — notably the CORS one, which is
 * the single most common reason a perfectly good URL and key still fail from a
 * browser.
 */
interface ValidationFailure {
  message: string;
  hint?: string;
}

/** Trim, add a scheme if the user omitted it, and reject anything not a URL. */
function normalizeBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return null;
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return withScheme;
  } catch {
    return null;
  }
}

/**
 * Classify a failure from the candidate server's `auth.validate`.
 *
 * A `TypeError` from fetch is indistinguishable at the JS level from a CORS
 * rejection — the browser hides the response on purpose — so both land here and
 * must NOT be reported as a bad key: telling an operator their key is invalid
 * when the real problem is `OMNI_CORS_ORIGINS` sends them to rotate a
 * perfectly good credential.
 */
function classifyValidationError(error: unknown, baseUrl: string): ValidationFailure {
  if (error instanceof TypeError) {
    return {
      message: `Could not reach ${baseUrl}.`,
      hint: `The request never got a response, which means the server is unreachable OR it rejected this dashboard's origin (${globalThis.window?.location.origin ?? 'this origin'}). Set OMNI_CORS_ORIGINS on the target server to include this origin, then try again.`,
    };
  }

  if (error instanceof SyntaxError) {
    // The SDK parses the body before checking the status, so a non-Omni host
    // answering with HTML surfaces as a JSON parse error rather than a status.
    return { message: `${baseUrl} answered, but not with an Omni API response.` };
  }

  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403) {
    return { message: 'The server rejected this API key.' };
  }
  if (status === 404) {
    return { message: `${baseUrl} responded, but has no /api/v2/auth/validate endpoint. Is it an Omni server?` };
  }
  if (typeof status === 'number') {
    return { message: `The server returned HTTP ${status}.` };
  }

  return { message: error instanceof Error ? error.message : 'Could not validate this server.' };
}

/**
 * Add a server to the registry — but only after proving the URL and key work.
 *
 * The candidate is validated with a throwaway SDK client built for the entered
 * URL and key, so nothing touches the registry or the active client until the
 * server answers. Failures leave the registry untouched.
 */
export function AddServerDialog({ open, onClose, onAdded }: AddServerDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [failure, setFailure] = useState<ValidationFailure | null>(null);

  /**
   * Attempt token. Incremented on every submit AND on every close, so a
   * validation the user walked away from can never come back and persist —
   * let alone activate — a server behind a dialog that is no longer open.
   * The SDK's `auth.validate()` takes no arguments, so the in-flight request
   * cannot be aborted; the token is what makes its late resolution inert.
   */
  const attemptRef = useRef(0);

  const reset = () => {
    setName('');
    setUrl('');
    setApiKey('');
    setFailure(null);
    setIsValidating(false);
  };

  const handleClose = () => {
    // Orphan any validation still in flight before the state it would write to
    // is torn down.
    attemptRef.current += 1;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setFailure(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFailure({ message: 'Give this server a name.' });
      return;
    }

    const baseUrl = normalizeBaseUrl(url);
    if (!baseUrl) {
      setFailure({ message: 'Enter a valid http(s) URL, for example https://omni.example.com.' });
      return;
    }

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setFailure({ message: 'An API key is required to validate this server.' });
      return;
    }

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    const isStale = () => attemptRef.current !== attempt;

    setIsValidating(true);
    try {
      // Throwaway client: the candidate is proven before anything is persisted,
      // and the singleton in lib/sdk keeps pointing at the current server.
      const candidate = createOmniClient({ baseUrl, apiKey: trimmedKey });
      const result = await candidate.auth.validate();
      // Checked before the write, not just before the UI update: a dialog the
      // user closed mid-validation must not persist or activate a server.
      if (isStale()) {
        return;
      }
      if (!result.valid) {
        setFailure({ message: 'The server rejected this API key.' });
        return;
      }

      const entry = addServer({ name: trimmedName, baseUrl, apiKey: trimmedKey });
      // Data from the previous server must not survive the activation that
      // follows in the parent.
      queryClient.clear();
      reset();
      onAdded(entry.id);
    } catch (error) {
      if (isStale()) {
        return;
      }
      setFailure(classifyValidationError(error, baseUrl));
    } finally {
      if (!isStale()) {
        setIsValidating(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          handleClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add server</DialogTitle>
          <DialogDescription>
            Connect this dashboard to another Omni API. The URL and key are checked before the server is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="server-name">Name *</Label>
            <Input
              id="server-name"
              placeholder="Production"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isValidating}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="server-url">URL *</Label>
            <Input
              id="server-url"
              placeholder="https://omni.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isValidating}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="server-key">API key *</Label>
            <Input
              id="server-key"
              type="password"
              placeholder="omni_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={isValidating}
              autoComplete="off"
            />
          </div>

          {failure && (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">{failure.message}</p>
                {failure.hint && <p className="text-destructive/80 text-xs leading-relaxed">{failure.hint}</p>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isValidating}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isValidating}>
            {isValidating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isValidating ? 'Validating…' : 'Validate & add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
