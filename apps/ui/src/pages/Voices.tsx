import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { useUpdateSetting } from '@/hooks/useSettings';
import { useVoices } from '@/hooks/useVoices';
import { cn } from '@/lib/utils';
import { Check, Mic, Play, Search } from 'lucide-react';
import { useState } from 'react';

function VoicesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="mb-3 h-12 w-full" />
            <div className="flex gap-1">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function Voices() {
  const { data: voices, isLoading, error } = useVoices();
  const updateSetting = useUpdateSetting();
  const [searchQuery, setSearchQuery] = useState('');
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const filteredVoices = voices?.filter((voice) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      voice.name.toLowerCase().includes(query) ||
      voice.category.toLowerCase().includes(query) ||
      voice.description?.toLowerCase().includes(query) ||
      Object.values(voice.labels).some((l) => l.toLowerCase().includes(query))
    );
  });

  const handleSetDefault = async (voiceId: string, voiceName: string) => {
    setSettingDefaultId(voiceId);
    try {
      await updateSetting.mutateAsync({ key: 'elevenlabs.default_voice', value: voiceId });
      toast.success(`Default voice set to ${voiceName}`);
    } catch (err) {
      toast.error(`Failed to set default: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handlePreview = (voiceId: string, previewUrl: string | null) => {
    if (!previewUrl) return;

    if (playingId === voiceId) {
      setPlayingId(null);
      return;
    }

    setPlayingId(voiceId);
    const audio = new Audio(previewUrl);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => {
      setPlayingId(null);
      toast.error('Failed to play preview');
    };
    audio.play();
  };

  return (
    <>
      <Header title="Voices" subtitle="Browse and configure ElevenLabs TTS voices" />

      <div className="flex-1 overflow-auto p-6">
        {/* Search bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search voices by name, category, or label..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {isLoading ? (
          <VoicesSkeleton />
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Mic className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">Failed to load voices</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Make sure your ElevenLabs API key is configured in Settings.
              </p>
            </CardContent>
          </Card>
        ) : !voices || voices.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Mic className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">No voices available</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure your ElevenLabs API key in Settings to browse available voices.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {filteredVoices?.length} voice{filteredVoices?.length === 1 ? '' : 's'}
              {searchQuery && ` matching "${searchQuery}"`}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredVoices?.map((voice) => (
                <Card key={voice.voiceId} className="group transition-shadow hover:shadow-md">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="truncate">{voice.name}</span>
                      <Badge variant="secondary" className="ml-2 shrink-0 text-xs">
                        {voice.category}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {voice.description && (
                      <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{voice.description}</p>
                    )}

                    {/* Labels */}
                    {Object.keys(voice.labels).length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-1">
                        {Object.entries(voice.labels).map(([key, value]) => (
                          <Badge key={key} variant="outline" className="text-xs">
                            {value}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      {voice.previewUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePreview(voice.voiceId, voice.previewUrl)}
                          className="h-8"
                        >
                          <Play className={cn('mr-1 h-3 w-3', playingId === voice.voiceId && 'text-primary')} />
                          {playingId === voice.voiceId ? 'Playing...' : 'Preview'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSetDefault(voice.voiceId, voice.name)}
                        disabled={settingDefaultId === voice.voiceId}
                        className="h-8"
                      >
                        {settingDefaultId === voice.voiceId ? (
                          <Check className="mr-1 h-3 w-3 animate-pulse" />
                        ) : (
                          <Check className="mr-1 h-3 w-3" />
                        )}
                        Set Default
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
