import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { calculateHoldings } from './portfolio-logic';

export async function getPortfolioData() {
    const filePath = path.join(process.cwd(), 'data', 'portfolio.csv');

    if (!fs.existsSync(filePath)) {
        return { transactions: [], holdings: [], performance: [] };
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');

    return new Promise((resolve) => {
        Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: (results) => {
                const transactions = processTransactions(results.data);
                const holdings = calculateHoldings(transactions, {}); // No prices yet
                resolve({ transactions, holdings, performance: [] });
            },
        });
    });
}

function processTransactions(rawRow) {
    return rawRow.map(row => {
        // Clean symbol: "BTC (Bitcoin)" -> "BTC"
        let symbol = row['Base currency'] || '';
        const cleanMatch = symbol.match(/^([^\s]+)/); // Take first word/part
        symbol = cleanMatch ? cleanMatch[1] : symbol;

        const type = row['Base type']; // CRYPTO, FIAT, FUND, STOCK...

        // Yahoo Finance normalization
        if (type === 'CRYPTO') {
            // Avoid double suffix if it already has one (rare in this CSV but good practice)
            if (!symbol.includes('-')) symbol += '-USD';
        } else if (type === 'FIAT') {
            if (symbol !== 'USD') symbol += '=X'; // e.g. EUR=X
        }
        // STOCKS/FUNDS usually good as is (DTLA.L)

        return {
            id: Math.random().toString(36).substr(2, 9),
            date: new Date(row.Date).toISOString(),
            type: row.Way,
            baseAmount: row['Base amount'],
            baseCurrency: symbol,
            quoteAmount: row['Quote amount'],
            quoteCurrency: row['Quote currency'],
            exchange: row.Exchange,
            fee: row['Fee amount'] || 0,
            feeCurrency: row['Fee currency (name)'],
            originalType: type // Keep for reference
        };
    }).filter(t => t.baseCurrency) // Filter out empty lines/bad data
        .sort((a, b) => new Date(b.date) - new Date(a.date));
}
