import Papa from 'papaparse';

export function parsePortfolioCsv(text) {
    const parsedCsv = Papa.parse(String(text || ''), { header: true, skipEmptyLines: true });
    const rows = parsedCsv.data || [];
    const transactions = [];
    const csvPortfolioNames = new Set();

    for (const row of rows) {
        const cashFlag = row['Affects Quote Balance'] || row['Affects Cash Balance'] || row['Affects Fiat Balance'];
        const affectsQuoteBalance = parseCsvBoolean(cashFlag);
        const tx = {
            date: row.Date,
            type: row.Way,
            baseAmount: parseFloat(row['Base amount']) || 0,
            baseCurrency: row['Base currency (name)'] || row['Base currency'] || '',
            originalType: row['Base type'] || 'MANUAL',
            quoteAmount: row['Quote amount'] ? parseFloat(row['Quote amount']) : null,
            quoteCurrency: row['Quote currency'] || null,
            exchange: row.Exchange || null,
            fee: parseFloat(row['Fee amount']) || 0,
            feeCurrency: row['Fee currency (name)'] || null,
            affectsFiatBalance: affectsQuoteBalance,
            affectsQuoteBalance,
            notes: row.Notes || null,
            portfolioId: parseInt(row['Portfolio ID']) || null,
            csvPortfolioName: row['Portfolio Name'] || null,
        };

        if (tx.csvPortfolioName) csvPortfolioNames.add(tx.csvPortfolioName);

        if (tx.date && tx.baseCurrency) {
            transactions.push(tx);
        }
    }

    return {
        transactions,
        portfolioNames: Array.from(csvPortfolioNames),
    };
}

function parseCsvBoolean(value) {
    if (!value) return undefined;
    return ['TRUE', '1', 'YES', 'Y'].includes(String(value).toUpperCase());
}
