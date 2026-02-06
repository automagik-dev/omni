declare module 'qrcode-terminal' {
  interface QRCodeTerminalOptions {
    small?: boolean;
  }

  function generate(text: string, options?: QRCodeTerminalOptions, callback?: (qrArt: string) => void): void;
  function setErrorLevel(level: string): void;

  export { generate, setErrorLevel };
}
