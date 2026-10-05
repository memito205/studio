import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Solo fotos de pruebas de entrega: Storage del proyecto y evidencias Quick. */
const ALLOWED_HOSTS = ['firebasestorage.googleapis.com', 'enterprise-img.smartquick.com.co'];
const MAX_BYTES = 15 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') || '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new Response('URL inválida', { status: 400 });
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
    return new Response('Host no permitido', { status: 400 });
  }
  if (url.hostname === 'firebasestorage.googleapis.com' && !url.pathname.includes('/o/entregas%2F')) {
    return new Response('Ruta no permitida', { status: 400 });
  }

  try {
    const upstream = await fetch(url.toString(), { cache: 'no-store' });
    if (!upstream.ok) return new Response(`Origen respondió ${upstream.status}`, { status: upstream.status });
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!type.startsWith('image/')) return new Response('No es una imagen', { status: 415 });
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return new Response('Imagen demasiado grande', { status: 413 });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store' },
    });
  } catch (error: any) {
    return new Response(error?.message || 'No se pudo descargar', { status: 502 });
  }
}
