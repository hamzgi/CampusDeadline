import { readFileSync } from 'node:fs';
import path from 'node:path';
import Script from 'next/script';

// Keep the original dashboard markup intact while Next.js serves the page.
const originalHtml = readFileSync(path.join(process.cwd(), 'source', 'index.html'), 'utf8');
const bodyMatch = originalHtml.match(/<body>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('The original dashboard body was not found.');
const dashboardHtml = bodyMatch[1].replace(/<script src="app\.js"><\/script>/i, '');

export default function Home() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: dashboardHtml }} />
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}
