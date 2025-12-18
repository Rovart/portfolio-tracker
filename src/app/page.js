import { getPortfolioData } from '@/utils/data';
import Dashboard from '@/components/Dashboard';

export default async function Home() {
  const { transactions, holdings, performance } = await getPortfolioData();

  return (
    <main style={{ minHeight: '100vh', paddingBottom: '40px' }}>
      <Dashboard
        initialTransactions={transactions}
        initialHoldings={holdings}
        initialPerformance={performance}
      />
    </main>
  );
}
