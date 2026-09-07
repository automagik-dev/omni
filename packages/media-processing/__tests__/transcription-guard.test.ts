/**
 * Tests for the transcription output guard (issue #942).
 */

import { describe, expect, it } from 'bun:test';
import { detectInvalidTranscription } from '../src/transcription-guard';

describe('detectInvalidTranscription', () => {
  it('rejects empty and whitespace-only output', () => {
    expect(detectInvalidTranscription('')).toContain('empty');
    expect(detectInvalidTranscription('   \n\t ')).toContain('empty');
  });

  it('rejects Portuguese assistant meta-responses', () => {
    const metaResponses = [
      'Claro, por favor me diga o que você gostaria que fosse transcrito. Se tiver um áudio ou uma fala específica, descreva o conteúdo.',
      'Claro! Por favor, envie o áudio que deseja transcrever.',
      'Desculpe, não consigo transcrever este áudio.',
      'Não consigo acessar o áudio enviado.',
      'Parece que não há áudio na mensagem.',
      'Infelizmente não recebi nenhum áudio para transcrever.',
      'Por favor, envie o áudio novamente.',
    ];
    for (const text of metaResponses) {
      expect(detectInvalidTranscription(text)).toBeDefined();
    }
  });

  it('rejects English assistant meta-responses', () => {
    const metaResponses = [
      'Sure, please provide the audio you would like transcribed.',
      "I'm sorry, I cannot transcribe this audio.",
      'I don’t have access to the audio you mentioned.',
      'It seems there is no audio attached to this message.',
      'Unfortunately, no audio was provided.',
      'Please provide the audio file you want transcribed.',
      'Could you please send the audio again?',
    ];
    for (const text of metaResponses) {
      expect(detectInvalidTranscription(text)).toBeDefined();
    }
  });

  it('accepts ordinary transcripts, including ones starting with "Claro"', () => {
    const transcripts = [
      'Oi, tudo bem? Queria marcar a consulta pra quinta-feira de manhã.',
      'Claro que eu vou na festa, pode me esperar lá pelas oito.',
      'Sure thing, I will send the report by Friday afternoon.',
      'Desculpa aí o horário, mas preciso remarcar a reunião de amanhã.'.repeat(6),
      'Sorry pelo atraso, o trânsito estava impossível hoje.'.repeat(8),
    ];
    for (const text of transcripts) {
      expect(detectInvalidTranscription(text)).toBeUndefined();
    }
  });

  it('accepts long transcripts even when they open with a meta-response phrase', () => {
    const longTranscript = `Claro, por favor me avisa quando você chegar. ${'Então, sobre o projeto, a gente precisa revisar o cronograma e alinhar com o time de produto antes da sprint. '.repeat(4)}`;
    expect(detectInvalidTranscription(longTranscript)).toBeUndefined();
  });
});
