import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['sharp', '@huggingface/transformers', 'onnxruntime-node'],
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },   // join codes live in the URL
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};
export default config;
