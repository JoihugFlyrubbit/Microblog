/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  images: {
    unoptimized: true,
  },
  // API calls will be made to the Workers API
  // This is configured at runtime via environment variables
};

export default nextConfig;
