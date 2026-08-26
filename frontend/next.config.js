/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // Next.js 16 uses Turbopack by default — provide empty config to satisfy it
  turbopack: {},
  webpack: (config, { isServer }) => {
    const falseModules = [
      '@x402/evm',
      '@x402/core/client',
      '@x402/svm/exact/client',
      '@x402/core',
      '@x402/svm',
    ];
    for (const mod of falseModules) {
      config.resolve.alias[mod] = false;
    }
    config.resolve.alias['pino-pretty'] = false;

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;