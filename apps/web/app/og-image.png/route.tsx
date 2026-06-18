import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export function GET(_req: NextRequest) {
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 60%, #3b82f6 100%)',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          padding: 60,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 96, marginBottom: 16, display: 'flex' }}>⚡</div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: '#ffffff',
            marginBottom: 16,
            display: 'flex',
            letterSpacing: '-2px',
          }}
        >
          Zobia Social
        </div>
        <div
          style={{
            fontSize: 32,
            color: 'rgba(255,255,255,0.85)',
            textAlign: 'center',
            display: 'flex',
            maxWidth: 800,
          }}
        >
          Connect, engage, and belong.
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
