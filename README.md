# Portfolio Tracker

A minimalistic, dark-mode portfolio tracker built with Next.js, Recharts, and Yahoo Finance.

## Features

- **Live Market Data**: Real-time prices and 24h performance fetched via Yahoo Finance.
- **Visual Analytics**: Interactive performance charts with split-color gradients (green for profit, red for loss).
- **Comprehensive Holdings**: 3-column dashboard showing total value, net P/L, and daily nominal change.
- **Transaction History**: Detailed view of buy/sell/deposit actions with individual performance tracking.
- **USD Connectivity**: Option to deduct/add from a USD cash balance for purchases and sales.
- **Adaptive UI**: Beautiful, premium dark-mode interface with smooth animations.

## Getting Started

### Prerequisites

- Node.js 18.x or later
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Rovart/portfolio-tracker.git
   cd portfolio-tracker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Data Persistence

Transactions are saved locally in your browser's `localStorage` and synced back to `data/portfolio.csv` automatically.

## License

MIT
