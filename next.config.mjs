/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/lms-sync-extension.zip': ['./extension/**/*'],
  },
};

export default nextConfig;
