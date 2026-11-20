import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Task Reminder App',
  description: 'Phone-first reminders: tasks under main projects, daily tasks, priorities, voice capture and friendly reminders.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Task Reminder App', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#000000' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><link rel="apple-touch-icon" href="/icon-192.png" /><link rel="icon" href="/icon-192.png" /></head>
      <body>{children}</body>
    </html>
  );
}
