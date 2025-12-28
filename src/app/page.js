'use client';

import { Suspense } from 'react';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', paddingBottom: '40px' }}>
      <Suspense fallback={<div style={{ background: '#000', minHeight: '100vh' }} />}>
        <Dashboard />
      </Suspense>
    </main>
  );
}
